/** Installed ordinary off-scope4d5369..4d54c5. The host performs real resource
 * release between before/after actions; replay recording is explicitly off. */
export type NativePedScopeAction =
  | "vanish"
  | "count"
  | "score-fall"
  | "score-burn"
  | "stop-burning";
export interface NativePedScopePlan {
  beforeRelease: NativePedScopeAction[];
  afterRelease: NativePedScopeAction[];
}
export function planNativePedScopeExit(input: {
  rendered: boolean;
  replay: boolean;
  active: boolean;
  flags: number;
  hitPoints: number;
  burningValue: number;
}): NativePedScopePlan {
  const beforeRelease: NativePedScopeAction[] = [],
    afterRelease: NativePedScopeAction[] = [];
  if (!input.rendered || input.replay) return { beforeRelease, afterRelease };
  let vanished = !!(input.flags & 0x80),
    alive = input.hitPoints > 0;
  if (input.active && !vanished) {
    beforeRelease.push("vanish");
    vanished = true;
    afterRelease.push("count");
    if (alive) {
      afterRelease.push("score-fall");
      alive = false;
    }
  }
  if (input.burningValue > 0) {
    if (alive) afterRelease.push("score-burn");
    afterRelease.push("stop-burning");
    if (!vanished) afterRelease.push("vanish", "count");
  } else if (input.burningValue < 0) afterRelease.push("stop-burning");
  return { beforeRelease, afterRelease };
}
/** FindYVerticallyBelow initializes its no-hit result to Float32−MAX at
 *4e4158 and returns it at4e431f; no invented height0 fallback is used. */
export function nativePedFallingHeight(
  y: number,
  floor: number | null,
): number {
  const maximum = 3.4028234663852886e38;
  if (
    !Number.isFinite(Math.fround(y)) ||
    (floor !== null && !Number.isFinite(Math.fround(floor)))
  )
    throw new Error("Invalid native pedestrian falling-height input");
  const height = Math.fround(
    Math.fround(y) - (floor === null ? -maximum : Math.fround(floor)),
  );
  if (!Number.isFinite(height))
    throw new Error("Non-finite native pedestrian falling height");
  return height;
}
