import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  nativePursuitPrediction,
  nativePursuitReverse,
} from "../src/ai/pursuit-motion.ts";

test("direct pursuit predicts half the current separation time using relative model velocity", () => {
  const result = nativePursuitPrediction(
    new Vector3(),
    new Vector3(10, 0, 0),
    new Vector3(),
    new Vector3(2, 0, 0),
  );
  assert.equal(result.distance, 10);
  assert.equal(result.relativeSpeed, 2);
  assert.equal(result.time, 2.5);
  assert.deepEqual(result.finish.toArray(), [15, 0, 0]);
});

test("relative speed below one suppresses prediction, but equality enables it", () => {
  const at = nativePursuitPrediction(
    new Vector3(),
    new Vector3(10, 0, 0),
    new Vector3(1, 0, 0),
    new Vector3(2, 0, 0),
  );
  assert.equal(at.time, 5);
  assert.equal(at.finish.x, 20);
  const below = nativePursuitPrediction(
    new Vector3(),
    new Vector3(10, 0, 0),
    new Vector3(1.5, 0, 0),
    new Vector3(2, 0, 0),
  );
  assert.equal(below.time, 0);
  assert.equal(below.finish.x, 10);
});

test("prediction uses full three-dimensional separation and two Float32 offset stores", () => {
  const result = nativePursuitPrediction(
    new Vector3(),
    new Vector3(0, 3, 4),
    new Vector3(),
    new Vector3(0, 0.3, 0.4),
  );
  assert.equal(result.distance, 5);
  assert.equal(result.time, 0);
  const fast = nativePursuitPrediction(
    new Vector3(),
    new Vector3(0.1, 3, 4),
    new Vector3(),
    new Vector3(0.3, 2.1, 0.4),
  );
  assert.equal(
    fast.finish.y,
    Math.fround(3 + Math.fround(Math.fround(2.1) * fast.time)),
  );
  assert.equal(
    fast.finish.z,
    Math.fround(4 + Math.fround(Math.fround(0.4) * fast.time)),
  );
});

test("pursuit reverse uses original mass forces and strict unsigned deadlines", () => {
  assert.deepEqual(nativePursuitReverse(2300, 100, 2, 0), {
    finished: false,
    curvature: 0,
    accForce: -16,
    brakeForce: 0,
  });
  assert.deepEqual(nativePursuitReverse(2301, 100, 2, 0), {
    finished: false,
    curvature: 0,
    accForce: 0,
    brakeForce: 30,
  });
  assert.equal(nativePursuitReverse(3100, 100, 2, 0).finished, false);
  assert.deepEqual(nativePursuitReverse(3101, 100, 2, 0), {
    finished: true,
    curvature: 0,
    accForce: 0,
    brakeForce: 0,
  });
  assert.equal(
    nativePursuitReverse(0xfffffff0, 0xfffffff0, 2, 0).finished,
    true,
  );
});

test("invalid native pursuit input fails before publishing state", () => {
  assert.throws(() =>
    nativePursuitPrediction(
      new Vector3(NaN, 0, 0),
      new Vector3(),
      new Vector3(),
      new Vector3(),
    ),
  );
  assert.throws(() => nativePursuitReverse(-1, 0, 2, 0));
  assert.throws(() => nativePursuitReverse(0, 0, 0, 0));
});

test("late pursuit braking preserves existing curvature instead of restarting reverse", () => {
  assert.equal(nativePursuitReverse(2301, 100, 2, 0.125).curvature, 0.125);
  assert.equal(nativePursuitReverse(3101, 100, 2, -0.125).curvature, -0.125);
  assert.equal(nativePursuitReverse(2300, 100, 2, 0.125).curvature, 0);
});

test("reverse completion is nested under the braking gate when deadlines straddle wrap", () => {
  assert.deepEqual(nativePursuitReverse(500, 0xfffff500, 2, 0.125), {
    finished: false,
    curvature: 0,
    accForce: -16,
    brakeForce: 0,
  });
});
