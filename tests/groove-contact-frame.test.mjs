import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { WorldGrooveRuntime } from "../src/world-groove.ts";
import { WorldCollision } from "../src/world.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { originalCar } from "./support/original-car.mjs";
import { DamageSystem } from "../src/damage.ts";
import { createSimulatedCar } from "../src/physics/simulation.ts";
import { DEFAULT_SURFACE } from "../src/physics/surfaces.ts";
import {
  createMovingWorldBody,
  captureMovingWorldPose,
  prepareMovingWorldPose,
  sweepHullMovingTriangle,
} from "../src/physics/moving-world.ts";

function fixture(vertices = [-4, 0, -4, 0, 0, 4, 4, 0, -4]) {
  const scene = new THREE.Group(),
    actor = new THREE.Group();
  actor.name = "&PLAT.ACT";
  const mesh = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  mesh.geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  actor.add(mesh);
  scene.add(actor);
  const grooves = new WorldGrooveRuntime(
    scene,
    `START OF GROOVE
&PLAT.ACT
not a lollipop
constant
straight
linear
0,0,0
1
0,4,0
no object animation
END OF GROOVE`,
  );
  actor.userData.dynamicBody = true;
  const world = new WorldCollision(scene),
    simulation = new VehicleSimulation(world, scene);
  simulation.grooves = grooves;
  const platform = createMovingWorldBody(actor);
  simulation.addMovingWorld(platform);
  return { scene, actor, mesh, grooves, world, simulation, platform };
}
function rigid(position, orientation = new THREE.Quaternion()) {
  return {
    state: {
      position: position.clone(),
      predictedPosition: position.clone(),
      orientation: orientation.clone(),
      predictedOrientation: orientation.clone(),
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
    },
    properties: {
      mass: 1,
      inertia: new THREE.Vector3(1, 1, 1),
      centerOfMass: new THREE.Vector3(),
      worldFriction: 0,
      objectFriction: 0,
    },
  };
}
function finish(simulation, time) {
  simulation.beginWorldGrooveFrame();
  simulation.finishWorldGrooveFrame(time);
}
const cube = buildBoxHull(
  new THREE.Vector3(-0.5, -0.5, -0.5),
  new THREE.Vector3(0.5, 0.5, 0.5),
);

test("owned outer frame does not advance GROOVE in any intervening physics step", () => {
  const { simulation, actor, grooves } = fixture();
  finish(simulation, 250);
  finish(simulation, 375);
  assert.equal(actor.position.y, 2);
  simulation.beginWorldGrooveFrame();
  simulation.step();
  simulation.step();
  simulation.step();
  assert.equal(actor.position.y, 2);
  assert.deepEqual(grooves.previousTimes, [375, 250]);
  simulation.finishWorldGrooveFrame(500);
  assert.equal(actor.position.y, 4);
  assert.deepEqual(grooves.previousTimes, [500, 375]);
});

test("standalone direct steps retain the documented immediate physics-clock fallback", () => {
  const { simulation, actor, grooves } = fixture();
  simulation.step();
  assert.ok(Math.abs(actor.position.y - Math.fround(-3.36)) < 1e-6);
  assert.deepEqual(grooves.previousTimes, [0, 0]);
});

test("emitted mesh face stops its exact ACT ancestor without an impulse threshold", () => {
  const { simulation, actor, grooves, world } = fixture();
  finish(simulation, 250);
  finish(simulation, 375);
  const body = rigid(new THREE.Vector3(0, 2, 0));
  simulation.beginWorldGrooveFrame();
  const contacts = simulation.worldContacts(body, [cube]);
  assert.equal(grooves.grooves[0].pathInterrupt, 1);
  assert.equal(actor.position.y, 0);
  assert.deepEqual(
    body.state.velocity.toArray(),
    [0, 0, 0],
    "no solve or damage admission precedes interruption",
  );
  assert.ok(
    contacts.length,
    "first collected moving trajectory remains available to CCD",
  );
  assert.equal(contacts[0].sourceSurface.a.y, 2);
  const refreshed = world.querySurfaces(
    new THREE.Vector3(-1, -1, -1),
    new THREE.Vector3(1, 1, 1),
  );
  assert.ok(refreshed.length);
  assert.equal(refreshed[0].a.y, 0);
  assert.equal(
    contacts[0].sourceSurface.a.y,
    2,
    "cache replacement leaves already emitted coordinates intact",
  );
  simulation.finishWorldGrooveFrame(500);
  assert.equal(
    actor.position.y,
    0,
    "done flag suppresses late normal evaluation",
  );
});

