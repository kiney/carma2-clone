import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { hullPenetration, transformHull } from "../src/physics/geometry.ts";
import { createHierarchyMotionPhase } from "../src/physics/hierarchy-motion.ts";
import {
  createBallJoint,
  createHingeJoint,
  createTranslationJoint,
} from "../src/physics/joint.ts";
import { BodyTrajectoryGuard } from "../src/physics/pair-guard.ts";
import { createRigidBodyPosePath } from "../src/physics/rigid-path.ts";
import { legacyGuardPairTrajectory } from "./support/legacy-physics-guard.mjs";

const STEP = 0.04;
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function body(position = v(), half = 0.1, immovable = false) {
  return {
    hulls: [buildBoxHull(v(-half, -half, -half), v(half, half, half))],
    state: {
      position,
      orientation: new Quaternion(),
      velocity: v(),
      angularVelocity: v(),
    },
    properties: {
      mass: 1,
      inertia: v(1, 1, 1),
      centerOfMass: v(),
      immovable,
    },
  };
}
function move(item, delta) {
  item.state.velocity.copy(delta).divideScalar(STEP);
  return createRigidBodyPosePath(item, STEP);
}
function run(paths, pairAllowed) {
  const diagnostics = {};
  const limits = new BodyTrajectoryGuard().run(
    [...paths.keys()],
    paths,
    pairAllowed,
    diagnostics,
  );
  return { limits, diagnostics };
}
function pair(a, b, pa, pb) {
  return run(
    new Map([
      [a, pa],
      [b, pb],
    ]),
  );
}
function depth(a, b, pa, pb, ta, tb = ta) {
  const poseA = pa(ta),
    poseB = pb(tb);
  return Math.max(
    ...a.hulls.flatMap((ha) =>
      b.hulls.map((hb) =>
        hullPenetration(
          transformHull(ha, poseA.position, poseA.orientation),
          transformHull(hb, poseB.position, poseB.orientation),
        ),
      ),
    ),
  );
}
function near(actual, expected, tolerance = 2e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );
}

// Verify the producer's global envelope against actual immutable path samples,
// including the anchor-correction discontinuity immediately after OLD.
function checkEnvelope(item, path) {
  const envelope = path.guardMotion;
  assert.ok(envelope);
  const old = path(0);
  const oldCOM = envelope.centerOfMass
    .clone()
    .applyQuaternion(old.orientation)
    .add(old.position);
  const radius = Math.max(
    ...item.hulls.flatMap((hull) =>
      hull.vertices.map((point) => point.distanceTo(envelope.centerOfMass)),
    ),
  );
  const angularAllowance =
    2 * radius * Math.sin(Math.min(envelope.angularTravel, Math.PI) / 2);
  for (const f of [0, 1e-8, 0.0001, 0.03, 0.125, 0.5, 0.73, 1]) {
    const pose = path(f);
    const actualCOM = envelope.centerOfMass
      .clone()
      .applyQuaternion(pose.orientation)
      .add(pose.position);
    const translatedCOM = oldCOM.clone().addScaledVector(envelope.delta, f);
    assert.ok(
      actualCOM.distanceTo(translatedCOM) <=
        (envelope.centerError ?? 0) + 1e-10,
      `COM envelope at ${f}: ${actualCOM.distanceTo(translatedCOM)} > ${envelope.centerError ?? 0}`,
    );
    assert.ok(
      old.orientation.angleTo(pose.orientation) <=
        envelope.angularTravel + 1e-7,
      `Angular envelope at ${f}`,
    );
    for (const hull of item.hulls)
      for (const point of hull.vertices) {
        const expected = point
          .clone()
          .applyQuaternion(old.orientation)
          .add(old.position)
          .addScaledVector(envelope.delta, f);
        const actual = point
          .clone()
          .applyQuaternion(pose.orientation)
          .add(pose.position);
        assert.ok(
          actual.distanceTo(expected) <=
            (envelope.centerError ?? 0) + angularAllowance + 1e-10,
          `Vertex envelope at ${f}`,
        );
      }
  }
}

