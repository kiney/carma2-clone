import { Box3, Vector3 } from "three";
import type { WorldCollision } from "../world";
import type { CameraBodyShape } from "./own-shape";
import { cameraNoncarRay } from "./noncar-ray";
import { cameraTriangleRay, cameraSurfaceVisible } from "./triangle-ray";
import { cameraTriangleInBox } from "./triangle-box";
import type { CameraWorldQueries } from "./world-clearance";

/** Share original transformed triangles, not the vehicle collision sweep.
 * Candidate order currently follows the browser spatial index: equivalence to
 * native prepared material-group ordering before its six-face cap is pending.
 */
export function cameraWorldQueries(
  world: WorldCollision,
  blockingNoncars: () => readonly CameraBodyShape[] = () => [],
): CameraWorldQueries {
  return {
    ray(from: Vector3, delta: Vector3) {
      const bounds = new Box3().setFromPoints([from, from.clone().add(delta)]);
      return cameraTriangleRay(
        from,
        delta,
        world.querySurfaces(bounds.min, bounds.max, true),
      );
    },
    faces(min: Vector3, max: Vector3) {
      return world
        .querySurfaces(min, max, true)
        .filter(
          (surface) =>
            cameraSurfaceVisible(surface) &&
            cameraTriangleInBox([surface.a, surface.b, surface.c], min, max),
        )
        .map((surface) => ({
          point: surface.a,
          normal: surface.normal,
          twoSided: !!(surface.materialFlags & 0x1000),
        }));
    },
    noncars(com, nearProbe, end, selected) {
      return cameraNoncarRay(com, nearProbe, end, blockingNoncars(), selected);
    },
  };
}
