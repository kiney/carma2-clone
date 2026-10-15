import { Vector3 } from "three";
import type { CollisionHull } from "./geometry";

const AXIS_LENGTH_SQUARED_MINIMUM = 1e-12;

function normalized(axis: Vector3): Vector3 | undefined {
  const lengthSquared = axis.lengthSq();
  if (
    !Number.isFinite(lengthSquared) ||
    lengthSquared < AXIS_LENGTH_SQUARED_MINIMUM
  )
    return;
  return axis.clone().multiplyScalar(1 / Math.sqrt(lengthSquared));
}

function project(hull: CollisionHull, axis: Vector3): [number, number] {
  let low = Infinity,
    high = -Infinity;
  const count = hull.vertexOrder?.length ?? hull.vertices.length;
  for (let index = 0; index < count; index++) {
    const value = hull.vertices[hull.vertexOrder?.[index] ?? index].dot(axis);
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return [low, high];
}

/** Exact continuous SAT for fixed orientations and linear translation. Each
 * axis contributes two strict depth inequalities; intersecting their temporal
 * intervals catches complete crossings with clear endpoints. OLD overlap
 * admission and wire/native-feature handling remain the caller's policy. */
export function translationHullFraction(
  aWorldOld: CollisionHull,
  bWorldOld: CollisionHull,
  deltaA: Vector3,
  deltaB: Vector3,
  depthLimit: number,
): number {
  if (
    !aWorldOld.faces.length ||
    !bWorldOld.faces.length ||
    !(aWorldOld.vertexOrder?.length ?? aWorldOld.vertices.length) ||
    !(bWorldOld.vertexOrder?.length ?? bWorldOld.vertices.length)
  )
    return 1;
  if (!(Number.isFinite(depthLimit) && depthLimit >= 0)) return 0;
  const relative = deltaB.clone().sub(deltaA);
  let enter = 0,
    leave = 1,
    axes = 0,
    invalid = false;
  const inequality = (value: number, rate: number): boolean => {
    if (!Number.isFinite(value) || !Number.isFinite(rate)) {
      // Invalid arithmetic cannot establish an unchecked trajectory as clear.
      invalid = true;
      return false;
    }
    if (rate === 0) return value > 0;
    const boundary = -value / rate;
    if (rate > 0) enter = Math.max(enter, boundary);
    else leave = Math.min(leave, boundary);
    return enter < leave;
  };
  const visit = (source: Vector3): boolean => {
    if (!Number.isFinite(source.lengthSq())) {
      invalid = true;
      return false;
    }
    const axis = normalized(source);
    if (!axis) return true;
    axes++;
    const [al, ah] = project(aWorldOld, axis),
      [bl, bh] = project(bWorldOld, axis),
      rate = relative.dot(axis);
    if (![al, ah, bl, bh, rate].every(Number.isFinite)) {
      invalid = true;
      return false;
    }
    return (
      inequality(ah - bl - depthLimit, -rate) &&
      inequality(bh - al - depthLimit, rate)
    );
  };
  for (const hull of [aWorldOld, bWorldOld])
    for (const face of hull.faces)
      if (!visit(face.normal)) return invalid ? 0 : 1;
  const edgeA = new Vector3(),
    edgeB = new Vector3(),
    cross = new Vector3();
  for (const [ai, aj] of aWorldOld.edges) {
    edgeA.subVectors(aWorldOld.vertices[aj], aWorldOld.vertices[ai]);
    for (const [bi, bj] of bWorldOld.edges) {
      edgeB.subVectors(bWorldOld.vertices[bj], bWorldOld.vertices[bi]);
      if (!visit(cross.crossVectors(edgeA, edgeB))) return invalid ? 0 : 1;
    }
  }
  return axes && enter < leave ? Math.max(0, enter) : 1;
}

/** A one-sided whole-phase clearance certificate. The caller supplies global
 * OLD-orientation envelopes in world-distance units, including every angular
 * excursion and any pose discontinuity. Failure means "unknown", not contact.
 * Any witness direction suffices, so edge-cross construction is unnecessary. */
export function certifiedHullSeparation(
  aOld: CollisionHull,
  bOld: CollisionHull,
  relativeDelta: Vector3,
  rotationAllowanceA: number,
  rotationAllowanceB: number,
): boolean {
  if (
    !(aOld.vertexOrder?.length ?? aOld.vertices.length) ||
    !(bOld.vertexOrder?.length ?? bOld.vertices.length) ||
    !Number.isFinite(rotationAllowanceA) ||
    !Number.isFinite(rotationAllowanceB) ||
    rotationAllowanceA < 0 ||
    rotationAllowanceB < 0
  )
    return false;
  const allowance = rotationAllowanceA + rotationAllowanceB;
  const witness = (source: Vector3): boolean => {
    const axis = normalized(source);
    if (!axis) return false;
    const [al, ah] = project(aOld, axis),
      [bl, bh] = project(bOld, axis),
      travel = relativeDelta.dot(axis);
    if (![al, ah, bl, bh, travel, allowance].every(Number.isFinite))
      return false;
    const scale = Math.max(
      1,
      Math.abs(al),
      Math.abs(ah),
      Math.abs(bl),
      Math.abs(bh),
      Math.abs(travel),
      allowance,
    );
    const pad = 1e-9 + 64 * Number.EPSILON * scale;
    return (
      Math.max(bl - ah + Math.min(0, travel), al - bh + Math.min(0, -travel)) >
      allowance + pad
    );
  };
  const centerDelta = new Vector3();
  for (const [hull, sign] of [
    [bOld, 1],
    [aOld, -1],
  ] as const) {
    const count = hull.vertexOrder?.length ?? hull.vertices.length;
    for (let index = 0; index < count; index++)
      centerDelta.addScaledVector(
        hull.vertices[hull.vertexOrder?.[index] ?? index],
        sign / count,
      );
  }
  if (witness(centerDelta)) return true;
  for (const hull of [aOld, bOld])
    for (const face of hull.faces) if (witness(face.normal)) return true;
  return (
    witness(new Vector3(1, 0, 0)) ||
    witness(new Vector3(0, 1, 0)) ||
    witness(new Vector3(0, 0, 1))
  );
}
