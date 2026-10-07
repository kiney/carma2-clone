import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  WORLD_METRES_PER_UNIT,
  DEFAULT_VEHICLE_CONFIG,
  createVehicle,
  updateVehicle,
  speedMph,
  checkpointCrossing,
  createRace,
  updateRace,
  repairVehicle,
  recoverVehicle,
} from "../src/gameplay.ts";

const flat = { height: () => 0 };
const controls = (
  throttle = 0,
  steer = 0,
  brake = false,
  handbrake = false,
) => ({ throttle, steer, brake, handbrake });
const car = () => createVehicle(new Vector3(0, 0.05, 0));
function simulate(vehicle, input, seconds, ground = flat) {
  for (let i = 0; i < seconds * 120; i++)
    updateVehicle(vehicle, input, 1 / 120, ground);
}
function gate(z, direction = 0) {
  return {
    points: [
      new Vector3(-2, 0, z),
      new Vector3(2, 0, z),
      new Vector3(2, 3, z),
      new Vector3(-2, 3, z),
    ],
    direction,
  };
}

test("driving uses original units, faces negative Z, brakes and caps forward/reverse speed", () => {
  assert.equal(WORLD_METRES_PER_UNIT, 6.9);
  const vehicle = car();
  simulate(vehicle, controls(1), 4);
  assert.ok(vehicle.position.z < -10);
  assert.ok(vehicle.speed > 5);
  assert.equal(vehicle.position.y, 0.05);
  const before = vehicle.speed;
  simulate(vehicle, controls(0, 0, true), 2);
  assert.ok(vehicle.speed < before);
  assert.ok(
    vehicle.speed >= 0,
    "brake must not turn into reverse acceleration",
  );
  simulate(vehicle, controls(-1), 8);
  assert.equal(vehicle.speed, -DEFAULT_VEHICLE_CONFIG.reverseSpeed);
  simulate(vehicle, controls(1), 30);
  assert.ok(Math.abs(vehicle.speed - DEFAULT_VEHICLE_CONFIG.maxSpeed) < 1e-8);
  assert.ok(Math.abs(speedMph(vehicle) - 200) < 1e-8);
});

test("steering needs motion, reverses when backing up, and handbrake preserves lateral drift", () => {
  const stationary = car();
  simulate(stationary, controls(0, 1), 1);
  assert.equal(stationary.heading, 0);
  const forward = car();
  simulate(forward, controls(1, 1), 1);
  assert.ok(forward.heading > 0);
  assert.ok(forward.position.x < 0);
  const reverse = car();
  simulate(reverse, controls(-1, 1), 1);
  assert.ok(reverse.heading < 0);
  const grip = car();
  const slide = car();
  grip.velocity.x = slide.velocity.x = 2;
  simulate(grip, controls(), 0.25);
  simulate(slide, controls(0, 0, false, true), 0.25);
  assert.ok(slide.velocity.x > grip.velocity.x * 2);
});

test("terrain follows modest slopes and gravity carries the vehicle across a missing road", () => {
  const slope = car();
  simulate(slope, controls(1), 1, { height: (_x, z) => -z * 0.1 });
  assert.ok(slope.position.y > 0.1);
  assert.ok(
    Math.abs(slope.position.y - (-slope.position.z * 0.1 + 0.05)) < 1e-8,
  );
  const falling = createVehicle(new Vector3(0, 1, 0));
  simulate(falling, controls(1), 0.25, { height: () => null });
  assert.ok(falling.position.y < 1);
  assert.ok(falling.velocity.y < -0.3);
  assert.equal(
    falling.position.z,
    0,
    "airborne throttle does not manufacture traction",
  );
  simulate(falling, controls(), 2, flat);
  assert.equal(falling.position.y, 0.05);
  assert.equal(falling.velocity.y, 0);
  const cliff = car();
  cliff.velocity.z = -2;
  simulate(cliff, controls(), 0.5, {
    height: (_x, z) => (z > -0.2 ? 0 : null),
  });
  assert.ok(cliff.position.y < 0.05);
});

test("swept wall collision prevents tunnelling, damages on impact, and retains tangent velocity", () => {
  const vehicle = car();
  vehicle.velocity.set(1, 0, -10);
  let contacts = 0;
  const wall = {
    height: () => 0,
    sweep(from, to, radius) {
      const boundary = -0.6 + radius;
      if (from.z >= boundary && to.z < boundary) {
        contacts++;
        return {
          fraction: (boundary - from.z) / (to.z - from.z),
          normal: new Vector3(0, 0, 1),
        };
      }
      return null;
    },
  };
  const result = updateVehicle(vehicle, controls(), 0.1, wall);
  assert.ok(contacts > 0);
  assert.ok(vehicle.position.z >= -0.4);
  assert.ok(vehicle.position.x > 0);
  assert.ok(vehicle.velocity.z > 0, "collision produces a small rebound");
  assert.ok(result.collisionSpeed > 9);
  assert.ok(vehicle.health < 30);
});

test("substeps keep regular frame rates consistent and ignore invalid durations", () => {
  const a = car();
  const b = car();
  for (let i = 0; i < 60; i++) updateVehicle(a, controls(1, 0.4), 1 / 60, flat);
  for (let i = 0; i < 120; i++)
    updateVehicle(b, controls(1, 0.4), 1 / 120, flat);
  assert.ok(a.position.distanceTo(b.position) < 1e-9);
  const snapshot = a.position.clone();
  updateVehicle(a, controls(1), NaN, flat);
  updateVehicle(a, controls(1), -1, flat);
  assert.ok(a.position.equals(snapshot));
});

