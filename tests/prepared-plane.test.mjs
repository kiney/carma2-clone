import test from "node:test";
import assert from "node:assert/strict";
import { createAssetStore } from "../server/assets.mjs";
import { parseDat } from "../src/formats.ts";
import { prepareNativeModelFacePlane as plane } from "../src/physics/prepared-plane.ts";

test("original preparation preserves positive unit axes but clamps exact negative unit axes", () => {
  assert.deepEqual(plane([0, 0, 4], [1, 0, 4], [0, 1, 4]), {
    normal: [0, 0, 1],
    d: 4,
    degenerate: false,
  });
  assert.deepEqual(plane([0, 0, 4], [0, 1, 4], [1, 0, 4]), {
    normal: [0, 0, -0.9999998807907104],
    d: -4,
    degenerate: false,
  });
  assert.equal(
    plane([2, 0, 0], [2, 0, 1], [2, 1, 0]).normal[0],
    -0.9999998807907104,
  );
  assert.equal(
    plane([0, 3, 0], [1, 3, 0], [0, 3, 1]).normal[1],
    -0.9999998807907104,
  );
});

test("installed small oblique fixture captures asymmetric live and Float32 spills", () => {
  assert.deepEqual(
    plane(
      [0.0003851529909297824, 0.0004207677557133138, 0.0001636810484342277],
      [0.0008291573030874133, -0.00030017728568054736, 0.0008208203944377601],
      [0.0008770236745476723, -0.00043065438512712717, 0.0003816337266471237],
    ),
    {
      normal: [0.8703434467315674, 0.4898318946361542, -0.050665583461523056],
      d: 0.0005330278654582798,
      degenerate: false,
    },
  );
});

test("installed large translated fixture retains pre-store normalized components for D", () => {
  const a = [-3043788.25, 2104355.25, -4452375.5];
  const result = plane(
    a,
    [3897839, -8499167, -6038866],
    [-3454944.25, 7492415, -9705758],
  );
  assert.deepEqual(result, {
    normal: [0.7910124063491821, 0.45697611570358276, 0.40678271651268005],
    d: -3257183.75,
    degenerate: false,
  });
  const normal = result.normal;
  assert.notEqual(
    Math.fround(normal[2] * a[2] + normal[1] * a[1] + normal[0] * a[0]),
    result.d,
  );
});

test("zero-area source fallback is +Z at vertex0, including nonzero D", () => {
  assert.deepEqual(plane([2, 3, 4], [2, 3, 4], [2, 3, 4]), {
    normal: [0, 0, 1],
    d: 4,
    degenerate: true,
  });
  assert.deepEqual(plane([1, 2, 3], [2, 4, 6], [3, 6, 9]), {
    normal: [0, 0, 1],
    d: 3,
    degenerate: true,
  });
});

test("original Float32 inputs are immutable and invalid source vertices are explicit errors", () => {
  const a = Object.freeze([0, 0, 1 + 2 ** -25]);
  assert.equal(plane(a, [1, 0, 1], [0, 1, 1]).d, 1);
  assert.equal(a[2], 1 + 2 ** -25);
  for (const value of [NaN, Infinity, Number.MAX_VALUE])
    assert.throws(
      () => plane([value, 0, 0], [1, 0, 0], [0, 1, 0]),
      /finite Float32/,
    );
  assert.throws(() => plane([0, 0], [1, 0, 0], [0, 1, 0]), /finite Float32/);
});

test("original Stock and Advanced car and track indexed vertices supply finite prepared planes", async (t) => {
  let store;
  try {
    store = await createAssetStore(process.env.CARMA2_ROOT || "carma2_orig");
  } catch (error) {
    if (/ENOENT|Original installation/.test(String(error))) {
      t.skip("Original installation unavailable");
      return;
    }
    throw error;
  }
  for (const root of ["data", "adv_data"]) {
    let checked = 0;
    for (const path of [
      "CARS/EAGLE3/Eagle3.dat",
      "RACES/newcity1/newcity1.dat",
    ]) {
      const bytes = await store.read(`${root}/${path}`);
      assert.ok(bytes, `Original ${root}/${path} exists`);
      for (const model of parseDat(bytes))
        for (
          let i = 0;
          i < model.faces.length;
          i += Math.max(1, Math.floor(model.faces.length / 8))
        ) {
          const vertices = model.faces[i].indices.map((index) =>
            Array.from(model.positions.subarray(index * 3, index * 3 + 3)),
          );
          const result = plane(...vertices);
          assert.ok([...result.normal, result.d].every(Number.isFinite));
          assert.ok(
            result.normal.every(
              (component) => component <= 1 && component > -1,
            ),
          );
          checked++;
        }
    }
    assert.ok(checked > 1000);
  }
});
