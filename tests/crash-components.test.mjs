import test from "node:test";
import assert from "node:assert/strict";
import {
  nativeCrashDamageAward,
  redistributeNativeCrashDamage,
} from "../src/physics/crash-components.ts";

const levels = (entries = {}) => {
  const result = new Uint8Array(12);
  for (const [index, value] of Object.entries(entries))
    result[Number(index)] = value;
  return result;
};

test("native component redistribution leaves flat and falling parts alone and reports only raised victim levels", () => {
  const attacker = levels({ 0: 10, 1: 20, 2: 30, 3: 8 });
  const attackerLast = levels({ 1: 20, 2: 40, 3: 8 });
  const victim = levels({ 0: 20, 1: 20, 2: 30, 3: 8 });
  const victimLast = levels({ 0: 10, 1: 25, 2: 20, 3: 8 });
  const snapshots = [attackerLast.slice(), victimLast.slice()];

  assert.equal(
    redistributeNativeCrashDamage(attacker, attackerLast, victim, victimLast),
    40,
  );
  assert.deepEqual([...attacker.slice(0, 4)], [1, 20, 30, 8]);
  assert.deepEqual([...victim.slice(0, 4)], [30, 20, 40, 8]);
  assert.deepEqual(attackerLast, snapshots[0]);
  assert.deepEqual(victimLast, snapshots[1]);

  // The stored current levels compound against the same baseline on another pair.
  assert.equal(
    redistributeNativeCrashDamage(attacker, attackerLast, victim, victimLast),
    80,
  );
  assert.equal(victim[0], 50);
  assert.equal(victim[2], 60);
});

test("redistribution clamps victim components at 99 and truncates the attacker share", () => {
  const attacker = levels({ 0: 99 });
  const attackerLast = levels({ 0: 98 });
  const victim = levels({ 0: 99 });
  const victimLast = levels({ 0: 98 });

  assert.equal(
    redistributeNativeCrashDamage(attacker, attackerLast, victim, victimLast),
    1,
  );
  assert.equal(victim[0], 99);
  assert.equal(attacker[0], 98, "trunc(98 + 0.1) stays at 98");
});

test("award rates use Float32 authored values and time ignores the credit multiplier", () => {
  assert.deepEqual(
    nativeCrashDamageAward(7, 0.7, 8, 0.8928571649138248, 0),
    { rawCredits: 100, credits: 100, seconds: 0 },
    "Float32 rate storage moves the credit subtotal across the native integer boundary",
  );
  assert.deepEqual(nativeCrashDamageAward(10, 0.7, 8, 0, 0.5), {
    rawCredits: 0,
    credits: 0,
    seconds: 5,
  });
  assert.equal(
    nativeCrashDamageAward(10, 0.70000004, 1, 0, 0.25).seconds,
    0,
    "victim softness is stored as Float32 before damage scaling",
  );
});

test("credit and time awards apply their native caps", () => {
  assert.deepEqual(nativeCrashDamageAward(1000, 0.7, 8, 100, 1), {
    rawCredits: 800000,
    credits: 2000,
    seconds: 90,
  });
});

test("component and award inputs reject malformed or out-of-range values", () => {
  assert.throws(
    () =>
      redistributeNativeCrashDamage(
        new Uint8Array(11),
        new Uint8Array(12),
        new Uint8Array(12),
        new Uint8Array(12),
      ),
    /12-entry/,
  );
  const invalidLevels = new Uint8Array(12);
  invalidLevels[4] = 100;
  assert.throws(
    () =>
      redistributeNativeCrashDamage(
        invalidLevels,
        new Uint8Array(12),
        new Uint8Array(12),
        new Uint8Array(12),
      ),
    /0\.\.99/,
  );
  for (const args of [
    [-1, 0.7, 1, 1, 1],
    [1189, 0.7, 1, 1, 1],
    [1, 0, 1, 1, 1],
    [1, 1e-100, 1, 1, 1],
    [1, 0.7, -1, 1, 1],
    [1, 0.7, 1, Number.NaN, 1],
    [1, 0.7, 1, 1e100, 1],
  ])
    assert.throws(() => nativeCrashDamageAward(...args));
});
