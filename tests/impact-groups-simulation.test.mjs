import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Vector3 } from "three";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";

async function eagle(t) {
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
    false,
  );
}

function pointOnFront(car, offset = 0) {
  const bounds = car.shapeVertices
    .flatMap((shape) => shape)
    .reduce((box, point) => box.expandByPoint(point), new Box3());
  return new Vector3(
    (bounds.min.x + bounds.max.x) / 2 + offset,
    (bounds.min.y + bounds.max.y) / 2,
    bounds.min.z,
  );
}

function row(car, normal, lambda, options = {}) {
  const point = pointOnFront(car, options.offset ?? 0);
  return {
    a: car,
    b: undefined,
    point,
    pointB: point.clone(),
    normal: normal.clone(),
    normalImpulse: lambda,
    closingSpeed: options.closingSpeed ?? 0,
    tangentImpulse: new Vector3(),
  };
}

async function setup(t) {
  const car = await eagle(t);
  if (!car) return undefined;
  const sim = new VehicleSimulation({}, new Group());
  sim.add(car);
  sim.crashClock = () => 1000;
  const calls = [];
  const apply = car.damage.applyImpact.bind(car.damage);
  car.damage.applyImpact = (...args) => {
    calls.push({
      contacts: args[0].map((p) => p.clone()),
      damage: args[1].clone(),
    });
    return apply(...args);
  };
  return { car, sim, calls };
}

test("positive rest impulse reaches real damage despite zero closing speed", async (t) => {
  const fixture = await setup(t);
  if (!fixture) return;
  const { car, sim, calls } = fixture;
  let pairCallbacks = 0;
  sim.onImpactPair = () => pairCallbacks++;

  sim.applyImpactDamage([row(car, new Vector3(1, 0, 0), 0.03)]);

  assert.equal(calls.length, 1);
  assert.ok(calls[0].damage.x > 0);
  assert.equal(pairCallbacks, 1);
});

test("the strict Float32 lambda gate rejects equality and accepts the next Float32 value", async (t) => {
  for (const [lambda, expectedCalls] of [
    [Math.fround(0.02), 0],
    [Math.fround(0.02 + 2 ** -29), 1],
  ]) {
    const fixture = await setup(t);
    if (!fixture) return;
    const { car, sim, calls } = fixture;
    let pairs = 0;
    sim.onImpactPair = () => pairs++;
    sim.applyImpactDamage([row(car, new Vector3(1, 0, 0), lambda)]);
    assert.equal(calls.length, expectedCalls);
    assert.equal(pairs, expectedCalls);
  }
});

test("four geometric rows form one group and a fifth row starts the next damage call", async (t) => {
  const fixture = await setup(t);
  if (!fixture) return;
  const { car, sim, calls } = fixture;
  const rows = [
    row(car, new Vector3(1, 0, 0), 0.01, { offset: -0.04 }),
    row(car, new Vector3(1, 0, 0), 0.01, { offset: -0.02 }),
    row(car, new Vector3(1, 0, 0), 0.01, { offset: 0.02 }),
    row(car, new Vector3(1, 0, 0), 0.01, { offset: 0.04 }),
    row(car, new Vector3(1, 0, 0), 0.03),
  ];
  sim.applyImpactDamage(rows);

  const factor = car.damage.carSoftness * 0.2;
  assert.equal(calls.length, 2);
  assert.equal(calls[0].contacts.length, 4);
  assert.equal(calls[1].contacts.length, 1);
  assert.ok(Math.abs(calls[0].damage.x - 0.04 * factor) < 1e-7);
  assert.ok(Math.abs(calls[1].damage.x - 0.03 * factor) < 1e-7);
});

test("orthogonal normal forces stay in separate calls and preserve their raw vector components", async (t) => {
  const fixture = await setup(t);
  if (!fixture) return;
  const { car, sim, calls } = fixture;
  sim.applyImpactDamage([
    row(car, new Vector3(1, 0, 0), 0.03, { offset: -0.02 }),
    row(car, new Vector3(0, 1, 0), 0.04, { offset: 0.02 }),
  ]);

  const factor = car.damage.carSoftness * 0.2;
  assert.equal(calls.length, 2);
  assert.ok(Math.abs(calls[0].damage.x - 0.03 * factor) < 1e-7);
  assert.equal(calls[0].damage.y, 0);
  assert.equal(calls[0].damage.z, 0);
  assert.equal(calls[1].damage.x, 0);
  assert.ok(Math.abs(calls[1].damage.y - 0.04 * factor) < 1e-7);
  assert.equal(calls[1].damage.z, 0);
});
