import test from "node:test";
import assert from "node:assert/strict";
import { nativeCrashSmokeReturn } from "../src/physics/crash-smoke.ts";

const argument = (damage = 0, driver = 8) => ({
  driver,
  accumulatorF32: damage,
});
const car = (damage = 0, overrides = {}) => ({
  frameKnackered: false,
  accumulatorF32: damage,
  lastAttackerMs: 100,
  ...overrides,
});
const world = (damage = 0, overrides = {}) => ({
  originalFirst: argument(damage),
  originalSecond: null,
  normalizedFirst: car(damage),
  normalizedSecond: null,
  nowMs: 100,
  ...overrides,
});
const pair = (a, b, overrides = {}) => ({
  originalFirst: argument(a),
  originalSecond: argument(b, 6),
  normalizedFirst: car(a),
  normalizedSecond: car(b),
  nowMs: 100,
  ...overrides,
});

test("world expiry returns1 at signed 5000ms even with zero saved damage", () => {
  assert.equal(nativeCrashSmokeReturn(world(0, { nowMs: 5099 })), false);
  assert.equal(nativeCrashSmokeReturn(world(0, { nowMs: 5100 })), true);
  assert.equal(nativeCrashSmokeReturn(world(0.5, { nowMs: 5100 })), true);
  assert.equal(
    nativeCrashSmokeReturn(
      world(0, {
        normalizedFirst: car(0, { lastAttackerMs: 0xfffffff0 }),
        nowMs: 4984,
      }),
    ),
    true,
  );
  assert.equal(
    nativeCrashSmokeReturn(
      world(0, {
        normalizedFirst: car(0, { lastAttackerMs: 0x80000000 }),
        nowMs: 0,
      }),
    ),
    false,
    "signed negative wrapped age does not expire",
  );
});

test("primary __ftol low DWORD and secondary nonzero float are asymmetric", () => {
  assert.equal(nativeCrashSmokeReturn(world(0.5)), false);
  assert.equal(nativeCrashSmokeReturn(world(1)), true);
  assert.equal(nativeCrashSmokeReturn(world(2 ** 32)), false);
  assert.equal(nativeCrashSmokeReturn(world(2 ** 31)), true);
  assert.equal(nativeCrashSmokeReturn(pair(0.5, 0)), false);
  assert.equal(nativeCrashSmokeReturn(pair(0, 0.5)), true);
  assert.equal(nativeCrashSmokeReturn(pair(0, 2 ** -149)), true);
  assert.equal(nativeCrashSmokeReturn(pair(0, 2 ** -150)), false);
});

test("frame-knackered early exits use saved gate and precede world expiry", () => {
  assert.equal(
    nativeCrashSmokeReturn(
      world(0.5, {
        normalizedFirst: car(0.5, { frameKnackered: true }),
        nowMs: 10000,
      }),
    ),
    false,
  );
  assert.equal(
    nativeCrashSmokeReturn(
      world(1, { normalizedFirst: car(1, { frameKnackered: true }) }),
    ),
    true,
  );
  assert.equal(
    nativeCrashSmokeReturn(
      pair(0.5, 0, { normalizedFirst: car(0.5, { frameKnackered: true }) }),
    ),
    false,
  );
  assert.equal(
    nativeCrashSmokeReturn(
      pair(0, 0.5, { normalizedSecond: car(0.5, { frameKnackered: true }) }),
    ),
    true,
  );
});

test("both low damage early exit can still request smoke for the second car", () => {
  const threshold = Math.fround(0.00005);
  assert.equal(nativeCrashSmokeReturn(pair(threshold, 0)), false);
  assert.equal(nativeCrashSmokeReturn(pair(0, threshold)), true);
  assert.equal(nativeCrashSmokeReturn(pair(0, 0)), false);
  assert.equal(nativeCrashSmokeReturn(pair(1, 0)), true);
});

test("saved original arguments survive normalization and cleanup snapshots", () => {
  const moved = world(2, {
    originalFirst: argument(999, 2),
    originalSecond: argument(2, 8),
  });
  assert.equal(
    nativeCrashSmokeReturn(moved),
    false,
    "normalized second pointer was cleared",
  );
  moved.nowMs = 5100;
  assert.equal(
    nativeCrashSmokeReturn(moved),
    true,
    "direct expired-world return bypasses saved gate",
  );
  const initial = pair(0, 0.5);
  const saved = structuredClone(initial);
  assert.equal(nativeCrashSmokeReturn(initial), true);
  assert.deepEqual(
    initial,
    saved,
    "return computation must not clear or refresh state",
  );
  initial.normalizedFirst.accumulatorF32 = 0;
  initial.normalizedSecond.accumulatorF32 = 0;
  assert.equal(
    nativeCrashSmokeReturn(initial),
    true,
    "saved original secondary damage remains independent",
  );
});

test("two noncars return0 before all later gates, and invalid domains reject", () => {
  const input = {
    originalFirst: argument(NaN, 1),
    originalSecond: argument(NaN, 4),
    normalizedFirst: null,
    normalizedSecond: null,
    nowMs: 0,
  };
  assert.equal(
    nativeCrashSmokeReturn(input),
    false,
    "noncar accumulator is never read",
  );
  assert.throws(
    () => nativeCrashSmokeReturn(world(0, { nowMs: -1 })),
    /timestamp/,
  );
  assert.throws(() => nativeCrashSmokeReturn(world(Infinity)), /accumulator/);
  assert.throws(
    () => nativeCrashSmokeReturn(pair(0, 1, { normalizedSecond: null })),
    /normalized pair/,
  );
});
