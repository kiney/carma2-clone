import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { selectNativeCrashAttribution } from "../src/physics/crash-attribution.ts";
import { applyNativeCrashReaction } from "../src/ai/crash-reactions.ts";

const history = (overrides = {}) => ({
  lastAttacker: null,
  lastMs: 0,
  previousAttacker: null,
  previousMs: 0,
  ...overrides,
});

function attributionCar(identity, driver, overrides = {}) {
  return {
    identity,
    driver,
    frameKnackered: false,
    accumulatorF32: 0.1,
    firstContactFace: 5,
    normalizedContactZ: 0.8,
    preSpeedF32: 0.2,
    localVelocityF32: new Vector3(0, 0, 1),
    gear: 0,
    accelKey: true,
    joystick: 0,
    history: history(),
    ...overrides,
  };
}

function reactionCar(source, overrides = {}) {
  return {
    identity: source.identity,
    driver: source.driver,
    damageAccumulatorF32: source.accumulatorF32,
    flags: { grudgeRecent: false, bigBang: false, scaryBang: false },
    lastHitter: null,
    lastWeHit: null,
    contactTimeMs: 0,
    accForce: 11,
    brakeForce: 12,
    curvature: 0.5,
    ...overrides,
  };
}

function weakOpponent(entry, overrides = {}) {
  return {
    catalogIndex: 0,
    objective: "complete-race",
    target: null,
    stunUntilMs: 0,
    notifyAttributedTargetHit() {},
    ...overrides,
  };
}

test("accepted pair reaction reads original victim accumulator before selector cleanup", () => {
  const attacker = attributionCar("player", 8, {
    accumulatorF32: 0.2,
    firstContactFace: 5,
    normalizedContactZ: 0.8,
    localVelocityF32: new Vector3(0, 0, 1),
    preSpeedF32: 0.2,
  });
  const victim = attributionCar("rival", 6, {
    accumulatorF32: 0.01,
    firstContactFace: 5,
    normalizedContactZ: 0.8,
    preSpeedF32: 0.01,
    history: history({ previousAttacker: "older", previousMs: 20 }),
  });
  const reactionAttacker = reactionCar(attacker);
  const reactionVictim = reactionCar(victim, {
    flags: { grudgeRecent: false, bigBang: false, scaryBang: true },
  });
  const catalog = { strength: 4, grudge: 94 };
  const opponent = weakOpponent(catalog, { stunUntilMs: 1000 });
  let callbackAccumulator = null;
  const selected = selectNativeCrashAttribution(
    attacker,
    victim,
    100,
    () => null,
    (a, v) => {
      callbackAccumulator = v.accumulatorF32;
      reactionAttacker.damageAccumulatorF32 = a.accumulatorF32;
      reactionVictim.damageAccumulatorF32 = v.accumulatorF32;
      applyNativeCrashReaction(
        reactionAttacker,
        reactionVictim,
        100,
        54,
        () => opponent,
        () => catalog,
      );
    },
  );
  assert.deepEqual(selected.roles, { attacker: "player", victim: "rival" });
  assert.equal(callbackAccumulator, 0.01);
  assert.equal(selected.cleanup, true);
  assert.equal(attacker.accumulatorF32, 0);
  assert.equal(victim.accumulatorF32, 0);
  // F32(0.01) * 300000 produces severity54, so increment is5 and stun is100+1000+30*54.
  assert.equal(catalog.grudge, 99);
  assert.equal(opponent.stunUntilMs, 2720);
  assert.equal(reactionVictim.accForce, 0);
  assert.equal(reactionVictim.brakeForce, 0);
  assert.equal(reactionVictim.curvature, 0);
  assert.equal(reactionVictim.flags.grudgeRecent, true);
  assert.equal(reactionVictim.flags.bigBang, true);
});

