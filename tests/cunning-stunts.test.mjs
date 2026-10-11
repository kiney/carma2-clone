import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import {
  NativeCunningStuntCounter,
  nativeCunningStuntMotion,
  parseCunningStuntBonus,
} from "../src/cunning-stunts.ts";
import { createAssetStore } from "../server/assets.mjs";

const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const input = (pdTimeMs, overrides = {}) => ({
  pdTimeMs,
  driver: 8,
  mass: 1,
  bodyInertia: v(),
  bodyAngularVelocity: v(),
  upY: 1,
  wheelsDown: 4,
  volumeGravity: undefined,
  actionReplay: false,
  skill: 0,
  creditsBySkill: [2000, 1000, 500],
  ...overrides,
});
const wild = (now, overrides = {}) =>
  input(now, { bodyAngularVelocity: v(17), ...overrides });
const mild = (now, overrides = {}) =>
  input(now, { bodyAngularVelocity: v(2), wheelsDown: 0, ...overrides });
const preparedLanding = (overrides = {}) =>
  new NativeCunningStuntCounter({
    lastAwardMs: 0,
    mildStartMs: 18000,
    mildEndMs: 20000,
    wheelsStartMs: 20000,
    upsideDownMs: 19000,
    ...overrides,
  });

test("installed Float32 thresholds preserve unrounded X/Y and explicitly stored Z asymmetry", () => {
  assert.equal(
    nativeCunningStuntMotion(v(), v(16)).wild,
    true,
    "26.4 in X x87 temporary is above installed Float32 26.3999996185",
  );
  assert.equal(
    nativeCunningStuntMotion(v(), v(15.999999046325684)).wild,
    false,
  );
  assert.equal(nativeCunningStuntMotion(v(), v(0, 28)).wild, true);
  assert.equal(
    nativeCunningStuntMotion(v(), v(0, 27.999998092651367)).wild,
    false,
  );
  assert.equal(
    nativeCunningStuntMotion(v(), v(0, 0, 16)).wild,
    false,
    "Z is stored Float32 and exactly equals its Float32 threshold",
  );
  assert.equal(
    nativeCunningStuntMotion(v(), v(0, 0, 16.000001907348633)).wild,
    true,
  );
  assert.equal(nativeCunningStuntMotion(v(), v(1)).mild, true);
  assert.equal(nativeCunningStuntMotion(v(), v(0, 0, 1)).mild, false);
  assert.equal(
    nativeCunningStuntMotion(v(), v(0, 0, 1.0000001192092896)).mild,
    true,
  );
  assert.equal(
    nativeCunningStuntMotion(v(), v(0, 3)).mild,
    false,
    "mild motion excludes the body Y axis",
  );
  const actual = nativeCunningStuntMotion(v(0.02, 0.03, 0.04), v(-2, -3, -4));
  assert.equal(
    actual.x,
    ((47.61000061035156 * 0.019999999552965164 + 3.3) / 2) * 2,
  );
  assert.equal(
    actual.y,
    ((47.61000061035156 * 0.029999999329447746 + 3.57) / 2) * 3,
  );
  assert.equal(
    actual.z,
    Math.fround(((47.61000061035156 * 0.03999999910593033 + 0.44) / 2) * 4),
  );
});

test("wild motion uses greater-than ten-second cooldown, inclusive 500ms duration and retains its start after award", () => {
  const counter = new NativeCunningStuntCounter({ lastAwardMs: 1000 });
  assert.equal(counter.advance(wild(11000)), undefined);
  assert.equal(counter.snapshot.wildStartMs, 0);
  assert.equal(counter.advance(wild(11001)), undefined);
  assert.equal(counter.snapshot.wildStartMs, 11001);
  assert.equal(counter.advance(wild(11500)), undefined);
  assert.deepEqual(counter.advance(wild(11501, { skill: 1 })), {
    kind: "wild",
    credits: 1000,
    fancyIndex: 18,
    seconds: 0,
  });
  assert.equal(counter.snapshot.lastAwardMs, 11501);
  assert.equal(counter.snapshot.wildStartMs, 11001);
  assert.throws(() => counter.recordLandingAwardPdTime(11502), /No landing/);
  counter.advance(wild(21501));
  assert.equal(
    counter.snapshot.wildStartMs,
    0,
    "cooldown path clears the retained wild start",
  );
  counter.advance(wild(21502));
  assert.equal(counter.snapshot.wildStartMs, 21502);
});

