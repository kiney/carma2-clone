import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { CorrectionWorkingSet } from "../src/physics/correction-working-set.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function body(x = 0) {
  return {
    hulls: [buildBoxHull(v(-1, -1, -1), v(1, 1, 1))],
    state: {
      position: v(x),
      orientation: new Quaternion(),
      velocity: v(),
      angularVelocity: v(),
      predictedPosition: v(x + 0.25),
      predictedOrientation: new Quaternion(),
    },
    properties: {
      mass: 10,
      inertia: v(2, 3, 4),
      centerOfMass: v(),
      worldFriction: 0.4,
      objectFriction: 0.4,
    },
  };
}
const collectPair = (set, a, b, emit) =>
  set.pair(a, b, set.capture(a), set.capture(b), emit);

test("hierarchy certificates include ancestor motion and mutable joint geometry", () => {
  const set = new CorrectionWorkingSet(),
    child = body(),
    parent = body(2);
  child.joint = {
    type: "ball",
    parent,
    child,
    childAnchor: v(0.2, 0.1),
    parentAnchor: v(-0.2),
  };
  let snapshot = set.capture(child);
  const changed = (mutate) => {
    mutate();
    const next = set.capture(child);
    assert.notEqual(next, snapshot);
    snapshot = next;
    assert.equal(set.capture(child), next);
  };
  changed(() => (parent.state.velocity.z += 1));
  changed(() => (parent.state.angularVelocity.y += (2 * Math.PI) / 0.04));
  changed(() => (parent.state.position.x += 0.25));
  changed(() => parent.state.orientation.setFromAxisAngle(v(0, 1), 0.3));
  changed(() => (parent.properties.centerOfMass.x += 0.1));
  changed(() => (parent.properties.inertia.y *= 2));
  changed(() => (child.joint.childAnchor.z += 0.2));
  changed(() => (child.joint.parentAnchor.y -= 0.1));
  changed(() => (child.joint.type = "hinge"));
  changed(() => (child.joint.childAxis = v(1)));
  changed(() => (child.joint.quickHinge = true));
  changed(() => (parent.properties.immovable = true));
});

test("stable correction snapshots reuse old and predicted geometry", () => {
  const diagnostics = {},
    set = new CorrectionWorkingSet(diagnostics),
    a = body(),
    first = set.capture(a),
    geometry = set.geometry(a, first);
  assert.equal(set.capture(a), first);
  assert.equal(set.geometry(a, first), geometry);
  assert.equal(diagnostics.geometryTransforms, 2);
  assert.equal(diagnostics.geometryHits, 2);
});

test("every collision shape component and ordering participates in validity", () => {
  const set = new CorrectionWorkingSet(),
    a = body();
  a.hulls.push(buildBoxHull(v(-0.5), v(0.5)));
  let snapshot = set.capture(a);
  const changed = (mutate) => {
    mutate();
    const next = set.capture(a);
    assert.notEqual(next, snapshot);
    snapshot = next;
  };
  changed(() => (a.hulls[0].vertices[0].x += 0.125));
  changed(() => (a.hulls[0].faces[0].constant += 0.125));
  changed(() => (a.hulls[0].faces[0].normal.x = 0.25));
  changed(() => (a.hulls[0].faces[0].indices[0] = 4));
  changed(() => (a.hulls[0].edges[0][0] = 1));
  changed(() => (a.hulls[0].vertexOrder = [7, 6, 5]));
  changed(() => a.hulls.reverse());
  changed(() => a.hulls.push(buildBoxHull(v(-0.5), v(0.5))));
  changed(() => (a.shape = { type: "SPHERE", center: [1, 2, 3], radius: 2 }));
  changed(() => (a.shape.center[1] += 0.25));
});

test("pose, velocity, COM, inertia, masks, ancestry, and recovery invalidate pairs", () => {
  const set = new CorrectionWorkingSet(),
    a = body(),
    b = body(4);
  let emissions = 0;
  const emit = () => ({ contacts: [], overlap: false });
  collectPair(set, a, b, () => (emissions++, emit()));
  collectPair(set, a, b, () => (emissions++, emit()));
  assert.equal(emissions, 1);
  const invalidations = [
    () => (a.state.position.x += 1),
    () => a.state.orientation.setFromAxisAngle(v(0, 1), 0.2),
    () => (a.state.predictedPosition.z += 1),
    () => a.state.predictedOrientation.setFromAxisAngle(v(1), 0.3),
    () => (a.state.velocity.x += 1),
    () => (a.state.angularVelocity.y += 1),
    () => (a.properties.centerOfMass.x += 1),
    () => (a.properties.inertia.z += 1),
    () => (a.properties.mass += 1),
    () => (a.filterA = 3),
    () => (a.filterB = 7),
    () => (a.overlapRecovery = true),
    () => (a.overlapDetected = true),
    () => (a.worldRecovery = true),
    () => (a.worldOverlapDetected = true),
    () => (a.suppressWorldFaces = true),
    () => (a.suppressSelfSentinel = true),
    () => (a.suppressJointConstraints = true),
  ];
  for (const mutate of invalidations) {
    mutate();
    collectPair(set, a, b, () => (emissions++, emit()));
  }
  const parent = body(-4);
  a.joint = { parent };
  collectPair(set, a, b, () => (emissions++, emit()));
  parent.state.position.y += 0.5;
  collectPair(set, a, b, () => (emissions++, emit()));
  a.joint.parent = b;
  collectPair(set, a, b, () => (emissions++, emit()));
  // Parent movement now changes the child's actual candidate trajectory too.
  assert.equal(emissions, 1 + invalidations.length + 3);
});

