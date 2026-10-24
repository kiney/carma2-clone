import test from "node:test";
import assert from "node:assert/strict";
import { createVehicle } from "../src/legacy-arcade.ts";
import { existsSync, readFileSync } from "node:fs";
import * as THREE from "three";
import { AudioSystem } from "../src/audio.ts";
import {
  parsePowerupPickupSounds,
  raceEventSoundIds,
} from "../src/event-audio.ts";
import { createRace } from "../src/gameplay.ts";
import { PowerupSystem } from "../src/powerups.ts";

function powerupTable(definitions) {
  const lines = [String(definitions.length)];
  for (const definition of definitions) {
    lines.push(
      definition.message ?? "Test pickup",
      "none",
      "-1",
      String(definition.duration ?? -1),
      String(definition.initialValue ?? 0),
      String(definition.action),
      String(definition.floats?.length ?? 0),
      ...(definition.floats ?? []).map(String),
      String(definition.ints?.length ?? 0),
      ...(definition.ints ?? []).map(String),
      "0",
      "0",
      "0",
    );
  }
  return lines.join("\r\n");
}

test("GENERAL pickup sound parser accepts its list and rejects malformed bounds", () => {
  assert.deepEqual(
    parsePowerupPickupSounds(
      "header\n// Powerup connotations\n2 // count\n5401\n5402\n",
    ),
    [5401, 5402],
  );
  assert.deepEqual(
    parsePowerupPickupSounds("// Powerup connotations\n0\n"),
    [],
  );
  assert.throws(
    () => parsePowerupPickupSounds("// other section\n1\n5401"),
    /missing/,
  );
  assert.throws(
    () => parsePowerupPickupSounds("// Powerup connotations\n101\n"),
    /count/,
  );
  assert.throws(
    () => parsePowerupPickupSounds("// Powerup connotations\n2\n5401\n"),
    /ID 2/,
  );
  assert.throws(
    () => parsePowerupPickupSounds("// Powerup connotations\n1\n-1"),
    /ID 1/,
  );
});

test(
  "local GENERAL.TXT pickup sounds parse when original installation exists",
  {
    skip: !existsSync(
      new URL("../carma2_orig/data/general.txt", import.meta.url),
    ),
  },
  () => {
    const text = readFileSync(
      new URL("../carma2_orig/data/general.txt", import.meta.url),
      "utf8",
    );
    assert.deepEqual(parsePowerupPickupSounds(text), [5401]);
  },
);

test("race voice dispatch uses one correct sample per race event", () => {
  const sounds = [];
  const audio = new AudioSystem({});
  audio.context = { state: "running" };
  audio.checkpoint = () => sounds.push(8012);
  audio.playSound = async (id) => sounds.push(id);

  audio.raceEvents(
    [
      { type: "checkpoint", checkpoint: 1, lap: 1 },
      { type: "checkpoint", checkpoint: 2, lap: 2 },
      { type: "lap", lap: 3 },
      { type: "checkpoint", checkpoint: 3, lap: 3 },
      { type: "completed", lap: 3 },
      { type: "failed", lap: 1 },
    ],
    3,
  );

  assert.deepEqual(sounds, [8012, 8014, 8011, 8010]);
  assert.deepEqual(
    raceEventSoundIds(
      [
        { type: "checkpoint", checkpoint: 3, lap: 3 },
        { type: "completed", lap: 3 },
      ],
      3,
    ),
    [8011],
    "finishing a race does not stack the checkpoint and completion voices",
  );
});

test("pickup audio uses configured connotations, mine sound, and remains silent while locked", async () => {
  const audio = new AudioSystem({});
  const played = [];
  audio.context = { state: "running" };
  audio.playOneShot = async (...args) => played.push(args);
  audio.configurePowerups("// Powerup connotations\n1\n5401\n");

  audio.powerupPickup(0, () => 0);
  audio.powerupPickup(0, () => 1 - Number.EPSILON);
  audio.powerupPickup(14, () => {
    throw new Error("mine pickup does not sample a connotation");
  });
  assert.equal(played[0][0], 5401);
  assert.equal(played[0][1], 1);
  assert.equal(played[0][2], 0.875);
  assert.equal(played[1][0], 5401);
  assert.equal(played[1][2], 1.125);
  assert.deepEqual(played[2], [5400, 1, 1]);

  const locked = new AudioSystem({});
  locked.configurePowerups("// Powerup connotations\n1\n5401\n");
  let lockedOutput = 0;
  locked.playOneShot = async () => lockedOutput++;
  locked.powerupPickup(0);
  locked.powerupPickup(14);
  await Promise.resolve();
  assert.equal(lockedOutput, 0);
});

test("PowerupSystem emits pickup callback once for world collection only", async () => {
  const root = new THREE.Group();
  const timedActor = new THREE.Group();
  timedActor.name = "&£000001";
  timedActor.position.x = 1;
  root.add(timedActor);
  const abilityActor = new THREE.Group();
  abilityActor.name = "&£010001";
  abilityActor.position.x = 100;
  root.add(abilityActor);

  const system = await new PowerupSystem(
    {
      text: async () =>
        powerupTable([
          { action: 9, duration: 1, floats: [2, 1, 1, 1, 0, 0, 1] },
          { action: 35, initialValue: -2, message: "Mine ability" },
        ]),
    },
    root,
  ).init();
  const picked = [];
  system.onPickup = (definition) => picked.push(definition.index);
  const car = createVehicle(new THREE.Vector3(0, 0, 0));
  const race = createRace([], { timeLimit: 60 });

  system.update(0, car, race);
  car.position.x = 2;
  system.update(0.1, car, race);
  assert.deepEqual(picked, [0]);
  assert.equal(timedActor.visible, false);

  system.grant(1, car, race);
  assert.equal(system.activateAbility(race), true);
  system.update(1.1, car, race);
  assert.deepEqual(
    picked,
    [0],
    "grant, ability use, and timed expiry do not emit pickup audio",
  );

  car.position.x = 100;
  system.update(0, car, race);
  assert.deepEqual(picked, [0, 1]);
  system.update(0, car, race);
  assert.deepEqual(picked, [0, 1], "a collected world actor emits only once");
});
