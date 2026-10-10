import test from "node:test";
import assert from "node:assert/strict";
import { applyCameraControls } from "../src/camera/controls.ts";

const controls = (overrides = {}) =>
  applyCameraControls({
    zoom: 1,
    yaw: 0,
    reset: false,
    reverse: false,
    dtMs: 0,
    closer: false,
    farther: false,
    orbitLeft: false,
    orbitRight: false,
    ...overrides,
  });

test("orbit advances by 50 degrees per second in quantized BRender angles", () => {
  assert.equal(controls({ dtMs: 1000, orbitRight: true }).yaw, 9102);
  assert.equal(controls({ dtMs: 1000, orbitLeft: true }).yaw, 0xdc72);
  assert.equal(controls({ dtMs: 20, orbitRight: true }).yaw, 182);
});

test("reverse swaps orbit direction and yaw wraps as unsigned 16-bit", () => {
  assert.equal(
    controls({ yaw: 10, dtMs: 1000, reverse: true, orbitRight: true }).yaw,
    (10 - 9102) & 0xffff,
  );
  assert.equal(controls({ yaw: 65530, dtMs: 1, orbitRight: true }).yaw, 3);
  assert.equal(controls({ yaw: 2, dtMs: 1, orbitLeft: true }).yaw, 65529);
});

test("both orbit keys reset yaw and latch until both keys are released", () => {
  const reset = controls({
    yaw: 1234,
    reset: false,
    orbitLeft: true,
    orbitRight: true,
  });
  assert.deepEqual(reset, { zoom: 1, yaw: 0, reset: true, manualMove: true });

  const heldLatch = controls({
    yaw: 1234,
    reset: true,
    dtMs: 1000,
    orbitRight: true,
  });
  assert.deepEqual(heldLatch, {
    zoom: 1,
    yaw: 1234,
    reset: true,
    manualMove: true,
  });
  assert.deepEqual(controls({ reset: true }), {
    zoom: 1,
    yaw: 0,
    reset: false,
    manualMove: false,
  });
  assert.equal(controls({ reset: true, orbitRight: true }).reset, true);
});

test("zoom applies farther then closer with float32 timestep steps and native bounds", () => {
  const farther = controls({ zoom: 1, dtMs: 1000, farther: true });
  assert.equal(farther.zoom, 1.5);
  assert.equal(controls({ zoom: 1.999, dtMs: 1000, farther: true }).zoom, 2);
  assert.equal(
    controls({ zoom: 0.101, dtMs: 1000, closer: true }).zoom,
    Math.fround(0.1),
  );

  // At the upper limit, the first zoom-in is clamped before zoom-out runs.
  assert.equal(
    controls({ zoom: 2, dtMs: 1000, farther: true, closer: true }).zoom,
    1.5,
  );
  assert.equal(
    controls({ zoom: 1, dtMs: 1, farther: true }).zoom,
    Math.fround(1.0005),
  );
});

test("manual movement is reported independently of the reset latch", () => {
  assert.equal(controls({ reset: true, orbitLeft: true }).manualMove, true);
  assert.equal(controls().manualMove, false);
});

test("camera controls reject invalid zoom, angle, timestep, and flags", () => {
  for (const zoom of [NaN, Infinity, -Infinity])
    assert.throws(() => controls({ zoom }));
  for (const yaw of [-1, 65536, 1.5]) assert.throws(() => controls({ yaw }));
  for (const dtMs of [-1, 0.5, 0x100000000, NaN, Infinity])
    assert.throws(() => controls({ dtMs }));
  assert.throws(() => controls({ orbitLeft: 1 }));
});
