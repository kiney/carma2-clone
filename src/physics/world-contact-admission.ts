import type { Contact } from "./contact";

/** Browser trajectory admission: a shallow shared-edge seam is one local
 * encounter, not two simultaneous opposed supports. Five degrees is a bounded
 * smooth-patch policy, not an original C2 constant. Geometry and actor identity
 * distinguish a seam from separate walls, overlapping faces and sharp corners. */
function shallowSharedEdge(
  x: NonNullable<Contact["sourceSurface"]>,
  y: NonNullable<Contact["sourceSurface"]>,
): boolean {
  const actorX = x.source?.actor ?? x.actor;
  const actorY = y.source?.actor ?? y.actor;
  if (
    !actorX ||
    actorX !== actorY ||
    Math.abs(x.normal.dot(y.normal)) < Math.cos((5 * Math.PI) / 180)
  )
    return false;
  const first = [x.a, x.b, x.c],
    second = [y.a, y.b, y.c];
  const shared: { first: number; second: number }[] = [];
  for (let i = 0; i < 3; i++) {
    const j = second.findIndex(
      (v, index) =>
        !shared.some((pair) => pair.second === index) &&
        first[i].distanceToSquared(v) <= 1e-12,
    );
    if (j >= 0) shared.push({ first: i, second: j });
  }
  if (shared.length !== 2) return false;
  const origin = first[shared[0].first];
  const edge = first[shared[1].first].clone().sub(origin);
  if (edge.lengthSq() <= 1e-12) return false;
  const thirdX = first.find(
    (_, i) => !shared.some((pair) => pair.first === i),
  )!;
  const thirdY = second.find(
    (_, i) => !shared.some((pair) => pair.second === i),
  )!;
  // Compare the third vertices in the plane perpendicular to the shared edge.
  // Same-side overlapping triangles must not erase an independent contact.
  const sideX = edge.clone().cross(thirdX.clone().sub(origin));
  const sideY = edge.clone().cross(thirdY.clone().sub(origin));
  return sideX.dot(sideY) < 0;
}

/** Same local finite surface neighborhood. Coplanar behavior stays unchanged;
 * only proven shallow shared-edge adjacency broadens the previous predicate.
 * Different walls in a narrow gap remain independent constraints. */
function sameSurfacePatch(a: Contact, b: Contact): boolean {
  const x = a.sourceSurface,
    y = b.sourceSurface;
  if (!x || !y || x.owner || y.owner) return false;
  if (x === y) return true;
  return (
    (Math.abs(x.normal.dot(y.normal)) > 1 - 1e-8 &&
      Math.abs(x.normal.dot(y.a.clone().sub(x.a))) <= 1e-6) ||
    shallowSharedEdge(x, y)
  );
}

/** Native reduction already treats nearby opposed feature rows as one contact
 * (squared OLD-point distance .0045). Restrict that spatial fallback to one
 * plane patch: distinct levers and independent walls survive.
 * This policy belongs to the browser's sampled trajectory, not the C2 solver. */
export function conflictingWorldEncounter(a: Contact, b: Contact): boolean {
  if (
    a.a !== b.a ||
    a.b !== b.b ||
    a.normal.dot(b.normal) >= -0.95 ||
    !sameSurfacePatch(a, b)
  )
    return false;
  const x = a.worldFeature,
    y = b.worldFeature;
  if (
    x &&
    y &&
    x.hullIndex === y.hullIndex &&
    x.vertexIndex !== undefined &&
    y.vertexIndex !== undefined &&
    x.vertexIndex >= 0 &&
    y.vertexIndex >= 0 &&
    x.vertexIndex === y.vertexIndex
  )
    return true;
  return a.point.distanceToSquared(b.point) < 0.0045;
}

/** Samples describe successive encounters, not simultaneous opposing supports.
 * Admit the earliest local encounter before splitting by normal direction.
 * Caller still uses ALL crossings to constrain the final committed trajectory. */
export function admitSampledWorldContacts<T extends Contact>(
  rows: readonly T[],
): T[] {
  const admitted: T[] = [];
  for (const row of [...rows].sort(
    (a, b) => (a.worldFeature?.fraction ?? 0) - (b.worldFeature?.fraction ?? 0),
  )) {
    if (!admitted.some((other) => conflictingWorldEncounter(row, other)))
      admitted.push(row);
  }
  return admitted;
}

/** The sampled path takes precedence over its full-tick chord only where the
 * two disagree about the SAME local encounter. Never compare their fractions:
 * a chord can report the later upward crossing of an arc that first went down.
 * Equal normals at separate levers are not interchangeable torque constraints. */
export function mergeWorldContacts(
  native: readonly Contact[],
  sampled: readonly Contact[],
  encounters: readonly Contact[] = sampled,
): Contact[] {
  const retained = native.filter(
    (row) => !encounters.some((other) => conflictingWorldEncounter(row, other)),
  );
  return [
    ...retained,
    ...sampled.filter(
      (row) =>
        !retained.some(
          (other) =>
            other.a === row.a &&
            other.b === row.b &&
            other.normal.dot(row.normal) > 1 - 1e-8 &&
            other.point.distanceToSquared(row.point) < 0.0005,
        ),
    ),
  ];
}
