import { Quaternion, Vector3 } from "three";
import type { RigidBody } from "./contact";

// Local HW 0x4b8fd0, 0x4c1990, 0x4c1cc0. BRender angles are unsigned 16-bit turns.
const RAD_TO_ANGLE = 10430.378350470453; // f64 0x589790
const ANGLE_TO_RAD = (2 * Math.PI) / 65536;
const SMALL_ROTATION_SQUARED = 1e-7; // f64 0x589880
const FIRST_ORDER_LIMIT = 0.00800000037997961; // f32 0x589888
const SUBSTEP_FACTOR = 31.249998092651367; // f32 0x58988c
function rotation(omega: Vector3, dt: number, half = false): Quaternion {
  const rate = omega.length();
  if (rate === 0) return new Quaternion();
  let angle = Math.trunc(rate * dt * RAD_TO_ANGLE) & 0xffff;
  if (half) angle >>>= 1;
  return new Quaternion().setFromAxisAngle(
    omega.clone().multiplyScalar(1 / rate),
    angle * ANGLE_TO_RAD,
  );
}
function divide(v: Vector3, inertia: Vector3): Vector3 {
  return v.set(v.x / inertia.x, v.y / inertia.y, v.z / inertia.z);
}

/** COM translation and momentum-preserving body rotation at the original step.
 * Candidate prediction leaves committed transform and velocities intact.
 */
export function advanceRigidBody(
  body: RigidBody,
  dt: number,
  writeCandidate = false,
): void {
  if (!(dt >= 0 && Number.isFinite(dt)))
    throw new Error("Rigid step must be finite and nonnegative");
  const { state, properties } = body;
  const orientation = state.orientation.clone();
  const oldCOM = properties.centerOfMass
    .clone()
    .applyQuaternion(orientation)
    .add(state.position);
  const omega = state.angularVelocity
    .clone()
    .applyQuaternion(orientation.clone().invert());
  const angleSquared = omega.lengthSq() * dt * dt;
  if (!properties.rotationLocked && angleSquared >= SMALL_ROTATION_SQUARED) {
    const highAngle = angleSquared > FIRST_ORDER_LIMIT;
    const requestedSteps = highAngle
      ? Math.trunc(Math.sqrt(angleSquared * SUBSTEP_FACTOR)) + 1
      : 1;
    const step = dt / requestedSteps;
    for (let i = 0; i < Math.min(requestedSteps, 400); i++) {
      const momentum = omega.clone().multiply(properties.inertia);
      let increment: Quaternion;
      if (highAngle) {
        const halfwayMomentum = momentum
          .clone()
          .applyQuaternion(rotation(omega, step, true).invert());
        const midpointOmega = divide(halfwayMomentum, properties.inertia);
        increment = rotation(midpointOmega, step);
      } else {
        if (omega.length() * step < 0.0001) break;
        increment = rotation(omega, step);
      }
      orientation.multiply(increment).normalize();
      divide(
        momentum.applyQuaternion(increment.clone().invert()),
        properties.inertia,
      );
      omega.copy(momentum);
    }
  }
  const position = oldCOM
    .addScaledVector(state.velocity, dt)
    .sub(properties.centerOfMass.clone().applyQuaternion(orientation));
  if (writeCandidate) {
    (state.predictedPosition ??= new Vector3()).copy(position);
    (state.predictedOrientation ??= new Quaternion()).copy(orientation);
  } else {
    state.position.copy(position);
    state.orientation.copy(orientation);
    if (!properties.rotationLocked)
      state.angularVelocity.copy(omega.applyQuaternion(orientation));
  }
}
