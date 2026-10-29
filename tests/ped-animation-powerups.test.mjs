import test from "node:test";
import assert from "node:assert/strict";
import { createVehicle } from "../src/legacy-arcade.ts";
import { Vector3, Group } from "three";
import { createRace } from "../src/gameplay.ts";
import { PowerupSystem, isPowerupImplemented } from "../src/powerups.ts";

function table(definitions) {
  return [
    definitions.length,
    ...definitions.flatMap((d) => [
      d.name ?? "Animation modifier",
      "none",
      -1,
      d.duration ?? 1,
      0,
      d.action,
      d.floats.length,
      ...d.floats,
      0,
      d.group ?? 0,
      0,
      0,
    ]),
  ].join("\n");
}

async function fixture(definitions) {
  const powerups = await new PowerupSystem(
    { text: async () => table(definitions) },
    new Group(),
  ).init();
  return {
    powerups,
    vehicle: createVehicle(new Vector3()),
    race: createRace([]),
  };
}

test("actions 2, 32 and 33 expose copied pedestrian animation state and expire", async () => {
  const definitions = [
    { action: 2, floats: [1.2, 0.8, 1.1] },
    { action: 32, floats: [1.4] },
    { action: 33, floats: [0.35] },
  ];
  assert.ok(definitions.every((d) => isPowerupImplemented({ action: d.action })));
  const { powerups, vehicle, race } = await fixture(definitions);
  const start = powerups.pedestrianAnimationState;
  assert.deepEqual(start, {
    bodyScale: [1, 1, 1],
    headScale: 1,
    mutantSpeed: 0,
    revision: 0,
  });

  definitions.forEach((_, index) => powerups.grant(index, vehicle, race));
  const active = powerups.pedestrianAnimationState;
  assert.deepEqual(active.bodyScale, [Math.fround(1.2), Math.fround(0.8), Math.fround(1.1)]);
  assert.equal(active.headScale, Math.fround(1.4));
  assert.equal(active.mutantSpeed, Math.fround(0.35));
  assert.equal(active.revision, 3);
  assert.deepEqual(start.bodyScale, [1, 1, 1], "previous snapshots stay detached");
  assert.throws(() => active.bodyScale.push(3), TypeError);

  powerups.update(1, vehicle, race);
  assert.deepEqual(powerups.pedestrianAnimationState, {
    bodyScale: [1, 1, 1],
    headScale: 1,
    mutantSpeed: 0,
    revision: 6,
  });
});

test("group conflicts reset animation state before the incoming setter; dispose resets the rest", async () => {
  const { powerups, vehicle, race } = await fixture([
    { action: 2, floats: [2, 2, 2], group: 1 },
    { action: 32, floats: [3], group: 2 },
    { action: 5, floats: [], group: 1 },
  ]);
  powerups.grant(0, vehicle, race);
  powerups.grant(1, vehicle, race);
  powerups.grant(2, vehicle, race);
  assert.deepEqual(powerups.pedestrianAnimationState, {
    bodyScale: [1, 1, 1],
    headScale: 3,
    mutantSpeed: 0,
    revision: 3,
  });
  powerups.dispose();
  assert.deepEqual(powerups.pedestrianAnimationState, {
    bodyScale: [1, 1, 1],
    headScale: 1,
    mutantSpeed: 0,
    revision: 4,
  });
});

test("pedestrian body and head scales reject nonpositive or nonfinite authored values", async () => {
  for (const definition of [
    { action: 2, floats: [1, 0, 1] },
    { action: 2, floats: [1, 1] },
    { action: 32, floats: [-1] },
    { action: 32, floats: [1e100] },
  ]) {
    const { powerups, vehicle, race } = await fixture([definition]);
    assert.throws(() => powerups.grant(0, vehicle, race), /positive finite/);
  }
});
