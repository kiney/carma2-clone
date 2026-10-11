import { Quaternion, Vector3 } from "three";
import type { CollisionHull } from "../physics/geometry";

export interface CameraBodyShape {
  hulls: readonly CollisionHull[];
  position: Vector3;
  orientation: Quaternion;
}

export interface ShapeRay {
  inside: boolean;
  point?: Vector3;
  fraction?: number;
  localNormal?: Vector3;
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
    let entryNormal: Vector3 | undefined;
    let rejected = false;
    for (const face of hull.faces) {
      const offset = face.constant - face.normal.dot(from);
      const slope = face.normal.dot(delta);
      if (offset < 0) inside = false;
      if (slope === 0) {
        if (offset < 0) rejected = true;
      } else if (slope < 0) {
        const fraction = offset / slope;
        if (fraction > enter) {
          enter = fraction;
          entryNormal = face.normal.clone().negate();
        }
      } else exit = Math.min(exit, offset / slope);
    }
    if (inside) return { inside: true };
    if (rejected || enter > exit || exit < 0 || enter > 1) continue;
    if (!nearest || enter < nearest.fraction!)
      nearest = {
        inside: false,
        fraction: enter,
        point: from.clone().addScaledVector(delta, enter),
        localNormal: entryNormal,
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
  // Validate authored storage, but do not use its vertex radius as a ray
  // bound. Installed461810 tests the retained planes, including planes without
  // a closed auxiliary polygon after crush; it never clips to vertex bounds.
  for (const hull of shape.hulls)
    for (const vertex of hull.vertices) {
      if (!vertex.toArray().every(Number.isFinite))
        throw new Error("Invalid camera body vertex");
    }
  let limit: number | undefined;
  for (let iteration = 0; ; iteration++) {
    if (limit !== undefined && iteration >= limit)
      throw new Error("Camera own-shape clearance exceeded plane exit");
    const outward = position.clone().sub(worldCOM);
    // Installed413443–413491 uses +X when length is <=2^-22.
    if (outward.length() <= 2.384185791015625e-7) outward.set(1, 0, 0);
    outward.normalize().multiplyScalar(clearance);
    const from = position.clone().sub(shape.position).applyQuaternion(inverse);
    const to = position
      .clone()
      .sub(outward)
      .sub(shape.position)
      .applyQuaternion(inverse);
    const hit = cameraShapeRay(from, to, shape.hulls);
    if (!hit) return { position, iterations: iteration };
    if (hit.inside) {
      if (limit === undefined) {
        const direction = outward
          .clone()
          .divideScalar(clearance)
          .applyQuaternion(inverse);
        let exitDistance = Infinity;
        for (const face of shape.hulls[0].faces) {
          if (![...face.normal.toArray(), face.constant].every(Number.isFinite))
            throw new Error("Invalid camera body plane");
          const slope = face.normal.dot(direction);
          if (slope > 0)
            exitDistance = Math.min(
              exitDistance,
              (face.constant - face.normal.dot(from)) / slope,
            );
        }
        if (!Number.isFinite(exitDistance))
          throw new Error("Camera own-shape clearance ray has no finite exit");
        // Strict start-inside includes the boundary. One further step can
        // reach outside, and its inward probe can then hit that boundary.
        limit = Math.floor(Math.max(0, exitDistance) / clearance) + 3;
      }
      position.add(outward);
    } else {
      position
        .copy(hit.point!)
        .applyQuaternion(shape.orientation)
        .add(shape.position)
        .add(outward);
      return { position, iterations: iteration + 1 };
    }
  }
}
