import { Vector3 } from "three";
import { ConvexHull } from "three/addons/math/ConvexHull.js";
import type { CollisionHull } from "./geometry";

/** Browser recovery for undefined native horizon incidence, never a replacement
 * for successful source-ordered hulls. QuickHull rebuilds the actual stored
 * points; its triangulation diagonals must not become physical CCD edges. */
export function recoverHull(
  points: readonly Vector3[],
  rawTolerance: number,
): CollisionHull {
  const unique: Vector3[] = [];
  const authored = new Map<Vector3, number>();
  const keys = new Set<string>();
  for (let index = 0; index < points.length; index++) {
    const point = new Vector3(...points[index].toArray().map(Math.fround));
    const key = point.toArray().join(",");
    if (keys.has(key)) continue;
    keys.add(key);
    unique.push(point);
    authored.set(point, index);
  }
  const invalid = () => new Error("Cannot reconstruct collision hull surface");
  if (unique.length < 4) throw invalid();
  const scale = [0, 1, 2].reduce(
    (sum, axis) =>
      sum +
      Math.max(...unique.map((point) => Math.abs(point.getComponent(axis)))),
    0,
  );
  const roundoff = Math.max(24 * Number.EPSILON * scale, Number.MIN_VALUE);
  const origin = unique[0];
  const farthest = unique.reduce((a, b) =>
    a.distanceToSquared(origin) >= b.distanceToSquared(origin) ? a : b,
  );
  const axis = farthest.clone().sub(origin);
  const normal = unique
    .map((point) => point.clone().sub(origin).cross(axis))
    .reduce((a, b) => (a.lengthSq() >= b.lengthSq() ? a : b))
    .normalize();
  if (
    !unique.some(
      (point) => Math.abs(normal.dot(point.clone().sub(origin))) > roundoff,
    )
  )
    throw invalid();
  // The native builder already accepted a non-planar seed before its horizon
  // failed. Independently check rank here because the addon assumes it.
  const quick = new ConvexHull().setFromPoints(unique);
  const triangles = quick.faces;
  const tolerance = Math.max(quick.tolerance * 8, Number.MIN_VALUE);
  if (
    triangles.length < 4 ||
    triangles.some(
      (face) =>
        !(face.area > 0) ||
        !Number.isFinite(face.constant) ||
        !face.normal.toArray().every(Number.isFinite) ||
        unique.some(
          (point) => face.normal.dot(point) - face.constant > tolerance,
        ),
    )
  )
    throw invalid();

  const indices = new Map(triangles.map((face, index) => [face, index]));
  const groups = triangles.map((_, index) => index);
  const root = (index: number): number => {
    while (groups[index] !== index) index = groups[index];
    return index;
  };
  for (let index = 0; index < triangles.length; index++) {
    const face = triangles[index];
    let edge = face.edge;
    do {
      const other = edge.twin.face;
      // Only machine-roundoff coplanarity joins adjacent facets. Using the
      // native 1e-6 side tolerance here would erase real narrow crush ridges.
      if (
        face.normal.dot(other.normal) > 0 &&
        [other.edge, other.edge.next, other.edge.prev].every(
          (e) =>
            Math.abs(face.normal.dot(e.head().point) - face.constant) <=
            tolerance,
        ) &&
        [face.edge, face.edge.next, face.edge.prev].every(
          (e) =>
            Math.abs(other.normal.dot(e.head().point) - other.constant) <=
            tolerance,
        )
      )
        groups[root(indices.get(other)!)] = root(index);
      edge = edge.next;
    } while (edge !== face.edge);
  }
  const surfaces = new Map<number, number[]>();
  for (let index = 0; index < triangles.length; index++) {
    const id = root(index);
    const members = surfaces.get(id) ?? [];
    members.push(index);
    surfaces.set(id, members);
  }
  const faces: CollisionHull["faces"] = [];
  const incidence = new Map<
    string,
    { edge: [number, number]; count: number }
  >();
  const used = new Set<number>();
  for (const [id, members] of surfaces) {
    const next = new Map<number, number>();
    for (const index of members) {
      const face = triangles[index];
      let edge = face.edge;
      do {
        if (root(indices.get(edge.twin.face)!) !== id) {
          const a = authored.get(edge.tail().point)!;
          const b = authored.get(edge.head().point)!;
          if (a === b || next.has(a)) throw invalid();
          next.set(a, b);
        }
        edge = edge.next;
      } while (edge !== face.edge);
    }
    if (next.size < 3) throw invalid();
    const start = Math.min(...next.keys());
    const polygon: number[] = [];
    let vertex = start;
    do {
      if (!next.has(vertex) || polygon.includes(vertex)) throw invalid();
      polygon.push(vertex);
      vertex = next.get(vertex)!;
    } while (vertex !== start);
    if (polygon.length !== next.size) throw invalid();
    const plane = triangles[members[0]];
    // Prevent transitive coplanarity joins from making a non-planar polygon.
    if (
      members.some((index) => {
        const edge = triangles[index].edge;
        return [edge, edge.next, edge.prev].some(
          (e) =>
            Math.abs(plane.normal.dot(e.head().point) - plane.constant) >
            tolerance,
        );
      })
    )
      throw invalid();
    faces.push({
      normal: plane.normal.clone(),
      constant: plane.constant,
      indices: polygon,
    });
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length];
      used.add(a);
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const entry = incidence.get(key) ?? {
        edge: [a, b] as [number, number],
        count: 0,
      };
      entry.count++;
      incidence.set(key, entry);
    }
  }
  // Translation-relative signed volume also checks outward orientation and
  // excludes coincident two-sided shells (which can satisfy Euler/incidence).
  let sixVolume = 0;
  for (const face of faces) {
    const a = points[face.indices[0]].clone().sub(origin);
    for (let i = 1; i + 1 < face.indices.length; i++)
      sixVolume += a.dot(
        points[face.indices[i]]
          .clone()
          .sub(origin)
          .cross(points[face.indices[i + 1]].clone().sub(origin)),
      );
  }
  if (
    faces.length < 4 ||
    !(sixVolume > 0) ||
    !Number.isFinite(sixVolume) ||
    [...incidence.values()].some((edge) => edge.count !== 2) ||
    used.size - incidence.size + faces.length !== 2 ||
    faces.some((face) =>
      points.some(
        (point) => face.normal.dot(point) - face.constant > rawTolerance,
      ),
    )
  )
    throw invalid();
  return {
    vertices: points.map((point) => point.clone()),
    vertexOrder: [...used].sort((a, b) => a - b),
    faces,
    edges: [...incidence.values()].map((entry) => entry.edge),
    recoveredFrom: "open-horizon",
  };
}
