import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { WorldCollision } from "../src/world.ts";
import { cameraWorldQueries } from "../src/camera/world-queries.ts";

function faceGeometry(points) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  return geometry;
}

function floor(name, x, z, y = 0, material = "ROAD") {
  const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  mat.name = material;
  const mesh = new THREE.Mesh(
    faceGeometry([x - 1, y, z, x + 1, y, z, x, y, z + 2]),
    mat,
  );
  mesh.name = name;
  return mesh;
}

function worldWith(...meshes) {
  const root = new THREE.Group();
  root.add(...meshes);
  return { root, world: new WorldCollision(root) };
}

function summary(surface) {
  return {
    actor: surface.actor?.name,
    faceIndex: surface.faceIndex,
    a: surface.a.toArray(),
    b: surface.b.toArray(),
    c: surface.c.toArray(),
    material: surface.material,
  };
}

function hitSummary(hit) {
  return (
    hit && {
      distance: hit.distance,
      point: hit.point.toArray(),
      normal: hit.normal.toArray(),
      face: summary(hit.surface),
    }
  );
}

function queryLocal(world, min, max, includeNonSolid = false, envelope) {
  assert.equal(
    typeof world.queryLocalSurfaces,
    "function",
    "WorldCollision exposes its local-face query",
  );
  return world.queryLocalSurfaces(min, max, includeNonSolid, envelope);
}

function legacyRaycast(world, ...args) {
  const queryLocalSurfaces = world.queryLocalSurfaces;
  try {
    // Route the production ray implementation through its original broad query
    // so the expected hit includes the legacy cells, gates and ordering.
    world.queryLocalSurfaces = (min, max, includeNonSolid) =>
      world.querySurfaces(min, max, includeNonSolid);
    return hitSummary(world.raycast(...args));
  } finally {
    world.queryLocalSurfaces = queryLocalSurfaces;
  }
}

function withLegacyCameraQueries(world, run) {
  const queryLocalSurfaces = world.queryLocalSurfaces;
  try {
    world.queryLocalSurfaces = (min, max, includeNonSolid) =>
      world.querySurfaces(min, max, includeNonSolid);
    return run(cameraWorldQueries(world));
  } finally {
    world.queryLocalSurfaces = queryLocalSurfaces;
  }
}

test("local static faces preserve legacy cell/Y gates and source order", () => {
  const { world } = worldWith(
    floor("source-first", 3, 3, 0),
    floor("source-second", 4, 3, 0),
    floor("too-high", 4, 3, 8),
    floor("non-solid", 3, 3, 0, "!ROAD"),
  );
  const min = new THREE.Vector3(0, -1, 0),
    max = new THREE.Vector3(8, 1, 8),
    legacy = world.querySurfaces(min, max, true),
    local = queryLocal(world, min, max, true);

  assert.deepEqual(
    local.map((surface) => surface.actor.name),
    ["source-first", "source-second", "non-solid"],
  );
  assert.deepEqual(
    local,
    legacy.filter((surface) => surface.maxY >= min.y && surface.minY <= max.y),
  );
  assert.deepEqual(
    queryLocal(world, min, max).map((surface) => surface.actor.name),
    ["source-first", "source-second"],
    "default solidity filtering remains compatible with querySurfaces",
  );
});

test("narrow local envelopes filter broad candidates while preserving legacy order", () => {
  const { world } = worldWith(
    floor("left", 1, 1),
    floor("near", 9, 1),
    floor("right", 17, 1),
  );
  const broadMin = new THREE.Vector3(-4, -1, -2),
    broadMax = new THREE.Vector3(20, 1, 5),
    narrow = new THREE.Box3(
      new THREE.Vector3(8.5, -0.1, 0.5),
      new THREE.Vector3(9.5, 0.1, 1.5),
    );
  const broad = world.querySurfaces(broadMin, broadMax, true),
    local = queryLocal(world, broadMin, broadMax, true, narrow);

  assert.deepEqual(
    local.map((surface) => surface.actor.name),
    ["near"],
  );
  const broadOrder = new Map(broad.map((surface, index) => [surface, index]));
  assert.ok(local.every((surface) => broadOrder.has(surface)));
  assert.deepEqual(
    local.map((surface) => broadOrder.get(surface)),
    [...local.map((surface) => broadOrder.get(surface))].sort((a, b) => a - b),
    "local filtering emits an ordered subset of the broad query",
  );
});

