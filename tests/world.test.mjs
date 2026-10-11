import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { WorldCollision, batchStaticWorld } from "../src/world.ts";
import { captureWorldSource } from "../src/world-source.ts";
function mesh(points, material = new THREE.MeshBasicMaterial()) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, material);
}
test("pre-batch source collision retains original actors, mirrored face flags and live rebuilds", () => {
  const root = new THREE.Group();
  root.name = "PP01 1 1 1 3";
  const tile = new THREE.Group();
  tile.name = "0 0";
  root.add(tile);
  const staticActor = new THREE.Group();
  staticActor.name = "static-original";
  const mirrored = mesh([-2, 0, -2, -2, 0, 2, 2, 0, 2]);
  mirrored.scale.x = -1;
  mirrored.geometry.userData.sourceFaceFlags = [1];
  staticActor.add(mirrored);
  tile.add(staticActor);
  const retainedActor = new THREE.Group();
  retainedActor.name = "moving-original";
  retainedActor.position.set(5, 1, 0);
  const moving = mesh([-2, 0, -2, -2, 0, 2, 2, 0, 2]);
  retainedActor.add(moving);
  tile.add(retainedActor);

  const source = captureWorldSource(root);
  const rendered = batchStaticWorld(root, [retainedActor]);
  const world = new WorldCollision(rendered, undefined, source);
  const faces = world.querySurfaces(
    new THREE.Vector3(-3, -1, -3),
    new THREE.Vector3(8, 2, 3),
  );
  assert.equal(faces.length, 2);
  const floor = faces.find((face) => face.actor === mirrored);
  assert.ok(floor);
  assert.equal(floor.normal.y, 1);
  assert.equal(floor.faceFlags, 4);
  assert.equal(floor.source.actor, staticActor);
  assert.equal(floor.source.renderTriangleIndex, 0);
  assert.equal(floor.source.preparedGroupIndex, null);
  assert.equal(world.height(0, 0, 0.1), 0);
  assert.equal(world.height(5, 0, 1.1), 1);

  const additional = mesh([-2, 0, -2, -2, 0, 2, 2, 0, 2]);
  additional.position.set(10, 3, 0);
  additional.name = "late-loaded-door";
  rendered.add(additional);
  world.rebuildStatic();
  assert.equal(
    world.triangles,
    3,
    "late-loaded actors join original source meshes without GPU-batch duplicates",
  );
  assert.equal(world.height(10, 0, 3.1), 3);
  const lateFace = world
    .querySurfaces(new THREE.Vector3(8, 2, -3), new THREE.Vector3(12, 4, 3))
    .find((face) => face.actor === additional);
  assert.ok(lateFace);
  assert.equal(
    lateFace.source,
    undefined,
    "late ACT identity is distinct from the initial snapshot",
  );

  retainedActor.position.y = 2;
  world.rebuildStatic();
  assert.equal(
    world.height(5, 0, 2.1),
    2,
    "retained live actor updates after batching",
  );
  staticActor.userData.worldSmashDisabled = true;
  world.rebuildStatic();
  assert.equal(world.height(0, 0, 0.1), null);
  retainedActor.userData.dynamicBody = true;
  additional.userData.worldSmashDisabled = true;
  world.rebuildStatic();
  assert.equal(
    world.triangles,
    0,
    "dynamic actors leave static source collection",
  );
});
test("world ground query retains actor transforms, separates decks, and rejects gaps", () => {
  const group = new THREE.Group();
  const floor = mesh([0, 0, 0, 2, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 2]);
  floor.position.set(3, 2, 5);
  group.add(floor);
  const ceiling = floor.clone();
  ceiling.position.y = 4;
  group.add(ceiling);
  const world = new WorldCollision(group);
  assert.equal(world.height(4, 6, 2.1), 2);
  assert.equal(world.height(4, 6, 4.1), 4);
  assert.equal(world.height(-10, 6, 4), null);
});
test("wall sweeps prevent fast tunnelling from both directions and respect height", () => {
  const group = new THREE.Group();
  group.add(mesh([1, 0, -2, 1, 2, -2, 1, 2, 2, 1, 0, -2, 1, 2, 2, 1, 0, 2]));
  const world = new WorldCollision(group);
  for (const [from, to, normal] of [
    [0, 2, -1],
    [2, 0, 1],
  ]) {
    const hit = world.sweep(
      new THREE.Vector3(from, 0.1, 0),
      new THREE.Vector3(to, 0.1, 0),
      0.2,
    );
    assert.ok(hit);
    assert.ok(Math.abs(hit.fraction - 0.4) < 0.005);
    assert.equal(Math.sign(hit.normal.x), normal);
  }
  assert.equal(
    world.sweep(new THREE.Vector3(0, 5, 0), new THREE.Vector3(2, 5, 0), 0.2),
    null,
  );
});
test("static batching preserves transformed triangles and combines matching materials", () => {
  const group = new THREE.Group(),
    mat = new THREE.MeshBasicMaterial();
  for (let x = 0; x < 4; x++) {
    const m = mesh([0, 0, 0, 1, 0, 1, 1, 0, 0], mat);
    m.position.x = x;
    group.add(m);
  }
  const batch = batchStaticWorld(group);
  assert.equal(batch.children.length, 1);
  assert.equal(batch.children[0].geometry.getAttribute("position").count, 12);
  const collision = new WorldCollision(batch);
  assert.equal(collision.height(3.8, 0.2, 0.1), 0);
});
test("low downward-facing ceilings do not become ground and mirrored actors retain upward floors", () => {
  const group = new THREE.Group();
  group.add(mesh([-2, 0, -2, -2, 0, 2, 2, 0, 2, -2, 0, -2, 2, 0, 2, 2, 0, -2]));
  group.add(
    mesh([
      -2, 0.3, -2, 2, 0.3, 2, -2, 0.3, 2, -2, 0.3, -2, 2, 0.3, -2, 2, 0.3, 2,
    ]),
  );
  const world = new WorldCollision(group);
  assert.equal(world.height(0, 0, 0.05), 0);
  const floor = new THREE.Group();
  const mirrored = mesh([-2, 0, -2, -2, 0, 2, 2, 0, 2]);
  mirrored.scale.x = -1;
  floor.add(mirrored);
  const batch = batchStaticWorld(floor);
  assert.equal(new WorldCollision(batch).height(0, 0, 0.05), 0);
});
test("wall collision does not extend beyond the geometric edge", () => {
  const group = new THREE.Group();
  group.add(mesh([1, 0, -2, 1, 2, -2, 1, 2, 2, 1, 0, -2, 1, 2, 2, 1, 0, 2]));
  const world = new WorldCollision(group);
  assert.equal(
    world.sweep(
      new THREE.Vector3(0, 0.1, 2.3),
      new THREE.Vector3(2, 0.1, 2.3),
      0.2,
    ),
    null,
  );
  assert.ok(
    world.sweep(
      new THREE.Vector3(0, 0.1, 1.9),
      new THREE.Vector3(2, 0.1, 1.9),
      0.2,
    ),
  );
});

