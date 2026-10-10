import assert from "node:assert/strict";
import test from "node:test";
import { Vector2 } from "three";
import { constructNativePathCorner } from "../src/ai/path-corner.ts";

const close = (actual, expected, epsilon = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );

test("perpendicular width-one straights produce the native left corner", () => {
  let randomCalls = 0;
  const corner = constructNativePathCorner(
    new Vector2(-30, 0),
    new Vector2(0, 0),
    new Vector2(0, 30),
    1,
    1,
    () => {
      randomCalls++;
      return 0;
    },
  );
  const exact = 2 + Math.sqrt(2);
  assert.equal(corner.fallback, false);
  assert.equal(corner.left, true);
  close(corner.tangentReach, exact);
  close(corner.radius, Math.fround(exact));
  close(corner.center.x, -Math.fround(exact));
  close(corner.center.y, Math.fround(exact));
  assert.equal(randomCalls, 0, "normal corner construction consumes no RNG");
});

test("mirroring the turn changes handedness and unequal widths change the radius", () => {
  const left = constructNativePathCorner(
    new Vector2(-30, 0),
    new Vector2(0, 0),
    new Vector2(0, 30),
    2,
    1,
    () => assert.fail("normal geometry must not sample randomness"),
  );
  close(left.tangentReach, 5);
  close(left.radius, 5);
  close(left.center.x, -5);
  close(left.center.y, 5);

  const right = constructNativePathCorner(
    new Vector2(-30, 0),
    new Vector2(0, 0),
    new Vector2(0, -30),
    2,
    1,
    () => assert.fail("normal geometry must not sample randomness"),
  );
  assert.equal(right.left, false);
  close(right.tangentReach, 5);
  close(right.radius, 5);
  close(right.center.x, -5);
  close(right.center.y, -5);
});

test("tangent reach is capped to one third of either adjacent straight", () => {
  const incomingCap = constructNativePathCorner(
    new Vector2(-12, 0),
    new Vector2(0, 0),
    new Vector2(0, 30),
    10,
    10,
  );
  close(incomingCap.tangentReach, Math.fround(12 * Math.fround(1 / 3)));
  close(incomingCap.radius, Math.fround(incomingCap.tangentReach));

  const outgoingCap = constructNativePathCorner(
    new Vector2(-30, 0),
    new Vector2(0, 0),
    new Vector2(0, 12),
    10,
    10,
  );
  close(outgoingCap.tangentReach, Math.fround(12 * Math.fround(1 / 3)));
  close(outgoingCap.radius, Math.fround(outgoingCap.tangentReach));
});

test("nonorthogonal corners match native Float32 intermediate stores", () => {
  const first = constructNativePathCorner(
    new Vector2(-31, 3),
    new Vector2(0, 0),
    new Vector2(11, 29),
    Math.fround(0.7),
    Math.fround(1.3),
  );
  assert.equal(first.tangentReach, 3.6443369388580322);
  assert.equal(first.radius, 4.770451545715332);
  assert.equal(first.center.x, -3.1678807735443115);
  assert.equal(first.center.y, 5.099306583404541);

  const second = constructNativePathCorner(
    new Vector2(-40, 3),
    new Vector2(0, 0),
    new Vector2(11, 35),
    Math.fround(0.7),
    Math.fround(1.3),
  );
  assert.equal(second.tangentReach, 3.5889830589294434);
  assert.equal(second.radius, 4.524764537811279);
  assert.equal(second.center.x, -3.2405245304107666);
  assert.equal(second.center.y, 4.780511856079102);
});

test("small-sine fallback uses minimum width, junction center, and one RNG sample", () => {
  let calls = 0;
  const corner = constructNativePathCorner(
    new Vector2(-100, 0),
    new Vector2(0, 0),
    new Vector2(100, 0.09),
    3,
    2,
    () => {
      calls++;
      return 0.5;
    },
  );
  assert.equal(corner.fallback, true);
  assert.equal(corner.left, true);
  assert.deepEqual(corner.center.toArray(), [0, 0]);
  assert.equal(corner.radius, 2);
  assert.equal(corner.tangentReach, Math.fround(2 * Math.fround(0.7)));
  assert.equal(calls, 1);
});

test("a zero-length adjacent segment also takes the randomized fallback once", () => {
  let calls = 0;
  const corner = constructNativePathCorner(
    new Vector2(0, 0),
    new Vector2(0, 0),
    new Vector2(0, 5),
    1.5,
    2,
    () => {
      calls++;
      return 0;
    },
  );
  assert.equal(corner.fallback, true);
  assert.equal(corner.left, false);
  assert.deepEqual(corner.center.toArray(), [0, 0]);
  assert.equal(corner.radius, 1.5);
  assert.equal(corner.tangentReach, Math.fround(1.5 * Math.fround(0.7)));
  assert.equal(calls, 1);
});
