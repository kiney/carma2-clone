import { planNativeOpponentInitialization } from "../src/ai/startup-plan.ts";
import { NativeRandom } from "../src/native-random.ts";
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

test("live fleet drives shared lifecycle through physical, cheating, rematerialized and frozen/thawed frames", () => {
  const { fleet, player, rival, events } = fixture();
  fleet.update(100, 16, 1, false);
  assert.equal(fleet.snapshot.playerTrail.recordingCount, 1);
  assert.equal(fleet.snapshot.playerTrail.nodes.length, 2);
  assert.equal(fleet.snapshot.rivals[0].trail.recordingCount, 0);
  assert.equal(fleet.snapshot.rivals[0].trail.nodes.length, 0);
  assert.equal(fleet.snapshot.rivals[0].objective.objective, "complete-race");
  assert.equal(fleet.snapshot.rivals[0].physical, true);
  player.state.position.x = 500;
  fleet.update(5000, 16, 1, false);
  assert.equal(fleet.snapshot.rivals[0].cheating, true);
  assert.equal(fleet.snapshot.rivals[0].physical, false);
  const entered = rival.state.position.clone();
  fleet.update(5016, 16, 1, false);
  assert.equal(rival.state.velocity.y, Math.fround(41.4));
  assert.ok(rival.state.position.distanceTo(entered) > 0);
  player.state.position.copy(rival.state.position);
  fleet.update(5032, 16, 1, false);
  assert.equal(fleet.snapshot.rivals[0].cheating, false);
  assert.equal(fleet.snapshot.rivals[0].physical, true);
  assert.deepEqual(events, ["physics-off", "rematerialize"]);
  fleet.update(5048, 16, 0, false);
  assert.equal(fleet.snapshot.rivals[0].objective.objective, "frozen");
  assert.equal(rival.state.accForce, 0);
  assert.equal(rival.state.brakeForce, 15000);
  fleet.update(5064, 16, 1, false);
  assert.equal(fleet.snapshot.rivals[0].objective.objective, "get-near-player");
});

test("attribution consumes the live damage accumulator and game-frame clock; duplicates share catalog grudge", () => {
  const { fleet, player, rival } = fixture();
  fleet.add(car(false, 11), 0, 0);
  fleet.update(100, 16, 1, false);
  rival.crashRecord.accumulator = Math.fround(0.03);
  assert.equal(fleet.onCrashAttribution(player, rival).outcome, "human-hit-ai");
  assert.equal(fleet.snapshot.catalogGrudges[0], 19);
  assert.equal(fleet.snapshot.rivals[0].contact.contactTimeMs, 100);
  assert.equal(fleet.snapshot.rivals[0].contact.flags.scaryBang, true);
  fleet.update(10001, 16, 0, false);
  assert.equal(fleet.snapshot.catalogGrudges[0], 15);
  assert.equal(fleet.snapshot.rivals[0].contact.flags.bigBang, false);
  assert.equal(fleet.snapshot.rivals[0].contact.lastHitter, null);
});

test("native repair runs before objective selection on eligible cheaty frames and retains contact-clock cooldown", () => {
  const { fleet, player, events } = fixture({ repairLimits: [0, 0] });
  fleet.update(100, 16, 1, false);
  player.state.position.x = 500;
  fleet.update(4000, 16, 1, false);
  assert.equal(events[0], "repair");
  assert.equal(fleet.snapshot.rivals[0].repair.lastRepairMs, 4000);
  assert.equal(fleet.snapshot.rivals[0].repair.nextCheckMs, 7000);
});

test("stolen knackered rival levitates visibly with physical activity disabled and finishes above200", () => {
  const { fleet, rival, inactive } = fixture({ isStolen: () => true });
  rival.knackered = true;
  fleet.update(100, 16, 1, false);
  assert.equal(fleet.snapshot.rivals[0].objective.objective, "levitate");
  assert.equal(inactive.has(rival), true);
  assert.equal(rival.group.visible, true);
  fleet.update(30100, 16, 1, false);
  assert.equal(rival.state.position.y, 200);
  assert.equal(fleet.snapshot.rivals[0].objective.finishedForRace, false);
  fleet.update(30101, 16, 1, false);
  assert.equal(fleet.snapshot.rivals[0].objective.finishedForRace, true);
});

