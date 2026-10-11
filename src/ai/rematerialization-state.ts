import { Vector3 } from "three";
import {
  alignNativeRematerializationGround,
  type NativeGroundRay,
} from "./rematerialization-ground";
import {
  nativeRematerializationRetry,
  nativeRematerializationVelocity,
} from "./rematerialization";

const f = Math.fround;

/** ACT matrix represented as explicit stored row vectors and translation. */
export interface NativeActorPose {
  row0: Vector3;
  row1: Vector3;
  row2: Vector3;
  position: Vector3;
}

export interface NativeRematerializationActor {
  pose: NativeActorPose;
  physical: boolean;
  renderStyle: number;
  collisionFlags: number;
}

export interface NativeRematerializationCallbacks {
  ray: NativeGroundRay;
  /** Caller performs engine cache, old-matrix, wheel, drivetrain and reset writes. */
  applyAttemptReset(alignedPose: NativeActorPose, velocity: Vector3): void;
  /** Native public result: 0 means obstructed; -1 and 1 are accepted. */
  sensiblePlace(alignedPose: NativeActorPose): 0 | -1 | 1;
  successResetSpecialVolume(): void;
  pipe(enabled: boolean): void;
  rebuild(): void;
  clearDynamics(): void;
  fallback(): void;
}

function vector(value: Vector3, label: string): Vector3 {
  if (!(value instanceof Vector3))
    throw new Error(`Invalid native rematerialization ${label}`);
  const result = new Vector3(f(value.x), f(value.y), f(value.z));
  if (!result.toArray().every(Number.isFinite))
    throw new Error(`Invalid native rematerialization ${label}`);
  return result;
}

function clonePose(pose: NativeActorPose): NativeActorPose {
  return {
    row0: vector(pose.row0, "pose row0"),
    row1: vector(pose.row1, "pose row1"),
    row2: vector(pose.row2, "pose row2"),
    position: vector(pose.position, "pose position"),
  };
}

function copyPose(pose: NativeActorPose): NativeActorPose {
  return {
    row0: pose.row0.clone(),
    row1: pose.row1.clone(),
    row2: pose.row2.clone(),
    position: pose.position.clone(),
  };
}

function nativeYaw(row2: Vector3): number {
  return (
    (0x3ffc - Math.trunc(Math.atan2(row2.z, row2.x) * 10430.378350470453)) &
    0xffff
  );
}

/** Independent RematerialiseOpponent4a8540 lifecycle coordinator. Placement
 * reset callbacks own the engine-specific cached fields documented for the
 * caller; this class owns ACT pose, visibility flags and attempt ordering. */
export class NativeRematerializationState {
  constructor(
    private readonly actor: NativeRematerializationActor,
    private readonly callbacks: NativeRematerializationCallbacks,
  ) {}

  /** Return polarity follows the installed wrapper: accepted placement or
   * exhausted fallback both return1, even when fallback leaves physics inactive. */
  run(speed: number): 1 {
    const saved = clonePose(this.actor.pose);
    const storedSpeed = f(speed);
    if (!Number.isFinite(speed) || !Number.isFinite(storedSpeed))
      throw new Error("Invalid native rematerialization speed");
    // 0x4a8540 computes yaw from incoming row2 before the already-physical test.
    const savedYaw = nativeYaw(saved.row2);
    void savedYaw;
    if (this.actor.physical) return 1;

    this.actor.pose = copyPose(saved);
    this.actor.collisionFlags =
      (this.checkedFlags(this.actor.collisionFlags) | 0x100) >>> 0;
    this.actor.renderStyle = 0;
    this.callbacks.pipe(true);
    this.actor.physical = true;
    this.callbacks.rebuild();

    let attemptPosition = saved.position.clone();
    for (let retryIndex = -1; retryIndex <= 22; retryIndex++) {
      // The ground helper recomputes yaw from the same fixed saved row2 on each
      // retry, matching the single saved-yaw value without changing its API.
      const aligned = alignNativeRematerializationGround(
        attemptPosition,
        saved.row2,
        this.callbacks.ray,
      );
      const alignedPose: NativeActorPose = {
        row0: aligned.row0.clone(),
        row1: aligned.row1.clone(),
        row2: aligned.row2.clone(),
        position: aligned.position.clone(),
      };
      const velocity = nativeRematerializationVelocity(
        alignedPose.row2,
        storedSpeed,
      );
      this.actor.pose = copyPose(alignedPose);
      this.callbacks.applyAttemptReset(copyPose(alignedPose), velocity.clone());
      const placement = this.callbacks.sensiblePlace(copyPose(alignedPose));
      if (placement !== 0) {
        this.callbacks.successResetSpecialVolume();
        return 1;
      }

      // Native restores the complete incoming matrix before generating each
      // retry offset; offsets always use saved translation and saved row2.
      this.actor.pose = copyPose(saved);
      if (retryIndex < 22)
        attemptPosition = nativeRematerializationRetry(
          saved.position,
          saved.row2,
          retryIndex + 1,
        );
    }

    this.actor.pose = copyPose(saved);
    this.callbacks.clearDynamics();
    this.actor.physical = false;
    this.actor.renderStyle = 1;
    this.callbacks.pipe(false);
    this.callbacks.rebuild();
    this.callbacks.fallback();
    return 1;
  }

  private checkedFlags(value: number): number {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
      throw new Error("Invalid native rematerialization collision flags");
    return value >>> 0;
  }
}
