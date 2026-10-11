import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { NativePhysicalPathFollower } from "../src/ai/path-follow.ts";
import { NativePursuitState } from "../src/ai/pursuit-state.ts";

const nodes = [
  new Vector3(0, 0, 0),
  new Vector3(10, 0, 0),
  new Vector3(10, 0, 10),
  new Vector3(0, 0, 10),
];
const sections = nodes.map((_, i) => ({
  nodeIndices: [i, (i + 1) % nodes.length],
  minSpeed: [0, 0],
  maxSpeed: [255, 255],
  width: 4,
  type: 0,
  oneWay: false,
}));
const trail = [
  new Vector3(0, 0, 0),
  new Vector3(10, 0, 0),
  new Vector3(10, 0, 10),
  new Vector3(0, 0, 10),
];
const query = (nowMs, overrides = {}) => ({
  position: new Vector3(5, 0, 0),
  velocity: new Vector3(),
  dtMs: 16,
  nowMs,
  maxCurve: 0.2,
  mass: 2,
  factor: 1,
  engineDamage: 0,
  transmissionDamage: 0,
  currentCurvature: 0,
  actorRow2: new Vector3(0, 0, -1),
  targetPosition: new Vector3(15, 0, 0),
  targetVelocity: new Vector3(1, 0, 0),
  targetTrail: [],
  worldPathNodes: nodes,
  worldPathSections: sections,
  trailShifted: false,
  playerDistance: 10,
  grudge: 15,
  personality: 0,
  playerInView: false,
  physical: true,
  cheating: false,
  pathEnded: false,
  ...overrides,
});

class CountingFollower extends NativePhysicalPathFollower {
  starts = [];
  shifts = [];
  start(nowMs, slot = 0) {
    this.starts.push([nowMs, slot]);
    super.start(nowMs, slot);
  }
  setSectionSlot(slot) {
    this.shifts.push(slot);
    super.setSectionSlot(slot);
  }
  run(nodes, sections, route, query, random) {
    return super.run(nodes, sections, route, query, random);
  }
}
const make = () => {
  const follower = new CountingFollower();
  const state = new NativePursuitState(follower);
  state.start(100, 7);
  return { state, follower };
};
const clearRay = () => 2;
const blockedRay = () => 1;

test("START resets pursuit timers without replacing or stopping its shared follower; DIE is a no-op", () => {
  const { state, follower } = make();
  follower.start(50, 2);
  state.notifyTwatted(80);
  state.start(120, 9);
  assert.equal(state.snapshot.state, 0);
  assert.equal(state.snapshot.currentSection, 9);
  assert.equal(state.snapshot.lastTwattedMs, 0);
  assert.equal(state.snapshot.lastAwayMs, 120);
  assert.equal(follower.starts.length, 1);
  state.die();
  assert.deepEqual(state.snapshot, {
    state: 0,
    currentSection: 9,
    nextVisibilityCheckMs: 0,
    backupStartMs: 0,
    lastTwattedMs: 0,
    lastVisibleMs: 0,
    lastAwayMs: 120,
    directLength: 0,
  });
  assert.equal(follower.starts.length, 1);
});

test("grudge below 15 completes unless personality is the native forced type 3", () => {
  const { state, follower } = make();
  assert.equal(
    state.run(query(4000, { grudge: 14 }), blockedRay).kind,
    "objective-complete",
  );
  assert.equal(
    state.run(
      query(4001, { grudge: 0, personality: 3, targetTrail: trail }),
      blockedRay,
    ).kind,
    "driving",
  );
  assert.equal(follower.starts.length, 1);
});

test("initial visibility grace selects direct pursuit; sighting bypasses ray and refreshes at 900ms", () => {
  const { state, follower } = make();
  let rays = 0;
  const ray = () => (rays++, 0);
  const grace = state.run(query(100), ray);
  assert.equal(grace.kind, "driving");
  assert.equal(grace.snapshot.state, 2);
  assert.equal(rays, 1);
  assert.equal(follower.starts.length, 1);
  assert.equal(grace.view.kind, "direct");

  const visible = state.run(query(200, { playerInView: true }), () => {
    throw new Error("direct sighting must skip the ray test");
  });
  assert.equal(visible.snapshot.lastVisibleMs, 200);
  assert.equal(visible.snapshot.nextVisibilityCheckMs, 1100);
  assert.equal(follower.starts.length, 1, "refresh must not restart the PID");
  assert.equal(state.run(query(3199), blockedRay).snapshot.state, 2);
  assert.equal(state.run(query(3200), blockedRay).kind, "get-near-player");
});

test("blocked ray retains visibility deadline and trail absence requests GetNear after grace", () => {
  const { state } = make();
  state.start(4000, 4);
  const blocked = state.run(query(4001), blockedRay);
  assert.equal(blocked.kind, "get-near-player");
  assert.equal(blocked.snapshot.nextVisibilityCheckMs, 0);
  assert.equal(state.run(query(4001), blockedRay).kind, "get-near-player");
  assert.equal(
    state.run(query(4001, { playerDistance: 35 }), clearRay).kind,
    "get-near-player",
  );
  assert.equal(
    state.run(query(4001, { playerDistance: 34 }), clearRay).snapshot.state,
    2,
  );
  state.start(4000, 4);
  state.run(query(4001, { playerDistance: 34 }), clearRay);
  const stillDirect = state.run(query(4900), () => 0);
  assert.equal(stillDirect.snapshot.lastVisibleMs, 4001);
  assert.equal(stillDirect.snapshot.nextVisibilityCheckMs, 4901);
  assert.equal(state.run(query(7002), blockedRay).kind, "get-near-player");
});

