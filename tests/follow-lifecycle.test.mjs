import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  NativeFollowLifecycle,
  nativeFollowRematerializationSpeed,
} from "../src/ai/follow-lifecycle.ts";
import { NativePhysicalPathFollower } from "../src/ai/path-follow.ts";

const v = (x, y = 0, z = 0) => new Vector3(x, y, z);
const nodes = [v(0), v(10)];
const section = (maxSpeed = [255, 255], minSpeed = [0, 0]) => ({
  nodeIndices: [0, 1],
  minSpeed,
  maxSpeed,
  width: 4,
  type: 0,
  oneWay: false,
});
const sections = [section()];
const route = [{ section: 0, direction: 1 }];
const query = (overrides = {}) => ({
  position: v(2),
  velocity: v(3, 4, 0),
  dtMs: 16,
  nowMs: 1000,
  maxCurve: 1,
  mass: 1000,
  factor: 1,
  engineDamage: 0,
  transmissionDamage: 0,
  currentCurvature: 0,
  cheating: false,
  physical: true,
  ...overrides,
});

class MockPhysicalFollower extends NativePhysicalPathFollower {
  trace = [];
  result = {
    kind: "ok",
    madeIt: true,
    movedOnTask: false,
    struggleCount: 0,
    geometry: {
      sectionSlot: 0,
      desiredSpeed: 0,
      escape: { timeMs: 0, flipped: false },
    },
    curvature: 0,
    accForce: 4,
    brakeForce: 5,
  };

  start(now, slot) {
    this.trace.push(["start", now, slot]);
  }

  setSectionSlot(slot) {
    this.trace.push(["slot", slot]);
  }

  syncCarForces(acc, brake) {
    this.trace.push(["sync-forces", acc, brake]);
  }

  run(trackNodes, trackSections, entries, input, random) {
    this.trace.push(["run", input, entries, random]);
    return this.result;
  }
}

function hooks(trace = [], rematOnSection = () => 1, rematNearest = () => 0) {
  return {
    trace,
    turnPhysicsOff() {
      trace.push("physics-off");
    },
    applyCheatyPose(result) {
      trace.push(["pose", result]);
    },
    clearCarForces() {
      trace.push("clear-forces");
    },
    rematerializeOnSection(slot, speed) {
      trace.push(["remat-section", slot, speed]);
      return rematOnSection(slot, speed);
    },
    rematerializeOnNearestSection(speed) {
      trace.push(["remat-nearest", speed]);
      return rematNearest(speed);
    },
  };
}

function started({
  follower = new MockPhysicalFollower(),
  initial = query(),
  hookSet = hooks(),
} = {}) {
  const state = new NativeFollowLifecycle(follower);
  state.start(initial, hookSet);
  return { state, follower, hookSet };
}

test("physical lifecycle delegates query and maps follower given-up to status2", () => {
  const follower = new MockPhysicalFollower();
  follower.result = { ...follower.result, kind: "given-up" };
  const { state } = started({ follower });
  const input = query({ dtMs: 25 });
  const result = state.run(nodes, sections, route, input, hooks(), () => 0.25);
  assert.equal(result.kind, "physical");
  assert.equal(result.status, 2);
  assert.equal(result.follower.kind, "given-up");
  const call = follower.trace.find((entry) => entry[0] === "run");
  assert.equal(call[1], input);
  assert.equal(call[3](), 0.25);
});

test("START resets follow cheating and rematerializes nearest only for nonphysical, noncheating input", () => {
  for (const [physical, cheating, expectedCalls] of [
    [false, false, 1],
    [true, false, 0],
    [false, true, 0],
    [true, true, 0],
  ]) {
    const trace = [];
    const follower = new MockPhysicalFollower();
    const lifecycle = new NativeFollowLifecycle(follower);
    lifecycle.start(query({ physical, cheating }), hooks(trace));
    assert.equal(lifecycle.snapshot.cheating, false);
    assert.equal(
      trace.filter(
        (entry) => Array.isArray(entry) && entry[0] === "remat-nearest",
      ).length,
      expectedCalls,
    );
  }
  const trace = [];
  const lifecycle = new NativeFollowLifecycle(new MockPhysicalFollower());
  lifecycle.start(query({ physical: false, velocity: v(3, 4) }), hooks(trace));
  assert.deepEqual(trace, [["remat-nearest", 5]]);
});

test("cheaty entry turns physics off before pose apply and carries no orientation or collision velocity", () => {
  const { state } = started();
  const trace = [];
  const result = state.run(
    nodes,
    sections,
    route,
    query({ cheating: true, position: v(2), dtMs: 0 }),
    hooks(trace),
  );
  assert.equal(result.kind, "cheaty");
  assert.equal(result.status, 0);
  assert.deepEqual(
    trace.map((entry) => (typeof entry === "string" ? entry : entry[0])),
    ["physics-off", "pose"],
  );
  assert.equal(result.movement.requestPhysicsOff, true);
  assert.equal(result.movement.velocity, undefined);
  assert.equal(result.movement.lookVector, undefined);
});

