import type { MotionState } from "./motion";
import { C2_WORLD_SCALE } from "./motion";

/** Installed PollCarControls0x443e5a: before physics, zero revs and all linear
 * velocity, preserving angular velocity. Grounding only controls feedback. */
export function instantHandbrake(
  state: Pick<MotionState, "velocity" | "rpm">,
): void {
  state.rpm = 0;
  state.velocity.set(0, 0, 0);
}

/** Installed KangerooJump0x4ddec0 adds to world Y, including when airborne.
 * Cars in this engine are always integrated, so no sleeping flag needs waking. */
export function commandJump(
  state: Pick<MotionState, "velocity">,
  amount: number,
): void {
  if (!Number.isFinite(amount))
    throw new Error("Invalid command jump parameter");
  state.velocity.y += amount / C2_WORLD_SCALE;
}