test("native driver, mass and replay gates preserve existing pending state rather than cancel it", () => {
  const state = {
    lastAwardMs: 1,
    wildStartMs: 2,
    mildStartMs: 3,
    mildEndMs: 4,
    wheelsStartMs: 5,
    upsideDownMs: 6,
  };
  for (const overrides of [
    { driver: 7 },
    { actionReplay: true },
    { mass: 5 },
    { mass: 4.9999999 },
  ]) {
    const counter = new NativeCunningStuntCounter(state);
    assert.equal(counter.advance(wild(11000, overrides)), undefined);
    assert.deepEqual(counter.snapshot, state);
  }
  const accepted = new NativeCunningStuntCounter();
  accepted.advance(wild(11000, { mass: 4.999999523162842 }));
  assert.equal(accepted.snapshot.wildStartMs, 11000);
});

test("raw special-volume gravity restarts wild timing and delays landing without clearing its qualified interval", () => {
  const counter = new NativeCunningStuntCounter();
  counter.advance(wild(11000));
  counter.advance(wild(11499, { volumeGravity: 0.5 }));
  assert.equal(counter.snapshot.wildStartMs, 11499);
  assert.equal(counter.advance(wild(11998, { volumeGravity: 1 })), undefined);
  assert.equal(counter.advance(wild(11999, { volumeGravity: 1 })).kind, "wild");
  const landing = preparedLanding();
  assert.equal(landing.advance(input(20501, { volumeGravity: 2 })), undefined);
  assert.equal(landing.snapshot.wheelsStartMs, 20000);
  assert.equal(landing.snapshot.mildStartMs, 18000);
  assert.equal(
    landing.advance(input(21000, { volumeGravity: 1 })).kind,
    "landing",
  );
  const storedGravity = preparedLanding();
  assert.equal(
    storedGravity.advance(input(20501, { volumeGravity: 1 + 1e-9 })).kind,
    "landing",
    "volume field is Float32, and only its raw stored value is compared",
  );
});

test("two-second mild upside-down interval, all-wheel landing and fresh post-Earn PD clock produce one award", () => {
  const counter = new NativeCunningStuntCounter();
  counter.advance(mild(18000, { upY: -1 }));
  counter.advance(mild(19999));
  assert.equal(counter.snapshot.upsideDownMs, 18000);
  assert.equal(counter.advance(input(20000)), undefined);
  assert.equal(counter.snapshot.mildEndMs, 20000);
  assert.equal(counter.snapshot.wheelsStartMs, 20000);
  assert.equal(counter.advance(input(20500)), undefined);
  assert.deepEqual(counter.advance(input(20501)), {
    kind: "landing",
    credits: 2000,
    fancyIndex: 18,
    seconds: 0,
  });
  assert.equal(
    counter.snapshot.lastAwardMs,
    20501,
    "provisional frame sample before root's post-outlet resample",
  );
  counter.recordLandingAwardPdTime(20517);
  assert.equal(counter.snapshot.lastAwardMs, 20517);
  assert.deepEqual(counter.snapshot, {
    lastAwardMs: 20517,
    wildStartMs: 0,
    mildStartMs: 0,
    mildEndMs: 0,
    wheelsStartMs: 0,
    upsideDownMs: 0,
  });
  assert.throws(() => counter.recordLandingAwardPdTime(20518), /No landing/);
  assert.equal(counter.advance(input(20518)), undefined);
});

test("mild interval duration, inverted up threshold and inclusive upside-down timestamp boundaries are independent", () => {
  const short = new NativeCunningStuntCounter();
  short.advance(mild(18000, { upY: -1 }));
  short.advance(input(19999));
  assert.equal(short.snapshot.mildStartMs, 0);
  const exactUp = new NativeCunningStuntCounter();
  exactUp.advance(mild(18000, { upY: Math.fround(-0.8) }));
  assert.equal(exactUp.snapshot.upsideDownMs, 0);
  exactUp.advance(mild(18001, { upY: -0.8000000715255737 }));
  assert.equal(exactUp.snapshot.upsideDownMs, 18001);
  for (const timestamp of [18000, 20000])
    assert.equal(
      preparedLanding({ upsideDownMs: timestamp }).advance(input(20501)).kind,
      "landing",
    );
  for (const timestamp of [17999, 20001]) {
    const counter = preparedLanding({ upsideDownMs: timestamp });
    assert.equal(counter.advance(input(20501)), undefined);
    assert.equal(counter.snapshot.mildStartMs, 0);
  }
});