test("stable cheating uses F32 41.4 velocity and path end clears forces with status1", () => {
  const { state, follower } = started();
  state.run(
    nodes,
    sections,
    route,
    query({ cheating: true, position: v(2), dtMs: 16 }),
    hooks(),
  );
  const trace = [];
  const result = state.run(
    nodes,
    sections,
    [{ section: 0, direction: 1 }],
    query({ cheating: true, position: v(9.5), dtMs: 200 }),
    hooks(trace),
  );
  assert.equal(result.kind, "cheaty");
  assert.equal(result.status, 1);
  assert.equal(result.movement.kind, "path-end");
  assert.deepEqual(result.movement.velocity.toArray(), [
    0,
    Math.fround(41.4),
    0,
  ]);
  assert.deepEqual(
    trace.map((entry) => (typeof entry === "string" ? entry : entry[0])),
    ["pose", "clear-forces"],
  );
  assert.ok(
    follower.trace.some(
      (entry) => entry[0] === "sync-forces" && entry[1] === 0 && entry[2] === 0,
    ),
  );
});

test("rematerialization uses authored max, then authored min, then clamped Float32 distance fallback", () => {
  assert.equal(
    nativeFollowRematerializationSpeed(
      v(2),
      nodes,
      [section([80, 90])],
      route,
      0,
    ),
    Math.fround(90 * 0.14492753623188406),
  );
  assert.equal(
    nativeFollowRematerializationSpeed(
      v(2),
      nodes,
      [section([255, 255], [10, 20])],
      route,
      0,
    ),
    Math.fround(20 * 0.14492753623188406),
  );
  assert.equal(
    nativeFollowRematerializationSpeed(v(9.9), nodes, sections, route, 0),
    1,
  );
  assert.equal(
    nativeFollowRematerializationSpeed(v(-10), nodes, sections, route, 0),
    7,
  );
});

test("nonzero rematerialization return clears forces and defers physical call even when already physical", () => {
  const follower = new MockPhysicalFollower();
  const { state } = started({ follower });
  state.run(
    nodes,
    sections,
    route,
    query({ cheating: true, position: v(2), dtMs: 0 }),
    hooks(),
  );
  const trace = [];
  const result = state.run(
    nodes,
    sections,
    route,
    query({ cheating: false, physical: true }),
    hooks(trace, () => 2),
  );
  assert.deepEqual(result, { kind: "rematerialized", status: 0 });
  assert.deepEqual(
    trace.map((entry) => (typeof entry === "string" ? entry : entry[0])),
    ["remat-section", "clear-forces"],
  );
  assert.equal(
    follower.trace.some((entry) => entry[0] === "run"),
    false,
  );
  assert.ok(
    follower.trace.some(
      (entry) => entry[0] === "sync-forces" && entry[1] === 0 && entry[2] === 0,
    ),
  );
});

test("zero rematerialization return restores cheaty mode and continues stable movement without made-it change", () => {
  const { state } = started();
  state.run(
    nodes,
    sections,
    route,
    query({ cheating: true, position: v(2), dtMs: 0 }),
    hooks(),
  );
  const trace = [];
  const result = state.run(
    nodes,
    sections,
    route,
    query({ cheating: false, position: v(2), dtMs: 0 }),
    hooks(trace, () => 0),
  );
  assert.equal(result.kind, "cheaty");
  assert.equal(result.status, 0);
  assert.ok(result.movement.velocity);
  assert.equal(state.snapshot.cheating, true);
  assert.equal("madeIt" in state.snapshot, false);
  assert.deepEqual(
    trace.map((entry) => (typeof entry === "string" ? entry : entry[0])),
    ["remat-section", "pose"],
  );
});

test("public cursor synchronization updates follower and cheaty path cursor", () => {
  const follower = new MockPhysicalFollower();
  const { state } = started({ follower });
  state.setSectionSlot(2);
  assert.equal(state.snapshot.sectionSlot, 2);
  assert.deepEqual(follower.trace.at(-1), ["slot", 2]);
  const trace = [];
  const result = state.run(
    nodes,
    sections,
    [route[0], route[0], route[0]],
    query({ cheating: true, dtMs: 0 }),
    hooks(trace),
  );
  assert.equal(result.movement.state.sectionSlot, 2);
  state.setSectionSlot(0);
  assert.equal(state.snapshot.sectionSlot, 0);
});

test("negative or out-of-u32 frame period is rejected before mode transition", () => {
  const { state } = started();
  for (const dtMs of [-1, 0x100000000]) {
    assert.throws(
      () =>
        state.run(
          nodes,
          sections,
          route,
          query({ cheating: true, dtMs }),
          hooks(),
        ),
      /frame period/,
    );
    assert.equal(state.snapshot.cheating, false);
  }
});
