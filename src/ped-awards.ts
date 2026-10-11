import type { PedAwards } from "./race-awards";

export interface PedAwardVector {
  x: number;
  y: number;
  z: number;
}

/** Raw ScoreForKilledPedestrian4cd010 inputs. Omitted motion fields are
 * unknown providers, not invented zero velocities or a collision cause. */
export interface NativePedAwardContext {
  cachePresent: boolean;
  killerDriver?: number;
  /** Native WORD at pedestrian cache+2e, independent of cache+c4 flags. */
  cacheFlags: number;
  height?: number;
  /** Cache+98 is tested as signed positive, not compared with the clock. */
  napalmDeadlineMs?: number;
  killerAngularVelocity?: PedAwardVector;
  killerUpY?: number;
  killerActorOriginY?: number;
  pedestrianY?: number;
  pedVelocity?: PedAwardVector;
  pedStartingVelocity?: PedAwardVector;
  /** Native inverse physics-pose rotation of pedestrian.pos - car.pos(COM). */
  localPedPosition?: PedAwardVector;
  /** Physics object+1a8, not world velocity. */
  killerLocalVelocity?: PedAwardVector;
}

export interface NativePedAwardClassification {
  classification: string;
  multiplier: number;
  fancyIndex?: number;
  /** Installed PratcamEvent4e0c50 is an empty RET; this is metadata only. */
  pratcamEvent?: 30;
  missingInputs: string[];
}

/** Installed ordered alternatives4cd104..3c2; classifications never stack. */
export function classifyNativePedAward(
  context: NativePedAwardContext,
  combo: number,
): NativePedAwardClassification {
  const missingInputs: string[] = [];
  const result = (
    classification: string,
    multiplier: number,
    fancyIndex?: number,
    pratcamEvent?: 30,
  ): NativePedAwardClassification => ({
    classification,
    multiplier,
    fancyIndex,
    pratcamEvent,
    missingInputs,
  });
  const flags = context.cacheFlags & 0xffff;
  for (const [flag, multiplier, fancyIndex, name] of [
    [0x10, 20, 32, "mutant-tail"],
    [0x08, 5, 31, "tail"],
    [0x40, 2, 2, "mine"],
    [0x01, 4, 17, "drone-or-indirect"],
    [0x20, 2, 30, "napalm"],
  ] as const)
    if (flags & flag) return result(name, multiplier, fancyIndex, 30);

  const omega = context.killerAngularVelocity;
  const height = context.height;
  if (height === undefined) missingInputs.push("height");
  if (
    (context.napalmDeadlineMs !== undefined &&
      (context.napalmDeadlineMs | 0) > 0) ||
    (height === 0 &&
      ((omega !== undefined &&
        (Math.abs(omega.x) > 5 || Math.abs(omega.z) > 5)) ||
        (context.killerUpY !== undefined &&
          context.killerUpY < Math.fround(0.1)) ||
        (context.killerActorOriginY !== undefined &&
          context.pedestrianY !== undefined &&
          context.killerActorOriginY - context.pedestrianY >
            Math.fround(0.05))))
  )
    return result("rolling-or-burning-cache", 4, 3, 30);
  if (height === 0) {
    if (omega === undefined) missingInputs.push("killerAngularVelocity");
    if (context.killerUpY === undefined) missingInputs.push("killerUpY");
    if (context.killerActorOriginY === undefined)
      missingInputs.push("killerActorOriginY");
    if (context.pedestrianY === undefined) missingInputs.push("pedestrianY");
  }
  if (context.napalmDeadlineMs === undefined)
    missingInputs.push("napalmDeadlineMs");
  if (height !== undefined && height > 1)
    return result("falling-height", 2, 6, 30);

  const lengthSquared = (v: PedAwardVector) =>
    v.x * v.x + v.y * v.y + v.z * v.z;
  if (
    (context.pedVelocity !== undefined &&
      lengthSquared(context.pedVelocity) >= 2) ||
    (context.pedStartingVelocity !== undefined &&
      lengthSquared(context.pedStartingVelocity) >= 2)
  )
    return result("moving-pedestrian", 4, 5, 30);
  if (context.pedVelocity === undefined) missingInputs.push("pedVelocity");
  if (context.pedStartingVelocity === undefined)
    missingInputs.push("pedStartingVelocity");

  if (height === 0) {
    const hit = context.localPedPosition;
    const velocity = context.killerLocalVelocity;
    if (hit === undefined) missingInputs.push("localPedPosition");
    if (velocity === undefined) missingInputs.push("killerLocalVelocity");
    if (
      hit !== undefined &&
      velocity !== undefined &&
      ((Math.abs(hit.x) / Math.abs(hit.z) >= 0.5 &&
        (Math.abs(velocity.z) < Math.abs(velocity.x) ||
          (omega !== undefined && Math.abs(omega.y / velocity.z) > 600))) ||
        (hit.z > 0 && velocity.z > 0))
    )
      return result("sideways-or-reverse", 2, 2);
  }
  if (combo > 1) return result("combo", 1, combo + 6, 30);
  if (flags & 0x02) return result("dismemberment-flag", 2, 0, 30);
  return result("ordinary", 1);
}

export interface NativePedAwardResult extends NativePedAwardClassification {
  credits: number;
  seconds: number;
  combo: number;
}

/** Cache+local-human ownership gates precede combo updates. Time is fixed;
 * all three native integer credit products wrap signed32. */
export class NativePedAwardCounter {
  private previousMs = 0;
  private combo = 0;

  score(
    nowMs: number,
    awards: PedAwards,
    skill: 0 | 1 | 2,
    context: NativePedAwardContext,
  ): NativePedAwardResult | undefined {
    if (!context.cachePresent || context.killerDriver !== 8) return undefined;
    const now = Math.trunc(nowMs) >>> 0;
    this.combo =
      (now - this.previousMs) >>> 0 <= 1000 ? Math.min(10, this.combo + 1) : 1;
    this.previousMs = now;
    const classification = classifyNativePedAward(context, this.combo);
    return {
      ...classification,
      credits: Math.imul(
        Math.imul(awards.points[skill], this.combo),
        classification.multiplier,
      ),
      seconds: awards.time[skill] | 0,
      combo: this.combo,
    };
  }
}

/** Installed EarnCredits2 44b960. No credit clamp or nonnegative guard exists;
 * HUD aggregation changes its displayed amount, not this committed delta. */
export function consumeNativeEarnCredits(context: {
  amount: number;
  creditMultiplier: number;
  currentCredits: number;
  raceFinished: boolean;
}): { accepted: boolean; amount: number; credits: number } {
  const amount = context.amount | 0;
  const current = context.currentCredits | 0;
  if (context.raceFinished || amount === 0)
    return { accepted: false, amount: 0, credits: current };
  const multiplier = context.creditMultiplier | 0;
  const earned = multiplier === 0 ? amount : Math.imul(amount, multiplier);
  return { accepted: true, amount: earned, credits: (current + earned) | 0 };
}
