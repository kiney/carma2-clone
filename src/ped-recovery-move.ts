/** Inactive retained-root SetCharacterMove40a050. This consumes an actual
 * halt owner's root; it never activates physics to use the active move API. */
import type {
  NativePedInstance,
  NativePedInstanceMove,
  NativePedInstanceResult,
} from "./ped-native-instance";
import { currentNativePedModel } from "./ped-native-instance";
import type { NativePedRuntimeCallback } from "./ped-native-runtime";
import type { NativePedGameplayOptions } from "./ped-native-gameplay";
import { buildPedRootMotion, pedRootMotionDirection } from "./ped-form";
import { buildNativePedBoneMotion, poseNativePedBones } from "./ped-bone-pose";
import {
  nativeActivePedOrientation,
  type NativePedMoveCallbackState,
} from "./physics/ped-active-move";
import { nativePedRootPose } from "./physics/ped-body";

export interface NativePedRecoveryMoveRequest {
  id: number;
  /** Native pSpeed: nonnegative absolute period, negative authored multiplier. */
  speed: number;
  completion: boolean;
  /** The caller's actual40c620/630 scope, not an inferred corpse/get-up state. */
  retainRoot: boolean;
}
export interface NativePedRecoveryMoveInput
  extends NativePedRecoveryMoveRequest {
  instance: NativePedInstance;
  /** Actual current native12 ACT, after halt posing and active-bit clearing. */
  rootPose: ArrayLike<number>;
  timeMs: number;
  callbackState?: NativePedMoveCallbackState;
  onMoveCompleted?: (instance: NativePedInstance, timeMs: number) => void;
  replayMode?: boolean;
  replayMutationsAllowed?: boolean;
}
export interface NativePedRecoveryMoveResult extends NativePedInstanceResult {
  nativeMoveReturn: 0 | 1 | 2 | null;
  replaySkipped: boolean;
  /** This core operation has no SetCharacterDirection call. */
  directionIgnored: true;
  poseMode: 3 | null;
  haltedFlagCleared: boolean;
}
const f = Math.fround;
const moves = new WeakMap<
  NativePedInstance["template"],
  Map<number, NativePedInstanceMove>
>();
function result(
  nativeMoveReturn: NativePedRecoveryMoveResult["nativeMoveReturn"],
  requiredProviders: string[] = [],
): NativePedRecoveryMoveResult {
  return {
    status: requiredProviders.length ? "provider-required" : "complete",
    requiredProviders,
    processedFrames: 0,
    completedMove: false,
    nativeMoveReturn,
    replaySkipped: false,
    directionIgnored: true,
    poseMode: null,
    haltedFlagCleared: false,
  };
}
function moveFor(
  instance: NativePedInstance,
  id: number,
): NativePedInstanceMove | null {
  const asset = instance.template.moves.get(id);
  if (!asset?.personality) return null;
  let cache = moves.get(instance.template);
  if (!cache) moves.set(instance.template, (cache = new Map()));
  let move = cache.get(id);
  if (!move) {
    const roots = buildPedRootMotion(
      asset.motion,
      instance.template.profile.rootName,
      asset.form.resetAxes,
      { missingRoot: "native-zero" },
    );
    move = {
      asset,
      roots,
      bones: buildNativePedBoneMotion(
        asset.motion,
        instance.template.bones.map((b) => b.name),
        { missingBones: "native-zero" },
      ),
      sourceDirection: pedRootMotionDirection(
        roots,
        asset.form.direction,
        asset.form.resetAxes,
      ).sourceDirection,
    };
    cache.set(id, move);
  }
  return move;
}
function render(instance: NativePedInstance): void {
  instance.rootWorldPosition.set(
    instance.rootPose[9],
    instance.rootPose[10],
    instance.rootPose[11],
  );
  for (const bone of instance.bones) {
    const bit = (2 ** bone.index) >>> 0;
    if (instance.detachedBoneMask & bit) continue;
    const p = bone.pose;
    bone.actor.matrix.set(
      p[0],
      p[3],
      p[6],
      p[9],
      p[1],
      p[4],
      p[7],
      p[10],
      p[2],
      p[5],
      p[8],
      p[11],
      0,
      0,
      0,
      1,
    );
    bone.actor.matrixAutoUpdate = false;
    bone.actor.matrixWorldNeedsUpdate = true;
    bone.actor.visible = !(instance.vanishedBoneMask & bit);
  }
  instance.group.updateMatrixWorld(true);
}
/** Ordinary primary selection only. Heading, movement basis, character V and
 * every PHIL field remain owned by the caller. No ground lookup occurs in3. */
