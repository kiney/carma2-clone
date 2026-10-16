import test from "node:test";
import assert from "node:assert/strict";
import {
  Box3,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { WorldCollision } from "../src/world.ts";
import { DEFAULT_SURFACE } from "../src/physics/surfaces.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { CorrectionWorkingSet } from "../src/physics/correction-working-set.ts";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { resolveContacts } from "../src/physics/contact.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function body(x = 0, y = 0.75, half = 0.5) {
  return {
    hulls: [buildBoxHull(v(-half, -half, -half), v(half, half, half))],
    state: {
      position: v(x, y),
      orientation: new Quaternion(),
      velocity: v(0, -5),
      angularVelocity: v(),
      predictedPosition: v(x, y - 0.5),
      predictedOrientation: new Quaternion(),
    },
    properties: {
      mass: 1,
      inertia: v(1, 1, 1),
      centerOfMass: v(),
      worldFriction: 0,
    },
    worldRecovery: false,
    worldOverlapDetected: false,
    overlapRecovery: false,
    overlapDetected: false,
  };
}
function fixture() {
  const root = new Group(),
    geometry = new BufferGeometry(),
    material = new MeshBasicMaterial({ side: DoubleSide });
  material.name = "ROAD";
  material.userData.c2Flags = 4096;
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([-20, 0, -20, 0, 0, 20, 20, 0, -20], 3),
  );
  const mesh = new Mesh(geometry, material);
  root.add(mesh);
  const world = new WorldCollision(root, [{ ...DEFAULT_SURFACE }]),
    sim = new VehicleSimulation(world, root);
  sim.correctionDiagnostics = {};
  sim.correctionWorkingSet = new CorrectionWorkingSet(
    sim.correctionDiagnostics,
  );
  return { sim, mesh, world };
}
const worldRows = (sim, item) => sim.worldContacts(item, item.hulls);

test("native feature reuse retains live face-ring access and recollection groove callbacks", () => {
  const { sim, mesh } = fixture(),
    item = body();
  let stops = 0,
    ringGets = 0;
  sim.worldGrooveFrameActive = true;
  sim.grooves = {
    actors: new Set([mesh]),
    poseRevision: 0,
    stopActor() {
      stops++;
      return false;
    },
  };
  const originalGet = sim.worldFaceCache.get;
  sim.worldFaceCache.get = function (...args) {
    ringGets++;
    return originalGet.apply(this, args);
  };
  assert.ok(worldRows(sim, item).length);
  assert.ok(worldRows(sim, item).length);
  assert.equal(ringGets, 2, "feature hit still checks retained face validity");
  assert.equal(stops, 1, "native interior containment retains callback policy");
  assert.equal(sim.correctionDiagnostics.nativeWorldEmitHits, 1);
  const cache = sim.worldFaceCache,
    state = sim.worldFaceStates.get(item);
  // Another owner's real ring allocation overwrites the first body's range.
  cache.get(
    cache.createState(),
    {
      bounds: new Box3(v(-1, -1, -1), v(1, 1, 1)),
      matrix: new Matrix4(),
      committedMatrix: new Matrix4(),
    },
    (_query, maximum) => Array(maximum).fill({}),
  );
  assert.equal(cache.valid(state), false);
  assert.ok(worldRows(sim, item).length);
  assert.equal(stops, 2, "ring expiry must still recollect and stop its MODEL");
  assert.equal(cache.valid(state), true);
  assert.equal(sim.correctionDiagnostics.nativeWorldEmitHits, 2);
});

test("reused world geometry supplies fresh solver rows and repeated positive callbacks", () => {
  const { sim } = fixture(),
    item = body();
  const first = worldRows(sim, item);
  assert.ok(first.length);
  const point = first[0].point.toArray(),
    normal = first[0].normal.toArray();
  let callbacks = 0;
  const solve = (rows) =>
    resolveContacts(rows, 0.04, [], (impacts) => {
      callbacks++;
      assert.ok(impacts.some((impact) => impact.normalImpulse > 0));
    });
  solve(first);
  first[0].point.set(100, 200, 300);
  first[0].normal.set(0, 0, 0);
  first[0].sourceType = 9;
  item.state.velocity.set(0, -5, 0);
  item.state.angularVelocity.set(0, 0, 0);
  const second = worldRows(sim, item);
  assert.notEqual(second[0], first[0]);
  assert.deepEqual(second[0].point.toArray(), point);
  assert.deepEqual(second[0].normal.toArray(), normal);
  assert.notEqual(second[0].sourceType, 9);
  solve(second);
  assert.equal(callbacks, 2);
  assert.equal(sim.correctionDiagnostics.nativeWorldEmitHits, 1);
});

