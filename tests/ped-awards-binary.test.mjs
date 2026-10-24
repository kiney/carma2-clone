import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import {
  classifyNativePedAward,
  NativePedAwardCounter,
  consumeNativeEarnCredits,
} from "../src/ped-awards.ts";
import { parsePedAwards } from "../src/race-awards.ts";
import { parsePowerups } from "../src/powerups.ts";
import { createAssetStore } from "../server/assets.mjs";

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const context = (overrides = {}) => ({
  cachePresent: true,
  killerDriver: 8,
  cacheFlags: 0,
  height: 0,
  napalmDeadlineMs: 0,
  killerAngularVelocity: v(),
  killerUpY: 1,
  killerActorOriginY: 0,
  pedestrianY: 0,
  pedVelocity: v(),
  pedStartingVelocity: v(),
  localPedPosition: v(0, 0, -1),
  killerLocalVelocity: v(0, 0, -1),
  ...overrides,
});
const awards = { points: [300, 200, 150], time: [15, 10, 5] };

test("installed ordered cache flags choose one multiplier and preserve the napalm bit across another kill cause", () => {
  for (const [flags, multiplier, fancyIndex, name] of [
    [0x79, 20, 32, "mutant-tail"],
    [0x69, 5, 31, "tail"],
    [0x61, 2, 2, "mine"],
    [0x21, 4, 17, "drone-or-indirect"],
    [0x20, 2, 30, "napalm"],
  ]) {
    const result = new NativePedAwardCounter().score(
      2000,
      awards,
      0,
      context({
        cacheFlags: flags,
        height: 5,
        pedVelocity: v(10),
        killerAngularVelocity: v(20),
      }),
    );
    assert.equal(result.multiplier, multiplier);
    assert.equal(result.fancyIndex, fancyIndex);
    assert.equal(result.classification, name);
    assert.equal(result.credits, 300 * multiplier);
    assert.equal(result.seconds, 15);
    assert.equal(result.pratcamEvent, 30);
    assert.deepEqual(result.missingInputs, []);
  }
  assert.equal(
    classifyNativePedAward(context(), 1).multiplier,
    1,
    "electric/annihilator alone do not author a cache cause flag",
  );
});

test("normal caller height zero inspects rolling fields; signed cache98 can independently select its earlier class", () => {
  for (const value of [
    { killerAngularVelocity: v(5.0001) },
    { killerAngularVelocity: v(0, 0, -5.0001) },
    { killerUpY: Math.fround(0.1) - 1e-7 },
    { killerActorOriginY: Math.fround(0.05) + 1e-7 },
  ]) {
    assert.equal(
      classifyNativePedAward(context(value), 1).classification,
      "rolling-or-burning-cache",
    );
    assert.equal(
      classifyNativePedAward(context({ ...value, height: 0.01 }), 1).multiplier,
      1,
    );
  }
  assert.equal(
    classifyNativePedAward(
      context({
        killerAngularVelocity: v(5, 0, -5),
        killerUpY: Math.fround(0.1),
        killerActorOriginY: Math.fround(0.05),
      }),
      1,
    ).multiplier,
    1,
  );
  assert.equal(
    classifyNativePedAward(context({ napalmDeadlineMs: 1, height: 3 }), 1)
      .multiplier,
    4,
  );
  assert.equal(
    classifyNativePedAward(context({ napalmDeadlineMs: 0x80000000 }), 1)
      .multiplier,
    1,
  );
  assert.equal(
    classifyNativePedAward(context({ napalmDeadlineMs: 0xffffffff }), 1)
      .multiplier,
    1,
  );
  assert.equal(
    classifyNativePedAward(
      context({ cacheFlags: 0x20, napalmDeadlineMs: 1 }),
      1,
    ).multiplier,
    2,
    "napalm cause precedes positive cache98's fourfold branch",
  );
});

