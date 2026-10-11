import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { NativeCompleteRaceState } from "../src/ai/complete-race-state.ts";
import { NativePhysicalPathFollower } from "../src/ai/path-follow.ts";
import { NativeRaceRouteState } from "../src/ai/race-route-state.ts";

const v = (x, y = 0, z = 0) => new Vector3(x, y, z);
const section = (a, b, type = 0) => ({
  nodeIndices: [a, b],
  minSpeed: [0, 0],
  maxSpeed: [80, 80],
  width: 4,
  type,
  oneWay: false,
});
const nodes = Array.from({ length: 12 }, (_, i) =>
  v(Math.cos((i * Math.PI) / 6) * 10, 0, Math.sin((i * Math.PI) / 6) * 10),
);
const sections = nodes.map((_, i) =>
  section(i, (i + 1) % nodes.length, i === 0 ? 1 : 0),
);
const query = (overrides = {}) => ({
  position: v(1),
  velocity: v(0),
  dtMs: 16,
  nowMs: 3000,
  maxCurve: 1,
  mass: 1000,
  factor: 1,
  engineDamage: 0,
  transmissionDamage: 0,
  currentCurvature: 0,
  cheating: false,
  ...overrides,
});
const hooks = (events = []) => ({
  newGetNearPlayer() {
    events.push("get-near");
  },
  objectiveComplete() {
    events.push("complete");
  },
});
const state = (trackNodes = nodes, trackSections = sections) =>
  new NativeCompleteRaceState(
    trackNodes,
    trackSections,
    new NativeRaceRouteState(trackNodes.length, trackSections, () => 0),
    new NativePhysicalPathFollower(),
    () => 0,
  );

test("start uses nearest authored section and run advances physical route with complete-race flags", () => {
  const s = state();
  assert.equal(s.start(query()).route[0].section, 11);
  const result = s.run(query({ velocity: v(1) }), hooks());
  assert.equal(result.transition, "continue");
  assert.ok(result.follower);
  assert.equal(result.follower.movedOnTask, true);
  assert.equal(s.hasEverMoved, true);
  assert.equal(result.follower.geometry.sectionSlot, 0);
});

test("physical follower receives all complete-race flags as false", () => {
  class RecordingFollower extends NativePhysicalPathFollower {
    lastQuery;
    run(nodes, sections, route, q, random) {
      this.lastQuery = q;
      return super.run(nodes, sections, route, q, random);
    }
  }
  const follower = new RecordingFollower();
  const race = new NativeRaceRouteState(nodes.length, sections, () => 0);
  const s = new NativeCompleteRaceState(
    nodes,
    sections,
    race,
    follower,
    () => 0,
  );
  s.start(query());
  s.run(
    query({ ignoreEnd: true, neverStruggle: true, pursuit: true }),
    hooks(),
  );
  assert.deepEqual(
    [
      follower.lastQuery.ignoreEnd,
      follower.lastQuery.neverStruggle,
      follower.lastQuery.pursuit,
    ],
    [false, false, false],
  );
});

test("freeze bypasses route preparation and returns native brake force", () => {
  const s = state();
  s.start(query());
  const before = s.entries;
  const result = s.run(query({ factor: 0, velocity: v(3) }), hooks());
  assert.deepEqual(s.entries, before);
  assert.deepEqual(result.forces, { accForce: 0, brakeForce: 15000 });
});

test("empty-route freeze preserves route state and skips hooks", () => {
  const s = state([], []);
  s.start(query());
  const events = [];
  const result = s.run(query({ factor: 0 }), hooks(events));
  assert.deepEqual(result.forces, { accForce: 0, brakeForce: 15000 });
  assert.deepEqual(events, []);
});

test("external cursor shifts and refills route before following", () => {
  const s = state();
  s.start(query());
  const before = s.entries;
  s.setSectionSlot(2);
  const result = s.run(query(), hooks());
  assert.equal(result.transition, "continue");
  assert.notDeepEqual(s.entries, before);
  assert.equal(result.follower.geometry.sectionSlot, 0);
});

