import test from "node:test";
import assert from "node:assert/strict";
import {
  Group,
  Vector3,
  Quaternion,
  Mesh,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  DoubleSide,
} from "three";
import { WorldCollision } from "../src/world.ts";
import { DEFAULT_SURFACE } from "../src/physics/surfaces.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { CorrectionWorkingSet } from "../src/physics/correction-working-set.ts";
import { buildBoxHull } from "../src/physics/box-hull.ts";

const v = (...values) => new Vector3(...values);
function body(x = 0) {
  return {
    hulls: [buildBoxHull(v(-0.2, -0.2, -0.2), v(0.2, 0.2, 0.2))],
    state: {
      position: v(x, 0, 0),
      orientation: new Quaternion(),
      velocity: v(1, 0, 0),
      angularVelocity: v(0, 0, 0),
      predictedPosition: v(x + 0.1, 0, 0),
      predictedOrientation: new Quaternion(),
    },
    properties: {
      mass: 1,
      inertia: v(1, 1, 1),
      centerOfMass: v(0, 0, 0),
      worldFriction: 0,
    },
    overlapRecovery: true,
    overlapDetected: false,
  };
}
function floor() {
  const root = new Group(),
    material = new MeshBasicMaterial({ side: DoubleSide });
  material.name = "ROAD";
  material.userData.c2Flags = 4096;
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([-2, 0, -2, 0, 0, 2, 2, 0, -2], 3),
  );
  const mesh = new Mesh(geometry, material);
  root.add(mesh);
  const modifiers = [{ ...DEFAULT_SURFACE }];
  return { root, mesh, modifiers, world: new WorldCollision(root, modifiers) };
}
test("static guard certificates follow world mutation, friction and moving-owner admission", () => {
  const { root, mesh, world, modifiers } = floor(),
    initial = world.getStaticGuardRevision();
  assert.equal(initial, world.getStaticGuardRevision());
  world.invalidateActors([mesh]);
  assert.notEqual(initial, world.getStaticGuardRevision());
  const rebuilt = world.getStaticGuardRevision();
  world.rebuildStatic();
  assert.notEqual(rebuilt, world.getStaticGuardRevision());
  const oldFriction = modifiers[0].wallFriction,
    before = world.getStaticGuardRevision();
  try {
    modifiers[0].wallFriction += 0.25;
    assert.notEqual(before, world.getStaticGuardRevision());
  } finally {
    modifiers[0].wallFriction = oldFriction;
  }
  const b = body(),
    actor = new Group();
  root.add(actor);
  world.addDynamic(b, actor, true, true);
  assert.equal(world.getStaticGuardRevision(), undefined);
  world.removeDynamic(b);
  assert.ok(world.getStaticGuardRevision());
  const query = world.queryLocalSurfaces;
  world.queryLocalSurfaces = (...args) => query.apply(world, args);
  assert.equal(world.getStaticGuardRevision(), undefined);
});
test("pair reuse replays empty overlap evidence and isolates mutable contact rows", () => {
  const sim = new VehicleSimulation(
      new WorldCollision(new Group()),
      new Group(),
    ),
    a = body(),
    b = body(0.1);
  sim.correctionDiagnostics = {};
  sim.correctionWorkingSet = new CorrectionWorkingSet(
    sim.correctionDiagnostics,
  );
  // Moving together produces overlap evidence without a positive closing row.
  b.state.velocity.copy(a.state.velocity);
  b.state.predictedPosition.x = 0.2;
  sim.collectBodyContacts([a, b]);
  assert.ok(a.overlapDetected && b.overlapDetected);
  // Warm the certificate after its output flag changed, then verify hit replay.
  sim.collectBodyContacts([a, b]);
  const hitCount = sim.correctionDiagnostics.pairHits ?? 0;
  sim.collectBodyContacts([a, b]);
  assert.ok(sim.correctionDiagnostics.pairHits > hitCount);
  // Output resets must not change the result, even if conservative validation
  // recollects that first reset. A subsequent hit must replay both flags.
  a.overlapDetected = b.overlapDetected = false;
  sim.collectBodyContacts([a, b]);
  assert.ok(a.overlapDetected && b.overlapDetected);
  b.state.velocity.set(-1, 0, 0);
  b.state.predictedPosition.x = 0;
  const first = sim.collectBodyContacts([a, b]);
  assert.ok(first.length);
  const point = first[0].point.toArray(),
    normal = first[0].normal.toArray();
  first[0].point.set(100, 200, 300);
  first[0].normal.set(0, 0, 0);
  first[0].sourceType = 99;
  const next = sim.collectBodyContacts([a, b]);
  assert.deepEqual(next[0].point.toArray(), point);
  assert.deepEqual(next[0].normal.toArray(), normal);
  assert.notEqual(next[0].sourceType, 99);
});
test("world guard reuse restores candidate endpoints and invalidates modified scenery", () => {
  const { root, mesh, world } = floor(),
    sim = new VehicleSimulation(world, root),
    a = body();
  a.state.position.set(0, 0.25, 0);
  a.state.velocity.set(0, -5, 0);
  a.state.predictedPosition.set(0, 0.25 - 5 * 0.04, 0);
  sim.correctionDiagnostics = {};
  sim.correctionWorkingSet = new CorrectionWorkingSet(
    sim.correctionDiagnostics,
  );
  const first = sim.advanceWorldContacts(a),
    endpoint = a.state.predictedPosition.toArray();
  const second = sim.advanceWorldContacts(a);
  assert.equal(sim.correctionDiagnostics.worldHits, 1);
  assert.equal(second.fraction, first.fraction);
  assert.deepEqual(a.state.predictedPosition.toArray(), endpoint);
  const before = sim.correctionDiagnostics.worldCollections;
  mesh.position.y = 0.1;
  world.invalidateActors([mesh]);
  sim.advanceWorldContacts(a);
  assert.ok(sim.correctionDiagnostics.worldCollections > before);
  const original = sim.computeAdvanceWorldContacts.bind(sim);
  let calls = 0;
  sim.computeAdvanceWorldContacts = (...args) => {
    calls++;
    return original(...args);
  };
  // Unknown/moving worlds stay live even when all body fields match.
  sim.movingWorld.push({});
  sim.advanceWorldContacts(a);
  sim.advanceWorldContacts(a);
  assert.equal(calls, 2);
});
test("lazy dormant geometry still discovers an in-place pose change before pair reuse", () => {
  const sim = new VehicleSimulation(
      new WorldCollision(new Group()),
      new Group(),
    ),
    moving = body(),
    prop = body(10);
  prop.kind = "noncar";
  prop.properties.immovable = true;
  prop.mechanics = { ignoreWorldCollisions: false };
  prop.state.velocity.set(0, 0, 0);
  sim.correctionDiagnostics = {};
  sim.correctionWorkingSet = new CorrectionWorkingSet(
    sim.correctionDiagnostics,
  );
  assert.deepEqual(sim.collectBodyContacts([moving, prop]), []);
  assert.equal(
    sim.correctionDiagnostics.geometryTransforms,
    undefined,
    "neither unrelated body needs full narrow-phase transforms",
  );
  prop.state.position.x = 0.1;
  prop.state.predictedPosition.x = 0.1;
  moving.state.velocity.x = -1;
  moving.state.predictedPosition.x = -0.1;
  sim.collectBodyContacts([moving, prop]);
  assert.equal(
    sim.correctionDiagnostics.pairTests,
    1,
    "changed broadphase bounds admit the newly relevant pair",
  );
  assert.ok(sim.correctionDiagnostics.boundsBuilds >= 2);
  const count = sim.correctionDiagnostics.geometryTransforms;
  sim.collectBodyContacts([moving, prop]);
  assert.equal(
    sim.correctionDiagnostics.geometryTransforms,
    count,
    "stationary narrow-phase geometry is retained only after exact validation",
  );
});