export function setNativePedRecoveryMove(
  input: NativePedRecoveryMoveInput,
): NativePedRecoveryMoveResult {
  const { instance, id, callbackState } = input;
  if (!Number.isInteger(id) || id < -1 || id > 0x7fffffff)
    throw new Error("Invalid native recovery move ID");
  if (
    !Number.isInteger(input.timeMs) ||
    input.timeMs < 0 ||
    input.timeMs > 0xffffffff
  )
    throw new Error("Invalid native recovery move time");
  if (
    typeof input.completion !== "boolean" ||
    typeof input.retainRoot !== "boolean"
  )
    throw new Error("Invalid native recovery move flags");
  if (
    callbackState &&
    (!Number.isInteger(callbackState.flags) ||
      callbackState.flags < 0 ||
      callbackState.flags > 255 ||
      !Number.isInteger(callbackState.queuedMoveIndex) ||
      callbackState.queuedMoveIndex < -1 ||
      callbackState.queuedMoveIndex > 127)
  )
    throw new Error("Invalid native move callback byte/index");
  if (input.replayMode) {
    if (!input.replayMutationsAllowed)
      return { ...result(null), replaySkipped: true };
    return result(null, ["native-replay-move-recording-provider"]);
  }
  if (instance.physicsActive)
    return result(null, ["native-inactive-character-state"]);
  try {
    currentNativePedModel(instance, 0);
  } catch {
    return result(null, ["native-render-actor-set-owner"]);
  }
  const moveId = id < 0 ? id : id & ~0x40000000;
  let next: NativePedInstanceMove | null;
  try {
    next = id < 0 ? instance.move : moveFor(instance, moveId);
  } catch (error) {
    return result(2, [
      `native-move-${moveId}: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  if (!next)
    return result(id < 0 ? null : 2, [
      id < 0
        ? "native-selected-move-provider"
        : `native-move-${moveId}-and-personality-record-provider`,
    ]);
  const speed = f(input.speed);
  if (!Number.isFinite(speed))
    throw new Error("Invalid native recovery move speed");
  const converted = Math.trunc(
    speed >= 0 ? speed : -next.asset.form.periodMs * speed,
  );
  if (
    !Number.isFinite(converted) ||
    converted < -0x80000000 ||
    converted > 0x7fffffff
  )
    throw new Error("Native pedestrian period conversion outside signed32");
  const period = (converted << 16) >> 16;
  if (period < 0) return result(null, ["native-reverse-replay-provider"]);
  const changed =
    id >= 0 && (moveId !== instance.moveId || !!(id & 0x40000000));
  if (changed && !input.retainRoot)
    return result(null, ["native-non-retained-recovery-move-provider"]);
  if (changed && instance.morphActive)
    return result(null, ["native-ped-morph-ownership-provider"]);
  if (
    input.rootPose.length !== 12 ||
    Array.from(input.rootPose).some((n) => !Number.isFinite(f(n)))
  )
    throw new Error("Recovery move requires a finite native12 ACT root");
  const root = Float32Array.from(input.rootPose);
  const orientation = changed
    ? nativeActivePedOrientation(next.roots[0], root)
    : instance.characterOrientation;
  const posed = changed
    ? poseNativePedBones({
        bones: instance.poseBones,
        angles: next.bones.frames[0],
        rootPose: root,
        characterOrientation: orientation,
        currentPoses: instance.bones.map((b) => b.pose),
        removedBoneMask: instance.removedBoneMask,
        mode: 3,
        selectedMoveValid: true,
        renderAvailable: true,
        physicsActive: false,
        boned: instance.boned,
        temporaryMatricesAvailable: instance.temporaryMatricesAvailable,
        morphActive: false,
        mutantSpeed: instance.mutantSpeed,
      })
    : null;
  if (posed?.requiredProviders.length)
    return result(null, posed.requiredProviders);
  if (id >= 0) {
    instance.completionRequested = input.completion;
    if (callbackState) {
      callbackState.queuedMoveIndex = -1;
      callbackState.flags =
        (callbackState.flags & ~2) | (input.completion ? 2 : 0);
    }
  }
  instance.clock.periodMs = period;
  if (!changed) return result(1);
  instance.move = next;
  instance.moveId = moveId;
  instance.clock.frame = 0;
  instance.clock.fraction = 0;
  instance.clock.lastTimeMs = 0;
  instance.characterOrientation = orientation;
  instance.rootPose.set(root);
  if (input.onMoveCompleted) instance.onMoveCompleted = input.onMoveCompleted;
  //407b38 requires active AND boned to skip the clear. Inactive is not skipped.
  if (callbackState) callbackState.flags &= ~1;
  for (let i = 0; i < instance.bones.length; i++)
    instance.bones[i].pose.set(posed!.poses[i]);
  render(instance);
  return { ...result(0), poseMode: 3, haltedFlagCleared: true };
}

export interface NativePedRecoveryMoveHost<Owner extends object> {
  readCallbackState?: (
    context: NativePedRuntimeCallback<Owner>,
  ) => NativePedMoveCallbackState;
  onMoveCompleted?: (instance: NativePedInstance, timeMs: number) => void;
  readReplayState?: () => {
    replayMode: boolean;
    replayMutationsAllowed: boolean;
  };
}
/** Direct NativePedGameplay.setRecoveryMove adapter. Header2 may still be
 * present inside halt; the character bit, live root and ACT identity matter. */
export function createNativePedRecoveryMoveCallback<Owner extends object>(
  host: NativePedRecoveryMoveHost<Owner> = {},
): NonNullable<NativePedGameplayOptions<Owner>["setRecoveryMove"]> {
  return (context, request) => {
    if (context.body.actor !== context.instance.bones[0].actor)
      return result(null, ["native-recovery-physical-root-ACT-owner"]);
    return setNativePedRecoveryMove({
      instance: context.instance,
      rootPose: nativePedRootPose(context.body),
      timeMs: context.timeMs,
      ...request,
      callbackState: host.readCallbackState?.(context),
      onMoveCompleted: host.onMoveCompleted,
      ...host.readReplayState?.(),
    });
  };
}
