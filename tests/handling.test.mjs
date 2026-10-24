import test from "node:test";
import assert from "node:assert/strict";
import { createVehicle, updateVehicle } from "../src/legacy-arcade.ts";
import { Vector3 } from "three";

import { physicsConfigFromCar } from "../src/legacy-handling.ts";

const config = (extra) => ({
  wheels: [],
  dimensions: null,
  wheelbase: null,
  speedAtRedline: 200,
  acceleration: 5,
  brakeMultiplier: 1,
  brakingStrengthMultiplier: 1,
  ...extra,
});
const controls = { throttle: 1, steer: 0, brake: 0, handbrake: false };

test("original engine acceleration remains proportional and stronger engines accelerate faster", () => {
  const weak = physicsConfigFromCar(config({ acceleration: 3 }));
  const strong = physicsConfigFromCar(config({ acceleration: 8 }));
  assert.ok(strong.acceleration > weak.acceleration);
  assert.ok(Math.abs(strong.acceleration / weak.acceleration - 8 / 3) < 1e-10);
  assert.ok(
    Math.abs(physicsConfigFromCar(config({})).acceleration - (5 / 6.9) * 1.6) <
      1e-10,
  );
  const a = createVehicle(new Vector3(0, 0.05, 0)),
    b = createVehicle(new Vector3(0, 0.05, 0));
  for (let frame = 0; frame < 120; frame++) {
    updateVehicle(a, controls, 1 / 120, { height: () => 0 }, weak);
    updateVehicle(b, controls, 1 / 120, { height: () => 0 }, strong);
  }
  assert.ok(b.speed > a.speed * 2);
});

test("geometry, brake multipliers and speed use original mechanics units with valid fallbacks", () => {
  const parsed = physicsConfigFromCar(
    config({
      dimensions: [0.6, 0.2, 1],
      wheelbase: 0.7,
      brakeMultiplier: 2,
      brakingStrengthMultiplier: 1.5,
    }),
  );
  assert.equal(parsed.radius, 0.3);
  assert.equal(parsed.wheelbase, 0.7);
  assert.ok(Math.abs((parsed.maxSpeed * 6.9) / 0.44704 - 200) < 1e-10);
  assert.ok(Math.abs(parsed.braking - 3.8 * 3) < 1e-10);
  const invalid = physicsConfigFromCar(
    config({
      dimensions: [NaN, 0, 0],
      wheelbase: -1,
      acceleration: Infinity,
      speedAtRedline: -20,
      brakeMultiplier: NaN,
      brakingStrengthMultiplier: 0,
    }),
  );
  assert.ok(
    Object.values(invalid).every(
      (value) => Number.isFinite(value) && value > 0,
    ),
  );
  const wheels = physicsConfigFromCar(
    config({ wheels: [{ position: [0, 0, -0.3] }, { position: [0, 0, 0.3] }] }),
  );
  assert.equal(wheels.wheelbase, 0.6);
});
