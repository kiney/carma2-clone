import test from "node:test";
import assert from "node:assert/strict";
import {
  decideNativePedHalt,
  mutateNativePedHalt,
  completeNativePedMove,
  nativePedPercentageChance,
  sharedNativePedHaltState,
} from "../src/physics/ped-halt.ts";
import { NativeRandom } from "../src/native-random.ts";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import {
  parsePedForm,
  parsePedRemap,
  parsePedPersonalitySimpleBody,
} from "../src/ped-form.ts";

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const lying = [1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0];
function state(overrides = {}) {
  return {
    hitPoints: 100,
    flags: 8,
    moveId: 93,
    action: 5,
    impactSerial: 0,
    cache: { retryCount: 0 },
    doNothing: true,
    rigidFlags: 0,
    rigidPose: new Float32Array(identity),
    localOmega: [0, 0, 0],
    filterA: 0x20000,
    filterB: 0x40000,
    ...overrides,
  };
}
function input(overrides = {}) {
  return {
    actorRootPose: identity,
    characterOrientation: lying,
    worldFaceNormals: [[0, 1, 0]],
    mass: 2,
    inertia: [2.6, 2, 1],
    bounds: { min: [0, 0, 0], max: [2, 4, 6] },
    lyingAxes: [-1, 1],
    head: { boneIndex: 0, modelState: 0 },
    collisionFlag: false,
    nowMs: 123,
    immortal: false,
    volumeGravity: null,
    goreLevel: 0,
    replay: false,
    mutantSpeed: 0,
    ...overrides,
  };
}
function providers(values = [32767]) {
  let i = 0;
  return {
    shared: { retryScalar: 8 },
    nextCrtInteger: () => values[i++ % values.length],
  };
}
function near(actual, expected, tol = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tol, `${actual} != ${expected}`);
}

