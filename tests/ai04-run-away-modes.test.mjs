import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { NativeRunAwayState } from "../src/ai/run-away-state.ts";
import { NativeProjectedRoute } from "../src/ai/path-route.ts";
import { NativeFollowLifecycle } from "../src/ai/follow-lifecycle.ts";

// Installed RunAway uses the opponent's shared TopUpRandomRoute at START,
// refill, and result2 restart. Its type2 filtering reads opponent cheating,
// independently of ProcessFollowPath's three false option arguments.
const nodes = [new Vector3(), new Vector3(10, 0, 0), new Vector3(20, 0, 0)];
const sections = [0, 1].map((i) => ({
  nodeIndices: [i, i + 1],
  minSpeed: [0, 0],
  maxSpeed: [80, 80],
  width: 4,
  type: i === 1 ? 2 : 0,
  oneWay: false,
}));
const hooks = {
  turnPhysicsOff() {},
  applyCheatyPose() {},
  clearCarForces() {},
  rematerializeOnSection: () => 1,
  rematerializeOnNearestSection: () => 1,
};
const objectiveHooks = {
  objectiveComplete() {
    assert.fail("RunAway should remain before its stop deadline");
  },
};
const query = (cheating, nowMs = 100) => ({
  position: new Vector3(1, 0, 0),
  velocity: new Vector3(),
  actorDirection: new Vector3(1, 0, 0),
  dtMs: 16,
  nowMs,
  maxCurve: 1,
  mass: 1000,
  factor: 1,
  engineDamage: 0,
  transmissionDamage: 0,
  currentCurvature: 0,
  cheating,
  physical: true,
  followHooks: hooks,
});
function fixture(follower = new NativeFollowLifecycle()) {
  const route = new NativeProjectedRoute(nodes.length, sections);
  const state = new NativeRunAwayState(
    nodes,
    sections,
    route,
    follower,
    () => 0,
  );
  return { state, route, follower };
}
function assertContinuation(entries, index, cheating) {
  assert.equal(entries.length, 12);
  assert.deepEqual(entries[index - 1], { section: 0, direction: 1 });
  assert.deepEqual(
    entries[index],
    cheating ? { section: 1, direction: 1 } : { section: 0, direction: 0 },
    cheating
      ? "cheating permits the sole forward cheat-only continuation"
      : "physical mode excludes type2 and reverses the seed at this dead end",
  );
}

for (const cheating of [false, true]) {
  const mode = cheating ? "cheating" : "physical";
  test(`RunAway START uses ${mode} mode for cheat-only route eligibility`, () => {
    const { state } = fixture();
    state.start(query(cheating));
    assertContinuation(state.entries, 1, cheating);
  });

  test(`RunAway refill uses current ${mode} mode after consuming a physical route prefix`, () => {
    const { state, route } = fixture();
    state.start(query(false));
    // A physical dead-end route alternates the seed's two directions. Consume
    // ten real entries, leaving forward+reverse, then refill to twelve.
    const previous = route.entries;
    state.setSectionSlot(10);
    const result = state.run(query(cheating, 116), objectiveHooks);
    assert.equal(result.transition, "continue");
    assert.deepEqual(state.entries.slice(0, 2), previous.slice(10));
    assertContinuation(state.entries, 3, cheating);
  });
}

// Explicit objective-coordinator status boundary: cheaty FOLLOW normally
// returns0/1, so this does not claim status2 is reachable in a cheaty frame.
// Inject only its documented result2 dispatch to verify every RunAway top-up
// uses the current opponent mode. START and all route operations remain real.
class GivenUpStatusBoundary extends NativeFollowLifecycle {
  run() {
    return {
      kind: "physical",
      status: 2,
      follower: {
        kind: "given-up",
        madeIt: false,
        movedOnTask: true,
        struggleCount: 3,
        geometry: {
          sectionSlot: 0,
          desiredSpeed: 0,
          escape: { timeMs: 0, flipped: false },
        },
        curvature: 0,
        accForce: 0,
        brakeForce: 0,
      },
    };
  }
}
for (const cheating of [false, true]) {
  const mode = cheating ? "cheating" : "physical";
  test(`RunAway result2 boundary restart uses current ${mode} mode without changing its deadline`, () => {
    const { state } = fixture(new GivenUpStatusBoundary());
    state.start(query(false));
    const originalDeadline = state.deadlineMs;
    const result = state.run(query(cheating, 116), objectiveHooks);
    assert.equal(result.transition, "restarted");
    assert.equal(state.deadlineMs, originalDeadline);
    assertContinuation(state.entries, 1, cheating);
  });
}
