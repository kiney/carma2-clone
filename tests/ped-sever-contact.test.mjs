import test from "node:test";
import assert from "node:assert/strict";
import { NativeRandom } from "../src/native-random.ts";
import { createPedSeverDamageTail } from "../src/physics/ped-sever-contact.ts";

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const form = {
  personalityMass: 0.068,
  simpleBodyMass: 0.068,
  boneCount: 3,
  nonHumanoid: false,
};
const bones = [
  {
    name: "root",
    parent: -1,
    mass: 0.001,
    massKg: 1,
    collisionType: "BOX",
    jointType: "NONE",
    jointRecords: [],
  },
  {
    name: "head",
    parent: 0,
    mass: 0.002,
    massKg: 2,
    collisionType: "SPHERE",
    jointType: "FALSE",
    jointRecords: [],
  },
  {
    name: "limb",
    parent: 0,
    mass: 0.003,
    massKg: 3,
    collisionType: "BOX",
    jointType: "FALSE",
    jointRecords: [],
  },
];
const state = (overrides = {}) => ({
  removedBoneMask: 0,
  vanishedBoneMask: 0,
  bonedSlot: -1,
  hitPoints: 100,
  physicsActive: true,
  characterVelocity: [1, 2, 3],
  cache: { stumpCounters: new Uint8Array(3), flags: 0 },
  ...overrides,
});
const request = (overrides = {}) => ({
  damage: 20,
  form,
  state: {
    hitPoints: 100,
    flags: 0,
    immortal: false,
    exploding: false,
    brittle: false,
    goreLevel: 2,
    removedBoneMask: 0,
    headMissing: false,
  },
  aliveMove: 90,
  deadMove: 91,
  ...overrides,
});
const severInput = (overrides = {}) => ({
  normalizedDamage: 0,
  otherPresent: true,
  goreLevel: 2,
  immortal: false,
  brittle: false,
  exploding: false,
  articulated: false,
  form: { bones, headBone: 1, nonHumanoid: false, maxBoned: 8 },
  severDamage: 40,
  severChance: 10,
  dismemberSpurtCount: 6,
  ...overrides,
});
function host(s, options = {}) {
  const events = [];
  let draws = 0;
  const values = options.values ?? [];
  const provider = {
    nextCrtInteger: () => {
      assert.ok(draws < values.length, "unexpected sever random draw");
      events.push(["draw", values[draws]]);
      return values[draws++];
    },
    reserveBonedSlot: () => {
      events.push(["reserve"]);
      return 2;
    },
    readBone: (index) => ({
      actor: `actor${index}`,
      model: `model${index}`,
      nativePose: identity,
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
    }),
    registerBone: (q) => {
      events.push(["register", q.index]);
      return options.registerFailure
        ? null
        : {
            body: `body${q.index}`,
            rigidType: 5,
            filterA: 0x40000,
            filterB: 0x50000,
          };
    },
    commitBone: (q, receipt) => events.push(["commit", q.index, receipt.body]),
  };
  if (options.missingProvider) delete provider[options.missingProvider];
  const adapter = createPedSeverDamageTail({
    state: s,
    input: severInput(options.input),
    providers: {
      sever: provider,
      onReaction: (health) =>
        events.push(["reaction", health.hitPoints, health.reactionMoveId]),
      onNoise: (health) => events.push(["noise", health.hitPoints]),
      onKill: options.onKill
        ? (health, context) => options.onKill(health, context, events)
        : undefined,
      applyKillModelEffect: options.missingModelProvider
        ? undefined
        : (effect) => events.push(["model", effect.kind]),
      callerContinuation: (health) => events.push(["caller", health.hitPoints]),
    },
  });
  return { adapter, events, draws: () => draws };
}
const choose = (index, count = 3) =>
  Math.ceil(((index - 1) * 32768) / (count - 1));

test("head sever updates the post-sever mask before one HP tail and real Kill model phase", () => {
  const s = state();
  const h = host(s, {
    values: [0, choose(1), 0, 0, 0],
    onKill: (_health, context, events) => {
      events.push(["kill"]);
      context.emitKillModelEffects();
    },
  });
  const result = h.adapter.damageTail(request({ damage: 40 }));
  assert.equal(result.health.hitPoints, 0);
  assert.equal(result.health.killed, true);
  assert.equal(result.receipt.tailInvoked, true);
  assert.equal(result.receipt.callerInvoked, true);
  assert.equal(s.removedBoneMask, 2);
  assert.equal(s.hitPoints, 0);
  assert.deepEqual(
    h.events
      .filter((event) =>
        ["reaction", "noise", "kill", "model", "caller"].includes(event[0]),
      )
      .map((event) => event[0]),
    ["reaction", "noise", "kill", "model", "model", "model", "caller"],
  );
  assert.deepEqual(
    h.events.filter((event) => event[0] === "model").map((event) => event[1]),
    ["dead-model-all", "dead-model-head", "clear-head-sequence"],
  );
  assert.equal(h.events.filter((event) => event[0] === "reaction").length, 1);
});

