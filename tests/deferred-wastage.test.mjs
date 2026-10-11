import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Group, Vector3 } from "three";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";

async function eagle(t, human = true) {
  let data;
  try {
    data = await originalCar("EAGLE3");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original Eagle data absent");
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
    new Vector3(),
    0,
    human,
  );
  const simulation = new VehicleSimulation(
    {
      raycast() {
        return null;
      },
      querySurfaces() {
        return [];
      },
    },
    new Group(),
  );
  simulation.add(car);
  t.after(() => simulation.dispose());
  return { car, damage, simulation };
}

test("deferred original Eagle bend updates health and reports wastage in the same outer frame", async (t) => {
  const fixture = await eagle(t);
  if (!fixture) return;
  const { car, damage, simulation } = fixture;
  const bounds = new Box3();
  for (const shape of damage.shapes)
    for (const vertex of shape.vertices) bounds.expandByPoint(vertex);
  // Stock Eagle WAM bendability1 and its front hull beyond bendZMin admit
  // force7 (> source threshold2.5). A zero random draw selects the native
  // bend branch and DamageSystems' minimum increment10; DoDamage caps95 at99.
  assert.equal(damage.wam.bendability, 1);
  assert.ok(bounds.min.z < damage.wam.bendZMin);
  assert.equal(damage.carSoftness, 0.7);
  damage.damageContext.random = () => 0;
  damage.componentLevels[0] = 95;
  car.state.health = 5;
  const wasted = [];
  simulation.onWasted = (body) => wasted.push(body);
  let forceSteps = 0;
  // Isolate contact discovery while retaining the actual impact admission,
  // ordinary queue, structural selection, bend and component-damage paths.
  simulation.step = () => {
    forceSteps++;
    simulation.elapsed += 0.04;
    damage.applyImpact(
      [new Vector3(0, 0, bounds.min.z)],
      new Vector3(),
      false,
      true,
      40,
      new Vector3(0, 0, 10),
    );
    assert.equal(simulation.ordinaryCrushQueue.count, 1);
    assert.equal(damage.structuralBend, undefined);
    assert.equal(damage.componentLevels[0], 95);
    assert.equal(car.knackered, false);
    assert.deepEqual(wasted, []);
  };
  const first = simulation.updateFrame(0, 10);
  assert.equal(first.steps, 1);
  assert.equal(forceSteps, 1);
  assert.ok(
    damage.structuralBend,
    "the original model actually bends at the deferred drain",
  );
  assert.equal(damage.componentLevels[0], 99);
  assert.equal(car.state.health, 1);
  assert.equal(car.knackered, true);
  assert.equal(car.wastedAt, simulation.elapsed);
  assert.deepEqual(wasted, [car]);
  assert.equal(simulation.ordinaryCrushQueue.count, 0);
  // The completed40ms tick is ahead of this20ms render end, so no new force
  // step can mask a delayed callback or health refresh.
  const second = simulation.updateFrame(10, 10);
  assert.equal(second.steps, 0);
  assert.equal(forceSteps, 1);
  assert.equal(car.state.health, 1);
  assert.equal(car.wastedAt, 0.04);
  assert.deepEqual(
    wasted,
    [car],
    "same-frame wastage is reported exactly once",
  );
});

test("outer-frame health refresh preserves deferred AI attenuation until a real wastage check", async (t) => {
  const fixture = await eagle(t, false);
  if (!fixture) return;
  const { car, damage, simulation } = fixture;
  // This is the existing AI earnings-attenuation state: component levels
  // may satisfy CheckDamage while its explicit check is still deferred.
  damage.componentLevels[0] = 99;
  simulation.deferredCrashWastage.add(car);
  simulation.elapsed = 0.04;
  car.state.health = 5;
  const wasted = [];
  simulation.onWasted = (body) => wasted.push(body);
  simulation.step = () => assert.fail("These frames must not run force steps");
  assert.equal(simulation.updateFrame(0, 10).steps, 0);
  assert.equal(damage.wasted, true);
  assert.equal(car.state.health, 1);
  assert.equal(car.knackered, false);
  assert.equal(car.wastedAt, undefined);
  assert.deepEqual(wasted, []);
  // Invoke the production CheckDamage outlet, which removes the attenuation
  // deferral and derives knackered from the real component damage levels.
  damage.onWastageCheck();
  assert.equal(simulation.deferredCrashWastage.has(car), false);
  assert.equal(car.knackered, true);
  assert.equal(simulation.updateFrame(10, 10).steps, 0);
  assert.equal(car.wastedAt, 0.04);
  assert.deepEqual(wasted, [car]);
});
