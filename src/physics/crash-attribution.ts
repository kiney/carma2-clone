import { Vector3 } from "three";

export type NativeCrashIdentity = string | number;

export interface NativeCrashHistory {
  lastAttacker: NativeCrashIdentity | null;
  lastMs: number;
  previousAttacker: NativeCrashIdentity | null;
  previousMs: number;
}

/** Native car snapshot fields consumed by DoCrashEarnings pair selection.
 * Non-car contact normalization belongs to the caller, before this pure API. */
export interface NativeCrashCar {
  identity: NativeCrashIdentity;
  driver: number;
  frameKnackered: boolean;
  accumulatorF32: number;
  firstContactFace: number;
  normalizedContactZ: number;
  preSpeedF32: number;
  localVelocityF32: Vector3;
  gear: number;
  accelKey: boolean;
  joystick: number;
  history: NativeCrashHistory;
}

export interface NativeCrashRoles {
  attacker: NativeCrashIdentity;
  victim: NativeCrashIdentity;
}

export interface NativeCrashAttribution {
  roles: NativeCrashRoles | null;
  inherited: boolean;
  /** True when the ordinary tail clears both damage accumulators. */
  cleanup: boolean;
}

const ACCUMULATOR_THRESHOLD = Math.fround(0.00005);
const MINIMUM_SPEED = Math.fround(0.0005);
const FIVE = Math.fround(5);

function uint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function identity(value: unknown): value is NativeCrashIdentity {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function age(now: number, then: number): number {
  return (now - then) | 0;
}

function storedF32(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`Invalid native crash ${label}`);
  const stored = Math.fround(value);
  if (!Number.isFinite(stored))
    throw new Error(`Native crash ${label} exceeds Float32 bounds`);
  return stored;
}

function validateCar(car: NativeCrashCar): void {
  if (
    !identity(car.identity) ||
    !Number.isInteger(car.driver) ||
    car.driver <= 5 ||
    typeof car.frameKnackered !== "boolean" ||
    !Number.isFinite(car.accumulatorF32) ||
    !Number.isInteger(car.firstContactFace) ||
    car.firstContactFace < 0 ||
    car.firstContactFace > 7 ||
    !Number.isInteger(car.gear) ||
    typeof car.accelKey !== "boolean" ||
    !Number.isInteger(car.joystick) ||
    (!identity(car.history.lastAttacker) &&
      car.history.lastAttacker !== null) ||
    !uint(car.history.lastMs) ||
    (!identity(car.history.previousAttacker) &&
      car.history.previousAttacker !== null) ||
    !uint(car.history.previousMs)
  )
    throw new Error("Invalid native crash-attribution car");
  storedF32(car.accumulatorF32, "damage accumulator");
  storedF32(car.normalizedContactZ, "normalized contact Z");
  storedF32(car.preSpeedF32, "pre-physics speed");
  if (
    !car.localVelocityF32 ||
    !car.localVelocityF32.toArray().every(Number.isFinite)
  )
    throw new Error("Invalid native crash local velocity");
  car.localVelocityF32
    .toArray()
    .forEach((value) => storedF32(value, "local velocity"));
}

function contactSector(car: NativeCrashCar): number {
  const face = car.firstContactFace;
  if (face > 3) return face;
  const z = storedF32(car.normalizedContactZ, "normalized contact Z");
  if (z < 0.25) return 4;
  if (z > 0.75) return 5;
  return face;
}

function movementSector(car: NativeCrashCar): number {
  const [x, y, z] = car.localVelocityF32
    .toArray()
    .map((value) => storedF32(value, "local velocity"));
  const ax = Math.abs(x),
    ay = Math.abs(y),
    az = Math.abs(z);
  if (ax > ay && ax > az) return x < 0 ? 2 : 3;
  if (ay > ax && ay > az) return y < 0 ? 1 : 0;
  return z < 0 ? 4 : 5;
}

function sectorMatches(car: NativeCrashCar): boolean {
  return contactSector(car) === movementSector(car);
}

function driving(car: NativeCrashCar): boolean {
  const z = storedF32(car.localVelocityF32.z, "local velocity");
  return (
    z !== 0 && car.gear > 0 !== z > 0 && (car.accelKey || car.joystick > 32768)
  );
}

function candidate(car: NativeCrashCar, other: NativeCrashCar): boolean {
  const speed = storedF32(car.preSpeedF32, "pre-physics speed");
  const otherSpeed = storedF32(other.preSpeedF32, "pre-physics speed");
  return (
    sectorMatches(car) &&
    speed * FIVE > otherSpeed &&
    speed > MINIMUM_SPEED &&
    (car.driver < 7 || driving(car))
  );
}

