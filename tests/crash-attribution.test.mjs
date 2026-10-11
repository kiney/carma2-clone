import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { selectNativeCrashAttribution } from "../src/physics/crash-attribution.ts";

const baseHistory = () => ({
  lastAttacker: null,
  lastMs: 0,
  previousAttacker: null,
  previousMs: 0,
});

function car(identity, overrides = {}) {
  return {
    identity,
    driver: 6,
    frameKnackered: false,
    accumulatorF32: 0.1,
    firstContactFace: 5,
    normalizedContactZ: 0.8,
    preSpeedF32: 0.2,
    localVelocityF32: new Vector3(0, 0, 1),
    gear: 0,
    accelKey: true,
    joystick: 0,
    history: baseHistory(),
    ...overrides,
  };
}

const humanDriving = (identity, overrides = {}) =>
  car(identity, { driver: 7, ...overrides });

test("AI6 selected pair emits attacker roles and clears both accumulators", () => {
  const a = car("a");
  const b = car("b", {
    preSpeedF32: 0.1,
    firstContactFace: 0,
    normalizedContactZ: 0.5,
  });
  const result = selectNativeCrashAttribution(a, b, 100);
  assert.deepEqual(result, {
    roles: { attacker: "a", victim: "b" },
    inherited: false,
    cleanup: true,
  });
  assert.equal(a.accumulatorF32, 0);
  assert.equal(b.accumulatorF32, 0);
});

test("strict F32 speed product and minimum-speed thresholds reject equality", () => {
  const a = car("a", { preSpeedF32: 0.125 });
  const b = car("b", {
    firstContactFace: 0,
    normalizedContactZ: 0.5,
    preSpeedF32: Math.fround(Math.fround(0.125) * Math.fround(5)),
  });
  let result = selectNativeCrashAttribution(a, b, 10);
  assert.equal(result.roles, null);
  assert.equal(result.cleanup, true);

  const liveProduct = car("live", { preSpeedF32: 0.2 });
  const roundedOther = car("rounded", {
    firstContactFace: 0,
    normalizedContactZ: 0.5,
    preSpeedF32: Math.fround(1),
  });
  result = selectNativeCrashAttribution(liveProduct, roundedOther, 10);
  assert.equal(
    result.roles?.attacker,
    "live",
    "the product remains live after F32 field loads",
  );

  const slow = car("slow", { preSpeedF32: Math.fround(0.0005) });
  const other = car("other", {
    firstContactFace: 0,
    normalizedContactZ: 0.5,
    preSpeedF32: 0,
  });
  result = selectNativeCrashAttribution(slow, other, 11);
  assert.equal(result.roles, null);
});

test("raw face remap uses strict quarter boundaries and movement ties fall to Z", () => {
  const exactQuarter = car("quarter", {
    firstContactFace: 0,
    normalizedContactZ: 0.25,
    localVelocityF32: new Vector3(0, 1, 0.1),
  });
  const weak = car("weak", { accumulatorF32: 0 });
  let result = selectNativeCrashAttribution(exactQuarter, weak, 20);
  assert.equal(result.roles?.attacker, "quarter");

  const belowQuarter = car("below", {
    firstContactFace: 0,
    normalizedContactZ: Math.fround(0.24999999),
    localVelocityF32: new Vector3(0, 1, 1),
  });
  result = selectNativeCrashAttribution(
    belowQuarter,
    car("victim", {
      firstContactFace: 1,
      normalizedContactZ: 0.5,
      preSpeedF32: 0,
    }),
    21,
  );
  assert.equal(result.roles, null);

  const zeroZtie = car("z-tie", {
    firstContactFace: 5,
    normalizedContactZ: 0.8,
    localVelocityF32: new Vector3(1, 0, 1),
  });
  result = selectNativeCrashAttribution(
    zeroZtie,
    car("other", {
      firstContactFace: 0,
      normalizedContactZ: 0.5,
      preSpeedF32: 0,
    }),
    22,
  );
  assert.equal(result.roles?.attacker, "z-tie");
});

test("human B8 wins when both candidates qualify, while AI pair roles remain reportable", () => {
  const a = humanDriving("human-a", { driver: 7, preSpeedF32: 0.2 });
  const b = humanDriving("human-b", { driver: 8, preSpeedF32: 0.1 });
  const result = selectNativeCrashAttribution(a, b, 50);
  assert.deepEqual(result.roles, { attacker: "human-b", victim: "human-a" });
  assert.equal(a.history.lastAttacker, "human-b");
  assert.equal(a.history.previousAttacker, "human-b");
  assert.equal(a.history.lastMs, 50);
  assert.equal(a.history.previousMs, 50);
});

