import test from "node:test";
import assert from "node:assert/strict";
import { NativeFramePeriodClock } from "../src/frame-period.ts";

test("rec2 starts at 100ms and corrects its first integer-ms frame", () => {
  const clock = new NativeFramePeriodClock(1000);
  assert.equal(clock.sample().framePeriodMs, 100);
  assert.deepEqual(clock.advance(1016, 16), {
    framePeriodMs: 16,
    cameraPeriodMs: 16,
    averageFramePeriodMs: 16,
    gameTimeMs: 1032,
  });
});

test("native exponential smoothing stabilizes at 151 for a 16ms cadence", () => {
  const clock = new NativeFramePeriodClock(0);
  let sample;
  for (let frame = 1; frame <= 37_500; frame++)
    sample = clock.advance(frame * 16, frame * 16);
  assert.equal(sample.framePeriodMs, 16);
  assert.equal(sample.averageFramePeriodMs, 151);
});

test("average-period multiply wraps as unsigned 32-bit before division", () => {
  const clock = new NativeFramePeriodClock(0, 0xffff_fff0);
  const sample = clock.advance(16, 16);
  assert.equal(sample.averageFramePeriodMs, 429_496_731);
});

test("a greater-than-500ms late frame follows the literal native error correction", () => {
  const clock = new NativeFramePeriodClock(0);
  for (let frame = 1; frame <= 375; frame++)
    clock.advance(frame * 16, frame * 16);

  const sample = clock.advance(375 * 16 + 600, 375 * 16 + 600);
  assert.equal(sample.averageFramePeriodMs, 150);
  assert.equal(sample.framePeriodMs, 600);
  assert.equal(sample.cameraPeriodMs, 600);
});

test("installed limits clamp both periods to 10ms minimum and 1000ms maximum", () => {
  const capped = new NativeFramePeriodClock(0);
  for (let frame = 1; frame <= 375; frame++)
    capped.advance(frame * 16, frame * 16);
  const longFrame = capped.advance(375 * 16 + 2000, 8000);
  assert.equal(longFrame.framePeriodMs, 1000);
  assert.equal(longFrame.cameraPeriodMs, 1000);

  const shortFrame = new NativeFramePeriodClock(0).advance(5, 5);
  assert.equal(shortFrame.framePeriodMs, 10);
  assert.equal(shortFrame.cameraPeriodMs, 10);
  assert.equal(shortFrame.gameTimeMs, 15);
});

test("AddLostTime removes pause duration from GetTotalTime", () => {
  const clock = new NativeFramePeriodClock(100_000);
  const beforePause = clock.advance(100_016, 16).gameTimeMs;
  clock.addLostTime(5000);
  assert.equal(clock.sample().gameTimeMs, beforePause - 5000);
});

test("MainGameLoop reset restores tick baseline but retains global filters", () => {
  const clock = new NativeFramePeriodClock(100_000, 151);
  clock.addLostTime(2500);
  clock.advance(100_016, 16);
  clock.resetMainLoop(200_000);
  assert.deepEqual(clock.sample(), {
    framePeriodMs: 100,
    cameraPeriodMs: 100,
    averageFramePeriodMs: 151,
    gameTimeMs: 197_600,
  });
});

test("clock inputs must be safe nonnegative integer milliseconds", () => {
  const clock = new NativeFramePeriodClock(0);
  for (const value of [-1, 1.5, NaN, Infinity]) {
    assert.throws(() => new NativeFramePeriodClock(value));
    assert.throws(() => clock.advance(value, 0));
    assert.throws(() => clock.advance(0, value));
    assert.throws(() => clock.addLostTime(value));
  }
});
