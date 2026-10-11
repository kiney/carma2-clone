export type SkillAward = [number, number, number];
export interface RaceAwards {
  checkpointCredits: SkillAward;
  timeBonusCredits: SkillAward;
  wastingTime: SkillAward;
  wastingCredits: SkillAward;
  rollingTime: SkillAward;
  rollingCredits: SkillAward;
}
export interface CrashDamageAwards {
  creditsPerDamage: SkillAward;
  secondsPerDamage: SkillAward;
}

/** Installed LoadGeneral loads Float32 skill tables at758e50/75f3f0. */
export function parseCrashDamageAwards(text: string): CrashDamageAwards {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const read = (label: RegExp): SkillAward => {
    const marker = lines.findIndex((line) =>
      label.test(line.split("//").slice(1).join("//")),
    );
    if (marker < 0)
      throw new Error(`GENERAL.TXT: missing damage award ${label.source}`);
    for (let i = marker; i < lines.length; i++) {
      const value = lines[i].split("//")[0].trim();
      if (!value) continue;
      const parts = value.split(/[\s,]+/).map(Number);
      if (
        parts.length !== 3 ||
        parts.some(
          (n) =>
            !Number.isFinite(n) || n < 0 || !Number.isFinite(Math.fround(n)),
        )
      )
        throw new Error(`GENERAL.TXT: invalid damage award at line ${i + 1}`);
      return parts.map(Math.fround) as SkillAward;
    }
    throw new Error("GENERAL.TXT: truncated damage awards");
  };
  return {
    creditsPerDamage: read(/Credits per unit car damage for each skill level/i),
    secondsPerDamage: read(/Seconds per unit car damage for each skill level/i),
  };
}

/** Independent labelled GENERAL reader; installed LoadGeneral reads these
 * three-skill records in order. Inline and preceding comments are supported. */
export function parseRaceAwards(text: string): RaceAwards {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const read = (label: RegExp): SkillAward => {
    const marker = lines.findIndex((line) =>
      label.test(line.split("//").slice(1).join("//")),
    );
    if (marker < 0)
      throw new Error(`GENERAL.TXT: missing race award ${label.source}`);
    for (let i = marker; i < lines.length; i++) {
      const value = lines[i].split("//")[0].trim();
      if (!value) continue;
      const parts = value.split(/[\s,]+/).map(Number);
      if (
        parts.length !== 3 ||
        parts.some((n) => !Number.isSafeInteger(n) || n < 0)
      )
        throw new Error(`GENERAL.TXT: invalid race award at line ${i + 1}`);
      return parts as SkillAward;
    }
    throw new Error("GENERAL.TXT: truncated race awards");
  };
  return {
    checkpointCredits: read(
      /Credits awarded for checkpoints for each skill level/i,
    ),
    timeBonusCredits: read(/Credits per second of time bonus/i),
    wastingTime: read(/Time awarded for wasting car for each skill level/i),
    wastingCredits: read(
      /Credits awarded for wasting car for each skill level/i,
    ),
    rollingTime: read(/Time awarded for rolling car for each skill level/i),
    rollingCredits: read(
      /Credits awarded for rolling car for each skill level/i,
    ),
  };
}

export interface PedAwards {
  points: SkillAward;
  time: SkillAward;
}
export function parsePedAwards(text: string): PedAwards {
  const read = (label: string): SkillAward => {
    const line = text
      .split(/\r?\n/)
      .find((line) => line.toLowerCase().includes(label));
    const values = line
      ?.split("//")[0]
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      !values ||
      values.length !== 3 ||
      values.some((n) => !Number.isSafeInteger(n) || n < 0)
    )
      throw new Error(`PEDS/settings: invalid or missing ${label}`);
    return values as SkillAward;
  };
  return {
    points: read("points score per ped"),
    time: read("time score per ped"),
  };
}

/** Installed ScoreForKilledPedestrian0x4cd078: inclusive1000ms, cap10.
 * Special collision classifications need PED-03's native cause/cache inputs;
 * ordinary swept contacts currently use multiplier1 explicitly. */
export class PedAwardCounter {
  private previousMs: number | undefined;
  private combo = 0;
  score(nowMs: number, awards: PedAwards, skill: 0 | 1 | 2, multiplier = 1) {
    const now = Math.trunc(nowMs) >>> 0;
    this.combo =
      this.previousMs !== undefined && (now - this.previousMs) >>> 0 <= 1000
        ? Math.min(10, this.combo + 1)
        : 1;
    this.previousMs = now;
    return {
      credits: awards.points[skill] * this.combo * multiplier,
      seconds: awards.time[skill],
      combo: this.combo,
    };
  }
}

/** Installed DoCrashEarnings0x440e85: nearest100, squared softness ratio. */
export function wastedCarCredits(base: number, softness: number): number {
  if (
    !Number.isFinite(base) ||
    base < 0 ||
    !Number.isFinite(softness) ||
    softness <= 0
  )
    throw new Error("Invalid wasted car award inputs");
  return 100 * Math.trunc((base * (0.7 / softness) ** 2 + 50) * 0.01);
}
