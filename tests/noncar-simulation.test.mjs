import test from "node:test";
import assert from "node:assert/strict";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  DoubleSide,
} from "three";
import { parseNonCarMechanics } from "../src/noncars.ts";
import {
  createNonCarBody,
  finalizeNonCarRelease,
  releaseNonCar,
} from "../src/physics/noncar-body.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { WorldCollision, batchStaticWorld } from "../src/world.ts";

function prop({
  mass = 0.1,
  attached = 2,
  bend = 0,
  torque = 0,
  keywords = "",
  bounds = "-.1,-.1,-.1\n.1,.1,.1",
  name = "&07c0001.ACT",
} = {}) {
  const actor = new Group();
  actor.name = name;
  actor.add(
    new Mesh(
      new BoxGeometry(0.2, 0.2, 0.2),
      new MeshBasicMaterial({ side: DoubleSide }),
    ),
  );
  const mechanics = parseNonCarMechanics(
    `101\n7\n0,0,0\n0,-.1,0\n1\nbox\n${bounds}\n${mass},${attached}\n.2,.2,.2\n${bend}\n${torque}\n0\n${keywords}\nEND`,
  );
  return createNonCarBody(actor, mechanics);
}
const near = (a, b, e = 1e-8) =>
  assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);

test("smashed jointed scenery leaves the candidate hierarchy until re-enabled", () => {
  const scene = new Group(),
    body = prop({ bend: 30 });
  scene.add(body.actor);
  const sim = new VehicleSimulation(new WorldCollision(scene), scene);
  sim.addNonCar(body);
  assert.ok(sim.admitNonCar(body, { wake: true }));
  body.motor.sleeping = false;
  body.properties.immovable = false;
  assert.ok(body.joint);
  body.actor.userData.worldSmashDisabled = true;
  assert.ok(!sim.allBodies().includes(body));
  assert.ok(!sim.allJoints().includes(body.joint));
  assert.doesNotThrow(() => sim.step());
  delete body.actor.userData.worldSmashDisabled;
  assert.ok(sim.allBodies().includes(body));
  assert.ok(sim.allJoints().includes(body.joint));
  assert.doesNotThrow(() => sim.step());
  sim.dispose();
});

test("admitted sleeping props keep source geometry and refresh finite drivable faces", () => {
  const source = new Group(),
    body = prop({ keywords: "DRIVABLE_ON" });
  source.position.set(5, 0, 0);
  source.add(body.actor);
  source.updateMatrixWorld(true);
  // Resolve the authored world origin as the loader does before batching.
  body.state.position.copy(body.actor.getWorldPosition(new Vector3()));
  const mesh = body.actor.children[0];
  let disposed = 0;
  mesh.geometry.addEventListener("dispose", () => disposed++);
  const result = batchStaticWorld(source, [body.actor]);
  near(body.actor.position.x, 5);
  assert.equal(disposed, 0);
  const world = new WorldCollision(result);
  assert.equal(
    world.triangles,
    12,
    "unpulled cube retains its twelve static faces",
  );
  const staticHit = world.raycast(
    new Vector3(5, 1, 0),
    new Vector3(0, -1, 0),
    2,
  );
  near(staticHit.point.y, 0.1, 1e-6);
  assert.equal(
    staticHit.body,
    undefined,
    "unpulled static geometry has no dynamic owner",
  );
  // This isolated world fixture models an already admitted drivable owner;
  // unpulled ACT coverage and collection-time admission have separate tests.
  world.setNonCarParticipation(body, body.actor, true, true);
  assert.equal(world.triangles, 0, "admission removes stale static copies");
  const hit = world.raycast(new Vector3(5, 1, 0), new Vector3(0, -1, 0), 2);
  assert.equal(hit.body, body);
  near(hit.point.y, 0.1, 1e-6);
  body.state.position.y = 1;
  body.actor.position.copy(body.state.position);
  world.refreshDynamic(body);
  near(
    world.raycast(new Vector3(5, 2, 0), new Vector3(0, -1, 0), 2).point.y,
    1.1,
    1e-6,
  );
  assert.equal(
    world.raycast(new Vector3(0, 2, 0), new Vector3(0, -1, 0), 2),
    null,
  );
  assert.equal(
    world.querySurfaces(new Vector3(-10, -10, -10), new Vector3(10, 10, 10))
      .length,
    0,
  );
});

