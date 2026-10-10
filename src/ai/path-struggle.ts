export interface NativeStruggleThresholds {
  stopAtMs: number;
  brakeAtMs: number;
}

export interface NativeStruggleTiming extends NativeStruggleThresholds {
  stop: boolean;
  brake: boolean;
}

const U32_MAX = 0xffffffff;

function checkedU32(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > U32_MAX)
    throw new Error(`Invalid native struggle ${label}`);
  return value;
}

/** ProcessFollowPath's installed existing-struggle timers (0x4afa33–0x4afb14).
 * This deliberately preserves the count-zero unsigned 750*count-750 wrap. */
export function nativeStruggleThresholds(
  struggleStartMs: number,
  count: number,
  mass: number,
): NativeStruggleThresholds {
  const start = checkedU32(struggleStartMs, "start timestamp");
  if (!Number.isInteger(count) || count < 0 || count > 0xff)
    throw new Error("Invalid native struggle count");
  if (!Number.isFinite(mass) || !Number.isFinite(Math.fround(mass)))
    throw new Error("Invalid native struggle mass");

  const countDelay = (750 * count - 750) >>> 0;
  const signedStopBase = ((start + 2750) >>> 0) | 0;
  const unsignedBrakeBase = (start + 2000) >>> 0;
  const nativeMass = Math.fround(mass);
  return {
    stopAtMs: signedStopBase + 30 * nativeMass + countDelay,
    brakeAtMs: unsignedBrakeBase + 15 * nativeMass + countDelay,
  };
}

/** Strict native comparisons with stop taking precedence over the brake phase. */
export function nativeStruggleTiming(
  nowMs: number,
  struggleStartMs: number,
  count: number,
  mass: number,
): NativeStruggleTiming {
  const now = checkedU32(nowMs, "current timestamp");
  const thresholds = nativeStruggleThresholds(struggleStartMs, count, mass);
  const stop = now > thresholds.stopAtMs;
  return {
    ...thresholds,
    stop,
    brake: !stop && now > thresholds.brakeAtMs,
  };
}
