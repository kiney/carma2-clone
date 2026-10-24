import { Vector3 } from "three";
import { WORLD_METRES_PER_UNIT } from "./gameplay";
import type { VehicleInput, VehicleState } from "./gameplay";

/** Legacy arcade approximation retained for unit tests, not active C2 physics. */
export interface SweepHit {
  /** Fraction of the requested move before contact, in [0, 1]. */
  fraction: number;
  /** Surface normal pointing out of the obstacle. */
  normal: Vector3;
}
export interface GroundQuery {
  /** Surface Y below/near the car, or null for a gap. nearY helps select decks. */
  height(x: number, z: number, nearY: number): number | null;
  sweep?(from: Vector3, to: Vector3, radius: number): SweepHit | null;
}
export interface VehicleConfig {
  maxSpeed: number;
  reverseSpeed: number;
  acceleration: number;
  braking: number;
  rollingDrag: number;
  lateralGrip: number;
  wheelbase: number;
  steerAngle: number;
  gravity: number;
  rideHeight: number;
  stepHeight: number;
  radius: number;
  impactDamage: number;
}
export const DEFAULT_VEHICLE_CONFIG: Readonly<VehicleConfig> = Object.freeze({
  // Eagle3 specifies 200 mph at redline, a 0.48-unit wheelbase and 0.40-unit width.
  maxSpeed: (200 * 0.44704) / WORLD_METRES_PER_UNIT,
  reverseSpeed: 2.4,
  acceleration: 1.8,
  braking: 3.8,
  rollingDrag: 0.08,
  lateralGrip: 9,
  wheelbase: 0.48,
  steerAngle: 0.45,
  gravity: 9.81 / WORLD_METRES_PER_UNIT,
  rideHeight: 0.05,
  stepHeight: 0.08,
  radius: 0.2,
  impactDamage: 9,
});
const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
const finiteInput = (v: number | boolean) =>
  typeof v === "boolean" ? Number(v) : Number.isFinite(v) ? v : 0;
const approachZero = (v: number, amount: number) =>
  Math.sign(v) * Math.max(0, Math.abs(v) - amount);
const validHeight = (h: number | null): h is number =>
  h !== null && Number.isFinite(h);

export function createVehicle(position: Vector3, heading = 0): VehicleState {
  return {
    position: position.clone(),
    velocity: new Vector3(),
    heading,
    speed: 0,
    health: 100,
  };
}

