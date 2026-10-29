import assert from "node:assert/strict";
import test from "node:test";
import { Group, Mesh, MeshBasicMaterial, Vector3, Box3, Matrix4 } from "three";
import { WorldCollision } from "../src/world.ts";
import { createModelGeometry } from "../src/render-geometry.ts";
import {
  createNativeActorOrder,
  knownNativeActorValue as known,
} from "../src/native-actor-order.ts";
import {
  createNativeTrackModelResource,
  prepareNativeTrackResource,
} from "../src/native-track-resources.ts";
import {
  NativePedOrdinarySupport,
  NativePedOrdinarySupportError,
  nativePedOrdinarySupportFace,
} from "../src/ped-ordinary-support.ts";
import { NativePedGroundCachePool } from "../src/ped-ground-cache.ts";
import { nativePedSelectGroundSupport } from "../src/ped-grounding.ts";
import { rescanNativePedProximity } from "../src/ped-native-proximity.ts";
import { nativeWorldMatrix } from "../src/native-world-scene.ts";
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const bounds = { min: [-3, -3, -3], max: [3, 3, 3] };
const request = () => ({
  characterPose: Float32Array.from(I),
  localBounds: bounds,
  worldBounds: bounds,
  limit: 76,
  owner: {},
  timeMs: 1000,
});
function fixture(count = 1) {
  const material = { name: "road", flags: 0 };
  const model = {
    name: "safe-ground",
    flags: 0,
    pivot: [0, 0, 0],
    positions: Float32Array.from([-2, 0, -2, 0, 0, 2, 2, 0, -2]),
    uvs: new Float32Array(6),
    materials: ["road"],
    faces: Array.from({ length: count }, () => ({
      indices: [0, 1, 2],
      flags: 0,
      material: 1,
      smoothing: 0,
    })),
  };
  const resource = createNativeTrackModelResource(
    model,
    () => known(material),
    4,
  ).value;
  assert.equal(prepareNativeTrackResource(resource).resolved, true);
  const raw = (name, own) => ({
    name,
    type: own ? 1 : 0,
    renderStyle: own ? 4 : 0,
    transform: I,
    ...(own ? { model: model.name } : {}),
    children: [],
  });
  const state = createNativeActorOrder([raw("ground-actor", true)], {
    model: () => known(resource),
  });
  const actor = state.roots[0],
    root = new Group(),
    object = new Group();
  object.name = actor.name;
  const geometry = createModelGeometry(model),
    mesh = new Mesh(geometry, new MeshBasicMaterial({ name: "road" }));
  mesh.name = model.name;
  object.add(mesh);
  root.add(object);
  const native = {
    layout: {
      originX: -10,
      originZ: -10,
      columnSizeX: 20,
      columnSizeZ: 20,
      countX: 1,
      countZ: 1,
    },
    columns: [[actor]],
    additionalActors: null,
    nonTrackActors: createNativeActorOrder([raw("nontrack", false)]).roots[0],
    blackMaterial: material,
    resources: new Map([[resource, resource]]),
    arena: {
      materialOrder: (faces) => ({
        kind: "verified-pointer-order",
        keys: faces.map(() => 1),
        evidence: "single actual MAT",
      }),
    },
    actorObjects: new Map([[actor, object]]),
    faceActors: new Map([[actor, object]]),
    meshes: new Map([[actor, mesh]]),
    initialGeometries: new Map([[actor, geometry]]),
    actors: state.actors,
    noncars: [],
    provenance: "native-query-with-host-resource-addresses",
  };
  const world = new WorldCollision(root, undefined, undefined, native);
  return {
    material,
    model,
    resource,
    actor,
    native,
    world,
    support: new NativePedOrdinarySupport(world),
  };
}

