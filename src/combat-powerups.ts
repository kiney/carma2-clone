import { Vector3 } from "three";

/** Kernels use original actor coordinates, velocities and tonnes. */
export interface CombatImpulse {
  deltaVelocity: Vector3;
  /** Native omega increments are in body axes. */
  deltaAngularVelocity: Vector3;
  /** Native rigid +49c rejects stale imported multiplayer state. It does not
   * suppress local contacts. The clock is the last PHIL physics tick. */
  networkStateCutoffMs: number;
}

export interface RepulsionParameters {
  strength: number;
  minimumUpDirection: number;
  angularStrength: number;
  /** Opponents use distance; pedestrians use distance squared. */
  range: number;
}

/** Installed 4ddff0 and 4de340 use different ordering of the middle floats. */
export function repulsionParameters(
  action: 38 | 45,
  floats: readonly number[],
): RepulsionParameters {
  if (floats.length < 4 || !floats.slice(0, 4).every(Number.isFinite))
    throw new Error("Repulsion requires four finite authored parameters");
  if (floats[3] <= 0) throw new Error("Repulsion range must be positive");
  return {
    strength: floats[0],
    minimumUpDirection: floats[action === 38 ? 1 : 2],
    angularStrength: floats[action === 38 ? 2 : 1],
    range: floats[3],
  };
}

const NORMAL_EPSILON = 2 ** -22;

/** Installed FRandomPosNeg512fc0 uses the 15-bit CRT sample / 32768. */
function randomSigned(random: () => number, amplitude: number): number {
  const sample = Math.min(32767, Math.max(0, Math.floor(random() * 32768)));
  return -amplitude + (2 * amplitude * sample) / 32768;
}

function impulse(
  delta: Vector3,
  factor: number,
  parameters: RepulsionParameters,
  physicsTickMs: number,
  random: () => number,
): CombatImpulse {
  const distance = delta.length();
  const direction =
    distance > NORMAL_EPSILON
      ? delta.clone().multiplyScalar(1 / distance)
      : new Vector3(1, 0, 0);
  // Native replaces a near-horizontal Y component; it does not renormalize.
  if (Math.abs(direction.y) < 0.1) direction.y = parameters.minimumUpDirection;
  const angular = factor * parameters.angularStrength;
  return {
    deltaVelocity: direction.multiplyScalar(parameters.strength * factor),
    deltaAngularVelocity: new Vector3(
      randomSigned(random, angular),
      randomSigned(random, angular),
      randomSigned(random, angular),
    ),
    networkStateCutoffMs: (physicsTickMs + 40) >>> 0,
  };
}

/** Opponent handler4ddff0 divides by the temporary mass multiplier +4c8,
 * which initializes to 1, rather than by the rigid object's mass. The caller
 * visits native car categories 0..4, excluding the source by identity. */
export function opponentRepulsionImpulse(
  sourcePosition: Vector3,
  targetPosition: Vector3,
  massMultiplier: number,
  parameters: RepulsionParameters,
  physicsTickMs: number,
  random: () => number,
): CombatImpulse | null {
  if (!Number.isFinite(massMultiplier) || massMultiplier <= 0)
    throw new Error("Invalid opponent mass multiplier");
  const delta = targetPosition.clone().sub(sourcePosition);
  const distance = delta.length();
  if (distance >= parameters.range) return null;
  return impulse(
    delta,
    (parameters.range - distance) / parameters.range / massMultiplier,
    parameters,
    physicsTickMs,
    random,
  );
}

/** Pedestrian callback4ce0e0: range and falloff use squared distance, and
 * the native 0.068 conversion divides by simple-physics rigid mass +4. */
export function pedestrianRepulsionImpulse(
  sourcePosition: Vector3,
  targetPosition: Vector3,
  mass: number,
  parameters: RepulsionParameters,
  physicsTickMs: number,
  random: () => number,
): CombatImpulse | null {
  if (!Number.isFinite(mass) || mass <= 0)
    throw new Error("Invalid pedestrian mass");
  const delta = targetPosition.clone().sub(sourcePosition);
  const distanceSquared = delta.lengthSq();
  if (distanceSquared >= parameters.range) return null;
  return impulse(
    delta,
    (((parameters.range - distanceSquared) / parameters.range) * 0.068) / mass,
    parameters,
    physicsTickMs,
    random,
  );
}

export interface CombatPedestrian {
  position: Vector3;
  alive: boolean;
  /** Native shared helper traverses gPedestrians_in_sight, not all spawns. */
  inSight: boolean;
}

/** Shared helper4cdef0 uses a clear segment (first face fraction >= 1).
 * Range zero disables its distance test. The callback's return is ignored:
 * a qualifying target, even an already burning one, makes the helper succeed. */
