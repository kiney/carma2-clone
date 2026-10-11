import test from "node:test";
import assert from "node:assert/strict";
import {
  applyNativeCrashReaction,
  nativeCrashBigBangThreshold,
} from "../src/ai/crash-reactions.ts";

function car(identity, driver, damage = 0) {
  return {
    identity,
    driver,
    damageAccumulatorF32: Math.fround(damage),
    flags: { grudgeRecent: false, bigBang: false, scaryBang: false },
    lastHitter: null,
    lastWeHit: null,
    contactTimeMs: 0,
    accForce: 12,
    brakeForce: 13,
    curvature: 0.75,
  };
}

const damageFor = (severity) => {
  const data = new DataView(new ArrayBuffer(4));
  data.setFloat32(0, (severity * severity) / 300000);
  data.setUint32(0, data.getUint32(0) + 1);
  return data.getFloat32(0);
};

function state(catalogIndex, overrides = {}) {
  return {
    catalogIndex,
    objective: "complete-race",
    target: null,
    stunUntilMs: 0,
    notifyAttributedTargetHit() {},
    ...overrides,
  };
}

function setup(entries, states) {
  const resolveCalls = [];
  const resolveOpponent = (car) => {
    resolveCalls.push(car.identity);
    return states.get(car.identity) ?? null;
  };
  const catalogCalls = [];
  const catalog = (index) => {
    catalogCalls.push(index);
    return entries[index] ?? null;
  };
  return { resolveOpponent, catalog, resolveCalls, catalogCalls };
}

test("severity 4 exits before facts, while severity 5 proceeds and threshold comparison is inclusive", () => {
  const a = car("human", 8, damageFor(20));
  const v = car("victim", 6, damageFor(4.999));
  const env = setup(
    [{ strength: 2, grudge: 7 }],
    new Map([["victim", state(0)]]),
  );
  let result = applyNativeCrashReaction(
    a,
    v,
    200,
    5,
    env.resolveOpponent,
    env.catalog,
  );
  assert.equal(result.severity, 4);
  assert.equal(result.outcome, "minor");
  assert.equal(a.lastWeHit, null);
  assert.equal(v.flags.grudgeRecent, false);
  assert.deepEqual(env.resolveCalls, []);

  v.damageAccumulatorF32 = damageFor(5.001);
  result = applyNativeCrashReaction(
    a,
    v,
    201,
    5,
    env.resolveOpponent,
    env.catalog,
  );
  assert.equal(result.severity, 5);
  assert.equal(v.flags.bigBang, true);
  assert.equal(v.flags.scaryBang, false);
  assert.equal(v.flags.grudgeRecent, true);
});

test("severity 79/80 sets sticky scary flag at 80 and severity 80 sets bang facts", () => {
  const attacker = car("human", 8);
  const victim = car("ai", 6, damageFor(79));
  const entry = { strength: 8, grudge: 0 };
  const env = setup([entry], new Map([["ai", state(0)]]));
  let result = applyNativeCrashReaction(
    attacker,
    victim,
    10,
    79,
    env.resolveOpponent,
    env.catalog,
  );
  assert.equal(result.severity, 79);
  assert.equal(victim.flags.bigBang, true);
  assert.equal(victim.flags.scaryBang, false);

  victim.damageAccumulatorF32 = damageFor(80);
  result = applyNativeCrashReaction(
    attacker,
    victim,
    11,
    80,
    env.resolveOpponent,
    env.catalog,
  );
  assert.equal(result.severity, 80);
  assert.equal(victim.flags.bigBang, true);
  assert.equal(victim.flags.scaryBang, true);
  assert.equal(victim.flags.grudgeRecent, true);
});

test("human attacker applies weak scary stun, clears forces in order, increments shared grudge", () => {
  const attacker = car("player", 8);
  const victim = car("rival", 6, damageFor(50));
  victim.flags.scaryBang = true;
  const shared = { strength: 4.5, grudge: 99 };
  const opponent = state(0, { stunUntilMs: 1200 });
  const env = setup([shared], new Map([["rival", opponent]]));
  const writes = [];
  for (const key of ["accForce", "brakeForce", "curvature"]) {
    let value = victim[key];
    Object.defineProperty(victim, key, {
      get: () => value,
      set: (next) => {
        writes.push(key);
        value = next;
      },
      configurable: true,
    });
  }
  const result = applyNativeCrashReaction(
    attacker,
    victim,
    500,
    100,
    env.resolveOpponent,
    env.catalog,
  );
  assert.equal(result.outcome, "human-hit-ai");
  assert.equal(result.severity, 50);
  assert.equal(shared.grudge, 100);
  assert.equal(opponent.stunUntilMs, 3000);
  assert.deepEqual(writes, ["accForce", "brakeForce", "curvature"]);
  assert.deepEqual(env.resolveCalls, ["rival"]);
  assert.deepEqual(env.catalogCalls, [0]);
  assert.equal(attacker.lastWeHit, "rival");
  assert.equal(attacker.contactTimeMs, 500);
  assert.equal(victim.contactTimeMs, 500);
  assert.equal(victim.lastHitter, "player");
});

