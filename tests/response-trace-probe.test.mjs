import test from "node:test";
import assert from "node:assert/strict";
import { installResponseTraceProbe } from "../tools/response-trace-probe.mjs";

const vector = (x, y, z) => ({
  x,
  y,
  z,
  toArray() {
    return [this.x, this.y, this.z];
  },
});

function makeHost() {
  const parent = {
      name: "parent",
      state: {
        position: vector(0, 0, 0),
        orientation: { toArray: () => [0, 0, 0, 1] },
        velocity: vector(0, 0, 0),
        angularVelocity: vector(0, 0, 0),
      },
      properties: {
        mass: 2,
        inertia: vector(1, 1, 1),
        centerOfMass: vector(0, 0, 0),
        immovable: false,
      },
      hulls: [],
    },
    body = {
      name: "damaged-body",
      kind: "car",
      state: {
        position: vector(1, 2, 3),
        orientation: { toArray: () => [0, 0, 0, 1] },
        velocity: vector(0, 0, 0),
        angularVelocity: vector(0, 0, 0),
      },
      properties: {
        mass: 4,
        inertia: vector(2, 3, 4),
        centerOfMass: vector(0.1, 0.2, 0.3),
        immovable: false,
      },
      damage: { componentLevels: [0, 0, 0] },
      hulls: [{ revision: 1, vertices: [vector(0, 0, 0)], faces: [] }],
      motor: { sleeping: false },
    };
  let calls = 0;
  const sim = {
    priorTrace: [],
    onLocalResponseTrace(event) {
      assert.equal(this, sim);
      this.priorTrace.push(event.phase);
    },
    processImpactDamage(impacts, joints, restarts) {
      assert.equal(this, sim);
      assert.ok(Array.isArray(impacts));
      assert.ok(Array.isArray(joints));
      assert.ok(Array.isArray(restarts));
      calls++;
      if (calls === 1) {
        body.state.velocity.x = 5;
        body.damage.componentLevels[1] = 18;
        body.hulls = [
          {
            revision: 2,
            vertices: [vector(0.25, 0, 0)],
            faces: [],
          },
        ];
        body.joint = {
          type: "ball",
          child: body,
          parent,
          childAnchor: vector(0, 1, 0),
          parentAnchor: vector(0, 1, 0),
        };
        return true;
      }
      return false;
    },
    allBodies() {
      return [parent, body];
    },
  };
  const contact = (normalImpulse) => ({
    a: body,
    b: parent,
    point: vector(1, 0, 0),
    pointB: vector(1, 0, 0),
    normal: vector(0, 1, 0),
    sourceType: 5,
    normalImpulse,
    tangentImpulse: vector(0, 0, 0),
    closingSpeed: 1,
    solverAccepted: true,
  });
  return { sim, body, parent, contact };
}

test("response trace captures per-attempt field changes and separates repeated geometry from impulses", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "window"),
    { sim, body, contact } = makeHost();
  globalThis.window = { carma: { simulation: sim } };
  try {
    const originalTrace = sim.onLocalResponseTrace,
      originalProcess = sim.processImpactDamage,
      probeInfo = installResponseTraceProbe();
    assert.deepEqual(probeInfo.methods, [
      "processImpactDamage",
      "onLocalResponseTrace",
    ]);
    const probe = window.__perfResponseTraceProbe;
    assert.equal(probe.seed().bodyCount, 2);
    const trace = (phase) =>
      sim.onLocalResponseTrace({
        phase,
        seed: body,
        batch: [body],
        changed: [body],
        ringSize: 2,
        attempt: 1,
        positiveNormal: true,
        positiveJoint: false,
        rejected: false,
        worldChanged: false,
        rosterChanged: false,
      });
    trace("collection");
    sim.processImpactDamage([contact(2)], [], []);
    sim.processImpactDamage([contact(4)], [], []);
    sim.processImpactDamage([contact(4)], [], []);
    trace("response");

    const report = probe.snapshot(),
      callback = report.events.find(
        (event) => event.phase === "processImpactDamage",
      ),
      response = report.events.find((event) => event.phase === "response"),
      bodyChanges = callback.stateChanges.find(
        (entry) => entry.name === "damaged-body",
      );
    assert.equal(callback.classification, "useful-state-change");
    assert.deepEqual(Object.keys(bodyChanges.fields).sort(), [
      "damage",
      "hulls",
      "joint",
      "velocity",
    ]);
    assert.equal(
      bodyChanges.fields.hulls.before[0].coordinates.hash ===
        bodyChanges.fields.hulls.after[0].coordinates.hash,
      false,
    );
    assert.equal(bodyChanges.fields.joint.after.type, "ball");
    assert.equal(response.usefulStateChange, true);
    assert.equal(response.processCalls, 3);
    assert.equal(response.usefulCalls, 1);
    assert.equal(response.unchangedCalls, 2);
    assert.equal(report.rows.length, 3);
    assert.equal(report.rowKeyCounts.geometryRepeats, 2);
    assert.equal(report.rowKeyCounts.sameImpulseRepeats, 1);
    assert.deepEqual(sim.priorTrace, ["collection", "response"]);
    assert.match(report.events[0].note, /immediately before measured stepping/);
    assert.match(report.overheadNote, /exclude these captures from FPS/);

    probe.dispose();
    assert.equal(sim.onLocalResponseTrace, originalTrace);
    assert.equal(sim.processImpactDamage, originalProcess);
  } finally {
    window.__perfResponseTraceProbe?.dispose();
    if (saved) Object.defineProperty(globalThis, "window", saved);
    else delete globalThis.window;
  }
});

test("response trace is bounded and dispose preserves wrappers installed later", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "window"),
    { sim, body, contact } = makeHost();
  globalThis.window = { carma: { simulation: sim } };
  try {
    const original = sim.processImpactDamage,
      probe = installResponseTraceProbe({ maxEvents: 1, maxRows: 1 }),
      installed = window.__perfResponseTraceProbe;
    installed.seed();
    sim.processImpactDamage([contact(1), contact(1), contact(1)], [], []);
    sim.onLocalResponseTrace({
      phase: "collection",
      seed: body,
      batch: [body],
      ringSize: 1,
      attempt: 1,
    });
    const report = installed.snapshot();
    assert.equal(report.events.length, 1);
    assert.equal(report.rows.length, 1);
    assert.equal(report.droppedRows, 2);
    assert.ok(report.droppedEvents > 0);
    assert.throws(
      () => installResponseTraceProbe({ maxEvents: 513 }),
      /maxEvents/,
    );
    const wrapped = sim.processImpactDamage;
    const laterWrapper = function (...args) {
      return wrapped.apply(this, args);
    };
    sim.processImpactDamage = laterWrapper;
    installed.dispose();
    assert.equal(sim.processImpactDamage, laterWrapper);
    assert.equal(laterWrapper.call(sim, [], [], []), false);
    sim.processImpactDamage = original;
  } finally {
    window.__perfResponseTraceProbe?.dispose();
    if (saved) Object.defineProperty(globalThis, "window", saved);
    else delete globalThis.window;
  }
});
