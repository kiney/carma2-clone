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
  const point = frontPoint(a);
  return {
    a,
    b,
    point,
    pointB: b ? frontPoint(b) : point.clone(),
    normal: new Vector3(1, 0, 0),
    normalImpulse: 1,
    closingSpeed: 2,
    tangentImpulse: new Vector3(),
  };
}

function begin(car, speed, velocity, { gear = 0, key = false } = {}) {
  car.crashRecord.cachedSpeed = Math.fround(speed);
  car.crashRecord.beginFrame(false, velocity);
  car.state.gear = gear;
  car.crashAccelerationKey = key;
}

async function simulation(t, ...cars) {
  if (cars.some((car) => !car)) return undefined;
  const sim = new VehicleSimulation({}, new Group());
  for (const car of cars) sim.add(car);
  return sim;
}

test("live eligible front hit attributes after both receiver damage paths and stamps raw PD time", async (t) => {
  const victim = await eagle(t);
  const player = await eagle(t, true);
  const sim = await simulation(t, victim, player);
  if (!sim) return;
  const pdNow = 0xfffffff0;
  sim.crashClock = () => pdNow;
  begin(victim, 0.001, new Vector3(0, 0, 1));
  begin(player, 0.01, new Vector3(0, 0, -10), { gear: 1, key: true });
  sim.elapsed = 321.75;

  const receiverOrder = [];
  for (const car of [victim, player]) {
    const apply = car.damage.applyImpact.bind(car.damage);
    car.damage.applyImpact = (...args) => {
      receiverOrder.push(car);
      return apply(...args);
    };
  }
  let pairSawDamage = false;
  sim.onImpactPair = (a, b) => {
    assert.equal(a, victim);
    assert.equal(b, player);
    pairSawDamage =
      receiverOrder.length === 2 &&
      victim.crashRecord.accumulator > 0 &&
      player.crashRecord.accumulator > 0;
  };
  let selected;
  sim.onCrashAttribution = (attacker, target) => {
    selected = [attacker, target];
    assert.deepEqual(receiverOrder, [victim, player]);
    assert.ok(target.crashRecord.accumulator > 0);
  };

  sim.applyImpactDamage([impact(victim, player)]);

  assert.equal(pairSawDamage, true);
  assert.deepEqual(selected, [player, victim]);
  assert.equal(victim.crashHistory.lastAttacker, player.group.uuid);
  assert.equal(victim.crashHistory.lastMs, pdNow);
  assert.equal(victim.crashHistory.previousAttacker, player.group.uuid);
  assert.equal(victim.crashHistory.previousMs, pdNow);
  assert.equal(victim.lastAttributedImpactMs, pdNow);
  assert.equal(victim.crashRecord.accumulator, 0);
  assert.equal(player.crashRecord.accumulator, 0);
  assert.equal(
    sim.elapsed,
    321.75,
    "raw platform time is independent of physics elapsed",
  );
});

test("a stationary human collision does not receive an unconditional award", async (t) => {
  const player = await eagle(t, true);
  const rival = await eagle(t);
  const sim = await simulation(t, rival, player);
  if (!sim) return;
  sim.crashClock = () => 9000;
  begin(rival, 0.001, new Vector3(0, 0, 1));
  begin(player, 0.001, new Vector3(0, 0, 0));
  let attributions = 0;
  sim.onCrashAttribution = () => attributions++;

  sim.applyImpactDamage([impact(rival, player)]);

  assert.equal(attributions, 0);
  assert.equal(rival.crashHistory.lastAttacker, null);
});

test("static continuation uses signed raw-clock ages across wrap and rejects at 5000", async (t) => {
  for (const [now, expected] of [
    [0x20, true], // unsigned subtraction wraps; signed age is 48ms
    [0x1378, false], // from 0xfffffff0 this is exactly 5000ms
  ]) {
    const victim = await eagle(t);
    const player = await eagle(t, true);
    const sim = await simulation(t, victim, player);
    if (!sim) return;
    sim.crashClock = () => now;
    sim.elapsed = now === 0x20 ? 50_000 : 0;
    victim.crashHistory.lastAttacker = player.group.uuid;
    victim.crashHistory.lastMs = 0xfffffff0;
    begin(victim, 0.001, new Vector3(0, 0, 1));
    let attributed = 0;
    sim.onCrashAttribution = (attacker, target) => {
      assert.equal(attacker, player);
      assert.equal(target, victim);
      attributed++;
    };

    sim.applyImpactDamage([impact(victim, undefined)]);

    assert.equal(attributed, Number(expected));
    if (expected) {
      assert.equal(victim.crashRecord.accumulator, 0);
      assert.equal(victim.crashHistory.lastMs, now);
      assert.equal(victim.crashHistory.previousMs, 0);
    } else {
      assert.ok(
        victim.crashRecord.accumulator > 0,
        "expired history exits before cleanup",
      );
      assert.equal(victim.crashHistory.lastMs, 0xfffffff0);
    }
  }
});

test("immunity preserves the first contact face while leaving no damage accumulation", async (t) => {
  const victim = await eagle(t);
  const player = await eagle(t, true);
  const sim = await simulation(t, victim, player);
  if (!sim) return;
  sim.crashClock = () => 400;
  victim.damage.damageContext.invulnerable = true;
  begin(victim, 0.001, new Vector3(0, 0, 1));
  begin(player, 0.01, new Vector3(0, 0, -10), { gear: 1, key: true });
  sim.applyImpactDamage([impact(victim, player)]);
  assert.equal(victim.crashRecord.firstContactFace, 4);
  assert.equal(victim.crashRecord.accumulator, 0);
});

test("accepted pairs clear accumulation between first-seen AB then AC callbacks", async (t) => {
  const a = await eagle(t, true);
  const b = await eagle(t);
  const c = await eagle(t);
  const sim = await simulation(t, a, b, c);
  if (!sim) return;
  sim.crashClock = () => 800;
  begin(a, 0.01, new Vector3(0, 0, -10), { gear: 1, key: true });
  begin(b, 0.001, new Vector3(0, 0, 1));
  begin(c, 0.001, new Vector3(0, 0, 1));
  const labels = new Map([
    [a, "A"],
    [b, "B"],
    [c, "C"],
  ]);
  const pairs = [];
  const selected = [];
  const attackerAccumulations = [];
  sim.onImpactPair = (first, second) => {
    pairs.push(`${labels.get(first)}${labels.get(second)}`);
  };
  sim.onCrashAttribution = (attacker, victim) => {
    selected.push(`${labels.get(attacker)}>${labels.get(victim)}`);
    attackerAccumulations.push(attacker.crashRecord.accumulator);
    assert.ok(attacker.crashRecord.accumulator > 0);
    assert.ok(victim.crashRecord.accumulator > 0);
  };

  sim.applyImpactDamage([impact(a, b), impact(a, c)]);

  assert.deepEqual(pairs, ["AB", "AC"]);
  assert.deepEqual(selected, ["A>B", "A>C"]);
  assert.equal(
    attackerAccumulations[1],
    attackerAccumulations[0],
    "identical one-unit pairs must not retain the preceding pair's accumulation",
  );
  assert.equal(a.crashRecord.accumulator, 0);
  assert.equal(b.crashRecord.accumulator, 0);
  assert.equal(c.crashRecord.accumulator, 0);
});
