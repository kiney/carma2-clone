import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  nativeSphereSphereSweep,
  nativeSpherePointSweep,
  nativeSphereEdgeSweep,
  nativeLineSphereCollide,
  nativeSphereBoxFaceSweep,
  nativeSpherePolyFaceSweep,
  nativeSphereWorldFaceSweep,
  nativeSphereSphereContact,
  nativeSphereWorldContacts,
  nativeSphereTargetContacts,
  selectNativeSpherePairContacts,
} from "../src/physics/sphere-contact.ts";
import {
  reduceWorldContacts,
  finalizeWorldContacts,
} from "../src/physics/geometry.ts";
import { nativePedBoneShape } from "../src/physics/ped-bone-body.ts";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";
const f = Math.fround;
const sphere = { radius: 0.5, center: [0, 0, 0], radiusSquared: 0.25 };
const box = { min: [-1, -1, -1], max: [1, 1, 1] };
const face = {
  a: [-5, 0, -5],
  b: [5, 0, -5],
  c: [0, 0, 5],
  normal: [0, 1, 0],
  constant: 0,
  materialFlags: 0x1000,
  faceFlags: 7,
};
const planes = [
  { normal: [1, 0, 0], offset: 1 },
  { normal: [-1, 0, 0], offset: 1 },
  { normal: [0, 1, 0], offset: 1 },
  { normal: [0, -1, 0], offset: 1 },
  { normal: [0, 0, 1], offset: 1 },
  { normal: [0, 0, -1], offset: 1 },
];
function near(actual, expected, tolerance = 2e-7) {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) =>
    assert.ok(
      Math.abs(v - expected[i]) <= tolerance,
      `${i}: ${v} != ${expected[i]}`,
    ),
  );
}
function captureHit(hit, expected, tolerance = 2e-7) {
  if (expected[0] === 100) {
    assert.equal(hit, null);
    return;
  }
  assert.ok(hit);
  near(
    [hit.fraction, ...hit.normal, ...(expected.length === 7 ? hit.point : [])],
    expected,
    tolerance,
  );
}
// Numeric constants below were emitted by actual installed math routines with
// these invented Float32 inputs. No original binary bytes or model fixtures.
test("45dae0 sphere sweep captures crossing, tangency and finite-motion rejection", () => {
  for (const [args, expected] of [
    [
      [-2, 0, 0, 2, 0, 0],
      [0.25, 1, 0, 0],
    ],
    [
      [-2, 1, 0, 2, 1, 0],
      [0.5, 0, -1, 0],
    ],
    [[-2, 1.001, 0, 2, 1.001, 0], [100]],
    [[-2, 1.003, 0, 2, 1.003, 0], [100]],
    [[-1.001, 0, 0, -2, 0, 0], [100]],
  ])
    captureHit(
      nativeSphereSphereSweep(sphere, sphere, args.slice(0, 3), args.slice(3)),
      expected,
    );
});
test("45dd60 strict END shell rejects exact touch, overlap and shell boundary", () => {
  captureHit(
    nativeSphereSphereSweep(sphere, sphere, [-1.001, 0, 0], [-1.001, 0, 0]),
    [1, 1, 0, 0],
  );
  for (const x of [0, 0.999, 1, 1.002, 1.003])
    assert.equal(
      nativeSphereSphereSweep(sphere, sphere, [x, 0, 0], [x, 0, 0]),
      null,
    );
  assert.ok(
    nativeSphereSphereSweep(sphere, sphere, [-2, 0, 0], [-1.001, 0, 0]),
  );
});
test("45de20 edge and 45e520 endpoint captures preserve signed feature normal", () => {
  for (const [args, expected, flags] of [
    [
      [0, 2, 0, 0, -2, 0],
      [0.375, 0, -1, 0, 0, 0, 0],
    ],
    [[2, 2, 0, 2, -2, 0], [100]],
    [
      [1.3, 2, 0, 1.3, -2, 0],
      [f(0.4), -0.5999999642372131, -0.800000011920929, 0, 1, 0, 0],
    ],
    [[1.3, 2, 0, 1.3, -2, 0], [100], 128],
  ])
    captureHit(
      nativeSphereEdgeSweep(
        [-1, 0, 0],
        [1, 0, 0],
        sphere,
        args.slice(0, 3),
        args.slice(3),
        flags ?? 0,
        flags ?? 0,
      ),
      expected,
    );
  captureHit(
    nativeSpherePointSweep([1, 0, 0], sphere, [1.3, 2, 0], [1.3, -2, 0]),
    [f(0.4), -0.5999999642372131, -0.800000011920929, 0, 1, 0, 0],
  );
});
test("45e3a0 resting edge shell has radius*.004, not expanded-radius squared", () => {
  for (const [y, expected] of [
    [0.501, [1, 0, -1, 0, 0, 0, 0]],
    [0.499, [100]],
    [0.5, [100]],
    [0.503, [100]],
  ])
    captureHit(
      nativeSphereEdgeSweep(
        [-1, 0, 0],
        [1, 0, 0],
        sphere,
        [0, y, 0],
        [0, y, 0],
      ),
      expected,
    );
  const stationary = nativeSphereEdgeSweep(
    [-1, 0, 0],
    [1, 0, 0],
    sphere,
    [1.501, 0, 0],
    [1.501, 0, 0],
    128,
    128,
  );
  captureHit(stationary, [1, -1, 0, 0, 1, 0, 0]);
  assert.equal(
    nativeSphereEdgeSweep([-1, 0, 0], [1, 0, 0], sphere, [2, 0, 0], [-2, 0, 0]),
    null,
  );
});
test("4616b0 vertex pass distinguishes start inside, sweep and squared-radius END shell", () => {
  assert.equal(nativeLineSphereCollide([0, 0, 0], [2, 0, 0], sphere).code, -1);
  const sweep = nativeLineSphereCollide([-2, 0, 0], [2, 0, 0], sphere);
  assert.equal(sweep.code, 1);
  captureHit(sweep.hit, [0.375, 1, 0, 0, -0.5, 0, 0]);
  const resting = nativeLineSphereCollide(
    [-0.5005, 0, 0],
    [-0.5005, 0, 0],
    sphere,
  );
  assert.equal(resting.code, 2);
  captureHit(resting.hit, [1, 1, 0, 0, 0.5, 0, 0]);
  assert.equal(
    nativeLineSphereCollide([-0.5015, 0, 0], [-0.5015, 0, 0], sphere).code,
    0,
  );
  assert.equal(
    nativeLineSphereCollide([-0.5, 0, 0], [-0.5, 0, 0], sphere).code,
    0,
  );
});
test("45e9e0 BOX finite face captures use min/max order and inclusive other-axis bounds", () => {
  for (const [args, expected] of [
    [
      [-2, 0, 0, 2, 0, 0],
      [0.125, 1, 0, 0, -1, 0, 0],
    ],
    [[-2, 1.2, 0, 2, 1.2, 0], [100]],
    [
      [-2, 1, 0, 2, 1, 0],
      [0.125, 1, 0, 0, -1, 1, 0],
    ],
    [
      [-1.501, 0, 0, -1.501, 0, 0],
      [1, 1, 0, 0, f(-1.501), 0, 0],
    ],
    [[-1.5, 0, 0, -1.5, 0, 0], [100]],
    [[0, 0, 0, -2, 0, 0], [100]],
    [
      [0, 2, 0, 0, 0.502, 0],
      [0.33377835154533386, 0, -1, 0, 0, 1, 0],
    ],
    [
      [0, 2, 0, 0, 0.499, 0],
      [0.3331112563610077, 0, -1, 0, 0, 1, 0],
    ],
  ])
    captureHit(
      nativeSphereBoxFaceSweep(sphere, box, args.slice(0, 3), args.slice(3)),
      expected,
    );
});
test("45e700 POLY finite face differs at boundary and resting surface point", () => {
  for (const [args, expected] of [
    [
      [-2, 0, 0, 2, 0, 0],
      [0.125, 1, 0, 0, -1, 0, 0],
    ],
    [[-2, 1.2, 0, 2, 1.2, 0], [100]],
    [[-2, 1, 0, 2, 1, 0], [100]],
    [
      [-1.501, 0, 0, -1.501, 0, 0],
      [1, 1, 0, 0, -1.0010000467300415, 0, 0],
    ],
    [[-1.5, 0, 0, -1.5, 0, 0], [100]],
    [[0, 0, 0, -2, 0, 0], [100]],
    [
      [0, 2, 0, 0, 0.502, 0],
      [0.33377835154533386, 0, -1, 0, 0, 1, 0],
    ],
    [
      [0, 2, 0, 0, 0.499, 0],
      [0.3331112861633301, 0, -1, 0, 0, 1, 0],
    ],
  ])
    captureHit(
      nativeSpherePolyFaceSweep(
        sphere,
        planes,
        args.slice(0, 3),
        args.slice(3),
      ),
      expected,
    );
});
test("45ed50 world finite face captures preserve front and back fraction behavior", () => {
  for (const [args, expected] of [
    [
      [0, 2, 0, 0, -2, 0],
      [0.375, 0, 1, 0],
    ],
    [
      [0, -2, 0, 0, 2, 0],
      [1, 0, -1, 0],
    ],
    [
      [0, 0.501, 0, 0, 0.501, 0],
      [0, 0, 1, 0],
    ],
    [[0, 0.499, 0, 0, -2, 0], [100]],
    [
      [0, 0.5, 0, 0, 0.5, 0],
      [0, 0, 1, 0],
    ],
    [
      [0, 2, 0, 0, 0.502, 0],
      [1, 0, 1, 0],
    ],
    [[0, 2, 0, 0, 0.503, 0], [100]],
  ])
    captureHit(
      nativeSphereWorldFaceSweep(sphere, face, args.slice(0, 3), args.slice(3)),
      expected,
    );
});
test("world face material gates and projection work on each normal axis", () => {
  for (const materialIdentifier of ["!ignore", ">ignore", "?ignore"])
    assert.equal(
      nativeSphereWorldFaceSweep(
        sphere,
        { ...face, materialIdentifier },
        [0, 2, 0],
        [0, -2, 0],
      ),
      null,
    );
  for (const materialFlags of [undefined, 0, 0x800])
    assert.equal(
      nativeSphereWorldFaceSweep(
        sphere,
        { ...face, materialFlags },
        [0, -2, 0],
        [0, 2, 0],
      ),
      null,
    );
  assert.equal(
    nativeSphereWorldFaceSweep(sphere, face, [20, 2, 0], [20, -2, 0]),
    null,
  );
  for (const order of [
    [0, 1, 2],
    [1, 0, 2],
    [0, 2, 1],
  ]) {
    const remap = (v) => order.map((i) => v[i]);
    const remapped = {
      ...face,
      a: remap(face.a),
      b: remap(face.b),
      c: remap(face.c),
      normal: remap(face.normal),
    };
    captureHit(
      nativeSphereWorldFaceSweep(
        sphere,
        remapped,
        remap([0, 2, 0]),
        remap([0, -2, 0]),
      ),
      [0.375, ...remap([0, 1, 0])],
    );
  }
});
const identity = (x = 0, y = 0, z = 0) => [1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z];
test("sphere-pair old surface points remain separate under translated candidate matrices", () => {
  const a = { sphere, oldPose: identity(), predictedPose: identity() },
    b = { sphere, oldPose: identity(-2), predictedPose: identity(2) },
    hit = nativeSphereSphereContact(a, b);
  assert.ok(hit);
  assert.equal(hit.fraction, 0.25);
  near(hit.normal.toArray(), [1, 0, 0]);
  near(hit.points[0].toArray(), [-0.5, 0, 0]);
  near(hit.pointsB[0].toArray(), [-1.5, 0, 0]);
  assert.deepEqual(hit.contactTypes, [7]);
  // Applying candidate translation to either torque point would spuriously alter momentum.
  assert.notDeepEqual(hit.points[0].toArray(), hit.pointsB[0].toArray());
});
test("rotation moves an offset authored sphere center while radius and COM-independent contact survive", () => {
  const offset = { ...sphere, center: [0.25, 0, 0] },
    rotated = [0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 2, 0],
    end = [...rotated];
  end[10] = -2;
  const contacts = nativeSphereWorldContacts(
    { sphere: offset, oldPose: rotated, predictedPose: end },
    [face],
  );
  assert.equal(contacts.length, 1);
  near(contacts[0].points[0].toArray(), [0, 1.75, 0]);
  near(contacts[0].normal.toArray(), [0, 1, 0]);
  assert.equal(contacts[0].fraction, f(1.75 / 4));
  assert.deepEqual(contacts[0].contactTypes, [3]);
});
test("world source order picks earliest face and retains first exact tie metadata", () => {
  const lower = { ...face, faceFriction: 0.1 },
    higher = {
      ...face,
      constant: 0.25,
      a: [-5, 0.25, -5],
      b: [5, 0.25, -5],
      c: [0, 0.25, 5],
      faceFriction: 0.7,
    };
  const body = {
    sphere,
    oldPose: identity(0, 2),
    predictedPose: identity(0, -2),
  };
  const candidates = nativeSphereWorldContacts(body, [
    lower,
    higher,
    { ...higher, faceFriction: 0.9 },
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].faceFriction, 0.7);
  assert.equal(candidates[0].fraction, 0.3125);
  const retained = finalizeWorldContacts(reduceWorldContacts(candidates));
  assert.equal(retained.length, 1);
  assert.equal(retained[0].fraction, candidates[0].fraction);
  assert.equal(retained[0].faceFriction, 0.7);
  near(retained[0].points[0].toArray(), candidates[0].points[0].toArray());
});
test("world flags80 and1/2/4 suppress edge visits independently of finite face pass", () => {
  const small = {
      ...face,
      a: [-1, 0, 0],
      b: [1, 0, 0],
      c: [0, 0, 2],
      faceFlags: 0,
    },
    body = {
      sphere,
      oldPose: identity(0, 2, -0.3),
      predictedPose: identity(0, -2, -0.3),
    };
  const edges = nativeSphereWorldContacts(body, [small]);
  assert.ok(edges.some((h) => h.contactTypes[0] === 4));
  assert.equal(
    nativeSphereWorldContacts(body, [{ ...small, faceFlags: 1 }]).length,
    0,
  );
  assert.equal(
    nativeSphereWorldContacts(body, [{ ...small, faceFlags: 128 }]).length,
    0,
  );
  const centered = {
    ...body,
    oldPose: identity(0, 2, 0.5),
    predictedPose: identity(0, -2, 0.5),
  };
  assert.ok(
    nativeSphereWorldContacts(centered, [{ ...small, faceFlags: 128 }]).some(
      (h) => h.contactTypes[0] === 3,
    ),
  );
});
test("placement uses explicit world COM star start without moving actual old torque point", () => {
  const body = {
    sphere,
    oldPose: identity(0, -2),
    predictedPose: identity(0, -2),
  };
  assert.equal(
    nativeSphereWorldContacts(body, [{ ...face, materialFlags: 0 }]).length,
    0,
  );
  const h = nativeSphereWorldContacts(body, [{ ...face, materialFlags: 0 }], {
    placementStart: [0, 2, 0],
  });
  assert.equal(h.length, 1);
  near(h[0].points[0].toArray(), [0, -2.5, 0]);
  assert.equal(h[0].fraction, 0.375);
});
test("native analytic sphere inputs reject non-finite/singular data and scaled poses explicitly", () => {
  assert.throws(
    () =>
      nativeSphereSphereSweep(
        { ...sphere, radiusSquared: 1 },
        sphere,
        [0, 0, 0],
        [1, 0, 0],
      ),
    /radius/,
  );
  assert.throws(
    () =>
      nativeSphereEdgeSweep([0, 0, 0], [0, 0, 0], sphere, [0, 1, 0], [0, 0, 0]),
    /degenerate/,
  );
  assert.throws(
    () =>
      nativeSphereWorldFaceSweep(
        sphere,
        { ...face, normal: [0, 2, 0] },
        [0, 1, 0],
        [0, 0, 0],
      ),
    /unit normal/,
  );
  assert.throws(
    () =>
      nativeSpherePolyFaceSweep(
        sphere,
        Array(125).fill(planes[0]),
        [0, 1, 0],
        [0, 0, 0],
      ),
    /plane count/,
  );
  const bad = identity();
  bad[0] = 2;
  assert.throws(
    () =>
      nativeSphereWorldContacts(
        { sphere, oldPose: bad, predictedPose: identity() },
        [face],
      ),
    /unit normal|scaled/,
  );
  assert.throws(
    () => nativeSpherePointSweep([NaN, 0, 0], sphere, [0, 1, 0], [0, 0, 0]),
    /non-finite/,
  );
});
for (const dataRoot of ["data", "adv_data"])
  test(`original ${dataRoot} BIPED1 and DOG1 authored head radii drive plane and sphere contacts`, async (t) => {
    let store;
    try {
      store = await createAssetStore(
        new URL("../carma2_orig/", import.meta.url).pathname,
      );
    } catch (e) {
      if (e?.code === "ENOENT" || /Original installation/.test(String(e))) {
        t.skip("Original installation unavailable");
        return;
      }
      throw e;
    }
    const assets = new Assets();
    assets.manifest = store.manifest;
    assets.lookup = new Map(
      store.manifest.map((x) => [x.path.toLowerCase(), x.path]),
    );
    assets.bytes = async (p) => new Uint8Array(await store.read(p));
    const radii = [];
    for (const name of ["Blokebl", "Bandsman", "twolf"]) {
      const live = await loadNativePedAssets(
          assets,
          `PEDS/PEEPS/${name}`,
          name,
          dataRoot,
        ),
        head = live.bones[live.form.headBone],
        variant = head.variants[0],
        authored = variant.modelBounds.get(variant.sourceModels[0]);
      const shape = nativePedBoneShape(head.collisionType, {
        min: authored.min.toArray(),
        max: authored.max.toArray(),
      });
      assert.equal(shape.type, "SPHERE");
      assert.ok(head.massKg === (name === "twolf" ? 2 : 4));
      radii.push(shape.radius);
      const r = shape.radius,
        hit = nativeSphereWorldFaceSweep(
          shape,
          face,
          [0, f(r * 3), 0],
          [0, f(-r * 3), 0],
        );
      assert.ok(hit);
      assert.ok(Math.abs(hit.fraction - 1 / 3) < 1e-6);
      const staticSphere = { ...shape, center: [0, 0, 0] },
        paired = nativeSphereSphereSweep(
          staticSphere,
          staticSphere,
          [f(-4 * r), 0, 0],
          [f(4 * r), 0, 0],
        );
      assert.ok(paired);
      assert.ok(Math.abs(paired.fraction - 0.25) < 1e-6);
    }
    assert.ok(new Set(radii).size > 1);
  });

