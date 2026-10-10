import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createRace, createVehicle } from "../src/gameplay.ts";
import { PowerupSystem } from "../src/powerups.ts";

function table(definitions) {
  const lines = [String(definitions.length)];
  for (const definition of definitions) {
    lines.push(
      definition.message ?? "Phase test",
      "none",
      "-1",
      String(definition.duration ?? -1),
      "0",
      String(definition.action),
      String(definition.floats?.length ?? 0),
      ...(definition.floats ?? []).map(String),
      "0",
      "0",
      "0",
      "0",
    );
  }
  return lines.join("\r\n");
}

async function systemFor(definitions) {
  return new PowerupSystem(
    { text: async () => table(definitions) },
    new THREE.Group(),
    Math.random,
    [],
    0.75,
  ).init();
}

test("timed gravity and Pinball remain active through beginFrame at deadline", async () => {
  const system = await systemFor([
    { action: 16, duration: 1, floats: [0.2] },
    { action: 17, duration: 1, floats: [2] },
  ]);
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([]);
  system.grant(0, car, race);
  system.grant(1, car, race);

  const duringPhysics = system.beginFrame(1, car, race);
  assert.equal(duringPhysics.gravityMultiplier, Math.fround(0.2));
  assert.equal(duringPhysics.pinballFactor, 2);

  const afterExpiry = system.finishFrame();
  assert.equal(afterExpiry.gravityMultiplier, 0.75);
  assert.equal(afterExpiry.pinballFactor, 0);
});

test("finishFrame removes expired bounce before the periodic physics callback", async () => {
  const system = await systemFor([
    { action: 19, duration: 1, floats: [2, 6.9] },
  ]);
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([]);
  const state = { velocity: new THREE.Vector3(), groundedWheelCount: 4 };
  system.grant(0, car, race);

  assert.equal(system.beginFrame(1, car, race).bouncePeriodMs, 500);
  assert.equal(system.finishFrame().bouncePeriodMs, 0);
  assert.equal(system.periodicBounce(state), false);
  assert.deepEqual(state.velocity.toArray(), [0, 0, 0]);
});

test("pickup and renewed grants use the sampled end time for expiration", async () => {
  const root = new THREE.Group();
  const pickup = new THREE.Group();
  pickup.name = "&£00";
  root.add(pickup);
  const assets = {
    text: async () => table([{ action: 16, duration: 1, floats: [0.2] }]),
  };
  const system = await new PowerupSystem(
    assets,
    root,
    Math.random,
    [],
    0.75,
  ).init();
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([]);
  const events = [];

  system.resetPath(car.position);
  const collected = system.beginFrame(
    0.25,
    car,
    race,
    (event) => events.push(event),
    250,
  );
  assert.equal(collected.gravityMultiplier, Math.fround(0.2));
  assert.equal(events.length, 1);
  assert.equal(system.pickups[0].collected, true);

  system.beginFrame(0.25, car, race, undefined, 500);
  system.grant(0, car, race);
  assert.equal(
    system.beginFrame(0.75, car, race, undefined, 1250).gravityMultiplier,
    Math.fround(0.2),
  );
  assert.equal(system.finishFrame().gravityMultiplier, Math.fround(0.2));
  assert.equal(
    system.beginFrame(0.25, car, race, undefined, 1500).gravityMultiplier,
    Math.fround(0.2),
  );
  assert.equal(system.finishFrame().gravityMultiplier, 0.75);
});

test("legacy update still combines begin and expiry phases", async () => {
  const system = await systemFor([{ action: 16, duration: 1, floats: [4] }]);
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([]);
  system.grant(0, car, race);
  assert.equal(system.update(0.99, car, race).gravityMultiplier, 4);
  assert.equal(system.update(0.01, car, race).gravityMultiplier, 0.75);
});
