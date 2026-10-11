import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import * as THREE from "three";
import { PedestrianSystem, PedAction } from "../src/pedestrians.ts";
import { WorldCollision } from "../src/world.ts";
import { Assets } from "../src/content.ts";
import { createAssetStore } from "../server/assets.mjs";
import { NativeRandom } from "../src/native-random.ts";

const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const close = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const car = (position = v(0, 0, -5), velocity = v()) => ({
  position,
  velocity,
  yaw: 0,
  speed: 0,
});
const source = (position = v(), overrides = {}) => ({
  position,
  velocity: v(),
  owner: {},
  ...overrides,
});
async function fixture(
  count = 1,
  { wall = false, gravity, random = () => 0.5, hooks = {} } = {},
) {
  const track = new THREE.Group();
  const floorGeometry = new THREE.BufferGeometry();
  floorGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-20, 0, -20, 0, 0, 20, 20, 0, -20], 3),
  );
  const floorMaterial = new THREE.MeshBasicMaterial();
  floorMaterial.name = "sidewalk";
  track.add(new THREE.Mesh(floorGeometry, floorMaterial));
  if (wall) {
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    material.name = "wall";
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(10, 4), material);
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(1, 0, 0);
    track.add(mesh);
  }
  const prototype = new THREE.Group();
  prototype.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.28, 0.06),
      new THREE.MeshBasicMaterial(),
    ),
  );
  const assets = {
    manifest: [{ path: "data/PEDS/PEEPS/Alice/Alice.act", size: 1000 }],
    text: async () => "// Group #0\n1\nAlice\n",
    scene: async () => ({ group: prototype.clone(true) }),
  };
  const events = [];
  const peds = await PedestrianSystem.create(
    assets,
    track,
    "// Ped specs\n1\nsidewalk\n0\n0\n2\n0\n0\n",
    () => 0,
    {
      spawn: v(),
      maxCount: count,
      random: () => 0.5,
      combatRandom: random,
      collision: new WorldCollision(track),
      readGravityMultiplier: gravity,
      onHit: (event) => events.push(event),
      ...hooks,
    },
  );
  const objects = peds.group.children.slice(0, count);
  objects.forEach((object, index) => object.position.set(index + 2, 0, 0));
  const update = (now = 1000, options = {}, dt = 0) =>
    peds.update(dt, car(), {
      gameTimeMs: now,
      physicsTickMs: 80,
      framePeriodMs: dt * 1000,
      ...options,
    });
  return { peds, objects, events, update };
}

test("annihilator selects active/in-sight LOS targets, returns source success and centralizes ordinary kill once", async () => {
  const f = await fixture(2);
  assert.equal(
    f.peds.useCombatPowerup(37, [36], source(), 80, 1000),
    false,
    "not all unprocessed spawns qualify",
  );
  f.update();
  const origin = source();
  assert.equal(f.peds.useCombatPowerup(37, [36], origin, 80, 1010), true);
  assert.equal(f.peds.alive, 0);
  assert.equal(f.peds.hits, 2);
  assert.equal(f.events.length, 2);
  assert.equal(f.events[0].owner, origin.owner);
  assert.equal(f.events[0].cause, "annihilator");
  assert.equal(f.events[0].timeMs, 1010);
  assert.equal(f.peds.states[0].moveId, 113);
  assert.equal(f.peds.states[0].action, PedAction.Dead);
  assert.equal(f.peds.groupCounts.get(0).killed, 2);
  assert.equal(f.peds.useCombatPowerup(37, [36], origin, 80, 1011), false);
  f.update(1011);
  assert.equal(f.events.length, 2);
  f.peds.reset();
  assert.equal(f.peds.alive, 2);
  assert.equal(f.peds.hits, 0);
  f.peds.dispose();
  const blocked = await fixture(1, { wall: true });
  blocked.update();
  assert.equal(
    blocked.peds.useCombatPowerup(37, [36], source(), 80, 1000),
    false,
    "real finite world wall blocks segment",
  );
  assert.equal(blocked.peds.alive, 1);
  blocked.peds.dispose();
});

