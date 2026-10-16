import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { WorldCollision } from "../src/world.ts";
import { DEFAULT_SURFACE } from "../src/physics/surfaces.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function triangle() {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([-2, 0, -2, 0, 0, 2, 2, 0, -2], 3),
  );
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.name = "ROAD";
  return new Mesh(geometry, material);
}
function body() {
  return {
    state: {
      position: v(),
      orientation: new Quaternion(),
      velocity: v(),
      angularVelocity: v(),
      predictedPosition: v(),
      predictedOrientation: new Quaternion(),
    },
    properties: {
      mass: 1,
      inertia: v(1, 1, 1),
      centerOfMass: v(),
      worldFriction: 1,
    },
  };
}
function fixture() {
  const root = new Group(),
    mesh = triangle(),
    modifiers = [{ ...DEFAULT_SURFACE }];
  root.add(mesh);
  return { root, mesh, modifiers, world: new WorldCollision(root, modifiers) };
}
function query(world, local = false) {
  return local
    ? world.queryLocalSurfaces(v(-10, -10, -10), v(10, 10, 10))
    : world.querySurfaces(v(-10, -10, -10), v(10, 10, 10));
}
const ownerless = (surfaces) => surfaces.filter((surface) => !surface.owner);

test("ownerless revision survives moving-owner translation rotation and geometry refresh", () => {
  const { root, world } = fixture(),
    owner = body(),
    actor = triangle();
  // Dynamic geometry is a separate source; static cell snapshots are retained.
  root.add(actor);
  world.addDynamic(owner, actor, true, true);
  const revision = world.getOwnerlessGuardRevision(),
    staticFaces = ownerless(query(world));
  assert.ok(revision);
  assert.equal(world.getStaticGuardRevision(), undefined);
  assert.equal(staticFaces.length, 1);
  assert.equal(query(world).filter((face) => face.owner === owner).length, 1);
  for (const mutate of [
    () => {
      actor.position.set(2, 1, 0);
      owner.state.position.copy(actor.position);
      owner.state.predictedPosition.copy(actor.position);
    },
    () => {
      actor.quaternion.setFromAxisAngle(v(0, 0, 1), 0.5);
      owner.state.orientation.copy(actor.quaternion);
      owner.state.predictedOrientation.copy(actor.quaternion);
    },
    () => {
      const positions = actor.geometry.getAttribute("position");
      positions.setX(0, -3);
      positions.needsUpdate = true;
    },
  ]) {
    const priorDynamic = query(world).find((face) => face.owner === owner);
    mutate();
    world.refreshDynamic(owner);
    assert.equal(world.getOwnerlessGuardRevision(), revision);
    assert.equal(world.getStaticGuardRevision(), undefined);
    for (const local of [false, true]) {
      const faces = query(world, local);
      assert.deepEqual(ownerless(faces), staticFaces);
      assert.ok(faces.some((face) => face.owner === owner));
      assert.notEqual(
        faces.find((face) => face.owner === owner),
        priorDynamic,
        "changed dynamic snapshots are replaced and remain owner tagged",
      );
    }
  }
});

test("ownerless revision follows activation removal ACT invalidation rebuild and friction", () => {
  const { root, mesh, modifiers, world } = fixture();
  let revision = world.getOwnerlessGuardRevision();
  const changes = [
    () => {
      mesh.position.y = 1;
      world.invalidateActors([mesh]);
    },
    () => world.rebuildStatic(),
    () => (modifiers[0].wallFriction += 0.25),
    () => modifiers.push({ ...DEFAULT_SURFACE }),
  ];
  for (const change of changes) {
    change();
    const next = world.getOwnerlessGuardRevision();
    assert.notEqual(next, revision);
    assert.equal(next, world.getStaticGuardRevision());
    revision = next;
  }
  const dormant = triangle(),
    owner = body();
  root.add(dormant);
  world.invalidateActors([dormant]);
  const dormantFaces = ownerless(query(world));
  assert.equal(dormantFaces.length, 2);
  revision = world.getOwnerlessGuardRevision();
  world.setNonCarParticipation(owner, dormant, true);
  assert.notEqual(world.getOwnerlessGuardRevision(), revision);
  assert.equal(ownerless(query(world)).length, 1);
  revision = world.getOwnerlessGuardRevision();
  world.setNonCarParticipation(owner, dormant, false);
  assert.notEqual(world.getOwnerlessGuardRevision(), revision);
  assert.equal(ownerless(query(world)).length, 2);
  // Direct world-collider membership also preserves the legacy API's rejection.
  revision = world.getOwnerlessGuardRevision();
  world.addDynamic(owner, dormant, true, true);
  assert.notEqual(world.getOwnerlessGuardRevision(), revision);
  assert.equal(world.getStaticGuardRevision(), undefined);
  revision = world.getOwnerlessGuardRevision();
  world.removeDynamic(owner);
  assert.notEqual(world.getOwnerlessGuardRevision(), revision);
  assert.equal(
    world.getStaticGuardRevision(),
    world.getOwnerlessGuardRevision(),
  );
});

test("ownerless and legacy revisions reject uncertified query and modifier providers", () => {
  for (const method of ["querySurfaces", "queryLocalSurfaces", "modifier"]) {
    const { world } = fixture(),
      original = world[method],
      revision = world.getOwnerlessGuardRevision();
    world[method] = (...args) => original.apply(world, args);
    assert.equal(world.getOwnerlessGuardRevision(), undefined);
    assert.equal(world.getStaticGuardRevision(), undefined);
    world[method] = original;
    assert.equal(world.getOwnerlessGuardRevision(), revision);
    assert.equal(world.getStaticGuardRevision(), revision);
  }
});
