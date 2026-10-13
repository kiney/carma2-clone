import test from "node:test";
import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { advanceRigidBody } from "../src/physics/integrate.ts";
import { createRigidBodyPosePath } from "../src/physics/rigid-path.ts";

// Independent oracle copied from this MIT project's commit-path factory,
// retaining the original step/world-fraction multiplication order. Keep the old
// probe/candidate/cache operations here rather than sharing the new factory.
function oldFactory(body, stepSeconds, worldFraction = 1) {
  const probe = {
    ...body,
    state: {
      ...body.state,
      position: body.state.position.clone(),
      orientation: body.state.orientation.clone(),
      velocity: body.state.velocity.clone(),
      angularVelocity: body.state.angularVelocity.clone(),
      predictedPosition: new Vector3(),
      predictedOrientation: new Quaternion(),
    },
  };
  const cache = new Map();
  const path = (fraction) => {
    let pose = cache.get(fraction);
    if (!pose) {
      if (probe.properties.immovable) {
        probe.state.predictedPosition.copy(probe.state.position);
        probe.state.predictedOrientation.copy(probe.state.orientation);
      } else
        advanceRigidBody(probe, stepSeconds * worldFraction * fraction, true);
      pose = {
        position: probe.state.predictedPosition.clone(),
        orientation: probe.state.predictedOrientation.clone(),
      };
      cache.set(fraction, pose);
    }
    return pose;
  };
  path.stable = true;
  if (body.properties.immovable) path.constantPose = path(0);
  const inertia = body.properties.inertia;
  path.angularTravel =
    body.properties.immovable || body.properties.rotationLocked
      ? 0
      : (body.state.angularVelocity
          .clone()
          .applyQuaternion(body.state.orientation.clone().invert())
          .multiply(inertia)
          .length() /
          Math.min(inertia.x, inertia.y, inertia.z)) *
        stepSeconds *
        worldFraction;
  return path;
}
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function body(immovable = false, rotationLocked = false) {
  return {
    state: {
      position: v(-0, 2, -3),
      orientation: new Quaternion().setFromAxisAngle(
        v(1, 2, 3).normalize(),
        0.53,
      ),
      velocity: v(1.2, -0, -3.4),
      angularVelocity: v(2, -3, 7),
      predictedPosition: v(99, 98, 97),
      predictedOrientation: new Quaternion(0.1, 0.2, 0.3, 0.4),
    },
    properties: {
      mass: 2,
      inertia: v(0.3, 0.9, 1.2),
      centerOfMass: v(0.15, -0.2, 0.3),
      worldFriction: 0,
      immovable,
      rotationLocked,
    },
  };
}
const serialize = (body) => JSON.stringify(body);
function exactComponents(actual, expected) {
  for (const key of ["x", "y", "z", ...("w" in expected ? ["w"] : [])])
    assert(
      Object.is(actual[key], expected[key]),
      `Exact ${key}: ${actual[key]} vs ${expected[key]}`,
    );
}
function compare(body, stepSeconds, worldFraction = 1) {
  const before = serialize(body);
  const expected = oldFactory(body, stepSeconds, worldFraction),
    actual = createRigidBodyPosePath(body, stepSeconds, worldFraction);
  assert.equal(actual.stable, expected.stable);
  assert(Object.is(actual.angularTravel, expected.angularTravel));
  assert.equal(!!actual.constantPose, !!expected.constantPose);
  for (const fraction of [-0, 0, 0.125, 0.5, 0.999999, 1, 0.5]) {
    const a = actual(fraction),
      b = expected(fraction);
    exactComponents(a.position, b.position);
    exactComponents(a.orientation, b.orientation);
    assert.equal(actual(fraction), a, "Repeated fraction reuses pose identity");
  }
  assert.equal(
    serialize(body),
    before,
    "Prediction leaves external state/properties unchanged",
  );
}
test("moving, rotation-locked and immovable paths preserve exact candidate poses", () => {
  for (const immovable of [false, true])
    for (const rotationLocked of [false, true])
      for (const stepSeconds of [0, 0.04])
        for (const worldFraction of [
          0,
          -0,
          1,
          0.000081,
          1 / 3,
          1 / 7,
          0.9999999999999999,
        ])
          compare(body(immovable, rotationLocked), stepSeconds, worldFraction);
  const unnormalized = body();
  unnormalized.state.orientation.set(0.2, -0.3, 0.4, 0.7);
  compare(unnormalized, 0.04);
  const fullTurn = body();
  fullTurn.properties.inertia.set(1, 1, 1);
  fullTurn.state.angularVelocity.set(0, (2 * Math.PI) / 0.04, 0);
  compare(fullTurn, 0.04);
});
test("constant paths capture their pose once; wake-up uses a fresh path", () => {
  const source = body(true);
  const path = createRigidBodyPosePath(source, 0.04);
  const pose = path(0);
  assert.equal(path.constantPose, pose);
  assert.notEqual(pose.position, source.state.position);
  assert.notEqual(pose.orientation, source.state.orientation);
  source.state.position.set(8, 9, 10);
  source.state.orientation.set(0, 0, 0, 1);
  source.properties.immovable = false;
  for (const fraction of [-0, 0.25, 1]) assert.equal(path(fraction), pose);
  assert.equal(pose.position.y, 2);
  const awake = createRigidBodyPosePath(source, 0.04);
  assert.equal(awake.constantPose, undefined);
  assert.notDeepEqual(awake(1).position, pose.position);
  compare(source, 0.04);
});
test("immovable creation reads no unrelated body, motion or inertia fields", () => {
  const source = body(true);
  for (const [object, key] of [
    [source, "unrelated"],
    [source.state, "velocity"],
    [source.state, "angularVelocity"],
    [source.properties, "inertia"],
  ])
    Object.defineProperty(object, key, {
      enumerable: true,
      get() {
        throw new Error(`Unneeded immovable field ${key}`);
      },
    });
  const path = createRigidBodyPosePath(source, 0.04);
  assert.equal(path(1), path.constantPose);
  assert.equal(path.angularTravel, 0);
});
test("world clipping keeps the original angular-bound multiplication grouping", () => {
  const source = body();
  const fractions = [0.000081, 1 / 3, 1 / 7, 1 / 11, 1 / 13, 1 / 17, 1 / 19];
  assert(
    fractions.some(
      (fraction) =>
        !Object.is(
          oldFactory(source, 0.04, fraction).angularTravel,
          oldFactory(source, 0.04 * fraction).angularTravel,
        ),
    ),
    "Fixture must expose a rounding difference if the duration is premultiplied",
  );
  for (const fraction of fractions) compare(source, 0.04, fraction);
});
test("moving paths snapshot motion and retain the previous shared-property semantics", () => {
  const source = body();
  const old = oldFactory(source, 0.04),
    path = createRigidBodyPosePath(source, 0.04);
  const initial = path(0);
  source.state.position.set(10, 20, 30);
  source.state.velocity.set(100, 200, 300);
  source.state.angularVelocity.set(30, 20, 10);
  source.state.orientation.set(0, 0, 0, 1);
  source.properties.centerOfMass.set(0.1, 0.2, 0.3);
  for (const fraction of [0.25, 0.75]) {
    exactComponents(path(fraction).position, old(fraction).position);
    exactComponents(path(fraction).orientation, old(fraction).orientation);
  }
  assert.equal(path(0), initial);
  source.properties.immovable = true;
  exactComponents(path(1).position, old(1).position);
  exactComponents(path(1).orientation, old(1).orientation);
});
test("immovable creation reduces six vector/quaternion clones to two and later sampling clones none", () => {
  const source = body(true);
  const originals = [Vector3.prototype.clone, Quaternion.prototype.clone];
  let clones = 0;
  try {
    Vector3.prototype.clone = function () {
      clones++;
      return originals[0].call(this);
    };
    Quaternion.prototype.clone = function () {
      clones++;
      return originals[1].call(this);
    };
    oldFactory(source, 0.04);
    assert.equal(clones, 6);
    clones = 0;
    const path = createRigidBodyPosePath(source, 0.04);
    assert.equal(clones, 2);
    clones = 0;
    for (const fraction of [0, 0.25, 0.5, 0.75, 1])
      assert.equal(path(fraction), path.constantPose);
    assert.equal(clones, 0);
  } finally {
    Vector3.prototype.clone = originals[0];
    Quaternion.prototype.clone = originals[1];
  }
});
