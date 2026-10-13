import test from "node:test";
import assert from "node:assert/strict";
import { installLivePerformanceRecorder } from "../tools/live-performance-recorder.mjs";

test("live recorder preserves calls, pauses, race replacement and bounded history", () => {
  const saved = Object.fromEntries(
    ["window", "requestAnimationFrame", "cancelAnimationFrame"].map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  const callbacks = new Map();
  let id = 0;
  const frame = (time) => {
    const [key, callback] = callbacks.entries().next().value;
    callbacks.delete(key);
    callback(time);
  };
  class Simulation {
    elapsed = 0;
    cars = [{}];
    debris = [];
    bodyTrajectoryGuard = {
      run(value) {
        return value;
      },
    };
    advanceWorldContacts() {
      return "world";
    }
    collectBodyContacts() {
      return [];
    }
    step(value) {
      this.elapsed += 0.04;
      assert.equal(this.bodyTrajectoryGuard.run("commit"), "commit");
      assert.equal(this.bodyTrajectoryGuard.run("projection"), "projection");
      assert.equal(
        this.advanceWorldContacts({ properties: { immovable: true } }),
        "world",
      );
      this.collectBodyContacts();
      return value;
    }
    updateFrame(start, period) {
      assert.equal(this.step("tick"), "tick");
      return { skippedMs: period, start };
    }
  }
  const makeGame = () => ({
    paused: true,
    simulation: new Simulation(),
    stats: {},
    renderer: {
      render() {
        return 7;
      },
    },
  });
  globalThis.window = { carma: makeGame() };
  globalThis.requestAnimationFrame = (fn) => {
    callbacks.set(++id, fn);
    return id;
  };
  globalThis.cancelAnimationFrame = (key) => callbacks.delete(key);
  try {
    installLivePerformanceRecorder(16);
    const recorder = window.__perf01LiveRecorder,
      oldSim = window.carma.simulation;
    const wrapped = oldSim.step;
    frame(10);
    frame(20);
    assert.deepEqual(recorder.snapshot().rows, {
      ticks: [],
      updates: [],
      frames: [],
    });
    assert.equal(window.carma.renderer.render(), 7);
    window.carma.paused = false;
    frame(30);
    for (let i = 0; i < 20; i++) {
      const value = oldSim.updateFrame(i * 40, 40);
      assert.deepEqual(value, { skippedMs: 40, start: i * 40 });
      frame(40 + i * 16);
    }
    const snapshot = recorder.snapshot();
    assert.equal(snapshot.rows.ticks.length, 16);
    assert.equal(snapshot.rows.updates.length, 16);
    assert.equal(snapshot.rows.frames.length, 16);
    assert(
      snapshot.rows.ticks.every(
        (row) => row.length === recorder.columns.ticks.length,
      ),
    );
    assert.equal(snapshot.rows.updates[0][4], 1);
    assert.equal(snapshot.rows.updates[0][7], 40);
    assert.equal(snapshot.rows.ticks[0][7], 1);
    assert.equal(snapshot.rows.ticks[0][6], 0);
    assert.equal(snapshot.rows.ticks[0][9], 1);
    window.carma.paused = true;
    frame(1000);
    frame(2000);
    assert.deepEqual(recorder.snapshot().rows, snapshot.rows);
    window.carma.paused = false;
    frame(4000);
    frame(4016);
    assert.equal(recorder.snapshot().rows.frames.at(-1)[3], 16);

    window.carma = makeGame();
    frame(5000);
    assert.equal(recorder.generation, 2);
    assert.equal(oldSim.step, Simulation.prototype.step);
    assert.equal(Object.hasOwn(oldSim, "step"), false);
    assert.notEqual(oldSim.step, wrapped);
    window.carma.paused = false;
    window.carma.simulation.step("replacement");
    assert.equal(recorder.snapshot().rows.ticks.at(-1)[0], 2);
    const currentSim = window.carma.simulation;
    installLivePerformanceRecorder(16);
    assert.equal(recorder.stopped, true);
    assert.equal(callbacks.size, 1);
    window.__perf01LiveRecorder.stop();
    assert.equal(callbacks.size, 0);
    assert.equal(Object.hasOwn(currentSim, "step"), false);
    assert.equal(currentSim.step, Simulation.prototype.step);
  } finally {
    window.__perf01LiveRecorder?.stop();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("live recorder rejects unbounded or invalid capacities before touching the page", () => {
  for (const capacity of [0, 15, 4097, Infinity, NaN, 512.5])
    assert.throws(() => installLivePerformanceRecorder(capacity), /capacity/);
});
