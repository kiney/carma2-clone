import assert from "node:assert/strict";
import test from "node:test";
import { Group, Quaternion, Vector3 } from "three";
import { nativePickupMineKick } from "../src/physics/mines.ts";
import { NativeRandom, sharedNativeRandom } from "../src/native-random.ts";
import {
  VehicleSimulation,
  createSimulatedCar,
} from "../src/physics/simulation.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";
import { createMovingWorldBody } from "../src/physics/moving-world.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { WorldCollision } from "../src/world.ts";
import { DamageSystem } from "../src/damage.ts";
import { originalCar } from "./support/original-car.mjs";

const f32 = Math.fround;
const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} vs ${expected}`);
function kick(overrides = {}) {
  const samples = [0, 0.5, 0.75];
  let draws = 0;
  const result = nativePickupMineKick({
    flags: 0,
    physicsType: 5,
    mass: 2,
    velocity: new Vector3(1, 2, 3),
    omega: new Vector3(4, 5, 6),
    random: () => {
      assert.ok(draws < samples.length);
      return samples[draws++];
    },
    ...overrides,
  });
  return { result, draws };
}

test("pickup mine core uses three native draws, Float32 stores and body-Z then body-X order", () => {
  const { result, draws } = kick();
  assert.equal(draws, 3);
  assert.deepEqual(result.velocity.toArray(), [1, f32(2 + 1 / (2 * 6.9)), 3]);
  assert.deepEqual(result.omega.toArray(), [
    f32(4 + (0.25 * 2 * Math.PI) / 2),
    5,
    6,
  ]);
  const special = kick({ physicsType: 0x10 }).result;
  assert.equal(special.velocity.y, f32(2 + 3 / (2 * 6.9)));
  assert.equal(special.omega.x, f32(4 + (0.875 * 2 * Math.PI) / 2));
});

test("car-class fallback uses fixed .7..1 impulses rather than action30 parameters or damage/crush draws", () => {
  const car = kick({ flags: 0x10000 }).result;
  assert.equal(car.velocity.y, f32(2 + f32(0.7) / (2 * 6.9)));
  assert.equal(car.omega.x, f32(4 + (0.25 * 2 * Math.PI) / 2));
  assert.equal(kick({ flags: 0x10000, carImpulseEnabled: false }).result, null);
  assert.equal(kick({ flags: 0x10000, carImpulseEnabled: false }).draws, 0);
  assert.equal(
    kick({ flags: 0, carImpulseEnabled: false }).draws,
    3,
    "car-only gate cannot suppress noncar reaction",
  );
  for (const values of [{ mass: 0 }, { flags: -1 }, { physicsType: 256 }])
    assert.throws(() => kick(values), /pickup mine physics/);
  assert.throws(() => kick({ random: () => 1 }), /random sample/);
});

function prop() {
  const actor = new Group();
  actor.name = "&07!0001.ACT";
  return createNonCarBody(
    actor,
    parseNonCarMechanics(
      "101\n7\n0,0,0\n0,0,0\n1\nbox\n-.1,-.1,-.1\n.1,.1,.1\n2,2\n.2,.2,.2\n0\n0\n0\nEND",
    ),
  );
}

test("registered noncar pickup reaction preserves native body axes, wakes and rejects unowned ACTs", () => {
  const scene = new Group(),
    simulation = new VehicleSimulation(new WorldCollision(scene), scene);
  const body = prop();
  scene.add(body.actor);
  simulation.addNonCar(body);
  assert.equal(
    simulation.hitPickupMine(body.actor),
    false,
    "unpulled noncar has no incoming physics owner",
  );
  assert.equal(simulation.admitNonCar(body, { wake: true }), true);
  body.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  body.state.velocity.set(1, 2, 3);
  body.state.angularVelocity.set(0, 0, 0);
  body.motor.sleeping = true;
  const saved = sharedNativeRandom.state;
  try {
    const expectedRng = new NativeRandom(111);
    const expected = nativePickupMineKick({
      flags: 0,
      physicsType: 5,
      mass: body.properties.mass,
      velocity: body.state.velocity,
      omega: new Vector3(),
      random: expectedRng.random,
    });
    sharedNativeRandom.seed(111);
    assert.equal(simulation.hitPickupMine(body.actor), true);
    assert.deepEqual(
      body.state.velocity.toArray(),
      expected.velocity.toArray(),
    );
    const worldOmega = expected.omega.applyQuaternion(body.state.orientation);
    body.state.angularVelocity
      .toArray()
      .forEach((value, axis) => near(value, worldOmega.getComponent(axis)));
    assert.equal(
      sharedNativeRandom.state,
      expectedRng.state,
      "no action30 damage/crush RNG",
    );
    assert.equal(body.motor.sleeping, false);
    assert.equal(simulation.hitPickupMine(new Group()), false);
  } finally {
    sharedNativeRandom.seed(saved);
    simulation.dispose();
  }
});

test("registered moving scenery uses the ordinary generic kick without changing its pose", () => {
  const scene = new Group(),
    simulation = new VehicleSimulation(new WorldCollision(scene), scene);
  const actor = new Group();
  actor.position.set(1, 2, 3);
  const body = createMovingWorldBody(actor);
  simulation.addMovingWorld(body);
  const before = body.state.position.clone(),
    saved = sharedNativeRandom.state;
  try {
    sharedNativeRandom.seed(112);
    assert.equal(simulation.hitPickupMine(actor), true);
    assert.ok(body.state.velocity.y > 0);
    assert.deepEqual(body.state.position, before);
  } finally {
    sharedNativeRandom.seed(saved);
    simulation.dispose();
  }
});

test("original active car pickup fallback leaves component/crush damage unchanged and skips inactive cars", async (t) => {
  let data;
  try {
    data = await originalCar("EAGLE3");
  } catch (error) {
    if (error.code === "ENOENT")
      return t.skip("Original car installation unavailable");
    throw error;
  }
  const damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  const car = createSimulatedCar(
    data.group,
    data.text,
    damage,
    new Vector3(),
    0,
    true,
  );
  const scene = new Group(),
    simulation = new VehicleSimulation(new WorldCollision(scene), scene);
  scene.add(car.group);
  simulation.add(car);
  const levels = [...damage.componentLevels],
    original = damage.meshes.map((entry) => [
      ...entry.mesh.geometry.getAttribute("position").array,
    ]);
  const saved = sharedNativeRandom.state;
  try {
    const rng = new NativeRandom(113);
    rng.nextInteger();
    rng.nextInteger();
    rng.nextInteger();
    sharedNativeRandom.seed(113);
    assert.equal(simulation.hitPickupMine(car.group), true);
    assert.ok(car.state.velocity.y > 0);
    assert.equal(sharedNativeRandom.state, rng.state);
    assert.deepEqual([...damage.componentLevels], levels);
    assert.deepEqual(
      damage.meshes.map((entry) => [
        ...entry.mesh.geometry.getAttribute("position").array,
      ]),
      original,
    );
    simulation.setCarPhysicsActive(car, false);
    const state = sharedNativeRandom.state;
    assert.equal(simulation.hitPickupMine(car.group), false);
    assert.equal(sharedNativeRandom.state, state);
  } finally {
    sharedNativeRandom.seed(saved);
    simulation.dispose();
  }
});
