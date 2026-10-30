import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { NativeCrashRecord } from "../src/physics/crash-record.ts";
import { NativeOpponentPlacement } from "../src/physics/opponent-placement.ts";
import { NativePathView } from "../src/ai/path-view.ts";

function fixture(t, { checkTraction = false } = {}) {
  const world = { querySurfaces: () => [], raycast: () => null };
  const sim = new VehicleSimulation(world, new Group());
  t.after(() => sim.dispose());
  const originalPosition = new Vector3(2, 3, 4);
  const originalOrientation = new Quaternion().setFromAxisAngle(
    new Vector3(1, 0, 0),
    0.7,
  );
  const car = {
    group: new Group(),
    state: {
      position: originalPosition.clone(),
      orientation: originalOrientation.clone(),
      velocity: new Vector3(3, 4, 5),
      angularVelocity: new Vector3(1, 2, 3),
      wheelLengths: [1, 2, 3, 4],
      tractionControl: false,
      accForce: 17,
      brakeForce: 23,
      curvature: 4,
    },
    properties: { mass: 1200 },
    motion: { suspensionBase: { rideHeight: 0.2 } },
    crashRecord: new NativeCrashRecord(),
    poseEpoch: 0,
  };
  car.crashRecord.resetDirection(originalOrientation);
  const resets = [],
    checks = [];
  let active = false,
    fallback;
  // Retain the real per-attempt reset/cache implementation. The fixture has
  // no PHIL roster; activity and obstruction are explicit source boundaries.
  sim.isCarPhysicsActive = () => active;
  sim.setCarPhysicsActive = (_car, value) => {
    active = value;
  };
  sim.wakeQuietPhysics = () => {};
  const reset = sim.rematerializePose.bind(sim);
  sim.rematerializePose = (...args) => {
    reset(...args);
    resets.push({
      position: car.state.position.clone(),
      orientation: car.state.orientation.clone(),
      direction: car.crashRecord.cachedDirection.clone(),
    });
  };
  sim.testCarPlacement = () => {
    checks.push({
      direction: car.crashRecord.cachedDirection.clone(),
      tractionControl: car.state.tractionControl,
    });
    // A previous failed attempt may leave arbitrary tyre-control state;
    // every following native reset must independently re-enable traction.
    if (checkTraction) car.state.tractionControl = false;
    return 0;
  };
  // A zero-length section preserves the admitted tilted actor matrix. Native
  // attempt alignment still replaces tilt with saved yaw on the first retry.
  const nodes = [originalPosition.clone(), originalPosition.clone()];
  const sections = [
    {
      nodeIndices: [0, 1],
      width: 1,
      minSpeed: [0, 0],
      maxSpeed: [255, 255],
      type: 0,
      oneWay: false,
    },
  ];
  const placement = new NativeOpponentPlacement(
    sim,
    world,
    nodes,
    sections,
    () => {
      fallback = {
        position: car.state.position.clone(),
        orientation: car.state.orientation.clone(),
        actorPosition: car.group.position.clone(),
        actorOrientation: car.group.quaternion.clone(),
        direction: car.crashRecord.cachedDirection.clone(),
      };
    },
  );
  const run = () =>
    placement.onSection(
      car,
      NativePathView.projected(nodes, sections, [{ section: 0, direction: 1 }]),
      0,
      8,
    );
  return {
    car,
    run,
    resets,
    checks,
    originalPosition,
    originalOrientation,
    fallback: () => fallback,
    active: () => active,
  };
}

test("exhausted rematerialization performs exactly 24 per-attempt resets", (t) => {
  const f = fixture(t);
  assert.equal(f.run(), 1);
  assert.equal(f.checks.length, 24);
  assert.equal(
    f.resets.length,
    24,
    "native exhaustion restores ACT without a 25th per-attempt cache reset",
  );
});

test("exhausted fallback restores actor pose while retaining last attempt direction for teleport", (t) => {
  const f = fixture(t);
  f.run();
  const fallback = f.fallback();
  assert.equal(f.checks.length, 24);
  assert.ok(
    f.checks
      .at(-1)
      .direction.distanceTo(
        new Vector3(0, 0, -1).applyQuaternion(f.originalOrientation),
      ) > 0.1,
    "tilted saved pose differs meaningfully from last yaw-aligned attempt",
  );
  assert.deepEqual(fallback.position.toArray(), f.originalPosition.toArray());
  assert.deepEqual(
    fallback.actorPosition.toArray(),
    f.originalPosition.toArray(),
  );
  assert.ok(fallback.orientation.angleTo(f.originalOrientation) < 1e-6);
  assert.ok(fallback.actorOrientation.angleTo(f.originalOrientation) < 1e-6);
  assert.equal(f.active(), false);
  assert.equal(f.car.group.visible, false);
  assert.deepEqual(
    fallback.direction.toArray(),
    f.checks.at(-1).direction.toArray(),
    "TeleportOpponentToNearestSafeLocation reads the last cached direction",
  );
});

test("each rematerialization attempt enables traction control before sensible-place test", (t) => {
  const f = fixture(t, { checkTraction: true });
  f.run();
  assert.equal(f.checks.length, 24);
  assert.ok(
    f.checks.every((entry) => entry.tractionControl === true),
    "HW 0x4a8b0b stores car.traction_control=1 before every test at 0x4a8bb4",
  );
});
