import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  createBallJoint,
  createHingeJoint,
  createSdbHingeJoint,
  buildQuickHingeConstraints,
  projectQuickHingeVelocities,
} from "../src/physics/joint.ts";
import { kevFlapTearThreshold } from "../src/physics/attachment.ts";
import {
  applyImpulse,
  pointVelocity,
  resolveContactGroups,
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

test("candidate car contacts retain independent A and B solver-frame levers", () => {
  const a = body(2, v(0, -3)),
    b = body(3);
  a.properties.objectFriction = -1;
  const point = v(1),
    pointB = v(-2);
  const [impact] = resolveContacts([
    { ...contact(a, point, v(0, 1), b), pointB },
  ]);
  const inverseMass = 1 / 2 + 1 / 3 + 1 / 2 + 4 / 3;
  near(impact.normalImpulse, 3.013 / inverseMass);
  near(a.state.angularVelocity.z, impact.normalImpulse / 2);
  near(b.state.angularVelocity.z, (2 * impact.normalImpulse) / 3);
  assert.ok(impact.pointB !== pointB);
});

test("independent B lever contributes angular closing speed and pair rest drift", () => {
  const a = body(),
    b = body();
  a.properties.objectFriction = -1;
  b.state.angularVelocity.z = 2;
  const [impact] = resolveContacts([
    { ...contact(a, v(), v(0, 1), b), pointB: v(2) },
  ]);
  near(impact.closingSpeed, 4);
  const c = body(),
    d = body();
  c.state.predictedPosition = v(0, -0.02);
  d.state.predictedPosition = v(0, 0.01);
  const [rest] = resolveContacts([
    { ...contact(c, v(1), v(0, 1), d), pointB: v(-2) },
  ]);
  near(rest.normalImpulse, 0.75 / 7);
});

test("contact and attached-body anchor rows share one coupled matrix", () => {
  const parent = body(2, v(0, -3)),
    child = body(1, v(0, -3));
  const joint = createBallJoint(child, parent, v(), v());
  const [impact] = resolveContacts(
    [{ ...contact(parent, v(), v(0, 1)), faceFriction: 0 }],
    0.04,
    [joint],
  );
  near(impact.normalImpulse, 3 * 3.013);
  near(parent.state.velocity.y, 0.013);
  near(child.state.velocity.y, 0.013);
});

test("off-center contact torque is coupled to a hinge's forbidden rotation", () => {
  const parent = body(1, v(0, -2)),
    child = body(1, v(0, -2));
  const joint = createHingeJoint(child, parent, v(), v(), v(0, 1), v(0, 1));
  const [impact] = resolveContacts(
    [{ ...contact(child, v(1), v(0, 1)), faceFriction: 0 }],
    0.04,
    [joint],
  );
  near(child.state.angularVelocity.z, parent.state.angularVelocity.z);
  near(child.state.velocity.y, parent.state.velocity.y);
  near(pointVelocity(child.state, child.properties, v(1)).y, 0.012);
  assert.ok(impact.normalImpulse > 0);
});

test("mixed contact solve keeps negative bilateral reactions instead of clamping them", () => {
  const parent = body(),
    child = body();
  child.state.velocity.set(3, -2);
  resolveContacts([], 0.04, [createBallJoint(child, parent, v(), v())]);
  near(parent.state.velocity.x, 1.5);
  near(child.state.velocity.x, 1.5);
  near(parent.state.velocity.y, -1);
  near(child.state.velocity.y, -1);
});

test("world body-vertex slip uses the original .995 lever without changing torque mass", () => {
  const a = body(1, v(0, -1));
  a.state.angularVelocity.set(0, 0.2, 2);
  a.properties.worldFriction = 0;
  const [impact] = resolveContacts([
    { ...contact(a, v(0, 1), v(0, 1)), sourceType: 1, faceFriction: 100 },
  ]);
  near(impact.tangentImpulse.x, 1 - 0.004999999888241291);
  near(a.state.angularVelocity.z, 1 + 0.004999999888241291);
});

test("friction transports solver-local COM slip through the candidate actor orientation", () => {
  const a = body(1, v(2, -1));
  a.properties.worldFriction = 0;
  a.state.predictedOrientation = new Quaternion().setFromAxisAngle(
    v(0, 1),
    0.2,
  );
  const [impact] = resolveContacts([
    { ...contact(a, v(), v(0, 1)), faceFriction: 100 },
  ]);
  const expected = v(-2).applyQuaternion(a.state.predictedOrientation);
  near(impact.tangentImpulse.distanceTo(expected), 0);
  near(a.state.velocity.x, 2 + expected.x);
  near(a.state.velocity.z, expected.z);
});

test("slow world rolling mode removes normal spin and switches to linear COM friction", () => {
  const a = body(1, v(0.02, -0.01));
  a.state.angularVelocity.set(0, 0.05, 2);
  a.properties.worldFriction = 0;
  resolveContacts([{ ...contact(a, v(0, 1), v(0, 1)), faceFriction: 100 }]);
  near(a.state.angularVelocity.y, 0);
  near(a.state.angularVelocity.z, 2);
  near(a.state.velocity.length(), 0);
});

test("pre-application callback sees solved impulses and untouched body velocities", () => {
  const a = body(2, v(3, -2));
  const [impact] = resolveContacts(
    [{ ...contact(a, v(), v(0, 1)), faceFriction: 100 }],
    0.04,
    [],
    (impacts) => {
      near(a.state.velocity.distanceTo(v(3, -2)), 0);
      near(impacts[0].normalImpulse, 4.024);
      near(impacts[0].tangentImpulse.length(), 0);
      impacts[0].normalImpulse = 2;
    },
  );
  near(impact.normalImpulse, 2);
  near(a.state.velocity.y, -1);
  assert.ok(impact.tangentImpulse.x < 0);
});

test("disabled callback rows skip normal, friction and angular speed limiting", () => {
  const a = body(1, v(3, -2)),
    b = body();
  a.state.angularVelocity.set(100, 0, 0);
  const omega = a.state.angularVelocity.clone();
  resolveContacts([contact(a, v(), v(0, 1), b)], 0.04, [], (impacts) => {
    impacts[0].sourceType = 9;
  });
  near(a.state.velocity.distanceTo(v(3, -2)), 0);
  near(a.state.angularVelocity.distanceTo(omega), 0);
  near(b.state.velocity.length(), 0);
});

test("restart callback suppresses the whole contact and bilateral joint solve", () => {
  const parent = body(),
    child = body(1, v(3, -2));
  const joint = createBallJoint(child, parent, v(), v());
  resolveContacts([contact(child, v(), v(0, 1))], 0.04, [joint], () => false);
  near(parent.state.velocity.length(), 0);
  near(child.state.velocity.distanceTo(v(3, -2)), 0);
});

test("callback mass and inertia changes retain the pre-callback torque lever", () => {
  const a = body(2, v(0, -2));
  resolveContacts(
    [{ ...contact(a, v(1), v(0, 1)), faceFriction: 0 }],
    0.04,
    [],
    (impacts) => {
      a.properties.mass = 1;
      a.properties.inertia.set(1, 1, 1);
      a.properties.centerOfMass.set(0.5, 0, 0);
      impacts[0].normalImpulse = 1;
    },
  );
  near(a.state.velocity.y, -1);
  near(a.state.angularVelocity.z, 1);
});

test("disconnected world contacts choose impact and resting branches independently", () => {
  const falling = body(1, v(0, -2)),
    resting = body();
  resting.state.predictedPosition = v(0, -0.002);
  const groups = [];
  const impacts = resolveContactGroups(
    [contact(falling, v(), v(0, 1)), contact(resting, v(), v(0, 1))],
    0.04,
    [],
    (rows) => groups.push(rows.map((row) => row.a)),
  );
  assert.equal(groups.length, 2);
  near(impacts[0].normalImpulse, 2.012);
  near(impacts[1].normalImpulse, 0.06);
});

test("joints and object contacts connect groups while shared state wrappers retain identity", () => {
  const parent = body(),
    child = body(1, v(0, -2)),
    other = body();
  parent.properties.objectFriction = -1;
  const alias = { state: child.state, properties: child.properties };
  const groups = [];
  const input = [
    { ...contact(alias, v(), v(0, 1)), faceFriction: 0 },
    { ...contact(parent, v(), v(1), other), faceFriction: 0 },
  ];
  const impacts = resolveContactGroups(
    input,
    0.04,
    [createBallJoint(child, parent, v(), v())],
    (rows) => groups.push(rows),
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 2);
  assert.equal(impacts[0].a, alias);
  assert.equal(impacts[1].a, parent);
  near(child.state.velocity.y, parent.state.velocity.y);
});

function flapLimit() {
  const parent = body(),
    child = body(0.1);
  child.state.angularVelocity.set(0, 3, 0);
  child.state.predictedOrientation = new Quaternion().setFromAxisAngle(
    v(0, 1),
    0.01,
  );
  const joint = createBallJoint(child, parent, v(), v(), [
    { childDirection: v(1), parentNormal: v(0, 0, 1) },
  ]);
  joint.allowNearBoundary = true;
  return { parent, child, joint };
}

test("pre-application callback exposes source11 angular limits in child-local coordinates", () => {
  const { parent, child, joint } = flapLimit();
  child.state.orientation.setFromAxisAngle(v(0, 0, 1), Math.PI / 2);
  child.state.predictedOrientation
    .copy(child.state.orientation)
    .multiply(new Quaternion().setFromAxisAngle(v(0, 1), 0.01));
  child.state.angularVelocity.set(-3, 0, 0);
  let rows;
  resolveContacts([], 0.04, [joint], (contacts, joints) => {
    assert.equal(contacts.length, 0);
    rows = joints;
    near(child.state.angularVelocity.x, -3);
    return false;
  });
  assert.equal(rows.filter((row) => row.sourceType === 10).length, 3);
  const limit = rows.find((row) => row.sourceType === 11);
  assert.ok(limit);
  assert.equal(limit.a, child);
  assert.equal(limit.b, parent);
  assert.equal(limit.joint, joint);
  near(limit.angularConstraintLocal.distanceTo(v(0, -1)), 0);
  near(limit.parentAngularConstraintLocal.distanceTo(v(1)), 0);
  near(limit.normalImpulse, 3 / 11);
  near(limit.closingSpeed, 3);
  assert.equal(limit.rowIndex, 3);
});

test("source KEV tear gate can cap a solved row and restart before any joint reaction", () => {
  const { parent, child, joint } = flapLimit();
  const joints = [joint];
  let cap;
  resolveContacts([], 0.04, joints, (_, rows) => {
    const limit = rows.find((row) => row.sourceType === 11);
    cap = kevFlapTearThreshold({
      sourceType: limit.sourceType,
      impulse: limit.normalImpulse,
      childMass: child.properties.mass,
      angularConstraint: limit.angularConstraintLocal.toArray(),
      hingeAxis: [0, 1, 0],
      kevFlap: true,
      driver: 8,
      immune: false,
    });
    assert.equal(cap, 0.2);
    limit.normalImpulse = cap;
    for (const row of rows) row.sourceType = 9;
    joints.splice(0, 1);
    return false;
  });
  near(child.state.angularVelocity.y, 3);
  near(parent.state.angularVelocity.length(), 0);
  near(child.state.velocity.length(), 0);
  assert.equal(joints.length, 0);
});

test("mutable joint row impulses and type9 are honored by normal application", () => {
  for (const disabled of [false, true]) {
    const { parent, child, joint } = flapLimit();
    resolveContacts([], 0.04, [joint], (_, rows) => {
      const limit = rows.find((row) => row.sourceType === 11);
      limit.normalImpulse = 0.1;
      if (disabled) limit.sourceType = 9;
    });
    near(child.state.angularVelocity.y, disabled ? 3 : 2);
    near(parent.state.angularVelocity.y, disabled ? 0 : 0.1);
  }
});

test("quick hinge closing speed is measured after its hidden velocity projection", () => {
  const child = body(),
    parent = body();
  child.state.angularVelocity.x = 20;
  const joint = createSdbHingeJoint(child, parent, [v(), v(0, 1), v(1)], 1);
  joint.planeLimits = [];
  const [impact] = resolveContacts(
    [{ ...contact(child, v(0, 0, 1), v(0, 1)), faceFriction: 0 }],
    0.04,
    [joint],
  );
  near(impact.closingSpeed, 10);
  near(child.state.angularVelocity.x, parent.state.angularVelocity.x);
});

test("full hinge/contact response equals source three-hidden/two-explicit Schur elimination", () => {
  const child = body(2, v(1, -3, 0.2)),
    parent = body(7, v(-0.5, -1, 0.8));
  child.state.orientation.setFromAxisAngle(v(0, 1), 0.4);
  parent.state.orientation.setFromAxisAngle(v(1, 8, 2).normalize(), 0.3);
  child.state.angularVelocity.set(0.3, 0.5, -0.2);
  parent.state.angularVelocity.set(-0.2, 0.1, 0.4);
  child.properties.centerOfMass.set(0.1, -0.2, 0.05);
  parent.properties.centerOfMass.set(-0.3, 0.1, -0.2);
  child.properties.inertia.set(0.8, 1.7, 2.1);
  parent.properties.inertia.set(3.2, 4.4, 5.8);
  const joint = createSdbHingeJoint(
    child,
    parent,
    [v(0.4, -0.1, 0.2), v(0.4, 0.9, 0.2), v(1.4, -0.1, 0.2)],
    1,
  );
  joint.planeLimits = [];
  projectQuickHingeVelocities(joint);
  const hidden = buildQuickHingeConstraints(joint).map((row) => row.jacobians);
  const com = (b) =>
    b.properties.centerOfMass
      .clone()
      .applyQuaternion(b.state.orientation)
      .add(b.state.position);
  const anchor = (b) =>
    (b === child ? joint.childAnchor : joint.parentAnchor)
      .clone()
      .applyQuaternion(b.state.orientation)
      .add(b.state.position);
  const entry = (b, point, direction) => {
    const angular = point.clone().sub(com(b)).cross(direction);
    const response = angular
      .clone()
      .applyQuaternion(b.state.orientation.clone().conjugate())
      .divide(b.properties.inertia)
      .applyQuaternion(b.state.orientation);
    return { body: b, linear: direction.clone(), angular, response };
  };
  const normal = v(0, 1),
    point = com(child).add(v(-0.2, 0, 0.4));
  const explicit = [
    [entry(child, point, normal)],
    ...joint.hingeBasis.map((local) => {
      const axis = local.clone().applyQuaternion(child.state.orientation);
      return [
        entry(child, anchor(child), axis),
        entry(parent, anchor(parent), axis.clone().negate()),
      ];
    }),
  ];
  const k = (a, b) =>
    a.reduce(
      (sum, x) =>
        sum +
        b.reduce(
          (s, y) =>
            s +
            (x.body === y.body
              ? x.linear.dot(y.linear) / x.body.properties.mass +
                x.angular.dot(y.response)
              : 0),
          0,
        ),
      0,
    );
  const solve = (matrix, rhs) => {
    const rows = matrix.map((row, i) => [...row, rhs[i]]),
      n = rhs.length;
    for (let column = 0; column < n; column++) {
      let pivot = column;
      for (let i = column + 1; i < n; i++)
        if (Math.abs(rows[i][column]) > Math.abs(rows[pivot][column]))
          pivot = i;
      [rows[column], rows[pivot]] = [rows[pivot], rows[column]];
      const divisor = rows[column][column];
      for (let j = column; j <= n; j++) rows[column][j] /= divisor;
      for (let i = 0; i < n; i++)
        if (i !== column) {
          const scale = rows[i][column];
          for (let j = column; j <= n; j++)
            rows[i][j] -= scale * rows[column][j];
        }
    }
    return rows.map((row) => row[n]);
  };
  const B = hidden.map((a) => hidden.map((b) => k(a, b)));
  const hc = explicit.map((c) => hidden.map((h) => k(h, c)));
  const reactions = hc.map((column) => solve(B, column));
  const reduced = explicit.map((a, i) =>
    explicit.map(
      (b, j) =>
        k(a, b) -
        hc[i].reduce(
          (sum, value, index) => sum + value * reactions[j][index],
          0,
        ),
    ),
  );
  const speed = (row) =>
    row.reduce(
      (sum, x) =>
        sum +
        x.linear.dot(x.body.state.velocity) +
        x.angular.dot(x.body.state.angularVelocity),
      0,
    );
  const closing = -speed(explicit[0]);
  assert.ok(closing > 0.01);
  const lambda = solve(reduced, [
    0.01 + 1.001 * closing,
    ...explicit.slice(1).map((row) => -speed(row)),
  ]);
  assert.ok(lambda[0] > 0);
  const hiddenLambda = solve(
    B,
    hidden.map(
      (_, i) => -lambda.reduce((sum, value, j) => sum + hc[j][i] * value, 0),
    ),
  );
  const expected = new Map(
    [child, parent].map((b) => [
      b,
      {
        velocity: b.state.velocity.clone(),
        omega: b.state.angularVelocity.clone(),
      },
    ]),
  );
  const apply = (rows, values) =>
    rows.forEach((row, i) =>
      row.forEach((x) => {
        expected
          .get(x.body)
          .velocity.addScaledVector(
            x.linear,
            values[i] / x.body.properties.mass,
          );
        expected.get(x.body).omega.addScaledVector(x.response, values[i]);
      }),
    );
  apply(explicit, lambda);
  apply(hidden, hiddenLambda);
  const [impact] = resolveContacts(
    [{ ...contact(child, point, normal), faceFriction: 0 }],
    0.04,
    [joint],
  );
  near(impact.normalImpulse, lambda[0], 1e-8);
  for (const b of [child, parent]) {
    near(b.state.velocity.distanceTo(expected.get(b).velocity), 0, 1e-8);
    near(b.state.angularVelocity.distanceTo(expected.get(b).omega), 0, 1e-8);
  }
});

test("source friction remains a free body impulse after quick hinge normal coupling", () => {
  const child = body(1, v(0, -1, 2)),
    parent = body(1, v(0, -1, 2));
  const joint = createSdbHingeJoint(child, parent, [v(), v(0, 0, 1), v(1)], 1);
  joint.planeLimits = [];
  const [impact] = resolveContacts(
    [{ ...contact(child, v(), v(0, 1)), faceFriction: 10 }],
    0.04,
    [joint],
  );
  near(impact.normalImpulse, 2.022);
  near(child.state.velocity.z, 0);
  near(parent.state.velocity.z, 2);
  near(impact.tangentImpulse.z, -2);
});

test("camera acceptance marks zero impulse rows but excludes rejected solves and type9", () => {
  const a = body(1, v(0, 1, 0));
  const contact = { a, point: v(), normal: v(0, 1, 0) };
  const accepted = resolveContacts([contact], 0.04, [], (impacts) => {
    impacts[0].normalImpulse = 0;
  });
  assert.equal(accepted[0].normalImpulse, 0);
  assert.equal(accepted[0].solverAccepted, true);
  const rejected = resolveContacts([contact], 0.04, [], () => false);
  assert.equal(rejected[0].solverAccepted, undefined);
  const disabled = resolveContacts([{ ...contact, sourceType: 9 }]);
  assert.equal(disabled[0].solverAccepted, false);
});
