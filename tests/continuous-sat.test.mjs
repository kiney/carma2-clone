import test from "node:test";
import assert from "node:assert/strict";
import { Euler, Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  certifiedHullSeparation,
  translationHullFraction,
} from "../src/physics/continuous-sat.ts";
import { hullPenetration, transformHull } from "../src/physics/geometry.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const box = (x = 1, y = 1, z = 1) => buildBoxHull(v(-x, -y, -z), v(x, y, z));
const pose = (hull, position = v(), orientation = new Quaternion()) =>
  transformHull(hull, position, orientation);
const close = (actual, expected, tolerance = 1e-12) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected}`,
  );

test("continuous SAT catches a thin full crossing with clear endpoints", () => {
  const a = pose(box(0.0001, 0.2, 0.3), v(-100, 0.1, 0.2)),
    b = pose(box(0.0002, 1, 1)),
    deltaA = v(200),
    deltaB = v(),
    before = JSON.stringify([a, b, deltaA, deltaB]);
  const fraction = translationHullFraction(a, b, deltaA, deltaB, 0);
  close(fraction, (100 - 0.0003) / 200);
  assert.equal(hullPenetration(a, b), 0);
  assert.equal(hullPenetration(pose(a, deltaA), b), 0);
  assert.equal(JSON.stringify([a, b, deltaA, deltaB]), before);
});

test("continuous SAT intersects axis time windows rather than endpoint bounds", () => {
  const h = box(0.1, 0.1, 0.1),
    a = pose(h, v(-2, 2)),
    b = pose(h);
  assert.equal(translationHullFraction(a, b, v(4, -1), v(), 0), 1);
  close(translationHullFraction(a, b, v(4, -4), v(), 0), 0.45);
});

test("tangential and separating touches remain fully movable", () => {
  const h = box(),
    a = pose(h),
    b = pose(h, v(2));
  assert.equal(translationHullFraction(a, b, v(0, 10), v(), 0), 1);
  assert.equal(translationHullFraction(a, b, v(-10), v(), 0), 1);
  assert.equal(translationHullFraction(a, b, v(10), v(), 0), 0);
  // The two strict axis windows meet only at one instant: a corner graze.
  assert.equal(
    translationHullFraction(pose(h, v(-2, 0)), b, v(8, 8), v(), 0),
    1,
  );
});

test("allowed old depth accepts escape and clamps increased penetration", () => {
  const h = box(),
    a = pose(h),
    b = pose(h, v(1.5)),
    limit = 0.500001;
  assert.equal(translationHullFraction(a, b, v(-1), v(), limit), 1);
  assert.equal(translationHullFraction(a, b, v(), v(), 0.5), 1);
  close(translationHullFraction(a, b, v(1), v(), limit), 0.000001);
  assert.equal(translationHullFraction(a, b, v(), v(), 0.4), 0);
});

test("edge-cross axes reject skew rods despite every face projection overlapping", () => {
  const h = box(1, 0.15, 0.1),
    a = pose(
      h,
      v(),
      new Quaternion().setFromEuler(
        new Euler(1.2213671787176281, 1.9113588784821332, 2.345409391215071),
      ),
    ),
    b = pose(
      h,
      v(0.7564654950983822, 0.20036458037793636, 0.32528953021392226),
      new Quaternion().setFromEuler(
        new Euler(0.27511618472635746, 0.4755855586845428, 2.760273307096213),
      ),
    );
  for (const { normal } of [...a.faces, ...b.faces]) {
    const pa = a.vertices.map((point) => point.dot(normal)),
      pb = b.vertices.map((point) => point.dot(normal));
    assert.ok(Math.max(...pa) > Math.min(...pb));
    assert.ok(Math.max(...pb) > Math.min(...pa));
  }
  assert.equal(hullPenetration(a, b), 0);
  assert.equal(translationHullFraction(a, b, v(), v(), 0), 1);
});

test("relative translation is invariant under common motion and body order", () => {
  const h = box(0.2, 0.4, 0.6),
    a = pose(h, v(-5, 0.2, 0.1)),
    b = pose(h),
    da = v(10, 2, 3),
    db = v(0, 2, 3);
  const fraction = translationHullFraction(a, b, da, db, 0.000001);
  close(fraction, (5 - 0.4 + 0.000001) / 10);
  close(translationHullFraction(b, a, db, da, 0.000001), fraction);
  close(translationHullFraction(a, b, v(10), v(), 0.000001), fraction);
});

test("near-parallel rotated boxes preserve thin off-center crossings", () => {
  const orientation = new Quaternion().setFromEuler(new Euler(0.2, 0.4, -0.1)),
    direction = v(1).applyQuaternion(orientation),
    h = box(0.01, 1, 0.8),
    a = pose(h, direction.clone().multiplyScalar(-3), orientation),
    b = pose(
      h,
      v(),
      orientation
        .clone()
        .multiply(new Quaternion().setFromAxisAngle(v(0, 1), 0.0002)),
    ),
    delta = direction.clone().multiplyScalar(6);
  const fraction = translationHullFraction(a, b, delta, v(), 1e-6);
  assert.ok(fraction > 0.49 && fraction < 0.51);
  assert.equal(
    hullPenetration(pose(a, delta.clone().multiplyScalar(fraction - 1e-5)), b),
    0,
  );
  assert.ok(
    hullPenetration(pose(a, delta.clone().multiplyScalar(fraction + 1e-5)), b) >
      1e-6,
  );
});

test("SAT projections honor compact vertex order and ignore retained storage", () => {
  const a = pose(box(), v(-4)),
    b = pose(box()),
    retained = {
      ...a,
      vertexOrder: a.vertices.map((_, index) => index),
      vertices: [...a.vertices, v(NaN, NaN, NaN), v(10000)],
    };
  close(translationHullFraction(retained, b, v(8), v(), 0), 0.25);
  assert.equal(certifiedHullSeparation(retained, b, v(), 0, 0), true);
});

test("whole-phase witness includes relative motion and both rotation allowances", () => {
  const a = pose(box()),
    b = pose(box(), v(6));
  assert.equal(certifiedHullSeparation(a, b, v(-1), 1, 1), true);
  assert.equal(certifiedHullSeparation(a, b, v(-2), 1, 1), false);
  assert.equal(certifiedHullSeparation(a, b, v(-10), 0, 0), false);
  assert.equal(certifiedHullSeparation(a, b, v(10, 20), 1, 2), true);
  assert.equal(certifiedHullSeparation(b, a, v(1), 1, 1), true);
});

test("witness padding rejects numerical near-gaps and unsupported envelopes", () => {
  const a = pose(box()),
    b = pose(box(), v(2 + 1e-10));
  assert.equal(certifiedHullSeparation(a, b, v(), 0, 0), false);
  assert.equal(certifiedHullSeparation(a, b, v(), -1, 0), false);
  assert.equal(certifiedHullSeparation(a, b, v(), Infinity, 0), false);
  assert.equal(certifiedHullSeparation(a, b, v(NaN), 0, 0), false);
});
