import test from "node:test";
import assert from "node:assert/strict";
import {
  NativeRegularDecision,
  nativeDecisionInteger,
} from "../src/ai/decision.ts";

const initial = (extra = {}) => ({
  objective: "complete-race",
  target: null,
  objectiveStartMs: 0,
  nextOutOfWorldCheckMs: 10000,
  grudge: 10,
  knackeredDetected: false,
  pursuingBeforeFreeze: false,
  movedEver: true,
  pursueFromStart: false,
  acknowledgedSighting: false,
  ...extra,
});
const query = (extra = {}) => ({
  nowMs: 10000,
  factor: 1,
  nastiness: 0,
  strength: 3,
  firstFrame: false,
  mustChoose: false,
  forcedType: 1,
  player: "player",
  playerDistance: 5,
  knackered: false,
  stolen: false,
  scaryBang: false,
  bigBang: false,
  grudgeRaisedRecently: false,
  lastHitter: null,
  lastWeHit: null,
  inView: false,
  headOn: false,
  pursuingPopulation: 0,
  skill: 1,
  hasFallenOffWorld: () => false,
  ...extra,
});
const human = (identity) => ({ identity, driver: 8 });

test("lifecycle priority and strict wrapped fallen-world deadline", () => {
  let checks = 0;
  const fallen = () => {
    checks++;
    return true;
  };
  const brain = new NativeRegularDecision(initial());
  assert.equal(
    brain.run(query({ hasFallenOffWorld: fallen })).transition,
    null,
  );
  assert.equal(checks, 0);
  const result = brain.run(
    query({
      nowMs: 0xfffffffe,
      knackered: true,
      factor: 0,
      hasFallenOffWorld: fallen,
    }),
  );
  assert.equal(result.transition.reason, "fallen");
  assert.equal(result.transition.teleportToSafeLocation, true);
  assert.equal(result.state.nextOutOfWorldCheckMs, 498);
  assert.equal(result.state.knackeredDetected, false);
  assert.equal(checks, 1);
  const disabled = new NativeRegularDecision(
    initial({ knackeredDetected: true }),
  );
  assert.equal(
    disabled.run(query({ nowMs: 20000, hasFallenOffWorld: fallen })).transition,
    null,
  );
  assert.equal(checks, 1);
});

test("knackered selection precedes freeze and stolen selects levitate", () => {
  const brain = new NativeRegularDecision(initial());
  const result = brain.run(query({ knackered: true, stolen: true, factor: 0 }));
  assert.equal(result.transition.objective, "levitate");
  assert.equal(result.state.knackeredDetected, true);
});

test("freeze remembers only pursuit AND the player target", () => {
  for (const [objective, target, expected] of [
    ["complete-race", "player", false],
    ["pursue", "other", false],
    ["pursue", "player", true],
  ]) {
    const brain = new NativeRegularDecision(initial({ objective, target }));
    const result = brain.run(query({ factor: 0, scaryBang: true }));
    assert.equal(result.transition.objective, "frozen");
    assert.equal(result.state.pursuingBeforeFreeze, expected);
    brain.synchronize({ ...result.state, objective: "frozen" });
    assert.equal(brain.run(query({ factor: 0 })).transition, null);
    assert.equal(
      brain.run(query()).transition.objective,
      expected ? "pursue" : "get-near-player",
    );
  }
});

test("reactive priority: scary bang then hitter then hit player then grudge", () => {
  const all = query({
    scaryBang: true,
    bigBang: true,
    lastHitter: human("hitter"),
    lastWeHit: human("hit"),
    grudgeRaisedRecently: true,
    inView: true,
  });
  const run = (extra) =>
    new NativeRegularDecision(initial({ grudge: 25 })).run(
      { ...all, ...extra },
      () => 0,
    );
  assert.equal(run({}).transition.reason, "scary-bang");
  assert.equal(run({ scaryBang: false }).transition.target, "hitter");
  assert.equal(
    run({ scaryBang: false, bigBang: false }).transition.target,
    "player",
  );
  assert.equal(
    run({ scaryBang: false, bigBang: false, lastWeHit: null }).transition
      .reason,
    "grudge",
  );
  assert.equal(run({ playerDistance: 10 }).transition.reason, "hit-by-player");
  assert.equal(run({ strength: 5 }).transition.reason, "hit-by-player");
});

test("first frame bypass and RunAway equality still allow forced override", () => {
  let draws = 0;
  const random = () => {
    draws++;
    return 0;
  };
  const brain = new NativeRegularDecision(
    initial({ objective: "run-away", objectiveStartMs: 1000 }),
  );
  const q = query({
    scaryBang: false,
    bigBang: true,
    lastHitter: human("hitter"),
  });
  assert.equal(brain.run({ ...q, nowMs: 20999 }, random).transition, null);
  assert.equal(
    brain.run({ ...q, nowMs: 20999, mustChoose: true }, random).transition
      .objective,
    "complete-race",
  );
  assert.equal(
    brain.run({ ...q, nowMs: 21000 }, random).transition.reason,
    "hit-by-player",
  );
  assert.equal(
    brain.run({ ...q, firstFrame: true, mustChoose: true }, random).transition
      .reason,
    "forced",
  );
  assert.equal(draws, 0);
});

