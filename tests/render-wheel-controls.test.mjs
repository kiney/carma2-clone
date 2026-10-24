import test from "node:test";
import assert from "node:assert/strict";
import { RenderWheelControls } from "../src/render-wheel-controls.ts";

const car = () => ({
  state: { wheelLengths: [0.1, 0.2, 0.3, 0.4], curvature: -0.2 },
  poseEpoch: 0,
  damage: { repairRevision: 0 },
});
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);

test("wheel controls sample the last two physics ticks at the body-pose alpha without aliasing state", () => {
  const body = car(),
    history = new RenderWheelControls();
  history.capture([body]);
  body.state.wheelLengths.splice(0, 4, 0.5, 0.6, 0.7, 0.8);
  body.state.curvature = 0.4;
  const committed = structuredClone(body);
  const target = { wheelLengths: [1, 2, 3, 4, 5], curvature: 99 };
  for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
    assert.equal(history.sample(body, alpha, target), target);
    target.wheelLengths.forEach((value, wheel) =>
      near(value, 0.1 * (wheel + 1) + 0.4 * alpha),
    );
    near(target.curvature, -0.2 + 0.6 * alpha);
    assert.equal(target.wheelLengths.length, 4);
    assert.deepEqual(body, committed);
  }
  near(history.sample(body, -1).curvature, -0.2);
  near(history.sample(body, 2).curvature, 0.4);
  const copy = history.sample(body, 1);
  copy.wheelLengths[0] = 999;
  assert.equal(body.state.wheelLengths[0], 0.5);
});

test("a catch-up capture advances history once per actual tick", () => {
  const body = car(),
    history = new RenderWheelControls();
  history.capture([body]);
  body.state.curvature = 0.4;
  history.capture([body]);
  body.state.curvature = 0.8;
  near(history.sample(body, 0).curvature, 0.4);
  near(history.sample(body, 0.5).curvature, 0.6);
  near(history.sample(body, 1).curvature, 0.8);
});

test("missing history, pose changes and progressive/full repair revisions select current controls", () => {
  const body = car(),
    history = new RenderWheelControls();
  assert.deepEqual(history.sample(body, 0), body.state);
  history.capture([body]);
  body.poseEpoch++;
  body.state.curvature = 0.4;
  body.state.wheelLengths.fill(0.5);
  assert.deepEqual(history.sample(body, 0), body.state);
  history.capture([body]);
  body.damage.repairRevision++;
  body.state.curvature = 0.6;
  body.state.wheelLengths.fill(0.7);
  assert.deepEqual(history.sample(body, 0), body.state);
  history.capture([body]);
  body.state.curvature = 0.8;
  assert.deepEqual(
    history.sample(body, 1),
    body.state,
    "paused/inactive cars use alpha1",
  );
});

test("removed cars are pruned, and reload clear prevents recycled identities retaining stale history", () => {
  const body = car(),
    history = new RenderWheelControls();
  history.capture([body]);
  body.state.curvature = 0.7;
  history.capture([]);
  assert.deepEqual(history.sample(body, 0), body.state);
  history.capture([body]);
  body.state.curvature = 0.9;
  history.clear();
  assert.deepEqual(history.sample(body, 0), body.state);
});
