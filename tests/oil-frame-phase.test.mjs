import test from "node:test";
import assert from "node:assert/strict";
import { Group } from "three";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { WorldCollision } from "../src/world.ts";
function fixture() {
  const scene = new Group(),
    simulation = new VehicleSimulation(new WorldCollision(scene), scene);
  const calls = [];
  simulation.oil = { update: (time) => calls.push(time), dispose: () => {} };
  return { simulation, calls };
}
test("production oil processes once after graphics rather than during multi-step physics", () => {
  const { simulation, calls } = fixture();
  simulation.deferFinalSmashFlush = true;
  simulation.smashClock = () => 81;
  const frame = simulation.updateFrame(0, 81);
  assert.ok(frame.steps >= 2);
  assert.deepEqual(calls, []);
  simulation.processOilFrame(81);
  simulation.flushSmashEffects();
  assert.deepEqual(
    calls,
    [81],
    "final flush cannot process newly queued oil again",
  );
  simulation.updateFrame(81, 40);
  assert.deepEqual(calls, [81]);
  simulation.processOilFrame(121);
  assert.deepEqual(calls, [81, 121]);
  simulation.dispose();
});
test("standalone outer-window oil adapter processes once with its game clock", () => {
  const { simulation, calls } = fixture();
  simulation.smashClock = () => 999;
  const frame = simulation.updateFrame(0, 160);
  assert.ok(frame.steps >= 4);
  assert.deepEqual(calls, [999]);
  simulation.dispose();
});
