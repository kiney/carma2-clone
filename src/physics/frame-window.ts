/** Installed PHILDoPhysics0x4b63d0: absolute windows, fixed40ms, max5 steps. */
export const PHYSICS_WINDOW_STEP_MS = 40;
export const PHYSICS_WINDOW_MAX_STEPS = 5;
const MAX_TICK = 0xffff_ffff;

export interface PhysicsFrameWindow {
  frameEndMs: number;
  stepStartMs: number;
  lastPhysicsTickMs: number;
  skippedMs: number;
  steps: number;
  interpolationAlpha: number;
}

function tick(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > MAX_TICK)
    throw new Error(`Invalid ${name}: expected an unsigned millisecond tick`);
}

/** Windows use one race-relative epoch. Wrapped or backward epochs require an
 * explicit reset by the caller; this API does not infer a new race from them. */
export function planPhysicsFrameWindow(
  lastPhysicsTickMs: number,
  frameStartMs: number,
  framePeriodMs: number,
): PhysicsFrameWindow {
  tick(lastPhysicsTickMs, "last physics tick");
  tick(frameStartMs, "frame start");
  if (
    !Number.isInteger(framePeriodMs) ||
    framePeriodMs < 10 ||
    framePeriodMs > 1000
  )
    throw new Error(
      "Invalid frame period: expected 10–1000 integer milliseconds",
    );
  const frameEndMs = frameStartMs + framePeriodMs;
  tick(frameEndMs, "frame end");
  // HW4b641b..2f resynchronizes only when the start is strictly newer.
  const stepStartMs =
    frameStartMs > lastPhysicsTickMs
      ? Math.floor(frameStartMs / PHYSICS_WINDOW_STEP_MS) *
        PHYSICS_WINDOW_STEP_MS
      : lastPhysicsTickMs;
  const steps = Math.min(
    PHYSICS_WINDOW_MAX_STEPS,
    Math.max(0, Math.ceil((frameEndMs - stepStartMs) / PHYSICS_WINDOW_STEP_MS)),
  );
  const completedTick = stepStartMs + steps * PHYSICS_WINDOW_STEP_MS;
  tick(completedTick, "completed physics tick");
  // HW4b689b..e4 resets an out-of-range backward interpolation fraction to0.
  // Existing browser pose interpolation runs forward from previous to latest.
  const backward = (completedTick - frameEndMs) / PHYSICS_WINDOW_STEP_MS;
  const interpolationAlpha = backward >= 0 && backward <= 1 ? 1 - backward : 1;
  return {
    frameEndMs,
    stepStartMs,
    lastPhysicsTickMs: completedTick,
    skippedMs: stepStartMs - lastPhysicsTickMs,
    steps,
    interpolationAlpha,
  };
}
