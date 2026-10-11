export interface NativeModelPickVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

type StoredVector = { x: number; y: number; z: number };
const axes = ["x", "y", "z"] as const;
const f = Math.fround;

function stored(v: NativeModelPickVector): StoredVector {
  const result = { x: f(v.x), y: f(v.y), z: f(v.z) };
  if (
    !axes.every(
      (axis) => Number.isFinite(v[axis]) && Number.isFinite(result[axis]),
    )
  )
    throw new Error("ModelPickBox requires finite Float32 coordinates");
  return result;
}

/** The installed 460490 clipping predicate, after the model-space early gates
 * and query-box transpose transform. This polygon is only an acceptance test;
 * native cached face records retain the original triangle vertices. */
export function clipNativeModelPickFaceToBox(
  vertices: readonly NativeModelPickVector[],
  min: NativeModelPickVector,
  max: NativeModelPickVector,
): readonly NativeModelPickVector[] {
  if (vertices.length !== 3)
    throw new Error("ModelPickBox requires exactly three triangle vertices");
  const low = stored(min),
    high = stored(max);
  if (axes.some((axis) => min[axis] > max[axis] || low[axis] > high[axis]))
    throw new Error("ModelPickBox requires ordered box bounds");
  let polygon = vertices.map(stored);
  for (const axis of axes) {
    for (const greaterEqual of [true, false]) {
      const limit = greaterEqual ? low[axis] : high[axis];
      const output: StoredVector[] = [];
      let previous = polygon[polygon.length - 1];
      for (const current of polygon) {
        // Both source passes use strict > for crossing, including equality.
        if (previous[axis] > limit !== current[axis] > limit) {
          const intersection = { x: 0, y: 0, z: 0 };
          for (const component of axes)
            intersection[component] =
              component === axis
                ? limit
                : f(
                    ((current[component] - previous[component]) *
                      (limit - previous[axis])) /
                      (current[axis] - previous[axis]) +
                      previous[component],
                  );
          output.push(intersection);
        }
        if (greaterEqual ? current[axis] >= limit : current[axis] <= limit)
          output.push({ ...current });
        previous = current;
      }
      if (output.length > 12)
        throw new Error(
          "ModelPickBox clipping exceeds the native 12-vertex buffer",
        );
      polygon = output;
      // Source stops immediately; subsequent planes must not resurrect it.
      if (polygon.length < 3) return polygon;
    }
  }
  return polygon;
}

export function nativeModelPickFaceInBox(
  vertices: readonly NativeModelPickVector[],
  min: NativeModelPickVector,
  max: NativeModelPickVector,
): boolean {
  return clipNativeModelPickFaceToBox(vertices, min, max).length >= 3;
}
