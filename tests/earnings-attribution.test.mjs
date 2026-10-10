import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { createRace, awardRaceCredits } from "../src/gameplay.ts";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";

async function originalEagle(t, human) {
  let data;
  try {
    data = await originalCar("EAGLE3");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original data absent");
      return undefined;
    }
    throw error;
  }
  const damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  damage.damageContext.random = () => 0.5;
  const body = createSimulatedCar(
    data.group,
    data.text,
    damage,
    new Vector3(),
    0,
    human,
  );
  return body;
}

const impact = (a, b) => ({
  a,
  b,
  point: new Vector3(0, 0.2, 0),
  pointB: new Vector3(0, 0.2, 0),
  normal: new Vector3(1, 0, 0),
  normalImpulse: 1,
  closingSpeed: 1,
  tangentImpulse: new Vector3(),
});

function watchRealDamageAndForceWasted(body) {
  const realApply = body.damage.applyImpact.bind(body.damage);
  let forceNextTransition = false;
  const calls = [];
  body.damage.applyImpact = (...args) => {
    calls.push(args);
    const result = realApply(...args);
    if (forceNextTransition) {
      forceNextTransition = false;
      body.damage.componentLevels[0] = 99;
    }
    return result;
  };
  return {
    calls,
    wasteOnNextApply() {
      forceNextTransition = true;
    },
  };
}

async function targetAndPlayer(t) {
  const target = await originalEagle(t, false);
  if (!target) return undefined;
  const player = await originalEagle(t, true);
  if (!player) return undefined;
  return { target, player, simulation: new VehicleSimulation({}, new Group()) };
}

test("wasted-car attribution carries a human culprit through a static impact only before 5000ms", async (t) => {
  for (const [elapsed, expectedCulprit] of [
    [4.999, true],
    [5, false],
  ]) {
    const scenario = await targetAndPlayer(t);
    if (!scenario) return;
    const { target, player, simulation } = scenario;
    const spy = watchRealDamageAndForceWasted(target);
    assert.equal(target.lastAwardAttacker, undefined);
    assert.equal(target.lastAwardImpactMs, undefined);
    simulation.applyImpactDamage([impact(target, player)]);
    assert.ok(
      spy.calls.length > 0,
      "real damage handler received the player contact",
    );
    assert.equal(target.lastAwardAttacker, player);
    assert.equal(target.lastAwardImpactMs, 0);
    assert.equal(
      target.damage.wasted,
      false,
      "the first low-force contact is not the forced transition",
    );

    simulation.elapsed = elapsed;
    spy.wasteOnNextApply();
    simulation.applyImpactDamage([impact(target, undefined)]);
    assert.equal(target.damage.wasted, true);
    assert.equal(target.wastedByPlayer, expectedCulprit);
    if (expectedCulprit) assert.equal(target.lastAwardImpactMs, 4999);
  }
});

test("AI direct contact overwrites player attribution before a static-world waste", async (t) => {
  const scenario = await targetAndPlayer(t);
  if (!scenario) return;
  const { target, player, simulation } = scenario;
  const ai = await originalEagle(t, false);
  if (!ai) return;
  const spy = watchRealDamageAndForceWasted(target);
  simulation.applyImpactDamage([impact(target, player)]);
  assert.equal(target.lastAwardAttacker, player);
  simulation.elapsed = 1;
  simulation.applyImpactDamage([impact(target, ai)]);
  assert.equal(target.lastAwardAttacker, ai);
  assert.equal(target.lastAwardImpactMs, 1000);

  simulation.elapsed = 2;
  spy.wasteOnNextApply();
  simulation.applyImpactDamage([impact(target, undefined)]);
  assert.equal(target.damage.wasted, true);
  assert.equal(target.wastedByPlayer, false);
});

test("time-zero static impact without a recorded attacker grants no player-waste attribution", async (t) => {
  const target = await originalEagle(t, false);
  if (!target) return;
  const simulation = new VehicleSimulation({}, new Group());
  const spy = watchRealDamageAndForceWasted(target);
  spy.wasteOnNextApply();
  simulation.applyImpactDamage([impact(target, undefined)]);
  assert.equal(target.damage.wasted, true);
  assert.equal(target.wastedByPlayer, false);
  assert.equal(target.lastAwardAttacker, undefined);
  assert.equal(target.lastAwardImpactMs, undefined);
});

test("already-wasted cars keep their original culprit when hit by the player", async (t) => {
  const target = await originalEagle(t, false);
  if (!target) return;
  const player = await originalEagle(t, true);
  if (!player) return;
  target.damage.componentLevels[0] = 99;
  target.wastedByPlayer = false;
  const simulation = new VehicleSimulation({}, new Group());
  simulation.applyImpactDamage([impact(target, player)]);
  assert.equal(target.damage.wasted, true);
  assert.equal(
    target.lastAwardAttacker,
    player,
    "direct attribution still records the latest attacker",
  );
  assert.equal(
    target.wastedByPlayer,
    false,
    "a non-transition cannot rewrite the waste culprit",
  );
});

test("race credits reject zero, finished, and awards-closed payouts", () => {
  const race = createRace([], { credits: 100 });
  assert.equal(awardRaceCredits(race, 0), false);
  assert.equal(race.credits, 100);
  assert.equal(awardRaceCredits(race, 50), true);
  assert.equal(race.credits, 150);
  race.awardsClosed = true;
  assert.equal(awardRaceCredits(race, 50), false);
  assert.equal(race.credits, 150);
  race.awardsClosed = false;
  race.status = "completed";
  assert.equal(awardRaceCredits(race, 50), false);
  assert.equal(race.credits, 150);
});
