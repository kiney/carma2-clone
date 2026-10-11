/** Independent installed SetCharacterMoveAR4d1a20 / SetCharacterMove40a050
 * active-body transition. See docs/c2-ped-active-move-re.md. */
import type {
  NativePedInstance,
  NativePedInstanceMove,
  NativePedInstanceResult,
  NativePedMoveSelectionOptions,
} from "../ped-native-instance";
import { currentNativePedModel } from "../ped-native-instance";
import type {
  NativePedRuntimeHooks,
  NativePedRuntimeCallback,
} from "../ped-native-runtime";
import {
  buildPedRootMotion,
  composePedRootPose,
  pedRootMotionDirection,
} from "../ped-form";
import { buildNativePedBoneMotion, poseNativePedBones } from "../ped-bone-pose";
import { nativePedRootPose } from "./ped-body";

export interface NativePedMoveCallbackState {
  /** Character+9 callback byte. Bit0 is the transient halted marker, bit1
   * completion, bit2 queued completion. Never substitute PHIL header flags. */
  flags: number;
  /** Character+8: queued FORM index, -1 after an ordinary selection/reset. */
  queuedMoveIndex: number;
}
export interface NativeActivePedMoveInput {
  instance: NativePedInstance;
  /** Current actual ACT root, not character+8c or its last impact snapshot. */
  rootPose: ArrayLike<number>;
  id: number;
  timeMs: number;
  options?: NativePedMoveSelectionOptions;
  /** Source pSpeed: nonnegative absolute period, negative authored multiplier.
   * Absent uses options.periodMs, otherwise source -1 (authored period). */
  speed?: number;
  callbackState?: NativePedMoveCallbackState;
  replayMode?: boolean;
  replayMutationsAllowed?: boolean;
  /** Ordinary (non-retain) newly grounded moves call FindYVerticallyBelow2
   * even while active. The exact ACT/physics owner must commit that write. */
  writeGroundedRoot?: (root: Float32Array) => void;
}
export interface NativeActivePedMoveResult extends NativePedInstanceResult {
  nativeMoveReturn: 0 | 1 | 2 | null;
  replaySkipped: boolean;
  /** SetCharacterDirection40a730 ignores active direction outside replay. */
  directionIgnored: true;
  poseMode: 0 | 3 | null;
  haltedFlagCleared: boolean;
}
const f = Math.fround;
const cache = new WeakMap<
  NativePedInstance["template"],
  Map<number, NativePedInstanceMove>
>();
function result(
  nativeMoveReturn: NativeActivePedMoveResult["nativeMoveReturn"],
  requiredProviders: string[] = [],
): NativeActivePedMoveResult {
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
function matrix(input: ArrayLike<number>): Float32Array {
  if (
    input.length !== 12 ||
    Array.from(input).some((n) => !Number.isFinite(n) || !Number.isFinite(f(n)))
  )
    throw new Error(
      "Active pedestrian move requires a finite native12 ACT root",
    );
  return Float32Array.from(input);
}
function moveFor(
  instance: NativePedInstance,
  id: number,
): NativePedInstanceMove | null {
  const asset = instance.template.moves.get(id);
  if (!asset?.personality) return null;
  let moves = cache.get(instance.template);
  if (!moves) cache.set(instance.template, (moves = new Map()));
  let move = moves.get(id);
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
        instance.template.form.bones.map((b) => b.name),
        { missingBones: "native-zero" },
      ),
      sourceDirection: pedRootMotionDirection(
        roots,
        asset.form.direction,
        asset.form.resetAxes,
      ).sourceDirection,
    };
    moves.set(id, move);
  }
  return move;
}
/** LPInverse is a basis transpose, followed by the complete row-basis product.
 * Translation is explicitly zeroed after multiplication at40a6aa..b6. */
