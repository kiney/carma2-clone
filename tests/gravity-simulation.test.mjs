import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { applyGenericVolumeForces } from "../src/physics/volumes.ts";
import { resolveContactGroups } from "../src/physics/contact.ts";
import { WorldCollision } from "../src/world.ts";
import { originalCar } from "./support/original-car.mjs";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} != ${expected}`,
  );
const dt = 0.04;
function rigid(mass = 2) {
  return {
    state: {
      position: new Vector3(),
      orientation: new Quaternion(),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass,
      inertia: new Vector3(1, 1, 1),
      centerOfMass: new Vector3(),
      worldFriction: -1,
    },
  };
}
function genericExpected(mass, factor, volumeFactor = 1) {
  const raw = -(9.8 / 6.9) * factor * volumeFactor * dt;
  const drag = 1 - (Math.abs(raw) * dt * 0.0005000000237487257 * 6.9) / mass;
  return raw * drag;
}

test("generic PHIL gravity multiplies global once and retains model-unit drag", () => {
  for (const mass of [0.05, 2])
    for (const factor of [0, 0.2, 4]) {
      const body = rigid(mass);
      applyGenericVolumeForces(body, null, 1, dt, false, factor);
      near(body.state.velocity.y, genericExpected(mass, factor));
      near(body.state.velocity.x, 0);
      near(body.state.angularVelocity.length(), 0);
    }
  const submerged = rigid();
  applyGenericVolumeForces(
    submerged,
    { gravityMultiplier: 0.2, viscosityMultiplier: 2 },
    0.5,
    dt,
    false,
    4,
  );
  // viscosity2 * depth.5 gives the same drag coefficient as the dry case.
  near(submerged.state.velocity.y, genericExpected(2, 4, 0.1));
});

test("one simulation propagates global gravity into both original car force paths", async (t) => {
  const scene = new Group();
  const simulation = new VehicleSimulation(new WorldCollision(scene), scene);
  const cars = [];
  for (const [i, name] of ["EAGLE3", "buggy"].entries()) {
    let data;
    try {
      data = await originalCar(name);
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("Local original Eagle/buggy assets absent");
        return;
      }
      throw error;
    }
    const damage = new DamageSystem(data.assets, data.group, data.text);
    await damage.init();
    const car = createSimulatedCar(
      data.group,
      data.text,
      damage,
      new Vector3(i * 20, 50, 0),
      0,
      i === 0,
    );
    scene.add(car.group);
    simulation.add(car);
    cars.push(car);
  }
  for (const factor of [0, 0.2, 4]) {
    simulation.gravityMultiplier = factor;
    for (const car of cars) {
      car.state.velocity.set(0, 0, 0);
      car.state.angularVelocity.set(0, 0, 0);
    }
    simulation.step();
    assert.equal(simulation.lastImpacts.length, 0);
    for (const car of cars) {
      assert.equal(car.debug.grounded, 0);
      near(car.debug.force.y, -car.properties.mass * 10 * factor);
      const raw = (-10 * factor * dt) / 6.9;
      const drag =
        1 -
        (Math.abs(raw) * dt * 0.0005000000237487257 * 6.9) /
          car.properties.mass;
      near(car.state.velocity.y, raw * drag);
      near(car.state.globalGravityMultiplier, factor);
      assert.equal(car.state.settlingVolumeGravity, undefined);
    }
  }
  // Supply controlled volume observations at the simulation/motion boundary:
  // acceleration depends on depth, whereas native settling reads raw gravity.
  simulation.gravityMultiplier = 0.2;
  const volume = {
    gravityMultiplier: 0.2,
    viscosityMultiplier: 0,
    materialModifierIndex: 0,
  };
  for (const depth of [0.1, 0.8])
    for (const ability of [false, true]) {
      simulation.updateSpecialVolume = () => ({
        volume,
        automatic: null,
        depth,
      });
      for (const car of cars) {
        car.state.velocity.set(0, 0, 0);
        car.state.underwaterAbility = ability;
      }
      simulation.step();
      for (const car of cars) {
        const accelerationFactor = 1 - 0.8 * depth * (ability ? 0.6 : 1);
        near(car.state.volumeGravityFactor, accelerationFactor);
        near(car.state.settlingVolumeGravity, ability ? 0.52 : 0.2);
        near(
          car.debug.force.y,
          -car.properties.mass * 10 * 0.2 * accelerationFactor,
        );
      }
    }
  // Installed41bb0b requires driver>5 before using the underwater divisor.
  for (const driver of [5, 6, 8]) {
    for (const car of cars) {
      car.state.driver = driver;
      car.state.underwaterAbility = true;
      car.state.velocity.set(0, 0, 0);
    }
    simulation.step();
    for (const car of cars)
      near(car.state.settlingVolumeGravity, driver > 5 ? 0.52 : 0.2);
  }
});

test("custom noncar gravity reads raw volume independently of depth and global powerup", () => {
  // Native4183d2 reads volume+88 directly. The custom motor/gravity path
  // does not read global74b348; generic ProcessGravity is a separate consumer.
  const mechanics = parseNonCarMechanics(
    "101\n7\n0,0,0\n0,0,0\n1\nbox\n-.1,-.1,-.1\n.1,.1,.1\n2,2\n.2,.2,.2\n0\n0\n0\nEND",
  );
  for (const depth of [0.1, 0.8])
    for (const factor of [0, 0.2, 4]) {
      const scene = new Group();
      const actor = new Group();
      actor.name = "&07!0001.ACT";
      actor.position.y = 50;
      scene.add(actor);
      const body = createNonCarBody(actor, mechanics);
      const simulation = new VehicleSimulation(
        new WorldCollision(scene),
        scene,
      );
      simulation.addNonCar(body);
      assert.ok(simulation.admitNonCar(body, { wake: true }));
      body.motor.sleeping = false;
      body.properties.immovable = false;
      simulation.gravityMultiplier = factor;
      const volume = { gravityMultiplier: 0.2, viscosityMultiplier: 0 };
      simulation.updateSpecialVolume = () => ({
        volume,
        automatic: null,
        depth,
      });
      simulation.step();
      assert.equal(simulation.lastImpacts.length, 0);
      near(body.state.velocity.y, (-dt * 10 * 0.2) / 6.9);
      near(body.state.velocity.x, 0);
      near(body.state.velocity.z, 0);
    }
});

test("simulation free-body force hook propagates global gravity for arbitrary masses", () => {
  const scene = new Group();
  const simulation = new VehicleSimulation(new WorldCollision(scene), scene);
  // Exercise the common detached/mine force hook independently of lifecycle
  // and explosion conditions; the native consumer is ProcessGravity4b6c60.
  for (const factor of [0, 0.2, 4]) {
    simulation.gravityMultiplier = factor;
    for (const mass of [0.05, 2]) {
      const body = rigid(mass);
      const environment = { volume: null, automatic: null, depth: 1 };
      simulation.updateSpecialVolume = () => environment;
      simulation.applyFreeBodyForces(body);
      near(body.state.velocity.y, genericExpected(mass, factor));
    }
  }
});

test("simulation pinball callback kicks resting world rows before the solver applies impulses", () => {
  const scene = new Group();
  const simulation = new VehicleSimulation(new WorldCollision(scene), scene);
  simulation.pinballFactor = 1;
  const body = rigid();
  // A candidate penetration produces a resting constraint with zero closing
  // speed, which the ordinary crush callback intentionally ignores.
  body.state.predictedPosition = new Vector3(0, -0.002, 0);
  body.state.predictedOrientation = body.state.orientation.clone();
  let callbackKick = 0;
  const rows = resolveContactGroups(
    [
      {
        a: body,
        point: new Vector3(),
        normal: new Vector3(0, 1, 0),
        sourceType: 1,
      },
    ],
    dt,
    [],
    (impacts, joints) => {
      const result = simulation.processImpactDamage(impacts, joints, []);
      callbackKick = body.state.velocity.y;
      return result;
    },
  );
  assert.equal(rows[0].closingSpeed, 0);
  assert.ok(rows[0].normalImpulse > 0.0002);
  near(
    callbackKick,
    (rows[0].normalImpulse * 6.9 * 0.20000000298023224) / body.properties.mass,
  );
  near(
    body.state.velocity.y,
    callbackKick + rows[0].normalImpulse / body.properties.mass,
  );

  const a = rigid(),
    b = rigid();
  a.state.velocity.y = -1;
  const pair = resolveContactGroups(
    [{ a, b, point: new Vector3(), normal: new Vector3(0, 1, 0) }],
    dt,
    [],
    (impacts, joints) => simulation.processImpactDamage(impacts, joints, []),
  );
  near(a.state.velocity.y, -1 + pair[0].normalImpulse / a.properties.mass);
  near(b.state.velocity.y, -pair[0].normalImpulse / b.properties.mass);
});