test("static material batching preserves original COPLANAR edge flags after index regrouping and mirrored winding", () => {
  const source = new THREE.Group();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [0, 0, 0, 0, 0, 1, 1, 0, 0, 2, 0, 0, 2, 0, 1, 3, 0, 0],
      3,
    ),
  );
  geo.setIndex([3, 4, 5, 0, 1, 2]);
  geo.addGroup(0, 3, 0);
  geo.addGroup(3, 3, 1);
  geo.userData.sourceFaces = [{ flags: 1 }, { flags: 4 }];
  geo.computeVertexNormals();
  const materials = [
    new THREE.MeshBasicMaterial(),
    new THREE.MeshBasicMaterial(),
  ];
  const actor = new THREE.Mesh(geo, materials);
  actor.scale.x = -1;
  source.add(actor);
  const batch = batchStaticWorld(source);
  assert.deepEqual(
    batch.children.map((m) => [...m.geometry.userData.sourceFaceFlags]),
    [[1], [4]],
    "Mirroring exchanges edge0/edge2 and material index order retains authored face",
  );
  const world = new WorldCollision(batch);
  const faces = world.querySurfaces(
    new THREE.Vector3(-4, -1, -1),
    new THREE.Vector3(1, 1, 2),
  );
  assert.deepEqual(faces.map((f) => f.faceFlags).sort(), [1, 4]);
});
test("native edge-only smash triangles remain body candidates but cannot support tyre rays", () => {
  const root = new THREE.Group(),
    mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  mat.name = "?broken";
  const floor = mesh(
    [-2, 0, -2, 2, 0, 2, 2, 0, -2, -2, 0, -2, -2, 0, 2, 2, 0, 2],
    mat,
  );
  root.add(floor);
  const world = new WorldCollision(root),
    origin = new THREE.Vector3(0, 1, 0),
    down = new THREE.Vector3(0, -1, 0);
  assert.equal(world.raycast(origin, down, 2), null);
  assert.equal(world.height(0, 0, 0.1), null);
  assert.equal(
    world.querySurfaces(
      new THREE.Vector3(-1, -1, -1),
      new THREE.Vector3(1, 1, 1),
    ).length,
    2,
  );
  assert.ok(
    world.raycast(origin, down, 2, true),
    "explicit non-solid probes preserve access",
  );
  mat.name = "GLASS";
  floor.geometry.userData.worldSmashFaceModes = ["edges", "edges"];
  world.rebuildStatic();
  assert.equal(world.raycast(origin, down, 2), null);
  assert.equal(world.height(0, 0, 0.1), null);
  assert.ok(
    world
      .querySurfaces(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1))
      .every((s) => s.collisionMode === "edges"),
  );
});
