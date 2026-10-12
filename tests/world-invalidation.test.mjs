import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferGeometry,
  Box3,
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

function triangle(x = 0, z = 0) {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([x - 1, 0, z, x + 1, 0, z, x, 0, z + 2], 3),
  );
  return geometry;
}

function body() {
  return {
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
      worldFriction: 0,
    },
    hulls: [],
  };
}

function mesh(name, x, z, material = new MeshBasicMaterial()) {
  const result = new Mesh(triangle(x, z), material);
  result.name = name;
  return result;
}

const bounds = (x, z) => [
  new Vector3(x - 1.1, -1, z - 0.1),
  new Vector3(x + 1.1, 1, z + 2.1),
];
const surfacesAt = (world, x, z) => world.querySurfaces(...bounds(x, z), true);
const vertices = (surface) =>
  [surface.a, surface.b, surface.c].map((point) => point.toArray());

test("targeted static invalidation moves one owner's triangles and retains other identities", () => {
  const root = new Group(),
    firstOwner = new Group(),
    secondOwner = new Group(),
    first = mesh("first", 0, 0),
    second = mesh("second", 20, 0);
  firstOwner.add(first);
  secondOwner.add(second);
  root.add(firstOwner, secondOwner);
  const world = new WorldCollision(root),
    oldFirst = surfacesAt(world, 0, 0)[0],
    untouched = surfacesAt(world, 20, 0)[0],
    priorSnapshot = vertices(oldFirst);

  firstOwner.position.x = 40;
  world.invalidateActors([firstOwner]);

  assert.equal(
    surfacesAt(world, 0, 0).some((surface) => surface.actor === first),
    false,
  );
  const moved = surfacesAt(world, 40, 0);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].actor, first);
  assert.equal(moved[0].a.x, 39);
  assert.equal(surfacesAt(world, 20, 0)[0], untouched);
  assert.deepEqual(
    vertices(oldFirst),
    priorSnapshot,
    "previous rows remain snapshots",
  );
});

test("targeted replacement removes detached siblings and appends new subtree surfaces in traversal order", () => {
  const root = new Group(),
    prop = new Group(),
    first = mesh("first", 0, 0),
    sibling = mesh("sibling", 8, 0),
    stableOwner = new Group(),
    stable = mesh("stable", 20, 0);
  prop.add(first, sibling);
  stableOwner.add(stable);
  root.add(prop, stableOwner);
  const world = new WorldCollision(root),
    stableSurface = surfacesAt(world, 20, 0)[0];

  prop.remove(first, sibling);
  const replacement = mesh("replacement", 32, 0),
    replacementTail = mesh("replacement-tail", 40, 0);
  prop.add(replacement, replacementTail);
  world.invalidateActors([prop]);

  assert.equal(surfacesAt(world, 0, 0).length, 0);
  assert.equal(surfacesAt(world, 8, 0).length, 0);
  assert.deepEqual(
    surfacesAt(world, 32, 0).map((surface) => surface.actor.name),
    ["replacement"],
  );
  assert.deepEqual(
    surfacesAt(world, 40, 0).map((surface) => surface.actor.name),
    ["replacement-tail"],
  );
  assert.equal(surfacesAt(world, 20, 0)[0], stableSurface);
});

test("targeted invalidation tracks passthrough removal, edge mode, and material-facing changes", () => {
  const root = new Group(),
    owner = new Group(),
    face = mesh("face", 0, 0);
  owner.add(face);
  root.add(owner);
  const world = new WorldCollision(root);

  face.geometry.userData.worldSmashFaceModes = ["passthrough"];
  face.material = new MeshBasicMaterial({ side: DoubleSide });
  world.invalidateActors([owner]);
  assert.equal(surfacesAt(world, 0, 0).length, 0);

  face.geometry.userData.worldSmashFaceModes = ["edges"];
  world.invalidateActors([owner]);
  const result = surfacesAt(world, 0, 0);
  assert.equal(result.length, 1);
  assert.equal(result[0].collisionMode, "edges");
  assert.equal(result[0].twoSided, true);

  owner.userData.worldSmashDisabled = true;
  world.invalidateActors([owner]);
  assert.equal(surfacesAt(world, 0, 0).length, 0);
  owner.userData.worldSmashDisabled = false;
  world.invalidateActors([owner]);
  assert.equal(surfacesAt(world, 0, 0).length, 1);
});

test("targeted cell ordering and collector prefixes match a fresh broad rebuild after geometry replacement", () => {
  const root = new Group(),
    firstOwner = new Group(),
    secondOwner = new Group(),
    first = mesh("first", 1, 1),
    second = mesh("second", 1.5, 1),
    third = mesh("third", 2, 1);
  firstOwner.add(first, third);
  secondOwner.add(second);
  root.add(firstOwner, secondOwner);
  const targeted = new WorldCollision(root),
    broad = new WorldCollision(root),
    queryBounds = new Box3(new Vector3(-2, -1, -1), new Vector3(4, 1, 4));
  const summary = (surface) => ({
    actor: surface.actor?.name,
    face: surface.faceIndex,
    a: surface.a.toArray(),
    b: surface.b.toArray(),
    c: surface.c.toArray(),
    mode: surface.collisionMode,
  });
  const queryRows = (world) => surfacesAt(world, 1, 1).map(summary);
  const collect = (world, capacity) =>
    world
      .collectFaces({ bounds: queryBounds, matrix: new Matrix4() }, capacity)
      .map(summary);

  assert.deepEqual(queryRows(targeted), queryRows(broad));
  for (const capacity of [1, 2])
    assert.deepEqual(collect(targeted, capacity), collect(broad, capacity));

  const replacement = triangle(1.25, 1);
  first.geometry = replacement;
  targeted.invalidateActors([firstOwner]);
  broad.rebuildStatic();

  assert.deepEqual(queryRows(targeted), queryRows(broad));
  for (const capacity of [1, 2])
    assert.deepEqual(collect(targeted, capacity), collect(broad, capacity));
});

test("a notified dynamic subtree refreshes only its owner and preserves returned rows", () => {
  const root = new Group(),
    affectedActor = new Group(),
    unaffectedActor = new Group(),
    affectedMesh = mesh("affected", 0, 0),
    unaffectedMesh = mesh("unaffected", 20, 0);
  affectedActor.add(affectedMesh);
  unaffectedActor.add(unaffectedMesh);
  root.add(affectedActor, unaffectedActor);
  affectedActor.userData.dynamicBody = true;
  unaffectedActor.userData.dynamicBody = true;
  const world = new WorldCollision(root),
    affected = body(),
    unaffected = body();
  world.addDynamic(affected, affectedActor);
  world.addDynamic(unaffected, unaffectedActor);
  const oldAffected = world.dynamic.get(affected).surfaces,
    retainedUnaffected = world.dynamic.get(unaffected).surfaces,
    oldVertices = vertices(oldAffected[0]);

  affectedMesh.geometry = triangle(4, 0);
  world.invalidateActors([affectedActor]);

  const refreshed = world.dynamic.get(affected).surfaces;
  assert.notEqual(refreshed, oldAffected);
  assert.equal(refreshed[0].a.x, 3);
  assert.equal(world.dynamic.get(unaffected).surfaces, retainedUnaffected);
  assert.deepEqual(vertices(oldAffected[0]), oldVertices);
});
