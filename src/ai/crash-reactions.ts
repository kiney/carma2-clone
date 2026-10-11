import type { NativeCarIdentity, NativeDecisionObjective } from "./decision";
import { nativeIntegerLow32 } from "./integer";

export interface NativeCrashReactionFlags {
  grudgeRecent: boolean;
  bigBang: boolean;
  scaryBang: boolean;
}

export interface NativeCrashReactionCar {
  identity: NativeCarIdentity;
  driver: 6 | 8;
  damageAccumulatorF32: number;
  flags: NativeCrashReactionFlags;
  lastHitter: NativeCarIdentity | null;
  lastWeHit: NativeCarIdentity | null;
  contactTimeMs: number;
  accForce: number;
  brakeForce: number;
  curvature: number;
}

export interface NativeCrashOpponentState {
  catalogIndex: number;
  objective: NativeDecisionObjective;
  target: NativeCarIdentity | null;
  stunUntilMs: number;
  notifyAttributedTargetHit(nowMs: number): void;
}

export interface NativeCrashCatalogEntry {
  strength: number;
  grudge: number;
}

export interface NativeCrashReactionResult {
  severity: number;
  increment: number;
  outcome: "ignored" | "minor" | "human-hit-ai" | "ai-hit-human" | "ai-hit-ai";
}

function uint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function i32(value: number): number {
  return value | 0;
}

function storedFloat(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`Invalid native crash ${label}`);
  const stored = Math.fround(value);
  if (!Number.isFinite(stored))
    throw new Error(`Native crash ${label} exceeds Float32 bounds`);
  return stored;
}

function lowByte(value: number): number {
  return value & 0xff;
}

function validateCar(car: NativeCrashReactionCar): void {
  if (
    !car ||
    (car.driver !== 6 && car.driver !== 8) ||
    (typeof car.identity !== "string" &&
      (typeof car.identity !== "number" || !Number.isFinite(car.identity))) ||
    typeof car.flags?.grudgeRecent !== "boolean" ||
    typeof car.flags.bigBang !== "boolean" ||
    typeof car.flags.scaryBang !== "boolean" ||
    !uint(car.contactTimeMs) ||
    (car.lastHitter !== null &&
      typeof car.lastHitter !== "string" &&
      (typeof car.lastHitter !== "number" ||
        !Number.isFinite(car.lastHitter))) ||
    (car.lastWeHit !== null &&
      typeof car.lastWeHit !== "string" &&
      (typeof car.lastWeHit !== "number" || !Number.isFinite(car.lastWeHit)))
  )
    throw new Error("Unsupported or invalid native crash reaction car");
  storedFloat(car.damageAccumulatorF32, "damage accumulator");
  storedFloat(car.accForce, "acceleration force");
  storedFloat(car.brakeForce, "brake force");
  storedFloat(car.curvature, "curvature");
}

function resolveState(
  car: NativeCrashReactionCar,
  resolveOpponent: (
    car: NativeCrashReactionCar,
  ) => NativeCrashOpponentState | null,
  catalog: (index: number) => NativeCrashCatalogEntry | null,
): {
  opponent: NativeCrashOpponentState;
  entry: NativeCrashCatalogEntry;
  strength: number;
} {
  const opponent = resolveOpponent(car);
  if (
    !opponent ||
    !Number.isInteger(opponent.catalogIndex) ||
    opponent.catalogIndex < 0
  )
    throw new Error(
      "Native crash reaction opponent is not in the regular population",
    );
  if (!uint(opponent.stunUntilMs))
    throw new Error("Invalid native crash reaction stun deadline");
  const entry = catalog(opponent.catalogIndex);
  if (
    !entry ||
    !Number.isInteger(entry.grudge) ||
    entry.grudge < -0x80000000 ||
    entry.grudge > 0x7fffffff ||
    !Number.isFinite(entry.strength)
  )
    throw new Error("Native crash reaction catalog entry is unavailable");
  const strength = storedFloat(entry.strength, "opponent strength");
  return { opponent, entry, strength };
}

function increaseWeakScaryStun(
  victim: NativeCrashReactionCar,
  severity: number,
  nowMs: number,
  opponent: NativeCrashOpponentState,
  strength: number,
): void {
  if (victim.flags.scaryBang && strength < 5) {
    victim.accForce = 0;
    victim.brakeForce = 0;
    victim.curvature = 0;
    const deadline = (nowMs + 1000 + 30 * severity) >>> 0;
    opponent.stunUntilMs = Math.max(opponent.stunUntilMs, deadline);
  }
}

