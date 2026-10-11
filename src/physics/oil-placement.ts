import { Box3, Matrix4, Vector3 } from "three";
import type { OilPlacement } from "./oil";

export interface NativeOilFace {
  a: Vector3;
  b: Vector3;
  c: Vector3;
  normal: Vector3;
  twoSided: boolean;
  material: string;
}
const f = Math.fround;
const dot = (a: Vector3, b: Vector3) => f(a.x * b.x + a.y * b.y + a.z * b.z);

/** Installed CheckSingleFace45f1c0. This is a finite segment with a strict
 * nonnegative plane distance, distinct from the signed-penetration wheel ray.
 * Installed45f504..45f54c divides the second numerator by the NEGATED
 * determinant; rec2's stale beta expression omits that sign. */
export function intersectNativeOilFace(
  origin: Vector3,
  segment: Vector3,
  face: NativeOilFace,
) {
  const d = dot(face.normal, segment);
  if (
    (!face.twoSided && d > 0) ||
    /^[!>?]/.test(face.material) ||
    Math.abs(d) < 2 ** -22
  )
    return null;
  const numerator = f(
    face.normal.x * (origin.x - face.a.x) +
      face.normal.y * (origin.y - face.a.y) +
      face.normal.z * (origin.z - face.a.z),
  );
  if (
    Math.abs(d) < 1 &&
    Math.abs(numerator) > Math.abs(d) * 3.4028234663852886e38
  )
    return null;
  const facing = d > 0 ? -numerator : numerator;
  if (facing < 0 || facing > Math.abs(d) + 0.003) return null;
  const fraction = Math.min(1, f(-numerator / d));
  const point = new Vector3(
    f(origin.x + f(segment.x * fraction)),
    f(origin.y + f(segment.y * fraction)),
    f(origin.z + f(segment.z * fraction)),
  );
  let drop = Math.abs(face.normal.x) >= Math.abs(face.normal.y) ? 0 : 1;
  if (Math.abs(face.normal.z) > Math.abs(face.normal.getComponent(drop)))
    drop = 2;
  const [u, v] = [0, 1, 2].filter((axis) => axis !== drop);
  const ux = f(face.b.getComponent(u) - face.a.getComponent(u)),
    uy = f(face.b.getComponent(v) - face.a.getComponent(v));
  const vx = f(face.c.getComponent(u) - face.a.getComponent(u)),
    vy = f(face.c.getComponent(v) - face.a.getComponent(v));
  const px = f(point.getComponent(u) - face.a.getComponent(u)),
    py = f(point.getComponent(v) - face.a.getComponent(v));
  const determinant = f(ux * vy - uy * vx);
  if (!determinant) return null;
  const alphaNumerator = f(ux * py - uy * px);
  if (Math.abs(alphaNumerator) > 1.0001 * Math.abs(determinant)) return null;
  const alpha = f(alphaNumerator / determinant);
  if (alpha < -0.0001) return null;
  const betaNumerator = f(vx * py - vy * px);
  if (Math.abs(betaNumerator) > 1.0001 * Math.abs(determinant)) return null;
  const beta = betaNumerator / -determinant;
  if (beta < -0.0001 || alpha + beta > 1.0001) return null;
  return {
    fraction,
    point,
    normal: face.normal.clone().multiplyScalar(d > 0 ? -1 : 1),
  };
}

export interface NativeOilPlacementQuery {
  bounds: Box3;
  matrix: Matrix4;
}
export type NativeOilFaceCollector = (
  query: NativeOilPlacementQuery,
  capacity: number,
) => readonly NativeOilFace[];

/** Installed4a6cd4..4a6f42: ACT-local model box, at most ten ordered faces,
 * first finite hit, then all collected neighbour planes. Never nearest-hit
 * sorting or a box derived from the smash impact point. */
export function projectNativeOil(
  sourceMatrix: Matrix4,
  modelBounds: Box3,
  fullSize: number,
  retainedSpillPosition: Vector3,
  collect: NativeOilFaceCollector,
): OilPlacement | null {
  if (
    !Number.isFinite(fullSize) ||
    fullSize < 0 ||
    modelBounds.isEmpty() ||
    !sourceMatrix.elements.every(Number.isFinite) ||
    ![modelBounds.min, modelBounds.max, retainedSpillPosition].every((p) =>
      p.toArray().every(Number.isFinite),
    )
  )
    throw new Error("Invalid native oil placement provider");
  const bounds = new Box3(
    new Vector3(-fullSize, f(modelBounds.min.y - 1 / 6.9), -fullSize),
    new Vector3(fullSize, modelBounds.max.y, fullSize),
  );
  const faces = collect({ bounds, matrix: sourceMatrix }, 10);
  if (faces.length > 10)
    throw new Error("Native oil face collector exceeded ten faces");
  const origin = new Vector3().setFromMatrixPosition(sourceMatrix);
  origin.y = f(origin.y + f(0.2));
  const height = f(bounds.min.y - bounds.max.y);
  const direction =
    Math.abs(height) > f(2 ** -22)
      ? new Vector3(0, -1, 0)
      : new Vector3(1, 0, 0);
  let accepted: ReturnType<typeof intersectNativeOilFace> = null;
  for (const face of faces) {
    accepted = intersectNativeOilFace(origin, direction, face);
    if (accepted) break;
  }
  if (!accepted || accepted.normal.y < f(0.97)) return null;
  return {
    position: accepted.point,
    normal: accepted.normal,
    nearbyFaceNormals: faces.map((face) => face.normal),
    sameSideOfNearbyPlanes: faces.map(
      (face) => retainedSpillPosition.clone().sub(face.a).dot(face.normal) >= 0,
    ),
  };
}

/** Graphics41ea20 retains this slot mask for the NEXT physics phase. */
export function nativeOilBroadphaseMask(
  carPosition: Vector3,
  shapeMaxZ: number,
  spills: readonly ({ mesh: { position: Vector3 }; fullSize: number } | null)[],
): number {
  if (
    spills.length > 32 ||
    !Number.isFinite(shapeMaxZ) ||
    !carPosition.toArray().every(Number.isFinite)
  )
    throw new Error("Invalid native oil broadphase provider");
  // Graphics41ea5f keeps the x87 product live for the first X comparison,
  // then stores it to Float32 for the remaining three comparisons.
  const wideRadius = shapeMaxZ * f(1 / 6.9) * f(1.5);
  const radius = f(wideRadius);
  let mask = 0;
  for (let i = 0; i < spills.length; i++) {
    const spill = spills[i];
    if (!spill) continue;
    const p = spill.mesh.position,
      full = spill.fullSize;
    if (
      carPosition.x - wideRadius < p.x + full &&
      carPosition.x + radius > p.x - full &&
      carPosition.z - radius < p.z + full &&
      carPosition.z + radius > p.z - full
    )
      mask |= 1 << i;
  }
  return mask >>> 0;
}
