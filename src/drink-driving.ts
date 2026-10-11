/** Independently reconstructed SetPissed4df040/PissedEffect4df1d0.
 * This handler changes camera FOV and earned credits, not tyre or steering forces. */
export class NativeDrinkDriving {
  creditMultiplier = 0;
  private amplitude = 0;
  private periodMs = 1;
  private phaseMs = 0;
  private nextVoiceMs = 0;

  constructor(private readonly random: () => number) {}

  private integer(low: number, high: number): number {
    const sample = Math.floor(this.random() * 32768);
    return low + Math.trunc(Math.imul(sample, high + 1 - low) / 32768);
  }

  set(
    floatParams: readonly number[],
    integerParams: readonly number[],
    nowMs: number,
  ): void {
    const [amplitude, low, high] = floatParams.map(Math.fround);
    const multiplier = integerParams[0];
    if (
      ![amplitude, low, high, multiplier, nowMs].every(Number.isFinite) ||
      low <= 0 ||
      high < low ||
      !Number.isSafeInteger(multiplier)
    )
      throw new Error("Invalid Drink Driving parameters");
    // Source random order: voice deadline, period, phase.
    this.nextVoiceMs = (Math.trunc(nowMs) + this.integer(1500, 3000)) >>> 0;
    this.creditMultiplier = multiplier | 0;
    this.amplitude = amplitude;
    this.periodMs = Math.fround(low + this.random() * (high - low));
    this.phaseMs = Math.fround(this.random() * this.periodMs);
  }

  reset(): void {
    this.creditMultiplier = 0;
  }

  /** Original 65-entry float cosine table is generated here, not copied.
   * Four quadrants and truncation retain source BRender angle quantization. */
  fovAngle16(baseFovDegrees: number, nowMs: number): number {
    if (!Number.isFinite(baseFovDegrees) || !Number.isFinite(nowMs))
      throw new Error("Invalid Drink Driving camera input");
    if (this.creditMultiplier === 0)
      return Math.trunc(baseFovDegrees * (65536 / 360)) & 0xffff;
    const phase =
      ((((Math.trunc(nowMs) >>> 0) + this.phaseMs) % this.periodMs) /
        this.periodMs) *
      (2 * Math.PI);
    let quarter: number, sign: number;
    if (phase > (3 * Math.PI) / 2) {
      quarter = 2 * Math.PI - phase;
      sign = 1;
    } else if (phase > Math.PI) {
      quarter = phase - Math.PI;
      sign = -1;
    } else if (phase > Math.PI / 2) {
      quarter = Math.PI - phase;
      sign = -1;
    } else {
      quarter = phase;
      sign = 1;
    }
    const index = Math.trunc(quarter * (256 / (2 * Math.PI)));
    const cosine = sign * Math.fround(Math.cos(index * (Math.PI / 128)));
    return (
      Math.trunc(
        (cosine * this.amplitude + 1) *
          Math.fround(baseFovDegrees) *
          (65536 / 360),
      ) & 0xffff
    );
  }

  /** Source compares unsigned absolute times strictly and consumes pitch,
   * probability and next-delay draws even without an audio device. */
  periodic(
    nowMs: number,
  ): { id: 3602 | 3603; playbackRate: number } | undefined {
    const now = Math.trunc(nowMs) >>> 0;
    if (this.creditMultiplier === 0 || now <= this.nextVoiceMs) return;
    const pitch = this.integer(0xc000, 0x14000);
    const id = Math.trunc(this.random() * 100) < 50 ? 3602 : 3603;
    this.nextVoiceMs = (now + this.integer(1500, 3000)) >>> 0;
    return { id, playbackRate: pitch / 65536 };
  }

  get snapshot() {
    return {
      creditMultiplier: this.creditMultiplier,
      amplitude: this.amplitude,
      periodMs: this.periodMs,
      phaseMs: this.phaseMs,
      nextVoiceMs: this.nextVoiceMs,
    };
  }
}
