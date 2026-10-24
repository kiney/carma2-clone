import { Vector3 } from "three";
import { consumeNativeEarnCredits } from "./ped-awards";

/** Original asset coordinates: rec2's WORLD_SCALE is 6.9 metres per unit.
 * This independent arcade approximation uses a bicycle steering model, tyre
 * side-slip damping, gravity, and swept sphere wall contacts. It does not port
 * the original solver, suspension, damage deformation, or drivetrain.
 */
export const WORLD_METRES_PER_UNIT = 6.9;
export interface VehicleState {
  position: Vector3;
  velocity: Vector3;
  /** Radians around +Y; zero faces -Z, matching the original car actors. */
  heading: number;
  /** Signed forward speed, in original world units per second. */
  speed: number;
  health: number;
}
export interface VehicleInput {
  throttle: number;
  /** Positive turns left. Reverse motion reverses the steering response. */
  steer: number;
  brake: number | boolean;
  handbrake: number | boolean;
}
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

export function speedMph(vehicle: VehicleState): number {
  return (Math.abs(vehicle.speed) * WORLD_METRES_PER_UNIT) / 0.44704;
}

export interface Checkpoint {
  /** Ordered vertices of a convex planar gate, in original world coordinates. */
  points: Vector3[];
  /** Restrict crossing relative to winding normal, or zero for either direction. */
  direction?: -1 | 0 | 1;
}
export interface RaceOptions {
  /** Browser practice for drivable assets lacking supported single-player rules. */
  practice?: boolean;
  laps: number;
  timeLimit: number;
  credits: number;
  /** Legacy option retained for callers; native C2 gates award no time. */
  checkpointBonusSeconds: number;
  checkpointCredits: number;
  completionCredits: number;
  disableTimeAwards: boolean;
  completionCreditsByReason?: readonly number[];
  completionTimeCreditRate?: number;
  deferCompletionAwards?: boolean;
}
export interface RaceState extends RaceOptions {
  /** Native global credit multiplier: zero means identity, independent of payouts. */
  earnedCreditMultiplier?: number;
  /** Native finished guard while a wasted body still simulates its countdown. */
  awardsClosed?: boolean;
  completionReason?: 0 | 1 | 2 | 3;
  checkpoints: Checkpoint[];
  nextCheckpoint: number;
  /** Current lap, starting at one; remains at the final lap upon completion. */
  lap: number;
  timeLeft: number;
  elapsed: number;
  status: "racing" | "completed" | "failed";
}
export interface RaceEvent {
  type: "checkpoint" | "lap" | "completed" | "failed";
  checkpoint?: number;
  lap: number;
}

export function createRace(
  checkpoints: Checkpoint[],
  options: Partial<RaceOptions> = {},
): RaceState {
  const o: RaceOptions = {
    laps: 3,
    timeLimit: 180,
    credits: 1000,
    checkpointBonusSeconds: 0,
    checkpointCredits: 100,
    completionCredits: 2000,
    disableTimeAwards: false,
    ...options,
  };
  o.laps = Math.max(1, Math.floor(o.laps));
  o.timeLimit = Math.max(0, o.timeLimit);
  return {
    ...o,
    checkpoints: checkpoints.map((cp) => ({
      ...cp,
      points: cp.points.map((p) => p.clone()),
    })),
    nextCheckpoint: 0,
    lap: 1,
    timeLeft: o.timeLimit,
    elapsed: 0,
    status: o.practice || o.timeLimit > 0 ? "racing" : "failed",
  };
}

/** Segment/convex polygon intersection, including fast moves across thin gates.
 * Merely touching the plane at the end does not count; leaving it can count once.
 */
export function checkpointCrossing(
  from: Vector3,
  to: Vector3,
  gate: Checkpoint,
): number | null {
  if (gate.points.length > 4 && gate.points.length % 4 === 0) {
    const crossings: number[] = [];
    for (let i = 0; i < gate.points.length; i += 4) {
      const value = checkpointCrossing(from, to, {
        ...gate,
        points: gate.points.slice(i, i + 4),
      });
      if (value !== null) crossings.push(value);
    }
    return crossings.length ? Math.min(...crossings) : null;
  }
  if (gate.points.length < 3) return null;
  const origin = gate.points[0];
  const normal = new Vector3()
    .subVectors(gate.points[1], origin)
    .cross(new Vector3().subVectors(gate.points[2], origin));
  if (normal.lengthSq() < 1e-12) return null;
  normal.normalize();
  const a = normal.dot(new Vector3().subVectors(from, origin));
  const b = normal.dot(new Vector3().subVectors(to, origin));
  // Half-open intervals prevent two adjacent updates counting one crossing twice.
  const crosses = (a <= 0 && b > 0) || (a >= 0 && b < 0);
  if (!crosses || Math.abs(b - a) < 1e-10) return null;
  const direction = gate.direction ?? 0;
  if (direction !== 0 && Math.sign(b - a) !== direction) return null;
  const t = -a / (b - a);
  const point = from.clone().lerp(to, t);
  for (let i = 0; i < gate.points.length; i++) {
    const start = gate.points[i];
    const end = gate.points[(i + 1) % gate.points.length];
    const side = new Vector3()
      .subVectors(end, start)
      .cross(new Vector3().subVectors(point, start))
      .dot(normal);
    if (side < -1e-7) return null;
  }
  return t;
}

