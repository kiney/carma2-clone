import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { WorldCollision } from "../src/world.ts";
import {
  createNativeTrackModelResource,
  nativeTrackMaterialOrder,
  prepareNativeTrackResource,
} from "../src/native-track-resources.ts";
import {
  createNativeActorOrder,
  knownNativeActorValue as known,
  prependNativeActor,
  removeNativeActor,
} from "../src/native-actor-order.ts";

const triangle = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 0, 0, 1], 3),
  );
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2),
  );
  return geometry;
};
const owner = () => ({
  state: {
    position: new THREE.Vector3(),
    orientation: new THREE.Quaternion(),
    velocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
  },
  properties: {
    mass: 1,
    inertia: new THREE.Vector3(1, 1, 1),
    centerOfMass: new THREE.Vector3(),
    worldFriction: 1,
  },
  hulls: [],
});
const diagnostics = () => ({
  dynamicChecks: 0,
  dynamicUnchanged: 0,
  dynamicChanged: 0,
  hierarchyChecks: 0,
  triangleBuilds: 0,
  nativeActorChecks: 0,
  nativeActorWrites: 0,
  nativeGeometryChecks: 0,
  nativeGeometryWrites: 0,
  transform: {
    resolved: 0,
    cacheHits: 0,
    localChecks: 0,
    compositions: 0,
    multiplications: 0,
    nativeUpdates: 0,
  },
});
function dynamicFixture({ nested = false, parent = null, material } = {}) {
  const worldRoot = new THREE.Group(),
    actor = new THREE.Group();
  const child = new THREE.Mesh(
    triangle(),
    material ?? new THREE.MeshBasicMaterial(),
  );
  actor.add(child);
  (parent ?? worldRoot).add(actor);
  const body = owner(),
    world = new WorldCollision(worldRoot);
  world.syncDiagnostics = diagnostics();
  world.addDynamic(body, actor, true);
  world.syncDiagnostics = diagnostics();
  return { world, worldRoot, actor, child, body };
}
const rows = (world, body) => world.dynamic.get(body).surfaces;
const points = (surface) =>
  [surface.a, surface.b, surface.c].map((p) => p.toArray());

test("unchanged dynamic hierarchy is cached without matrix updates or triangle rebuilds", () => {
  const f = dynamicFixture(),
    { world, actor, child, body } = f;
  const first = rows(world, body),
    original = first.map(points);
  world.refreshDynamic(body);
  assert.equal(rows(world, body), first);
  assert.deepEqual(rows(world, body).map(points), original);
  assert.equal(world.syncDiagnostics.triangleBuilds, 0);
  assert.equal(world.syncDiagnostics.dynamicUnchanged, 1);
  assert.equal(world.syncDiagnostics.transform.multiplications, 0);
  assert.equal(world.syncDiagnostics.transform.nativeUpdates, 0);
  assert.equal(child.geometry.getAttribute("position").count, 3);
});

