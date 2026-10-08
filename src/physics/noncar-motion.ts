import { Vector3 } from "three";
import type { NonCarMechanics, NonCarWorldJoint } from "../noncars";
import type { RigidBody } from "./contact";

/** Local original HW: NonCarCalcForce 0x418270, MakeLiftGoUp 0x418250,
 * ApplyPhysicsToCars 0x4158b0, CalcForce wheel support 0x418870.
 * This module applies forces/counters only. The caller owns collision impulses,
 * world joints, travel limits, transform integration and sleeping broad phase. */
export const NONCAR_STEP = 0.04;
const METRES_PER_UNIT = 6.9;
const GRAVITY = 10;
const MOTOR_DELTA = (NONCAR_STEP * GRAVITY) / METRES_PER_UNIT;
export const NONCAR_FLAGS = {
  translation: 0x10000,
  riseWhenHit: 0x20000,
  riseWhenDrivenOn: 0x40000,
  blockCamera: 0x80000,
  forceApplied: 0x100000,
  sparky: 0x200000,
} as const;

export interface NonCarMotorState {
  /** Low byte: forward pushes. Next byte: return pushes. Upper bits: flags. */
  flags: number;
  pauseUntilMs: number;
  sleeping: boolean;
}

export function createNonCarMotorState(
  mechanics: NonCarMechanics,
): NonCarMotorState {
  return {
    flags:
      (mechanics.worldJoint?.kind === "translation"
        ? NONCAR_FLAGS.translation
        : 0) |
      (mechanics.riseWhenHit ? NONCAR_FLAGS.riseWhenHit : 0) |
      (mechanics.riseWhenDrivenOn ? NONCAR_FLAGS.riseWhenDrivenOn : 0) |
      (mechanics.blockCamera ? NONCAR_FLAGS.blockCamera : 0) |
      (mechanics.sparky ? NONCAR_FLAGS.sparky : 0),
    pauseUntilMs: 0,
    sleeping: true,
  };
}

/** Explicit smash/delayed activation also uses this exact byte assignment. */
export function activateNonCarMotor(motor: NonCarMotorState): void {
  motor.flags = (motor.flags & 0xffffff00) | 1;
  motor.sleeping = false;
}

function motorIdle(motor: NonCarMotorState): boolean {
  return (motor.flags & 0xffff) === 0 && motor.pauseUntilMs === 0;
}

/** Generic pair collision wakes objects; flag bit2 identifies body/body contact.
 * World contacts use a different bit and do not count as RISE_WHEN_HIT. */
export function notifyNonCarBodyContact(
  mechanics: NonCarMechanics,
  motor: NonCarMotorState,
): void {
  motor.sleeping = false;
  if (
    mechanics.worldJoint?.kind === "translation" &&
    mechanics.riseWhenHit &&
    motorIdle(motor)
  )
    activateNonCarMotor(motor);
}

/** Original activation requires all four wheel support objects to be identical. */
export function notifyNonCarDrivenOn(
  mechanics: NonCarMechanics,
  motor: NonCarMotorState,
  wheelOwners: readonly unknown[],
  owner: object,
): boolean {
  if (
    mechanics.worldJoint?.kind !== "translation" ||
    !mechanics.riseWhenDrivenOn ||
    !motorIdle(motor) ||
    wheelOwners.length !== 4 ||
    !wheelOwners.every((hit) => hit === owner)
  )
    return false;
  activateNonCarMotor(motor);
  return true;
}

/** Strict expiry is source behavior: the motor remains paused at its deadline. */
export function updateNonCarMotorWake(
  motor: NonCarMotorState,
  nowMs: number,
): void {
  if (!Number.isFinite(nowMs) || nowMs < 0)
    throw new Error("Invalid noncar clock");
  if (
    motor.flags & NONCAR_FLAGS.translation &&
    motor.pauseUntilMs !== 0 &&
    nowMs > motor.pauseUntilMs
  ) {
    motor.pauseUntilMs = 0;
    motor.flags = (motor.flags & 0xffff0000) | 0x100;
    motor.sleeping = false;
  }
  if (motor.flags & 0xffff) motor.sleeping = false;
}

