import { NativeFramePeriodClock } from "./frame-period";

export interface GameFrame {
  periodMs: number;
  cameraPeriodMs: number;
  /** Pause-adjusted predicted start and end, relative to this race. */
  startMs: number;
  endMs: number;
  /** Native process-clock timestamp, including accumulated lost-time removal. */
  totalTimeMs: number;
  /** Signed native timestamp change; prediction can regress after a stall. */
  clockDeltaMs: number;
}

function wallTick(now: number): number {
  if (
    !Number.isFinite(now) ||
    now < 0 ||
    !Number.isSafeInteger(Math.floor(now))
  )
    throw new Error("Invalid browser wall tick");
  return Math.floor(now);
}

/** Native frame sampling with explicit browser scheduling extensions:
 * render independently, gate gameplay to <=100Hz, and shift paused sampling origins.
 * The native period, smoothing, error correction and clamps remain unchanged.
 */
export class BrowserGameClock {
  private readonly native = new NativeFramePeriodClock(0);
  private wallRaceStart = 0;
  private gameEpoch = 0;
  private lastFrameWall = 0;
  private lastGameEnd = 0;
  private pauseStart?: number;
  private started = false;

  start(now: number, paused = false): void {
    const tick = wallTick(now);
    this.native.resetMainLoop(tick);
    // Native MainGameLoop advances its clock before establishing race start.
    const initial = this.native.advance(tick, 0);
    this.wallRaceStart = tick;
    this.gameEpoch = (initial.gameTimeMs - initial.framePeriodMs) >>> 0;
    this.lastFrameWall = tick;
    this.lastGameEnd = 0;
    this.pauseStart = paused ? tick : undefined;
    this.started = true;
  }

  setPaused(paused: boolean, now: number): void {
    const tick = wallTick(now);
    if (!this.started) return;
    if (paused) {
      this.pauseStart ??= tick;
    } else if (this.pauseStart !== undefined) {
      if (tick < this.pauseStart)
        throw new Error("Browser wall time went backwards");
      this.native.addLostTime(tick - this.pauseStart);
      this.native.shiftSampling(tick - this.pauseStart);
      this.lastFrameWall += tick - this.pauseStart;
      this.pauseStart = undefined;
    }
  }

  sample(now: number, active: boolean): GameFrame | undefined {
    const tick = wallTick(now);
    if (!this.started) return;
    this.setPaused(!active, tick);
    if (!active) return;
    if (tick < this.lastFrameWall)
      throw new Error("Browser wall time went backwards");
    // Without this gate a 144/240Hz RAF would multiply the native 10ms floor.
    if (tick - this.lastFrameWall < 10) return;
    const sample = this.native.advance(tick, (tick - this.wallRaceStart) >>> 0);
    const startMs =
      (sample.gameTimeMs - sample.framePeriodMs - this.gameEpoch) >>> 0;
    const endMs = (sample.gameTimeMs - this.gameEpoch) >>> 0;
    const clockDeltaMs = (endMs - this.lastGameEnd) | 0;
    this.lastGameEnd = endMs;
    this.lastFrameWall = tick;
    return {
      periodMs: sample.framePeriodMs,
      cameraPeriodMs: sample.cameraPeriodMs,
      startMs,
      endMs,
      totalTimeMs: sample.gameTimeMs,
      clockDeltaMs,
    };
  }
}
