import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseTwt } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import {
  parsePedForm,
  parsePedPersonalitySimpleBody,
  parsePedRemap,
} from "../src/ped-form.ts";
import {
  mutateNativePedSever,
  nativePedSeverBodyPolicy,
} from "../src/physics/ped-sever.ts";
import { resolvePedContactDamage } from "../src/physics/ped-contact.ts";
import { NativeRandom } from "../src/native-random.ts";

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 3, 5, 7];
const parents = [-1, 0, 0, 2, 0, 4, 0, 6, 0, 8];
function input(overrides = {}) {
  return {
    normalizedDamage: 40,
    otherPresent: true,
    goreLevel: 2,
    immortal: false,
    brittle: false,
    exploding: false,
    articulated: false,
    form: {
      bones: parents.map((parent, i) => ({
        name: `bone${i}`,
        parent,
        massKg: i + 1,
        mass: Math.fround((i + 1) / 1000),
        collisionType: i === 1 ? "SPHERE" : "BOX",
        jointType: i === 0 ? "NONE" : "FALSE",
        jointRecords: [],
      })),
      headBone: 1,
      nonHumanoid: false,
      maxBoned: 10,
    },
    severDamage: 40,
    severChance: 10,
    dismemberSpurtCount: 100,
    ...overrides,
  };
}
function state(overrides = {}) {
  return {
    removedBoneMask: 0,
    vanishedBoneMask: 0,
    bonedSlot: -1,
    hitPoints: 100,
    physicsActive: true,
    characterVelocity: [2.25, -3.5, 4.75],
    cache: { stumpCounters: new Uint8Array(32), flags: 0 },
    ...overrides,
  };
}
const select = (index, count = 10) =>
  Math.ceil(((index - 1) * 32768) / (count - 1));
function host(s, values, overrides = {}) {
  let draw = 0;
  const log = [],
    models = [];
  return {
    log,
    models,
    nextCrtInteger: () => {
      assert.ok(draw < values.length, "unexpected shared CRT draw");
      log.push(["draw", values[draw]]);
      return values[draw++];
    },
    reserveBonedSlot: () => {
      log.push(["reserve"]);
      return 2;
    },
    readBone: (index) => ({
      actor: { index },
      model: `model${index}`,
      nativePose: identity,
      bounds: { min: [-0.1, -0.2, -0.3], max: [0.1, 0.2, 0.3] },
    }),
    registerBone: (request) => {
      log.push(["register", request]);
      assert.equal(s.removedBoneMask & (1 << request.index), 0);
      return { body: { index: request.index }, ...nativePedSeverBodyPolicy };
    },
    commitBone: (request, receipt, oldSlot) => {
      assert.ok(s.removedBoneMask & (1 << request.index));
      log.push(["commit", request.index, oldSlot, receipt.body]);
    },
    commonTail: (context) => {
      log.push(["tail", { ...context }]);
      const result = resolvePedContactDamage(
        context.normalizedDamage,
        { nonHumanoid: false },
        { hitPoints: s.hitPoints, immortal: false, ...context },
        90,
        91,
      );
      s.hitPoints = result.hitPoints;
      if (result.killed) {
        context.emitKillModelEffects();
        context.emitKillModelEffects(); // Once-only within the actual Kill phase.
      }
      return result;
    },
    applyKillModelEffect: (effect) => {
      assert.equal(s.hitPoints, 0, "Kill model phase follows HP mutation");
      models.push(effect);
    },
    callerContinuation: (tail, context) =>
      log.push(["caller", tail.hitPoints, context.normalizedDamage]),
    ...overrides,
  };
}