export interface NonCarForceInput {
  nowMs: number;
  /** Snapshot before the preceding contact solve, PHILPrepareObject 0x4b9780.
   * The current velocity includes that solve's impulses. */
  previousVelocity: Vector3;
  /** Original collision_flag: bit2 pair, bit1 world. */
  collisionFlags?: number;
  /** Special-volume gravity multiplier; default original dry gravity. */
  gravityScale?: number;
}

/** Fixed original 40 ms force step. Returns whether forces were evaluated. */
export function applyNonCarMotionForces(
  mechanics: NonCarMechanics,
  body: RigidBody,
  motor: NonCarMotorState,
  input: NonCarForceInput,
): boolean {
  updateNonCarMotorWake(motor, input.nowMs);
  const pairContact = !!((input.collisionFlags ?? 0) & 2);
  if (pairContact) notifyNonCarBodyContact(mechanics, motor);
  if (motor.sleeping) return false;
  const gravity = input.gravityScale ?? 1;
  if (!Number.isFinite(gravity)) throw new Error("Invalid noncar gravity");
  const velocity = body.state.velocity;
  const joint = mechanics.worldJoint;
  // The source measures velocities from the preceding collision solve, before
  // this step's gravity/motor increment. Rotating lifts use the authored axis.
  const axis =
    joint?.kind === "translation"
      ? new Vector3(...joint.axis).applyQuaternion(body.state.orientation)
      : undefined;
  const axialVelocity = axis?.dot(velocity) ?? 0;
  const axialChange = axis
    ? axialVelocity - axis.dot(input.previousVelocity)
    : 0;
  motor.flags |= NONCAR_FLAGS.forceApplied;
  velocity.y -= MOTOR_DELTA * gravity;
  if (joint?.kind !== "translation" || !axis) return true;

  const forward = motor.flags & 0xff;
  const returning = (motor.flags >>> 8) & 0xff;
  const pushes = (mechanics.numberOfPushes ?? 0) & 0xff; // original byte storage
  let motorDelta = 0;
  let resistance = joint.forwardResistance;
  if (forward === 0 && (motor.sleeping || motor.pauseUntilMs === 0)) {
    if (returning !== 0 || (!motor.sleeping && motor.pauseUntilMs === 0)) {
      resistance = joint.reverseResistance;
      motorDelta = -joint.reverseAcceleration * MOTOR_DELTA;
      if (axialChange > 0.05 && axialVelocity > -0.005) {
        if (returning < pushes && pairContact) {
          motor.flags =
            (motor.flags & 0xffff00ff) | (((returning + 1) & 0xff) << 8);
        } else {
          motor.flags &= 0xffff00ff;
          stop(body, motor);
          motorDelta = 0;
        }
      }
    }
  } else {
    motorDelta = joint.forwardAcceleration * MOTOR_DELTA;
    if (axialChange < -0.05 && axialVelocity < 0.005) {
      if (motor.pauseUntilMs === 0 || forward === 1)
        motor.pauseUntilMs = input.nowMs + joint.pauseAtTop;
      if (forward < pushes && pairContact) {
        if (forward !== 0)
          motor.flags = (motor.flags & 0xffffff00) | (forward + 1);
      } else {
        motor.flags &= 0xffffff00;
        stop(body, motor);
        motorDelta = 0;
      }
    }
  }
  velocity.addScaledVector(axis, motorDelta);
  // Binary loader 0x487d60 has FCHS at 0x488814/0x48883e. rec2's positive
  // exponent is incorrect; actual decay is exp(-0.43 * authored resistance).
  velocity.multiplyScalar(Math.exp(-0.43 * resistance));
  return true;
}

function stop(body: RigidBody, motor: NonCarMotorState): void {
  motor.sleeping = true;
  body.state.velocity.set(0, 0, 0);
  body.state.angularVelocity.set(0, 0, 0);
}

