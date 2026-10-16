import test from "node:test";
import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { HierarchyPredictionCache } from "../src/physics/cached-hierarchy-motion.ts";
import { createHierarchyMotionPhase } from "../src/physics/hierarchy-motion.ts";
import { createBallJoint } from "../src/physics/joint.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function body() {
  return {
    state: {
      position: v(),
      orientation: new Quaternion(),
      velocity: v(2, 1),
      angularVelocity: v(0, 0.7),
    },
    properties: {
      mass: 2,
      inertia: v(1, 2, 3),
      centerOfMass: v(0.1, 0.2, -0.1),
      worldFriction: 0.4,
    },
  };
}
function check(phase, bodies, joints) {
  const full = createHierarchyMotionPhase(bodies, joints, 0.04);
  assert.deepEqual(new Set(phase.paths.keys()), new Set(full.paths.keys()));
  for (const target of full.paths.keys())
    for (const t of [0, 0.123, 0.5, 1]) {
      const got = phase.pose(target, t),
        expected = full.pose(target, t);
      for (const key of [
        "position",
        "orientation",
        "velocity",
        "angularVelocity",
      ])
        assert.deepEqual(
          got[key].toArray(),
          expected[key].toArray(),
          `${key} at ${t}`,
        );
      assert.equal(
        phase.paths.get(target).temporalGroup,
        full.paths.get(target).temporalGroup,
      );
    }
  phase.writeCandidates(bodies);
  const first = bodies.map((b) => [
    b.state.predictedPosition.toArray(),
    b.state.predictedOrientation.toArray(),
  ]);
  full.writeCandidates(bodies);
  assert.deepEqual(
    first,
    bodies.map((b) => [
      b.state.predictedPosition.toArray(),
      b.state.predictedOrientation.toArray(),
    ]),
  );
}

test("retry prediction reuses unchanged trees and captures changed native trajectories", () => {
  const a = body(),
    b = body(),
    cache = new HierarchyPredictionCache();
  let inputs = new Map([
    [a, {}],
    [b, {}],
  ]);
  const initial = cache.update([a, b], [], 0.04, inputs);
  a.state.velocity.x = 17;
  inputs = new Map(inputs).set(a, {});
  const next = cache.update([a, b], [], 0.04, inputs);
  assert.equal(next.paths.get(b), initial.paths.get(b));
  assert.notEqual(next.paths.get(a), initial.paths.get(a));
  check(next, [a, b], []);
  assert.equal(
    cache.update([a, b], [], 0.04, inputs).paths.get(a),
    next.paths.get(a),
  );
});

test("changed children rebuild their complete physical tree, leaving another root reusable", () => {
  const a = body(),
    child = body(),
    b = body(),
    cache = new HierarchyPredictionCache();
  const joint = createBallJoint(child, a, v(), v(0, 1));
  let inputs = new Map([
    [a, {}],
    [child, {}],
    [b, {}],
  ]);
  const initial = cache.update([a, child, b], [joint], 0.04, inputs);
  child.state.angularVelocity.x = 1.3;
  inputs = new Map(inputs).set(child, {});
  const next = cache.update([a, child, b], [joint], 0.04, inputs);
  assert.notEqual(next.paths.get(a), initial.paths.get(a));
  assert.notEqual(next.paths.get(child), initial.paths.get(child));
  assert.equal(next.paths.get(b), initial.paths.get(b));
  check(next, [a, child, b], [joint]);
});

test("shared external anchors stay captured and invalidate all dependent children", () => {
  const anchor = body(),
    a = body(),
    b = body(),
    unrelated = body(),
    cache = new HierarchyPredictionCache();
  anchor.properties.immovable = true;
  const joints = [
    createBallJoint(a, anchor, v(), v(1)),
    createBallJoint(b, anchor, v(), v(-1)),
  ];
  let inputs = new Map([
    [a, {}],
    [b, {}],
    [unrelated, {}],
  ]);
  const initial = cache.update([a, b, unrelated], joints, 0.04, inputs);
  check(initial, [a, b, unrelated], joints);
  const unchanged = cache.update([a, b, unrelated], joints, 0.04, inputs);
  check(unchanged, [a, b, unrelated], joints);
  anchor.state.position.y = 3;
  inputs = new Map(inputs).set(a, {}).set(b, {});
  const next = cache.update([a, b, unrelated], joints, 0.04, inputs);
  assert.notEqual(next.paths.get(a), initial.paths.get(a));
  assert.notEqual(next.paths.get(b), initial.paths.get(b));
  assert.equal(next.paths.get(unrelated), initial.paths.get(unrelated));
  check(next, [a, b, unrelated], joints);
});

test("detachment, removal and repair reparenting cannot reuse an obsolete hierarchy", () => {
  const a = body(),
    child = body(),
    replacement = body(),
    cache = new HierarchyPredictionCache();
  let inputs = new Map([
    [a, {}],
    [child, {}],
  ]);
  cache.update(
    [a, child],
    [createBallJoint(child, a, v(), v(0, 1))],
    0.04,
    inputs,
  );
  inputs = new Map(inputs).set(child, {});
  check(cache.update([a, child], [], 0.04, inputs), [a, child], []);
  inputs = new Map([
    [replacement, {}],
    [child, {}],
  ]);
  const joints = [createBallJoint(child, replacement, v(), v(0, -1))];
  const repaired = cache.update([child, replacement], joints, 0.04, inputs);
  assert.equal(repaired.paths.has(a), false);
  check(repaired, [child, replacement], joints);
});

test("aliased state is recaptured together; unknown certificates are rejected", () => {
  const a = body(),
    b = body(),
    cache = new HierarchyPredictionCache();
  b.state = a.state;
  let inputs = new Map([
    [a, {}],
    [b, {}],
  ]);
  const initial = cache.update([a, b], [], 0.04, inputs);
  a.state.velocity.z = 7;
  inputs = new Map(inputs).set(a, {});
  const next = cache.update([a, b], [], 0.04, inputs);
  assert.notEqual(next.paths.get(b), initial.paths.get(b));
  check(next, [a, b], []);
  assert.throws(
    () => cache.update([a, b], [], 0.04, new Map([[a, {}]])),
    /certificate/,
  );
});
