import {
  chooseForcedRegularObjective,
  nativePercentageChance,
} from "./objective";

export type NativeCarIdentity = string | number;
export type NativeDecisionObjective =
  | "none"
  | "complete-race"
  | "pursue"
  | "run-away"
  | "get-near-player"
  | "levitate"
  | "freewheel"
  | "frozen";

export interface NativeDecisionState {
  objective: NativeDecisionObjective;
  target: NativeCarIdentity | null;
  objectiveStartMs: number;
  nextOutOfWorldCheckMs: number;
  grudge: number;
  knackeredDetected: boolean;
  pursuingBeforeFreeze: boolean;
  movedEver: boolean;
  pursueFromStart: boolean;
  acknowledgedSighting: boolean;
}

export interface NativeDecisionCar {
  identity: NativeCarIdentity;
  driver: number;
}

export interface NativeDecisionQuery {
  nowMs: number;
  factor: number;
  nastiness: number;
  strength: number;
  firstFrame: boolean;
  mustChoose: boolean;
  forcedType: number;
  player: NativeCarIdentity;
  playerDistance: number;
  knackered: boolean;
  stolen: boolean;
  scaryBang: boolean;
  bigBang: boolean;
  grudgeRaisedRecently: boolean;
  lastHitter: NativeDecisionCar | null;
  lastWeHit: NativeDecisionCar | null;
  inView: boolean;
  headOn: boolean;
  pursuingPopulation: number;
  skill: number;
  /** Called only after the strict native next-check deadline expires. */
  hasFallenOffWorld: () => boolean;
}

export interface NativeDecisionTransition {
  objective: NativeDecisionObjective;
  target: NativeCarIdentity | null;
  reason:
    | "fallen"
    | "knackered"
    | "thaw"
    | "freeze"
    | "scary-bang"
    | "hit-by-player"
    | "hit-player"
    | "grudge"
    | "sighting"
    | "forced";
  teleportToSafeLocation: boolean;
}

