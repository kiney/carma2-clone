/** Average rendered frames over the elapsed wall-clock window. */
export class RenderFpsSampler {
  private previousTimeMs: number;
  private windowStartMs: number;
  private frames = 0;

  constructor(
    initialTimeMs: number,
    private readonly windowMs = 1000,
  ) {
    if (!Number.isFinite(initialTimeMs))
      throw new RangeError("Initial render timestamp must be finite");
    if (!Number.isFinite(windowMs) || windowMs <= 0)
      throw new RangeError("FPS sampling window must be positive and finite");
    this.previousTimeMs = initialTimeMs;
    this.windowStartMs = initialTimeMs;
  }

  /** Returns a new rounded estimate once a full window has elapsed. */
  sample(timestampMs: number): number | undefined {
    if (!Number.isFinite(timestampMs) || timestampMs < this.previousTimeMs)
      return undefined;

    this.previousTimeMs = timestampMs;
    this.frames++;
    const elapsedMs = timestampMs - this.windowStartMs;
    if (elapsedMs < this.windowMs) return undefined;

    const fps = Math.round((this.frames * 1000) / elapsedMs);
    // Match the runtime's existing window policy: discard excess elapsed time
    // and start the next window at the frame that produced this estimate.
    this.windowStartMs = timestampMs;
    this.frames = 0;
    return fps;
  }
}
