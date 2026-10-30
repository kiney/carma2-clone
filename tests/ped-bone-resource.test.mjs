import test from "node:test";
import assert from "node:assert/strict";
import { Object3D } from "three";
import {
  createNativePedBoneResource,
  prepareNativePedBoneResource,
} from "../src/physics/ped-bone-body.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { evaluateNativePedRetainedJoint } from "../src/physics/ped-retained-joint.ts";

function input(type, position = [1, 2, 3], dimensions = [0.02, 0.03, 0.04]) {
  return {
    owner: {},
    levelOut: 0.2,
    request: {
      index: 1,
      slot: 0,
      bone: {
        name: "source-bone",
        collisionType: type,
        mass: Math.fround(0.004),
        massKg: 4,
      },
      snapshot: {
        actor: new Object3D(),
        model: {},
        nativePose: [1, 0, 0, 0, 1, 0, 0, 0, 1, ...position],
        bounds: { min: dimensions.map((v) => -v), max: dimensions },
      },
      rigidType: 5,
      filterA: 0x40000,
      filterB: 0x50000,
      localOmega: [0, 0, 0],
      activation: null,
      clearParentJoint: true,
      clearChildren: true,
      clearLink188: true,
    },
  };
}

for (const type of ["BOX", "SPHERE", "LINE"]) {
  test(`FORM ${type} resource is unbound until preparation and keeps physical identity across owners`, () => {
    const resource = createNativePedBoneResource(type),
      shape = resource.shape,
      bounds = shape.bounds,
      state = resource.state,
      inertia = resource.properties.inertia,
      com = resource.properties.centerOfMass,
      matrix = resource.nativeMatrix,
      vertices = shape.type === "BOX" ? [...shape.hull.vertices] : null,
      joint = { quietOrientationY: 0.7 };
    assert.equal(resource.actor, null);
    assert.equal(resource.model, null);
    assert.equal(resource.owner, null);
    assert.equal(resource.rigidType, 0);
    assert.equal(resource.properties.mass, 0);
    assert.equal(resource.properties.objectFriction, 0);
    resource.rigidFlags = 0x80000200;
    resource.nativeJoint2 = joint;
    resource.properties.objectFriction = Math.fround(0.7);
    const first = input(type),
      body = prepareNativePedBoneResource(resource, first);
    assert.equal(body, resource);
    assert.equal(body.actor, first.request.snapshot.actor);
    assert.equal(body.model, first.request.snapshot.model);
    assert.equal(body.nativeJoint2, joint);
    assert.equal(body.rigidFlags, 0x80000200);
    assert.equal(body.properties.objectFriction, Math.fround(0.7));
    assert.equal(body.state, state);
    assert.equal(body.shape, shape);
    assert.equal(body.shape.bounds, bounds);
    assert.equal(body.properties.inertia, inertia);
    assert.equal(body.properties.centerOfMass, com);
    assert.equal(body.nativeMatrix, matrix);
    if (vertices)
      vertices.forEach((v, i) => assert.equal(body.shape.hull.vertices[i], v));
    const second = input(type, [4, 5, 6], [0.04, 0.05, 0.06]);
    body.state.velocity.set(4, 5, 6);
    body.localOmega.set(1, 2, 3);
    body.poseTarget = new Float32Array(first.request.snapshot.nativePose);
    const rebound = prepareNativePedBoneResource(resource, second);
    assert.equal(rebound, body);
    assert.equal(rebound.owner, second.owner);
    assert.equal(rebound.actor, second.request.snapshot.actor);
    assert.equal(
      rebound.poseTarget,
      undefined,
      "a reused BODY cannot write into the old owner's ACT pose",
    );
    assert.deepEqual(rebound.state.position.toArray(), [4, 5, 6]);
    assert.equal(rebound.state.velocity.length(), 0);
    assert.equal(rebound.localOmega.length(), 0);
    assert.equal(rebound.nativeJoint2, joint);
    assert.equal(rebound.properties.objectFriction, Math.fround(0.7));
    assert.equal(rebound.shape, shape);
    if (vertices)
      vertices.forEach((v, i) =>
        assert.equal(rebound.shape.hull.vertices[i], v),
      );
  });
}

