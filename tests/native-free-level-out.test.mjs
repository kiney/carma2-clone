import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { nativeFreeLevelOutDelta } from "../src/physics/native-free-level-out.ts";
import { applyNativeFreeForces40 } from "../src/physics/native-free-forces.ts";
import { nativePedBoneMassProperties } from "../src/physics/ped-bone-body.ts";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";

const f = Math.fround,
  identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function input(extra = {}) {
  return {
    inertia: new Vector3(1, 1, 1),
    actorMatrix: identity,
    waterPlaneNormal: new Vector3(0, 1, 0),
    ...extra,
  };
}
const add = (omega, delta) =>
  omega.map((value, i) => f(value + delta.getComponent(i)));

test("strict largest moment selects X or Y; every remaining case, including X/Y largest tie, selects Z", () => {
  for (const [moments, axis] of [
    [[3, 2, 1], 0],
    [[2, 3, 1], 1],
    [[1, 2, 3], 2],
    [[3, 3, 1], 2],
    [[3, 1, 3], 2],
    [[1, 3, 3], 2],
    [[1, 1, 1], 2],
  ])
    assert.equal(
      nativeFreeLevelOutDelta(input({ inertia: new Vector3(...moments) })).axis,
      axis,
    );
  const sphere = nativeFreeLevelOutDelta(input());
  assert.equal(sphere.status, "applied");
  assert.deepEqual(sphere.bodyDelta.toArray(), [-1, 0, 0]);
  const uprightY = nativeFreeLevelOutDelta(
    input({ inertia: new Vector3(1, 2, 1) }),
  );
  assert.equal(uprightY.status, "skipped");
  assert.equal(uprightY.dot, -1);
});

test("the dot gate compares live X+Y+Z with double -.99, before the Float32 scratch spill", () => {
  const matrix = [...identity];
  matrix.splice(6, 3, 1, -1, 0);
  const r = nativeFreeLevelOutDelta(
    input({
      actorMatrix: matrix,
      waterPlaneNormal: new Vector3(f(0.99), 2 ** -26, 0),
    }),
  );
  assert.ok(r.dot > -0.99);
  assert.ok(f(r.dot) < -0.99);
  assert.equal(r.status, "applied");
  const below = nativeFreeLevelOutDelta(
    input({
      actorMatrix: matrix,
      waterPlaneNormal: new Vector3(f(0.99), 0, 0),
    }),
  );
  assert.equal(below.status, "skipped");
});

test("installed numerical replay: sequential normalization and full sheared basis transpose match Float32 omega", () => {
  // Numerical input/output probes of installed4b6d50; no MODEL or executable bytes.
  const probes = [
    {
      moments: [2.2110559940338135, 3.397563934326172, 0.45469000935554504],
      basis: [
        1.315999984741211, 0.11400000005960464, -0.7350000143051147,
        -1.2699999809265137, -2.496999979019165, -1.1419999599456787,
        -1.7350000143051147, -0.7260000109672546, -0.800000011920929,
      ],
      normal: [-1.9390000104904175, 0.028999999165534973, 1.6480000019073486],
      omega: [-0.4449999928474426, -2.7219998836517334, 1.8289999961853027],
      expected: [-0.391652375459671, -2.64263653755188, 2.438399076461792],
    },
    {
      moments: [8.36954402923584, 2.1478240489959717, 0.8965010046958923],
      basis: [
        -1.2519999742507935, -1.656999945640564, 1.3890000581741333,
        2.563999891281128, -2.23799991607666, -1.7430000305175781,
        -1.0230000019073486, -2.562000036239624, -1.3049999475479126,
      ],
      normal: [2.2039999961853027, -1.1380000114440918, -2.244999885559082],
      omega: [-0.9089999794960022, 0.5299999713897705, 1.2669999599456787],
      expected: [-0.10118895769119263, 2.226980686187744, -8.243285179138184],
    },
  ];
  for (const p of probes) {
    const r = nativeFreeLevelOutDelta(
      input({
        inertia: new Vector3(...p.moments),
        actorMatrix: [...p.basis, 17, -23, 1000],
        waterPlaneNormal: new Vector3(...p.normal),
      }),
    );
    assert.equal(r.status, "applied");
    assert.deepEqual(add(p.omega, r.bodyDelta), p.expected);
    const translated = nativeFreeLevelOutDelta(
      input({
        inertia: new Vector3(...p.moments),
        actorMatrix: [...p.basis, -200, 33, 12],
        waterPlaneNormal: new Vector3(...p.normal),
      }),
    );
    assert.deepEqual(translated.bodyDelta.toArray(), r.bodyDelta.toArray());
    const a = new Vector3(
        ...p.basis.slice(r.axis * 3, r.axis * 3 + 3),
      ).negate(),
      ordinary = new Vector3(...p.normal)
        .cross(a)
        .normalize()
        .multiplyScalar(1 + f(r.dot));
    assert.ok(ordinary.distanceTo(r.worldDelta) > 0.01);
  }
});

