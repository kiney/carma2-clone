import test from "node:test";
import assert from "node:assert/strict";
import { Vector3, Quaternion, Group } from "three";
import { NativeOpponentFleet } from "../src/ai/runtime.ts";

const nodes = Array.from(
  { length: 12 },
  (_, i) =>
    new Vector3(
      10 * Math.cos((i * Math.PI) / 6),
      0,
      10 * Math.sin((i * Math.PI) / 6),
    ),
);
const sections = nodes.map((_, i) => ({
  nodeIndices: [i, (i + 1) % 12],
  minSpeed: [0, 0],
  maxSpeed: [80, 80],
  width: 4,
  type: 1,
  oneWay: false,
}));
function car(human, x) {
  return {
    human,
    group: new Group(),
    state: {
      position: new Vector3(x, 0, 0),
      velocity: new Vector3(),
      orientation: new Quaternion(),
      angularVelocity: new Vector3(),
      accForce: 0,
      brakeForce: 0,
      curvature: 0,
      rpm: 0,
      gear: 0,
    },
    properties: { mass: 1000 },
    motion: { maxCurve: 1 },
    damage: { componentLevels: new Uint8Array(12) },
    input: { throttle: 0, steer: 0, brake: 0, handbrake: false },
    crashRecord: { cachedDirection: new Vector3(0, 0, -1), accumulator: 0 },
    knackered: false,
  };
}
function fixture(overrides = {}, initialization) {
  const player = car(true, 10),
    rival = car(false, 10),
    inactive = new Set(),
    events = [];
  const fleet = new NativeOpponentFleet(
    nodes,
    sections,
    [{ strengthRating: 3 }],
    1,
    player,
    {
      skill: 1,
      raceIndex: 0,
      raceCount: 10,
      viewDistance: 45,
      repairLimits: [120, 240],
      random: () => 0,
      rayFraction: () => 2,
      isPhysicsActive: (b) => !inactive.has(b),
      setPhysicsActive: (b, active) => {
        events.push(active ? "physics-on" : "physics-off");
        if (active) inactive.delete(b);
        else inactive.add(b);
      },
      rematerialize: (b) => {
        inactive.delete(b);
        events.push("rematerialize");
        return 1;
      },
      rematerializeNearest: (b) => {
        inactive.delete(b);
        return 1;
      },
      hasFallenOffWorld: () => false,
      recoverFallen: () => {},
      repair: () => events.push("repair"),
      ...overrides,
    },
  );
  fleet.add(rival, 0, 0, initialization);
  return { fleet, player, rival, inactive, events };
}

// Count-zero's native unsigned timer cannot finish in an ordinary short run.
// Inject only the later borrowed-recovery record, then exercise the real fleet
// dispatcher, follower give-up, local route restart and car-force application.
function enterExpiredBorrowedRecovery(fleet, rival) {
  const record = fleet.rivals.get(rival.group.uuid);
  record.follow.physicalFollower.madeIt = false;
  record.follow.physicalFollower.borrowedStartMs = 0;
  return record;
}

test("borrowed give-up and local restart preserve actual car force fields", () => {
  const { fleet, rival } = fixture({ rayFraction: () => 0 });
  fleet.update(100, 16, 1, false);
  const record = enterExpiredBorrowedRecovery(fleet, rival);
  const objectiveBefore = fleet.snapshot.rivals[0].objective;
  assert.equal(record.follow.physicalFollower.accForce, 12000);
  rival.state.accForce = 7;
  rival.state.brakeForce = 8;

  fleet.update(10001, 16, 1, false);

  assert.deepEqual([rival.state.accForce, rival.state.brakeForce], [7, 8]);
  assert.equal(record.follow.physicalFollower.madeIt, true);
  assert.equal(record.follow.physicalFollower.borrowedStartMs, 10001);
  assert.deepEqual(fleet.snapshot.rivals[0].objective, objectiveBefore);
});

test("borrowed give-up preserves countdown brake written before the same objective run", () => {
  let countdown = 0;
  const { fleet, rival } = fixture({
    rayFraction: () => 0,
    countdown: () => countdown,
  });
  // Acknowledge the start once so the later countdown command does not retain
  // initialization stun; ProcessThisOpponent still writes its normal brake.
  fleet.update(100, 16, 1, false);
  const record = enterExpiredBorrowedRecovery(fleet, rival);
  const objectiveBefore = fleet.snapshot.rivals[0].objective;
  rival.state.accForce = 7;
  rival.state.brakeForce = 8;
  countdown = 1;

  fleet.update(10001, 16, 1, false);

  assert.deepEqual([rival.state.accForce, rival.state.brakeForce], [7, 10000]);
  assert.equal(record.follow.physicalFollower.madeIt, true);
  assert.equal(record.follow.physicalFollower.borrowedStartMs, 10001);
  assert.deepEqual(fleet.snapshot.rivals[0].objective, objectiveBefore);
});
