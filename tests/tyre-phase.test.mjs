import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { applyVehicleForces } from "../src/physics/motion.ts";
import { DamageSystem } from "../src/damage.ts";
import { createSimulatedCar } from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";

async function original(t, name) {
  let data;
  try {
    data = await originalCar(name);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Original installation absent");
      return;
    }
    throw error;
  }
  const damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  return createSimulatedCar(
    data.group,
    data.text,
    damage,
    new Vector3(0, -0.003, 0),
    0,
    true,
  );
}

test("original Eagle/Buggy invoke rear and front tyre effects before velocity application, with current wheel distances", async (t) => {
  for (const name of ["EAGLE3", "buggy"]) {
    const body = await original(t, name);
    if (!body) return;
    body.state.velocity.set(1, 0, -8);
    body.state.gear = 1;
    body.state.rpm = 4200;
    const before = body.state.velocity.clone(),
      oldLengths = body.state.wheelLengths.slice(),
      phases = [];
    const result = applyVehicleForces(
      body.state,
      { throttle: 1, steer: 0.5, brake: 0, handbrake: false },
      0.04,
      body.motion,
      {
        raycast(origin, direction, maximum) {
          const distance = -origin.y / direction.y;
          return distance >= 0 && distance <= maximum
            ? {
                distance,
                normal: new Vector3(0, 1, 0),
                friction: 1,
                rollingResistance: 0,
                downforce: 1,
              }
            : null;
        },
        tyreAxle(packet) {
          assert.deepEqual(
            body.state.velocity.toArray(),
            before.toArray(),
            "source pre-force velocity barrier",
          );
          assert.deepEqual(packet.velocityCarSpace.toArray(), before.toArray());
          assert.ok(
            packet.supportNormalBody.distanceTo(new Vector3(0, 1, 0)) < 1e-8,
          );
          phases.push({
            axle: packet.axle,
            lengths: body.state.wheelLengths.slice(),
            capacities: packet.capacities,
          });
        },
        stopTyreEffects() {
          assert.fail("supported car must not use no-wheel stop");
        },
      },
    );
    assert.equal(result.grounded, 4);
    assert.deepEqual(
      phases.map((phase) => phase.axle),
      [0, 1],
    );
    assert.deepEqual(phases[0].lengths, body.state.wheelLengths);
    assert.notDeepEqual(phases[0].lengths, oldLengths);
    assert.deepEqual(phases[0].capacities, result.wheelCapacities.slice(0, 2));
    assert.deepEqual(phases[1].capacities, result.wheelCapacities.slice(2, 4));
    assert.ok(body.state.velocity.distanceTo(before) > 0.01);
  }
});

test("native no-wheel voice stop runs before gravity changes airborne velocity", async (t) => {
  const body = await original(t, "EAGLE3");
  if (!body) return;
  body.state.position.y = 50;
  body.state.velocity.set(0, -1, 0);
  const before = body.state.velocity.clone();
  let stops = 0;
  const debug = applyVehicleForces(
    body.state,
    { throttle: 0, steer: 0, brake: 0, handbrake: false },
    0.04,
    body.motion,
    {
      raycast: () => null,
      tyreAxle() {
        assert.fail("airborne tyre allocator must be skipped");
      },
      stopTyreEffects() {
        stops++;
        assert.deepEqual(body.state.velocity.toArray(), before.toArray());
      },
    },
  );
  assert.equal(stops, 1);
  assert.equal(debug.grounded, 0);
  assert.ok(body.state.velocity.y < before.y);
});
