import type { NativeCarIdentity, NativeDecisionObjective } from "./decision";
import { nativeObjectiveDeadline } from "./objective";

export interface NativeObjectiveCounts {
  completeRace: number;
  pursuing: number;
  getNear: number;
}

export interface NativeObjectiveRival {
  objective: NativeDecisionObjective;
  finishedForRace: boolean;
}

export interface NativeObjectiveLifecycleSnapshot {
  objective: NativeDecisionObjective;
  target: NativeCarIdentity | null;
  startMs: number;
  deadlineMs: number;
  newRequired: boolean;
  finishedForRace: boolean;
  stunUntilMs: number;
}

export interface NativeObjectiveLifecycleHooks {
  die(objective: NativeDecisionObjective): void;
  start(objective: NativeDecisionObjective): void;
}

export interface NativeObjectiveProcessQuery {
  nowMs: number;
  mass: number;
  countdown: number;
  raceFinished: boolean;
  stopOpponentsMoving: boolean;
}

export interface NativeObjectiveProcessHooks {
  changeCheatingMode(): void;
  repair(): void;
  chooseObjective(force: boolean): void;
  setBrakeForce(force: number): void;
  run(objective: NativeDecisionObjective): void;
  isCheating(): boolean;
  copyActorOriginToCarPosition(): void;
}

const objectives = new Set<NativeDecisionObjective>([
  "none",
  "complete-race",
  "pursue",
  "run-away",
  "get-near-player",
  "levitate",
  "freewheel",
  "frozen",
]);

function uint(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function validObjective(value: NativeDecisionObjective): boolean {
  return objectives.has(value);
}

function category(
  objective: NativeDecisionObjective,
): keyof NativeObjectiveCounts | null {
  if (objective === "complete-race") return "completeRace";
  if (objective === "pursue") return "pursuing";
  if (objective === "get-near-player") return "getNear";
  return null;
}

function wrapCount(value: number): number {
  return value | 0;
}

function validateCounts(counts: NativeObjectiveCounts): void {
  for (const value of [counts.completeRace, counts.pursuing, counts.getNear]) {
    if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff)
      throw new Error("Invalid native objective count");
  }
}

/** ProcessOpponent objective state and the installed 0x4aa310 lifecycle order. */
export class NativeObjectiveLifecycle {
  private state: NativeObjectiveLifecycleSnapshot;

  constructor(
    initial: Partial<NativeObjectiveLifecycleSnapshot> = {},
    private readonly counts?: NativeObjectiveCounts,
    private readonly random = Math.random,
  ) {
    this.state = {
      objective: initial.objective ?? "none",
      target: initial.target ?? null,
      startMs: initial.startMs ?? 0,
      deadlineMs: initial.deadlineMs ?? 0,
      newRequired: initial.newRequired ?? false,
      finishedForRace: initial.finishedForRace ?? false,
      stunUntilMs: initial.stunUntilMs ?? 0,
    };
    this.validateState(this.state);
    if (counts) validateCounts(counts);
  }

  snapshot(): NativeObjectiveLifecycleSnapshot {
    return { ...this.state };
  }

  synchronize(state: NativeObjectiveLifecycleSnapshot): void {
    this.validateState(state);
    this.state = { ...state };
  }

  /** Installed MungeOpponents per-frame recount; finished rivals are excluded. */
  static recount(
    counts: NativeObjectiveCounts,
    rivals: readonly NativeObjectiveRival[],
  ): NativeObjectiveCounts {
    counts.completeRace = 0;
    counts.pursuing = 0;
    counts.getNear = 0;
    for (const rival of rivals) {
      if (rival.finishedForRace) continue;
      const key = category(rival.objective);
      if (key) counts[key] = wrapCount(counts[key] + 1);
    }
    return counts;
  }

  newObjective(
    nowMs: number,
    objective: NativeDecisionObjective,
    target: NativeCarIdentity | null,
    hooks: NativeObjectiveLifecycleHooks,
  ): void {
    if (!uint(nowMs) || !validObjective(objective))
      throw new Error("Invalid native objective transition");
    if (objective === "pursue" && target === null)
      throw new Error("Native pursue objective requires a target");
    const old = this.state.objective;
    if (old !== "none") hooks.die(old);
    this.state.objective = objective;
    this.state.startMs = nowMs;
    this.state.deadlineMs = nativeObjectiveDeadline(
      nowMs,
      objective === "pursue",
      this.random,
    );
    // Installed target store4aab82 follows the deadline draw/store4aab42–66.
    if (objective === "pursue") this.state.target = target;
    const key = category(objective);
    if (key && this.counts) this.counts[key] = wrapCount(this.counts[key] + 1);
    hooks.start(objective);
  }

  objectiveComplete(): void {
    this.state.newRequired = true;
    const key = category(this.state.objective);
    if (key && this.counts) this.counts[key] = wrapCount(this.counts[key] - 1);
  }

  process(
    query: NativeObjectiveProcessQuery,
    hooks: NativeObjectiveProcessHooks,
  ): void {
    if (
      !uint(query.nowMs) ||
      !Number.isFinite(query.mass) ||
      !Number.isFinite(Math.fround(query.mass)) ||
      Math.fround(query.mass) <= 0 ||
      !Number.isInteger(query.countdown) ||
      query.countdown < -0x80000000 ||
      query.countdown > 0x7fffffff ||
      typeof query.raceFinished !== "boolean" ||
      typeof query.stopOpponentsMoving !== "boolean"
    )
      throw new Error("Invalid native opponent objective process input");

    hooks.changeCheatingMode();
    hooks.repair();
    const force = this.state.newRequired || query.nowMs > this.state.deadlineMs;
    hooks.chooseObjective(force);
    this.state.newRequired = false;
    if (query.countdown !== 0 || query.raceFinished)
      hooks.setBrakeForce(Math.fround(10 * Math.fround(query.mass)));
    if (
      !this.state.finishedForRace &&
      !query.stopOpponentsMoving &&
      !query.raceFinished &&
      query.nowMs > this.state.stunUntilMs
    )
      hooks.run(this.state.objective);
    if (hooks.isCheating()) hooks.copyActorOriginToCarPosition();
  }

  private validateState(state: NativeObjectiveLifecycleSnapshot): void {
    if (
      !validObjective(state.objective) ||
      !uint(state.startMs) ||
      !uint(state.deadlineMs) ||
      !uint(state.stunUntilMs) ||
      typeof state.newRequired !== "boolean" ||
      typeof state.finishedForRace !== "boolean"
    )
      throw new Error("Invalid native objective lifecycle state");
  }
}
