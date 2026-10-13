import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { createHierarchyMotionPhase } from "../src/physics/hierarchy-motion.ts";
import { advanceRigidBody } from "../src/physics/integrate.ts";
import {
  createBallJoint,
  createHingeJoint,
  createTranslationJoint,
} from "../src/physics/joint.ts";

const STEP = 0.04;
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const q = (axis = v(0, 1), angle = 0) =>
  new Quaternion().setFromAxisAngle(axis.clone().normalize(), angle);
const nearVector = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    actual.distanceTo(expected) <= tolerance,
    `${actual.toArray()} != ${expected.toArray()}`,
  );
const nearRotation = (actual, expected) =>
  assert.ok(actual.angleTo(expected) < 1e-7);
function body(position = v(), orientation = new Quaternion()) {
  return {
    state: {
      position,
      orientation,
      velocity: v(),
      angularVelocity: v(),
      predictedPosition: v(99, 98, 97),
      predictedOrientation: q(v(1), 0.2),
    },
    properties: {
      mass: 2,
      inertia: v(1, 1, 1),
      centerOfMass: v(),
      worldFriction: 0,
    },
  };
}
function cloneBody(source) {
  return {
    ...source,
    state: Object.fromEntries(
      Object.entries(source.state).map(([key, value]) => [
        key,
        value?.clone ? value.clone() : value,
      ]),
    ),
    properties: {
      ...source.properties,
      inertia: source.properties.inertia.clone(),
      centerOfMass: source.properties.centerOfMass.clone(),
    },
  };
}
function anchor(pose, local) {
  return local.clone().applyQuaternion(pose.orientation).add(pose.position);
}
function align(parentPose, parentAnchor, childOrientation, childAnchor) {
  return anchor(parentPose, parentAnchor).sub(
    childAnchor.clone().applyQuaternion(childOrientation),
  );
}
// Installed 0x4b9209..0x4b921f: signed Float32 hinge angle, truncation
// toward zero, then the unsigned 16-bit BRender turn representation.
function nativeSignedTurn(rate, dt) {
  return (
    (Math.trunc(Math.fround(rate * dt) * 10430.378350470453) & 0xffff) *
    ((2 * Math.PI) / 65536)
  );
}

test("free hierarchy roots retain native COM integration and prediction is pure", () => {
  const root = body(v(3, -2, 1), q(v(1, 2, 3), 0.4));
  root.properties.centerOfMass.set(0.2, -0.3, 0.4);
  root.properties.inertia.set(1, 3, 5);
  root.state.velocity.set(1, 2, -3);
  root.state.angularVelocity.set(2, -3, 4);
  const old = cloneBody(root);
  const expected = cloneBody(root);
  advanceRigidBody(expected, STEP * 0.375);
  const phase = createHierarchyMotionPhase([root], [], STEP);
  const sample = phase.pose(root, 0.375);
  nearVector(sample.position, expected.state.position);
  nearRotation(sample.orientation, expected.state.orientation);
  nearVector(sample.velocity, expected.state.velocity);
  nearVector(sample.angularVelocity, expected.state.angularVelocity);
  for (const key of [
    "position",
    "velocity",
    "angularVelocity",
    "predictedPosition",
  ])
    nearVector(root.state[key], old.state[key]);
  nearRotation(root.state.orientation, old.state.orientation);
  nearRotation(root.state.predictedOrientation, old.state.predictedOrientation);
});

for (const type of ["ball", "universal"])
  test(`${type} child rotates independently but candidate origin follows the ancestor anchor`, () => {
    const parent = body(v(3, 4, 5), q(v(0, 1), 0.3));
    parent.state.velocity.set(2, -1, 3);
    parent.state.angularVelocity.set(0, 1, 0);
    const child = body(v(-10, 6, 4), q(v(1), 0.2));
    child.properties.centerOfMass.set(0.2, 0.4, -0.1);
    child.state.velocity.set(100, -200, 300);
    child.state.angularVelocity.set(0, 0, 1);
    const joint = createBallJoint(
      child,
      parent,
      v(0.3, 0.2, -0.1),
      v(1, -0.2, 2),
    );
    joint.type = type;
    const phase = createHierarchyMotionPhase([child, parent], [joint], STEP);
    const sample = phase.pose(child, 1);
    // Isotropic inertia and a small pure-axis rate have a single native turn.
    const angle =
      (Math.trunc(STEP * 10430.378350470453) & 0xffff) *
      ((2 * Math.PI) / 65536);
    const expectedRotation = q(v(0, 0, 1), angle).multiply(
      child.state.orientation,
    );
    nearRotation(sample.orientation, expectedRotation);
    nearVector(
      sample.position,
      align(
        phase.pose(parent, 1),
        joint.parentAnchor,
        expectedRotation,
        joint.childAnchor,
      ),
    );
    nearVector(sample.velocity, child.state.velocity);
    child.state.velocity.set(-500, 800, -900);
    const changed = createHierarchyMotionPhase([parent, child], [joint], STEP);
    nearVector(changed.pose(child, 1).position, sample.position);
    nearRotation(changed.pose(child, 1).orientation, sample.orientation);
  });

