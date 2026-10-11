import test from "node:test";
import assert from "node:assert/strict";
import { Assets } from "../src/content.ts";
import { SkidMaterialLibrary } from "../src/skid-materials.ts";
import { createAssetStore } from "../server/assets.mjs";

test("original skid materials preserve distinct fractional PIX alpha and borrow cache textures", async (t) => {
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
  const assets = new Assets();
  assets.manifest = store.manifest;
  for (const entry of store.manifest)
    assets.lookup.set(entry.path.toLowerCase(), entry.path);
  assets.bytes = async (path) => {
    const bytes = await store.read(path);
    assert.ok(bytes, path);
    return new Uint8Array(bytes);
  };
  const library = new SkidMaterialLibrary();
  await library.load(assets, [
    "SKIDMARK.MAT",
    "DESKID.MAT",
    "SNOWSKID.MAT",
    "OILSMEAR.MAT",
    "NONE",
    "0",
    "1",
  ]);
  assert.deepEqual(library.diagnostics, []);
  const expectedAlpha = new Map([
    ["SKIDMARK", 238],
    ["DESKID", 119],
    ["SNOWSKID", 51],
  ]);
  const maps = new Set();
  let texturesDisposed = 0;
  let materialsDisposed = 0;
  for (const name of [...expectedAlpha.keys(), "OILSMEAR"]) {
    const material = library.resolve(`${name}.MAT`);
    assert.ok(material, name);
    assert.equal(material, library.resolve(name.toLowerCase()));
    assert.equal(material.transparent, true);
    assert.equal(material.depthWrite, false);
    assert.equal(material.alphaTest, 0);
    assert.equal(material.map.userData.c2PixelmapType, 18);
    assert.ok([...assets.textures.values()].includes(material.map));
    const data = material.map.image.data;
    const alpha = [];
    for (let at = 3; at < data.length; at += 4) alpha.push(data[at]);
    assert.equal(Math.min(...alpha), 0, name);
    if (expectedAlpha.has(name))
      assert.equal(Math.max(...alpha), expectedAlpha.get(name), name);
    maps.add(material.map);
    material.addEventListener("dispose", () => materialsDisposed++);
  }
  assert.equal(maps.size, 4);
  for (const texture of maps)
    texture.addEventListener("dispose", () => texturesDisposed++);
  const before = library.resolve("skidmark");
  await library.load(assets, ["SKIDMARK.MAT"]);
  assert.equal(library.resolve("skidmark"), before);
  library.dispose();
  assert.equal(library.materials.size, 0);
  assert.equal(materialsDisposed, 4);
  assert.equal(texturesDisposed, 0);
});