test("surviving limb uses post-sever mask but retains ordinary alive reaction and no Kill phase", () => {
  const s = state();
  const h = host(s, { values: [0, choose(2), 0, 0, 0] });
  const result = h.adapter.damageTail(request({ damage: 40 }));
  assert.equal(result.health.hitPoints, 60);
  assert.equal(result.health.reactionMoveId, 90);
  assert.equal(result.health.killed, false);
  assert.equal(s.removedBoneMask, 4);
  assert.equal(s.hitPoints, 60);
  assert.deepEqual(
    h.events
      .filter((event) => ["reaction", "noise", "caller"].includes(event[0]))
      .map((event) => event[0]),
    ["reaction", "noise", "caller"],
  );
});

test("nonhumanoid limb sever runs the source fatal HP tail with effective damage0", () => {
  const s = state();
  const h = host(s, {
    values: [0, choose(2), 0, 0, 0],
    input: { form: { ...severInput().form, nonHumanoid: true } },
    onKill: (_health, context, events) =>
      events.push(["kill", context.removedBoneMask]),
  });
  const result = h.adapter.damageTail(
    request({ damage: 40, form: { ...form, nonHumanoid: true } }),
  );
  assert.equal(result.receipt.status, "complete");
  assert.equal(result.health.hitPoints, 0);
  assert.equal(result.health.damage, 40);
  assert.equal(result.health.effectiveDamage, 0);
  assert.equal(result.health.killed, true);
  assert.equal(s.removedBoneMask, 4);
  assert.equal(h.draws(), 5);
  assert.deepEqual(
    h.events.filter((e) => e[0] === "kill"),
    [["kill", 4]],
  );
});

test("actual contact exploding flag overrides stale input and bypasses zero sever chance", () => {
  const s = state();
  const h = host(s, {
    values: [choose(2), ...Array(6).fill(16384)],
    input: { severChance: 0 },
  });
  const result = h.adapter.damageTail(
    request({ damage: 40, state: { ...request().state, exploding: true } }),
  );
  assert.equal(result.receipt.status, "complete");
  assert.equal(result.health.hitPoints, 60);
  assert.equal(s.removedBoneMask, 4);
  assert.equal(h.draws(), 7);
});

test("no selected bone and failed registration still run the HP tail once", () => {
  const belowThresholdState = state();
  const belowThreshold = host(belowThresholdState, { values: [] });
  const noBone = belowThreshold.adapter.damageTail(request({ damage: 20 }));
  assert.equal(noBone.health.hitPoints, 80);
  assert.equal(noBone.receipt.severResult.attempts.length, 0);
  assert.equal(noBone.receipt.severResult.randomDraws, 0);
  assert.equal(noBone.receipt.tailInvoked, true);

  const noSelectionState = state();
  const noSelection = host(noSelectionState, { values: [32767] });
  const chance = noSelection.adapter.damageTail(request({ damage: 41 }));
  assert.equal(chance.health.hitPoints, 59);
  assert.equal(chance.receipt.severResult.newlyDetached, 0);
  assert.equal(chance.receipt.tailInvoked, true);
  assert.equal(
    noSelection.events.filter((event) => event[0] === "reaction").length,
    1,
  );

  const rejectedState = state();
  const rejected = host(rejectedState, {
    values: [0, choose(2), 0, 0, 0],
    registerFailure: true,
  });
  const registration = rejected.adapter.damageTail(request({ damage: 41 }));
  assert.equal(registration.health.hitPoints, 59);
  assert.equal(rejectedState.removedBoneMask, 0);
  assert.equal(registration.receipt.severResult.newlyDetached, 0);
  assert.equal(registration.receipt.tailInvoked, true);
  assert.equal(
    rejected.events.filter((event) => event[0] === "caller").length,
    1,
  );
});

test("true missing core provider returns unresolved with null HP and no fake draw/allocation", () => {
  const s = state();
  const h = host(s, { values: [], missingProvider: "registerBone" });
  const result = h.adapter.damageTail(request({ damage: 50 }));
  assert.equal(result.health, null);
  assert.equal(result.receipt.tailInvoked, false);
  assert.equal(result.receipt.callerInvoked, false);
  assert.ok(
    result.unresolved.includes("source-bone-PHIL-registration-provider"),
  );
  assert.equal(h.draws(), 0);
  assert.equal(s.removedBoneMask, 0);
  assert.equal(s.hitPoints, 100);
  assert.equal(h.events.length, 0);
});

