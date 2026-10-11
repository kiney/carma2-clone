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
import { OilRuntime } from "../src/physics/oil.ts";

test("original Eagle and buggy acquire source per-wheel oil grip from a projected, persistent spill", async (t) => {
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
    const scene = new Group();
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(
        [-5, 0, -5, 5, 0, 5, 5, 0, -5, -5, 0, -5, -5, 0, 5, 5, 0, 5],
        3,
      ),
    );
    scene.add(new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })));
    const simulation = new VehicleSimulation(new WorldCollision(scene), scene);
    scene.add(car.group);
    simulation.oil = new OilRuntime({ random: () => 0.5 });
    simulation.add(car);
    for (let i = 0; i < 10; i++) simulation.step();
    assert.equal(car.debug.grounded, 4);
    assert.ok(simulation.dropOil(car));
    assert.ok(simulation.dropOil(car), "No same-car cooldown for ability");
    const oil = simulation.oil.spills.find(Boolean);
    Object.defineProperty(damage, "primaryRenderModelBounds", {
      configurable: true,
      get() {
        throw new Error("Principal MODEL re-selection after queue");
      },
    });
    assert.ok(
      !oil.source.readModelBounds().isEmpty(),
      "queue retains the captured MODEL rather than re-selecting a principal",
    );
    delete damage.primaryRenderModelBounds;
    const projected = simulation.projectOil(
      car.state.position,
      oil.fullSize,
      car,
    );
    assert.ok(
      projected,
      `${name}: no ground projection, actor=${car.state.position.toArray()}, min=${car.hulls[0].vertices.map((v) => v.y).sort((a, b) => a - b)[0]}`,
    );
    simulation.step();
    for (let i = 0; i < 50; i++) simulation.step();
    const spills = simulation.oil.spills.filter(Boolean);
    assert.equal(
      spills.length,
      2,
      JSON.stringify({
        name,
        normal: projected.normal.toArray(),
        normals: projected.nearbyFaceNormals.map((n) => n.toArray()),
        sides: projected.sameSideOfNearbyPlanes,
        pos: car.state.position.toArray(),
      }),
    );
    assert.ok(spills.every((s) => s.mesh.visible && !s.pending));
    assert.ok(
      car.debug.oilWheelFactors.every((f) => Math.abs(f - 0.08) < 1e-8),
      `${name}: ${car.debug.oilWheelFactors}`,
    );
    const oilPosition = spills[0].position.clone();
    car.state.velocity.z = -1;
    for (let i = 0; i < 5; i++) simulation.step();
    assert.ok(
      spills[0].position.equals(oilPosition),
      "Placed oil does not follow its car",
    );
    assert.ok(
      spills[0].currentSize > 0.2,
      "Ability oil continues growing despite owner movement",
    );
    simulation.dispose();
  }
});
