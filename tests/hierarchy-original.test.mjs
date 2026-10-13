import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { originalCar } from "./support/original-car.mjs";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  PHYSICS_STEP,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { createHierarchyMotionPhase } from "../src/physics/hierarchy-motion.ts";
import { advanceRigidBody } from "../src/physics/integrate.ts";

const emptyWorld = { raycast: () => null, querySurfaces: () => [] };
const nearVector = (actual, expected, tolerance = 1e-8) =>
  assert.ok(
    actual.distanceTo(expected) < tolerance,
    `${actual.toArray()} != ${expected.toArray()}`,
  );
function snapshot(body) {
  return {
    position: body.state.position.clone(),
    orientation: body.state.orientation.clone(),
    velocity: body.state.velocity.clone(),
    angularVelocity: body.state.angularVelocity.clone(),
  };
}
function worldAnchor(pose, local) {
  return local.clone().applyQuaternion(pose.orientation).add(pose.position);
}
function checkCommitted(body, expected) {
  nearVector(body.state.position, expected.position);
  assert.ok(body.state.orientation.angleTo(expected.orientation) < 1e-7);
  nearVector(body.state.velocity, expected.velocity);
  nearVector(body.state.angularVelocity, expected.angularVelocity);
}

for (const name of ["EAGLE3", "cerby"])
  test(`${name} original WAM ordinary part follows hierarchy motion, release and full repair`, async (t) => {
    let original;
    try {
      original = await originalCar(name);
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("Local original car installation absent");
        return;
      }
      throw error;
    }
    const damage = new DamageSystem(
      original.assets,
      original.group,
      original.text,
    );
    await damage.init();
    damage.damageContext.random = () => 0.5;
    const car = createSimulatedCar(
      original.group,
      original.text,
      damage,
      new Vector3(2, 20, -3),
      0,
      true,
      { immutableHulls: true },
    );
    const scene = new Group();
    scene.add(car.group);
    const sim = new VehicleSimulation(emptyWorld, scene);
    sim.add(car);
    t.after(() => {
      sim.dispose();
      const geometries = new Set();
      const materials = new Set();
      car.group.traverse((actor) => {
        if (!actor.isMesh) return;
        geometries.add(actor.geometry);
        for (const material of Array.isArray(actor.material)
          ? actor.material
          : [actor.material])
          materials.add(material);
      });
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    });
    const pristineProperties = {
      mass: car.properties.mass,
      inertia: car.properties.inertia.clone(),
      centerOfMass: car.properties.centerOfMass.clone(),
    };
    const ordinaryParts = damage.runtimeParts.filter(
      (part) =>
        (part.state.type === 0 || part.state.type === 1) &&
        part.state.phase === 0 &&
        part.part.type === "detach" &&
        part.originalVertices.length >= 4,
    );
    assert.ok(
      ordinaryParts.length,
      `${name} lacks an original ordinary jointed WAM part`,
    );
    const runtime =
      ordinaryParts.find((part) => /FBMP|FBUMP/i.test(part.actor.name)) ??
      ordinaryParts[0];
    const partIndex = damage.runtimeParts.indexOf(runtime);
    car.state.orientation.setFromAxisAngle(
      new Vector3(0.3, 1, 0.2).normalize(),
      0.6,
    );
    car.state.velocity.set(0.3, 0.2, -0.4);
    car.state.angularVelocity.set(1.7, -0.8, 0.5);
    sim.sync(car);

    // Controlled activation fixture: make this original WAM reservation due.
    // The production detach path supplies geometry, anchors, mass and COM;
    // this test does not claim to recreate a preceding collision impulse.
    runtime.state.queuedAt = sim.elapsed * 1000;
    sim.detachParts(car);
    const child = sim.debris.find(
      (body) => body.part === partIndex && body.owner === car,
    );
    assert.ok(
      child?.joint,
      `${name}/${runtime.actor.name} did not enter semi-detachment`,
    );
    assert.equal(runtime.state.phase, 1);
    assert.equal(child.joint.type, "ball");
    assert.equal(child.joint.parent, car);
    assert.equal(child.properties.mass, runtime.mass);
    assert.ok(
      child.properties.mass > 0 && child.properties.mass < car.properties.mass,
    );
    assert.ok(
      child.properties.inertia
        .toArray()
        .every((value) => Number.isFinite(value) && value > 0),
    );
    assert.ok(child.properties.centerOfMass.toArray().every(Number.isFinite));
    assert.ok(
      child.hulls.length &&
        child.hulls.every((hull) => hull.vertices.length >= 4),
    );

    child.state.velocity.set(3, -2, 1);
    child.state.angularVelocity.set(-4, 2, 3);
    const joint = child.joint;
    const oldCar = snapshot(car);
    const oldChild = snapshot(child);
    const phase = createHierarchyMotionPhase(
      [child, car],
      [joint],
      PHYSICS_STEP,
    );
    for (const fraction of [0.25, 0.75]) {
      const parentPose = phase.pose(car, fraction);
      const childPose = phase.pose(child, fraction);
      nearVector(
        worldAnchor(childPose, joint.childAnchor),
        worldAnchor(parentPose, joint.parentAnchor),
      );
      // The authored detached inertia drives independent native gyro motion;
      // ancestor anchoring changes translation, not that angular result.
      const angularOracle = {
        state: {
          ...oldChild,
          position: oldChild.position.clone(),
          orientation: oldChild.orientation.clone(),
          velocity: new Vector3(),
          angularVelocity: oldChild.angularVelocity.clone(),
        },
        properties: child.properties,
      };
      advanceRigidBody(angularOracle, PHYSICS_STEP * fraction);
      assert.ok(
        childPose.orientation.angleTo(angularOracle.state.orientation) < 1e-7,
      );
      nearVector(
        childPose.angularVelocity,
        angularOracle.state.angularVelocity,
      );
      nearVector(childPose.velocity, oldChild.velocity);
    }
    checkCommitted(car, oldCar);
    checkCommitted(child, oldChild);
    phase.writeCandidates([child, car], 0.25);
    nearVector(child.state.predictedPosition, phase.pose(child, 0.25).position);
    checkCommitted(child, oldChild);

    const quarterCar = phase.pose(car, 0.25);
    const quarterChild = phase.pose(child, 0.25);
    phase.commit(
      [child, car],
      new Map([
        [child, 0.25],
        [car, 0.8],
      ]),
    );
    checkCommitted(car, quarterCar);
    checkCommitted(child, quarterChild);
    const nextPhase = createHierarchyMotionPhase(
      [car, child],
      [joint],
      PHYSICS_STEP,
    );
    const nextCar = nextPhase.pose(car, 0.75);
    const nextChild = nextPhase.pose(child, 0.75);
    nextPhase.commit(
      [car, child],
      new Map([
        [child, 0.75],
        [car, 1],
      ]),
    );
    checkCommitted(car, nextCar);
    checkCommitted(child, nextChild);
    nearVector(
      worldAnchor(child.state, joint.childAnchor),
      worldAnchor(car.state, joint.parentAnchor),
    );

    // Controlled release fixture: source full detachment has this phase/link
    // result. Physical ancestry ends while original repair ownership remains.
    runtime.state.phase = 2;
    child.joint = undefined;
    const releasedOld = snapshot(child);
    const released = createHierarchyMotionPhase([child, car], [], PHYSICS_STEP);
    const freeOracle = {
      state: {
        position: releasedOld.position.clone(),
        orientation: releasedOld.orientation.clone(),
        velocity: releasedOld.velocity.clone(),
        angularVelocity: releasedOld.angularVelocity.clone(),
      },
      properties: child.properties,
    };
    advanceRigidBody(freeOracle, PHYSICS_STEP);
    checkCommitted(freeOracle, released.pose(child, 1));
    assert.equal(child.owner, car);
    assert.notEqual(
      released.paths.get(child).temporalGroup,
      released.paths.get(car).temporalGroup,
    );
    nearVector(phase.pose(child, 0).position, oldChild.position);

    sim.sync(car);
    sim.repair(car);
    assert.equal(runtime.state.phase, 0);
    assert.equal(runtime.actor.parent, runtime.originalParent);
    assert.ok(damage.componentLevels.every((level) => level === 0));
    sim.step(); // One lifecycle tick removes the repaired physical part.
    assert.ok(!sim.debris.includes(child));
    const repaired = createHierarchyMotionPhase(
      sim.allBodies(),
      sim.allJoints(),
      PHYSICS_STEP,
    );
    assert.ok(
      !repaired.paths.has(child),
      "repair cannot retain the released body's motion certificate",
    );
    assert.equal(car.properties.mass, pristineProperties.mass);
    nearVector(car.properties.inertia, pristineProperties.inertia);
    nearVector(car.properties.centerOfMass, pristineProperties.centerOfMass);
    assert.ok(repaired.pose(car, 1).position.toArray().every(Number.isFinite));
    nearVector(phase.pose(child, 0).position, oldChild.position);
    nearVector(released.pose(child, 0).position, releasedOld.position);
  });
