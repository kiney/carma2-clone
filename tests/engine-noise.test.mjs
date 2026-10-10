import test from "node:test";
import assert from "node:assert/strict";
import { engineNoise, nativeEngineRevs } from "../src/engine-noise.ts";

test("native engine noise has idle pitch and volume at 800 revs", () => {
  assert.deepEqual(engineNoise(800, 0), {
    pitchFixed: 48960,
    volume: 243,
    playbackRate: 48960 / 65536,
    gain: 243 / 255,
  });
});

test("enclosed and underwater indices scale pitch and volume independently", () => {
  assert.deepEqual(engineNoise(800, 1), {
    pitchFixed: 36720,
    volume: 255,
    playbackRate: 36720 / 65536,
    gain: 1,
  });
  assert.deepEqual(engineNoise(800, 2), {
    pitchFixed: 26928,
    volume: 194,
    playbackRate: 26928 / 65536,
    gain: 194 / 255,
  });
  assert.equal(engineNoise(800, 1.5).pitchFixed, 48960);
  assert.equal(engineNoise(800, 1.5).volume, 243);
});

test("native pitch clamps and truncates after replay scaling", () => {
  assert.equal(engineNoise(-10000, 0).pitchFixed, 4096);
  assert.equal(engineNoise(100000, 0).pitchFixed, 131072);
  assert.equal(engineNoise(800, 0, 1, -2).pitchFixed, 97920);
});

test("volume boost is applied after the native cap and truncated for S3", () => {
  const boosted = engineNoise(100000, 1, 1.5);
  assert.equal(boosted.volume, 265);
  assert.equal(boosted.gain, 265 / 255);
});

test("native revs preserve negative speedometer fractional remainder", () => {
  assert.equal(nativeEngineRevs(0, 8000), 800);
  assert.equal(nativeEngineRevs(-0.0015, 8000), -2800);
  assert.ok(Math.abs(nativeEngineRevs(-0.0024, 8000) + 4960) < 1e-9);
  assert.equal(
    engineNoise(nativeEngineRevs(-0.0015, 8000), 0).pitchFixed,
    12960,
  );
});

test("helpers reject nonfinite inputs while accepting zero replay rate", () => {
  assert.equal(engineNoise(800, 0, 1, 0).pitchFixed, 4096);
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(() => engineNoise(value, 0));
    assert.throws(() => engineNoise(800, value));
    assert.throws(() => engineNoise(800, 0, value));
    assert.throws(() => engineNoise(800, 0, 1, value));
    assert.throws(() => nativeEngineRevs(value, 8000));
    assert.throws(() => nativeEngineRevs(0, value));
  }
});
