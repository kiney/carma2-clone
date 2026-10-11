import type { NativeDecisionObjective } from "./decision";

export interface NativeOpponentRepairSnapshot {
  nextCheckMs: number;
  repairIntervalMs: number;
  lastRepairMs: number;
}
export interface NativeOpponentRepairQuery {
  nowMs: number;
  cheating: boolean;
  police: boolean;
  objective: NativeDecisionObjective;
  knackered: boolean;
  lastContactMs: number;
}
function uint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

/** GENERAL labels call these seconds; installed InitOpponents multiplies each
 * integer by60000. Preserve that mismatch instead of changing authored units. */
export function readNativeOpponentRepairLimits(
  text: string,
): readonly [number, number] {
  const values = text
    .split(/\r?\n/)
    .filter((line) =>
      /time in secs after last contact.*opponent considers repairing/i.test(
        line,
      ),
    )
    .map((line) => Number(line.split("//", 1)[0].trim()));
  if (
    values.length !== 2 ||
    !values.every((value) => Number.isInteger(value) && value >= 0) ||
    values[1] < values[0]
  )
    throw new Error("Missing authored native opponent repair limits");
  return [values[0], values[1]];
}

/** Installed PossiblyRepairOpponent4ad6b0, called before selector4acc10.
 * A valid installed car always passes its unit-pointer necessity test.
 * The repair callback owns model, component and collision-shape restoration. */
export class NativeOpponentRepairState {
  private state: NativeOpponentRepairSnapshot;
  constructor(
    nowMs: number,
    private readonly minimumMinutes: number,
    private readonly maximumMinutes: number,
    private readonly random = Math.random,
  ) {
    if (
      !uint(nowMs) ||
      !Number.isInteger(minimumMinutes) ||
      !Number.isInteger(maximumMinutes) ||
      minimumMinutes < 0 ||
      maximumMinutes < minimumMinutes ||
      maximumMinutes > 0x7fffffff
    )
      throw new Error("Invalid native opponent repair initialization");
    this.state = {
      nextCheckMs: 0,
      repairIntervalMs: this.interval(),
      lastRepairMs: nowMs,
    };
  }
  get snapshot(): NativeOpponentRepairSnapshot {
    return { ...this.state };
  }

  run(query: NativeOpponentRepairQuery, repair: () => void): boolean {
    if (!uint(query.nowMs) || !uint(query.lastContactMs))
      throw new Error("Invalid native opponent repair timestamp");
    if (
      query.police ||
      query.nowMs <= this.state.nextCheckMs ||
      !query.cheating ||
      query.objective === "levitate" ||
      query.objective === "freewheel" ||
      query.knackered
    )
      return false;
    this.state.nextCheckMs = (query.nowMs + 3000 + this.between(0, 2000)) >>> 0;
    if (
      query.nowMs <=
      (query.lastContactMs + this.state.repairIntervalMs) >>> 0
    )
      return false;
    repair();
    this.state.repairIntervalMs = this.interval();
    this.state.lastRepairMs = query.nowMs;
    return true;
  }
  private interval(): number {
    return (
      Math.imul(
        60000,
        this.between(this.minimumMinutes, this.maximumMinutes),
      ) >>> 0
    );
  }
  private between(low: number, high: number): number {
    const sample = this.random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
      throw new Error("Native opponent repair sample must be in [0,1)");
    return (
      low + Math.floor((Math.floor(sample * 32768) * (high - low + 1)) / 32768)
    );
  }
}
