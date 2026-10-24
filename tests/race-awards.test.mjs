import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseDamagePrograms } from "../src/damage-program.ts";
import { consumeNativeEarnCredits } from "../src/ped-awards.ts";
import { nativeCrashDamageAward } from "../src/physics/crash-components.ts";
import {
  parsePedAwards,
  parseRaceAwards,
  parseCrashDamageAwards,
  PedAwardCounter,
  wastedCarCredits,
} from "../src/race-awards.ts";

const labeledGeneral = `
2000,500,50 // Credits awarded for checkpoints for each skill level (with peds)
// Credits per second of time bonus
15,10,5
// Time awarded for wasting car for each skill level (with peds)
120,90,60
3000,2000,1000 // Credits awarded for wasting car for each skill level (with peds)
60,30,15 // Time awarded for rolling car for each skill level (with peds)
1000,1000,1000 // Credits awarded for rolling car for each skill level (with peds)
`;

test("GENERAL race awards parse inline and preceding labels into skill triplets", () => {
  assert.deepEqual(parseRaceAwards(labeledGeneral), {
    checkpointCredits: [2000, 500, 50],
    timeBonusCredits: [15, 10, 5],
    wastingTime: [120, 90, 60],
    wastingCredits: [3000, 2000, 1000],
    rollingTime: [60, 30, 15],
    rollingCredits: [1000, 1000, 1000],
  });
});

test("race award parser rejects missing, malformed, negative, and truncated records", () => {
  assert.throws(() => parseRaceAwards(""), /missing race award/);
  assert.throws(
    () =>
      parseRaceAwards(labeledGeneral.replace("2000,500,50", "2000,nope,50")),
    /invalid race award/,
  );
  assert.throws(
    () => parseRaceAwards(labeledGeneral.replace("2000,500,50", "2000,-1,50")),
    /invalid race award/,
  );
  assert.throws(
    () => parseRaceAwards(labeledGeneral.replace("15,10,5", "15,10")),
    /invalid race award/,
  );
  const truncated = labeledGeneral.replace(
    "1000,1000,1000 // Credits awarded for rolling car for each skill level (with peds)",
    "// Credits awarded for rolling car for each skill level (with peds)",
  );
  assert.throws(() => parseRaceAwards(truncated), /truncated race awards/);
});

test("installed stock and Advanced GENERAL tables retain source reward triplets", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const assets = await createAssetStore();
  const expected = {
    checkpointCredits: [2000, 500, 50],
    timeBonusCredits: [15, 10, 5],
    wastingTime: [120, 90, 60],
    wastingCredits: [3000, 2000, 1000],
    rollingTime: [60, 30, 15],
    rollingCredits: [1000, 1000, 1000],
  };
  for (const path of ["data/GENERAL.TXT", "adv_data/GENERAL.TXT"]) {
    const bytes = await assets.read(path);
    assert.ok(bytes, `installed GENERAL exists: ${path}`);
    assert.deepEqual(parseRaceAwards(decodeText(bytes)), expected, path);
    assert.deepEqual(
      parseCrashDamageAwards(decodeText(bytes)),
      {
        creditsPerDamage: [15, 13, 11],
        secondsPerDamage: [1, 0.75, 0.5],
      },
      path,
    );
  }
});

test("damage award tables accept fractional authored rates and reject malformed input", () => {
  const text =
    "// Seconds per unit car damage for each skill level\n1,.75,.5\n15,13,11 // Credits per unit car damage for each skill level";
  assert.deepEqual(parseCrashDamageAwards(text), {
    creditsPerDamage: [15, 13, 11],
    secondsPerDamage: [1, 0.75, 0.5],
  });
  assert.throws(() => parseCrashDamageAwards(""), /missing damage award/);
  for (const rates of ["1,2", "1,nope,3", "-1,2,3", "1e100,2,3"])
    assert.throws(
      () => parseCrashDamageAwards(text.replace("1,.75,.5", rates)),
      /invalid damage award/,
    );
});

