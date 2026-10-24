import assert from "node:assert/strict";
import test from "node:test";
import { RacePayout } from "../src/race-payout.ts";
import { consumeNativeEarnCredits } from "../src/ped-awards.ts";
import { completeRace, createRace } from "../src/gameplay.ts";

const createPayout = (overrides = {}) =>
  new RacePayout({
    snapshotCredits: 1000,
    completionBonus: 120,
    timeLeft: 2,
    rate: 15,
    suppressPresentation: false,
    ...overrides,
  });

test("payout follows native states, delay, rattle thresholds, and partial seconds", () => {
  const payout = createPayout({ timeLeft: 2.9999 });
  assert.equal(payout.timeLeft, 2.999);
  assert.equal(payout.totalBonus, 150);

  payout.update(9999);
  assert.equal(payout.state, 0);
  payout.update(1);
  assert.equal(payout.state, 1);

  payout.update(499);
  assert.equal(payout.state, 1);
  assert.equal(payout.credits, 1000);
  assert.deepEqual(payout.update(1), [8015]);
  assert.equal(payout.state, 2);
  assert.equal(payout.credits, 1120);

  payout.update(1999);
  assert.equal(payout.state, 2);
  payout.update(1);
  assert.equal(payout.state, 3);

  payout.update(15);
  assert.equal(payout.timeLeft, 2.999);
  assert.equal(payout.displayedBonus, 0);
  payout.update(1);
  assert.equal(payout.timeLeft, 1.999);
  assert.equal(payout.displayedBonus, 15);
  payout.update(15);
  assert.equal(payout.timeLeft, 0.999);
  assert.equal(payout.displayedBonus, 30);
  payout.update(16);
  assert.equal(payout.timeLeft, 0);
  payout.update(1);
  assert.equal(payout.state, 4);

  payout.update(999);
  assert.equal(payout.state, 4);
  payout.update(1);
  assert.equal(payout.state, 5);
  payout.update(15);
  assert.equal(payout.displayedBonus, 30);
  assert.equal(payout.credits, 1120);
  payout.update(1);
  assert.equal(payout.displayedBonus, 14);
  assert.equal(payout.credits, 1136);
  payout.update(15);
  assert.equal(payout.displayedBonus, 0);
  assert.equal(payout.credits, 1150);
  payout.update(1);
  assert.equal(payout.state, 6);
  payout.update(1999);
  assert.equal(payout.finished, false);
  payout.update(1);
  assert.equal(payout.finished, true);
  assert.equal(payout.credits, 1150);
});

test("skip settles the full bonus exactly once from every payout state", () => {
  for (const [snapshotCredits, expected] of [
    [1000, 1030],
    [-500, -470],
    [0x7fffffff, -2147483619],
  ])
    for (let target = 0; target <= 6; target += 1) {
      const payout = createPayout({
        snapshotCredits,
        completionBonus: 20,
        timeLeft: 1,
        rate: 10,
      });
      if (target >= 1) payout.update(10000);
      if (target >= 2) payout.update(500);
      if (target >= 3) payout.update(2000);
      if (target >= 4) {
        payout.update(30000);
        payout.update(1);
      }
      if (target >= 5) payout.update(1000);
      if (target >= 6) {
        payout.update(30);
        payout.update(1);
      }
      assert.equal(payout.state, target, `prepared payout state ${target}`);

      payout.skip();
      assert.equal(payout.finished, true);
      assert.equal(payout.credits, expected);
      payout.skip();
      payout.update(10000);
      assert.equal(payout.credits, expected);
    }
});

test("runtime 99 waits through the finish delay, then settles without presentation", () => {
  const payout = createPayout({ suppressPresentation: true });
  payout.update(9999);
  assert.equal(payout.finished, false);
  assert.equal(payout.credits, 1000);
  assert.equal(payout.state, 0);

  assert.deepEqual(payout.update(1), []);
  assert.equal(payout.finished, true);
  assert.equal(payout.state, 0);
  assert.equal(payout.displayedBonus, 0);
  assert.equal(payout.credits, 1150);
  assert.deepEqual(payout.update(500), []);
  assert.equal(payout.credits, 1150);
});

test("zero remaining time skips presentation after the finish delay", () => {
  const payout = createPayout({ timeLeft: 0 });
  payout.update(10000);
  assert.equal(payout.finished, true);
  assert.equal(payout.state, 0);
  assert.equal(payout.credits, 1120);
});

test("rejects invalid timesteps without advancing the payout", () => {
  const payout = createPayout();
  for (const dt of [-0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => payout.update(dt), RangeError);
    assert.equal(payout.state, 0);
    assert.equal(payout.credits, 1000);
  }
});

test("finish countdown advances by frame periods, not absolute game time", () => {
  const payout = createPayout();
  payout.update(9999, 50_000);
  assert.equal(payout.state, 0);
  assert.equal(payout.timeLeft, 2);
  assert.equal(payout.credits, 1000);

  payout.update(1, 50_000);
  assert.equal(payout.state, 1);
  assert.equal(payout.credits, 1000);
});

