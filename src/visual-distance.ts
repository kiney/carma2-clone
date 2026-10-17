import type { Object3D, Quaternion, Vector3 } from "three";

/** Browser presentation policy, independent of native C2 process/physics Yon. */
export const VISUAL_DISTANCE_MULTIPLIER = 4;
export function visualDistances(
  nativeYon: number,
  pedestrianProcessDistance: number,
) {
  if (
    !Number.isFinite(nativeYon) ||
    nativeYon <= 0 ||
    !Number.isFinite(pedestrianProcessDistance) ||
    pedestrianProcessDistance <= 0
  )
    throw new Error("Invalid native visibility distances");
  return {
    nativeYon,
    landscape: nativeYon * VISUAL_DISTANCE_MULTIPLIER,
    opponents: nativeYon * VISUAL_DISTANCE_MULTIPLIER,
    pedestrians: Math.min(
      nativeYon * VISUAL_DISTANCE_MULTIPLIER,
      pedestrianProcessDistance * VISUAL_DISTANCE_MULTIPLIER,
    ),
    fogScale: VISUAL_DISTANCE_MULTIPLIER,
  };
}
interface PresentedBody {
  group: Object3D;
  state: { position: Vector3; orientation: Quaternion };
  poseEpoch?: number;
}
interface PublishedPose {
  epoch?: number;
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

/** Valid native cheaty poses may be shown for this render pass only. Native
 * visibility remains authoritative for oil, placement, AI and all other game
 * processing. Unknown/repositioned/failed-placement poses are never exposed. */
export class DistantOpponentPresentation {
  private published = new WeakMap<PresentedBody, PublishedPose>();
  private shown: Object3D[] = [];
  publish(body: PresentedBody): void {
    const p = body.state.position,
      q = body.state.orientation;
    const pose = this.published.get(body) ?? ({} as PublishedPose);
    Object.assign(pose, {
      epoch: body.poseEpoch,
      x: p.x,
      y: p.y,
      z: p.z,
      qx: q.x,
      qy: q.y,
      qz: q.z,
      qw: q.w,
    });
    this.published.set(body, pose);
  }
  invalidate(body: PresentedBody): void {
    this.published.delete(body);
  }
  apply(
    bodies: readonly PresentedBody[],
    camera: Vector3,
    distance: number,
  ): number {
    this.restore();
    const squared = distance * distance;
    for (const body of bodies) {
      if (body.group.visible) continue;
      const pose = this.published.get(body),
        p = body.state.position,
        q = body.state.orientation;
      if (
        !pose ||
        pose.epoch !== body.poseEpoch ||
        pose.x !== p.x ||
        pose.y !== p.y ||
        pose.z !== p.z ||
        pose.qx !== q.x ||
        pose.qy !== q.y ||
        pose.qz !== q.z ||
        pose.qw !== q.w ||
        !(p.distanceToSquared(camera) <= squared)
      )
        continue;
      body.group.visible = true;
      this.shown.push(body.group);
    }
    return this.shown.length;
  }
  restore(): void {
    for (const group of this.shown) group.visible = false;
    this.shown.length = 0;
  }
  reset(): void {
    this.restore();
    this.published = new WeakMap();
  }
}
