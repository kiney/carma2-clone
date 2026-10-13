import type { CollisionHull } from "./geometry";

const immutableHullSets = new WeakSet<CollisionHull[]>();

/** Freeze an owned source-hull graph so broadphase caches may trust its identity. */
export function sealCollisionHulls(hulls: CollisionHull[]): CollisionHull[] {
  for (const hull of hulls)
    if (hull.localHull || hull.position || hull.orientation)
      throw new Error("Cannot seal transformed collision hulls");
  for (const hull of hulls) {
    for (const vertex of hull.vertices) Object.freeze(vertex);
    Object.freeze(hull.vertices);
    if (hull.vertexOrder) Object.freeze(hull.vertexOrder);
    for (const face of hull.faces) {
      Object.freeze(face.normal);
      Object.freeze(face.indices);
      Object.freeze(face);
    }
    Object.freeze(hull.faces);
    for (const edge of hull.edges) Object.freeze(edge);
    Object.freeze(hull.edges);
    Object.freeze(hull);
  }
  Object.freeze(hulls);
  immutableHullSets.add(hulls);
  return hulls;
}

export function hasImmutableCollisionHulls(hulls: CollisionHull[]): boolean {
  return immutableHullSets.has(hulls);
}
