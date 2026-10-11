import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";

const emptyWorld = {
  raycast() {
    return null;
  },
  querySurfaces() {
    return [];
  },
};

async function makeCar(t, position) {
  let data;
  try {
    data = await originalCar("EAGLE3");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original car archives are absent");
      return undefined;
    }
    throw error;
  }
  const group = data.group.clone(true);
  const damage = new DamageSystem(data.assets, group, data.text);
  await damage.init();
  damage.damageContext.random = () => 0.5;
  return createSimulatedCar(group, data.text, damage, position, 0, false);
}

test("inactive cars remain registered and rendered but are absent from physics until explicitly reactivated", async (t) => {
  const first = await makeCar(t, new Vector3(0, 20, 0));
  if (!first) return;
  const second = await makeCar(t, new Vector3(0, 20, 0));
  if (!second) return;
  const scene = new Group();
  const simulation = new VehicleSimulation(emptyWorld, scene);
  simulation.add(first);
  simulation.add(second);
  const originalGroup = second.group;
  const originalDamage = second.damage;
  const originalHulls = second.hulls;
  second.state.velocity.set(3, 4, 5);
  second.state.angularVelocity.set(1, 2, 3);
  second.state.curvature = 0.25;
  second.state.turnSpeed = 0.5;
  second.state.speed = 12;
  second.state.gear = 3;
  second.state.rpm = 3000;
  second.state.tractionRpm = 2500;
  second.state.slipping = 0.75;
  second.state.accForce = 50;
  second.state.brakeForce = 25;
  second.input = { throttle: 1, steer: 1, brake: 1, handbrake: true };

  simulation.setCarPhysicsActive(second, false);
  assert.equal(simulation.phil.getState(second), 0);
  assert.equal(simulation.isCarPhysicsActive(first), true);
  assert.equal(simulation.isCarPhysicsActive(second), false);
  assert.equal(simulation.cars.includes(second), true);
  assert.equal(second.group, originalGroup);
  assert.equal(second.damage, originalDamage);
  assert.equal(second.hulls, originalHulls);
  assert.deepEqual(second.state.velocity.toArray(), [0, 0, 0]);
  assert.deepEqual(second.state.angularVelocity.toArray(), [0, 0, 0]);
  assert.equal(second.state.curvature, 0);
  assert.equal(second.state.speed, 0, "derived browser speed is invalidated");
  assert.equal(second.state.turnSpeed, 0.5);
  assert.equal(second.state.gear, 3);
  assert.equal(second.state.rpm, 3000);
  assert.equal(second.state.tractionRpm, 2500);
  assert.equal(second.state.slipping, 0.75);
  assert.equal(second.state.accForce, 0);
  assert.equal(second.state.brakeForce, 0);
  assert.deepEqual(second.input, {
    throttle: 0,
    steer: 0,
    brake: 0,
    handbrake: false,
  });

  const frozenPose = second.state.position.clone();
  simulation.step();
  assert.ok(first.state.position.y < 20, "active body continues integrating");
  assert.deepEqual(second.state.position.toArray(), frozenPose.toArray());
  assert.ok(
    simulation.lastImpacts.every(
      (impact) => impact.a !== second && impact.b !== second,
    ),
    "inactive car must not enter car-car or world contact solving",
  );

  simulation.setCarPhysicsActive(second, true);
  assert.equal(simulation.phil.getState(second), 2);
  assert.equal(simulation.isCarPhysicsActive(second), true);
  simulation.step();
  assert.ok(second.state.position.y < frozenPose.y);
  assert.equal(second.group, originalGroup);
  assert.equal(second.damage, originalDamage);
  assert.equal(second.hulls, originalHulls);
  assert.throws(
    () => simulation.setCarPhysicsActive({ ...second }, false),
    /unregistered car/,
  );
  simulation.dispose();
});

test("attached fragments sleep with an inactive parent while detached debris keeps moving", async (t) => {
  const car = await makeCar(t, new Vector3(0, 20, 0));
  if (!car) return;
  const simulation = new VehicleSimulation(emptyWorld, new Group());
  simulation.add(car);
  const attachedPart = car.damage.runtimeParts.find(
    (part) =>
      part.state.phase === 0 &&
      part.state.type !== 2 &&
      !part.forcedFullDetach &&
      part.state.queuedAt === null,
  );
  const detachedPart = car.damage.runtimeParts.find(
    (part) => part.state.phase === 0 && part.state.type === 2,
  );
  assert.ok(attachedPart, "fixture car has an ordinary jointed part");
  assert.ok(detachedPart, "fixture car has a free debris part");
  attachedPart.state.queuedAt = 0;
  detachedPart.state.queuedAt = 0;
  simulation.step();
  const attached = simulation.debris.find(
    (body) => body.part >= 0 && body.actor === attachedPart.actor,
  );
  const detached = simulation.debris.find(
    (body) => body.part >= 0 && body.actor === detachedPart.actor,
  );
  assert.ok(attached?.joint, "ordinary debris keeps its native joint");
  assert.equal(
    detached?.joint,
    undefined,
    "type-2 debris is independently free",
  );

  simulation.setCarPhysicsActive(car, false);
  const attachedPose = attached.state.position.clone();
  const attachedVelocity = attached.state.velocity.clone();
  const detachedPose = detached.state.position.clone();
  simulation.step();
  assert.deepEqual(attached.state.position.toArray(), attachedPose.toArray());
  assert.deepEqual(
    attached.state.velocity.toArray(),
    attachedVelocity.toArray(),
  );
  assert.notDeepEqual(
    detached.state.position.toArray(),
    detachedPose.toArray(),
  );
  simulation.dispose();
});