test("strict principal axis comparisons select Z for every tied maximum", () => {
  for (const [I, axis] of [
    [[3, 2, 1], 0],
    [[1, 3, 2], 1],
    [[2, 2, 1], 2],
    [[3, 1, 3], 2],
    [[1, 3, 3], 2],
    [[1, 1, 1], 2],
  ]) {
    assert.equal(
      decideNativePedHalt(state(), input({ inertia: I })).principalAxis,
      axis,
    );
  }
});
test("upright uses living character orientation inverse, source Float32 .93 boundary, not actor yaw", () => {
  const above = identity.slice();
  above[4] = Math.fround(0.93); // Source float is strictly ABOVE double.93.
  const below = identity.slice();
  below[4] = Math.fround(0.93) - 2 ** -24;
  assert.equal(
    decideNativePedHalt(state(), input({ characterOrientation: above })).kind,
    "upright",
  );
  assert.equal(
    decideNativePedHalt(state(), input({ characterOrientation: below }))
      .upright,
    false,
  );
  assert.equal(
    decideNativePedHalt(
      state({ hitPoints: 0 }),
      input({ characterOrientation: identity }),
    ).upright,
    false,
  );
  assert.equal(
    decideNativePedHalt(state(), input({ characterOrientation: lying }))
      .upright,
    false,
  );
});
test("ordered highest positive face retains ties, no support leaves a bounded provider gap", () => {
  const d = decideNativePedHalt(
    state(),
    input({
      worldFaceNormals: [
        [1, 0, 0],
        [0.4, 0.8, 0.2],
        [-0.2, 0.8, 0.4],
        [0, -1, 0],
      ],
    }),
  );
  assert.deepEqual(d.supportNormal, [
    Math.fround(0.4),
    Math.fround(0.8),
    Math.fround(0.2),
  ]);
  assert.equal(
    decideNativePedHalt(
      state(),
      input({
        worldFaceNormals: [
          [0, 0, 1],
          [0, -1, 0],
        ],
      }),
    ).kind,
    "unsupported",
  );
  assert.equal(
    decideNativePedHalt(
      state(),
      input({ worldFaceNormals: [], characterOrientation: identity }),
    ).kind,
    "upright",
  );
});
test("strict Float32-spilled .706 retry gate and alive/dead cache limits", () => {
  const make = (dot) =>
    input({ worldFaceNormals: [[-dot, 1, 0]], inertia: [3, 2, 1] });
  const low = Math.fround(0.706),
    high = low + 2 ** -24;
  assert.equal(decideNativePedHalt(state(), make(low)).alignmentRetry, true);
  assert.equal(decideNativePedHalt(state(), make(high)).alignmentRetry, false);
  for (const [hp, count, kind] of [
    [100, 2, "retry"],
    [100, 3, "kill-required"],
    [0, 1, "retry"],
    [0, 2, "dead"],
    [-1, 2, "dead"],
  ]) {
    assert.equal(
      decideNativePedHalt(
        state({ hitPoints: hp, cache: { retryCount: count } }),
        input(),
      ).kind,
      kind,
    );
  }
  assert.equal(
    decideNativePedHalt(state({ cache: null }), input()).kind,
    "kill-required",
  );
  assert.equal(
    decideNativePedHalt(state({ cache: null }), input({ immortal: true })).kind,
    "lying",
  );
});
test("reflection and physical actor principal row determine front/back FORM directions", () => {
  const actor = [0, 1, 0, -1, 0, 0, 0, 0, 1, 7, 8, 9];
  const back = decideNativePedHalt(state(), input({ actorRootPose: actor }));
  assert.equal(back.axisDotNormal, -1);
  assert.equal(back.moveId, 81);
  assert.deepEqual(back.direction, [0, 0, 1]);
  const reflected = actor.slice();
  reflected[1] = -1;
  const front = decideNativePedHalt(
    state(),
    input({ actorRootPose: reflected }),
  );
  assert.equal(front.axisDotNormal, 1);
  assert.equal(front.moveId, 80);
  front.direction.forEach((n, i) => near(n, -[0, 0, 1][i]));
});
test("PercentageChance consumes exact shared CRT integer draw and strict threshold", () => {
  let count = 0;
  assert.equal(
    nativePedPercentageChance(0, () => {
      count++;
      return 0;
    }),
    false,
  );
  assert.equal(count, 0);
  assert.equal(
    nativePedPercentageChance(50, () => 16383),
    true,
  );
  assert.equal(
    nativePedPercentageChance(50, () => 16384),
    false,
  );
  assert.equal(
    nativePedPercentageChance(75, () => 24575),
    true,
  );
  assert.equal(
    nativePedPercentageChance(75, () => 24576),
    false,
  );
  const rng = new NativeRandom(1);
  assert.equal(
    nativePedPercentageChance(50, () => rng.nextInteger()),
    true,
  );
  assert.equal(rng.state, 2745024);
  assert.equal(sharedNativePedHaltState.retryScalar, 8);
});
test("retry uses persistent signed8, negative actor axis, first face and min0 before clearing ec", () => {
  const shared = { retryScalar: 8 },
    rng = new NativeRandom(1),
    p = { shared, nextCrtInteger: () => rng.nextInteger() },
    s = state({ moveId: 90 });
  const order = [];
  p.onEffect = (e) => order.push(e.kind);
  const result = mutateNativePedHalt(
    s,
    input({
      inertia: [1, 2, 3],
      worldFaceNormals: [
        [1, 0, 0],
        [0, 1, 0],
      ],
    }),
    p,
  );
  assert.equal(result.returnValue, 0);
  assert.equal(result.randomDraws, 1);
  assert.equal(shared.retryScalar, -8);
  assert.equal(s.cache.retryCount, 1);
  assert.equal(s.moveId, 93);
  assert.equal(s.action, 3);
  assert.equal(s.doNothing, false);
  assert.equal(s.rigidFlags & 0x100, 0x100);
  assert.deepEqual(order, [
    "position",
    "move",
    "head-sequence",
    "action",
    "settling",
    "sync-root-basis",
  ]);
  const e = result.effects.find((e) => e.kind === "settling");
  e.worldVector.forEach((n, i) => near(n, [0, 0, 8][i]));
  assert.equal(e.minimumSpeed, 0);
  assert.equal(e.gain, Math.fround(1.39));
  assert.equal(e.result.gate, "applied");
  near(s.localOmega[1], -2.2239999771118164);
  assert.equal(s.cache.headSequence.startTimeMs, 123);
  // A different pedestrian reuses the SAME sign/scalar and CRT stream.
  const s2 = state();
  const result2 = mutateNativePedHalt(s2, input({ inertia: [1, 2, 3] }), p);
  assert.equal(result2.randomDraws, 1);
  assert.equal(shared.retryScalar, -8); // Second CRT draw18467 does not flip.
});
test("reaction membership is exactly90/91/92/97/113; dead replaces with94 and no living head sequence", () => {
  for (const id of [90, 91, 92, 97, 113]) {
    const s = state({ moveId: id });
    mutateNativePedHalt(s, input(), providers());
    assert.equal(s.moveId, 93, id);
  }
  for (const id of [93, 94, 95, 96, 98, 112, 114]) {
    const s = state({ moveId: id });
    mutateNativePedHalt(s, input(), providers());
    assert.equal(s.moveId, id, id);
  }
  const s = state({ hitPoints: 0, moveId: 90 });
  const r = mutateNativePedHalt(s, input(), providers());
  assert.equal(s.moveId, 94);
  assert.ok(!r.effects.some((e) => e.kind === "head-sequence"));
});

