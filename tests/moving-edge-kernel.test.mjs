import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  sweepMovingEdges,
  hullPenetration,
  collideHulls,
} from "../src/physics/geometry.ts";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { sweepMovingEdges as legacySweep } from "./support/legacy-moving-edge.mjs";
import {
  eagerPenetration,
  eagerContact,
} from "./support/legacy-physics-guard.mjs";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function exact(actual, expected, path = "contact") {
  if (expected === null || typeof expected !== "object") {
    assert.ok(Object.is(actual, expected), `${path}: ${actual} != ${expected}`);
    return;
  }
  assert.ok(actual !== null && typeof actual === "object", path);
  assert.deepEqual(
    Object.keys(actual),
    Object.keys(expected),
    `${path} fields`,
  );
  for (const key of Object.keys(expected))
    exact(actual[key], expected[key], `${path}.${key}`);
}
function compare(points) {
  const before = points.map((point) => point.toArray());
  const result = sweepMovingEdges(...points);
  exact(result, legacySweep(...points));
  assert.deepEqual(
    points.map((point) => point.toArray()),
    before,
    "source endpoints unchanged",
  );
  return result;
}
const crossing = () => [
  v(0, -1),
  v(0, 1),
  v(1, 0, -1),
  v(1, 0, 1),
  v(-1, 0, -1),
  v(-1, 0, 1),
];

test("scalar edge kernel preserves linear/quadratic roots and both original torque points", () => {
  assert.equal(compare(crossing()).fraction, 0.5);
  const rotating = crossing();
  rotating[4] = v(-1, 0, 0);
  rotating[5] = v(1, 0, 2);
  assert.equal(compare(rotating).fraction, Math.fround((Math.sqrt(5) - 1) / 2));
  for (const points of [crossing(), rotating]) {
    compare([points[1], points[0], ...points.slice(2)]);
    compare([points[0], points[1], points[3], points[2], points[5], points[4]]);
    compare([points[0], points[1], points[4], points[5], points[2], points[3]]);
  }
});

test("scalar edge kernel preserves degeneracy, exceptional values and signed-zero outputs", () => {
  compare([v(), v(), v(), v(), v(), v()]);
  compare([v(), v(1), v(0, 1), v(1, 1), v(0, 2), v(1, 2)]);
  for (const scale of [1e-10, 1e-4, 1, 1e30, 1e100, 1e200])
    compare(crossing().map((point) => point.multiplyScalar(scale)));
  const negativeZeros = crossing().map((point) => {
    for (const axis of ["x", "y", "z"]) if (point[axis] === 0) point[axis] = -0;
    return point;
  });
  compare(negativeZeros);
  for (const exceptional of [Infinity, -Infinity, NaN]) {
    const points = crossing();
    points[2].x = exceptional;
    compare(points);
  }
  const translated = crossing().map((point) => point.add(v(1e14, -1e14, 1e14)));
  compare(translated);
});

test("bounded seeded edge fixtures preserve all emitted numbers bit-for-bit", () => {
  let seed = 0xd841ce2b;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 96; i++) {
    const points = Array.from({ length: 6 }, () =>
      v((random() - 0.5) * 4, (random() - 0.5) * 4, (random() - 0.5) * 4),
    );
    compare(points);
  }
});

test("rejected edge pairs create no cloned or crossed temporary vectors", () => {
  const points = crossing();
  for (const i of [2, 3, 4, 5]) points[i].y = 3;
  const originalClone = Vector3.prototype.clone,
    originalCross = Vector3.prototype.cross;
  let clones = 0,
    crosses = 0;
  Vector3.prototype.clone = function (...args) {
    clones++;
    return originalClone.apply(this, args);
  };
  Vector3.prototype.cross = function (...args) {
    crosses++;
    return originalCross.apply(this, args);
  };
  try {
    assert.equal(legacySweep(...points), null);
    assert.ok(
      clones >= 7 && crosses >= 2,
      "baseline creates per-pair vector intermediates",
    );
    clones = crosses = 0;
    assert.equal(sweepMovingEdges(...points), null);
    assert.equal(clones, 0);
    assert.equal(crosses, 0);
  } finally {
    Vector3.prototype.clone = originalClone;
    Vector3.prototype.cross = originalCross;
  }
});

test("fixed scalar roots retain stable exceptional ordering without array sorting", () => {
  const rotating = crossing();
  rotating[4] = v(-1, 0, 0);
  rotating[5] = v(1, 0, 2);
  // These coplanarity coefficients are a=-0.5, b=0, c=0: the native zero-q
  // double-root branch must retain its exact division and signed-zero result.
  const doubleRoot = [
    v(),
    v(1),
    v(0, -0.5),
    v(0, 0.5),
    v(0, -0.5, -0.5),
    v(0, 1.5, 0.5),
  ];
  const negativeZeros = crossing().map((point) => {
    for (const axis of ["x", "y", "z"]) if (point[axis] === 0) point[axis] = -0;
    return point;
  });
  const exceptional = crossing();
  exceptional[2].x = Infinity;
  for (const points of [
    crossing(),
    rotating,
    doubleRoot,
    negativeZeros,
    exceptional,
    crossing().map((point) => point.multiplyScalar(1e100)),
    [v(), v(), v(), v(), v(), v()],
  ]) {
    const originalSort = Array.prototype.sort;
    let sorts = 0,
      actual,
      expected,
      actualSorts,
      expectedSorts;
    Array.prototype.sort = function (...args) {
      sorts++;
      return originalSort.apply(this, args);
    };
    try {
      actual = sweepMovingEdges(...points);
      actualSorts = sorts;
      sorts = 0;
      expected = legacySweep(...points);
      expectedSorts = sorts;
    } finally {
      Array.prototype.sort = originalSort;
    }
    exact(actual, expected);
    assert.equal(actualSorts, 0);
    assert.equal(
      expectedSorts,
      1,
      "legacy kernel sorts even its empty root array",
    );
  }
  assert.ok(compare(doubleRoot));
});

test("SAT shortcut retains every edge above 64 independently of the partner list", () => {
  const a = buildBoxHull(v(-1, -1, -1), v(1, 1, 1)),
    b = buildBoxHull(v(-0.8, -0.8, -0.8), v(1.2, 1.2, 1.2));
  a.edges = Array.from({ length: 65 }, () => [...a.edges[0]]);
  const expected = eagerPenetration(a, b),
    originalCross = Vector3.prototype.cross;
  let crosses = 0;
  Vector3.prototype.cross = function (...args) {
    crosses++;
    return originalCross.apply(this, args);
  };
  try {
    exact(hullPenetration(a, b), expected, "large-list depth");
    assert.equal(
      crosses,
      65 * 3,
      "all 65 authored A edges survive; small B still deduplicates",
    );
  } finally {
    Vector3.prototype.cross = originalCross;
  }
  exact(collideHulls(a, b), eagerContact(a, b));
  exact(hullPenetration(b, a), eagerPenetration(b, a));
  exact(collideHulls(b, a), eagerContact(b, a));
});
