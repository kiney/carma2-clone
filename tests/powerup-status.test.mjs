import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { PowerupSystem } from "../src/powerups.ts";
import { createVehicle } from "../src/legacy-arcade.ts";
import { createRace } from "../src/gameplay.ts";

const table = (definitions) =>
  [
    definitions.length,
    ...definitions.flatMap((d) => [
      d.name,
      "none",
      -1,
      d.duration,
      d.initial ?? 0,
      d.action,
      0,
      d.integers?.length ?? 0,
      ...(d.integers ?? []),
      d.group ?? 0,
      0,
      0,
    ]),
  ].join("\n");
async function fixture(definitions) {
  const powerups = await new PowerupSystem(
    { text: async () => table(definitions) },
    new Group(),
  ).init();
  const vehicle = createVehicle(new Vector3()),
    race = createRace([]);
  vehicle.driver = 8;
  return {
    powerups,
    vehicle,
    race,
    grant: (index) => powerups.grant(index, vehicle, race),
  };
}

test("active display uses stored game deadlines, preserving the native post-physics expiry boundary", async () => {
  const { powerups, vehicle, race, grant } = await fixture([
    { name: "Timed armour", duration: 2, action: 5 },
    { name: "Race repairs", duration: 0, action: 6 },
  ]);
  assert.deepEqual(powerups.activeEffectsFor(vehicle), []);
  grant(0);
  grant(1);
  assert.deepEqual(powerups.activeEffectsFor(vehicle), [
    { index: 0, name: "Timed armour", remainingSeconds: 2 },
    { index: 1, name: "Race repairs", remainingSeconds: null },
  ]);
  powerups.beginFrame(1.25, vehicle, race);
  assert.equal(
    powerups.activeEffectsFor(vehicle)[0].remainingSeconds,
    2,
    "reading does not invoke finishFrame or expire an in-flight physics window",
  );
  powerups.finishFrame();
  assert.equal(powerups.activeEffectsFor(vehicle)[0].remainingSeconds, 0.75);
  const state = powerups.activeEffectsFor(vehicle);
  for (let i = 0; i < 3; i++)
    assert.deepEqual(
      powerups.activeEffectsFor(vehicle),
      state,
      "extra rendering or paused reads cannot advance native effect time",
    );
  powerups.beginFrame(0.75, vehicle, race);
  assert.equal(powerups.activeEffectsFor(vehicle).length, 2);
  powerups.finishFrame();
  assert.deepEqual(powerups.activeEffectsFor(vehicle), [
    { index: 1, name: "Race repairs", remainingSeconds: null },
  ]);
});

test("renewal, group cancellation, explicit removal and teardown update the same display records", async () => {
  const { powerups, vehicle, race, grant } = await fixture([
    { name: "Armour", duration: 2, action: 5, group: 1 },
    { name: "Wall climb", duration: 3, action: 18, group: 1 },
    { name: "Cancel", duration: -1, action: 51 },
  ]);
  grant(0);
  powerups.update(1, vehicle, race);
  grant(0);
  assert.deepEqual(powerups.activeEffectsFor(vehicle), [
    { index: 0, name: "Armour", remainingSeconds: 2 },
  ]);
  grant(1);
  assert.deepEqual(powerups.activeEffectsFor(vehicle), [
    { index: 1, name: "Wall climb", remainingSeconds: 3 },
  ]);
  grant(2);
  assert.deepEqual(powerups.activeEffectsFor(vehicle), []);
  grant(1);
  powerups.dispose();
  assert.deepEqual(powerups.activeEffectsFor(vehicle), []);
});

test("display values are copied and do not expose another vehicle's effect ownership", async () => {
  const { powerups, vehicle, race, grant } = await fixture([
    { name: "Timed armour", duration: 5, action: 5 },
  ]);
  grant(0);
  const copy = powerups.activeEffectsFor(vehicle);
  copy[0].name = "mutated";
  copy[0].remainingSeconds = -100;
  copy.length = 0;
  assert.deepEqual(powerups.activeEffectsFor(vehicle), [
    { index: 0, name: "Timed armour", remainingSeconds: 5 },
  ]);
  const other = createVehicle(new Vector3());
  assert.deepEqual(powerups.activeEffectsFor(other), []);
  powerups.grant(0, other, race);
  assert.deepEqual(powerups.activeEffectsFor(vehicle), []);
  assert.deepEqual(powerups.activeEffectsFor(other), [
    { index: 0, name: "Timed armour", remainingSeconds: 5 },
  ]);
});

test("instant awards and unused command inventory are not displayed as active timed effects", async () => {
  const { powerups, vehicle, grant } = await fixture([
    { name: "Credits", duration: -1, action: 0, integers: [100, 100] },
    { name: "Mines", duration: 10, action: 34, initial: -3 },
  ]);
  grant(0);
  grant(1);
  assert.equal(powerups.abilities.get(1).charges, 3);
  assert.deepEqual(powerups.activeEffectsFor(vehicle), []);
});