test("captured rigid and hierarchy root paths continuously catch a thin complete crossing", () => {
  for (const producer of ["rigid", "hierarchy"]) {
    const a = body(v(-2, 0, 0), 0.001);
    const b = body(v(), 0.001, true);
    a.state.velocity.x = 4 / STEP;
    const paths =
      producer === "rigid"
        ? new Map([
            [a, createRigidBodyPosePath(a, STEP)],
            [b, createRigidBodyPosePath(b, STEP)],
          ])
        : createHierarchyMotionPhase([a, b], [], STEP).paths;
    assert.ok(paths.get(a).guardMotion, producer);
    const before = JSON.stringify([a.state, b.state]);
    const { limits, diagnostics } = run(paths);
    near(limits.get(a), (2 - 0.002 + 1e-6) / 4);
    assert.equal(limits.get(b), 1);
    assert.equal(depth(a, b, paths.get(a), paths.get(b), 0), 0);
    assert.equal(depth(a, b, paths.get(a), paths.get(b), 1), 0);
    assert.ok(
      depth(a, b, paths.get(a), paths.get(b), limits.get(a), 1) <= 1.01e-6,
    );
    assert.ok(diagnostics.translationHullQueries > 0);
    assert.equal(diagnostics.sampledIntervals, 0);
    assert.equal(JSON.stringify([a.state, b.state]), before);
  }
});

test("two captured approaching bodies retain the analytical common head-on prefix", () => {
  const a = body(v(-1, 0, 0)),
    b = body(v(1, 0, 0));
  const pa = move(a, v(2, 0, 0)),
    pb = move(b, v(-2, 0, 0));
  const { limits, diagnostics } = pair(a, b, pa, pb);
  near(limits.get(a), (1.8 + 1e-6) / 4);
  assert.equal(limits.get(a), limits.get(b));
  assert.ok(depth(a, b, pa, pb, limits.get(a)) <= 1.01e-6);
  assert.ok(diagnostics.translationHullQueries > 0);
  assert.equal(diagnostics.sampledIntervals, 0);
});

test("continuous root guards permit separating and tangential touching motion", () => {
  for (const delta of [v(-1, 0, 0), v(0, 0, 2)]) {
    const a = body(v(-0.1, 0, 0)),
      b = body(v(0.1, 0, 0), 0.1, true);
    const pa = move(a, delta),
      pb = createRigidBodyPosePath(b, STEP);
    const { limits, diagnostics } = pair(a, b, pa, pb);
    assert.equal(limits.get(a), 1);
    assert.equal(diagnostics.sampledIntervals, 0);
    assert.equal(depth(a, b, pa, pb, 1), 0);
  }
});

test("root translation certificates account for a rotated nonzero center of mass", () => {
  const a = body(v(-1, 0, 0)),
    b = body(v(), 0.1, true);
  a.properties.centerOfMass.set(0.3, -0.2, 0.4);
  a.state.orientation.setFromAxisAngle(v(0, 1, 0), Math.PI / 2);
  const pa = move(a, v(2, 0, 0)),
    pb = createRigidBodyPosePath(b, STEP);
  assert.deepEqual(pa.guardMotion.centerOfMass.toArray(), [0.3, -0.2, 0.4]);
  assert.ok(pa(0).position.distanceTo(a.state.position) < 1e-12);
  assert.ok(pa(1).position.distanceTo(v(1, 0, 0)) < 1e-12);
  const { limits, diagnostics } = pair(a, b, pa, pb);
  near(limits.get(a), (0.8 + 1e-6) / 2);
  assert.ok(depth(a, b, pa, pb, limits.get(a)) <= 1.01e-6);
  assert.ok(diagnostics.translationHullQueries > 0);
  assert.equal(diagnostics.sampledIntervals, 0);
});

test("whole-phase rotating clearance avoids sampling even for a broadphase candidate", () => {
  const a = body(),
    b = body(v(0, 1, 0), 0.025, true);
  a.hulls = [buildBoxHull(v(-2, -0.02, -0.02), v(2, 0.02, 0.02))];
  a.state.angularVelocity.y = 1;
  const pa = createRigidBodyPosePath(a, STEP),
    pb = createRigidBodyPosePath(b, STEP);
  const { limits, diagnostics } = pair(a, b, pa, pb);
  assert.equal(limits.get(a), 1);
  assert.ok(
    diagnostics.pairGuardCalls > 0,
    "Exercise the guard after broadphase discovery",
  );
  assert.ok(diagnostics.clearanceHullCertificates > 0);
  assert.equal(diagnostics.translationHullQueries, 0);
  assert.equal(diagnostics.sampledIntervals, 0);
  assert.equal(diagnostics.guardFeatureSweeps, 0);
});

