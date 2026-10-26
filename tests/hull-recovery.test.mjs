import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Quaternion, Vector3 } from "three";
import {
  buildHull,
  hullBounds,
  sweepHullTriangle,
  sweepHulls,
  transformHull,
} from "../src/physics/geometry.ts";
import { recoverHull } from "../src/physics/hull-recovery.ts";

// Independently authored six-point sloped hull that currently reaches the
// incremental builder's undefined second-plane horizon. These are safe,
// redistributable coordinates; no original collision points are used.
const coordinates = [
  [2, 3, -4],
  [-2, 3, 4],
  [-1.999999761581421, 3, 1],
  [-2, 3, -1],
  [-2.000000476837158, 3, -4],
  [-2, -1, -1],
];

const makePoints = (values = coordinates) =>
  values.map((point) => new Vector3(...point));

function hullSignature(hull) {
  return {
    vertexOrder: [...hull.vertexOrder],
    edges: hull.edges.map(([a, b]) => [a, b]),
    faces: hull.faces.map((face) => ({
      normal: face.normal.toArray(),
      constant: face.constant,
      indices: [...face.indices],
    })),
  };
}

function signedHullVolume(hull) {
  let volume = 0;
  for (const face of hull.faces)
    for (let i = 1; i < face.indices.length - 1; i++) {
      const a = hull.vertices[face.indices[0]];
      const b = hull.vertices[face.indices[i]];
      const c = hull.vertices[face.indices[i + 1]];
      volume += a.dot(b.clone().cross(c)) / 6;
    }
  return volume;
}