test("early human A history branch does not fall through to matching human B", () => {
  const a = humanDriving("a", {
    firstContactFace: 0,
    normalizedContactZ: 0.5,
    localVelocityF32: new Vector3(1, 0, 0),
    preSpeedF32: 0.2,
  });
  const b = humanDriving("b", {
    firstContactFace: 5,
    normalizedContactZ: 0.8,
    localVelocityF32: new Vector3(0, 0, 1),
    preSpeedF32: 0.01,
  });
  const result = selectNativeCrashAttribution(a, b, 77);
  assert.equal(a.history.lastAttacker, null);
  assert.equal(result.roles, null);
  assert.equal(result.cleanup, true);
});

test("early human history storage has no speed gate", () => {
  const a = humanDriving("a", { preSpeedF32: 0.0001 });
  const b = car("b", {
    firstContactFace: 0,
    normalizedContactZ: 0.5,
    preSpeedF32: 0,
  });
  const result = selectNativeCrashAttribution(a, b, 123);
  assert.equal(b.history.lastAttacker, "a");
  assert.equal(b.history.lastMs, 123);
  assert.equal(result.roles, null);
});

test("inherited pair fallback is strict at 750ms and uses signed wrapped age", () => {
  const a = car("a", { firstContactFace: 0, normalizedContactZ: 0.5 });
  const b = car("b", {
    firstContactFace: 1,
    normalizedContactZ: 0.5,
    history: { ...baseHistory(), previousAttacker: "a", previousMs: 1000 },
  });
  let result = selectNativeCrashAttribution(a, b, 1749);
  assert.deepEqual(result.roles, { attacker: "a", victim: "b" });
  assert.equal(result.inherited, true);
  assert.equal(
    b.history.previousMs,
    1000,
    "inherited selection must not extend previous-pair age",
  );

  const staleA = car("a", { firstContactFace: 0, normalizedContactZ: 0.5 });
  const staleB = car("b", {
    firstContactFace: 1,
    normalizedContactZ: 0.5,
    history: { ...baseHistory(), previousAttacker: "a", previousMs: 1000 },
  });
  assert.equal(selectNativeCrashAttribution(staleA, staleB, 1750).roles, null);

  const wrapA = car("wa", { firstContactFace: 0, normalizedContactZ: 0.5 });
  const wrapB = car("wb", {
    firstContactFace: 1,
    normalizedContactZ: 0.5,
    history: {
      ...baseHistory(),
      previousAttacker: "wa",
      previousMs: 0xfffffff0,
    },
  });
  result = selectNativeCrashAttribution(wrapA, wrapB, 100);
  assert.deepEqual(result.roles, { attacker: "wa", victim: "wb" });
});

test("null-other last-attacker continuation expires at signed 5000 and preserves accumulators on rejection", () => {
  const human = humanDriving("human", { driver: 8 });
  const victim = car("victim", {
    history: {
      ...baseHistory(),
      lastAttacker: "human",
      lastMs: 1000,
      previousAttacker: "older",
      previousMs: 900,
    },
  });
  let result = selectNativeCrashAttribution(victim, null, 5999, (id) =>
    id === "human" ? human : null,
  );
  assert.deepEqual(result.roles, { attacker: "human", victim: "victim" });
  assert.equal(result.inherited, true);
  assert.equal(result.cleanup, true);
  assert.equal(
    victim.history.lastMs,
    5999,
    "accepted human continuation refreshes last-hit time",
  );
  assert.equal(victim.history.previousMs, 900);
  assert.equal(victim.accumulatorF32, 0);

  const expired = car("expired", {
    history: { ...baseHistory(), lastAttacker: "human", lastMs: 1000 },
  });
  assert.equal(
    selectNativeCrashAttribution(expired, null, 6000, () => human),
    null,
  );
  assert.equal(expired.accumulatorF32, 0.1);
});

test("null-other previous history uses callback identity lookup and signed 750ms age", () => {
  const victim = car("victim", {
    history: {
      ...baseHistory(),
      previousAttacker: "third-party",
      previousMs: 1000,
    },
  });
  const thirdParty = car("third-party", { driver: 8 });
  const result = selectNativeCrashAttribution(victim, null, 1749, (id) =>
    id === "third-party" ? thirdParty : null,
  );
  assert.deepEqual(result.roles, { attacker: "third-party", victim: "victim" });
  assert.equal(result.inherited, true);
  assert.equal(victim.history.previousMs, 1000);
});

