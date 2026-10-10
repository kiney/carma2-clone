import test from "node:test";
import assert from "node:assert/strict";
import {
  nativePercentageChance,
  nativeObjectiveDeadline,
  chooseForcedRegularObjective,
} from "../src/ai/objective.ts";

test("installed PercentageChance uses 100 buckets and preserves RNG consumption", () => {
  let draws = 0;
  const last = () => {
    draws++;
    return 32767 / 32768;
  };
  assert.equal(nativePercentageChance(0, last), false);
  assert.equal(draws, 0);
  assert.equal(nativePercentageChance(-1, last), false);
  assert.equal(draws, 1);
  assert.equal(nativePercentageChance(99, last), false);
  assert.equal(nativePercentageChance(100, last), true);
  assert.equal(draws, 3);
  assert.equal(
    nativePercentageChance(50, () => 16383 / 32768),
    true,
  );
  assert.equal(
    nativePercentageChance(50, () => 16384 / 32768),
    false,
  );
});

test("native objective deadlines use inclusive20..60, pursuit addition and u32 wrap", () => {
  assert.equal(
    nativeObjectiveDeadline(100, false, () => 0),
    20100,
  );
  assert.equal(
    nativeObjectiveDeadline(100, false, () => 32767 / 32768),
    60100,
  );
  assert.equal(
    nativeObjectiveDeadline(100, true, () => 0),
    110100,
  );
  assert.equal(
    nativeObjectiveDeadline(0xfffffff0, false, () => 0),
    19984,
  );
  let calls = 0;
  const random = () => {
    calls++;
    return 0;
  };
  nativeObjectiveDeadline(0, false, random);
  nativeObjectiveDeadline(0, false, random);
  assert.equal(calls, 2, "same-objective restarts also consume a fresh draw");
});

test("forced regular objective selection honors moved and original forced-type fields", () => {
  const noDraw = () =>
    assert.fail("native branch does not consume percentage RNG");
  assert.equal(
    chooseForcedRegularObjective(false, false, 3, 100, noDraw),
    "complete-race",
  );
  assert.equal(
    chooseForcedRegularObjective(false, true, 1, 100, noDraw),
    "pursue",
  );
  assert.equal(
    chooseForcedRegularObjective(true, false, 1, 100, noDraw),
    "complete-race",
  );
  assert.equal(
    chooseForcedRegularObjective(true, false, 2, 100, noDraw),
    "get-near-player",
  );
  assert.equal(
    chooseForcedRegularObjective(true, false, 3, 100, noDraw),
    "pursue",
  );
  assert.equal(
    chooseForcedRegularObjective(true, false, 0, 15.99, noDraw),
    "complete-race",
  );
  assert.equal(
    chooseForcedRegularObjective(true, false, 0, 65.9, () => 0.499),
    "get-near-player",
  );
  assert.equal(
    chooseForcedRegularObjective(true, false, 0, 65.9, () => 0.5),
    "complete-race",
  );
});

test("native objective helpers reject malformed inputs without corrupting timers", () => {
  assert.throws(() => nativeObjectiveDeadline(-1, false));
  assert.throws(() => nativeObjectiveDeadline(0, false, () => 1));
  assert.throws(() => nativePercentageChance(0.5));
  assert.throws(() => nativePercentageChance(100, () => NaN));
  assert.throws(() => chooseForcedRegularObjective(true, false, 0, Infinity));
});
