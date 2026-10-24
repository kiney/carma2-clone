import test from "node:test";
import assert from "node:assert/strict";
import { createVehicle } from "../src/legacy-arcade.ts";
import { access } from "node:fs/promises";
import * as THREE from "three";
import { createAssetStore } from "../server/assets.mjs";
import { createRace } from "../src/gameplay.ts";
import { decodeText, parseAct } from "../src/formats.ts";
import { parsePowerups, PowerupSystem } from "../src/powerups.ts";
import { selectNapalmTarget } from "../src/combat-powerups.ts";

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

test("debug grants preserve original pickup charges, event dispatch, renewed expiry and world actors", async () => {
  const root = new THREE.Group(),
    actor = new THREE.Group();
  actor.name = "&£000001";
  actor.position.x = 100;
  root.add(actor);
  const system = await new PowerupSystem(
    {
      text: async () =>
        table([
          { action: 9, duration: 1, floats: [2, 1, 1, 1, 0, 0, 1] },
          { action: 35, initialValue: -5 },
          { action: 7 },
        ]),
    },
    root,
  ).init();
  const car = createVehicle(new THREE.Vector3()),
    race = createRace([]),
    events = [];
  const onEvent = (event) => events.push(event.kind);
  for (const index of [-1, 3, 0.5, NaN, Infinity])
    assert.equal(system.grant(index, car, race, onEvent), false);
  assert.deepEqual(events, []);
  assert.equal(system.grant(0, car, race, onEvent), true);
  assert.equal(system.update(0.6, car, race).accelerationMultiplier, 2);
  system.grant(0, car, race, onEvent);
  assert.equal(
    system.update(0.6, car, race).accelerationMultiplier,
    2,
    "renewed source duration owns the timeout",
  );
  assert.equal(system.update(0.5, car, race).accelerationMultiplier, 1);
  system.grant(1, car, race, onEvent);
  system.activateAbility(race);
  assert.equal(system.abilities.get(1).charges, 4);
  system.grant(1, car, race, onEvent);
  assert.equal(
    system.abilities.get(1).charges,
    9,
    "installed inventory addition preserves four remaining charges and adds five",
  );
  car.health = 20;
  system.grant(2, car, race, onEvent);
  assert.equal(car.health, 100);
  assert.deepEqual(events, [
    "engine",
    "engine",
    "ability",
    "ability",
    "repair",
  ]);
  assert.equal(system.pickups[0].collected, false);
  assert.equal(actor.visible, true);
});

test("original negative charge count becomes edge-operated oil inventory and expires on its fifth use", async () => {
  const root = new THREE.Group();
  const actor = new THREE.Group();
  actor.name = "&£000001";
  root.add(actor);
  const system = await new PowerupSystem(
    {
      text: async () =>
        table([{ action: 35, initialValue: -5, message: "Oil ability" }]),
    },
    root,
  ).init();
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([], { timeLimit: 60 });
  const events = [];
  system.update(0, car, race, (event) => events.push(event));
  assert.equal(events[0].kind, "ability");
  assert.equal(system.abilities.get(0).charges, 5);
  assert.equal(
    system.activateAbility(race, () => {}, true),
    false,
    "Wasted cars cannot activate",
  );
  race.status = "completed";
  assert.equal(
    system.activateAbility(race),
    false,
    "Finished races cannot activate",
  );
  race.status = "racing";
  let uses = 0;
  for (let i = 0; i < 5; i++)
    assert.equal(
      system.activateAbility(race, (event) => {
        assert.equal(event.kind, "ability-use");
        uses++;
      }),
      true,
    );
  assert.equal(uses, 5);
  assert.equal(system.activateAbility(race), false);
  assert.equal(system.abilities.size, 0);
  assert.equal(system.selectedAbility, null);
});

test("action 34 shares charged inventory and actions 12/30 dispatch crash events", async () => {
  const system = await syntheticEffects(
    [
      { action: 34, initialValue: -3, message: "Charged ability" },
      { action: 12, message: "Native crush" },
      { action: 30, message: "Mine ability" },
    ],
    [0, 4, 8],
  );
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([]);
  const events = [];
  system.update(0, car, race, (event) => events.push(event));
  car.position.x = 4;
  system.update(0, car, race, (event) => events.push(event));
  car.position.x = 8;
  system.update(0, car, race, (event) => events.push(event));
  assert.equal(system.abilities.get(0).charges, 3);
  assert.deepEqual(
    events.map(({ kind, definition }) => [kind, definition.action]),
    [
      ["ability", 34],
      ["crash", 12],
      ["crash", 30],
    ],
  );
  assert.equal(system.activateAbility(race), true);
  assert.equal(system.abilities.get(0).charges, 2);
  system.dispose();
});

