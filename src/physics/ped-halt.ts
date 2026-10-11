import type { PedBounds, PedVector } from "../ped-form";
import {
  settleNativePedBody,
  type NativePedSettlingResult,
} from "./ped-settling";

const f = Math.fround;
const reactionMoves = new Set([90, 91, 92, 97, 113]);
/** Installed persistent image scalar65c348, shared across pedestrians/races. */
export interface NativePedHaltSharedState {
  retryScalar: number;
}
export const sharedNativePedHaltState: NativePedHaltSharedState = {
  retryScalar: 8,
};
export interface NativePedHaltCache {
  retryCount: number;
  runSpeed?: number;
  runFactor?: number;
  headSequence?: { address: 0x65d050; startTimeMs: number; index: 0 };
}
export interface NativePedHaltState {
  hitPoints: number;
  flags: number;
  moveId: number;
  action: number;
  impactSerial: number;
  cache: NativePedHaltCache | null;
  doNothing: boolean;
  rigidFlags: number;
  rigidPose: Float32Array;
  localOmega: [number, number, number];
  filterA: number;
  filterB: number;
  runningTimeMs?: number;
}
export interface NativePedHaltInput {
  actorRootPose: ArrayLike<number>;
  /** Already derived using the inverse CURRENT animation root; never render yaw. */
  characterOrientation: ArrayLike<number>;
  worldFaceNormals: readonly PedVector[];
  optionalFaceNormal?: PedVector | null;
  mass: number;
  inertia: PedVector;
  bounds: PedBounds;
  lyingAxes: readonly [number, number];
  head: { boneIndex: number; modelState: number };
  collisionFlag: boolean;
  nowMs: number;
  immortal: boolean;
  /** Explicit source corpse branch providers; null means no special volume. */
  volumeGravity: number | null;
  goreLevel: number;
  mutantSpeed: number;
  unsupportedBranches?: readonly string[];
}
export interface NativePedHaltDecision {
  kind:
    | "retry"
    | "upright"
    | "lying"
    | "kill-required"
    | "dead"
    | "unsupported";
  upright: boolean;
  principalAxis: 0 | 1 | 2;
  negativeActorAxis: PedVector;
  supportNormal: PedVector | null;
  axisDotNormal: number | null;
  alignmentRetry: boolean;
  direction: PedVector | null;
  moveId: number | null;
  requiredProviders: string[];
}
export type NativePedHaltEffect =
  | { kind: "position"; position: PedVector }
  | { kind: "status-physical-level"; level: 5 }
  | {
      kind: "move";
      moveId: number;
      speed: number;
      arg4: 0;
      completion: boolean;
      timeMs: number;
      action: number;
    }
  | {
      kind: "head-sequence";
      address: 0x65d050;
      firstState: 1;
      headBone: number;
      modelState: number;
      timeMs: number;
    }
  | { kind: "action"; action: number }
  | { kind: "recache-ground"; force: true; timeMs: number }
  | { kind: "direction"; vector: PedVector; turn: 0; timeMs: number }
  | { kind: "kill"; reason: "exhausted-or-missing-alignment-cache" }
  | { kind: "freeze-move"; moveId: -1; speed: number; timeMs: number }
  | { kind: "rescan-proximity" }
  | {
      kind: "scan-objects";
      timeMs: number;
      pointerIdentityReseedRequired: true;
    }
  | { kind: "corpse-slick" }
  | {
      kind: "settling";
      worldVector: PedVector;
      gain: number;
      minimumSpeed: 0;
      result: NativePedSettlingResult;
    }
  | { kind: "sync-root-basis"; basis: Float32Array; rigidFlag: 0x100 }
  | { kind: "clear-volume" }
  | { kind: "release-selected-face-cache" };
