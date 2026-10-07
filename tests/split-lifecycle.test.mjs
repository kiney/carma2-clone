import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { DamageSystem } from "../src/damage.ts";
import { WorldCollision } from "../src/world.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";
import { setMotionSuspension } from "../src/physics/motion.ts";
const emptyWorld = {
  raycast() {
    return null;
  },
  querySurfaces() {
    return [];
  },
};
async function stock(t) {
  let data;
  try {
    data = await originalCar("EAGLE3");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Original Eagle archive is absent");
      return;
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
    true,
  );
}
function geometries(group) {
  const result = new Set();
  group.traverse((actor) => {
    if (actor.isMesh) result.add(actor.geometry);
  });
  return result;
}

test("source immunity consumes due detach reservations while preserving accumulated force", async (t) => {
  const car = await stock(t);
  if (!car) return;
  const sim = new VehicleSimulation(emptyWorld, new Group());
  sim.scene.add(car.group);
  sim.add(car);
  const part = car.damage.runtimeParts.find((p) => p.state.type === 2);
  assert.ok(part);
  part.state.accumulatedForce = 0.8;
  part.state.queuedAt = 0;
  car.damage.damageContext.invulnerable = true;
  sim.step();
  assert.equal(part.state.queuedAt, null);
  assert.equal(part.state.phase, 0);
  assert.equal(part.state.accumulatedForce, 0.8);
  assert.equal(sim.debris.length, 0);
  car.damage.damageContext.invulnerable = false;
  part.state.queuedAt = 0;
  sim.step();
  assert.ok(sim.debris.some((body) => body.actor === part.actor));
  sim.dispose();
});

test("structural bending resets suspension from current axle/COM geometry and repair restores it", async (t) => {
  const car = await stock(t);
  if (!car) return;
  const sim = new VehicleSimulation(emptyWorld, new Group());
  sim.scene.add(car.group);
  sim.add(car);
  const original = [...car.motion.spring];
  car.damage.damageContext.random = () => 0;
  car.damage.applyImpact(
    [new Vector3(0, 0.1, -0.3)],
    new Vector3(0, 0, 5),
    false,
    true,
    10000,
    new Vector3(0, 0, 5),
  );
  assert.ok(car.damage.structuralBend);
  sim.step();
  const p = car.motion;
  const ratio = Math.abs(
    (p.wheelPositions[0].z - p.centerOfMass.z) /
      (p.wheelPositions[2].z - p.centerOfMass.z),
  );
  const expected = [p.mass / (ratio + 1), p.mass / (1 / ratio + 1)].map(
    (mass, axle) => (mass * 5) / p.suspensionBase.give[axle],
  );
  expected.forEach((value, axle) =>
    assert.ok(Math.abs(p.spring[axle] - value) < 1e-10),
  );
  assert.notDeepEqual(p.spring, original);
  car.damage.repair();
  sim.step();
  original.forEach((value, axle) =>
    assert.ok(Math.abs(p.spring[axle] - value) < 1e-8),
  );
  assert.equal(car.suspensionBendActive, false);
  sim.dispose();
});

test("full powerup repair resets temporary suspension on an unbent original car", async (t) => {
  const car = await stock(t);
  if (!car) return;
  const sim = new VehicleSimulation(emptyWorld, new Group());
  sim.scene.add(car.group);
  sim.add(car);
  const springs = [...car.motion.spring],
    dampers = [...car.motion.damper];
  setMotionSuspension(car.motion, {
    frontGiveMultiplier: 2,
    rearGiveMultiplier: 3,
    frontExtraLength: 0.4,
    rearExtraLength: 0.5,
    dampingMultiplier: 4,
  });
  assert.notDeepEqual(car.motion.spring, springs);
  sim.repair(car);
  springs.forEach((value, axle) =>
    assert.ok(Math.abs(car.motion.spring[axle] - value) < 1e-10),
  );
  dampers.forEach((value, axle) =>
    assert.ok(Math.abs(car.motion.damper[axle] - value) < 1e-10),
  );
  sim.dispose();
});
function belongs(actor, parent) {
  while (actor) {
    if (actor === parent) return true;
    actor = actor.parent;
  }
  return false;
}
async function splitEagle(t) {
  const car = await stock(t);
  if (!car) return;
  const originalGeometry = geometries(car.group),
    scene = new Group(),
    geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [0, -1, 0, 0, 1, 0, 1, 1, 0, 0, -1, 0, -1, 1, -1, 0, 1, 0],
      3,
    ),
  );
  geometry.userData.sourceFaceFlags = Uint8Array.from([6, 3]);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.userData.c2Flags = 4096;
  scene.add(new Mesh(geometry, material));
  const world = new WorldCollision(scene);
  scene.add(car.group);
  const sim = new VehicleSimulation(world, scene);
  sim.add(car);
  car.state.position.z = 0.55;
  car.state.velocity.z = -8;
  sim.step();
  const secondary = sim.debris.find((body) => body.part < 0);
  assert.ok(
    secondary && car.damage.snapped,
    "Original qualifying scenery edge splits the Eagle",
  );
  t.after(() => {
    sim.dispose();
    geometry.dispose();
    material.dispose();
  });
  return { car, sim, secondary, scene, originalGeometry };
}