test("ordinary support refuses legacy rendered collection before interpreting no floor", () => {
  let calls = 0;
  const support = new NativePedOrdinarySupport({
    collectFaces: () => {
      calls++;
      return [];
    },
  });
  assert.deepEqual(support.collect(request()), {
    status: "provider-required",
    requiredProviders: ["source-native-world-scene"],
    faces: [],
  });
  assert.throws(
    () => support.collectFaces(request()),
    NativePedOrdinarySupportError,
  );
  assert.equal(calls, 0);
  assert.equal(nativePedOrdinarySupportFace({}).status, "provider-required");
});

test("actual native world collection retains finite76 prefix, source MAT and raw/prepared face order", () => {
  const h = fixture(80);
  const query = {
    bounds: new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max)),
    matrix: new Matrix4(),
  };
  const expected = h.world.collectFaces(query, 76, true);
  const result = h.support.collect(request());
  assert.equal(result.status, "complete");
  assert.equal(result.faces.length, 76);
  assert.deepEqual(
    result.faces.map((face) => face.native.nativeFaceIndex),
    expected.map((surface) => surface.native.nativeFaceIndex),
  );
  assert.ok(
    result.faces.every(
      (face) => face.material === h.material && face.nativeGroup === -1,
    ),
  );
  assert.deepEqual(result.faces[0].a, expected[0].native.a);
  assert.notEqual(result.faces[0].normal, expected[0].native.normal);
});

test("query adapter preserves actual basis/shear and local bounds, with explicit simulation callback outlet", () => {
  const h = fixture(),
    r = request();
  r.characterPose = Float32Array.from([1, 2, 0, 0, 1, 0, 0, 0, 3, 4, 5, 6]);
  r.worldBounds = { min: [-999, -999, -999], max: [999, 999, 999] };
  let seen;
  const support = new NativePedOrdinarySupport(h.world, {
    collectWorldFaces: (query, count, gather) => {
      seen = { query, count, gather };
      return [];
    },
  });
  assert.equal(support.collect(r).status, "complete");
  assert.deepEqual(
    nativeWorldMatrix(seen.query.matrix),
    Array.from(r.characterPose),
  );
  assert.deepEqual(seen.query.bounds.min.toArray(), bounds.min);
  assert.deepEqual(seen.query.bounds.max.toArray(), bounds.max);
  assert.equal(seen.count, 76);
  assert.equal(seen.gather, true);
});

test("CheckSingleFace queries borrowed mutable records and live MAT flags with finite geometry", () => {
  const h = fixture(),
    face = h.support.collectFaces(request())[0];
  const query = {
    origin: [0, 0.5, 0],
    segment: [0, -1, 0],
    excludePlingMaterials: false,
  };
  assert.deepEqual(h.support.queryFace(face, query), {
    parameter: 0.5,
    point: [0, 0, 0],
  });
  assert.equal(
    h.support.queryFace(face, { ...query, origin: [5, 0.5, 5] }),
    null,
  );
  const fromBelow = { ...query, origin: [0, -0.5, 0], segment: [0, 1, 0] };
  assert.equal(h.support.queryFace(face, fromBelow), null);
  h.material.flags = 0x1000;
  assert.ok(h.support.queryFace(face, fromBelow));
  assert.equal(face.materialFlags, 0);
  h.support.synchronizeMaterialFlags([face]);
  assert.equal(face.materialFlags, 0x1000);
  face.normal = [0, -1, 0];
  h.material.flags = 0;
  assert.equal(h.support.queryFace(face, query), null);
  assert.deepEqual(face.native.normal, [0, 1, 0]);
});

test("ground selector owns bit80 and nearest tie semantics after finite adapter queries", () => {
  const h = fixture(2),
    faces = h.support.collectFaces(request());
  const select = () =>
    nativePedSelectGroundSupport(
      faces,
      [0, 0.5, 0],
      0,
      (face, query) => h.support.queryFace(face, query),
      false,
    );
  assert.equal(select().face, faces[0]);
  faces[0].rawFlags |= 0x80;
  assert.equal(select().face, faces[1]);
});