export interface NativePedHaltProviders {
  shared: NativePedHaltSharedState;
  /** Actual shared MSVC CRT rand result0..32767, not an unrelated RNG. */
  nextCrtInteger: () => number;
  /** Source owners consume effects in order. Missing cache/model/scoring/pointer
   * providers remain listed in the result; an emitted effect is not their implementation. */
  onEffect?: (effect: NativePedHaltEffect) => void;
  /** Full KillPedestrian outlet, including score/gore/model ownership. */
  kill?: () => number;
}
export interface NativePedHaltResult {
  decision: NativePedHaltDecision;
  /** null denotes a required outlet; otherwise installed callback return0/1. */
  returnValue: 0 | 1 | null;
  effects: NativePedHaltEffect[];
  requiredProviders: string[];
  randomDraws: number;
}
function scalar(n: number): number {
  const value = f(n);
  if (!Number.isFinite(value))
    throw new Error("Non-finite native pedestrian halt scalar");
  return value;
}
function vector(v: PedVector): [number, number, number] {
  if (v.length !== 3) throw new Error("Invalid native pedestrian halt vector");
  return [scalar(v[0]), scalar(v[1]), scalar(v[2])];
}
function matrix(m: ArrayLike<number>): Float32Array {
  if (m.length !== 12)
    throw new Error("Pedestrian halt requires a native twelve-value basis");
  return Float32Array.from(m, scalar);
}
function integer(n: number, lo: number, hi: number, label: string): number {
  if (!Number.isInteger(n) || n < lo || n > hi)
    throw new Error(`Invalid native pedestrian ${label}`);
  return n;
}
function validate(state: NativePedHaltState, input: NativePedHaltInput): void {
  integer(state.hitPoints, -128, 127, "hit points");
  integer(state.flags, 0, 0xffff, "flags");
  integer(state.impactSerial, -32768, 32767, "impact serial");
  integer(state.moveId, -1, 32767, "move id");
  if (state.cache) integer(state.cache.retryCount, 0, 255, "halt retry count");
  integer(input.nowMs, 0, 0xffffffff, "time");
  integer(input.goreLevel, 0, 0x7fffffff, "gore level");
  integer(input.head.boneIndex, -128, 127, "head bone");
  integer(input.head.modelState, -128, 127, "head model state");
  input.lyingAxes.forEach((n) => integer(n, -3, 3, "lying axis"));
  const I = vector(input.inertia);
  if (!(scalar(input.mass) > 0) || I.some((n) => n <= 0))
    throw new Error("Invalid native pedestrian halt mass/moments");
  vector(input.bounds.min);
  vector(input.bounds.max);
  if (input.bounds.max.some((n, i) => scalar(n) <= scalar(input.bounds.min[i])))
    throw new Error("Degenerate native pedestrian halt bounds");
  vector(state.localOmega);
  scalar(input.mutantSpeed);
  if (input.volumeGravity !== null) scalar(input.volumeGravity);
  matrix(input.actorRootPose);
  matrix(input.characterOrientation);
  matrix(state.rigidPose);
}
function row(m: ArrayLike<number>, axis: number, sign = 1): PedVector {
  return [
    scalar(m[axis * 3] * sign),
    scalar(m[axis * 3 + 1] * sign),
    scalar(m[axis * 3 + 2] * sign),
  ];
}
/** Installed512f30: the integer percentage comparison consumes one CRT draw. */
export function nativePedPercentageChance(
  percent: number,
  nextCrtInteger: () => number,
): boolean {
  integer(percent, 0, 100, "percentage");
  if (percent === 0) return false;
  const value = integer(nextCrtInteger(), 0, 32767, "CRT rand result");
  return Math.floor((value * 100) / 32768) < percent;
}
/** Pure installed4d0efe..4d1052 selection. Source floats spill before the strict
 * .93/.706 double comparisons. Tied principal moments select Z. */
