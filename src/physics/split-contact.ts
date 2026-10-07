import { Vector3 } from "three";
import type { ContactImpact } from "./contact";

export interface SplitTriangle {
  a: Vector3;
  b: Vector3;
  c: Vector3;
  /** Original track normal, with its authored winding. */
  normal: Vector3;
}
export interface SplitContactEligibility {
  minForcePerTonne: number;
  snappability: number;
  softness: number;
  driver: number;
  objectType: number;
  immune: boolean;
  snapped: boolean;
}
export interface SplitContactCandidate {
  contact: ContactImpact;
  contactIndex: number;
  threshold: number;
  worldEdgePoint: Vector3;
  triangles: [SplitTriangle, SplitTriangle];
  edgeIndices: [number, number];
  /** Direction start minus end of the SECOND triangle's first matching edge. */
  worldEdgeDirection: Vector3;
  /** Original actor-local input plane for the later split-plane validator. */
  normalLocal: Vector3;
  constantLocal: number;
  horizontalNormalLocal: Vector3;
  horizontalConstantLocal: number;
}

const EDGE_DISTANCE_SQUARED = 1.1920928955078125e-7;
const NORMAL_DOT_MAXIMUM = Math.cos(0.1744903177022934);
const HORIZONTAL_COMPONENT = 0.7071070075035095;
const TINY = 2.384185791015625e-7;

/** Squared distance to a finite segment, independently expressed from the
 * projection geometry verified at local HW0x42c260. */
export function splitEdgeDistanceSquared(
  point: Vector3,
  start: Vector3,
  end: Vector3,
): number {
  const edge = end.clone().sub(start);
  const squared = edge.lengthSq();
  if (!squared) return point.distanceToSquared(start);
  const parameter = Math.max(
    0,
    Math.min(1, point.clone().sub(start).dot(edge) / squared),
  );
  return point.distanceToSquared(
    start.clone().addScaledVector(edge, parameter),
  );
}

/** Independently reconstructed local0x430d80 contact gate. The source scans
 * at most40 solved rows, accepts world-edge type0 only, then takes the FIRST
 * two cached triangles having a nearby edge. It does not compare edge IDs or
 * search later triangles for a better normal pair. Return planes for0x430730;
 * subsequent car/model split eligibility and slicing belong to the caller. */
export function findSplitContactCandidate(
  contacts: readonly ContactImpact[],
  triangles: readonly SplitTriangle[],
  eligibility: SplitContactEligibility,
  acceptCandidate?: (candidate: SplitContactCandidate) => boolean,
): SplitContactCandidate | null {
  if (
    eligibility.driver <= 5 ||
    eligibility.objectType !== 1 ||
    eligibility.immune ||
    eligibility.snapped
  )
    return null;
  for (
    let contactIndex = 0;
    contactIndex < Math.min(40, contacts.length);
    contactIndex++
  ) {
    const contact = contacts[contactIndex];
    if (
      contact.b ||
      contact.sourceType !== 0 ||
      !(contact.normalImpulse >= 0.009999999776482582) ||
      !contact.pointB
    )
      continue;
    const threshold =
      (contact.a.properties.mass * eligibility.minForcePerTonne) /
      (eligibility.snappability * eligibility.softness);
    if (!(contact.normalImpulse >= threshold)) continue;
    const found: { triangle: SplitTriangle; edgeIndex: number }[] = [];
    for (const triangle of triangles) {
      const points = [triangle.a, triangle.b, triangle.c];
      const edgeIndex = points.findIndex(
        (point, index) =>
          splitEdgeDistanceSquared(
            contact.pointB!,
            point,
            points[(index + 1) % 3],
          ) < EDGE_DISTANCE_SQUARED,
      );
      if (edgeIndex >= 0) found.push({ triangle, edgeIndex });
      if (found.length === 2) break;
    }
    if (
      found.length !== 2 ||
      found[0].triangle.normal.dot(found[1].triangle.normal) >
        NORMAL_DOT_MAXIMUM
    )
      continue;
    const secondPoints = [
      found[1].triangle.a,
      found[1].triangle.b,
      found[1].triangle.c,
    ];
    const worldEdgeDirection = secondPoints[found[1].edgeIndex]
      .clone()
      .sub(secondPoints[(found[1].edgeIndex + 1) % 3]);
    const state = contact.a.state;
    const edgeLocal = worldEdgeDirection
      .clone()
      .applyQuaternion(
        (state.predictedOrientation ?? state.orientation).clone().conjugate(),
      );
    const normalLocal = edgeLocal.cross(
      contact.normal
        .clone()
        .applyQuaternion(state.orientation.clone().conjugate()),
    );
    if (normalLocal.length() <= TINY) normalLocal.set(1, 0, 0);
    else normalLocal.normalize();
    if (
      Math.abs(normalLocal.x) <= HORIZONTAL_COMPONENT &&
      Math.abs(normalLocal.z) <= HORIZONTAL_COMPONENT
    )
      continue;
    const pointLocal = contact.point
      .clone()
      .sub(state.position)
      .applyQuaternion(state.orientation.clone().conjugate());
    const horizontalNormalLocal = new Vector3(
      normalLocal.x,
      0,
      normalLocal.z,
    ).normalize();
    const candidate: SplitContactCandidate = {
      contact,
      contactIndex,
      threshold,
      worldEdgePoint: contact.pointB.clone(),
      triangles: [found[0].triangle, found[1].triangle],
      edgeIndices: [found[0].edgeIndex, found[1].edgeIndex],
      worldEdgeDirection,
      normalLocal,
      constantLocal: normalLocal.dot(pointLocal),
      horizontalNormalLocal,
      horizontalConstantLocal: horizontalNormalLocal.dot(pointLocal),
    };
    if (!acceptCandidate || acceptCandidate(candidate)) return candidate;
  }
  return null;
}