test("rejected pair does not invoke reaction callback or change facts, history, grudge, or accumulators", () => {
  const attacker = attributionCar("player", 8, {
    accumulatorF32: Math.fround(0.00005),
  });
  const victim = attributionCar("rival", 6, {
    accumulatorF32: Math.fround(0.00005),
  });
  const reactionAttacker = reactionCar(attacker);
  const reactionVictim = reactionCar(victim);
  const catalog = { strength: 3, grudge: 20 };
  let calls = 0;
  const beforeHistory = structuredClone(victim.history);
  const selected = selectNativeCrashAttribution(
    attacker,
    victim,
    10,
    () => null,
    () => {
      calls++;
      applyNativeCrashReaction(
        reactionAttacker,
        reactionVictim,
        10,
        1,
        () => weakOpponent(catalog),
        () => catalog,
      );
    },
  );
  assert.equal(selected, null);
  assert.equal(calls, 0);
  assert.deepEqual(victim.history, beforeHistory);
  assert.equal(attacker.accumulatorF32, Math.fround(0.00005));
  assert.equal(victim.accumulatorF32, Math.fround(0.00005));
  assert.equal(catalog.grudge, 20);
  assert.equal(reactionVictim.flags.grudgeRecent, false);
  assert.equal(reactionAttacker.lastWeHit, null);
});

test("inherited recent human continuation applies facts while previous history time stays fixed", () => {
  const player = attributionCar("player", 8, {
    accumulatorF32: 0.1,
  });
  const rival = attributionCar("rival", 6, {
    accumulatorF32: 0.01,
    history: history({
      lastAttacker: "player",
      lastMs: 1,
      previousAttacker: "older-player",
      previousMs: 0xfffffff0,
    }),
  });
  const reactionPlayer = reactionCar(player);
  const reactionRival = reactionCar(rival, {
    flags: { grudgeRecent: false, bigBang: false, scaryBang: true },
  });
  const catalog = { strength: 4, grudge: 40 };
  const opponent = weakOpponent(catalog, { stunUntilMs: 0 });
  let callbackHistory;
  const result = selectNativeCrashAttribution(
    rival,
    null,
    5000,
    (identity) => (identity === "player" ? player : null),
    (a, v) => {
      callbackHistory = {
        lastMs: v.history.lastMs,
        previousMs: v.history.previousMs,
      };
      reactionPlayer.damageAccumulatorF32 = a.accumulatorF32;
      reactionRival.damageAccumulatorF32 = v.accumulatorF32;
      applyNativeCrashReaction(
        reactionPlayer,
        reactionRival,
        5000,
        0,
        () => opponent,
        () => catalog,
      );
    },
  );
  assert.deepEqual(result.roles, { attacker: "player", victim: "rival" });
  assert.equal(result.inherited, true);
  assert.deepEqual(callbackHistory, { lastMs: 1, previousMs: 0xfffffff0 });
  assert.equal(rival.history.lastMs, 5000);
  assert.equal(rival.history.previousMs, 0xfffffff0);
  assert.equal(rival.history.previousAttacker, "older-player");
  assert.equal(reactionRival.lastHitter, "player");
  assert.equal(reactionPlayer.lastWeHit, "rival");
  assert.equal(reactionRival.flags.grudgeRecent, true);
  assert.equal(opponent.stunUntilMs, 7620);
  assert.equal(rival.accumulatorF32, 0);
});

test("inherited continuation expires at exact 5000ms and cannot produce reaction side effects", () => {
  const player = attributionCar("player", 8);
  const rival = attributionCar("rival", 6, {
    accumulatorF32: 0.01,
    history: history({
      lastAttacker: "player",
      lastMs: 1,
      previousAttacker: "another-player",
      previousMs: 4999,
    }),
  });
  const target = reactionCar(rival);
  let callbackCount = 0;
  const result = selectNativeCrashAttribution(
    rival,
    null,
    5001,
    () => player,
    () => {
      callbackCount++;
      applyNativeCrashReaction(
        reactionCar(player),
        target,
        5001,
        0,
        () => weakOpponent({ strength: 1, grudge: 0 }),
        () => ({ strength: 1, grudge: 0 }),
      );
    },
  );
  assert.equal(result, null);
  assert.equal(callbackCount, 0);
  assert.equal(target.flags.grudgeRecent, false);
  assert.equal(target.lastHitter, null);
  assert.equal(rival.history.lastMs, 1);
  assert.equal(rival.accumulatorF32, 0.01);
});