test("an actual full-turn collision retains the sampled rotational fallback", () => {
  const a = body(),
    b = body(v(0, 0, 0.35), 0.025, true);
  a.hulls = [buildBoxHull(v(-0.5, -0.025, -0.025), v(0.5, 0.025, 0.025))];
  a.state.angularVelocity.y = (2 * Math.PI) / STEP;
  const pa = createRigidBodyPosePath(a, STEP),
    pb = createRigidBodyPosePath(b, STEP);
  const { limits, diagnostics } = pair(a, b, pa, pb);
  assert.equal(depth(a, b, pa, pb, 0), 0);
  assert.equal(depth(a, b, pa, pb, 1), 0);
  assert.ok(limits.get(a) > 0 && limits.get(a) < 0.25);
  assert.ok(depth(a, b, pa, pb, limits.get(a)) <= 1.01e-6);
  assert.ok(diagnostics.sampledIntervals > 0);
  assert.equal(diagnostics.translationHullQueries, 0);
  assert.equal(diagnostics.clearanceHullCertificates, 0);
});

test("rotating clearance measures the hull radius about its offset COM", () => {
  const a = body(v(), 0.04),
    b = body(v(0.12, 0, 0.45), 0.04, true);
  a.properties.centerOfMass.x = 1;
  a.state.angularVelocity.y = 0.5 / STEP;
  const pa = createRigidBodyPosePath(a, STEP),
    pb = createRigidBodyPosePath(b, STEP);
  assert.ok(
    depth(a, b, pa, pb, 1) > 0,
    "The origin follows a COM-centered collision arc",
  );
  const { limits, diagnostics } = pair(a, b, pa, pb);
  assert.ok(limits.get(a) > 0 && limits.get(a) < 1);
  assert.equal(diagnostics.clearanceHullCertificates, 0);
  assert.ok(diagnostics.sampledIntervals > 0);
  assert.ok(depth(a, b, pa, pb, limits.get(a)) <= 1.01e-6);
});

test("a custom translation path without an envelope retains the sampled fallback", () => {
  const a = body(v(-1, 0, 0)),
    b = body(v(), 0.1, true);
  const captured = move(a, v(2, 0, 0));
  const pa = (fraction) => captured(fraction);
  pa.stable = true;
  pa.angularTravel = 0;
  const pb = createRigidBodyPosePath(b, STEP);
  const expected = legacyGuardPairTrajectory(a, b, pa, pb);
  const { limits, diagnostics } = pair(a, b, pa, pb);
  assert.equal(limits.get(a), expected);
  assert.ok(limits.get(a) > 0 && limits.get(a) < 1);
  assert.equal(diagnostics.clearanceHullTests, 0);
  assert.equal(diagnostics.translationHullQueries, 0);
  assert.ok(diagnostics.sampledIntervals > 0);
});

test("a discontinuous child anchor correction is enclosed without certifying a collision clear", () => {
  const parent = body(v(0, 3, 0), 0.01, true);
  const child = body(v(-1, 0, 0));
  const wall = body(v(1, 0, 0), 0.1, true);
  const joint = createBallJoint(child, parent, v(), v(1, -3, 0));
  child.joint = joint;
  const phase = createHierarchyMotionPhase(
    [parent, child, wall],
    [joint],
    STEP,
  );
  const pc = phase.paths.get(child),
    pw = phase.paths.get(wall);
  near(pc.guardMotion.centerError, 2, 1e-12);
  assert.equal(pc.guardMotion.angularTravel, 0);
  checkEnvelope(child, pc);
  assert.equal(pc(0).position.x, -1);
  assert.equal(
    pc(0.01).position.x,
    1,
    "Fixture has an instantaneous anchor correction",
  );
  const expected = legacyGuardPairTrajectory(child, wall, pc, pw);
  const { limits, diagnostics } = run(
    phase.paths,
    (a, b) => a !== parent && b !== parent,
  );
  assert.equal(limits.get(child), expected);
  assert.ok(limits.get(child) < 1);
  assert.ok(diagnostics.clearanceHullTests > 0);
  assert.equal(diagnostics.clearanceHullCertificates, 0);
  assert.equal(diagnostics.translationHullQueries, 0);
  assert.ok(diagnostics.sampledIntervals > 0);
});

