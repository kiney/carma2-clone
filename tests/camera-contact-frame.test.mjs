import test from "node:test";
import assert from "node:assert/strict";
import { CameraContactFrame } from "../src/camera/contact-frame.ts";
import { Vector3 } from "three";
const a = {},
  b = {};
const row = (values = {}) => ({
  a,
  b,
  normalImpulse: 0,
  solverAccepted: true,
  point: new Vector3(),
  normal: new Vector3(0, 1, 0),
  closingSpeed: 0,
  tangentImpulse: new Vector3(),
  ...values,
});
test("native camera flag accumulates accepted zero-impulse contacts across steps", () => {
  const frame = new CameraContactFrame();
  frame.begin();
  frame.step([row()]);
  frame.step([]);
  assert.ok(frame.bodies.has(a));
  assert.ok(frame.bodies.has(b));
  frame.finish(80, 80);
  frame.begin();
  assert.equal(frame.bodies.size, 0);
});
test("only preceding final-step contacts survive positive native overshoot", () => {
  for (const gap of [-1, 0, 1, 40, 41]) {
    const frame = new CameraContactFrame();
    frame.begin();
    frame.step([row({ b: undefined })]);
    frame.finish(100, 100 - gap);
    frame.begin();
    assert.equal(frame.bodies.has(a), gap > 0 && gap <= 40);
  }
  const frame = new CameraContactFrame();
  frame.begin();
  frame.step([row()]);
  frame.step([]);
  frame.finish(80, 70);
  frame.begin();
  assert.equal(frame.bodies.size, 0);
});
test("invalidated contact solves and native disabled rows cannot set camera flags", () => {
  const frame = new CameraContactFrame();
  frame.begin();
  frame.step([row({ solverAccepted: false }), row({ sourceType: 9 })]);
  assert.equal(frame.bodies.size, 0);
  frame.step([row({ sourceType: 14 })]);
  assert.ok(frame.bodies.has(a));
});
