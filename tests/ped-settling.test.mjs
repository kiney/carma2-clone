import test from "node:test";
import assert from "node:assert/strict";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import {
  parsePedForm,
  parsePedRemap,
  parsePedPersonalitySimpleBody,
} from "../src/ped-form.ts";
import { settleNativePedBody } from "../src/physics/ped-settling.ts";

const f = Math.fround;
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const base = {
  worldVector: [0, 0, 2],
  firstWorldFaceNormal: [0, 1, 0],
  actorMatrix: identity,
  mass: 2,
  inertia: [2.6, 2, 1],
  bounds: { min: [0, 0, 0], max: [2, 4, 6] },
  localOmega: [0, 0, 0],
  collisionFlag: true,
  doNothing: false,
};
function near(actual, expected, tolerance = 1e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((n, i) =>
    assert.ok(
      Math.abs(n - expected[i]) <= tolerance,
      `${i}: ${n} != ${expected[i]}`,
    ),
  );
}

test("417fd0 numerical increment uses moments, mass and half extents without dt", () => {
  const result = settleNativePedBody(base);
  assert.equal(result.gate, "applied");
  assert.deepEqual(result.worldAxis, [1, 0, 0]);
  // Ix/(dx/2) * gain*.1 * M*(2-.1), with source Float32 fields/spills.
  assert.deepEqual(result.localOmega, [1.3733199834823608, 0, 0]);
  assert.deepEqual(base.localOmega, [0, 0, 0]);
  assert.deepEqual(base.worldVector, [0, 0, 2]);
});
test("collision or ec gates, speed threshold equality and absent face diagnostic", () => {
  assert.equal(
    settleNativePedBody({ ...base, collisionFlag: false }).gate,
    "no-collision-or-sleep",
  );
  assert.equal(
    settleNativePedBody({ ...base, collisionFlag: false, doNothing: true })
      .applied,
    true,
  );
  assert.equal(
    settleNativePedBody({ ...base, worldVector: [0, 0, 0.09] }).gate,
    "below-minimum-speed",
  );
  const equality = settleNativePedBody({
    ...base,
    worldVector: [0, 0, f(0.1)],
  });
  assert.equal(equality.applied, true);
  // Squared-speed Float32 spill creates a small positive native increment.
  assert.deepEqual(equality.localOmega, [1.4809518056324578e-9, 0, 0]);
  assert.equal(
    settleNativePedBody({ ...base, firstWorldFaceNormal: null }).gate,
    "face-unavailable",
  );
});
test("signed angular projection gate is strict, not a total-omega limit", () => {
  assert.equal(
    settleNativePedBody({ ...base, localOmega: [f(1.5001), 0, 0] }).gate,
    "angular-projection",
  );
  assert.equal(
    settleNativePedBody({ ...base, localOmega: [1.5, 0, 0] }).applied,
    true,
  );
  assert.equal(
    settleNativePedBody({ ...base, localOmega: [-10, 0, 0] }).applied,
    true,
  );
  assert.equal(
    settleNativePedBody({ ...base, localOmega: [0, 10, 0] }).applied,
    true,
  );
});
test("actor transpose maps the world rolling axis into native body coordinates", () => {
  const result = settleNativePedBody({
    ...base,
    actorMatrix: [0, 1, 0, -1, 0, 0, 0, 0, 1, 999, 888, 777],
  });
  assert.deepEqual(result.localAxis, [0, -1, 0]);
  near(result.localOmega, [0, -0.5282, 0]);
});
test("safe cross preserves min-component fallback, ties and zero-vector X fallback", () => {
  const parallel = settleNativePedBody({ ...base, worldVector: [0, 2, 0] });
  assert.deepEqual(parallel.worldAxis, [0, 0, -1]);
  const zero = settleNativePedBody({
    ...base,
    worldVector: [0, 0, 0],
    firstWorldFaceNormal: [0, 0, 0],
    minimumSpeed: 0,
  });
  assert.deepEqual(zero.worldAxis, [1, 0, 0]);
  assert.deepEqual(zero.localOmega, [0, 0, 0]);
  const xParallel = settleNativePedBody({
    ...base,
    worldVector: [2, 0, 0],
    firstWorldFaceNormal: [1, 0, 0],
  });
  assert.deepEqual(xParallel.worldAxis, [0, 0, 1]);
});
test("native cap applies after increment and caps magnitude to 20", () => {
  const result = settleNativePedBody({ ...base, worldVector: [0, 0, 2000] });
  assert.equal(result.capped, true);
  near(result.localOmega, [20, 0, 0]);
  // Negative projection does not bypass the final cap.
  const backwards = settleNativePedBody({ ...base, localOmega: [-100, 8, 6] });
  assert.equal(backwards.capped, true);
  assert.ok(Math.abs(Math.hypot(...backwards.localOmega) - 20) < 2e-6);
});
test("malformed bodies and non-finite arithmetic fail before returning invalid omega", () => {
  for (const patch of [
    { mass: 0 },
    { inertia: [0, 1, 1] },
    { worldVector: [Infinity, 0, 0] },
    { actorMatrix: identity.slice(0, 9) },
    { minimumSpeed: -1 },
    { bounds: { min: [0, 0, 0], max: [0, 1, 1] } },
    { gain: NaN },
    { worldVector: [3e38, 3e38, 3e38] },
  ])
    assert.throws(() => settleNativePedBody({ ...base, ...patch }));
});
test("four original simple forms preserve kg scaling and source .025 moments", async (t) => {
  let store;
  try {
    store = await createAssetStore(
      new URL("../carma2_orig/", import.meta.url).pathname,
    );
  } catch (e) {
    if (e.code === "ENOENT") {
      t.skip("Original installation unavailable");
      return;
    }
    throw e;
  }
  const text = async (path) => {
    const bytes = await store.read(path);
    assert.ok(bytes, path);
    return decodeText(bytes);
  };
  for (const [name, mass, I, omegaX] of [
    [
      "blokebl",
      0.06800000369548798,
      [0.00003484999979264103, 0.00014420253864955157, 0.00016681253327988088],
      0.000004392029040900525,
    ],
    [
      "twolf",
      0.04699999839067459,
      [
        0.00008285629883175716, 0.000037642301322193816,
        0.000052583600336220115,
      ],
      0.000036731082218466327,
    ],
    [
      "cow",
      0.12300000339746475,
      [0.0007501431973651052, 0.0006099447491578758, 0.00022295287635643035],
      0.00042013582424260676,
    ],
    [
      "elephant",
      4.409999370574951,
      [0.1509200930595398, 0.11052262783050537, 0.0735924169421196],
      0.9060502052307129,
    ],
  ]) {
    const personality = await text(`data/PEDS/PEEPS/${name}/${name}.TXT`),
      lines = personality
        .split(/\r?\n/)
        .map((l) => l.split("//")[0].trim())
        .filter(Boolean),
      form = parsePedForm(await text(`data/PEDS/FORMS/${lines[0]}.TXT`)),
      remap = form.remapFilename
        ? parsePedRemap(await text(`data/PEDS/REMAPS/${form.remapFilename}`))
        : new Map(),
      profile = parsePedPersonalitySimpleBody(personality, form, remap);
    assert.equal(profile.mass, mass, name);
    assert.deepEqual(profile.inertia, I, name);
    const result = settleNativePedBody({
      ...base,
      mass: profile.mass,
      inertia: profile.inertia,
      bounds: profile.bounds,
    });
    assert.deepEqual(result.localOmega, [omegaX, 0, 0], name);
  }
});
