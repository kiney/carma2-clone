import test from "node:test";
import assert from "node:assert/strict";
import {
  Box3,
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
  PHYSICS_STEP,
} from "../src/physics/simulation.ts";
import { advanceRigidBody } from "../src/physics/integrate.ts";
import { applyComponentImpact } from "../src/physics/components.ts";
import { originalCar } from "./support/original-car.mjs";

const emptyWorld = {
  raycast() {
    return null;
  },
  querySurfaces() {
    return [];
  },
};
const near = (actual, expected, tolerance = 1e-8) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} != ${expected}`,
  );
const nearVector = (actual, expected, tolerance = 1e-8) =>
  assert.ok(
    actual.distanceTo(expected) <= tolerance,
    `${actual.toArray()} != ${expected.toArray()}`,
  );
const bounds = (car) => new Box3().setFromPoints(car.shapeVertices.flat());
async function stock(t, name, heading = 0) {
  let data;
  try {
    data = await originalCar(name);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original car archives are absent");
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
    heading,
    true,
  );
}
/** Original airborne forces: gravity10 metric/s² followed by source quadratic
 * drag. This isolates the contact momentum exchange from external forces.
 */
function freeVelocity(velocity, mass) {
  const result = velocity
    .clone()
    .add(new Vector3(0, (-10 / 6.9) * PHYSICS_STEP, 0));
  return result.multiplyScalar(
    1 - (result.length() * PHYSICS_STEP * 0.0005000000237487257 * 6.9) / mass,
  );
}
function momentum(cars) {
  return cars.reduce(
    (sum, car) => sum.addScaledVector(car.state.velocity, car.properties.mass),
    new Vector3(),
  );
}

for (const [lightName, heavyName] of [
  ["buggy", "EAGLE3"],
  ["buggy", "bigdump"],
  ["EAGLE3", "bigdump"],
]) {
  test(`source ${lightName}/${heavyName} head-on collision conserves contact momentum and follows mass ratio`, async (t) => {
    const light = await stock(t, lightName),
      heavy = await stock(t, heavyName, Math.PI);
    if (!light || !heavy) return;
    assert.ok(light.properties.mass < heavy.properties.mass);
    assert.equal(light.properties.mass, light.mechanics.root.mass);
    assert.equal(heavy.properties.mass, heavy.mechanics.root.mass);
    light.state.position.z = -bounds(light).min.z + 0.01;
    heavy.state.position.z = bounds(heavy).min.z - 0.01;
    light.state.velocity.z = -2;
    heavy.state.velocity.z = 2;
    const freeLight = freeVelocity(light.state.velocity, light.properties.mass),
      freeHeavy = freeVelocity(heavy.state.velocity, heavy.properties.mass);
    const expectedMomentum = freeLight
      .clone()
      .multiplyScalar(light.properties.mass)
      .addScaledVector(freeHeavy, heavy.properties.mass);
    const sim = new VehicleSimulation(emptyWorld, new Group());
    sim.add(light);
    sim.add(heavy);
    t.after(() => sim.dispose());
    sim.step();
    assert.ok(
      sim.lastImpacts.some((impact) => impact.b),
      "Original convex hulls must collide",
    );
    assert.equal(
      sim.debris.length,
      0,
      "This moderate head-on case keeps both authored bodies intact",
    );
    nearVector(momentum([light, heavy]), expectedMomentum);
    const lightChange = light.state.velocity.clone().sub(freeLight),
      heavyChange = heavy.state.velocity.clone().sub(freeHeavy);
    assert.ok(
      lightChange.z > 0 && heavyChange.z < 0,
      "Both incoming velocities respond to contact",
    );
    nearVector(
      lightChange.clone().multiplyScalar(light.properties.mass),
      heavyChange.clone().multiplyScalar(-heavy.properties.mass),
    );
    near(
      lightChange.length() / heavyChange.length(),
      heavy.properties.mass / light.properties.mass,
      1e-7,
    );
    if (heavyName === "bigdump")
      assert.ok(
        lightChange.length() > 20 * heavyChange.length(),
        "Authored truck mass produces substantially less velocity change",
      );
  });
}

test("source off-center Eagle/dump-truck side impact spins bodies according to contact lever and authored inertia", async (t) => {
  const samples = [];
  for (const offset of [0, 0.55]) {
    const eagle = await stock(t, "EAGLE3"),
      truck = await stock(t, "bigdump");
    if (!eagle || !truck) return;
    eagle.state.position.set(
      bounds(truck).min.x - bounds(eagle).max.x - 0.01,
      0,
      offset,
    );
    eagle.state.velocity.x = 3;
    const initialPosition = truck.state.position.clone(),
      initialOrientation = truck.state.orientation.clone();
    const freeEagle = freeVelocity(eagle.state.velocity, eagle.properties.mass),
      freeTruck = freeVelocity(truck.state.velocity, truck.properties.mass);
    const sim = new VehicleSimulation(emptyWorld, new Group());
    sim.add(eagle);
    sim.add(truck);
    t.after(() => sim.dispose());
    sim.step();
    assert.ok(sim.lastImpacts.some((impact) => impact.b));
    assert.equal(sim.debris.length, 0);
    nearVector(
      momentum([eagle, truck]),
      freeEagle
        .multiplyScalar(eagle.properties.mass)
        .addScaledVector(freeTruck, truck.properties.mass),
    );
    // Normal levers use OLD actor/COM coordinates. Native local retries commit
    // their normal-only rotation/gyro before 0x4ba688 applies retained friction.
    const angular = new Vector3(),
      center = truck.properties.centerOfMass
        .clone()
        .applyQuaternion(initialOrientation)
        .add(initialPosition);
    for (const impact of sim.lastImpacts) {
      if (!impact.solverAccepted || impact.sourceType === 9) continue;
      const sign = impact.a === truck ? 1 : impact.b === truck ? -1 : 0;
      if (!sign) continue;
      const impulse = impact.normal
        .clone()
        .multiplyScalar(impact.normalImpulse)
        .multiplyScalar(sign);
      angular.add(
        (sign === 1 ? impact.point : (impact.pointB ?? impact.point))
          .clone()
          .sub(center)
          .cross(impulse),
      );
    }
    const local = angular
      .clone()
      .applyQuaternion(initialOrientation.clone().invert())
      .divide(truck.properties.inertia)
      .applyQuaternion(initialOrientation);
    const reference = {
      state: {
        position: initialPosition.clone(),
        orientation: initialOrientation.clone(),
        velocity: truck.state.velocity.clone(),
        angularVelocity: local,
      },
      properties: truck.properties,
    };
    advanceRigidBody(reference, PHYSICS_STEP);
    near(truck.state.orientation.angleTo(reference.state.orientation), 0, 1e-7);
    // Friction retains the OLD-local COM lever but transforms each tangential
    // impulse through the accepted candidate basis. It updates next-tick omega
    // after gyro/pose commitment; it does not reintegrate this tick's rotation.
    const candidate = reference.state.orientation;
    for (const impact of sim.lastImpacts) {
      if (!impact.solverAccepted || impact.sourceType === 9) continue;
      const sign = impact.a === truck ? 1 : impact.b === truck ? -1 : 0;
      if (!sign) continue;
      const oldLocalLever = (
        sign === 1 ? impact.point : (impact.pointB ?? impact.point)
      )
        .clone()
        .sub(initialPosition)
        .applyQuaternion(initialOrientation.clone().invert())
        .sub(truck.properties.centerOfMass);
      const candidateLocalImpulse = impact.tangentImpulse
        .clone()
        .multiplyScalar(sign)
        .applyQuaternion(candidate.clone().invert());
      const delta = oldLocalLever
        .cross(candidateLocalImpulse)
        .divide(truck.properties.inertia)
        .applyQuaternion(candidate);
      reference.state.angularVelocity.add(delta);
    }
    nearVector(
      truck.state.angularVelocity,
      reference.state.angularVelocity,
      1e-8,
    );
    samples.push({ yaw: truck.state.angularVelocity.y, torque: angular.y });
  }
  assert.ok(
    samples[1].torque > 0 && samples[1].yaw > 0,
    "Offset hit transfers the expected positive yaw torque",
  );
  assert.ok(
    Math.abs(samples[1].yaw) > Math.abs(samples[0].yaw),
    "Moving the impact away from the COM increases spin",
  );
});

function wallScene() {
  const scene = new Group(),
    geometry = new BufferGeometry();
  // The two broad coplanar triangles have no splitting edge between differing
  // normals; their coordinates and material are independent test geometry.
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [-5, -5, 0, 5, -5, 0, 5, 5, 0, -5, -5, 0, 5, 5, 0, -5, 5, 0],
      3,
    ),
  );
  geometry.userData.sourceFaceFlags = Uint8Array.from([7, 7]);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  scene.add(new Mesh(geometry, material));
  return { scene, geometry, material, world: new WorldCollision(scene) };
}
for (const name of ["EAGLE3", "buggy", "bigdump"]) {
  test(`source ${name} moderate/high plane crashes preserve localized authored crush and separate component damage`, async (t) => {
    const samples = [];
    for (const speed of [2, 8]) {
      const car = await stock(t, name);
      if (!car) return;
      const originalBounds = bounds(car),
        originalShapes = car.shapeVertices.map((shape) =>
          shape.map((point) => point.clone()),
        );
      car.state.position.z = -originalBounds.min.z + 0.01;
      car.state.velocity.z = -speed;
      const originalMeshes = [];
      car.group.traverse((object) => {
        if (object.isMesh)
          originalMeshes.push([
            object,
            Float32Array.from(object.geometry.attributes.position.array),
          ]);
      });
      const calls = [],
        apply = car.damage.applyImpact.bind(car.damage);
      car.damage.applyImpact = (
        contacts,
        damage,
        hitCar,
        human,
        time,
        crush,
        point,
      ) => {
        calls.push({
          contacts: contacts.map((p) => p.clone()),
          damage: damage.clone(),
          crush: crush.clone(),
          point: point.clone(),
        });
        return apply(contacts, damage, hitCar, human, time, crush, point);
      };
      const { scene, geometry, material, world } = wallScene();
      scene.add(car.group);
      const sim = new VehicleSimulation(world, scene);
      sim.add(car);
      t.after(() => {
        sim.dispose();
        geometry.dispose();
        material.dispose();
      });
      sim.step();
      assert.ok(sim.lastImpacts.length > 0);
      assert.equal(calls.length, 1);
      assert.equal(
        car.damage.snapped,
        false,
        "Broad coplanar contact does not satisfy the authored split-edge gate",
      );
      const raw = sim.lastImpacts
        .filter((i) => i.sourceType !== 9 && i.normalImpulse > 0)
        .reduce(
          // The native force-row lambda operand is Float32 before grouping.
          (sum, i) =>
            sum.addScaledVector(i.normal, Math.fround(i.normalImpulse)),
          new Vector3(),
        );
      nearVector(calls[0].damage, raw.clone().multiplyScalar(0.2));
      nearVector(calls[0].crush, raw.clone().multiplyScalar(0.1));
      const expectedLevels = new Uint8Array(12);
      const component = applyComponentImpact(
        expectedLevels,
        car.damage.damagePrograms,
        {
          point: calls[0].point.toArray(),
          bounds: {
            min: originalBounds.min.toArray(),
            max: originalBounds.max.toArray(),
          },
          energyVector: calls[0].damage.toArray(),
          hitAnotherCar: false,
          context: { human: true, random: () => 0.5 },
        },
      );
      assert.ok(component.energy > 0);
      assert.deepEqual(
        car.damage.componentLevels,
        expectedLevels,
        "Component changes follow this car’s original location/weakness programs",
      );
      let physical = 0,
        front = 0,
        rear = 0;
      for (let s = 0; s < originalShapes.length; s++)
        for (let i = 0; i < originalShapes[s].length; i++) {
          const old = originalShapes[s][i],
            distance = car.shapeVertices[s][i].distanceTo(old);
          physical += distance;
          if (old.z < originalBounds.getCenter(new Vector3()).z)
            front += distance;
          else rear += distance;
        }
      assert.ok(
        physical > 0 && front > rear,
        "Version4 physical crush remains localized toward the impact face",
      );
      const visual = originalMeshes.reduce(
        (sum, [object, old]) =>
          sum +
          Array.from(object.geometry.attributes.position.array).reduce(
            (total, value, index) => total + Math.abs(value - old[index]),
            0,
          ),
        0,
      );
      assert.ok(
        visual > 0,
        "Original WAM-linked render geometry receives permanent crush",
      );
      samples.push({
        physical,
        visual,
        damage: Array.from(car.damage.componentLevels).reduce(
          (sum, value) => sum + value,
          0,
        ),
      });
    }
    assert.ok(
      samples[1].damage > samples[0].damage,
      "Greater source impulse increases original component damage",
    );
    assert.ok(
      samples[1].visual > samples[0].visual,
      "Greater source impulse increases authored render deflection",
    );
    assert.ok(
      samples[1].physical >= samples[0].physical - 1e-6,
      "Physical hull may saturate at authored shape limits",
    );
  });
}
