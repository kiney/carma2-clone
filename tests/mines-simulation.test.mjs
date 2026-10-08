import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { Box3, Group, Vector3 } from "three";
import { WorldCollision } from "../src/world.ts";
import { DamageSystem } from "../src/damage.ts";
import { VehicleSimulation, createSimulatedCar } from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";

const emptyWorld = new WorldCollision(new Group());

async function stock(t, name, position = new Vector3(), human = false) {
  let data;
  try {
    data = await originalCar(name);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original car data absent");
      return null;
    }
    throw error;
  }
  const damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  return createSimulatedCar(data.group, data.text, damage, position, 0, human);
}

function mineFactory() {
  const actor = new Group();
  actor.name = "test mine";
  const bounds = new Box3(new Vector3(-0.2, -0.2, -0.2), new Vector3(0.2, 0.2, 0.2));
  return { actor, bounds, mass: 0.05 };
}

test("physical mine contact crushes a stock car locally and timed mines clean up", async (t) => {
  if (!existsSync("carma2_orig/data/CARS/EAGLE3.TWT") || !existsSync("carma2_orig/data/CARS/buggy.TWT")) {
    t.skip("Local original EAGLE3 and buggy data absent");
    return;
  }
  const owner = await stock(t, "buggy", new Vector3(20, 0, 0));
  const victim = await stock(t, "EAGLE3", new Vector3(), true);
  if (!owner || !victim) return;
  owner.damage.damageContext.random = () => 0.5;
  let seed = 12345;
  victim.damage.damageContext.random = () => {
    seed = (Math.imul(seed, 214013) + 2531011) >>> 0;
    return ((seed >>> 16) & 32767) / 32768;
  };
  const scene = new Group();
  scene.add(owner.group, victim.group);
  const simulation = new VehicleSimulation(emptyWorld, scene);
  simulation.add(owner);
  simulation.add(victim);
  simulation.mineFactory = mineFactory();
  const events = [];
  simulation.onMineEvent = (event) => events.push(event.kind);

  assert.equal(
    simulation.launchMine(owner, {
      lifetimeSeconds: 5,
      minimumUpImpulse: 2,
      maximumUpImpulse: 10,
      zAngularFactor: 2,
      xAngularFactor: 2,
      collisionForceThreshold: 0.7,
      launchUpVelocity: 0.5,
      launchZVelocity: 0.6,
      mortar: false,
    }, 52),
    true,
  );
  const body = simulation.mineBodies[0];
  body.state.position.copy(victim.state.position).add(new Vector3(0, 0.4, 0));
  body.state.velocity.set(0, -30, 0);
  body.state.predictedPosition = undefined;
  body.state.predictedOrientation = undefined;

  const shapeBefore = victim.shapeVertices.map((shape) => shape.map((p) => p.clone()));
  const componentsBefore = Array.from(victim.damage.componentLevels);
  simulation.step();
  simulation.step(); // Mine callbacks process deferred contact work at tick start.
  assert.ok(events.includes("crush"), `expected physical crush event, got ${events}`);
  assert.ok(events.includes("reaction"), `expected mine reaction event, got ${events}`);
  assert.ok(
    victim.damage.componentLevels.some((level, i) => level > componentsBefore[i]),
    "mine reaction damages stock car components",
  );
  assert.ok(
    victim.shapeVertices.some((shape, s) =>
      shape.some((p, i) => p.distanceTo(shapeBefore[s][i]) > 1e-7),
    ),
    `mine crush deforms the stock car shape; crush=${events}, softness=${victim.damage.carSoftness}`,
  );
  assert.ok(
    Array.from(owner.damage.componentLevels).every((level) => level === 0),
    "mine damage does not spread radially to another car",
  );
  victim.damage.repair();
  assert.ok(Array.from(victim.damage.componentLevels).every((level) => level === 0));
  for (let s = 0; s < shapeBefore.length; s++)
    for (let i = 0; i < shapeBefore[s].length; i++)
      assert.equal(victim.shapeVertices[s][i].distanceTo(shapeBefore[s][i]), 0);
  simulation.dispose();

  const timerScene = new Group();
  const timerOwner = await stock(t, "buggy", new Vector3());
  if (!timerOwner) return;
  timerScene.add(timerOwner.group);
  const timerSimulation = new VehicleSimulation(emptyWorld, timerScene);
  timerSimulation.add(timerOwner);
  timerSimulation.mineFactory = mineFactory();
  const timerEvents = [];
  timerSimulation.onMineEvent = (event) => timerEvents.push(event.kind);
  assert.equal(timerSimulation.launchMine(timerOwner, {
    lifetimeSeconds: 5,
    minimumUpImpulse: 2,
    maximumUpImpulse: 10,
    zAngularFactor: 2,
    xAngularFactor: 2,
    collisionForceThreshold: 0.7,
    launchUpVelocity: 0.5,
    launchZVelocity: 0.6,
    mortar: false,
  }, 52), true);
  for (let i = 0; i < 125; i++) timerSimulation.step();
  assert.equal(timerEvents.includes("explode"), false, "deadline is strict at five seconds");
  assert.equal(timerSimulation.mineBodies.length, 1);
  timerSimulation.step();
  assert.ok(timerEvents.includes("explode"));
  assert.equal(timerSimulation.mineBodies.length, 1, "exploded mine remains allocated during cleanup delay");
  for (let i = 0; i < 40; i++) timerSimulation.step();
  assert.equal(timerSimulation.mineBodies.length, 1, "1600ms cleanup deadline is strict");
  for (let i = 0; i < 2 && timerSimulation.mineBodies.length; i++) timerSimulation.step();
  assert.equal(timerSimulation.mineBodies.length, 0);
  timerSimulation.dispose();
});

test("direct mine powerup uses authored impulses and damages only its target", async (t) => {
  if (!existsSync("carma2_orig/data/CARS/EAGLE3.TWT") || !existsSync("carma2_orig/data/CARS/buggy.TWT")) {
    t.skip("Local original EAGLE3 and buggy data absent");
    return;
  }
  const target = await stock(t, "EAGLE3", new Vector3(), true);
  const bystander = await stock(t, "buggy", new Vector3(20, 0, 0));
  if (!target || !bystander) return;
  target.damage.damageContext.random = () => 0.5;
  const scene = new Group();
  scene.add(target.group, bystander.group);
  const simulation = new VehicleSimulation(emptyWorld, scene);
  simulation.add(target);
  simulation.add(bystander);
  const before = Array.from(target.damage.componentLevels);
  simulation.hitMine(target, [8, 15, 4, 4]);
  assert.ok(
    Math.abs(target.state.velocity.y - 11.5 / (target.properties.mass * 6.9)) < 1e-12,
    "direct mine hit uses the authored midpoint upward impulse",
  );
  assert.equal(target.state.angularVelocity.length(), 0, "midpoint random sample yields zero angular impulse");
  assert.ok(
    target.damage.componentLevels.some((level, i) => level > before[i]),
    "direct mine hit applies component damage",
  );
  assert.ok(Array.from(bystander.damage.componentLevels).every((level) => level === 0));
  assert.ok(bystander.state.velocity.length() === 0, "direct hit has no radial blast");
  simulation.dispose();
});