test("world feature hits replay empty OLD-overlap evidence", () => {
  const { sim } = fixture(),
    item = body(0, 0.25);
  item.worldRecovery = true;
  item.state.predictedPosition.y = 0.35;
  assert.deepEqual(worldRows(sim, item), []);
  assert.equal(item.worldOverlapDetected, true);
  item.worldOverlapDetected = false;
  assert.deepEqual(worldRows(sim, item), []);
  assert.equal(item.worldOverlapDetected, true);
  assert.equal(sim.correctionDiagnostics.nativeWorldEmitHits, 1);
});

test("changed retained surface values invalidate and moving-owner faces stay live", () => {
  const { sim } = fixture(),
    item = body();
  const first = worldRows(sim, item),
    surface = first[0].sourceSurface;
  assert.ok(surface);
  surface.modifier.wallFriction = 0.25;
  const changed = worldRows(sim, item);
  assert.ok(changed.length);
  assert.ok(changed.every((row) => row.faceFriction === 0.25));
  assert.equal(sim.correctionDiagnostics.nativeWorldFaceInvalidations, 1);
  const owner = body(0, 0);
  owner.kind = "moving-world";
  owner.state.predictedPosition.copy(owner.state.position);
  surface.owner = owner;
  const before = sim.correctionDiagnostics.nativeWorldEmitHits ?? 0;
  worldRows(sim, item);
  worldRows(sim, item);
  assert.equal(sim.correctionDiagnostics.nativeWorldEmitHits ?? 0, before);
  assert.equal(
    sim.correctionDiagnostics.nativeWorldUncacheableInvalidations,
    2,
  );
  delete surface.owner;
  worldRows(sim, item);
  assert.equal(
    sim.correctionDiagnostics.nativeWorldEmitHits ?? 0,
    before,
    "moving-owner fallback discards the earlier static result",
  );
});

test("pair recovery reevaluates relative velocity at unchanged OLD/NEXT endpoints", () => {
  const { sim } = fixture(),
    a = body(0, 1, 0.2),
    b = body(0.1, 1, 0.2);
  const discovery = [];
  sim.bodyPairDiagnostics = (phase, diagnostics) => {
    if (phase === "contacts") discovery.push(diagnostics);
  };
  for (const item of [a, b]) {
    item.overlapRecovery = true;
    item.state.velocity.set(1, 0, 0);
    item.state.predictedPosition.copy(item.state.position).add(v(0.1));
  }
  assert.deepEqual(sim.collectBodyContacts([a, b]), []);
  assert.ok(a.overlapDetected && b.overlapDetected);
  assert.deepEqual(sim.collectBodyContacts([a, b]), []);
  assert.equal(sim.correctionDiagnostics.pairFeatureHits, 1);
  b.state.velocity.x = -1;
  const rows = sim.collectBodyContacts([a, b]);
  assert.ok(rows.length, "closing speed now admits actual OLD-overlap rows");
  assert.equal(sim.correctionDiagnostics.pairRecoveryInvalidations, 1);
  assert.equal(
    sim.correctionDiagnostics.pairRecoveryGeometryHits,
    1,
    "velocity-sensitive selection reuses unchanged OLD intersection geometry",
  );
  assert.equal(discovery.at(-1).pairDiscoveryHits, 1);
  assert.equal(discovery.at(-1).nodeTests, 0);
});

test("changed NEXT reuses OLD pair classification while new crossings stay live", () => {
  const { sim } = fixture(),
    a = body(0, 1, 0.2),
    b = body(0.6, 1, 0.2);
  a.state.predictedPosition.copy(a.state.position).x = 0.8;
  b.state.predictedPosition.copy(b.state.position);
  const first = sim.collectBodyContacts([a, b]);
  assert.ok(first.length);
  assert.equal(sim.correctionDiagnostics.pairOldGeometryTests, 1);
  a.state.predictedPosition.x = 0.9;
  const cached = sim.collectBodyContacts([a, b]);
  assert.equal(sim.correctionDiagnostics.pairOldGeometryHits, 1);
  sim.correctionWorkingSet = undefined;
  const uncached = sim.collectBodyContacts([a, b]);
  const rows = (contacts) =>
    contacts.map((c) => ({
      point: c.point.toArray(),
      pointB: c.pointB?.toArray(),
      normal: c.normal.toArray(),
      sourceType: c.sourceType,
      penetration: c.penetration,
    }));
  assert.deepEqual(rows(cached), rows(uncached));
});
