import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  collectHullRecoveryGeometry,
  recoverHullOverlap,
  sweepHulls,
  transformHull,
} from "../src/physics/geometry.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const cube = buildBoxHull(v(-0.5, -0.5, -0.5), v(0.5, 0.5, 0.5));
const at = (position, orientation = new Quaternion(), hull = cube) =>
  transformHull(hull, position, orientation);
function body(hull, velocity = v()) {
  return {
    state: {
      position: hull.position.clone(),
      orientation: hull.orientation.clone(),
      velocity,
      angularVelocity: v(),
    },
    properties: {
      mass: 1,
      inertia: v(1, 1, 1),
      centerOfMass: v(),
      worldFriction: 0,
    },
  };
}
function freezeGeometry(geometry) {
  for (const candidate of geometry.candidates) {
    Object.freeze(candidate.normal);
    Object.freeze(candidate.movingPoint);
    Object.freeze(candidate.targetPoint);
    Object.freeze(candidate);
  }
  Object.freeze(geometry.candidates);
  return Object.freeze(geometry);
}
function compare(oldA, oldB, options, geometry) {
  const direct = recoverHullOverlap(oldA, oldB, options),
    reused = recoverHullOverlap(oldA, oldB, { ...options, geometry });
  assert.deepEqual(reused, direct);
  return reused;
}

test("retained OLD recovery geometry applies live closing speed and attachment suppression", () => {
  const oldA = at(v(-0.45)),
    oldB = at(v(0.45)),
    a = body(oldA, v(1)),
    b = body(oldB, v(-1)),
    geometry = freezeGeometry(collectHullRecoveryGeometry(oldA, oldB));
  assert.equal(geometry.overlap, true);
  assert.ok(geometry.candidates.length >= 4);
  const inward = compare(oldA, oldB, { a, b }, geometry);
  assert.equal(inward.contact.points.length, 4);
  assert.ok(inward.contact.pointNormals.every((normal) => normal.x === -1));
  assert.ok(inward.contact.contactTypes.every((type) => type === 6));
  a.state.velocity.x = -1;
  b.state.velocity.x = 1;
  assert.deepEqual(compare(oldA, oldB, { a, b }, geometry), {
    overlap: true,
    contact: null,
  });
  a.state.velocity.x = 1;
  b.state.velocity.x = -1;
  assert.equal(
    compare(oldA, oldB, { a, b, sameAttachmentGroup: true }, geometry).contact,
    null,
  );
  assert.ok(compare(oldA, oldB, { a, b }, geometry).contact);
});

test("cached recovery geometry never aliases solver contact vectors", () => {
  const oldA = at(v(-0.45)),
    oldB = at(v(0.45)),
    a = body(oldA, v(1)),
    b = body(oldB, v(-1)),
    geometry = freezeGeometry(collectHullRecoveryGeometry(oldA, oldB)),
    first = compare(oldA, oldB, { a, b }, geometry),
    expected = recoverHullOverlap(oldA, oldB, { a, b });
  first.contact.normal.set(9, 8, 7);
  for (const point of first.contact.points) point.set(100, 200, 300);
  for (const point of first.contact.pointsB) point.set(-100, -200, -300);
  for (const normal of first.contact.pointNormals) normal.set(0, 0, 0);
  assert.deepEqual(
    recoverHullOverlap(oldA, oldB, { a, b, geometry }),
    expected,
  );
});

test("rotated hull candidates preserve order under live angular velocity and COM edits", () => {
  const rotations = [
    [new Quaternion(), new Quaternion()],
    [new Quaternion().setFromAxisAngle(v(0, 1), 0.35), new Quaternion()],
    [
      new Quaternion().setFromAxisAngle(v(1, 0, 0), 0.4),
      new Quaternion().setFromAxisAngle(v(0, 0, 1), -0.25),
    ],
    [
      new Quaternion().setFromAxisAngle(v(0, 1), Math.PI),
      new Quaternion().setFromAxisAngle(v(0, 1), Math.PI / 2),
    ],
  ];
  for (const [rotationA, rotationB] of rotations) {
    const oldA = at(v(-0.35, 0.05, 0.05), rotationA),
      oldB = at(v(0.35, -0.05, 0), rotationB),
      a = body(oldA, v(0.7, 0.1)),
      b = body(oldB, v(-0.6, -0.1)),
      centerA = oldA.position.clone().add(v(0.1, 0.05)),
      centerB = oldB.position.clone().add(v(-0.05, 0.1)),
      options = { a, b, boundsCenterA: centerA, boundsCenterB: centerB },
      geometry = freezeGeometry(
        collectHullRecoveryGeometry(oldA, oldB, centerA, centerB),
      );
    assert.ok(geometry.overlap);
    for (const mutate of [
      () => {},
      () => a.state.angularVelocity.set(0.5, 2, -3),
      () => b.state.angularVelocity.set(-2, 0.5, 1),
      () => a.properties.centerOfMass.set(0.3, -0.2, 0.1),
      () => b.properties.centerOfMass.set(-0.1, 0.4, 0.2),
      () => a.state.velocity.set(-3, 0, 0),
    ]) {
      mutate();
      compare(oldA, oldB, options, geometry);
    }
  }
});

test("separation and containment preserve empty recovery evidence", () => {
  const small = buildBoxHull(v(-0.1, -0.1, -0.1), v(0.1, 0.1, 0.1));
  for (const [oldA, oldB, overlap] of [
    [at(v(-2)), at(v(2)), false],
    [at(v(), new Quaternion(), small), at(v()), true],
  ]) {
    const a = body(oldA),
      b = body(oldB),
      geometry = freezeGeometry(collectHullRecoveryGeometry(oldA, oldB));
    assert.equal(geometry.overlap, overlap);
    assert.equal(geometry.candidates.length, 0);
    assert.deepEqual(compare(oldA, oldB, { a, b }, geometry), {
      overlap,
      contact: null,
    });
  }
});

test("pair sweeps replay overlap callbacks with cached recovery and current velocities", () => {
  const oldA = at(v(-0.45)),
    oldB = at(v(0.45)),
    nextA = at(v(-0.4)),
    nextB = at(v(0.4)),
    a = body(oldA, v(1)),
    b = body(oldB, v(-1)),
    geometry = freezeGeometry(collectHullRecoveryGeometry(oldA, oldB));
  for (const direction of [1, -1]) {
    a.state.velocity.x = direction;
    b.state.velocity.x = -direction;
    let callbacks = 0;
    const options = { a, b };
    const direct = sweepHulls(oldA, nextA, oldB, nextB, {
      recovery: options,
      onOverlap: () => callbacks++,
    });
    const reused = sweepHulls(oldA, nextA, oldB, nextB, {
      recovery: { ...options, geometry },
      onOverlap: () => callbacks++,
    });
    assert.deepEqual(reused, direct);
    assert.equal(callbacks, 2);
    assert.equal(reused === null, direction < 0);
  }
});
