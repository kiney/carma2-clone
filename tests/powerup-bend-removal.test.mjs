import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { createRace } from "../src/gameplay.ts";
import { createVehicle } from "../src/legacy-arcade.ts";
import { PowerupSystem, parsePowerups } from "../src/powerups.ts";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";

function table(definitions) {
  return [
    definitions.length,
    ...definitions.flatMap((definition) => [
      definition.name,
      "none",
      -1,
      definition.duration,
      definition.initial ?? 0,
      definition.action,
      definition.floats?.length ?? 0,
      ...(definition.floats ?? []),
      definition.integers?.length ?? 0,
      ...(definition.integers ?? []),
      definition.group ?? 0,
      0,
      definition.flags ?? 0,
    ]),
  ].join("\n");
}

async function fixture(definitions) {
  const powerups = await new PowerupSystem(
    { text: async () => table(definitions) },
    new Group(),
  ).init();
  return { powerups, race: createRace([]) };
}

test("structural bend removes only flagged effects owned by driver 8 in catalog order", async () => {
  const { powerups, race } = await fixture([
    { name: "Unflagged protection", action: 27, duration: 60, floats: [0.25] },
    { name: "Timer freeze", action: 8, duration: 20, flags: 4 },
    { name: "Invulnerability", action: 5, duration: 20, flags: 4 },
    { name: "Free repairs", action: 6, duration: 20, flags: 4 },
    {
      name: "Other driver's underwater effect",
      action: 10,
      duration: 60,
      flags: 4,
    },
    { name: "Inventory", action: 34, duration: -1, initial: -2, flags: 4 },
  ]);
  const vehicle = createVehicle(new Vector3());
  const other = createVehicle(new Vector3(1, 0, 0));
  vehicle.driver = 8;
  other.driver = 7;
  const grant = (index, recipient = vehicle) =>
    powerups.grant(index, recipient, race);

  // Advance the common timer before grants so removal can be checked against
  // both active deadlines and the ordinary expiry path.
  powerups.beginFrame(0.25, vehicle, race);
  grant(3);
  grant(2);
  grant(1);
  grant(0);
  grant(4, other);
  grant(5);
  assert.equal(powerups.abilities.get(5)?.charges, 2);
  assert.deepEqual(
    powerups.activeEffectsFor(vehicle).map((effect) => effect.index),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    powerups.activeEffectsFor(other).map((effect) => effect.index),
    [4],
  );

  const resetOrder = [];
  const reset = powerups.resetEffect;
  powerups.resetEffect = function (action, recipient) {
    resetOrder.push({ action, recipient });
    return reset.call(this, action, recipient);
  };
  const elapsedBefore = powerups.elapsedMs;
  const beforeBendRead = powerups.activeEffectsFor(vehicle);

  const wrongDriverResult = powerups.removeForStructuralBend(other);
  assert.equal(wrongDriverResult, undefined);
  const missingDriver = createVehicle(new Vector3());
  const missingDriverResult = powerups.removeForStructuralBend(missingDriver);
  assert.equal(missingDriverResult, undefined);
  assert.deepEqual(
    resetOrder,
    [],
    "ineligible recipients must not lose effects",
  );
  assert.deepEqual(powerups.activeEffectsFor(vehicle), beforeBendRead);
  assert.deepEqual(
    powerups.activeEffectsFor(other).map((effect) => effect.index),
    [4],
  );

  const modifiers = powerups.removeForStructuralBend(vehicle);
  assert.deepEqual(
    resetOrder.map(({ action, recipient }) => [action, recipient]),
    [
      [8, vehicle],
      [5, vehicle],
      [6, vehicle],
    ],
    "ordinary reset handlers run once each in POWERUP catalog order",
  );
  assert.equal(
    powerups.elapsedMs,
    elapsedBefore,
    "bend removal must not advance time",
  );
  assert.deepEqual(modifiers, {
    accelerationMultiplier: 1,
    maxSpeedMultiplier: 1,
    lateralGripMultiplier: 1,
    invulnerable: false,
    freeRepairs: false,
    damageMultiplier: 1,
    protection: 0.25,
    timerFrozen: false,
    underwaterAbility: true,
    instantHandbrake: false,
    pedestriansOnMap: false,
    opponentSpeedFactor: 1,
    copSpeedFactor: 1,
    bouncePeriodMs: 0,
    wallClimb: false,
    gravityMultiplier: 1,
    pinballFactor: 0,
  });
  assert.deepEqual(
    powerups.activeEffectsFor(vehicle).map((effect) => effect.index),
    [0],
    "unflagged effects remain active on the bent vehicle",
  );
  assert.deepEqual(
    powerups.activeEffectsFor(other).map((effect) => effect.index),
    [4],
    "effects owned by another vehicle remain active",
  );
  assert.equal(
    powerups.abilities.get(5)?.charges,
    2,
    "inventory is not an active effect",
  );
  assert.equal(
    powerups.removeForStructuralBend(vehicle),
    undefined,
    "a later bend with no matching effects is a no-op",
  );

  powerups.beginFrame(21.25, vehicle, race);
  const afterExpiry = powerups.finishFrame();
  assert.deepEqual(
    resetOrder.map(({ action }) => action),
    [8, 5, 6],
    "removed deadlines must not invoke lose handlers again",
  );
  assert.equal(
    afterExpiry.protection,
    0.25,
    "the unflagged effect retains its deadline",
  );
  assert.deepEqual(
    powerups.activeEffectsFor(vehicle).map((effect) => effect.index),
    [0],
  );
  assert.deepEqual(
    powerups.activeEffectsFor(other).map((effect) => effect.index),
    [4],
  );
});

test("original Stock and Advanced tables mark only authored bend-sensitive definitions", async (t) => {
  let assets;
  try {
    assets = await createAssetStore();
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Original installation is absent");
      return;
    }
    throw error;
  }
  for (const root of ["data", "adv_data"]) {
    const definitions = parsePowerups(
      decodeText(await assets.read(`${root}/POWERUP.TXT`)),
    );
    assert.deepEqual(
      definitions
        .filter((def) => def.flags & 4)
        .map((def) => [def.index, def.action, def.duration]),
      [
        [5, 9, 30],
        [23, 20, 30],
        [39, 27, 30],
      ],
    );
    const powerups = await new PowerupSystem(
      {
        text: async () => decodeText(await assets.read(`${root}/POWERUP.TXT`)),
      },
      new Group(),
    ).init();
    const vehicle = createVehicle(new Vector3());
    vehicle.driver = 8;
    const race = createRace([]);
    // Hot rod and jelly share a group; granite is independent. Exercise each
    // authored grant/lose path without a prior conflict hiding a missing reset.
    for (const index of [5, 23, 39]) {
      powerups.grant(index, vehicle, race);
      assert.ok(
        powerups
          .activeEffectsFor(vehicle)
          .some((effect) => effect.index === index),
      );
      const modifiers = powerups.removeForStructuralBend(vehicle);
      assert.ok(modifiers);
      assert.equal(modifiers.accelerationMultiplier, 1);
      assert.equal(modifiers.lateralGripMultiplier, 1);
      assert.equal(modifiers.protection, 1);
      if (index === 5 || index === 23)
        assert.deepEqual(modifiers.suspension, {
          frontGiveMultiplier: 1,
          rearGiveMultiplier: 1,
          frontExtraLength: 0,
          rearExtraLength: 0,
          dampingMultiplier: 1,
        });
      assert.equal(powerups.activeEffectsFor(vehicle).length, 0);
    }
    powerups.dispose();
  }
});