test("426920 installed BOX wrapper captures preserve finite face, two edges and resting levers", () => {
  const fixture = (args) =>
    selectNativeSpherePairContacts(
      nativeSphereTargetContacts(
        {
          sphere,
          oldPose: identity(...args.slice(0, 3)),
          predictedPose: identity(...args.slice(3)),
        },
        {
          shape: { type: "BOX", bounds: box },
          oldPose: identity(),
          predictedPose: identity(),
        },
      ),
    );
  const first = fixture([-2, 0, 0, 2, 0, 0]);
  assert.equal(first.length, 1);
  assert.equal(first[0].fraction, 0.125);
  near(first[0].points[0].toArray(), [-1.5, 0, 0]);
  near(first[0].pointsB[0].toArray(), [-1, 0, 0]);
  near(first[0].normal.toArray(), [-1, 0, 0]);
  assert.equal(first[0].sourceProjectedDrift, 4);
  assert.equal(first[0].sourceObjectOrder, "target-sphere");
  const edges = fixture([0, 2, -1.3, 0, -2, -1.3]);
  assert.equal(edges.length, 2);
  near(
    edges.map((h) => h.fraction),
    [0.14999999105930328, 0.6499999761581421],
  );
  near(edges[0].normal.toArray(), [0, 0.8000000715255737, -0.5999999046325684]);
  near(edges[0].pointsB[0].toArray(), [0, 1, -1]);
  near(edges[1].pointsB[0].toArray(), [0, -1, -1]);
  assert.equal(edges[0].sourceProjectedDrift, 3.200000286102295);
  const resting = fixture([-1.501, 0, 0, -1.501, 0, 0]);
  assert.equal(resting.length, 1);
  assert.equal(resting[0].fraction, 1);
  assert.equal(resting[0].sourceProjectedDrift, 0);
  near(resting[0].pointsB[0].toArray(), [f(-1.501), 0, 0]);
  near(resting[0].points[0].toArray(), [-1.0010000467300415, 0, 0]);
});
test("426800 stable corner capture retains duplicate rows and source vertex-first order", () => {
  const rows = selectNativeSpherePairContacts(
    nativeSphereTargetContacts(
      { sphere, oldPose: identity(-2, 1, 1), predictedPose: identity(2, 1, 1) },
      {
        shape: { type: "BOX", bounds: box },
        oldPose: identity(),
        predictedPose: identity(),
      },
    ),
  );
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((r) => r.contactTypes[0]),
    [5, 8, 8, 8],
  );
  assert.deepEqual(
    rows.map((r) => r.fraction),
    [0.125, 0.125, 0.125, 0.125],
  );
  assert.deepEqual(
    rows.map((r) => r.sourceProjectedDrift),
    [0, 4, 4, 4],
  );
  for (const r of rows) {
    near(r.points[0].toArray(), [-1.5, 1, 1]);
    near(r.pointsB[0].toArray(), [-1, 1, 1]);
    near(r.normal.toArray(), [-1, 0, 0]);
  }
});
test("pair final prefix uses native .707 boundary and does not omit a mismatched row then resume", () => {
  const row = (fraction, normal, label) => ({
    fraction,
    normal: new Vector3(...normal),
    points: [new Vector3()],
    penetration: 0,
    label,
  });
  const a = row(0.2, [1, 0, 0], "first"),
    b = row(0.2, [0.707, Math.sqrt(1 - 0.707 ** 2), 0], "equal"),
    c = row(0.3, [0.7069, Math.sqrt(1 - 0.7069 ** 2), 0], "stop"),
    d = row(0.4, [1, 0, 0], "later");
  assert.deepEqual(
    selectNativeSpherePairContacts([a, b, c, d]).map((r) => r.label),
    ["first", "equal"],
  );
});

