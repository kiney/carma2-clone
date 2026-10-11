import test from "node:test";
import assert from "node:assert/strict";
import {
  assignNativePersonalities,
  nativeOpponentNastiness,
  resolveNativeRaceNastiness,
} from "../src/ai/personality.ts";

const catalog = (levels, first = 0.25, last = 0.75) => ({
  races: levels.map((opponentNastinessLevel) => ({ opponentNastinessLevel })),
  firstRaceDefaults: { nastinessInfluencer: first },
  lastRaceDefaults: { nastinessInfluencer: last },
});

test("race nastiness interpolates stored endpoints but preserves authored values", () => {
  const races = catalog([0, 0, 0, Math.fround(2 ** -22), 0.9], 0.2, 0.8);
  const first = Math.fround(0.2);
  const last = Math.fround(0.8);
  for (let index = 0; index < 4; index++) {
    assert.equal(
      resolveNativeRaceNastiness(races, index),
      Math.fround(first + (last - first) * (index / 4)),
    );
  }
  assert.equal(resolveNativeRaceNastiness(races, 4), Math.fround(0.9));

  const justAboveSentinel = Math.fround(2 ** -22 + 2 ** -45);
  assert.ok(justAboveSentinel > 2 ** -22);
  assert.equal(
    resolveNativeRaceNastiness(catalog([0, justAboveSentinel]), 1),
    justAboveSentinel,
  );
  assert.throws(() => resolveNativeRaceNastiness(races, -1), /index/);
  assert.throws(() => resolveNativeRaceNastiness(races, 5), /index/);
  assert.throws(
    () => resolveNativeRaceNastiness(catalog([0]), 0),
    /interpolate/,
  );
});

test("opponent nastiness follows native strength/skill adjustment and F32 stores", () => {
  const race = Math.fround(2.3);
  const multiplier = Math.fround(1.7);
  const expected = Math.fround(
    (race - ((4 - 1) * -0.25 + 3 * -0.5)) * 0.3333333333333333 * multiplier,
  );
  assert.equal(nativeOpponentNastiness(2.3, 3, 4, 1.7), expected);

  // The race and multiplier are input fields stored as Float32 before the
  // extended-precision expression; this value changes if raw decimal inputs
  // are used instead.
  assert.equal(
    nativeOpponentNastiness(1.00000006, 0, 1, 1.00000006),
    Math.fround(
      Math.fround(1.00000006) * 0.3333333333333333 * Math.fround(1.00000006),
    ),
  );
  assert.throws(
    () => nativeOpponentNastiness(Infinity, 0, 1),
    /race nastiness/,
  );
  assert.throws(() => nativeOpponentNastiness(1, 1.5, 1), /skill or strength/);
  assert.equal(
    nativeOpponentNastiness(1, 0, -2147483648),
    Math.fround((1 + 2147483647 * 0.25) / 3),
  );
  assert.throws(
    () => nativeOpponentNastiness(3e38, 0, 1, 3e38),
    /Float32 bounds/,
  );
  assert.throws(
    () => nativeOpponentNastiness(1, 0, 1, Number.MAX_VALUE),
    /multiplier/,
  );
});

test("forced-personality quotas truncate at each native population size", () => {
  for (const count of [1, 2, 5, 10, 12, 15]) {
    let draws = 0;
    const assigned = assignNativePersonalities(count, 9.5, () => {
      draws++;
      return 0;
    });
    assert.equal(assigned.length, count);
    assert.equal(
      assigned.filter((value) => value === 2).length,
      Math.trunc(0.6 * count),
    );
    assert.equal(
      assigned.filter((value) => value === 1).length,
      Math.trunc(0.2 * count),
    );
    assert.equal(
      assigned.filter((value) => value === 0).length,
      count - Math.trunc(0.6 * count) - Math.trunc(0.2 * count),
    );
    assert.equal(draws, Math.trunc(0.6 * count) + Math.trunc(0.2 * count));
  }
});

test("bounded 15-bit draws scan forward and wrap through physical slots", () => {
  const lowTrace = [];
  const low = assignNativePersonalities(5, 1, () => {
    lowTrace.push(0);
    return 0;
  });
  assert.deepEqual(low, [2, 2, 2, 1, 0]);
  assert.equal(lowTrace.length, 4);

  const highTrace = [];
  const high = assignNativePersonalities(5, 1, () => {
    highTrace.push(1);
    return 1 - 1 / 32768;
  });
  assert.deepEqual(high, [0, 1, 2, 2, 2]);
  assert.equal(highTrace.length, 4);

  let calls = 0;
  assert.deepEqual(
    assignNativePersonalities(5, 10, () => {
      calls++;
      return 0;
    }),
    [3, 3, 3, 3, 3],
  );
  assert.deepEqual(
    assignNativePersonalities(0, 1, () => {
      calls++;
      return 0;
    }),
    [],
  );
  assert.equal(calls, 0, "all-type-3 and empty populations do not draw RNG");
  assert.throws(() => assignNativePersonalities(5, 1, () => 1), /\[0, 1\)/);
  assert.throws(() => assignNativePersonalities(5, 1, () => NaN), /\[0, 1\)/);
});

test("personality assignment validates native count and finite race level", () => {
  for (const count of [-1, 16, 2.5])
    assert.throws(() => assignNativePersonalities(count, 1), /count/);
  assert.throws(() => assignNativePersonalities(2, Infinity), /race nastiness/);
  assert.throws(
    () => assignNativePersonalities(2, Number.MAX_VALUE),
    /race nastiness/,
  );
});
