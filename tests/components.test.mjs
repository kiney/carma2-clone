import test from "node:test";
import assert from "node:assert/strict";
import {
  selectDamageFace,
  normalizeDamagePoint,
  componentImpactMagnitude,
  damagePercentageChance,
  componentDamageIncrement,
  applyDamageUnit,
  applyComponentImpact,
  wheelDamageWobble,
} from "../src/physics/components.ts";

const bounds = { min: [-1, -1, -1], max: [1, 1, 1] };
const human = { human: true, multiplayer: true };

test("nearest damage surface preserves Z then X priority and side ties", () => {
  assert.equal(selectDamageFace([0, 0, 0], bounds), "rear");
  assert.equal(selectDamageFace([-0.9, -0.9, 0], bounds), "left");
  assert.equal(selectDamageFace([0, 0.9, 0], bounds), "top");
  assert.equal(selectDamageFace([0, -0.9, 0], bounds), "bottom");
  assert.equal(selectDamageFace([0.9, 0, 0], bounds), "right");
  assert.equal(selectDamageFace([0, 0, -0.9], bounds), "front");
  assert.deepEqual(
    normalizeDamagePoint([-0.5, 0.2, 1.2], bounds),
    [0.25, 0.6, 1.1],
  );
});

test("component energy uses car softness and bottom-world half strength, without crush cap", () => {
  assert.equal(componentImpactMagnitude([0, 0, 0.7], 2, "front", false), 2);
  assert.equal(componentImpactMagnitude([0, 0, 0.7], 2, "bottom", false), 1);
  assert.equal(componentImpactMagnitude([0, 0, 0.7], 2, "bottom", true), 2);
  assert.equal(componentDamageIncrement(1, 2, human), 30);
  assert.equal(
    componentDamageIncrement(1, 2, {
      human: false,
      raceIndex: 0,
      raceCount: 10,
    }),
    119,
  );
  assert.equal(
    componentDamageIncrement(1, 2, {
      human: false,
      raceIndex: 10,
      raceCount: 10,
    }),
    20,
  );
});

test("offline human damage retains integer percentage chance and integer increments", () => {
  assert.equal(
    damagePercentageChance(50.9, () => 0.4999),
    true,
  );
  assert.equal(
    damagePercentageChance(50.9, () => 0.5),
    false,
  );
  assert.equal(
    damagePercentageChance(100, () => 0.99999),
    true,
  );
  assert.equal(
    componentDamageIncrement(1, 0.02, { human: true, random: () => 0.5 }),
    0,
  );
  assert.equal(
    componentDamageIncrement(1, 0.2, { human: true, random: () => 0.99 }),
    6,
  );
});

test("DoDamage discards tiny increments, protects human driver and requires >=10 to finish", () => {
  assert.equal(applyDamageUnit(20, 0, 4, human), 20);
  assert.equal(applyDamageUnit(20, 0, 5, human), 25);
  assert.equal(applyDamageUnit(94, 0, 5, human), 94);
  assert.equal(applyDamageUnit(95, 0, 9, human), 95);
  assert.equal(applyDamageUnit(89, 0, 10, human), 99);
  assert.equal(applyDamageUnit(0, 2, 20, human), 0);
  assert.equal(applyDamageUnit(0, 2, 20, { human: false }), 20);
  assert.equal(applyDamageUnit(0, 0, 20, { ...human, invulnerable: true }), 0);
});

test("all matching component clauses execute separately in original order", () => {
  const programs = Object.fromEntries(
    ["top", "bottom", "left", "right", "front", "rear"].map((location) => [
      location,
      { location, clauses: [] },
    ]),
  );
  const effect = { system: "engine", systemIndex: 0, weaknessFactor: 1 / 3 };
  programs.front.clauses = [
    {
      conditions: [{ axis: "x", operator: "<", threshold: 0.5 }],
      effects: [effect],
    },
    {
      conditions: [{ axis: "y", operator: ">", threshold: 0.5 }],
      effects: [effect],
    },
    {
      conditions: [{ axis: "x", operator: ">", threshold: 0.9 }],
      effects: [effect],
    },
  ];
  const levels = new Uint8Array(12);
  levels[0] = 90;
  const result = applyComponentImpact(
    levels,
    { softness: 1, programs },
    {
      point: [-0.1, 0.1, -1],
      bounds,
      energyVector: [0, 0, 0.7],
      hitAnotherCar: true,
      context: human,
    },
  );
  assert.equal(result.face, "front");
  assert.deepEqual(
    result.events.map(({ previous, level, increment }) => [
      previous,
      level,
      increment,
    ]),
    [
      [90, 95, 5],
      [95, 95, 5],
    ],
  );
  assert.equal(levels[0], 95); // Summing first would incorrectly finish the engine.
});

test("wheel wobble follows original damage modulo8 sequence above30", () => {
  assert.deepEqual(wheelDamageWobble(30), { yDegrees: 0, zDegrees: 0 });
  assert.deepEqual(wheelDamageWobble(40), { yDegrees: 0, zDegrees: 4 });
  assert.deepEqual(wheelDamageWobble(42), {
    yDegrees: 4.800000000000001,
    zDegrees: 0,
  });
  assert.deepEqual(wheelDamageWobble(40, true), { yDegrees: 0, zDegrees: 0 });
});
