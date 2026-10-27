import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Object3D, Quaternion, Vector3 } from "three";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { createNativePedBody } from "../src/physics/ped-body.ts";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { WorldCollision } from "../src/world.ts";

function emptySimulation() {
  const scene = new Group();
  return new VehicleSimulation(new WorldCollision(scene), scene);
}

function simplePed() {
  const bounds = { min: [-0.02, -0.05, -0.02], max: [0.02, 0.05, 0.02] };
  return createNativePedBody({
    actor: new Object3D(),
    profile: {
      mass: 0.068,
      bounds,
      centreOfMass: [0, 0, 0],
      inertia: [0.00004, 0.00001, 0.00004],
      rootName: "root",
      formName: "capacity-fixture",
      defaultMovesName: "capacity-fixture",
      rootRemap: null,
      modelsByBone: new Map(),
      movement: new Map(),
    },
    rootPose: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    levelOut: 0,
  });
}

function dummyBody() {
  return {
    state: {
      position: new Vector3(),
      orientation: new Quaternion(),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: 1,
      inertia: new Vector3(1, 1, 1),
      centerOfMass: new Vector3(),
      worldFriction: 0.4,
    },
  };
}

function mineOwner() {
  const body = dummyBody();
  Object.assign(body, {
    group: new Group(),
    hulls: [
      buildBoxHull(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5)),
    ],
    damage: {
      carSoftness: 1,
      damageContext: { invulnerable: false, random: () => 0.5 },
    },
    human: false,
    specialVolume: undefined,
  });
  body.state.position.set(20, 10, 0);
  return body;
}

function carFixture() {
  const body = dummyBody();
  Object.assign(body, {
    group: new Group(),
    damage: {
      wasted: false,
      schedulingBindings: [],
      configureDetachmentScheduling(context) {
        this.schedulingBindings.push(context);
      },
      configureWamSmashQueue() {},
      configureWamRepairQueue() {},
      repair() {},
    },
    human: false,
  });
  return body;
}

function mineFactory() {
  return {
    actor: new Group(),
    bounds: new Box3(new Vector3(-0.2, -0.2, -0.2), new Vector3(0.2, 0.2, 0.2)),
    mass: 0.05,
  };
}

const mineParameters = {
  lifetimeSeconds: 30,
  minimumUpImpulse: 2,
  maximumUpImpulse: 10,
  zAngularFactor: 2,
  xAngularFactor: 2,
  collisionForceThreshold: 0.7,
  launchUpVelocity: 0.5,
  launchZVelocity: 0.6,
  mortar: false,
};

test("simulation admits only active bodies; static level ACTs stay outside the shared pool", () => {
  const sim = emptySimulation();
  const staticProps = Array.from({ length: 3 }, () =>
    createNonCarBody(
      new Group(),
      parseNonCarMechanics(
        "101\n7\n0,0,0\n0,-.1,0\n1\nbox\n-1,-1,-1\n1,1,1\n1,2\n.2,.2,.2\n0\n0\n0\nEND",
      ),
    ),
  );
  for (const prop of staticProps) sim.addNonCar(prop);
  assert.ok(staticProps.every((prop) => sim.phil.getHeader(prop) === null));
  assert.equal(sim.phil.count, 0);

  const ped = simplePed();
  ped.headerState = 2;
  sim.addPedBody(ped);
  assert.ok(sim.phil.getHeader(ped));
  assert.equal(sim.phil.getState(ped), 2);
  assert.equal(sim.phil.freeCount, 99);
  sim.removePedBody(ped);
  assert.equal(sim.phil.getHeader(ped), null);
  assert.equal(sim.phil.freeCount, 100);
  assert.deepEqual(sim.noncars, staticProps);
  sim.dispose();
});

test("failed active-car admission at capacity leaves the simulation car list unchanged", () => {
  const sim = emptySimulation();
  sim.add(carFixture());
  sim.add(carFixture());
  assert.equal(sim.cars.length, 2);
  for (let i = 2; i < 100; i++)
    assert.equal(sim.phil.addActiveImmediate(dummyBody()), 0);
  const before = [...sim.cars];
  assert.throws(() => sim.add({}), /No native PHIL header/);
  assert.deepEqual(sim.cars, before);
  assert.equal(sim.phil.count, 100);
  assert.equal(sim.phil.freeCount, 0);
  sim.dispose();
});

