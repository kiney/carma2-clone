import test from "node:test";
import assert from "node:assert/strict";
import { createVehicle } from "../src/legacy-arcade.ts";
import { access } from "node:fs/promises";
import * as THREE from "three";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { createRace } from "../src/gameplay.ts";
import { parsePowerups, PowerupSystem } from "../src/powerups.ts";
import {
  commandJump,
  instantHandbrake,
} from "../src/physics/command-powerups.ts";

function table(definitions) {
  const lines = [String(definitions.length)];
  for (const d of definitions) {
    lines.push(
      d.message ?? "Test effect",
      d.icon ?? "none",
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

function pickupRoot(indices) {
  const root = new THREE.Group();
  indices.forEach(({ index, x = 0 }) => {
    const actor = new THREE.Group();
    actor.name = `&£${String(index).padStart(2, "0")}fixture`;
    actor.position.x = x;
    root.add(actor);
  });
  return root;
}

async function synthetic(definitions, indices = []) {
  return new PowerupSystem(
    { text: async () => table(definitions) },
    pickupRoot(indices),
    () => 0,
  ).init();
}

test("recovery vouchers accumulate, consume only on explicit success, survive cancellation, and clear on dispose", async () => {
  const system = await synthetic([
    { action: 26, message: "Five vouchers", ints: [5] },
    { action: 51, message: "Cancel effects" },
  ]);
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([]);
  assert.equal(system.grant(0, car, race), true);
  assert.equal(system.recoveryVouchers, 5);
  system.grant(0, car, race);
  assert.equal(system.recoveryVouchers, 10);
  assert.equal(system.consumeRecoveryVoucher(), true);
  assert.equal(system.recoveryVouchers, 9);
  system.grant(1, car, race);
  assert.equal(
    system.recoveryVouchers,
    9,
    "effect cancellation leaves vouchers intact",
  );
  assert.equal(system.consumeRecoveryVoucher(), true);
  assert.equal(system.recoveryVouchers, 8);
  system.dispose();
  assert.equal(system.recoveryVouchers, 0);
});

test("instant handbrake modifier renews its expiry and cancellation clears it", async () => {
  const system = await synthetic([
    { action: 28, message: "Instant handbrake", duration: 5 },
    { action: 51, message: "Cancel effects" },
  ]);
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([]);
  system.grant(0, car, race);
  assert.equal(system.update(4, car, race).instantHandbrake, true);
  system.grant(0, car, race);
  assert.equal(system.update(4, car, race).instantHandbrake, true);
  assert.equal(system.update(0.99, car, race).instantHandbrake, true);
  assert.equal(system.update(0.02, car, race).instantHandbrake, false);
  system.grant(0, car, race);
  assert.equal(system.update(0, car, race).instantHandbrake, true);
  system.grant(1, car, race);
  assert.equal(system.update(0, car, race).instantHandbrake, false);
  system.dispose();
});

test("instant handbrake zeros all linear velocity and RPM while preserving angular velocity", () => {
  const state = {
    velocity: new THREE.Vector3(3, -4, 5),
    angularVelocity: new THREE.Vector3(0.2, -0.3, 0.4),
    rpm: 4200,
  };
  const angularBefore = state.angularVelocity.clone();
  instantHandbrake(state);
  assert.deepEqual(state.velocity.toArray(), [0, 0, 0]);
  assert.equal(state.rpm, 0);
  assert.deepEqual(state.angularVelocity.toArray(), angularBefore.toArray());
});

test("command jump adds world vertical velocity, preserves other components, and rejects invalid input", () => {
  const state = {
    velocity: new THREE.Vector3(2, 3, -4),
    heading: Math.PI / 2,
  };
  commandJump(state, 12);
  assert.equal(state.velocity.x, 2);
  assert.ok(Math.abs(state.velocity.y - (3 + 12 / 6.9)) < 1e-12);
  assert.equal(state.velocity.z, -4);
  assert.equal(state.heading, Math.PI / 2);
  commandJump(state, 6.9);
  assert.ok(Math.abs(state.velocity.y - (3 + 12 / 6.9 + 1)) < 1e-12);
  assert.throws(
    () => commandJump(state, NaN),
    /Invalid command jump parameter/,
  );
  assert.throws(
    () => commandJump(state, Infinity),
    /Invalid command jump parameter/,
  );
});

test("command jump pickup stacks charges without motion until an allowed ability use", async () => {
  const system = await synthetic(
    [
      {
        action: 36,
        message: "Kangaroo on command",
        initialValue: -3,
        floats: [12],
      },
    ],
    [
      { index: 0, x: 0 },
      { index: 0, x: 2 },
    ],
  );
  const car = createVehicle(new THREE.Vector3());
  car.velocity.set(1, 2, 3);
  const beforeCollection = car.velocity.clone();
  const race = createRace([]);
  const events = [];
  system.update(0, car, race, (event) => events.push(event));
  car.position.x = 2;
  system.update(0, car, race, (event) => events.push(event));
  assert.equal(system.abilities.get(0).charges, 6);
  assert.deepEqual(car.velocity.toArray(), beforeCollection.toArray());
  assert.deepEqual(
    events
      .filter((event) => event.kind === "ability")
      .map((event) => event.amount),
    [3, 6],
  );

  const uses = [];
  const activate = () =>
    system.activateAbility(race, (event) => {
      uses.push(event.kind);
      if (event.kind === "ability-use")
        commandJump(car, event.definition.floatParams[0]);
    });
  const beforeUse = car.velocity.clone();
  assert.equal(
    system.activateAbility(race, () => {}, true),
    false,
  );
  assert.deepEqual(car.velocity.toArray(), beforeUse.toArray());
  race.status = "completed";
  assert.equal(activate(), false, "finished race blocks command use");
  assert.deepEqual(car.velocity.toArray(), beforeUse.toArray());
  race.status = "racing";
  assert.equal(activate(), true);
  assert.deepEqual(uses, ["ability-use"]);
  assert.ok(Math.abs(car.velocity.y - (beforeUse.y + 12 / 6.9)) < 1e-12);
  assert.equal(system.abilities.get(0).charges, 5);
  system.dispose();
  assert.equal(system.abilities.size, 0);
  assert.equal(system.selectedAbility, null);
});

test("installed stock and Advanced command powerup definitions retain their authored parameters", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const store = await createAssetStore();
  for (const path of ["data/powerup.txt", "adv_data/Powerup.txt"]) {
    const bytes = await store.read(path);
    assert.ok(bytes, `installed table exists: ${path}`);
    const definitions = parsePowerups(decodeText(bytes));
    assert.equal(definitions.length, 98);
    assert.deepEqual(
      [definitions[38].action, definitions[38].integerParams],
      [26, [5]],
    );
    assert.deepEqual(
      [
        definitions[32].action,
        definitions[32].duration,
        definitions[32].floatParams,
      ],
      [28, 30, []],
    );
    assert.deepEqual(
      [
        definitions[54].action,
        definitions[54].initialValue,
        definitions[54].floatParams,
      ],
      [36, -3, [12]],
    );
    for (const index of [52, 53, 54, 96]) {
      assert.equal(definitions[index].initialValue < 0, true);
      assert.equal(definitions[index].groupInclusion, 0);
      assert.equal(definitions[index].flags, 0);
      assert.equal(definitions[index].fizzleType, -1);
    }
  }
});

test("native command rejection retains charges and selection, while successful calls need no cooldown", async () => {
  const system = await synthetic([
    { action: 34, initialValue: -2 },
    { action: 35, initialValue: -1 },
  ]);
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([]);
  system.grant(1, car, race);
  system.grant(0, car, race);
  let calls = 0;
  assert.equal(
    system.activateAbility(race, () => {
      calls++;
      return -1;
    }),
    false,
  );
  assert.equal(calls, 1);
  assert.equal(system.abilities.get(0).charges, 2);
  assert.equal(system.selectedAbility, 0);
  assert.equal(
    system.activateAbility(race, () => 0),
    true,
  );
  assert.equal(system.abilities.get(0).charges, 1);
  assert.equal(
    system.activateAbility(race, () => 0),
    true,
  );
  assert.equal(system.abilities.has(0), false);
  assert.equal(system.selectedAbility, 1);
  assert.equal(
    system.activateAbility(race, () => -7),
    false,
  );
  assert.equal(system.abilities.get(1).charges, 1);
  assert.equal(system.selectedAbility, 1);
  assert.equal(
    system.activateAbility(race, () => {}),
    true,
    "native oil allocator failure still returns a nonnegative handler result",
  );
  assert.equal(system.selectedAbility, null);
});

test("native command guards reject closed awards, invalid selections and empty inventory before handler dispatch", async () => {
  const system = await synthetic([
    { action: 36, initialValue: -3, floats: [12] },
  ]);
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([]);
  system.grant(0, car, race);
  let calls = 0;
  const handler = () => {
    calls++;
    return 0;
  };
  race.awardsClosed = true;
  assert.equal(system.activateAbility(race, handler), false);
  race.awardsClosed = false;
  for (const selection of [null, -1, 99, 0.5]) {
    system.selectedAbility = selection;
    assert.equal(system.activateAbility(race, handler), false);
  }
  system.selectedAbility = 0;
  system.abilities.get(0).charges = 0;
  assert.equal(system.activateAbility(race, handler), false);
  assert.equal(calls, 0);
});
