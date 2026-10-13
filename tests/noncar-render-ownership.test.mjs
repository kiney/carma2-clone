import test from "node:test";
import assert from "node:assert/strict";
import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { RenderPoses } from "../src/render-pose.ts";
import { WorldCollision } from "../src/world.ts";
import { hasGraphicalPoseOwner } from "../src/render-ownership.ts";

const nearVector = (a, b) =>
  assert.ok(a.distanceTo(b) < 1e-10, `${a.toArray()} != ${b.toArray()}`);
const nearRotation = (a, b) => assert.ok(a.angleTo(b) < 1e-7);
function physicsSnapshot(body) {
  return Object.fromEntries(
    ["position", "orientation", "velocity", "angularVelocity"].map((name) => [
      name,
      body.state[name].toArray(),
    ]),
  );
}
function fixture(t, admitted = true) {
  const scene = new Group(),
    parent = new Group(),
    actor = new Group();
  scene.add(parent);
  parent.add(actor);
  actor.name = "&07!0001.ACT";
  actor.position.set(5, 1, 2);
  actor.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.2);
  const geometry = new BoxGeometry(1, 1, 1);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.userData.c2Flags = 4096;
  actor.add(new Mesh(geometry, material));
  // Safe synthetic mechanics exercise ordinary catalog/slot/PHIL admission.
  // Parent motion is a controlled graphical fixture, not authored track data.
  const mechanics = parseNonCarMechanics(
    "101\n7\n0,0,0\n0,0,0\n1\nbox\n-.5,-.5,-.5\n.5,.5,.5\n1,1\n1,1,1\n0\n0\n0\nDRIVABLE_ON\nOBJECT_FRICTION\n0\nEND",
  );
  const body = createNonCarBody(actor, mechanics);
  const world = new WorldCollision(scene);
  const sim = new VehicleSimulation(world, scene);
  sim.addNonCar(body);
  if (admitted) {
    assert.equal(
      sim.admitNonCar(body, { wake: true, resetVelocity: false }),
      true,
    );
    assert.equal(sim.isNonCarPhysicsActive(body), true);
  }
  t.after(() => {
    sim.dispose();
    geometry.dispose();
    material.dispose();
  });
  return { sim, body, parent, actor, world };
}

test("admitted NONCAR rebases after graphical parent motion before interpolation and restores committed world pose", (t) => {
  const { sim, body, parent, actor, world } = fixture(t);
  const poses = new RenderPoses();
  poses.capture([body]);
  const oldPosition = body.state.position.clone();
  const oldOrientation = body.state.orientation.clone();
  body.state.position.set(7, 5, 2);
  body.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), 0.8);
  body.state.velocity.set(0.3, -0.5, 0.7);
  body.state.angularVelocity.set(-1, 2, 0.3);
  sim.syncCommittedNonCarActor(body); // Tick-time committed actor, old parent.
  const state = physicsSnapshot(body);
  parent.position.set(10, 2, -3);
  parent.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.6);
  const owners = new Set([parent]);
  assert.equal(hasGraphicalPoseOwner(actor, owners), true);
  assert.equal(
    hasGraphicalPoseOwner(actor, owners, false),
    false,
    "native pulled actor does not inherit its retained Three parent ownership",
  );
  assert.ok(
    actor.getWorldPosition(new Vector3()).distanceTo(body.state.position) > 1,
  );
  let refreshes = 0;
  const refresh = world.refreshDynamic;
  world.refreshDynamic = function (owner) {
    assert.equal(owner, body);
    nearVector(actor.getWorldPosition(new Vector3()), body.state.position);
    nearRotation(
      actor.getWorldQuaternion(new Quaternion()),
      body.state.orientation,
    );
    refreshes++;
    return refresh.call(this, owner);
  };
  sim.syncCommittedNonCarActor(body);
  assert.equal(refreshes, 1);
  assert.deepEqual(physicsSnapshot(body), state);
  nearVector(actor.getWorldPosition(new Vector3()), body.state.position);
  nearRotation(
    actor.getWorldQuaternion(new Quaternion()),
    body.state.orientation,
  );
  const localPosition = actor.position.toArray();
  const localOrientation = actor.quaternion.toArray();
  const rayOrigin = body.state.position.clone().add(new Vector3(0, 3, 0));
  const committedHit = world.raycast(rayOrigin, new Vector3(0, -1, 0), 6);
  assert.ok(
    committedHit?.body === body,
    "drivable MODEL cache must use the rebased committed pose before interpolation",
  );
  assert.ok(Math.abs(committedHit.point.y - 5.5) < 1e-8);
  assert.equal(poses.apply(body, actor, 0.5), true);
  nearVector(
    actor.getWorldPosition(new Vector3()),
    oldPosition.clone().lerp(body.state.position, 0.5),
  );
  nearRotation(
    actor.getWorldQuaternion(new Quaternion()),
    oldOrientation.clone().slerp(body.state.orientation, 0.5),
  );
  assert.equal(
    refreshes,
    1,
    "temporary presentation must not refresh committed collision geometry",
  );
  const duringDraw = world.raycast(rayOrigin, new Vector3(0, -1, 0), 6);
  assert.ok(duringDraw?.body === body);
  assert.ok(
    Math.abs(duringDraw.point.y - 5.5) < 1e-8,
    "retained MODEL cache must stay committed while the drawn pose interpolates",
  );
  assert.deepEqual(physicsSnapshot(body), state);
  poses.restore();
  nearVector(actor.getWorldPosition(new Vector3()), body.state.position);
  nearRotation(
    actor.getWorldQuaternion(new Quaternion()),
    body.state.orientation,
  );
  assert.deepEqual(actor.position.toArray(), localPosition);
  assert.deepEqual(actor.quaternion.toArray(), localOrientation);
  assert.deepEqual(physicsSnapshot(body), state);
});

test("unadmitted retained NONCAR keeps inherited graphical pose and performs no committed cache refresh", (t) => {
  const { sim, body, parent, actor, world } = fixture(t, false);
  parent.position.set(10, 2, -3);
  parent.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.6);
  const position = actor.position.toArray(),
    orientation = actor.quaternion.toArray();
  const state = physicsSnapshot(body);
  world.refreshDynamic = () =>
    assert.fail("inactive actor cannot refresh PHIL geometry");
  sim.syncCommittedNonCarActor(body);
  assert.deepEqual(actor.position.toArray(), position);
  assert.deepEqual(actor.quaternion.toArray(), orientation);
  assert.deepEqual(physicsSnapshot(body), state);
});

test("direct GROOVE ownership preserves the admitted actor's authored graphical pose", (t) => {
  const { sim, body, actor, world } = fixture(t);
  sim.grooves = { actors: new Set([actor]) };
  actor.position.set(-2, 7, 9);
  actor.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.7);
  const position = actor.position.toArray(),
    orientation = actor.quaternion.toArray();
  const state = physicsSnapshot(body);
  world.refreshDynamic = () =>
    assert.fail("own GROOVE actor cannot be physics-rebased");
  sim.syncCommittedNonCarActor(body);
  assert.deepEqual(actor.position.toArray(), position);
  assert.deepEqual(actor.quaternion.toArray(), orientation);
  assert.deepEqual(physicsSnapshot(body), state);
});
