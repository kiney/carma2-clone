import type { RaceCatalog } from "../config";

const DEFAULT_NASTINESS_THRESHOLD = 2 ** -22;
const DOUBLE_ONE_THIRD = 0.3333333333333333;

function storedFloat(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`Invalid ${label}`);
  const stored = Math.fround(value);
  if (!Number.isFinite(stored)) throw new Error(`Invalid ${label}`);
  return stored;
}

/** Installed LoadRaces stores each race nastiness as F32. Values at or below
 * the native epsilon sentinel are interpolated from the catalog endpoints. */
export function resolveNativeRaceNastiness(
  catalog: RaceCatalog,
  raceIndex: number,
): number {
  if (
    !Number.isInteger(raceIndex) ||
    raceIndex < 0 ||
    raceIndex >= catalog.races.length
  )
    throw new RangeError("Invalid native nastiness race index");
  const count = catalog.races.length;
  const authored = storedFloat(
    catalog.races[raceIndex].opponentNastinessLevel,
    "authored opponent nastiness",
  );
  if (authored > DEFAULT_NASTINESS_THRESHOLD) return authored;
  if (count <= 1)
    throw new RangeError("Cannot interpolate native nastiness with one race");

  const first = storedFloat(
    catalog.firstRaceDefaults.nastinessInfluencer,
    "first-race nastiness default",
  );
  const last = storedFloat(
    catalog.lastRaceDefaults.nastinessInfluencer,
    "last-race nastiness default",
  );
  return Math.fround(first + (last - first) * (raceIndex / (count - 1)));
}

/** Installed InitOpponents nastiness calculation (HW 0x4addab–f3).
 * Intermediate values stay in x87 precision; inputs and final opponent field
 * cross F32 stores. */
export function nativeOpponentNastiness(
  raceLevel: number,
  skillLevel: number,
  strengthRating: number,
  multiplier = 1,
): number {
  const race = storedFloat(raceLevel, "race nastiness");
  const scale = storedFloat(multiplier, "opponent nastiness multiplier");
  if (
    !Number.isInteger(skillLevel) ||
    skillLevel < -0x80000000 ||
    skillLevel > 0x7fffffff ||
    !Number.isInteger(strengthRating) ||
    strengthRating < -0x80000000 ||
    strengthRating > 0x7fffffff
  )
    throw new Error("Invalid native opponent skill or strength");

  // Native DEC wraps the signed integer before FILD converts it.
  const negativeStrength = ((strengthRating - 1) | 0) * -0.25;
  const negativeSkill = skillLevel * -0.5;
  const adjusted = race - (negativeStrength + negativeSkill);
  const result = Math.fround(adjusted * DOUBLE_ONE_THIRD * scale);
  if (!Number.isFinite(result))
    throw new Error("Native opponent nastiness exceeds Float32 bounds");
  return result;
}

export type NativeForcedPersonality = 0 | 1 | 2 | 3;

function random15(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1)
    throw new Error("Native personality random sample must be in [0, 1)");
  return Math.floor(value * 0x8000);
}

function randomInclusive(
  random: () => number,
  low: number,
  high: number,
): number {
  return low + Math.trunc((random15(random) * (high - low + 1)) / 0x8000);
}

function assignSlots(
  personalities: NativeForcedPersonality[],
  count: number,
  quota: number,
  type: 1 | 2,
  random: () => number,
  initialBound: number,
): void {
  for (let index = 0; index < quota; index++) {
    const start = randomInclusive(random, 0, initialBound - index);
    let slot = start;
    while (personalities[slot] !== 0) {
      slot++;
      if (slot >= count) slot = 0;
      if (slot === start)
        throw new Error("Native personality slot scan exhausted");
    }
    personalities[slot] = type;
  }
}

/** Installed InitOpponents forced objective quotas. Choices are made over
 * opponent instance slots and scan forward with wrap after each bounded draw. */
export function assignNativePersonalities(
  count: number,
  raceLevel: number,
  random = Math.random,
): NativeForcedPersonality[] {
  if (!Number.isInteger(count) || count < 0 || count > 15)
    throw new RangeError("Native regular opponent count must be 0..15");
  const level = storedFloat(raceLevel, "race nastiness");
  const personalities = Array.from(
    { length: count },
    (): NativeForcedPersonality => 0,
  );
  if (!count) return personalities;
  if (level >= 10) return personalities.fill(3);

  const getNearQuota = Math.trunc(0.6 * count);
  const completeRaceQuota = Math.trunc(0.2 * count);
  assignSlots(personalities, count, getNearQuota, 2, random, count - 1);
  assignSlots(
    personalities,
    count,
    completeRaceQuota,
    1,
    random,
    count - getNearQuota - 1,
  );
  return personalities;
}
