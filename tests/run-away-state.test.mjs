import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { NativeRunAwayState } from "../src/ai/run-away-state.ts";
import { NativeProjectedRoute } from "../src/ai/path-route.ts";

const v = (x, y = 0, z = 0) => new Vector3(x, y, z);
const nodes = Array.from({ length: 12 }, (_, i) =>
  v(Math.cos((i * Math.PI) / 6) * 10, 0, Math.sin((i * Math.PI) / 6) * 10),
);
const sections = nodes.map((_, i) => ({
  nodeIndices: [i, (i + 1) % nodes.length],
  minSpeed: [0, 0],
  maxSpeed: [80, 80],
  width: 4,
  type: 0,
  oneWay: false,
}));

function physicalFollower(results = []) {
  const trace = [];
  return {
    trace,
    start(nowMs, slot) {
      trace.push(["start", nowMs, slot]);
    },
    setSectionSlot(slot) {
      trace.push(["slot", slot]);
    },
    syncCarForces(acc, brake) {
      trace.push(["forces", acc, brake]);
    },
    run(trackNodes, trackSections, route, query, random) {
      trace.push(["run", route.map((entry) => ({ ...entry })), query, random]);
      return (
        results.shift() ?? {
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
          accForce: 2,
          brakeForce: 3,
        }
      );
    },
  };
}

const query = (overrides = {}) => ({
  position: v(10, 0, 0),
  actorDirection: v(1, 0, 0),
  velocity: v(0),
  dtMs: 16,
  nowMs: 1000,
  maxCurve: 1,
  mass: 1000,
  factor: 1,
  engineDamage: 0,
  transmissionDamage: 0,
  currentCurvature: 0,
  cheating: false,
  ...overrides,
});

function makeState({ random = () => 0, route, follower } = {}) {
  const sharedRoute = route ?? new NativeProjectedRoute(nodes.length, sections);
  const sharedFollower = follower ?? physicalFollower();
  return {
    state: new NativeRunAwayState(
      nodes,
      sections,
      sharedRoute,
      sharedFollower,
      random,
    ),
    route: sharedRoute,
    follower: sharedFollower,
  };
}

test("START draws inclusive 30 second deadline, uses live direction dot order, seeds and fills shared route", () => {
  const draws = [];
  const { state, route, follower } = makeState({
    random: () => {
      draws.push("random");
      return 0;
    },
  });
  const result = state.start(query({ actorDirection: v(1) }));
  assert.equal(state.deadlineMs, 31000);
  assert.equal(result.transition, "started");
  assert.equal(route.entries.length, 12);
  assert.equal(route.entries[0].section, 0);
  assert.equal(route.entries[0].direction, 0);
  assert.deepEqual(follower.trace, [["start", 1000, 0]]);
  assert.ok(draws.length >= 1);
});

test("START uses cached F32 direction fields before the native dot-product order", () => {
  const { state, route } = makeState();
  state.start(query({ actorDirection: v(3.73205221, 0, 1) }));
  // Double precision gives a small positive dot; the stored F32 x component
  // makes it negative, selecting native direction0.
  assert.equal(
    1 * 0.9659258723258972 + 3.73205221 * -0.25881895422935486 > 0,
    true,
  );
  assert.equal(route.entries[0].direction, 0);
  assert.throws(
    () => state.start(query({ actorDirection: v(Number.MAX_VALUE) })),
    /Float32 bounds/,
  );
});

test("deadline draw reaches inclusive 90 seconds and wraps u32", () => {
  const { state } = makeState({ random: () => 32767 / 32768 });
  state.start(query({ nowMs: 0xfffffff0 }));
  assert.equal(state.deadlineMs, (0xfffffff0 + 90000) >>> 0);
  const { state: ninety } = makeState({ random: () => 32767 / 32768 });
  ninety.start(query({ nowMs: 0 }));
  assert.equal(ninety.deadlineMs, 90000);
});

test("RUN includes deadline equality and passes all physical path flags false", () => {
  const { state, follower } = makeState();
  state.start(query());
  const result = state.run(query({ nowMs: state.deadlineMs }), {
    objectiveComplete() {
      assert.fail("equality must not complete the objective");
    },
  });
  assert.equal(result.transition, "continue");
  const run = follower.trace.find((event) => event[0] === "run");
  assert.deepEqual(
    [run[2].ignoreEnd, run[2].neverStruggle, run[2].pursuit],
    [false, false, false],
  );
});

