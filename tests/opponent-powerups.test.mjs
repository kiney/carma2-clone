import test from "node:test";
import assert from "node:assert/strict";
import { createVehicle } from "../src/legacy-arcade.ts";
import { access } from "node:fs/promises";
import { Group, Vector3 } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { createRace } from "../src/gameplay.ts";
import { decodeText } from "../src/formats.ts";
import {
  isPowerupImplemented,
  parsePowerups,
  PowerupSystem,
} from "../src/powerups.ts";

function table(definitions) {
  const lines = [String(definitions.length)];
  for (const definition of definitions) {
    lines.push(
      definition.message ?? "Test effect",
      "none",
      "-1",
      String(definition.duration),
      "0",
      String(definition.action),
      String(definition.floats.length),
      ...definition.floats.map(String),
      "0",
      String(definition.group ?? 0),
      "0",
      "0",
    );
  }
  return lines.join("\n");
}

async function systemFor(definitions) {
  return new PowerupSystem(
    { text: async () => table(definitions) },
    new Group(),
  ).init();
}

const definitions = [
  {
    action: 14,
    duration: 4,
    floats: [0],
    group: 64,
    message: "Frozen opponents",
  },
  { action: 15, duration: 3, floats: [2], group: 128, message: "Turbo cops" },
  {
    action: 14,
    duration: 10,
    floats: [2],
    group: 64,
    message: "Turbo opponents",
  },
  { action: 51, duration: -1, floats: [], message: "Cancel" },
];

test("opponent and cop speed factors start at one and are independently timed", async () => {
  const system = await systemFor(definitions);
  const car = createVehicle(new Vector3());
  const race = createRace([]);
  assert.deepEqual(
    [
      system.update(0, car, race).opponentSpeedFactor,
      system.update(0, car, race).copSpeedFactor,
    ],
    [1, 1],
  );

  const events = [];
  system.grant(0, car, race, (event) => events.push(event));
  assert.deepEqual(
    [
      system.update(0, car, race).opponentSpeedFactor,
      system.update(0, car, race).copSpeedFactor,
    ],
    [0, 1],
  );
  system.grant(1, car, race, (event) => events.push(event));
  const active = system.update(0, car, race);
  assert.deepEqual([active.opponentSpeedFactor, active.copSpeedFactor], [0, 2]);
  assert.deepEqual(
    events.map((event) => [event.kind, event.amount]),
    [
      ["effect", 0],
      ["effect", 2],
    ],
  );

  const afterExpiry = system.update(3, car, race);
  assert.deepEqual(
    [afterExpiry.opponentSpeedFactor, afterExpiry.copSpeedFactor],
    [0, 1],
    "expiry of the cop effect leaves the opponent factor unchanged",
  );
});

test("authored opponent group replacement resets before assignment and removes the old timeout", async () => {
  const system = await systemFor(definitions);
  const car = createVehicle(new Vector3());
  const race = createRace([]);
  system.grant(0, car, race);
  system.update(3, car, race);
  const beforeReplacement = system.opponentSpeedState.revision;
  system.grant(2, car, race, () => {
    assert.equal(
      system.opponentSpeedState.revision,
      beforeReplacement + 2,
      "the old reset and new setter both execute before notification",
    );
    assert.equal(
      system.update(0, car, race).opponentSpeedFactor,
      2,
      "the new assignment follows the conflicting definition's reset",
    );
  });
  assert.equal(system.update(2, car, race).opponentSpeedFactor, 2);
  assert.equal(
    system.update(7.9, car, race).opponentSpeedFactor,
    2,
    "the removed four-second timer cannot clear the replacement ten-second effect",
  );
  assert.equal(system.update(0.1, car, race).opponentSpeedFactor, 1);

  system.grant(0, car, race);
  system.grant(1, car, race);
  system.grant(3, car, race);
  const cancelled = system.update(0, car, race);
  assert.deepEqual(
    [cancelled.opponentSpeedFactor, cancelled.copSpeedFactor],
    [1, 1],
  );
});

test("actions 14 and 15 require their authored float parameter and are supported", async () => {
  const system = await systemFor([
    { action: 14, duration: 1, floats: [] },
    { action: 15, duration: 1, floats: [Number.MAX_VALUE] },
  ]);
  const car = createVehicle(new Vector3());
  const race = createRace([]);
  assert.equal(isPowerupImplemented(system.definitions[0]), true);
  assert.equal(isPowerupImplemented(system.definitions[1]), true);
  assert.throws(() => system.grant(0, car, race), /parameter/);
  assert.throws(() => system.grant(1, car, race), /parameter/);
});

test("installed Stock and Advanced powerups define freeze and turbo entries", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const store = await createAssetStore();
  for (const path of ["data/powerup.txt", "adv_data/Powerup.txt"]) {
    const bytes = await store.read(path);
    assert.ok(bytes, `installed powerup table exists: ${path}`);
    const powerups = parsePowerups(decodeText(bytes));
    assert.deepEqual(
      powerups
        .slice(15, 19)
        .map((definition) => [
          definition.action,
          definition.duration,
          definition.floatParams,
          definition.groupInclusion,
        ]),
      [
        [14, 30, [0], 64],
        [15, 30, [0], 128],
        [14, 30, [2], 64],
        [15, 30, [2], 128],
      ],
      path,
    );
  }
});