test("finite checkpoint polygons count swept crossing and enforce winding direction", () => {
  const from = new Vector3(0, 1, 5);
  const to = new Vector3(0, 1, -5);
  assert.equal(checkpointCrossing(from, to, gate(0)), 0.5);
  assert.equal(
    checkpointCrossing(new Vector3(3, 1, 5), new Vector3(3, 1, -5), gate(0)),
    null,
  );
  assert.equal(
    checkpointCrossing(new Vector3(0, 4, 5), new Vector3(0, 4, -5), gate(0)),
    null,
  );
  assert.equal(checkpointCrossing(from, to, gate(0, 1)), null);
  assert.equal(checkpointCrossing(from, to, gate(0, -1)), 0.5);
  assert.equal(checkpointCrossing(from, new Vector3(0, 1, 0), gate(0)), null);
  assert.equal(checkpointCrossing(new Vector3(0, 1, 0), to, gate(0)), 0);
  assert.equal(checkpointCrossing(from, from, gate(0)), null);
});

test("racing requires checkpoints in order, progresses laps, freezes completion and awards credits", () => {
  const race = createRace([gate(0), gate(-4)], { laps: 2, timeLimit: 10 });
  let events = updateRace(
    race,
    new Vector3(0, 1, -3),
    new Vector3(0, 1, -5),
    1,
  );
  assert.deepEqual(events, []);
  assert.equal(race.nextCheckpoint, 0);
  events = updateRace(race, new Vector3(0, 1, 5), new Vector3(0, 1, -5), 1);
  assert.deepEqual(
    events.map((e) => e.type),
    ["checkpoint", "checkpoint", "lap"],
  );
  assert.equal(race.lap, 2);
  assert.equal(race.credits, 1200);
  assert.equal(race.timeLeft, 38);
  events = updateRace(race, new Vector3(0, 1, 5), new Vector3(0, 1, -5), 1);
  assert.deepEqual(
    events.map((e) => e.type),
    ["checkpoint", "checkpoint", "completed"],
  );
  assert.equal(race.status, "completed");
  assert.equal(race.credits, 3400);
  assert.equal(race.lap, 2);
  const elapsed = race.elapsed;
  assert.deepEqual(updateRace(race, new Vector3(), new Vector3(), 100), []);
  assert.equal(race.elapsed, elapsed);
});

test("checkpoint timing cannot revive an expired timer but timely crossings grant their bonus", () => {
  const from = new Vector3(0, 1, 5);
  const to = new Vector3(0, 1, -5);
  const expired = createRace([gate(0)], { timeLimit: 0.4 });
  assert.deepEqual(
    updateRace(expired, from, to, 1).map((e) => e.type),
    ["failed"],
  );
  assert.equal(expired.timeLeft, 0);
  assert.equal(expired.credits, 1000);
  assert.equal(expired.elapsed, 0.4);
  const timely = createRace([gate(0)], {
    timeLimit: 0.6,
    checkpointBonusSeconds: 5,
  });
  assert.deepEqual(
    updateRace(timely, from, to, 1).map((e) => e.type),
    ["checkpoint", "lap"],
  );
  assert.ok(Math.abs(timely.timeLeft - 4.6) < 1e-9);
  assert.equal(timely.elapsed, 1);
});

test("repairs and recovery spend credits atomically and recovery resets motion", () => {
  const vehicle = car();
  const race = createRace([]);
  vehicle.health = 50;
  assert.equal(repairVehicle(vehicle, race), true);
  assert.equal(vehicle.health, 100);
  assert.equal(race.credits, 750);
  assert.equal(repairVehicle(vehicle, race), false);
  vehicle.health = 0;
  race.credits = 10;
  assert.equal(repairVehicle(vehicle, race), false);
  assert.equal(vehicle.health, 0);
  assert.equal(race.credits, 10);
  vehicle.velocity.set(2, -3, 4);
  assert.equal(
    recoverVehicle(vehicle, race, new Vector3(5, 0.05, 6), 1),
    false,
  );
  race.credits = 250;
  assert.equal(recoverVehicle(vehicle, race, new Vector3(5, 0.05, 6), 1), true);
  assert.deepEqual(vehicle.position.toArray(), [5, 0.05, 6]);
  assert.equal(vehicle.velocity.length(), 0);
  assert.equal(vehicle.heading, 1);
  assert.equal(race.credits, 0);
});
test("one checkpoint accepts crossing either of its original disjoint quads", () => {
  const quad = (z) => [
    new Vector3(0, -2, z),
    new Vector3(0, 2, z),
    new Vector3(0, 2, z + 1),
    new Vector3(0, -2, z + 1),
  ];
  const gate = { points: [...quad(0), ...quad(5)] };
  assert.equal(
    checkpointCrossing(new Vector3(-1, 0, 5.5), new Vector3(1, 0, 5.5), gate),
    0.5,
  );
  assert.equal(
    checkpointCrossing(new Vector3(-1, 0, 2.5), new Vector3(1, 0, 2.5), gate),
    null,
  );
});