test("fleet retains assigned personalities and applies their objectives after the native first-movement gate", () => {
  const { fleet, rival } = fixture({ rayFraction: () => 0 });
  rival.state.velocity.x = 1;
  const forcedRace = car(false, 11),
    forcedNear = car(false, 12),
    forcedPursuit = car(false, 13);
  for (const [body, personality] of [
    [forcedRace, 1],
    [forcedNear, 2],
    [forcedPursuit, 3],
  ]) {
    body.state.velocity.x = 1;
    fleet.add(body, 0, personality);
  }
  fleet.update(100, 16, 1, false);
  assert.deepEqual(
    fleet.snapshot.rivals.map((r) => r.personality),
    [0, 1, 2, 3],
  );
  assert.ok(
    fleet.snapshot.rivals.every(
      (r) => r.objective.objective === "complete-race" && r.movedEver,
    ),
  );
  fleet.update(70000, 16, 1, false);
  assert.deepEqual(
    fleet.snapshot.rivals.slice(1).map((r) => r.objective.objective),
    ["complete-race", "get-near-player", "pursue"],
  );
});

test("fleet empty-route default selects explicit browser continuation without completing GetNear", () => {
  const { fleet, rival } = fixture();
  fleet.update(100, 40, 1, false);
  // An exhausted finished route is the original undefined-return branch.
  // Keep actual roads available to the next GetNear objective.
  const current = fleet.rivals.get(rival.group.uuid);
  current.race.route.clear();
  current.race.state.finished = true;
  fleet.update(140, 40, 1, false);
  const state = fleet.snapshot;
  assert.equal(state.rivals[0].objective.objective, "get-near-player");
  assert.equal(state.rivals[0].objective.newRequired, false);
  // Native old-objective count is recounted next frame; this transition
  // increments GetNear but must not immediately complete/decrement it.
  assert.equal(state.counts.getNear, 1);
  assert.ok(rival.state.position.toArray().every(Number.isFinite));
});

test("safe-relocation closed component reports bounded exhaustion and preserves damage/orientation", () => {
  const diagnostics = [];
  const { fleet, rival, player, inactive } = fixture({
    diagnostic: (message) => diagnostics.push(message),
  });
  rival.state.velocity.set(1, 2, 3);
  rival.state.angularVelocity.set(4, 5, 6);
  rival.state.accForce = 10;
  rival.state.brakeForce = 12;
  rival.state.curvature = 0.1;
  rival.state.gear = 3;
  rival.state.rpm = 4000;
  rival.damage.componentLevels[0] = 42;
  const orientation = rival.state.orientation.clone();
  player.state.position.set(0, 0, 0);
  const result = fleet.teleportToSafeLocation(rival);
  assert.equal(result.kind, "bound-exhausted");
  assert.equal(result.endpointVisits, 4096);
  assert.equal(inactive.has(rival), true);
  assert.equal(rival.group.visible, false);
  assert.deepEqual(rival.state.velocity.toArray(), [0, 0, 0]);
  assert.deepEqual(rival.state.angularVelocity.toArray(), [0, 0, 0]);
  assert.deepEqual(
    [
      rival.state.accForce,
      rival.state.brakeForce,
      rival.state.curvature,
      rival.state.gear,
      rival.state.rpm,
    ],
    [0, 0, 0, 0, 0],
  );
  assert.deepEqual(rival.state.orientation.toArray(), orientation.toArray());
  assert.equal(rival.damage.componentLevels[0], 42);
  assert.deepEqual(rival.state.position.toArray(), result.position.toArray());
  assert.ok(
    diagnostics.some((message) => message.includes("4096 endpoint visits")),
  );
  assert.equal(fleet.snapshot.rivals[0].physical, false);
});

test("reserved opponent initialization binds publication clock without repeating random draws", () => {
  const rng = new NativeRandom(1),
    plan = planNativeOpponentInitialization(5, 1, [120, 240], rng.random),
    before = rng.state;
  const { fleet } = fixture(
    {
      initialTimeMs: 100000,
      random: () => {
        throw new Error("reserved initialization must not draw again");
      },
    },
    plan.instances[0],
  );
  const state = fleet.snapshot.rivals[0];
  assert.equal(
    state.repair.repairIntervalMs,
    plan.instances[0].repairIntervalMs,
  );
  assert.equal(state.repair.lastRepairMs, 100000);
  assert.equal(
    state.visibilityInitialDeadlineMs,
    102000 + plan.instances[0].visibilityDelayMs,
  );
  assert.equal(rng.state, before);
});

test("reserved initialization validates before partial fleet registration", () => {
  for (const initialization of [
    { repairIntervalMs: -1, visibilityDelayMs: 0 },
    { repairIntervalMs: 0, visibilityDelayMs: 901 },
    { repairIntervalMs: NaN, visibilityDelayMs: 0 },
  ]) {
    assert.throws(() => fixture({}, initialization), /initialization/);
  }
  const { fleet } = fixture({}, { repairIntervalMs: 0, visibilityDelayMs: 0 });
  assert.equal(
    fleet.snapshot.rivals[0].repair.repairIntervalMs,
    0,
    "zero is valid reserved data, not a signal to draw again",
  );
});
