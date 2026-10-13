import test from "node:test";
import assert from "node:assert/strict";
import {
  correctionWorkCounts,
  installPhysicsWindowProbe,
} from "../tools/correction-performance-probe.mjs";

const clock = () => {
  let elapsed = 0;
  return () => elapsed++;
};
function simulation(ticks = 2) {
  return {
    calls: 0,
    marker: "preserved receiver",
    step() {
      this.calls++;
      return this.marker;
    },
    updateFrame(start, period) {
      this.arguments = [start, period];
      for (let index = 0; index < ticks; index++) this.step();
      this.returned = { steps: 5, skippedMs: 120 };
      return this.returned;
    },
  };
}

test("window observer counts actual completed ticks independently of planned ticks or elapsed jumps", () => {
  const sim = simulation();
  const originalStep = sim.step,
    originalFrame = sim.updateFrame;
  const probe = installPhysicsWindowProbe(sim, { now: clock() });
  const returned = sim.updateFrame(1000, 200);
  assert.equal(returned, sim.returned);
  assert.deepEqual(sim.arguments, [1000, 200]);
  assert.equal(sim.calls, 2);
  assert.equal(probe.updates.length, 1);
  const row = probe.updates[0];
  assert.equal(row.ticks, 2);
  assert.equal(row.tickCalls, 2);
  assert.equal(row.plannedTicks, 5);
  assert.equal(row.skippedMs, 120);
  assert.equal(row.requestedPeriodMs, 200);
  assert.equal(row.frameStartMs, 1000);
  assert.equal(row.failed, false);
  assert.equal(row.tickCpuMs, 2);
  assert.equal(row.cpuMs, 5);
  assert.deepEqual(probe.stepSamples, [1, 1]);
  probe.stop();
  probe.stop();
  assert.equal(sim.step, originalStep);
  assert.equal(sim.updateFrame, originalFrame);
});

test("zero-tick windows retain outer-frame work and unknown baseline return fields", () => {
  const sim = simulation(0);
  sim.updateFrame = function () {
    this.calls++;
    return undefined;
  };
  const probe = installPhysicsWindowProbe(sim, { now: clock() });
  try {
    assert.equal(sim.updateFrame(40, 10), undefined);
    const row = probe.updates[0];
    assert.equal(row.cpuMs, 1);
    assert.equal(row.ticks, 0);
    assert.equal(row.tickCpuMs, 0);
    assert.equal(row.plannedTicks, null);
    assert.equal(row.skippedMs, null);
    assert.equal(sim.calls, 1);
  } finally {
    probe.stop();
  }
});

test("failed tick/window results preserve the exception and distinguish attempted from completed ticks", () => {
  const sim = simulation();
  const failure = new Error("fixture tick failure");
  sim.step = function () {
    if (++this.calls === 2) throw failure;
    return "completed";
  };
  const original = sim.step;
  const probe = installPhysicsWindowProbe(sim, { now: clock() });
  try {
    assert.throws(
      () => sim.updateFrame(0, 40),
      (error) => error === failure,
    );
    assert.equal(probe.updates[0].failed, true);
    assert.equal(probe.updates[0].tickCalls, 2);
    assert.equal(probe.updates[0].ticks, 1);
    assert.equal(probe.updates[0].plannedTicks, null);
    assert.equal(probe.counts().completedTicks, 1);
    assert.equal(probe.counts().tickCalls, 2);
    assert.equal(probe.stepSamples.length, 2);
  } finally {
    probe.stop();
  }
  assert.equal(sim.step, original);
});

test("bounded samples report discarded retention without losing whole-window work counts", () => {
  const sim = simulation(1);
  const probe = installPhysicsWindowProbe(sim, {
    now: clock(),
    maximumUpdates: 1,
    maximumTicks: 2,
  });
  try {
    for (let index = 0; index < 4; index++) sim.updateFrame(index * 40, 40);
    assert.equal(probe.updates.length, 1);
    assert.equal(probe.stepSamples.length, 2);
    assert.deepEqual(probe.counts(), {
      updateCalls: 4,
      tickCalls: 4,
      completedTicks: 4,
      droppedUpdates: 3,
      droppedTicks: 2,
    });
  } finally {
    probe.stop();
  }
});

test("stopping restores inherited methods and own property descriptors while preserving another observer", () => {
  const prototype = simulation(0);
  const sim = Object.create(prototype);
  const originalStep = prototype.step;
  Object.defineProperty(sim, "step", {
    value: originalStep,
    configurable: true,
    writable: true,
    enumerable: false,
  });
  const originalDescriptor = Object.getOwnPropertyDescriptor(sim, "step");
  const probe = installPhysicsWindowProbe(sim, { now: clock() });
  const measuredFrame = sim.updateFrame;
  const anotherObserver = function (...args) {
    return measuredFrame.apply(this, args);
  };
  sim.updateFrame = anotherObserver;
  probe.stop();
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(sim, "step"),
    originalDescriptor,
  );
  assert.equal(sim.updateFrame, anotherObserver);
  sim.updateFrame(0, 40);
  assert.equal(
    probe.updates.length,
    0,
    "stopped inner observer bypasses its instrumentation",
  );
  delete sim.updateFrame;
  assert.equal(sim.updateFrame, prototype.updateFrame);
});

test("tick wrapper preserves its explicit receiver and original return value", () => {
  const sim = simulation(0);
  const other = { calls: 0, marker: "other receiver" };
  const probe = installPhysicsWindowProbe(sim, { now: clock() });
  try {
    assert.equal(sim.step.call(other), "other receiver");
    assert.equal(other.calls, 1);
    assert.equal(sim.calls, 0);
    assert.equal(probe.counts().completedTicks, 1);
    assert.equal(probe.updates.length, 0);
  } finally {
    probe.stop();
  }
});

test("missing baseline work counters remain unknown while measured zero stays zero", () => {
  const raw = { pairTests: 0, responseSolves: 3 };
  const counts = correctionWorkCounts(raw);
  assert.equal(counts.pairTests, 0);
  assert.equal(counts.responseSolves, 3);
  assert.equal(counts.localCollections, null);
  assert.equal(counts.worldContactCollections, null);
  assert.equal(counts.deferredFrictionOverflow, null);
  assert.deepEqual(raw, { pairTests: 0, responseSolves: 3 });
  assert.ok(
    Object.values(correctionWorkCounts(undefined)).every(
      (value) => value === null,
    ),
  );
});

test("invalid retention limits and nonfinite/fractional work counts fail before a misleading capture", () => {
  for (const limit of [0, -1, 513, 1.5, NaN]) {
    const sim = simulation();
    const original = sim.updateFrame;
    assert.throws(() =>
      installPhysicsWindowProbe(sim, { maximumUpdates: limit }),
    );
    assert.equal(sim.updateFrame, original);
  }
  for (const count of [-1, 0.5, NaN, Infinity])
    assert.throws(
      () => correctionWorkCounts({ consideredBodies: count }),
      /Invalid correction work counter/,
    );
});
