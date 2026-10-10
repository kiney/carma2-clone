import type { Vector3 } from "three";

/** Installed SetBouncey4dcc40 / DoBouncey4de7c0. Period is milliseconds,
 * amount is metric velocity. The periodic handler affects the local player. */
export interface BouncePowerup {
  periodMs: number;
  amount: number;
  lastBounceMs: number;
}
export function setBouncePowerup(parameters: readonly number[]): BouncePowerup {
  if (
    parameters.length < 2 ||
    parameters.slice(0, 2).some((v) => !Number.isFinite(v))
  )
    throw new Error("Missing source bounce powerup parameters");
  return {
    periodMs: Math.fround(1000 / parameters[0]),
    amount: Math.fround(parameters[1]),
    lastBounceMs: 0,
  };
}
export function bouncePowerup(
  state: { velocity: Vector3; groundedWheelCount?: number },
  effect: BouncePowerup,
  nowMs: number,
): boolean {
  if (!Number.isFinite(nowMs) || nowMs < 0)
    throw new Error("Invalid bounce clock");
  const now = Math.trunc(nowMs) >>> 0;
  if (
    (now - effect.lastBounceMs) >>> 0 < effect.periodMs ||
    !((state.groundedWheelCount ?? 0) > 2)
  )
    return false;
  effect.lastBounceMs = now;
  state.velocity.y += effect.amount / 6.9;
  return true;
}
