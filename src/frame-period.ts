/** Non-replay UpdateFramePeriod model from rec2 mainloop.c. Static analysis verified the
 * installed CARMA2_HW tail at 0x49252a: frame periods below 10ms are assigned
 * 10ms and lastTick is snapped to now (0x492547); the source annotation
 * 0x492680 does not match the installed function address. Times are unsigned
 * millisecond ticks. The remaining filters follow rec2's source algorithm;
 * the average multiplication wraps as verified in the installed binary.
 */
export interface FramePeriodSample {
  framePeriodMs: number;
  cameraPeriodMs: number;
  averageFramePeriodMs: number;
  gameTimeMs: number;
}

const U32 = 0xffff_ffff;
const u32 = (value: number) => value >>> 0;
const signed32 = (value: number) => value | 0;

function tick(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`Invalid ${name}`);
  return u32(value);
}

/** Reproduces rec2's ordinary UpdateFramePeriod branch and GetTotalTime.
 * The caller supplies elapsed race time because native gRace_start is a
 * separate game-clock value, while UpdateFramePeriod compares it to OS ticks.
 */
export class NativeFramePeriodClock {
  private actualLastTick: number;
  private lastTick: number;
  private framePeriod = 100;
  private average: number;
  private lostTime = 0;
  private cameraPeriod = 100;

  constructor(initialTickMs: number, averageFramePeriodMs = 0) {
    const initial = tick(initialTickMs, "initial tick");
    this.actualLastTick = initial;
    this.lastTick = initial;
    this.average = tick(averageFramePeriodMs, "average frame period");
  }

  /** MainGameLoop resets these tick fields for a new race but keeps the
   * process-global average and lost-time accumulator. */
  resetMainLoop(initialTickMs: number): void {
    const initial = tick(initialTickMs, "initial tick");
    this.actualLastTick = initial;
    this.lastTick = initial;
    this.framePeriod = 100;
    this.cameraPeriod = 100;
  }

  /** Advance once per rendered frame using integer OS ticks and native race age. */
  advance(nowMs: number, raceElapsedMs: number): FramePeriodSample {
    const now = tick(nowMs, "OS tick");
    const raceElapsed = tick(raceElapsedMs, "race elapsed time");

    this.lastTick = u32(this.lastTick + this.framePeriod);
    const error = signed32(now - this.lastTick);
    this.framePeriod = u32(now - this.actualLastTick);

    if (this.framePeriod > 500 && raceElapsed > 2000) {
      this.framePeriod = Math.trunc(this.average / 10);
      this.lastTick = now;
    }

    // Installed 0x4924cf-0x4924e7 uses LEA for 9*average in 32 bits, then an
    // unsigned multiply/shift sequence for division by 10.
    const scaledAverage = Math.imul(9, this.average) >>> 0;
    this.average = u32(Math.trunc(scaledAverage / 10) + this.framePeriod);
    if (raceElapsed > 2000) this.framePeriod = Math.trunc(this.average / 10);

    const newPeriod = signed32(this.framePeriod + error);
    if (newPeriod > 0) this.framePeriod = u32(newPeriod);
    else this.lastTick = now;
    this.actualLastTick = now;

    if (this.framePeriod < 10) {
      this.framePeriod = 10;
      this.lastTick = now;
    } else if (this.framePeriod > 1000) {
      this.framePeriod = 1000;
      this.lastTick = now;
    }

    this.cameraPeriod = Math.max(10, Math.min(1000, this.framePeriod));
    return this.sample();
  }

  /** Native AddLostTime: remove paused/menu duration from GetTotalTime. */
  addLostTime(milliseconds: number): void {
    const lost = tick(milliseconds, "lost time");
    this.lostTime = u32(this.lostTime + lost);
  }

  sample(): FramePeriodSample {
    return {
      framePeriodMs: this.framePeriod,
      cameraPeriodMs: this.cameraPeriod,
      averageFramePeriodMs: this.average,
      gameTimeMs: u32(this.framePeriod + this.lastTick - this.lostTime),
    };
  }
}