test("explicit POLY and WIRE target providers use ordered authored features without a BOX fallback", () => {
  const vertices = Array.from({ length: 8 }, (_, i) => [
      i & 2 ? -1 : 1,
      i & 1 ? -1 : 1,
      i & 4 ? -1 : 1,
    ]),
    edges = [
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
      [0, 2],
      [1, 3],
      [4, 6],
      [5, 7],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ],
    body = { sphere, oldPose: identity(-2), predictedPose: identity(2) },
    target = (type) => ({
      shape: { type, bounds: box, vertices, edges, planes },
      oldPose: identity(),
      predictedPose: identity(),
    });
  const p = selectNativeSpherePairContacts(
    nativeSphereTargetContacts(body, target("POLY")),
  );
  assert.equal(p.length, 1);
  assert.equal(p[0].fraction, 0.125);
  assert.equal(nativeSphereTargetContacts(body, target("WIRE")).length, 0);
  assert.equal(nativeSphereTargetContacts(body, target("WIREPOLY")).length, 1);
  assert.throws(
    () =>
      nativeSphereTargetContacts(body, {
        ...target("POLY"),
        shape: { ...target("POLY").shape, edges: [[0, 99]] },
      }),
    /edge index/,
  );
  assert.throws(
    () =>
      nativeSphereTargetContacts(body, {
        ...target("POLY"),
        shape: {
          ...target("POLY").shape,
          vertices: Array(113).fill([0, 0, 0]),
        },
      }),
    /workspace/,
  );
});
