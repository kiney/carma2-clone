import { Matrix4, Object3D, Quaternion, Vector3 } from "three";

export interface RenderBody {
  state: { position: Vector3; orientation: Quaternion };
  poseEpoch?: number;
}
interface Pose {
  position: Vector3;
  orientation: Quaternion;
  epoch?: number;
}

// World-to-local inversion/quaternion multiplication can introduce a few ULPs
// even for an unchanged pose. This tolerance covers double-precision roundoff
// in local components; it is not a physics or interpolation motion threshold.
const POSE_ROUNDOFF = 64 * Number.EPSILON;
function sameComponent(a: number, b: number): boolean {
  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    Math.abs(a - b) <= POSE_ROUNDOFF * Math.max(1, Math.abs(a), Math.abs(b))
  );
}
function ordinaryUpdates(actor: Object3D): boolean {
  return (
    actor.updateMatrix === Object3D.prototype.updateMatrix &&
    actor.updateMatrixWorld === Object3D.prototype.updateMatrixWorld &&
    actor.updateWorldMatrix === Object3D.prototype.updateWorldMatrix
  );
}

/** Render between the last two committed physics ticks. Never feed interpolated
 * transforms back into collision, damage, attachment or checkpoint state. */
export class RenderPoses {
  private previous = new Map<RenderBody, Pose>();
  private restored: Array<{ actor: Object3D; pose: Pose; matrix?: Matrix4 }> =
    [];
  private targetPosition = new Vector3();
  private targetOrientation = new Quaternion();
  private parentOrientation = new Quaternion();
  private parentInverse = new Matrix4();
  private targetMatrix = new Matrix4();
  private savedPosition = new Vector3();
  private savedOrientation = new Quaternion();
  private savedMatrix = new Matrix4();

  capture(bodies: readonly RenderBody[]) {
    const live = new Set(bodies);
    for (const body of this.previous.keys())
      if (!live.has(body)) this.previous.delete(body);
    for (const body of bodies) {
      const pose = this.previous.get(body) ?? {
        position: new Vector3(),
        orientation: new Quaternion(),
      };
      pose.position.copy(body.state.position);
      pose.orientation.copy(body.state.orientation);
      pose.epoch = body.poseEpoch;
      this.previous.set(body, pose);
    }
  }

  sample(
    body: RenderBody,
    alpha: number,
    position: Vector3,
    orientation: Quaternion,
  ) {
    const old = this.previous.get(body);
    position.copy(body.state.position);
    orientation.copy(body.state.orientation);
    if (!old || old.epoch !== body.poseEpoch) return;
    const fraction = Math.max(0, Math.min(1, alpha));
    position.lerpVectors(old.position, body.state.position, fraction);
    orientation.slerpQuaternions(
      old.orientation,
      body.state.orientation,
      fraction,
    );
  }

  /** Flat source ACTs have manual matrices; explicitly commit their temporary
   * interpolated pose, then restore the exact saved matrix after drawing. */
  apply(
    body: RenderBody,
    actor: Object3D,
    alpha: number,
    updateManualMatrix = false,
  ) {
    let ordinary = ordinaryUpdates(actor);
    for (let parent = actor.parent; ordinary && parent; parent = parent.parent)
      ordinary =
        ordinaryUpdates(parent) &&
        parent.getWorldQuaternion === Object3D.prototype.getWorldQuaternion;
    if (!ordinary)
      return this.applyCustom(body, actor, alpha, updateManualMatrix);
    // Save into reusable scratch before native parent outlets: custom methods
    // can have side effects, and changed paths retain the old restore boundary.
    this.savedPosition.copy(actor.position);
    this.savedOrientation.copy(actor.quaternion);
    const saveMatrix = updateManualMatrix && !actor.matrixAutoUpdate;
    if (saveMatrix) this.savedMatrix.copy(actor.matrix);
    this.sample(body, alpha, this.targetPosition, this.targetOrientation);
    if (actor.parent) {
      actor.parent.updateWorldMatrix(true, false);
      this.parentInverse.copy(actor.parent.matrixWorld).invert();
      this.targetPosition.applyMatrix4(this.parentInverse);
      actor.parent.getWorldQuaternion(this.parentOrientation);
      this.targetOrientation.premultiply(this.parentOrientation.invert());
    }
    const position = actor.position,
      orientation = actor.quaternion;
    const samePose =
      sameComponent(position.x, this.targetPosition.x) &&
      sameComponent(position.y, this.targetPosition.y) &&
      sameComponent(position.z, this.targetPosition.z) &&
      sameComponent(orientation.x, this.targetOrientation.x) &&
      sameComponent(orientation.y, this.targetOrientation.y) &&
      sameComponent(orientation.z, this.targetOrientation.z) &&
      sameComponent(orientation.w, this.targetOrientation.w);
    const sameManualMatrix =
      !updateManualMatrix ||
      this.targetMatrix
        .compose(this.targetPosition, this.targetOrientation, actor.scale)
        .elements.every((value, index) =>
          Object.is(value, actor.matrix.elements[index]),
        );
    // Final scene preparation owns animated/custom descendants. This method
    // only defers its redundant temporary-pose subtree updates; custom root
    // outlets still receive the original apply/restore calls.
    if (samePose && sameManualMatrix) return false;
    this.restored.push({
      actor,
      pose: {
        position: this.savedPosition.clone(),
        orientation: this.savedOrientation.clone(),
      },
      matrix: saveMatrix ? this.savedMatrix.clone() : undefined,
    });
    actor.position.copy(this.targetPosition);
    actor.quaternion.copy(this.targetOrientation);
    if (updateManualMatrix) actor.updateMatrix();
    actor.updateMatrixWorld(true);
    return true;
  }

  /** Opaque outlets retain the previous mutation/callback order as well as
   * their calls. They can inspect or change actors during parent preparation. */
  private applyCustom(
    body: RenderBody,
    actor: Object3D,
    alpha: number,
    updateManualMatrix: boolean,
  ): boolean {
    this.restored.push({
      actor,
      pose: {
        position: actor.position.clone(),
        orientation: actor.quaternion.clone(),
      },
      matrix:
        updateManualMatrix && !actor.matrixAutoUpdate
          ? actor.matrix.clone()
          : undefined,
    });
    this.sample(body, alpha, actor.position, actor.quaternion);
    if (actor.parent) {
      actor.parent.updateWorldMatrix(true, false);
      actor.position.applyMatrix4(actor.parent.matrixWorld.clone().invert());
      const parentRotation = actor.parent.getWorldQuaternion(new Quaternion());
      actor.quaternion.premultiply(parentRotation.invert());
    }
    if (updateManualMatrix) actor.updateMatrix();
    actor.updateMatrixWorld(true);
    return true;
  }

  restore() {
    for (const { actor, pose, matrix } of this.restored) {
      actor.position.copy(pose.position);
      actor.quaternion.copy(pose.orientation);
      if (matrix) {
        actor.matrix.copy(matrix);
        actor.matrixWorldNeedsUpdate = true;
      }
      actor.updateMatrixWorld(true);
    }
    this.restored.length = 0;
  }
}