test("ordinary subtree is ascending depth-first, source policy and actor data reach a real host", () => {
  const s = state(),
    h = host(s, [0, select(2), 0, 16384, 32767, 32767, 0, 16384]);
  const r = mutateNativePedSever(s, input(), h);
  assert.equal(r.status, "complete");
  assert.equal(r.randomDraws, 8);
  assert.equal(r.newlyDetached, 2);
  assert.equal(r.removedBoneMask, 12);
  assert.equal(r.normalizedDamage, 40);
  assert.equal(r.remainingBudget, -40);
  assert.equal(s.hitPoints, 60);
  assert.equal(s.bonedSlot, 2);
  assert.deepEqual(
    h.log.filter((e) => e[0] === "commit").map((e) => e.slice(1, 3)),
    [
      [3, -1],
      [2, 2],
    ],
  );
  const requests = h.log.filter((e) => e[0] === "register").map((e) => e[1]);
  assert.deepEqual(
    requests.map((q) => q.index),
    [3, 2],
  );
  assert.deepEqual(requests[0].localOmega, [-1, 0, 0.99993896484375]);
  for (const q of requests) {
    assert.equal(q.rigidType, 5);
    assert.equal(q.filterA, 0x40000);
    assert.equal(q.filterB, 0x50000);
    assert.equal(q.model, undefined);
    assert.equal(q.snapshot.model, `model${q.index}`);
    assert.deepEqual([...q.snapshot.nativePose], identity);
    assert.equal(q.bone.mass, Math.fround((q.index + 1) / 1000));
    assert.deepEqual(q.activation, {
      velocity: [2.25, -3.5, 4.75],
      gravity: 1,
      clearProperties: [3, 4, 5],
      clearDoNothing: true,
      enableHalt: true,
    });
    assert.equal(q.clearParentJoint, true);
    assert.equal(q.clearChildren, true);
    assert.equal(q.clearLink188, true);
  }
  assert.equal(s.cache.stumpCounters[3], 100);
  assert.equal(s.cache.stumpCounters[2], 100);
  assert.equal(h.log.filter((e) => e[0] === "tail").length, 1);
  assert.equal(h.log.filter((e) => e[0] === "caller").length, 1);
  assert.deepEqual(h.log.at(-1), ["caller", 60, 40]);
});
test("threshold equality and chance10 boundary spend budget without changing HP damage", () => {
  for (const [damage, values, attemptCount] of [
    [39, [], 0],
    [40, [3277], 1],
    [79, [3277], 1],
    [80, [3277, 32767], 2],
    [99, [3277, 32767], 2],
  ]) {
    const s = state(),
      h = host(s, values);
    const r = mutateNativePedSever(s, input({ normalizedDamage: damage }), h);
    assert.equal(r.attempts.length, attemptCount);
    assert.equal(r.randomDraws, attemptCount);
    assert.equal(r.newlyDetached, 0);
    assert.equal(r.normalizedDamage, damage);
    assert.equal(s.hitPoints, 100 - damage);
    assert.equal(r.tailInvoked, true);
    assert.equal(r.callerInvoked, true);
  }
  const s = state(),
    r = mutateNativePedSever(s, input(), host(s, [3276, select(9), 0, 0, 0]));
  assert.equal(r.newlyDetached, 1);
  assert.equal(r.removedBoneMask, 512);
});
test("three upper subtrees overshoot successful cap to6; next threshold is spent before cap test", () => {
  const s = state(),
    values = [];
  for (const i of [2, 4, 6]) values.push(0, select(i), ...Array(6).fill(16384));
  const r = mutateNativePedSever(
    s,
    input({ normalizedDamage: 400 }),
    host(s, values),
  );
  assert.equal(r.newlyDetached, 6);
  assert.equal(r.attempts.length, 3);
  assert.equal(r.randomDraws, 24);
  assert.equal(r.remainingBudget, 240);
  assert.equal(r.removedBoneMask, 252);
  assert.equal(s.cache.flags & 2, 2);
  assert.deepEqual(
    r.effects.filter((e) => e.kind === "detach").map((e) => e.index),
    [3, 2, 5, 4, 7, 6],
  );
  assert.deepEqual(r.effects.filter((e) => e.kind === "budget").at(-1), {
    kind: "budget",
    remaining: 240,
    successfulCount: 6,
  });
});
test("a repeated removed bone consumes chance/selection but no reserve or spin; resets stump counter", () => {
  const s = state({ removedBoneMask: 512, bonedSlot: 2 }),
    h = host(s, [0, select(9)]);
  const r = mutateNativePedSever(s, input(), h);
  assert.equal(r.newlyDetached, 0);
  assert.equal(r.randomDraws, 2);
  assert.equal(s.cache.stumpCounters[9], 100);
  assert.equal(
    h.log.some((e) => ["reserve", "register", "commit"].includes(e[0])),
    false,
  );
  assert.equal(r.status, "complete");
  assert.equal(s.hitPoints, 60);
});
test("a removed selected parent still visits an eligible child left by an earlier failure", () => {
  const s = state({ removedBoneMask: 4, bonedSlot: 2 });
  const r = mutateNativePedSever(s, input(), host(s, [0, select(2), 0, 0, 0]));
  assert.equal(r.newlyDetached, 1);
  assert.equal(r.removedBoneMask, 12);
  assert.deepEqual(
    r.effects.filter((e) => e.kind === "detach").map((e) => e.index),
    [3],
  );
  assert.equal(s.cache.stumpCounters[2], 100);
});
test("native pool exhaustion spends threshold and resumes HP without spin draws", () => {
  const s = state(),
    h = host(s, [0, select(2)], { reserveBonedSlot: () => null });
  const r = mutateNativePedSever(s, input(), h);
  assert.equal(r.status, "complete");
  assert.equal(r.randomDraws, 2);
  assert.equal(r.newlyDetached, 0);
  assert.equal(s.bonedSlot, -1);
  assert.equal(s.hitPoints, 60);
  assert.equal(s.cache.stumpCounters[2], 100);
  assert.equal(s.cache.stumpCounters[3], 100);
  assert.equal(r.effects.filter((e) => e.kind === "reserve-slot").length, 2);
  assert.equal(r.tailInvoked, true);
  assert.equal(r.callerInvoked, true);
});
test("native registration failure consumes spin and preserves reservation without changing missing mask", () => {
  const s = state(),
    h = host(s, [0, select(9), 0, 16384, 32767], { registerBone: () => null });
  const r = mutateNativePedSever(s, input(), h);
  assert.equal(r.status, "complete");
  assert.equal(r.randomDraws, 5);
  assert.equal(s.bonedSlot, 2);
  assert.equal(s.removedBoneMask, 0);
  assert.equal(r.newlyDetached, 0);
  assert.equal(s.hitPoints, 60);
  assert.equal(
    h.log.some((e) => e[0] === "commit"),
    false,
  );
  assert.equal(r.tailInvoked, true);
});
test("registration failure for a child does not suppress successful parent, preserving source partial order", () => {
  const s = state();
  const h = host(s, [0, select(2), ...Array(6).fill(16384)]);
  const register = h.registerBone;
  h.registerBone = (request) =>
    request.index === 3 ? null : register(request);
  const r = mutateNativePedSever(s, input(), h);
  assert.equal(r.newlyDetached, 1);
  assert.equal(r.removedBoneMask, 4);
  assert.equal(r.randomDraws, 8);
  assert.equal(h.log.filter((e) => e[0] === "reserve").length, 1);
  assert.equal(s.hitPoints, 60);
});
test("head loss kills via supplied common tail with ordered dead model callbacks once; corpse does not kill twice", () => {
  const s = state(),
    h = host(s, [0, 0, 0, 0, 0]);
  const r = mutateNativePedSever(s, input(), h);
  assert.equal(r.removedBoneMask, 2);
  assert.equal(s.hitPoints, 0);
  assert.equal(r.tailResult.killed, true);
  assert.deepEqual(h.models, [
    { kind: "dead-model-all", pose: 0, modelSet: 1 },
    { kind: "dead-model-head", index: 1, pose: 2, modelSet: 1 },
    { kind: "clear-head-sequence" },
  ]);
  assert.ok(
    r.effects.findIndex((e) => e.kind === "head-kill-required") <
      r.effects.findIndex((e) => e.kind === "common-tail"),
  );
  assert.deepEqual(
    r.effects.slice(-4).map((e) => e.kind),
    [
      "dead-model-all",
      "dead-model-head",
      "clear-head-sequence",
      "caller-continuation",
    ],
  );
  const corpse = state({ hitPoints: 0 }),
    ch = host(corpse, [0, 0, 0, 0, 0]);
  const cr = mutateNativePedSever(corpse, input(), ch);
  assert.equal(cr.newlyDetached, 1);
  assert.equal(cr.tailResult.killed, false);
  assert.equal(ch.models.length, 0);
  assert.equal(
    cr.effects.some((e) => e.kind === "head-kill-required"),
    false,
  );
});
test("head removal does not terminate subsequent random selections or reduce normalized HP damage", () => {
  const s = state();
  const r = mutateNativePedSever(
    s,
    input({ normalizedDamage: 80 }),
    host(s, [0, 0, 0, 0, 0, 0, select(9), 0, 0, 0]),
  );
  assert.equal(r.newlyDetached, 2);
  assert.equal(r.removedBoneMask, 514);
  assert.equal(r.normalizedDamage, 80);
  assert.equal(r.tailResult.damage, 80);
  assert.deepEqual(
    r.attempts.map((a) => a.selectedIndex),
    [1, 9],
  );
});
test("inactive character still registers and removes part but does not copy V/activate it", () => {
  const s = state({ physicsActive: false }),
    h = host(s, [0, select(9), 0, 0, 0]);
  const r = mutateNativePedSever(s, input(), h);
  assert.equal(r.newlyDetached, 1);
  assert.equal(h.log.find((e) => e[0] === "register")[1].activation, null);
});
test("world, immortal and gore gates resume common tail without any sever host/RNG", () => {
  for (const overrides of [
    { otherPresent: false },
    { immortal: true },
    { goreLevel: 1 },
  ]) {
    const s = state(),
      h = host(s, []);
    const r = mutateNativePedSever(s, input(overrides), {
      commonTail: h.commonTail,
      callerContinuation: h.callerContinuation,
    });
    assert.equal(r.status, "complete");
    assert.equal(r.randomDraws, 0);
    assert.equal(r.attempts.length, 0);
    assert.equal(s.hitPoints, 60);
    assert.equal(r.callerInvoked, true);
  }
});
test("chance0 draws nothing and needs no limb/RNG providers; still spends every threshold", () => {
  const s = state(),
    h = host(s, []);
  const r = mutateNativePedSever(
    s,
    input({ normalizedDamage: 80, severChance: 0 }),
    { commonTail: h.commonTail, callerContinuation: h.callerContinuation },
  );
  assert.equal(r.status, "complete");
  assert.equal(r.randomDraws, 0);
  assert.equal(r.attempts.length, 2);
  assert.equal(r.remainingBudget, -40);
  assert.equal(s.hitPoints, 20);
});
test("brittle uses fixed threshold5 and bypasses percentage draw, retaining ordinary spin", () => {
  const s = state();
  const r = mutateNativePedSever(
    s,
    input({ normalizedDamage: 5, brittle: true }),
    host(s, [select(9), 0, 16384, 32767]),
  );
  assert.equal(r.status, "complete");
  assert.equal(r.randomDraws, 4);
  assert.equal(r.newlyDetached, 1);
  assert.equal(r.remainingBudget, -5);
  assert.equal(s.hitPoints, 95);
});
test("Float32 budget rounds independently of the retained normalized integer D", () => {
  const s = state(),
    h = host(s, [32767]);
  const r = mutateNativePedSever(
    s,
    input({ normalizedDamage: 16777217, severDamage: 16777216 }),
    h,
  );
  assert.equal(r.normalizedDamage, 16777217);
  assert.equal(r.attempts[0].remainingBudget, 0);
  assert.equal(r.remainingBudget, -16777216);
  assert.equal(r.tailResult.damage, 16777217);
  assert.equal(r.randomDraws, 1);
});
test("chance100 still consumes percentage draw; all removed selections need no registration host", () => {
  const s = state({ removedBoneMask: 1022, bonedSlot: 2, hitPoints: 0 });
  const h = host(s, [32767, select(9)]);
  delete h.readBone;
  delete h.reserveBonedSlot;
  delete h.registerBone;
  delete h.commitBone;
  const r = mutateNativePedSever(s, input({ severChance: 100 }), h);
  assert.equal(r.status, "complete");
  assert.equal(r.randomDraws, 2);
  assert.equal(r.newlyDetached, 0);
  assert.equal(r.tailInvoked, true);
});
test("shared native CRT stream includes host tail draws in order, without separate part generators", () => {
  const s = state(),
    rng = new NativeRandom(1),
    h = host(s, []);
  h.nextCrtInteger = () => rng.nextInteger();
  h.commonTail = (context) => ({
    damage: context.normalizedDamage,
    hostDraw: rng.nextInteger(),
  });
  h.callerContinuation = () => {};
  const r = mutateNativePedSever(s, input(), h);
  // seed1: chance41 accepted; selection18467 ->6; child7 spins6334,26500,19169;
  // selected6 spins15724,11478,29358. Tail observes the next shared draw26962.
  assert.equal(r.newlyDetached, 2);
  assert.equal(r.randomDraws, 8);
  assert.equal(r.attempts[0].selectedIndex, 6);
  assert.equal(r.tailResult.hostDraw, 26962);
});
test("missing required provider preflights before draws/mutation and does not masquerade as native exhaustion", () => {
  for (const key of [
    "nextCrtInteger",
    "readBone",
    "reserveBonedSlot",
    "registerBone",
    "commitBone",
    "commonTail",
    "callerContinuation",
  ]) {
    const s = state(),
      h = host(s, []);
    delete h[key];
    const r = mutateNativePedSever(s, input(), h);
    assert.equal(r.status, "provider-required", key);
    assert.ok(r.requiredProviders.length > 0);
    assert.equal(r.randomDraws, 0);
    assert.equal(s.removedBoneMask, 0);
    assert.equal(s.bonedSlot, -1);
    assert.equal(s.hitPoints, 100);
    assert.equal(r.tailInvoked, false);
  }
  const s = state(),
    h = host(s, [], { readBone: () => null });
  assert.equal(mutateNativePedSever(s, input(), h).status, "provider-required");
  assert.equal(h.log.length, 0);
});
test("exploding and articulated/nonhumanoid selection require explicit alternate providers, without generic fallbacks", () => {
  for (const overrides of [
    { exploding: true },
    { articulated: true },
    { form: { ...input().form, nonHumanoid: true } },
  ]) {
    const s = state(),
      h = host(s, []);
    const r = mutateNativePedSever(s, input(overrides), h);
    assert.equal(r.status, "provider-required");
    assert.equal(r.randomDraws, 0);
    assert.equal(r.tailInvoked, false);
    assert.equal(s.hitPoints, 100);
  }
});
test("stump low byte and32-bit highest mask bit are preserved", () => {
  const p = input();
  p.form.bones = Array.from({ length: 32 }, (_, i) => ({
    ...p.form.bones[0],
    name: `part${i}`,
    parent: i ? 0 : -1,
  }));
  p.form.headBone = 1;
  const s = state(),
    r = mutateNativePedSever(
      s,
      { ...p, dismemberSpurtCount: 300 },
      host(s, [0, 32767, 0, 0, 0]),
    );
  assert.equal(r.removedBoneMask, 0x80000000);
  assert.equal(s.cache.stumpCounters[31], 44);
  assert.equal(r.attempts[0].selectedIndex, 31);
});
test("unsafe trees, wide masks, oversized/nonprogressing loops and dishonest registration are rejected", () => {
  for (const p of [
    input({ normalizedDamage: 100, maximumAttempts: 1 }),
    input({ normalizedDamage: 0x7fffffff, severDamage: 1 }),
  ])
    assert.throws(() => mutateNativePedSever(state(), p, {}), /budget/);
  const p = input();
  p.form.bones[2].parent = 3;
  assert.throws(() => mutateNativePedSever(state(), p, {}), /Cyclic/);
  assert.throws(
    () =>
      mutateNativePedSever(state({ removedBoneMask: 0x80000000 }), input(), {}),
    /mask exceeds/,
  );
  const s = state(),
    h = host(s, [0, select(9), 0, 0, 0], {
      registerBone: () => ({
        body: {},
        rigidType: 2,
        filterA: 0x10000,
        filterB: 0x50000,
      }),
    });
  assert.throws(() => mutateNativePedSever(s, input(), h), /type5\/filter/);
  assert.equal(s.removedBoneMask, 0);
});
test("requested missing dead-model provider is explicit and never reruns already invoked HP tail", () => {
  const s = state(),
    h = host(s, [0, 0, 0, 0, 0]);
  delete h.applyKillModelEffect;
  const r = mutateNativePedSever(s, input(), h);
  assert.equal(r.status, "provider-required");
  assert.deepEqual(r.requiredProviders, [
    "source-dead-model-head-sequence-provider",
  ]);
  assert.equal(r.tailInvoked, true);
  assert.equal(r.callerInvoked, false);
  assert.equal(s.hitPoints, 0);
  assert.equal(h.log.filter((e) => e[0] === "tail").length, 1);
});

