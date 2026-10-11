import { Vector3 } from "three";

export interface NativePointCamera {
  position: Vector3;
  /** Camera-to-world row2: +Z points behind the camera. */
  backwards: Vector3;
  yon: number;
}
export interface NativePointVisibility {
  camera: NativePointCamera;
  mirror?: NativePointCamera;
  /** Native extra renders ignore the direction gate. */
  extraRenders?: readonly Pick<NativePointCamera, "position" | "yon">[];
}
const f32 = Math.fround;
function vector(value: Vector3) {
  const result = new Vector3(f32(value.x), f32(value.y), f32(value.z));
  if (![result.x, result.y, result.z].every(Number.isFinite))
    throw new Error("Invalid native point visibility vector");
  return result;
}
/** Installed PointOutOfSight4e5aa0. Bounds and facing are strict; this is a
 * point/range/half-space test, not frustum clipping or obstacle occlusion. */
export function nativePointVisible(
  point: Vector3,
  maxDistanceSquared: number,
  views: NativePointVisibility,
) {
  const p = vector(point);
  const range = f32(maxDistanceSquared);
  if (!Number.isFinite(range)) throw new Error("Invalid native point range");
  const inside = (
    camera: Pick<NativePointCamera, "position" | "yon">,
    backwards?: Vector3,
  ) => {
    const delta = p.clone().sub(vector(camera.position));
    const yon = f32(camera.yon);
    if (!Number.isFinite(yon)) throw new Error("Invalid native camera yon");
    const limit = range !== 0 ? range : yon * yon;
    return (
      delta.lengthSq() < limit &&
      (!backwards || delta.dot(vector(backwards)) < 0)
    );
  };
  if (views.mirror && inside(views.mirror, views.mirror.backwards)) return true;
  for (const camera of views.extraRenders ?? [])
    if (inside(camera)) return true;
  return inside(views.camera, views.camera.backwards);
}