function assertClosedContainingHull(hull, points) {
  const activeVertices = new Set(hull.vertexOrder);
  assert.ok(activeVertices.size >= 4, "hull has at least four active vertices");
  assert.equal(activeVertices.size, hull.vertexOrder.length);
  assert.ok(hull.faces.length >= 4);
  assert.ok(hull.edges.length >= 6);
  assert.equal(
    activeVertices.size - hull.edges.length + hull.faces.length,
    2,
    "closed convex surface satisfies Euler's formula",
  );

  for (const index of hull.vertexOrder)
    assert.ok(Number.isInteger(index) && index >= 0 && index < points.length);

  const incidences = new Map();
  for (const face of hull.faces) {
    assert.ok(face.indices.length >= 3);
    assert.ok(face.normal.toArray().every(Number.isFinite));
    assert.ok(Number.isFinite(face.constant));
    for (const index of face.indices)
      assert.ok(activeVertices.has(index), "face references an active vertex");
    const first = points[face.indices[0]];
    const second = points[face.indices[1]];
    const third = points[face.indices[2]];
    assert.ok(
      second
        .clone()
        .sub(first)
        .cross(third.clone().sub(first))
        .dot(face.normal) > 0,
      "polygon winding agrees with its outward face normal",
    );
    for (let i = 0; i < face.indices.length; i++) {
      const a = face.indices[i];
      const b = face.indices[(i + 1) % face.indices.length];
      assert.notEqual(a, b, "face has no zero-length index edge");
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      incidences.set(key, (incidences.get(key) ?? 0) + 1);
    }
    for (const point of points)
      assert.ok(
        face.normal.dot(point) - face.constant <= 2e-6,
        "every authored point lies inside each outward face plane",
      );
  }

  assert.ok(
    [...incidences.values()].every((count) => count === 2),
    "every surface edge has exactly two incident faces",
  );
  const listedEdges = new Set(
    hull.edges.map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`)),
  );
  assert.deepEqual(
    listedEdges,
    new Set(incidences.keys()),
    "edge table matches the closed face boundary",
  );

  // Check a concrete support point outside the sloped hull; a replacement
  // axis-aligned box would incorrectly include it.
  const outside = new Vector3(2, -0.9, 4);
  const coordinateBounds = new Box3().setFromPoints(points);
  assert.ok(
    outside.x >= coordinateBounds.min.x &&
      outside.x <= coordinateBounds.max.x &&
      outside.y >= coordinateBounds.min.y &&
      outside.y <= coordinateBounds.max.y &&
      outside.z >= coordinateBounds.min.z &&
      outside.z <= coordinateBounds.max.z,
    "outside support point remains inside the axis-aligned bounds",
  );
  assert.ok(
    hull.faces.some((face) => face.normal.dot(outside) - face.constant > 1e-5),
    "recovered surface preserves the sloped support instead of boxing it",
  );

  const expectedBounds = new Box3().setFromPoints(points);
  const actualBounds = hullBounds(hull);
  assert.deepEqual(actualBounds.min.toArray(), expectedBounds.min.toArray());
  assert.deepEqual(actualBounds.max.toArray(), expectedBounds.max.toArray());
}

test("six-point horizon recovery is deterministic, closed and preserves authored IDs", () => {
  const points = makePoints();
  const original = points.map((point) => point.toArray());
  const hull = buildHull(points);
  const repeated = buildHull(makePoints());

  assert.equal(hull.recoveredFrom, "open-horizon");
  assertClosedContainingHull(hull, points);
  assert.deepEqual(hullSignature(hull), hullSignature(repeated));
  assert.ok(Math.abs(signedHullVolume(hull) - 128.00001525878906 / 6) < 1e-12);
  assert.deepEqual(
    points.map((point) => point.toArray()),
    original,
    "builder does not mutate caller coordinates",
  );
  assert.deepEqual(
    hull.vertices.map((point) => point.toArray()),
    original,
    "all raw authored points and their indices are retained",
  );
  for (const coordinate of [0, 1, 2]) {
    const min = Math.min(...coordinates.map((point) => point[coordinate]));
    const max = Math.max(...coordinates.map((point) => point[coordinate]));
    assert.equal(
      Math.min(
        ...hull.vertexOrder.map((index) =>
          hull.vertices[index].getComponent(coordinate),
        ),
      ),
      min,
    );
    assert.equal(
      Math.max(
        ...hull.vertexOrder.map((index) =>
          hull.vertices[index].getComponent(coordinate),
        ),
      ),
      max,
    );
  }
});

test("sub-Float32 raw jitter preserves the exact stored topology and strict stored-point containment", () => {
  const raw = coordinates.map(
    (point, index) =>
      new Vector3(
        ...point.map(
          (value, axis) => value + ((index + 1) * (axis + 1)) ** 2 * 1e-12,
        ),
      ),
  );
  const rawSnapshot = raw.map((point) => point.toArray());
  const storedCoordinates = rawSnapshot.map((point) => point.map(Math.fround));
  assert.deepEqual(storedCoordinates, coordinates);
  const stored = makePoints(storedCoordinates);
  const rawHull = buildHull(raw);
  const storedHull = buildHull(stored);

  assertClosedContainingHull(rawHull, raw);
  assertClosedContainingHull(storedHull, stored);
  assert.deepEqual(hullSignature(rawHull), hullSignature(storedHull));
  assert.deepEqual(
    raw.map((point) => point.toArray()),
    rawSnapshot,
  );
  assert.deepEqual(
    rawHull.vertices.map((point) => point.toArray()),
    rawSnapshot,
    "all perturbed authored coordinates remain in their original slots",
  );
  for (const face of rawHull.faces)
    for (const point of stored)
      assert.ok(
        face.normal.dot(point) - face.constant <= 1e-12,
        "stored Float32 points satisfy recovered planes near roundoff",
      );
});

test("duplicate stored Float32 points preserve every authored storage slot", () => {
  const points = makePoints();
  const duplicate = points[0].clone();
  const storedDuplicate = duplicate.toArray().map(Math.fround);
  points.push(duplicate);
  const hull = buildHull(points);

  assertClosedContainingHull(hull, points);
  assert.equal(hull.vertices.length, coordinates.length + 1);
  assert.deepEqual(
    hull.vertices.map((point) => point.toArray()),
    [...coordinates, storedDuplicate],
  );
  assert.ok(
    !hull.vertexOrder.includes(coordinates.length),
    "the duplicate stored coordinate does not replace the first authored ID",
  );
});

test("reordering the last two fixture points still recovers an open final horizon", () => {
  const reordered = [0, 1, 2, 3, 5, 4].map((index) => coordinates[index]);
  const points = makePoints(reordered);
  const hull = buildHull(points);

  assert.equal(hull.recoveredFrom, "open-horizon");
  assertClosedContainingHull(hull, points);
});

test("recovered hull remains usable by head-on and floor collision sweeps", () => {
  const hull = buildHull(makePoints());
  const identity = new Quaternion();
  const target = transformHull(hull, new Vector3(), identity);
  const headOn = sweepHulls(
    transformHull(hull, new Vector3(-8, 0, 0), identity),
    transformHull(hull, new Vector3(-3, 0, 0), identity),
    target,
    target,
  );
  assert.ok(headOn, "head-on feature sweep detects the recovered hull");
  assert.ok(Number.isFinite(headOn.fraction));

  const oldHull = transformHull(hull, new Vector3(0, 2, 0), identity);
  const nextHull = transformHull(hull, new Vector3(0, -2, 0), identity);
  const floorHit = sweepHullTriangle(
    oldHull,
    nextHull,
    new Vector3(-20, 0, -20),
    new Vector3(0, 0, 20),
    new Vector3(20, 0, -20),
    { materialFlags: 0 },
  );
  assert.ok(floorHit, "floor sweep detects the recovered hull");
  assert.ok(Number.isFinite(floorHit.fraction));
});

test("horizon recovery continues to reject flat and nonfinite point sets", () => {
  const flat = coordinates.map(([x, , z]) => new Vector3(x, 3, z));
  assert.throws(() => buildHull(flat), /Degenerate collision hull/);

  const nonfinite = makePoints();
  nonfinite[0].x = Number.NaN;
  assert.throws(() => buildHull(nonfinite), /Invalid collision hull vertices/);
});

test("direct recovery merges cube triangulation into source planes without diagonals", () => {
  const cube = [-1, 1].flatMap((x) =>
    [-1, 1].flatMap((y) => [-1, 1].map((z) => new Vector3(x, y, z))),
  );
  const hull = recoverHull(cube, 1e-6);

  assert.equal(hull.faces.length, 6);
  assert.equal(hull.edges.length, 12);
  assert.equal(
    hull.vertexOrder.length - hull.edges.length + hull.faces.length,
    2,
  );
  assert.ok(hull.faces.every((face) => face.indices.length === 4));
  for (const face of hull.faces)
    for (const point of cube)
      assert.ok(face.normal.dot(point) - face.constant <= 1e-12);

  const incidences = new Map();
  for (const face of hull.faces)
    for (let i = 0; i < face.indices.length; i++) {
      const a = face.indices[i];
      const b = face.indices[(i + 1) % face.indices.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      incidences.set(key, (incidences.get(key) ?? 0) + 1);
    }
  assert.ok([...incidences.values()].every((count) => count === 2));
  assert.deepEqual(
    new Set(incidences.keys()),
    new Set(hull.edges.map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`))),
  );
});