test("landing onset must be under 300ms, and partial ground contact updates end while clearing landing start", () => {
  const state = { mildStartMs: 18000, mildEndMs: 20000, upsideDownMs: 19000 };
  const timely = new NativeCunningStuntCounter(state);
  timely.advance(input(20299, { wheelsDown: 6 }));
  assert.equal(
    timely.snapshot.wheelsStartMs,
    20299,
    "native compares wheel count >=4",
  );
  assert.equal(timely.advance(input(20799)), undefined);
  assert.equal(timely.advance(input(20800)).kind, "landing");
  const late = new NativeCunningStuntCounter(state);
  late.advance(input(20300));
  assert.equal(late.snapshot.mildStartMs, 0);
  const contact = preparedLanding();
  contact.advance(mild(20200, { wheelsDown: 1, upY: -1 }));
  assert.equal(contact.snapshot.wheelsStartMs, 0);
  assert.equal(contact.snapshot.mildEndMs, 20200);
  assert.equal(
    contact.snapshot.upsideDownMs,
    19000,
    "partial contact does not sample inversion",
  );
});

test("unsigned duration wrap differs from absolute interval endpoints and zero timestamp sentinel", () => {
  const counter = new NativeCunningStuntCounter({ lastAwardMs: 0xffffc000 });
  counter.advance(wild(0xffffff00));
  assert.equal(counter.advance(wild(0x000000f3)), undefined);
  assert.equal(counter.advance(wild(0x000000f4)).kind, "wild");
  const crossing = preparedLanding({
    mildStartMs: 0xffffff00,
    mildEndMs: 2000,
    upsideDownMs: 0xffffff10,
    wheelsStartMs: 2000,
    lastAwardMs: 0xffffc000,
  });
  assert.equal(
    crossing.advance(input(2501)),
    undefined,
    "absolute unsigned upside-down endpoint comparison rejects the crossing interval",
  );
  assert.equal(crossing.snapshot.mildStartMs, 0);
  const sentinel = new NativeCunningStuntCounter({ lastAwardMs: 0xffffc000 });
  sentinel.advance(wild(0));
  assert.equal(sentinel.snapshot.wildStartMs, 0);
  assert.equal(sentinel.advance(wild(500)), undefined);
  assert.equal(
    sentinel.snapshot.wildStartMs,
    500,
    "zero is a free/start sentinel, so the next qualifying frame restarts duration",
  );
});

test("explicit native cancellation clears five pending globals while retaining award cooldown", () => {
  const counter = new NativeCunningStuntCounter({
    lastAwardMs: 42,
    wildStartMs: 43,
    mildStartMs: 44,
    mildEndMs: 45,
    wheelsStartMs: 46,
    upsideDownMs: 47,
  });
  const snapshot = counter.snapshot;
  snapshot.lastAwardMs = 0;
  counter.cancelPending();
  assert.deepEqual(counter.snapshot, {
    lastAwardMs: 42,
    wildStartMs: 0,
    mildStartMs: 0,
    mildEndMs: 0,
    wheelsStartMs: 0,
    upsideDownMs: 0,
  });
  assert.equal(counter.advance(wild(10042)), undefined);
  assert.equal(counter.snapshot.wildStartMs, 0);
});

test("GENERAL parser reads signed three-skill stunt bonus with bounds checks", () => {
  assert.deepEqual(
    parseCunningStuntBonus(
      "2000,1000,500 // Cunning stunt bonus for each skill level",
    ),
    [2000, 1000, 500],
  );
  assert.deepEqual(
    parseCunningStuntBonus(
      "// Cunning stunt bonus for each skill level\n-1,0,1",
    ),
    [-1, 0, 1],
  );
  for (const data of [
    "",
    "1,2 // Cunning stunt bonus for each skill level",
    "2147483648,1,2 // Cunning stunt bonus for each skill level",
    "1.5,1,2 // Cunning stunt bonus for each skill level",
  ])
    assert.throws(() => parseCunningStuntBonus(data), /GENERAL/);
});

test("read-only Stock/Advanced authored stunt bonuses award raw credits without time", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const store = await createAssetStore();
  for (const root of ["data", "adv_data"]) {
    const table = parseCunningStuntBonus(
      new TextDecoder().decode(await store.read(`${root}/General.txt`)),
    );
    assert.deepEqual(table, [2000, 1000, 500]);
    for (const skill of [0, 1, 2]) {
      const counter = new NativeCunningStuntCounter();
      counter.advance(wild(11000, { creditsBySkill: table, skill }));
      assert.deepEqual(
        counter.advance(wild(11500, { creditsBySkill: table, skill })),
        { kind: "wild", credits: table[skill], fancyIndex: 18, seconds: 0 },
      );
    }
  }
});
