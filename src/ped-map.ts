import type { RaceType } from "./config";

export interface PedestrianMapPolicy {
  effectActive: boolean;
  raceType?: RaceType;
  targetGroups?: readonly number[];
}

/** Installed map 0x495cbd enables peds for action29 or a pedestrian mission. */
export function pedestrianMapEnabled(policy: PedestrianMapPolicy): boolean {
  return policy.effectActive || policy.raceType === "peds";
}

/** GetPedPosition 0x4d2a10: live, processed peds; mission target flag200
 * derives from the authored spawn group. Replay/network policies are separate.
 */
export function pedestrianMapEligible(
  alive: boolean,
  active: boolean,
  group: number,
  policy: PedestrianMapPolicy,
): boolean {
  return (
    pedestrianMapEnabled(policy) &&
    alive &&
    active &&
    (policy.raceType !== "peds" || !!policy.targetGroups?.includes(group))
  );
}

/** Installed 0x495d0b passes palette index52 to the map point renderer. */
export function pedestrianMapColor(palette?: Uint8Array): string | undefined {
  const offset = 52 * 4;
  if (!palette || palette.length < offset + 3) return;
  return `rgb(${palette[offset]}, ${palette[offset + 1]}, ${palette[offset + 2]})`;
}

/** Native 0x496610 clips the projected float before truncating to one pixel. */
export function drawPedestrianMapPoint(
  context: Pick<CanvasRenderingContext2D, "canvas" | "fillRect">,
  x: number,
  y: number,
): boolean {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    y < 0 ||
    x >= context.canvas.width ||
    y >= context.canvas.height
  )
    return false;
  context.fillRect(Math.trunc(x), Math.trunc(y), 1, 1);
  return true;
}
