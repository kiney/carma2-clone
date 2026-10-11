import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  nativeFreeGravity40,
  applyNativeFreeDrag40,
  applyNativeFreeForces40,
} from "../src/physics/native-free-forces.ts";
import { nativePedBoneMassProperties } from "../src/physics/ped-bone-body.ts";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { loadNativePedAssets } from "../src/ped-native-assets.ts";

const f = Math.fround;
const bits = (value) => new Uint32Array(new Float32Array([value]).buffer)[0];
const dry = { volume: null, depth: 0 };
const water = { identity: {}, gravity: f(0.2), viscosity: 5 };
const airLike = { identity: {}, gravity: 1, viscosity: 1 };
function packet(extra = {}) {
  return {
    headerState: 2,
    doNothing: false,
    headerFlags: 12,
    gravity: 1,
    drag: 0,
    levelOut: 0,
    mass: f(0.004),
    inertia: new Vector3(f(0.0001), f(0.0002), f(0.0003)),
    worldVelocity: new Vector3(1, 2, 3),
    localOmega: new Vector3(4, 5, 6),
    gravityIncrement: new Vector3(0, f(-0.3), 0),
    ...extra,
  };
}
function options(extra = {}) {
  return {
    globalGravity: 1,
    volumeStep: { before: dry, after: dry },
    retainedJoint2: "absent",
    ...extra,
  };
}
function state(p) {
  return [
    p.worldVelocity.toArray(),
    p.localOmega.toArray(),
    p.gravityIncrement.toArray(),
  ];
}

test("dry detached40ms applies raw gravity once, with no generic air or angular damping", () => {
  const p = packet(),
    identities = [p.worldVelocity, p.localOmega, p.gravityIncrement],
    r = applyNativeFreeForces40(p, options());
  assert.equal(r.status, "complete");
  assert.equal(r.gravityApplied, true);
  assert.deepEqual(p.worldVelocity.toArray(), [
    1,
    f(2 - 0.05681159420289855),
    3,
  ]);
  assert.deepEqual(p.localOmega.toArray(), [4, 5, 6]);
  assert.deepEqual(p.gravityIncrement.toArray(), [
    0,
    f(-0.05681159420289855),
    0,
  ]);
  assert.deepEqual(r.dragPasses, []);
  assert.equal(p.worldVelocity, identities[0]);
  assert.equal(p.localOmega, identities[1]);
  assert.equal(p.gravityIncrement, identities[2]);
  // Native .04 * 9.8 / 6.9 is a world-velocity increment, not metric gravity.
  assert.ok(Math.abs(p.gravityIncrement.y - (-9.8 * 0.04) / 6.9) < 1e-8);
});

test("passive and do-nothing active headers skip forces without erasing the old gravity vector", () => {
  for (const extra of [
    { headerState: 1 },
    { headerState: 0 },
    { doNothing: true },
  ]) {
    const p = packet(extra),
      old = state(p),
      r = applyNativeFreeForces40(p, options({ volumeStep: "unknown" }));
    assert.equal(r.status, "skipped");
    assert.deepEqual(state(p), old);
    assert.equal(r.markPassivePhase, p.headerState === 1);
  }
});

test("header gravity0 dry preserves retained gravity, while global gravity0 writes an actual zero packet", () => {
  const noGravity = packet({ gravity: 0 });
  const r = applyNativeFreeForces40(noGravity, options());
  assert.equal(r.gravityApplied, false);
  assert.deepEqual(noGravity.worldVelocity.toArray(), [1, 2, 3]);
  assert.equal(noGravity.gravityIncrement.y, f(-0.3));
  const globalZero = packet();
  assert.equal(
    applyNativeFreeForces40(globalZero, options({ globalGravity: 0 }))
      .gravityApplied,
    true,
  );
  assert.equal(globalZero.worldVelocity.y, 2);
  assert.equal(globalZero.gravityIncrement.y, -0);
});

test("volume bit8 owns fallback gravity/drag; disabled bit ignores even unknown scene volume", () => {
  const wet = packet({ gravity: 0 }),
    after = { volume: airLike, depth: f(0.25) },
    r = applyNativeFreeForces40(
      wet,
      options({ volumeStep: { before: after, after } }),
    );
  assert.equal(r.gravityApplied, true);
  assert.equal(wet.gravityIncrement.y, f(-0.05681159420289855 * 0.25));
  assert.deepEqual(r.dragPasses, ["header"]);
  assert.ok(wet.worldVelocity.x < 1);
  const disabled = packet({ headerFlags: 4, gravity: 0 });
  assert.equal(
    applyNativeFreeForces40(disabled, options({ volumeStep: "unknown" }))
      .status,
    "complete",
  );
  assert.deepEqual(disabled.worldVelocity.toArray(), [1, 2, 3]);
});

