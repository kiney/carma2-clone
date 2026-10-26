import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
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
  nodeIndices: [i, (i + 1) % nodes.length],
  minSpeed: [0, 0],
  maxSpeed: [80, 80],
  width: 4,
  type: 1,
  oneWay: false,
}));
function car(human) {
  return {
    human,
    group: new Group(),
    state: {
      position: new Vector3(10, 0, 0),
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
function fixture(initialTimeMs) {
  const player = car(true),
    rival = car(false),
    rays = [];
  let draws = 0;
  const fleet = new NativeOpponentFleet(
    nodes,
    sections,
    [{ strengthRating: 3 }],
    1,
    player,
    {
      initialTimeMs,
      skill: 1,
      raceIndex: 0,
      raceCount: 10,
      viewDistance: 45,
      repairLimits: [120, 240],
      random: () => {
        draws++;
        return 0;
      },
      rayFraction: () => {
        rays.push(true);
        return 2;
      },
      isPhysicsActive: () => true,
      setPhysicsActive() {},
      rematerialize: () => 1,
      rematerializeNearest: () => 1,
      hasFallenOffWorld: () => false,
      repair() {},
    },
  );
  fleet.add(rival, 0, 0);
  return { fleet, rival, player, rays, draws: () => draws };
}

test("publication clock initializes contact and objective state without consuming the first frame", () => {
  const zero = fixture(),
    shifted = fixture(5000);
  for (const [fixture, start] of [
    [zero, 0],
    [shifted, 5000],
  ]) {
    const initial = fixture.fleet.snapshot;
    assert.equal(initial.nowMs, start);
    assert.equal(initial.firstFrame, true);
    assert.equal(initial.rivals[0].contact.contactTimeMs, start);
    assert.equal(initial.rivals[0].selector.nextOutOfWorldCheckMs, start + 500);
    assert.equal(initial.rivals[0].selector.objectiveStartMs, start);
    assert.equal(initial.rivals[0].objective.startMs, start);
    assert.equal(initial.rivals[0].objective.objective, "none");
    assert.equal(initial.rivals[0].repair.lastRepairMs, start);
    assert.equal(initial.playerTrail.recordingCount, 0);
    assert.equal(
      fixture.draws(),
      2,
      "initial repair interval and visibility draws only",
    );
    fixture.fleet.update(start + 100, 16, 1, false);
    const active = fixture.fleet.snapshot;
    assert.equal(active.firstFrame, false);
    assert.equal(active.rivals[0].objective.objective, "complete-race");
    assert.equal(active.rivals[0].objective.startMs, start + 100);
    assert.equal(active.rivals[0].objective.deadlineMs, start + 20100);
    assert.equal(
      fixture.rays.length,
      0,
      "visibility does not expire during asset staging",
    );
  }
  assert.deepEqual(shifted.rival.input, zero.rival.input);
  assert.deepEqual(
    shifted.fleet.snapshot.rivals[0].forces,
    zero.fleet.snapshot.rivals[0].forces,
  );
  assert.equal(shifted.draws(), zero.draws());
});

test("visibility and grudge deadlines retain strict native boundaries after time translation", () => {
  const zero = fixture(0),
    shifted = fixture(5000);
  for (const [fixture, start] of [
    [zero, 0],
    [shifted, 5000],
  ]) {
    fixture.fleet.update(start + 100, 16, 1, false);
    fixture.fleet.update(start + 2000, 16, 1, false);
    assert.equal(fixture.rays.length, 0);
    fixture.fleet.update(start + 2001, 16, 1, false);
    assert.equal(fixture.rays.length, 1);
    // Freeze keeps later random objective changes out of the decay boundary.
    fixture.fleet.update(start + 10000, 16, 0, false);
    const before = fixture.fleet.snapshot.catalogGrudges[0];
    fixture.fleet.update(start + 10001, 16, 0, false);
    assert.equal(fixture.fleet.snapshot.catalogGrudges[0], before - 2);
  }
  assert.equal(shifted.draws(), zero.draws());
  assert.deepEqual(shifted.fleet.snapshot.counts, zero.fleet.snapshot.counts);
  assert.deepEqual(
    shifted.fleet.snapshot.catalogGrudges,
    zero.fleet.snapshot.catalogGrudges,
  );
  assert.equal(
    shifted.fleet.snapshot.rivals[0].objective.objective,
    zero.fleet.snapshot.rivals[0].objective.objective,
  );
});

test("initial timestamps accept uint32 endpoints and reject malformed clocks", () => {
  const maximum = fixture(0xffffffff).fleet.snapshot;
  assert.equal(maximum.nowMs, 0xffffffff);
  assert.equal(maximum.firstFrame, true);
  assert.equal(maximum.rivals[0].contact.contactTimeMs, 0xffffffff);
  assert.equal(maximum.rivals[0].selector.nextOutOfWorldCheckMs, 499);
  for (const invalid of [-1, 0.5, 0x100000000, NaN, Infinity, null, "5000"])
    assert.throws(
      () => fixture(invalid),
      /Invalid native opponent initial timestamp/,
    );
});
