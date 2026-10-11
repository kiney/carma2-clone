import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Vector3 } from "three";
import { DamageSystem } from "../src/damage.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { WorldCollision } from "../src/world.ts";
import { originalCar } from "./support/original-car.mjs";

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

function prop() {
  const actor = new Group();
  actor.name = "&07c0001.ACT";
  const mechanics = parseNonCarMechanics(
    "101\n7\n0,0,0\n0,-.1,0\n1\nbox\n-.1,-.1,-.1\n.1,.1,.1\n.1,2\n.2,.2,.2\n0\n0\n0\n\nEND",
  );
  return createNonCarBody(actor, mechanics);
}

function carImpact(car, other, impulse = 1, reversed = false) {
  const carPoint = frontPoint(car);
  const otherPoint = other.state.position.clone();
  return {
    a: reversed ? other : car,
    b: reversed ? car : other,
    point: reversed ? otherPoint : carPoint,
    pointB: reversed ? carPoint : otherPoint,
    normal: new Vector3(1, 0, 0),
    normalImpulse: impulse,
    closingSpeed: 2,
    tangentImpulse: new Vector3(),
  };
}

function bodyImpact(a, b, impulse = 1) {
  return {
    a,
    b,
    point: a.state.position.clone(),
    pointB: b.state.position.clone(),
    normal: new Vector3(1, 0, 0),
    normalImpulse: impulse,
    closingSpeed: 2,
    tangentImpulse: new Vector3(),
  };
}

function detachedPart(owner, joint = undefined) {
  return {
    owner,
    part: 12,
    joint,
    state: { position: new Vector3() },
    actor: new Group(),
    hulls: [],
  };
}

function begin(car) {
  car.crashRecord.cachedSpeed = Math.fround(0.01);
  car.crashRecord.beginFrame(false, new Vector3(0, 0, -10));
  car.state.gear = 1;
  car.crashAccelerationKey = true;
}

async function setup(t) {
  const human = await eagle(t, true);
  const rival = await eagle(t);
  const propBody = prop();
  if (!human || !rival) return undefined;
  const scene = new Group();
  const sim = new VehicleSimulation(new WorldCollision(scene), scene);
  sim.add(human);
  sim.add(rival);
  sim.addNonCar(propBody);
  begin(human);
  begin(rival);
  return { human, rival, propBody, sim };
}

test("world prop keeps its first human owner and attributes a later reversed hit after 5000ms", async (t) => {
  const setupResult = await setup(t);
  if (!setupResult) return;
  const { human, rival, propBody, sim } = setupResult;
  let now = 100;
  sim.crashClock = () => now;
  const awards = [];
  sim.onCrashAttribution = (attacker, victim) =>
    awards.push([attacker, victim]);

  // The owner contacts its own prop first; that contact cannot create an
  // attacker pointer for the human's own crash history.
  sim.applyImpactDamage([carImpact(human, propBody)]);
  assert.equal(human.crashHistory.lastAttacker, null);
  assert.deepEqual(awards, []);

  // A later car can strike the same prop without replacing the original owner.
  now = 6001;
  sim.applyImpactDamage([carImpact(rival, propBody, 1, true)]);

  assert.deepEqual(awards, [[human, rival]]);
  assert.equal(rival.crashHistory.lastAttacker, human.group.uuid);
  assert.equal(rival.crashHistory.lastMs, now);
  assert.equal(rival.crashHistory.previousAttacker, null);
  assert.equal(rival.crashHistory.previousMs, 0);
  assert.equal(rival.lastAwardAttacker, human);
  assert.equal(rival.lastAwardImpactMs, now);
});

for (const impulse of [0.019, Math.fround(0.02)]) {
  test(`world prop does not capture an owner at lambda ${impulse}`, async (t) => {
    const setupResult = await setup(t);
    if (!setupResult) return;
    const { human, rival, propBody, sim } = setupResult;
    let now = 100;
    sim.crashClock = () => now;
    const awards = [];
    sim.onCrashAttribution = (...pair) => awards.push(pair);

    sim.applyImpactDamage([carImpact(human, propBody, impulse)]);
    now = 200;
    sim.applyImpactDamage([carImpact(rival, propBody)]);

    assert.deepEqual(awards, []);
    assert.equal(rival.crashHistory.lastAttacker, null);
  });
}

test("a non-car owner inherited from another world prop stays ineligible", async (t) => {
  const setupResult = await setup(t);
  if (!setupResult) return;
  const { human, rival, propBody: firstProp, sim } = setupResult;
  const secondProp = prop();
  sim.addNonCar(secondProp);
  let now = 100;
  sim.crashClock = () => now;
  const awards = [];
  sim.onCrashAttribution = (...pair) => awards.push(pair);

  // Native owner slots are filled for both sides of the prop contact.
  sim.applyImpactDamage([bodyImpact(firstProp, secondProp)]);
  sim.applyImpactDamage([carImpact(human, secondProp)]);
  now = 200;
  sim.applyImpactDamage([carImpact(rival, secondProp)]);

  assert.deepEqual(awards, []);
  assert.equal(rival.crashHistory.lastAttacker, null);
});

test("a free part keeps its initialized original car owner, while a semi-detached part earns no credit", async (t) => {
  const setupResult = await setup(t);
  if (!setupResult) return;
  const { human, rival, sim } = setupResult;
  let now = 100;
  sim.crashClock = () => now;
  const awards = [];
  sim.onCrashAttribution = (attacker, victim) =>
    awards.push([attacker, victim]);

  const freePart = detachedPart(human);
  sim.applyImpactDamage([bodyImpact(human, freePart)]);
  assert.deepEqual(awards, [], "a free part cannot credit its own owner");
  now = 6001;
  sim.applyImpactDamage([bodyImpact(rival, freePart)]);
  assert.deepEqual(awards, [[human, rival]]);
  assert.equal(rival.crashHistory.lastAttacker, human.group.uuid);
  assert.equal(rival.crashHistory.lastMs, now);

  const semiVictim = await eagle(t);
  if (!semiVictim) return;
  sim.add(semiVictim);
  begin(semiVictim);
  const semiDetached = detachedPart(human, {});
  now = 100;
  sim.applyImpactDamage([bodyImpact(semiVictim, semiDetached)]);
  assert.equal(awards.length, 1);
  assert.equal(semiVictim.crashHistory.lastAttacker, null);
  assert.equal(semiVictim.crashHistory.lastMs, 0);
});
