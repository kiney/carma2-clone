import test from "node:test";
import assert from "node:assert/strict";
import { installImpactHistoryRecorder } from "../tools/impact-history-recorder.mjs";

test("impact history distinguishes discarded attachment impulses from committed damage and follows races", () => {
  const oldWindow = globalThis.window,
    oldInterval = globalThis.setInterval,
    oldClear = globalThis.clearInterval;
  let poll,
    cleared = false;
  globalThis.setInterval = (fn) => {
    poll = fn;
    return 1;
  };
  globalThis.clearInterval = () => {
    cleared = true;
  };
  const vector = (x, y, z) => ({ toArray: () => [x, y, z] });
  const player = {
    group: { name: "test-truck" },
    state: { position: vector(1, 2, 3), velocity: vector(0, 0, 6) },
    damage: { componentLevels: new Uint8Array(12) },
    knackered: false,
  };
  const sign = { actor: { name: "&28d0256" } };
  let mode = "reject",
    lastRow,
    callbacksPerStep = 1;
  class Simulation {
    elapsed = 0;
    processImpactDamage(rows) {
      if (mode === "reject") {
        rows[0].sourceType = 9;
        rows[0].normalImpulse = 0;
        return false;
      }
      if (mode !== "quiet") player.damage.componentLevels[0]++;
      if (mode === "accept-once") mode = "quiet";
    }
    step() {
      this.elapsed += 0.04;
      for (let i = 0; i < callbacksPerStep; i++) {
        const row = {
          a: player,
          b: sign,
          normalImpulse: mode === "reject" ? 500 : 0.4,
          closingSpeed: 6,
          sourceType: 5,
          point: vector(1, 2, 4),
          normal: vector(0, 0, -1),
        };
        lastRow = row;
        if (this.processImpactDamage([row]) !== false)
          row.solverAccepted = true;
      }
      return "step-result";
    }
  }
  const first = new Simulation();
  globalThis.window = { carma: { simulation: first, player, paused: false } };
  try {
    assert.throws(() => installImpactHistoryRecorder(0), /capacity/);
    installImpactHistoryRecorder(8);
    const recorder = window.__carmaImpactRecorder;
    assert.equal(first.step(), "step-result");
    let data = recorder.snapshot();
    assert.equal(data.contacts.length, 1);
    assert.equal(data.changes.length, 0);
    assert.equal(data.contacts[0].callbackRejected, true);
    assert.equal(data.contacts[0].rows[0].sourceTypeBefore, 5);
    assert.equal(data.contacts[0].rows[0].sourceTypeAfter, 9);
    assert.equal(data.contacts[0].rows[0].solverAccepted, false);
    assert.equal(data.contacts[0].rows[0].lambda, 500);
    mode = "accept";
    first.step();
    data = recorder.snapshot();
    assert.equal(data.changes.length, 1);
    assert.equal(data.changes[0].before[0], 0);
    assert.equal(data.changes[0].after[0], 1);
    assert.equal(data.changes[0].rows[0].solverAccepted, true);
    assert.equal(data.changes[0].rows[0].b, "&28d0256");
    // Scalar snapshots neither retain live contact rows nor expose internal rings.
    lastRow.point = vector(99, 99, 99);
    data.changes[0].before[0] = 99;
    assert.deepEqual(recorder.snapshot().changes[0].rows[0].point, [1, 2, 4]);
    assert.equal(recorder.snapshot().changes[0].before[0], 0);
    for (let i = 0; i < 20; i++) first.step();
    assert.equal(recorder.snapshot().contacts.length, 8);
    assert.equal(recorder.snapshot().changes.length, 8);
    window.carma.simulation = new Simulation();
    poll();
    assert.equal(Object.hasOwn(first, "step"), false);
    assert.equal(Object.hasOwn(first, "processImpactDamage"), false);
    window.carma.simulation.step();
    assert.equal(recorder.snapshot().contacts.at(-1).generation, 2);
    recorder.stop();
    assert.equal(cleared, true);
    assert.equal(Object.hasOwn(window.carma.simulation, "step"), false);
    assert.equal(
      Object.hasOwn(window.carma.simulation, "processImpactDamage"),
      false,
    );
    // One step can contain more responses than either retained history ring.
    // The oldest damage entry must still finalize even when quiet contacts
    // have displaced it from the ordinary contact ring.
    mode = "accept-once";
    callbacksPerStep = 24;
    installImpactHistoryRecorder(8);
    window.carma.simulation.step();
    const overflow = window.__carmaImpactRecorder.snapshot();
    assert.equal(overflow.contacts.length, 8);
    assert.equal(overflow.changes.length, 1);
    assert.ok(overflow.contacts.every((entry) => entry.rows[0].solverAccepted));
    assert.equal(overflow.changes[0].rows[0].solverAccepted, true);
    assert.equal(overflow.changes[0].rows[0].sourceTypeAfter, 5);
  } finally {
    window.__carmaImpactRecorder?.stop();
    globalThis.window = oldWindow;
    globalThis.setInterval = oldInterval;
    globalThis.clearInterval = oldClear;
  }
});