test("expired RUN completes before route shift, refill, or follower call", () => {
  const { state, route, follower } = makeState();
  state.start(query());
  const before = route.entries;
  const trace = [];
  const result = state.run(query({ nowMs: state.deadlineMs + 1 }), {
    objectiveComplete() {
      trace.push("complete");
    },
  });
  assert.equal(result.transition, "objective-complete");
  assert.deepEqual(trace, ["complete"]);
  assert.deepEqual(route.entries, before);
  assert.equal(
    follower.trace.some((event) => event[0] === "run"),
    false,
  );
});

test("RUN shifts positive follower slot then resets slot zero and refills shared route", () => {
  const first = {
    kind: "ok",
    madeIt: true,
    movedOnTask: false,
    struggleCount: 0,
    geometry: {
      sectionSlot: 1,
      desiredSpeed: 0,
      escape: { timeMs: 0, flipped: false },
    },
    curvature: 0,
    accForce: 2,
    brakeForce: 3,
  };
  const { state, route, follower } = makeState({
    follower: physicalFollower([first]),
  });
  state.start(query());
  state.run(query(), { objectiveComplete() {} });
  assert.equal(route.entries.length, 12);
  const firstRun = follower.trace.find((event) => event[0] === "run");
  assert.equal(firstRun[1].length, 12);
  state.run(query({ nowMs: 1001 }), { objectiveComplete() {} });
  const events = follower.trace;
  const secondRunIndex = events.findIndex(
    (event, index) =>
      event[0] === "run" && index > follower.trace.indexOf(firstRun),
  );
  assert.ok(secondRunIndex > 0);
  assert.deepEqual(events.slice(secondRunIndex - 1, secondRunIndex), [
    ["slot", 0],
  ]);
  assert.equal(events[secondRunIndex][1].length, 12);
  assert.equal(events[secondRunIndex][1][0].section, firstRun[1][1].section);
});

test("public cursor sync updates shared follower and shifts route on next RUN", () => {
  const { state, route, follower } = makeState();
  state.start(query());
  const prior = route.entries;
  state.setSectionSlot(2);
  assert.deepEqual(follower.trace.at(-1), ["slot", 2]);
  state.run(query(), { objectiveComplete() {} });
  const run = follower.trace.find((event) => event[0] === "run");
  assert.equal(run[1][0].section, prior[2].section);
});

test("given-up restart preserves forces and stop deadline without another deadline draw", () => {
  const givenUp = {
    kind: "given-up",
    madeIt: false,
    movedOnTask: true,
    struggleCount: 3,
    geometry: {
      sectionSlot: 2,
      desiredSpeed: 0,
      escape: { timeMs: 0, flipped: false },
    },
    curvature: 0.25,
    accForce: 17,
    brakeForce: 19,
  };
  let draws = 0;
  const { state, follower } = makeState({
    random: () => {
      draws++;
      return 0;
    },
    follower: physicalFollower([givenUp]),
  });
  state.start(query());
  const originalDeadline = state.deadlineMs;
  const result = state.run(query({ nowMs: 1100 }), { objectiveComplete() {} });
  assert.equal(result.transition, "restarted");
  assert.equal(result.follower, givenUp);
  assert.equal(state.deadlineMs, originalDeadline);
  assert.deepEqual(
    follower.trace.filter((event) => event[0] === "forces"),
    [["forces", 17, 19]],
  );
  assert.deepEqual(follower.trace.at(-1), ["start", 1100, 0]);
  assert.equal(draws, 1);
});

test("cheaty follow is rejected and no nearest section is a bounded START error", () => {
  const { state } = makeState();
  assert.throws(() => state.start(query({ cheating: true })), /Cheaty/);
  const empty = new NativeRunAwayState(
    nodes,
    [],
    new NativeProjectedRoute(nodes.length, []),
    physicalFollower(),
  );
  assert.throws(() => empty.start(query()), /requires a nearest path section/);
});