export function decideNativePedHalt(
  state: NativePedHaltState,
  input: NativePedHaltInput,
): NativePedHaltDecision {
  validate(state, input);
  const root = matrix(input.actorRootPose),
    orientation = matrix(input.characterOrientation),
    I = vector(input.inertia);
  const principalAxis: 0 | 1 | 2 =
    I[0] > I[1] && I[0] > I[2] ? 0 : I[1] > I[2] && I[1] > I[0] ? 1 : 2;
  const axis = row(root, principalAxis, -1);
  let normal: PedVector | null = input.optionalFaceNormal
    ? vector(input.optionalFaceNormal)
    : null;
  if (!normal)
    for (const face of input.worldFaceNormals) {
      const n = vector(face);
      if (n[1] > (normal?.[1] ?? 0)) normal = n;
    }
  const upright = state.hitPoints > 0 && orientation[4] > 0.93;
  const dot = normal
    ? scalar(axis[0] * normal[0] + axis[1] * normal[1] + axis[2] * normal[2])
    : null;
  const retry =
    !upright && normal !== null && normal[1] !== 0 && Math.abs(dot!) < 0.706;
  const required = [...(input.unsupportedBranches ?? [])];
  if (!upright && normal === null)
    required.push("positive-world-face-normal-unavailable");
  const common = {
    upright,
    principalAxis,
    negativeActorAxis: axis,
    supportNormal: normal,
    axisDotNormal: dot,
    alignmentRetry: retry,
    direction: null,
    moveId: null,
    requiredProviders: required,
  };
  if (required.length) return { ...common, kind: "unsupported" };
  if (
    retry &&
    state.cache &&
    state.cache.retryCount < (state.hitPoints > 0 ? 3 : 2)
  )
    return { ...common, kind: "retry" };
  if (state.hitPoints <= 0) return { ...common, kind: "dead" };
  if (retry && !input.immortal)
    return {
      ...common,
      kind: "kill-required",
      requiredProviders: ["KillPedestrian-model-score-gore"],
    };
  if (upright)
    return {
      ...common,
      kind: "upright",
      direction: row(orientation, 2),
      moveId: 41,
    };
  const signedAxis = input.lyingAxes[dot! > 0 ? 0 : 1];
  return {
    ...common,
    kind: "lying",
    direction: row(orientation, Math.abs(signedAxis), signedAxis < 0 ? -1 : 1),
    moveId: dot! > 0 ? 80 : 81,
  };
}
function emit(
  effects: NativePedHaltEffect[],
  providers: Pick<NativePedHaltProviders, "onEffect">,
  effect: NativePedHaltEffect,
): void {
  effects.push(effect);
  providers.onEffect?.(effect);
}
function move(
  state: NativePedHaltState,
  effects: NativePedHaltEffect[],
  providers: Pick<NativePedHaltProviders, "onEffect">,
  nowMs: number,
  id: number,
  action: number,
  completion = false,
  speed = -1,
): void {
  if (id !== -1) state.moveId = id;
  state.action = action;
  if ("completionEnabled" in state) state.completionEnabled = completion;
  emit(effects, providers, {
    kind: "move",
    moveId: id,
    speed,
    arg4: 0,
    completion,
    timeMs: nowMs,
    action,
  });
}
function replaceReaction(
  state: NativePedHaltState,
  input: NativePedHaltInput,
  effects: NativePedHaltEffect[],
  providers: Pick<NativePedHaltProviders, "onEffect">,
): void {
  if (!reactionMoves.has(state.moveId)) return;
  move(
    state,
    effects,
    providers,
    input.nowMs,
    state.hitPoints > 0 ? 93 : 94,
    5,
  );
  if (state.hitPoints > 0 && state.cache) {
    state.cache.headSequence = {
      address: 0x65d050,
      startTimeMs: input.nowMs,
      index: 0,
    };
    if (input.head.modelState >= 0)
      emit(effects, providers, {
        kind: "head-sequence",
        address: 0x65d050,
        firstState: 1,
        headBone: input.head.boneIndex,
        modelState: input.head.modelState,
        timeMs: input.nowMs,
      });
  }
}
function sync(
  state: NativePedHaltState,
  input: NativePedHaltInput,
  effects: NativePedHaltEffect[],
  providers: Pick<NativePedHaltProviders, "onEffect">,
): void {
  state.rigidPose.set(matrix(input.actorRootPose).subarray(0, 9));
  state.rigidFlags = (state.rigidFlags | 0x100) >>> 0;
  emit(effects, providers, {
    kind: "sync-root-basis",
    basis: state.rigidPose.slice(0, 9),
    rigidFlag: 0x100,
  });
}
/** Bounded source state mutation and ordered effects. It does not allocate
 * animation/cache state or perform a pointer-identity CRT reseed. Owners must
 * fulfill requiredProviders before interpreting emitted source effects as a
 * completed runtime lifecycle. Retry is min0; ordinary moved uses min.1. */