async function original(path, t) {
  try {
    return await readFile(new URL(`../carma2_orig/${path}`, import.meta.url));
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Original local installation absent");
      return null;
    }
    throw error;
  }
}
test("original humanoid FORM/model inventory drives source subtree outlets independently of ACT child order", async (t) => {
  const bytes = await original("data/PEDS/FORMS/BIPED1.TXT", t);
  if (!bytes) return;
  const form = parsePedForm(decodeText(bytes)),
    remapBytes = await original("data/PEDS/REMAPS/MAN.TXT", t);
  if (!remapBytes) return;
  assert.deepEqual(
    form.bones.map((b) => b.parent),
    parents,
  );
  assert.equal(form.headBone, 1);
  assert.equal(form.maxBoned, 10);
  const articulatedBytes = await original("data/PEDS/FORMS/BIPEDF.TXT", t);
  if (!articulatedBytes) return;
  const articulatedForm = parsePedForm(decodeText(articulatedBytes));
  assert.deepEqual(
    articulatedForm.bones.map((b) => b.parent),
    parents,
  );
  assert.equal(articulatedForm.bones[1].jointType, "BALLNSOCKET");
  assert.equal(articulatedForm.bones[3].jointType, "HINGE");
  assert.equal(articulatedForm.mass, form.mass);
  for (const [person, head, lowerLeft, lowerRight] of [
    ["Blokebl", "CHEBL.DAT", "LBOTLBL.DAT", "RBOTLBL.DAT"],
    ["Bandsman", "HEDC.DAT", "LBOTLDC.DAT", "RBOTLDC.DAT"],
  ]) {
    const archive = await original(`data/PEDS/PEEPS/${person}.TWT`, t);
    if (!archive) return;
    const entry = parseTwt(archive).entries.find(
      (e) => e.name.toLowerCase() === `${person.toLowerCase()}.txt`,
    );
    const profile = parsePedPersonalitySimpleBody(
      decodeText(archive.subarray(entry.offset, entry.offset + entry.size)),
      form,
      parsePedRemap(decodeText(remapBytes)),
    );
    assert.equal(profile.modelsByBone.get(form.bones[1].name)[0], head);
    assert.equal(profile.modelsByBone.get(form.bones[3].name)[0], lowerLeft);
    assert.equal(profile.modelsByBone.get(form.bones[5].name)[0], lowerRight);
    const s = state(),
      h = host(s, [0, select(2), ...Array(6).fill(16384)]);
    const read = h.readBone;
    h.readBone = (i) => ({
      ...read(i),
      model: profile.modelsByBone.get(form.bones[i].name)[0],
    });
    const r = mutateNativePedSever(s, input({ form }), h);
    assert.equal(r.newlyDetached, 2);
    assert.deepEqual(
      h.log
        .filter((e) => e[0] === "register")
        .map((e) => [e[1].index, e[1].snapshot.model, e[1].bone.mass]),
      [
        [3, lowerLeft, Math.fround(0.007)],
        [
          2,
          profile.modelsByBone.get(form.bones[2].name)[0],
          Math.fround(0.008),
        ],
      ],
    );
  }
});

test("activation reads live character flag and velocity after successful PHIL registration", () => {
  for (const activeAfterRegistration of [true, false]) {
    const s = state({ physicsActive: !activeAfterRegistration });
    const h = host(s, [0, select(9), 0, 16384, 32767]);
    const register = h.registerBone;
    let committed;
    h.registerBone = (request) => {
      assert.equal(
        request.activation,
        null,
        "registration saw premature activation",
      );
      s.physicsActive = activeAfterRegistration;
      s.characterVelocity = [-7, 8, -9];
      return register(request);
    };
    h.commitBone = (request) => {
      committed = request.activation;
    };
    const result = mutateNativePedSever(s, input(), h);
    assert.equal(result.status, "complete");
    if (activeAfterRegistration)
      assert.deepEqual(committed.velocity, [-7, 8, -9]);
    else assert.equal(committed, null);
  }
});
