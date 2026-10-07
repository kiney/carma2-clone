import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { advanceRigidBody } from "../src/physics/integrate.ts";
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const near = (a, b, t = 1e-8) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
const body = (omega = v(), inertia = v(1, 2, 3), com = v(0.2, 0.1, -0.3)) => ({
  state: {
    position: v(),
    orientation: new Quaternion(),
    velocity: v(),
    angularVelocity: omega,
  },
  properties: { mass: 1, inertia, centerOfMass: com, worldFriction: 0.4 },
});
const momentum = (b) =>
  b.state.angularVelocity
    .clone()
    .applyQuaternion(b.state.orientation.clone().invert())
    .multiply(b.properties.inertia)
    .applyQuaternion(b.state.orientation);
const com = (b) =>
  b.properties.centerOfMass
    .clone()
    .applyQuaternion(b.state.orientation)
    .add(b.state.position);

test("source first order rotation quantizes angle and preserves COM", () => {
  const b = body(v(0, 1, 0));
  const c = com(b);
  advanceRigidBody(b, 0.04);
  const angle = (Math.trunc(0.04 * 10430.378350470453) * 2 * Math.PI) / 65536;
  near(
    b.state.orientation.angleTo(
      new Quaternion().setFromAxisAngle(v(0, 1), angle),
    ),
    0,
    1e-7,
  );
  near(com(b).distanceTo(c), 0);
});
test("source first order and midpoint high-angle steps preserve world angular momentum", () => {
  for (const rate of [1, 20]) {
    const b = body(v(rate, rate * 0.8, rate * 0.6));
    const l = momentum(b),
      w = b.state.angularVelocity.clone();
    advanceRigidBody(b, 0.04);
    near(momentum(b).distanceTo(l), 0, 1e-7);
    assert.ok(b.state.angularVelocity.distanceTo(w) > 1e-5);
  }
});
test("candidate transform retains velocities and matches committed integration", () => {
  const b = body(v(10, 3, 7));
  b.state.velocity.set(1, -2, 3);
  const oldPosition = b.state.position.clone(),
    oldOrientation = b.state.orientation.clone(),
    oldOmega = b.state.angularVelocity.clone();
  advanceRigidBody(b, 0.04, true);
  near(b.state.position.distanceTo(oldPosition), 0);
  near(b.state.orientation.angleTo(oldOrientation), 0, 1e-7);
  near(b.state.angularVelocity.distanceTo(oldOmega), 0);
  const position = b.state.predictedPosition.clone(),
    orientation = b.state.predictedOrientation.clone();
  advanceRigidBody(b, 0.04);
  near(b.state.position.distanceTo(position), 0);
  near(b.state.orientation.angleTo(orientation), 0, 1e-7);
  near(com(b).distanceTo(v(0.2 + 0.04, 0.1 - 0.08, -0.3 + 0.12)), 0);
});
test("small-angle skip retains orientation and rotation lock retains transform orientation", () => {
  const b = body(v(0.0001, 0, 0));
  const original = b.state.orientation.clone();
  advanceRigidBody(b, 0.04);
  near(b.state.orientation.angleTo(original), 0, 1e-7);
  const locked = body(v(20, 10, 3));
  locked.properties.rotationLocked = true;
  locked.state.velocity.set(1, 0, 0);
  advanceRigidBody(locked, 0.04);
  near(locked.state.orientation.angleTo(new Quaternion()), 0, 1e-7);
  near(locked.state.position.x, 0.04);
});
