import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import * as THREE from "three";
import { createAssetStore } from "../server/assets.mjs";
import { createRace, createVehicle } from "../src/gameplay.ts";
import { decodeText, parseAct } from "../src/formats.ts";
import { parsePowerups, PowerupSystem } from "../src/powerups.ts";

function table(definitions) {
  const lines = [String(definitions.length)];
  for (const d of definitions) {
    lines.push(
      d.message ?? "Test effect",
      d.icon ?? "none",
      "-1",
      String(d.duration ?? -1),
      "0",
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

test("parses sequential definitions and variable float/integer parameters", () => {
  const parsed = parsePowerups(
    `// header\n${table([
      { message: "n/a", action: 0, ints: [100, 1000] },
      { message: "Hot rod!", action: 9, duration: 30, floats: [8, 2.2, 1.5] },
    ])}`,
  );
  assert.equal(parsed.length, 2);
  assert.deepEqual(parsed[0].integerParams, [100, 1000]);
  assert.deepEqual(parsed[1].floatParams, [8, 2.2, 1.5]);
  assert.equal(parsed[1].duration, 30);
});

test("sweeps supported pickups, applies effects, and preserves pickup world position", async () => {
  const definitions = [
    { message: "Credits", action: 0, ints: [100, 1000] },
    { message: "Instant repair", action: 7 },
    {
      message: "Hot rod",
      action: 9,
      duration: 30,
      floats: [2, 1.5, 1, 1, 0, 0, 1],
    },
    { message: "Time bonus", action: 11, ints: [5, 30] },
  ];
  const assets = { text: async () => table(definitions) };
  const root = new THREE.Group();
  root.position.set(10, 0, -3);
  const pickup = new THREE.Group();
  pickup.name = "&£020123";
  pickup.position.set(2, 0, 0);
  pickup.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial(),
    ),
  );
  root.add(pickup);
  const system = await new PowerupSystem(assets, root).init();
  assert.equal(system.pickups.length, 1);
  assert.deepEqual(system.pickups[0].position.toArray(), [12, 0, -3]);
  assert.equal(
    root.children.includes(pickup),
    false,
    "pickup is removed before static world batching",
  );
  assert.equal(
    system.group.children[0],
    pickup,
    "original mesh hierarchy is reused",
  );

  const vehicle = createVehicle(new THREE.Vector3(11, 0, -3));
  const race = createRace([], { credits: 0, timeLimit: 60 });
  vehicle.health = 30;
  system.update(1 / 60, vehicle, race);
  const events = [];
  vehicle.position.set(13, 0, -3); // crosses the pickup between frames
  const modifiers = system.update(1 / 60, vehicle, race, (event) =>
    events.push(event),
  );
  assert.equal(system.pickups[0].collected, true);
  assert.equal(pickup.visible, false);
  assert.equal(race.credits, 0);
  assert.equal(events[0].kind, "engine");
  assert.deepEqual(modifiers, {
    accelerationMultiplier: 2,
    maxSpeedMultiplier: 1,
    lateralGripMultiplier: 1.5,
    invulnerable: false,
    freeRepairs: false,
    damageMultiplier: 1,
    protection: 1,
    timerFrozen: false,
    suspension: {
      frontGiveMultiplier: 1,
      rearGiveMultiplier: 1,
      frontExtraLength: 0,
      rearExtraLength: 0,
      dampingMultiplier: 1,
    },
  });
  system.dispose();

  const indexedRoot = new THREE.Group();
  const bonus = new THREE.Group();
  bonus.name = "&£001234";
  indexedRoot.add(bonus);
  const indexedSystem = await new PowerupSystem(
    assets,
    indexedRoot,
    () => 0.5,
  ).init();
  const car = createVehicle(new THREE.Vector3());
  const state = createRace([], { credits: 0, timeLimit: 60 });
  const got = [];
  indexedSystem.update(0, car, state, (event) => got.push(event));
  assert.equal(state.credits, 500);
  assert.equal(got[0].kind, "credits");
  assert.equal(got[0].amount, 500);
  indexedSystem.dispose();
});

test("unsupported pickups collect once with an explicit event and definition warning", async () => {
  const assets = {
    text: async () => table([{ message: "Unknown", action: 48 }]),
  };
  const root = new THREE.Group(),
    pickup = new THREE.Group();
  pickup.name = "&£001234";
  root.add(pickup);
  const system = await new PowerupSystem(assets, root).init();
  assert.equal(system.pickups.length, 1);
  assert.equal(root.children.includes(pickup), false);
  assert.match(system.warnings[0], /unsupported action 48/);
  assert.equal(system.warnings.length, 1);
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([]);
  const events = [];
  const modifiers = system.update(0, car, race, (event) => events.push(event));
  assert.equal(pickup.visible, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "unsupported");
  assert.equal(events[0].name, "Unknown");
  assert.equal(modifiers.accelerationMultiplier, 1);
  system.update(0, car, race, (event) => events.push(event));
  assert.equal(events.length, 1);
  system.dispose();
});

async function syntheticEffects(
  definitions,
  positions = definitions.map(() => 0),
  random = Math.random,
) {
  const root = new THREE.Group();
  definitions.forEach((definition, index) => {
    const actor = new THREE.Group();
    actor.name = `&£${String(index).padStart(2, "0")}fixture`;
    actor.position.x = positions[index];
    root.add(actor);
  });
  return new PowerupSystem(
    { text: async () => table(definitions) },
    root,
    random,
  ).init();
}

const damageEffects = [
  { message: "Immunity", action: 5, duration: 30 },
  { message: "Repair voucher", action: 6, duration: 60 },
  { message: "Damage factor", action: 22, duration: 30, floats: [5] },
  { message: "Protection factor", action: 27, duration: 30, floats: [50] },
];

test("timed source damage and repair actions retain independent thirty/sixty second expiry", async () => {
  const system = await syntheticEffects(damageEffects);
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([]);
  const events = [];
  let modifiers = system.update(0, car, race, (event) => events.push(event));
  assert.equal(system.pickups.length, 4);
  assert.equal(system.warnings.length, 0);
  assert.equal(events.length, 4);
  assert.equal(modifiers.invulnerable, true);
  assert.equal(modifiers.freeRepairs, true);
  assert.equal(modifiers.damageMultiplier, 5);
  assert.equal(modifiers.protection, 50);
  modifiers = system.update(29.75, car, race);
  assert.equal(modifiers.invulnerable, true);
  modifiers = system.update(0.25, car, race);
  assert.equal(modifiers.invulnerable, false);
  assert.equal(modifiers.damageMultiplier, 1);
  assert.equal(modifiers.protection, 1);
  assert.equal(modifiers.freeRepairs, true);
  modifiers = system.update(30, car, race);
  assert.equal(modifiers.freeRepairs, false);
  system.dispose();
});

test("source random tables retain duplicate weights and report the selected effect", async () => {
  for (const [sample, expectedKind, expectedAmount] of [
    [0, "credits", 100],
    [0.65, "credits", 100],
    [2 / 3, "credits", 100],
    [0.99, "time", 5],
  ]) {
    const system = await syntheticEffects(
      [
        { action: 4, ints: [1, 1, 2] },
        { action: 0, message: "Cash", ints: [100, 100] },
        { action: 11, message: "Time", ints: [5, 5] },
      ],
      [0, 100, 200],
      () => sample,
    );
    const car = createVehicle(new THREE.Vector3());
    const race = createRace([], { credits: 0, timeLimit: 60 });
    const events = [];
    system.update(0, car, race, (event) => events.push(event));
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, expectedKind);
    assert.equal(events[0].amount, expectedAmount);
    assert.equal(
      events[0].definition.index,
      expectedKind === "credits" ? 1 : 2,
    );
    system.dispose();
  }
});

