import { Vector3 } from "three";
import { cameraShapeRay, type CameraBodyShape } from "./own-shape";
import type { CameraWorldHit } from "./world-clearance";

/** Active noncars with native flag0x80000 only. Caller supplies that selection.
 * Positive second-probe hits use LOCAL inward normals, deliberately preserving
 * installed caller behavior. Native uninitialized/stale inside outputs are not
 * synthesized: inside still flags collision but cannot replace placement. */
export function cameraNoncarRay(
  worldCOM: Vector3,
  nearProbe: Vector3,
  extendedEnd: Vector3,
  shapes: readonly CameraBodyShape[],
  selected?: CameraWorldHit,
): { hit?: CameraWorldHit; collided: boolean } {
  let hit = selected;
  let collided = false;
  for (const shape of shapes) {
    const inverse = shape.orientation.clone().invert();
    const local = (point: Vector3) =>
      point.clone().sub(shape.position).applyQuaternion(inverse);
    const end = local(extendedEnd);
    if (!cameraShapeRay(local(nearProbe), end, shape.hulls)) continue;
    collided = true;
    const candidate = cameraShapeRay(local(worldCOM), end, shape.hulls);
    if (
      candidate &&
      !candidate.inside &&
      candidate.localNormal &&
      (!hit || candidate.fraction! < hit.fraction)
    )
      hit = {
        fraction: candidate.fraction!,
        normal: candidate.localNormal.clone(),
      };
  }
  return { hit, collided };
}