test("gravity branch strict viscosity2 and nonzero levelOut preserve live source expression", () => {
  const partial = { volume: water, depth: f(0.25) };
  assert.equal(
    nativeFreeGravity40(1, 1, f(0.7), partial).y,
    f(((1 - f(0.2)) * f(0.25) * f(0.7) - 1.4202898550724639) * 0.04),
  );
  assert.equal(
    nativeFreeGravity40(1, 1, 0, partial).y,
    f(f(0.2) * f(0.25) * -0.05681159420289855),
  );
  assert.equal(
    nativeFreeGravity40(1, 1, f(0.7), {
      ...partial,
      volume: { ...water, viscosity: 2 },
    }).y,
    f(f(0.2) * f(0.25) * -0.05681159420289855),
  );
  assert.equal(
    nativeFreeGravity40(-2, f(0.5), 0, dry).y,
    f(0.05681159420289855),
  );
});

test("native drag uses6.9/M linear factor and float1/47.61 angular conversion, then clamps reversal", () => {
  const p = packet({
    worldVelocity: new Vector3(1, 0, 0),
    localOmega: new Vector3(1, 0, 0),
    mass: 1,
    inertia: new Vector3(1, 1, 1),
  });
  applyNativeFreeDrag40(p, 1, dry);
  assert.equal(p.worldVelocity.x, f(1 - f(f(0.00002) * 6.9)));
  assert.equal(p.localOmega.x, f(1 - f(0.00002) * f(1 / 47.61)));
  assert.equal(p.worldVelocity.y, 0);
  assert.equal(p.localOmega.z, 0);
  const reversing = packet({
    mass: f(1e-7),
    inertia: new Vector3(1e-9, 1e-9, 1e-9),
  });
  applyNativeFreeDrag40(reversing, 1, dry);
  assert.deepEqual(reversing.worldVelocity.toArray(), [0, 0, 0]);
  assert.deepEqual(reversing.localOmega.toArray(), [0, 0, 0]);
});

test("angular drag's Y scaled torque spill differs by one Float32 bit from uniform x87-live arithmetic", () => {
  const p = packet({
    localOmega: new Vector3(
      19.91543960571289,
      12.733281135559082,
      8.872591018676758,
    ),
    inertia: new Vector3(1, 0.0034018561709672213, 1),
  });
  applyNativeFreeDrag40(p, 1, dry);
  assert.equal(bits(p.localOmega.y), 1095440617);
  // Independent literal source packet: T_y=.006429911125451326, C=DWORD5898d0.
  const unspilled = f(
    12.733281135559082 -
      (0.006429911125451326 * f(1 / 47.61)) / 0.0034018561709672213,
  );
  assert.equal(bits(unspilled), 1095440616);
});

test("fully immersed entry adds a second drag in order; retained immersion has only the first", () => {
  const immersed = { volume: water, depth: 1 };
  const entry = packet({ gravity: 0 }),
    result = applyNativeFreeForces40(
      entry,
      options({ volumeStep: { before: dry, after: immersed } }),
    );
  assert.deepEqual(result.dragPasses, ["header", "volume-entry"]);
  const retained = packet({ gravity: 0 });
  const steady = applyNativeFreeForces40(
    retained,
    options({ volumeStep: { before: immersed, after: immersed } }),
  );
  assert.deepEqual(steady.dragPasses, ["header"]);
  assert.ok(entry.worldVelocity.x < retained.worldVelocity.x);
  assert.ok(entry.localOmega.y < retained.localOmega.y);
  for (const depth of [f(1 - 2 ** -24), 1, f(1 + 2 ** -23)]) {
    const p = packet(),
      after = { volume: water, depth };
    assert.deepEqual(
      applyNativeFreeForces40(
        p,
        options({ volumeStep: { before: dry, after } }),
      ).dragPasses,
      depth === 1 ? ["header", "volume-entry"] : ["header"],
    );
  }
});

