/** Procedural collision geometry only; no original assets or capture data. */
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { buildBoxHull } from "../../src/physics/box-hull.ts";
import {
  DeferredContactFriction,
  resolveContacts,
} from "../../src/physics/contact.ts";
import { createHierarchyMotionPhase } from "../../src/physics/hierarchy-motion.ts";
import { VehicleSimulation } from "../../src/physics/simulation.ts";
import { WorldCollision } from "../../src/world.ts";

export const v = (...values) => new Vector3(...values);
export const DT = 0.04;
export const SEAM_DEGREES = 1.33;

export function kineticEnergy(body) {
  const local = body.state.angularVelocity
    .clone()
    .applyQuaternion(body.state.orientation.clone().invert());
  return (
    0.5 * body.properties.mass * body.state.velocity.lengthSq() +
    0.5 * local.dot(local.clone().multiply(body.properties.inertia))
  );
}

export function makeShallowSeamFixture({ rotation = -0.04, y = 0 } = {}) {
  const root = new Group();
  const geometry = new BufferGeometry();
  // Two finite triangles share their complete diagonal. Raising only the
  // second triangle's third vertex gives a small, continuous terrain crease.
  const height = Math.tan((SEAM_DEGREES * Math.PI) / 180) * Math.sqrt(200);
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [
        -10,
        0,
        -10,
        10,
        0,
        10,
        10,
        0,
        -10,
        -10,
        0,
        -10,
        -10,
        height,
        10,
        10,
        0,
        10,
      ],
      3,
    ),
  );
  geometry.userData.sourceFaceFlags = new Uint8Array([7, 7]);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  root.add(new Mesh(geometry, material));
  const simulation = new VehicleSimulation(new WorldCollision(root), root);
  const low = v(-0.05, 0, -0.055),
    high = v(0.055, 0.307, 0.055);
  const size = high.clone().sub(low),
    mass = 0.05;
  const body = {
    kind: "noncar",
    mechanics: { ignoreWorldCollisions: false },
    hulls: [buildBoxHull(low, high)],
    properties: {
      mass,
      inertia: v(
        size.y ** 2 + size.z ** 2,
        size.x ** 2 + size.z ** 2,
        size.x ** 2 + size.y ** 2,
      ).multiplyScalar(mass / 12),
      centerOfMass: low.clone().add(high).multiplyScalar(0.5),
      worldFriction: 0,
      objectFriction: 0,
      immovable: false,
      rotationLocked: false,
    },
    state: {
      position: v(0, y, 0),
      orientation: new Quaternion().setFromAxisAngle(v(0, 0, 1), rotation),
      velocity: v(-3, 0, 1),
      angularVelocity: v(0, 0, 20),
    },
  };
  simulation.hierarchyMotion = createHierarchyMotionPhase([body], [], DT);
  simulation.hierarchyMotion.writeCandidates([body]);
  return {
    body,
    simulation,
    dispose() {
      simulation.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Keep real chord and sampled emitters separate so origin is observable. */
export function collectShallowSeamRows({ simulation, body }) {
  const native = simulation.computeWorldContacts(body, body.hulls);
  const position = body.state.predictedPosition.clone();
  const orientation = body.state.predictedOrientation.clone();
  const guard = simulation.computeAdvanceWorldContacts(body, false);
  body.state.predictedPosition.copy(position);
  body.state.predictedOrientation.copy(orientation);
  return { native, sampled: guard.contacts, encounters: guard.encounters };
}

/** Normal-only response isolates admission from deferred friction and clamps. */
export function solveShallowSeamRows(body, rows) {
  body.state.velocity.set(-3, 0, 1);
  body.state.angularVelocity.set(0, 0, 20);
  const before = kineticEnergy(body);
  const impacts = resolveContacts(
    rows,
    DT,
    [],
    undefined,
    new DeferredContactFriction(),
  );
  return {
    energyRatio: kineticEnergy(body) / before,
    largestImpulse: Math.max(0, ...impacts.map((row) => row.normalImpulse)),
    impacts,
  };
}