test("direct recovery preserves a one-Float32-ULP ridge on an otherwise flat cube face", () => {
  const cube = [-1, 1].flatMap((x) =>
    [-1, 1].flatMap((y) => [-1, 1].map((z) => new Vector3(x, y, z))),
  );
  const ridgeHeight = Math.fround(1.1920928955078125e-7);
  const points = [...cube, new Vector3(0, 1 + ridgeHeight, 0)];
  const hull = recoverHull(points, 1e-6);

  assert.equal(Math.fround(points.at(-1).y), 1.0000001192092896);
  assert.ok(hull.vertexOrder.includes(points.length - 1));
  assert.ok(
    hull.faces.length > 6,
    "the authored narrow ridge remains a feature",
  );
  assert.ok(
    hull.faces.some(
      (face) =>
        Math.abs(face.normal.x) > 0 &&
        Math.abs(face.normal.y) > 0 &&
        face.indices.includes(points.length - 1),
    ),
    "ridge side planes are retained rather than merged into the flat cube top",
  );
  for (const face of hull.faces)
    for (const point of points)
      assert.ok(face.normal.dot(point) - face.constant <= 1e-12);
});

test("direct recovery rejects flat and collinear rank-deficient inputs", () => {
  const flat = [-1, 1].flatMap((x) =>
    [-1, 1].flatMap((z) => new Vector3(x, 0, z)),
  );
  const collinear = [0, 1, 2, 3].map((x) => new Vector3(x, 2 * x, -x));
  assert.throws(
    () => recoverHull(flat, 1e-6),
    /Cannot reconstruct collision hull surface/,
  );
  assert.throws(
    () => recoverHull(collinear, 1e-6),
    /Cannot reconstruct collision hull surface/,
  );
});
