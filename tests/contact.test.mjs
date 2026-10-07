import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  applyImpulse,
  pointVelocity,
  resolveContacts,
} from "../src/physics/contact.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} != ${expected}`,
  );
const body = (mass = 1, velocity = v()) => ({
  state: {
    position: v(),
    orientation: new Quaternion(),
    velocity,
    angularVelocity: v(),
  },
  properties: {
    mass,
    inertia: v(mass, mass, mass),
    centerOfMass: v(),
    objectFriction: 0.4,
    worldFriction: 0.4,
  },
});
const energy = (b) => {
  const omega = b.state.angularVelocity
    .clone()
    .applyQuaternion(b.state.orientation.clone().conjugate());
  return (
    0.5 * b.properties.mass * b.state.velocity.lengthSq() +
    0.5 *
      (omega.x ** 2 * b.properties.inertia.x +
        omega.y ** 2 * b.properties.inertia.y +
        omega.z ** 2 * b.properties.inertia.z)
  );
};
const contact = (a, point, normal, b) => ({ a, b, point, normal });

test("center plane impulse follows original impact bias and tiny rebound", () => {
  const a = body(2, v(0, -10));
  const [impact] = resolveContacts([contact(a, v(), v(0, 1))]);
  near(impact.normalImpulse, 20.04);
  near(impact.closingSpeed, 10);
  near(a.state.velocity.y, 0.02);
  near(a.state.angularVelocity.length(), 0);
});

test("equal and unequal mass head-on impacts conserve total momentum", () => {
  for (const [ma, mb] of [
    [1, 1],
    [1, 20],
    [20, 1],
  ]) {
    const a = body(ma, v(3)),
      b = body(mb, v(-2));
    const [impact] = resolveContacts([contact(a, v(), v(-1), b)]);
    const expected = 5.015 / (1 / ma + 1 / mb);
    near(impact.normalImpulse, expected);
    near(ma * a.state.velocity.x + mb * b.state.velocity.x, ma * 3 - mb * 2);
    near(b.state.velocity.x - a.state.velocity.x, 0.015);
  }
});

test("off-center side, rear and corner impulses include lever-arm torque", () => {
  for (const [point, normal, velocity] of [
    [v(0, 0, 2), v(-1), v(3)],
    [v(2, 0, 0), v(0, 0, 1), v(0, 0, -3)],
    [v(1, 0, 1), v(-1), v(3)],
  ]) {
    const a = body(2, velocity);
    a.properties.inertia.set(2, 4, 6);
    const torque = point.clone().cross(normal);
    const inverseMass =
      0.5 + torque.x ** 2 / 2 + torque.y ** 2 / 4 + torque.z ** 2 / 6;
    const [impact] = resolveContacts([
      { ...contact(a, point, normal), faceFriction: 0 },
    ]);
    near(impact.normalImpulse, 3.013 / inverseMass);
    near(a.state.angularVelocity.y, (torque.y * impact.normalImpulse) / 4);
    near(pointVelocity(a.state, a.properties, point).dot(normal), 0.013);
  }
});

test("rotated diagonal inertia and displaced COM determine the impulse response", () => {
  const a = body(2);
  a.state.position.set(8, 0, 0);
  a.state.orientation.setFromAxisAngle(v(0, 0, 1), Math.PI / 2);
  a.properties.centerOfMass.set(1, 0, 0);
  a.properties.inertia.set(2, 4, 8);
  // COM is (8,1,0); world torque (0,2,0) maps to local torque (2,0,0).
  applyImpulse(a.state, a.properties, v(8, 1, 2), v(1));
  near(a.state.velocity.x, 0.5);
  near(a.state.angularVelocity.y, 1);
  near(pointVelocity(a.state, a.properties, v(8, 1, 2)).x, 2.5);
  const central = body(2);
  central.properties.centerOfMass.set(0, 1, 0);
  applyImpulse(central.state, central.properties, v(0, 1), v(2));
  near(central.state.angularVelocity.length(), 0);
});

test("coupled two-contact plane manifold preserves symmetry and avoids double impulse", () => {
  const a = body(2, v(0, -4));
  const contacts = [-1, 1].map((x) => ({
    ...contact(a, v(x, 0), v(0, 1)),
    faceFriction: 0,
  }));
  const result = resolveContacts(contacts);
  near(result[0].normalImpulse, 4.014);
  near(result[1].normalImpulse, 4.014);
  near(a.state.angularVelocity.length(), 0);
  near(a.state.velocity.y, 0.014);
  const reversed = body(2, v(0, -4));
  resolveContacts(
    contacts
      .slice()
      .reverse()
      .map((c) => ({ ...c, a: reversed })),
  );
  near(reversed.state.velocity.y, a.state.velocity.y);
});