test("height then current/starting raw pedestrian velocity choose ordered non-stacking classes", () => {
  assert.equal(classifyNativePedAward(context({ height: 1 }), 1).multiplier, 1);
  const height = classifyNativePedAward(
    context({ height: 1.0001, pedVelocity: v(3) }),
    1,
  );
  assert.equal(height.multiplier, 2);
  assert.equal(height.fancyIndex, 6);
  for (const key of ["pedVelocity", "pedStartingVelocity"]) {
    const result = classifyNativePedAward(context({ [key]: v(1, 1) }), 1);
    assert.equal(result.multiplier, 4);
    assert.equal(result.fancyIndex, 5);
    assert.equal(
      classifyNativePedAward(context({ [key]: v(1, 0.999) }), 1).multiplier,
      1,
    );
  }
});

test("native local hit ratio, sideways velocity, spin ratio and reverse signs preserve boundaries", () => {
  const sideways = context({
    localPedPosition: v(0.5, 0, -1),
    killerLocalVelocity: v(2, 0, 1),
  });
  assert.equal(classifyNativePedAward(sideways, 1).multiplier, 2);
  assert.equal(
    classifyNativePedAward(
      { ...sideways, localPedPosition: v(0.4999, 0, -1) },
      1,
    ).multiplier,
    1,
  );
  const spinning = context({
    localPedPosition: v(0.5, 0, -1),
    killerLocalVelocity: v(0, 0, -1),
    killerAngularVelocity: v(0, 600, 0),
  });
  assert.equal(classifyNativePedAward(spinning, 1).multiplier, 1);
  assert.equal(
    classifyNativePedAward(
      { ...spinning, killerAngularVelocity: v(0, -600.001, 0) },
      1,
    ).multiplier,
    2,
  );
  const reverse = classifyNativePedAward(
    context({ localPedPosition: v(0, 0, 1), killerLocalVelocity: v(0, 0, 1) }),
    1,
  );
  assert.equal(reverse.multiplier, 2);
  assert.equal(reverse.fancyIndex, 2);
  assert.equal(
    reverse.pratcamEvent,
    undefined,
    "sideways/reverse skips installed empty event stub",
  );
  assert.equal(
    classifyNativePedAward(
      context({
        localPedPosition: v(0, 0, 0),
        killerLocalVelocity: v(0, 0, 1),
      }),
      1,
    ).multiplier,
    1,
  );
  assert.equal(
    classifyNativePedAward(
      context({
        localPedPosition: v(1, 0, -1),
        killerLocalVelocity: v(0, 0, 0),
        killerAngularVelocity: v(0, 1),
      }),
      1,
    ).multiplier,
    2,
    "division by zero has native IEEE infinity semantics",
  );
});

test("native DWORD field loads round supplied geometry before ordered classification", () => {
  for (const [overrides, expected] of [
    [{ height: 1.00000001 }, "ordinary"],
    [{ height: 1.0000001192092896 }, "falling-height"],
    [{ killerAngularVelocity: v(5.00000001) }, "ordinary"],
    [
      { killerAngularVelocity: v(-5.000000476837158) },
      "rolling-or-burning-cache",
    ],
    [{ killerAngularVelocity: v(0, 0, -5.00000001) }, "ordinary"],
    [
      { killerAngularVelocity: v(0, 0, 5.000000476837158) },
      "rolling-or-burning-cache",
    ],
    [{ killerUpY: Math.fround(0.1) - 1e-10 }, "ordinary"],
    [{ killerUpY: 0.09999999403953552 }, "rolling-or-burning-cache"],
    [{ killerActorOriginY: Math.fround(0.05) + 1e-10 }, "ordinary"],
    [{ killerActorOriginY: 0.05000000447034836 }, "rolling-or-burning-cache"],
    [{ pedVelocity: v(1, 1 - 1e-10) }, "moving-pedestrian"],
    [{ pedStartingVelocity: v(1, 1 - 1e-10) }, "moving-pedestrian"],
    [{ pedVelocity: v(1, 0.9999999403953552) }, "ordinary"],
    [
      {
        localPedPosition: v(0.5 - 1e-10, 0, -1),
        killerLocalVelocity: v(2, 0, -1),
      },
      "sideways-or-reverse",
    ],
    [
      {
        localPedPosition: v(0.5, 0, -1),
        killerLocalVelocity: v(1 + 1e-10, 0, -1),
      },
      "ordinary",
    ],
    [
      {
        localPedPosition: v(0.5, 0, -1),
        killerLocalVelocity: v(1.0000001192092896, 0, -1),
      },
      "sideways-or-reverse",
    ],
    [
      {
        localPedPosition: v(0.5, 0, -1),
        killerAngularVelocity: v(0, 600 + 1e-7),
      },
      "ordinary",
    ],
    [
      {
        localPedPosition: v(0.5, 0, -1),
        killerAngularVelocity: v(0, 600.0000610351562),
      },
      "sideways-or-reverse",
    ],
    [
      {
        localPedPosition: v(0, 0, Number.MIN_VALUE),
        killerLocalVelocity: v(0, 0, 1),
      },
      "ordinary",
    ],
    [
      { localPedPosition: v(0, 0, 2 ** -149), killerLocalVelocity: v(0, 0, 1) },
      "sideways-or-reverse",
    ],
    [
      { height: Number.MIN_VALUE, killerAngularVelocity: v(6) },
      "rolling-or-burning-cache",
    ],
  ]) {
    const input = context(overrides);
    const snapshot = structuredClone(input);
    assert.equal(
      classifyNativePedAward(input, 1).classification,
      expected,
      JSON.stringify(overrides),
    );
    assert.deepEqual(
      input,
      snapshot,
      "classification does not mutate its retained inputs",
    );
  }
});