test("repulsion is nonlethal corporeal move91 with squared-range mass falloff, body omega and physics tick cutoff", async () => {
  let draws = 0;
  const f = await fixture(2, {
    random: () => {
      draws++;
      return 0.75;
    },
  });
  f.objects[1].position.set(Math.sqrt(10), 0, 0);
  f.update();
  const origin = source();
  assert.equal(
    f.peds.useCombatPowerup(45, [15, 0.25, 5, 10], origin, 80, 1000),
    true,
  );
  const state = f.peds.states[0];
  assert.equal(state.alive, true);
  assert.equal(state.corporeal, true);
  assert.equal(state.moveId, 91);
  assert.equal(state.action, PedAction.Impacting);
  close(state.velocity.x, 9);
  close(state.velocity.y, 45);
  close(state.angularVelocity.x, 0.075);
  close(state.angularVelocity.y, 0.075);
  close(state.angularVelocity.z, 0.075);
  assert.equal(state.networkStateCutoffMs, 120);
  assert.equal(state.combatOwner, origin.owner);
  assert.equal(
    draws,
    4,
    "move period consumes one draw before three body-axis omega draws",
  );
  assert.equal(
    f.peds.states[1].corporeal,
    false,
    "strict squared-range boundary",
  );
  assert.equal(f.peds.hits, 0);
  assert.equal(f.events.length, 0);
  f.update(1040, {}, 0.04);
  close(f.peds.states[0].velocity.y, 45 - (9.8 / 6.9) * 0.04);
  assert.ok(f.peds.states[0].position.x > state.position.x);
  assert.ok(f.peds.states[0].position.y > 0);
  assert.equal(f.peds.alive, 2);
  f.peds.dispose();
});

test("electric scan uses velocity-line geometry without LOS, preserves active/global gates and pays once", async () => {
  const f = await fixture(1, { wall: true });
  f.objects[0].position.set(2, 0, 0);
  f.peds.update(0, car(v(), v(1, 0, 0)), {
    gameTimeMs: 1000,
    electricRayDistanceSquared: 0.01,
    immortalPedestrians: true,
  });
  assert.equal(f.peds.hits, 0);
  const electricOwner = {};
  f.peds.update(0, car(v(100, 0, 0), v(1, 0, 0)), {
    gameTimeMs: 1001,
    cameraPosition: v(),
    combatPosition: v(),
    combatOwner: electricOwner,
    electricRayDistanceSquared: 0.01,
  });
  assert.equal(
    f.peds.hits,
    1,
    "predicted line reaches a distant target despite blocked direct LOS",
  );
  assert.equal(f.events[0].cause, "electric");
  assert.equal(f.events[0].owner, electricOwner);
  assert.equal(f.events[0].timeMs, 1001);
  f.peds.update(0, car(v(), v(1, 0, 0)), {
    gameTimeMs: 1002,
    electricRayDistanceSquared: 0.01,
  });
  assert.equal(f.peds.hits, 1);
  f.peds.dispose();
});

test("flamethrower reserves nearest targets in five persistent slots and respects LOS and source/target volumes", async () => {
  let wet = false;
  const f = await fixture(6, { gravity: () => (wet ? 0.5 : 1) });
  f.update();
  assert.equal(
    f.peds.useCombatPowerup(
      49,
      [],
      source(v(), { gravityMultiplier: 0.5 }),
      80,
      1000,
    ),
    false,
  );
  for (let i = 0; i < 5; i++)
    assert.equal(f.peds.useCombatPowerup(49, [], source(), 80, 1000), true);
  assert.equal(f.peds.useCombatPowerup(49, [], source(), 80, 1000), false);
  assert.deepEqual(
    f.peds.combatStats.bolts.map((bolt) => bolt.slot),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    f.peds.states.map((state) => state.napalmSlot),
    [0, 1, 2, 3, 4, -1],
  );
  assert.equal(f.peds.hits, 0);
  assert.equal(f.peds.combatStats.burning, 0);
  f.update(1040, { framePeriodMs: 40 }, 0);
  close(f.peds.combatStats.bolts[0].position.x, 0.082);
  close(f.peds.combatStats.bolts[0].position.y, 0.0736);
  wet = true;
  f.update(1050);
  assert.equal(f.peds.combatStats.bolts.length, 0);
  assert.equal(f.peds.combatStats.reserved, 0);
  assert.equal(f.peds.useCombatPowerup(49, [], source(), 80, 1050), false);
  assert.equal(f.peds.alive, 6);
  f.peds.dispose();
  const blocked = await fixture(1, { wall: true });
  blocked.update();
  assert.equal(
    blocked.peds.useCombatPowerup(49, [], source(), 80, 1000),
    false,
  );
  blocked.peds.dispose();
});

