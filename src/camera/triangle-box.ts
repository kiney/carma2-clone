import { Vector3 } from "three";

/** Native ModelPickBox retains triangles whose six-plane clipping result has
 * at least three vertices. An AABB broad-phase hit alone is insufficient. */
export function cameraTriangleInBox(
  vertices: readonly Vector3[],
  min: Vector3,
  max: Vector3,
): boolean {
  if (
    vertices.length !== 3 ||
    ![
      ...min.toArray(),
      ...max.toArray(),
      ...vertices.flatMap((v) => v.toArray()),
    ].every(Number.isFinite) ||
    min.x > max.x ||
    min.y > max.y ||
    min.z > max.z
  )
    throw new Error("Invalid camera triangle bounds");
  let polygon = vertices.map((v) => v.clone());
  for (const axis of ["x", "y", "z"] as const) {
    for (const side of [-1, 1]) {
      const boundary = side < 0 ? min[axis] : max[axis];
      const clipped: Vector3[] = [];
      for (let i = 0; i < polygon.length; i++) {
        const start = polygon[i];
        const end = polygon[(i + 1) % polygon.length];
        const startDistance = side * (boundary - start[axis]);
        const endDistance = side * (boundary - end[axis]);
        const startInside = startDistance >= 0;
        const endInside = endDistance >= 0;
        if (startInside) clipped.push(start.clone());
        if (startInside !== endInside)
          clipped.push(
            start
              .clone()
              .lerp(end, startDistance / (startDistance - endDistance)),
          );
      }
      polygon = clipped;
      if (polygon.length < 3) return false;
    }
  }
  return polygon.length >= 3;
}
