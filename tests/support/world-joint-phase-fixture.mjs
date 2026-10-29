/** Procedural NONCAR/WORLD joint contact fixture; contains no original assets. */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { parseNonCarMechanics } from "../../src/noncars.ts";
import { createNonCarBody } from "../../src/physics/noncar-body.ts";
import {
  createBallJoint,
  createHingeJoint,
  createTranslationJoint,
} from "../../src/physics/joint.ts";
import { createHierarchyMotionPhase } from "../../src/physics/hierarchy-motion.ts";
import {
  recoverWorldContacts,
  transformHull,
} from "../../src/physics/geometry.ts";
import { buildBoxHull } from "../../src/physics/box-hull.ts";
import { VehicleSimulation } from "../../src/physics/simulation.ts";
import { WorldCollision } from "../../src/world.ts";

export const STEP = 0.04;
export const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);

export function worldJointFixture({
  mass = 0.5,
  halfDepth = 0.02,
  frame = new Quaternion(),
  translation = v(),
  clearance = 0.00001,
  omega = 0.5,
  prior = true,
  jointType = "ball",
  movableParent = false,
  wall = false,
  sibling = false,
  extraFloor,
} = {}) {
  const scene = new Group();
  const resources = [];
  function faceMesh(name, vertices) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.userData.sourceFaceFlags = new Uint8Array([7, 7]);
    const material = new MeshBasicMaterial({ name: "5SNOW64.MAT" });
    material.userData.c2Flags = 37;
    const mesh = new Mesh(geometry, material);
    mesh.name = name;
    mesh.quaternion.copy(frame);
    mesh.position.copy(translation);
    scene.add(mesh);
    resources.push(geometry, material);
    return mesh;
  }
  const floor = faceMesh(
    "qualified floor",
    [-4, 0, -4, -4, 0, 4, 4, 0, 4, -4, 0, -4, 4, 0, 4, 4, 0, -4],
  );
  const wallMesh = wall
    ? faceMesh(
        "new wall",
        [
          -4, -4, 0.024, -4, 4, 0.024, 4, 4, 0.024, -4, -4, 0.024, 4, 4, 0.024,
          4, -4, 0.024,
        ],
      )
    : undefined;
  const extraFloorMesh =
    extraFloor === undefined
      ? undefined
      : faceMesh("other floor", [
          -4,
          extraFloor,
          -4,
          -4,
          extraFloor,
          4,
          4,
          extraFloor,
          4,
          -4,
          extraFloor,
          -4,
          4,
          extraFloor,
          4,
          4,
          extraFloor,
          -4,
        ]);
  const actor = new Group();
  actor.name = "&44C0001";
  actor.position.copy(
    v(0, clearance, 0).applyQuaternion(frame).add(translation),
  );
  actor.quaternion.copy(frame);
  scene.add(actor);
  const mechanics = parseNonCarMechanics(
    `101\n44\n0,.12,0\n0,.12,0\n1\nbox\n-.02,0,${-halfDepth}\n.02,.24,${halfDepth}\n${mass},${mass}\n.04,.24,${2 * halfDepth}\n30\n.3\n0\nEND`,
    "procedural-world-joint",
  );
  mechanics.worldFriction = mechanics.objectFriction = 0;
  const body = createNonCarBody(actor, mechanics);
  const parent = {
    state: {
      position: v(),
      orientation: new Quaternion(),
      velocity: v(),
      angularVelocity: v(),
    },
    properties: {
      mass: 1,
      inertia: v(1, 1, 1),
      centerOfMass: v(),
      worldFriction: 0,
      immovable: !movableParent,
      rotationLocked: true,
    },
  };
  const childAnchor = v(0, 0.12, 0);
  const anchor = childAnchor.clone().applyQuaternion(frame).add(actor.position);
  if (jointType === "ball")
    body.joint = createBallJoint(body, parent, childAnchor, anchor);
  else if (jointType === "hinge")
    body.joint = createHingeJoint(
      body,
      parent,
      childAnchor,
      anchor,
      v(1),
      v(1).applyQuaternion(frame),
    );
  else if (jointType === "translation")
    body.joint = createTranslationJoint(
      body,
      parent,
      childAnchor,
      anchor,
      v(0, 1),
      1,
    );
  if (jointType === "none") {
    // createNonCarBody supplies the ordinary authored WORLD joint by default.
    // A genuinely free-body control must explicitly remove that attachment.
    body.joint = undefined;
    body.attached = false;
  }
  const simulation = new VehicleSimulation(new WorldCollision(scene), scene);
  simulation.addNonCar(body);
  if (!simulation.admitNonCar(body, { wake: true, resetVelocity: false }))
    throw Error("NONCAR admission failed");
  body.state.position.copy(actor.position);
  body.state.orientation.copy(frame);
  body.state.velocity.set(0, 0, 0);
  body.state.angularVelocity.copy(v(omega).applyQuaternion(frame));
  body.properties.immovable = false;
  body.actor.userData.noncarPulled = true;
  body.worldRecovery = body.worldOverlapDetected = prior;
  body.overlapRecovery = body.overlapDetected = false;
  body.motor.sleeping = false;
  if (sibling)
    body.hulls.push(buildBoxHull(v(-0.02, 0.005, 0.38), v(0.02, 0.045, 0.42)));

  const fixture = {
    scene,
    simulation,
    body,
    parent,
    frame,
    translation,
    floor,
    wallMesh,
    extraFloorMesh,
    capture() {
      const phase = createHierarchyMotionPhase(
        [body],
        body.joint ? [body.joint] : [],
        STEP,
      );
      simulation.hierarchyMotion = phase;
      phase.writeCandidates([body]);
      return phase;
    },
    oldRecovery(hullIndex = 0, surfaces) {
      const hull = body.hulls[hullIndex];
      const old = transformHull(
        hull,
        body.state.position,
        body.state.orientation,
      );
      const next = transformHull(
        hull,
        body.state.predictedPosition,
        body.state.predictedOrientation,
      );
      const faces =
        surfaces ??
        simulation
          .facesNearBody(body, body.hulls, true)
          .filter((surface) => !surface.owner);
      const center = body.properties.centerOfMass
        .clone()
        .applyQuaternion(body.state.orientation)
        .add(body.state.position);
      return recoverWorldContacts(
        old,
        next,
        simulation.recoverySurfaces(faces),
        center,
      );
    },
    source() {
      return simulation.computeWorldContacts(body, body.hulls);
    },
    guard() {
      return simulation.computeAdvanceWorldContacts(body, false);
    },
    dispose() {
      simulation.dispose();
      for (const resource of resources) resource.dispose();
    },
  };
  fixture.capture();
  return fixture;
}

/** Axis-aligned principal spin: independent native quantized rotation + anchor projection. */
export function independentBallCandidate(fixture, omega = 0.5) {
  const { body, frame, parent } = fixture;
  const angle =
    (Math.trunc(Math.abs(omega) * STEP * 10430.378350470453) & 0xffff) *
    ((2 * Math.PI) / 65536);
  const orientation = frame
    .clone()
    .multiply(new Quaternion().setFromAxisAngle(v(Math.sign(omega)), angle));
  const anchor = body.joint.parentAnchor
    .clone()
    .applyQuaternion(parent.state.orientation)
    .add(parent.state.position);
  return {
    orientation,
    position: anchor.sub(
      body.joint.childAnchor.clone().applyQuaternion(orientation),
    ),
  };
}
