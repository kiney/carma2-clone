/** Installed SetCharacterPosition40b0a0 mode1, without BON clock advancement. */
import type {
  NativePedInstance,
  NativePedInstanceResult,
} from "./ped-native-instance";
import { currentNativePedModel } from "./ped-native-instance";
import {
  composePedRootPose,
  groundPedRootOrigin,
  pedRootMotionDirection,
  type PedVector,
} from "./ped-form";
import { poseNativePedBones } from "./ped-bone-pose";
import type { NativePedMoveCallbackState } from "./physics/ped-active-move";

export interface NativePedSetPositionInput {
  instance: NativePedInstance;
  /** Raw finite selected face hit; mode1 adds current move clearance once. */
  groundPoint: PedVector;
  /** Actual Character+14, not PHIL header flags or pedestrian flags. */
  physicsFlags: number;
  callbackState?: NativePedMoveCallbackState;
  /**40b2b5 copies the complete pre-pose root into passive Object+8c. */
  writePassiveMatrix?: (pose: Float32Array) => void;
  replayMode?: boolean;
}
export interface NativePedSetPositionResult extends NativePedInstanceResult {
  positionIgnored: boolean;
  physicsMatrixWritten: boolean;
  haltedFlagCleared: boolean;
}
const f = Math.fround;
function result(requiredProviders: string[] = []): NativePedSetPositionResult {
  return {
    status: requiredProviders.length ? "provider-required" : "complete",
    requiredProviders,
    processedFrames: 0,
    completedMove: false,
    positionIgnored: false,
    physicsMatrixWritten: false,
    haltedFlagCleared: false,
  };
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
/** Ground translation, reset-axis phase correction, passive matrix notification,
 * then current-frame mode0 pose. Ped.pos is a separate later outer-loop write. */
export function setNativePedPosition(
  input: NativePedSetPositionInput,
): NativePedSetPositionResult {
  const { instance, physicsFlags, callbackState } = input;
  if (
    !Number.isInteger(physicsFlags) ||
    physicsFlags < 0 ||
    physicsFlags > 0xffffffff
  )
    throw new Error("Native position physics flags must be uint32");
  if (physicsFlags & 4) {
    if (!input.replayMode) return { ...result(), positionIgnored: true };
    return result(["native-replay-position-provider"]);
  }
  if (input.replayMode) return result(["native-replay-position-provider"]);
  if (instance.physicsActive)
    return result(["native-position-character-active-bit-owner"]);
  try {
    currentNativePedModel(instance, 0);
  } catch {
    return result(["native-render-actor-set-owner"]);
  }
  const move = instance.move;
  if (!move) return result(["native-selected-move-provider"]);
  const frame = instance.clock.frame;
  if (!Number.isInteger(frame) || frame < 0 || frame >= move.roots.length)
    throw new Error("Native position requires an authored current frame");
  if (instance.morphActive) return result(["native-ped-morph-pose-provider"]);
  if (
    callbackState &&
    (!Number.isInteger(callbackState.flags) ||
      callbackState.flags < 0 ||
      callbackState.flags > 255)
  )
    throw new Error("Invalid native position callback byte");
  if (physicsFlags & 1 && !input.writePassiveMatrix)
    return result(["native-passive-position-matrix-owner"]);
  const personal = move.asset.personality;
  if (!personal) return result(["native-personality-move-provider"]);
  const position = groundPedRootOrigin(
    input.groundPoint,
    input.groundPoint[1],
    personal.groundingOffset,
  );
  const reset = move.asset.form.resetAxes;
  const stationary = pedRootMotionDirection(
    move.roots,
    move.asset.form.direction,
    reset,
  ).stationary;
  let x = 0,
    y = 0,
    z = 0;
  if (!stationary) {
    //40b1c9..1e7 walks backward. Only X spills after each add; Y/Z stay live.
    for (let i = frame; i > 0; i--) {
      x = f(x + move.roots[i][9]);
      y += move.roots[i][10];
      z += move.roots[i][11];
    }
    if (!reset.includes("X")) x = 0;
    if (!reset.includes("Y")) y = 0;
    if (!reset.includes("Z")) z = 0;
  }
  const k = f(personal.scale);
  //This source phase correction is in world axes; no movement-basis transform.
  const prePose = instance.rootPose.slice();
  prePose[9] = f(position[0] + x * k);
  prePose[10] = f(position[1] + y * k);
  prePose[11] = f(position[2] + z * k);
  const root = composePedRootPose(
    move.roots[frame],
    instance.characterOrientation,
    [prePose[9], prePose[10], prePose[11]],
  );
  const posed = poseNativePedBones({
    bones: instance.poseBones,
    angles: move.bones.frames[frame],
    rootPose: root,
    characterOrientation: instance.characterOrientation,
    currentPoses: instance.bones.map((b) => b.pose),
    removedBoneMask: instance.removedBoneMask,
    mode: 0,
    selectedMoveValid: true,
    renderAvailable: true,
    physicsActive: false,
    boned: instance.boned,
    temporaryMatricesAvailable: instance.temporaryMatricesAvailable,
    morphActive: false,
    mutantSpeed: instance.mutantSpeed,
  });
  if (posed.requiredProviders.length) return result(posed.requiredProviders);
  //Source passive-matrix notification precedes407b20. Callback failure stops
  //at that ownership boundary, retaining the already changed root translation.
  instance.rootPose.set(prePose);
  if (physicsFlags & 1) input.writePassiveMatrix!(prePose.slice());
  instance.rootPose.set(root);
  for (let i = 0; i < instance.bones.length; i++)
    instance.bones[i].pose.set(posed.poses[i]);
  if (callbackState) callbackState.flags &= ~1;
  render(instance);
  return {
    ...result(),
    physicsMatrixWritten: !!(physicsFlags & 1),
    haltedFlagCleared: true,
  };
}
