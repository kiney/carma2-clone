import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { NativeFollowLifecycle } from "../src/ai/follow-lifecycle.ts";
import { NativeCompleteRaceState } from "../src/ai/complete-race-state.ts";
import { NativeGetNearPlayerState } from "../src/ai/get-near-state.ts";
import { NativeRunAwayState } from "../src/ai/run-away-state.ts";
import { NativePursuitState } from "../src/ai/pursuit-state.ts";
import { NativeRaceRouteState } from "../src/ai/race-route-state.ts";
import { NativePathView } from "../src/ai/path-view.ts";
import { enterCheatyPath, stepCheatyPath } from "../src/ai/cheaty-path.ts";

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
const engineHooks = {
  turnPhysicsOff() {},
  applyCheatyPose() {},
  clearCarForces() {},
  rematerializeOnSection() {
    return 1;
  },
  rematerializeOnNearestSection() {
    return 1;
  },
};
const query = () => ({
  position: new Vector3(10, 0, 0),
  velocity: new Vector3(),
  dtMs: 16,
  nowMs: 1000,
  maxCurve: 1,
  mass: 1000,
  factor: 1,
  engineDamage: 0,
  transmissionDamage: 0,
  currentCurvature: 0,
  cheating: true,
  physical: false,
  followHooks: engineHooks,
});
/** Inject raw native return codes at the shared dispatcher boundary. The
 * objective's status contract is independent of the movement producing it. */
class StatusLifecycle extends NativeFollowLifecycle {
  constructor(status) {
    super();
    this.status = status;
  }
  run(nodes, sections, route, query) {
    if (this.status === 2)
      return {
        kind: "physical",
        status: 2,
        follower: {
          kind: "given-up",
          movedOnTask: false,
          accForce: 0,
          brakeForce: 0,
          curvature: 0,
          geometry: { sectionSlot: 0 },
        },
      };
    return {
      kind: "cheaty",
      status: this.status,
      movement: {
        kind: this.status === 1 ? "path-end" : "ok",
        position: query.position.clone(),
        state: {
          sectionSlot: 0,
          movingToIntersection: false,
          intersection: query.position.clone(),
        },
      },
    };
  }
}

test("CompleteRace result1 dispatches GetNear then completes the newly current objective", () => {
  const lifecycle = new StatusLifecycle(1),
    race = new NativeRaceRouteState(nodes.length, sections, () => 0);
  const state = new NativeCompleteRaceState(
      nodes,
      sections,
      race,
      lifecycle,
      () => 0,
    ),
    events = [];
  state.start(query());
  const result = state.run(query(), {
    newGetNearPlayer() {
      events.push("new-get-near");
    },
    objectiveComplete() {
      events.push("complete");
    },
  });
  assert.equal(result.rawStatus, 1);
  assert.equal(result.follow.kind, "cheaty");
  assert.deepEqual(events, ["new-get-near", "complete"]);
});

test("GetNear maps1 to acquisition/Follow restart and2 to pursuit", () => {
  for (const status of [0, 1, 2]) {
    const race = new NativeRaceRouteState(nodes.length, sections, () => 0);
    const state = new NativeGetNearPlayerState(
      nodes,
      sections,
      race.route,
      new StatusLifecycle(status),
      () => 0,
    );
    const q = {
      ...query(),
      actorRow2: new Vector3(0, 0, 1),
      targetPosition: new Vector3(0, 0, 10),
      strength: 3,
      opponentFlags: 32,
    };
    const started = state.start(q, { section: -1, refreshAtMs: 0 });
    const result = state.run(q, started.targetCache);
    assert.equal(result.rawStatus, status);
    assert.equal(
      result.transition,
      ["continue", "restarted", "pursue"][status],
    );
  }
});

test("RunAway result1 continues; only2 reseeds and restarts Follow", () => {
  for (const status of [0, 1, 2]) {
    const race = new NativeRaceRouteState(nodes.length, sections, () => 0);
    const state = new NativeRunAwayState(
      nodes,
      sections,
      race.route,
      new StatusLifecycle(status),
      () => 0,
    );
    const q = { ...query(), actorDirection: new Vector3(1, 0, 0) };
    state.start(q);
    const result = state.run(q, {
      objectiveComplete() {
        assert.fail("Unexpected completion");
      },
    });
    assert.equal(result.rawStatus, status);
    assert.equal(result.transition, status === 2 ? "restarted" : "continue");
  }
});

test("Pursuit ignores all direct results; trail1/2 requests GetNear with explicit virtual mapping", () => {
  for (const trail of [false, true])
    for (const status of [0, 1, 2]) {
      const state = new NativePursuitState(new StatusLifecycle(status));
      state.start(0, 20000);
      const bound = [];
      const q = {
        ...query(),
        nowMs: trail ? 5000 : 1000,
        targetPosition: new Vector3(20, 0, 0),
        targetVelocity: new Vector3(),
        targetTrail: [new Vector3(0, 0, 0), new Vector3(20, 0, 0)],
        worldPathNodes: nodes,
        worldPathSections: sections,
        trailShifted: false,
        playerDistance: 40,
        grudge: 30,
        personality: 0,
        playerInView: !trail,
        pathEnded: false,
        followHooksForView(view) {
          bound.push(view.nativeId(0));
          return engineHooks;
        },
      };
      const result = state.run(
        q,
        () => 2,
        () => 0,
      );
      assert.equal(result.rawStatus, status);
      assert.equal(
        result.kind,
        trail && status !== 0 ? "get-near-player" : "driving",
      );
      assert.ok(bound.every((id) => id === (trail ? 15000 : 10000)));
    }
});

test("25-node cheaty trails accept24 sections; projected capacity remains12", () => {
  const view = NativePathView.trail(
    Array.from({ length: 25 }, (_, i) => new Vector3(i, 0, 0)),
  );
  assert.throws(() =>
    enterCheatyPath(
      new Vector3(),
      0,
      view.route,
      view.nodes,
      view.sections,
      16,
    ),
  );
  const entry = enterCheatyPath(
    new Vector3(),
    0,
    view.route,
    view.nodes,
    view.sections,
    16,
    24,
  );
  const moved = stepCheatyPath(
    entry.position,
    entry.state,
    view.route,
    view.nodes,
    view.sections,
    2000,
    24,
  );
  assert.equal(moved.kind, "ok");
  assert.equal(moved.state.sectionSlot, 11);
  const lifecycle = new NativeFollowLifecycle();
  const q = { ...query(), position: new Vector3(), routeCapacity: 24 };
  lifecycle.start(q, engineHooks);
  assert.equal(
    lifecycle.run(view.nodes, view.sections, view.route, q, engineHooks).kind,
    "cheaty",
  );
});