test("weak scary sticky state can stun again and wrapped deadlines use unsigned max", () => {
  const attacker = car("player", 8);
  const victim = car("rival", 6, damageFor(5));
  victim.flags.scaryBang = true;
  const opponent = state(0, { stunUntilMs: 0xfffffff0 });
  const env = setup(
    [{ strength: 1, grudge: 0 }],
    new Map([["rival", opponent]]),
  );
  applyNativeCrashReaction(
    attacker,
    victim,
    0xfffffff0,
    -1,
    env.resolveOpponent,
    env.catalog,
  );
  assert.equal(victim.accForce, 0);
  assert.equal(victim.brakeForce, 0);
  assert.equal(victim.curvature, 0);
  assert.equal(
    opponent.stunUntilMs,
    0xfffffff0,
    "wrapped short deadline does not beat the old unsigned max",
  );
  opponent.stunUntilMs = 0;
  applyNativeCrashReaction(
    attacker,
    victim,
    100,
    -1,
    env.resolveOpponent,
    env.catalog,
  );
  assert.equal(opponent.stunUntilMs, 1250);
});

test("human victim notifies only matching pursuit target and suppresses pursuit grudge decrease", () => {
  const attacker = car("rival", 6);
  const human = car("player", 8, damageFor(50));
  const entry = { strength: 10, grudge: 20 };
  const notifications = [];
  const opponent = state(0, {
    objective: "pursue",
    target: "player",
    notifyAttributedTargetHit: (now) => notifications.push(now),
  });
  const env = setup([entry], new Map([["rival", opponent]]));
  let result = applyNativeCrashReaction(
    attacker,
    human,
    10,
    100,
    env.resolveOpponent,
    env.catalog,
  );
  assert.equal(result.outcome, "ai-hit-human");
  assert.deepEqual(notifications, [10]);
  assert.equal(entry.grudge, 20);

  opponent.target = "other-player";
  entry.grudge = 20;
  result = applyNativeCrashReaction(
    attacker,
    human,
    11,
    100,
    env.resolveOpponent,
    env.catalog,
  );
  assert.equal(result.outcome, "ai-hit-human");
  assert.deepEqual(notifications, [10]);
  assert.equal(
    entry.grudge,
    20,
    "pursuit suppresses decrease even for a different target",
  );
});

test("nonpursuit human victim branch reduces grudge with signed clamp and low-byte store", () => {
  const attacker = car("rival", 6);
  const human = car("player", 8, damageFor(50));
  const entry = { strength: 10, grudge: 7 };
  const env = setup(
    [entry],
    new Map([["rival", state(0, { objective: "freewheel" })]]),
  );
  const result = applyNativeCrashReaction(
    attacker,
    human,
    100,
    100,
    env.resolveOpponent,
    env.catalog,
  );
  assert.equal(result.increment, 5);
  assert.equal(entry.grudge, 0);
});

test("AI6 versus AI6 resolves attacker then victim, can notify matching pursuit, and leaves grudges unchanged", () => {
  const attacker = car("a", 6, damageFor(50));
  const victim = car("b", 6, damageFor(50));
  const attackerCatalog = { strength: 10, grudge: 44 };
  const victimCatalog = { strength: 3, grudge: 81 };
  const notifications = [];
  const attackState = state(0, {
    objective: "pursue",
    target: "b",
    notifyAttributedTargetHit: (now) => notifications.push(now),
  });
  const victimState = state(1);
  const env = setup(
    [attackerCatalog, victimCatalog],
    new Map([
      ["a", attackState],
      ["b", victimState],
    ]),
  );
  const result = applyNativeCrashReaction(
    attacker,
    victim,
    500,
    100,
    env.resolveOpponent,
    env.catalog,
  );
  assert.equal(result.outcome, "ai-hit-ai");
  assert.deepEqual(env.resolveCalls, ["a", "b"]);
  assert.deepEqual(env.catalogCalls, [0, 1]);
  assert.deepEqual(notifications, [500]);
  assert.equal(attackerCatalog.grudge, 44);
  assert.equal(victimCatalog.grudge, 81);
});

test("catalog callback returns shared duplicate identity so grudge update reaches common entry", () => {
  const attacker = car("player", 8);
  const firstAi = car("rival-a", 6, damageFor(50));
  const secondAi = car("rival-b", 6);
  const sharedEntry = { strength: 10, grudge: 3 };
  const firstState = state(2);
  const secondState = state(2);
  const env = setup(
    [null, null, sharedEntry],
    new Map([
      ["rival-a", firstState],
      ["rival-b", secondState],
    ]),
  );
  applyNativeCrashReaction(
    attacker,
    firstAi,
    1,
    100,
    env.resolveOpponent,
    env.catalog,
  );
  assert.equal(sharedEntry.grudge, 8);
  assert.equal(env.catalog(2), sharedEntry);
  assert.equal(secondState.catalogIndex, firstState.catalogIndex);
  assert.equal(secondAi.identity, "rival-b");
});

test("big-bang threshold rank formula validates catalog bounds and retains F32 multiplier", () => {
  assert.equal(nativeCrashBigBangThreshold(0, 10, 3), 40);
  assert.equal(nativeCrashBigBangThreshold(9, 10, 3), 13);
  assert.equal(nativeCrashBigBangThreshold(9, 10, 3, 1.5), -15);
  assert.throws(() => nativeCrashBigBangThreshold(0, 0, 1));
  assert.throws(() => nativeCrashBigBangThreshold(10, 10, 1));
});

test("unsupported police/network driver is rejected without inventing reaction", () => {
  const cop = { ...car("cop", 6), driver: 7 };
  const ai = car("ai", 6);
  assert.throws(
    () =>
      applyNativeCrashReaction(
        cop,
        ai,
        1,
        10,
        () => null,
        () => null,
      ),
    /Unsupported/,
  );
  assert.equal(cop.lastWeHit, null);
});
