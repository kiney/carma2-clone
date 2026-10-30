import {
  assignNativePersonalities,
  type NativeForcedPersonality,
} from "./personality";

export interface NativeOpponentInitializationInstance {
  repairIntervalMs: number;
  visibilityDelayMs: number;
}

export interface NativeOpponentInitializationPlan {
  instances: NativeOpponentInitializationInstance[];
  personalities: NativeForcedPersonality[];
}

function inclusive(random: () => number, low: number, high: number): number {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
    throw new RangeError("Native opponent startup sample must be in [0, 1)");
  // Installed IRandomBetween HW0x512f00/SW0x50dd00 multiplies signed32 before
  // truncating towards zero. Authored repair ranges have positive products.
  const product = Math.imul(Math.floor(sample * 32768), (high - low + 1) | 0);
  return (low + Math.trunc(product / 32768)) | 0;
}

/** Installed InitOpponents HW0x4adaf0/SW0x4a94a0 draws repair then visibility for
 * every regular instance, followed by the personality quotas. HW draw sites:
 * 0x4adcbc, 0x4add11, then 0x4ae017/0x4ae08c. This plan preserves that chronology.
 * Reserving it before browser asset awaits is an integration extension, not
 * whole-launch CRT parity. Publication supplies timestamps without new draws.
 */
export function planNativeOpponentInitialization(
  count: number,
  raceLevel: number,
  repairLimits: readonly [number, number],
  random: () => number,
): NativeOpponentInitializationPlan {
  if (!Number.isInteger(count) || count < 0 || count > 15)
    throw new RangeError("Native regular opponent count must be 0..15");
  const level = Math.fround(raceLevel);
  if (!Number.isFinite(raceLevel) || !Number.isFinite(level))
    throw new RangeError("Invalid native opponent startup race nastiness");
  if (
    !Array.isArray(repairLimits) ||
    repairLimits.length !== 2 ||
    ![repairLimits[0], repairLimits[1]].every(
      (value) => Number.isInteger(value) && value >= 0 && value <= 0x7fffffff,
    ) ||
    repairLimits[1] < repairLimits[0]
  )
    throw new RangeError("Invalid native opponent startup repair limits");
  if (typeof random !== "function")
    throw new TypeError("Native opponent startup requires a random callback");

  const instances = Array.from({ length: count }, () => ({
    // GENERAL labels these seconds; the installed initializer uses 60000.
    repairIntervalMs:
      Math.imul(60000, inclusive(random, repairLimits[0], repairLimits[1])) >>>
      0,
    visibilityDelayMs: inclusive(random, 0, 900),
  }));
  return {
    instances,
    personalities: assignNativePersonalities(count, level, random),
  };
}