test("85-slot copies retain actual metadata and proximity reads current ACT MODEL indices", () => {
  const h = fixture(),
    faces = h.support.collectFaces(request()),
    pool = new NativePedGroundCachePool();
  const slot = pool.acquire({
    previous: null,
    preferredIdentity: null,
    capacity: 5,
    faces,
    bounds,
    owner: {},
    timeMs: 1000,
  });
  const face = slot.faces[0];
  assert.notEqual(face, faces[0]);
  assert.equal(face.native, faces[0].native);
  assert.equal(face.material, h.material);
  let indexed = h.support.readIndexedFace(face);
  assert.equal(indexed.kind, "indexed");
  assert.equal(indexed.value.model, h.resource);
  assert.deepEqual(indexed.value.indices, [0, 1, 2]);
  h.resource.current.faces[0].indices = [2, 1, 0];
  indexed = h.support.readIndexedFace(face);
  assert.deepEqual(indexed.value.indices, [2, 1, 0]);
  face.nativeFace = 9;
  assert.equal(h.support.readIndexedFace(face).kind, "invalid-face");
  face.nativeFace = 0;
  face.nativeGroup = 0;
  assert.deepEqual(h.support.readIndexedFace(face), {
    kind: "provider-required",
    requiredProvider: "source-proximity-prepared-group-index-storage",
  });
});

test("excluded negative-group floor preserves native unsupported boundary without vertex substitution", () => {
  const h = fixture(),
    face = h.support.collectFaces(request())[0];
  const indexed = h.support.readIndexedFace(face).value;
  assert.deepEqual(h.support.readPreparedGroupVertices(face, indexed), {
    kind: "provider-required",
    requiredProvider:
      "source-proximity-unchecked-negative-prepared-group-storage",
  });
  const process = {
    storage: new Uint8Array(300),
    faceCache: { faces: [face], selectedFace: face },
  };
  const result = rescanNativePedProximity({
    process,
    rootPosition: [0, 0.1, 0],
    characterDirection: [0, 0, 1],
    direction: null,
    personalityBoundsMaxX: 0.1,
    cosMaxSlope: 0.7,
    action: 0,
    suicidal: false,
    exclusionSpec: {
      exclusionsOkWhenRunning: false,
      exclusions: [{ material: h.material, flags: 0 }],
      exceptions: [],
    },
    readIndexedFace: (value) => h.support.readIndexedFace(value),
    readPreparedGroupVertices: (value, indices) =>
      h.support.readPreparedGroupVertices(value, indices),
  });
  assert.equal(result.status, "provider-required");
  assert.deepEqual(result.requiredProviders, [
    "source-proximity-unchecked-negative-prepared-group-storage",
  ]);
  assert.deepEqual(process.storage, new Uint8Array(300));
});

test("missing native records or unresolved collection produce explicit provider results", () => {
  const h = fixture();
  let support = new NativePedOrdinarySupport(h.world, {
    collectWorldFaces: () => [{}],
  });
  assert.equal(
    support.collect(request()).requiredProviders[0],
    "source-native-pedestrian-world-face-record",
  );
  support = new NativePedOrdinarySupport(h.world, {
    collectWorldFaces: () => {
      throw new Error(
        "Native world face collector requires actual-current-MODEL",
      );
    },
  });
  assert.deepEqual(support.collect(request()).requiredProviders, [
    "actual-current-MODEL",
  ]);
  // The retained record still points at the ACT whose local binding changed.
  const original = fixture(),
    face = original.support.collectFaces(request())[0];
  original.actor.localModel = {
    resolved: false,
    requiredProvider: "unresolved-ACT-MODEL",
  };
  assert.deepEqual(original.support.readIndexedFace(face), {
    kind: "provider-required",
    requiredProvider: "unresolved-ACT-MODEL",
  });
});