test("sparse moving neighbors need bounds only, then receive fresh geometry on incident entry", () => {
  const sim = new VehicleSimulation(
      new WorldCollision(new Group()),
      new Group(),
    ),
    a = body(),
    b = body(10),
    c = body(-10);
  sim.correctionDiagnostics = {};
  sim.correctionWorkingSet = new CorrectionWorkingSet(
    sim.correctionDiagnostics,
  );
  const roster = [a, b, c],
    incident = new Set([a]);
  assert.deepEqual(sim.collectBodyContacts(roster, incident), []);
  assert.equal(sim.correctionDiagnostics.geometryTransforms ?? 0, 0);
  assert.equal(sim.correctionDiagnostics.validityChecks ?? 0, 0);
  assert.equal(sim.correctionDiagnostics.boundsBuilds, 3);
  // The neighbor is not incident. Its pose must still update the retained leaf.
  b.state.position.x = 0.5;
  b.state.predictedPosition.x = -0.1;
  b.state.velocity.x = -15;
  const rows = sim.collectBodyContacts(roster, incident);
  assert.ok(rows.some((row) => row.a === a && row.b === b));
  assert.equal(sim.correctionDiagnostics.geometryTransforms, 4);
  assert.equal(sim.correctionDiagnostics.pairTests, 1);
  assert.equal(sim.correctionDiagnostics.boundsBuilds, 4);
  assert.equal(sim.correctionDiagnostics.boundsHits, 2);
  // Moving the same neighbor away drops it; stale pair rows cannot survive.
  b.state.position.x = b.state.predictedPosition.x = 20;
  assert.deepEqual(sim.collectBodyContacts(roster, incident), []);
});

test("moving bounds observe in-place source edits and sealed crush/repair replacements", async () => {
  const { sealCollisionHulls } = await import(
    "../src/physics/immutable-hulls.ts"
  );
  for (const sealed of [false, true]) {
    const sim = new VehicleSimulation(
        new WorldCollision(new Group()),
        new Group(),
      ),
      a = body(),
      b = body(2);
    sim.correctionWorkingSet = new CorrectionWorkingSet();
    if (sealed) sealCollisionHulls(b.hulls);
    const pristine = b.hulls;
    assert.deepEqual(sim.collectBodyContacts([a, b]), []);
    const enlarged = buildBoxHull(v(-2, -0.2, -0.2), v(0.2, 0.2, 0.2));
    if (sealed) b.hulls = sealCollisionHulls([enlarged]);
    else Object.assign(b.hulls[0], enlarged);
    sim.collectBodyContacts([a, b]);
    assert.ok(a.overlapDetected && b.overlapDetected);
    b.hulls = sealed
      ? pristine
      : [buildBoxHull(v(-0.2, -0.2, -0.2), v(0.2, 0.2, 0.2))];
    a.overlapDetected = b.overlapDetected = false;
    assert.deepEqual(sim.collectBodyContacts([a, b]), []);
    assert.equal(a.overlapDetected, false);
    assert.equal(b.overlapDetected, false);
  }
});
