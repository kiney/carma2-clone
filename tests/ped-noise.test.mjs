import test from "node:test";
import assert from "node:assert/strict";
import { createAssetStore } from "../server/assets.mjs";
import {
  NATIVE_PED_NOISE_GROUP_COUNT,
  nativePedNoiseDiagnostics,
  parseNativePedNoiseGroups,
  selectNativePedNoise,
} from "../src/ped-noise.ts";

const table = (groups = [[40, 41], [], [52], [], [], [], [], [], [], [], []]) =>
  groups.map((ids) => `${ids.length}\n${ids.join("\n")}`).join("\n");

test("parses eleven bounded authored groups and retains duplicate sound IDs", () => {
  const groups = parseNativePedNoiseGroups(
    `// Header\n${table([[4000, 4000, 4201], [], [4353], [], [], [], [], [], [], [], [65535]])}`,
  );
  assert.equal(groups.length, NATIVE_PED_NOISE_GROUP_COUNT);
  assert.deepEqual(groups[0], [4000, 4000, 4201]);
  assert.deepEqual(groups[1], []);
  assert.deepEqual(groups[10], [65535]);
  const oversized = parseNativePedNoiseGroups(
    table([[1, 2, 3, 4, 5, 6, 7], ...Array.from({ length: 10 }, () => [])]),
  );
  assert.deepEqual(oversized[0], [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(nativePedNoiseDiagnostics(oversized), [
    "Pedestrian sound group 0 has 7 IDs; native packed capacity is 5.",
  ]);
});

test("selector uses inclusive authored index exactly once and empty groups consume no RNG", () => {
  const groups = parseNativePedNoiseGroups(
    table([[4000, 4000, 4201], [], [4353], [], [], [], [], [], [], [], []]),
  );
  const calls = [];
  const next = (low, high) => {
    calls.push([low, high]);
    return high;
  };
  assert.equal(selectNativePedNoise(groups, 0, next), 4201);
  assert.deepEqual(calls, [[0, 2]]);
  assert.equal(selectNativePedNoise(groups, 1, next), undefined);
  assert.deepEqual(calls, [[0, 2]]);
  assert.equal(selectNativePedNoise(groups, 2, next), 4353);
  assert.deepEqual(calls, [
    [0, 2],
    [0, 0],
  ]);
});

test("rejects missing, excessive, malformed and trailing table data", () => {
  assert.throws(() => parseNativePedNoiseGroups(""), /count for group 0/);
  assert.throws(
    () =>
      parseNativePedNoiseGroups(
        table([Array(33).fill(1), ...Array.from({ length: 10 }, () => [])]),
      ),
    /out of range/,
  );
  assert.throws(
    () => parseNativePedNoiseGroups(table([[70000]])),
    /out of range/,
  );
  assert.throws(
    () => parseNativePedNoiseGroups(table([["bad"]])),
    /Invalid pedestrian sound ID/,
  );
  assert.throws(() => parseNativePedNoiseGroups(`${table()}\n99`), /trailing/);
  const groups = parseNativePedNoiseGroups(table());
  assert.throws(() => selectNativePedNoise(groups, 11, () => 0), /0\.\.10/);
  assert.throws(
    () => selectNativePedNoise(groups.slice(0, 10), 0, () => 0),
    /eleven groups/,
  );
});

test("Stock and Advanced authored pedestrian sound tables stay within native group bounds", async (t) => {
  let store;
  try {
    store = await createAssetStore(process.env.CARMA2_ROOT ?? "carma2_orig");
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
  for (const root of ["data", "adv_data"]) {
    const paths = store.manifest
      .filter((entry) =>
        new RegExp(`^${root}/peds/sound/[^/]+\\.txt$`, "i").test(entry.path),
      )
      .map((entry) => entry.path);
    assert.ok(paths.length > 0, `${root}: no pedestrian sound tables found`);
    for (const path of paths) {
      const text = new TextDecoder().decode(await store.read(path));
      const groups = parseNativePedNoiseGroups(text);
      assert.equal(groups.length, 11, path);
      assert.ok(
        groups.every((sounds) => sounds.length <= 32),
        path,
      );
      if (/\/SICKSOUNDS\.TXT$/i.test(path)) {
        assert.deepEqual(groups[3], [4140, 4141, 4801, 4802, 4803, 4804, 4805]);
        assert.equal(nativePedNoiseDiagnostics(groups).length, 1, path);
      } else assert.deepEqual(nativePedNoiseDiagnostics(groups), [], path);
    }
    const malePath = `${root}/PEDS/SOUND/MALESOUNDS.TXT`;
    const male = paths.find(
      (path) => path.toLowerCase() === malePath.toLowerCase(),
    );
    assert.ok(male);
    const maleGroups = parseNativePedNoiseGroups(
      new TextDecoder().decode(await store.read(male)),
    );
    assert.deepEqual(maleGroups[6], [4000, 4000, 4201]);
  }
});