function pairResult(
  attacker: NativeCrashCar,
  victim: NativeCrashCar,
  inherited: boolean,
  nowMs: number,
  onAttributedPair?: (attacker: NativeCrashCar, victim: NativeCrashCar) => void,
): NativeCrashAttribution {
  onAttributedPair?.(attacker, victim);
  if (attacker.driver === 8) {
    victim.history.lastAttacker = attacker.identity;
    victim.history.lastMs = nowMs;
    if (!inherited) {
      victim.history.previousAttacker = attacker.identity;
      victim.history.previousMs = nowMs;
    }
  }
  return {
    roles: { attacker: attacker.identity, victim: victim.identity },
    inherited,
    cleanup: true,
  };
}

function finish(
  a: NativeCrashCar,
  b: NativeCrashCar | null,
  result: NativeCrashAttribution,
): NativeCrashAttribution {
  if (result.cleanup) {
    a.accumulatorF32 = 0;
    if (b) b.accumulatorF32 = 0;
  }
  return result;
}

/** Pure offline DoCrashEarnings4 0x440550 car-pair selector. */
export function selectNativeCrashAttribution(
  a: NativeCrashCar,
  b: NativeCrashCar | null,
  nowMs: number,
  getCar: (identity: NativeCrashIdentity) => NativeCrashCar | null = () => null,
  onAttributedPair?: (attacker: NativeCrashCar, victim: NativeCrashCar) => void,
): NativeCrashAttribution | null {
  if (!uint(nowMs)) throw new Error("Invalid native crash timestamp");
  validateCar(a);
  if (b) validateCar(b);
  if (a.frameKnackered || b?.frameKnackered) return null;
  if (
    b &&
    storedF32(a.accumulatorF32, "damage accumulator") <=
      ACCUMULATOR_THRESHOLD &&
    storedF32(b.accumulatorF32, "damage accumulator") <= ACCUMULATOR_THRESHOLD
  )
    return null;

  const lookup = (id: NativeCrashIdentity): NativeCrashCar | null => {
    if (a.identity === id) return a;
    if (b?.identity === id) return b;
    const found = getCar(id);
    if (!found || found.identity !== id)
      throw new Error("Native crash history identity could not be resolved");
    validateCar(found);
    return found;
  };
  if (!b) {
    if (age(nowMs, a.history.lastMs) >= 5000) return null;
    const prior =
      a.history.lastAttacker === null ? null : lookup(a.history.lastAttacker);
    if (prior && prior.driver >= 7)
      return finish(
        a,
        null,
        pairResult(prior, a, true, nowMs, onAttributedPair),
      );
    if (age(nowMs, a.history.previousMs) < 750) {
      if (a.history.previousAttacker === null)
        return finish(a, null, { roles: null, inherited: true, cleanup: true });
      const previous = lookup(a.history.previousAttacker);
      if (!previous)
        throw new Error("Native crash history identity could not be resolved");
      return finish(
        a,
        null,
        pairResult(previous, a, true, nowMs, onAttributedPair),
      );
    }
    if (prior)
      return finish(
        a,
        null,
        pairResult(prior, a, true, nowMs, onAttributedPair),
      );
    return finish(a, null, { roles: null, inherited: true, cleanup: true });
  }

  // Installed early branch is exclusive: a human A failure does not fall
  // through and attribute a matching human B to A.
  if (a.driver >= 7) {
    if (sectorMatches(a) && driving(a)) {
      b.history.lastAttacker = a.identity;
      b.history.lastMs = nowMs;
    }
  } else if (b.driver >= 7 && sectorMatches(b) && driving(b)) {
    a.history.lastAttacker = b.identity;
    a.history.lastMs = nowMs;
  }

  const aCandidate = candidate(a, b);
  const bCandidate = candidate(b, a);
  let selected: { attacker: NativeCrashCar; victim: NativeCrashCar } | null =
    null;
  if (aCandidate && !(bCandidate && b.driver === 8)) {
    selected = { attacker: a, victim: b };
  } else if (bCandidate) {
    selected = { attacker: b, victim: a };
  }

  if (selected && selected.attacker.driver >= 7)
    return finish(
      a,
      b,
      pairResult(
        selected.attacker,
        selected.victim,
        false,
        nowMs,
        onAttributedPair,
      ),
    );

  // Prefer the two live pair records; only callback-resolve a historical ID.
  if (
    b.history.previousAttacker === a.identity &&
    age(nowMs, b.history.previousMs) < 750
  )
    return finish(a, b, pairResult(a, b, true, nowMs, onAttributedPair));
  if (
    a.history.previousAttacker === b.identity &&
    age(nowMs, a.history.previousMs) < 750
  )
    return finish(a, b, pairResult(b, a, true, nowMs, onAttributedPair));
  if (selected)
    return finish(
      a,
      b,
      pairResult(
        selected.attacker,
        selected.victim,
        false,
        nowMs,
        onAttributedPair,
      ),
    );
  return finish(a, b, { roles: null, inherited: false, cleanup: true });
}
