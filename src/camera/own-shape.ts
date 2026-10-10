import { Quaternion, Vector3 } from "three";
import type { CollisionHull } from "../physics/geometry";

export interface CameraBodyShape {
  hulls: readonly CollisionHull[];
  position: Vector3;
  orientation: Quaternion;
}

interface ShapeRay {
  inside: boolean;
  point?: Vector3;
  fraction?: number;
}

/** Clip a finite local segment against authored convex half-spaces. Native
 * ShapeRayCast distinguishes start-inside from a positive boundary hit and
 * dispatches only the supplied head shape, not its linked successors. */
export function cameraShapeRay(
  from: Vector3,
  to: Vector3,
  hulls: readonly CollisionHull[],
): ShapeRay | undefined {
  if (![...from.toArray(), ...to.toArray()].every(Number.isFinite))
    throw new Error("Invalid camera shape segment");
  const delta = to.clone().sub(from);
  let nearest: ShapeRay | undefined;
  for (const hull of hulls.slice(0, 1)) {
    if (!hull.faces.length) continue;
    let inside = true;
    let enter = 0;
    let exit = 1;
    let rejected = false;
    for (const face of hull.faces) {
      const offset = face.constant - face.normal.dot(from);
      const slope = face.normal.dot(delta);
      if (offset < 0) inside = false;
      if (slope === 0) {
        if (offset < 0) rejected = true;
      } else if (slope < 0) enter = Math.max(enter, offset / slope);
      else exit = Math.min(exit, offset / slope);
    }
    if (inside) return { inside: true };
    if (rejected || enter > exit || exit < 0 || enter > 1) continue;
    if (!nearest || enter < nearest.fraction!)
      nearest = {
        inside: false,
        fraction: enter,
        point: from.clone().addScaledVector(delta, enter),
      };
  }
  return nearest;
}

/** Installed CollideCamera2 0x4133fa–0x41356d: own-shape clearance runs
 * independently of world faces. Repeat only for start-inside; a positive
 * boundary hit moves to hit+clearance and stops. Other cars do not participate. */
export function clearCameraFromOwnShape(
  cameraPosition: Vector3,
  worldCOM: Vector3,
  shape: CameraBodyShape,
  cameraNear: number,
): { position: Vector3; iterations: number } {
  if (!(cameraNear > 0 && Number.isFinite(cameraNear)))
    throw new Error("Invalid camera near plane");
  if (
    ![
      ...cameraPosition.toArray(),
      ...worldCOM.toArray(),
      ...shape.position.toArray(),
      ...shape.orientation.toArray(),
    ].every(Number.isFinite)
  )
    throw new Error("Invalid camera body transform");
  if (Math.abs(shape.orientation.lengthSq() - 1) > 1e-5)
    throw new Error("Camera body orientation must be normalized");
  const clearance = cameraNear * 3;
  const position = cameraPosition.clone();
  const inverse = shape.orientation.clone().invert();
  // A finite authored shape bounds the number of native inside advances.
  const localCOM = worldCOM
    .clone()
    .sub(shape.position)
    .applyQuaternion(inverse);
  let radius = 0;
  for (const hull of shape.hulls)
    for (const vertex of hull.vertices) {
      if (!vertex.toArray().every(Number.isFinite))
        throw new Error("Invalid camera body vertex");
      radius = Math.max(radius, vertex.distanceTo(localCOM));
    }
  const limit = Math.ceil((2 * radius) / clearance) + 3;
  for (let iteration = 0; iteration < limit; iteration++) {
    const outward = position.clone().sub(worldCOM);
    if (outward.lengthSq() === 0)
      throw new Error("Camera clearance ray starts at the centre of mass");
    outward.normalize().multiplyScalar(clearance);
    const from = position.clone().sub(shape.position).applyQuaternion(inverse);
    const to = position
      .clone()
      .sub(outward)
      .sub(shape.position)
      .applyQuaternion(inverse);
    const hit = cameraShapeRay(from, to, shape.hulls);
    if (!hit) return { position, iterations: iteration };
    if (hit.inside) position.add(outward);
    else {
      position
        .copy(hit.point!)
        .applyQuaternion(shape.orientation)
        .add(shape.position)
        .add(outward);
      return { position, iterations: iteration + 1 };
    }
  }
  throw new Error("Camera own-shape clearance exceeded authored bounds");
}
