import assert from "node:assert/strict";
import test from "node:test";
import { RenderFpsSampler } from "../src/render-fps.ts";

test("render FPS estimates actual 100 ms frame intervals, not a 50 ms game cap", () => {
  const sampler = new RenderFpsSampler(0);
  let estimate;
  for (let frame = 1; frame <= 10; frame++)
    estimate = sampler.sample(frame * 100);
  assert.equal(estimate, 10);
});

test("fast and irregular rendered frame intervals use elapsed wall time", () => {
  const fast = new RenderFpsSampler(0);
  let estimate;
  for (let frame = 1; frame <= 60; frame++)
    estimate = fast.sample((frame * 1000) / 60);
  assert.equal(estimate, 60);

  const irregular = new RenderFpsSampler(0);
  for (const timestamp of [100, 260, 410, 700])
    assert.equal(irregular.sample(timestamp), undefined);
  assert.equal(irregular.sample(1100), 5); // 5 frames / 1.1 seconds
});

test("initial, duplicate, and invalid timestamps do not create false windows", () => {
  const sampler = new RenderFpsSampler(25);
  assert.equal(sampler.sample(25), undefined);
  assert.equal(sampler.sample(Number.NaN), undefined);
  assert.equal(sampler.sample(24), undefined);
  let estimate;
  for (let frame = 1; frame <= 10; frame++)
    estimate = sampler.sample(25 + frame * 100);
  assert.equal(estimate, 11); // duplicate timestamp is still a rendered frame
});

test("a long pause is included in the elapsed average and resets at that frame", () => {
  const sampler = new RenderFpsSampler(0);
  assert.equal(sampler.sample(2000), 1);
  let estimate;
  for (let frame = 1; frame <= 10; frame++)
    estimate = sampler.sample(2000 + frame * 100);
  assert.equal(estimate, 10);
});
