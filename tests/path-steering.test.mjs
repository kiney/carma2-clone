import assert from "node:assert/strict";
import test from "node:test";
import { Vector2 } from "three";
import {
  nativeCornerErrors,
  nativeInLaneSteering,
  nativeStraightErrors,
} from "../src/ai/path-steering.ts";

const v = (x, y) => new Vector2(x, y);
const close = (actual, expected, epsilon = 1e-10) =>
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );

test("straight errors use longitudinal, lateral, and beyond-finish branches", () => {
  const start = v(0, 0);
  const finish = v(10, 0);
  const velocity = v(0, 4);

  const lateral = nativeStraightErrors(start, finish, v(2, 3), velocity, 2);
  close(lateral.error, -1.5);
  close(lateral.headingError, 1);
  assert.equal(lateral.baseCurvature, 0);

  const wider = nativeStraightErrors(start, finish, v(2, 3), velocity, 4);
  close(wider.error, -0.75);

  // q <= 0 retains the longitudinal projection, even with lateral offset.
  close(nativeStraightErrors(start, finish, v(-2, 3), velocity, 2).error, -2);
  // q > L measures excess beyond the finish and does not use width.
  close(nativeStraightErrors(start, finish, v(14, 3), velocity, 100).error, 4);
  // q == L remains in the interior branch; q == 0 is longitudinal zero.
  close(nativeStraightErrors(start, finish, v(10, 3), velocity, 2).error, -1.5);
  close(nativeStraightErrors(start, finish, v(0, 3), velocity, 2).error, 0);
});

test("straight heading uses metric velocity and guards stationary or degenerate paths", () => {
  const forward = nativeStraightErrors(v(0, 0), v(10, 0), v(4, 1), v(0, 4), 2);
  close(forward.headingError, 1);
  const reversed = nativeStraightErrors(
    v(0, 0),
    v(10, 0),
    v(4, 1),
    v(0, -4),
    2,
  );
  close(reversed.headingError, -1);

  const stationary = nativeStraightErrors(
    v(0, 0),
    v(10, 0),
    v(4, 1),
    v(0, 0),
    2,
  );
  assert.equal(stationary.headingError, 0);
  const degenerate = nativeStraightErrors(
    v(1, 2),
    v(1, 2),
    v(9, 8),
    v(3, 4),
    2,
  );
  assert.deepEqual(degenerate, { error: 0, headingError: 0, baseCurvature: 0 });
  assert.throws(() =>
    nativeStraightErrors(v(0, 0), v(1, 0), v(0, 0), v(0, 0), 0),
  );
  assert.throws(() =>
    nativeStraightErrors(v(0, 0), v(1, 0), v(0, 0), v(0, 0), Infinity),
  );
});

test("corner error and heading signs follow turn handedness", () => {
  const center = v(0, 0);
  const position = v(3, 4);
  const velocity = v(0, 4);
  const left = nativeCornerErrors(center, 4, 2, true, position, velocity);
  const right = nativeCornerErrors(center, 4, 2, false, position, velocity);

  close(left.error, 0.5);
  close(right.error, -0.5);
  close(left.headingError, -1);
  close(right.headingError, 1);
  close(left.baseCurvature, 1 / (Math.fround(6.9) * 4));
  close(right.baseCurvature, -1 / (Math.fround(6.9) * 4));

  const outsideLeft = nativeCornerErrors(center, 5, 2, true, v(7, 0), velocity);
  const insideLeft = nativeCornerErrors(center, 5, 2, true, v(3, 0), velocity);
  close(outsideLeft.error, 1);
  close(insideLeft.error, -1);
});

test("corner stationary heading is guarded and invalid dimensions are rejected", () => {
  const stationary = nativeCornerErrors(v(0, 0), 5, 2, true, v(7, 0), v(0, 0));
  close(stationary.headingError, 0);
  close(stationary.error, 1);
  assert.throws(() =>
    nativeCornerErrors(v(0, 0), 0, 2, true, v(1, 0), v(1, 0)),
  );
  assert.throws(() =>
    nativeCornerErrors(v(0, 0), 5, -1, true, v(1, 0), v(1, 0)),
  );
});

