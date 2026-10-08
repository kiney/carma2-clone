import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { pointVelocity } from "../src/physics/contact.ts";
import {
  buildJointConstraints,
  buildQuickHingeConstraints,
  projectQuickHingeVelocities,
  prepareJointVelocities,
  selectQuickHinges,
  createBallJoint,
  createHingeJoint,
  createSdbBallJoint,
  createSdbHingeJoint,
  createOrdinaryDetachJoint,
  selectOrdinaryDetachGeometry,
  resolveJoints,
  projectJointPositions,
} from "../src/physics/joint.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const near = (a, b, tolerance = 1e-8) =>
  assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const body = (mass = 1) => ({
  state: {
    position: v(),
    orientation: new Quaternion(),
    velocity: v(),
    angularVelocity: v(),
  },
  properties: {
    mass,
    inertia: v(mass, mass, mass),
    centerOfMass: v(),
    objectFriction: 0.4,
    worldFriction: 0,
  },
});

test("ball anchor constraints are bilateral and conserve unequal-mass momentum", () => {
  const child = body(1),
    parent = body(4);
  child.state.velocity.set(5, -3, 2);
  const [reaction] = resolveJoints([createBallJoint(child, parent, v(), v())]);
  near(child.state.velocity.distanceTo(parent.state.velocity), 0);
  near(child.state.velocity.x, 1);
  near(child.state.velocity.y, -0.6);
  near(child.state.velocity.z, 0.4);
  near(reaction.linearImpulse.x, -4);
  near(reaction.linearImpulse.y, 2.4);
});

test("ball joint keeps its three rotational freedoms", () => {
  const child = body(),
    parent = body();
  child.state.angularVelocity.set(1, 2, 3);
  const result = resolveJoints([createBallJoint(child, parent, v(), v())]);
  near(child.state.angularVelocity.distanceTo(v(1, 2, 3)), 0);
  near(parent.state.angularVelocity.length(), 0);
  near(result[0].linearImpulse.length(), 0);
});

test("hinge shares forbidden angular motion and preserves free-axis rotation", () => {
  const child = body(),
    parent = body();
  child.state.angularVelocity.set(2, 4, 6);
  resolveJoints([
    createHingeJoint(child, parent, v(), v(), v(0, 0, 1), v(0, 0, 1)),
  ]);
  near(child.state.angularVelocity.x, 1);
  near(parent.state.angularVelocity.x, 1);
  near(child.state.angularVelocity.y, 2);
  near(parent.state.angularVelocity.y, 2);
  near(child.state.angularVelocity.z, 6);
  near(parent.state.angularVelocity.z, 0);
});

test("off-center anchor solve includes coupled mass and inertia response", () => {
  const child = body(),
    parent = body(3);
  child.state.position.set(2, 0, 0);
  child.state.velocity.set(0, -2, 1);
  const joint = createBallJoint(child, parent, v(-1), v(1));
  resolveJoints([joint]);
  const point = v(1);
  near(
    pointVelocity(child.state, child.properties, point).distanceTo(
      pointVelocity(parent.state, parent.properties, point),
    ),
    0,
  );
  near(child.state.velocity.y + 3 * parent.state.velocity.y, -2);
  near(child.state.velocity.z + 3 * parent.state.velocity.z, 1);
  assert.ok(child.state.angularVelocity.length() > 0);
});

test("multiple attached children are solved together without order-dependent parent momentum", () => {
  const a = body(),
    b = body(),
    parent = body(2);
  a.state.velocity.x = 4;
  b.state.velocity.x = -2;
  resolveJoints([
    createBallJoint(a, parent, v(), v()),
    createBallJoint(b, parent, v(), v()),
  ]);
  near(a.state.velocity.x, 0.5);
  near(b.state.velocity.x, 0.5);
  near(parent.state.velocity.x, 0.5);
});