export function mutateNativePedHalt(
  state: NativePedHaltState,
  input: NativePedHaltInput,
  providers: NativePedHaltProviders,
): NativePedHaltResult {
  const decision = decideNativePedHalt(state, input),
    effects: NativePedHaltEffect[] = [],
    required = [...decision.requiredProviders];
  let draws = 0;
  const finish = (returnValue: 0 | 1 | null): NativePedHaltResult => {
    if (
      effects.some(
        (effect) => effect.kind === "move" || effect.kind === "freeze-move",
      )
    )
      required.push("source-animation-move-provider");
    return {
      decision,
      returnValue,
      effects,
      requiredProviders: [...new Set(required)],
      randomDraws: draws,
    };
  };
  if (decision.kind === "unsupported") return finish(null);
  emit(effects, providers, {
    kind: "position",
    position: row(matrix(input.actorRootPose), 3),
  });
  if (decision.kind === "retry") {
    replaceReaction(state, input, effects, providers);
    if (effects.some((e) => e.kind === "head-sequence"))
      required.push("head-sequence-model-provider");
    const flip = nativePedPercentageChance(50, providers.nextCrtInteger);
    draws++;
    const previous = scalar(providers.shared.retryScalar);
    providers.shared.retryScalar = flip ? scalar(-previous) : previous;
    state.action = 3;
    emit(effects, providers, { kind: "action", action: 3 });
    const worldVector = vector(
      decision.negativeActorAxis.map((n) =>
        scalar(n * providers.shared.retryScalar),
      ) as [number, number, number],
    );
    const settling = settleNativePedBody({
      worldVector,
      firstWorldFaceNormal: input.worldFaceNormals[0] ?? null,
      actorMatrix: input.actorRootPose,
      mass: input.mass,
      inertia: input.inertia,
      bounds: input.bounds,
      localOmega: state.localOmega,
      collisionFlag: input.collisionFlag,
      doNothing: state.doNothing,
      gain: f(1.39),
      minimumSpeed: 0,
    });
    state.localOmega = settling.localOmega;
    if (settling.gate === "face-unavailable")
      required.push("first-cached-physics-face-provider");
    emit(effects, providers, {
      kind: "settling",
      worldVector,
      gain: f(1.39),
      minimumSpeed: 0,
      result: settling,
    });
    state.cache!.retryCount = (state.cache!.retryCount + 1) & 255;
    state.doNothing = false;
    sync(state, input, effects, providers);
    return finish(0);
  }
  emit(effects, providers, { kind: "status-physical-level", level: 5 });
  state.impactSerial = ((state.impactSerial + 1 + 32768) & 0xffff) - 32768;
  replaceReaction(state, input, effects, providers);
  if (effects.some((e) => e.kind === "head-sequence"))
    required.push("head-sequence-model-provider");
  if (state.cache) state.cache.retryCount = 0;
  if (state.hitPoints > 0) {
    emit(effects, providers, {
      kind: "recache-ground",
      force: true,
      timeMs: input.nowMs,
    });
    required.push("source-ground-face-cache-provider");
    if (decision.kind === "kill-required") {
      state.action = 5;
      emit(effects, providers, { kind: "action", action: 5 });
      emit(effects, providers, {
        kind: "kill",
        reason: "exhausted-or-missing-alignment-cache",
      });
      if (!providers.kill) return finish(null);
      state.hitPoints = integer(providers.kill(), -128, 127, "kill result HP");
      if (state.hitPoints > 0) return finish(null);
      required.splice(required.indexOf("KillPedestrian-model-score-gore"), 1);
      move(state, effects, providers, input.nowMs, 94, 5);
    } else {
      state.flags &= ~8;
      emit(effects, providers, {
        kind: "direction",
        vector: decision.direction!,
        turn: 0,
        timeMs: input.nowMs,
      });
      required.push("source-SetPedXZDirection-provider");
      if (decision.kind === "upright") {
        state.action = 0;
        if (state.cache) {
          state.cache.runSpeed = 100;
          state.cache.runFactor = f(0.09);
        }
        move(
          state,
          effects,
          providers,
          input.nowMs,
          41,
          1,
          false,
          state.cache ? 100 : -1,
        );
        state.runningTimeMs = input.nowMs;
      } else
        move(state, effects, providers, input.nowMs, decision.moveId!, 4, true);
      emit(effects, providers, { kind: "rescan-proximity" });
      emit(effects, providers, {
        kind: "scan-objects",
        timeMs: input.nowMs,
        pointerIdentityReseedRequired: true,
      });
      required.push("source-proximity-object-scan-and-pointer-CRT-provider");
    }
  }
  if (state.hitPoints <= 0) {
    const speed =
      scalar(input.mutantSpeed) === 0 ? 0 : scalar(-input.mutantSpeed);
    emit(effects, providers, {
      kind: "freeze-move",
      moveId: -1,
      speed,
      timeMs: input.nowMs,
    });
    //4d150d kill tail skips corpse-slick. Ordinary4d185e tail draws75 before
    //bit0x10/gore tests even when no slick is ultimately emitted.
    if (
      decision.kind !== "kill-required" &&
      (input.volumeGravity === null || scalar(input.volumeGravity) >= 1)
    ) {
      const slick = nativePedPercentageChance(75, providers.nextCrtInteger);
      draws++;
      if (slick && !(state.flags & 0x10) && input.goreLevel > 0) {
        state.flags |= 0x10;
        emit(effects, providers, { kind: "corpse-slick" });
        required.push("source-corpse-slick-provider");
      }
    }
  }
  sync(state, input, effects, providers);
  state.filterA = 0x10000;
  state.filterB = 0x50000;
  emit(effects, providers, { kind: "clear-volume" });
  required.push("source-volume-state-clear-provider");
  return finish(1);
}