test("native stored Y operands retain their unspilled PC53 difference", () => {
  const originY = 0.0625;
  const pedestrianY = 0.012499998323619366;
  assert.equal(Math.fround(originY), originY);
  assert.equal(Math.fround(pedestrianY), pedestrianY);
  assert.ok(originY - pedestrianY > Math.fround(0.05));
  assert.equal(Math.fround(originY - pedestrianY), Math.fround(0.05));
  assert.equal(
    classifyNativePedAward(
      context({ killerActorOriginY: originY, pedestrianY }),
      1,
    ).classification,
    "rolling-or-burning-cache",
    "4cd206..20c compares a live difference, without a Float32 result store",
  );
});

test("eligibility precedes inclusive unsigned combo clock; combo cap and giblet flag do not multiply time", () => {
  const counter = new NativePedAwardCounter();
  assert.equal(
    counter.score(2000, awards, 0, context({ killerDriver: undefined })),
    undefined,
  );
  assert.equal(
    counter.score(2000, awards, 0, context({ killerDriver: 7 })),
    undefined,
  );
  assert.equal(
    counter.score(2000, awards, 0, context({ cachePresent: false })),
    undefined,
  );
  assert.equal(counter.score(2000, awards, 0, context()).combo, 1);
  const second = counter.score(3000, awards, 0, context({ cacheFlags: 2 }));
  assert.equal(second.combo, 2);
  assert.equal(second.multiplier, 1);
  assert.equal(second.fancyIndex, 8);
  assert.equal(second.credits, 600);
  assert.equal(second.seconds, 15);
  for (let i = 0; i < 20; i++)
    assert.ok(counter.score(3000, awards, 0, context()).combo <= 10);
  assert.equal(counter.score(4001, awards, 0, context()).combo, 1);
  assert.equal(
    counter.score(5002, awards, 0, context({ cacheFlags: 2 })).credits,
    600,
  );
  const wrapping = new NativePedAwardCounter();
  wrapping.score(0xfffffff0, awards, 0, context());
  assert.equal(wrapping.score(0x10, awards, 0, context()).combo, 2);
});

test("unknown source motion skips unevidenced geometry with explicit diagnostics, while authored flags remain exact", () => {
  const raw = { cachePresent: true, killerDriver: 8, cacheFlags: 0 };
  const result = new NativePedAwardCounter().score(2000, awards, 0, raw);
  assert.equal(result.credits, 300);
  assert.ok(result.missingInputs.includes("height"));
  assert.ok(result.missingInputs.includes("pedVelocity"));
  assert.deepEqual(
    classifyNativePedAward({ ...raw, cacheFlags: 0x20 }, 1).missingInputs,
    [],
  );
});

