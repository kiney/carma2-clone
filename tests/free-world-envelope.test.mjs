import test from "node:test";
import assert from "node:assert/strict";
import {
  Box3,
  Group,
  Vector3,
  Quaternion,
  Mesh,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  DoubleSide,
} from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { createHierarchyMotionPhase } from "../src/physics/hierarchy-motion.ts";
import { freeWorldEnvelope } from "../src/physics/free-world-envelope.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { WorldCollision } from "../src/world.ts";

function body() {
  return {
    hulls: [
      buildBoxHull(new Vector3(-0.2, -0.3, -0.1), new Vector3(0.2, 0.3, 0.1)),
    ],
    properties: {
      mass: 0.05,
      inertia: new Vector3(0.00046, 0.000094, 0.00045),
      centerOfMass: new Vector3(0.03, 0.15, 0),
      worldFriction: 0,
    },
    state: {
      position: new Vector3(10000, 2000, -9000),
      orientation: new Quaternion(),
      velocity: new Vector3(400, 30, -120),
      angularVelocity: new Vector3(717744, 289227, 454739),
    },
  };
}
function floor() {
  const scene = new Group(),
    geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute([-10, 0, -10, 10, 0, 10, 10, 0, -10], 3),
  );
  scene.add(new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide })));
  return new WorldCollision(scene);
}
test("PHY-18 full free COM tube encloses offset-COM gyro poses without requiring their samples", () => {
  const b = body(),
    phase = createHierarchyMotionPhase([b], [], 0.04),
    path = phase.paths.get(b);
  const bounds = freeWorldEnvelope(b, path);
  assert.ok(bounds instanceof Box3);
  for (const f of [0, 0.5, 1]) {
    const p = path(f);
    for (const h of b.hulls)
      for (const v of h.vertices)
        assert.ok(
          bounds.containsPoint(
            v.clone().applyQuaternion(p.orientation).add(p.position),
          ),
        );
  }
  const custom = () => path(1);
  custom.guardMotion = path.guardMotion;
  assert.equal(
    freeWorldEnvelope(b, custom),
    undefined,
    "Uncertified custom trajectory has no free COM guarantee",
  );
  const child = Object.assign(() => path(1), {
    guardMotion: { ...path.guardMotion, centerError: 1 },
    temporalGroup: b,
  });
  assert.equal(freeWorldEnvelope(b, child), undefined);
});
test("PHY-18 remote extreme spinner skips angular sweep and retains exact final candidate pose", () => {
  const b = body(),
    sim = new VehicleSimulation(floor(), new Group());
  sim.hierarchyMotion = createHierarchyMotionPhase([b], [], 0.04);
  const path = sim.hierarchyMotion.paths.get(b),
    expected = path(1);
  let sweeps = 0;
  sim.sweepWorldTrajectory = () => {
    sweeps++;
    throw Error("Unexpected sampled sweep");
  };
  const result = sim.computeAdvanceWorldContacts(b, true);
  assert.equal(result.fraction, 1);
  assert.equal(result.contacts.length, 0);
  assert.equal(sweeps, 0);
  assert.ok(b.state.predictedPosition.equals(expected.position));
  assert.ok(b.state.predictedOrientation.equals(expected.orientation));
  assert.equal(b.state.angularVelocity.x, 717744);
  sim.dispose();
});
test("PHY-18 high-speed outside-to-outside re-entry keeps actual wall/floor guard", () => {
  const b = body();
  b.state.position.set(0, 2, 0);
  b.state.velocity.set(0, -100, 0);
  b.state.angularVelocity.set(0, 0, 0);
  const sim = new VehicleSimulation(floor(), new Group());
  sim.hierarchyMotion = createHierarchyMotionPhase([b], [], 0.04);
  const result = sim.computeAdvanceWorldContacts(b, true);
  assert.ok(result.fraction < 1);
  assert.ok(result.contacts.length > 0);
  sim.dispose();
});
test("PHY-18 hull and COM replacements change the clearance envelope immediately", () => {
  const b = body(),
    path = createHierarchyMotionPhase([b], [], 0.04).paths.get(b);
  const before = freeWorldEnvelope(b, path);
  b.hulls = [
    buildBoxHull(new Vector3(-100, -100, -100), new Vector3(100, 100, 100)),
  ];
  const after = freeWorldEnvelope(b, path);
  assert.ok(
    after.getSize(new Vector3()).x > before.getSize(new Vector3()).x + 300,
  );
  b.state.orientation.set(NaN, 0, 0, 1);
  assert.equal(
    freeWorldEnvelope(
      b,
      createHierarchyMotionPhase([b], [], 0.04).paths.get(b),
    ),
    undefined,
  );
});