test("native unsigned SUB/JB presentation thresholds wrap across a clock regression", () => {
  const payout = createPayout();
  payout.update(10_000, 0);
  assert.equal(payout.state, 1);

  payout.update(0, 2000);
  assert.equal(payout.state, 2);
  assert.equal(payout.credits, 1120);

  payout.update(1000, 1032);
  assert.equal(
    payout.state,
    3,
    "native elapsed is U32(1032−2000), above the threshold",
  );
  payout.update(1000, 1048);
  assert.equal(payout.state, 3);
  assert.equal(payout.credits, 1120);
  assert.equal(payout.timeLeft, 1);
  assert.equal(payout.displayedBonus, 15);

  payout.update(0, 1063);
  assert.equal(payout.timeLeft, 0);
  assert.equal(payout.displayedBonus, 30);
});

test("presentation uses unsigned native timestamps across DWORD rollover", () => {
  const payout = createPayout();
  payout.update(10000, 0xfffffff0);
  assert.equal(payout.state, 1);
  payout.update(0, 483);
  assert.equal(payout.state, 1);
  payout.update(0, 484);
  assert.equal(payout.state, 2, "U32(484−0xfffffff0) is500ms");
  assert.equal(payout.credits, 1120);
});

test("negative signed earned credits remain a valid payout snapshot", () => {
  const earned = consumeNativeEarnCredits({
    amount: -200,
    creditMultiplier: 3,
    currentCredits: 100,
    raceFinished: false,
  });
  assert.equal(earned.credits, -500);
  const payout = createPayout({ snapshotCredits: earned.credits });
  payout.skip();
  assert.equal(payout.credits, -350);
  for (const key of ["snapshotCredits", "completionBonus", "rate", "timeLeft"])
    assert.throws(() => createPayout({ [key]: NaN }), RangeError);
  for (const key of ["completionBonus", "rate", "timeLeft"])
    assert.throws(() => createPayout({ [key]: -1 }), RangeError);
});

test("actual native state3/5 captures preserve low32 multiplication, signed clamps and unsigned division", () => {
  // Captured with the optional hash-checked original-function probe. The
  // fixtures isolate an existing state; expected scalars are native outputs.
  for (const [state, now, timerMs, displayedBonus, rate, credits, expected] of [
    [3, 16, 2999, 0, 15, 1120, [1999, 15, 1120, 15]],
    [3, 31, 2999, 0, 15, 1120, [999, 30, 1120, 30]],
    [
      3,
      0xffffffff,
      2999,
      0,
      15,
      1120,
      [1431658831, -21474825, 1120, 0xffffffff],
    ],
    [3, 16, 2000, 0x7fffffff, 15, 1120, [1000, -2147483634, 1120, 15]],
    [5, 15, 0, 30, 15, 0x7fffffff, [0, 30, 0x7fffffff, 0]],
    [5, 16, 0, 30, 15, 0x7fffffff, [0, 14, -2147483633, 15]],
    [5, 16, 0, 30, 0x10000000, 1000, [0, 30, 1000, 15]],
    [
      5,
      0xffffffff,
      0,
      1000000000,
      15,
      0x7fffffff,
      [0, 713668848, -1861152497, 0xffffffff],
    ],
  ]) {
    const payout = createPayout({ timeLeft: timerMs / 1000, rate });
    Object.assign(payout, { state, displayedBonus, credits });
    payout.update(0, now);
    assert.deepEqual(
      [
        payout.timerMs,
        payout.displayedBonus,
        payout.credits,
        payout.lastRattleMs,
      ],
      expected,
    );
  }
});

test("native signed total and settlement agree with immediate completion, preserving practice guard", () => {
  for (const [
    snapshotCredits,
    completionBonus,
    timerMs,
    rate,
    totalBonus,
    credits,
  ] of [
    [0x7fffffff, 120, 2999, 15, 150, -2147483499],
    [-500, 120, 2999, 15, 150, -350],
    [0x7fffffff, 120, 0x7fffffff, 0x7fffffff, 2145336285, -2147364],
  ]) {
    const payout = createPayout({
      snapshotCredits,
      completionBonus,
      timeLeft: timerMs / 1000,
      rate,
    });
    assert.equal(payout.totalBonus, totalBonus);
    payout.skip();
    assert.equal(payout.credits, credits);
    const race = createRace([], {
      credits: snapshotCredits,
      completionCreditsByReason: [completionBonus, completionBonus],
      completionTimeCreditRate: rate,
    });
    race.timeLeft = timerMs / 1000;
    assert.equal(completeRace(race, 1), true);
    assert.equal(race.credits, credits);
    const practice = createRace([], {
      practice: true,
      credits: snapshotCredits,
    });
    assert.equal(completeRace(practice, 0), false);
    assert.equal(practice.credits, snapshotCredits);
  }
});
