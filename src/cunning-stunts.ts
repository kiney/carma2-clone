import type { SkillAward } from "./race-awards";

export interface CunningStuntVector {
  x: number;
  y: number;
  z: number;
}
export interface CunningStuntInput {
  /** Raw PDGetTotalTime, not GetTotalTime or race timer time. */
  pdTimeMs: number;
  driver: number;
  mass: number;
  bodyInertia: CunningStuntVector;
  bodyAngularVelocity: CunningStuntVector;
  upY: number;
  wheelsDown: number;
  /** Undefined means no native special-volume pointer. */
  volumeGravity?: number;
  actionReplay: boolean;
  skill: 0 | 1 | 2;
  creditsBySkill: SkillAward;
}
export interface CunningStuntState {
  lastAwardMs: number;
  wildStartMs: number;
  mildStartMs: number;
  mildEndMs: number;
  wheelsStartMs: number;
  upsideDownMs: number;
}
export interface CunningStuntAward {
  kind: "wild" | "landing";
  credits: number;
  fancyIndex: 18;
  seconds: 0;
}

/** Installed41ee3e..efbb. Native field inputs are Float32. X/Y remain x87
 * temporaries; Z is explicitly stored Float32 at41eed0 before comparison. */
export function nativeCunningStuntMotion(
  inertia: CunningStuntVector,
  omega: CunningStuntVector,
) {
  const scaleSquared = Math.fround(47.61);
  const x =
    ((scaleSquared * Math.fround(inertia.x) + 3.3) / 2) *
    Math.abs(Math.fround(omega.x));
  const y =
    ((scaleSquared * Math.fround(inertia.y) + 3.57) / 2) *
    Math.abs(Math.fround(omega.y));
  const z = Math.fround(
    ((scaleSquared * Math.fround(inertia.z) + 0.44) / 2) *
      Math.abs(Math.fround(omega.z)),
  );
  return {
    x,
    y,
    z,
    wild:
      x > Math.fround(26.4) || y > Math.fround(49.98) || z > Math.fround(3.52),
    mild: x > Math.fround(1.65) || z > Math.fround(0.22),
  };
}

const uint = (value: number) => Math.trunc(value) >>> 0;
const elapsed = (now: number, then: number) => (now - then) >>> 0;

/** Six native globals677c44..58. Call once per graphical outer frame, using
 * raw native body axes/inertia and special-volume gravity. Financial finish
 * guards and Drink Driving apply in EarnCredits, outside this consumer. */
export class NativeCunningStuntCounter {
  private state: CunningStuntState;
  private landingAwardPending = false;

  constructor(initial: Partial<CunningStuntState> = {}) {
    this.state = {
      lastAwardMs: uint(initial.lastAwardMs ?? 0),
      wildStartMs: uint(initial.wildStartMs ?? 0),
      mildStartMs: uint(initial.mildStartMs ?? 0),
      mildEndMs: uint(initial.mildEndMs ?? 0),
      wheelsStartMs: uint(initial.wheelsStartMs ?? 0),
      upsideDownMs: uint(initial.upsideDownMs ?? 0),
    };
  }
  get snapshot(): CunningStuntState {
    return { ...this.state };
  }
  /** CancelPendingCunningStunt41e5a0 preserves the last-award cooldown. */
  cancelPending(): void {
    this.clearMild();
    this.state.wildStartMs = 0;
    this.landingAwardPending = false;
  }
  private clearMild() {
    this.state.mildStartMs = 0;
    this.state.mildEndMs = 0;
    this.state.wheelsStartMs = 0;
    this.state.upsideDownMs = 0;
  }
  /** Landing's source41f096 samples PD time again after EarnCredits. Supply
   * that post-outlet timestamp after a landing result; wild retains its sample. */
  recordLandingAwardPdTime(pdTimeMs: number): void {
    if (!this.landingAwardPending)
      throw new Error("No landing stunt award awaits a PD timestamp");
    this.state.lastAwardMs = uint(pdTimeMs);
    this.landingAwardPending = false;
  }
  advance(input: CunningStuntInput): CunningStuntAward | undefined {
    const state = this.state;
    if (
      input.actionReplay ||
      input.driver !== 8 ||
      !(Math.fround(input.mass) < 5)
    )
      return undefined;
    this.landingAwardPending = false;
    const now = uint(input.pdTimeMs);
    const motion = nativeCunningStuntMotion(
      input.bodyInertia,
      input.bodyAngularVelocity,
    );
    const normalVolume =
      input.volumeGravity === undefined ||
      Math.fround(input.volumeGravity) === 1;
    if (motion.wild && elapsed(now, state.lastAwardMs) > 10000) {
      if (state.wildStartMs === 0 || !normalVolume) {
        state.wildStartMs = now;
        return undefined;
      }
      if (elapsed(now, state.wildStartMs) < 500) return undefined;
      state.lastAwardMs = now;
      this.clearMild();
      // Installed wild award deliberately retains wildStartMs.
      return {
        kind: "wild",
        credits: input.creditsBySkill[input.skill] | 0,
        fancyIndex: 18,
        seconds: 0,
      };
    }

    state.wildStartMs = 0;
    if (input.wheelsDown <= 3) {
      state.wheelsStartMs = 0;
      if (input.wheelsDown === 0 && motion.mild) {
        if (state.mildStartMs === 0) state.mildStartMs = now;
        if (Math.fround(input.upY) < Math.fround(-0.8))
          state.upsideDownMs = now;
      } else state.mildEndMs = now;
      return undefined;
    }

    if (state.mildEndMs === 0) state.mildEndMs = now;
    if (
      state.mildStartMs === 0 ||
      elapsed(now, state.lastAwardMs) <= 10000 ||
      elapsed(state.mildEndMs, state.mildStartMs) < 2000 ||
      state.upsideDownMs < state.mildStartMs ||
      state.upsideDownMs > state.mildEndMs
    ) {
      this.clearMild();
      return undefined;
    }
    if (state.wheelsStartMs === 0) {
      if (elapsed(now, state.mildEndMs) < 300) state.wheelsStartMs = now;
      else this.clearMild();
      return undefined;
    }
    if (elapsed(now, state.wheelsStartMs) <= 500 || !normalVolume)
      return undefined;
    // Provisional sample is replaced by recordLandingAwardPdTime after the
    // earned-credit outlet, preserving the second native clock read.
    state.lastAwardMs = now;
    this.clearMild();
    this.landingAwardPending = true;
    return {
      kind: "landing",
      credits: input.creditsBySkill[input.skill] | 0,
      fancyIndex: 18,
      seconds: 0,
    };
  }
}

export function parseCunningStuntBonus(text: string): SkillAward {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const marker = lines.findIndex((line) =>
    /cunning stunt bonus for each skill level/i.test(
      line.split("//").slice(1).join("//"),
    ),
  );
  if (marker < 0) throw new Error("GENERAL: missing cunning stunt bonus");
  for (let i = marker; i < lines.length; i++) {
    const data = lines[i].split("//")[0].trim();
    if (!data) continue;
    const values = data.split(/[\s,]+/).map(Number);
    if (
      values.length !== 3 ||
      values.some(
        (value) =>
          !Number.isInteger(value) || value < -2147483648 || value > 2147483647,
      )
    )
      throw new Error("GENERAL: invalid cunning stunt bonus");
    return values as SkillAward;
  }
  throw new Error("GENERAL: truncated cunning stunt bonus");
}
