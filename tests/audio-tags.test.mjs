import test from "node:test";
import assert from "node:assert/strict";
import { AudioSystem } from "../src/audio.ts";

function setup(t) {
  let resolve;
  const decoded = new Promise((done) => {
    resolve = done;
  });
  const sources = [];
  const gain = () => ({ gain: { value: 0 }, connect() {}, disconnect() {} });
  const context = {
    state: "running",
    currentTime: 0,
    destination: {},
    createGain: gain,
    createBufferSource() {
      const source = {
        playbackRate: { value: 0 },
        started: false,
        stopped: false,
        connect() {},
        disconnect() {},
        start() {
          this.started = true;
        },
        stop() {
          this.stopped = true;
        },
      };
      sources.push(source);
      return source;
    },
    decodeAudioData: () => decoded,
    close: async () => {},
  };
  const audio = new AudioSystem({
    resolve: () => "data/SOUND/skid1.wav",
    bytes: async () => new Uint8Array(4),
  });
  // Focused Web Audio lifecycle adapter, independently of original WAV data.
  audio.context = context;
  audio.master = gain();
  audio.sounds.set(9000, { id: 9000, file: "skid1.wav" });
  t.after(() => audio.dispose());
  return { audio, sources, resolve };
}

test("tracked tyre voices do not restart while decoding and cancelled decodes cannot play late", async (t) => {
  const { audio, sources, resolve } = setup(t);
  const first = audio.startTrackedSound(9000, 0.5, 0.75);
  assert.equal(audio.isSoundPlaying(first), true);
  assert.equal(sources.length, 0);
  audio.stopTrackedSound(first);
  assert.equal(audio.isSoundPlaying(first), false);
  const second = audio.startTrackedSound(9000, 0.8, 1.25);
  assert.notEqual(first, second);
  resolve({ duration: 1 });
  await new Promise((done) => setImmediate(done));
  assert.equal(sources.length, 1);
  assert.equal(sources[0].started, true);
  assert.equal(sources[0].playbackRate.value, 1.25);
  assert.equal(audio.isSoundPlaying(second), true);
  sources[0].onended();
  assert.equal(audio.isSoundPlaying(second), false);
});

test("tracked voices retire after disposal and missing samples, without accumulating pending tags", async (t) => {
  const { audio, sources, resolve } = setup(t);
  const absent = audio.startTrackedSound(9004, 1, 1);
  await new Promise((done) => setImmediate(done));
  assert.equal(audio.isSoundPlaying(absent), false);
  const pending = audio.startTrackedSound(9000, 1, 1);
  audio.dispose();
  resolve({ duration: 1 });
  await new Promise((done) => setImmediate(done));
  assert.equal(audio.isSoundPlaying(pending), false);
  assert.equal(sources.length, 0);
  assert.equal(audio.startTrackedSound(9000, 1, 1), 0);
});
