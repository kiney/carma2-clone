import test from "node:test";
import assert from "node:assert/strict";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { originalCar } from "./support/original-car.mjs";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { WorldCollision } from "../src/world.ts";
import { transformHull } from "../src/physics/geometry.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { buildBoxHull } from "../src/physics/box-hull.ts";

function corner() {
  const scene = new Group();
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.userData.c2Flags = 4096;
  for (const vertices of [
    [-20, 0, -20, 20, 0, 20, 20, 0, -20, -20, 0, -20, -20, 0, 20, 20, 0, 20],
    [-20, -20, 0, 20, 20, 0, 20, -20, 0, -20, -20, 0, -20, 20, 0, 20, 20, 0],
  ]) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    // Finite source body-vertex features; no edge wedge/split in this fixture.
    geometry.userData.sourceFaceFlags = Uint8Array.from([7, 7]);
    scene.add(new Mesh(geometry, material));
  }
  return scene;
}
async function stock(t, name, position) {
  let data;
  try {
    data = await originalCar(name);
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local original car installation absent");
      return null;
    }
    throw error;
  }
  const damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  damage.damageContext.random = () => 0.5;
  return createSimulatedCar(data.group, data.text, damage, position, 0, true, {
    immutableHulls: true,
  });
}
function addSimulation(t, scene, car) {
  if (car) scene.add(car.group);
  const sim = new VehicleSimulation(new WorldCollision(scene), scene);
  if (car) sim.add(car);
  sim.correctionDiagnostics = {};
  t.after(() => sim.dispose());
  return sim;
}
const accepted = (sim) =>
  sim.lastImpacts.filter(
    (impact) =>
      impact.solverAccepted &&
      impact.sourceType !== 9 &&
      impact.normalImpulse > 1e-8,
  );
function finiteMotion(body) {
  for (const key of ["position", "orientation", "velocity", "angularVelocity"])
    assert.ok(
      body.state[key].toArray().every(Number.isFinite),
      `nonfinite ${key}`,
    );
}

test("fast rotating original Eagle responds to finite floor/wall features and cannot commit through either face", async (t) => {
  const car = await stock(t, "EAGLE3", new Vector3(0, 0.15, 0.6));
  if (!car) return;
  const sim = addSimulation(t, corner(), car);
  // Immunity isolates response/CCD from WAM split and shape replacement.
  car.damage.damageContext.invulnerable = true;
  car.state.velocity.set(0, -8, -32);
  car.state.angularVelocity.set(180, 0, 0);
  sim.step();
  const world = accepted(sim).filter((impact) => !impact.b);
  assert.ok(
    world.some((impact) => Math.abs(impact.normal.y) > 0.9),
    "the fast downward trajectory must receive a floor response",
  );
  assert.ok(
    world.some((impact) => Math.abs(impact.normal.z) > 0.9),
    "the simultaneous forward trajectory must receive a wall response",
  );
  for (const hull of car.hulls)
    for (const point of transformHull(
      hull,
      car.state.position,
      car.state.orientation,
    ).vertices) {
      assert.ok(point.y >= -0.003, `road penetration ${point.y}`);
      assert.ok(point.z >= -0.003, `wall penetration ${point.z}`);
    }
  finiteMotion(car);
  assert.ok(sim.correctionDiagnostics.localCollections > 0);
  assert.ok(sim.correctionDiagnostics.responseSolves > 0);
});