test("leaving viscous volume adds literal drag1 using current volume, including a dry exit", () => {
  const previous = { volume: water, depth: 1 },
    p = packet({ gravity: 0 });
  const r = applyNativeFreeForces40(
    p,
    options({ volumeStep: { before: previous, after: dry } }),
  );
  assert.equal(r.gravityApplied, false);
  assert.deepEqual(r.dragPasses, ["volume-exit"]);
  assert.ok(p.worldVelocity.x < 1);
  const after = { volume: { ...airLike, viscosity: 2 }, depth: f(0.5) },
    replacement = packet();
  assert.deepEqual(
    applyNativeFreeForces40(
      replacement,
      options({ volumeStep: { before: previous, after } }),
    ).dragPasses,
    ["header", "volume-exit"],
  );
});

test("partial viscous levelOut requires actual plane/basis provider and executes after gravity and drag", () => {
  const after = { volume: water, depth: f(0.5) },
    p = packet({ levelOut: f(0.7) }),
    before = state(p),
    opts = options({ volumeStep: { before: after, after } });
  const missing = applyNativeFreeForces40(p, opts);
  assert.equal(missing.status, "provider-required");
  assert.deepEqual(missing.requiredProviders, ["native-water-plane-level-out"]);
  assert.deepEqual(state(p), before);
  const r = applyNativeFreeForces40(p, {
    ...opts,
    levelOut: ({ packet: w, volume, depth }) => {
      assert.equal(volume.identity, water.identity);
      assert.equal(depth, f(0.5));
      assert.notEqual(w.worldVelocity.y, 2);
      assert.ok(w.localOmega.x < 4);
      return new Vector3(1, -1, 2);
    },
  });
  assert.equal(r.status, "complete");
  assert.ok(p.localOmega.x > 4);
  assert.ok(p.localOmega.y < 5);
  assert.ok(p.localOmega.z > 6);
});

test("unknown volume blocks atomically; joint2 remains a separate later constraint requirement", () => {
  const p = packet(),
    old = state(p);
  const missing = applyNativeFreeForces40(
    p,
    options({ volumeStep: "unknown", retainedJoint2: "unknown" }),
  );
  assert.equal(missing.status, "provider-required");
  assert.deepEqual(missing.requiredProviders, ["native-special-volume-step"]);
  assert.equal(missing.jointConstraintProviderRequired, true);
  assert.deepEqual(state(p), old);
  const complete = applyNativeFreeForces40(
    p,
    options({ retainedJoint2: "present" }),
  );
  assert.equal(complete.status, "complete");
  assert.equal(complete.jointConstraintProviderRequired, true);
});

test("invalid force/volume/level-out providers fail without partial velocity mutation", () => {
  const p = packet(),
    old = state(p);
  assert.throws(
    () => applyNativeFreeForces40(p, options({ globalGravity: NaN })),
    /scalar/,
  );
  assert.throws(
    () => applyNativeFreeDrag40({ ...p, mass: 0 }, 1, dry),
    /positive mass/,
  );
  assert.throws(
    () =>
      applyNativeFreeForces40(
        p,
        options({
          volumeStep: {
            before: dry,
            after: { volume: { gravity: 1, viscosity: 2 }, depth: 1 },
          },
        }),
      ),
    /identity provider/,
  );
  const wet = packet({ levelOut: 1 }),
    wetOld = state(wet),
    after = { volume: water, depth: 0.5 };
  assert.throws(
    () =>
      applyNativeFreeForces40(
        wet,
        options({
          volumeStep: { before: after, after },
          levelOut: () => new Vector3(Infinity, 0, 0),
        }),
      ),
    /scalar/,
  );
  assert.deepEqual(state(p), old);
  assert.deepEqual(state(wet), wetOld);
});

for (const tree of ["data", "adv_data"])
  for (const name of ["Blokebl", "Bandsman", "twolf"])
    test(`original ${tree}/${name} detached head FORM mass/MODEL moments support exact dry forces`, async (t) => {
      let store;
      try {
        store = await createAssetStore(
          new URL("../carma2_orig/", import.meta.url).pathname,
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
        bounds = variant.modelBounds.get(variant.sourceModels[0]);
      assert.equal(bone.collisionType, "SPHERE");
      assert.equal(bone.massKg, name === "twolf" ? 2 : 4);
      const properties = nativePedBoneMassProperties(bone.mass, {
          min: bounds.min.toArray(),
          max: bounds.max.toArray(),
        }),
        p = packet({ mass: bone.mass, inertia: properties.inertia });
      applyNativeFreeForces40(p, options());
      assert.equal(p.worldVelocity.y, f(2 - 0.05681159420289855));
      assert.deepEqual(p.localOmega.toArray(), [4, 5, 6]);
    });
