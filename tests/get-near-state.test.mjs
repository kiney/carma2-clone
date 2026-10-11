import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { nativeStruggleThresholds } from "../src/ai/path-struggle.ts";
import { NativeGetNearPlayerState } from "../src/ai/get-near-state.ts";
import { NativePhysicalPathFollower } from "../src/ai/path-follow.ts";
import { NativeProjectedRoute } from "../src/ai/path-route.ts";
import { NativeTargetAcquisition } from "../src/ai/target-acquisition.ts";

const nodes = Array.from({ length: 12 }, (_, index) => {
  const angle = (index * Math.PI * 2) / 12;
  return new Vector3(20 * Math.sin(angle), 0, 20 * Math.cos(angle));
});
const pointOn = (section, t) =>
  nodes[section].clone().lerp(nodes[(section + 1) % nodes.length], t);
const startPosition = pointOn(0, 0.4);
const targetPosition = pointOn(2, 0.4);
const sections = Array.from({ length: 12 }, (_, index) => ({
  nodeIndices: [index, (index + 1) % nodes.length],
  minSpeed: [0, 0],
  maxSpeed: [255, 255],
  width: 4,
  type: index === 2 ? 1 : 0,
  oneWay: false,
}));

const cache = () => ({ section: -1, refreshAtMs: 0 });
const query = (nowMs, overrides = {}) => ({
  position: startPosition.clone(),
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
  targetPosition: targetPosition.clone(),
  cheating: false,
  strength: 5,
  opponentFlags: 0,
  ...overrides,
});

const makeState = (
  acquisition = new NativeTargetAcquisition(nodes, sections),
) => {
  const route = new NativeProjectedRoute(nodes.length, sections);
  const follower = new NativePhysicalPathFollower();
  return {
    state: new NativeGetNearPlayerState(
      nodes,
      sections,
      route,
      follower,
      () => 0,
      acquisition,
    ),
    route,
    follower,
  };
};

test("GetNearPlayer start forces acquisition and returns the shared target cache", () => {
  const acquisition = new NativeTargetAcquisition(nodes, sections);
  const { state, route } = makeState(acquisition);
  const started = state.start(query(100), cache());
  assert.equal(started.transition, "started");
  assert.equal(started.targetCache.section, 2);
  assert.equal(started.targetCache.refreshAtMs, 1000);
  assert.equal(started.route[0].section, 0);
  assert.equal(started.route[0].direction, 1);
  assert.ok(started.route.length > 1);
  assert.deepEqual(state.entries, started.route);
  assert.deepEqual(route.entries, started.route);
  assert.equal(acquisition.previousTargetSection, 2);
});

test("factor-zero run emits native brakes without shifting or mutating target state", () => {
  const { state } = makeState();
  const started = state.start(query(100), cache());
  const frozen = state.run(
    query(116, { factor: 0, currentCurvature: 0.05 }),
    started.targetCache,
  );
  assert.equal(frozen.transition, "continue");
  assert.equal(frozen.follower.kind, "ok");
  assert.equal(frozen.follower.accForce, 0);
  assert.equal(frozen.follower.brakeForce, 30);
  assert.equal(frozen.follower.curvature, 0.05);
  assert.deepEqual(frozen.targetCache, started.targetCache);
  assert.deepEqual(frozen.route, started.route);
});

test("physical GetNearPlayer run owns its objective flags and reports direct forces", () => {
  const { state } = makeState();
  const started = state.start(query(100), cache());
  const result = state.run(
    query(116, { velocity: new Vector3(0, 0, 1) }),
    started.targetCache,
  );
  assert.equal(result.transition, "continue");
  assert.equal(result.follower.kind, "ok");
  assert.ok(Number.isFinite(result.follower.curvature));
  assert.ok(Number.isFinite(result.follower.accForce));
  assert.ok(Number.isFinite(result.follower.brakeForce));
  assert.ok(result.follower.speed);
  assert.equal(result.targetCache.section, 2);
  assert.ok(result.route.length > 0);
});

test("external cursor advancement survives freeze then shifts the shared route on physical reuse", () => {
  const { state } = makeState();
  const started = state.start(query(100), cache());
  const next = started.route[1];
  state.setSectionSlot(1);
  const frozen = state.run(query(116, { factor: 0 }), started.targetCache);
  assert.equal(frozen.follower.geometry.sectionSlot, 1);
  assert.deepEqual(frozen.route, started.route);
  const resumed = state.run(query(132), frozen.targetCache);
  assert.deepEqual(resumed.route[0], next);
  assert.throws(() => state.setSectionSlot(-1));
});

test("physical GetNearPlayer explicitly rejects the unsupported cheaty follower", () => {
  const { state } = makeState();
  const started = state.start(query(100), cache());
  assert.throws(
    () => state.run(query(116, { cheating: true }), started.targetCache),
    /Cheaty following is not implemented/,
  );
});

test("explicit native path-end notification restarts at slot zero without an arrival heuristic", () => {
  const { state } = makeState();
  const started = state.start(query(100), cache());
  const result = state.onPathEnd(
    query(200, { cheating: true }),
    started.targetCache,
  );
  assert.equal(result.transition, "restarted");
  assert.deepEqual(result.route, started.route);
  assert.deepEqual(result.targetCache, started.targetCache);
  const resumed = state.run(query(216), result.targetCache);
  assert.equal(resumed.transition, "continue");
  assert.equal(resumed.follower.kind, "ok");
});

test("native given-up result requests pursuit rather than a local route restart", () => {
  const { state } = makeState();
  let targetCache = cache();
  const startAt = 0x80001000;
  const started = state.start(query(startAt), targetCache);
  targetCache = started.targetCache;

  // Move-on-task is latched by the native 3D speed gate, then a stationary
  // interval creates count-zero struggle. Subsequent stops reuse the same
  // physical section until native count three requests result 2.
  state.run(
    query(startAt + 1, { velocity: new Vector3(0, 0, 1) }),
    targetCache,
  );
  let struggleStart = startAt + 2001;
  state.run(query(struggleStart), targetCache);
  let stopAt = nativeStruggleThresholds(struggleStart, 0, 2).stopAtMs + 1;
  let stop = state.run(query(stopAt), targetCache);
  assert.equal(stop.follower.madeIt, false);

  for (let count = 1; count <= 3; count++) {
    state.run(query(stopAt + 1001), targetCache);
    struggleStart = stopAt + 2001;
    state.run(query(struggleStart), targetCache);
    const threshold = nativeStruggleThresholds(
      struggleStart,
      count,
      2,
    ).stopAtMs;
    // The installed mixed signed/unsigned expression can produce a negative
    // stop threshold after count zero; any valid u32 timestamp then exceeds it.
    stopAt = threshold < 0 ? struggleStart + 1 : threshold + 1;
    stop = state.run(query(stopAt), targetCache);
    assert.equal(stop.follower.madeIt, false);
  }
  state.run(query(stopAt + 1001), targetCache);
  const givenUp = state.run(query(stopAt + 2001), targetCache);
  assert.equal(givenUp.transition, "pursue");
  assert.equal(givenUp.follower.kind, "given-up");
});