test("angular plane limit stops crossing without blocking allowed rotation", () => {
  const child = body(),
    parent = body();
  child.state.angularVelocity.z = -1;
  child.state.predictedOrientation = new Quaternion().setFromAxisAngle(
    v(0, 0, 1),
    -0.04,
  );
  const limits = [
    { childDirection: v(1, 0.01).normalize(), parentNormal: v(0, 1) },
  ];
  const [reaction] = resolveJoints([
    createBallJoint(child, parent, v(), v(), limits),
  ]);
  near(child.state.angularVelocity.z - parent.state.angularVelocity.z, 0);
  assert.ok(reaction.angularImpulse.z > 0);
  const allowed = body();
  allowed.state.angularVelocity.z = 1;
  allowed.state.predictedOrientation = new Quaternion().setFromAxisAngle(
    v(0, 0, 1),
    0.04,
  );
  resolveJoints([createBallJoint(allowed, body(), v(), v(), limits)]);
  near(allowed.state.angularVelocity.z, 1);
});

test("resting angular limit uses original .001 margin and transform drift factor25", () => {
  const child = body(),
    parent = body();
  const direction = v(1, 0.0011).normalize();
  child.state.predictedOrientation = new Quaternion().setFromAxisAngle(
    v(0, 0, 1),
    -0.001,
  );
  const before = direction.y;
  const after = direction
    .clone()
    .applyQuaternion(child.state.predictedOrientation).y;
  resolveJoints([
    createBallJoint(child, parent, v(), v(), [
      { childDirection: direction, parentNormal: v(0, 1) },
    ]),
  ]);
  near(
    child.state.angularVelocity.z - parent.state.angularVelocity.z,
    25 * (0.001 - (after - before)),
  );
});

test("actor integration projects anchors exactly while retaining hinge angle", () => {
  const child = body(),
    parent = body();
  parent.state.position.set(10, 2, -1);
  parent.state.orientation.setFromAxisAngle(v(0, 1), 0.3);
  child.state.orientation.setFromAxisAngle(v(0, 1), 1);
  const joint = createHingeJoint(child, parent, v(-1), v(1), v(0, 1), v(0, 1));
  projectJointPositions([joint]);
  const childAnchor = joint.childAnchor
    .clone()
    .applyQuaternion(child.state.orientation)
    .add(child.state.position);
  const parentAnchor = joint.parentAnchor
    .clone()
    .applyQuaternion(parent.state.orientation)
    .add(parent.state.position);
  near(childAnchor.distanceTo(parentAnchor), 0);
  near(
    child.state.orientation.angleTo(
      new Quaternion().setFromAxisAngle(v(0, 1), 1),
    ),
    0,
  );
});

test("SDB setup uses authored anchor and original plane-normal .01 bias", () => {
  const child = body(),
    parent = body();
  child.state.position.set(1, 2, 3);
  const ball = createSdbBallJoint(child, parent, [v(), v(1), v(0, 1)]);
  near(ball.parentAnchor.distanceTo(v(1, 2, 3)), 0);
  assert.equal(ball.planeLimits.length, 2);
  near(ball.planeLimits[0].parentNormal.x, 0.01 / Math.sqrt(1.0002));
  near(ball.planeLimits[0].parentNormal.z, 1 / Math.sqrt(1.0002));
  const hinge = createSdbHingeJoint(
    child,
    parent,
    [v(), v(0, 1), v(0, 0, 1)],
    Math.PI / 2,
  );
  assert.equal(hinge.type, "hinge");
  near(hinge.childAxis.y, 1);
  near(hinge.planeLimits[0].childDirection.x, 0.01 / Math.sqrt(1.0001));
  assert.deepEqual(resolveJoints([]), []);
});

