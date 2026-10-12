import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  transformHull,
  sweepHullTriangle,
  recoverWorldContacts,
} from "../src/physics/geometry.ts";
const v = (...x) => new Vector3(...x);
const hull = () => buildBoxHull(v(-0.2, -0.2, -0.2), v(0.2, 0.2, 0.2));
const pose = (h, y) => transformHull(h, v(0, y, 0), new Quaternion());
const face = () => ({
  a: v(-2, 0, -2),
  b: v(0, 0, 2),
  c: v(2, 0, -2),
  normal: v(1, 0, 0),
  constant: 100,
  twoSided: true,
});
const summary = (h) =>
  h && {
    normal: h.normal.toArray(),
    points: h.points.map((p) => p.toArray()),
    fraction: h.fraction,
    measures: h.measures,
    types: h.contactTypes,
    normals: h.pointNormals?.map((n) => n.toArray()),
    fractions: h.pointFractions,
  };

test("retained world planes preserve exact triangle arithmetic and refresh edited coordinates", () => {
  const f = face(),
    h = hull();
  for (const y of [0, 0, 2, 2]) {
    for (const p of [f.a, f.b, f.c]) p.y = y;
    const old = pose(h, y + 0.3),
      next = pose(h, y - 0.3);
    const expected = sweepHullTriangle(old, next, f.a, f.b, f.c, {
      twoSided: true,
      deferReduction: true,
    });
    const actual = sweepHullTriangle(old, next, f.a, f.b, f.c, {
      sourceSurface: f,
      twoSided: true,
      deferReduction: true,
    });
    assert.ok(expected);
    assert.deepEqual(summary(actual), summary(expected));
    assert.deepEqual(
      f.normal.toArray(),
      [1, 0, 0],
      "prepared plane stays separate from feature plane",
    );
    assert.equal(f.constant, 100);
  }
});

test("bidirectional recovery never negates the retained feature normal", () => {
  const f = face(),
    h = hull();
  for (const [oldY, newY] of [
    [0.05, -0.05],
    [-0.05, 0.05],
    [0.05, -0.05],
    [-0.05, 0.05],
  ]) {
    const old = pose(h, oldY),
      next = pose(h, newY),
      center = v(0, oldY, 0);
    const expected = recoverWorldContacts(old, next, [{ ...f }], center);
    const actual = recoverWorldContacts(
      old,
      next,
      [{ ...f, sourceSurface: f }],
      center,
    );
    assert.deepEqual(
      actual.contacts.map(summary),
      expected.contacts.map(summary),
    );
    assert.deepEqual(
      [...actual.suppressedVertices],
      [...expected.suppressedVertices],
    );
    assert.equal(actual.overlapDetected, expected.overlapDetected);
    assert.ok(actual.overlapDetected);
  }
});
