import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  buildHull,
  transformHull,
  collideHulls,
  sweepHullTriangle,
  reduceWorldContacts,
  sweepMovingEdges,
} from "../src/physics/geometry.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const near = (a, b, epsilon = 1e-7) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);
const cube = buildHull(
  [-0.5, 0.5].flatMap((x) =>
    [-0.5, 0.5].flatMap((y) => [-0.5, 0.5].map((z) => v(x, y, z))),
  ),
);
const at = (position, quaternion = new Quaternion()) =>
  transformHull(cube, position, quaternion);
const floor = [v(-5, 0, -5), v(0, 0, 5), v(5, 0, -5)];

test("authored convex hull topology excludes triangulation diagonals", () => {
  assert.equal(cube.vertices.length, 8);
  assert.equal(cube.faces.length, 6);
  assert.equal(cube.edges.length, 12);
  assert.ok(cube.faces.every((face) => face.indices.length === 4));
});

test("hull SAT normal pushes A away from B and detects separated cars", () => {
  const a = at(v(-0.45)),
    b = at(v(0.45));
  const impact = collideHulls(a, b);
  assert.ok(impact);
  near(impact.normal.x, -1);
  near(impact.penetration, 0.1);
  assert.ok(impact.points.length >= 1 && impact.points.length <= 4);
  assert.equal(collideHulls(at(v(-1)), at(v(1))), null);
  const swapped = collideHulls(b, a);
  near(swapped.normal.dot(impact.normal), -1);
});

test("moving-vertex world contacts retain old lever and original sweep extension", () => {
  const result = sweepHullTriangle(at(v(0, 1)), at(v()), ...floor);
  assert.ok(result);
  near(result.normal.y, 1);
  assert.equal(result.points.length, 4);
  assert.ok(result.points.every((point) => Math.abs(point.y - 0.5) < 1e-8));
  near(result.fraction, 0.5 / (1 + 0.0010434782598167658));
  assert.ok(result.measures.every((value) => value < 0));
});

test("original material prefixes suppress contact and material flags control sides", () => {
  for (const prefix of ["!water", ">noncontact"]) {
    assert.equal(
      sweepHullTriangle(at(v(0, 1)), at(v()), ...floor, {
        materialIdentifier: prefix,
      }),
      null,
    );
  }
  assert.equal(
    sweepHullTriangle(at(v(0, -1)), at(v()), ...floor, { materialFlags: 0 }),
    null,
  );
  for (const flag of [0x800, 0x1000]) {
    const result = sweepHullTriangle(at(v(0, -1)), at(v()), ...floor, {
      materialFlags: flag,
    });
    assert.ok(result);
    near(result.normal.y, -1);
  }
  // '?' is conditional on a game global in C2; it is not unconditionally removed.
  assert.ok(
    sweepHullTriangle(at(v(0, 1)), at(v()), ...floor, {
      materialIdentifier: "?special",
      materialFlags: 0,
    }),
  );
});

test("finite triangle tests reject crossings outside world geometry", () => {
  assert.equal(sweepHullTriangle(at(v(20, 1)), at(v(20, -1)), ...floor), null);
  assert.equal(sweepHullTriangle(at(v(0, 2)), at(v(0, 3)), ...floor), null);
});

test("small world triangle crosses a moving hull face without any hull vertex hit", () => {
  const small = [v(-0.1, 0, -0.1), v(0, 0, 0.1), v(0.1, 0, -0.1)];
  const result = sweepHullTriangle(at(v(0, 1)), at(v()), ...small);
  assert.ok(result);
  assert.ok(result.points.length >= 1);
  for (const point of result.points) {
    near(point.y, 0.5, 1e-5);
    assert.ok(Math.abs(point.x) <= 0.100001 && Math.abs(point.z) <= 0.100001);
  }
  near(result.normal.y, 1);
  near(result.fraction, 0.5);
});

test("world emitter sorts contact measures and retains four per authored shape", () => {
  const values = [4, 1, 3, 0, 2, -1].map((measure, i) => ({
    normal: v(0, 1),
    points: [v(i * 0.1)],
    penetration: 0,
    measures: [measure],
  }));
  const reduced = reduceWorldContacts(values);
  assert.equal(reduced.length, 4);
  assert.deepEqual(
    reduced.map((contact) => contact.measures[0]),
    [-1, 0, 1, 2],
  );
  assert.equal(values.length, 6);
});

test("original duplicate thresholds preserve different contact normals", () => {
  const candidates = [
    { normal: v(0, 1), points: [v()], penetration: 0 },
    { normal: v(0, 1), points: [v(0.01)], penetration: 0 },
    { normal: v(0, -1), points: [v(0.05)], penetration: 0 },
    { normal: v(1), points: [v(0.01)], penetration: 0 },
    { normal: v(0, 1), points: [v(0.03)], penetration: 0 },
  ];
  const result = reduceWorldContacts(candidates);
  assert.equal(result.length, 3);
  assert.ok(result.some((contact) => contact.normal.x === 1));
  assert.ok(result.some((contact) => contact.points[0].x === 0.03));
});

test("rotating authored vertices use their actual endpoint paths", () => {
  const old = at(v(0, 0.7));
  const predicted = at(
    v(0, 0.7),
    new Quaternion().setFromAxisAngle(v(0, 0, 1), Math.PI / 4),
  );
  const result = sweepHullTriangle(old, predicted, ...floor, {
    materialFlags: 0,
  });
  assert.ok(result);
  near(result.normal.y, 1);
  assert.ok(
    result.points.every((point) =>
      old.vertices.some((vertex) => vertex.distanceTo(point) < 1e-8),
    ),
  );
});

test("moving-edge quadratic CCD returns the old edge torque point", () => {
  const result = sweepMovingEdges(
    v(0, -1),
    v(0, 1),
    v(1, 0, -1),
    v(1, 0, 1),
    v(-1, 0, -1),
    v(-1, 0, 1),
  );
  assert.ok(result);
  near(result.fraction, 0.5);
  near(result.normal.x, 1);
  near(result.points[0].distanceTo(v(1)), 0);
  assert.equal(
    sweepMovingEdges(
      v(0, -1),
      v(0, 1),
      v(1, 3, -1),
      v(1, 3, 1),
      v(-1, 3, -1),
      v(-1, 3, 1),
    ),
    null,
  );
});

test("rotating edge CCD solves a quadratic coplanarity crossing", () => {
  const result = sweepMovingEdges(
    v(0, -1),
    v(0, 1),
    v(1, 0, -1),
    v(1, 0, 1),
    v(-1, 0, 0),
    v(1, 0, 2),
  );
  assert.ok(result);
  const fraction = (Math.sqrt(5) - 1) / 2;
  near(result.fraction, fraction);
  near(result.points[0].x, 1);
  near(result.points[0].z, -fraction);
  near(result.normal.z / result.normal.x, -fraction);
});

test("each swept vertex chooses its earliest world face before reduction", () => {
  const late = {
    normal: v(0, 1),
    points: [v()],
    penetration: 0,
    fraction: 0.8,
    vertexIndices: [2],
    measures: [-1],
  };
  const early = { ...late, normal: v(1), fraction: 0.3, measures: [-0.5] };
  const result = reduceWorldContacts([late, early]);
  assert.equal(result.length, 1);
  near(result[0].fraction, 0.3);
  near(result[0].normal.x, 1);
});