/** Installed EarnCredits2 0x44b960 rejects finished races and zero amounts.
 * Debug credit editing and post-race settlement deliberately bypass this. */
export function awardRaceCredits(race: RaceState, amount: number): boolean {
  if (
    race.status !== "racing" ||
    race.awardsClosed ||
    !Number.isFinite(amount) ||
    amount === 0
  )
    return false;
  const result = consumeNativeEarnCredits({
    amount,
    creditMultiplier: race.earnedCreditMultiplier ?? 0,
    currentCredits: race.credits,
    raceFinished: false,
  });
  if (result.accepted) race.credits = result.credits;
  return result.accepted;
}

/** Installed AddTimeAward0x44baf0 checks the current race's no_time flag.
 * Debug time editing is deliberately separate from ordinary game awards. */
export function awardRaceTime(race: RaceState, seconds: number): boolean {
  if (
    race.status !== "racing" ||
    race.awardsClosed ||
    race.disableTimeAwards ||
    !Number.isFinite(seconds) ||
    seconds === 0
  )
    return false;
  race.timeLeft += seconds;
  return true;
}

/** Installed completion selection0x493adb: classic rows0/1/2 are laps,
 * pedestrians, opponents; missions pass the same row for every reason.
 * Browser races defer settlement to RacePayout; standalone headless callers
 * may request the final total immediately with the default option. */
export function completeRace(race: RaceState, reason: 0 | 1 | 2 | 3): boolean {
  if (race.status !== "racing" || race.awardsClosed || race.practice)
    return false;
  race.status = "completed";
  race.completionReason = reason;
  if (!race.deferCompletionAwards)
    race.credits +=
      (race.completionCreditsByReason?.[reason] ?? race.completionCredits) +
      Math.floor(Math.max(0, race.timeLeft)) *
        (race.completionTimeCreditRate ?? 0);
  return true;
}

/** Awards only ordered gates. Processes multiple gates chronologically in a
 * single move and interpolates crossing times so a late gate cannot revive a
 * timer that expired before the car reached it. Completed/failed races freeze.
 */
export function updateRace(
  race: RaceState,
  from: Vector3,
  to: Vector3,
  dt: number,
): RaceEvent[] {
  if (
    race.status !== "racing" ||
    race.awardsClosed ||
    !Number.isFinite(dt) ||
    dt < 0
  )
    return [];
  if (race.practice) {
    race.elapsed += dt;
    return [];
  }
  const events: RaceEvent[] = [];
  let previousFraction = 0;
  let checks = 0;
  while (race.checkpoints.length && checks++ < race.checkpoints.length) {
    const checkpoint = race.nextCheckpoint;
    const fraction = checkpointCrossing(from, to, race.checkpoints[checkpoint]);
    if (fraction === null || fraction < previousFraction - 1e-8) break;
    const elapsed = (fraction - previousFraction) * dt;
    if (race.timeLeft <= elapsed) break;
    race.timeLeft -= elapsed;
    race.elapsed += elapsed;
    previousFraction = fraction;
    events.push({ type: "checkpoint", checkpoint, lap: race.lap });
    race.nextCheckpoint++;
    if (race.nextCheckpoint === race.checkpoints.length) {
      race.nextCheckpoint = 0;
      if (race.lap === race.laps) {
        completeRace(race, 0);
        events.push({ type: "completed", lap: race.lap });
        return events;
      }
      race.lap++;
      events.push({ type: "lap", lap: race.lap });
    }
    // Installed IncrementCheckpoint skips this award after the finishing gate.
    awardRaceCredits(race, race.checkpointCredits);
  }
  const remaining = dt * (1 - previousFraction);
  race.elapsed += Math.min(race.timeLeft, remaining);
  race.timeLeft = Math.max(0, race.timeLeft - remaining);
  if (race.timeLeft <= 0) {
    race.status = "failed";
    events.push({ type: "failed", lap: race.lap });
  }
  return events;
}

export function repairCost(vehicle: VehicleState): number {
  return Math.ceil(Math.max(0, 100 - vehicle.health) * 5);
}
export function repairVehicle(vehicle: VehicleState, race: RaceState): boolean {
  const cost = repairCost(vehicle);
  if (race.status !== "racing" || cost === 0 || race.credits < cost)
    return false;
  race.credits -= cost;
  vehicle.health = 100;
  return true;
}

/** Caller supplies a known safe ground position (e.g. last reached checkpoint).
 * Recovery teleports, so the caller must reset its previous race sample too.
 */
export function recoverVehicle(
  vehicle: VehicleState,
  race: RaceState,
  position: Vector3,
  heading: number,
  cost = 250,
): boolean {
  cost = Math.max(0, cost);
  if (race.status !== "racing" || race.credits < cost) return false;
  race.credits -= cost;
  vehicle.position.copy(position);
  vehicle.velocity.set(0, 0, 0);
  vehicle.speed = 0;
  vehicle.heading = heading;
  return true;
}