/** Mutates state. Substeps up to 120 Hz, caps a stalled frame to 0.25 seconds. */
export function updateVehicle(
  state: VehicleState,
  input: VehicleInput,
  dt: number,
  ground: GroundQuery,
  config: Partial<VehicleConfig> = {},
): { grounded: boolean; collisionSpeed: number } {
  const c = { ...DEFAULT_VEHICLE_CONFIG, ...config };
  if (!Number.isFinite(dt) || dt <= 0)
    return { grounded: false, collisionSpeed: 0 };
  const duration = Math.min(dt, 0.25);
  const steps = Math.ceil(duration * 120);
  const step = duration / steps;
  const throttle = clamp(finiteInput(input.throttle), -1, 1);
  const steer = clamp(finiteInput(input.steer), -1, 1);
  const brake = clamp(finiteInput(input.brake), 0, 1);
  const handbrake = clamp(finiteInput(input.handbrake), 0, 1);
  const forward = new Vector3();
  const right = new Vector3();
  const from = new Vector3();
  const to = new Vector3();
  let grounded = false;
  let collisionSpeed = 0;

  for (let i = 0; i < steps; i++) {
    const initialHeight = ground.height(
      state.position.x,
      state.position.z,
      state.position.y,
    );
    grounded =
      validHeight(initialHeight) &&
      Math.abs(state.position.y - initialHeight - c.rideHeight) <= 0.025 &&
      state.velocity.y <= 0.2;
    forward.set(-Math.sin(state.heading), 0, -Math.cos(state.heading));
    right.set(Math.cos(state.heading), 0, -Math.sin(state.heading));
    let longitudinal = state.velocity.dot(forward);
    let lateral = state.velocity.dot(right);
    if (grounded) {
      const healthFactor =
        state.health <= 0 ? 0 : 0.4 + 0.6 * clamp(state.health / 100, 0, 1);
      longitudinal += throttle * c.acceleration * healthFactor * step;
      longitudinal = approachZero(
        longitudinal,
        (brake * c.braking + handbrake * c.braking * 0.7 + c.rollingDrag) *
          step,
      );
      longitudinal = clamp(longitudinal, -c.reverseSpeed, c.maxSpeed);
      lateral *= Math.exp(-c.lateralGrip * (1 - 0.88 * handbrake) * step);
      const angle =
        (steer * c.steerAngle) / (1 + Math.abs(longitudinal) * 0.65);
      const yaw = clamp(
        (longitudinal * Math.tan(angle)) / Math.max(c.wheelbase, 0.01),
        -2.6,
        2.6,
      );
      state.heading += yaw * step * (1 + handbrake * 0.6);
      // Preserve inertia during steering; the tyre damping redirects it gradually.
      state.velocity.x = forward.x * longitudinal + right.x * lateral;
      state.velocity.z = forward.z * longitudinal + right.z * lateral;
      state.velocity.y = 0;
      state.position.y = initialHeight! + c.rideHeight;
    } else {
      state.velocity.y -= c.gravity * step;
    }

    from.copy(state.position);
    to.copy(from).addScaledVector(state.velocity, step);
    const hit = ground.sweep?.(from, to, c.radius);
    if (hit && Number.isFinite(hit.fraction) && hit.normal.lengthSq() > 1e-10) {
      const normal = hit.normal.clone().normalize();
      const intoWall = state.velocity.dot(normal);
      if (intoWall < 0) {
        const impact = -intoWall;
        collisionSpeed = Math.max(collisionSpeed, impact);
        const fraction = clamp(hit.fraction, 0, 1);
        to.lerpVectors(from, to, Math.max(0, fraction - 0.0001));
        // A small rebound prevents repeated penetrating contacts; keep tangent motion.
        state.velocity.addScaledVector(normal, -intoWall * 1.12);
        // Consume the remaining step along the contact plane, allowing the car
        // to scrape along walls instead of freezing at a glancing contact.
        const contact = to.clone();
        to.addScaledVector(state.velocity, step * (1 - fraction));
        const second = ground.sweep?.(contact, to, c.radius);
        if (second) to.lerpVectors(contact, to, clamp(second.fraction, 0, 1));
        state.health = Math.max(
          0,
          state.health - Math.max(0, impact - 0.65) * c.impactDamage,
        );
      }
    }
    const nextHeight = ground.height(to.x, to.z, Math.max(from.y, to.y));
    if (validHeight(nextHeight)) {
      const floor = nextHeight + c.rideHeight;
      const horizontalMove = Math.hypot(to.x - from.x, to.z - from.z);
      const canFollow =
        grounded &&
        floor - from.y <= c.stepHeight + horizontalMove &&
        from.y - floor <= c.stepHeight;
      const landing =
        state.velocity.y <= 0 &&
        to.y <= floor &&
        from.y >= floor - c.stepHeight;
      if (canFollow || landing) {
        if (!grounded && state.velocity.y < -1.5) {
          state.health = Math.max(
            0,
            state.health - (-state.velocity.y - 1.5) * c.impactDamage * 0.5,
          );
        }
        to.y = floor;
        state.velocity.y = 0;
        grounded = true;
      } else {
        grounded = false;
      }
    } else {
      grounded = false;
    }
    state.position.copy(to);
    forward.set(-Math.sin(state.heading), 0, -Math.cos(state.heading));
    state.speed = state.velocity.dot(forward);
    state.heading = Math.atan2(
      Math.sin(state.heading),
      Math.cos(state.heading),
    );
  }
  return { grounded, collisionSpeed };
}