test("napalm contact starts fifteen-second burning, retains owner, kills via ordinary outlet and cancels underwater", async () => {
  let wet = false;
  const sounds = [],
    columns = [],
    extinguished = [];
  const f = await fixture(2, {
    gravity: () => (wet ? 0.5 : 1),
    hooks: {
      onCombatSound: (id) => sounds.push(id),
      onNapalmIgnited: (actor) => columns.push(actor),
      onNapalmExtinguished: (actor) => extinguished.push(actor),
    },
  });
  f.objects[0].position.set(0, 0, 0);
  f.objects[1].position.set(10, 0, 0);
  f.update();
  const origin = source();
  assert.equal(f.peds.useCombatPowerup(49, [], origin, 80, 1000), true);
  assert.deepEqual(sounds, [3701]);
  f.update(1000);
  assert.deepEqual(sounds, [3701, 3702]);
  assert.equal(columns.length, 1);
  assert.equal(f.peds.combatStats.bolts.length, 0);
  assert.equal(f.peds.combatStats.reserved, 0);
  assert.equal(f.peds.states[0].burningUntilMs, 16000);
  assert.equal(f.peds.alive, 2);
  f.update(15999);
  assert.equal(f.peds.alive, 2);
  f.update(16000, { immortalPedestrians: true });
  assert.equal(f.peds.alive, 2);
  f.update(16001);
  assert.equal(f.peds.alive, 1);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].owner, origin.owner);
  assert.equal(f.events[0].cause, "napalm");
  assert.equal(f.events[0].timeMs, 16001);
  f.update(16002);
  assert.equal(f.events.length, 1);
  f.peds.reset();
  f.objects[0].position.set(0, 0, 0);
  f.objects[1].position.set(10, 0, 0);
  f.update(20000);
  f.peds.useCombatPowerup(49, [], origin, 80, 20000);
  f.update(20000);
  wet = true;
  f.update(20001);
  wet = false;
  f.update(40000);
  assert.equal(f.peds.alive, 2);
  assert.equal(f.peds.combatStats.burning, 0);
  f.peds.dispose();
});

test("inactive burning scores immediately without OneLessPed and stops smoke despite immortality", async () => {
  const extinguished = [];
  const f = await fixture(2, {
    hooks: { onNapalmExtinguished: (actor) => extinguished.push(actor) },
  });
  f.objects[0].position.set(0, 0, 0);
  f.objects[1].position.set(10, 0, 0);
  f.update(1000);
  const origin = source();
  f.peds.useCombatPowerup(49, [], origin, 80, 1000);
  f.update(1000);
  assert.equal(f.peds.states[0].burningUntilMs, 16000);
  assert.equal(f.peds.states[0].awardCauseFlags, 0x20);
  f.update(1001, { cameraPosition: v(10000, 0, 0), immortalPedestrians: true });
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].owner, origin.owner);
  assert.equal(f.events[0].count, 0);
  assert.equal(f.events[0].awardContext.cacheFlags, 0x20);
  assert.equal(f.events[0].awardContext.cachePresent, true);
  assert.equal(f.peds.hits, 0);
  assert.equal(f.peds.states[0].alive, false);
  assert.equal(f.peds.states[0].burningUntilMs, 0);
  assert.deepEqual(extinguished, [f.objects[0]]);
  f.update(1002);
  assert.equal(
    f.objects[0].visible,
    false,
    "MakePedVanish survives returning processing camera",
  );
  assert.equal(f.events.length, 1);
  f.peds.reset();
  assert.equal(f.peds.states[0].awardCauseFlags, 0);
  f.update(1003);
  assert.equal(f.objects[0].visible, true);
  f.peds.dispose();
});

test("ray killing a burning pedestrian retains the native napalm cause flag, reset clears it", async () => {
  const f = await fixture(2);
  f.objects[0].position.set(0, 0, 0);
  f.objects[1].position.set(10, 0, 0);
  f.update(1000);
  const origin = source();
  f.peds.useCombatPowerup(49, [], origin, 80, 1000);
  f.update(1000);
  f.peds.useCombatPowerup(37, [36], origin, 80, 1001);
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].cause, "annihilator");
  assert.equal(f.events[0].awardContext.cacheFlags, 0x20);
  f.peds.reset();
  f.objects[0].position.set(0, 0, 0);
  f.objects[1].position.set(10, 0, 0);
  f.update(1002);
  f.peds.useCombatPowerup(37, [36], origin, 80, 1002);
  assert.equal(f.events[1].awardContext.cacheFlags, 0);
  f.peds.dispose();
});

