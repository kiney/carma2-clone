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

test("broadphase bounds and later contact geometry share endpoint vertex transforms", () => {
  const diagnostics = {},
    set = new CorrectionWorkingSet(diagnostics),
    a = body();
  const bounds = set.bounds(a);
  assert.equal(diagnostics.boundsVertexTransforms, 16);
  assert.equal(diagnostics.geometryTransforms ?? 0, 0);
  const full = set.geometry(a);
  assert.equal(
    diagnostics.boundsVertexTransforms,
    16,
    "no second endpoint vertex transformation",
  );
  assert.equal(diagnostics.geometryTransforms, 2);
  assert.equal(full.bounds, bounds);
  assert.ok(full.old[0].faces.length > 0);
  assert.ok(full.next[0].faces.length > 0);
  const boundsAfter = set.bounds(a);
  assert.equal(boundsAfter, bounds);
  a.state.velocity.x = 17;
  a.state.angularVelocity.z = 2;
  assert.equal(
    set.bounds(a),
    bounds,
    "written poses, not velocity, own geometry validity",
  );
  assert.equal(diagnostics.boundsVertexTransforms, 16);
  a.state.predictedPosition.z += 0.5;
  set.bounds(a);
  assert.equal(
    diagnostics.boundsVertexTransforms,
    24,
    "only changed NEXT endpoint transforms",
  );
  set.geometry(a);
  assert.equal(diagnostics.boundsVertexTransforms, 24);
});

test("bounds admission cannot consume a later full shape or pose invalidation", () => {
  const set = new CorrectionWorkingSet(),
    a = body(),
    b = body(1);
  let emits = 0;
  const emit = () => ({ contacts: [], overlap: !!++emits });
  const original = set.capture(a);
  collectPair(set, a, b, emit);
  a.hulls[0].faces[0].normal.x += 0.25;
  set.bounds(a);
  const changed = set.capture(a);
  assert.notEqual(changed.token, original.token);
  collectPair(set, a, b, emit);
  assert.equal(
    emits,
    2,
    "face changes invalidate pair evidence after bounds capture",
  );
  const geometry = set.geometry(a);
  assert.equal(geometry.old[0].faces[0].normal.x, a.hulls[0].faces[0].normal.x);
  a.state.position.y += 1;
  set.bounds(a);
  const moved = set.capture(a);
  assert.notEqual(moved.token, changed.token);
  collectPair(set, a, b, emit);
  assert.equal(emits, 3);
});

test("geometry-only snapshots stay tick-local while exact endpoint storage persists weakly", () => {
  const diagnostics = {},
    owner = new CorrectionWorkingSet(),
    a = body();
  const first = owner.createTick(diagnostics);
  const snapshot = first.captureGeometry(a),
    bounds = first.bounds(a);
  const second = owner.createTick(diagnostics);
  assert.throws(() => second.geometry(a, snapshot), /different body\/set/);
  assert.throws(() => second.bounds(a, snapshot), /different body\/set/);
  assert.equal(second.bounds(a), bounds);
  assert.equal(diagnostics.boundsVertexTransforms, 16);
  const full = second.geometry(a);
  assert.equal(full.bounds, bounds);
  assert.equal(diagnostics.boundsVertexTransforms, 16);
});

test("polygon bounds and full provider bounds never contaminate each other", () => {
  const set = new CorrectionWorkingSet(),
    a = body();
  // Use an ordinary Box3 result without depending on implementation slots.
  const polygon = set.bounds(a);
  const custom = (_body, position, _orientation, hulls) => {
    assert.ok(hulls[0].faces.length);
    return polygon.clone().translate(position).expandByScalar(5);
  };
  const full = set.geometry(a, set.capture(a), custom);
  assert.notDeepEqual(full.bounds, polygon);
  assert.equal(set.bounds(a).equals(polygon), true);
  assert.equal(set.geometry(a).bounds.equals(polygon), true);
});

test("borrowed geometry inputs retain fresh motion validity and reject foreign owners", () => {
  const set = new CorrectionWorkingSet(),
    a = body(),
    other = body(2);
  const geometry = set.captureGeometry(a);
  set.bounds(a, geometry);
  const first = set.capture(a, true, geometry);
  a.state.velocity.x += 0.5;
  a.overlapDetected = true;
  const changed = set.capture(a, true, geometry);
  assert.notEqual(changed.token, first.token);
  assert.equal(changed.oldPoseToken, first.oldPoseToken);
  assert.throws(
    () => set.capture(other, true, geometry),
    /different body\/set/,
  );
});