test("rotated thin body rejects a triangle in its swept world AABB but outside its original local box", () => {
  const { simulation, actor, grooves } = fixture([
    1.25, 0, 1.25, 1.35, 0, 1.25, 1.3, 0, 1.35,
  ]);
  finish(simulation, 250);
  finish(simulation, 375);
  const hull = buildBoxHull(
    new THREE.Vector3(-2, -0.1, -0.1),
    new THREE.Vector3(2, 0.1, 0.1),
  );
  const body = rigid(
    new THREE.Vector3(0, 2, 0),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI / 4,
    ),
  );
  simulation.beginWorldGrooveFrame();
  simulation.worldContacts(body, [hull]);
  assert.equal(grooves.grooves[0].pathInterrupt, 0);
  assert.equal(grooves.grooves[0].doneThisFrame, false);
  simulation.finishWorldGrooveFrame(500);
  assert.equal(actor.position.y, 4);
});

test("same-name ACT impostor cannot redirect a face to a registered groove", () => {
  const { simulation, actor, scene, world, grooves } = fixture();
  finish(simulation, 250);
  finish(simulation, 375);
  const impostor = actor.clone(true);
  impostor.name = actor.name;
  scene.add(impostor);
  const other = createMovingWorldBody(impostor);
  simulation.addMovingWorld(other);
  world.removeDynamic(simulation.movingWorld[0]);
  simulation.beginWorldGrooveFrame();
  simulation.worldContacts(rigid(new THREE.Vector3(0, 2, 0)), [cube]);
  assert.equal(grooves.grooves[0].pathInterrupt, 0);
  assert.equal(actor.position.y, 2);
});

test("wheel-extended bb2 emits a groove below bb1 without requiring a body contact", () => {
  const { simulation, actor, grooves } = fixture();
  finish(simulation, 250);
  finish(simulation, 375);
  const body = {
    ...rigid(new THREE.Vector3(0, 2.6, 0)),
    motion: {
      wheelPositions: Array.from({ length: 4 }, () => new THREE.Vector3()),
      suspensionLength: [6.9, 6.9],
    },
  };
  simulation.beginWorldGrooveFrame();
  assert.deepEqual(simulation.worldContacts(body, [cube]), []);
  assert.equal(grooves.grooves[0].pathInterrupt, 1);
  assert.equal(actor.position.y, 0);
});

test("persistent cached faces suppress new groove callbacks until the source query refreshes", () => {
  const { simulation, actor, grooves } = fixture();
  finish(simulation, 250);
  finish(simulation, 375);
  const body = rigid(new THREE.Vector3(0, 2, 0));
  // Populate outside the outer-frame callback owner, then clear done normally.
  simulation.facesNearBody(body, [cube]);
  simulation.beginWorldGrooveFrame();
  simulation.worldContacts(body, [cube]);
  assert.equal(grooves.grooves[0].pathInterrupt, 0);
  assert.equal(actor.position.y, 2);
  simulation.invalidateWorldFaceCache(body);
  simulation.worldContacts(body, [cube]);
  assert.equal(grooves.grooves[0].pathInterrupt, 1);
});

test("finite first300 emission consumes non-solid faces before groove eligibility", () => {
  const { simulation, actor, scene, world, grooves } = fixture();
  finish(simulation, 250);
  finish(simulation, 375);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  material.name = "!DECAL.MAT";
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      Array.from({ length: 300 }, () => [-4, 2, -4, 0, 2, 4, 4, 2, -4]).flat(),
      3,
    ),
  );
  scene.add(new THREE.Mesh(geometry, material));
  world.rebuildStatic();
  simulation.beginWorldGrooveFrame();
  const body = rigid(new THREE.Vector3(0, 2, 0));
  assert.deepEqual(simulation.worldContacts(body, [cube]), []);
  assert.equal(simulation.worldFaceCache.count, 300);
  assert.equal(
    simulation.worldFaceCache.epoch,
    2,
    "exactly full collection repeats atslot0",
  );
  assert.equal(grooves.grooves[0].pathInterrupt, 0);
  assert.equal(actor.position.y, 2);
});

