import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Vector3 } from "three";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
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

function impact(a, b) {
  return {
    a,
    b,
    point: frontPoint(a),
    pointB: frontPoint(b),
    normal: new Vector3(1, 0, 0),
    normalImpulse: 1,
    closingSpeed: 2,
    tangentImpulse: new Vector3(),
  };
}

function begin(car, speed, velocity, direction) {
  car.crashRecord.cachedSpeed = Math.fround(speed);
  if (direction) car.crashRecord.cachedDirection.copy(direction);
  car.crashRecord.beginFrame(false, velocity);
  car.state.gear = car.human ? 1 : 0;
  car.crashAccelerationKey = car.human;
}

function writeLevels(car, entries) {
  car.damage.componentLevels.fill(0);
  for (const [index, level] of Object.entries(entries))
    car.damage.componentLevels[Number(index)] = level;
}

async function pairFixture(
  t,
  {
    rawAttacker = { 4: 2 },
    rawVictim = { 3: 10 },
    attackerLast = {},
    victimLast = {},
    headOn = false,
    spin = false,
    attackerHuman = true,
    victimHuman = false,
    awards = {
      creditsPerDamage: [15, 13, 11],
      secondsPerDamage: [1, 0.75, 0.5],
    },
  } = {},
) {
  const attacker = await eagle(t, attackerHuman);
  const victim = await eagle(t, victimHuman);
  if (!attacker || !victim) return undefined;
  const scene = new Group();
  const simulation = new VehicleSimulation({}, scene);
  simulation.add(attacker);
  simulation.add(victim);
  simulation.crashDamageAwards = awards;
  simulation.crashClock = () => 0xfffffff0;
  begin(attacker, 0.01, new Vector3(0, 0, -10), new Vector3(0, 0, -1));
  begin(
    victim,
    0.005,
    new Vector3(0, 0, 1),
    headOn ? new Vector3(0, 0, 1) : new Vector3(0, 0, -1),
  );
  if (spin) victim.state.angularVelocity.y = 7;
  for (const [index, level] of Object.entries(attackerLast))
    attacker.damage.lastComponentLevels[Number(index)] = level;
  for (const [index, level] of Object.entries(victimLast))
    victim.damage.lastComponentLevels[Number(index)] = level;

  const order = [];
  for (const [car, raw] of [
    [attacker, rawAttacker],
    [victim, rawVictim],
  ]) {
    const apply = car.damage.applyImpact.bind(car.damage);
    car.damage.applyImpact = (...args) => {
      order.push(car);
      const result = apply(...args);
      // Keep the real damage path, then set deterministic raw component output
      // for the earnings coupling under test.
      writeLevels(car, raw);
      return result;
    };
  }
  return { attacker, victim, simulation, order };
}

async function hit(fixture) {
  fixture.simulation.applyImpactDamage([
    impact(fixture.attacker, fixture.victim),
  ]);
}

test("human-selected pair redistributes raw component levels before awarding and keeps raw attacker wastage", async (t) => {
  const fixture = await pairFixture(t, {
    rawAttacker: { 0: 99 },
    rawVictim: { 3: 10 },
    attackerLast: { 0: 98 },
    victimLast: { 3: 0 },
  });
  if (!fixture) return;
  const { attacker, victim, simulation, order } = fixture;
  const callbacks = [];
  const awards = [];
  const events = [];
  simulation.onImpactPair = () => {
    assert.deepEqual(order, [attacker, victim]);
    assert.equal(attacker.damage.componentLevels[0], 99);
    assert.equal(victim.damage.componentLevels[3], 10);
  };
  simulation.onCrashAttribution = (source, target) => {
    assert.equal(source, attacker);
    assert.equal(target, victim);
    assert.equal(source.damage.componentLevels[0], 99);
    assert.equal(target.damage.componentLevels[3], 10);
    assert.equal(source.damage.lastComponentLevels[0], 98);
    assert.equal(target.damage.lastComponentLevels[3], 0);
    callbacks.push([source, target]);
  };
  simulation.onWasted = (car) => events.push(["wasted", car]);
  simulation.onCrashDamageAward = (...args) => {
    awards.push(args);
    events.push(["award", args[0]]);
  };

  await hit(fixture);

  assert.deepEqual(callbacks, [[attacker, victim]]);
  assert.equal(attacker.knackered, true);
  assert.equal(attacker.damage.componentLevels[0], 98);
  assert.equal(victim.damage.componentLevels[3], 20);
  assert.equal(awards.length, 1);
  assert.equal(awards[0][0], victim);
  assert.deepEqual(awards[0].slice(1), [300, 20, 1]);
  assert.equal(events.length, 2);
  assert.deepEqual(events[0], ["wasted", attacker]);
  assert.deepEqual(events[1], ["award", victim]);
  assert.equal(victim.damage.lastComponentLevels[3], 20);
  assert.equal(victim.crashHistory.lastAttacker, attacker.group.uuid);
  assert.equal(victim.crashHistory.lastMs, 0xfffffff0);
});

