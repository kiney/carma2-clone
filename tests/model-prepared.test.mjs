import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { parseDat } from "../src/formats.ts";
import {
  prepareNativeCarVertexOrder,
  prepareNativeModelVertexOrder,
} from "../src/car-smoke.ts";

function face(indices, material = 0, smoothing = 1) {
  return { indices, material, smoothing, flags: 0 };
}
function duplicated(overrides = {}) {
  return {
    name: "independent-fixture",
    flags: 0,
    positions: Float32Array.from([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]),
    uvs: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    faces: [face([0, 1, 2]), face([3, 4, 5])],
    materials: [],
    ...overrides,
  };
}
function preparedPoints(model, order) {
  return order.sourceVertexIndices.map((source) =>
    Array.from(model.positions.subarray(3 * source, 3 * source + 3)),
  );
}

test("generic WELD coalesces equivalent source IDs but DONT_WELD and car loading retain them", () => {
  const model = duplicated();
  const welded = prepareNativeModelVertexOrder(model);
  assert.equal(welded.welding, "weld");
  assert.equal(welded.corners.length, 3);
  assert.deepEqual(preparedPoints(model, welded), [
    [0, 0, 0],
    [0, 1, 0],
    [1, 0, 0],
  ]);
  assert.deepEqual(welded.groups, [
    { start: 0, count: 3, materialIndices: [0] },
  ]);
  const retained = prepareNativeModelVertexOrder({ ...model, flags: 1 });
  assert.equal(retained.welding, "dont-weld");
  assert.deepEqual(retained.sourceVertexIndices, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(
    prepareNativeCarVertexOrder(model).sourceVertexIndices,
    retained.sourceVertexIndices,
  );
});

test("generic WELD sorts XYZ before UV and preserves mapping seams", () => {
  const model = duplicated();
  model.uvs[6] = 0.5;
  const result = prepareNativeModelVertexOrder(model);
  assert.equal(result.corners.length, 4);
  assert.deepEqual(preparedPoints(model, result), [
    [0, 0, 0],
    [0, 0, 0],
    [0, 1, 0],
    [1, 0, 0],
  ]);
  assert.deepEqual(result.sourceVertexIndices.slice(0, 2), [0, 3]);
  const reordered = duplicated({
    positions: Float32Array.from([2, 0, 0, 0, 1, 0, 1, 0, 0]),
    uvs: new Float32Array(6),
    faces: [face([0, 1, 2])],
  });
  assert.deepEqual(
    prepareNativeModelVertexOrder(reordered).sourceVertexIndices,
    [1, 2, 0],
  );
  assert.deepEqual(
    prepareNativeModelVertexOrder({ ...reordered, flags: 1 })
      .sourceVertexIndices,
    [0, 1, 2],
  );
});

test("equivalent XYZ and UV still split for unequal unnormalized smoothing sums", () => {
  const model = duplicated({
    faces: [
      face([0, 1, 2], 0, 1),
      face([3, 4, 5], 0, 1),
      face([0, 1, 2], 0, 2),
    ],
  });
  const result = prepareNativeModelVertexOrder(model);
  assert.equal(result.corners.length, 6);
  assert.deepEqual(preparedPoints(model, result), [
    [0, 0, 0],
    [0, 0, 0],
    [0, 1, 0],
    [0, 1, 0],
    [1, 0, 0],
    [1, 0, 0],
  ]);
  assert.deepEqual(
    result.corners.map(
      (corner) => model.faces[Math.floor(corner / 3)].smoothing,
    ),
    [2, 1, 2, 1, 2, 1],
  );
});

test("zero-area face contributes native positive-Z fallback, while opposite normals may cancel", () => {
  const collinear = duplicated({
    positions: Float32Array.from([
      0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]),
    faces: [face([0, 1, 2], 0, 1), face([3, 4, 5], 0, 2)],
  });
  // Nonoverlapping smoothing masks each retain just their own face normal.
  // Degenerate face normal +Z equals the regular face's +Z, merging origin/X1.
  assert.equal(prepareNativeModelVertexOrder(collinear).corners.length, 4);
  const opposite = duplicated({
    faces: [face([0, 1, 2]), face([3, 5, 4])],
  });
  assert.equal(prepareNativeModelVertexOrder(opposite).corners.length, 3);
});

test("material groups remain one contiguous allocation with honest pointer authority", () => {
  const model = duplicated({
    faces: [face([0, 1, 2], 9), face([3, 4, 5], 3), face([0, 1, 2], 0)],
  });
  const approximate = prepareNativeModelVertexOrder(model);
  assert.equal(approximate.materialOrder, "native-null-first");
  assert.equal(
    approximate.remainingMaterialOrder,
    "browser-positive-material-approximation",
  );
  assert.deepEqual(approximate.groups, [
    { start: 0, count: 3, materialIndices: [0] },
    { start: 3, count: 3, materialIndices: [9] },
    { start: 6, count: 3, materialIndices: [3] },
  ]);
  const exact = prepareNativeModelVertexOrder(model, {
    materialPointers: new Map([
      [9, 0x2000],
      [3, 0x1000],
    ]),
  });
  assert.equal(exact.materialOrder, "native-pointers");
  assert.deepEqual(
    exact.groups.map((group) => group.materialIndices),
    [[0], [3], [9]],
  );
  assert.equal(exact.firstGroupCount, 3);
  assert.equal(exact.corners.length, 9);
  assert.ok(
    exact.corners[exact.firstGroupCount] !== undefined,
    "native inclusive first-group endpoint can read next contiguous group",
  );
  const aliased = prepareNativeModelVertexOrder(model, {
    materialPointers: new Map([
      [9, 0x1000],
      [3, 0x1000],
    ]),
  });
  assert.deepEqual(aliased.groups, [
    { start: 0, count: 3, materialIndices: [0] },
    { start: 3, count: 3, materialIndices: [9, 3] },
  ]);
  assert.equal(aliased.corners.length, 6);
});

test("crease filtering is selected by model flag and requires its actual cosine", () => {
  // Two equal-origin corners: one +Z normal, one +Y normal; material/UV match.
  const model = duplicated({
    positions: Float32Array.from([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1,
    ]),
  });
  const smooth = prepareNativeModelVertexOrder(model);
  assert.equal(smooth.corners.length, 4);
  assert.deepEqual(
    prepareNativeModelVertexOrder(model, { creaseCos: 0.5 }).corners,
    smooth.corners,
  );
  assert.throws(
    () => prepareNativeModelVertexOrder({ ...model, flags: 0x100 }),
    /crease cosine provider/,
  );
  const creased = prepareNativeModelVertexOrder(
    { ...model, flags: 0x100 },
    { creaseCos: 0 },
  );
  assert.equal(
    creased.corners.length,
    6,
    "dot0 equals threshold and strict test excludes the other face",
  );
  assert.equal(
    prepareNativeModelVertexOrder(
      { ...model, flags: 0x100 },
      { creaseCos: -0.01 },
    ).corners.length,
    4,
  );
});

test("generic preparation rejects incomplete UV/flags/face/pointer providers", () => {
  assert.throws(
    () =>
      prepareNativeModelVertexOrder({
        ...duplicated(),
        uvs: new Float32Array(2),
      }),
    /UV count/,
  );
  const invalidUv = duplicated();
  invalidUv.uvs[0] = NaN;
  assert.throws(() => prepareNativeModelVertexOrder(invalidUv), /source UV/);
  assert.throws(
    () => prepareNativeModelVertexOrder({ ...duplicated(), flags: -1 }),
    /flags/,
  );
  assert.throws(
    () =>
      prepareNativeModelVertexOrder({
        ...duplicated(),
        positions: new Float32Array(0x10000 * 3),
        uvs: new Float32Array(0x10000 * 2),
      }),
    /16-bit/,
  );
  assert.throws(
    () =>
      prepareNativeModelVertexOrder(duplicated({ faces: [face([0, 1, 6])] })),
    /source face/,
  );
  assert.throws(
    () =>
      prepareNativeModelVertexOrder(
        duplicated({ faces: [face([0, 1, 2], 1)] }),
        { materialPointers: new Map() },
      ),
    /material pointer/,
  );
});

test("original Stock and Advanced gun50/53 weld, gun51/52/pump retain source IDs", async (t) => {
  const root = new URL("../carma2_orig", import.meta.url).pathname;
  try {
    await access(`${root}/data.twt`);
  } catch (error) {
    if (error.code === "ENOENT") return t.skip("Original installation absent");
    throw error;
  }
  const assets = await createAssetStore(root);
  const cases = [
    ["Carrier1", "&50gun01_DEBRIS1.dat", 0, 62, undefined],
    ["Carrier1", "&51gun01_DEBRIS2.dat", 21, 24, undefined],
    ["Carrier1", "&52TGUN_DEBRIS1.dat", 21, 61, undefined],
    ["Carrier1", "&53TGUN_DEBRIS2.dat", 0, 76, 3],
    ["newcity1", "&petpump.dat", 21, 40, 8],
  ];
  for (const directory of ["data", "adv_data"]) {
    for (const [race, basename, flags, total, nullFirstCount] of cases) {
      const wanted = `${directory}/races/${race}/${basename}`.toLowerCase();
      const entry = assets.manifest.find(
        (candidate) => candidate.path.toLowerCase() === wanted,
      );
      assert.ok(entry, wanted);
      const models = parseDat(await assets.read(entry.path));
      assert.equal(models.length, 1);
      const model = models[0];
      assert.equal(model.flags, flags);
      const prepared = prepareNativeModelVertexOrder(model);
      assert.equal(prepared.welding, (flags & 1) !== 0 ? "dont-weld" : "weld");
      assert.equal(prepared.corners.length, total);
      assert.equal(
        prepared.groups.reduce((count, group) => count + group.count, 0),
        total,
      );
      prepared.corners.forEach((corner, i) => {
        const source = model.faces[Math.floor(corner / 3)].indices[corner % 3];
        assert.equal(prepared.sourceVertexIndices[i], source);
      });
      if (nullFirstCount !== undefined) {
        assert.equal(prepared.materialOrder, "native-null-first");
        assert.equal(prepared.firstGroupCount, nullFirstCount);
        assert.ok(
          prepared.corners
            .slice(0, nullFirstCount)
            .every(
              (corner) => model.faces[Math.floor(corner / 3)].material === 0,
            ),
        );
      } else {
        assert.equal(prepared.materialOrder, "browser-first-approximation");
        assert.equal(
          prepared.remainingMaterialOrder,
          "browser-positive-material-approximation",
        );
      }
      if ((flags & 1) !== 0)
        assert.deepEqual(
          prepared.corners,
          prepareNativeCarVertexOrder(model).corners,
        );
    }
  }
});
