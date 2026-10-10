const TURN = 0x10000;
const f32 = Math.fround;

export interface CameraControlInput {
  zoom: number;
  yaw: number;
  reset: boolean;
  reverse: boolean;
  dtMs: number;
  closer: boolean;
  farther: boolean;
  orbitLeft: boolean;
  orbitRight: boolean;
}

export interface CameraControlResult {
  zoom: number;
  yaw: number;
  reset: boolean;
  manualMove: boolean;
}

function checkInput(input: CameraControlInput): void {
  if (!Number.isFinite(input.zoom)) throw new Error("Invalid camera zoom");
  if (!Number.isInteger(input.yaw) || input.yaw < 0 || input.yaw > 0xffff)
    throw new Error("Invalid camera yaw");
  if (
    !Number.isInteger(input.dtMs) ||
    input.dtMs < 0 ||
    input.dtMs > 0xffffffff
  )
    throw new Error("Invalid camera control timestep");
  if (
    [
      input.reset,
      input.reverse,
      input.closer,
      input.farther,
      input.orbitLeft,
      input.orbitRight,
    ].some((value) => typeof value !== "boolean")
  )
    throw new Error("Invalid camera control flags");
}

/** Pure port of the ordinary DoCameraControls zoom/orbit inputs. Native zoom
 * and degree-step intermediates are single precision; yaw wraps as BRender's
 * unsigned 16-bit angle. Countdown, replay, and post-race swirl gating belong
 * to the caller and are deliberately outside this helper. */
export function applyCameraControls(
  input: CameraControlInput,
): CameraControlResult {
  checkInput(input);

  let zoom = f32(input.zoom);
  const dtFloat = f32(input.dtMs);
  const step = f32(f32(dtFloat * 5) / 10000);
  if (input.farther) zoom = f32(Math.min(2, f32(zoom + step)));
  if (input.closer) zoom = f32(Math.max(0.1, f32(zoom - step)));

  let yaw = input.yaw;
  let reset = input.reset;
  const left = input.reverse ? input.orbitRight : input.orbitLeft;
  const right = input.reverse ? input.orbitLeft : input.orbitRight;
  if (left && right) {
    yaw = 0;
    reset = true;
  } else if (!left && !right) {
    reset = false;
  } else if (!reset) {
    const degrees = f32(dtFloat * f32(0.05));
    const angleStep = Math.trunc((degrees * TURN) / 360);
    yaw = (yaw + (left ? -angleStep : angleStep)) & 0xffff;
  }

  return {
    zoom,
    yaw,
    reset,
    manualMove: input.orbitLeft || input.orbitRight,
  };
}
