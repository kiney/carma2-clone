import { Mesh, Object3D, Quaternion, Vector3 } from "three";
import type { NonCarMechanics } from "../noncars";
import type { RigidBody } from "./contact";
import { buildHull, hullsBounds, type CollisionHull } from "./geometry";
import { buildBoxHull } from "./box-hull";
import { buildWireHull } from "./wire-hull";
import { sealCollisionHulls } from "./immutable-hulls";
import { createBallJoint, type RigidJoint } from "./joint";
import { createNonCarMotorState, type NonCarMotorState } from "./noncar-motion";
import type { BodyVolumeState } from "./simulation";

export interface NonCarBody extends RigidBody {
  kind: "noncar";
  actor: Object3D;
  mechanics: NonCarMechanics;
  hulls: CollisionHull[];
  motor: NonCarMotorState;
  joint?: RigidJoint;
  attached: boolean;
  pendingFreeMass?: boolean;
  previousVelocity: Vector3;
  collisionFlags: number;
  originalPosition: Vector3;
  originalOrientation: Quaternion;
  specialVolume?: BodyVolumeState;
  overlapRecovery: boolean;
  overlapDetected: boolean;
  worldRecovery: boolean;
  worldOverlapDetected: boolean;
}

/** The source creates an actor instance from its indexed NONCARS definition;
 * shape vertices and mass remain in authored model units/tonnes. */
export function createNonCarBody(
  actor: Object3D,
  mechanics: NonCarMechanics,
  options: { immutableHulls?: boolean } = {},
): NonCarBody {
  actor.userData.dynamicBody = true;
  actor.updateWorldMatrix(true, true);
  const position = new Vector3(),
    orientation = new Quaternion(),
    scale = new Vector3();
  actor.matrixWorld.decompose(position, orientation, scale);
  const hulls = mechanics.shapes.map((shape) => {
    if (shape.kind === "wire")
      return buildWireHull(
        shape.vertices.map((point) => new Vector3(...point).multiply(scale)),
        shape.edges,
      );
    if (shape.kind === "box")
      return buildBoxHull(
        new Vector3(...shape.bounds.min).multiply(scale),
        new Vector3(...shape.bounds.max).multiply(scale),
      );
    if (shape.kind === "sphere") {
      // The existing analytic-sphere TODO remains explicit; original stock
      // props use the same sampled convex helper as detached/car spheres.
      const points: Vector3[] = [];
      for (let ring = 0; ring <= 6; ring++)
        for (let az = 0; az < 12; az++) {
          const a = (ring * Math.PI) / 6,
            b = (az * Math.PI) / 6;
          points.push(
            new Vector3(
              Math.sin(a) * Math.cos(b),
              Math.cos(a),
              Math.sin(a) * Math.sin(b),
            )
              .multiplyScalar(shape.radius)
              .add(new Vector3(...shape.center))
              .multiply(scale),
          );
        }
      return buildHull(points);
    }
    return buildHull(
      shape.vertices.map((point) => new Vector3(...point).multiply(scale)),
    );
  });
  if (options.immutableHulls) sealCollisionHulls(hulls);
  const attached = !!mechanics.worldJoint || mechanics.snapAngleDegrees !== 0;
  const mass =
    actor.name[3] !== "!" && mechanics.snapAngleDegrees !== 0
      ? mechanics.attachedMass
      : mechanics.freeMass;
  const body: NonCarBody = {
    kind: "noncar",
    actor,
    mechanics,
    hulls,
    attached,
    motor: createNonCarMotorState(mechanics),
    previousVelocity: new Vector3(),
    collisionFlags: 0,
    originalPosition: position.clone(),
    originalOrientation: orientation.clone(),
    overlapRecovery: true,
    overlapDetected: false,
    worldRecovery: true,
    worldOverlapDetected: false,
    state: {
      position,
      orientation,
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass,
      inertia: new Vector3(...mechanics.inertiaPerMass).multiplyScalar(mass),
      centerOfMass: new Vector3(...mechanics.centerOfMass).multiply(scale),
      worldFriction: mechanics.worldFriction,
      objectFriction: mechanics.objectFriction,
      rotationLocked: mechanics.infiniteInertia,
      immovable: true,
    },
  };
  // Default breakable props use a ball joint at the attached COM. The native
  // WORLD_HINGE_JOINT loader also creates type1 (second vector is unused).
  const joint = mechanics.worldJoint;
  if (joint?.kind !== "translation" && attached) {
    const local = new Vector3(
      ...(joint?.position ?? mechanics.attachedCenterOfMass),
    );
    const world = local.clone().applyQuaternion(orientation).add(position);
    const parent: RigidBody = {
      state: {
        position: new Vector3(),
        orientation: new Quaternion(),
        velocity: new Vector3(),
        angularVelocity: new Vector3(),
      },
      properties: {
        mass: 1,
        inertia: new Vector3(1, 1, 1),
        centerOfMass: new Vector3(),
        worldFriction: 0,
        immovable: true,
        rotationLocked: true,
      },
    };
    body.joint = createBallJoint(body, parent, local, world);
  }
  if (!hulls.length || hullsBounds(hulls).isEmpty())
    throw new Error(`Noncar ${actor.name}: no solid collision shape`);
  if (body.properties.inertia.toArray().some((v) => v <= 0))
    throw new Error(`Noncar ${actor.name}: zero inertia`);
  return body;
}

/** Installed snap callback420330 clears the joint and velocities. The next
 * NonCarCalcForce418270 changes the actor marker and restores its free mass. */
export function releaseNonCar(body: NonCarBody): void {
  body.attached = false;
  body.joint = undefined;
  body.motor.sleeping = false;
  body.properties.immovable = false;
  body.pendingFreeMass = true;
  body.state.velocity.set(0, 0, 0);
  body.state.angularVelocity.set(0, 0, 0);
}

export function finalizeNonCarRelease(body: NonCarBody): void {
  if (!body.pendingFreeMass) return;
  body.pendingFreeMass = false;
  body.actor.name =
    body.actor.name.slice(0, 3) + "!" + body.actor.name.slice(4);
  body.state.velocity.set(0, 0, 0);
  body.state.angularVelocity.set(0, 0, 0);
  body.properties.mass = body.mechanics.freeMass;
  body.properties.inertia
    .fromArray(body.mechanics.inertiaPerMass)
    .multiplyScalar(body.properties.mass);
}

export function nonCarActors(
  root: Object3D,
): Array<{ actor: Object3D; type: number; instance: number }> {
  const result: Array<{ actor: Object3D; type: number; instance: number }> = [];
  root.traverse((actor) => {
    if (actor instanceof Mesh) return;
    const match = /^&(\d{2})[^\d](\d{4})(?:\.act)?$/i.exec(actor.name);
    if (match)
      result.push({
        actor,
        type: Number(match[1]),
        instance: Number(match[2]),
      });
  });
  return result;
}