test("emitted non-solid model runs its callback while wheel/body consumers exclude it", () => {
  const { simulation, mesh, world, grooves } = fixture();
  finish(simulation, 250);
  finish(simulation, 375);
  mesh.material.name = "!DECAL.MAT";
  world.invalidateDynamic();
  world.refreshDynamic();
  const body = {
    ...rigid(new THREE.Vector3(0, 2, 0)),
    hulls: [cube],
    motion: {
      wheelPositions: Array.from({ length: 4 }, () => new THREE.Vector3()),
      suspensionLength: [1, 1],
    },
  };
  simulation.beginWorldGrooveFrame();
  assert.deepEqual(simulation.worldContacts(body, [cube]), []);
  assert.equal(grooves.grooves[0].pathInterrupt, 1);
  assert.ok(simulation.worldFaceCache.count);
  assert.equal(
    simulation.cachedWheelRaycast(
      body,
      new THREE.Vector3(0, 2.4, 0),
      new THREE.Vector3(0, -1, 0),
      1,
    ),
    null,
  );
});

test("cached native wheel queries retain ordinary #water material faces", () => {
  const { simulation, mesh, world } = fixture();
  finish(simulation, 250);
  finish(simulation, 375);
  mesh.material.name = "#WATER.MAT";
  world.invalidateDynamic();
  world.refreshDynamic();
  const body = {
    ...rigid(new THREE.Vector3(0, 2, 0)),
    hulls: [cube],
    motion: {
      wheelPositions: Array.from({ length: 4 }, () => new THREE.Vector3()),
      suspensionLength: [1, 1],
    },
  };
  const hit = simulation.cachedWheelRaycast(
    body,
    new THREE.Vector3(0, 2.4, 0),
    new THREE.Vector3(0, -1, 0),
    1,
  );
  assert.ok(hit);
  assert.equal(hit.surface.material, "#WATER.MAT");
  assert.ok(Math.abs(hit.distance - 0.4) < 1e-9);
});

test("CCD query pose snapshots survive a later live owner rollback", () => {
  const actor = new THREE.Group(),
    owner = createMovingWorldBody(actor),
    body = rigid(new THREE.Vector3(0, 1.5, 0));
  prepareMovingWorldPose(
    owner,
    new THREE.Vector3(0, 2, 0),
    new THREE.Quaternion(),
    1,
  );
  const collectedPose = captureMovingWorldPose(owner);
  prepareMovingWorldPose(owner, new THREE.Vector3(), new THREE.Quaternion(), 1);
  const triangle = {
    owner,
    a: new THREE.Vector3(-4, 0, -4),
    b: new THREE.Vector3(0, 0, 4),
    c: new THREE.Vector3(4, 0, -4),
    twoSided: true,
  };
  assert.equal(sweepHullMovingTriangle(body, cube, triangle), null);
  assert.ok(
    sweepHullMovingTriangle(body, cube, { ...triangle, collectedPose }),
  );
  assert.equal(collectedPose.predictedPosition.y, 2);
});

