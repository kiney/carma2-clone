import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  NativeFlapFrame,
  sharedNativeFlapFrame,
} from "../src/physics/flap-frame.ts";

const rotation = new Quaternion();
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);

test("outer120ms produces one stored force from the final raw velocity", () => {
  const frame = new NativeFlapFrame();
  const car = {};
  frame.sample(car, 40, v(1, 2, 4), rotation);
  const force = frame.sample(car, 160, v(1.12, 2.24, 4.36), rotation);
  assert.deepEqual(force.toArray(), [1, 3.440000057220459, 3.0000009536743164]);
  assert.equal(frame.previousTick, 160);
});

test("the second same-tick car is guarded but its velocity and global tick are captured", () => {
  const frame = new NativeFlapFrame();
  const first = {},
    second = {};
  frame.sample(first, 40, v(), rotation, 0);
  const velocity = v(2, 0, 0);
  assert.equal(frame.sample(second, 40, velocity, rotation, 0), undefined);
  velocity.x = 99;
  assert.equal(frame.previousTick, 40);
  assert.deepEqual(
    frame.sample(second, 80, v(2, 0, 0), rotation, 0).toArray(),
    [0, 0, 0],
  );
});

test("inactive eligible callers prime velocity and still advance the shared clock", () => {
  const frame = new NativeFlapFrame();
  const inactive = {},
    active = {};
  // The caller ignores force while inactive; there is no active-flap gate here.
  frame.sample(inactive, 40, v(0.12), rotation, 0);
  frame.sample(active, 40, v(0.5), rotation, 0);
  frame.sample(inactive, 160, v(0.24), rotation, 0);
  assert.equal(frame.sample(active, 160, v(0.5), rotation, 0), undefined);
  assert.deepEqual(
    frame.sample(inactive, 200, v(0.24), rotation, 0).toArray(),
    [0, 0, 0],
  );
});

test("regressed physics ticks use the native unsigned wrapped period", () => {
  const frame = new NativeFlapFrame();
  const car = {};
  frame.sample(car, 2000, v(), rotation, 0);
  const force = frame.sample(car, 1032, v(1), rotation, 0);
  // uint32 period4294966328 stores FLOAT seconds4294966.5.
  assert.equal(force.x, 2.3283068628643377e-7);
  assert.equal(force.y, 0);
  assert.equal(frame.previousTick, 1032);
});

test("X/Y difference stores round before division while Z retains register precision", () => {
  const frame = new NativeFlapFrame();
  const car = {};
  frame.sample(car, 40, v(-(2 ** -24), -(2 ** -24), -(2 ** -24)), rotation, 0);
  const force = frame.sample(car, 41, v(1, 1, 1), rotation, 0);
  assert.deepEqual(
    force.toArray(),
    [999.9999389648438, 999.9999389648438, 1000],
  );
});

test("Batty gravity is stored Float32 and transformed into the current car frame", () => {
  const frame = new NativeFlapFrame();
  const car = {};
  const quarterTurn = new Quaternion().setFromAxisAngle(
    v(0, 0, 1),
    Math.PI / 2,
  );
  const force = frame.sample(car, 40, v(), quarterTurn, 1.44);
  assert.equal(force.x, Math.fround(1.44));
  assert.ok(Math.abs(force.y) < 1e-15);
  assert.equal(force.z, 0);
  assert.deepEqual(frame.sample(car, 80, v(), rotation, -1.44).toArray(), [
    0,
    Math.fround(-1.44),
    0,
  ]);
});

test("zero clock is not a first-update sentinel and the shared instance is exported", () => {
  const frame = new NativeFlapFrame();
  const car = {};
  assert.equal(frame.sample(car, 0, v(1), rotation), undefined);
  assert.deepEqual(frame.sample(car, 40, v(1), rotation).toArray(), [
    0,
    Math.fround(1.44),
    0,
  ]);
  assert.ok(sharedNativeFlapFrame instanceof NativeFlapFrame);
});

test("invalid authored inputs are rejected without advancing retained state", () => {
  const frame = new NativeFlapFrame();
  const car = {};
  assert.throws(() => frame.sample(car, -1, v(), rotation), /uint32/);
  assert.throws(() => frame.sample(car, 40, v(1e40), rotation), /velocity/);
  assert.throws(
    () => frame.sample(car, 40, v(), rotation, Infinity),
    /gravity/,
  );
  assert.throws(
    () => frame.sample(car, 40, v(), new Quaternion(0, 0, 0, 0)),
    /orientation/,
  );
  assert.equal(frame.previousTick, 0);
});