test("a nested authored hinge keeps its existing trajectory and fallback result", () => {
  const parent = body(v(0, 3, 0), 0.01, true);
  const child = body(v(), 0.01),
    tip = body(v(0.4, 0, 0), 0.04);
  const wall = body(v(0, 0, -0.4), 0.04, true);
  child.state.angularVelocity.y = Math.PI / STEP;
  tip.state.angularVelocity.y = Math.PI / STEP;
  const first = createHingeJoint(
    child,
    parent,
    v(),
    v(0, -3, 0),
    v(0, 1, 0),
    v(0, 1, 0),
  );
  const second = createHingeJoint(
    tip,
    child,
    v(),
    v(0.4, 0, 0),
    v(0, 1, 0),
    v(0, 1, 0),
  );
  child.joint = first;
  tip.joint = second;
  const phase = createHierarchyMotionPhase(
    [parent, child, tip, wall],
    [first, second],
    STEP,
  );
  checkEnvelope(child, phase.paths.get(child));
  checkEnvelope(tip, phase.paths.get(tip));
  const expected = legacyGuardPairTrajectory(
    tip,
    wall,
    phase.paths.get(tip),
    phase.paths.get(wall),
  );
  const { limits, diagnostics } = run(
    phase.paths,
    (a, b) => (a === tip && b === wall) || (a === wall && b === tip),
  );
  assert.ok(
    expected > 0 && expected < 1,
    "Fixture must exercise an actual hinge collision",
  );
  assert.equal(limits.get(tip), expected);
  assert.ok(diagnostics.sampledIntervals > 0);
  assert.equal(diagnostics.translationHullQueries, 0);
});

test("sub-gate root angular motion uses exact translation in both captured producers", () => {
  for (const producer of ["rigid", "hierarchy"]) {
    const a = body(v(-1, 0, 0)),
      b = body(v(), 0.1, true);
    a.state.angularVelocity.set(0.001, -0.002, 0.001);
    a.state.velocity.x = 2 / STEP;
    const paths =
      producer === "rigid"
        ? new Map([
            [a, createRigidBodyPosePath(a, STEP)],
            [b, createRigidBodyPosePath(b, STEP)],
          ])
        : createHierarchyMotionPhase([a, b], [], STEP).paths;
    const pa = paths.get(a);
    assert.ok(pa.angularTravel > 0);
    assert.equal(pa.guardMotion.angularTravel, 0);
    checkEnvelope(a, pa);
    const { limits, diagnostics } = run(paths);
    near(limits.get(a), (0.8 + 1e-6) / 2);
    assert.ok(diagnostics.translationHullQueries > 0);
    assert.equal(diagnostics.sampledIntervals, 0);
  }
});

test("native rotation gate preserves sequential multiplication at a clipped-duration boundary", () => {
  const a = body();
  a.state.angularVelocity.x = 0.02395664894066954;
  const fraction = 0.33,
    dt = 0.0132;
  assert.equal(a.state.angularVelocity.lengthSq() * dt * dt, 1e-7);
  assert.ok(
    a.state.angularVelocity.lengthSq() * dt ** 2 < 1e-7,
    "Fixture must distinguish native multiplication order from exponentiation",
  );
  const rigid = createRigidBodyPosePath(a, STEP, fraction);
  const hierarchy = createHierarchyMotionPhase(
    [a],
    [],
    STEP,
    new Map([[a, fraction]]),
  ).paths.get(a);
  const quantum = (2 * Math.PI) / 65536;
  // The decimal product STEP * .33 rounds one ULP above literal .0132.
  // Exercise that clipped path too; the literal duration exposes the gate bug.
  const literalRigid = createRigidBodyPosePath(a, dt);
  const literalHierarchy = createHierarchyMotionPhase([a], [], dt).paths.get(a);
  for (const path of [rigid, hierarchy, literalRigid, literalHierarchy]) {
    assert.ok(path.guardMotion.angularTravel > 0);
    const rotation = path(0).orientation.angleTo(path(1).orientation);
    assert.ok(
      rotation > 0,
      "The actual integrator must retain its boundary rotation",
    );
    near(rotation, 3 * quantum, 1e-9);
  }
});

