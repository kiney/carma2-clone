export interface RacePayoutOptions {
  snapshotCredits: number;
  completionBonus: number;
  /** Remaining race time in seconds; native storage is integer milliseconds. */
  timeLeft: number;
  rate: number;
  /** Runtime variable 99: suppress animation, while retaining final payout. */
  suppressPresentation: boolean;
}

/** 0 is the initial finish delay; 1–6 are the native bonus-state values. */
export type RacePayoutState = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type RacePayoutSound = 8015;

/** Offline successful-race payout. Call update once per rendered frame:
 * native dispatch executes one state per frame, without carrying a large dt
 * through multiple transitions. Installed HW: RaceCompleted 0x502d80,
 * MungeRaceFinished 0x493a7d, bonus animation 0x49348c–0x493730.
 */
export class RacePayout {
  readonly snapshotCredits: number;
  readonly completionBonus: number;
  readonly totalBonus: number;
  readonly rate: number;
  readonly suppressPresentation: boolean;
  credits: number;
  displayedBonus = 0;
  state: RacePayoutState = 0;
  finished = false;
  private timerMs: number;
  private clockMs = 0;
  private stateStartMs = 0;
  private lastRattleMs = 0;
  private finishDelayMs = 10000;

  constructor(options: RacePayoutOptions) {
    for (const value of [
      options.snapshotCredits,
      options.completionBonus,
      options.timeLeft,
      options.rate,
    ]) {
      if (!Number.isFinite(value) || value < 0)
        throw new RangeError("Race payout inputs must be finite and nonnegative");
    }
    this.snapshotCredits = options.snapshotCredits;
    this.credits = options.snapshotCredits;
    this.completionBonus = options.completionBonus;
    this.rate = options.rate;
    this.suppressPresentation = options.suppressPresentation;
    this.timerMs = Math.trunc(options.timeLeft * 1000);
    // Snapshot precedes the runtime-99 presentation guard, 0x493b01–0x493b34.
    this.totalBonus =
      this.completionBonus + Math.trunc(this.timerMs / 1000) * this.rate;
  }

  get timeLeft(): number {
    return this.timerMs / 1000;
  }

  /** Return/Keypad Return bypass presentation and retain full settlement. */
  skip(): void {
    if (this.finished) return;
    // Race-loop exit reconciles even partially displayed awards, 0x493c4d.
    this.credits = this.snapshotCredits + this.totalBonus;
    this.finished = true;
  }

  update(dtMs: number, gameTimeMs?: number): RacePayoutSound[] {
    if (!Number.isFinite(dtMs) || dtMs < 0)
      throw new RangeError("Race payout timestep must be finite and nonnegative");
    if (gameTimeMs !== undefined &&
      (!Number.isFinite(gameTimeMs) || gameTimeMs < 0))
      throw new RangeError("Invalid race payout game timestamp");
    if (this.finished) return [];
    const previousClock = Math.floor(this.clockMs);
    this.clockMs = gameTimeMs ?? this.clockMs + dtMs;
    const now = Math.floor(this.clockMs);
    if (this.state === 0) {
      // Native finish countdown uses frame period, while later states use
      // absolute GetTotalTime timestamps, which can regress after stalls.
      this.finishDelayMs -= gameTimeMs === undefined ? now - previousClock : dtMs;
      if (this.finishDelayMs <= 0) {
        // 0x493b6f–0x493bf3: no animation with zero timer or runtime 99.
        if (this.timerMs === 0 || this.suppressPresentation) this.skip();
        else this.enter(1, now);
      }
      return [];
    }

    const elapsed = now - this.stateStartMs;
    switch (this.state) {
      case 1:
        if (elapsed >= 500) {
          this.credits += this.completionBonus;
          this.enter(2, now);
          return [8015]; // Clap, 0x4934e3–0x493513.
        }
        break;
      case 2:
        if (elapsed >= 2000) this.enter(3, now);
        break;
      case 3:
        if (this.timerMs === 0) this.enter(4, now);
        else {
          const delta = elapsed - this.lastRattleMs;
          if (delta > 15) {
            const steps = Math.floor(delta / 15);
            const previousTimer = this.timerMs;
            this.timerMs = Math.max(0, previousTimer - 1000 * steps);
            this.displayedBonus +=
              Math.trunc((previousTimer - this.timerMs) / 1000) * this.rate;
            this.lastRattleMs += 15 * steps;
          }
        }
        break;
      case 4:
        if (elapsed >= 1000) this.enter(5, now);
        break;
      case 5:
        if (this.displayedBonus === 0) this.enter(6, now);
        else {
          const delta = elapsed - this.lastRattleMs;
          if (delta > 15) {
            const previousBonus = this.displayedBonus;
            // Native truncates delta*rate/15, not floor(delta/15)*rate.
            this.displayedBonus = Math.max(
              0,
              previousBonus - Math.floor((delta * this.rate) / 15),
            );
            this.credits += previousBonus - this.displayedBonus;
            this.lastRattleMs += 15 * Math.floor(delta / 15);
          }
        }
        break;
      case 6:
        if (elapsed >= 2000) this.skip();
        break;
    }
    return [];
  }

  private enter(state: RacePayoutState, now: number): void {
    this.state = state;
    this.stateStartMs = now;
    this.lastRattleMs = 0;
  }
}
