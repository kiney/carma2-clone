import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import {
  parsePedAwards,
  parseRaceAwards,
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
  }
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
