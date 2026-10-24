import test from "node:test";
import assert from "node:assert/strict";
import {
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Vector3,
} from "three";
import { DamageSystem } from "../src/damage.ts";
import { WorldCollision } from "../src/world.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { buildBoxHull } from "../src/physics/box-hull.ts";

function makeMechanics(index = 7) {
  return parseNonCarMechanics(
    `101\n${index}\n0,0,0\n0,0,0\n1\nbox\n-.5,-.5,-.5\n.5,.5,.5\n.1,.1\n1,1,1\n0\n0\n0\nEND`,
  );
}

function worldFixture({ floor = true } = {}) {
  const root = new Group();
  if (floor) {
    const mesh = new Mesh(
      new BoxGeometry(200, 1, 200),
      new MeshBasicMaterial(),
    );
    mesh.position.y = -0.5;
    root.add(mesh);
  }
  const world = new WorldCollision(root);
  return { root, world, simulation: new VehicleSimulation(world, root) };
}

function addProp(fixture, name, position = [0, 1, 0], index = 7) {
  const actor = new Group();
  actor.name = name;
  actor.position.fromArray(position);
  actor.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  fixture.root.add(actor);
  const body = createNonCarBody(actor, makeMechanics(index));
  fixture.simulation.addNonCar(body);
  assert.equal(fixture.simulation.admitNonCar(body, { wake: true }), true);
  return body;
}

test("escaped free noncar retires every physics owner while retaining its source identity", () => {
  const f = worldFixture(),
    body = addProp(f, "&07!0001.ACT");
  const originalPosition = body.originalPosition.clone();
  assert.ok(f.world.escapeBounds);
  assert.ok(f.world.dynamic.has(body));
  assert.ok(f.simulation.nonCarSlots.get(body));

  // Seed the caches and cross-frame owners the retirement path must unlink.
  const faceState = f.simulation.worldFaceCache.createState();
  faceState.bounds.setFromCenterAndSize(new Vector3(), new Vector3(1, 1, 1));
  f.simulation.worldFaceStates.set(body, faceState);
  assert.ok(f.simulation.worldFaceStates.has(body));
  f.simulation.contactSurfaces.set(body, [{}]);
  f.simulation.pedContactRings.set(body, new Set([body]));
  f.simulation.cameraContacts.step([
    { a: body, b: null, solverAccepted: true, sourceType: 1 },
  ]);
  f.simulation.cameraContacts.finish(20, 0);
  f.simulation.cameraContacts.begin();
  assert.ok(f.simulation.cameraContacts.bodies.has(body));
  f.simulation.hierarchyQuiet.retain(
    body,
    new Box3().setFromPoints(body.hulls[0].vertices),
  );

  body.state.position.set(100_000, 1, 0);
  body.state.velocity.set(10_000, 0, 0);
  body.state.angularVelocity.set(0, 90_000, 0);
  assert.equal(f.simulation.containEscapedBodies(), 1);

  assert.equal(f.simulation.isNonCarPhysicsActive(body), false);
  assert.equal(f.simulation.phil.getHeader(body), null);
  assert.equal(f.simulation.nonCarSlots.get(body), null);
  assert.equal(f.world.dynamic.has(body), false);
  assert.equal(f.simulation.admittedNoncars.has(body), false);
  assert.equal(f.simulation.noncarQuiet.has(body), false);
  assert.equal(f.simulation.initialNoncarSleep.has(body), false);
  assert.equal(f.simulation.hierarchyQuiet.get(body), null);
  assert.equal(f.simulation.contactSurfaces.has(body), false);
  assert.equal(f.simulation.worldFaceStates.has(body), false);
  assert.equal(f.simulation.pedContactRings.has(body), false);
  assert.equal(f.simulation.cameraContacts.bodies.has(body), false);
  f.simulation.cameraContacts.begin();
  assert.equal(f.simulation.cameraContacts.bodies.has(body), false);
  assert.equal(f.simulation.noncarsByActor.get(body.actor), body);
  assert.ok(f.simulation.noncars.includes(body));
  assert.equal(body.actor.userData.c2ActorTypeData, undefined);
  assert.equal(body.actor.userData.noncarPulled, false);
  assert.equal(body.actor.userData.physicsEscaped, true);
  assert.equal(body.actor.userData.worldSmashDisabled, true);
  assert.equal(body.actor.visible, false);
  assert.deepEqual(body.state.position.toArray(), originalPosition.toArray());
  assert.equal(f.simulation.admitNonCar(body, { wake: true }), false);
});

