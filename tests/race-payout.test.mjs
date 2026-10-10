import assert from "node:assert/strict";
import test from "node:test";
import { RacePayout } from "../src/race-payout.ts";

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
  for (let target = 0; target <= 6; target += 1) {
    const payout = createPayout({ completionBonus: 20, timeLeft: 1, rate: 10 });
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
    assert.equal(payout.credits, 1030);
    payout.skip();
    payout.update(10000);
    assert.equal(payout.credits, 1030);
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

test("presentation thresholds use absolute time through a predicted-clock regression", () => {
  const payout = createPayout();
  payout.update(10_000, 0);
  assert.equal(payout.state, 1);

  payout.update(0, 2000);
  assert.equal(payout.state, 2);
  assert.equal(payout.credits, 1120);

  payout.update(1000, 1032);
  assert.equal(payout.state, 2, "period cannot advance the presentation state");
  payout.update(1000, 1048);
  assert.equal(
    payout.state,
    2,
    "small recovery after regression does not double count",
  );
  assert.equal(payout.credits, 1120);

  payout.update(0, 4000);
  assert.equal(
    payout.state,
    3,
    "state 2 ends at its absolute 2000ms threshold",
  );
});
