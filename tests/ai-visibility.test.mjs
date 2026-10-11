import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  NativeVisibilityState,
  nativeHeadOnChance,
} from "../src/ai/visibility.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const query = (overrides = {}) => ({
  nowMs: 1,
  playerDistance: 10,
  playerPosition: v(1, 2, 3),
  rivalPosition: v(4, 5, 6),
  ...overrides,
});

test("strict timer deadline suppresses ray and RNG while preserving state", () => {
  const state = new NativeVisibilityState();
  state.synchronize({ inView: true, acknowledged: true });
  let randomCalls = 0,
    rayCalls = 0;
  const current = state.snapshot;
  const result = state.run(
    query({ nowMs: 0 }),
    () => {
      rayCalls++;
      return 2;
    },
    () => {
      randomCalls++;
      return 0;
    },
  );
  assert.deepEqual(result, current);
  assert.equal(randomCalls, 0);
  assert.equal(rayCalls, 0);
});

test("due check draws 15-bit inclusive delay before rejecting distant player", () => {
  const state = new NativeVisibilityState();
  let randomCalls = 0,
    rayCalls = 0;
  const result = state.run(
    query({ nowMs: 100, playerDistance: 50 }),
    () => {
      rayCalls++;
      return 2;
    },
    () => {
      randomCalls++;
      return 32767 / 32768;
    },
  );
  assert.equal(randomCalls, 1);
  assert.equal(rayCalls, 0);
  assert.equal(result.nextCheckMs, 5000);
  assert.equal(result.inView, false);
});

test("visibility timer wraps at uint32 and strictly gates its next check", () => {
  const state = new NativeVisibilityState();
  const result = state.run(
    query({ nowMs: 0xfffffff0, playerDistance: 50 }),
    () => 0,
    () => 0,
  );
  assert.equal(result.nextCheckMs, 3984);
  let calls = 0;
  const skipped = state.run(
    query({ nowMs: 3984 }),
    () => {
      calls++;
      return 2;
    },
    () => {
      calls++;
      return 0;
    },
  );
  assert.equal(calls, 0);
  assert.equal(skipped.nextCheckMs, 3984);
});

test("ray receives native Float32 origin and direction, including Y bias order", () => {
  const state = new NativeVisibilityState();
  let actualFrom, actualDirection;
  state.run(
    query({
      nowMs: 10,
      playerDistance: 49.999,
      playerPosition: v(
        1.0000001192092896,
        2.000000238418579,
        3.000000238418579,
      ),
      rivalPosition: v(4.000000476837158, 6.000000476837158, 8.000000953674316),
    }),
    (from, direction) => {
      actualFrom = from;
      actualDirection = direction;
      return 1;
    },
    () => 0,
  );
  assert.deepEqual(actualFrom.toArray(), [
    f(1.0000001192092896),
    f(f(2.000000238418579) + f(0.15)),
    f(3.000000238418579),
  ]);
  assert.deepEqual(actualDirection.toArray(), [
    f(f(4.000000476837158) - f(1.0000001192092896)),
    f(f(6.000000476837158) - f(2.000000238418579) + f(0.15)),
    f(f(8.000000953674316) - f(3.000000238418579)),
  ]);
});

const f = Math.fround;

test("fraction exactly one fails; its next Float32 value succeeds and clears acknowledgment", () => {
  const state = new NativeVisibilityState();
  state.synchronize({ inView: false, acknowledged: true });
  assert.equal(
    state.run(
      query({ nowMs: 10 }),
      () => 1,
      () => 0,
    ).inView,
    false,
  );
  assert.equal(state.snapshot.acknowledged, true);
  state.synchronize({ inView: false, acknowledged: true });
  const next = f(1 + 2 ** -23);
  const visible = state.run(
    query({ nowMs: 5000 }),
    () => next,
    () => 0,
  );
  assert.equal(visible.inView, true);
  assert.equal(visible.acknowledged, false);
});

test("failed visibility check clears inView but preserves outer acknowledgment", () => {
  const state = new NativeVisibilityState();
  state.synchronize({ inView: true, acknowledged: true });
  const result = state.run(
    query({ nowMs: 10 }),
    () => 0.99,
    () => 0,
  );
  assert.equal(result.inView, false);
  assert.equal(result.acknowledged, true);
});

test("head-on coincidence uses positive X fallback", () => {
  assert.equal(
    nativeHeadOnChance({
      playerPosition: v(),
      rivalPosition: v(),
      playerDirection: v(-1),
      rivalDirection: v(1),
    }),
    true,
  );
});

test("head-on epsilon equality uses fallback; the next Float32 value uses direction", () => {
  const epsilon = 2 ** -22;
  const args = (x) => ({
    playerPosition: v(x),
    rivalPosition: v(),
    playerDirection: v(-1),
    rivalDirection: v(1),
  });
  assert.equal(nativeHeadOnChance(args(-epsilon)), true);
  assert.equal(nativeHeadOnChance(args(f(-epsilon - 2 ** -45))), false);
});

test("head-on live normalization retains the near-threshold source comparison", () => {
  const player = v(67.8740234375, 39.18419647216797, 0);
  const rival = v();
  const liveLength = Math.sqrt(player.x * player.x + player.y * player.y);
  const liveX = player.x / liveLength,
    liveY = player.y / liveLength;
  const liveRivalDot = liveX;
  const storedX = f(liveX),
    storedY = f(liveY);
  const storedDot = f(f(1 * storedX + 0 * storedY) + 0 * 0);
  const threshold = f(Math.cos(0.5235668420791626));
  assert.ok(liveRivalDot > threshold);
  assert.equal(storedDot, threshold);
  assert.equal(
    nativeHeadOnChance({
      playerPosition: player,
      rivalPosition: rival,
      rivalDirection: v(1),
      playerDirection: v(-1),
    }),
    true,
  );
});

test("query vectors are read-only and Float32 overflow is rejected", () => {
  const player = v(1, 2, 3),
    before = player.clone();
  assert.throws(
    () =>
      nativeHeadOnChance({
        playerPosition: v(3.5e38),
        rivalPosition: v(),
        playerDirection: v(-1),
        rivalDirection: v(1),
      }),
    /Float32/,
  );
  nativeHeadOnChance({
    playerPosition: player,
    rivalPosition: v(),
    playerDirection: v(-1),
    rivalDirection: v(1),
  });
  assert.deepEqual(player.toArray(), before.toArray());
});
