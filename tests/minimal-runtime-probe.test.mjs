import test from "node:test";
import assert from "node:assert/strict";
import { installMinimalRuntimeProbe } from "../tools/minimal-runtime-probe.mjs";

test("minimal runtime probe counts full ticks/updates and restores simulation methods", async () => {
  const keys = [
    "window",
    "performance",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "setTimeout",
    "clearTimeout",
    "KeyboardEvent",
    "innerWidth",
    "innerHeight",
    "devicePixelRatio",
  ];
  const saved = Object.fromEntries(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  let time = 0,
    rafId = 0,
    timeoutId = 0,
    throwOnKeyUp = false;
  const events = [],
    callbacks = new Map();
  class KeyboardEvent {
    constructor(type, init) {
      this.type = type;
      Object.assign(this, init);
    }
  }
  const sim = {
    elapsed: 3,
    step(value) {
      assert.equal(this, sim);
      assert.equal(value, "tick");
      return "stepped";
    },
    updateFrame(start, period) {
      assert.equal(this, sim);
      this.step("tick");
      this.step("tick");
      return { start, skippedMs: 7 };
    },
    quietCensus() {
      return {};
    },
  };
  const originalStep = sim.step,
    originalUpdate = sim.updateFrame,
    game = {
      paused: true,
      simulation: sim,
      opponentsReady: true,
      pedestriansReady: true,
      rivals: [{}, {}],
      pedestrians: { states: [{ active: true }, { active: false }] },
      stats: { ready: true, physicsSkippedMs: 0, gameTimeMs: 20 },
      renderer: {
        domElement: {
          dispatchEvent(event) {
            events.push(event.type);
            if (throwOnKeyUp && event.type === "keyup")
              throw new Error("keyup failure");
          },
        },
        getContext: () => ({
          drawingBufferWidth: 1280,
          drawingBufferHeight: 800,
          getExtension: () => null,
          getParameter: () => "WebGL 2.0",
          getContextAttributes: () => ({ antialias: true }),
          getError: () => 0,
        }),
      },
    };
  globalThis.window = { carma: game };
  globalThis.performance = { now: () => ++time };
  globalThis.requestAnimationFrame = (callback) => {
    callbacks.set(++rafId, callback);
    return rafId;
  };
  globalThis.cancelAnimationFrame = (id) => callbacks.delete(id);
  globalThis.setTimeout = (callback) => {
    ++timeoutId;
    callback();
    return timeoutId;
  };
  globalThis.clearTimeout = () => {};
  globalThis.KeyboardEvent = KeyboardEvent;
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 800;
  globalThis.devicePixelRatio = 1;
  try {
    const installed = installMinimalRuntimeProbe(16);
    assert.deepEqual(installed.readiness, {
      opponents: true,
      pedestrianSystemInstalled: true,
    });
    assert.deepEqual(installed.population, {
      rivals: 2,
      pedestrians: 2,
      activePedestrians: 1,
      cars: 0,
      debris: 0,
      noncars: 0,
      movingWorld: 0,
    });
    assert.equal(sim.step("tick"), "stepped");
    assert.deepEqual(sim.updateFrame(10, 40), { start: 10, skippedMs: 7 });
    const probe = window.__c2MinimalRuntimeProbe,
      live = probe.snapshot();
    assert.equal(live.totalTicks, 3);
    assert.equal(live.totalUpdates, 1);
    assert.equal(live.rows.ticks.length, 3);
    assert.equal(live.rows.updates[0][1], 2);
    assert.equal(live.rows.updates[0][2], 40);

    const capture = await probe.capture({ durationMs: 250, key: "KeyW" });
    assert.equal(capture.runtime.tickCount, 0);
    assert.equal(capture.runtime.updateCount, 0);
    assert.equal(capture.runtime.tickMs, null);
    assert.equal(capture.runtime.updateMs, null);
    assert.equal(capture.physicsSkippedMs, 0);
    assert.equal(capture.glError, 0);
    assert.deepEqual(events, ["keydown", "keyup"]);
    assert.equal(game.paused, true);
    game.paused = false;
    throwOnKeyUp = true;
    await assert.rejects(probe.capture({ durationMs: 250 }), /keyup failure/);
    assert.equal(game.paused, false);
    throwOnKeyUp = false;
    probe.dispose();
    assert.equal(sim.step, originalStep);
    assert.equal(sim.updateFrame, originalUpdate);
    assert.equal(window.__c2MinimalRuntimeProbe, undefined);
  } finally {
    window.__c2MinimalRuntimeProbe?.dispose();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("minimal runtime probe restores timing counters and methods when a tick throws", () => {
  const saved = Object.fromEntries(
      ["window", "innerWidth", "innerHeight", "devicePixelRatio"].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ]),
    ),
    sim = {
      step() {
        throw new Error("tick failure");
      },
      updateFrame() {
        return this.step();
      },
    };
  globalThis.window = {
    carma: {
      stats: { ready: true },
      simulation: sim,
      renderer: {
        getContext: () => ({
          drawingBufferWidth: 1280,
          drawingBufferHeight: 800,
          getExtension: () => null,
          getParameter: () => "WebGL 2.0",
          getContextAttributes: () => ({ antialias: true }),
          getError: () => 0,
        }),
      },
    },
  };
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 800;
  globalThis.devicePixelRatio = 1;
  try {
    const originalStep = sim.step,
      originalUpdate = sim.updateFrame;
    installMinimalRuntimeProbe(16);
    assert.throws(() => sim.updateFrame(), /tick failure/);
    const live = window.__c2MinimalRuntimeProbe.snapshot();
    assert.equal(live.totalTicks, 1);
    assert.equal(live.totalUpdates, 1);
    window.__c2MinimalRuntimeProbe.dispose();
    assert.equal(sim.step, originalStep);
    assert.equal(sim.updateFrame, originalUpdate);
  } finally {
    window.__c2MinimalRuntimeProbe?.dispose();
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
