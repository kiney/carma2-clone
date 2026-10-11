import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";

const emptyWorld = { raycast: () => null, querySurfaces: () => [] };
async function car(t, name, position, human = false) {
  let data;
  try {
    data = await originalCar(name);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original cars absent");
      return;
    }
    throw error;
  }
  const damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  const body = createSimulatedCar(
    data.group,
    data.text,
    damage,
    position,
    0,
    human,
  );
  // Requested fixture locations are native car.pos (world COM).
  body.state.position.sub(body.properties.centerOfMass);
  return body;
}
function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
}

test("installed repulsion wakes registered cars, uses temporary multiplier rather than stock mass and retains native attribution", async (t) => {
  const source = await car(t, "EAGLE3", new Vector3(0, 20, 0), true);
  if (!source) return;
  const light = await car(t, "buggy", new Vector3(3.5, 20, 0));
  const heavy = await car(t, "bigdump", new Vector3(-3.5, 20, 0));
  const outside = await car(t, "EAGLE3", new Vector3(7, 20, 0));
  if (!light || !heavy || !outside) return;
  assert.ok(heavy.properties.mass > light.properties.mass);
  const sim = new VehicleSimulation(emptyWorld, new Group());
  for (const body of [source, light, heavy, outside]) sim.add(body);
  t.after(() => sim.dispose());
  sim.setCarPhysicsActive(light, false);
  heavy.knackered = true;
  heavy.temporaryMassMultiplier = 2;
  heavy.state.orientation.copy(
    new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2),
  );
  source.damage.damageContext.random = () => 0;
  heavy.state.position
    .copy(new Vector3(-3.5, 20, 0))
    .sub(
      heavy.properties.centerOfMass
        .clone()
        .applyQuaternion(heavy.state.orientation),
    );
  sim.elapsed = 1.2;
  sim.crashClock = () => 123456;
  assert.equal(sim.repulseOpponents(source, [12, 0.2, 3, 7]), true);
  assert.equal(sim.isCarPhysicsActive(light), true);
  near(light.state.velocity.x, 6);
  near(light.state.velocity.y, 1.2);
  near(heavy.state.velocity.x, -3);
  near(heavy.state.velocity.y, 0.6);
  const heavyLocalOmega = heavy.state.angularVelocity
    .clone()
    .applyQuaternion(heavy.state.orientation.clone().invert());
  for (const value of heavyLocalOmega.toArray()) near(value, -0.75);
  for (const body of [light, heavy]) {
    assert.equal(body.networkStateCutoffMs, 1240);
    assert.equal(body.lastAwardAttacker, source);
    assert.equal(body.crashHistory.lastAttacker, source.group.uuid);
    assert.equal(body.crashHistory.lastMs, 123456);
    assert.equal(body.lastAwardImpactMs, 123456);
  }
  assert.equal(heavy.knackered, true, "repulsion cannot repair a wasted car");
  assert.deepEqual(
    outside.state.velocity.toArray(),
    [0, 0, 0],
    "strict authored radius excludes boundary",
  );
  assert.deepEqual(
    source.state.velocity.toArray(),
    [0, 0, 0],
    "source identity excluded",
  );
  assert.equal(
    light.damage.componentLevels.some((level) => level),
    false,
    "repulsion itself fabricates no damage",
  );
});

test("a rejected repulsion has no random draws or timestamp mutation", async (t) => {
  const source = await car(t, "EAGLE3", new Vector3());
  if (!source) return;
  const target = await car(t, "buggy", new Vector3(7, 0, 0));
  if (!target) return;
  const sim = new VehicleSimulation(emptyWorld, new Group());
  sim.add(source);
  sim.add(target);
  t.after(() => sim.dispose());
  source.damage.damageContext.random = () => {
    throw new Error("Ineligible target consumed RNG");
  };
  assert.equal(sim.repulseOpponents(source, [12, 0.2, 3, 7]), false);
  assert.equal(target.networkStateCutoffMs, undefined);
  assert.equal(target.lastAwardAttacker, undefined);
});