test("underwater ability renewal and cancellation own their native timed modifier", async () => {
  const root = new THREE.Group();
  const actor = new THREE.Group();
  actor.name = "&£000001";
  root.add(actor);
  const system = await new PowerupSystem(
    { text: async () => table([{ action: 10, duration: 5 }]) },
    root,
  ).init();
  const car = createVehicle(new THREE.Vector3());
  const race = createRace([], { timeLimit: 60 });
  assert.equal(system.update(0, car, race).underwaterAbility, true);
  assert.equal(system.update(4.99, car, race).underwaterAbility, true);
  assert.equal(system.update(0.02, car, race).underwaterAbility, false);
});

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
    underwaterAbility: false,
    instantHandbrake: false,
    bouncePeriodMs: 0,
    wallClimb: false,
    gravityMultiplier: 1,
    pinballFactor: 0,
    opponentSpeedFactor: 1,
    copSpeedFactor: 1,
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
    text: async () => table([{ message: "Unknown", action: 43 }]),
  };
  const root = new THREE.Group(),
    pickup = new THREE.Group();
  pickup.name = "&£001234";
  root.add(pickup);
  const system = await new PowerupSystem(assets, root).init();
  assert.equal(system.pickups.length, 1);
  assert.equal(root.children.includes(pickup), false);
  assert.match(system.warnings[0], /unsupported action 43/);
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
      { action: 43, message: "Original ability" },
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
    assert.equal(definitions[52].action, 34);
    assert.equal(definitions[52].initialValue, -10);
    assert.equal(definitions[96].action, 34);
    assert.equal(definitions[96].initialValue, -3);
    for (const [index, action, initialValue, floats] of [
      [25, 31, 0, [3.5]],
      [55, 37, -3, [36]],
      [56, 38, -3, [12, 0.2, 3, 7]],
      [65, 45, -5, [15, 0.25, 5, 10]],
      [91, 49, -15, []],
    ]) {
      assert.equal(definitions[index].action, action);
      assert.equal(definitions[index].initialValue, initialValue);
      assert.deepEqual(definitions[index].floatParams, floats);
    }
    assert.equal(definitions[25].duration, 30);
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
      17,
      "New City warns once per unsupported definition after combat powerup lifecycle registration",
    );
    assert.equal(system.group.children.length, system.pickups.length);
    system.dispose();
  },
);

test("suspension pickups use native five-argument mapping, renewal and independent resets", async () => {
  const system = await new PowerupSystem(
    {
      text: async () =>
        table([
          { action: 20, duration: 1, floats: [2, 3, 0.1, -0.2, 4] },
          { action: 9, duration: 3, floats: [2, 1.5, 5, 6, 0.4, 0.5, 7] },
          { action: 51 },
        ]),
    },
    new THREE.Group(),
  ).init();
  const car = createVehicle(new THREE.Vector3()),
    race = createRace([]);
  system.grant(1, car, race);
  system.grant(0, car, race);
  let modifiers = system.update(0.6, car, race);
  assert.deepEqual(modifiers.suspension, {
    frontGiveMultiplier: 2,
    rearGiveMultiplier: 3,
    frontExtraLength: 0.1,
    rearExtraLength: -0.2,
    dampingMultiplier: 4,
  });
  assert.equal(modifiers.accelerationMultiplier, 2);
  assert.equal(modifiers.lateralGripMultiplier, 1.5);
  system.grant(0, car, race);
  assert.equal(system.update(0.6, car, race).suspension.frontGiveMultiplier, 2);
  modifiers = system.update(0.5, car, race);
  assert.deepEqual(modifiers.suspension, {
    frontGiveMultiplier: 1,
    rearGiveMultiplier: 1,
    frontExtraLength: 0,
    rearExtraLength: 0,
    dampingMultiplier: 1,
  });
  // Native setters overwrite shared suspension; expiry does not restore an
  // older engine-powerup suspension or reset its independent scalar factors.
  assert.equal(modifiers.accelerationMultiplier, 2);
  system.grant(0, car, race);
  system.grant(2, car, race);
  modifiers = system.update(0, car, race);
  assert.equal(modifiers.accelerationMultiplier, 1);
  assert.equal(modifiers.suspension.frontGiveMultiplier, 1);
});

