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

/** Render between the last two committed physics ticks. Never feed interpolated
 * transforms back into collision, damage, attachment or checkpoint state. */
export class RenderPoses {
  private previous = new Map<RenderBody, Pose>();
  private restored: Array<{ actor: Object3D; pose: Pose; matrix?: Matrix4 }> =
    [];

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
