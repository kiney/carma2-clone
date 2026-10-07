import assert from "node:assert/strict";
import test from "node:test";
import { access } from "node:fs/promises";
import { Mesh, DoubleSide, FrontSide } from "three";
import { Assets } from "../src/content.ts";
import { createAssetStore } from "../server/assets.mjs";
import {
  createModelGeometry,
  updateModelNormals,
} from "../src/render-geometry.ts";

const model = (faces) => ({
  name: "synthetic",
  flags: 0,
  positions: new Float32Array([
    0,
    0,
    0, // shared origin
    1,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    1,
    0,
    1,
    1,
  ]),
  uvs: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1, 0.5, 1]),
  faces,
  materials: ["mat0", "mat1"],
});
const face = (indices, smoothing, material = 0) => ({
  indices,
  smoothing,
  flags: 0,
  material,
});
const xyz = (geometry, index) =>
  geometry.getAttribute("normal").array.slice(index * 3, index * 3 + 3);

test("model geometry preserves authored vertices and groups faces by material", () => {
  const source = model([face([0, 1, 2], 1, 1), face([0, 3, 1], 3, 0)]);
  const geometry = createModelGeometry(source);
  assert.deepEqual(
    Array.from(geometry.userData.sourceVertexIndices),
    [0, 1, 2, 0, 3, 1],
  );
  assert.deepEqual(
    Array.from(geometry.userData.sourcePositions),
    Array.from(source.positions),
  );
  assert.deepEqual(geometry.userData.sourceFaces, source.faces);
  assert.deepEqual(geometry.groups, [
    { start: 0, count: 3, materialIndex: 0 },
    { start: 3, count: 3, materialIndex: 1 },
  ]);
  assert.deepEqual(Array.from(geometry.index.array), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(xyz(geometry, 0), xyz(geometry, 3));
  assert.ok(Math.abs(xyz(geometry, 0)[1] - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(xyz(geometry, 0)[2] - Math.SQRT1_2) < 1e-6);
});

test("nonintersecting smoothing masks keep a shared authored corner hard", () => {
  const geometry = createModelGeometry(
    model([
      face([0, 1, 2], 1), // +Z
      face([0, 3, 1], 4), // +Y
    ]),
  );
  assert.deepEqual(Array.from(xyz(geometry, 0)), [0, 0, 1]);
  assert.deepEqual(Array.from(xyz(geometry, 3)), [0, 1, 0]);
});

test("matching XYZ vertices smooth across authored UV seams", () => {
  const seam = model([
    face([0, 1, 2], 1), // +Z
    face([3, 5, 4], 1), // +Y, separate authored vertices at the same XYZ
  ]);
  seam.positions = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
  ]);
  seam.uvs = new Float32Array([0, 0, 1, 0, 0, 1, 0.5, 0.5, 0.5, 0, 1, 1]);
  const geometry = createModelGeometry(seam);
  assert.notEqual(
    geometry.userData.sourceVertexIndices[0],
    geometry.userData.sourceVertexIndices[3],
  );
  assert.deepEqual(xyz(geometry, 0), xyz(geometry, 3));
  assert.ok(Math.abs(xyz(geometry, 0)[1] - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(xyz(geometry, 0)[2] - Math.SQRT1_2) < 1e-6);
});

test("zero smoothing masks use the original all-smooth default and update from live positions", () => {
  const geometry = createModelGeometry(
    model([face([0, 1, 2], 0), face([0, 3, 1], 2)]),
  );
  assert.ok(Math.abs(xyz(geometry, 0)[1] - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(xyz(geometry, 0)[2] - Math.SQRT1_2) < 1e-6);

  const position = geometry.getAttribute("position");
  // Move the second face out of plane; its new face normal is included on refresh.
  position.setXYZ(4, 0, 1, 2);
  position.needsUpdate = true;
  updateModelNormals(geometry);
  assert.notDeepEqual(Array.from(xyz(geometry, 0)), [
    0,
    Math.SQRT1_2,
    Math.SQRT1_2,
  ]);
});

test("scene materials render both always-visible and two-sided faces without culling", async () => {
  const u32 = (value) => {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(value);
    return b;
  };
  const chunk = (tag, payload = Buffer.alloc(0)) =>
    Buffer.concat([u32(tag), u32(payload.length), payload]);
  const header = (type) => chunk(0x12, Buffer.concat([u32(type), u32(2)]));
  const material = (name, flags) => {
    const data = Buffer.alloc(65);
    data.fill(255, 0, 4);
    data.writeUInt32BE(flags, 20);
    data.writeFloatBE(1, 24);
    data.writeFloatBE(1, 36);
    return Buffer.concat([
      chunk(0x3c, Buffer.concat([data, Buffer.from(name + "\0")])),
      chunk(0),
    ]);
  };
  const files = new Map([
    [
      "scene/scene.mat",
      Buffer.concat([
        header(5),
        material("one-sided", 1),
        material("always-visible", 0x801),
        material("two-sided", 0x1001),
      ]),
    ],
    [
      "scene/scene.act",
      Buffer.concat([header(1), chunk(0x23, Buffer.from([0, 4, 0])), chunk(0)]),
    ],
  ]);
  const assets = new Assets();
  assets.manifest = [...files.keys()].map((path) => ({
    path,
    size: files.get(path).length,
  }));
  assets.lookup = new Map([...files.keys()].map((path) => [path, path]));
  assets.bytes = async (path) => files.get(path);
  const scene = await assets.scene("scene", "scene");
  assert.equal(scene.materials.get("one-sided").side, FrontSide);
  assert.equal(scene.materials.get("always-visible").side, DoubleSide);
  assert.equal(scene.materials.get("two-sided").side, DoubleSide);
});

test("read-only original scenes preserve black tyres and windows, plus authored cutouts", async (t) => {
  try {
    await access("carma2_orig");
  } catch {
    t.skip("local original assets are absent");
    return;
  }
  const store = await createAssetStore();
  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map(({ path }) => [path.toLowerCase(), path]),
  );
  assets.bytes = async (path) => store.read(path);
  await assets.common(() => {});
  const car = await assets.scene("data/CARS/EAGLE3", "EAGLE3");
  const city = await assets.scene("data/RACES/newcity1", "newcity1");
  const blackPixels = (material) => {
    const data = material.map.image.data;
    let black = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] || data[i + 1] || data[i + 2]) continue;
      black++;
      assert.equal(
        data[i + 3],
        255,
        `${material.name}: black pixel ${i / 4} stays opaque`,
      );
    }
    return black;
  };
  const tyre = car.materials.get("ewheel6");
  assert.ok(blackPixels(tyre) > 600);
  let wheels = 0;
  car.group.traverse((object) => {
    if (!(object instanceof Mesh) || !/^[RF][RL]WHEEL\.DAT$/i.test(object.name))
      return;
    wheels++;
    assert.equal(
      object.material[0],
      tyre,
      `${object.name}: inherited tyre material`,
    );
  });
  assert.equal(wheels, 4);
  assert.ok(blackPixels(city.materials.get("block5w2")) > 0);
  assert.ok(blackPixels(city.materials.get("tower3w")) > 0);
  const fence = city.materials.get("fencing").map.image.data;
  assert.ok(
    fence.some((value, i) => i % 4 === 3 && value === 0),
    "RGBA fence cutouts stay transparent",
  );
  assert.equal(car.stats.missingTextures, 0);
  assert.equal(city.stats.missingTextures, 0);
});