test("bounce pickups renew the native period and stop on removal without consuming charges", async () => {
  const system = await new PowerupSystem(
    {
      text: async () =>
        table([{ action: 19, duration: 2, floats: [2, 6.9] }, { action: 51 }]),
    },
    new THREE.Group(),
  ).init();
  const car = createVehicle(new THREE.Vector3()),
    race = createRace([]);
  const state = { velocity: new THREE.Vector3(), groundedWheelCount: 4 };
  system.grant(0, car, race);
  assert.equal(system.update(0.49, car, race).bouncePeriodMs, 500);
  assert.equal(system.periodicBounce(state), false);
  system.update(0.01, car, race);
  assert.equal(system.periodicBounce(state), true);
  assert.ok(Math.abs(state.velocity.y - 1) < 1e-7);
  assert.equal(system.abilities.size, 0);
  system.grant(0, car, race);
  // Native renewal zeroes the last-bounce timestamp, not the game clock.
  assert.equal(system.periodicBounce(state), true);
  assert.equal(system.update(2.01, car, race).bouncePeriodMs, 0);
  assert.equal(system.periodicBounce(state), false);
  system.grant(0, car, race);
  system.grant(1, car, race);
  assert.equal(system.update(0, car, race).bouncePeriodMs, 0);
  assert.equal(system.periodicBounce(state), false);
});

test("wall-climb pickup flag renews and clears without altering independent engine/grip state", async () => {
  const system = await new PowerupSystem(
    {
      text: async () =>
        table([
          { action: 18, duration: 1 },
          { action: 9, duration: 4, floats: [2, 1.5, 1, 1, 0, 0, 1] },
          { action: 51 },
        ]),
    },
    new THREE.Group(),
  ).init();
  const car = createVehicle(new THREE.Vector3()),
    race = createRace([]);
  assert.equal(system.update(0, car, race).wallClimb, false);
  system.grant(1, car, race);
  system.grant(0, car, race);
  assert.equal(system.update(0.6, car, race).wallClimb, true);
  system.grant(0, car, race);
  assert.equal(system.update(0.6, car, race).wallClimb, true);
  const modifiers = system.update(0.5, car, race);
  assert.equal(modifiers.wallClimb, false);
  assert.equal(modifiers.accelerationMultiplier, 2);
  assert.equal(modifiers.lateralGripMultiplier, 1.5);
  system.grant(0, car, race);
  system.grant(2, car, race);
  assert.equal(system.update(0, car, race).wallClimb, false);
});

test("gravity and Pinball pickups assign independent globals and restore authored defaults", async () => {
  const system = await new PowerupSystem(
    {
      text: async () =>
        table([
          { action: 16, duration: 1, floats: [0.2] },
          { action: 16, duration: 1, floats: [4] },
          { action: 17, duration: 3, floats: [2] },
          { action: 51 },
        ]),
    },
    new THREE.Group(),
    Math.random,
    [],
    0.75,
  ).init();
  const car = createVehicle(new THREE.Vector3()),
    race = createRace([]);
  assert.equal(system.update(0, car, race).gravityMultiplier, 0.75);
  system.grant(0, car, race);
  system.grant(2, car, race);
  let modifiers = system.update(0.6, car, race);
  assert.equal(modifiers.gravityMultiplier, Math.fround(0.2));
  assert.equal(modifiers.pinballFactor, 2);
  system.grant(1, car, race);
  assert.equal(system.update(0.6, car, race).gravityMultiplier, 4);
  modifiers = system.update(0.5, car, race);
  assert.equal(modifiers.gravityMultiplier, 0.75);
  assert.equal(modifiers.pinballFactor, 2);
  system.grant(0, car, race);
  system.grant(3, car, race);
  modifiers = system.update(0, car, race);
  assert.equal(modifiers.gravityMultiplier, 0.75);
  assert.equal(modifiers.pinballFactor, 0);
});

test("native game timestamps drive expiry independently of frame-period timer subtraction", async () => {
  const system = await new PowerupSystem(
    { text: async () => table([{ action: 16, duration: 1, floats: [0.2] }]) },
    new THREE.Group(),
  ).init();
  const car = createVehicle(new THREE.Vector3()),
    race = createRace([]);
  system.update(0.016, car, race, undefined, 32);
  system.grant(0, car, race);
  assert.equal(
    system.update(0.016, car, race, undefined, 1031).gravityMultiplier,
    Math.fround(0.2),
    "999ms game age remains active despite a small frame period",
  );
  assert.equal(
    system.update(0.016, car, race, undefined, 1032).gravityMultiplier,
    1,
    "the absolute game deadline expires at exactly one second",
  );
  for (const time of [-1, NaN, Infinity])
    assert.throws(() => system.update(0.016, car, race, undefined, time));
});

