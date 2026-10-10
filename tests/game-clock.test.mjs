import test from "node:test";
import assert from "node:assert/strict";
import { BrowserGameClock } from "../src/game-clock.ts";

function runSchedule(hz, durationMs = 5000) {
  const clock = new BrowserGameClock();
  clock.start(10_000);
  const samples = [];
  const count = Math.ceil((durationMs * hz) / 1000);
  for (let frame = 1; frame <= count; frame++) {
    const now = Math.min(durationMs, Math.floor((frame * 1000) / hz));
    const sample = clock.sample(10_000 + now, true);
    if (sample) samples.push({ now, sample });
  }
  return samples;
}

test("144Hz and 240Hz RAF schedules gate gameplay to at most 100Hz", () => {
  for (const hz of [144, 240]) {
    const samples = runSchedule(hz);
    assert.ok(
      samples.length <= 501,
      `${hz}Hz: ${samples.length} gameplay frames`,
    );
    for (let index = 1; index < samples.length; index++)
      assert.ok(
        samples[index].now - samples[index - 1].now >= 10,
        `${hz}Hz emitted gameplay frames less than 10ms apart`,
      );
  }
});

test("60, 100, 144, and 240Hz schedules advance comparable gameplay time", () => {
  const schedules = [60, 100, 144, 240].map((hz) => runSchedule(hz));
  const ends = schedules.map((samples) => samples.at(-1).sample.endMs);
  assert.ok(Math.max(...ends) - Math.min(...ends) <= 10, ends.join(", "));
  for (const samples of schedules) {
    const elapsed = samples.at(-1).sample.endMs;
    assert.ok(Math.abs(elapsed - 5000) <= 25, `${elapsed}ms elapsed`);
  }
});

test("first sample is seeded to race time and native periods stay in 10..1000ms", () => {
  const clock = new BrowserGameClock();
  assert.equal(clock.sample(10, true), undefined);
  clock.start(100_000);
  const first = clock.sample(100_016, true);
  assert.ok(first);
  assert.equal(first.startMs, 10);
  assert.equal(first.endMs, 32);

  const fast = new BrowserGameClock();
  fast.start(0);
  const short = fast.sample(10, true);
  assert.ok(short);
  assert.ok(short.periodMs >= 10);
  for (let now = 20; now <= 3000; now += 10) fast.sample(now, true);
  const late = fast.sample(3600, true);
  assert.ok(late);
  assert.ok(late.periodMs <= 1000, `${late.periodMs}ms native cap`);
  assert.ok(late.periodMs > 500, `${late.periodMs}ms late-frame correction`);
});

test("pause excludes five seconds and rebases the first resumed sample", () => {
  const clock = new BrowserGameClock();
  clock.start(0);
  let before;
  for (let now = 16; now <= 1008; now += 16) before = clock.sample(now, true);
  assert.ok(before);
  clock.sample(1010, false);
  clock.sample(6010, false);
  assert.equal(clock.sample(6010, true), undefined);
  const resumed = clock.sample(6026, true);
  assert.ok(resumed);
  assert.ok(
    resumed.endMs - before.endMs < 100,
    `${resumed.endMs} vs ${before.endMs}`,
  );
  assert.ok(
    resumed.clockDeltaMs < 100,
    `${resumed.clockDeltaMs}ms resume delta`,
  );
});

test("starting another race retains the underlying native average", () => {
  const clock = new BrowserGameClock();
  clock.start(0);
  for (let now = 16; now <= 4000; now += 16) clock.sample(now, true);
  const warmedAverage = clock.native.sample().averageFramePeriodMs;
  assert.ok(warmedAverage > 100);

  clock.start(10_000);
  const resetAverage = clock.native.sample().averageFramePeriodMs;
  assert.ok(
    resetAverage > 10,
    `new race reset the process-global average to ${resetAverage}`,
  );
});

test("invalid wall ticks and time reversal are rejected", () => {
  const clock = new BrowserGameClock();
  for (const value of [-1, NaN, Infinity]) {
    assert.throws(() => clock.start(value));
    assert.throws(() => clock.sample(value, true));
  }
  clock.start(100);
  clock.sample(120, true);
  assert.throws(() => clock.sample(119, true), /backwards/);

  const paused = new BrowserGameClock();
  paused.start(100);
  paused.setPaused(true, 200);
  assert.throws(() => paused.setPaused(false, 199), /backwards/);
});

test("native prediction regressions remain signed rather than double-counting elapsed time", () => {
  const clock = new BrowserGameClock();
  clock.start(10_000);
  const stalled = clock.sample(11_000, true);
  const corrected = clock.sample(11_016, true);
  const next = clock.sample(11_032, true);
  assert.equal(stalled.endMs, 2000);
  assert.equal(corrected.endMs, 1032);
  assert.equal(corrected.clockDeltaMs, -968);
  assert.equal(next.endMs, 1048);
  assert.equal(
    stalled.clockDeltaMs + corrected.clockDeltaMs + next.clockDeltaMs,
    1048,
  );
});

test("pause retains native prediction error instead of snapping game timestamps to wall time", () => {
  for (const schedule of [
    [16, 36, 76, 136],
    [30, 60, 95, 200],
    [50, 100, 250, 300],
  ]) {
    const plain = new BrowserGameClock(),
      paused = new BrowserGameClock();
    plain.start(10_000);
    paused.start(10_000);
    for (const ms of schedule)
      assert.deepEqual(
        paused.sample(10_000 + ms, true),
        plain.sample(10_000 + ms, true),
      );
    const pauseAt = 10_000 + schedule.at(-1) + 3;
    paused.setPaused(true, pauseAt);
    paused.setPaused(false, pauseAt + 600);
    const resumed = paused.sample(pauseAt + 638, true);
    const continued = plain.sample(pauseAt + 38, true);
    assert.deepEqual(resumed, continued);
  }
});

test("pause shifts the gameplay cadence gate without discarding active pre-pause remainder", () => {
  const plain = new BrowserGameClock(),
    paused = new BrowserGameClock();
  plain.start(1000);
  paused.start(1000);
  plain.sample(1016, true);
  paused.sample(1016, true);
  paused.setPaused(true, 1022);
  paused.setPaused(false, 1622);
  assert.deepEqual(paused.sample(1626, true), plain.sample(1026, true));
});

test("pause preserves an established 102ms prediction offset and its physics window", () => {
  const plain = new BrowserGameClock(),
    paused = new BrowserGameClock();
  plain.start(1000);
  paused.start(1000);
  for (const ms of [3016, 3032, 3144]) {
    plain.sample(ms, true);
    paused.sample(ms, true);
  }
  paused.setPaused(true, 3144);
  paused.setPaused(false, 3744);
  const resumed = paused.sample(3782, true);
  assert.deepEqual(resumed, plain.sample(3182, true));
  assert.equal(resumed.periodMs, 41);
  assert.equal(resumed.startMs, 2156);
  assert.equal(resumed.endMs, 2197);
});