test("native credit products and EarnCredits2 signed addition wrap without clamps or time multiplication", () => {
  const huge = { points: [0x40000000, 0, 0], time: [15, 0, 0] };
  const scored = new NativePedAwardCounter().score(
    2000,
    huge,
    0,
    context({ cacheFlags: 0x08 }),
  );
  assert.equal(scored.credits, 0x40000000);
  assert.equal(scored.seconds, 15);
  const consume = (overrides = {}) =>
    consumeNativeEarnCredits({
      amount: 300,
      creditMultiplier: 0,
      currentCredits: 100,
      raceFinished: false,
      ...overrides,
    });
  assert.deepEqual(consume(), { accepted: true, amount: 300, credits: 400 });
  assert.deepEqual(consume({ creditMultiplier: 3 }), {
    accepted: true,
    amount: 900,
    credits: 1000,
  });
  assert.deepEqual(consume({ amount: -500, creditMultiplier: 3 }), {
    accepted: true,
    amount: -1500,
    credits: -1400,
  });
  assert.deepEqual(consume({ raceFinished: true }), {
    accepted: false,
    amount: 0,
    credits: 100,
  });
  assert.deepEqual(consume({ amount: 0 }), {
    accepted: false,
    amount: 0,
    credits: 100,
  });
  assert.deepEqual(
    consume({ amount: 0x40000000, creditMultiplier: 4 }),
    { accepted: true, amount: 0, credits: 100 },
    "zero after overflow still passes native pre-multiply gate",
  );
  assert.equal(consume({ currentCredits: 0x7fffffff }).credits, -2147483349);
});

test("original Stock/Advanced points, fixed times and Drink Driving authored action48 integer multiplier", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const store = await createAssetStore();
  for (const [root, time] of [
    ["data", [15, 10, 5]],
    ["adv_data", [10, 8, 5]],
  ]) {
    const settings = await store.read(`${root}/PEDS/settings.txt`);
    const parsed = parsePedAwards(new TextDecoder().decode(settings));
    assert.deepEqual(parsed.points, [300, 200, 150]);
    assert.deepEqual(parsed.time, time);
    const powerups = parsePowerups(
      new TextDecoder().decode(await store.read(`${root}/Powerup.txt`)),
    );
    const drink = powerups.find((definition) => definition.action === 48);
    assert.equal(drink.index, 90);
    assert.equal(drink.duration, 30);
    assert.deepEqual(drink.integerParams, [3]);
    for (const skill of [0, 1, 2])
      for (const [cause, multiplier] of [
        [{}, 1],
        [{ cacheFlags: 0x10 }, 20],
        [{ cacheFlags: 0x08 }, 5],
        [{ cacheFlags: 0x40 }, 2],
        [{ cacheFlags: 0x01 }, 4],
        [{ cacheFlags: 0x20 }, 2],
        [{ killerAngularVelocity: v(6) }, 4],
        [{ height: 1.0000001192092896 }, 2],
        [{ pedVelocity: v(1, 1 - 1e-10) }, 4],
        [
          {
            localPedPosition: v(0.5 - 1e-10, 0, -1),
            killerLocalVelocity: v(2, 0, -1),
          },
          2,
        ],
        [{ cacheFlags: 0x02 }, 2],
      ])
        for (const combo of [1, 10]) {
          const counter = new NativePedAwardCounter();
          for (let previous = 1; previous < combo; previous++)
            counter.score(2000, parsed, skill, context());
          const raw = counter.score(2000, parsed, skill, context(cause));
          const factor =
            cause.cacheFlags === 0x02 && combo > 1 ? 1 : multiplier;
          assert.equal(raw.combo, combo);
          assert.equal(raw.credits, parsed.points[skill] * combo * factor);
          assert.equal(
            raw.seconds,
            time[skill],
            "classes/combos never multiply fixed time",
          );
          for (const creditMultiplier of [0, drink.integerParams[0]]) {
            const earned = consumeNativeEarnCredits({
              amount: raw.credits,
              currentCredits: 100,
              creditMultiplier,
              raceFinished: false,
            });
            const amount =
              parsed.points[skill] * combo * factor * (creditMultiplier || 1);
            assert.deepEqual(earned, {
              accepted: true,
              amount,
              credits: 100 + amount,
            });
          }
        }
  }
});