test("descendant and ancestor changes, reparenting and manual affine matrices refresh cached surfaces", () => {
  const f = dynamicFixture(),
    { world, worldRoot, actor, child, body } = f;
  const first = rows(world, body),
    captured = first.map(points);
  child.position.x = 3;
  world.refreshDynamic(body);
  assert.notEqual(rows(world, body), first);
  assert.deepEqual(
    first.map(points),
    captured,
    "returned rows remain immutable snapshots",
  );
  assert.equal(rows(world, body)[0].a.x, 2);

  const prior = rows(world, body);
  worldRoot.position.y = 5;
  world.syncDiagnostics = diagnostics();
  world.refreshDynamic(body);
  assert.notEqual(rows(world, body), prior);
  assert.equal(rows(world, body)[0].a.y, 5);

  const newParent = new THREE.Group();
  worldRoot.add(newParent);
  newParent.position.z = 4;
  newParent.add(actor);
  world.syncDiagnostics = diagnostics();
  world.refreshDynamic(body);
  assert.equal(rows(world, body)[0].a.z, 4);

  actor.matrixAutoUpdate = false;
  actor.matrix.set(1, 0.4, 0, 7, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  actor.matrixWorldNeedsUpdate = true;
  world.syncDiagnostics = diagnostics();
  world.refreshDynamic(body);
  assert.equal(rows(world, body)[0].a.x, 9);
});

test("opaque external parent updates use Three's live hierarchy path", () => {
  const worldRoot = new THREE.Group(),
    parent = new THREE.Group(),
    actor = new THREE.Group();
  const mesh = new THREE.Mesh(triangle(), new THREE.MeshBasicMaterial());
  actor.add(mesh);
  parent.add(actor);
  worldRoot.add(parent);
  const update = parent.updateWorldMatrix;
  let calls = 0;
  parent.updateWorldMatrix = function (...args) {
    calls++;
    return update.apply(this, args);
  };
  const world = new WorldCollision(worldRoot),
    body = owner();
  world.syncDiagnostics = diagnostics();
  world.addDynamic(body, actor, true);
  assert.ok(calls > 0);
  const prior = rows(world, body);
  calls = 0;
  parent.position.x = 4;
  world.refreshDynamic(body);
  assert.ok(calls > 0, "opaque parent retains its update behavior");
  assert.equal(
    calls,
    1,
    "one native hierarchy update handles the opaque branch",
  );
  assert.notEqual(rows(world, body), prior);
  assert.equal(rows(world, body)[0].a.x, 3);
  assert.deepEqual(
    points(rows(world, body)[0]),
    [
      [3, 0, 0],
      [5, 0, 0],
      [4, 0, 1],
    ],
    "rebuilt surface vertices use the final parent transform",
  );
});

test("opaque update recaptures topology added before the native traversal", () => {
  const worldRoot = new THREE.Group(),
    parent = new THREE.Group(),
    actor = new THREE.Group(),
    extra = new THREE.Mesh(triangle(), new THREE.MeshBasicMaterial());
  actor.add(new THREE.Mesh(triangle(), new THREE.MeshBasicMaterial()));
  parent.add(actor);
  worldRoot.add(parent);
  const update = parent.updateWorldMatrix;
  let inserted = false;
  parent.updateWorldMatrix = function (...args) {
    if (!inserted) {
      inserted = true;
      actor.add(extra);
    }
    return update.apply(this, args);
  };
  const world = new WorldCollision(worldRoot),
    body = owner();
  world.addDynamic(body, actor, true);
  assert.equal(rows(world, body).length, 2);
  parent.updateWorldMatrix = update;
  extra.position.x = 6;
  const prior = rows(world, body);
  world.refreshDynamic(body);
  assert.notEqual(rows(world, body), prior);
  assert.equal(
    rows(world, body).find((surface) => surface.actor === extra).a.x,
    5,
    "newly inserted mesh remains tracked after the opaque update returns",
  );
});

test("restoring an opaque descendant update method invalidates the forced owner", () => {
  const worldRoot = new THREE.Group(),
    actor = new THREE.Group(),
    mesh = new THREE.Mesh(triangle(), new THREE.MeshBasicMaterial());
  actor.add(mesh);
  worldRoot.add(actor);
  const update = mesh.updateWorldMatrix;
  mesh.updateWorldMatrix = function (...args) {
    update.apply(this, args);
    this.matrixWorld.elements[12] = 5;
  };
  const world = new WorldCollision(worldRoot),
    body = owner();
  world.addDynamic(body, actor, true);
  assert.equal(rows(world, body)[0].a.x, 4);
  mesh.updateWorldMatrix = update;
  world.refreshDynamic(body);
  assert.equal(
    rows(world, body)[0].a.x,
    -1,
    "the next ordinary pass discards the prior opaque matrixWorld edit",
  );
});

test("in-place vertices, replacement geometry, index, groups and material eligibility invalidate rows", () => {
  const f = dynamicFixture(),
    { world, child, body } = f;
  let prior = rows(world, body);
  const position = child.geometry.getAttribute("position");
  position.setX(0, -2);
  position.needsUpdate = true;
  world.syncDiagnostics = diagnostics();
  world.refreshDynamic(body);
  assert.notEqual(rows(world, body), prior);
  assert.equal(rows(world, body)[0].a.x, -2);

  prior = rows(world, body);
  const geometry = triangle();
  geometry.setIndex([0, 2, 1]);
  child.geometry = geometry;
  world.syncDiagnostics = diagnostics();
  world.refreshDynamic(body);
  assert.notEqual(rows(world, body), prior);
  assert.equal(rows(world, body)[0].b.z, 1);

  prior = rows(world, body);
  geometry.getAttribute("uv").setX(0, 0.25);
  geometry.getAttribute("uv").needsUpdate = true;
  world.syncDiagnostics = diagnostics();
  world.refreshDynamic(body);
  assert.notEqual(
    rows(world, body),
    prior,
    "UV revision participates in the geometry signature",
  );

  prior = rows(world, body);
  geometry.clearGroups();
  geometry.addGroup(0, 3, 1);
  child.material = [
    new THREE.MeshBasicMaterial(),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  ];
  world.syncDiagnostics = diagnostics();
  world.refreshDynamic(body);
  assert.notEqual(rows(world, body), prior);
  assert.equal(rows(world, body)[0].twoSided, true);

  prior = rows(world, body);
  child.userData.skipWorldCollision = true;
  world.syncDiagnostics = diagnostics();
  world.refreshDynamic(body);
  assert.notEqual(rows(world, body), prior);
  assert.equal(rows(world, body).length, 0);
});

test("child addition, removal, detachment and world smash eligibility are reflected", () => {
  const f = dynamicFixture(),
    { world, actor, child, body } = f;
  const extra = new THREE.Mesh(triangle(), new THREE.MeshBasicMaterial());
  actor.add(extra);
  world.refreshDynamic(body);
  assert.equal(rows(world, body).length, 2);
  actor.remove(child);
  world.refreshDynamic(body);
  assert.equal(rows(world, body).length, 1);
  actor.userData.worldSmashDisabled = true;
  world.refreshDynamic(body);
  assert.equal(rows(world, body).length, 0);
  actor.userData.worldSmashDisabled = false;
  actor.remove(extra);
  world.refreshDynamic(body);
  assert.equal(rows(world, body).length, 0);
});

const nativeMaterial = {
  name: "road",
  rgba: [80, 80, 80, 255],
  flags: 4096,
  ambient: 1,
  diffuse: 0,
  specular: 0,
  power: 20,
  uvTransform: [1, 0, 0, 1, 0, 0],
};
function nativeFixture({ columns = 1 } = {}) {
  const model = {
    name: "road",
    flags: 0x80,
    pivot: [0, 0, 0],
    positions: Float32Array.from([-1, 0, -1, 0, 0, 1, 1, 0, -1]),
    uvs: new Float32Array(6),
    materials: ["road"],
    faces: [{ indices: [0, 1, 2], material: 1, flags: 0, smoothing: 0 }],
  };
  const resource = createNativeTrackModelResource(
    model,
    () => known(nativeMaterial),
    4,
  ).value;
  assert.equal(prepareNativeTrackResource(resource).resolved, true);
  const raw = (name, children = []) => ({
    name,
    type: 1,
    renderStyle: 4,
    transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    model: "road",
    children,
  });
  const roots = Array.from({ length: columns }, (_, index) =>
    raw(`&animated${index || ""}`, [raw(`&01a000${index}`)]),
  );
  const state = createNativeActorOrder(roots, { model: () => known(resource) });
  const objects = new Map(
    state.actors.map((actor) => [actor, new THREE.Group()]),
  );
  const meshes = new Map();
  for (const actor of state.actors) {
    const mesh = new THREE.Mesh(
      triangle(),
      new THREE.MeshBasicMaterial({ name: "road" }),
    );
    objects.get(actor).add(mesh);
    meshes.set(actor, mesh);
  }
  const native = {
    layout: {
      originX: -10,
      originZ: -10,
      columnSizeX: columns === 1 ? 20 : columns === 2 ? 10 : 5,
      columnSizeZ: 20,
      countX: columns,
      countZ: 1,
    },
    columns: [state.roots],
    additionalActors: null,
    nonTrackActors: createNativeActorOrder([
      {
        name: "nontrack",
        type: 0,
        renderStyle: 0,
        transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        children: [],
      },
    ]).roots[0],
    blackMaterial: nativeMaterial,
    resources: new Map([[resource, resource]]),
    arena: {
      materialOrder: (faces) =>
        nativeTrackMaterialOrder({ current: { faces } }),
    },
    meshes,
    initialPoses: new Map(),
    initialGeometries: new Map(
      [...meshes].map(([actor, mesh]) => [actor, mesh.geometry]),
    ),
    actorObjects: objects,
    faceActors: objects,
    actors: state.actors,
    noncars: [],
    provenance: "native-query-with-host-resource-addresses",
  };
  return {
    world: new WorldCollision(new THREE.Group(), undefined, undefined, native),
    state,
    objects,
    native,
  };
}

test("native collection syncs only visited ACTs and callbacks preserve emitted surface snapshots", () => {
  const { world, state, objects } = nativeFixture(),
    events = [];
  const rootObject = objects.get(state.roots[0]);
  const childObject = objects.get(state.actors[1]);
  childObject.position.x = 2;
  world.syncDiagnostics = diagnostics();
  const faces = world.collectFaces(
    {
      bounds: new THREE.Box3(
        new THREE.Vector3(-10, -10, -10),
        new THREE.Vector3(10, 10, 10),
      ),
      matrix: new THREE.Matrix4(),
    },
    1,
    true,
    {
      stopGroovidelic: (object) => {
        events.push(["stop", object]);
        object.position.x = 5;
      },
      pullActorFromWorld: (object) => {
        events.push(["pull", object]);
        return null;
      },
    },
  );
  assert.equal(faces.length, 1);
  assert.equal(faces[0].native.actor, state.roots[0]);
  assert.deepEqual(events, [
    ["stop", rootObject],
    ["pull", objects.get(state.actors[1])],
  ]);
  assert.deepEqual(
    faces[0].a.toArray(),
    [-1, 0, -1],
    "emitted row retains pre-stop pose",
  );
  assert.equal(
    world.syncDiagnostics.nativeActorChecks,
    2,
    "root and child visited; non-track actor pruned",
  );
  assert.ok(
    world.syncDiagnostics.nativeActorWrites >= 1,
    "changed visited host ACT is synchronized lazily",
  );
});

test("Stop rewrites direct borrowed ACT matrix edits and skips redundant warm writes", () => {
  const { world, state, objects } = nativeFixture(),
    actor = state.roots[0],
    object = objects.get(actor),
    query = {
      bounds: new THREE.Box3(
        new THREE.Vector3(-10, -10, -10),
        new THREE.Vector3(10, 10, 10),
      ),
      matrix: new THREE.Matrix4(),
    };
  object.position.x = 3;
  world.syncDiagnostics = diagnostics();
  let captured;
  const first = world.collectFaces(query, 8, true, {
    onFace: (surface) => {
      if (surface.native.actor === actor) {
        captured = surface.a.clone();
        actor.matrix[9] = 123;
      }
    },
  });
  assert.ok(captured);
  assert.equal(
    first[0].a.x,
    2,
    "captured surface retains its emitted vertices",
  );
  assert.equal(
    actor.matrix[9],
    3,
    "Stop restores the host-derived ACT local translation",
  );
  const writesAfterFirstQuery = world.syncDiagnostics.nativeActorWrites;
  assert.ok(writesAfterFirstQuery > 0);

  const warm = world.collectFaces(query, 8, true);
  assert.equal(warm[0].a.x, 2);
  assert.equal(
    world.syncDiagnostics.nativeActorWrites,
    writesAfterFirstQuery,
    "unchanged warm query skips redundant native matrix writes",
  );
});

test("native parent-link-only change preserves borrowed local until child Stop rebases it", () => {
  const { world, state, objects, native } = nativeFixture(),
    child = state.actors[1],
    childObject = objects.get(child),
    resource = child.localModel.value;
  world.collectFaces(
    {
      bounds: new THREE.Box3(
        new THREE.Vector3(-10, -10, -10),
        new THREE.Vector3(10, 10, 10),
      ),
      matrix: new THREE.Matrix4(),
    },
    8,
    true,
  );
  assert.equal(child.matrix[9], 0);

  const newParent = createNativeActorOrder(
    [
      {
        name: "&newparent",
        type: 0,
        renderStyle: 4,
        transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
        model: "road",
        children: [],
      },
    ],
    { model: () => known(resource) },
  ).roots[0];
  const parentObject = new THREE.Group();
  parentObject.position.x = 4;
  native.actorObjects.set(newParent, parentObject);
  native.faceActors.set(newParent, parentObject);
  removeNativeActor(child);
  prependNativeActor(newParent, child);
  native.columns = [[newParent]];

  const events = [];
  const faces = world.collectFaces(
    {
      bounds: new THREE.Box3(
        new THREE.Vector3(-10, -10, -10),
        new THREE.Vector3(10, 10, 10),
      ),
      matrix: new THREE.Matrix4(),
    },
    8,
    true,
    {
      onFace: (surface) => events.push(["face", surface.a.x]),
      stopGroovidelic: (object) => {
        if (object === childObject) {
          events.push(["child-stop", child.matrix[9]]);
          assert.equal(
            child.matrix[9],
            0,
            "parent-link-only preflight preserves borrowed child local",
          );
        }
      },
    },
  );
  assert.ok(faces.length > 0);
  assert.deepEqual(
    events.find(([kind]) => kind === "child-stop"),
    ["child-stop", 0],
  );
  assert.equal(child.matrix[9], -4);
});

test("native opaque parent resolves once before face generation and matches its current transform", () => {
  const { world, state, objects } = nativeFixture(),
    external = new THREE.Group(),
    actorObject = objects.get(state.roots[0]);
  external.position.x = 4;
  const update = external.updateWorldMatrix;
  let calls = 0;
  external.updateWorldMatrix = function (...args) {
    calls++;
    return update.apply(this, args);
  };
  external.add(actorObject);
  world.syncDiagnostics = diagnostics();
  const callsAtFace = [];
  const faces = world.collectFaces(
    {
      bounds: new THREE.Box3(
        new THREE.Vector3(-10, -10, -10),
        new THREE.Vector3(10, 10, 10),
      ),
      matrix: new THREE.Matrix4(),
    },
    8,
    true,
    { onFace: () => callsAtFace.push(calls) },
  );
  assert.ok(faces.length > 0);
  assert.equal(
    faces[0].a.x,
    3,
    "surface row follows the current host world transform",
  );
  assert.equal(
    calls,
    4,
    "two preflight actor syncs and two Stop outlets update the opaque parent",
  );
  assert.deepEqual(
    callsAtFace,
    [2, 3],
    "both actors sync before generation and each Stop updates before the next row",
  );
});

test("render-reparented native child sees parent Stop transform after captured parent face", () => {
  const { world, state, objects } = nativeFixture(),
    parent = objects.get(state.roots[0]),
    child = objects.get(state.actors[1]),
    events = [];
  parent.add(child); // Rendering hierarchy is rebuilt independently from ACT ownership.
  const faces = world.collectFaces(
    {
      bounds: new THREE.Box3(
        new THREE.Vector3(-10, -10, -10),
        new THREE.Vector3(10, 10, 10),
      ),
      matrix: new THREE.Matrix4(),
    },
    4,
    true,
    {
      onFace: (surface) => events.push(["face", surface.a.x]),
      stopGroovidelic: (object) => {
        events.push(["stop", object.position.x]);
        if (object === parent) object.position.x = 2;
      },
    },
  );
  assert.equal(faces.length, 2);
  assert.deepEqual(events, [
    ["face", -1],
    ["stop", 0],
    ["face", 1],
    ["stop", 0],
  ]);
  assert.equal(faces[0].a.x, -1, "first row keeps the parent pose at emission");
  assert.equal(
    faces[1].a.x,
    1,
    "child row uses the updated parent ACT transform",
  );
});

test("native query uses a query-start ACT snapshot after onFace mutates an unvisited child", () => {
  const { world, state, objects } = nativeFixture(),
    child = objects.get(state.actors[1]);
  const query = {
    bounds: new THREE.Box3(
      new THREE.Vector3(-10, -10, -10),
      new THREE.Vector3(10, 10, 10),
    ),
    matrix: new THREE.Matrix4(),
  };
  const baseline = world.collectFaces(query, 8, true);
  child.position.x = 0;
  const first = world.collectFaces(query, 8, true, {
    onFace: (surface) => {
      if (surface.native.actor === state.roots[0]) child.position.x = 7;
    },
  });
  assert.equal(first.length, baseline.length);
  assert.deepEqual(
    first.map((surface) => surface.a.toArray()),
    baseline.map((surface) => surface.a.toArray()),
    "all rows use pre-callback input even when a later child is unvisited",
  );
  const second = world.collectFaces(query, 8, true);
  assert.equal(second.length, baseline.length);
  assert.equal(
    second[1].a.x,
    baseline[1].a.x + 7,
    "next query observes the changed child transform",
  );
});

test("native sync checks only selected columns and capacity zero still runs native callbacks", () => {
  const { world, state, objects } = nativeFixture({ columns: 4 });
  world.syncDiagnostics = diagnostics();
  const leftQuery = {
    bounds: new THREE.Box3(
      new THREE.Vector3(-9, -10, -10),
      new THREE.Vector3(-8, 10, 10),
    ),
    matrix: new THREE.Matrix4(),
  };
  world.collectFaces(leftQuery, 8, true);
  const afterLeft = world.syncDiagnostics.nativeActorChecks;
  assert.equal(
    afterLeft,
    4,
    "only two selected roots and their children were checked",
  );
  objects.get(state.roots[3]).position.x = 6;
  world.collectFaces(leftQuery, 8, true);
  assert.equal(
    world.syncDiagnostics.nativeActorChecks,
    afterLeft + 4,
    "an unselected column adds no actor checks",
  );
  const rightQuery = {
    bounds: new THREE.Box3(
      new THREE.Vector3(6, -10, -10),
      new THREE.Vector3(9, 10, 10),
    ),
    matrix: new THREE.Matrix4(),
  };
  world.collectFaces(rightQuery, 8, true);
  assert.equal(
    world.syncDiagnostics.nativeActorChecks,
    afterLeft + 8,
    "the changed actor is synchronized when its column is selected",
  );

  const callbacks = [];
  world.collectFaces(
    {
      bounds: new THREE.Box3(
        new THREE.Vector3(-10, -10, -10),
        new THREE.Vector3(10, 10, 10),
      ),
      matrix: new THREE.Matrix4(),
    },
    0,
    true,
    {
      pullActorFromWorld: (object) => {
        callbacks.push(object);
        return null;
      },
    },
  );
  assert.deepEqual(callbacks, [
    objects.get(state.actors[1]),
    objects.get(state.actors[3]),
    objects.get(state.actors[5]),
    objects.get(state.actors[7]),
  ]);
});

const preparationQuery = () => ({
  bounds: new THREE.Box3(
    new THREE.Vector3(-10, -10, -10),
    new THREE.Vector3(10, 10, 10),
  ),
  matrix: new THREE.Matrix4(),
});

test("physics preparation reuses ordinary ACT subtrees while repeating native callbacks", () => {
  const { world, state, objects } = nativeFixture();
  world.syncDiagnostics = diagnostics();
  const events = [];
  const callbacks = {
    mutationsTracked: true,
    onFaceReadOnly: true,
    onFace: (surface) => events.push(["face", surface.native.actor]),
    stopGroovidelic: (actor) => events.push(["stop", actor]),
    pullActorFromWorld: (actor) => {
      events.push(["pull", actor]);
      return null;
    },
  };
  world.beginNativePreparation();
  try {
    const first = world.collectFaces(preparationQuery(), 8, true, callbacks);
    const firstEvents = [...events];
    const actorChecks = world.syncDiagnostics.nativeActorChecks;
    const geometryChecks = world.syncDiagnostics.nativeGeometryChecks;
    events.length = 0;
    const second = world.collectFaces(preparationQuery(), 8, true, callbacks);
    assert.deepEqual(second.map(points), first.map(points));
    assert.deepEqual(events, firstEvents, "callbacks retain their exact order");
    assert.equal(world.syncDiagnostics.nativeActorChecks, actorChecks);
    assert.equal(world.syncDiagnostics.nativeGeometryChecks, geometryChecks);
    assert.ok(world.syncDiagnostics.nativePreparedActorHits > 0);

    objects.get(state.actors[1]).position.x = 3;
    world.invalidateNativePreparation("pose");
    const moved = world.collectFaces(preparationQuery(), 8, true, callbacks);
    assert.equal(moved[1].a.x, first[1].a.x + 3);
    assert.equal(world.syncDiagnostics.nativeActorChecks, actorChecks * 2);
    assert.equal(world.syncDiagnostics.nativeGeometryChecks, geometryChecks);
    assert.ok(world.syncDiagnostics.nativePreparedGeometryHits > 0);
  } finally {
    world.endNativePreparation();
  }
  const geometryChecks = world.syncDiagnostics.nativeGeometryChecks;
  world.collectFaces(preparationQuery(), 8);
  assert.ok(world.syncDiagnostics.nativeGeometryChecks > geometryChecks);
});

test("uncertified observers keep query-start snapshots and invalidate scoped preparation", () => {
  const { world, state, objects } = nativeFixture();
  const child = objects.get(state.actors[1]);
  world.beginNativePreparation();
  try {
    const baseline = world.collectFaces(preparationQuery(), 8);
    const changed = world.collectFaces(preparationQuery(), 8, true, {
      onFace: (surface) => {
        if (surface.native.actor === state.roots[0]) child.position.x = 7;
      },
    });
    assert.deepEqual(changed.map(points), baseline.map(points));
    const next = world.collectFaces(preparationQuery(), 8);
    assert.equal(next[1].a.x, baseline[1].a.x + 7);
  } finally {
    world.endNativePreparation();
  }
});

test("geometry publication invalidates prepared MODEL tables within a physics scope", () => {
  const { world, state, native } = nativeFixture();
  const actor = state.roots[0];
  const mesh = native.meshes.get(actor);
  world.syncDiagnostics = diagnostics();
  world.beginNativePreparation();
  try {
    world.collectFaces(preparationQuery(), 8);
    const position = mesh.geometry.getAttribute("position");
    position.setX(0, -4);
    position.needsUpdate = true;
    world.invalidateActors([mesh]);
    const next = world.collectFaces(preparationQuery(), 8);
    assert.equal(next[0].a.x, -4);
    assert.ok(world.syncDiagnostics.nativeGeometryWrites > 0);
    const checks = world.syncDiagnostics.nativeGeometryChecks;
    world.collectFaces(preparationQuery(), 8);
    assert.equal(world.syncDiagnostics.nativeGeometryChecks, checks);
  } finally {
    world.endNativePreparation();
  }
});

test("opaque ACT update methods stay eager within a physics preparation scope", () => {
  const { world, state, objects } = nativeFixture();
  const object = objects.get(state.roots[0]);
  let updates = 0;
  object.updateWorldMatrix = function (...args) {
    updates++;
    return THREE.Object3D.prototype.updateWorldMatrix.apply(this, args);
  };
  world.syncDiagnostics = diagnostics();
  world.beginNativePreparation();
  try {
    world.collectFaces(preparationQuery(), 8);
    const firstUpdates = updates;
    const firstChecks = world.syncDiagnostics.nativeActorChecks;
    world.collectFaces(preparationQuery(), 8);
    assert.ok(updates > firstUpdates);
    assert.ok(world.syncDiagnostics.nativeActorChecks > firstChecks);
  } finally {
    world.endNativePreparation();
  }
});
