import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { WorldCollision } from "../src/world.ts";

const box = (x = 0, y = 0, z = 0, radius = 0.1) =>
  new THREE.Box3(
    new THREE.Vector3(x - radius, y - radius, z - radius),
    new THREE.Vector3(x + radius, y + radius, z + radius),
  );
function fixture(t, points = [-1, 0, -1, 1, 0, -1, 0, 0, 1]) {
  const root = new THREE.Group();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  root.add(mesh);
  const world = new WorldCollision(root);
  t.after(() => {
    geometry.dispose();
    material.dispose();
  });
  return { root, mesh, geometry, world };
}

test("ownerless clearance proves empty and far-space bounds, retaining overlaps and crossing paths", (t) => {
  const empty = new WorldCollision(new THREE.Group());
  assert.equal(empty.ownerlessGuardBoundsClear(box()), true);
  const { world } = fixture(t);
  assert.equal(world.ownerlessGuardBoundsClear(box(1e6, 8e5, -3e5)), true);
  assert.equal(world.ownerlessGuardBoundsClear(box()), false);
  assert.equal(world.ownerlessGuardBoundsClear(box(0, 1, 0)), true);
  const crossing = box(-1000).union(box(1000));
  assert.equal(world.ownerlessGuardBoundsClear(crossing), false);
  assert.equal(world.ownerlessGuardBoundsClear(box()), false);
});

test("ownerless clearance includes unindexed large triangles and never trusts a capped grid miss", (t) => {
  const { world } = fixture(t, [-1000, 0, -1000, 1000, 0, -1000, 0, 0, 1000]);
  assert.equal(world.triangles, 0, "The legacy grid omits this large triangle");
  assert.deepEqual(world.querySurfaces(box().min, box().max), []);
  assert.equal(world.ownerlessGuardBoundsClear(box()), false);
  const broad = box(0, 0, 0, 2000);
  assert.deepEqual(world.querySurfaces(broad.min, broad.max), []);
  assert.equal(world.ownerlessGuardBoundsClear(broad), false);
  assert.equal(world.ownerlessGuardBoundsClear(box(0, 100, 0)), true);
});

test("ownerless clearance encloses publications monotonically until a static rebuild", (t) => {
  const { root, mesh, geometry, world } = fixture(t);
  assert.equal(world.ownerlessGuardBoundsClear(box(100)), true);
  mesh.position.x = 100;
  world.invalidateActors([mesh]);
  assert.equal(world.ownerlessGuardBoundsClear(box(100)), false);
  assert.equal(world.ownerlessGuardBoundsClear(box()), false);
  const positions = geometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) positions.setY(i, 20);
  positions.needsUpdate = true;
  world.invalidateActors([mesh]);
  assert.equal(world.ownerlessGuardBoundsClear(box(100)), false);
  assert.equal(world.ownerlessGuardBoundsClear(box(100, 20)), false);
  root.remove(mesh);
  world.rebuildStatic();
  assert.equal(world.ownerlessGuardBoundsClear(box(100, 20)), true);
  root.add(mesh);
  world.rebuildStatic();
  assert.equal(world.ownerlessGuardBoundsClear(box(100, 20)), false);
});

test("ownerless clearance excludes moving owner faces while ownerless movement still invalidates", (t) => {
  const { mesh, world } = fixture(t);
  assert.equal(world.ownerlessGuardBoundsClear(box()), false);
  const body = {
    properties: {
      mass: 1,
      inertia: new THREE.Vector3(1, 1, 1),
      centerOfMass: new THREE.Vector3(),
    },
    state: {
      position: new THREE.Vector3(),
      orientation: new THREE.Quaternion(),
      velocity: new THREE.Vector3(),
      angularVelocity: new THREE.Vector3(),
    },
  };
  mesh.userData.dynamicBody = body;
  world.addDynamic(body, mesh, true, true);
  world.invalidateActors([mesh]);
  assert.ok(
    world.querySurfaces(box().min, box().max).some((s) => s.owner === body),
  );
  assert.equal(
    world.ownerlessGuardBoundsClear(box()),
    false,
    "Former static geometry conservatively remains until rebuild",
  );
  world.rebuildStatic();
  assert.equal(world.ownerlessGuardBoundsClear(box()), true);
  world.removeDynamic(body);
  delete mesh.userData.dynamicBody;
  mesh.position.y = 10;
  world.invalidateActors([mesh]);
  assert.equal(world.ownerlessGuardBoundsClear(box()), true);
  assert.equal(world.ownerlessGuardBoundsClear(box(0, 10)), false);
});

test("ownerless clearance requires finite ordered bounds and a certified provider", (t) => {
  const { world } = fixture(t);
  for (const bounds of [
    new THREE.Box3(),
    new THREE.Box3(new THREE.Vector3(1, 1, 1), new THREE.Vector3()),
    new THREE.Box3(new THREE.Vector3(NaN, 0, 0), new THREE.Vector3(1, 1, 1)),
    new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(Infinity, 1, 1)),
  ])
    assert.equal(world.ownerlessGuardBoundsClear(bounds), false);
  assert.equal(world.ownerlessGuardBoundsClear(box(100)), true);
  const original = world.querySurfaces;
  world.querySurfaces = () => [];
  assert.equal(world.ownerlessGuardBoundsClear(box(100)), false);
  world.querySurfaces = original;
  assert.equal(world.ownerlessGuardBoundsClear(box(100)), true);
});

test("a nonfinite authoritative surface snapshot cannot certify clearance", (t) => {
  const { mesh, world } = fixture(t);
  // Exercise the same per-face publication outlet as static geometry writers.
  const source = world.staticOwners.get(mesh).surfaces[0];
  world.indexSurface({ ...source, a: new THREE.Vector3(NaN, 0, 0) });
  assert.equal(world.ownerlessGuardBoundsClear(box(100)), false);
  assert.equal(world.ownerlessGuardBoundsClear(box(100)), false);
  world.invalidateActors([mesh]);
  assert.equal(
    world.ownerlessGuardBoundsClear(box(100)),
    false,
    "Nonfinite publication invalidates clearance until a complete rebuild",
  );
  world.rebuildStatic();
  assert.equal(world.ownerlessGuardBoundsClear(box(100)), true);
});

test("ownerless clearance never scans static owners across mutation or guard revisions", (t) => {
  const { mesh, world } = fixture(t);
  let scans = 0;
  const original = world.staticOwners.values;
  world.staticOwners.values = function () {
    scans++;
    return original.call(this);
  };
  assert.equal(world.ownerlessGuardBoundsClear(box(1000)), true);
  const revision = world.getOwnerlessGuardRevision();
  mesh.position.x = 10;
  world.invalidateActors([mesh]);
  assert.notEqual(world.getOwnerlessGuardRevision(), revision);
  assert.equal(world.ownerlessGuardBoundsClear(box(1000)), true);
  world.staticGuardRevision = {};
  assert.equal(world.ownerlessGuardBoundsClear(box(1000)), true);
  assert.equal(scans, 0);
});