export function nativeActivePedOrientation(
  frame: ArrayLike<number>,
  root: ArrayLike<number>,
): Float32Array {
  const a = matrix(frame),
    b = matrix(root),
    inverse = new Float32Array(12);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) inverse[i * 3 + j] = a[j * 3 + i];
  return composePedRootPose(inverse, b, [0, 0, 0]);
}
function render(instance: NativePedInstance) {
  instance.rootWorldPosition.fromArray(instance.rootPose, 9);
  for (const bone of instance.bones) {
    if (instance.detachedBoneMask & ((2 ** bone.index) >>> 0)) continue;
    const p = bone.pose;
    bone.actor.visible = !(
      instance.vanishedBoneMask &
      ((2 ** bone.index) >>> 0)
    );
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
  }
  instance.group.updateMatrixWorld(true);
}
/** Source active flags stay set throughout: no passive-selector workaround.
 * New selection resets lastTime to0; the next animation visit stamps its clock.
 * id−1 only changes period and never reposes/clears halted/completion flags. */
export function setNativeActivePedMove(
  input: NativeActivePedMoveInput,
): NativeActivePedMoveResult {
  const { instance, id, timeMs, callbackState } = input,
    options = input.options ?? {};
  if (
    !Number.isInteger(timeMs) ||
    timeMs < 0 ||
    timeMs > 0xffffffff ||
    !Number.isInteger(id) ||
    id < -1 ||
    id > 0x7fffffff
  )
    throw new Error("Invalid active pedestrian move ID/time");
  if (
    callbackState &&
    (!Number.isInteger(callbackState.flags) ||
      callbackState.flags < 0 ||
      callbackState.flags > 255 ||
      !Number.isInteger(callbackState.queuedMoveIndex) ||
      callbackState.queuedMoveIndex < -1 ||
      callbackState.queuedMoveIndex > 127)
  )
    throw new Error("Invalid native pedestrian callback byte/queued index");
  if (input.replayMode && !input.replayMutationsAllowed)
    return { ...result(null), replaySkipped: true };
  if (input.replayMode)
    return result(null, [
      "native-active-replay-direction-and-physical-basis-provider",
    ]);
  if (!instance.physicsActive)
    return result(null, ["native-active-character-state"]);
  try {
    currentNativePedModel(instance, 0);
  } catch {
    return result(null, ["native-render-actor-set-owner"]);
  }
  if (!instance.move) return result(null, ["native-selected-move-provider"]);
  if (instance.morphActive || options.morphDurationMs)
    return result(null, ["native-ped-morph-pose-provider"]);
  const root = matrix(input.rootPose),
    moveId = id < 0 ? id : id & ~0x40000000;
  let next: NativePedInstanceMove | null;
  try {
    next = id < 0 ? instance.move : moveFor(instance, moveId);
  } catch (error) {
    return result(null, [
      `native-move-${moveId}: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  if (!next)
    return result(2, [`native-move-${moveId}-and-personality-record-provider`]);
  const speed = f(input.speed ?? options.periodMs ?? -1);
  if (!Number.isFinite(speed))
    throw new Error("Invalid native pedestrian move speed");
  const converted = Math.trunc(
    speed >= 0 ? speed : -next.asset.form.periodMs * speed,
  );
  if (
    !Number.isSafeInteger(converted) ||
    converted < -0x80000000 ||
    converted > 0x7fffffff
  )
    throw new Error("Native pedestrian period conversion outside signed32");
  const period = (converted << 16) >> 16;
  // Reverse animation is explicitly separate; do not let an apparently complete
  // ordinary transition install an unsupported clock into the current instance.
  if (period < 0) return result(null, ["native-reverse-replay-provider"]);
  const changed =
    id >= 0 &&
    (moveId !== instance.moveId || !!(id & 0x40000000) || !!options.restart);
  if (
    changed &&
    !options.retainRoot &&
    next.asset.personality!.groundingMode === 0 &&
    (options.groundHeight === undefined || !input.writeGroundedRoot)
  )
    return result(null, [
      "native-active-ground-height-and-ACT-root-write-provider",
    ]);
  if (
    options.groundHeight !== undefined &&
    !Number.isFinite(f(options.groundHeight))
  )
    throw new Error("Invalid native pedestrian grounding height");
  // Preflight pose providers before changing selection. Native fully boned,
  // active/no-temporary-matrix storage is an ordinary early return, not a new pose.
  const mode = options.retainRoot ? 3 : 0;
  const orientation =
    changed && options.retainRoot
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
        mode,
        selectedMoveValid: true,
        renderAvailable: true,
        physicsActive: true,
        boned: instance.boned,
        temporaryMatricesAvailable: instance.temporaryMatricesAvailable,
        morphActive: false,
        mutantSpeed: instance.mutantSpeed,
      })
    : null;
  if (posed?.requiredProviders.length)
    return result(null, posed.requiredProviders);
  if (id >= 0) {
    // Core default pArg5 is0. A concrete ID updates completion even on same ID.
    instance.completionRequested = options.completionRequested ?? false;
    if (callbackState) {
      callbackState.queuedMoveIndex = -1;
      callbackState.flags =
        (callbackState.flags & ~2) | (instance.completionRequested ? 2 : 0);
    }
  }
  instance.clock.periodMs = period;
  if (!changed) return result(1);
  instance.move = next;
  instance.moveId = moveId;
  instance.clock.frame = 0;
  instance.clock.fraction = 0;
  instance.clock.lastTimeMs = 0;
  if (options.onMoveCompleted)
    instance.onMoveCompleted = options.onMoveCompleted;
  instance.characterOrientation = orientation;
  instance.rootPose.set(root);
  if (!options.retainRoot && next.asset.personality!.groundingMode === 0) {
    instance.rootPose[10] = f(
      options.groundHeight! + next.asset.personality!.groundingOffset,
    );
    input.writeGroundedRoot!(instance.rootPose.slice());
    // Native ground callback occurs before407b20; pose from the committed root.
    posed!.poses[0].set(instance.rootPose);
    const grounded = poseNativePedBones({
      bones: instance.poseBones,
      angles: next.bones.frames[0],
      rootPose: instance.rootPose,
      characterOrientation: orientation,
      currentPoses: instance.bones.map((b) => b.pose),
      removedBoneMask: instance.removedBoneMask,
      mode,
      selectedMoveValid: true,
      renderAvailable: true,
      physicsActive: true,
      boned: instance.boned,
      temporaryMatricesAvailable: instance.temporaryMatricesAvailable,
      morphActive: false,
      mutantSpeed: instance.mutantSpeed,
    });
    posed!.poses = grounded.poses;
  }
  const haltedFlagCleared = !(
    instance.boned && !instance.temporaryMatricesAvailable
  );
  if (callbackState && haltedFlagCleared) callbackState.flags &= ~1;
  // Installed407b38..4b returns before clearing halted or touching any ACT
  // when fully boned active storage has no temporary matrix array.
  if (haltedFlagCleared) {
    for (let i = 0; i < instance.bones.length; i++)
      instance.bones[i].pose.set(posed!.poses[i]);
    render(instance);
  }
  return { ...result(0), poseMode: mode, haltedFlagCleared };
}

export interface NativeActivePedMoveHost<Owner extends object> {
  readReplayState?: () => {
    replayMode: boolean;
    replayMutationsAllowed: boolean;
  };
  readCallbackState?: (
    context: NativePedRuntimeCallback<Owner>,
  ) => NativePedMoveCallbackState;
  readSpeed?: (
    context: NativePedRuntimeCallback<Owner>,
    id: number,
  ) => number | undefined;
  writeGroundedRoot?: (
    context: NativePedRuntimeCallback<Owner>,
    root: Float32Array,
  ) => void;
}
/** Direct runtime hook. Header state2 is required; it never activates/makes
 * passive, writes velocities, clears quiet state, or sets a new heading. */
export function createNativeActivePedMoveCallback<Owner extends object>(
  host: NativeActivePedMoveHost<Owner> = {},
): NonNullable<NativePedRuntimeHooks<Owner>["activeSetMove"]> {
  return (context, id, _direction, _up, options) => {
    if (context.body.headerState !== 2)
      return result(null, ["native-active-PHIL-header-state2"]);
    return setNativeActivePedMove({
      instance: context.instance,
      rootPose: nativePedRootPose(context.body),
      id,
      timeMs: context.timeMs,
      options,
      speed: host.readSpeed?.(context, id),
      callbackState: host.readCallbackState?.(context),
      ...host.readReplayState?.(),
      ...(host.writeGroundedRoot
        ? {
            writeGroundedRoot: (root: Float32Array) =>
              host.writeGroundedRoot!(context, root),
          }
        : {}),
    });
  };
}
