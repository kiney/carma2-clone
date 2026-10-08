import { Vector3 } from "three";

export interface WheelRayFace {
  a: Vector3;
  b: Vector3;
  c: Vector3;
  normal: Vector3;
  twoSided: boolean;
}

/** Installed HW MultiRayCheckSingleFace 0x45f5d0; rec2 0x45f0d0.
 * Independently expressed finite plane/barycentric equations. Unlike a generic
 * forward ray, the native wheel query accepts a small signed penetration and
 * clamps hits just beyond the segment to its endpoint. Distances are model units.
 */
export function intersectWheelFace(
  origin: Vector3,
  segment: Vector3,
  face: WheelRayFace,
): { fraction: number; point: Vector3; normal: Vector3 } | null {
  const denominator = face.normal.dot(segment);
  if ((!face.twoSided && denominator > 0) || Math.abs(denominator) < 2 ** -22)
    return null;
  const numerator = face.normal.dot(origin.clone().sub(face.a));
  const facingDistance = denominator > 0 ? -numerator : numerator;
  if (facingDistance < -0.001 || facingDistance > Math.abs(denominator) + 0.003)
    return null;
  const fraction = Math.min(1, -numerator / denominator);
  const point = origin.clone().addScaledVector(segment, fraction);
  // Native drops the largest normal component before its finite triangle test.
  const n = face.normal;
  const drop =
    Math.abs(n.x) > Math.abs(n.y)
      ? Math.abs(n.x) >= Math.abs(n.z)
        ? 0
        : 2
      : Math.abs(n.y) >= Math.abs(n.z)
        ? 1
        : 2;
  const axes = [0, 1, 2].filter((axis) => axis !== drop);
  const u = axes[0],
    v = axes[1];
  const bx = face.b.getComponent(u) - face.a.getComponent(u);
  const by = face.b.getComponent(v) - face.a.getComponent(v);
  const cx = face.c.getComponent(u) - face.a.getComponent(u);
  const cy = face.c.getComponent(v) - face.a.getComponent(v);
  const px = point.getComponent(u) - face.a.getComponent(u);
  const py = point.getComponent(v) - face.a.getComponent(v);
  const determinant = bx * cy - by * cx;
  if (determinant === 0) return null;
  const b = (px * cy - py * cx) / determinant;
  const c = (bx * py - by * px) / determinant;
  if (b < -0.0001 || c < -0.0001 || b > 1.0001 || c > 1.0001 || b + c > 1.0001)
    return null;
  return {
    fraction,
    point,
    normal: face.normal.clone().multiplyScalar(denominator > 0 ? -1 : 1),
  };
}
