import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCarShrapnelMaterials,
  simpleMaterialColour,
  SimpleMaterialLibrary,
} from "../src/shrapnel-materials.ts";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";

test("native shrapnel RGB aliases and ordered repeated colours are retained", () => {
  assert.equal(simpleMaterialColour("M14.MAT"), 0x212121);
  assert.equal(simpleMaterialColour("M00.MAT"), 0x5d0303);
  assert.equal(simpleMaterialColour("32, 56, 80"), 0x203850);
  assert.deepEqual(
    parseCarShrapnelMaterials(
      "END OF MECHANICS STUFF\n4\nM00.MAT\n1,2,3\nM14.MAT\nM00.MAT\n// next block",
    ),
    ["M00.MAT", "1,2,3", "M14.MAT", "M00.MAT"],
  );
  assert.throws(() => simpleMaterialColour("M99.MAT"), /Obsolete/);
  assert.throws(() => simpleMaterialColour("256,0,0"), /Invalid/);
  assert.throws(
    () => parseCarShrapnelMaterials("END OF MECHANICS STUFF\n3\nM14.MAT"),
    /Truncated/,
  );
  assert.throws(
    () => parseCarShrapnelMaterials("END OF MECHANICS STUFF\n-1"),
    /count/,
  );
});
test("native simple-material cache keys RGB, preserves first shading and rejects slot33", () => {
  const library = new SimpleMaterialLibrary();
  const first = library.resolve("M14.MAT", 4);
  assert.equal(library.resolve("33,33,33", 2), first);
  assert.equal(first.userData.c2Shading, 4);
  assert.deepEqual(first.userData.c2Lighting, [1, 0, 0]);
  for (let i = 0; i < 31; i++) assert.ok(library.resolve(`${i},0,0`, 2));
  assert.equal(library.resolve("100,0,0", 2), undefined);
  assert.equal(library.diagnostics.length, 1);
  let disposed = 0;
  first.addEventListener("dispose", () => disposed++);
  library.dispose();
  assert.equal(disposed, 1);
});
test("all original Stock/Advanced car shrapnel lists parse, including native four-entry cars", async (t) => {
  let store;
  try {
    store = await createAssetStore();
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Original installation absent");
      return;
    }
    throw error;
  }
  const roots = new Set();
  const counts = new Set();
  const known = new Map();
  for (const entry of store.manifest.filter((e) =>
    /^(adv_)?data\/cars\/[^/]+\/[^/]+\.txt$/i.test(e.path),
  )) {
    const names = parseCarShrapnelMaterials(
      decodeText(await store.read(entry.path)),
    );
    if (!names.length) continue;
    roots.add(entry.path.split("/")[0]);
    counts.add(names.length);
    known.set(entry.path.toLowerCase(), names.map(simpleMaterialColour));
  }
  assert.equal(roots.size, 2);
  assert.ok(known.size > 50);
  assert.ok(counts.has(4));
  assert.deepEqual(known.get("data/cars/eagle3/eagle3.txt"), [0xfd0000]);
  assert.deepEqual(known.get("data/cars/buggy/buggy.txt"), [0xd60067]);
  assert.deepEqual(known.get("data/cars/copcar/copcar.txt"), [0x203850]);
});