test("head-start effect retains offscreen sequence writes and carries actual renderSlot independently of MODEL pose", () => {
  for (const slot of [-1, 0, 15]) {
    const s = state({ moveId: 90 });
    const r = mutateNativePedHalt(
      s,
      input({ head: { boneIndex: -1, modelState: -1, renderSlot: slot } }),
      providers(),
    );
    const effect = r.effects.find((e) => e.kind === "head-sequence");
    assert.ok(effect);
    assert.equal(effect.headBone, -1);
    assert.equal(effect.renderSlot, slot);
    assert.equal(s.cache.headSequence.address, 0x65d050);
    assert.equal(s.cache.headSequence.startTimeMs, 123);
  }
  const s = completion({ moveId: 97 });
  const result = completeNativePedMove(
    s,
    completionInput({
      head: { boneIndex: -1, modelState: -1, renderSlot: -1 },
    }),
  );
  assert.equal(
    result.effects.find((e) => e.kind === "head-sequence").renderSlot,
    -1,
  );
  assert.equal(s.cache.headSequence.index, 0);
});
test("accepted upright/lying order, signed serial wrap, root basis preserves rigid origin", () => {
  const s = state({ impactSerial: 32767, moveId: 90 });
  s.rigidPose.set([4, 5, 6], 9);
  const r = mutateNativePedHalt(
    s,
    input({ characterOrientation: identity }),
    providers(),
  );
  assert.equal(r.returnValue, 1);
  assert.equal(s.impactSerial, -32768);
  assert.equal(s.moveId, 41);
  assert.equal(s.action, 1);
  assert.equal(s.cache.runSpeed, 100);
  assert.equal(s.cache.runFactor, Math.fround(0.09));
  assert.equal(s.runningTimeMs, 123);
  assert.equal(s.flags & 8, 0);
  assert.equal(s.filterA, 0x10000);
  assert.equal(s.filterB, 0x50000);
  assert.deepEqual(Array.from(s.rigidPose.slice(9)), [4, 5, 6]);
  assert.deepEqual(
    r.effects.map((e) => e.kind),
    [
      "position",
      "status-physical-level",
      "move",
      "head-sequence",
      "recache-ground",
      "direction",
      "move",
      "rescan-proximity",
      "scan-objects",
      "sync-root-basis",
      "clear-volume",
    ],
  );
  const ly = state();
  const out = mutateNativePedHalt(
    ly,
    input({ actorRootPose: [0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0] }),
    providers(),
  );
  const m = out.effects.find((e) => e.kind === "move");
  assert.equal(m.moveId, 81);
  assert.equal(m.completion, true);
  assert.equal(m.action, 4);
});
test("exhausted alive alignment invokes explicit KillPedestrian outlet; no fake HP tail", () => {
  const s = state({ cache: { retryCount: 3 } });
  const blocked = mutateNativePedHalt(s, input(), providers());
  assert.equal(blocked.returnValue, null);
  assert.equal(s.hitPoints, 100);
  assert.ok(
    blocked.requiredProviders.includes("KillPedestrian-model-score-gore"),
  );
  const real = state({ cache: { retryCount: 3 } }),
    p = providers();
  let called = 0;
  p.kill = () => {
    called++;
    return 0;
  };
  const done = mutateNativePedHalt(real, input(), p);
  assert.equal(called, 1);
  assert.equal(done.returnValue, 1);
  assert.equal(real.hitPoints, 0);
  assert.equal(real.moveId, 94);
  assert.equal(done.randomDraws, 0);
  assert.ok(
    done.effects.some((e) => e.kind === "freeze-move" && e.speed === 0),
  );
});
test("dead acceptance freezes current move and draws75 before flags/gore; low gravity skips draw", () => {
  for (const [flags, gore] of [
    [0, 0],
    [0x10, 2],
  ]) {
    const s = state({ hitPoints: 0, cache: { retryCount: 2 }, flags });
    const r = mutateNativePedHalt(
      s,
      input({ goreLevel: gore }),
      providers([0]),
    );
    assert.equal(r.returnValue, 1);
    assert.equal(r.randomDraws, 1);
    assert.equal(s.moveId, 93);
    assert.ok(!r.effects.some((e) => e.kind === "corpse-slick"));
  }
  const out = mutateNativePedHalt(
    state({ hitPoints: 0, cache: { retryCount: 2 }, flags: 0 }),
    input({ goreLevel: 2 }),
    providers([0]),
  );
  assert.ok(out.effects.some((e) => e.kind === "corpse-slick"));
  assert.ok(out.requiredProviders.includes("source-corpse-slick-provider"));
  const low = mutateNativePedHalt(
    state({ hitPoints: 0, cache: { retryCount: 2 } }),
    input({ volumeGravity: 0.5, mutantSpeed: 2 }),
    providers(),
  );
  assert.equal(low.randomDraws, 0);
  assert.ok(
    low.effects.some((e) => e.kind === "freeze-move" && e.speed === -2),
  );
});
function completion(overrides = {}) {
  return {
    ...state(),
    moveId: 80,
    frame: 60,
    completionEnabled: true,
    ...overrides,
  };
}
function completionInput(overrides = {}) {
  return {
    frameCount: 60,
    positiveAdvance: 1,
    replay: false,
    nowMs: 500,
    blind: false,
    valiumTimeMs: 0,
    head: { boneIndex: 0, modelState: 0 },
    ...overrides,
  };
}
test("native animation completion gates actual frame/positive advance/replay and clears callback BEFORE dispatch", () => {
  for (const input of [
    completionInput({ positiveAdvance: 0 }),
    completionInput({ replay: true }),
    completionInput({ frameCount: 61 }),
  ]) {
    const s = completion();
    assert.equal(completeNativePedMove(s, input).dispatched, false);
    assert.equal(s.completionEnabled, true);
  }
  const s = completion();
  let observed;
  const r = completeNativePedMove(s, completionInput(), () => {
    observed = s.completionEnabled;
  });
  assert.equal(r.dispatched, true);
  assert.equal(observed, false);
  assert.equal(s.frame, 59);
  assert.equal(s.moveId, 41);
  assert.equal(s.action, 1);
  assert.equal(completeNativePedMove(s, completionInput()).dispatched, false);
});
test("all lying completion IDs80..85 default RUN41; blind/valium WALK30; missing cache preserves speed-1", () => {
  for (let id = 80; id <= 85; id++) {
    const s = completion({ moveId: id });
    const r = completeNativePedMove(s, completionInput());
    assert.equal(s.moveId, 41);
    assert.equal(s.cache.runSpeed, 100);
    assert.equal(r.effects[0].speed, 100);
  }
  for (const opts of [{ blind: true }, { valiumTimeMs: 1 }]) {
    const s = completion();
    const r = completeNativePedMove(s, completionInput(opts));
    assert.equal(s.moveId, 30);
    assert.equal(s.action, 0);
    assert.equal(r.effects[0].speed, -1);
  }
  const s = completion({ cache: null });
  assert.equal(
    completeNativePedMove(s, completionInput()).effects[0].speed,
    -1,
  );
  assert.equal(s.cache, null);
});
test("reaction completion owns97 callback, dead94 and explicit113 outlet", () => {
  for (const id of [90, 91, 92]) {
    const s = completion({ moveId: id });
    completeNativePedMove(s, completionInput());
    assert.equal(s.moveId, 97);
    assert.equal(s.completionEnabled, true);
  }
  for (const id of [96, 97]) {
    const s = completion({ moveId: id, hitPoints: 0 });
    completeNativePedMove(s, completionInput());
    assert.equal(s.moveId, 94);
    assert.equal(s.completionEnabled, false);
  }
  assert.ok(
    completeNativePedMove(
      completion({ moveId: 113 }),
      completionInput(),
    ).requiredProviders.includes("source-move113-forced-reaction-provider"),
  );
});
test("four original FORM moments/lying axes remain authored across source halt classification", async (t) => {
  let store;
  try {
    store = await createAssetStore(
      new URL("../carma2_orig/", import.meta.url).pathname,
    );
  } catch (e) {
    if (e.code === "ENOENT") {
      t.skip("Original installation unavailable");
      return;
    }
    throw e;
  }
  const text = async (p) => decodeText(await store.read(p));
  for (const [name, expected, lyingAxes] of [
    ["blokebl", 2, [-1, 1]],
    ["twolf", 0, [2, 2]],
    ["cow", 0, [2, 2]],
    ["elephant", 0, [2, 2]],
  ]) {
    const personality = await text(`data/PEDS/PEEPS/${name}/${name}.TXT`);
    const formName = personality
      .split(/\r?\n/)
      .map((l) => l.split("//")[0].trim())
      .find(Boolean);
    const form = parsePedForm(await text(`data/PEDS/FORMS/${formName}.TXT`));
    const remap = form.remapFilename
      ? parsePedRemap(await text(`data/PEDS/REMAPS/${form.remapFilename}`))
      : undefined;
    const profile = parsePedPersonalitySimpleBody(personality, form, remap);
    const I = profile.inertia;
    assert.deepEqual(form.lyingAxes, lyingAxes, name);
    const d = decideNativePedHalt(
      state(),
      input({
        mass: profile.mass,
        inertia: I,
        bounds: profile.bounds,
        lyingAxes: form.lyingAxes,
      }),
    );
    assert.equal(d.principalAxis, expected, name);
    assert.deepEqual(
      d.negativeActorAxis.map(Math.abs),
      [0, 1, 2].map((i) => (i === expected ? 1 : 0)),
      name,
    );
  }
});

