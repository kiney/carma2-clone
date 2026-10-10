import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseRaceCatalog } from "../src/config.ts";
import { MissionVariables } from "../src/mission-variables.ts";

test("mission variables use signed byte arithmetic, toggle semantics, and safe bounds", () => {
  const vars = new MissionVariables();
  vars.add(0, 127);
  vars.add(0, 1);
  assert.equal(vars.get(0), -128, "signed byte addition wraps at 127");
  vars.add(0, -1);
  assert.equal(vars.get(0), 127);

  vars.toggle(0);
  assert.equal(vars.get(0), 0);
  vars.toggle(0);
  assert.equal(vars.get(0), 1);
  vars.toggle(0);
  assert.equal(vars.get(0), 0);

  vars.add(999, 4);
  assert.equal(vars.get(999), 4);
  vars.add(1000, 9);
  vars.add(-1, 9);
  assert.equal(vars.get(1000), 0);
  assert.equal(vars.get(-1), 0);
  assert.equal(vars.get(1.5), 0);
  vars.toggle(1000);
  vars.toggle(-1);
  vars.clear();
  assert.equal(vars.get(999), 0);
  assert.throws(() => vars.add(0, Infinity), /Invalid mission variable delta/);
});

test("mission variable text pairs cast addresses to u16 and deltas to i16", () => {
  const vars = new MissionVariables();
  vars.apply([
    [65536, 32767],
    [0, 1],
    [1, 65535],
    [2, 32768],
  ]);
  assert.equal(
    vars.get(0),
    0,
    "65536 address wraps to zero and byte arithmetic wraps",
  );
  assert.equal(vars.get(1), -1, "u16 delta representation becomes signed i16");
  assert.equal(vars.get(2), 0, "i16 minimum narrows to signed byte");

  vars.apply([[3, 9999]]);
  assert.equal(vars.get(3), 1, "native 9999 marker toggles zero to one");
  vars.apply([[3, 9999]]);
  assert.equal(vars.get(3), 0, "native 9999 marker toggles nonzero to zero");
  vars.apply([
    [-1, 1],
    [1000, 1],
  ]);
  assert.equal(vars.get(-1), 0);
  assert.equal(vars.get(1000), 0);
  assert.throws(
    () => vars.apply([[0.5, 1]]),
    /Invalid mission variable change/,
  );
  assert.throws(
    () => vars.apply([[0, NaN]]),
    /Invalid mission variable change/,
  );
});

test("installed stock and Advanced catalogs retain smash variables, targets, and pedestrian groups", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const assets = await createAssetStore();
  const readCatalog = async (path) => {
    const bytes = await assets.read(path);
    assert.ok(bytes, `catalog exists: ${path}`);
    return parseRaceCatalog(decodeText(bytes));
  };
  const stock = await readCatalog("data/RACES.TXT");
  const eye = stock.races.find(
    (race) => race.name === "MISSION: EYE OF THE BEAVER",
  );
  assert.ok(eye);
  assert.equal(eye.raceType, "smash");
  assert.equal(eye.smashVariable, 1);
  assert.equal(eye.smashTarget, 11);
  assert.deepEqual(eye.pedGroupsToKill, []);

  const hardCore = stock.races.find(
    (race) => race.name === "MISSION: HARD CORE",
  );
  assert.ok(hardCore);
  assert.equal(hardCore.raceType, "smashAndPed");
  assert.equal(hardCore.smashVariable, 1);
  assert.equal(hardCore.smashTarget, 19);
  assert.deepEqual(hardCore.pedGroupsToKill, [56]);

  const advanced = await readCatalog("adv_data/Races.txt");
  const carpo = advanced.races.find(
    (race) => race.name === "MISSION: CARPOCALYPSE AGAIN",
  );
  assert.ok(carpo);
  assert.equal(carpo.raceType, "smash");
  assert.equal(carpo.smashVariable, 1);
  assert.equal(carpo.smashTarget, 15);
  assert.deepEqual(carpo.pedGroupsToKill, []);
});