test("initial car batch capacity and identity checks precede all mutation", () => {
  const sim = emptySimulation();
  const existing = carFixture();
  sim.add(existing);
  for (let i = 1; i < 99; i++)
    assert.equal(sim.phil.addActiveImmediate(dummyBody()), 0);
  const batch = [carFixture(), carFixture()];
  const registered = [...sim.phil.registeredBodies];
  assert.throws(() => sim.addCars(batch), /No native PHIL headers/);
  assert.deepEqual(sim.cars, [existing]);
  assert.deepEqual(sim.phil.registeredBodies, registered);
  assert.equal(sim.phil.freeCount, 1);
  for (const car of batch) {
    assert.equal(sim.phil.getHeader(car), null);
    assert.equal(car.damage.readSmashStartingVelocity, undefined);
    assert.deepEqual(car.damage.schedulingBindings, []);
  }
  assert.throws(() => sim.addCars([batch[0], batch[0]]), /duplicate car/);
  assert.throws(() => sim.addCars([existing]), /admitted/);
  const alias = carFixture();
  alias.group.uuid = existing.group.uuid;
  assert.throws(() => sim.addCars([alias]), /admitted/);
  assert.deepEqual(sim.phil.registeredBodies, registered);
  sim.dispose();
});

test("initial batch rollback restores registry and callbacks after a sync fault", () => {
  const sim = emptySimulation();
  const existing = carFixture();
  sim.add(existing);
  const registered = [...sim.phil.registeredBodies];
  const batch = [carFixture(), carFixture()];
  const oldCallback = () => new Vector3(1, 2, 3);
  batch[0].damage.readSmashStartingVelocity = oldCallback;
  const sync = sim.sync;
  sim.sync = function (car) {
    if (car === batch[1]) throw new Error("injected sync failure");
    return sync.call(this, car);
  };
  assert.throws(() => sim.addCars(batch), /injected sync failure/);
  assert.deepEqual(sim.cars, [existing]);
  assert.deepEqual(sim.phil.registeredBodies, registered);
  assert.equal(sim.phil.freeCount, 99);
  assert.equal(batch[0].damage.readSmashStartingVelocity, oldCallback);
  assert.equal(batch[1].damage.readSmashStartingVelocity, undefined);
  for (const car of batch) {
    assert.equal(sim.phil.getHeader(car), null);
    assert.equal(sim.crashCars.has(car.group.uuid), false);
    assert.equal(car.damage.deferOrdinaryCrush, undefined);
    assert.equal(car.damage.cancelQueuedSpam, undefined);
    assert.equal(car.damage.onWastageCheck, undefined);
    assert.deepEqual(car.damage.schedulingBindings, []);
  }
  sim.sync = sync;
  sim.addCars(batch);
  assert.deepEqual(sim.cars, [existing, ...batch]);
  assert.equal(sim.phil.count, 3);
  for (const car of batch) {
    assert.equal(sim.phil.getState(car), 2);
    assert.equal(sim.crashCars.get(car.group.uuid), car);
    assert.equal(typeof car.damage.readSmashStartingVelocity, "function");
    car.state.velocity.set(1, -2, 3);
    assert.deepEqual(car.damage.readSmashStartingVelocity().toArray(), [
      Math.fround(6.9),
      Math.fround(-13.8),
      Math.fround(20.7),
    ]);
    assert.equal(
      car.damage.deferOrdinaryCrush([], new Vector3(), false, 0),
      false,
    );
    assert.equal(typeof car.damage.cancelQueuedSpam, "function");
    car.damage.onWastageCheck();
    assert.equal(car.damage.schedulingBindings.length, 1);
    assert.equal(car.group.position.equals(car.state.position), true);
  }
  sim.dispose();
});

test("a full shared pool rejects only the new mine and preserves an existing deployment", () => {
  const sim = emptySimulation();
  sim.mineFactory = mineFactory();
  const owner = mineOwner();
  assert.equal(sim.phil.addActiveImmediate(owner), 0);
  assert.equal(sim.launchMine(owner, mineParameters, 52), true);
  const deployed = sim.mineBodies[0];
  const deployedHeader = sim.phil.getHeader(deployed);
  assert.ok(deployedHeader);

  while (sim.phil.freeCount > 0)
    assert.equal(sim.phil.addActiveImmediate(dummyBody()), 0);
  assert.equal(sim.launchMine(owner, mineParameters, 53), false);
  assert.equal(sim.phil.count, 100);
  assert.equal(sim.phil.getHeader(deployed), deployedHeader);
  assert.equal(sim.phil.getState(deployed), 2);
  assert.deepEqual(sim.mineBodies, [deployed]);
  assert.equal(deployed.mine.flags & 1, 1);
  sim.dispose();
});