test("fraction zero preserves a captured anchor gap while positive candidates align it", () => {
  const parent = body(v(4, 5, 6));
  const child = body(v(-1, -2, -3));
  const joint = createBallJoint(child, parent, v(1), v(0, 2));
  const phase = createHierarchyMotionPhase([parent, child], [joint], STEP);
  nearVector(phase.pose(child, 0).position, child.state.position);
  nearRotation(phase.pose(child, 0).orientation, child.state.orientation);
  assert.ok(
    anchor(phase.pose(child, 0), joint.childAnchor).distanceTo(
      anchor(phase.pose(parent, 0), joint.parentAnchor),
    ) > 1,
  );
  nearVector(
    anchor(phase.pose(child, 0.25), joint.childAnchor),
    anchor(phase.pose(parent, 0.25), joint.parentAnchor),
  );
});

for (const stoppedBy of ["zero timestep", "zero world cap", "zero pair cap"])
  test(`${stoppedBy} retains the actual old pose instead of snapping a malformed anchor`, () => {
    const parent = body(v(4, 5, 6));
    parent.state.velocity.set(3, 2, 1);
    const child = body(v(-1, -2, -3));
    child.state.angularVelocity.set(0, 0, 2);
    const joint = createBallJoint(child, parent, v(1), v(0, 2));
    const phase = createHierarchyMotionPhase(
      [parent, child],
      [joint],
      stoppedBy === "zero timestep" ? 0 : STEP,
      stoppedBy === "zero world cap" ? new Map([[child, 0]]) : undefined,
    );
    if (stoppedBy !== "zero pair cap") {
      nearVector(phase.pose(child, 1).position, child.state.position);
      nearRotation(phase.pose(child, 1).orientation, child.state.orientation);
    }
    phase.commit(
      [parent, child],
      stoppedBy === "zero pair cap" ? new Map([[child, 0]]) : undefined,
    );
    nearVector(parent.state.position, v(4, 5, 6));
    nearVector(child.state.position, v(-1, -2, -3));
    nearVector(parent.state.velocity, v(3, 2, 1));
    nearVector(child.state.angularVelocity, v(0, 0, 2));
  });

for (const signedRate of [-3.25, 3.25])
  test(`hinge uses finite parent rotation and signed native turn (${signedRate}) while retaining world omega`, () => {
    const parent = body(v(2, 3, 4), q(v(0, 1), 0.2));
    parent.state.angularVelocity.set(0, 0, 1.5);
    const child = body(v(9, 8, 7), q(v(1), 0.4));
    child.state.velocity.set(7, -8, 9);
    const axis = v(0, 1);
    child.state.angularVelocity
      .copy(parent.state.angularVelocity)
      .addScaledVector(
        axis.clone().applyQuaternion(child.state.orientation),
        signedRate,
      );
    const joint = createHingeJoint(
      child,
      parent,
      v(0.2, -0.1, 0.3),
      v(0.4, 0.5, -0.2),
      axis,
      axis,
    );
    joint.quickHinge = signedRate > 0;
    const oldChild = cloneBody(child);
    const phase = createHierarchyMotionPhase([child, parent], [joint], STEP);
    const sample = phase.pose(child, 1);
    const expectedRotation = phase
      .pose(parent, 1)
      .orientation.clone()
      .multiply(parent.state.orientation.clone().invert())
      .multiply(child.state.orientation)
      .multiply(q(axis, nativeSignedTurn(signedRate, STEP)))
      .normalize();
    nearRotation(sample.orientation, expectedRotation);
    nearVector(
      sample.position,
      align(
        phase.pose(parent, 1),
        joint.parentAnchor,
        expectedRotation,
        joint.childAnchor,
      ),
    );
    nearVector(sample.angularVelocity, oldChild.state.angularVelocity);
    nearVector(sample.velocity, oldChild.state.velocity);
  });

