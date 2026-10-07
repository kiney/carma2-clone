import assert from "node:assert/strict";
import test from "node:test";
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