test("in-lane acceptance is inclusive and desired speed reduction uses absolute heading", () => {
  const boundary = nativeInLaneSteering(
    { error: 1, headingError: 0, baseCurvature: 0 },
    6,
    10,
    0.2,
  );
  assert.ok(boundary);
  close(boundary.curvature, 0.020000000298023225);
  const negativeBoundary = nativeInLaneSteering(
    { error: -1, headingError: 0, baseCurvature: 0 },
    6,
    10,
    0.2,
  );
  assert.ok(negativeBoundary);
  close(negativeBoundary.curvature, -0.020000000298023225);

  assert.equal(
    nativeInLaneSteering(
      { error: 1.000001, headingError: 0, baseCurvature: 0 },
      6,
      10,
      0.2,
    ),
    undefined,
  );
  assert.equal(
    nativeInLaneSteering(
      { error: -1.000001, headingError: 0, baseCurvature: 0 },
      6,
      10,
      0.2,
    ),
    undefined,
  );

  const positiveHeading = nativeInLaneSteering(
    { error: 0, headingError: 0.25, baseCurvature: 0 },
    10,
    10,
    0.2,
  );
  const negativeHeading = nativeInLaneSteering(
    { error: 0, headingError: -0.25, baseCurvature: 0 },
    10,
    10,
    0.2,
  );
  close(positiveHeading.desiredSpeed, 9);
  close(negativeHeading.desiredSpeed, 9);
  close(positiveHeading.curvature, -0.05);
  close(negativeHeading.curvature, 0.05);

  const atOrBelowSix = nativeInLaneSteering(
    { error: 0, headingError: 0.5, baseCurvature: 0 },
    6,
    0,
    0.2,
  );
  close(atOrBelowSix.desiredSpeed, 6);
});

test("curvature limits scale above 12.5 m/s and final output clamps", () => {
  const errors = { error: 1, headingError: 0, baseCurvature: 0 };
  close(
    nativeInLaneSteering(errors, 6, 10, 0.2).curvature,
    0.020000000298023225,
  );
  close(
    nativeInLaneSteering(errors, 6, 12.5, 0.2).curvature,
    0.020000000298023225,
  );
  close(
    nativeInLaneSteering(errors, 6, 25, 0.2).curvature,
    0.010000000149011612,
  );

  close(
    nativeInLaneSteering(
      { error: 1, headingError: 0, baseCurvature: 0.3 },
      6,
      10,
      0.2,
    ).curvature,
    0.2,
  );
  close(
    nativeInLaneSteering(
      { error: -1, headingError: 0, baseCurvature: -0.3 },
      6,
      10,
      0.2,
    ).curvature,
    -0.2,
  );
});

test("in-lane steering rejects non-finite and negative speed or curvature inputs", () => {
  assert.throws(() =>
    nativeInLaneSteering(
      { error: NaN, headingError: 0, baseCurvature: 0 },
      6,
      1,
      1,
    ),
  );
  assert.throws(() =>
    nativeInLaneSteering(
      { error: 0, headingError: 0, baseCurvature: 0 },
      6,
      -1,
      1,
    ),
  );
  assert.throws(() =>
    nativeInLaneSteering(
      { error: 0, headingError: 0, baseCurvature: 0 },
      6,
      1,
      -1,
    ),
  );
});

test("native desired-speed store rounds the reduction before force control", () => {
  const result = nativeInLaneSteering(
    { error: 0, headingError: 0.13, baseCurvature: 0 },
    20.5,
    10,
    0.2,
  );
  assert.equal(result.desiredSpeed, 18.614999771118164);
});

test("nonfinite straight and corner vectors are rejected", () => {
  assert.throws(() =>
    nativeStraightErrors(v(0, 0), v(1, 0), v(NaN, 0), v(1, 0), 1),
  );
  assert.throws(() =>
    nativeCornerErrors(v(0, 0), 1, 1, true, v(1, 0), v(0, Infinity)),
  );
});

test("in-lane native corner heading can request a negative braking speed", () => {
  const errors = nativeCornerErrors(v(0, 0), 10, 2, true, v(11, 0), v(10, 0));
  assert.equal(errors.error, 0.5);
  const result = nativeInLaneSteering(errors, 80, 10, 0.2);
  assert.equal(result.desiredSpeed, Math.fround(-1.4000000000000057));
});