test("credits sample the original inclusive range and truncate awards to hundreds", async () => {
  for (const [sample, expected] of [
    [0, 100],
    [0.5, 500],
    [0.99, 900],
    [32767 / 32768, 1000],
  ]) {
    const system = await syntheticEffects(
      [{ action: 0, ints: [100, 1000] }],
      [0],
      () => sample,
    );
    const car = createVehicle(new THREE.Vector3());
    const race = createRace([], { credits: 25 });
    const events = [];
    system.update(0, car, race, (event) => events.push(event));
    assert.equal(race.credits, 25 + expected);
    assert.equal(events[0].amount, expected);
    system.dispose();
  }
});

test("time bonuses preserve source 15-bit sampling and both inclusive endpoints", async () => {
  for (const [sample, expected] of [
    [0, 5],
    [1 / 26, 5],
    [0.5, 18],
    [32767 / 32768, 30],
  ]) {
    const system = await syntheticEffects(
      [{ action: 11, ints: [5, 30] }],
      [0],
      () => sample,
    );
    const car = createVehicle(new THREE.Vector3());
    const race = createRace([], { timeLimit: 60 });
    const events = [];
    system.update(0, car, race, (event) => events.push(event));
    assert.equal(race.timeLeft, 60 + expected);
    assert.equal(events[0].amount, expected);
    system.dispose();
  }
});