test("replay dead acceptance skips the corpse-slick chance without consuming shared CRT or reactivating the body", () => {
  const dead = state({ hitPoints: 0, cache: { retryCount: 2 }, flags: 0 });
  const p = providers();
  p.nextCrtInteger = () => {
    throw new Error("replay must not draw slick chance");
  };
  const result = mutateNativePedHalt(
    dead,
    input({ replay: true, goreLevel: 2 }),
    p,
  );
  assert.equal(result.returnValue, 1);
  assert.equal(result.randomDraws, 0);
  assert.equal(dead.flags & 0x10, 0);
  assert.ok(!result.effects.some((e) => e.kind === "corpse-slick"));
  assert.ok(result.effects.some((e) => e.kind === "freeze-move"));
  assert.ok(
    result.effects.some(
      (e) => e.kind === "status-physical-level" && e.level === 5,
    ),
  );
  assert.ok(result.effects.some((e) => e.kind === "clear-volume"));
  assert.throws(
    () => decideNativePedHalt(state(), input({ replay: undefined })),
    /explicit replay/,
  );
  assert.throws(
    () =>
      decideNativePedHalt(
        state(),
        input({ head: { boneIndex: 1, modelState: 0, renderSlot: 128 } }),
      ),
    /head render slot/,
  );
});