test("fresh null-other AI6 history can be replaced by recent previous attacker; stale NULL blocks fallback", () => {
  const oldAi = car("old-ai", { driver: 6 });
  const recentHuman = car("recent-human", { driver: 8 });
  const victim = car("victim", {
    history: {
      lastAttacker: "old-ai",
      lastMs: 1000,
      previousAttacker: "recent-human",
      previousMs: 1100,
    },
  });
  const freshResult = selectNativeCrashAttribution(
    victim,
    null,
    1500,
    (id) => ({ "old-ai": oldAi, "recent-human": recentHuman })[id] ?? null,
  );
  assert.deepEqual(freshResult.roles, {
    attacker: "recent-human",
    victim: "victim",
  });
  assert.equal(freshResult.inherited, true);
  assert.equal(victim.history.lastAttacker, "recent-human");
  assert.equal(victim.history.previousMs, 1100);

  const staleNull = car("stale-null", {
    history: {
      lastAttacker: null,
      lastMs: 1000,
      previousAttacker: "recent-human",
      previousMs: 1490,
    },
  });
  assert.equal(
    selectNativeCrashAttribution(staleNull, null, 6000, () => recentHuman),
    null,
  );
  assert.equal(staleNull.accumulatorF32, 0.1);

  const freshNull = car("fresh-null", {
    history: { ...baseHistory(), previousMs: 1450 },
  });
  const noAttacker = selectNativeCrashAttribution(freshNull, null, 1500);
  assert.equal(
    noAttacker.roles,
    null,
    "fresh null previous pointer overwrites an absent last pointer",
  );
  assert.equal(noAttacker.inherited, true);
  assert.equal(noAttacker.cleanup, true);
  assert.equal(freshNull.accumulatorF32, 0);
});

test("attribution callback runs before pair history refresh and accumulator cleanup", () => {
  const attacker = humanDriving("attacker", { driver: 8 });
  const victim = car("victim", {
    firstContactFace: 0,
    normalizedContactZ: 0.5,
    localVelocityF32: new Vector3(1, 0, 0),
    history: { ...baseHistory(), previousAttacker: "older", previousMs: 12 },
  });
  const observed = [];
  const result = selectNativeCrashAttribution(
    attacker,
    victim,
    77,
    undefined,
    (selectedAttacker, selectedVictim) => {
      observed.push({
        attacker: selectedAttacker.identity,
        victim: selectedVictim.identity,
        previous: selectedVictim.history.previousAttacker,
        previousMs: selectedVictim.history.previousMs,
        accumulators: [
          selectedAttacker.accumulatorF32,
          selectedVictim.accumulatorF32,
        ],
      });
    },
  );
  assert.deepEqual(observed, [
    {
      attacker: "attacker",
      victim: "victim",
      previous: "older",
      previousMs: 12,
      accumulators: [0.1, 0.1],
    },
  ]);
  assert.equal(victim.history.previousAttacker, "attacker");
  assert.equal(victim.history.previousMs, 77);
  assert.equal(attacker.accumulatorF32, 0);
  assert.equal(victim.accumulatorF32, 0);
  assert.equal(result.cleanup, true);
});

test("unresolved historical pointers fail boundedly instead of fabricating a role", () => {
  const victim = car("victim", {
    history: { ...baseHistory(), lastAttacker: "missing", lastMs: 10 },
  });
  assert.throws(
    () => selectNativeCrashAttribution(victim, null, 20),
    /identity could not be resolved/,
  );
  assert.equal(victim.accumulatorF32, 0.1);
});

test("knackered and low-accumulator rejection preserve history and damage values", () => {
  const a = car("a", { frameKnackered: true });
  const b = car("b");
  const beforeA = structuredClone(a.history);
  assert.equal(selectNativeCrashAttribution(a, b, 42), null);
  assert.equal(a.accumulatorF32, 0.1);
  assert.deepEqual(a.history, beforeA);

  const lowA = car("low-a", { accumulatorF32: Math.fround(0.00005) });
  const lowB = car("low-b", { accumulatorF32: Math.fround(0.00005) });
  assert.equal(selectNativeCrashAttribution(lowA, lowB, 43), null);
  assert.equal(lowA.accumulatorF32, Math.fround(0.00005));
  assert.equal(lowB.accumulatorF32, Math.fround(0.00005));
});

test("invalid timestamp and malformed car fields fail before mutations", () => {
  const a = car("a", { driver: 8 });
  const b = car("b");
  assert.throws(() => selectNativeCrashAttribution(a, b, -1));
  a.firstContactFace = 8;
  assert.throws(() => selectNativeCrashAttribution(a, b, 1));
  assert.equal(a.accumulatorF32, 0.1);
  assert.equal(a.history.previousAttacker, null);
});
