import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  buildJointConstraints,
  createTranslationJoint,
  jointConstraintImpacts,
  prepareJointVelocities,
  projectJointPositions,
  resolveJoints,
} from "../src/physics/joint.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const body = (immovable = false) => ({
  state: {
    position: v(),
    orientation: new Quaternion(),
    velocity: v(),
    angularVelocity: v(),
  },
  properties: {
    mass: 1,
    inertia: v(1, 1, 1),
    centerOfMass: v(),
    worldFriction: 0,
    rotationLocked: immovable,
    immovable,
  },
});
const near = (actual, expected, epsilon = 1e-8) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test("type5 translation joint keeps only axial linear velocity and adds no angular rows", () => {
  const child = body();
  const world = body(true);
  const joint = createTranslationJoint(child, world, v(), v(), v(0, 1, 0), 5);
  child.state.velocity.set(4, 3, 2);
  child.state.angularVelocity.set(1, 2, 3);
  const rows = buildJointConstraints([joint], false);
  assert.equal(rows.length, 2);
  assert.equal(rows.some((row) => row.angular), false);
  prepareJointVelocities([joint]);
  near(child.state.velocity.x, 0);
  near(child.state.velocity.y, 3);
  near(child.state.velocity.z, 0);
  assert.deepEqual(child.state.angularVelocity.toArray(), [1, 2, 3]);
  assert.deepEqual(world.state.velocity.toArray(), [0, 0, 0]);
});

test("post-integration projection puts anchor on line, preserves axial travel and projects velocity", () => {
  const child = body();
  const world = body(true);
  const joint = createTranslationJoint(
    child,
    world,
    v(0, 1, 0),
    v(1, 2, 1),
    v(1, 0, 0),
    2,
  );
  child.state.position.set(3, 4, 5);
  child.state.velocity.set(1, 2, 3);
  child.state.angularVelocity.set(1, 2, 3);
  const originalRotation = child.state.orientation.clone();
  projectJointPositions([joint]);
  // localAnchor had y=1, so child anchor is projected to (3,2,1); x remains axial.
  assert.deepEqual(child.state.position.toArray(), [3, 1, 1]);
  assert.deepEqual(child.state.velocity.toArray(), [1, 0, 0]);
  assert.deepEqual(child.state.angularVelocity.toArray(), [1, 2, 3]);
  assert.equal(child.state.orientation.angleTo(originalRotation), 0);
});

test("type11 upper and lower travel limits create unilateral sourceType2 rows", () => {
  for (const [start, predicted, speed, expectedNormal] of [
    [1.99, 2.002, 4, -1],
    [-0.001, -0.002, -4, 1],
  ]) {
    const child = body();
    const world = body(true);
    child.state.position.x = start;
    child.state.predictedPosition = v(predicted, 0, 0);
    child.state.velocity.x = speed;
    const joint = createTranslationJoint(child, world, v(), v(), v(1, 0, 0), 2);
    const rows = buildJointConstraints([joint]);
    const limit = rows.find((row) => row.sourceType === 2);
    assert.ok(limit);
    assert.equal(limit.unilateral, true);
    assert.equal(limit.angular, false);
    near(limit.axis.x, expectedNormal);
    const impacts = jointConstraintImpacts(rows, rows.map((row) => row === limit ? 1 : 0));
    assert.equal(impacts.find((impact) => impact.constraint === limit).sourceType, 2);
    resolveJoints([joint]);
    near(child.state.velocity.x, 0);
    assert.deepEqual(world.state.velocity.toArray(), [0, 0, 0]);
  }
});

test("native travel tolerances keep contacts off at the .001 boundaries", () => {
  for (const [current, predicted] of [
    [0, -0.001],
    [2, 2.001],
  ]) {
    const child = body();
    const joint = createTranslationJoint(child, body(true), v(), v(), v(1, 0, 0), 2);
    child.state.position.x = current;
    child.state.predictedPosition = v(predicted, 0, 0);
    const rows = buildJointConstraints([joint]);
    assert.equal(rows.some((row) => row.sourceType === 2), false);
  }
});