test("pure pair features survive solver-only and output flag changes at fixed endpoints", () => {
  const diagnostics = {},
    set = new CorrectionWorkingSet(diagnostics),
    a = body(),
    b = body(1);
  let emitted = 0;
  const query = () =>
    set.pairFeatures(
      a,
      b,
      set.captureGeometry(a),
      set.captureGeometry(b),
      false,
      () => ({ contacts: [], overlap: ++emitted > 0 }),
    );
  const first = query();
  a.state.velocity.x += 10;
  b.state.angularVelocity.y += 5;
  a.properties.inertia.x *= 2;
  a.properties.worldFriction += 0.25;
  a.properties.mass += 1;
  a.overlapDetected = b.overlapDetected = true;
  assert.equal(query(), first);
  assert.equal(emitted, 1);
  assert.equal(diagnostics.pairFeatureHits, 1);
  b.state.predictedPosition.y += 0.1;
  assert.notEqual(query(), first);
  assert.equal(diagnostics.pairGeometryInvalidations, 1);
});

test("OLD pair recovery certifies both bodies' live velocities COM and attachment ancestry", () => {
  const diagnostics = {},
    set = new CorrectionWorkingSet(diagnostics),
    a = body(),
    b = body(1),
    parent = body(3);
  let emitted = 0;
  const query = () =>
    set.pairFeatures(
      a,
      b,
      set.captureGeometry(a),
      set.captureGeometry(b),
      true,
      () => ({ contacts: [], overlap: ++emitted > 0 }),
    );
  let old = query();
  const changes = [
    () => (b.state.velocity.x += 1),
    () => (a.state.angularVelocity.z -= 1),
    () => (b.properties.centerOfMass.x += 0.2),
    () => (a.joint = { parent, type: "ball" }),
    () => (a.joint.parent = b),
  ];
  for (const change of changes) {
    change();
    const next = query();
    assert.notEqual(next, old);
    assert.equal(query(), next);
    old = next;
  }
  assert.equal(emitted, 1 + changes.length);
  assert.equal(diagnostics.pairRecoveryInvalidations, changes.length);
});

test("feature results remain tick-local and uncachable shapes stay live", () => {
  const owner = new CorrectionWorkingSet(),
    a = body(),
    b = body(1);
  let emitted = 0;
  const emit = () => ({ contacts: [], overlap: ++emitted > 0 });
  const query = (set) =>
    set.pairFeatures(
      a,
      b,
      set.captureGeometry(a),
      set.captureGeometry(b),
      false,
      emit,
    );
  const first = owner.createTick();
  query(first);
  query(first);
  assert.equal(emitted, 1);
  query(owner.createTick());
  assert.equal(emitted, 2);
  a.shape = { type: "CUSTOM" };
  query(first);
  query(first);
  assert.equal(emitted, 4);
});

test("OLD recovery geometry survives response/NEXT changes but invalidates source/OLD edits", () => {
  const diagnostics = {},
    set = new CorrectionWorkingSet(diagnostics),
    a = body(),
    b = body(0.5);
  const ca = v(),
    cb = v(0.5);
  const query = (owner = set, cacheable = true) => {
    const oldA = owner.geometry(a, owner.captureGeometry(a)).old[0];
    const oldB = owner.geometry(b, owner.captureGeometry(b)).old[0];
    return owner.recoveryGeometry(oldA, oldB, ca, cb, cacheable);
  };
  let previous = query();
  a.state.velocity.x = 3;
  b.state.angularVelocity.y = 4;
  b.properties.centerOfMass.z = 0.1;
  a.state.predictedPosition.x += 0.3;
  assert.equal(query(), previous);
  assert.equal(diagnostics.pairRecoveryGeometryHits, 1);
  for (const mutate of [
    () => {
      a.state.position.x += 0.1;
    },
    () => {
      b.state.orientation.setFromAxisAngle(v(0, 1), 0.2);
    },
    () => {
      a.hulls[0].vertices[0].z -= 0.1;
    },
    () => {
      cb.x += 0.1;
    },
  ]) {
    mutate();
    const next = query();
    assert.notEqual(next, previous);
    assert.equal(query(), next);
    previous = next;
  }
  assert.notEqual(query(set.createTick()), previous);
  assert.notEqual(query(set, false), query(set, false));
});

test("OLD pair classification follows OLD/shape edits and resets each tick", () => {
  const set = new CorrectionWorkingSet(),
    a = body(),
    b = body(2.1);
  const query = (owner = set, cacheable = true) =>
    owner.pairOldGeometry(
      owner.geometry(a, owner.captureGeometry(a)).old[0],
      owner.geometry(b, owner.captureGeometry(b)).old[0],
      cacheable,
    );
  let previous = query();
  a.state.predictedOrientation.setFromAxisAngle(v(0, 1), 0.4);
  assert.equal(query(), previous);
  for (const mutate of [
    () => {
      a.state.position.x += 0.1;
    },
    () => {
      a.hulls[0].vertices[0].x -= 0.1;
    },
  ]) {
    mutate();
    const next = query();
    assert.notEqual(next, previous);
    assert.equal(query(), next);
    previous = next;
  }
  assert.notEqual(query(set.createTick()), previous);
  assert.notEqual(query(set, false), query(set, false));
});