test("redundant four-corner manifold remains finite and preserves aggregate symmetry", () => {
  const a = body(2, v(0, -4));
  const result = resolveContacts(
    [-1, 1].flatMap((x) =>
      [-1, 1].map((z) => ({
        ...contact(a, v(x, 0, z), v(0, 1)),
        faceFriction: 0,
      })),
    ),
  );
  assert.ok(
    result.every(
      (r) => Number.isFinite(r.normalImpulse) && r.normalImpulse >= 0,
    ),
  );
  near(
    result.reduce((sum, r) => sum + r.normalImpulse, 0),
    8.028,
  );
  near(a.state.angularVelocity.length(), 0);
});

test("inactive coupled contact gets no attractive impulse", () => {
  const a = body(1, v(0, -1));
  a.state.angularVelocity.z = 2;
  const result = resolveContacts(
    [0, 1].map((x) => ({
      ...contact(a, v(x, 0), v(0, 1)),
      faceFriction: 0,
    })),
  );
  assert.ok(result.every((r) => r.normalImpulse >= 0));
  near(result[1].normalImpulse, 0);
  assert.ok(pointVelocity(a.state, a.properties, v(1)).y > 0);
});

test("object friction uses original product cap and conserves momentum", () => {
  const a = body(2, v(5, -1)),
    b = body(3, v(-4, 1));
  a.properties.objectFriction = 0.2;
  b.properties.objectFriction = 0.6;
  const initial = energy(a) + energy(b);
  const momentum = a.state.velocity
    .clone()
    .multiplyScalar(2)
    .addScaledVector(b.state.velocity, 3);
  const [impact] = resolveContacts([contact(a, v(), v(0, 1), b)]);
  near(impact.tangentImpulse.length(), 0.35 * impact.normalImpulse * 1.2 * 1.6);
  const after = a.state.velocity
    .clone()
    .multiplyScalar(2)
    .addScaledVector(b.state.velocity, 3);
  near(after.distanceTo(momentum), 0);
  assert.ok(energy(a) + energy(b) < initial);
});

test("world friction is limited by face material and stops without reversing slip", () => {
  const a = body(2, v(8, -2));
  a.properties.worldFriction = 0.8;
  const [impact] = resolveContacts([
    { ...contact(a, v(), v(0, 1)), faceFriction: 0.5 },
  ]);
  near(impact.tangentImpulse.length(), 0.35 * impact.normalImpulse * 1.8 * 0.5);
  const slow = body(2, v(0.1, -2));
  resolveContacts([contact(slow, v(), v(0, 1))]);
  near(slow.state.velocity.x, 0);
  const locked = body(2, v(0, -2));
  locked.properties.rotationLocked = true;
  resolveContacts([contact(locked, v(1), v(0, 1))]);
  near(locked.state.angularVelocity.length(), 0);
});

test("resting world branch measures predicted drift with original fixed 25 factor", () => {
  const a = body(2);
  a.state.predictedPosition = v(0, -0.02);
  const [impact] = resolveContacts([contact(a, v(), v(0, 1))], 1 / 120);
  near(impact.normalImpulse, 1.02);
  near(a.state.velocity.y, 0.51);
  near(a.state.position.y, 0);
  near(a.state.predictedPosition.y, -0.02);
  const separating = body(2);
  separating.state.predictedPosition = v(0, 0.02);
  const [minimum] = resolveContacts([contact(separating, v(), v(0, 1))]);
  near(minimum.normalImpulse, 0.02);
});

test("resting body pair uses relative transforms and shared translation cancels", () => {
  const a = body(2),
    b = body(2);
  a.state.predictedPosition = v(0, -0.02);
  b.state.predictedPosition = v(0, 0.01);
  const [impact] = resolveContacts([contact(a, v(), v(0, 1), b)]);
  near(impact.normalImpulse, 0.75);
  const c = body(2),
    d = body(2);
  c.state.predictedPosition = v(5, -2, 1);
  d.state.predictedPosition = v(5, -2, 1);
  const [shared] = resolveContacts([contact(c, v(), v(0, 1), d)]);
  near(shared.normalImpulse, 0.01);
});

test("resting angular drift transforms the local contact point around actor origin", () => {
  const a = body(2);
  a.state.predictedOrientation = new Quaternion().setFromAxisAngle(
    v(0, 0, 1),
    -0.01,
  );
  const [impact] = resolveContacts([
    { ...contact(a, v(1), v(0, 1)), faceFriction: 0 },
  ]);
  // Effective inverse mass is 1, and predicted y = -sin(0.01).
  near(impact.normalImpulse, 0.01 + 25 * Math.sin(0.01));
});

test("impact branch selection applies to the whole connected group", () => {
  const a = body(1, v(0, -1)),
    b = body(1);
  b.state.predictedPosition = v(0, -0.2);
  const result = resolveContacts([
    { ...contact(a, v(), v(0, 1)), faceFriction: 0 },
    { ...contact(b, v(), v(0, 1)), faceFriction: 0 },
  ]);
  near(result[0].normalImpulse, 1.011);
  near(result[1].normalImpulse, 0.01);
  assert.deepEqual(resolveContacts([]), []);
});
