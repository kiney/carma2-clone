import assert from "node:assert/strict";
import test from "node:test";
import { Vector2 } from "three";
import { nativeOutsideLaneSteering } from "../src/ai/path-steering.ts";

const v = (x, y) => new Vector2(x, y);
const close = (actual, expected, epsilon = 5e-9) =>
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );

const start = v(0, 0);
const finish = v(10, 0);
const state = (timeMs = 0, flipped = false) => ({ timeMs, flipped });

test("outside-lane steering targets speed six and uses clamped straight endpoints", () => {
  const before = nativeOutsideLaneSteering(
    start,
    finish,
    v(-2, 3),
    v(0, 4),
    0.2,
    100,
    state(),
  );
  assert.equal(before.desiredSpeed, 6);
  close(before.curvature, (-8 / (4 * Math.sqrt(13))) * 0.2);

  const after = nativeOutsideLaneSteering(
    start,
    finish,
    v(12, 1),
    v(0, 4),
    0.2,
    100,
    state(),
  );
  assert.equal(after.desiredSpeed, 6);
  close(after.curvature, (8 / (4 * Math.sqrt(5))) * 0.2);
});

test("the speed-12 boundary is strict and high-speed steering leaves escape state alone", () => {
  const atTwelve = nativeOutsideLaneSteering(
    start,
    finish,
    v(12, 1),
    v(0, 12),
    0.2,
    2000,
    state(500, true),
  );
  assert.equal(atTwelve.desiredSpeed, 6);
  assert.equal(atTwelve.curvature, 0);
  assert.deepEqual(atTwelve.escape, state(500, true));

  const below = nativeOutsideLaneSteering(
    start,
    finish,
    v(12, 1),
    v(0, 11.999),
    0.2,
    2000,
    state(),
  );
  assert.notEqual(below.curvature, 0);
  assert.equal(below.escape.timeMs, 2000);
});

test("moving-away escape starts once and toggles only after strictly more than 5000 ms", () => {
  const awayVelocity = v(0, 4);
  const initial = nativeOutsideLaneSteering(
    start,
    finish,
    v(12, 1),
    awayVelocity,
    0.2,
    1000,
    state(0, true),
  );
  assert.deepEqual(initial.escape, state(1000, false));
  const untoggled = nativeOutsideLaneSteering(
    start,
    finish,
    v(12, 1),
    awayVelocity,
    0.2,
    6000,
    initial.escape,
  );
  assert.deepEqual(untoggled.escape, state(1000, false));
  close(untoggled.curvature, initial.curvature);

  const toggled = nativeOutsideLaneSteering(
    start,
    finish,
    v(12, 1),
    awayVelocity,
    0.2,
    6001,
    untoggled.escape,
  );
  assert.deepEqual(toggled.escape, state(6001, true));
  close(toggled.curvature, -initial.curvature);

  const exactlyFiveSeconds = nativeOutsideLaneSteering(
    start,
    finish,
    v(12, 1),
    awayVelocity,
    0.2,
    11001,
    toggled.escape,
  );
  assert.deepEqual(exactlyFiveSeconds.escape, state(6001, true));
  const repeated = nativeOutsideLaneSteering(
    start,
    finish,
    v(12, 1),
    awayVelocity,
    0.2,
    11002,
    exactlyFiveSeconds.escape,
  );
  assert.deepEqual(repeated.escape, state(11002, false));
  close(repeated.curvature, initial.curvature);
});

test("approaching preserves escape timing and flip without applying the flip", () => {
  const prior = state(1000, true);
  const approaching = nativeOutsideLaneSteering(
    start,
    finish,
    v(12, 1),
    v(0, -4),
    0.2,
    10000,
    prior,
  );
  assert.deepEqual(approaching.escape, prior);
  close(approaching.curvature, (-8 / (4 * Math.sqrt(5))) * 0.2);

  const awayAgain = nativeOutsideLaneSteering(
    start,
    finish,
    v(12, 1),
    v(0, 4),
    0.2,
    10000,
    approaching.escape,
  );
  assert.deepEqual(awayAgain.escape, state(10000, false));
});

test("stationary and degenerate straight inputs return finite zero curvature", () => {
  const stationary = nativeOutsideLaneSteering(
    start,
    finish,
    v(12, 1),
    v(0, 0),
    0.2,
    1000,
    state(500, true),
  );
  close(stationary.curvature, 0);
  assert.deepEqual(stationary.escape, state(500, true));

  const degenerate = nativeOutsideLaneSteering(
    start,
    start,
    v(1, 2),
    v(1, 2),
    0.2,
    1000,
    state(500, true),
  );
  assert.equal(degenerate.desiredSpeed, 6);
  assert.equal(degenerate.curvature, 0);
  assert.deepEqual(degenerate.escape, state(500, true));
});

test("mixed Float32 length stores match the native outside-lane result", () => {
  const result = nativeOutsideLaneSteering(
    v(1.1, -2.2),
    v(13.7, 9.3),
    v(15.2, 10.6),
    v(1.7, 3.9),
    0.3,
    5102,
    state(100, false),
  );
  assert.equal(result.escape.timeMs, 5102);
  assert.equal(result.escape.flipped, true);
  close(result.curvature, -0.12931095018612782, 1e-12);

  // A full-double reconstruction lands several ULPs away after native's
  // Float32 stores of the horizontal deltas and closest-point distance.
  const doubleCurvature = -0.12931093144995853;
  assert.ok(Math.abs(result.curvature - doubleCurvature) > 1e-8);
});

test("outside-lane helper rejects non-finite inputs", () => {
  assert.throws(() =>
    nativeOutsideLaneSteering(
      start,
      finish,
      v(Infinity, 1),
      v(0, 1),
      0.2,
      0,
      state(),
    ),
  );
  assert.throws(() =>
    nativeOutsideLaneSteering(
      start,
      finish,
      v(1, 1),
      v(0, 1),
      0.2,
      NaN,
      state(),
    ),
  );
  assert.throws(() =>
    nativeOutsideLaneSteering(
      start,
      finish,
      v(1, 1),
      v(0, 1),
      -0.2,
      0,
      state(),
    ),
  );
});