export function selectCombatPedestrians<T extends CombatPedestrian>(
  sourcePosition: Vector3,
  targets: readonly T[],
  rangeSquared: number,
  immortalPedestrians: boolean,
  firstFaceFraction: (source: Vector3, target: T) => number,
): T[] {
  if (!Number.isFinite(rangeSquared) || rangeSquared < 0)
    throw new Error("Invalid pedestrian combat range");
  if (immortalPedestrians) return [];
  return targets.filter(
    (target) =>
      target.alive &&
      target.inSight &&
      (rangeSquared === 0 ||
        sourcePosition.distanceToSquared(target.position) < rangeSquared) &&
      firstFaceFraction(sourcePosition, target) >= 1,
  );
}

export interface NapalmTarget extends CombatPedestrian {
  /** Ped cache +98: negative means bolt reserved; positive means burning. */
  burningOrReserved: boolean;
  specialVolumeGravityMultiplier?: number;
}

export const NAPALM_CAPACITY = 5;
export const NAPALM_BURN_MS = 15000;

/** Spawn4ce310 chooses nearest eligible target, with no range limit, and
 * rejects a source or target in a special volume with gravity multiplier <1. */
export function selectNapalmTarget<T extends NapalmTarget>(
  sourcePosition: Vector3,
  targets: readonly T[],
  occupiedSlots: readonly boolean[],
  sourceVolumeGravityMultiplier: number | undefined,
  immortalPedestrians: boolean,
  firstFaceFraction: (source: Vector3, target: T) => number,
): { target: T; slot: number } | null {
  if (
    sourceVolumeGravityMultiplier !== undefined &&
    sourceVolumeGravityMultiplier < 1
  )
    return null;
  const slot = occupiedSlots
    .slice(0, NAPALM_CAPACITY)
    .findIndex((busy) => !busy);
  if (slot < 0) return null;
  const candidates = selectCombatPedestrians(
    sourcePosition,
    targets,
    0,
    immortalPedestrians,
    firstFaceFraction,
  )
    .filter((target) => !target.burningOrReserved)
    .sort(
      (a, b) =>
        sourcePosition.distanceToSquared(a.position) -
        sourcePosition.distanceToSquared(b.position),
    );
  const target = candidates.find(
    (candidate) =>
      candidate.specialVolumeGravityMultiplier === undefined ||
      candidate.specialVolumeGravityMultiplier >= 1,
  );
  return target ? { target, slot } : null;
}

/** Installed PedScanForObjects4ced30 checks a strict 5-unit cube, then tests
 * distance to the relative-velocity line in XZ (stationary: direct XZ range).
 * The native nearness mode uses 3D range instead. This scan does not use LOS. */
export function electricRayHits(
  sourcePosition: Vector3,
  sourceVelocity: Vector3,
  targetPosition: Vector3,
  targetVelocity: Vector3,
  rayDistanceSquared: number,
  nearnessMode = false,
): boolean {
  if (!(rayDistanceSquared > 0)) return false;
  const delta = sourcePosition.clone().sub(targetPosition);
  if (
    Math.abs(delta.x) >= 5 ||
    Math.abs(delta.y) >= 5 ||
    Math.abs(delta.z) >= 5
  )
    return false;
  const relative = sourceVelocity.clone().sub(targetVelocity);
  const planarSpeedSquared = relative.x ** 2 + relative.z ** 2;
  const distanceSquared = nearnessMode
    ? delta.lengthSq()
    : planarSpeedSquared === 0
      ? delta.x ** 2 + delta.z ** 2
      : (relative.x * delta.z - relative.z * delta.x) ** 2 / planarSpeedSquared;
  return distanceSquared < rayDistanceSquared;
}

export interface NapalmMotion {
  position: Vector3;
  direction: Vector3;
  bornAtMs: number;
  /** Native +24 starts at zero and is not updated by the installed mover. */
  lastDirectionAtMs: number;
}

/** Installed MungeNapalm4ce580 moves at 2 actor units/second. Independent
 * 0.8..1.25 samples scale each direction component; ascent decays for 500 ms. */
export function stepNapalmMotion(
  bolt: NapalmMotion,
  targetPosition: Vector3,
  nowMs: number,
  dtMs: number,
  random: () => number,
): void {
  if (nowMs - bolt.lastDirectionAtMs > 50) {
    const delta = targetPosition.clone().sub(bolt.position);
    const distance = delta.length();
    bolt.direction.copy(
      distance > NORMAL_EPSILON
        ? delta.multiplyScalar(1 / distance)
        : new Vector3(1, 0, 0),
    );
    for (const component of ["x", "y", "z"] as const) {
      const sample = Math.min(32767, Math.max(0, Math.floor(random() * 32768)));
      bolt.direction[component] *= 0.8 + ((1.25 - 0.8) * sample) / 32768;
    }
    const age = nowMs - bolt.bornAtMs;
    if (age < 500) bolt.direction.y += (500 - age) * 0.002;
  }
  bolt.position.addScaledVector(bolt.direction, dtMs * 0.002);
}