test("fat face bounds retain long-triangle barycentric tolerance beyond the exact AABB", () => {
  const long = new THREE.Mesh(
    faceGeometry([-1000, 0, 0, 1000, 0, 0, 0, 0, 1]),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  long.name = "long-face";
  const { world } = worldWith(long),
    envelope = new THREE.Box3(
      new THREE.Vector3(1000.00005, -0.01, -0.001),
      new THREE.Vector3(1000.00005, 0.01, 0.001),
    );
  const candidates = queryLocal(
    world,
    new THREE.Vector3(999.9, -0.1, -0.1),
    new THREE.Vector3(1000.1, 0.1, 0.1),
    true,
    envelope,
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].actor, long);
});

test("Float32 camera boundary rounding retains a face just beyond the double bound", () => {
  const edge = new THREE.Mesh(
    faceGeometry([1, -1, -1, 1, 1, -1, 1, 0, 1]),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  edge.name = "float32-edge";
  const { world } = worldWith(edge),
    local = cameraWorldQueries(world),
    min = new THREE.Vector3(0, -1, -1),
    exactMax = new THREE.Vector3(1, 1, 1),
    slightlyShort = new THREE.Vector3(1 - 1e-9, 1, 1);

  assert.ok(
    slightlyShort.x < 1,
    "the double-precision box ends before the face",
  );
  assert.equal(Math.fround(slightlyShort.x), 1);
  const expected = withLegacyCameraQueries(world, (legacy) =>
    legacy.faces(min, slightlyShort),
  );
  assert.equal(
    expected.length,
    1,
    "the Float32 camera clip accepts the boundary",
  );
  assert.deepEqual(local.faces(min, slightlyShort), expected);
  assert.deepEqual(local.faces(min, slightlyShort), local.faces(min, exactMax));
});

test("ordinary ray hits and camera ray/finite-box results match legacy queries exactly", () => {
  const { world } = worldWith(
    floor("first-equal-hit", 0, 0),
    floor("second-equal-hit", 0, 0),
    floor("behind-camera", 0, 0, -0.5, "!ROAD"),
  );
  const from = new THREE.Vector3(0, 1, 1),
    delta = new THREE.Vector3(0, -2, 0),
    actualRay = hitSummary(world.raycast(from, delta, 2, true)),
    expectedRay = legacyRaycast(world, from, delta, 2, true);
  assert.deepEqual(actualRay, expectedRay);
  assert.equal(
    actualRay.face.actor,
    "first-equal-hit",
    "ties retain source order",
  );

  const actual = cameraWorldQueries(world);
  const actualCameraRay = actual.ray(
    new THREE.Vector3(0, 1, 1),
    new THREE.Vector3(0, -2, 0),
  );
  const min = new THREE.Vector3(-0.25, -0.25, -0.25),
    max = new THREE.Vector3(0.25, 0.25, 0.25);
  const expected = withLegacyCameraQueries(world, (legacy) => ({
    ray: legacy.ray(new THREE.Vector3(0, 1, 1), new THREE.Vector3(0, -2, 0)),
    faces: legacy.faces(min, max),
  }));
  assert.deepEqual(actualCameraRay, expected.ray);
  assert.deepEqual(actual.faces(min, max), expected.faces);
});

test("native wheel rays retain the legacy query path and signed face semantics", () => {
  const grazing = new THREE.Mesh(
    faceGeometry([-1, 1.0005, -1, 1, 1.0005, -1, 0, 1.0005, 1]),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );
  grazing.name = "negative-fraction-wheel-face";
  const { world } = worldWith(grazing);
  const origin = new THREE.Vector3(0, 1, 0),
    direction = new THREE.Vector3(0, -1, 0),
    narrowEnvelope = new THREE.Box3(
      new THREE.Vector3(-0.01, -1, -0.01),
      new THREE.Vector3(0.01, 1, 0.01),
    ),
    localCandidates = queryLocal(
      world,
      narrowEnvelope.min,
      narrowEnvelope.max,
      false,
      narrowEnvelope,
    ),
    expected = legacyRaycast(world, origin, direction, 2, false, true),
    actual = hitSummary(world.raycast(origin, direction, 2, false, true));
  assert.equal(
    localCandidates.length,
    0,
    "a narrow segment omits the grazing face",
  );
  assert.equal(expected.face.actor, "negative-fraction-wheel-face");
  assert.deepEqual(actual, expected);
  assert.deepEqual(
    hitSummary(world.wheelRaycast(origin, direction, 2)),
    expected,
  );
});

test("dynamic world-collider snapshots append unchanged around local static filtering", () => {
  const staticFace = floor("static", 0, 0),
    movingActor = new THREE.Group(),
    movingFace = floor("moving", 0, 0);
  movingActor.add(movingFace);
  const { world } = worldWith(staticFace);
  const owner = {
    state: {
      position: new THREE.Vector3(),
      predictedPosition: new THREE.Vector3(),
      orientation: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
    },
    properties: {
      mass: 1,
      inertia: new THREE.Vector3(1, 1, 1),
      centerOfMass: new THREE.Vector3(),
      worldFriction: 0,
    },
    hulls: [],
  };
  world.addDynamic(owner, movingActor, true, true);
  const broadMin = new THREE.Vector3(-2, -1, -2),
    broadMax = new THREE.Vector3(2, 1, 4),
    missStatic = new THREE.Box3(
      new THREE.Vector3(30, -1, 30),
      new THREE.Vector3(31, 1, 31),
    );
  let found = queryLocal(world, broadMin, broadMax, true, missStatic);
  assert.deepEqual(found, [world.dynamic.get(owner).surfaces[0]]);
  const oldMovingSurface = found[0],
    oldVertices = [
      oldMovingSurface.a,
      oldMovingSurface.b,
      oldMovingSurface.c,
    ].map((v) => v.toArray());

  movingActor.position.x = 5;
  world.refreshDynamic(owner);
  found = queryLocal(world, broadMin, broadMax, true, missStatic);
  assert.equal(found.length, 1);
  assert.equal(found[0], world.dynamic.get(owner).surfaces[0]);
  assert.notEqual(found[0], oldMovingSurface);
  assert.deepEqual(
    [oldMovingSurface.a, oldMovingSurface.b, oldMovingSurface.c].map((v) =>
      v.toArray(),
    ),
    oldVertices,
    "previous dynamic query rows remain immutable snapshots",
  );
});

test("targeted mutation, rebuild, and newly attached meshes refresh local cached cells", () => {
  const first = floor("first", 0, 0),
    stable = floor("stable", 20, 0),
    owner = new THREE.Group();
  owner.add(first);
  const root = new THREE.Group();
  root.add(owner, stable);
  const world = new WorldCollision(root),
    broadMin = new THREE.Vector3(-3, -1, -3),
    broadMax = new THREE.Vector3(30, 1, 5),
    envelopeAt = (x) =>
      new THREE.Box3(
        new THREE.Vector3(x - 1.1, -0.1, -0.1),
        new THREE.Vector3(x + 1.1, 0.1, 2.1),
      );
  const firstInitial = queryLocal(
      world,
      broadMin,
      broadMax,
      true,
      envelopeAt(0),
    )[0],
    stableInitial = queryLocal(
      world,
      broadMin,
      broadMax,
      true,
      envelopeAt(20),
    )[0];
  assert.equal(firstInitial.actor, first);
  assert.equal(stableInitial.actor, stable);

  owner.position.x = 12;
  world.invalidateActors([owner]);
  assert.equal(
    queryLocal(world, broadMin, broadMax, true, envelopeAt(0)).length,
    0,
  );
  assert.equal(
    queryLocal(world, broadMin, broadMax, true, envelopeAt(12))[0].actor,
    first,
  );
  assert.equal(
    queryLocal(world, broadMin, broadMax, true, envelopeAt(20))[0],
    stableInitial,
  );

  first.geometry = faceGeometry([0, 0, 0, 2, 0, 0, 1, 0, 2]);
  world.invalidateActors([owner]);
  const geometryReplacement = queryLocal(
    world,
    broadMin,
    broadMax,
    true,
    envelopeAt(12),
  )[0];
  assert.notEqual(geometryReplacement, firstInitial);
  assert.equal(geometryReplacement.a.x, 12);

  const added = floor("added", 8, 0);
  owner.add(added);
  world.invalidateActors([owner]);
  assert.deepEqual(
    queryLocal(world, broadMin, broadMax, true, envelopeAt(20)).map(
      (surface) => surface.actor.name,
    ),
    ["added", "stable"],
  );
  world.rebuildStatic();
  assert.deepEqual(
    queryLocal(world, broadMin, broadMax, true, envelopeAt(20)).map(
      (surface) => surface.actor.name,
    ),
    ["added", "stable"],
  );
});

test("warm repeated local queries retain the face cache", () => {
  const { world } = worldWith(floor("cached", 0, 0));
  world.faceDiagnostics = {};
  const min = new THREE.Vector3(-2, -1, -2),
    max = new THREE.Vector3(2, 1, 4);
  const first = queryLocal(world, min, max, true);
  const before = {
    indexBuilds: world.faceDiagnostics.indexBuilds,
    faceBoundsBuilds: world.faceDiagnostics.faceBoundsBuilds,
  };
  const second = queryLocal(world, min, max, true);
  assert.deepEqual(second, first);
  assert.deepEqual(
    {
      indexBuilds: world.faceDiagnostics.indexBuilds,
      faceBoundsBuilds: world.faceDiagnostics.faceBoundsBuilds,
    },
    before,
    "a warm query reuses cell indexes and face bounds",
  );
});
