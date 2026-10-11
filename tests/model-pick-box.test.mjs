import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  nativeModelPickFaceInBox,
  clipNativeModelPickFaceToBox,
} from "../src/physics/model-pick-box.ts";

const v = (x, y, z) => ({ x, y, z });
const lo = v(-1, -1, -1),
  hi = v(1, 1, 1);
const tuples = (polygon) => polygon.map(({ x, y, z }) => [x, y, z]);

test("source strict crossings reject minimum-plane tangency but retain maximum-plane duplicates", () => {
  for (const axis of ["x", "y", "z"]) {
    const other = axis === "x" ? "y" : "x";
    const a = v(0, 0, 0),
      b = v(0, 0, 0),
      c = v(0, 0, 0);
    a[axis] = -1;
    c[other] = 1;
    const min = v(-2, -2, -2),
      max = v(2, 2, 2);
    min[axis] = 0;
    assert.equal(nativeModelPickFaceInBox([a, b, c], min, max), false);
    assert.equal(clipNativeModelPickFaceToBox([a, b, c], min, max).length, 2);
    a[axis] = 1;
    min[axis] = -2;
    max[axis] = 0;
    assert.equal(nativeModelPickFaceInBox([a, b, c], min, max), true);
    assert.equal(clipNativeModelPickFaceToBox([a, b, c], min, max).length, 4);
  }
});

test("installed oblique fixture preserves six-plane order and exact Float32 intersection stores", () => {
  const vertices = [
    v(1.4943612813949585, 0.6496477127075195, 1.2258671522140503),
    v(-2.5407824516296387, 2.030992031097412, 0.37347838282585144),
    v(1.2090297937393188, -0.6261162161827087, 0.2422012984752655),
  ];
  assert.deepEqual(tuples(clipNativeModelPickFaceToBox(vertices, lo, hi)), [
    [1, 0.638256847858429, 1],
    [0.44900384545326233, 1, 1],
    [-1, 1, 0.36041611433029175],
    [-1, 0.9391971826553345, 0.3195371627807617],
    [1, -0.47799819707870483, 0.2495192140340805],
  ]);
  assert.equal(nativeModelPickFaceInBox(vertices, lo, hi), true);
});

test("finite clipping rejects a triangle whose AABB overlaps the query", () => {
  const vertices = [v(2, 0, 0), v(0, 2, 0), v(2, 2, 0)];
  assert.equal(
    nativeModelPickFaceInBox(vertices, v(0, 0, -1), v(0.5, 0.5, 1)),
    false,
  );
});

test("source predicate retains three degenerate vertices without area or epsilon tests", () => {
  assert.equal(
    nativeModelPickFaceInBox([v(0, 0, 0), v(0, 0, 0), v(0, 0, 0)], lo, hi),
    true,
  );
  assert.equal(
    nativeModelPickFaceInBox([v(-1, 0, 0), v(0, 0, 0), v(1, 0, 0)], lo, hi),
    true,
  );
  assert.equal(
    nativeModelPickFaceInBox([v(2, 0, 0), v(2, 0, 0), v(2, 0, 0)], lo, hi),
    false,
  );
});

test("Float32 boundary equality applies before clipping and signed zero is retained", () => {
  const polygon = clipNativeModelPickFaceToBox(
    [v(-0, 0, 0), v(-0, 1, 0), v(-0, 0, 1)],
    v(-0, -1, -1),
    hi,
  );
  assert.equal(polygon.length, 3);
  assert.ok(polygon.every((p) => Object.is(p.x, -0)));
  const near = [v(1 + 2 ** -25, 0, 0), v(1, 1, 0), v(1, 0, 1)];
  assert.equal(nativeModelPickFaceInBox(near, lo, hi), true);
  assert.deepEqual(tuples(clipNativeModelPickFaceToBox(near, lo, hi)), [
    [1, 0, 0],
    [1, 1, 0],
    [1, 0, 1],
  ]);
});

test("query inputs and source triangles are not mutated, including Three vectors", () => {
  const vertices = [
    new Vector3(-2, 0, 0),
    new Vector3(2, 0, 0),
    new Vector3(0, 2, 0),
  ];
  const before = vertices.map((p) => p.toArray());
  assert.equal(
    nativeModelPickFaceInBox(
      vertices,
      new Vector3(-1, -1, -1),
      new Vector3(1, 1, 1),
    ),
    true,
  );
  assert.deepEqual(
    vertices.map((p) => p.toArray()),
    before,
  );
});

test("invalid triangle arity, nonfinite Float32 inputs and reversed bounds are explicit errors", () => {
  assert.throws(() => nativeModelPickFaceInBox([], lo, hi), /three/);
  for (const value of [NaN, Infinity, -Infinity, Number.MAX_VALUE])
    assert.throws(
      () =>
        nativeModelPickFaceInBox(
          [v(value, 0, 0), v(0, 1, 0), v(0, 0, 1)],
          lo,
          hi,
        ),
      /finite Float32/,
    );
  assert.throws(
    () =>
      nativeModelPickFaceInBox([v(0, 0, 0), v(0, 1, 0), v(0, 0, 1)], hi, lo),
    /ordered/,
  );
});