test("ordinary detach uses nearest car-plane corner then nearest authored vertex", () => {
  const vertices = [
    v(-0.8, -0.3, -0.5),
    v(-0.7, 0.2, 0.5),
    v(-0.2, 0.2, -0.5),
    v(-0.2, -0.3, 0.5),
  ];
  const geometry = selectOrdinaryDetachGeometry(
    vertices,
    v(-1, -0.4, -1),
    v(1, 1, 1),
  );
  assert.deepEqual(geometry, { vertexIndex: 0, cornerBits: 0, side: 0 });
  const child = body(),
    parent = body();
  child.state.position.x = 1;
  const joint = createOrdinaryDetachJoint(child, parent, vertices, geometry);
  near(joint.childAnchor.distanceTo(vertices[0]), 0);
  near(joint.parentAnchor.x, 0.2);
  near(joint.planeLimits[0].parentNormal.x, -1);
  near(joint.planeLimits[0].childDirection.x, -0.01 / Math.sqrt(1.0001));
  near(joint.planeLimits[0].childDirection.y, 1 / Math.sqrt(1.0001));
  near(joint.planeLimits[1].childDirection.z, 1 / Math.sqrt(1.0001));
});

test("indexed ordinary detach preserves index and selects its nearest part corner", () => {
  const geometry = selectOrdinaryDetachGeometry(
    [v(-1, -1, -1), v(1, 1, 1)],
    v(-2, -1.01, -2),
    v(2, 3, 2),
    1,
  );
  assert.deepEqual(geometry, { vertexIndex: 1, cornerBits: 7, side: 0 });
  assert.throws(() => selectOrdinaryDetachGeometry([], v(), v()));
});

test("SDB hinges preserve the source transverse basis and quick type", () => {
  const joint = createSdbHingeJoint(
    body(),
    body(),
    [v(), v(1, 2, 3), v(0, 1)],
    1,
  );
  assert.equal(joint.quickHinge, true);
  near(joint.hingeBasis[0].distanceTo(v(-3, 0, 1).normalize()), 0);
  near(joint.hingeBasis[1].dot(joint.childAxis), 0);
  near(joint.hingeBasis[1].dot(joint.hingeBasis[0]), 0);
});

test("quick hinge preprojection constrains axial anchor motion and two angular freedoms", () => {
  const child = body(1),
    parent = body(3);
  child.state.velocity.set(4, 8, 6);
  child.state.angularVelocity.set(4, 8, 12);
  const joint = createSdbHingeJoint(child, parent, [v(), v(0, 1), v(1)], 1);
  projectQuickHingeVelocities(joint);
  near(child.state.velocity.y, 2);
  near(parent.state.velocity.y, 2);
  near(child.state.velocity.x, 4);
  near(child.state.velocity.z, 6);
  near(child.state.angularVelocity.x, 1);
  near(parent.state.angularVelocity.x, 1);
  near(child.state.angularVelocity.z, 3);
  near(parent.state.angularVelocity.z, 3);
  near(child.state.angularVelocity.y, 8);
  near(parent.state.angularVelocity.y, 0);
});

test("pre-candidate preparation resolves bilateral anchor velocities without angular limits", () => {
  const child = body(),
    parent = body(4);
  child.state.velocity.set(5, -3, 2);
  child.state.angularVelocity.set(2, 5, 3);
  const joint = createSdbHingeJoint(child, parent, [v(), v(0, 1), v(1)], 1);
  // A stale candidate crossing the limit must not enter the preparation solve.
  child.state.predictedOrientation = new Quaternion().setFromAxisAngle(
    v(0, 1),
    2,
  );
  const reactions = prepareJointVelocities([joint]);
  near(child.state.velocity.distanceTo(parent.state.velocity), 0);
  near(child.state.velocity.x, 1);
  near(child.state.angularVelocity.x, parent.state.angularVelocity.x);
  near(child.state.angularVelocity.z, parent.state.angularVelocity.z);
  near(child.state.angularVelocity.y, 5);
  near(parent.state.angularVelocity.y, 0);
  assert.equal(reactions[0].constraintImpulses.length, 5);
});

test("only the first quick hinge sharing a body retains the source optimization", () => {
  const parent = body(),
    a = body(),
    b = body();
  const first = createSdbHingeJoint(a, parent, [v(), v(0, 1), v(1)], 1);
  const second = createSdbHingeJoint(b, parent, [v(), v(0, 1), v(1)], 1);
  selectQuickHinges([first, second]);
  assert.equal(first.quickHinge, true);
  assert.equal(second.quickHinge, false);
  selectQuickHinges([second]);
  assert.equal(second.quickHinge, false);
});
