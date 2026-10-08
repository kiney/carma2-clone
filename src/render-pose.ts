import { Object3D, Quaternion, Vector3 } from "three";

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
  private restored: Array<{ actor: Object3D; pose: Pose }> = [];

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

  apply(body: RenderBody, actor: Object3D, alpha: number) {
    this.restored.push({
      actor,
      pose: {
        position: actor.position.clone(),
        orientation: actor.quaternion.clone(),
      },
    });
    this.sample(body, alpha, actor.position, actor.quaternion);
    if (actor.parent) {
      actor.parent.updateWorldMatrix(true, false);
      actor.position.applyMatrix4(actor.parent.matrixWorld.clone().invert());
      const parentRotation = actor.parent.getWorldQuaternion(new Quaternion());
      actor.quaternion.premultiply(parentRotation.invert());
    }
    actor.updateMatrixWorld(true);
  }

  restore() {
    for (const { actor, pose } of this.restored) {
      actor.position.copy(pose.position);
      actor.quaternion.copy(pose.orientation);
      actor.updateMatrixWorld(true);
    }
    this.restored.length = 0;
  }
}
