import type { Vector3 } from "three";
import { nativeModelPickFaceInBox } from "../physics/model-pick-box";

/** Source finite clipping; early prepared-plane gates remain caller-owned. */
export function cameraTriangleInBox(
  vertices: readonly Vector3[],
  min: Vector3,
  max: Vector3,
): boolean {
  return nativeModelPickFaceInBox(vertices, min, max);
}