function actorWithRegularDriver(
  attacker: NativeCrashReactionCar,
  victim: NativeCrashReactionCar,
): NativeCrashReactionCar | null {
  if (attacker.driver === 6) return attacker;
  if (victim.driver === 6) return victim;
  return null;
}

/** Installed AI crash response setter4aec90 for verified regular driver6/8 pairs. */
export function applyNativeCrashReaction(
  attacker: NativeCrashReactionCar,
  victim: NativeCrashReactionCar,
  nowMs: number,
  bigBangThreshold: number,
  resolveOpponent: (
    car: NativeCrashReactionCar,
  ) => NativeCrashOpponentState | null,
  catalog: (index: number) => NativeCrashCatalogEntry | null,
): NativeCrashReactionResult {
  validateCar(attacker);
  validateCar(victim);
  if (!uint(nowMs)) throw new Error("Invalid native crash reaction timestamp");
  if (
    !Number.isInteger(bigBangThreshold) ||
    bigBangThreshold < -0x80000000 ||
    bigBangThreshold > 0x7fffffff
  )
    throw new Error("Invalid native big-bang threshold");
  const aiCar = actorWithRegularDriver(attacker, victim);
  if (!aiCar) return { severity: 0, increment: 0, outcome: "ignored" };

  const victimAccumulator = storedFloat(
    victim.damageAccumulatorF32,
    "damage accumulator",
  );
  const severity = nativeIntegerLow32(
    Math.min(100, Math.sqrt(victimAccumulator * 300000)),
  );
  const increment = Math.trunc(severity / 10);
  if (severity < 5) return { severity, increment, outcome: "minor" };

  attacker.lastWeHit = victim.identity;
  attacker.contactTimeMs = nowMs;
  victim.contactTimeMs = nowMs;
  victim.flags.grudgeRecent = true;
  victim.lastHitter = attacker.identity;
  victim.flags.bigBang ||= severity >= bigBangThreshold;
  victim.flags.scaryBang ||= severity >= 80;

  if (attacker.driver === 8 && victim.driver === 6) {
    const { opponent, entry, strength } = resolveState(
      victim,
      resolveOpponent,
      catalog,
    );
    increaseWeakScaryStun(victim, severity, nowMs, opponent, strength);
    entry.grudge = lowByte(Math.min(100, i32(entry.grudge + increment)));
    return { severity, increment, outcome: "human-hit-ai" };
  }

  if (victim.driver === 8 && attacker.driver === 6) {
    const { opponent, entry } = resolveState(
      attacker,
      resolveOpponent,
      catalog,
    );
    if (opponent.objective === "pursue" && opponent.target === victim.identity)
      opponent.notifyAttributedTargetHit(nowMs);
    const decrease = opponent.objective === "pursue" ? 0 : i32(2 * increment);
    entry.grudge = lowByte(Math.max(0, i32(entry.grudge - decrease)));
    return { severity, increment, outcome: "ai-hit-human" };
  }

  // No player is involved: resolve the attacker first, then the victim.
  const attackState = resolveState(attacker, resolveOpponent, catalog);
  const victimState = resolveState(victim, resolveOpponent, catalog);
  increaseWeakScaryStun(
    victim,
    severity,
    nowMs,
    victimState.opponent,
    victimState.strength,
  );
  if (
    attackState.opponent.objective === "pursue" &&
    attackState.opponent.target === victim.identity
  )
    attackState.opponent.notifyAttributedTargetHit(nowMs);
  return { severity, increment, outcome: "ai-hit-ai" };
}

/** Installed0x4adb93–0x4adbf6 initialization from catalog race and skill inputs. */
export function nativeCrashBigBangThreshold(
  raceIndex: number,
  raceCount: number,
  skill: number,
  multiplier = 1,
): number {
  if (
    !Number.isInteger(raceCount) ||
    raceCount <= 0 ||
    !Number.isInteger(raceIndex) ||
    raceIndex < 0 ||
    raceIndex >= raceCount ||
    !Number.isInteger(skill) ||
    skill < -0x80000000 ||
    skill > 0x7fffffff
  )
    throw new Error("Invalid native big-bang threshold inputs");
  const scale = storedFloat(multiplier, "big-bang multiplier");
  const rank = nativeIntegerLow32(
    (101 - 99 * (1 - raceIndex / raceCount)) * -0.1,
  );
  const term = nativeIntegerLow32(10 * skill - 3 * rank);
  return nativeIntegerLow32(Math.fround(70) - term * scale);
}
