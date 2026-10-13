import test from "node:test";
import assert from "node:assert/strict";
import { Euler, Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { buildWireHull } from "../src/physics/wire-hull.ts";
import {
  eagerPenetration,
  eagerContact,
} from "./support/legacy-physics-guard.mjs";
import {
  collideHulls,
  hullPenetration,
  hullPenetrationExceeds,
  sweepHulls,
  sweepHullsFraction,
  transformHull,
} from "../src/physics/geometry.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const box = (x = 1, y = 1, z = 1) => buildBoxHull(v(-x, -y, -z), v(x, y, z));
const at = (hull, p = v(), q = new Quaternion()) => transformHull(hull, p, q);
const compareDepth = (a, b) => {
  const depth = hullPenetration(a, b);
  for (const threshold of [
    -Infinity,
    -1,
    -0,
    0,
    1e-6,
    depth - Number.EPSILON,
    depth,
    depth + Number.EPSILON,
    Infinity,
    NaN,
  ])
    assert.equal(
      hullPenetrationExceeds(a, b, threshold),
      depth > threshold,
      `depth ${depth}, threshold ${threshold}`,
    );
};
const compareSweep = (...hulls) => {
  const full = sweepHulls(...hulls),
    fraction = sweepHullsFraction(...hulls);
  assert.ok(
    Object.is(fraction, full?.fraction),
    `${fraction} != ${full?.fraction}`,
  );
  return fraction;
};

test("exact duplicate edge vectors skip repeated crosses without changing SAT contacts", () => {
  const a = at(box()),
    b = at(box(), v(0.2, 0.3, 0.4)),
    original = Vector3.prototype.cross;
  let crosses = 0;
  Vector3.prototype.cross = function (...args) {
    crosses++;
    return original.apply(this, args);
  };
  try {
    const expected = eagerPenetration(a, b),
      baselineCrosses = crosses;
    crosses = 0;
    assert.ok(Object.is(hullPenetration(a, b), expected));
    assert.equal(baselineCrosses, 144);
    assert.equal(crosses, 0, "scalar SAT constructs no cross Vector3 values");
  } finally {
    Vector3.prototype.cross = original;
  }
  assert.deepEqual(collideHulls(a, b), eagerContact(a, b));
});

test("SAT edge dedup preserves signed zero and falls back for unsafe vectors", () => {
  const limit = Math.sqrt(Math.sqrt(Number.MAX_VALUE)) / 4,
    a = at(box()),
    b = at(box(), v(0.2)),
    original = Vector3.prototype.cross;
  let crosses = 0;
  Vector3.prototype.cross = function (...args) {
    crosses++;
    return original.apply(this, args);
  };
  try {
    // The added storage is outside the compact projection feature set.
    const signed = {
      ...a,
      vertices: [...a.vertices, v(), v(2, 0, 0), v(2, -0, 0)],
      vertexOrder: a.vertices.map((_, i) => i),
      edges: [
        [8, 9],
        [8, 10],
      ],
    };
    const one = { ...b, edges: [b.edges[0]] };
    assert.ok(
      Object.is(hullPenetration(signed, one), eagerPenetration(signed, one)),
    );
    crosses = 0;
    hullPenetration(signed, one);
    assert.equal(crosses, 0, "signed-zero edges use scalar arithmetic");
    for (const component of [limit * 2, Infinity, NaN]) {
      const unsafe = {
        ...a,
        vertices: [...a.vertices, v(), v(component, 0, 0)],
        vertexOrder: a.vertices.map((_, i) => i),
        edges: [...a.edges, [8, 9], [8, 9]],
      };
      const expected = eagerPenetration(unsafe, b);
      crosses = 0;
      assert.ok(Object.is(hullPenetration(unsafe, b), expected));
      assert.equal(
        crosses,
        0,
        "exceptional edges also avoid cross Vector3 allocation",
      );
      compareDepth(unsafe, b);
      assert.deepEqual(collideHulls(unsafe, b), eagerContact(unsafe, b));
    }
    const tiny = {
      ...a,
      vertices: [...a.vertices, v(), v(1e-8, 0, 0)],
      vertexOrder: a.vertices.map((_, i) => i),
      edges: [
        [8, 9],
        [8, 9],
      ],
    };
    assert.ok(
      Object.is(hullPenetration(tiny, one), eagerPenetration(tiny, one)),
    );
    compareDepth(tiny, one);
  } finally {
    Vector3.prototype.cross = original;
  }
});

test("depth predicate matches strict SAT comparison at shallow contact and antiparallel axes", () => {
  const h = box();
  for (const distance of [0, 1.9999995, 2, 2.0000005, 4]) {
    const a = at(h),
      b = at(
        h,
        v(distance),
        new Quaternion().setFromAxisAngle(v(0, 1), Math.PI),
      );
    compareDepth(a, b);
    compareDepth(b, a);
  }
  for (const angle of [0.0002, 0.0006, 0.9]) {
    const a = at(box(0.05, 0.1, 1.2)),
      b = at(
        box(0.07, 0.13, 1),
        v(0.08, 0.01, 0.2),
        new Quaternion().setFromEuler(new Euler(angle, angle / 3, angle / 7)),
      );
    compareDepth(a, b);
    compareDepth(b, a);
  }
});

test("depth predicate preserves wire, zero-axis and nonfinite depth fallbacks", () => {
  const a = at(box()),
    b = at(box(), v(0.4));
  compareDepth({ ...a, faces: [] }, b);
  const noAxes = {
    ...a,
    faces: [{ normal: v(), constant: 0, indices: [] }],
    edges: [],
  };
  compareDepth(noAxes, noAxes);
  compareDepth({ ...a, vertices: a.vertices.map(() => v(NaN, NaN, NaN)) }, b);
  compareDepth(
    { ...a, vertices: a.vertices.map(() => v(Infinity, Infinity, Infinity)) },
    b,
  );
  compareDepth(
    {
      ...a,
      vertices: [...a.vertices, v(NaN, NaN, NaN)],
      vertexOrder: a.vertices.map((_, i) => i),
    },
    b,
  );
});

test("a positive depth below the guard limit skips all edge-axis construction", () => {
  const a = at(box()),
    b = at(box(), v(1.9999995));
  assert.ok(hullPenetration(a, b) > 0);
  let edgeReads = 0;
  const watch = (hull) =>
    Object.defineProperty({ ...hull }, "edges", {
      get() {
        edgeReads++;
        return hull.edges;
      },
    });
  assert.equal(hullPenetrationExceeds(watch(a), watch(b), 1e-6), false);
  assert.equal(
    edgeReads,
    0,
    "the shallow face certifies the full SAT predicate",
  );
  assert.ok(hullPenetration(watch(a), watch(b)) > 0);
  assert.equal(edgeReads, 2, "full depth still requires both edge arrays");
});

test("fraction query preserves crossing, clear-end tunnelling, touching and old overlap", () => {
  const h = box(0.5, 0.5, 0.5),
    fixed = at(h);
  assert.equal(compareSweep(at(h, v(-2)), at(h, v(2)), fixed, fixed), 0.25);
  compareSweep(at(h, v(-2)), at(h, v(-3)), fixed, fixed);
  compareSweep(at(h, v(-1)), at(h, v(-1, 0, 1)), fixed, fixed);
  compareSweep(at(h, v(-0.6)), at(h, v(-0.8)), fixed, fixed);
  compareSweep(at(h, v(-0.6)), at(h, v(-0.2)), fixed, fixed);
  const thin = box(0.3, 0.06, 0.4);
  compareSweep(
    at(thin, v(0, 0, -0.41)),
    at(thin, v(0, 0, -0.25)),
    at(thin, v(0, 0, 0.41)),
    at(thin, v(0, 0, 0.25)),
  );
});

test("fraction query retains authored wire edge features and compact vertex selection", () => {
  const wire = buildWireHull([v(0, 0, -1), v(0, 0, 1)], [[0, 1]]),
    vertical = buildWireHull([v(0, -1), v(0, 1)], [[0, 1]]),
    fixed = at(vertical),
    start = at(wire, v(1)),
    end = at(wire, v(-1));
  assert.equal(compareSweep(start, end, fixed, fixed), 0.5);
  assert.equal(compareSweep(fixed, fixed, start, end), 0.5);
  const solid = at(box(0.5, 0.5, 0.5));
  compareSweep(start, end, solid, solid);
  compareSweep(solid, solid, start, end);
  const h = box(0.5, 0.5, 0.5);
  h.vertices.push(v(50, 50, 50));
  h.vertexOrder = h.vertices.slice(0, -1).map((_, i) => i);
  compareSweep(at(h, v(-2)), at(h, v(2)), solid, solid);
});

test("fraction query retains the native 1.05 near-inside endpoint measure", () => {
  const wire = buildWireHull([v(0, 0, -0.1), v(0, 0, 0.1)], [[0, 1]]),
    fixed = at(box(0.5, 0.5, 0.5));
  assert.equal(
    compareSweep(at(wire, v(-1)), at(wire, v(-0.500005)), fixed, fixed),
    1.05,
  );
});

test("bounded rotated and translated fixture sweep fractions remain bit-identical", () => {
  let seed = 0x81d72a31;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let i = 0; i < 24; i++) {
    const h = box(0.4, 0.08 + random() * 0.3, 0.7),
      q = new Quaternion().setFromEuler(
        new Euler(random(), random(), random()),
      ),
      nextQ = new Quaternion().setFromEuler(
        new Euler(random(), random(), random()),
      ),
      offset = v(100 + random(), -7 + random(), 20 + random()),
      a = at(h, offset.clone().add(v(-1.8, 0, 0)), q),
      nextA = at(h, offset.clone().add(v(1.8, 0, 0)), nextQ),
      b = at(h, offset, nextQ),
      nextB = at(h, offset.clone().add(v(0, random() * 0.1, 0)), q);
    compareSweep(a, nextA, b, nextB);
    compareSweep(b, nextB, a, nextA);
    compareDepth(a, b);
  }
});

test("fraction query skips contact normal and torque-point transforms", () => {
  const h = box(0.5, 0.5, 0.5),
    hulls = [at(h, v(-2)), at(h, v(2)), at(h), at(h)],
    original = Vector3.prototype.applyQuaternion;
  let calls = 0;
  Vector3.prototype.applyQuaternion = function (...args) {
    calls++;
    return original.apply(this, args);
  };
  try {
    const full = sweepHulls(...hulls),
      fullCalls = calls;
    calls = 0;
    const fraction = sweepHullsFraction(...hulls),
      fractionCalls = calls;
    assert.equal(fraction, full.fraction);
    assert.ok(
      fractionCalls < fullCalls,
      `fraction transforms ${fractionCalls}, full contact transforms ${fullCalls}`,
    );
  } finally {
    Vector3.prototype.applyQuaternion = original;
  }
});
