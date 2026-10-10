import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { setBouncePowerup, bouncePowerup } from "../src/physics/bounce.ts";

test("native bounce timing requires three grounded wheels and preserves horizontal momentum", () => {
  const effect = setBouncePowerup([2, 13.8]);
  const state = { velocity: new Vector3(3, -1, -4), groundedWheelCount: 2 };
  assert.equal(effect.periodMs, 500);
  assert.equal(bouncePowerup(state, effect, 500), false);
  assert.equal(effect.lastBounceMs, 0);
  state.groundedWheelCount = 3;
  assert.equal(bouncePowerup(state, effect, 499), false);
  assert.equal(bouncePowerup(state, effect, 500), true);
  assert.ok(Math.abs(state.velocity.y - 1) < 1e-7);
  assert.equal(state.velocity.x, 3);
  assert.equal(state.velocity.z, -4);
  assert.equal(effect.lastBounceMs, 500);
  assert.equal(bouncePowerup(state, effect, 999), false);
  assert.equal(bouncePowerup(state, effect, 1000), true);
  assert.ok(Math.abs(state.velocity.y - 3) < 2e-7);
});

test("native bounce uses unsigned timestamp age and fresh pickup timestamp zero", () => {
  const effect = setBouncePowerup([1, 6.9]);
  const state = { velocity: new Vector3(), groundedWheelCount: 4 };
  assert.equal(bouncePowerup(state, effect, 2000), true);
  effect.lastBounceMs = 0xfffffff0;
  assert.equal(bouncePowerup(state, effect, 20), false);
  assert.equal(bouncePowerup(state, effect, 1000), true);
  const zeroFrequency = setBouncePowerup([0, 5]);
  assert.equal(zeroFrequency.periodMs, Infinity);
  assert.equal(bouncePowerup(state, zeroFrequency, 100000), false);
  assert.throws(() => setBouncePowerup([NaN, 5]));
  assert.throws(() => setBouncePowerup([1]));
  assert.throws(() => bouncePowerup(state, effect, NaN));
});
