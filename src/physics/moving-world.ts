import { Object3D, Quaternion, Vector3 } from "three";
import type { CollisionHull, HullContact, WorldSurfaceOptions } from "./geometry";
import { sweepHullTriangle, transformHull } from "./geometry";
import type { RigidBody, RigidProperties, RigidState } from "./contact";

export interface MovingWorldBody extends RigidBody {
  kind: "moving-world";
  actor: Object3D;
  state: RigidState & { predictedPosition: Vector3; predictedOrientation: Quaternion };
}
export interface MovingWorldTriangle extends WorldSurfaceOptions {
  a: Vector3;
  b: Vector3;
  c: Vector3;
  owner: MovingWorldBody;
}

/** Kinematic rigid pose for a source world actor. The body is an immovable
 * solver partner; its finite pose velocity still contributes to contact speed. */
export function createMovingWorldBody(actor: Object3D): MovingWorldBody {
  actor.updateWorldMatrix(true, false);
  const position = new Vector3(), orientation = new Quaternion(), scale = new Vector3();
  actor.matrixWorld.decompose(position, orientation, scale);
  return {
    kind: "moving-world",
    actor,
    state: {
      position,
      orientation,
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
      predictedPosition: position.clone(),
      predictedOrientation: orientation.clone(),
    },
    properties: {
      mass: 1,
      inertia: new Vector3(1, 1, 1),
      centerOfMass: new Vector3(),
      worldFriction: 0,
      objectFriction: 0,
      immovable: true,
      rotationLocked: true,
    },
  };
}

/** Set the target world pose and derive finite linear/angular velocity from the
 * last committed pose. Inputs are absolute poses, not per-tick deltas. */
export function prepareMovingWorldPose(
  body: MovingWorldBody,
  targetPosition: Vector3,
  targetOrientation: Quaternion,
  dt: number,
): void {
  body.state.predictedPosition!.copy(targetPosition);
  body.state.predictedOrientation!.copy(targetOrientation).normalize();
  if (!(dt > 0) || !Number.isFinite(dt)) {
    body.state.velocity.set(0, 0, 0);
    body.state.angularVelocity.set(0, 0, 0);
    return;
  }
  body.state.velocity.subVectors(targetPosition, body.state.position).divideScalar(dt);
  const delta = body.state.predictedOrientation!.clone().multiply(body.state.orientation.clone().invert()).normalize();
  if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
  const halfAngle = Math.acos(Math.max(-1, Math.min(1, delta.w)));
  const sinHalf = Math.sin(halfAngle);
  if (Math.abs(sinHalf) < 1e-10 || halfAngle === 0) body.state.angularVelocity.set(0, 0, 0);
  else body.state.angularVelocity.set(delta.x / sinHalf, delta.y / sinHalf, delta.z / sinHalf).multiplyScalar((2 * halfAngle) / dt);
}

/** Advance the committed kinematic pose after contact resolution. Rendering
 * owns actor transforms; this updates only the solver's old-pose reference. */
export function commitMovingWorldPose(body: MovingWorldBody): void {
  body.state.position.copy(body.state.predictedPosition!);
  body.state.orientation.copy(body.state.predictedOrientation!);
}

function toLocalHull(
  hull: CollisionHull,
  bodyPosition: Vector3,
  bodyOrientation: Quaternion,
  worldPosition: Vector3,
  worldOrientation: Quaternion,
): CollisionHull {
  const inverseWorld = worldOrientation.clone().invert();
  const position = bodyPosition.clone().sub(worldPosition).applyQuaternion(inverseWorld);
  const orientation = inverseWorld.multiply(bodyOrientation).normalize();
  return transformHull(hull, position, orientation);
}

/** Independently expressed finite-triangle CCD for a moving source actor.
 * Both body hull poses are converted into the surface owner's old/target local
 * frames, then the existing source-feature world-triangle sweep is reused. */
export function sweepHullMovingTriangle(
  body: RigidBody,
  hull: CollisionHull,
  surface: MovingWorldTriangle,
): HullContact | null {
  const owner = surface.owner;
  const oldPosition = owner.state.position, oldOrientation = owner.state.orientation;
  const targetPosition = owner.state.predictedPosition ?? oldPosition;
  const targetOrientation = owner.state.predictedOrientation ?? oldOrientation;
  const oldHull = toLocalHull(hull, body.state.position, body.state.orientation, oldPosition, oldOrientation);
  const predictedHull = toLocalHull(
    hull,
    body.state.predictedPosition ?? body.state.position,
    body.state.predictedOrientation ?? body.state.orientation,
    targetPosition,
    targetOrientation,
  );
  const relative = sweepHullTriangle(oldHull, predictedHull, surface.a, surface.b, surface.c, surface);
  if (!relative) return null;
  const points = relative.points.map((point) => point.clone().applyQuaternion(oldOrientation).add(oldPosition));
  const pointsB = (relative.pointsB ?? relative.points).map((point) => point.clone().applyQuaternion(oldOrientation).add(oldPosition));
  return {
    ...relative,
    normal: relative.normal.clone().applyQuaternion(oldOrientation).normalize(),
    pointNormals: relative.pointNormals?.map(normal => normal.clone().applyQuaternion(oldOrientation).normalize()),
    points,
    pointsB,
  };
}
