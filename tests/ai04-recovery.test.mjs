import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { NativeOpponentFleet } from "../src/ai/runtime.ts";

function car(human, position) {
  return {
    human,
    group: new Group(),
    state: {
      position: position.clone(),
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

function fixture(overrides = {}, radius = 10) {
  const nodes = Array.from(
    { length: 12 },
    (_, i) =>
      new Vector3(
        radius * Math.cos((i * Math.PI) / 6),
        0,
        radius * Math.sin((i * Math.PI) / 6),
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
  const player = car(true, nodes[0]),
    rival = car(false, nodes[0]);
  const inactive = new Set(),
    events = [];
  const makePhysical = (body) => {
    inactive.delete(body);
    body.group.visible = true;
    return 1;
  };
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
      rayFraction: () => 0,
      isPhysicsActive: (body) => !inactive.has(body),
      setPhysicsActive: (body, active) => {
        events.push(active ? "physics-on" : "physics-off");
        if (active) inactive.delete(body);
        else inactive.add(body);
      },
      rematerialize: (body) => {
        events.push("rematerialize");
        return makePhysical(body);
      },
      rematerializeNearest: (body) => {
        events.push("rematerialize-nearest");
        return makePhysical(body);
      },
      hasFallenOffWorld: () => false,
      recoverFallen: () => events.push("recover-fallen"),
      repair: () => events.push("repair"),
      ...overrides,
    },
  );
  // Forced race personality keeps source-derived objective restarts deterministic.
  fleet.add(rival, 0, 1);
  return {
    fleet,
    player,
    rival,
    inactive,
    events,
    record: fleet.rivals.get(rival.group.uuid),
    state: () => fleet.snapshot.rivals[0],
    makePhysical,
  };
}

function enterCountZeroStruggle(f) {
  // Real movement opens the native moved-on-task gate; stationary subsequent
  // frames model a car physically obstructed without fabricating follower flags.
  f.rival.state.velocity.set(0.05, 0, 0);
  f.fleet.update(100, 16, 1, false);
  assert.equal(f.state().movedEver, true);
  f.rival.state.velocity.set(0, 0, 0);
  f.fleet.update(2100, 16, 1, false);
  assert.equal(f.record.follow.physicalFollower.struggleStartMs, 0);
  f.fleet.update(2101, 16, 1, false);
  assert.equal(f.record.follow.physicalFollower.struggleStartMs, 2101);
  assert.equal(f.record.follow.physicalFollower.struggleCount, 0);
  f.fleet.update(2117, 16, 1, false);
  assert.equal(f.rival.state.accForce, -6000);
  assert.equal(f.rival.state.brakeForce, 0);
  assert.equal(f.state().objective.objective, "complete-race");
}

test("reachable count-zero physical struggle persists through deadline equality and restarts strictly after it", () => {
  const f = fixture();
  enterCountZeroStruggle(f);
  const original = f.state().objective;
  assert.equal(original.startMs, 100);
  assert.equal(original.deadlineMs, 20100);
  f.fleet.update(original.deadlineMs, 16, 1, false);
  assert.equal(f.state().objective.startMs, original.startMs);
  assert.equal(f.record.follow.physicalFollower.struggleStartMs, 2101);
  assert.equal(f.rival.state.accForce, -6000);
  assert.equal(f.rival.state.brakeForce, 0);
  f.fleet.update(original.deadlineMs + 1, 16, 1, false);
  assert.equal(f.state().objective.objective, "complete-race");
  assert.equal(f.state().objective.startMs, original.deadlineMs + 1);
  assert.equal(f.state().objective.deadlineMs, original.deadlineMs + 20001);
  assert.equal(f.record.follow.physicalFollower.struggleStartMs, 0);
  assert.equal(f.record.follow.physicalFollower.movedOnTask, false);
  assert.equal(f.state().cheating, false);
  assert.equal(f.state().physical, true);
  assert.deepEqual(f.events, []);
});

test("cheating interrupts a real physical struggle and retries failed rematerialization before succeeding", () => {
  let attempts = 0;
  const f = fixture({
    rematerialize: (body, view, slot, speed) => {
      attempts++;
      assert.ok(view);
      assert.equal(slot, 0);
      assert.equal(speed, Math.fround(80 * 0.14492753623188406));
      if (attempts === 1) return 0;
      return f.makePhysical(body);
    },
  });
  enterCountZeroStruggle(f);
  const deadline = f.state().objective.deadlineMs;
  f.player.state.position.set(500, 0, 0);
  f.fleet.update(5117, 16, 1, false);
  assert.equal(f.state().cheating, false);
  assert.equal(f.rival.state.accForce, -6000);
  f.fleet.update(5118, 16, 1, false);
  assert.equal(f.state().cheating, true);
  assert.equal(f.state().follow.cheating, true);
  assert.equal(f.state().physical, false);
  assert.deepEqual(f.events, ["physics-off"]);
  assert.equal(f.state().objective.deadlineMs, deadline);
  const remotePosition = f.rival.state.position.clone();
  f.player.state.position.copy(remotePosition);
  f.fleet.update(5134, 16, 1, false);
  assert.equal(attempts, 1);
  assert.equal(f.state().cheating, false);
  assert.equal(f.state().follow.cheating, true);
  assert.equal(f.state().physical, false);
  assert.ok(f.rival.state.position.distanceTo(remotePosition) > 0);
  f.fleet.update(5150, 16, 1, false);
  assert.equal(attempts, 2);
  assert.equal(f.state().follow.cheating, false);
  assert.equal(f.state().physical, true);
  assert.equal(f.rival.state.accForce, 0);
  assert.equal(f.rival.state.brakeForce, 0);
  assert.equal(f.state().objective.deadlineMs, deadline);
  assert.equal(f.rival.input.throttle, 0);
  assert.equal(f.rival.input.brake, 0);
  // Successful rematerialization clears forces and returns immediately. It does
  // not START a new objective or erase its retained physical struggle record.
  assert.equal(f.record.follow.physicalFollower.struggleStartMs, 2101);
  f.fleet.update(5166, 16, 1, false);
  assert.equal(attempts, 2);
  assert.equal(f.rival.state.accForce, -6000);
  assert.equal(f.rival.state.brakeForce, 0);
  assert.equal(f.rival.input.throttle, -1);
});

test("fallen-world selector recovery uses fleet relocation and rematerialization callbacks while retaining damage", () => {
  let fallen = false,
    checks = 0;
  const observed = [];
  const f = fixture(
    {
      hasFallenOffWorld: () => {
        checks++;
        return fallen;
      },
      recoverFallen: (body) => {
        observed.push("recover");
        assert.equal(f.inactive.has(body), true);
        assert.equal(body.group.visible, false);
        assert.deepEqual(body.state.velocity.toArray(), [0, 0, 0]);
        assert.deepEqual(body.state.angularVelocity.toArray(), [0, 0, 0]);
        assert.deepEqual([...body.damage.componentLevels], damage);
        assert.deepEqual(body.state.orientation.toArray(), orientation);
      },
      rematerializeNearest: (body, speed) => {
        observed.push("nearest");
        assert.equal(speed, 0);
        assert.deepEqual([...body.damage.componentLevels], damage);
        return f.makePhysical(body);
      },
    },
    100,
  );
  f.rival.damage.componentLevels.set([42, 18, 0, 90]);
  const damage = [...f.rival.damage.componentLevels];
  f.rival.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), 0.7);
  const orientation = f.rival.state.orientation.toArray();
  f.fleet.update(100, 16, 1, false);
  fallen = true;
  f.rival.state.velocity.set(1, -4, 2);
  f.rival.state.angularVelocity.set(3, 4, 5);
  f.fleet.update(500, 16, 1, false);
  assert.equal(checks, 0, "native next-world-check equality does not query");
  f.fleet.update(501, 16, 1, false);
  assert.equal(checks, 1);
  assert.deepEqual(observed, ["recover", "nearest"]);
  assert.equal(f.state().objective.objective, "get-near-player");
  assert.equal(f.state().objective.startMs, 501);
  assert.equal(f.state().physical, true);
  assert.equal(f.rival.group.visible, true);
  assert.deepEqual([...f.rival.damage.componentLevels], damage);
  assert.deepEqual(f.rival.state.orientation.toArray(), orientation);
  assert.equal(f.rival.poseEpoch, 1);
  assert.deepEqual(
    f.rival.group.position.toArray(),
    f.rival.state.position.toArray(),
  );
  assert.ok(f.rival.state.position.distanceTo(f.player.state.position) > 45);
  assert.ok(!f.events.includes("repair"));
});