test("global hinge envelopes include fixed-parent anchor mismatch, COM levers and signed turn quantization", () => {
  for (const rate of [-0.00001, 0.00001, -25, 25]) {
    const parent = body(v(2, 3, -1), 0.01, true);
    parent.properties.centerOfMass.set(0.4, -0.2, 0.1);
    parent.state.orientation.setFromAxisAngle(v(1, 2, 3).normalize(), 0.4);
    const child = body(v(-2, 0.2, 1), 0.1);
    child.properties.centerOfMass.set(0.8, -0.3, 0.5);
    child.state.angularVelocity.y = rate;
    const joint = createHingeJoint(
      child,
      parent,
      v(0.2, 0.1, -0.1),
      v(1, -0.5, 0.2),
      v(0, 1, 0),
      v(0, 1, 0),
    );
    child.joint = joint;
    const phase = createHierarchyMotionPhase([parent, child], [joint], STEP);
    const pc = phase.paths.get(child);
    const parentAnchor = joint.parentAnchor
      .clone()
      .applyQuaternion(parent.state.orientation)
      .add(parent.state.position);
    const childAnchor = joint.childAnchor
      .clone()
      .applyQuaternion(child.state.orientation)
      .add(child.state.position);
    assert.ok(
      pc.guardMotion.centerError >= parentAnchor.distanceTo(childAnchor),
    );
    checkEnvelope(child, pc);
  }
});

test("nested ball and hinge envelopes contain inherited moving-root translation and rotation", () => {
  const root = body(v(2, -1, 3));
  root.state.orientation.setFromAxisAngle(v(1, 2, 3).normalize(), 0.3);
  root.properties.centerOfMass.set(0.2, -0.1, 0.4);
  root.properties.inertia.set(1, 2, 3);
  root.state.velocity.set(3, -2, 1);
  root.state.angularVelocity.set(2, -3, 4);
  const child = body(v(-1, 0.2, 0.7)),
    tip = body(v(0.4, -0.3, 1));
  child.properties.centerOfMass.set(-0.4, 0.2, 0.5);
  child.properties.inertia.set(1, 2, 4);
  child.state.angularVelocity.set(-3, 5, 1);
  tip.properties.centerOfMass.set(0.1, 0.3, -0.5);
  tip.state.angularVelocity.set(1, -4, 2);
  const first = createBallJoint(
    child,
    root,
    v(0.2, -0.4, 0.1),
    v(0.4, 0.2, -0.3),
  );
  const second = createHingeJoint(
    tip,
    child,
    v(-0.1, 0.2, 0.3),
    v(0.8, -0.4, 0.1),
    v(0, 1, 0),
    v(0, 1, 0),
  );
  child.joint = first;
  tip.joint = second;
  const phase = createHierarchyMotionPhase(
    [tip, root, child],
    [first, second],
    STEP,
  );
  for (const item of [root, child, tip]) {
    checkEnvelope(item, phase.paths.get(item));
    assert.ok(
      phase.paths
        .get(item)
        .guardMotion.delta.distanceTo(
          root.state.velocity.clone().multiplyScalar(STEP),
        ) < 1e-12,
    );
  }
});

function nestedCOMHinges(rate) {
  const parent = body(v(), 0.01, true);
  const child = body(v(1, 0, 0), 0.04),
    tip = body(v(2, 0, 0), 0.04);
  child.properties.centerOfMass.set(0.3, 0.1, 0.2);
  tip.properties.centerOfMass.set(-0.2, 0.3, 0.1);
  child.state.angularVelocity.y = rate;
  tip.state.angularVelocity.y = rate * 1.5;
  const first = createHingeJoint(
    child,
    parent,
    v(),
    v(1, 0, 0),
    v(0, 1, 0),
    v(0, 1, 0),
  );
  const second = createHingeJoint(
    tip,
    child,
    v(),
    v(1, 0, 0),
    v(0, 1, 0),
    v(0, 1, 0),
  );
  child.joint = first;
  tip.joint = second;
  return { parent, child, tip, joints: [first, second] };
}

test("nested COM and hinge levers certify a distant candidate without sampled intervals", () => {
  const { parent, child, tip, joints } = nestedCOMHinges(1);
  const wall = body(v(2, 1, 0), 0.04, true);
  const phase = createHierarchyMotionPhase(
    [parent, child, tip, wall],
    joints,
    STEP,
  );
  checkEnvelope(child, phase.paths.get(child));
  checkEnvelope(tip, phase.paths.get(tip));
  assert.ok(
    phase.paths.get(tip).guardMotion.centerError >
      phase.paths.get(child).guardMotion.centerError,
  );
  const { limits, diagnostics } = run(
    phase.paths,
    (a, b) => (a === tip && b === wall) || (a === wall && b === tip),
  );
  assert.equal(limits.get(tip), 1);
  assert.ok(diagnostics.pairGuardCalls > 0);
  assert.ok(diagnostics.clearanceHullCertificates > 0);
  assert.equal(diagnostics.sampledIntervals, 0);
  assert.equal(diagnostics.guardFeatureSweeps, 0);
});