test("fast in-world, high-flying, attached and jointed parent/child props stay active", () => {
  const f = worldFixture(),
    fast = addProp(f, "&07!0001.ACT", [0, 1, 0], 7),
    high = addProp(f, "&08!0002.ACT", [0, 1, 0], 8),
    attached = addProp(f, "&09!0003.ACT", [0, 1, 0], 9),
    parent = addProp(f, "&10!0004.ACT", [0, 1, 0], 10),
    child = addProp(f, "&11!0005.ACT", [0, 1, 0], 11);
  fast.state.velocity.set(1e8, 0, 0);
  fast.state.angularVelocity.set(0, 1e8, 0);
  high.state.position.y = 1e6;
  attached.attached = true;
  parent.state.position.x = 100_000;
  child.state.position.x = 100_000;
  child.joint = { parent };

  assert.equal(f.simulation.containEscapedBodies(), 0);
  for (const body of [fast, high, attached, parent, child]) {
    assert.equal(f.simulation.isNonCarPhysicsActive(body), true);
    assert.ok(f.simulation.phil.getHeader(body));
    assert.ok(f.simulation.nonCarSlots.get(body));
    assert.equal(body.actor.visible, true);
  }
});

test("without authored world bounds containment is a no-op", () => {
  const f = worldFixture({ floor: false }),
    body = addProp(f, "&07!0001.ACT", [1e9, 1e9, 1e9]);
  assert.equal(f.world.escapeBounds, null);
  assert.equal(f.simulation.containEscapedBodies(), 0);
  assert.equal(f.simulation.isNonCarPhysicsActive(body), true);
});

test("retired loose car part keeps its actor and DamageSystem repair restores ownership", async () => {
  const f = worldFixture();
  const actor = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
  actor.name = "BODY.DAT";
  const carGroup = new Group();
  carGroup.name = "TEST";
  carGroup.add(actor);
  f.root.add(carGroup);
  const wam = [
    "VERSION 4",
    "1",
    "0.1",
    "1",
    "-0.1",
    "0",
    "0",
    "1",
    "0.25",
    "1",
    "-0.25",
    "1",
    "-0.05",
    "0.15",
    "1",
    "0",
    "0,0.16,0.05",
    "1",
    "BODY.DAT",
    "normal",
    "boring",
    "0",
  ].join("\n");
  const assets = {
    manifest: [{ path: "data/CARS/TEST/TEST.WAM" }],
    textures: new Map(),
    warnings: [],
    resolve: (name) =>
      name.toLowerCase() === "data/cars/test/test.wam"
        ? "data/CARS/TEST/TEST.WAM"
        : undefined,
    text: async () => wam,
  };
  const damage = new DamageSystem(assets, carGroup, "TEST.TXT\nTEST.WAM");
  await damage.init();
  const part = damage.runtimeParts[0];
  assert.ok(part);
  const originalPosition = actor.position.clone();
  part.state.phase = 2;
  f.root.add(actor);
  actor.position.set(100_000, 1, 0);
  const detached = {
    actor,
    owner: { damage },
    part: 0,
    state: {
      position: new Vector3(100_000, 1, 0),
      orientation: actor.quaternion.clone(),
      velocity: new Vector3(1, 0, 0),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: 1,
      inertia: new Vector3(1, 1, 1),
      centerOfMass: new Vector3(),
      worldFriction: 0,
    },
    hulls: [
      buildBoxHull(new Vector3(-0.5, -0.5, -0.5), new Vector3(0.5, 0.5, 0.5)),
    ],
  };
  f.simulation.debris.push(detached);
  const split = {
    ...detached,
    actor: new Group(),
    part: -1,
    state: { ...detached.state, position: new Vector3(100_000, 1, 0) },
  };
  split.actor.visible = true;
  f.root.add(split.actor);
  f.simulation.debris.push(split);

  assert.equal(f.simulation.containEscapedBodies(), 1);
  assert.equal(f.simulation.debris.includes(detached), false);
  assert.equal(actor.parent, null);
  assert.equal(actor.visible, true);
  assert.ok(f.simulation.debris.includes(split), "split secondary is retained");
  assert.equal(split.actor.parent, f.root);

  damage.repair();
  assert.equal(actor.parent, carGroup);
  assert.equal(part.state.phase, 0);
  assert.deepEqual(actor.position.toArray(), originalPosition.toArray());
  // Repair can run before the next ordinary physics roster cleanup. A stale
  // escaped body must not detach the now-restored model actor again.
  f.simulation.debris.push(detached);
  assert.equal(f.simulation.containEscapedBodies(), 0);
  assert.equal(actor.parent, carGroup);
  assert.equal(part.state.phase, 0);
});