test("ped award counter includes the 1000ms boundary, caps combo, and resets after a gap", () => {
  const awards = { points: [300, 200, 150], time: [15, 10, 5] };
  const counter = new PedAwardCounter();
  assert.deepEqual(counter.score(1000, awards, 0), {
    credits: 300,
    seconds: 15,
    combo: 1,
  });
  assert.deepEqual(counter.score(2000, awards, 0), {
    credits: 600,
    seconds: 15,
    combo: 2,
  });
  assert.deepEqual(counter.score(3001, awards, 0), {
    credits: 300,
    seconds: 15,
    combo: 1,
  });
  for (let combo = 2; combo <= 10; combo++) {
    const result = counter.score(3001 + (combo - 1) * 1000, awards, 1);
    assert.equal(result.combo, combo);
    assert.equal(result.seconds, 10, "time award does not multiply with combo");
  }
  assert.deepEqual(counter.score(13_001, awards, 1), {
    credits: 2000,
    seconds: 10,
    combo: 10,
  });
});

test("pedestrian score timestamps use unsigned 32-bit elapsed time across rollover", () => {
  const counter = new PedAwardCounter();
  const awards = { points: [300, 200, 150], time: [15, 10, 5] };
  counter.score(0xfffffff0, awards, 0);
  const result = counter.score(984, awards, 0);
  assert.deepEqual(result, { credits: 600, seconds: 15, combo: 2 });
});

test("wasted-car credits scale by squared softness and round to the nearest hundred", () => {
  assert.equal(wastedCarCredits(3000, 0.7), 3000);
  assert.equal(wastedCarCredits(3000, 1.4), 800);
  assert.equal(wastedCarCredits(3000, 0.35), 12000);
  for (const [base, softness] of [
    [-1, 0.7],
    [3000, 0],
    [3000, -0.7],
    [NaN, 0.7],
    [3000, Infinity],
  ])
    assert.throws(
      () => wastedCarCredits(base, softness),
      /Invalid wasted car award inputs/,
    );
});

test("native waste rounding first stores softness, retaining double ratio and square", () => {
  // Source440e99..ec9: DWORD softness, QWORD ratio/square and .01.
  // Each pair supplies different JS values that store as the same native field.
  for (const [softness, stored, expected] of [
    [1.8073922282301278, 1.8073922395706177, [400, 300, 100]],
    [1.1832159566199232, 1.1832159757614136, [1000, 700, 300]],
    [0.9438798074485389, 0.9438797831535339, [1700, 1100, 600]],
    [0.8082903768654761, 0.8082903623580933, [2300, 1500, 800]],
    [0.7181848464596079, 0.7181848287582397, [2900, 1900, 1000]],
  ]) {
    assert.equal(Math.fround(softness), stored);
    for (const skill of [0, 1, 2]) {
      const base = [3000, 2000, 1000][skill];
      assert.equal(wastedCarCredits(base, softness), expected[skill]);
      assert.equal(wastedCarCredits(base, stored), expected[skill]);
    }
  }
});

test("native waste conversion returns the signed low DWORD before wrapping multiplication by100", () => {
  for (const [softness, expected] of [
    [0.001, [1469999900, 979999900, 490000000]],
    [0.0001, [971119336, -784242808, 1755362244]],
    [1e-8, [1346534912, -1965621056, -982810528]],
    [1e-12, [0, 0, 0]],
    [2 ** -149, [0, 0, 0]],
  ])
    for (const skill of [0, 1, 2])
      assert.equal(
        wastedCarCredits([3000, 2000, 1000][skill], softness),
        expected[skill],
      );
  assert.equal(wastedCarCredits(0x7fffffff, 0.7), -2147483596);
  assert.equal(
    wastedCarCredits(3000, 1e-100),
    0,
    "softness underflow uses native invalid-integer low zero",
  );
  assert.equal(
    wastedCarCredits(3000, 1e100),
    0,
    "softness overflow leaves a zero ratio",
  );
});