test("random pickup preserves an unsupported choice and guards cyclic tables", async () => {
  const system = await syntheticEffects(
    [
      { action: 4, ints: [1] },
      { action: 48, message: "Original ability" },
    ],
    [0, 100],
    () => 0,
  );
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([]);
  const events = [];
  system.update(0, car, race, (event) => events.push(event));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "unsupported");
  assert.equal(events[0].name, "Original ability");
  system.dispose();
  const cyclic = await syntheticEffects(
    [{ action: 4, ints: [0] }],
    [0],
    () => 0,
  );
  cyclic.update(0, car, race, (event) => events.push(event));
  assert.equal(events.length, 2);
  assert.equal(events[1].kind, "unsupported");
  cyclic.dispose();
});

test("freeze timer renews its duration and cancellation clears it", async () => {
  const system = await syntheticEffects(
    [{ action: 8, duration: 1 }, { action: 8, duration: 2 }, { action: 51 }],
    [0, 4, 8],
  );
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([]);
  assert.equal(system.update(0, car, race).timerFrozen, true);
  system.update(0.75, car, race);
  car.position.x = 4;
  system.update(0, car, race);
  assert.equal(system.update(0.25, car, race).timerFrozen, true);
  assert.equal(system.update(1.75, car, race).timerFrozen, false);
  system.dispose();

  const cancelling = await syntheticEffects(
    [{ action: 8, duration: 30 }, { action: 51 }],
    [0, 4],
  );
  car.position.x = 0;
  assert.equal(cancelling.update(0, car, race).timerFrozen, true);
  car.position.x = 4;
  assert.equal(cancelling.update(0, car, race).timerFrozen, false);
  cancelling.dispose();
});

test("cancellation invokes scalar and motion resets without reverting credits or health", async () => {
  const definitions = [
    ...damageEffects,
    { action: 9, duration: 30, floats: [2, 1.5, 1, 1, 0, 0, 1] },
    { action: 21, duration: 30, floats: [0.3] },
    { action: 51 },
  ];
  const system = await syntheticEffects(definitions, [0, 0, 0, 0, 0, 0, 5]);
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([], { credits: 123 });
  car.health = 42;
  const active = system.update(0, car, race);
  assert.equal(active.accelerationMultiplier, 2);
  assert.equal(active.lateralGripMultiplier, 0.3);
  car.position.x = 5;
  const clean = system.update(0, car, race);
  assert.equal(clean.invulnerable, false);
  assert.equal(clean.freeRepairs, false);
  assert.equal(clean.damageMultiplier, 1);
  assert.equal(clean.protection, 1);
  assert.equal(clean.accelerationMultiplier, 1);
  assert.equal(clean.lateralGripMultiplier, 1);
  assert.equal(race.credits, 123);
  assert.equal(car.health, 42);
  assert.deepEqual(system.update(100, car, race), clean);
  system.dispose();
});

test("renewing a damage factor replaces its timeout and disposal resets live effects", async () => {
  const system = await syntheticEffects(
    [
      { action: 22, duration: 1, floats: [5] },
      { action: 22, duration: 2, floats: [7] },
      { action: 5, duration: 30 },
    ],
    [0, 4, 4],
  );
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([]);
  assert.equal(system.update(0, car, race).damageMultiplier, 5);
  system.update(0.75, car, race);
  car.position.x = 4;
  let modifiers = system.update(0, car, race);
  assert.equal(modifiers.damageMultiplier, 7);
  assert.equal(modifiers.invulnerable, true);
  assert.equal(system.update(0.25, car, race).damageMultiplier, 7);
  modifiers = system.update(1.75, car, race);
  assert.equal(modifiers.damageMultiplier, 1);
  assert.equal(modifiers.invulnerable, true);
  system.dispose();
  assert.equal(system.update(0, car, race).invulnerable, false);
});

