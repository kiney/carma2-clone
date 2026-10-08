import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { buildHull } from "../src/physics/geometry.ts";
import { pointVelocity, resolveContacts } from "../src/physics/contact.ts";
import {
  commitMovingWorldPose,
  createMovingWorldBody,
  prepareMovingWorldPose,
  sweepHullMovingTriangle,
} from "../src/physics/moving-world.ts";

function rigid(position = [0, 0, 0]) {
  return {
    state: {
      position: new THREE.Vector3(...position),
      orientation: new THREE.Quaternion(),
      velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(),
    },
    properties: {
      mass: 2, inertia: new THREE.Vector3(1, 1, 1), centerOfMass: new THREE.Vector3(), worldFriction: 0,
    },
  };
}
const cube = buildHull([
  new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, -0.5, -0.5),
  new THREE.Vector3(0.5, 0.5, -0.5), new THREE.Vector3(-0.5, 0.5, -0.5),
  new THREE.Vector3(-0.5, -0.5, 0.5), new THREE.Vector3(0.5, -0.5, 0.5),
  new THREE.Vector3(0.5, 0.5, 0.5), new THREE.Vector3(-0.5, 0.5, 0.5),
]);
function horizontal(owner) {
  return { owner, a: new THREE.Vector3(-4, 0, -4), b: new THREE.Vector3(0, 0, 4), c: new THREE.Vector3(4, 0, -4), twoSided: true };
}
function verticalX(owner, x = 0, span = 4) {
  return { owner,
    a: new THREE.Vector3(x, -span, -span),
    b: new THREE.Vector3(x, span, -span),
    c: new THREE.Vector3(x, 0, span), twoSided: true,
  };
}

test("lifting finite triangle catches a stationary hull in relative actor frames", () => {
  const actor = new THREE.Group(), world = createMovingWorldBody(actor), car = rigid([0, 1.5, 0]);
  prepareMovingWorldPose(world, new THREE.Vector3(0, 2, 0), new THREE.Quaternion(), 1);
  const hit = sweepHullMovingTriangle(car, cube, horizontal(world));
  assert.ok(hit);
  assert.ok(hit.points.length > 0);
  assert.equal(hit.pointsB.length, hit.points.length);
  assert.ok(hit.normal.y > 0.9);
  assert.equal(world.properties.immovable, true);
  commitMovingWorldPose(world);
  assert.equal(world.state.position.y, 2);
});

test("a translating wall supplies moving-surface velocity to the existing impact solve", () => {
  const actor = new THREE.Group(); actor.position.x = 2;
  const wall = createMovingWorldBody(actor), car = rigid();
  prepareMovingWorldPose(wall, new THREE.Vector3(-1, 0, 0), new THREE.Quaternion(), 1);
  const hit = sweepHullMovingTriangle(car, cube, verticalX(wall));
  assert.ok(hit, "wall crosses the car's finite hull");
  const contact = {
    a: car, b: wall, point: hit.points[0], pointB: hit.pointsB[0], normal: hit.normal,
  };
  const impacts = resolveContacts([contact]);
  assert.ok(impacts[0].normalImpulse > 0);
  assert.ok(car.state.velocity.x < 0);
  assert.equal(wall.state.velocity.x, -3);
  assert.deepEqual(wall.state.angularVelocity.toArray(), [0, 0, 0]);
  assert.equal(wall.properties.immovable, true);
  const delivered = impacts[0].normal.clone().multiplyScalar(impacts[0].normalImpulse).add(impacts[0].tangentImpulse);
  assert.ok(car.state.velocity.clone().multiplyScalar(car.properties.mass).distanceTo(delivered) < 1e-6);
});

test("rotating kinematic pose derives angular point velocity and sweeps an authored triangle", () => {
  const actor = new THREE.Group(), wall = createMovingWorldBody(actor), car = rigid([1, 0, 3]);
  const target = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
  prepareMovingWorldPose(wall, new THREE.Vector3(), target, 1);
  const velocity = pointVelocity(wall.state, wall.properties, new THREE.Vector3(1, 0, 0));
  assert.ok(Math.abs(velocity.z - Math.PI / 2) < 1e-6);
  assert.ok(sweepHullMovingTriangle(car, cube, verticalX(wall, 2)));
});

test("finite triangle bounds reject a moving actor that remains separated", () => {
  const actor = new THREE.Group(), wall = createMovingWorldBody(actor), car = rigid();
  prepareMovingWorldPose(wall, new THREE.Vector3(0.1, 0, 0), new THREE.Quaternion(), 1);
  assert.equal(sweepHullMovingTriangle(car, cube, verticalX(wall, 10, 0.1)), null);
});
