import test from "node:test";
import assert from "node:assert/strict";
import { NativeObjectiveLifecycle } from "../src/ai/objective-lifecycle.ts";

const noopLifecycleHooks = { die() {}, start() {} };

test("objective transition dies old state before storing, drawing, and starting new state", () => {
  const trace = [];
  const counts = { completeRace: 0, pursuing: 0, getNear: 0 };
  const lifecycle = new NativeObjectiveLifecycle(
    { objective: "complete-race", target: "stale" },
    counts,
    () => {
      trace.push(
        `draw:${lifecycle.snapshot().objective}:${lifecycle.snapshot().target}`,
      );
      return 0;
    },
  );
  lifecycle.newObjective(500, "pursue", "player", {
    die: (objective) => trace.push(`die:${objective}`),
    start: (objective) =>
      trace.push(`start:${objective}:${lifecycle.snapshot().target}`),
  });
  assert.deepEqual(trace, [
    "die:complete-race",
    "draw:pursue:stale",
    "start:pursue:player",
  ]);
  assert.deepEqual(lifecycle.snapshot(), {
    objective: "pursue",
    target: "player",
    startMs: 500,
    deadlineMs: 110500,
    newRequired: false,
    finishedForRace: false,
    stunUntilMs: 0,
  });
  assert.deepEqual(counts, { completeRace: 0, pursuing: 1, getNear: 0 });
});

test("counter adjustments wrap signed and recount only unfinished regular categories", () => {
  const counts = {
    completeRace: 0x7fffffff,
    pursuing: -0x80000000,
    getNear: 0,
  };
  const lifecycle = new NativeObjectiveLifecycle(
    { objective: "complete-race" },
    counts,
    () => 0,
  );
  lifecycle.newObjective(10, "complete-race", null, noopLifecycleHooks);
  assert.equal(counts.completeRace, -0x80000000);
  lifecycle.objectiveComplete();
  assert.equal(counts.completeRace, 0x7fffffff);
  assert.equal(lifecycle.snapshot().newRequired, true);

  NativeObjectiveLifecycle.recount(counts, [
    { objective: "complete-race", finishedForRace: false },
    { objective: "pursue", finishedForRace: false },
    { objective: "get-near-player", finishedForRace: false },
    { objective: "pursue", finishedForRace: true },
    { objective: "frozen", finishedForRace: false },
  ]);
  assert.deepEqual(counts, { completeRace: 1, pursuing: 1, getNear: 1 });
});

test("non-pursue transition preserves stale target and same-type transition draws a fresh deadline", () => {
  const draws = [];
  const lifecycle = new NativeObjectiveLifecycle(
    { objective: "get-near-player", target: "stale" },
    undefined,
    () => {
      draws.push("draw");
      return draws.length === 1 ? 0 : 32767 / 32768;
    },
  );
  lifecycle.newObjective(100, "get-near-player", null, noopLifecycleHooks);
  const firstDeadline = lifecycle.snapshot().deadlineMs;
  lifecycle.newObjective(200, "get-near-player", null, noopLifecycleHooks);
  assert.equal(draws.length, 2);
  assert.equal(firstDeadline, 20100);
  assert.equal(lifecycle.snapshot().deadlineMs, 60200);
  assert.equal(lifecycle.snapshot().target, "stale");
});

test("complete-race completion followed by get-near increment retains ordered raw count effects", () => {
  const counts = { completeRace: 3, pursuing: 0, getNear: 0 };
  const lifecycle = new NativeObjectiveLifecycle(
    { objective: "complete-race" },
    counts,
    () => 0,
  );
  lifecycle.objectiveComplete();
  assert.deepEqual(counts, { completeRace: 2, pursuing: 0, getNear: 0 });
  lifecycle.newObjective(1, "get-near-player", null, noopLifecycleHooks);
  assert.deepEqual(counts, { completeRace: 2, pursuing: 0, getNear: 1 });
});

function processHooks(trace, lifecycle, { cheating = false, choose } = {}) {
  return {
    changeCheatingMode() {
      trace.push("cheat-mode");
    },
    repair() {
      trace.push("repair");
    },
    chooseObjective(force) {
      trace.push(`choose:${force}`);
      choose?.(lifecycle);
    },
    setBrakeForce(force) {
      trace.push(`brake:${force}`);
    },
    run(objective) {
      trace.push(`run:${objective}`);
    },
    isCheating() {
      return cheating;
    },
    copyActorOriginToCarPosition() {
      trace.push("copy-position");
    },
  };
}

