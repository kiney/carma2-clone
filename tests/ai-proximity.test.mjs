import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  nativeOpponentViewDistance,
  nativeOpponentProximity,
  nativeOpponentCheating,
} from "../src/ai/proximity.ts";

test("native proximity uses original yon plus ten with a forty-five unit floor", () => {
  assert.equal(nativeOpponentViewDistance(35), 45);
  assert.equal(nativeOpponentViewDistance(100), 110);
  assert.equal(
    nativeOpponentViewDistance(35.000003),
    Math.fround(Math.fround(35.000003) + 10),
  );
});

test("last-in-view is actor-origin 3D proximity and equality does not refresh", () => {
  const player = new Vector3();
  for (const opponent of [
    new Vector3(45, 0, 0),
    new Vector3(0, 45, 0),
    new Vector3(0, 0, 45),
  ]) {
    const result = nativeOpponentProximity(opponent, player, 45, 5000, 100);
    assert.equal(result.playerDistance, 45);
    assert.equal(result.lastInViewMs, 100);
  }
  assert.equal(
    nativeOpponentProximity(new Vector3(0, 44, 0), player, 45, 5000, 100)
      .lastInViewMs,
    5000,
  );
});

test("live length, rather than stored Float32 distance, controls proximity boundary", () => {
  const justInside = new Vector3(0.014, 0, 45 - 2 ** -18);
  const result = nativeOpponentProximity(
    justInside,
    new Vector3(),
    45,
    5000,
    100,
  );
  assert.equal(result.playerDistance, 45);
  assert.equal(result.lastInViewMs, 5000);
  const outside = nativeOpponentProximity(
    new Vector3(0.0001, 0, 45),
    new Vector3(),
    45,
    5000,
    100,
  );
  assert.equal(outside.playerDistance, 45);
  assert.equal(outside.lastInViewMs, 100);
});

test("regular cheating follows strict wrapped deadline and original map suppression", () => {
  assert.equal(nativeOpponentCheating(3100, 100, 0, false), false);
  assert.equal(nativeOpponentCheating(3101, 100, 0, false), true);
  assert.equal(nativeOpponentCheating(3101, 100, 2, true), false);
  assert.equal(nativeOpponentCheating(3101, 100, 2, false), true);
  assert.equal(nativeOpponentCheating(3101, 100, 1, true), true);
  assert.equal(nativeOpponentCheating(0xfffffff0, 0xfffffff0, 0, false), true);
});

test("malformed geometry and timestamps are rejected before publishing native state", () => {
  assert.throws(() => nativeOpponentViewDistance(Infinity));
  assert.throws(() =>
    nativeOpponentProximity(
      new Vector3(Infinity, 0, 0),
      new Vector3(),
      45,
      1,
      0,
    ),
  );
  assert.throws(() => nativeOpponentCheating(-1, 0, 0, false));
  assert.throws(() => nativeOpponentCheating(1, 0x100000000, 0, false));
});