test("borrowed-time give-up preserves shared forces before route restart", () => {
  const race = new NativeRaceRouteState(nodes.length, sections, () => 0);
  const follower = new NativePhysicalPathFollower();
  const s = new NativeCompleteRaceState(
    nodes,
    sections,
    race,
    follower,
    () => 0,
  );
  s.start(query());
  follower.madeIt = false;
  follower.borrowedStartMs = 0;
  follower.syncCarForces(7, 8);
  const result = s.run(query({ nowMs: 10001 }), hooks());
  assert.equal(result.follower.kind, "given-up");
  assert.deepEqual(
    [result.follower.accForce, result.follower.brakeForce],
    [7, 8],
  );
  assert.deepEqual([follower.accForce, follower.brakeForce], [7, 8]);
  assert.equal(result.transition, "restarted");
  assert.equal(result.route[0].section, 11);
});

test("struggle give-up zeros shared forces before complete-race restart", () => {
  const race = new NativeRaceRouteState(nodes.length, sections, () => 0);
  const follower = new NativePhysicalPathFollower();
  const s = new NativeCompleteRaceState(
    nodes,
    sections,
    race,
    follower,
    () => 0,
  );
  s.start(query());
  follower.movedOnTask = true;
  follower.struggleCount = 3;
  follower.lastStruggleSection = 0;
  follower.lastStruggleFinishMs = 0;
  follower.syncCarForces(7, 8);
  const result = s.run(query({ nowMs: 3001 }), hooks());
  assert.equal(result.follower.kind, "given-up");
  assert.deepEqual(
    [result.follower.accForce, result.follower.brakeForce],
    [0, 0],
  );
  assert.deepEqual([follower.accForce, follower.brakeForce], [0, 0]);
  assert.equal(result.transition, "restarted");
});

test("explicit path end dispatches get-near before completing current objective", () => {
  const s = state();
  s.start(query());
  const events = [];
  s.onPathEnd(query(), hooks(events));
  assert.deepEqual(events, ["get-near", "complete"]);
});

test("get-near hook mutations are visible to objective completion on shared backing", () => {
  const race = new NativeRaceRouteState(nodes.length, sections, () => 0);
  const follower = new NativePhysicalPathFollower();
  const s = new NativeCompleteRaceState(
    nodes,
    sections,
    race,
    follower,
    () => 0,
  );
  s.start(query());
  const seen = [];
  s.onPathEnd(query(), {
    newGetNearPlayer() {
      race.start(4);
      follower.start(4000, 0);
      seen.push(`get-near:${s.entries[0].section}`);
    },
    objectiveComplete() {
      seen.push(`complete:${s.entries[0].section}`);
    },
  });
  assert.deepEqual(seen, ["get-near:4", "complete:4"]);
});

test("reaching physical destination does not synthesize explicit path end", () => {
  const s = state([v(0), v(10)], [section(0, 1, 1)]);
  s.start(query({ position: v(10) }));
  const events = [];
  s.run(query({ position: v(10), velocity: v(1) }), hooks(events));
  assert.deepEqual(events, []);
});

test("empty route requires raw status and dispatches status-specific behavior", () => {
  for (const [status, expected] of [
    [0, ["get-near"]],
    [2, ["get-near"]],
    [1, ["get-near", "complete"]],
    [0xffffffff, ["get-near", "complete"]],
  ]) {
    const s = state([], []);
    s.start(query());
    const events = [];
    assert.throws(() => s.run(query(), hooks(events)));
    const result = s.run(query(), hooks(events), status);
    assert.deepEqual(events, expected);
    assert.equal(result.rawStatus, status);
    assert.equal(
      result.transition,
      status === 0
        ? "empty-return"
        : status === 2
          ? "get-near-player"
          : "objective-complete",
    );
  }
});

test("cheaty mode and invalid raw empty status are rejected", () => {
  const s = state([], []);
  assert.throws(() => s.start(query({ cheating: true })), /Cheaty/);
  s.start(query());
  assert.throws(() => s.run(query(), hooks(), -1), /raw empty-route status/);
});