test("direct target refresh predicts from live target velocity without restarting follower", () => {
  const { state, follower } = make();
  state.run(query(100, { playerInView: true }), blockedRay);
  const starts = follower.starts.length;
  const result = state.run(
    query(500, {
      playerInView: true,
      targetPosition: new Vector3(15, 0, 0),
      targetVelocity: new Vector3(2, 0, 0),
    }),
    blockedRay,
  );
  assert.equal(result.view.kind, "direct");
  assert.equal(result.view.nodes[1].x, 20);
  assert.equal(follower.starts.length, starts);
});

test("trail shifts decrement the native cursor without START; first-slot revisit reacquires with ray", () => {
  const { state, follower } = make();
  const atSecondSegment = query(4000, {
    position: new Vector3(10, 0, 5),
    targetTrail: trail,
  });
  const started = state.run(atSecondSegment, blockedRay);
  assert.equal(started.snapshot.state, 1);
  assert.equal(started.snapshot.currentSection, 15001);
  const count = follower.starts.length;
  const shifted = state.run(
    query(4016, {
      ...atSecondSegment,
      nowMs: 4016,
      playerDistance: 40,
      trailShifted: true,
    }),
    blockedRay,
  );
  assert.equal(shifted.snapshot.currentSection, 15000);
  assert.equal(follower.starts.length, count);

  const first = state.run(
    query(4032, {
      ...atSecondSegment,
      nowMs: 4032,
      playerDistance: 40,
      position: new Vector3(2, 0, 0),
      trailShifted: true,
    }),
    clearRay,
  );
  assert.equal(first.kind, "driving");
  assert.equal(first.snapshot.currentSection, 15000);
  assert.equal(follower.starts.length, count + 1);
  const lost = state.run(
    query(4048, {
      ...atSecondSegment,
      nowMs: 4048,
      playerDistance: 40,
      position: new Vector3(2, 0, 0),
      trailShifted: true,
    }),
    blockedRay,
  );
  assert.equal(lost.kind, "get-near-player");
});

test("explicit path end is ignored for direct pursuit but trail path end requests GetNear", () => {
  const { state, follower } = make();
  const direct = state.run(
    query(100, { pathEnded: true, playerInView: true }),
    blockedRay,
  );
  assert.equal(direct.kind, "driving");
  assert.equal(follower.starts.length, 1);

  state.start(4000, 0);
  const trailResult = state.run(
    query(4001, { targetTrail: trail, pathEnded: true }),
    blockedRay,
  );
  assert.equal(trailResult.kind, "get-near-player");
});

test("reverse deadlines are strict and twat-triggered reverse wraps unsigned timers", () => {
  const { state } = make();
  state.notifyTwatted(1000);
  assert.equal(
    state.run(query(2000, { targetVelocity: new Vector3() }), blockedRay)
      .snapshot.state,
    2,
  );
  assert.equal(
    state.run(query(2001, { targetVelocity: new Vector3() }), blockedRay)
      .snapshot.state,
    3,
  );
  const reverse = state.run(
    query(4201, { targetVelocity: new Vector3(), currentCurvature: 0.125 }),
    blockedRay,
  );
  assert.deepEqual(reverse.forces, {
    finished: false,
    curvature: 0,
    accForce: -16,
    brakeForce: 0,
  });
  const brake = state.run(
    query(4202, { targetVelocity: new Vector3(), currentCurvature: 0.125 }),
    blockedRay,
  );
  assert.deepEqual(brake.forces, {
    finished: false,
    curvature: 0.125,
    accForce: 0,
    brakeForce: 30,
  });
  const done = state.run(
    query(5002, { targetVelocity: new Vector3(), currentCurvature: 0.125 }),
    blockedRay,
  );
  assert.deepEqual(done.forces, {
    finished: true,
    curvature: 0.125,
    accForce: 0,
    brakeForce: 0,
  });
  assert.equal(done.snapshot.state, 0);

  state.start(0xfffffff0, 0);
  state.notifyTwatted(0xfffffff0);
  const wrapped = state.run(
    query(0x000003e9, { targetVelocity: new Vector3() }),
    blockedRay,
  );
  assert.equal(wrapped.snapshot.state, 3);
});

test("physical pursuit rejects cheaty, frozen, and invalid modes without inferring arrival", () => {
  const { state } = make();
  assert.throws(
    () => state.run(query(100, { cheating: true }), clearRay),
    /nonphysical pursuit/,
  );
  assert.throws(
    () => state.run(query(100, { physical: false }), clearRay),
    /nonphysical pursuit/,
  );
  assert.throws(() => state.run(query(100, { factor: 0 }), clearRay), /frozen/);
  assert.equal(
    state.run(query(100, { personality: -1 }), clearRay).kind,
    "driving",
  );
});
