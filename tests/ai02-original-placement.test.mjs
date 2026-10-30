import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { originalCar } from "./support/original-car.mjs";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { NativeOpponentPlacement } from "../src/physics/opponent-placement.ts";
import { NativePathView } from "../src/ai/path-view.ts";

for (const name of ["EAGLE3", "buggy", "bigdump"])
  test(`original ${name} placement preserves component damage, physical shape and part ownership`, async (t) => {
    let original;
    try {
      original = await originalCar(name);
    } catch (error) {
      if (error.code === "ENOENT")
        return t.skip("Local original installation absent");
      throw error;
    }
    const damage = new DamageSystem(
      original.assets,
      original.group,
      original.text,
    );
    await damage.init();
    const car = createSimulatedCar(
      original.group,
      original.text,
      damage,
      new Vector3(0, 2, 0),
      0,
      false,
    );
    damage.damageContext.random = () => 0.5;
    original.group.updateMatrixWorld(true);
    const mesh = damage.primaryRenderMesh;
    assert.ok(mesh, "original principal render model present");
    const point = new Vector3()
      .fromBufferAttribute(mesh.geometry.attributes.position, 0)
      .applyMatrix4(mesh.matrixWorld)
      .applyMatrix4(original.group.matrixWorld.clone().invert());
    if (name === "EAGLE3") {
      damage.applyImpact(
        [point],
        new Vector3(0, 0, 2),
        false,
        true,
        10000,
        new Vector3(0, 0, 1),
      );
      assert.ok(
        damage.deformationRevision > 0,
        "Eagle fixture has genuine original-data crush before placement",
      );
    }
    damage.componentLevels[0] = 37;
    const world = { querySurfaces: () => [], raycast: () => null };
    const sim = new VehicleSimulation(world, new Group());
    t.after(() => sim.dispose());
    sim.add(car);
    sim.syncStructuralState(car);
    const hulls = car.hulls,
      shape = hulls.map((h) => h.vertices.map((v) => v.toArray())),
      components = Array.from(damage.componentLevels),
      revision = damage.deformationRevision,
      parts = damage.runtimeParts.map((p) => ({
        part: p,
        detached: p.detached,
        actor: p.actor,
      }));
    const nodes = [new Vector3(0, 2, 0), new Vector3(0, 2, 20)],
      sections = [
        {
          nodeIndices: [0, 1],
          width: 3,
          minSpeed: [0, 0],
          maxSpeed: [255, 255],
          type: 0,
          oneWay: false,
        },
      ];
    const placement = new NativeOpponentPlacement(sim, world, nodes, sections);
    sim.setCarPhysicsActive(car, false);
    assert.equal(
      placement.onSection(
        car,
        NativePathView.projected(nodes, sections, [
          { section: 0, direction: 1 },
        ]),
        0,
        5,
      ),
      1,
    );
    assert.equal(sim.isCarPhysicsActive(car), true);
    assert.equal(car.group.visible, true);
    assert.equal(car.hulls, hulls);
    assert.deepEqual(
      car.hulls.map((h) => h.vertices.map((v) => v.toArray())),
      shape,
    );
    assert.equal(damage.deformationRevision, revision);
    assert.deepEqual(Array.from(damage.componentLevels), components);
    assert.ok(
      parts.every(
        (row) =>
          damage.runtimeParts.includes(row.part) &&
          row.part.detached === row.detached &&
          row.part.actor === row.actor,
      ),
    );
    assert.ok(Math.abs(car.state.velocity.length() - 5) < 1e-5);
  });
