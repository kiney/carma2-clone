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
    { message: "Hot rod", action: 9, duration: 30, floats: [2, 1.5, 1, 1, 0, 0, 1] },
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
    suspension: {frontGiveMultiplier:1,rearGiveMultiplier:1,frontExtraLength:0,rearExtraLength:0,dampingMultiplier:1},
  });
  system.dispose();

  const indexedRoot = new THREE.Group();
  const bonus = new THREE.Group();
  bonus.name = "&£001234";
  indexedRoot.add(bonus);
  const indexedSystem = await new PowerupSystem(assets, indexedRoot).init();
  const car = createVehicle(new THREE.Vector3());
  const state = createRace([], { credits: 0, timeLimit: 60 });
  const got = [];
  indexedSystem.update(0, car, state, (event) => got.push(event));
  assert.equal(state.credits, 550);
  assert.equal(got[0].kind, "credits");
  assert.equal(got[0].amount, 550);
  indexedSystem.dispose();
});

test("unsupported action pickups remain visible and report one definition warning", async () => {
  const assets = {
    text: async () => table([{ message: "Unknown", action: 48 }]),
  };
  const root = new THREE.Group(),
    pickup = new THREE.Group();
  pickup.name = "&£001234";
  root.add(pickup);
  const system = await new PowerupSystem(assets, root).init();
  assert.equal(system.pickups.length, 0);
  assert.equal(root.children.includes(pickup), true);
  assert.match(system.warnings[0], /unsupported action 48/);
  assert.equal(system.warnings.length, 1);
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
      212,
      "New City has 212 supported pickups including tyre grip",
    );
    assert.equal(
      system.warnings.length,
      47,
      "New City warns once for each of its 47 unsupported definitions",
    );
    assert.equal(system.group.children.length, 212);
    system.dispose();
  },
);
