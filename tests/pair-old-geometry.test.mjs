import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  collectPairOldGeometry,
  sweepHulls,
  transformHull,
} from "../src/physics/geometry.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const cube = buildBoxHull(v(-0.5, -0.5, -0.5), v(0.5, 0.5, 0.5));
const at = (position, orientation = new Quaternion()) =>
  transformHull(cube, position, orientation);
function freezeGeometry(geometry) {
  for (const direction of [geometry.aToB, geometry.bToA]) {
    for (const point of direction.relativeOld) Object.freeze(point);
    Object.freeze(direction.relativeOld);
    Object.freeze(direction.inside);
    Object.freeze(direction);
  }
  return Object.freeze(geometry);
}
function compare(oldA, nextA, oldB, nextB, geometry) {
  let directOverlap = 0,
    cachedOverlap = 0,
    queries = 0;
  const direct = sweepHulls(oldA, nextA, oldB, nextB, {
    onOverlap: () => directOverlap++,
  });
  const cached = sweepHulls(oldA, nextA, oldB, nextB, {
    getOldGeometry: () => {
      queries++;
      return geometry;
    },
    onOverlap: () => cachedOverlap++,
  });
  assert.deepEqual(cached, direct);
  assert.equal(cachedOverlap, directOverlap);
  assert.equal(queries, 1);
  return { contact: cached, overlap: cachedOverlap };
}

test("cached OLD pair preparation preserves crossing and tangential feature selection", () => {
  const oldA = at(v(-0.75)),
    oldB = at(v(0.75)),
    geometry = freezeGeometry(collectPairOldGeometry(oldA, oldB));
  const crossing = compare(oldA, at(v(-0.25)), oldB, at(v(0.25)), geometry);
  assert.ok(crossing.contact);
  assert.equal(crossing.contact.points.length, 4);
  assert.ok(crossing.contact.pointNormals.every((normal) => normal.x === -1));
  const tangential = compare(
    oldA,
    at(v(-0.75, 2)),
    oldB,
    at(v(0.75, -2)),
    geometry,
  );
  assert.equal(tangential.contact, null);
});

test("one frozen OLD record remains exact across changing NEXT poses and rotations", () => {
  const rotations = [
    [new Quaternion(), new Quaternion()],
    [
      new Quaternion().setFromAxisAngle(v(0, 1), 0.4),
      new Quaternion().setFromAxisAngle(v(0, 0, 1), -0.3),
    ],
    [
      new Quaternion().setFromAxisAngle(v(1, 0, 0), 0.7),
      new Quaternion().setFromAxisAngle(v(0, 1), Math.PI / 2),
    ],
  ];
  for (const [rotationA, rotationB] of rotations) {
    const oldA = at(v(-0.8, 0.1, 0.05), rotationA),
      oldB = at(v(0.8, -0.1, -0.05), rotationB),
      geometry = freezeGeometry(collectPairOldGeometry(oldA, oldB));
    for (const distance of [0.7, 0.45, 0.1, -0.3]) {
      const nextA = at(
          v(-distance, 0.05, 0.15),
          new Quaternion().setFromAxisAngle(v(0, 1), distance),
        ),
        nextB = at(
          v(distance, -0.05, -0.15),
          new Quaternion().setFromAxisAngle(v(0, 0, 1), -distance),
        );
      compare(oldA, nextA, oldB, nextB, geometry);
    }
  }
});

test("OLD-inside flags replay overlap notifications on every normal emission", () => {
  const oldA = at(v(-0.45)),
    oldB = at(v(0.45)),
    geometry = freezeGeometry(collectPairOldGeometry(oldA, oldB));
  assert.ok(geometry.aToB.inside.some(Boolean));
  assert.ok(geometry.bToA.inside.some(Boolean));
  for (const next of [0.4, 0.6, 1]) {
    const result = compare(oldA, at(v(-next)), oldB, at(v(next)), geometry);
    assert.equal(result.overlap, 2);
  }
});

test("solver contact mutations cannot affect cached OLD target-local vectors", () => {
  const oldA = at(v(-0.75)),
    oldB = at(v(0.75)),
    nextA = at(v(-0.25)),
    nextB = at(v(0.25)),
    geometry = freezeGeometry(collectPairOldGeometry(oldA, oldB)),
    first = compare(oldA, nextA, oldB, nextB, geometry).contact;
  assert.ok(first);
  first.normal.set(0, 0, 0);
  for (const point of first.points) point.set(10, 20, 30);
  for (const point of first.pointsB) point.set(-10, -20, -30);
  for (const normal of first.pointNormals) normal.set(0, 0, 0);
  assert.ok(compare(oldA, nextA, oldB, nextB, geometry).contact);
});

test("successful OLD recovery returns before requesting ordinary OLD preparation", () => {
  const oldA = at(v(-0.45)),
    oldB = at(v(0.45));
  const body = (hull, velocity) => ({
    state: {
      position: hull.position,
      orientation: hull.orientation,
      velocity,
      angularVelocity: v(),
    },
    properties: {
      mass: 1,
      inertia: v(1, 1, 1),
      centerOfMass: v(),
      worldFriction: 0,
    },
  });
  const a = body(oldA, v(1)),
    b = body(oldB, v(-1));
  let overlap = 0;
  const contact = sweepHulls(oldA, at(v(-0.4)), oldB, at(v(0.4)), {
    recovery: { a, b },
    getOldGeometry: () => assert.fail("recovery must not prepare ordinary CCD"),
    onOverlap: () => overlap++,
  });
  assert.ok(contact);
  assert.equal(overlap, 1);
});
