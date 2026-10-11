import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";
import { WorldCollision } from "../src/world.ts";

async function originalEagle(t) {
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

function contact(
  a,
  b,
  normal,
  impulse,
  point = new Vector3(0, 0.2, 0),
  extra = {},
) {
  return {
    a,
    b,
    point: point.clone(),
    pointB: point.clone(),
    normal: normal.clone(),
    normalImpulse: impulse,
    closingSpeed: 3,
    tangentImpulse: new Vector3(),
    ...extra,
  };
}

test("first-seen unordered pairs batch both receiver calls before ordered callbacks", async (t) => {
  const [a, b, c] = await Promise.all([
    originalEagle(t),
    originalEagle(t),
    originalEagle(t),
  ]);
  if (!a || !b || !c) return;
  const scene = new Group();
  const simulation = new VehicleSimulation(new WorldCollision(scene), scene);
  simulation.add(a);
  simulation.add(b);
  simulation.add(c);

  const labels = new Map([
    [a, "A"],
    [b, "B"],
    [c, "C"],
  ]);
  const events = [];
  const received = new Map();
  for (const car of [a, b, c]) {
    const apply = car.damage.applyImpact.bind(car.damage);
    car.damage.applyImpact = (...args) => {
      const rows = received.get(car) ?? [];
      rows.push({
        force: args[1].clone(),
        contacts: args[0].map((point) => point.clone()),
        mean: args[6].clone(),
      });
      received.set(car, rows);
      return apply(...args);
    };
  }
  simulation.onImpact = (car, severity) =>
    events.push(`receiver:${labels.get(car)}:${severity}`);
  simulation.onImpactPair = (first, second) => {
    events.push(`pair:${labels.get(first)}${labels.get(second)}`);
    // Pair callback runs after both receivers for that pair have accumulated.
    assert.ok(first.crashRecord.accumulator > 0);
    assert.ok(second.crashRecord.accumulator > 0);
  };

  simulation.applyImpactDamage([
    contact(a, b, new Vector3(1, 0, 0), 2),
    contact(a, c, new Vector3(0, 1, 0), 3, undefined, { closingSpeed: 4 }),
    // Reversed body order joins the original AB pair; normal is reversed too.
    contact(b, a, new Vector3(-1, 0, 0), 4, new Vector3(0, 0.4, 0), {
      closingSpeed: 5,
    }),
  ]);

  assert.deepEqual(events, [
    "receiver:A:5",
    "receiver:B:5",
    "pair:AB",
    "receiver:A:4",
    "receiver:C:4",
    "pair:AC",
  ]);
  assert.equal(received.get(a).length, 2);
  assert.equal(received.get(b).length, 1);
  assert.equal(received.get(c).length, 1);

  // AI-vs-AI factor combines two .2 factors and the softness normalization.
  // Each EAGLE uses the same carSoftness, so this is .04 / 2 = .02.
  const factor = (0.2 * 0.2) / ((b.damage.carSoftness + 0.7) / 0.7);
  assert.ok(Math.abs(factor - 0.02) < 1e-12);
  assert.ok(Math.abs(received.get(a)[0].force.x - 0.12) < 1e-6);
  assert.ok(Math.abs(received.get(a)[1].force.y - 0.06) < 1e-6);
  assert.ok(Math.abs(received.get(b)[0].force.x + 0.12) < 1e-6);
  assert.ok(Math.abs(received.get(c)[0].force.y + 0.06) < 1e-6);
  assert.equal(received.get(a)[0].contacts.length, 2);
  assert.ok(Math.abs(received.get(a)[0].mean.y - 1 / 3) < 1e-6);
  // Largest closing speed is retained when a pair has multiple contacts.
});

test("discarded source-9 and zero-impulse contacts produce no pair callback", async (t) => {
  const [a, b] = await Promise.all([originalEagle(t), originalEagle(t)]);
  if (!a || !b) return;
  const scene = new Group();
  const simulation = new VehicleSimulation(new WorldCollision(scene), scene);
  simulation.add(a);
  simulation.add(b);
  const events = [];
  simulation.onImpact = (car) =>
    events.push(`receiver:${car === a ? "A" : "B"}`);
  simulation.onImpactPair = () => events.push("pair");
  simulation.applyImpactDamage([
    contact(a, b, new Vector3(1, 0, 0), 10, undefined, { sourceType: 9 }),
    contact(a, b, new Vector3(1, 0, 0), 0),
  ]);
  assert.deepEqual(events, []);
  assert.equal(a.crashRecord.accumulator, 0);
  assert.equal(b.crashRecord.accumulator, 0);
});