export interface NativeDecisionResult {
  state: NativeDecisionState;
  transition: NativeDecisionTransition | null;
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
export { nativeIntegerLow32 as nativeDecisionInteger } from "./integer";

/** Keep the exact F32 product and small offset until the signed64 truncation.
 * JS doubles would lose low integer bits that x87 retains below2^63. */
function scaledInteger(
  value: number,
  scale: number,
  offset: number,
  cap?: number,
): number {
  const bytes = new DataView(new ArrayBuffer(4));
  bytes.setFloat32(0, value);
  const bits = bytes.getUint32(0);
  const exponent = (bits >>> 23) & 255;
  const mantissa = BigInt((bits & 0x7fffff) | (exponent ? 0x800000 : 0));
  const power = exponent ? exponent - 150 : -149;
  let numerator = mantissa * BigInt(scale) * (bits >>> 31 ? -1n : 1n);
  const denominator = power < 0 ? 1n << BigInt(-power) : 1n;
  if (power >= 0) numerator <<= BigInt(power);
  numerator += BigInt(offset) * denominator;
  if (cap !== undefined && numerator > BigInt(cap) * denominator)
    numerator = BigInt(cap) * denominator;
  const truncated = numerator / denominator;
  if (truncated < -(1n << 63n) || truncated >= 1n << 63n) return 0;
  return Number(BigInt.asIntN(32, truncated));
}
function identity(value: NativeCarIdentity): boolean {
  return (
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

/** Independent port of installed regular ChooseNewObjective4acc10.
 * Selection mutates only selector-owned flags, checks and grudge. The caller
 * performs each returned NewObjective synchronously, including same-type
 * transitions, and owns its deadline RNG, die/start commands and populations. */
export class NativeRegularDecision {
  private state: NativeDecisionState;

  constructor(initial: NativeDecisionState) {
    this.validateState(initial);
    this.state = { ...initial };
  }

  snapshot(): NativeDecisionState {
    return { ...this.state };
  }

  /** Synchronize fields owned by NewObjective/follower/visibility callers. */
  synchronize(state: NativeDecisionState): void {
    this.validateState(state);
    this.state = { ...state };
  }

  run(q: NativeDecisionQuery, random = Math.random): NativeDecisionResult {
    this.validateQuery(q);
    const s = this.state;
    const done = (transition: NativeDecisionTransition | null = null) => ({
      state: this.snapshot(),
      transition,
    });
    const choose = (
      objective: NativeDecisionObjective,
      reason: NativeDecisionTransition["reason"],
      target: NativeCarIdentity | null = null,
    ) =>
      done({
        objective,
        reason,
        target,
        teleportToSafeLocation: reason === "fallen",
      });
    const pursuing = (target: NativeCarIdentity) =>
      s.objective === "pursue" && s.target === target;

    if (s.objective === "freewheel" || s.knackeredDetected) return done();
    if (q.nowMs > s.nextOutOfWorldCheckMs) {
      s.nextOutOfWorldCheckMs = (q.nowMs + 500) >>> 0;
      if (q.hasFallenOffWorld()) return choose("get-near-player", "fallen");
    }
    if (q.knackered) {
      s.knackeredDetected = true;
      return choose(q.stolen ? "levitate" : "freewheel", "knackered");
    }
    if (s.objective === "frozen") {
      if (Math.fround(q.factor) === 0) return done();
      return s.pursuingBeforeFreeze
        ? choose("pursue", "thaw", q.player)
        : choose("get-near-player", "thaw");
    }
    if (Math.fround(q.factor) === 0) {
      s.pursuingBeforeFreeze = pursuing(q.player);
      return choose("frozen", "freeze");
    }

    const nastiness = Math.fround(q.nastiness);
    const distance = Math.fround(q.playerDistance);
    const increase = scaledInteger(nastiness, 40, 10);
    const raiseGrudge = () => {
      s.grudge = Math.min(100, (Math.max(20, s.grudge) + increase) | 0) & 0xff;
    };
    if (!q.firstFrame) {
      if (
        q.scaryBang &&
        distance < 10 &&
        q.strength < 5 &&
        nativePercentageChance(
          scaledInteger(nastiness, -50, s.objective === "pursue" ? 100 : 60),
          random,
        )
      ) {
        return choose("run-away", "scary-bang");
      }
      if (
        s.objective !== "run-away" ||
        q.nowMs >= (s.objectiveStartMs + 20000) >>> 0
      ) {
        if (
          q.bigBang &&
          q.lastHitter?.driver === 8 &&
          !pursuing(q.lastHitter.identity)
        ) {
          raiseGrudge();
          return choose("pursue", "hit-by-player", q.lastHitter.identity);
        }
        if (q.lastWeHit?.driver === 8 && !pursuing(q.lastWeHit.identity)) {
          raiseGrudge();
          return choose("pursue", "hit-player", q.player);
        }
        if (!pursuing(q.player)) {
          if (
            q.grudgeRaisedRecently &&
            q.lastHitter?.driver === 8 &&
            s.grudge > 20
          ) {
            s.grudge = Math.min(100, (s.grudge + increase) | 0) & 0xff;
            return choose("pursue", "grudge", q.player);
          }
          if (q.inView && !s.acknowledgedSighting) {
            s.acknowledgedSighting = true;
            const chance =
              q.pursuingPopulation < ((q.skill + 3) | 0)
                ? scaledInteger(nastiness, 30, s.grudge - 20)
                : 0;
            if (
              nativePercentageChance((chance + (q.headOn ? 50 : 0)) | 0, random)
            ) {
              raiseGrudge();
              return choose("pursue", "sighting", q.player);
            }
          }
        }
      }
    }
    if (!q.mustChoose) return done();
    const objective = chooseForcedRegularObjective(
      s.movedEver,
      s.pursueFromStart,
      q.forcedType,
      distance,
      random,
    );
    if (!s.movedEver && s.pursueFromStart) {
      s.grudge =
        scaledInteger(nastiness, 40, Math.max(20, s.grudge) + 20, 100) & 0xff;
    }
    return choose(
      objective,
      "forced",
      objective === "pursue" ? q.player : null,
    );
  }

  private validateState(s: NativeDecisionState): void {
    if (
      !objectives.has(s.objective) ||
      !uint(s.objectiveStartMs) ||
      !uint(s.nextOutOfWorldCheckMs) ||
      !Number.isInteger(s.grudge) ||
      s.grudge < 0 ||
      s.grudge > 255 ||
      (s.target !== null && !identity(s.target)) ||
      ![
        s.knackeredDetected,
        s.pursuingBeforeFreeze,
        s.movedEver,
        s.pursueFromStart,
        s.acknowledgedSighting,
      ].every((v) => typeof v === "boolean")
    )
      throw new Error("Invalid native regular decision state");
  }
  private validateQuery(q: NativeDecisionQuery): void {
    if (
      !uint(q.nowMs) ||
      ![q.factor, q.nastiness, q.playerDistance].every((v) =>
        Number.isFinite(Math.fround(v)),
      ) ||
      q.playerDistance < 0 ||
      !identity(q.player) ||
      ![q.strength, q.forcedType, q.pursuingPopulation, q.skill].every(
        (v) => Number.isInteger(v) && v >= -2147483648 && v <= 2147483647,
      ) ||
      ![
        q.firstFrame,
        q.mustChoose,
        q.knackered,
        q.stolen,
        q.scaryBang,
        q.bigBang,
        q.grudgeRaisedRecently,
        q.inView,
        q.headOn,
      ].every((v) => typeof v === "boolean") ||
      typeof q.hasFallenOffWorld !== "function" ||
      ![q.lastHitter, q.lastWeHit].every(
        (v) =>
          v === null || (identity(v.identity) && Number.isInteger(v.driver)),
      )
    )
      throw new Error("Invalid native regular decision query");
  }
}
