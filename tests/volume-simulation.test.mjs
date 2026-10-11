import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  DoubleSide,
  Vector3,
} from "three";
import { originalCar } from "./support/original-car.mjs";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { WorldCollision } from "../src/world.ts";
import { hullsBounds } from "../src/physics/geometry.ts";
import { parseDefaultWaterVolume } from "../src/physics/volumes.ts";

const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${actual} != ${expected}`,
  );
const defaultWater = () =>
  parseDefaultWaterVolume(
    "// Default underwater special volume parameters\n.2\n50\n0\n.002\n-1\n-1\nNONE\n-1\n-1\n0\n10",
  );
function pond() {
  const scene = new Group();
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [-5, 0, -5, 5, 0, 5, 5, 0, -5, -5, 0, -5, -5, 0, 5, 5, 0, 5],
      3,
    ),
  );
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.name = "!water";
  material.userData.c2Flags = 4096;
  scene.add(new Mesh(geometry, material));
  return { scene, world: new WorldCollision(scene) };
}

test("two original cars enter, submerge and recover using finite water faces and actual source forces", async (t) => {
  for (const name of ["EAGLE3", "buggy"]) {
    let data;
    try {
      data = await originalCar(name);
    } catch (e) {
      if (e.code === "ENOENT") {
        t.skip("Local original cars absent");
        return;
      }
      throw e;
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
    const bounds = hullsBounds(car.hulls);
    car.state.position.y = -(bounds.min.y + bounds.max.y) * 0.5;
    // Installed TestAutoSpecialVolume projects bb2, including the suspension
    // setter's rear/front extension; centering bb1 is therefore not half wet.
    const wheelMinY = Math.min(
      bounds.min.y,
      Math.fround(
        (Math.fround(car.motion.wheelPositions[0].y) -
          Math.fround(car.motion.suspensionLength[0])) *
          Math.fround(1 / 6.9),
      ),
      Math.fround(
        (Math.fround(car.motion.wheelPositions[2].y) -
          Math.fround(car.motion.suspensionLength[1])) *
          Math.fround(1 / 6.9),
      ),
    );
    const expectedDepth = Math.fround(
      -(car.state.position.y + wheelMinY) / (bounds.max.y - wheelMinY),
    );
    const expectedGravity = 1 - 0.8 * expectedDepth;
    car.state.velocity.x = 4;
    const { scene, world } = pond();
    assert.equal(
      world.height(0, 0, 1),
      null,
      "Recovery and pedestrian height queries do not treat water as road",
    );
    scene.add(car.group);
    const simulation = new VehicleSimulation(world, scene);
    simulation.defaultWaterVolume = defaultWater();
    simulation.add(car);
    simulation.step();
    near(car.specialVolume.depth, expectedDepth);
    assert.equal(car.specialVolume.volume, simulation.defaultWaterVolume);
    near(car.state.volumeGravityFactor, expectedGravity);
    near(car.state.volumeDragFactor, 50 * expectedDepth);
    near(car.debug.force.y, -car.properties.mass * 10 * expectedGravity);
    assert.equal(
      car.debug.grounded,
      0,
      "Water is a non-solid surface, never a road",
    );
    assert.equal(
      simulation.lastImpacts.length,
      0,
      "Water itself creates no solid collision impulse",
    );
    car.state.position.y = -bounds.max.y - 1;
    simulation.reset(car);
    simulation.step();
    assert.equal(car.specialVolume.depth, 1);
    assert.equal(
      car.specialVolume.volume,
      simulation.defaultWaterVolume,
      "Native upward reset detects full submersion",
    );
    near(car.state.volumeGravityFactor, 0.2);
    car.state.underwaterAbility = true;
    simulation.step();
    near(car.state.volumeGravityFactor, 0.52);
    near(car.state.volumeDragFactor, 30);
    car.state.position.set(10, 2, 10);
    simulation.reset(car);
    simulation.step();
    assert.equal(
      car.specialVolume.volume,
      null,
      "Recovery outside finite pool clears the underwater latch",
    );
    near(car.state.volumeGravityFactor, 1);
    near(car.state.volumeDragFactor, 1);
    simulation.dispose();
  }
});
