import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Vector3 } from "three";
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
    closingSpeed: 1,
    tangentImpulse: new Vector3(),
  };
}

function prepareFrontHit(target, player) {
  target.crashRecord.cachedSpeed = Math.fround(0.001);
  target.crashRecord.beginFrame(false, new Vector3(0, 0, 1));
  target.state.gear = 0;
  target.crashAccelerationKey = false;
  player.crashRecord.cachedSpeed = Math.fround(0.01);
  player.crashRecord.beginFrame(false, new Vector3(0, 0, -10));
  player.state.gear = 1;
  player.crashAccelerationKey = true;
}

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

test("eligible native front impact carries human attribution through a static impact only before 5000ms", async (t) => {
  for (const [now, expectedCulprit] of [
    [4999, true],
    [5000, false],
  ]) {
    const scenario = await targetAndPlayer(t);
    if (!scenario) return;
    const { target, player, simulation } = scenario;
    let pdNow = 0;
    simulation.crashClock = () => pdNow;
    prepareFrontHit(target, player);
    const spy = watchRealDamageAndForceWasted(target);
    assert.equal(target.lastAwardAttacker, undefined);
    assert.equal(target.lastAwardImpactMs, undefined);
    simulation.applyImpactDamage([impact(target, player)]);
    assert.ok(
      spy.calls.length > 0,
      "real damage handler received the player contact",
    );
    assert.equal(target.lastAwardAttacker?.group.uuid, player.group.uuid);
    assert.equal(target.lastAwardImpactMs, 0);
    assert.equal(
      target.damage.wasted,
      false,
      "the first low-force contact is not the forced transition",
    );

    pdNow = now;
    spy.wasteOnNextApply();
    simulation.applyImpactDamage([impact(target, undefined)]);
    assert.equal(target.damage.wasted, true);
    assert.equal(target.wastedByPlayer, expectedCulprit);
    if (expectedCulprit) assert.equal(target.lastAwardImpactMs, now);
  }
});

test("ordinary AI contacts preserve human attribution without refreshing its timestamp", async (t) => {
  const scenario = await targetAndPlayer(t);
  if (!scenario) return;
  const { target, player, simulation } = scenario;
  const ai = await originalEagle(t, false);
  if (!ai) return;
  let pdNow = 0;
  simulation.crashClock = () => pdNow;
  prepareFrontHit(target, player);
  const spy = watchRealDamageAndForceWasted(target);
  simulation.applyImpactDamage([impact(target, player)]);
  assert.equal(target.lastAwardAttacker?.group.uuid, player.group.uuid);
  assert.equal(target.lastAwardImpactMs, 0);

  pdNow = 1000;
  simulation.applyImpactDamage([impact(target, ai)]);
  assert.equal(target.lastAwardAttacker?.group.uuid, player.group.uuid);
  assert.equal(
    target.lastAwardImpactMs,
    0,
    "ordinary AI contact does not replace the saved human or refresh the 5s window",
  );

  pdNow = 2000;
  spy.wasteOnNextApply();
  simulation.applyImpactDamage([impact(target, undefined)]);
  assert.equal(target.damage.wasted, true);
  assert.equal(
    target.wastedByPlayer,
    true,
    "static-world continuation within 5s retains the earlier human culprit",
  );
});

test("an AI contact that directly wastes a car is not player-attributed", async (t) => {
  const target = await originalEagle(t, false);
  if (!target) return;
  const ai = await originalEagle(t, false);
  if (!ai) return;
  const simulation = new VehicleSimulation({}, new Group());
  const spy = watchRealDamageAndForceWasted(target);

  spy.wasteOnNextApply();
  simulation.applyImpactDamage([impact(target, ai)]);

  assert.equal(target.damage.wasted, true);
  assert.equal(target.lastAwardAttacker, undefined);
  assert.equal(target.lastAwardImpactMs, undefined);
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
  target.knackered = true;
  target.wastedByPlayer = false;
  const simulation = new VehicleSimulation({}, new Group());
  simulation.crashClock = () => 1000;
  prepareFrontHit(target, player);
  simulation.applyImpactDamage([impact(target, player)]);
  assert.equal(target.damage.wasted, true);
  assert.equal(
    target.lastAwardAttacker?.group.uuid,
    player.group.uuid,
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
