import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseOpponents, parseRaceCatalog } from "../src/config.ts";
import {
  resolveOpponentRequests,
  selectOpponentIds,
} from "../src/opponent-selection.ts";

const opponents = (strengths) =>
  strengths.map((strengthRating, id) => ({ id, strengthRating }));

test("explicit opponent IDs preserve duplicates and player identity while random slots exclude them", () => {
  const roster = opponents([1, 2, 3, 4, 5, 1]);
  const selected = selectOpponentIds([4, 4, 2, -1, -1], roster, 2, () => 0.99);
  assert.deepEqual(selected, [4, 4, 2, 5, 0]);
});

test("random opponent choice is deterministic among eligible IDs", () => {
  const roster = opponents([1, 1, 1, 2, 2]);
  const draws = [];
  const selected = selectOpponentIds([-1, -2], roster, 1, () => {
    draws.push(0.5);
    return 0.5;
  });
  assert.deepEqual(selected, [2, 4]);
  assert.equal(draws.length, 2);
});

test("requested strengths escalate through five and then fall back to any eligible tier", () => {
  const strengthFive = selectOpponentIds([-1], opponents([5]), 99, () => 0);
  assert.deepEqual(strengthFive, [0], "strength 1 request reaches tier 5");
  const anyTier = selectOpponentIds([-5], opponents([1]), 99, () => 0);
  assert.deepEqual(
    anyTier,
    [0],
    "strength 5 request then falls back to any tier",
  );
});

test("unavailable random opponents throw instead of silently reducing the request", () => {
  assert.throws(
    () => selectOpponentIds([-1], opponents([1]), 0, () => 0),
    /No eligible opponent/,
  );
  assert.throws(
    () => selectOpponentIds([-1, -1], opponents([1]), 0, () => 0),
    /No eligible opponent/,
  );
});

test("installed stock and Advanced catalogs preserve defaults and authored opponent requests", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const assets = await createAssetStore();
  const read = async (path) => {
    const bytes = await assets.read(path);
    assert.ok(bytes, `installed data exists: ${path}`);
    return decodeText(bytes);
  };
  const stock = parseRaceCatalog(await read("data/RACES.TXT"));
  const adv = parseRaceCatalog(await read("adv_data/Races.txt"));
  const rosterText = await read("data/OPPONENT.TXT");
  const roster = parseOpponents(rosterText);

  assert.equal(stock.firstRaceDefaults.numberOfOpponents, 5);
  assert.equal(stock.lastRaceDefaults.numberOfOpponents, 11);
  assert.equal(stock.races.length, 40);
  assert.equal(adv.firstRaceDefaults.numberOfOpponents, 10);
  assert.equal(adv.lastRaceDefaults.numberOfOpponents, 13);

  const raceIndex = (catalog, name) =>
    catalog.races.findIndex((race) => race.name === name);
  const niceIndex = raceIndex(stock, "NICE BEAVER");
  assert.deepEqual(
    resolveOpponentRequests(stock, niceIndex),
    [-1, -1, -1, -2, -3],
  );
  const boulderIndex = raceIndex(stock, "MISSION: BOULDER DASH");
  assert.deepEqual(resolveOpponentRequests(stock, boulderIndex), []);
  const truckingIndex = raceIndex(stock, "MISSION: TRUCKING HELL");
  assert.deepEqual(resolveOpponentRequests(stock, truckingIndex), [38]);
  const bruiseIndex = raceIndex(stock, "THE BRUISE BROTHERS");
  assert.deepEqual(
    resolveOpponentRequests(stock, bruiseIndex),
    Array(12).fill(51),
  );
  assert.deepEqual(
    selectOpponentIds(resolveOpponentRequests(stock, bruiseIndex), roster, 51),
    Array(12).fill(51),
    "explicit duplicates and player identity remain authored",
  );

  const advancedDefaultRace = adv.races.findIndex(
    (race) => race.numberOfOpponents === -1,
  );
  assert.ok(advancedDefaultRace >= 0);
  assert.equal(
    resolveOpponentRequests(adv, advancedDefaultRace).length,
    10,
    "first Advanced default request uses its 10-opponent setting",
  );
});
