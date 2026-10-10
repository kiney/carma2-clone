import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeStruggleThresholds,
  nativeStruggleTiming,
} from "../src/ai/path-struggle.ts";

const U32_MAX = 0xffffffff;
const wrapCountDelay = (count) => (750 * count - 750) >>> 0;

test("count zero retains the native unsigned count-delay wrap", () => {
  const timing = nativeStruggleThresholds(100, 0, 1.5);
  assert.equal(wrapCountDelay(0), 4294966546);
  assert.equal(timing.stopAtMs, 4294969441);
  assert.equal(timing.brakeAtMs, 4294968668.5);
  assert.deepEqual(
    nativeStruggleTiming(U32_MAX, 100, 0, 1.5),
    { ...nativeStruggleThresholds(100, 0, 1.5), stop: false, brake: false },
    "even the largest native timestamp cannot reach the wrapped default delay",
  );
});

test("counts one and two add zero and 750 ms respectively", () => {
  assert.deepEqual(nativeStruggleThresholds(100, 1, 2), {
    stopAtMs: 2910,
    brakeAtMs: 2130,
  });
  assert.deepEqual(nativeStruggleThresholds(100, 2, 2), {
    stopAtMs: 3660,
    brakeAtMs: 2880,
  });
});

test("Float32 mass changes thresholds through native mass terms", () => {
  const light = nativeStruggleThresholds(1000, 1, Math.fround(1.1));
  const heavy = nativeStruggleThresholds(1000, 1, Math.fround(2.1));
  assert.equal(light.stopAtMs, 3750 + 30 * Math.fround(1.1));
  assert.equal(light.brakeAtMs, 3000 + 15 * Math.fround(1.1));
  assert.equal(
    heavy.stopAtMs - light.stopAtMs,
    30 * (Math.fround(2.1) - Math.fround(1.1)),
  );
  assert.equal(
    heavy.brakeAtMs - light.brakeAtMs,
    15 * (Math.fround(2.1) - Math.fround(1.1)),
  );
});

test("stop and brake comparisons are strict and stop takes precedence", () => {
  const thresholds = nativeStruggleThresholds(100, 1, 2);
  assert.equal(
    nativeStruggleTiming(thresholds.brakeAtMs, 100, 1, 2).brake,
    false,
  );
  assert.equal(nativeStruggleTiming(2131, 100, 1, 2).brake, true);
  assert.equal(
    nativeStruggleTiming(thresholds.stopAtMs, 100, 1, 2).stop,
    false,
  );
  assert.equal(nativeStruggleTiming(2911, 100, 1, 2).stop, true);
  assert.equal(nativeStruggleTiming(2911, 100, 1, 2).brake, false);
});

test("timestamp wrap preserves signed stop base and unsigned brake base", () => {
  const wrapped = nativeStruggleThresholds(0xfffffff0, 1, 0);
  assert.equal(wrapped.stopAtMs, 2734);
  assert.equal(wrapped.brakeAtMs, 1984);

  const signedBoundary = nativeStruggleThresholds(0x7fffffff, 1, 0);
  assert.equal(signedBoundary.stopAtMs, -2147480899);
  assert.equal(signedBoundary.brakeAtMs, 2147485647);
  assert.deepEqual(nativeStruggleTiming(0, 0x7fffffff, 1, 0), {
    ...signedBoundary,
    stop: true,
    brake: false,
  });
});

test("native struggle timing rejects invalid timestamps, counts, and Float32 mass", () => {
  assert.throws(() => nativeStruggleThresholds(-1, 1, 1));
  assert.throws(() => nativeStruggleThresholds(0x100000000, 1, 1));
  assert.throws(() => nativeStruggleTiming(1.5, 0, 1, 1));
  assert.throws(() => nativeStruggleThresholds(0, -1, 1));
  assert.throws(() => nativeStruggleThresholds(0, 256, 1));
  assert.throws(() => nativeStruggleThresholds(0, 1.5, 1));
  assert.throws(() => nativeStruggleThresholds(0, 1, Infinity));
  assert.throws(() => nativeStruggleThresholds(0, 1, 1e100));
});
