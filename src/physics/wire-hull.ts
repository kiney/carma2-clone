import { Vector3 } from "three";
import type { CollisionHull } from "./geometry";

/** Native shape type2: world422800 and pair425c00/4286f0 use authored
 * points/lines. Point-vs-wire428480 returns immediately: there is no interior,
 * plane, inferred volume or edge thickness. */
export function buildWireHull(
  points: readonly Vector3[],
  edges: readonly (readonly [number, number])[],
): CollisionHull {
  if (
    !points.length ||
    points.length > 1024 ||
    edges.length > 65536 ||
    points.some((point) => !point.toArray().every(Number.isFinite)) ||
    edges.some(
      (edge) =>
        edge.some(
          (index) =>
            !Number.isInteger(index) || index < 0 || index >= points.length,
        ) || edge[0] === edge[1],
    )
  )
    throw new Error("Invalid wire collision shape");
  return {
    vertices: points.map((point) => point.clone()),
    vertexOrder: points.map((_, index) => index),
    faces: [],
    edges: edges.map(([a, b]) => [a, b]),
  };
}
