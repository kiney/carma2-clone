import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import * as THREE from "three";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parsePowerupExclusions, parseRaceCatalog } from "../src/config.ts";
import {
  awardRaceTime,
  createRace,
  createVehicle,
  updateRace,
} from "../src/gameplay.ts";
import { PowerupSystem } from "../src/powerups.ts";

function table(definitions) {
  const lines = [String(definitions.length)];
  for (const d of definitions) {
    lines.push(
      d.message ?? "Test effect",
      "none",
      "-1",
      String(d.duration ?? -1),
      String(d.initialValue ?? 0),
      String(d.action),
      String(d.floats?.length ?? 0),
      ...(d.floats ?? []).map(String),
      String(d.ints?.length ?? 0),
      ...(d.ints ?? []).map(String),
      "0",
      "0",
      "0",
    );
  }
  return lines.join("\r\n");
}

test("powerup exclusions accept native delimiters, stop at negative sentinel, and enforce bounds", () => {
  assert.deepEqual(
    parsePowerupExclusions(" 0/2, 4\t6 / -1, 99 "),
    [0, 2, 4, 6],
  );
  assert.deepEqual(parsePowerupExclusions(""), []);
  assert.deepEqual(
    parsePowerupExclusions(Array(50).fill("7").join("/")),
    Array(50).fill(7),
  );
  assert.throws(
    () => parsePowerupExclusions(Array(51).fill("7").join("/")),
    /too many powerup exclusions/,
  );
  for (const invalid of ["1.5", "NaN", "9007199254740992", "word"]) {
    assert.throws(
      () => parsePowerupExclusions(invalid),
      /invalid powerup exclusion/,
    );
  }
});

test("disabled race time awards preserve credits and checkpoint progress", () => {
  const gate = {
    points: [
      new THREE.Vector3(-2, 0, 0),
      new THREE.Vector3(-2, 2, 0),
      new THREE.Vector3(2, 2, 0),
      new THREE.Vector3(2, 0, 0),
    ],
  };
  const race = createRace([gate], {
    disableTimeAwards: true,
    timeLimit: 60,
    credits: 10,
    checkpointBonusSeconds: 15,
    checkpointCredits: 40,
  });
  assert.equal(awardRaceTime(race, 30), false);
  assert.equal(race.timeLeft, 60);
  assert.equal(awardRaceTime(race, NaN), false);
  assert.equal(awardRaceTime(race, Infinity), false);
  assert.equal(awardRaceTime(race, 2), false);
  const events = updateRace(
    race,
    new THREE.Vector3(0, 1, 5),
    new THREE.Vector3(0, 1, -5),
    1,
  );
  assert.ok(events.some((event) => event.type === "checkpoint"));
  assert.equal(race.nextCheckpoint, 0);
  assert.equal(race.lap, 2);
  assert.equal(race.credits, 50);
  assert.ok(Math.abs(race.timeLeft - 59) < 1e-9);
});

test("excluded pickup keeps its authored actor and pickup identity but applies definition zero", async () => {
  const root = new THREE.Group();
  const actor = new THREE.Group();
  actor.name = "&£01fixture";
  root.add(actor);
  const system = await new PowerupSystem(
    {
      text: async () =>
        table([
          { action: 0, message: "Fallback credit", ints: [100, 100] },
          { action: 34, message: "Excluded charged ability", initialValue: -4 },
        ]),
    },
    root,
    () => 0,
    [1],
  ).init();
  assert.equal(actor.visible, true);
  const collected = [];
  system.onPickup = (definition) => collected.push(definition.index);
  const events = [];
  const race = createRace([], { credits: 0 });
  system.update(0, createVehicle(new THREE.Vector3()), race, (event) =>
    events.push(event),
  );
  assert.deepEqual(
    collected,
    [1],
    "pickup callback retains authored definition index",
  );
  assert.equal(actor.visible, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "credits");
  assert.equal(events[0].definition.index, 0);
  assert.equal(race.credits, 100);
  assert.equal(
    system.abilities.size,
    0,
    "excluded charged ability does not enter inventory",
  );
  system.dispose();
});

test("no-time races emit zero for time pickups while normal races receive the award", async () => {
  const makeSystem = () => {
    const root = new THREE.Group();
    const actor = new THREE.Group();
    actor.name = "&£00fixture";
    root.add(actor);
    return new PowerupSystem(
      {
        text: async () =>
          table([{ action: 11, message: "Time", ints: [12, 12] }]),
      },
      root,
      () => 0,
    ).init();
  };
  const car = createVehicle(new THREE.Vector3());
  const disabled = await makeSystem();
  const disabledRace = createRace([], {
    timeLimit: 60,
    disableTimeAwards: true,
  });
  const disabledEvents = [];
  disabled.update(0, car, disabledRace, (event) => disabledEvents.push(event));
  assert.equal(disabledRace.timeLeft, 60);
  assert.equal(disabledEvents[0].kind, "time");
  assert.equal(disabledEvents[0].amount, 0);
  disabled.dispose();

  const normal = await makeSystem();
  const normalRace = createRace([], { timeLimit: 60 });
  const normalEvents = [];
  normal.update(0, car, normalRace, (event) => normalEvents.push(event));
  assert.equal(normalRace.timeLeft, 72);
  assert.equal(normalEvents[0].kind, "time");
  assert.equal(normalEvents[0].amount, 12);
  normal.dispose();
  assert.equal(awardRaceTime(normalRace, NaN), false);
  assert.equal(awardRaceTime(normalRace, -Infinity), false);
  assert.equal(awardRaceTime(normalRace, 3), true);
  assert.equal(normalRace.timeLeft, 75);
});

