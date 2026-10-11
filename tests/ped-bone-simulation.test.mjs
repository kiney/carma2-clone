import test from "node:test";
import assert from "node:assert/strict";
import { Group, Object3D, Quaternion, Vector3 } from "three";
import {
  createNativePedBoneBody,
  commitNativePedBoneBody,
} from "../src/physics/ped-bone-body.ts";
import { VehicleSimulation, PHYSICS_STEP } from "../src/physics/simulation.ts";
import {
  nativeBodyLocalBounds,
  nativeBodyWorldBounds,
  nativeSpherePairRows,
} from "../src/physics/sphere-body.ts";
import { guardPairTrajectory } from "../src/physics/pair-guard.ts";
import {
  createMovingWorldBody,
  prepareMovingWorldPose,
} from "../src/physics/moving-world.ts";

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function makeBody(
  type = "SPHERE",
  position = [0, 0.2, 0],
  velocity = [0, 0, 0],
  mass = 0.004,
) {
  const request = {
    index: 1,
    slot: 0,
    bone: {
      name: "HEAD",
      massKg: mass * 1000,
      mass: Math.fround(mass),
      collisionType: type,
    },
    snapshot: {
      actor: new Object3D(),
      model: { safeFixture: true },
      nativePose: [...identity, ...position],
      bounds: { min: [-0.02, -0.02, -0.02], max: [0.02, 0.02, 0.02] },
    },
    rigidType: 5,
    filterA: 0x40000,
    filterB: 0x50000,
    localOmega: [0, 0, 0],
    activation: {
      velocity,
      gravity: 1,
      clearProperties: [3, 4, 5],
      clearDoNothing: true,
      enableHalt: true,
    },
    clearParentJoint: true,
    clearChildren: true,
    clearLink188: true,
  };
  return {
    request,
    body: createNativePedBoneBody({
      request,
      owner: {},
      levelOut: 0,
      retained: { rigidFlags: 0, objectFriction: 0 },
    }),
  };
}
const floor = {
  a: new Vector3(-10, 0, -10),
  b: new Vector3(-10, 0, 10),
  c: new Vector3(10, 0, -10),
  normal: new Vector3(0, 1, 0),
  material: "0",
  enabled: true,
  modifier: { tyreFriction: 1, wallFriction: 1, bumpiness: 0 },
};
function simulation(faces = []) {
  return new VehicleSimulation(
    { raycast: () => null, querySurfaces: () => faces },
    new Group(),
  );
}
function admit(sim, value) {
  assert.deepEqual(sim.addPedBoneBody(value.body), { accepted: true, code: 0 });
  commitNativePedBoneBody(value.request, value.body, {
    unlink() {},
    activate: (body) => sim.phil.activate(body, { flag2: false }),
  });
  return value.body;
}
const near = (actual, expected, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

test("type5 registration consumes the actual shared header and keeps sever callback bit clear", () => {
  const sim = simulation(),
    value = makeBody();
  assert.equal(sim.addPedBoneBody(value.body).accepted, true);
  const header = sim.phil.getHeader(value.body);
  assert.equal(header.state, 1);
  assert.equal(header.flags, 12);
  assert.equal(header.gravity, 1);
  assert.equal(header.drag, 0);
  assert.equal(sim.phil.count, 1);
  commitNativePedBoneBody(value.request, value.body, {
    unlink() {},
    activate: (body) => sim.phil.activate(body, { flag2: false }),
  });
  assert.equal(header.state, 2);
  assert.equal(header.flags & 2, 0);
  assert.equal(value.body.filterA, 0x40000);
  sim.removePedBoneBody(value.body);
  assert.equal(sim.phil.count, 0);
  assert.equal(value.body.headerState, 0);
  assert.equal(value.body.registered, false);
  assert.equal(sim.pedBoneBodies.length, 0);
});

test("analytic sphere queries use authored bounds and transformed center without hull vertices", () => {
  const { body } = makeBody();
  assert.deepEqual(body.hulls, []);
  const local = nativeBodyLocalBounds(body);
  near(local.min.y, -0.02);
  const box = nativeBodyWorldBounds(
    body,
    new Vector3(1, 2, 3),
    new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.7),
  );
  near(box.min.x, 1 - body.shape.radius);
  near(box.max.y, 2 + body.shape.radius);
});