test("ProcessOpponent order clears completion after selector and runs its synchronous replacement", () => {
  const trace = [];
  const lifecycle = new NativeObjectiveLifecycle(
    { objective: "complete-race", deadlineMs: 1000 },
    undefined,
    () => 0,
  );
  lifecycle.objectiveComplete();
  lifecycle.process(
    {
      nowMs: 900,
      mass: 20,
      countdown: 0,
      raceFinished: false,
      stopOpponentsMoving: false,
    },
    processHooks(trace, lifecycle, {
      cheating: true,
      choose: (brain) =>
        brain.newObjective(900, "pursue", "player", {
          die: (objective) => trace.push(`die:${objective}`),
          start: (objective) => trace.push(`start:${objective}`),
        }),
    }),
  );
  assert.deepEqual(trace, [
    "cheat-mode",
    "repair",
    "choose:true",
    "die:complete-race",
    "start:pursue",
    "run:pursue",
    "copy-position",
  ]);
  assert.equal(lifecycle.snapshot().newRequired, false);
});

test("deadline equality is not forced; selector still runs while stun or global stop suppresses RUN", () => {
  const trace = [];
  const lifecycle = new NativeObjectiveLifecycle({
    objective: "freewheel",
    deadlineMs: 100,
    stunUntilMs: 200,
  });
  const hooks = processHooks(trace, lifecycle);
  lifecycle.process(
    {
      nowMs: 100,
      mass: 1,
      countdown: 0,
      raceFinished: false,
      stopOpponentsMoving: true,
    },
    hooks,
  );
  assert.deepEqual(trace, ["cheat-mode", "repair", "choose:false"]);
  trace.length = 0;
  lifecycle.process(
    {
      nowMs: 101,
      mass: 1,
      countdown: 0,
      raceFinished: false,
      stopOpponentsMoving: false,
    },
    hooks,
  );
  assert.deepEqual(trace, ["cheat-mode", "repair", "choose:true"]);
});

test("countdown brakes at F32 mass while RUN may overwrite them; race finish skips RUN but selects", () => {
  const trace = [];
  const lifecycle = new NativeObjectiveLifecycle({
    objective: "pursue",
    deadlineMs: 100,
  });
  lifecycle.process(
    {
      nowMs: 1,
      mass: 1.1,
      countdown: 2,
      raceFinished: false,
      stopOpponentsMoving: false,
    },
    processHooks(trace, lifecycle),
  );
  assert.deepEqual(trace, [
    "cheat-mode",
    "repair",
    "choose:false",
    `brake:${Math.fround(10 * Math.fround(1.1))}`,
    "run:pursue",
  ]);
  trace.length = 0;
  lifecycle.process(
    {
      nowMs: 2,
      mass: 1,
      countdown: 0,
      raceFinished: true,
      stopOpponentsMoving: false,
    },
    processHooks(trace, lifecycle),
  );
  assert.deepEqual(trace, ["cheat-mode", "repair", "choose:false", "brake:10"]);
});

test("objective orchestration does not mutate physical actor or vehicle state", () => {
  const physical = {
    actor: { origin: [1, 2, 3] },
    car: { position: [4, 5, 6] },
  };
  const before = structuredClone(physical);
  const lifecycle = new NativeObjectiveLifecycle({ objective: "pursue" });
  lifecycle.process(
    {
      nowMs: 1,
      mass: 1,
      countdown: 0,
      raceFinished: false,
      stopOpponentsMoving: false,
    },
    processHooks([], lifecycle, { cheating: true }),
  );
  assert.deepEqual(physical, before);
});

test("invalid timestamps, pursue targets, mass and counts reject before lifecycle mutation", () => {
  const counts = { completeRace: 0, pursuing: 0, getNear: 0 };
  const lifecycle = new NativeObjectiveLifecycle({ objective: "none" }, counts);
  assert.throws(() =>
    lifecycle.newObjective(-1, "pursue", "player", noopLifecycleHooks),
  );
  assert.throws(() =>
    lifecycle.newObjective(1, "pursue", null, noopLifecycleHooks),
  );
  assert.equal(lifecycle.snapshot().objective, "none");
  assert.throws(() =>
    lifecycle.process(
      {
        nowMs: 0,
        mass: 0,
        countdown: 0,
        raceFinished: false,
        stopOpponentsMoving: false,
      },
      processHooks([], lifecycle),
    ),
  );
  assert.deepEqual(counts, { completeRace: 0, pursuing: 0, getNear: 0 });
});