test("empty pair results replay overlap state and changed shape recollects", () => {
  const diagnostics = {},
    set = new CorrectionWorkingSet(diagnostics),
    a = body(),
    b = body(5);
  let calls = 0;
  a.overlapDetected = true;
  b.overlapDetected = true;
  const emit = () => {
    calls++;
    return { contacts: [], overlap: true };
  };
  const first = collectPair(set, a, b, emit);
  assert.equal(first.overlap, true);
  const replay = collectPair(set, a, b, emit);
  a.overlapDetected ||= replay.overlap;
  b.overlapDetected ||= replay.overlap;
  assert.equal(calls, 1);
  assert.equal(a.overlapDetected, true);
  assert.equal(b.overlapDetected, true);
  a.hulls[0].vertices[0].y += 0.1;
  collectPair(set, a, b, emit);
  assert.equal(calls, 2);
  assert.equal(diagnostics.pairHits, 1);
});

test("world results key endpoint restoration by body revision, mode, and world revision", () => {
  const diagnostics = {},
    set = new CorrectionWorkingSet(diagnostics),
    a = body();
  const collect = () => {
    a.state.predictedPosition.set(9, 8, 7);
    a.state.predictedOrientation.setFromAxisAngle(v(0, 1), 0.75);
    return "contact rows";
  };
  let snapshot = set.capture(a),
    result = set.world(a, snapshot, 1, false, collect);
  assert.equal(result.value, "contact rows");
  assert.deepEqual(result.position.toArray(), [9, 8, 7]);
  const original = result.position.clone(),
    originalRotation = result.orientation.clone();
  a.state.predictedPosition.set(100, 100, 100);
  a.state.predictedOrientation.identity();
  result = set.world(a, snapshot, 1, false, () => assert.fail("cached"));
  assert.equal(diagnostics.worldHits, 1);
  a.state.predictedPosition.copy(result.position);
  a.state.predictedOrientation.copy(result.orientation);
  assert.ok(a.state.predictedPosition.equals(original));
  assert.ok(a.state.predictedOrientation.equals(originalRotation));
  set.world(a, snapshot, 1, true, () => "refined");
  set.world(a, snapshot, 2, false, () => "new world");
  a.state.velocity.x++;
  snapshot = set.capture(a);
  set.world(a, snapshot, 2, false, () => "new motion");
  assert.equal(diagnostics.worldHits, 1);
  assert.equal(diagnostics.worldTests, 5);
  let callbacks = 0;
  set.world(a, snapshot, undefined, false, () => callbacks++);
  set.world(a, snapshot, undefined, false, () => callbacks++);
  assert.equal(callbacks, 2, "uncertified moving-world callbacks always rerun");
});

test("uncertified bodies and unknown analytic shapes never reuse pair results", () => {
  const set = new CorrectionWorkingSet(),
    a = body(),
    b = body(5);
  a.shape = { type: "CUSTOM", center: [0, 0, 0] };
  let calls = 0;
  for (let i = 0; i < 2; i++)
    set.pair(a, b, set.capture(a), set.capture(b), () => {
      calls++;
      return { contacts: [], overlap: false };
    });
  assert.equal(calls, 2);
  for (let i = 0; i < 2; i++)
    set.pair(a, b, set.capture(a, false), set.capture(b), () => {
      calls++;
      return { contacts: [], overlap: false };
    });
  assert.equal(calls, 4);
});

test("fresh ticks reuse validated geometry but always recollect contacts and world fractions", () => {
  const retained = new CorrectionWorkingSet(),
    a = body(),
    b = body(4);
  const first = retained.createTick(),
    second = retained.createTick();
  let pairs = 0,
    worlds = 0;
  const geometry = first.geometry(a);
  const pair = (set) =>
    collectPair(set, a, b, () => {
      pairs++;
      return { contacts: [], overlap: false };
    });
  const world = (set) => set.world(a, set.capture(a), 1, false, () => ++worlds);
  pair(first);
  world(first);
  assert.equal(second.geometry(a), geometry);
  pair(second);
  world(second);
  assert.equal(pairs, 2);
  assert.equal(worlds, 2);
  a.hulls[0].vertices[0].x += 0.1;
  assert.notEqual(
    second.geometry(a),
    geometry,
    "persistent geometry still detects an unversioned crush between ticks",
  );
});