test("renewed engine and tyre effects survive the previous pickup's expiry", async () => {
  for (const action of [9, 21]) {
    const floats = action === 9 ? [2, 1.5, 1, 1, 0, 0, 1] : [2];
    const renewed = action === 9 ? [4, 3, 1, 1, 0, 0, 1] : [4];
    const system = await syntheticEffects(
      [
        { action, duration: 1, floats },
        { action, duration: 2, floats: renewed },
      ],
      [0, 4],
    );
    const car = createVehicle(new THREE.Vector3());
    const race = createRace([]);
    system.update(0, car, race);
    system.update(0.75, car, race);
    car.position.x = 4;
    system.update(0, car, race);
    const active = system.update(0.25, car, race);
    assert.equal(active.lateralGripMultiplier, action === 9 ? 3 : 4);
    assert.equal(active.accelerationMultiplier, action === 9 ? 4 : 1);
    const expired = system.update(1.75, car, race);
    assert.equal(expired.lateralGripMultiplier, 1);
    assert.equal(expired.accelerationMultiplier, 1);
    system.dispose();
  }
});

test("a sweep applies pickups in driving order, independently of scene ordering", async () => {
  const system = await syntheticEffects(
    [
      { action: 51, message: "Cancel" },
      {
        action: 9,
        message: "Turbo",
        duration: 30,
        floats: [2, 1.5, 1, 1, 0, 0, 1],
      },
    ],
    [4, 2],
  );
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([]);
  system.update(0, car, race);
  car.position.x = 6;
  const events = [];
  const modifiers = system.update(0, car, race, (event) => events.push(event));
  assert.deepEqual(
    events.map((event) => event.name),
    ["Turbo", "Cancel"],
  );
  assert.equal(modifiers.accelerationMultiplier, 1);
  assert.equal(modifiers.lateralGripMultiplier, 1);
  system.update(0, car, race, (event) => events.push(event));
  assert.equal(events.length, 2, "collected pickups do not retrigger");
  system.dispose();
});

test("APO gains and slots emit original three-column parameters without inventing credit billing", async () => {
  const system = await syntheticEffects([
    { action: 46, ints: [-1, 0, 0] },
    { action: 47, ints: [1, 1, 1] },
  ]);
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([], { credits: 123 });
  const events = [];
  system.update(0, car, race, (event) => events.push(event));
  assert.equal(system.warnings.length, 0);
  assert.deepEqual(
    events.map((event) => [
      event.kind,
      event.definition.action,
      event.definition.integerParams,
    ]),
    [
      ["upgrade", 46, [-1, 0, 0]],
      ["upgrade", 47, [1, 1, 1]],
    ],
  );
  assert.equal(race.credits, 123);
  system.dispose();
});

let originalAssetsAvailable = true;
try {
  await access(new URL("../carma2_orig", import.meta.url));
} catch {
  originalAssetsAvailable = false;
}
test(
  "parses the original power-up definition table",
  { skip: !originalAssetsAvailable },
  async () => {
    const assets = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const bytes = await assets.read("data/powerup.txt");
    assert.ok(bytes);
    const definitions = parsePowerups(
      new TextDecoder("windows-1252").decode(bytes),
    );
    assert.equal(definitions.length, 98);
    assert.equal(definitions[0].action, 0);
    assert.equal(definitions[9].action, 7);
    assert.equal(definitions[12].action, 11);
    assert.equal(definitions[5].action, 9);
  },
);

test(
  "extracts supported original New City pickup groups before world batching",
  { skip: !originalAssetsAvailable },
  async () => {
    const assets = await createAssetStore(
      new URL("../carma2_orig", import.meta.url).pathname,
    );
    const definitions = decodeText(await assets.read("data/powerup.txt"));
    const roots = parseAct(
      await assets.read("data/RACES/newcity1/newcity1.act"),
    );
    const toGroup = (node) => {
      const group = new THREE.Group();
      group.name = node.name;
      const m = node.transform;
      group.matrix.set(
        m[0],
        m[3],
        m[6],
        m[9],
        m[1],
        m[4],
        m[7],
        m[10],
        m[2],
        m[5],
        m[8],
        m[11],
        0,
        0,
        0,
        1,
      );
      group.matrix.decompose(group.position, group.quaternion, group.scale);
      for (const child of node.children) group.add(toGroup(child));
      return group;
    };
    const world = new THREE.Group();
    for (const root of roots) world.add(toGroup(root));
    const source = {
      text: async (path) =>
        path.toLowerCase() === "data/powerup.txt" ? definitions : null,
    };
    const system = await new PowerupSystem(source, world).init();
    assert.equal(
      system.pickups.length,
      491,
      "all New City pickups collect, including random tables and explicitly unsupported abilities",
    );
    assert.equal(
      system.warnings.length,
      32,
      "New City warns once for each unsupported definition",
    );
    assert.equal(system.group.children.length, system.pickups.length);
    system.dispose();
  },
);
