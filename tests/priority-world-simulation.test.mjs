import test from "node:test";
import assert from "node:assert/strict";
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  DoubleSide,
  Vector3,
} from "three";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { WorldCollision } from "../src/world.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { createMovingWorldBody } from "../src/physics/moving-world.ts";
import { WorldDestruction } from "../src/world-destruction.ts";
function prop(position = [0, 0.3, 0]) {
  const actor = new Group();
  actor.name = "&07c0001.ACT";
  actor.position.fromArray(position);
  const mechanics = parseNonCarMechanics(
    "101\n7\n0,0,0\n0,0,0\n1\nbox\n-.1,-.1,-.1\n.1,.1,.1\n.3,.3\n.2,.2,.2\n0\n0\n0\nEND",
  );
  const body = createNonCarBody(actor, mechanics);
  body.motor.sleeping = false;
  body.properties.immovable = false;
  return body;
}
function plane(horizontal = true) {
  const geo = new BufferGeometry();
  geo.setAttribute(
    "position",
    new Float32BufferAttribute(
      horizontal
        ? [-3, 0, -3, 3, 0, 3, 3, 0, -3, -3, 0, -3, -3, 0, 3, 3, 0, 3]
        : [0, -3, -3, 0, 3, 3, 0, 3, -3, 0, -3, -3, 0, -3, 3, 0, 3, 3],
      3,
    ),
  );
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.userData.c2Flags = 4096;
  return new Mesh(geo, material);
}
function emptyEffects() {
  return {
    sounds: [],
    shrapnel: [],
    explosions: [],
    slick: null,
    activations: [],
    sideEffects: [],
    extensionFlags: 0,
    roomCode: 0,
    award: { frequency: "none" },
    variableChanges: [],
  };
}
test("fixed-step moving world supplies owner velocity and finite platform faces", () => {
  const scene = new Group(),
    actor = new Group();
  actor.name = "platform";
  actor.add(plane());
  actor.userData.dynamicBody = true;
  scene.add(actor);
  const body = prop([0, 0.2, 0]);
  scene.add(body.actor);
  const world = new WorldCollision(scene),
    sim = new VehicleSimulation(world, scene);
  sim.addNonCar(body);
  assert.ok(sim.admitNonCar(body, { wake: true, resetVelocity: false }));
  const moving = createMovingWorldBody(actor);
  sim.addMovingWorld(moving);
  sim.grooves = {
    update: (time) => {
      actor.position.y = (time / 1000) * 2;
      actor.updateMatrixWorld(true);
    },
  };
  let hit = false;
  for (let i = 0; i < 10; i++) {
    sim.step();
    hit ||= sim.lastImpacts.some(
      (row) => row.b === moving && row.normalImpulse > 0,
    );
    assert.ok(Number.isFinite(body.state.velocity.y));
  }
  assert.ok(hit, "contact references the kinematic owner");
  assert.ok(Math.abs(moving.state.position.y - 0.8) < 1e-10);
  assert.ok(
    body.state.position.y > 0.75,
    `body is carried upward: ${body.state.position.y}`,
  );
  assert.ok(
    body.state.velocity.y > 1.5,
    `surface velocity reaches body: ${body.state.velocity.y}`,
  );
  assert.equal(
    world.raycast(new Vector3(8, 2, 0), new Vector3(0, -1, 0), 3),
    null,
    "finite authored platform does not fill world",
  );
});
test("world model removal caps stale contact rows and recollects without invisible obstruction", () => {
  const scene = new Group(),
    actor = new Group();
  actor.name = "barrier";
  actor.add(plane(false));
  scene.add(actor);
  const body = prop([-0.25, 0.5, 0]);
  scene.add(body.actor);
  body.state.velocity.x = 8;
  const world = new WorldCollision(scene),
    sim = new VehicleSimulation(world, scene);
  sim.addNonCar(body);
  assert.ok(sim.admitNonCar(body, { wake: true, resetVelocity: false }));
  sim.destruction = new WorldDestruction(scene, [
    {
      flags: 0,
      trigger: { kind: "model", name: "barrier" },
      mode: "remove",
      levels: [],
      removalThreshold: 0.01,
      connotations: emptyEffects(),
      reserved: [0, 0, 0, 0],
    },
  ]);
  sim.step();
  assert.equal(actor.visible, false);
  assert.equal(actor.userData.worldSmashDisabled, true);
  assert.equal(world.triangles, 0);
  assert.ok(
    body.state.position.x > 0,
    "removed barrier permits remaining motion",
  );
  assert.ok(
    body.state.velocity.x > 7.9,
    "invalidated old plane impulse is not applied",
  );
  assert.ok(
    sim.lastImpacts.some(
      (row) =>
        row.sourceType === 9 && row.sourceSurface?.actor === actor.children[0],
    ),
    "invalidated row preserves source face callback",
  );
});
test("smash thresholds use individual rows before the native cap summation", () => {
  const scene = new Group(),
    actor = new Group();
  actor.name = "barrier";
  actor.add(plane(false));
  scene.add(actor);
  const body = prop([-0.25, 0.5, 0]);
  scene.add(body.actor);
  const world = new WorldCollision(scene),
    sim = new VehicleSimulation(world, scene);
  sim.addNonCar(body);
  assert.ok(sim.admitNonCar(body, { wake: true, resetVelocity: false }));
  sim.destruction = new WorldDestruction(scene, [
    {
      flags: 0,
      trigger: { kind: "model", name: "barrier" },
      mode: "remove",
      levels: [],
      removalThreshold: 0.1,
      connotations: emptyEffects(),
      reserved: [0, 0, 0, 0],
    },
  ]);
  const surface = world.querySurfaces(
    new Vector3(-1, -1, -1),
    new Vector3(1, 1, 1),
  )[0];
  const rows = Array.from({ length: 4 }, () => ({
    a: body,
    point: new Vector3(),
    normal: new Vector3(-1, 0, 0),
    normalImpulse: 0.04,
    sourceSurface: surface,
    sourceType: 1,
  }));
  assert.equal(sim.processWorldSmash(rows, []), false);
  assert.equal(
    actor.visible,
    true,
    "four .04 rows do not trigger .1 threshold",
  );
  rows[0].normalImpulse = 0.11;
  const restarts = [];
  assert.equal(sim.processWorldSmash(rows, restarts), true);
  assert.equal(actor.visible, false);
  assert.equal(restarts.length, 1);
  assert.ok(rows.every((row) => row.sourceType === 9));
  assert.ok(
    Math.abs(rows.reduce((sum, row) => sum + row.normalImpulse, 0) - 0.1) <
      1e-8,
  );
});
test("wheel smash selects strongest first wheel per finite face and retains source force units", () => {
  const scene = new Group(),
    sim = new VehicleSimulation(new WorldCollision(scene), scene),
    car = prop();
  car.group = car.actor;
  const actorA = plane(),
    actorB = plane();
  const a = { actor: actorA, material: "GLASS", faceIndex: 0 },
    b = { actor: actorB, material: "GLASS", faceIndex: 1 };
  const captured = [];
  sim.destruction = {
    hasMaterialTrigger: () => true,
    handleContact: (contact) => {
      captured.push(contact);
      return { changes: [] };
    },
  };
  sim.oilGround(car).worldWheelContact([
    { hit: { surface: a }, load: 2, point: new Vector3(1, 2, 3) },
    { hit: { surface: a }, load: 4, point: new Vector3(4, 5, 6) },
    { hit: { surface: b }, load: 3, point: new Vector3(7, 8, 9) },
  ]);
  assert.equal(captured.length, 1);
  assert.equal(
    captured[0].actor,
    actorB,
    "second wheel on same face cannot replace first wheel",
  );
  assert.equal(
    captured[0].normalImpulse,
    Math.fround(3 * Math.fround(0.04)),
    "native load*.04, without /6.9",
  );
  assert.deepEqual(captured[0].point.toArray(), [7, 8, 9]);
  assert.equal(captured[0].kind, "wheel");
});
