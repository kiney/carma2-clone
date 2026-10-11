import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Vector3 } from "three";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";
import { WorldCollision } from "../src/world.ts";
import { scaleImpactVectors } from "../src/physics/impact.ts";

async function eagle(t, human = false) {
  let data;
  try {
    data = await originalCar("EAGLE3");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original Eagle assets absent");
      return undefined;
    }
    throw error;
  }
  const damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  damage.damageContext.random = () => 0.5;
  return createSimulatedCar(
    data.group,
    data.text,
    damage,
    new Vector3(),
    0,
    human,
  );
}

function impact(a, b, point, impulse = 10) {
  return {
    a,
    b,
    point: point.clone(),
    pointB: b ? frontPoint(b) : point.clone(),
    normal: new Vector3(1, 0, 0),
    normalImpulse: impulse,
    closingSpeed: 2,
    tangentImpulse: new Vector3(),
  };
}

function frontPoint(car) {
  const bounds = car.shapeVertices
    .flatMap((shape) => shape)
    .reduce((box, point) => box.expandByPoint(point), new Box3());
  return new Vector3(
    (bounds.min.x + bounds.max.x) / 2,
    (bounds.min.y + bounds.max.y) / 2,
    bounds.min.z,
  );
}

function frame(car, speed, velocity, { gear = 0, accelerator = false } = {}) {
  car.crashRecord.cachedSpeed = Math.fround(speed);
  car.crashRecord.beginFrame(false, velocity);
  car.state.gear = gear;
  car.crashAccelerationKey = accelerator;
}

async function simWith(t, ...cars) {
  if (cars.some((car) => !car)) return undefined;
  const scene = new Group();
  const simulation = new VehicleSimulation(new WorldCollision(scene), scene);
  for (const car of cars) simulation.add(car);
  return simulation;
}

test("outer frame snapshots crash state once across five 40ms substeps", async (t) => {
  const car = await eagle(t);
  if (!car) return;
  const simulation = await simWith(t, car);
  car.crashRecord.cachedSpeed = Math.fround(0.125);
  car.state.velocity.set(-12, 4, 5);
  car.state.speed = -999; // Native cache uses unsigned horizontal velocity.
  car.knackered = true;
  let beginCalls = 0;
  const begin = car.crashRecord.beginFrame.bind(car.crashRecord);
  car.crashRecord.beginFrame = (...args) => {
    beginCalls++;
    return begin(...args);
  };
  let steps = 0;
  simulation.step = () => {
    steps++;
    car.state.velocity.set(steps, 100 + steps, -steps);
    car.knackered = false;
  };

  const window = simulation.updateFrame(0, 200);
  assert.equal(window.steps, 5);
  assert.equal(steps, 5);
  assert.equal(beginCalls, 1);
  assert.equal(car.crashRecord.preSpeed, Math.fround(0.125));
  assert.equal(car.crashRecord.frameKnackered, true);
  // Inverse identity orientation preserves the frame-start local velocity.
  assert.deepEqual(car.crashRecord.localVelocity.toArray(), [-12, 4, 5]);
  assert.equal(
    car.crashRecord.cachedSpeed,
    Math.fround(Math.sqrt(50) * Math.fround(0.001)),
  );
});

test("frame-start local velocity rotates world velocity before substeps mutate pose", async (t) => {
  const car = await eagle(t);
  if (!car) return;
  const simulation = await simWith(t, car);
  car.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  car.state.velocity.set(3, 4, 8);
  simulation.step = () => car.state.velocity.set(90, 80, 70);
  simulation.updateFrame(0, 40);
  assert.deepEqual(car.crashRecord.localVelocity.toArray(), [-8, 4, 3]);
  assert.notDeepEqual(car.crashRecord.localVelocity.toArray(), [90, 80, 70]);
});

test("first car contact face survives accepted-damage accumulator cleanup", async (t) => {
  const target = await eagle(t);
  const attacker = await eagle(t, true);
  if (!target || !attacker) return;
  const simulation = await simWith(t, target, attacker);
  simulation.crashClock = () => 1000;
  frame(target, 0.001, new Vector3(0, 0, 1));
  frame(attacker, 0.01, new Vector3(0, 0, -10), {
    gear: 1,
    accelerator: true,
  });
  let acceptedPair = false;
  simulation.onCrashAttribution = (source, victim) => {
    if (source === attacker && victim === target) acceptedPair = true;
  };
  simulation.applyImpactDamage([impact(target, attacker, frontPoint(target))]);
  assert.equal(acceptedPair, true);
  const firstFace = target.crashRecord.firstContactFace;
  assert.equal(firstFace, 4);
  assert.equal(target.crashRecord.accumulator, 0);
  simulation.applyImpactDamage([impact(target, attacker, rearPoint(target))]);
  assert.equal(target.crashRecord.firstContactFace, firstFace);
  assert.equal(target.crashRecord.accumulator, 0);
});

function rearPoint(car) {
  const bounds = car.shapeVertices
    .flatMap((shape) => shape)
    .reduce((box, point) => box.expandByPoint(point), new Box3());
  return new Vector3(
    (bounds.min.x + bounds.max.x) / 2,
    (bounds.min.y + bounds.max.y) / 2,
    bounds.max.z,
  );
}

test("crash accumulation uses pre-protection scaled damage while immunity bypasses it", async (t) => {
  const target = await eagle(t, true);
  const attacker = await eagle(t, true);
  const immune = await eagle(t, true);
  if (!target || !attacker || !immune) return;
  const simulation = await simWith(t, target, attacker, immune);
  simulation.crashClock = () => 1000;
  target.protection = 8;
  const expected = scaleImpactVectors(new Vector3(10, 0, 0), {
    human: target.human,
    hitCar: true,
    attackerHuman: attacker.human,
    receiverSoftness: target.damage.carSoftness,
    attackerSoftness: attacker.damage.carSoftness,
    armorLevel: target.armorLevel,
    offenseLevel: attacker.offenseLevel,
    armorFactor: target.armorFactor,
    offenseFactor: attacker.offenseFactor,
    damageMultiplier: attacker.damageMultiplier,
    protection: target.protection,
    sinceLastAttributedImpactMs: 0,
  }).accumulatedDamage;
  let targetPreProtection;
  simulation.onImpactPair = (a, b) => {
    if (a === target || b === target)
      targetPreProtection = target.crashRecord.accumulator;
  };
  simulation.applyImpactDamage([impact(target, attacker, frontPoint(target))]);
  assert.equal(targetPreProtection, Math.fround(expected.x * expected.x));
  assert.equal(
    target.crashRecord.accumulator,
    0,
    "accepted pair cleans up after callback",
  );
  immune.damage.damageContext.invulnerable = true;
  let immuneFace = 7;
  simulation.onImpactPair = (a, b) => {
    if (a === immune || b === immune)
      immuneFace = immune.crashRecord.firstContactFace;
  };
  simulation.applyImpactDamage([impact(immune, attacker, frontPoint(immune))]);
  assert.equal(immuneFace, 4, "contact is recorded even when damage is immune");
  assert.equal(immune.crashRecord.accumulator, 0);
});
