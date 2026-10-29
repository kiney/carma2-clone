/** Redistributable procedural geometry; no original assets or captured game state. */
import {
  BufferGeometry,
  DoubleSide,
  FrontSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { parseNonCarMechanics } from "../../src/noncars.ts";
import { createNonCarBody } from "../../src/physics/noncar-body.ts";
import { createHierarchyMotionPhase } from "../../src/physics/hierarchy-motion.ts";
import { VehicleSimulation } from "../../src/physics/simulation.ts";
import { WorldCollision } from "../../src/world.ts";
import { DEFAULT_SURFACE } from "../../src/physics/surfaces.ts";

export const DT = 0.04;
export const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
export const identity = () => new Quaternion();

export function kineticEnergy(body) {
  const localOmega = body.state.angularVelocity
    .clone()
    .applyQuaternion(body.state.orientation.clone().invert());
  return (
    0.5 * body.properties.mass * body.state.velocity.lengthSq() +
    0.5 * localOmega.dot(localOmega.clone().multiply(body.properties.inertia))
  );
}

export function rigidBody({
  mass = 2,
  velocity = v(),
  omega = v(),
  rotation = identity(),
  position = v(),
  inertia = v(mass, mass, mass),
  kind = "car",
} = {}) {
  return {
    kind,
    state: {
      position: position.clone(),
      orientation: rotation.clone(),
      velocity: velocity.clone(),
      angularVelocity: omega.clone(),
    },
    properties: {
      mass,
      inertia: inertia.clone(),
      centerOfMass: v(),
      worldFriction: 0,
      objectFriction: 0,
    },
  };
}

export function worldContact(a, point, normal, b) {
  return { a, b, point, normal, faceFriction: 0 };
}

export function makeRunawayFixture({
  slope = 1e-6,
  mass = 0.05,
  spin = 20,
  rotation = identity(),
  translation = v(),
  twoSided = true,
  velocity = v(-3, 0, 1),
  position = v(),
  wall = false,
  wallFriction = 0,
} = {}) {
  const scene = new Group();
  const resources = [];
  function triangle(vertices) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.userData.sourceFaceFlags = new Uint8Array([7]);
    const material = new MeshBasicMaterial({
      side: twoSided ? DoubleSide : FrontSide,
    });
    if (twoSided) material.userData.c2Flags = 4096;
    const mesh = new Mesh(geometry, material);
    mesh.quaternion.copy(rotation);
    mesh.position.copy(translation);
    scene.add(mesh);
    resources.push(geometry, material);
  }
  triangle([-10, 10 * slope, -10, 10, -10 * slope, 10, 10, -10 * slope, -10]);
  if (wall) {
    triangle([0, -10, -10, 0, 10, -10, 0, 10, 10]);
    triangle([0, -10, -10, 0, 10, 10, 0, -10, 10]);
  }
  const actor = new Group();
  actor.name = "&01!0001.ACT";
  actor.position.copy(position).applyQuaternion(rotation).add(translation);
  actor.quaternion.copy(rotation);
  scene.add(actor);
  const mechanics = parseNonCarMechanics(
    `101\n1\n.0025,.1535,0\n.0025,0,0\n1\nbox\n-.05,0,-.055\n.055,.307,.055\n${mass},${mass}\n.105,.307,.11\n0\n0\n0\nEND`,
  );
  const body = createNonCarBody(actor, mechanics);
  const simulation = new VehicleSimulation(
    new WorldCollision(scene, [{ ...DEFAULT_SURFACE, wallFriction }]),
    scene,
  );
  simulation.addNonCar(body);
  if (!simulation.admitNonCar(body, { wake: true }))
    throw new Error("Fixture noncar admission failed");
  body.worldRecovery = body.overlapRecovery = false;
  body.state.velocity.copy(velocity).applyQuaternion(rotation);
  body.state.angularVelocity.set(0, 0, spin).applyQuaternion(rotation);
  return {
    scene,
    simulation,
    body,
    rotation,
    dispose() {
      simulation.dispose();
      for (const resource of resources) resource.dispose();
    },
  };
}

/** Read the two real emitters independently; this is deliberately not a merge. */
export function collectEmitterControls(fixture) {
  const { body, simulation } = fixture;
  simulation.hierarchyMotion = createHierarchyMotionPhase([body], [], DT);
  simulation.hierarchyMotion.writeCandidates([body]);
  const source = simulation.computeWorldContacts(body, body.hulls);
  const position = body.state.predictedPosition.clone();
  const orientation = body.state.predictedOrientation.clone();
  const guard = simulation.computeAdvanceWorldContacts(body, false).contacts;
  body.state.predictedPosition.copy(position);
  body.state.predictedOrientation.copy(orientation);
  return { source, guard };
}

/**
 * The independently specified OLD-space packet that exposes solver dependence.
 * Points follow the box and shallow-plane geometry in the root-cause note.
 * Keeping this packet independent prevents an admission fix from hiding a
 * numerical failure in public resolveContacts.
 */
export function contradictoryPacket(
  body,
  { slope = 1e-6, offset = 0.00243293, rotation = identity() } = {},
) {
  const worldPoint = (point) =>
    point.applyQuaternion(rotation).add(body.state.position);
  const n = v(slope, 1, 0).normalize().applyQuaternion(rotation);
  return [
    worldContact(body, worldPoint(v(-0.05, 0, -0.055)), n.clone().negate()),
    worldContact(body, worldPoint(v(-0.05, offset, -0.055)), n.clone()),
  ];
}

/** Observe the real production merge before normal preparation, without replacing it. */
export function observeProductionRows(simulation) {
  const packets = [];
  const prepare = simulation.preparePedContacts;
  simulation.preparePedContacts = function (rows) {
    packets.push(
      rows.map((row) => ({
        ...row,
        point: row.point.clone(),
        normal: row.normal.clone(),
      })),
    );
    return prepare.call(this, rows);
  };
  return packets;
}