test("body contact wakes a registered sleeping prop and conserves authored two-body horizontal momentum", () => {
  const scene = new Group(),
    a = prop({ mass: 0.1, name: "&07c0001.ACT" }),
    b = prop({ mass: 0.3, name: "&07c0002.ACT" });
  a.state.position.set(-0.3, 1, 0);
  b.state.position.set(0, 1, 0);
  for (const body of [a, b]) {
    body.actor.position.copy(body.state.position);
    scene.add(body.actor);
  }
  const world = new WorldCollision(scene),
    simulation = new VehicleSimulation(world, scene);
  simulation.addNonCar(a);
  simulation.addNonCar(b);
  assert.ok(simulation.admitNonCar(a, { wake: true }));
  assert.ok(simulation.admitNonCar(b, { wake: false }));
  a.motor.sleeping = false;
  a.properties.immovable = false;
  a.state.velocity.x = 3;
  const initial = 0.1 * 3;
  let touched = false;
  for (let i = 0; i < 4; i++) {
    simulation.step();
    touched ||= simulation.lastImpacts.some(
      (hit) => hit.b && hit.sourceType !== 9 && hit.normalImpulse > 0,
    );
    near(0.1 * a.state.velocity.x + 0.3 * b.state.velocity.x, initial, 1e-7);
  }
  assert.ok(touched);
  assert.equal(b.motor.sleeping, false);
  assert.ok(b.state.velocity.x > 0.1);
});

test("source world-anchor COM and delayed free-mass swap survive snap release", () => {
  const body = prop({ mass: 0.2, attached: 8, bend: 30, torque: 2 });
  assert.equal(body.properties.mass, 8);
  assert.deepEqual(body.properties.centerOfMass.toArray(), [0, 0, 0]);
  assert.deepEqual(body.joint.childAnchor.toArray(), [0, -0.1, 0]);
  body.state.velocity.set(1, 2, 3);
  releaseNonCar(body);
  assert.equal(body.joint, undefined);
  assert.equal(body.properties.mass, 8);
  assert.deepEqual(body.state.velocity.toArray(), [0, 0, 0]);
  finalizeNonCarRelease(body);
  assert.equal(body.actor.name[3], "!");
  assert.equal(body.properties.mass, 0.2);
  near(body.properties.inertia.x, (0.2 * (0.2 * 0.2 + 0.2 * 0.2)) / 12);
});

test("activated source translation motor has finite travel and preserves its authored axis", () => {
  const body = prop({
    mass: 500,
    keywords:
      "WORLD_TRANSLATION_JOINT\n0,0,0\n0,1,0\n.4\n7\n5\n1\n1\n500\nRISE_WHEN_HIT\nINFINITE_I\nIGNORE_WORLD_COLLISIONS",
  });
  const scene = new Group();
  scene.add(body.actor);
  const simulation = new VehicleSimulation(new WorldCollision(scene), scene);
  simulation.addNonCar(body);
  assert.ok(simulation.admitNonCar(body, { wake: true }));
  body.motor.flags |= 1;
  body.motor.sleeping = false;
  body.properties.immovable = false;
  let highest = 0;
  for (let i = 0; i < 120; i++) {
    simulation.step();
    highest = Math.max(highest, body.state.position.y);
    near(body.state.position.x, 0);
    near(body.state.position.z, 0);
    assert.ok(
      body.state.position.y >= -0.005 && body.state.position.y <= 0.405,
      `travel ${body.state.position.y}`,
    );
  }
  assert.ok(highest > 0.1, "Authored g acceleration moves the lift");
});
