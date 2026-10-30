import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { createVehicle } from "../src/legacy-arcade.ts";
import { createRace } from "../src/gameplay.ts";
import {
  isPowerupImplemented,
  parsePowerups,
  PowerupSystem,
} from "../src/powerups.ts";

function table(definitions) {
  return [
    definitions.length,
    ...definitions.flatMap((definition) => [
      definition.name ?? "Explosive pedestrian fixture",
      "none",
      -1,
      definition.duration ?? 30,
      definition.initialValue ?? 0,
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

async function fixture(definitions, random = () => 0) {
  const powerups = await new PowerupSystem(
    { text: async () => table(definitions) },
    new Group(),
    random,
  ).init();
  const vehicle = createVehicle(new Vector3());
  const race = createRace([]);
  return { powerups, vehicle, race };
}

const explosive = (extra = {}) => ({
  name: "Explosive pedestrians!",
  action: 3,
  duration: 30,
  group: 0x800,
  flags: 67,
  ...extra,
});

test(
  "installed Stock and Advanced action 3 record is supported through the catalog",
  async (t) => {
    let store;
    try {
      store = await createAssetStore(
        new URL("../carma2_orig/", import.meta.url).pathname,
      );
    } catch {
      t.skip("Original installation unavailable");
      return;
    }

    for (const root of ["data", "adv_data"]) {
      const bytes = await store.read(`${root}/powerup.txt`);
      if (!bytes) {
        t.skip("Original powerup catalog unavailable");
        return;
      }
      const text = decodeText(new Uint8Array(bytes));
      const definition = parsePowerups(text)[4];
      assert.equal(definition.action, 3, `${root} index4 action`);
      assert.equal(definition.message, "Explosive pedestrians!");
      assert.equal(definition.duration, 30);
      assert.equal(definition.groupInclusion, 2048);
      assert.equal(definition.flags, 67);
      assert.equal(isPowerupImplemented(definition), true);

      const system = await new PowerupSystem(
        { text: async () => text },
        new Group(),
      ).init();
      assert.equal(
        system.grant(4, createVehicle(new Vector3()), createRace([])),
        true,
        `${root} original index4 follows normal grant`,
      );
      assert.equal(system.explosivePedestrians, true);
      system.dispose();
      assert.equal(system.explosivePedestrians, false);
    }
  },
);

test("action 3 sets the global effect for any recipient without RNG or car mutation", async () => {
  const { powerups, vehicle, race } = await fixture([explosive()], () => {
    throw new Error(
      "explosive pedestrian grant must not consume random numbers",
    );
  });
  const other = createVehicle(new Vector3());
  other.driver = 2;

  assert.equal(powerups.explosivePedestrians, false);
  assert.equal(powerups.grant(0, other, race), true);
  assert.equal(powerups.explosivePedestrians, true);
  assert.deepEqual(powerups.activeEffectsFor(other), [
    { index: 0, name: "Explosive pedestrians!", remainingSeconds: 30 },
  ]);
  assert.deepEqual(powerups.activeEffectsFor(vehicle), []);

  powerups.dispose();
  assert.equal(powerups.explosivePedestrians, false);
});

test("action 3 renews one deadline and expires after the physics window", async () => {
  const { powerups, vehicle, race } = await fixture([explosive()]);
  powerups.grant(0, vehicle, race);
  powerups.beginFrame(20, vehicle, race);
  powerups.finishFrame();
  assert.equal(powerups.explosivePedestrians, true);

  powerups.grant(0, vehicle, race);
  assert.equal(powerups.activeEffectsFor(vehicle).length, 1);
  assert.equal(
    powerups.activeEffectsFor(vehicle)[0].remainingSeconds,
    30,
    "renewal replaces the deadline without resetting the global in between",
  );
  powerups.beginFrame(29.999, vehicle, race);
  powerups.finishFrame();
  assert.equal(powerups.explosivePedestrians, true);

  powerups.beginFrame(0.001, vehicle, race);
  assert.equal(powerups.explosivePedestrians, true);
  powerups.finishFrame();
  assert.equal(powerups.explosivePedestrians, false);
  powerups.dispose();
});

test("action 3 follows normal conflict, explicit-cancel, timer and reset ownership", async () => {
  const { powerups, vehicle, race } = await fixture([
    explosive(),
    { name: "Conflicting protection", action: 5, duration: 60, group: 0x800 },
    { name: "Cancellificator", action: 51, duration: -1 },
    { name: "Timer freeze", action: 8, duration: 60 },
  ]);

  powerups.grant(0, vehicle, race);
  powerups.grant(1, vehicle, race);
  assert.equal(powerups.explosivePedestrians, false);
  assert.deepEqual(
    powerups.activeEffectsFor(vehicle).map((effect) => effect.index),
    [1],
  );

  powerups.grant(0, vehicle, race);
  powerups.grant(2, vehicle, race);
  assert.equal(powerups.explosivePedestrians, false);
  assert.deepEqual(powerups.activeEffectsFor(vehicle), []);

  powerups.grant(0, vehicle, race);
  powerups.grant(3, vehicle, race);
  const modifiers = powerups.update(30, vehicle, race);
  assert.equal(modifiers.timerFrozen, true);
  assert.equal(
    powerups.explosivePedestrians,
    false,
    "normal game-time expiry still runs while the race timer is frozen",
  );

  powerups.grant(0, vehicle, race);
  powerups.dispose();
  assert.equal(powerups.explosivePedestrians, false);
});
