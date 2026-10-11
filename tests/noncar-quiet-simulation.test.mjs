import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3 } from "three";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";

const floor = {
  a: new Vector3(-10, 0, -10),
  b: new Vector3(-10, 0, 10),
  c: new Vector3(10, 0, -10),
  normal: new Vector3(0, 1, 0),
  material: "0",
  enabled: true,
  modifier: { tyreFriction: 1, wallFriction: 1, bumpiness: 0 },
};
function prop(position = [-0.1, 0.051, -0.1]) {
  const actor = new Group();
  actor.position.fromArray(position);
  actor.name = "&50!0000.ACT";
  actor.userData.noncarPulled = true;
  const body = createNonCarBody(actor, {
    index: 50,
    version: 101,
    centerOfMass: [0, 0, 0],
    attachedCenterOfMass: [0, 0, 0],
    shapes: [
      {
        kind: "box",
        bounds: { min: [-0.05, -0.05, -0.05], max: [0.05, 0.05, 0.05] },
      },
    ],
    extraPoints: [],
    freeMass: 1,
    attachedMass: 1,
    inertiaDimensions: [0.1, 0.1, 0.1],
    inertiaPerMass: [0.001, 0.001, 0.001],
    snapAngleDegrees: 0,
    minimumTorque: 0,
    shrapnelMaterials: [],
    worldFriction: 1,
    objectFriction: 0,
    riseWhenHit: false,
    riseWhenDrivenOn: false,
    drivableOn: false,
    infiniteInertia: false,
    ignoreWorldCollisions: false,
    blockCamera: false,
    sparky: false,
  });
  body.motor.sleeping = false;
  body.properties.immovable = false;
  return body;
}
function simulation(surfaces = [floor]) {
  return new VehicleSimulation(
    {
      raycast() {
        return null;
      },
      querySurfaces() {
        return surfaces;
      },
      addDynamic() {},
      removeDynamic() {},
    },
    new Group(),
  );
}
test("free ordinary prop uses contact/gravity quiet criterion, independent of motor sleep", () => {
  const sim = simulation(),
    body = prop();
  sim.addNonCar(body);
  const initialInertia = body.properties.inertia.clone();
  let firstSleep = -1;
  for (let i = 0; i < 30; i++) {
    sim.step();
    if (sim.nativeNonCarQuietState(body)?.doNothing) {
      firstSleep = i;
      break;
    }
  }
  assert.ok(
    firstSleep >= 0,
    "actual supported floor contacts never reached source ec",
  );
  assert.equal(
    body.motor.sleeping,
    false,
    "ec was substituted with motor sleep",
  );
  assert.equal(body.properties.immovable, true);
  assert.equal(body.state.velocity.lengthSq(), 0);
  assert.equal(body.state.angularVelocity.lengthSq(), 0);
  assert.ok(
    body.properties.inertia.distanceTo(initialInertia) < 1e-9,
    "temporary moments leaked",
  );
  const p = body.state.position.clone();
  sim.step();
  assert.ok(
    body.state.position.equals(p),
    "asleep prop integrated or acquired gravity",
  );
  assert.equal(sim.nativeNonCarQuietState(body).inertiaScale, 1);
});
test("airborne prop remains active even after many steps; elapsed time grants no ec", () => {
  const sim = simulation([]),
    body = prop([0, 100, 0]);
  sim.addNonCar(body);
  for (let i = 0; i < 100; i++) sim.step();
  const state = sim.nativeNonCarQuietState(body);
  assert.equal(state.doNothing, false);
  assert.equal(body.properties.immovable, false);
  assert.ok(body.state.velocity.y < -5);
  assert.equal(state.lastResult.gate, "linear-speed");
});
test("unsupported authored translation joint does not receive generic free-body quiet ownership", () => {
  const sim = simulation([]),
    body = prop([0, 1, 0]);
  body.mechanics.worldJoint = {
    kind: "translation",
    position: [0, 0, 0],
    axis: [0, 1, 0],
    travel: 1,
    forwardResistance: 0,
    reverseResistance: 0,
    forwardAcceleration: 1,
    reverseAcceleration: 1,
  };
  sim.addNonCar(body);
  sim.step();
  assert.equal(sim.nativeNonCarQuietState(body), null);
});

test("body impact wakes a source-quiet prop and repeats the contact solve", () => {
  const sim = simulation(),
    resting = prop();
  sim.addNonCar(resting);
  for (
    let i = 0;
    i < 30 && !sim.nativeNonCarQuietState(resting)?.doNothing;
    i++
  )
    sim.step();
  assert.equal(sim.nativeNonCarQuietState(resting).doNothing, true);
  const incoming = prop([
    resting.state.position.x - 0.15,
    resting.state.position.y + 0.035,
    resting.state.position.z,
  ]);
  incoming.state.velocity.x = 2;
  sim.addNonCar(incoming);
  sim.step();
  assert.equal(sim.nativeNonCarQuietState(resting).doNothing, false);
  assert.equal(resting.properties.immovable, false);
  assert.ok(
    sim.lastImpacts.some(
      (row) =>
        row.normalImpulse > 0 &&
        ((row.a === resting && row.b === incoming) ||
          (row.a === incoming && row.b === resting)),
    ),
  );
  assert.ok(
    resting.state.velocity.x > 0,
    "newly awake prop received no momentum",
  );
});

test("accepted pair geometry wakes ec before any lambda; world and two asleep leaves do not", () => {
  const sim = simulation(),
    left = prop(),
    right = prop([-0.6, 0.051, -0.1]);
  sim.addNonCar(left);
  sim.addNonCar(right);
  for (let i = 0; i < 30; i++) sim.step();
  assert.equal(sim.nativeNonCarQuietState(left).doNothing, true);
  assert.equal(sim.nativeNonCarQuietState(right).doNothing, true);
  const row = {
    a: left,
    b: right,
    point: left.state.position.clone(),
    normal: new Vector3(1, 0, 0),
    sourceType: 5,
  };
  // Exact accepted geometry→activation seam; no solver/lambda exists yet.
  sim.preparePedContacts([row]);
  assert.equal(sim.nativeNonCarQuietState(left).doNothing, true);
  assert.equal(sim.nativeNonCarQuietState(right).doNothing, true);
  sim.preparePedContacts([{ ...row, b: undefined, sourceType: 1 }]);
  assert.equal(sim.nativeNonCarQuietState(left).doNothing, true);
  const awake = prop([0, 1, 0]);
  sim.preparePedContacts([{ ...row, b: awake }]);
  assert.equal(sim.nativeNonCarQuietState(left).doNothing, false);
  assert.equal(left.properties.immovable, false);
  assert.equal(left.motor.sleeping, false);
  assert.equal(sim.nativeNonCarQuietState(right).doNothing, true);
});
