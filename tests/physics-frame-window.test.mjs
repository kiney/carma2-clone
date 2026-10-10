import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { planPhysicsFrameWindow } from "../src/physics/frame-window.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { DamageSystem } from "../src/damage.ts";
import { WorldCollision } from "../src/world.ts";
import { originalCar } from "./support/original-car.mjs";

const near = (actual, expected) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test("native16ms windows step ahead and interpolate toward frame end", () => {
  let tick = 0;
  const counts = [],
    alphas = [];
  for (let start = 0; start < 160; start += 16) {
    const window = planPhysicsFrameWindow(tick, start, 16);
    tick = window.lastPhysicsTickMs;
    counts.push(window.steps);
    alphas.push(window.interpolationAlpha);
    assert.equal(window.skippedMs, 0);
  }
  assert.deepEqual(counts, [1, 0, 1, 0, 0, 1, 0, 1, 0, 0]);
  const expected = [0.4, 0.8, 0.2, 0.6, 1, 0.4, 0.8, 0.2, 0.6, 1];
  alphas.forEach((alpha, i) => near(alpha, expected[i]));
  assert.equal(tick, 160);
});

test("newer frame start floors resync and large periods preserve five-step budget", () => {
  const stall = planPhysicsFrameWindow(80, 600, 16);
  assert.equal(stall.stepStartMs, 600);
  assert.equal(stall.skippedMs, 520);
  assert.equal(stall.steps, 1);
  assert.equal(stall.lastPhysicsTickMs, 640);
  near(stall.interpolationAlpha, 0.4);
  for (const period of [600, 1000]) {
    const long = planPhysicsFrameWindow(40, 40, period);
    assert.equal(long.steps, 5);
    assert.equal(long.lastPhysicsTickMs, 240);
    assert.equal(long.interpolationAlpha, 1);
    const next = planPhysicsFrameWindow(
      long.lastPhysicsTickMs,
      40 + period,
      16,
    );
    assert.equal(next.stepStartMs, 40 + period);
    assert.equal(next.skippedMs, period - 200);
    assert.equal(next.steps, 1);
    assert.equal(next.lastPhysicsTickMs, 80 + period);
  }
  const unaligned = planPhysicsFrameWindow(80, 619, 16);
  assert.equal(unaligned.stepStartMs, 600);
  assert.equal(unaligned.lastPhysicsTickMs, 640);
  near(unaligned.interpolationAlpha, 0.875);
});

test("end equality does not step and invalid interpolation uses the latest pose", () => {
  const equal = planPhysicsFrameWindow(40, 24, 16);
  assert.equal(equal.steps, 0);
  assert.equal(equal.interpolationAlpha, 1);
  const earlier = planPhysicsFrameWindow(40, 16, 16);
  assert.equal(earlier.steps, 0);
  near(earlier.interpolationAlpha, 0.8);
  const tooFarAhead = planPhysicsFrameWindow(120, 0, 16);
  assert.equal(tooFarAhead.steps, 0);
  assert.equal(tooFarAhead.interpolationAlpha, 1);
});

test("absolute windows reject invalid ticks, periods and wrap boundaries", () => {
  for (const args of [
    [0, -1, 16],
    [-1, 0, 16],
    [0, 0.5, 16],
    [0, NaN, 16],
    [0, 0, 9],
    [0, 0, 1001],
    [0, 0, 16.5],
    [0, 0xffffffff, 16],
  ])
    assert.throws(() => planPhysicsFrameWindow(...args), /Invalid/);
});

test("simulation elapsed skips discarded intervals and legacy update does not inherit pose debt", () => {
  const scene = new Group();
  const simulation = new VehicleSimulation(new WorldCollision(scene), scene);
  const callbackTimes = [];
  simulation.onBeforeStep = () => callbackTimes.push(simulation.elapsed);
  const first = simulation.updateFrame(600, 16);
  assert.equal(first.steps, 1);
  near(callbackTimes[0], 0.6);
  near(simulation.elapsed, 0.64);
  near(simulation.accumulator, 0.016);
  simulation.update(0.024);
  near(simulation.elapsed, 0.64);
  near(simulation.accumulator, 0.024);
  simulation.update(0.016);
  near(simulation.elapsed, 0.68);
  near(simulation.accumulator, 0);
  const next = simulation.updateFrame(680, 16);
  assert.equal(next.steps, 1);
  near(simulation.elapsed, 0.72);
  near(simulation.accumulator, 0.016);
});

test("original Eagle physics advances only the native window steps across stalls", async (t) => {
  let data;
  try {
    data = await originalCar("EAGLE3");
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original Eagle assets absent");
      return;
    }
    throw error;
  }
  const damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  const scene = new Group();
  const car = createSimulatedCar(
    data.group,
    data.text,
    damage,
    new Vector3(0, 50, 0),
    0,
    true,
  );
  scene.add(car.group);
  const simulation = new VehicleSimulation(new WorldCollision(scene), scene);
  simulation.add(car);
  let expectedVelocity = 0;
  for (const [start, period, steps, tick] of [
    [0, 16, 1, 40],
    [16, 16, 0, 40],
    [600, 16, 1, 640],
    [640, 1000, 5, 840],
    [1640, 16, 1, 1680],
  ]) {
    const result = simulation.updateFrame(start, period);
    assert.equal(result.steps, steps);
    for (let i = 0; i < steps; i++) {
      expectedVelocity -= (10 * 0.04) / 6.9;
      expectedVelocity *=
        1 -
        (Math.abs(expectedVelocity) * 0.04 * 0.0005000000237487257 * 6.9) /
          car.properties.mass;
    }
    near(car.state.velocity.y, expectedVelocity);
    near(simulation.elapsed, tick / 1000);
    assert.equal(simulation.lastImpacts.length, 0);
  }
});