test("type5 translation uses the old world axis, transverse correction and axial velocity without a travel clamp", () => {
  const world = body(v(7, -1, 2), q(v(0, 1), 0.5));
  world.properties.immovable = true;
  const child = body(v(3, 4, 5), q(v(0, 0, 1), Math.PI / 2));
  child.properties.centerOfMass.set(0.3, -0.2, 0.1);
  child.state.velocity.set(7, 5, -4);
  child.state.angularVelocity.set(0, 0, Math.PI / (2 * STEP));
  const localAxis = v(1);
  const worldAnchor = v(1, 2, 3);
  const joint = createTranslationJoint(
    child,
    world,
    v(0.2, -0.1, 0.3),
    worldAnchor,
    localAxis,
    0.001,
  );
  const axis = localAxis.clone().applyQuaternion(child.state.orientation);
  const angularOnly = cloneBody(child);
  angularOnly.state.velocity.set(0, 0, 0);
  advanceRigidBody(angularOnly, STEP);
  const projectedVelocity = axis
    .clone()
    .multiplyScalar(child.state.velocity.dot(axis));
  const displacement = worldAnchor
    .clone()
    .sub(anchor(angularOnly.state, joint.childAnchor));
  const expected = angularOnly.state.position
    .clone()
    .add(displacement)
    .addScaledVector(axis, -displacement.dot(axis))
    .addScaledVector(projectedVelocity, STEP);
  const phase = createHierarchyMotionPhase([child], [joint], STEP);
  const sample = phase.pose(child, 1);
  nearVector(sample.position, expected);
  nearRotation(sample.orientation, angularOnly.state.orientation);
  nearVector(sample.velocity, projectedVelocity);
  nearVector(sample.angularVelocity, angularOnly.state.angularVelocity);
  assert.ok(
    localAxis.clone().applyQuaternion(sample.orientation).dot(axis) < 0.01,
    "the new axis differs from the old axis by approximately 90 degrees",
  );
  assert.ok(
    anchor(sample, joint.childAnchor).sub(worldAnchor).dot(axis) >
      joint.translationTravel,
  );
});

test("nested physical ancestry is independent of body and joint roster order", () => {
  const root = body(v(1, 2, 3), q(v(0, 1), 0.3));
  root.state.velocity.set(1, -2, 3);
  root.state.angularVelocity.set(0, 0.8, 0);
  const roof = body(v(-4, 5, 6));
  roof.state.angularVelocity.set(0.7, 0, 0);
  const flap = body(v(8, -2, 9));
  flap.state.angularVelocity.set(0, 0, -0.5);
  const roofJoint = createBallJoint(
    roof,
    root,
    v(0.2, 0.3, -0.1),
    v(-0.4, 0.5, 0.6),
  );
  const flapJoint = createBallJoint(
    flap,
    roof,
    v(0.3, -0.1, 0.2),
    v(0.8, 0.4, -0.2),
  );
  const a = createHierarchyMotionPhase(
    [flap, root, roof],
    [flapJoint, roofJoint],
    STEP,
  );
  const b = createHierarchyMotionPhase(
    [root, roof, flap],
    [roofJoint, flapJoint],
    STEP,
  );
  for (const fraction of [0, 0.125, 0.5, 1]) {
    for (const member of [root, roof, flap]) {
      nearVector(
        a.pose(member, fraction).position,
        b.pose(member, fraction).position,
      );
      nearRotation(
        a.pose(member, fraction).orientation,
        b.pose(member, fraction).orientation,
      );
    }
    if (fraction > 0)
      for (const joint of [roofJoint, flapJoint])
        nearVector(
          anchor(a.pose(joint.child, fraction), joint.childAnchor),
          anchor(a.pose(joint.parent, fraction), joint.parentAnchor),
        );
  }
});

