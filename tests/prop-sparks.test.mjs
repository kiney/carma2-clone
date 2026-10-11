import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { WorldCollision } from "../src/world.ts";

function body(kind = "noncar", sparky = false) {
  const actor = new Group();
  actor.name = kind;
  return {
    kind,
    actor,
    mechanics: { sparky },
    state: {
      position: new Vector3(),
      orientation: new Quaternion(),
      velocity: new Vector3(1, 0, 0),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: 1,
      centerOfMass: new Vector3(),
      inertia: new Vector3(1, 1, 1),
    },
  };
}
function setup() {
  const scene = new Group();
  return new VehicleSimulation(new WorldCollision(scene), scene);
}
function row(a, b, point = new Vector3(1, 0, 0), lambda = 2) {
  return {
    a,
    b,
    point,
    pointB: point.clone(),
    normal: new Vector3(1, 0, 0),
    normalImpulse: lambda,
    tangentImpulse: new Vector3(),
    closingSpeed: 1,
    sourceType: 1,
  };
}

test("type-one prop groups dispatch pair fragments independently of car damage receivers", () => {
  const sim = setup(),
    a = body(),
    b = body();
  b.state.velocity.set(0, 2, 0);
  const packets = [];
  sim.onCarSparks = (packet) => packets.push(packet);
  sim.applyImpactDamage(
    [row(a, b), row(b, a, new Vector3(3, 0, 0), 1)].map((entry, i) =>
      i ? { ...entry, normal: new Vector3(-1, 0, 0) } : entry,
    ),
  );
  assert.equal(packets.length, 1);
  const packet = packets[0];
  assert.deepEqual(
    packet.cars.map((p) => [p.actor, p.driver, p.sparky]),
    [
      [a.actor, 4, false],
      [b.actor, 4, false],
    ],
  );
  assert.ok(
    Math.abs(packet.position.x - 5 / 3) < 1e-6,
    "reversed row retains primary's weighted contact",
  );
  assert.ok(Math.abs(packet.force.x - 20.7) < 1e-6);
  assert.deepEqual(packet.velocity.toArray(), [0, 2, 0]);
});

test("detached and split spark owners retain their own ACT and zero-filled flags", () => {
  for (const [joint, part, driver] of [
    [{}, 0, 1],
    [undefined, 0, 2],
    [undefined, -1, 3],
  ]) {
    const sim = setup(),
      a = body("detached"),
      b = body("noncar", true);
    a.owner = { group: new Group(), human: true };
    a.part = part;
    a.joint = joint;
    let packet;
    sim.onCarSparks = (p) => (packet = p);
    sim.applyImpactDamage([row(a, b)]);
    assert.equal(packet.cars[0].actor, a.actor);
    assert.equal(packet.cars[0].driver, driver);
    assert.equal(packet.cars[0].sparky, false);
    assert.equal(packet.cars[1].sparky, true);
  }
});

test("SPARKY props use world dispatch but unknown secondary physics suppresses that branch", () => {
  const sim = setup(),
    a = body();
  const packets = [];
  sim.onWorldSparks = (p) => packets.push(p);
  const contact = { ...row(a), sourceSurface: { material: "/stone" } };
  sim.applyImpactDamage([contact]);
  assert.equal(packets.length, 0);
  a.mechanics.sparky = true;
  sim.applyImpactDamage([contact]);
  assert.equal(packets.length, 1);
  assert.equal(packets[0].car, a.actor);
  sim.applyImpactDamage([{ ...contact, b: body("mine") }]);
  assert.equal(packets.length, 1);
});