test("excluded grants substitute definition zero exactly once, including excluded zero", async () => {
  const definitions = [
    { action: 9, message: "Fallback effect", floats: [2, 1, 1, 1, 0, 0, 1] },
    { action: 0, message: "Excluded credit", ints: [100, 100] },
  ];
  const system = await new PowerupSystem(
    { text: async () => table(definitions) },
    new THREE.Group(),
    () => 0,
    [0, 1],
  ).init();
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([], { credits: 5 });
  const events = [];
  assert.equal(
    system.grant(1, car, race, (event) => events.push(event)),
    true,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "engine");
  assert.equal(events[0].definition.index, 0);
  assert.equal(race.credits, 5);
  events.length = 0;
  assert.equal(
    system.grant(0, car, race, (event) => events.push(event)),
    true,
  );
  assert.equal(
    events.length,
    1,
    "zero is applied once rather than recursively substituted",
  );
  assert.equal(events[0].definition.index, 0);
  system.dispose();
});

test("random action 4 preserves duplicate weights and substitutes excluded draws without reroll", async () => {
  const makeRoot = () => {
    const root = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const actor = new THREE.Group();
      actor.name = `&£${String(i).padStart(2, "0")}fixture`;
      actor.position.x = i === 3 ? 0 : 100 + i * 10;
      root.add(actor);
    }
    return root;
  };
  const definitions = [
    { action: 0, message: "Fallback credit", ints: [100, 100] },
    { action: 0, message: "Excluded credit", ints: [200, 200] },
    { action: 11, message: "Time", ints: [5, 5] },
    { action: 4, ints: [1, 1, 2] },
  ];
  let draws = 0;
  const system = await new PowerupSystem(
    { text: async () => table(definitions) },
    makeRoot(),
    () => {
      draws++;
      return 0.5;
    },
    [1],
  ).init();
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([], { credits: 7, timeLimit: 60 });
  const events = [];
  system.update(0, car, race, (event) => events.push(event));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "credits");
  assert.equal(events[0].definition.index, 0);
  assert.equal(race.credits, 107);
  assert.equal(
    draws,
    2,
    "only the selected fallback's credit range draws again",
  );
  system.dispose();

  const excludedChoice = await new PowerupSystem(
    { text: async () => table(definitions) },
    makeRoot(),
    () => 0.99,
    [2],
  ).init();
  const fallbackEvents = [];
  const fallbackRace = createRace([], { credits: 7, timeLimit: 60 });
  excludedChoice.update(0, car, fallbackRace, (event) =>
    fallbackEvents.push(event),
  );
  assert.equal(fallbackEvents.length, 1);
  assert.equal(fallbackEvents[0].kind, "credits");
  assert.equal(fallbackEvents[0].definition.index, 0);
  assert.equal(fallbackRace.credits, 107);
  excludedChoice.dispose();
});

test("installed stock and Advanced race catalogs expose exclusion and no-time flags", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const store = await createAssetStore();
  const catalogs = new Map();
  for (const [path, label] of [
    ["data/RACES.TXT", "stock"],
    ["adv_data/Races.txt", "Advanced"],
  ]) {
    const bytes = await store.read(path);
    assert.ok(bytes, `installed ${label} catalog exists`);
    const catalog = parseRaceCatalog(decodeText(bytes));
    assert.ok(catalog.races.length > 0, `${label} races parsed`);
    assert.ok(
      catalog.races.every((race) => Array.isArray(race.powerupExclusions)),
      `${label} exclusions parsed for each race`,
    );
    assert.ok(
      catalog.races.every(
        (race) => typeof race.disableTimeAwards === "boolean",
      ),
      `${label} no-time flags parsed for each race`,
    );
    catalogs.set(label, catalog);
  }
  const stock = catalogs.get("stock").races;
  assert.deepEqual(
    stock.find((race) => race.name === "NICE BEAVER").powerupExclusions,
    [],
  );
  const boulder = stock.find((race) => race.name === "MISSION: BOULDER DASH");
  assert.ok(boulder);
  assert.equal(boulder.disableTimeAwards, true);
  assert.ok(boulder.powerupExclusions.includes(5));
  const advancedSpecial = catalogs
    .get("Advanced")
    .races.find((race) => race.name === "SPECIAL: START YOUR ENGINES!!");
  assert.ok(advancedSpecial);
  assert.deepEqual(
    advancedSpecial.powerupExclusions,
    [69, 70, 71, 72, 73, 74, 75, 76, 77, 82, 83, 84, 85, 86, 88, 89],
  );
  assert.equal(advancedSpecial.disableTimeAwards, false);
});