test("a phase captures motion, properties, joint fields and caps before later source mutation", () => {
  const root = body(v(2, 3, 4));
  root.state.velocity.set(1, 2, 3);
  root.state.angularVelocity.set(0, 1, 0);
  const child = body(v(4, 2, 1));
  child.state.angularVelocity.set(0, 0, 0.5);
  const joint = createBallJoint(child, root, v(1), v(0, 1));
  const caps = new Map([
    [root, 0.7],
    [child, 0.4],
  ]);
  const phase = createHierarchyMotionPhase([root, child], [joint], STEP, caps);
  const expectedRoot = cloneBody(root),
    expectedChild = cloneBody(child);
  const expectedJoint = createBallJoint(
    expectedChild,
    expectedRoot,
    joint.childAnchor,
    joint.parentAnchor,
  );
  const expected = createHierarchyMotionPhase(
    [expectedRoot, expectedChild],
    [expectedJoint],
    STEP,
    new Map([
      [expectedRoot, 0.7],
      [expectedChild, 0.4],
    ]),
  );
  root.state.position.set(90, 91, 92);
  root.state.velocity.set(-100, 200, -300);
  root.state.orientation.copy(q(v(1), 1));
  root.properties.centerOfMass.set(9, 8, 7);
  root.properties.inertia.set(11, 12, 13);
  child.state.angularVelocity.set(9, 8, 7);
  joint.parentAnchor.set(9, 9, 9);
  joint.childAnchor.set(7, 7, 7);
  joint.parent = body(v(200, 300, 400));
  joint.type = "hinge";
  caps.set(root, 0);
  caps.set(child, 1);
  for (const fraction of [0, 0.3, 1]) {
    nearVector(
      phase.pose(root, fraction).position,
      expected.pose(expectedRoot, fraction).position,
    );
    nearVector(
      phase.pose(child, fraction).position,
      expected.pose(expectedChild, fraction).position,
    );
    nearRotation(
      phase.pose(child, fraction).orientation,
      expected.pose(expectedChild, fraction).orientation,
    );
  }
});

test("world and pair clipping use one shared minimum time per physical tree at commitment", () => {
  const root = body(v(1, 2, 3));
  root.state.velocity.set(10, 0, 0);
  const child = body(v(2, 2, 3));
  const joint = createBallJoint(child, root, v(), v(1));
  const free = body(v(-2, 0, 0));
  free.state.velocity.set(0, 0, 5);
  const phase = createHierarchyMotionPhase(
    [child, free, root],
    [joint],
    STEP,
    new Map([
      [root, 0.8],
      [child, 0.25],
      [free, 1],
    ]),
  );
  assert.equal(phase.paths.get(child).temporalGroup, root);
  assert.equal(phase.paths.get(root).temporalGroup, root);
  assert.notEqual(phase.paths.get(free).temporalGroup, root);
  nearVector(phase.pose(root, 1).position, v(1.1, 2, 3));
  const expectedRoot = phase.pose(root, 0.2).position.clone();
  const expectedChild = phase.pose(child, 0.2).position.clone();
  const expectedFree = phase.pose(free, 0.7).position.clone();
  phase.writeCandidates([child, root, free], 0.5);
  nearVector(root.state.predictedPosition, phase.pose(root, 0.5).position);
  nearVector(root.state.position, v(1, 2, 3));
  phase.commit(
    [free, child, root],
    new Map([
      [root, 0.9],
      [child, 0.2],
      [free, 0.7],
    ]),
  );
  nearVector(root.state.position, expectedRoot);
  nearVector(child.state.position, expectedChild);
  nearVector(free.state.position, expectedFree);
  nearVector(
    anchor(child.state, joint.childAnchor),
    anchor(root.state, joint.parentAnchor),
  );
});

test("releasing a part or repairing its hierarchy requires a fresh phase without stale ownership", () => {
  const parent = body(v(10, 0, 0));
  const child = body(v(11, 0, 0));
  child.owner = parent;
  child.state.velocity.set(3, 4, 5);
  const joint = createBallJoint(child, parent, v(), v(1));
  const attached = createHierarchyMotionPhase([parent, child], [joint], STEP);
  nearVector(attached.pose(child, 1).position, v(11, 0, 0));
  const released = createHierarchyMotionPhase([parent, child], [], STEP);
  nearVector(released.pose(child, 1).position, v(11.12, 0.16, 0.2));
  // Repair restores source pose/anchor inputs; logical ownership alone is
  // never a physical motion dependency in either the released or new phase.
  parent.state.position.set(20, 0, 0);
  child.state.position.set(21, 0, 0);
  const repaired = createHierarchyMotionPhase([child, parent], [joint], STEP);
  nearVector(repaired.pose(child, 1).position, v(21, 0, 0));
  nearVector(attached.pose(child, 1).position, v(11, 0, 0));
  nearVector(released.pose(child, 1).position, v(11.12, 0.16, 0.2));
});

