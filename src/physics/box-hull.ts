import { Vector3 } from "three";
import type { CollisionHull } from "./geometry";
/** Analytic source BOX planes and edges retain exactly authored bounds,
 * including planar detached plates. Do not extrude a zero-width box merely
 * to satisfy the volumetric-polyhedron builder. */
export function buildBoxHull(min: Vector3, max: Vector3): CollisionHull {
  if (
    ![...min.toArray(), ...max.toArray()].every(Number.isFinite) ||
    [0, 1, 2].some((i) => min.getComponent(i) > max.getComponent(i))
  )
    throw new Error("Invalid collision box bounds");
  const vertices: Vector3[] = [];
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y])
      for (const z of [min.z, max.z]) vertices.push(new Vector3(x, y, z));
  const faces = [
    { normal: new Vector3(-1, 0, 0), constant: -min.x, indices: [0, 1, 3, 2] },
    { normal: new Vector3(1, 0, 0), constant: max.x, indices: [4, 6, 7, 5] },
    { normal: new Vector3(0, -1, 0), constant: -min.y, indices: [0, 4, 5, 1] },
    { normal: new Vector3(0, 1, 0), constant: max.y, indices: [2, 3, 7, 6] },
    { normal: new Vector3(0, 0, -1), constant: -min.z, indices: [0, 2, 6, 4] },
    { normal: new Vector3(0, 0, 1), constant: max.z, indices: [1, 5, 7, 3] },
  ];
  const edges: [number, number][] = [];
  for (let i = 0; i < 8; i++)
    for (const bit of [1, 2, 4]) if (!(i & bit)) edges.push([i, i | bit]);
  return { vertices, faces, edges };
}