test("low gravity skips physical death effects but retains death/scoring; immortality preserves charges", async () => {
  const f = await fixture(1, { gravity: () => 0.5 });
  f.update();
  assert.equal(f.peds.useCombatPowerup(37, [36], source(), 80, 1000), true);
  assert.equal(f.peds.alive, 0);
  assert.equal(f.events.length, 1);
  assert.equal(f.peds.states[0].moveId, 113);
  assert.equal(f.peds.combatStats.proximityRays, 1);
  f.peds.reset();
  f.update(1001, { immortalPedestrians: true });
  assert.equal(f.peds.useCombatPowerup(37, [36], source(), 80, 1001), false);
  assert.equal(
    f.peds.useCombatPowerup(45, [15, 0.25, 5, 10], source(), 80, 1001),
    false,
  );
  assert.equal(f.peds.useCombatPowerup(49, [], source(), 80, 1001), false);
  f.peds.dispose();
});

test("proximity rays retain live endpoints in twenty first-free slots for exactly 500 ms, with native float-bit CRT seed", async () => {
  const f = await fixture(32);
  f.objects.forEach((object) => object.position.set(2, 0, 0));
  f.update();
  const rayOrigin = v(0, -0.2, 0);
  assert.equal(
    f.peds.useCombatPowerup(
      37,
      [36],
      source(v(), {
        readRayOrigin: () => rayOrigin,
      }),
      80,
      1000,
    ),
    true,
  );
  assert.equal(f.peds.hits, 32, "visual saturation does not suppress kills");
  assert.equal(f.peds.combatStats.proximityRays, 20);
  f.update(1000);
  const line = f.peds.group.getObjectByName("ped-proximity-ray-0");
  assert.ok(line instanceof THREE.Line);
  const positions = line.geometry.getAttribute("position");
  close(positions.getY(0), Math.fround(-0.2));
  close(positions.getX(positions.count - 1), 2);
  close(positions.getY(positions.count - 1), Math.fround(0.025));
  const bits = new DataView(new ArrayBuffer(4));
  bits.setFloat32(0, 2 + 0.025 - 0.2, true);
  const rng = new NativeRandom((1000 + bits.getUint32(0, true)) >>> 0);
  close(positions.getX(1), Math.fround(-0.1 + 0.2 * rng.random()));
  close(positions.getY(1), Math.fround(-0.2 - 0.1 + 0.2 * rng.random()));
  rayOrigin.x = -1;
  f.update(1499);
  assert.equal(f.peds.combatStats.proximityRays, 20);
  close(line.geometry.getAttribute("position").getX(0), -1);
  f.update(1500);
  assert.equal(f.peds.combatStats.proximityRays, 0);
  assert.equal(f.peds.group.getObjectByName("ped-proximity-ray-0"), undefined);
  f.peds.dispose();
});

test("repulse visuals retain six live records, replace the oldest on saturation and expire at 700 ms", async () => {
  const f = await fixture();
  f.update();
  const sources = Array.from({ length: 7 }, () => source());
  for (let i = 0; i < 7; i++)
    assert.equal(
      f.peds.useCombatPowerup(45, [15, 0.25, 5, 10], sources[i], 80, 1000 + i),
      true,
    );
  assert.equal(f.peds.combatStats.repulseRays, 6);
  assert.equal(f.peds.repulseRays[0].source, sources[6]);
  assert.equal(f.peds.repulseRays[1].source, sources[1]);
  const opponentOrigin = v(0, 0, 1),
    opponentTarget = v(4, 0, 1);
  const readOrigin = () => opponentOrigin,
    readTarget = () => opponentTarget;
  f.peds.emitOpponentRepulsion(readOrigin, readTarget, 1007);
  assert.equal(f.peds.combatStats.repulseRays, 6);
  assert.equal(f.peds.repulseRays[1].readSourcePosition, readOrigin);
  assert.equal(f.peds.repulseRays[1].readTargetPosition, readTarget);
  assert.equal(f.peds.repulseRays[1].innerRadius, Math.fround(0.06));
  assert.equal(f.peds.repulseRays[1].outerRadius, Math.fround(0.12));
  f.update(1700);
  assert.equal(f.peds.combatStats.repulseRays, 6);
  f.update(1702);
  assert.equal(f.peds.combatStats.repulseRays, 5);
  f.update(1707);
  assert.equal(f.peds.combatStats.repulseRays, 0);
  f.peds.dispose();
});

