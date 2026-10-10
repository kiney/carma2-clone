import { Ray, Vector3 } from "three";
import type { Surface } from "../world";
import type { CameraWorldHit } from "./world-clearance";

/** DRModelPick2D's finite camera ray. Physics-only edge modes do not change
 * visual ray eligibility; ordinary pling-material exclusion is independent. */
export function cameraTriangleRay(
  from: Vector3,
  delta: Vector3,
  surfaces: readonly Surface[],
  excludePlingMaterials = true,
): CameraWorldHit | undefined {
  if (![...from.toArray(), ...delta.toArray()].every(Number.isFinite))
    throw new Error("Invalid camera triangle segment");
  const length = delta.length();
  if (length === 0) return undefined;
  const ray = new Ray(from, delta.clone().divideScalar(length));
  const point = new Vector3();
  let closest: CameraWorldHit | undefined;
  for (const surface of surfaces) {
    if (surface.enabled === false) continue;
    if (excludePlingMaterials && /^[!>?]/.test(surface.material)) continue;
    let actor = surface.actor;
    let hidden = false;
    while (actor) {
      if (!actor.visible) {
        hidden = true;
        break;
      }
      actor = actor.parent as typeof actor;
    }
    if (hidden) continue;
    const incidence = surface.normal.dot(delta);
    if (Math.abs(incidence) < 2 ** -22) continue;
    const twoSided = !!(surface.materialFlags & 0x1800);
    if (!twoSided && incidence > 0) continue;
    if (
      !ray.intersectTriangle(surface.a, surface.b, surface.c, !twoSided, point)
    )
      continue;
    const fraction = point.distanceTo(from) / length;
    if (fraction > 1 || (closest && fraction >= closest.fraction)) continue;
    closest = { fraction, normal: surface.normal.clone() };
  }
  return closest;
}