for (const [label, modifier, expectedMultiplier, expectedCredits] of [
  ["spin", { spin: true }, 2, 600],
  ["head-on", { headOn: true }, 2, 600],
]) {
  test(`${label} doubles credits without changing damage time`, async (t) => {
    const fixture = await pairFixture(t, modifier);
    if (!fixture) return;
    const awards = [];
    fixture.simulation.onCrashDamageAward = (...args) => awards.push(args);

    await hit(fixture);

    assert.equal(awards.length, 1);
    assert.equal(awards[0][0], fixture.victim);
    assert.deepEqual(awards[0].slice(1), [
      expectedCredits,
      20,
      expectedMultiplier,
    ]);
  });
}

test("unwasted damage awards cap credits and time while retaining all component deltas", async (t) => {
  const victimLevels = { 3: 99, 4: 99, 5: 99, 6: 99, 7: 99 };
  const fixture = await pairFixture(t, { rawVictim: victimLevels });
  if (!fixture) return;
  const awards = [];
  fixture.simulation.onCrashDamageAward = (...args) => awards.push(args);

  await hit(fixture);

  assert.equal(awards.length, 1);
  assert.equal(awards[0][0], fixture.victim);
  assert.deepEqual(awards[0].slice(1), [2000, 90, 1]);
  for (const index of [3, 4, 5, 6, 7]) {
    assert.equal(fixture.victim.damage.componentLevels[index], 99);
    assert.equal(fixture.victim.damage.lastComponentLevels[index], 99);
  }
});

test("unpaid nonwasting delta leaves its baseline until the next outer frame", async (t) => {
  const fixture = await pairFixture(t, {
    rawVictim: { 3: 10 },
    awards: { creditsPerDamage: [0, 0, 0], secondsPerDamage: [1, 1, 1] },
  });
  if (!fixture) return;
  const awards = [];
  fixture.simulation.onCrashDamageAward = (...args) => awards.push(args);

  await hit(fixture);

  assert.deepEqual(awards, []);
  assert.equal(fixture.victim.damage.componentLevels[3], 20);
  assert.equal(fixture.victim.damage.lastComponentLevels[3], 0);

  fixture.victim.damage.componentLevels[3] = 27;
  fixture.simulation.step = () => {};
  fixture.simulation.updateFrame(0, 16);
  assert.equal(fixture.victim.damage.lastComponentLevels[3], 27);
});

test("a wasted victim advances its baseline even when raw credits are zero", async (t) => {
  const fixture = await pairFixture(t, {
    rawVictim: { 0: 99 },
    awards: { creditsPerDamage: [0, 0, 0], secondsPerDamage: [0, 0, 0] },
  });
  if (!fixture) return;
  const awards = [];
  fixture.simulation.onCrashDamageAward = (...args) => awards.push(args);

  await hit(fixture);

  assert.equal(fixture.victim.knackered, true);
  assert.deepEqual(awards, []);
  assert.equal(fixture.victim.damage.componentLevels[0], 99);
  assert.equal(fixture.victim.damage.lastComponentLevels[0], 99);
});

test("AI redistribution can create a wasted victim without setting knackered before its native damage check", async (t) => {
  const fixture = await pairFixture(t, {
    attackerHuman: false,
    victimHuman: true,
    rawAttacker: { 4: 2 },
    rawVictim: { 0: 50 },
    victimLast: { 0: 1 },
  });
  if (!fixture) return;
  const { attacker, victim, simulation } = fixture;
  const awards = [];
  const wastes = [];
  simulation.onCrashDamageAward = (...args) => awards.push(args);
  simulation.onWasted = (car) => wastes.push(car);

  await hit(fixture);

  assert.equal(attacker.human, false);
  assert.equal(victim.damage.componentLevels[0], 99);
  assert.equal(victim.damage.wasted, true);
  assert.equal(victim.knackered, false);
  assert.equal(victim.wastedAt, undefined);
  assert.deepEqual(awards, []);
  assert.deepEqual(wastes, []);

  // The registered DamageSystem hook is the next native CheckDamage boundary.
  victim.damage.onWastageCheck();
  assert.equal(victim.knackered, true);
});

test("spin bonus uses body-local omega axes for a rolled victim", async (t) => {
  const fixture = await pairFixture(t);
  if (!fixture) return;
  const { victim, simulation } = fixture;
  // A 90-degree roll swaps body X and world Y. Local X5 qualifies even
  // though world Y5 would fail the native local-Y threshold6.
  victim.state.orientation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
  victim.state.angularVelocity.set(0, 5, 0);
  const awards = [];
  simulation.onCrashDamageAward = (...args) => awards.push(args);
  await hit(fixture);
  assert.deepEqual(awards[0].slice(1), [600, 20, 2]);
});

test("filtered mine damage checks already-saturated AI-redistributed components even when its small increment is rejected", async (t) => {
  const fixture = await pairFixture(t, {
    attackerHuman: false,
    victimHuman: true,
    rawVictim: { 0: 50 },
    victimLast: { 0: 1 },
  });
  if (!fixture) return;
  const { victim, simulation } = fixture;
  await hit(fixture);
  assert.equal(victim.knackered, false);
  assert.equal(victim.damage.componentLevels[0], 99);
  simulation.handleMineEvent({
    kind: "reaction",
    victim,
    mine: null,
    maxDamage: 1,
    deltaVelocity: new Vector3(),
    deltaAngularVelocity: new Vector3(),
    damageMode: "filtered",
    components: [{ unit: 0, magnitude: 5 }],
    creditOwner: null,
    wakeUntilMs: null,
  });
  assert.equal(victim.damage.componentLevels[0], 99);
  assert.equal(victim.knackered, true);
});
