export type NativeRegularObjective =
  | "complete-race"
  | "get-near-player"
  | "pursue";

function random15(random: () => number): number {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1)
    throw new Error("Native opponent random sample must be in [0, 1)");
  return Math.floor(value * 32768);
}

/** Installed PercentageChance512f30, including the zero/no-random shortcut.
 * This is a 0..99 draw; rec2's inclusive 0..100 reconstruction is different. */
export function nativePercentageChance(
  percent: number,
  random = Math.random,
): boolean {
  if (
    !Number.isInteger(percent) ||
    percent < -2147483648 ||
    percent > 2147483647
  )
    throw new Error("Invalid native opponent percentage");
  if (percent === 0) return false;
  return Math.floor((random15(random) * 100) / 32768) < percent;
}

/** NewObjective4aab10 always draws an inclusive20..60 second deadline,
 * including same-objective restarts. Pursuit adds90 seconds. */
export function nativeObjectiveDeadline(
  nowMs: number,
  pursuit: boolean,
  random = Math.random,
): number {
  if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs > 0xffffffff)
    throw new Error("Invalid native opponent objective timestamp");
  const seconds = 20 + Math.floor((random15(random) * 41) / 32768);
  return (nowMs + seconds * 1000 + (pursuit ? 90000 : 0)) >>> 0;
}

/** Forced regular-rival selection only. Fresh sightings, grudges, nastiness
 * and police objectives are separate earlier native decision branches. */
export function chooseForcedRegularObjective(
  movedEver: boolean,
  pursueFromStart: boolean,
  forcedType: number,
  playerDistance: number,
  random = Math.random,
): NativeRegularObjective {
  const distance = Math.fround(playerDistance);
  if (
    !Number.isFinite(distance) ||
    distance < 0 ||
    !Number.isInteger(forcedType)
  )
    throw new Error("Invalid native regular opponent objective input");
  if (!movedEver) return pursueFromStart ? "pursue" : "complete-race";
  if (forcedType === 1) return "complete-race";
  if (forcedType === 2) return "get-near-player";
  if (forcedType === 3) return "pursue";
  return nativePercentageChance(Math.trunc(distance) - 15, random)
    ? "get-near-player"
    : "complete-race";
}