test("sighting acknowledges before draw, zero chance skips RNG, head-on bypasses population gate", () => {
  let draws = 0;
  const brain = new NativeRegularDecision(initial());
  const q = query({ inView: true, pursuingPopulation: 4 });
  const random = () => {
    draws++;
    assert.equal(brain.snapshot().acknowledgedSighting, true);
    return 0;
  };
  assert.equal(brain.run(q, random).transition, null);
  assert.equal(draws, 0);
  assert.equal(brain.run({ ...q, headOn: true }, random).transition, null);
  brain.synchronize({ ...brain.snapshot(), acknowledgedSighting: false });
  assert.equal(
    brain.run({ ...q, headOn: true }, random).transition.reason,
    "sighting",
  );
  assert.equal(draws, 1);
  assert.equal(brain.snapshot().grudge, 30);
});

test("already pursuing player skips fresh sighting but accidental hit tests its own target", () => {
  const brain = new NativeRegularDecision(
    initial({ objective: "pursue", target: "player" }),
  );
  assert.equal(
    brain.run(query({ inView: true, headOn: true })).transition,
    null,
  );
  assert.equal(brain.snapshot().acknowledgedSighting, false);
  assert.equal(
    brain.run(query({ lastWeHit: human("other-human") })).transition.reason,
    "hit-player",
  );
});

test("negative nastiness retains signed chance draw and native unsigned byte grudge", () => {
  let draws = 0;
  const brain = new NativeRegularDecision(initial({ grudge: 10 }));
  const result = brain.run(
    query({ nastiness: -1, bigBang: true, lastHitter: human("hitter") }),
  );
  assert.equal(result.state.grudge, 246, "20 + trunc(-30) is stored as a byte");
  const sighting = new NativeRegularDecision(initial());
  assert.equal(
    sighting.run(query({ inView: true, nastiness: -1 }), () => {
      draws++;
      return 0;
    }).transition,
    null,
  );
  assert.equal(draws, 1, "negative probability consumes RNG");
  const fromStart = new NativeRegularDecision(
    initial({ movedEver: false, pursueFromStart: true }),
  );
  assert.equal(
    fromStart.run(query({ firstFrame: true, mustChoose: true, nastiness: -2 }))
      .state.grudge,
    216,
  );
});

test("selector leaves objective/deadline effects to outer caller and validates native inputs", () => {
  const brain = new NativeRegularDecision(initial());
  assert.equal(
    brain.run(query({ mustChoose: true })).transition.objective,
    "complete-race",
  );
  assert.equal(brain.snapshot().objectiveStartMs, 0);
  assert.throws(() => brain.run(query({ nowMs: -1 })), /Invalid/);
  assert.throws(() => brain.run(query({ nastiness: Infinity })), /Invalid/);
  assert.throws(() => brain.run(query({ forcedType: 1.5 })), /Invalid/);
  assert.throws(
    () => new NativeRegularDecision(initial({ grudge: 256 })),
    /Invalid/,
  );
});

test("575190 FISTP QWORD returns signed low DWORD, including integer-indefinite", () => {
  for (const [input, expected] of [
    [2 ** 31, -2147483648],
    [2 ** 31 + 1.75, -2147483647],
    [2 ** 32, 0],
    [2 ** 32 + 1.75, 1],
    [-(2 ** 32) - 1.75, -1],
    [2 ** 63 - 1024, -1024],
    [-(2 ** 63), 0],
    [2 ** 63, 0],
    [-(2 ** 63) - 2048, 0],
    [Infinity, 0],
    [NaN, 0],
  ])
    assert.equal(nativeDecisionInteger(input), expected, String(input));
});

test("finite F32 nastiness preserves x87 product offsets and signed64 invalid low zero", () => {
  for (const [nastiness, expected] of [
    [2 ** 27, 100], //40*n+10 has low DWORD0x4000000a; signed cap100.
    [2 ** 29, 30], //40*n+10 wraps signed low DWORD to10.
    [2 ** 56, 30], //x87 retains +10 where double multiplication/addition loses it.
    [-(2 ** 56), 30],
    [2 ** 58, 20], //40*n exceeds signed64; indefinite low DWORD is0.
    [-(2 ** 58), 20],
    [Math.fround(3.4e38), 20],
  ]) {
    const brain = new NativeRegularDecision(initial());
    assert.equal(
      brain.run(
        query({ nastiness, bigBang: true, lastHitter: human("hitter") }),
      ).state.grudge,
      expected,
      String(nastiness),
    );
  }
  let draws = 0;
  const result = new NativeRegularDecision(initial()).run(
    query({
      inView: true,
      nastiness: 2 ** 27,
    }),
    () => {
      draws++;
      return 0;
    },
  );
  assert.equal(
    result.transition,
    null,
    "30*2^27-10 returns negative signed low DWORD",
  );
  assert.equal(draws, 1);
  const invalid = new NativeRegularDecision(initial({ grudge: 20 }));
  assert.equal(
    invalid.run(query({ inView: true, nastiness: 2 ** 59 }), () => {
      draws++;
      return 0;
    }).transition,
    null,
  );
  assert.equal(draws, 1, "signed64 indefinite low zero skips chance RNG");
});
