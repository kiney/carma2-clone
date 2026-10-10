import { Vector3 } from "three";

export interface OpponentSpeedInput {
  /** Requested path speed in metres per second. */
  desiredSpeed: number;
  /** Physics velocity in model units per second. */
  velocity: Vector3;
  /** Native category/powerup factor. Zero means the frozen-opponent case. */
  factor: number;
  engineDamage: number;
  transmissionDamage: number;
  mass: number;
  dtMs: number;
}

export interface OpponentSpeedResult {
  /** Pre-mass controller acceleration in metres per second squared. */
  acceleration: number;
  accForce: number;
  brakeForce: number;
  speed: number;
  error: number;
  capacity: number;
}

function finite(input: OpponentSpeedInput): boolean {
  return [
    input.desiredSpeed,
    input.velocity.x,
    input.velocity.y,
    input.velocity.z,
    input.factor,
    input.mass,
    input.dtMs,
  ].every(Number.isFinite);
}

function damageLoss(damage: number, component: "engine" | "transmission") {
  if (damage >= 99) return Infinity;
  if (damage >= 98) return Math.fround(component === "engine" ? 0.6 : 0.3);
  if (damage >= 51)
    return (
      (damage - 50) * Math.fround(component === "engine" ? 0.0125 : 0.00625)
    );
  return 0;
}

/** Installed SetCurvature4b053b uses double .0005 per millisecond, then
 * stores both the maximum change and final car curvature as Float32. */
export function approachOpponentCurvature(
  current: number,
  target: number,
  dtMs: number,
): number {
  if (![current, target, dtMs].every(Number.isFinite) || dtMs < 0)
    throw new Error("Invalid opponent curvature input");
  const maximumChange = Math.fround(dtMs * 0.0005);
  return Math.fround(
    current +
      Math.max(-maximumChange, Math.min(maximumChange, target - current)),
  );
}

/** Installed ProcessFollowPath 0x4af700 / 0x4b03bd–0x4b0525. Keeps the
 * PID-like acceleration history in metric units; car mass scales only the
 * force outputs. It intentionally exposes forces without applying throttle. */
export class NativeOpponentSpeedController {
  private previousAcceleration = 0;
  private previousError = 0;

  reset(): void {
    this.previousAcceleration = 0;
    this.previousError = 0;
  }

  update(input: OpponentSpeedInput): OpponentSpeedResult {
    if (
      !finite(input) ||
      !(input.mass > 0) ||
      !(input.dtMs > 0) ||
      !Number.isInteger(input.engineDamage) ||
      input.engineDamage < 0 ||
      input.engineDamage > 100 ||
      !Number.isInteger(input.transmissionDamage) ||
      input.transmissionDamage < 0 ||
      input.transmissionDamage > 100
    )
      throw new Error("Invalid opponent speed controller input");

    const vx = Math.fround(input.velocity.x);
    const vy = Math.fround(input.velocity.y);
    const vz = Math.fround(input.velocity.z);
    // 4af9a2–db: live 3D length * double6.9, then one Float32 store.
    // The separate horizontal steering speed does not replace this PID input.
    const speed = Math.fround(Math.sqrt(vx * vx + vy * vy + vz * vz) * 6.9);
    const factor = Math.fround(input.factor);
    const mass = Math.fround(input.mass);
    const desiredSpeed = Math.fround(input.desiredSpeed);
    if (
      ![speed, factor, mass, desiredSpeed].every(Number.isFinite) ||
      mass <= 0
    )
      throw new Error(
        "Opponent controller input exceeds native Float32 bounds",
      );
    if (factor === 0) {
      return {
        acceleration: -15,
        accForce: 0,
        brakeForce: Math.fround(15 * mass),
        speed,
        error: 0,
        capacity: 0,
      };
    }

    let capacity = Math.max(factor, 1);
    capacity -= damageLoss(input.engineDamage, "engine");
    capacity -= damageLoss(input.transmissionDamage, "transmission");
    if (!Number.isFinite(capacity) || capacity < 0) capacity = 0;

    const error = desiredSpeed * factor - speed;
    const storedError = Math.fround(error);
    const maximumAcceleration = Math.fround(12 * capacity);
    const rawAcceleration =
      (((error - this.previousError) * 1000) / input.dtMs) * Math.fround(0.1) +
      storedError +
      this.previousAcceleration;
    const acceleration = Math.max(
      -maximumAcceleration,
      Math.min(maximumAcceleration, rawAcceleration),
    );

    // Native history is saved before the car-mass multiplication below.
    this.previousAcceleration = Math.fround(acceleration);
    this.previousError = storedError;
    return {
      acceleration,
      accForce: acceleration > 0 ? Math.fround(acceleration * mass) : 0,
      brakeForce: acceleration > 0 ? 0 : Math.fround(-acceleration * mass),
      speed,
      error,
      capacity,
    };
  }
}