test("installed pedestrian forms supply native mass and original flame textures without copied fixtures", async (t) => {
  try {
    await access(new URL("../carma2_orig", import.meta.url));
  } catch {
    t.skip("Original installation is absent");
    return;
  }
  const store = await createAssetStore();
  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map((entry) => [entry.path.toLowerCase(), entry.path]),
  );
  assets.bytes = async (path) => {
    const bytes = await store.read(path);
    assert.ok(bytes, path);
    return bytes;
  };
  const world = await assets.scene("data/RACES/newcity1", "newcity1");
  const collision = new WorldCollision(world.group);
  const peds = await PedestrianSystem.create(
    assets,
    world.group,
    await assets.text("data/RACES/newcity1/newcity1.txt"),
    (x, z, y) => collision.height(x, z, y),
    { spawn: v(), maxCount: 4, combatRandom: () => 0.5 },
  );
  assert.equal(peds.count, 4);
  assert.ok(peds.states.every((state) => state.mass > 0 && state.mass < 0.2));
  const flame = peds.group.getObjectByName("napalm-0-0");
  assert.ok(flame instanceof THREE.Sprite);
  assert.equal(flame.material.map.name.toLowerCase(), "ex00006");
  assert.ok(
    !peds.warnings.some((warning) =>
      /burning animation|flame texture/.test(warning),
    ),
    peds.warnings.join("\n"),
  );
  const position = peds.states[0].position;
  peds.update(0, car(position.clone()), {
    cameraPosition: position,
    gameTimeMs: 1000,
  });
  assert.equal(
    peds.useCombatPowerup(
      45,
      [15, 0.25, 5, 10],
      source(position.clone()),
      80,
      1000,
    ),
    true,
  );
  const state = peds.states[0];
  close(state.velocity.x, (15 * 0.068) / state.mass);
  close(state.velocity.y, (75 * 0.068) / state.mass);
  assert.equal(state.alive, true);
  const repulse = peds.group.getObjectByName("ped-repulse-ray-0");
  assert.ok(repulse instanceof THREE.Mesh);
  assert.equal(repulse.material.map.name.toLowerCase(), "repulse");
  assert.equal(repulse.geometry.getAttribute("position").count, 102);
  assert.equal(repulse.geometry.index.count, 300);
  peds.reset();
  const clearPosition = v(1000, 20, 1000);
  peds.group.children
    .slice(0, peds.count)
    .forEach((object, index) =>
      object.position.copy(
        index === 0 ? clearPosition : v(1500 + index, 20, 1000),
      ),
    );
  peds.update(0, car(clearPosition.clone()), {
    cameraPosition: clearPosition,
    gameTimeMs: 1001,
  });
  const liveOrigin = clearPosition.clone().add(v(-2, 0, 0));
  const raySource = source(liveOrigin.clone(), {
    readPosition: () => liveOrigin,
  });
  peds.useCombatPowerup(45, [15, 0.25, 5, 10], raySource, 80, 1001);
  const rendered = peds.group.getObjectByName("ped-repulse-ray-0");
  for (const [time, opacity] of [
    [1492, 0.75],
    [1562, 0.5],
    [1632, 0.25],
  ]) {
    peds.update(0, car(clearPosition.clone()), {
      cameraPosition: clearPosition,
      gameTimeMs: time,
    });
    assert.equal(rendered.visible, true);
    assert.equal(rendered.material.opacity, opacity);
  }
  liveOrigin.x -= 1;
  peds.update(0, car(clearPosition.clone()), {
    cameraPosition: clearPosition,
    gameTimeMs: 1633,
  });
  close(
    rendered.geometry.getAttribute("position").getX(0),
    Math.fround(liveOrigin.x + 3 / 50),
  );
  const opponentOrigin = clearPosition.clone(),
    opponentTarget = clearPosition.clone().add(v(4, 0, 0));
  peds.emitOpponentRepulsion(
    () => opponentOrigin,
    () => opponentTarget,
    1634,
  );
  peds.update(0, car(clearPosition.clone()), {
    cameraPosition: clearPosition,
    gameTimeMs: 1634,
  });
  const opponentMesh = peds.group.getObjectByName("ped-repulse-ray-1");
  assert.equal(opponentMesh.visible, true);
  const vertices = opponentMesh.geometry.getAttribute("position");
  close(vertices.getX(0), Math.fround(opponentOrigin.x + 4 / 50));
  close(vertices.getZ(0), Math.fround(opponentOrigin.z + Math.fround(0.06)));
  close(vertices.getZ(51), Math.fround(opponentOrigin.z + Math.fround(0.12)));
  close(vertices.getX(50), Math.fround(opponentOrigin.x + (4 * 51) / 50));
  peds.update(0, car(clearPosition.clone()), {
    cameraPosition: clearPosition,
    gameTimeMs: 1701,
  });
  assert.equal(rendered.visible, false);
  peds.dispose();
});
