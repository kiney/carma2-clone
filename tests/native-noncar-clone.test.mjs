import test from "node:test";
import assert from "node:assert/strict";
import {
  Box3,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { WorldCollision } from "../src/world.ts";
import { createModelGeometry } from "../src/render-geometry.ts";
import {
  createNativeActorOrder,
  enumerateNativeActorChildren,
  knownNativeActorValue as known,
} from "../src/native-actor-order.ts";
import {
  createNativeTrackModelResource,
  prepareNativeTrackResource,
} from "../src/native-track-resources.ts";

const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const material = { name: "road", flags: 0 };
function fixture() {
  const model = {
    name: "same-model",
    flags: 0,
    pivot: [0, 0, 0],
    positions: Float32Array.from([-1, 0, -1, 0, 0, 1, 1, 0, -1, 9, 3, 0]),
    uvs: new Float32Array(8),
    materials: ["road"],
    faces: [{ indices: [0, 1, 2], flags: 0, material: 1, smoothing: 0 }],
  };
  const resource = createNativeTrackModelResource(
    model,
    () => known(material),
    4,
  ).value;
  assert.ok(prepareNativeTrackResource(resource).resolved);
  const raw = (name, children = [], own = false) => ({
    name,
    type: own ? 1 : 0,
    renderStyle: own ? 4 : 0,
    transform: I,
    ...(own ? { model: model.name } : {}),
    children,
  });
  const state = createNativeActorOrder(
    [raw("track", [raw("&01a0000", [raw("one"), raw("two")], true)])],
    { model: () => known(resource) },
  );
  const [track, prop, one, two] = state.actors;
  const root = new Group(),
    host = new Group(),
    template = new Group();
  root.add(host);
  host.add(template);
  template.name = prop.name;
  const oneObject = new Group(),
    twoObject = new Group();
  oneObject.name = "one";
  twoObject.name = "two";
  const geometry = createModelGeometry(model),
    mesh = new Mesh(geometry, new MeshBasicMaterial({ name: "road" }));
  mesh.name = model.name;
  template.add(mesh, oneObject, twoObject);
  const nontrack = createNativeActorOrder([raw("nontrack")]).roots[0];
  const scene = {
    layout: {
      originX: -10,
      originZ: -10,
      columnSizeX: 20,
      columnSizeZ: 20,
      countX: 1,
      countZ: 1,
    },
    initialBounds: { min: [-10, -17, -10], max: [10, 4, 10] },
    trackRoot: track,
    columns: [[track]],
    additionalActors: null,
    nonTrackActors: nontrack,
    blackMaterial: material,
    resources: new Map([[resource, resource]]),
    actorObjects: new Map([
      [track, host],
      [prop, template],
      [one, oneObject],
      [two, twoObject],
    ]),
    faceActors: new Map([
      [track, host],
      [prop, template],
      [one, oneObject],
      [two, twoObject],
    ]),
    meshes: new Map([[prop, mesh]]),
    initialGeometries: new Map([[prop, geometry]]),
    actors: state.actors,
    noncars: [prop],
    findModelResource: (name) => (name === model.name ? resource : undefined),
    findMaterialSource: (name) =>
      name === material.name ? material : undefined,
  };
  return {
    root,
    scene,
    template,
    prop,
    resource,
    model,
    world: new WorldCollision(root, undefined, undefined, scene),
  };
}
const owner = () => ({
  state: {
    position: new Vector3(),
    orientation: new Quaternion(),
    velocity: new Vector3(),
    angularVelocity: new Vector3(),
  },
  properties: {
    mass: 1,
    inertia: new Vector3(1, 1, 1),
    centerOfMass: new Vector3(),
    worldFriction: 1,
    immovable: true,
  },
});
const query = {
  bounds: new Box3(new Vector3(-2, -2, -2), new Vector3(2, 2, 2)),
  matrix: new Matrix4(),
};
function externalTemplate(model, localMaterial = null) {
  const group = new Group();
  group.name = "&01!bbbb.ACT";
  Object.assign(group.userData, {
    c2ActorType: 1,
    c2ActorRenderStyle: 4,
    c2ActorLocalModelName: model.name,
    c2ActorLocalMaterialName: localMaterial,
  });
  const mesh = new Mesh(
    createModelGeometry(model),
    new MeshBasicMaterial({ name: "road" }),
  );
  mesh.name = model.name;
  group.add(mesh);
  return group;
}

test("native-template clones borrow exact resources and preserve linked child order without changing template", () => {
  const f = fixture(),
    clone = f.template.clone(true);
  clone.name = "&01!0001.ACT";
  const count = f.scene.actors.length,
    resourceCount = f.scene.resources.size;
  assert.equal(f.world.retainNonCarClone(clone, f.template), true);
  const copy = f.world.getNonCarNativeActor(clone);
  assert.notEqual(copy, f.prop);
  assert.equal(copy.localModel.value, f.resource);
  assert.equal(copy.parent, f.scene.nonTrackActors);
  assert.equal(f.prop.parent, f.scene.trackRoot);
  const names = [];
  enumerateNativeActorChildren(copy, (c) => {
    names.push(c.name);
    return 0;
  });
  assert.deepEqual(names, ["two", "one"]);
  assert.equal(f.scene.actors.length, count + 3);
  assert.equal(f.scene.resources.size, resourceCount);
  assert.equal(f.world.retainNonCarClone(clone, f.template), true);
  assert.equal(f.scene.actors.length, count + 3);
  assert.equal(f.world.getNonCarModelBounds(clone).max.x, 9);
});

test("external authored ACT resolves current exact registry resource despite same rendered MODEL name", () => {
  const f = fixture();
  const different = { ...f.model, positions: f.model.positions.slice() };
  different.positions[9] = 21;
  const newer = createNativeTrackModelResource(
    different,
    () => known(material),
    4,
  ).value;
  assert.ok(prepareNativeTrackResource(newer).resolved);
  f.scene.resources.set(newer, newer);
  f.scene.findModelResource = () => newer;
  const template = externalTemplate(different, "road"),
    clone = template.clone(true);
  assert.equal(f.world.retainNonCarClone(clone, template), true);
  const copy = f.world.getNonCarNativeActor(clone);
  assert.equal(copy.localModel.value, newer);
  assert.equal(copy.localMaterial.value, material);
  assert.equal(f.prop.localModel.value, f.resource);
  assert.equal(f.world.getNonCarModelBounds(clone).max.x, 21);
});

test("clone return outside Three track root restores static triangles and finite native repull", () => {
  const f = fixture(),
    template = externalTemplate(f.model),
    clone = template.clone(true),
    body = owner();
  clone.name = "&01!0001.ACT";
  const debrisHost = new Group();
  debrisHost.add(clone);
  clone.userData.dynamicBody = true;
  f.world.syncDiagnostics = {
    staticRebuilds: 0,
    staticOrderRebuilds: 0,
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
  };
  assert.equal(f.world.retainNonCarClone(clone, template), true);
  f.world.setNonCarParticipation(body, clone, true);
  assert.equal(f.world.syncDiagnostics.staticRebuilds, 0);
  assert.equal(f.world.syncDiagnostics.staticOrderRebuilds, 0);
  assert.equal(f.world.collectFaces(query, 30).length, 1);
  f.world.setNonCarParticipation(body, clone, false);
  const faces = f.world.collectFaces(query, 30);
  assert.equal(faces.length, 2);
  const cloneFace = faces.find(
    (face) => face.native.actor === f.world.getNonCarNativeActor(clone),
  );
  assert.equal(cloneFace.actor, clone.children[0]);
  assert.equal(cloneFace.owner, undefined);
  assert.equal(cloneFace.faceIndex, 0);
  assert.equal(
    f.world.querySurfaces(query.bounds.min, query.bounds.max).length,
    2,
  );
  f.world.rebuildStatic();
  assert.equal(
    f.world.querySurfaces(query.bounds.min, query.bounds.max).length,
    2,
  );
  const retained = f.scene.actors.length;
  const after = f.world.collectFaces(query, 30, true, {
    pullActorFromWorld: (object) => {
      if (object !== clone) return null;
      f.world.setNonCarParticipation(body, clone, true);
      return body;
    },
  });
  assert.equal(after.length, 1);
  assert.equal(f.scene.actors.length, retained);
  assert.equal(
    f.world.getNonCarNativeActor(clone).parent,
    f.scene.nonTrackActors,
  );
});

test("failed clone cleanup removes only copied ACT/index ownership and retains borrowed resources", () => {
  const f = fixture(),
    template = externalTemplate(f.model),
    originalCount = f.scene.actors.length;
  const clone = template.clone(true);
  clone.name = "&01!0001.ACT";
  const body = owner();
  new Group().add(clone);
  assert.equal(f.world.retainNonCarClone(clone, template), true);
  const copy = f.world.getNonCarNativeActor(clone),
    geometry = clone.children[0].geometry;
  let disposed = false;
  geometry.addEventListener("dispose", () => {
    disposed = true;
  });
  f.world.setNonCarParticipation(body, clone, true);
  f.world.setNonCarParticipation(body, clone, false);
  assert.equal(
    f.world.querySurfaces(query.bounds.min, query.bounds.max).length,
    2,
  );
  assert.equal(f.world.discardNonCarClone(clone), true);
  assert.equal(f.world.getNonCarNativeActor(clone), null);
  assert.equal(f.scene.actors.length, originalCount);
  for (const map of [
    f.scene.actorObjects,
    f.scene.faceActors,
    f.scene.meshes,
    f.scene.initialGeometries,
  ])
    assert.equal(map.has(copy), false);
  assert.equal(
    f.world.querySurfaces(query.bounds.min, query.bounds.max).length,
    1,
  );
  assert.equal(f.world.collectFaces(query, 30).length, 1);
  assert.equal(f.scene.resources.get(f.resource), f.resource);
  assert.equal(disposed, false);
  assert.equal(f.world.discardNonCarClone(f.template), false);
  assert.equal(f.prop.parent, f.scene.trackRoot);
  assert.equal(f.world.discardNonCarClone(clone), false);
  const next = template.clone(true);
  assert.equal(f.world.retainNonCarClone(next, template), true);
  assert.notEqual(f.world.getNonCarNativeActor(next).id, copy.id);
});

test("unsupported external providers return false before publishing actors or false resource bindings", () => {
  const f = fixture(),
    template = externalTemplate(f.model, "road"),
    count = f.scene.actors.length;
  delete f.scene.findMaterialSource;
  assert.equal(
    f.world.retainNonCarClone(template.clone(true), template),
    false,
  );
  assert.equal(f.scene.actors.length, count);
  f.scene.findMaterialSource = () => material;
  f.scene.findModelResource = () => undefined;
  assert.equal(
    f.world.retainNonCarClone(template.clone(true), template),
    false,
  );
  assert.equal(f.scene.actors.length, count);
  f.scene.findModelResource = () => {
    throw new Error("Native template MODEL preparation provider unavailable");
  };
  assert.equal(
    f.world.retainNonCarClone(template.clone(true), template),
    false,
  );
  assert.equal(f.scene.actors.length, count);
});