/** Joint limit10 compares the summed contact torque impulse magnitude squared
 * to (authored KN m / 6.9)^2 before applying the candidate impulses: 0x4bac60. */
export function nonCarTorqueExceedsThreshold(
  mechanics: NonCarMechanics,
  torqueImpulse: Vector3,
): boolean {
  return (
    torqueImpulse.lengthSq() > (mechanics.minimumTorque / METRES_PER_UNIT) ** 2
  );
}

/** TestNonCarSnapOff 0x420380 compares the actor's world-up projection to the
 * authored bend cosine. Explicit zero-bend world joints survive snap callbacks. */
export function nonCarBendExceedsThreshold(
  mechanics: NonCarMechanics,
  body: RigidBody,
): boolean {
  if (mechanics.snapAngleDegrees === 0) return false;
  // BRender's angle conversion truncates a revolution into 65536 units.
  const angle =
    ((Math.trunc((mechanics.snapAngleDegrees * 65536) / 360) & 0xffff) *
      Math.PI *
      2) /
    65536;
  return (
    new Vector3(0, 1, 0).applyQuaternion(body.state.orientation).y <
    Math.cos(angle)
  );
}

/** TumbleObjectWithV 0x417fd0. The caller supplies the selected world face
 * normal and shape extents; the original obtains them from its contact cache.
 * Threshold and speed are compared directly in model units, without conversion. */
export function applyNonCarTumble(
  body: RigidBody,
  tumble: { factor: number; threshold: number },
  boundsSize: Vector3,
  faceNormal: Vector3,
  contactOccurred: boolean,
  sleeping = false,
): boolean {
  if (
    (!contactOccurred && !sleeping) ||
    body.properties.rotationLocked ||
    tumble.factor === 0
  )
    return false;
  const speed = body.state.velocity.length();
  if (speed < tumble.threshold) return false;
  // DRVector3SafeCross 0x403f90 uses a perpendicular basis when normal and
  // velocity are parallel, then TumbleObject normalizes or falls back to x.
  const axis = new Vector3().crossVectors(faceNormal, body.state.velocity);
  const crossEpsilon = 2.384185791015625e-6;
  if (
    Math.abs(axis.x) < crossEpsilon &&
    Math.abs(axis.y) < crossEpsilon &&
    Math.abs(axis.z) < crossEpsilon
  ) {
    const abs = faceNormal
      .clone()
      .set(
        Math.abs(faceNormal.x),
        Math.abs(faceNormal.y),
        Math.abs(faceNormal.z),
      );
    const basis =
      abs.x <= abs.y && abs.x <= abs.z
        ? new Vector3(1, 0, 0)
        : abs.y <= abs.x && abs.y <= abs.z
          ? new Vector3(0, 1, 0)
          : new Vector3(0, 0, 1);
    axis.crossVectors(faceNormal, basis);
  }
  if (axis.length() <= 2.384185791015625e-7) axis.set(1, 0, 0);
  else axis.normalize();
  if (body.state.angularVelocity.dot(axis) > 1.5) return false;
  const localAxis = axis.applyQuaternion(
    body.state.orientation.clone().invert(),
  );
  const inertia = body.properties.inertia;
  // Native 0x588650 is 0.5 (half the bounding extent), not a timestep.
  const torqueScale =
    body.properties.mass *
    tumble.factor *
    0.1 *
    (speed - tumble.threshold) *
    0.5;
  const delta = new Vector3(
    (localAxis.x * boundsSize.x) / inertia.x,
    (localAxis.y * boundsSize.y) / inertia.y,
    (localAxis.z * boundsSize.z) / inertia.z,
  )
    .multiplyScalar(torqueScale)
    .applyQuaternion(body.state.orientation);
  body.state.angularVelocity.add(delta);
  if (body.state.angularVelocity.lengthSq() > 400)
    body.state.angularVelocity.setLength(20);
  return true;
}

export type NonCarTranslationJoint = Extract<
  NonCarWorldJoint,
  { kind: "translation" }
>;