test("nested hinge COM motion that reaches an obstacle receives no clearance certificate", () => {
  const { parent, child, tip, joints } = nestedCOMHinges(30);
  const captured = createHierarchyMotionPhase(
    [parent, child, tip],
    joints,
    STEP,
  );
  const wall = body(captured.paths.get(tip)(0.6).position.clone(), 0.04, true);
  const phase = createHierarchyMotionPhase(
    [parent, child, tip, wall],
    joints,
    STEP,
  );
  const pt = phase.paths.get(tip),
    pw = phase.paths.get(wall);
  checkEnvelope(tip, pt);
  assert.equal(depth(tip, wall, pt, pw, 0), 0);
  assert.ok(depth(tip, wall, pt, pw, 0.6) > 0);
  const expected = legacyGuardPairTrajectory(tip, wall, pt, pw);
  const { limits, diagnostics } = run(
    phase.paths,
    (a, b) => (a === tip && b === wall) || (a === wall && b === tip),
  );
  assert.ok(limits.get(tip) > 0 && limits.get(tip) < 0.6);
  assert.equal(limits.get(tip), expected);
  assert.equal(diagnostics.clearanceHullCertificates, 0);
  assert.ok(diagnostics.sampledIntervals > 0);
});

test("translation joints and their hinge descendants retain uncertified fallback paths", () => {
  const parent = body(v(), 0.01, true),
    slider = body(v(1, 0, 0)),
    tip = body(v(2, 0, 0));
  const translation = createTranslationJoint(
    slider,
    parent,
    v(),
    v(1, 0, 0),
    v(1, 0, 0),
    2,
  );
  const hinge = createHingeJoint(
    tip,
    slider,
    v(),
    v(1, 0, 0),
    v(0, 1, 0),
    v(0, 1, 0),
  );
  slider.joint = translation;
  tip.joint = hinge;
  const phase = createHierarchyMotionPhase(
    [parent, slider, tip],
    [translation, hinge],
    STEP,
  );
  assert.equal(phase.paths.get(slider).guardMotion, undefined);
  assert.equal(phase.paths.get(tip).guardMotion, undefined);
});

test("captured translating bodies revalidate unequal prefixes before committing a convoy", () => {
  const car = body(v(-0.6, 0, 0), 0.2),
    prop = body(v(), 0.2);
  const wall = body(v(0.45, 0, 0), 0.2, true);
  const paths = new Map([
    [car, move(car, v(1, 0, 0))],
    [prop, move(prop, v(1, 0, 0))],
    [wall, createRigidBodyPosePath(wall, STEP)],
  ]);
  const { limits, diagnostics } = run(paths);
  assert.ok(limits.get(prop) < 1);
  assert.equal(limits.get(car), limits.get(prop));
  assert.ok(diagnostics.revalidationCalls > 0);
  assert.ok(diagnostics.translationHullQueries > 0);
  assert.equal(diagnostics.sampledIntervals, 0);
  assert.equal(diagnostics.conservativeFallbacks, 0);
  for (const [a, b] of [
    [car, prop],
    [car, wall],
    [prop, wall],
  ])
    assert.ok(
      depth(a, b, paths.get(a), paths.get(b), limits.get(a), limits.get(b)) <=
        1.01e-6,
    );
});

for (const mutation of [
  "inertia",
  "centerOfMass",
  "immovable",
  "rotationLocked",
])
  test(`a borrowed rigid path loses its certificate when ${mutation} changes`, () => {
    const a = body(v(-1, 0, 0)),
      b = body(v(), 0.1, true);
    const pa = move(a, v(2, 0, 0)),
      pb = createRigidBodyPosePath(b, STEP);
    assert.ok(pa.guardMotion);
    if (mutation === "inertia") a.properties.inertia.y = 2;
    else if (mutation === "centerOfMass") a.properties.centerOfMass.x = 0.25;
    else a.properties[mutation] = true;
    assert.equal(pa.guardMotion, undefined);
    const expected = legacyGuardPairTrajectory(a, b, pa, pb);
    const { limits, diagnostics } = pair(a, b, pa, pb);
    assert.equal(limits.get(a), expected);
    assert.equal(diagnostics.clearanceHullTests, 0);
    assert.equal(diagnostics.translationHullQueries, 0);
    if (mutation !== "immovable") assert.ok(diagnostics.sampledIntervals > 0);
  });