test("electric ray stores native squared float and expires after the physics window", async () => {
  const system = await new PowerupSystem(
    {
      text: async () =>
        table([
          { action: 31, duration: 30, floats: [3.5] },
          { action: 8, duration: 60 },
          { action: 51 },
        ]),
    },
    new THREE.Group(),
  ).init();
  const car = createVehicle(new THREE.Vector3()),
    race = createRace([]);
  assert.equal(system.electricRayDistanceSquared, 0);
  system.beginFrame(0.016, car, race, undefined, 100);
  const events = [];
  system.grant(0, car, race, (event) => events.push(event));
  system.grant(1, car, race);
  assert.equal(events[0].kind, "effect");
  assert.equal(system.electricRayDistanceSquared, 12.25);
  assert.equal(system.abilities.size, 0);
  system.beginFrame(0.016, car, race, undefined, 30100);
  assert.equal(
    system.electricRayDistanceSquared,
    12.25,
    "the source field survives the entire physics window at its expiry",
  );
  assert.equal(system.finishFrame().timerFrozen, true);
  assert.equal(
    system.electricRayDistanceSquared,
    0,
    "timer freeze leaves electric's normal game-time expiry running",
  );
  system.grant(0, car, race);
  system.beginFrame(0.016, car, race, undefined, 31000);
  system.grant(0, car, race);
  system.update(0.016, car, race, undefined, 60100);
  assert.equal(
    system.electricRayDistanceSquared,
    12.25,
    "renewal replaces the previous timeout",
  );
  system.update(0.016, car, race, undefined, 61000);
  assert.equal(system.electricRayDistanceSquared, 0);
  system.grant(0, car, race);
  system.grant(2, car, race);
  assert.equal(system.electricRayDistanceSquared, 0);
  system.grant(0, car, race);
  system.dispose();
  assert.equal(system.electricRayDistanceSquared, 0);
});

test("combat inventory requires native handler success and adds original charges on renewal", async () => {
  for (const [action, initialValue, floats] of [
    [37, -3, [36]],
    [38, -3, [12, 0.2, 3, 7]],
    [45, -5, [15, 0.25, 5, 10]],
    [49, -15, []],
  ]) {
    const system = await new PowerupSystem(
      {
        text: async () =>
          table([
            { action, initialValue, floats, duration: -1 },
            { action: 51 },
          ]),
      },
      new THREE.Group(),
    ).init();
    const car = createVehicle(new THREE.Vector3()),
      race = createRace([]);
    const grants = [];
    system.grant(0, car, race, (event) => grants.push(event));
    assert.equal(grants[0].kind, "ability");
    assert.equal(grants[0].amount, -initialValue);
    assert.deepEqual(grants[0].definition.floatParams, floats);
    assert.equal(system.electricRayDistanceSquared, 0);
    for (const result of [false, -1, undefined]) {
      assert.equal(
        system.activateAbility(race, () => result),
        false,
      );
      assert.equal(system.abilities.get(0).charges, -initialValue);
      assert.equal(system.selectedAbility, 0);
    }
    assert.equal(
      system.activateAbility(race),
      false,
      "an unconnected combat runtime cannot consume a charge",
    );
    assert.equal(
      system.activateAbility(race, (event) => {
        assert.equal(event.kind, "ability-use");
        assert.equal(event.definition.action, action);
        return true;
      }),
      true,
    );
    assert.equal(system.abilities.get(0).charges, -initialValue - 1);
    system.grant(0, car, race);
    assert.equal(system.abilities.get(0).charges, -2 * initialValue - 1);
    system.grant(1, car, race);
    assert.equal(
      system.abilities.get(0).charges,
      -2 * initialValue - 1,
      "canceling timed effects does not erase keyboard inventory",
    );
    const count = system.abilities.get(0).charges;
    for (let i = 0; i < count; i++)
      assert.equal(
        system.activateAbility(race, () => 0),
        true,
      );
    assert.equal(system.abilities.has(0), false);
    assert.equal(system.selectedAbility, null);
    system.dispose();
  }
});

test("napalm rejects full native bolt pool and no-target commands without consuming inventory", async () => {
  const system = await new PowerupSystem(
    { text: async () => table([{ action: 49, initialValue: -15 }]) },
    new THREE.Group(),
  ).init();
  const car = createVehicle(new THREE.Vector3()),
    race = createRace([]);
  const target = {
    position: new THREE.Vector3(1, 0, 0),
    alive: true,
    inSight: true,
    burningOrReserved: false,
  };
  system.grant(0, car, race);
  const activate = (targets, slots) =>
    system.activateAbility(
      race,
      () =>
        !!selectNapalmTarget(
          car.position,
          targets,
          slots,
          undefined,
          false,
          () => 1,
        ),
    );
  assert.equal(activate([target], [true, true, true, true, true]), false);
  assert.equal(system.abilities.get(0).charges, 15);
  assert.equal(activate([], [false, false, false, false, false]), false);
  assert.equal(system.abilities.get(0).charges, 15);
  assert.equal(activate([target], [true, false, true, true, true]), true);
  assert.equal(system.abilities.get(0).charges, 14);
  system.dispose();
});