for (const name of ["EAGLE3", "cerby"])
  test(`${name} actual finite-wall crash deforms authored geometry and full repair restores its physical data`, async (t) => {
    const car = await stock(t, name, new Vector3(0, 5, 0.6));
    if (!car) return;
    const sim = addSimulation(t, corner(), car);
    const pristine = car.shapeVertices.map((shape) =>
      shape.map((point) => point.toArray()),
    );
    const mass = car.properties.mass;
    const com = car.properties.centerOfMass.clone();
    const inertia = car.properties.inertia.clone();
    const revision = car.damage.deformationRevision;
    car.state.velocity.set(0, 0, -8);
    sim.step();
    assert.ok(
      accepted(sim).some(
        (impact) => !impact.b && Math.abs(impact.normal.z) > 0.9,
      ),
    );
    assert.ok(
      car.damage.componentLevels.some((value) => value > 0),
      "accepted native impact must reach component damage",
    );
    assert.ok(car.damage.deformationRevision > revision);
    assert.notDeepEqual(
      car.shapeVertices.map((shape) => shape.map((point) => point.toArray())),
      pristine,
      "accepted native crush must change authored shape points",
    );
    // Move to clear finite space before full repair; recovery itself remains
    // independently covered and no old eight-round crash golden is assumed.
    car.state.position.set(0, 5, 3);
    car.state.velocity.set(0, 0, 0);
    car.state.angularVelocity.set(0, 0, 0);
    sim.reset(car);
    sim.repair(car);
    sim.step();
    assert.ok(car.damage.componentLevels.every((value) => value === 0));
    assert.deepEqual(
      car.shapeVertices.map((shape) => shape.map((point) => point.toArray())),
      pristine,
    );
    assert.equal(car.properties.mass, mass);
    assert.ok(car.properties.centerOfMass.distanceTo(com) < 1e-8);
    assert.ok(car.properties.inertia.distanceTo(inertia) < 1e-8);
    finiteMotion(car);
  });

function prop(x, awake, vx = 0) {
  const actor = new Group();
  actor.name = "&07c0001.ACT";
  actor.position.set(x, 1, 0);
  const mechanics = parseNonCarMechanics(
    "101\n7\n0,0,0\n0,-.1,0\n1\nbox\n-.1,-.1,-.1\n.1,.1,.1\n.1,2\n.2,.2,.2\n0\n0\n0\nINFINITE_I\nOBJECT_FRICTION\n0\nIGNORE_WORLD_COLLISIONS\nEND",
  );
  const body = createNonCarBody(actor, mechanics);
  body.motor.sleeping = !awake;
  body.properties.immovable = !awake;
  body.state.velocity.x = vx;
  return body;
}
const isPair = (impact, a, b) =>
  (impact.a === a && impact.b === b) || (impact.a === b && impact.b === a);
const momentumX = (bodies) =>
  bodies.reduce(
    (sum, body) => sum + body.properties.mass * body.state.velocity.x,
    0,
  );

test("a callback replacement of a dormant third hull is discovered by local response before commitment", () => {
  const scene = new Group();
  const a = prop(-0.25, true, 4),
    b = prop(0, true),
    c = prop(0.6, false);
  const bodies = [a, b, c];
  const sim = new VehicleSimulation(new WorldCollision(scene), scene);
  for (const body of bodies) {
    scene.add(body.actor);
    sim.addNonCar(body);
  }
  sim.correctionDiagnostics = {};
  const initialMomentum = momentumX(bodies);
  const original = sim.processImpactDamage;
  let replaced = false;
  sim.processImpactDamage = function (impacts, joints, restarts) {
    const accepted = original.call(this, impacts, joints, restarts);
    if (
      !replaced &&
      accepted !== false &&
      impacts.some(
        (impact) =>
          isPair(impact, a, b) &&
          impact.sourceType !== 9 &&
          impact.normalImpulse > 0,
      )
    ) {
      // Controlled collision-shape callback: only C's old left boundary moves
      // into B's redirected path. Locked rotation isolates normal momentum.
      c.hulls = [
        buildBoxHull(new Vector3(-0.5, -0.1, -0.1), new Vector3(0.1, 0.1, 0.1)),
      ];
      replaced = true;
    }
    return accepted;
  };
  try {
    sim.step();
    assert.ok(replaced);
    assert.ok(
      accepted(sim).some((impact) => isPair(impact, b, c)),
      "fresh third-body geometry must receive a real response in this tick",
    );
    assert.equal(c.motor.sleeping, false);
    assert.ok(c.state.velocity.x > 0.1);
    assert.ok(Math.abs(momentumX(bodies) - initialMomentum) < 1e-8);
    assert.ok(sim.correctionDiagnostics.responseChangedBodies > 0);
    bodies.forEach(finiteMotion);
  } finally {
    sim.dispose();
  }
});