test("queued part migrated to the secondary split half inherits that half and joins its physical tree", async (t) => {
  const fixture = await splitEagle(t);
  if (!fixture) return;
  const { car, sim, secondary } = fixture;
  const runtime = car.damage.runtimeParts.find(
    (part) =>
      part.state.phase === 0 &&
      part.state.type !== 2 &&
      belongs(part.actor, secondary.actor),
  );
  assert.ok(
    runtime,
    "Original Eagle contains an attached part migrated into the secondary half",
  );
  runtime.state.queuedAt = sim.elapsed * 1000;
  sim.detachParts(car);
  const child = sim.debris.find((body) => body.actor === runtime.actor);
  assert.ok(child?.joint);
  assert.equal(child.owner, car, "Logical repair ownership is retained");
  assert.equal(
    child.joint.parent,
    secondary,
    "Physical constraint belongs to the half containing the part",
  );
  const parentCOM = secondary.properties.centerOfMass
    .clone()
    .applyQuaternion(secondary.state.orientation)
    .add(secondary.state.position);
  const childCOM = child.properties.centerOfMass
    .clone()
    .applyQuaternion(child.state.orientation)
    .add(child.state.position);
  const expectedVelocity = secondary.state.velocity
    .clone()
    .add(
      new Vector3().crossVectors(
        secondary.state.angularVelocity,
        childCOM.sub(parentCOM),
      ),
    );
  assert.ok(child.state.velocity.distanceTo(expectedVelocity) < 1e-10);
  assert.ok(
    child.state.angularVelocity.distanceTo(secondary.state.angularVelocity) <
      1e-10,
  );
});

for (const repairFirst of [false, true])
  test(`split ${repairFirst ? "then full repair" : "without repair"} followed by content disposal releases original and sliced geometry`, async (t) => {
    const fixture = await splitEagle(t);
    if (!fixture) return;
    const { car, sim, secondary, originalGeometry } = fixture;
    const expected = new Set([
        ...originalGeometry,
        ...geometries(car.group),
        ...geometries(secondary.actor),
      ]),
      disposed = new Set();
    for (const geometry of expected)
      geometry.addEventListener("dispose", () => disposed.add(geometry));
    if (repairFirst) car.damage.repair();
    sim.dispose();
    // Match main.loadRace: simulation teardown precedes disposeGroup(oldCar).
    for (const geometry of geometries(car.group)) geometry.dispose();
    assert.equal(sim.cars.length, 0);
    assert.equal(sim.debris.length, 0);
    assert.equal(secondary.actor.parent, null);
    assert.equal(
      car.damage.snapped,
      false,
      "Teardown reunites any split before disposing original content",
    );
    for (const geometry of expected)
      assert.ok(
        disposed.has(geometry),
        "Every pristine source and temporary sliced geometry is disposed",
      );
    // A later load owns a fresh original car, with no detached or split state.
    const fresh = await stock(t);
    if (!fresh) return;
    assert.equal(fresh.damage.snapped, false);
    assert.ok(
      fresh.damage.runtimeParts.every((part) => part.state.phase === 0),
    );
    assert.equal(fresh.properties.mass, fresh.mechanics.root.mass);
  });

test("held repair waits for a blocked safe hull swap and resumes only after its commit", async (t) => {
  const car = await stock(t);
  if (!car) return;
  car.damage.applyImpact(
    [new Vector3(-0.16, 0.06, -0.38)],
    new Vector3(0, 0, 0.5),
    false,
    true,
    0,
    new Vector3(0, 0, 0.25),
  );
  const sim = new VehicleSimulation(emptyWorld, new Group());
  sim.add(car);
  t.after(() => sim.dispose());
  sim.step();
  assert.equal(car.knackered, false);
  const repair = car.damage.repairStep.bind(car.damage);
  let repairCalls = 0;
  car.damage.repairStep = (...args) => {
    repairCalls++;
    return repair(...args);
  };
  car.repairing = true;
  // Force all ten source placement probes to fail while preserving the actual
  // body repair and pending shape-swap machinery. Failure must roll back pose.
  sim.placementDirection = () => new Vector3(1, 0, 0);
  sim.step();
  assert.equal(repairCalls, 1);
  assert.ok(car.damage.pendingShapeSwapFlags & 1);
  const pendingRevision = car.damage.deformationRevision;
  sim.step();
  sim.step();
  assert.equal(
    repairCalls,
    1,
    "Controls wait instead of advancing bodywork through failed hull expansion",
  );
  assert.equal(car.damage.deformationRevision, pendingRevision);
  sim.placementDirection = () => undefined;
  sim.step();
  assert.equal(
    car.damage.pendingShapeSwapFlags,
    0,
    "A safe placement commits the retained pending hull",
  );
  sim.step();
  assert.ok(
    repairCalls > 1,
    "Held repair resumes after pending shape commitment",
  );
});