test("dry detached type5 receives native raw gravity and no generic air damping", () => {
  const sim = simulation(),
    body = admit(sim, makeBody("SPHERE", [0, 1, 0], [2, 0, 0]));
  const actualPoseStorage = new Float32Array([...identity, 0, 1, 0]);
  body.poseTarget = actualPoseStorage;
  sim.step();
  near(body.state.velocity.x, 2, 1e-12);
  const dy = Math.fround(-0.05681159420289855);
  near(body.state.velocity.y, dy, 1e-12);
  near(body.state.position.x, 2 * PHYSICS_STEP);
  near(body.state.position.y, 1 + dy * PHYSICS_STEP);
  near(body.actor.position.x, body.state.position.x);
  assert.equal(body.poseTarget, actualPoseStorage);
  assert.equal(actualPoseStorage[9], Math.fround(body.state.position.x));
  assert.equal(actualPoseStorage[10], Math.fround(body.state.position.y));
  near(body.nativeMatrix.elements[13], body.state.position.y);
  assert.equal(sim.pedBodies.length, 0);
  assert.equal(sim.phil.getState(body), 2);
  sim.dispose();
  assert.equal(sim.phil.count, 0);
});

test("native sphere floor contacts enter the impulse solver and survive repeated ticks", () => {
  const sim = simulation([floor]),
    body = admit(sim, makeBody("SPHERE", [-1, 0.12, -1], [0, -3, 0]));
  sim.step();
  assert.ok(
    sim.lastImpacts.some(
      (impact) =>
        impact.a === body &&
        [3, 4].includes(impact.sourceType) &&
        impact.normalImpulse > 0,
    ),
  );
  assert.ok(body.state.position.y >= body.shape.radius - 0.0001);
  assert.ok(body.state.velocity.y > -3);
  for (let i = 0; i < 80; i++) sim.step();
  assert.ok(body.state.position.y >= body.shape.radius - 0.0001);
  assert.equal(
    sim.phil.getState(body),
    2,
    "sever quiet does not release state2/header when callbackbit2 is clear",
  );
  assert.equal(sim.phil.count, 1);
});

test("BOX/sphere source face rows retain target-first old torque points", () => {
  const sphere = makeBody("SPHERE", [0.08, 0, 0]).body,
    box = makeBody("BOX", [0, 0, 0], [0, 0, 0], 0.08).body;
  sphere.state.predictedPosition = new Vector3(0.01, 0, 0);
  sphere.state.predictedOrientation = sphere.state.orientation.clone();
  const rows = nativeSpherePairRows(sphere, box);
  assert.ok(rows.some((row) => row.sourceType === 8));
  const face = rows.find((row) => row.sourceType === 8);
  assert.equal(face.a, box);
  assert.equal(face.b, sphere);
  assert.ok(face.normal.x < -0.99);
  assert.ok(face.pointB.x > face.point.x);
  assert.ok(face.fraction >= 0 && face.fraction <= 1);
});

test("analytic sphere final guard catches a fast crossing with separated endpoint shapes", () => {
  const a = makeBody("SPHERE", [-0.2, 0, 0]).body,
    b = makeBody("BOX", [0, 0, 0]).body;
  const pathA = (t) => ({
      position: new Vector3(-0.2 + 0.4 * t, 0, 0),
      orientation: new Quaternion(),
    }),
    pathB = () => ({ position: new Vector3(), orientation: new Quaternion() });
  const safe = guardPairTrajectory(a, b, pathA, pathB);
  assert.ok(
    safe > 0.3 && safe < 0.5,
    `retain clear motion before first contact: ${safe}`,
  );
  assert.equal(
    guardPairTrajectory(a, b, pathA, pathB, () => false),
    1,
  );
});

test("type5 LINE cannot silently become a sampled or BOX collision body", () => {
  const sim = simulation();
  assert.throws(
    () => sim.addPedBoneBody(makeBody("LINE").body),
    /LINE.*provider/,
  );
  assert.equal(sim.phil.count, 0);
  assert.equal(sim.pedBoneBodies.length, 0);
});

test("analytic type5 sphere retains independent old torque point for a rising world floor", () => {
  const owner = createMovingWorldBody(new Object3D());
  prepareMovingWorldPose(
    owner,
    new Vector3(0, 0.1, 0),
    new Quaternion(),
    PHYSICS_STEP,
  );
  const surface = {
    ...floor,
    owner,
    a: floor.a.clone().add(new Vector3(0, 0.1, 0)),
    b: floor.b.clone().add(new Vector3(0, 0.1, 0)),
    c: floor.c.clone().add(new Vector3(0, 0.1, 0)),
  };
  const sim = simulation([surface]),
    body = admit(sim, makeBody("SPHERE", [-1, 0.2, -1], [0, -3, 0]));
  sim.step();
  const impact = sim.lastImpacts.find(
    (row) => row.a === body && row.b === owner && row.sourceType === 3,
  );
  assert.ok(impact, "moving source3 face reaches the ordinary solver");
  assert.equal(impact.sourceSurface, surface);
  near(impact.pointB.y, 0);
  near(impact.normal.y, 1);
  assert.ok(impact.normalImpulse > 0);
  assert.ok(body.state.velocity.y > -3);
  assert.equal(
    sim.phil.count,
    1,
    "kinematic world face does not fabricate a PHIL root",
  );
});
