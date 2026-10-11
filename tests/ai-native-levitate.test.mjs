import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { NativeLevitateState } from "../src/ai/levitate.ts";

const query = (nowMs, overrides = {}) => ({
  nowMs,
  dtMs: 40,
  mass: 1000,
  velocity: new Vector3(),
  angularVelocity: new Vector3(),
  actorY: 3,
  ...overrides,
});

test("settling uses strict speed and angular gates and live exponential damping", () => {
  const state = new NativeLevitateState();
  assert.deepEqual(state.start(0, 1000), {
    settling: true,
    accForce: 0,
    brakeForce: 15000,
  });
  const moving = state.run(
    query(40, {
      velocity: new Vector3(Math.fround(0.0014492754125967622), 0, 0),
      angularVelocity: new Vector3(1, 2, 3),
    }),
  );
  assert.equal(moving.settling, true);
  assert.equal(moving.angularVelocity.x, Math.fround(1 / Math.pow(2, 0.04)));
  assert.equal(moving.angularVelocity.z, Math.fround(3 / Math.pow(2, 0.04)));
  assert.equal(
    state.run(query(4000, { velocity: new Vector3(1, 0, 0) })).settling,
    true,
  );
  const rising = state.run(query(4001, { velocity: new Vector3(1, 0, 0) }));
  assert.equal(rising.stopAndTurnPhysicsOff, true);
  assert.equal(rising.actorY, 3);
  assert.equal(state.snapshot.startMs, 4001);
});

test("levitation starts immediately when stationary, preserves base Y and finishes strictly above200", () => {
  const state = new NativeLevitateState();
  state.start(0, 1000);
  assert.equal(state.run(query(0)).stopAndTurnPhysicsOff, true);
  assert.equal(state.run(query(10000)).actorY, 28);
  assert.equal(state.run(query(20000)).actorY, 103);
  const boundary = state.run(query(30000));
  assert.equal(boundary.height, 200);
  assert.equal(boundary.finishedForRace, undefined);
  assert.equal(state.run(query(30001)).finishedForRace, true);
});

test("elapsed unsigned subtraction crosses the timestamp wrap", () => {
  const state = new NativeLevitateState();
  state.start(0xfffffff0, 1000);
  state.run(query(0xfffffff0));
  assert.equal(
    state.run(query(0x10)).actorY,
    Math.fround(3 + 0.25 * 0.032 * 0.032),
  );
});
