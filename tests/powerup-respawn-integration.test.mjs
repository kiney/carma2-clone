import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { createVehicle } from "../src/legacy-arcade.ts";
import { createRace } from "../src/gameplay.ts";
import { PowerupSystem, parsePowerupCatalog } from "../src/powerups.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";

test("native final-frame phase orders delayed effects, respawns, then queued grants", () => {
  const simulation = new VehicleSimulation(
    {
      raycast: () => null,
      querySurfaces: () => [],
    },
    new Group(),
  );
  const phases = [];
  simulation.worldActivations.update = () => phases.push("delayed");
  simulation.smashPowerupQueue.flush = () => {
    phases.push("queued grants");
    return 0;
  };
  simulation.flushSmashEffects(() => phases.push("respawns"));
  assert.deepEqual(phases, ["delayed", "respawns", "queued grants"]);
  simulation.dispose();
});

// Own miniature table: random pickup 0 selects definition 2, but only the
// original actor index 0 is respawn-enabled in the single-player mask.
const table = [
  4,
  ...[
    { action: 4, ints: [2] },
    { action: 0, ints: [100, 100] },
    { action: 9, duration: 30, floats: [2, 2, 1, 1, 0, 0, 1] },
    { action: 34, initial: -2 },
  ].flatMap((def, index) => [
    `Fixture ${index}`,
    "none",
    -1,
    def.duration ?? -1,
    def.initial ?? 0,
    def.action,
    def.floats?.length ?? 0,
    ...(def.floats ?? []),
    def.ints?.length ?? 0,
    ...(def.ints ?? []),
    0,
    0,
    0,
  ]),
  "// RESPAWN SPECS",
  2,
  1,
  0, // Single player: index zero is an enabled singleton.
  1,
  -4,
  0, // Network: all four definitions (unused by this engine).
  "// NETWORK AUTO-GOODIES",
  999, // Separate grammar is outside this slice.
].join("\n");

async function setup(index = 0) {
  const root = new Group(),
    actor = new Group();
  actor.name = `&£${String(index).padStart(2, "0")}0000`;
  root.add(actor);
  const powerups = await new PowerupSystem(
    { text: async () => table },
    root,
    () => 0,
    [],
    1,
    { minimumMs: 100, extraMs: 0 },
  ).init();
  assert.deepEqual(powerups.warnings, []);
  const vehicle = createVehicle(new Vector3());
  vehicle.driver = 8;
  return { powerups, actor, vehicle, race: createRace([]) };
}

test("catalog separates authored respawn specs from network-only auto-goodies", () => {
  const catalog = parsePowerupCatalog(table);
  assert.equal(catalog.definitions.length, 4);
  assert.deepEqual([...catalog.respawnSpecs[0]], [1, 0, 0, 0]);
  assert.deepEqual([...catalog.respawnSpecs[1]], [1, 1, 1, 1]);
  assert.throws(
    () => parsePowerupCatalog(table.replace("1\n-4\n0", "1\n-5\n0")),
    /respawn range/,
  );
});

test("world random pickup queues its source index and restores only after the current collection phase", async () => {
  const { powerups, actor, vehicle, race } = await setup();
  const collected = [],
    restored = [];
  powerups.onPickup = (def) => collected.push(def.index);
  powerups.onRespawn = (index, source) =>
    restored.push({ index, source, occupied: powerups.pendingRespawns });
  powerups.beginFrame(0.001, vehicle, race, undefined, 1);
  powerups.finishFrame();
  assert.deepEqual(collected, [0]);
  assert.equal(powerups.activeEffectsFor(vehicle)[0].index, 2);
  assert.equal(
    powerups.pendingRespawns,
    1,
    "schedule using actor index 0, not random result 2",
  );
  assert.equal(actor.visible, false);
  assert.equal(actor.userData.c2ActorRenderStyle, 1);
  assert.equal(powerups.updateRespawns(100), 0);

  // The native updater changes render style, retaining live model/pose data.
  actor.position.set(0.1, 0.2, 0.3);
  actor.scale.set(2, 3, 4);
  actor.userData.fixtureDamage = 17;
  const pose = [...actor.position.toArray(), ...actor.scale.toArray()];
  powerups.beginFrame(0.1, vehicle, race, undefined, 101);
  powerups.finishFrame();
  assert.deepEqual(
    collected,
    [0],
    "still hidden during this frame's collection",
  );
  assert.equal(powerups.updateRespawns(), 1);
  assert.equal(actor.visible, true);
  assert.equal(actor.userData.c2ActorRenderStyle, 4);
  assert.equal(powerups.pickups[0].collected, false);
  assert.deepEqual(
    [...actor.position.toArray(), ...actor.scale.toArray()],
    pose,
  );
  assert.equal(actor.userData.fixtureDamage, 17);
  assert.deepEqual(restored, [{ index: 0, source: actor, occupied: 1 }]);
  assert.equal(powerups.pendingRespawns, 0);
  powerups.beginFrame(0.001, vehicle, race, undefined, 102);
  assert.deepEqual(
    collected,
    [0, 0],
    "current collector can consume it next frame",
  );
  assert.equal(powerups.pendingRespawns, 1);
  powerups.dispose();
  assert.equal(powerups.pendingRespawns, 0);
  assert.equal(powerups.updateRespawns(10000), 0);
  assert.equal(restored.length, 1);
});

test("grant sources without an actor never schedule resurrection; disabled world indices stay consumed", async () => {
  const { powerups, actor, vehicle, race } = await setup(1);
  powerups.grant(0, vehicle, race);
  powerups.grant(3, vehicle, race);
  assert.equal(powerups.pendingRespawns, 0);
  assert.equal(actor.visible, true);
  assert.equal(powerups.abilities.get(3).charges, 2);
  powerups.update(0.001, vehicle, race, undefined, 1);
  assert.equal(actor.visible, false);
  assert.equal(powerups.pendingRespawns, 0);
  assert.equal(powerups.updateRespawns(10000), 0);
  assert.equal(actor.visible, false);
  powerups.dispose();
});

test("respawn clocks advance independently of the race countdown and do not advance on reads", async () => {
  const { powerups, actor, vehicle, race } = await setup();
  const raceTime = race.timeLeft;
  powerups.update(0.001, vehicle, race, undefined, 1);
  for (let i = 0; i < 3; i++) {
    powerups.activeEffectsFor(vehicle);
    assert.equal(powerups.updateRespawns(), 0);
  }
  assert.equal(actor.visible, false);
  // Simulate the normal timer-freeze consumer: game time advances while the
  // countdown does not. The real UI/main-loop case is covered in Chromium.
  powerups.beginFrame(0.1, vehicle, race, undefined, 101);
  powerups.finishFrame();
  powerups.updateRespawns();
  assert.equal(actor.visible, true);
  assert.equal(race.timeLeft, raceTime);
  powerups.dispose();
});