test("world spark hook retains the first face, weighted origin point, raw group force and pre-solve timing", async (t) => {
  let original;
  try {
    original = await originalCar("EAGLE3");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original installation absent");
      return;
    }
    throw error;
  }
  const damage = new DamageSystem(
    original.assets,
    original.group,
    original.text,
  );
  await damage.init();
  const car = createSimulatedCar(
    original.group,
    original.text,
    damage,
    new THREE.Vector3(10, 0, 0),
    0,
    true,
  );
  const { simulation, world } = fixture();
  simulation.add(car);
  t.after(() => simulation.dispose());
  car.state.velocity.set(1, 0, 0);
  simulation.mechanicsTimeSync = 17;
  const calls = [],
    indices = [];
  world.modifier = (index) => {
    indices.push(index);
    return { ...DEFAULT_SURFACE, sparkiness: index === 0 ? 7 : 99 };
  };
  const firstSurface = {
    material: ":WRONG11",
    modifier: { ...DEFAULT_SURFACE, sparkiness: 99 },
  };
  const secondSurface = { material: "/SECOND", modifier: DEFAULT_SURFACE };
  simulation.onImpact = () => calls.push("damage");
  simulation.onWorldSparks = (source) => {
    calls.push(source);
    assert.deepEqual(
      car.state.velocity.toArray(),
      [1, 0, 0],
      "solver has not applied the group impulse",
    );
  };
  const row = (point, lambda, sourceSurface) => ({
    a: car,
    point: new THREE.Vector3(point, 0, 0),
    normal: new THREE.Vector3(0, 1, 0),
    normalImpulse: lambda,
    tangentImpulse: new THREE.Vector3(),
    closingSpeed: 1,
    sourceType: 1,
    sourceSurface,
  });
  simulation.applyImpactDamage([
    row(11, 0.1, firstSurface),
    row(13, 0.3, secondSurface),
  ]);
  assert.deepEqual(indices, [0], "native spark consumer clamps modifier11 to0");
  assert.equal(calls[0], "damage");
  const source = calls[1];
  assert.equal(source.sparkiness, 7);
  assert.equal(source.timeSyncMs, 17);
  assert.equal(source.position.x, 12.5);
  assert.ok(
    Math.abs(
      source.force.y - Math.fround(Math.fround(0.1) + Math.fround(0.3)) * 6.9,
    ) < 1e-6,
  );
  assert.equal(calls.length, 2);
});

test("mechanics time sync is consumed before each40ms decrement and restored to1 on outer exit", () => {
  const { simulation } = fixture();
  const debts = [];
  simulation.onBeforeStep = () => debts.push(simulation.mechanicsTimeSync);
  simulation.updateFrame(0, 90);
  assert.deepEqual(debts, [90, 50, 10]);
  assert.equal(simulation.mechanicsTimeSync, 1);
  debts.length = 0;
  simulation.step();
  assert.deepEqual(debts, [1]);
  assert.equal(simulation.mechanicsTimeSync, 1);
});

test("car spark hook emits once after both receivers with primary weighted point and secondary raw velocity", async (t) => {
  const cars = [];
  for (const human of [true, false]) {
    let original;
    try {
      original = await originalCar("EAGLE3");
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("Local original installation absent");
        return;
      }
      throw error;
    }
    const damage = new DamageSystem(
      original.assets,
      original.group,
      original.text,
    );
    await damage.init();
    cars.push(
      createSimulatedCar(
        original.group,
        original.text,
        damage,
        new THREE.Vector3(human ? 10 : 20, 0, 0),
        0,
        human,
      ),
    );
  }
  const { simulation } = fixture();
  for (const car of cars) simulation.add(car);
  t.after(() => simulation.dispose());
  const [primary, secondary] = cars;
  primary.state.velocity.set(100, -100, 30);
  secondary.state.velocity.set(7, 8, 9);
  simulation.mechanicsTimeSync = 23;
  const calls = [];
  simulation.onImpact = (car) => calls.push(car);
  simulation.onImpactPair = () => calls.push("pair");
  simulation.onCarSparks = (packet) => calls.push(packet);
  const row = (x, lambda) => ({
    a: primary,
    b: secondary,
    point: new THREE.Vector3(x, 0, 0),
    normal: new THREE.Vector3(0, 1, 0),
    normalImpulse: lambda,
    tangentImpulse: new THREE.Vector3(),
    closingSpeed: 1,
    sourceType: 5,
  });
  simulation.applyImpactDamage([row(11, 0.1), row(13, 0.3)]);
  assert.equal(calls.length, 4);
  assert.equal(calls[0], primary);
  assert.equal(calls[1], secondary);
  assert.equal(calls[2], "pair");
  const packet = calls[3];
  assert.ok(Math.abs(packet.position.x - 12.5) < 1e-5);
  assert.deepEqual(packet.velocity.toArray(), [7, 8, 9]);
  assert.ok(
    Math.abs(packet.force.y - 2.76) < 1e-5,
    "no primary downward-speed doubling",
  );
  assert.equal(packet.timeSyncMs, 23);
  assert.equal(packet.cars[0].actor, primary.group);
  assert.equal(packet.cars[1].actor, secondary.group);
  assert.deepEqual(
    packet.cars.map((car) => car.driver),
    [8, 6],
  );
  assert.deepEqual(primary.state.velocity.toArray(), [100, -100, 30]);
  assert.deepEqual(secondary.state.velocity.toArray(), [7, 8, 9]);
});