test("native damage credits use Float32 .01 while fixed time uses double .2 across all skills", () => {
  // Installed441033..44109d: native .01 is below double .01. Exact
  // hundreds after adding50 therefore truncate to the preceding hundred.
  for (const [rate, secondsRate, delta, multiplier, rawCredits, seconds] of [
    [15, 1, 10, 1, 100, 10],
    [15, 1, 11, 1, 200, 10],
    [15, 1, 5, 2, 100, 5],
    [15, 1, 6, 2, 200, 5],
    [13, 0.75, 50, 1, 600, 40],
    [13, 0.75, 51, 1, 700, 40],
    [13, 0.75, 25, 2, 600, 20],
    [13, 0.75, 26, 2, 700, 20],
    [11, 0.5, 50, 1, 500, 25],
    [11, 0.5, 51, 1, 600, 25],
    [11, 0.5, 25, 2, 500, 15],
    [11, 0.5, 26, 2, 600, 15],
    [15, 1, 2, 4, 100, 0],
    [15, 1, 3, 4, 200, 5],
    [13, 0.75, 9, 8, 900, 5],
    [13, 0.75, 10, 8, 1000, 10],
    [11, 0.5, 4, 8, 400, 0],
    [11, 0.5, 5, 8, 400, 5],
  ])
    assert.deepEqual(
      nativeCrashDamageAward(delta, 0.7, multiplier, rate, secondsRate),
      { rawCredits, credits: rawCredits, seconds },
      `${rate}/${secondsRate}, delta${delta}, multiplier${multiplier}`,
    );
});

test("every installed car softness retains three-skill waste rewards and shared earned multipliers", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const assets = await createAssetStore();
  const expected = new Map([
    [0.05, [588000, 392000, 196000]],
    [0.1, [147000, 98000, 49000]],
    [0.125, [94100, 62700, 31400]],
    [0.13, [87000, 58000, 29000]],
    [0.2, [36700, 24500, 12200]],
    [0.25, [23500, 15700, 7800]],
    [0.3, [16300, 10900, 5400]],
    [0.35, [12000, 8000, 4000]],
    [0.4, [9200, 6100, 3100]],
    [0.46, [6900, 4600, 2300]],
    [0.5, [5900, 3900, 2000]],
    [0.6, [4100, 2700, 1400]],
    [0.7, [3000, 2000, 1000]],
    [0.8, [2300, 1500, 800]],
    [0.999, [1500, 1000, 500]],
    [1, [1500, 1000, 500]],
    [1.4, [800, 500, 300]],
    [1.5, [700, 400, 200]],
  ]);
  for (const root of ["data", "adv_data"]) {
    const awards = parseRaceAwards(
      decodeText(await assets.read(`${root}/GENERAL.TXT`)),
    );
    let checked = 0;
    for (const { path } of assets.manifest) {
      if (
        !path.toLowerCase().startsWith(`${root}/cars/`) ||
        !/^\w+\/cars\/[^/]+\/[^/]+\.txt$/i.test(path)
      )
        continue;
      const text = decodeText(await assets.read(path));
      // Car directories also contain README, dashboard and auxiliary TXT files.
      if (!/^START OF DRIVABLE STUFF\s*(?:\/\/.*)?$/im.test(text)) continue;
      const { softness } = parseDamagePrograms(text);
      const rewards = expected.get(softness);
      assert.ok(rewards, `known installed softness ${softness}: ${path}`);
      for (const skill of [0, 1, 2]) {
        const credits = wastedCarCredits(
          awards.wastingCredits[skill],
          softness,
        );
        assert.equal(credits, rewards[skill], `${path}, skill${skill}`);
        for (const multiplier of [0, 3]) {
          const earned = consumeNativeEarnCredits({
            amount: credits,
            creditMultiplier: multiplier,
            currentCredits: 100,
            raceFinished: false,
          });
          const amount = rewards[skill] * (multiplier || 1);
          assert.deepEqual(earned, {
            accepted: true,
            amount,
            credits: 100 + amount,
          });
        }
      }
      checked++;
    }
    assert.ok(checked > 0, `installed drivable car headers: ${root}`);
    t.diagnostic(`${root}: ${checked} car headers × three skills`);
  }
});

test("installed stock and Advanced pedestrian settings retain their award triplets", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const assets = await createAssetStore();
  const expected = {
    "data/PEDS/settings.txt": {
      points: [300, 200, 150],
      time: [15, 10, 5],
    },
    "adv_data/PEDS/settings.txt": {
      points: [300, 200, 150],
      time: [10, 8, 5],
    },
  };
  for (const [path, awards] of Object.entries(expected)) {
    const bytes = await assets.read(path);
    assert.ok(bytes, `installed pedestrian settings exist: ${path}`);
    assert.deepEqual(parsePedAwards(decodeText(bytes)), awards, path);
  }
});