test("bare, live-header and incompatible FORM resources cannot be admitted/reprepared", () => {
  const resource = createNativePedBoneResource("SPHERE"),
    sim = new VehicleSimulation(
      { raycast: () => null, querySurfaces: () => [] },
      new Object3D(),
    );
  assert.throws(() => sim.addPedBoneBody(resource), /prepared/);
  assert.equal(sim.phil.count, 0);
  assert.throws(
    () => prepareNativePedBoneResource(resource, input("BOX")),
    /shape tag/,
  );
  assert.equal(resource.actor, null);
  const body = prepareNativePedBoneResource(resource, input("SPHERE"));
  assert.equal(sim.addPedBoneBody(body).accepted, true);
  assert.throws(
    () => prepareNativePedBoneResource(resource, input("SPHERE")),
    /PHIL release/,
  );
  sim.removePedBoneBody(body);
  assert.equal(prepareNativePedBoneResource(resource, input("SPHERE")), body);
});

test("retained joint2 friction follows quiet, uses post-contact omega and never changes the committed pose", () => {
  const resource = createNativePedBoneResource("SPHERE"),
    body = prepareNativePedBoneResource(resource, input("SPHERE")),
    sim = new VehicleSimulation(
      { raycast: () => null, querySurfaces: () => [] },
      new Object3D(),
    ),
    joint = { friction: Math.fround(0.000001), type: 0, limitCount: 0 };
  body.nativeJoint2 = joint;
  sim.addPedBoneBody(body);
  // As in the sever caller, clear ec separately: PHIL activation preserves it.
  body.doNothing = false;
  sim.phil.activate(body, { flag2: false });
  body.state.angularVelocity.set(2, -3, 4);
  sim.preparePedBonePhysics();
  assert.deepEqual(
    body.localOmega.toArray(),
    [2, -3, 4],
    "free forces do not run late joint friction",
  );
  body.state.angularVelocity.set(3, 2, 1);
  const poseBefore = body.state.orientation.clone(),
    expected = evaluateNativePedRetainedJoint({
      joint,
      inertia: body.properties.inertia.toArray(),
      localOmega: [3, 2, 1],
    });
  assert.equal(expected.status, "complete");
  sim.finishPedJointFriction();
  assert.deepEqual(body.localOmega.toArray(), expected.localOmega);
  assert.equal(sim.pedBoneQuiet.get(body).requiredProviders.size, 0);
  assert.equal(body.nativeJoint2, joint);
  assert.equal(body.state.orientation.equals(poseBefore), true);
  const after = body.state.angularVelocity.toArray();
  sim.phil.makePassive(body);
  sim.finishPedJointFriction();
  assert.deepEqual(body.state.angularVelocity.toArray(), after);
  sim.removePedBoneBody(body);
  assert.equal(
    body.nativeJoint2,
    joint,
    "header release preserves external joint2",
  );
  sim.dispose();
});

test("real tick schedules retained joint friction after whole-ring quiet processing", () => {
  const body = prepareNativePedBoneResource(
      createNativePedBoneResource("SPHERE"),
      input("SPHERE"),
    ),
    sim = new VehicleSimulation(
      { raycast: () => null, querySurfaces: () => [] },
      new Object3D(),
    ),
    trace = [];
  body.nativeJoint2 = { friction: 0.000001, type: 0, limitCount: 0 };
  sim.addPedBoneBody(body);
  body.doNothing = false;
  sim.phil.activate(body, { flag2: false });
  body.state.angularVelocity.set(2, -3, 4);
  const quiet = sim.finishHierarchyQuiet.bind(sim),
    friction = sim.finishPedJointFriction?.bind(sim);
  assert.equal(typeof friction, "function");
  sim.finishHierarchyQuiet = () => {
    trace.push("quiet");
    quiet();
  };
  sim.finishPedJointFriction = () => {
    trace.push("joint-friction");
    friction();
  };
  sim.update(0.04);
  assert.deepEqual(trace, ["quiet", "joint-friction"]);
  sim.dispose();
});

test("retained friction never substitutes for unknown world anchors or positive limit rows", () => {
  const body = prepareNativePedBoneResource(
      createNativePedBoneResource("BOX"),
      input("BOX"),
    ),
    sim = new VehicleSimulation(
      { raycast: () => null, querySurfaces: () => [] },
      new Object3D(),
    );
  for (const joint of [
    { friction: 1 },
    { friction: 1, type: 1, limitCount: 0 },
    { friction: 1, type: 0, limitCount: 1 },
  ]) {
    body.nativeJoint2 = joint;
    assert.throws(() => sim.addPedBoneBody(body), /joint2 geometry provider/);
    assert.equal(sim.phil.count, 0);
    assert.equal(body.registered, false);
  }
  body.nativeJoint2 = { friction: 1, type: 0, limitCount: 0 };
  assert.equal(sim.addPedBoneBody(body).accepted, true);
  sim.dispose();
});
