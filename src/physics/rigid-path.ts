import { Quaternion, Vector3 } from "three";
import type { RigidBody } from "./contact";
import { advanceRigidBody } from "./integrate";
import type { GuardPose, PosePath } from "./pair-guard";

/** Capture one guard phase's committed pose/motion. Create a fresh path after
 * a solve, wake-up or other source mutation; cached poses belong to this phase.
 * Properties retain the original moving-probe reference semantics. */
export function createRigidBodyPosePath(
  body: RigidBody,
  stepSeconds: number,
  worldFraction = 1,
): PosePath {
  if (body.properties.immovable) {
    const pose: GuardPose = {
      position: body.state.position.clone(),
      orientation: body.state.orientation.clone(),
    };
    const path: PosePath = () => pose;
    path.stable = true;
    path.constantPose = pose;
    path.angularTravel = 0;
    return path;
  }
  const probe = {
    ...body,
    state: {
      ...body.state,
      position: body.state.position.clone(),
      orientation: body.state.orientation.clone(),
      velocity: body.state.velocity.clone(),
      angularVelocity: body.state.angularVelocity.clone(),
      predictedPosition: new Vector3(),
      predictedOrientation: new Quaternion(),
    },
  };
  const cache = new Map<number, GuardPose>();
  const path: PosePath = (fraction) => {
    let pose = cache.get(fraction);
    if (!pose) {
      // Keep candidate() semantics for the shared properties object, including
      // an immovability change during a caller-owned moving path's lifetime.
      if (probe.properties.immovable) {
        probe.state.predictedPosition.copy(probe.state.position);
        probe.state.predictedOrientation.copy(probe.state.orientation);
      } else
        advanceRigidBody(probe, stepSeconds * worldFraction * fraction, true);
      pose = {
        position: probe.state.predictedPosition.clone(),
        orientation: probe.state.predictedOrientation.clone(),
      };
      cache.set(fraction, pose);
    }
    return pose;
  };
  path.stable = true;
  // Momentum / smallest principal inertia bounds all midpoint angular rates,
  // including full turns hidden by identical endpoint quaternions.
  const inertia = body.properties.inertia;
  path.angularTravel = body.properties.rotationLocked
    ? 0
    : (body.state.angularVelocity
        .clone()
        .applyQuaternion(body.state.orientation.clone().invert())
        .multiply(inertia)
        .length() /
        Math.min(inertia.x, inertia.y, inertia.z)) *
      stepSeconds *
      worldFraction;
  return path;
}
