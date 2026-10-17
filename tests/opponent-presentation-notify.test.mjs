import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { NativeOpponentFleet } from "../src/ai/runtime.ts";

const nodes = Array.from(
  { length: 12 },
  (_, i) =>
    new Vector3(
      100 * Math.cos((i * Math.PI) / 6),
      0,
      100 * Math.sin((i * Math.PI) / 6),
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

function car(human) {
  const group = new Group();
  group.uuid = human ? "player" : "rival";
  return {
    human,
    group,
    poseEpoch: 0,
    state: {
      position: new Vector3(100, 0, 0),
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

function fixture(observe, fallback) {
  const player = car(true),
    rival = car(false),
    inactive = new Set(),
    events = [],
    notifications = [];
  let randomCalls = 0;
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
      random: () => {
        randomCalls++;
        return 0;
      },
      rayFraction: () => 2,
      isPhysicsActive: (body) => !inactive.has(body),
      setPhysicsActive: (body, active) => {
        events.push(active ? "physics-on" : "physics-off");
        if (active) inactive.delete(body);
        else inactive.add(body);
        body.group.visible = active;
      },
      ...(observe
        ? {
            onCheatyPose(body) {
              assert.equal(body, rival);
              assert.ok(inactive.has(body));
              assert.equal(body.group.visible, false);
              assert.deepEqual(body.group.position, body.state.position);
              assert.deepEqual(
                body.group.quaternion.toArray(),
                body.state.orientation.toArray(),
              );
              assert.deepEqual(
                body.group.matrixWorld.elements.slice(12, 15),
                body.state.position.toArray(),
              );
              notifications.push({
                position: body.state.position.clone(),
                orientation: body.state.orientation.clone(),
                epoch: body.poseEpoch,
              });
            },
          }
        : {}),
      rematerialize: (body) => {
        events.push(fallback ? "fallback" : "rematerialize");
        if (fallback) fleet.teleportToSafeLocation(body);
        else {
          inactive.delete(body);
          body.group.visible = true;
          body.poseEpoch++;
        }
        return 1;
      },
      rematerializeNearest: (body) => {
        inactive.delete(body);
        events.push("nearest");
        return 1;
      },
      hasFallenOffWorld: () => false,
      repair: () => events.push("repair"),
    },
  );
  fleet.add(rival, 0, 0);
  return {
    fleet,
    player,
    rival,
    inactive,
    events,
    notifications,
    nativeState: () => ({
      fleet: fleet.snapshot,
      state: rival.state,
      input: rival.input,
      poseEpoch: rival.poseEpoch,
      visible: rival.group.visible,
      position: rival.group.position,
      orientation: rival.group.quaternion.toArray(),
      randomCalls,
      events,
    }),
  };
}

for (const fallback of [false, true])
  test(`cheaty presentation observer preserves native decisions through ${fallback ? "fallback" : "rematerialization"}`, () => {
    const baseline = fixture(false, fallback),
      observed = fixture(true, fallback);
    const update = (nowMs) => {
      baseline.fleet.update(nowMs, 16, 1, false);
      observed.fleet.update(nowMs, 16, 1, false);
      assert.deepEqual(observed.nativeState(), baseline.nativeState());
    };
    update(100);
    assert.equal(observed.notifications.length, 0, "physical poses are silent");
    for (const f of [baseline, observed]) f.player.state.position.x = 500;
    update(5000);
    assert.equal(observed.notifications.length, 1);
    assert.equal(observed.fleet.snapshot.rivals[0].cheating, true);
    const entered = observed.notifications[0].position.clone();
    update(5016);
    assert.equal(observed.notifications.length, 2);
    assert.ok(observed.notifications[1].position.distanceTo(entered) > 0);
    for (const f of [baseline, observed])
      f.player.state.position.copy(f.rival.state.position);
    update(5032);
    assert.equal(observed.notifications.length, 2, "placement is silent");
    assert.ok(
      observed.events.includes(fallback ? "fallback" : "rematerialize"),
    );
    assert.equal(observed.inactive.has(observed.rival), fallback);
    assert.equal(observed.rival.poseEpoch, 1);
    if (fallback) {
      assert.equal(observed.rival.group.visible, false);
      assert.notDeepEqual(
        observed.rival.state.position,
        observed.notifications.at(-1).position,
      );
    }
  });