test("signed-byte corpse damage does not rescore or run a new Kill provider", () => {
  const s = state({ hitPoints: -120 });
  let kills = 0;
  const h = host(s, { values: [32767], onKill: () => kills++ });
  const result = h.adapter.damageTail(
    request({
      damage: 50,
      state: { ...request().state, hitPoints: -120 },
    }),
  );
  assert.equal(result.health.hitPoints, -120);
  assert.equal(result.health.wasAlive, false);
  assert.equal(result.health.killed, false);
  assert.equal(result.health.reactionMoveId, -1);
  assert.equal(kills, 0);
  assert.equal(s.hitPoints, -120);
});

test("shared CRT tail is exactly after the sever draws and before caller continuation", () => {
  const s = state();
  const rng = new NativeRandom(1);
  const events = [];
  const adapter = createPedSeverDamageTail({
    state: s,
    input: severInput(),
    providers: {
      sever: {
        nextCrtInteger: () => rng.nextInteger(),
        reserveBonedSlot: () => 2,
        readBone: (index) => ({
          actor: index,
          model: index,
          nativePose: identity,
          bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
        }),
        registerBone: (q) => ({
          body: q.index,
          rigidType: 5,
          filterA: 0x40000,
          filterB: 0x50000,
        }),
        commitBone: () => {},
      },
      onReaction: () => events.push(["reaction"]),
      onNoise: () => events.push(["noise", rng.nextInteger()]),
      callerContinuation: () => events.push(["caller"]),
    },
  });
  const result = adapter.damageTail(request({ damage: 40 }));
  assert.equal(result.receipt.severResult.randomDraws, 5);
  assert.deepEqual(events, [["reaction"], ["noise", 15724], ["caller"]]);
  assert.equal(result.health.hitPoints, 60);
});

test("partial post-HP missing model provider leaves an explicit receipt and never replays HP/tail", () => {
  const s = state();
  const h = host(s, {
    values: [0, choose(1), 0, 0, 0],
    missingModelProvider: true,
    onKill: (_health, context) => context.emitKillModelEffects(),
  });
  const result = h.adapter.damageTail(request({ damage: 40 }));
  assert.equal(result.health.hitPoints, 0);
  assert.equal(result.receipt.status, "provider-required");
  assert.equal(result.receipt.tailInvoked, true);
  assert.equal(result.receipt.callerInvoked, false);
  assert.ok(
    result.unresolved.includes("source-dead-model-head-sequence-provider"),
  );
  assert.equal(s.hitPoints, 0);
  assert.equal(h.events.filter((event) => event[0] === "reaction").length, 1);
  assert.equal(h.events.filter((event) => event[0] === "caller").length, 0);
  const retry = h.adapter.damageTail(request({ damage: 40 }));
  assert.equal(retry.health, null);
  assert.ok(retry.unresolved.includes("native-damage-tail-already-received"));
  assert.equal(h.events.filter((event) => event[0] === "reaction").length, 1);
  assert.equal(h.events.filter((event) => event[0] === "caller").length, 0);
});

test("passive 90/91 and active -1/94 move identifiers pass through unchanged", () => {
  const passiveState = state();
  const passive = host(passiveState, { values: [] });
  const p = passive.adapter.damageTail(
    request({ damage: 5, aliveMove: 90, deadMove: 91 }),
  );
  assert.equal(p.health.reactionMoveId, 90);
  const activeState = state({ hitPoints: 1 });
  const active = host(activeState, { values: [] });
  const a = active.adapter.damageTail(
    request({
      damage: 5,
      aliveMove: -1,
      deadMove: 94,
      state: { ...request().state, hitPoints: 1 },
    }),
  );
  assert.equal(a.health.hitPoints, -4);
  assert.equal(a.health.reactionMoveId, 94);
  assert.equal(active.events[0][0], "reaction");
});

test("receipt blocks retry after completed tail and caller", () => {
  const s = state();
  const h = host(s, { values: [] });
  const first = h.adapter.damageTail(request({ damage: 10 }));
  const second = h.adapter.damageTail(request({ damage: 10 }));
  assert.equal(first.health.hitPoints, 90);
  assert.equal(second.health, null);
  assert.ok(second.unresolved.includes("native-damage-tail-already-received"));
  assert.equal(s.hitPoints, 90);
  assert.equal(h.events.filter((event) => event[0] === "reaction").length, 1);
  assert.equal(h.events.filter((event) => event[0] === "caller").length, 1);
});
