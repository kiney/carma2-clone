import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  hullPenetration,
  nativeHullRecoveryOverlap,
  transformHull,
} from "../src/physics/geometry.ts";
import {
  BodyTrajectoryGuard,
  guardPairTrajectory,
} from "../src/physics/pair-guard.ts";
import { createHierarchyMotionPhase } from "../src/physics/hierarchy-motion.ts";
import { readFile } from "node:fs/promises";
import { hydrateCapturedBodies } from "./support/captured-bodies.mjs";

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
    properties: { mass: 1, inertia: v(1, 1, 1), centerOfMass: v() },
    overlapRecovery: false,
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

test("positive shallow OLD SAT overlap admits the full native recovery path independent of flags", () => {
  const a = box(-0.1995),
    b = box(0.1995);
  const oldDepth = hullPenetration(at(a), at(b));
  assert.ok(oldDepth > 1e-6 && oldDepth < 0.002);
  assert.equal(nativeHullRecoveryOverlap(at(a), at(b)), true);
  assert.equal(a.overlapRecovery, false);
  assert.equal(b.overlapRecovery, false);

  const fraction = guardPairTrajectory(
    a,
    b,
    linear(a, v(0.03)),
    linear(b, v(-0.03)),
  );
  assert.equal(fraction, 1);
  assert.equal(a.overlapRecovery, false);
  assert.equal(b.overlapRecovery, false);
});

test("initially clear geometry still guards re-entry on a later phase", () => {
  const a = box(-0.5),
    b = box(0.5);
  assert.equal(nativeHullRecoveryOverlap(at(a), at(b)), false);
  const fraction = guardPairTrajectory(a, b, linear(a, v(1)), linear(b, v(-1)));
  assert.ok(fraction > 0 && fraction < 1);
  assert.equal(a.overlapRecovery, false);
  assert.equal(b.overlapRecovery, false);
});

test("another initially clear hull of the same body remains guarded", () => {
  const car = box(-0.1),
    debris = box(0.1, 0.08);
  car.hulls.push(buildBoxHull(v(0.31, -0.04, -0.04), v(0.39, 0.04, 0.04)));
  debris.owner = car;
  assert.equal(nativeHullRecoveryOverlap(at(car), at(debris)), true);
  assert.equal(
    nativeHullRecoveryOverlap(at(car, car.hulls[1]), at(debris)),
    false,
  );

  const pathCar = linear(car, v(-1)),
    pathDebris = linear(debris);
  const fraction = guardPairTrajectory(car, debris, pathCar, pathDebris);
  assert.ok(fraction > 0 && fraction < 1);
  assert.equal(car.overlapRecovery, false);
  assert.equal(debris.overlapRecovery, false);
});

test("admitted overlap does not exempt a third body", () => {
  const car = box(-0.1),
    debris = box(0.1, 0.08),
    wall = box(-0.8, 0.05);
  debris.owner = car;
  wall.properties.immovable = true;
  const pathCar = linear(car, v(-1)),
    pathDebris = linear(debris, v(-1));
  const fractions = new BodyTrajectoryGuard().run(
    [car, debris, wall],
    new Map([
      [car, pathCar],
      [debris, pathDebris],
      [wall, linear(wall)],
    ]),
  );
  assert.ok(fractions.get(car) < 1);
  assert.ok(fractions.get(debris) < 1);
  for (const [body, path] of [
    [car, pathCar],
    [debris, pathDebris],
  ]) {
    const committed = path(fractions.get(body));
    for (const hull of body.hulls)
      assert.ok(
        hullPenetration(
          transformHull(hull, committed.position, committed.orientation),
          at(wall),
        ) <= 1.01e-6,
        `Body independently stops at wall: ${body === car ? "car" : "debris"}`,
      );
  }
});

test("mere tolerance touching does not receive blanket recovery admission", () => {
  const a = box(-0.2),
    b = box(0.2);
  assert.ok(hullPenetration(at(a), at(b)) <= 1e-6);
  // Native recovery geometry can recognize the source tolerance band; the
  // guard's positive SAT depth threshold must still reject blanket admission.
  const fraction = guardPairTrajectory(a, b, linear(a, v(0.2)), linear(b));
  assert.ok(fraction < 0.01);
  assert.equal(a.overlapRecovery, false);
  assert.equal(b.overlapRecovery, false);
});

test("optional perf18 capture admits qualified 3/7 motion and retains player progress", async (t) => {
  let sourceText;
  try {
    sourceText = await readFile("artifacts/perf18-user-interlock.json", "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Optional ignored perf18 capture absent");
      return;
    }
    throw error;
  }
  const source = JSON.parse(sourceText);
  const hydrated = hydrateCapturedBodies(source);
  const mach13 = hydrated.byId.get(3);
  const other = hydrated.byId.get(7);
  const player = hydrated.byId.get(source.playerId);
  assert.ok(mach13 && other && player, "Capture contains bodies 0, 3, and 7");
  mach13.overlapRecovery = false;
  other.overlapRecovery = false;
  const qualifies = mach13.hulls.some((hullA) =>
    other.hulls.some((hullB) => {
      const worldA = transformHull(
        hullA,
        mach13.state.position,
        mach13.state.orientation,
      );
      const worldB = transformHull(
        hullB,
        other.state.position,
        other.state.orientation,
      );
      return (
        hullPenetration(worldA, worldB) > 1e-6 &&
        nativeHullRecoveryOverlap(worldA, worldB)
      );
    }),
  );
  assert.ok(
    qualifies,
    "Mach13 (body 3) and debris (body 7) contain a native-qualified positive SAT overlap",
  );
  const phase = createHierarchyMotionPhase([mach13, other], [], 0.04);
  assert.equal(
    guardPairTrajectory(
      mach13,
      other,
      phase.paths.get(mach13),
      phase.paths.get(other),
    ),
    1,
  );

  const allBodies = [...hydrated.byId.values()];
  const fullPhase = createHierarchyMotionPhase(
    allBodies,
    hydrated.joints,
    0.04,
  );
  const fractions = new BodyTrajectoryGuard().run(allBodies, fullPhase.paths);
  const committed = fullPhase.pose(player, fractions.get(player));
  assert.ok(
    committed.position.distanceTo(player.state.position) > 1e-5,
    "Player retains physical movement in the full captured roster",
  );
});
