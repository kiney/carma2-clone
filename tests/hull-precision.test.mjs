import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { buildHull } from "../src/physics/geometry.ts";

// Independently authored box with redundant points along its boundary edges.
// The source-ordered builder's undefined second-plane incidence needs the
// existing exact-collinear repair; these are redistributable synthetic points.
const coordinates = [
  [2, -1, -4],
  [2, -1, -1],
  [2, 3, -1],
  [2, 3, 1],
  [2, -1, 1],
  [2, -1, 4],
  [2, 3, 4],
  [2, 3, -4],
  [-2, -1, 1],
  [-2, -1, 4],
  [-2, 3, 4],
  [-2, 3, 1],
  [-2, 3, -1],
  [-2, 3, -4],
  [-2, -1, -4],
  [-2, -1, -1],
];
const featureData = (hull) => ({
  vertexOrder: hull.vertexOrder,
  edges: hull.edges,
  faces: hull.faces.map((face) => ({
    normal: face.normal.toArray(),
    constant: face.constant,
    indices: face.indices,
  })),
});

test("collinear retry uses native stored coordinates for bit-identical Float32 inputs", () => {
  const original = coordinates.map((p) => new Vector3(...p));
  const expected = buildHull(original);
  assert.equal(expected.faces.length, 6);
  assert.equal(expected.edges.length, 12);
  for (const sign of [-1, 1]) {
    const points = coordinates.map(
      (p, i) =>
        new Vector3(
          ...p.map(
            (value, axis) => value + sign * ((i + 1) * (axis + 1)) ** 2 * 1e-12,
          ),
        ),
    );
    const snapshot = points.map((p) => p.toArray());
    assert.notDeepEqual(snapshot, coordinates);
    assert.deepEqual(
      snapshot.map((p) => p.map(Math.fround)),
      coordinates,
      "primary native builder sees exactly the original Float32 point set",
    );
    const actual = buildHull(points);
    assert.deepEqual(
      featureData(actual),
      featureData(expected),
      "equivalent native input retains ordered features and stored planes",
    );
    assert.deepEqual(
      points.map((p) => p.toArray()),
      snapshot,
      "caller coordinates remain immutable",
    );
    assert.deepEqual(
      actual.vertices.map((p) => p.toArray()),
      snapshot,
      "authored storage retains raw doubles and its original indices",
    );
    for (const face of actual.faces)
      for (const point of points)
        assert.ok(
          face.normal.dot(point) - face.constant <= 9.999999974752427e-7,
          "all authored points still pass the original containing-halfspace tolerance",
        );
  }
});

test("stored-coordinate retry does not accept a collapsed or non-finite shape", () => {
  const flat = coordinates.map(
    ([x, , z], i) => new Vector3(x, 1 + i * 1e-12, z),
  );
  assert.ok(flat.every((p) => Math.fround(p.y) === 1));
  assert.throws(() => buildHull(flat), /Degenerate collision hull/);
  const invalid = coordinates.map((p) => new Vector3(...p));
  invalid[0].x = NaN;
  assert.throws(() => buildHull(invalid), /Invalid collision hull vertices/);
});