test("a child orbit retains a full-turn guard bound even when its own angular velocity is zero", () => {
  const parent = body();
  parent.state.angularVelocity.set(0, (8 * Math.PI) / STEP, 0);
  const child = body(v(2, 0, 0));
  const joint = createBallJoint(child, parent, v(), v(2));
  const phase = createHierarchyMotionPhase([child, parent], [joint], STEP);
  const path = phase.paths.get(child);
  assert.equal(path.stable, true);
  assert.ok(path.angularTravel >= 8 * Math.PI - 1e-7);
  assert.ok(path(1 / 16).position.distanceTo(path(0).position) > 2);
  assert.equal(
    path(0.25),
    path(0.25),
    "one immutable phase retains sampled poses",
  );
});

test("a distant parent anchor supplies conservative child COM bounds over hidden complete turns", () => {
  const parent = body();
  parent.state.angularVelocity.set(0, (8 * Math.PI) / STEP, 0);
  const child = body(v(100, 0, 0));
  child.properties.centerOfMass.set(0.002, 0, 0);
  const joint = createBallJoint(child, parent, v(), v(100));
  const phase = createHierarchyMotionPhase([parent, child], [joint], STEP);
  const path = phase.paths.get(child);
  assert.ok(
    path.centerBounds,
    "COM orbit bounds cannot depend only on the child's tiny local radius",
  );
  assert.ok(path.centerBounds.min.x < -99.9);
  assert.ok(path.centerBounds.max.x > 99.9);
  assert.ok(path.centerBounds.min.z < -99.9);
  assert.ok(path.centerBounds.max.z > 99.9);
  for (let index = 0; index <= 32; index++) {
    const sample = phase.pose(child, index / 32);
    const com = child.properties.centerOfMass
      .clone()
      .applyQuaternion(sample.orientation)
      .add(sample.position);
    assert.ok(
      path.centerBounds.containsPoint(com),
      `COM outside enclosure at ${index}/32`,
    );
  }
});

test("type5 COM bounds include old axial COM and the transverse rotated COM offset", () => {
  const world = body();
  world.properties.immovable = true;
  const child = body();
  const axis = v(1, 1).normalize();
  child.properties.centerOfMass.copy(axis).multiplyScalar(100);
  child.state.angularVelocity.set(0, 0, Math.PI / (2 * STEP));
  const joint = createTranslationJoint(child, world, v(), v(), axis, 0);
  const phase = createHierarchyMotionPhase([child], [joint], STEP);
  const path = phase.paths.get(child);
  assert.ok(path.centerBounds);
  const endCOM = anchor(phase.pose(child, 1), child.properties.centerOfMass);
  assert.ok(
    endCOM.y > 140,
    "old axial COM and newly rotated transverse COM exceed the single 100-unit radius",
  );
  for (let index = 0; index <= 16; index++) {
    const com = anchor(
      phase.pose(child, index / 16),
      child.properties.centerOfMass,
    );
    assert.ok(
      path.centerBounds.containsPoint(com),
      `type5 COM outside enclosure at ${index}/16`,
    );
  }
});

test("immovable anchors remain captured constants and do not commit child motion back into the world", () => {
  const world = body(v(4, 5, 6));
  world.properties.immovable = true;
  world.state.velocity.set(99, 98, 97);
  world.state.angularVelocity.set(20, 30, 40);
  const child = body(v(5, 5, 6));
  child.state.angularVelocity.set(0, 0, 1);
  const joint = createBallJoint(child, world, v(), v(1));
  const phase = createHierarchyMotionPhase([child], [joint], STEP);
  nearVector(phase.pose(world, 1).position, world.state.position);
  nearRotation(phase.pose(world, 1).orientation, world.state.orientation);
  phase.commit([child, world]);
  nearVector(world.state.position, v(4, 5, 6));
  nearVector(world.state.velocity, v(99, 98, 97));
  nearVector(child.state.position, v(5, 5, 6));
});
