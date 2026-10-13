import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  hullPenetration,
  nativeHullRecoveryOverlap,
  recoverHullOverlap,
  transformHull,
} from "../src/physics/geometry.ts";
import {
  BodyTrajectoryGuard,
  guardPairTrajectory,
} from "../src/physics/pair-guard.ts";
import { createHierarchyMotionPhase } from "../src/physics/hierarchy-motion.ts";

const v = (...values) => new Vector3(...values);
function box(x = 0, half = 0.2) {
  return {
    hulls: [buildBoxHull(v(-half, -half, -half), v(half, half, half))],
    state: {
      position: v(x, 0, 0),
      orientation: new Quaternion(),
      velocity: v(),
      angularVelocity: v(),
    },
    properties: {
      mass: 1,
      inertia: v(1, 1, 1),
      centerOfMass: v(),
    },
    overlapRecovery: true,
  };
}
const at = (body, hull = body.hulls[0]) =>
  transformHull(hull, body.state.position, body.state.orientation);
function linear(body, delta = v()) {
  const position = body.state.position.clone();
  const orientation = body.state.orientation.clone();
  const path = (t) => ({
    position: position.clone().addScaledVector(delta, t),
    orientation,
  });
  path.stable = true;
  if (body.properties.immovable) path.constantPose = { position, orientation };
  return path;
}

test("native OLD containment without recovery rows permits full candidate motion", () => {
  const car = box(),
    piece = box(0.05, 0.08);
  piece.owner = car;
  car.state.velocity.x = 1;
  const recovered = recoverHullOverlap(at(car), at(piece), {
    a: car,
    b: piece,
  });
  assert.equal(recovered.overlap, true);
  assert.equal(recovered.contact, null);
  assert.equal(nativeHullRecoveryOverlap(at(car), at(piece)), true);
  const phase = createHierarchyMotionPhase([car, piece], [], 0.04);
  const diag = {};
  const fractions = new BodyTrajectoryGuard().run(
    [car, piece],
    phase.paths,
    undefined,
    diag,
  );
  assert.equal(fractions.get(car), 1);
  assert.equal(fractions.get(piece), 1);
  assert.equal(diag.recoveryHullAdmissions, 1);
  assert.equal(
    diag.hullTransforms,
    2,
    "admitted-only pair does not walk angular samples",
  );
  phase.commit([car, piece], fractions);
  assert.equal(car.state.position.x, 0.04);
  assert.equal(car.state.velocity.x, 1);
});

test("native recovery admission also permits solver-selected motion with type6 rows", () => {
  const a = box(-0.1),
    b = box(0.1);
  a.state.velocity.x = 1;
  b.state.velocity.x = -1;
  const recovery = recoverHullOverlap(at(a), at(b), { a, b });
  assert.equal(recovery.overlap, true);
  assert.ok(recovery.contact?.points.length > 0);
  assert.ok(recovery.contact.contactTypes.every((type) => type === 6));
  assert.equal(
    guardPairTrajectory(a, b, linear(a, v(0.04)), linear(b, v(-0.04))),
    1,
  );
  assert.equal(a.state.velocity.x, 1);
  assert.equal(b.state.velocity.x, -1);
});

test("admission is geometry/state based, not former-owner collision immunity", () => {
  const car = box(),
    piece = box(0.1, 0.08);
  const inward = linear(car, v(0.1));
  assert.equal(guardPairTrajectory(car, piece, inward, linear(piece)), 1);
  piece.owner = car;
  assert.equal(guardPairTrajectory(car, piece, inward, linear(piece)), 1);
  car.overlapRecovery = piece.overlapRecovery = false;
  assert.ok(guardPairTrajectory(car, piece, inward, linear(piece)) < 0.001);
  car.overlapRecovery = true;
  piece.state.position.x = 0.8;
  assert.ok(
    guardPairTrajectory(car, piece, linear(car, v(1)), linear(piece)) < 1,
  );
});

test("clearance rearms new-entry collision on the next captured phase", () => {
  const car = box(),
    piece = box(0.1, 0.08);
  piece.owner = car;
  const escape = linear(car, v(-1));
  assert.equal(guardPairTrajectory(car, piece, escape, linear(piece)), 1);
  car.state.position.copy(escape(1).position);
  assert.equal(nativeHullRecoveryOverlap(at(car), at(piece)), false);
  // Prior-overlap flags can still be set. Geometry must revoke the admission.
  const returnPath = linear(car, v(2));
  const fraction = guardPairTrajectory(car, piece, returnPath, linear(piece));
  assert.ok(fraction > 0.3 && fraction < 0.5);
  const admittedPose = returnPath(fraction);
  assert.ok(
    hullPenetration(
      transformHull(
        car.hulls[0],
        admittedPose.position,
        admittedPose.orientation,
      ),
      at(piece),
    ) <= 1.01e-6,
  );
});

test("native phase admission is not ratcheted by a within-phase depth fluctuation", () => {
  const a = box(-0.1),
    b = box(0.1);
  const excursion = (t) => ({
    position: v(-0.1 - Math.sin(Math.PI * t), 0, 0),
    orientation: new Quaternion(),
  });
  // Native recovery bypasses ordinary CCD for this candidate step. This test
  // records that deliberate policy, rather than asserting continuous reentry
  // protection inside an already admitted source phase.
  assert.equal(guardPairTrajectory(a, b, excursion, linear(b)), 1);
});

test("admitted own debris cannot exempt a new third-body wall collision", () => {
  const car = box(),
    piece = box(0.1, 0.08),
    wall = box(0.8, 0.05);
  piece.owner = car;
  wall.properties.immovable = true;
  const pa = linear(car, v(1)),
    pb = linear(piece, v(1));
  const diag = {};
  const limits = new BodyTrajectoryGuard().run(
    [car, piece, wall],
    new Map([
      [car, pa],
      [piece, pb],
      [wall, linear(wall)],
    ]),
    undefined,
    diag,
  );
  assert.ok(limits.get(car) > 0.5 && limits.get(car) < 0.6);
  const pose = pa(limits.get(car));
  assert.ok(
    hullPenetration(
      transformHull(car.hulls[0], pose.position, pose.orientation),
      at(wall),
    ) <= 1.01e-6,
  );
  assert.ok(diag.recoveryHullAdmissions > 0);
});

test("admission is per hull: another initially clear hull of the same body still blocks", () => {
  const body = box(-0.1),
    obstacle = box(0.1, 0.05);
  body.hulls.push(buildBoxHull(v(-0.6, -0.04, -0.04), v(-0.5, 0.04, 0.04)));
  const path = linear(body, v(1));
  assert.equal(nativeHullRecoveryOverlap(at(body), at(obstacle)), true);
  assert.equal(
    nativeHullRecoveryOverlap(at(body, body.hulls[1]), at(obstacle)),
    false,
  );
  const fraction = guardPairTrajectory(body, obstacle, path, linear(obstacle));
  assert.ok(fraction > 0.6 && fraction < 0.8);
});

test("Boolean native admission matches the authoritative recovery detector for rotated boxes", () => {
  for (const offset of [-0.7, -0.3, 0, 0.13, 0.7])
    for (const angle of [0, 0.4, 1.6]) {
      const a = box(offset),
        b = box(0, 0.12);
      a.state.orientation.setFromAxisAngle(v(0.3, 1, 0.2).normalize(), angle);
      b.state.orientation.setFromAxisAngle(v(0, 1, 0), -angle / 2);
      assert.equal(
        nativeHullRecoveryOverlap(at(a), at(b)),
        recoverHullOverlap(at(a), at(b), { a, b }).overlap,
      );
    }
});