export interface NativePedCompletionState extends NativePedHaltState {
  frame: number;
  completionEnabled: boolean;
}
export interface NativePedCompletionInput {
  frameCount: number;
  positiveAdvance: number;
  replay: boolean;
  nowMs: number;
  blind: boolean;
  valiumTimeMs: number;
  head: NativePedHaltInput["head"];
}
/**409e2c dispatch gate, then ordinary4cbf52 completion. Frame count is an
 * actual animation provider; the kernel does not synthesize60/50-frame timers. */
export function completeNativePedMove(
  state: NativePedCompletionState,
  input: NativePedCompletionInput,
  onEffect?: (effect: NativePedHaltEffect) => void,
): {
  dispatched: boolean;
  effects: NativePedHaltEffect[];
  requiredProviders: string[];
} {
  integer(input.frameCount, 1, 32767, "animation frame count");
  integer(state.frame, 0, 32767, "animation frame");
  integer(input.nowMs, 0, 0xffffffff, "completion time");
  integer(input.positiveAdvance, -32768, 32767, "completion advance");
  integer(input.valiumTimeMs, 0, 0x7fffffff, "valium time");
  const effects: NativePedHaltEffect[] = [],
    required: string[] = [],
    providers = { onEffect };
  if (
    input.replay ||
    input.positiveAdvance <= 0 ||
    !state.completionEnabled ||
    state.frame < input.frameCount
  )
    return { dispatched: false, effects, requiredProviders: required };
  state.frame = input.frameCount - 1;
  state.completionEnabled = false;
  if (state.moveId >= 80 && state.moveId <= 85) {
    if (!input.blind && input.valiumTimeMs === 0) {
      state.action = 0;
      if (state.cache) {
        state.cache.runSpeed = 100;
        state.cache.runFactor = f(0.09);
      }
      move(
        state,
        effects,
        providers,
        input.nowMs,
        41,
        1,
        false,
        state.cache ? 100 : -1,
      );
      state.runningTimeMs = input.nowMs;
    } else move(state, effects, providers, input.nowMs, 30, 0);
  } else if ([90, 91, 92].includes(state.moveId))
    move(state, effects, providers, input.nowMs, 97, 5, true);
  else if (state.moveId === 96 || state.moveId === 97) {
    move(
      state,
      effects,
      providers,
      input.nowMs,
      state.hitPoints > 0 ? 93 : 94,
      5,
    );
    if (state.hitPoints > 0 && state.cache) {
      state.cache.headSequence = {
        address: 0x65d050,
        startTimeMs: input.nowMs,
        index: 0,
      };
      if (input.head.modelState >= 0) {
        emit(effects, providers, {
          kind: "head-sequence",
          address: 0x65d050,
          firstState: 1,
          headBone: input.head.boneIndex,
          modelState: input.head.modelState,
          timeMs: input.nowMs,
        });
        required.push("head-sequence-model-provider");
      }
    }
  } else if (state.moveId === 113)
    required.push("source-move113-forced-reaction-provider");
  else if (state.moveId < 90)
    required.push("nonordinary-completion-dispatch-provider");
  emit(effects, providers, { kind: "release-selected-face-cache" });
  required.push("source-selected-face-cache-release-provider");
  if (effects.some((effect) => effect.kind === "move"))
    required.push("source-animation-move-provider");
  return { dispatched: true, effects, requiredProviders: required };
}