test("source parallel-axis singularity is reported honestly; input omega/matrix/normal are never mutated", () => {
  const matrix = [...identity];
  matrix[4] = -1;
  const supplied = input({
      inertia: new Vector3(1, 2, 1),
      actorMatrix: matrix,
    }),
    saved = JSON.stringify(supplied),
    r = nativeFreeLevelOutDelta(supplied);
  assert.equal(r.dot, 1);
  assert.equal(r.status, "singular");
  assert.ok(r.bodyDelta.toArray().every(Number.isNaN));
  assert.equal(JSON.stringify(supplied), saved);
});

test("missing or nonfinite native providers fail clearly rather than inventing a rotation-only matrix", () => {
  assert.throws(
    () => nativeFreeLevelOutDelta(input({ actorMatrix: identity.slice(0, 9) })),
    /native12/,
  );
  assert.throws(
    () =>
      nativeFreeLevelOutDelta(
        input({ waterPlaneNormal: new Vector3(0, NaN, 0) }),
      ),
    /Non-finite/,
  );
  assert.throws(
    () =>
      nativeFreeLevelOutDelta(input({ inertia: new Vector3(Infinity, 1, 1) })),
    /Non-finite/,
  );
});

test("generic force adapter owns strict depth/viscosity/header gates and adds the recovered BODY delta after drag", () => {
  let calls = 0;
  const makePacket = () => ({
    headerState: 2,
    doNothing: false,
    headerFlags: 12,
    gravity: 1,
    drag: 0,
    levelOut: 1,
    mass: f(0.004),
    inertia: new Vector3(0.0001, 0.0001, 0.0001),
    worldVelocity: new Vector3(),
    localOmega: new Vector3(),
    gravityIncrement: new Vector3(),
  });
  for (const [depth, viscosity, L, flags, count] of [
    [0.5, 5, 1, 12, 1],
    [1, 5, 1, 12, 0],
    [0.5, 2, 1, 12, 0],
    [0.5, 5, 0, 12, 0],
    [0.5, 5, 1, 4, 0],
  ]) {
    const p = makePacket();
    p.levelOut = L;
    p.headerFlags = flags;
    const snapshot = {
      volume: { identity: {}, gravity: f(0.2), viscosity },
      depth,
    };
    calls = 0;
    const r = applyNativeFreeForces40(p, {
      globalGravity: 1,
      volumeStep: { before: snapshot, after: snapshot },
      retainedJoint2: "absent",
      levelOut: ({ packet }) => {
        calls++;
        assert.deepEqual(packet.localOmega.toArray(), [0, 0, 0]);
        return nativeFreeLevelOutDelta(input({ inertia: packet.inertia }))
          .bodyDelta;
      },
    });
    assert.equal(r.status, "complete");
    assert.equal(calls, count);
    assert.deepEqual(p.localOmega.toArray(), count ? [-1, 0, 0] : [0, 0, 0]);
  }
});

for (const tree of ["data", "adv_data"])
  for (const name of ["Blokebl", "Bandsman", "twolf"])
    test(`${tree} original ${name} detached head uses authored MODEL moments in water`, async (t) => {
      let store;
      try {
        store = await createAssetStore(
          process.env.CARMA2_ROOT ?? "carma2_orig",
        );
      } catch (error) {
        if (
          error?.code === "ENOENT" ||
          /Original installation/.test(String(error))
        ) {
          t.skip("Original installation unavailable");
          return;
        }
        throw error;
      }
      const assets = new Assets();
      assets.manifest = store.manifest;
      assets.lookup = new Map(
        store.manifest.map((item) => [item.path.toLowerCase(), item.path]),
      );
      assets.bytes = async (path) => new Uint8Array(await store.read(path));
      const native = await loadNativePedAssets(
          assets,
          `PEDS/PEEPS/${name}`,
          name,
          tree,
        ),
        index = native.form.headBone,
        bone = native.form.bones[index],
        variant = native.bones[index].variants[0],
        bounds = variant.modelBounds.get(variant.sourceModels[0]),
        properties = nativePedBoneMassProperties(bone.mass, {
          min: bounds.min.toArray(),
          max: bounds.max.toArray(),
        }),
        r = nativeFreeLevelOutDelta(input({ inertia: properties.inertia }));
      assert.equal(bone.collisionType, "SPHERE");
      assert.equal(bone.massKg, name === "twolf" ? 2 : 4);
      // SPHERE contact geometry retains box-derived MODEL moments; these real
      // human heads choose Y, whereas the authored dog head chooses X.
      assert.equal(r.axis, name === "twolf" ? 0 : 1);
      assert.equal(r.status, name === "twolf" ? "applied" : "skipped");
      assert.deepEqual(
        r.bodyDelta.toArray(),
        name === "twolf" ? [0, 0, 1] : [0, 0, 0],
      );
    });
