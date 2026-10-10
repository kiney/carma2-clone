import { Vector2, Vector3 } from "three";
import type { TrackPathSection } from "../config";
import { getPathEndpointSpeed, getStraightPathGeometry } from "./path-geometry";
import { nextProjectedPathSlot, type ProjectedPathSection } from "./path-route";
import { constructNativePathCorner } from "./path-corner";
import type { NativePathCorner } from "./path-corner";

export interface NativePathCornerRecord extends NativePathCorner {
  /** Projected slot of the outgoing straight's first section. */
  sectionSlot: number;
  /** Filled by CalcSOCs, not CalcCorners. */
  speed: number;
}

export type NativeSpeedConstraint =
  | { kind: "section"; sectionSlot: number; speed: number }
  | { kind: "corner"; cornerIndex: number; sectionSlot: number; speed: number };

function horizontal(point: Vector3): Vector2 {
  return new Vector2(point.z, point.x);
}

function routeSection(
  sections: readonly TrackPathSection[],
  route: readonly ProjectedPathSection[],
  slot: number,
): TrackPathSection {
  const entry = route[slot];
  const section = entry && sections[entry.section];
  if (!section || (entry.direction !== 0 && entry.direction !== 1))
    throw new Error("Invalid native path constraint section");
  return section;
}

function endpoints(
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
  route: readonly ProjectedPathSection[],
  slot: number,
): [Vector3, Vector3] {
  const entry = route[slot];
  const section = routeSection(sections, route, slot);
  const startIndex = section.nodeIndices[1 - entry.direction];
  const finishIndex = section.nodeIndices[entry.direction];
  const start = nodes[startIndex];
  const finish = nodes[finishIndex];
  if (
    !start ||
    !finish ||
    ![...start.toArray(), ...finish.toArray()].every(Number.isFinite)
  )
    throw new Error("Invalid native path constraint node");
  return [start, finish];
}

function horizontalDistance(a: Vector3, b: Vector3): number {
  return horizontal(a).distanceTo(horizontal(b));
}

/** CalcCorners traversal over projected straight groups. A fourth corner is
 * the native maximum; the previous straight's start/width carry forward. */
export function calculateNativePathCorners(
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
  route: readonly ProjectedPathSection[],
  startSlot = 0,
  random = Math.random,
  cheating = false,
): NativePathCornerRecord[] {
  const firstStraight = getStraightPathGeometry(
    nodes,
    sections,
    route,
    startSlot,
    cheating,
  );
  if (!firstStraight || firstStraight.nextSlot < 0) return [];
  let previousStart = firstStraight.start.clone();
  let previousWidth = firstStraight.width;
  let sectionSlot = firstStraight.nextSlot;
  const corners: NativePathCornerRecord[] = [];
  while (sectionSlot >= 0 && corners.length < 4) {
    const nextStraight = getStraightPathGeometry(
      nodes,
      sections,
      route,
      sectionSlot,
      cheating,
    );
    if (!nextStraight) break;
    const junction = nextStraight.start.clone();
    const corner = constructNativePathCorner(
      previousStart,
      junction,
      nextStraight.finish,
      previousWidth,
      nextStraight.width,
      random,
    );
    corners.push({ ...corner, sectionSlot, speed: 0 });
    previousStart = junction;
    previousWidth = nextStraight.width;
    sectionSlot = nextStraight.nextSlot;
  }
  return corners;
}

function baseCornerSpeed(radius: number): number {
  if (!(Number.isFinite(radius) && radius >= 0))
    throw new Error("Invalid native corner radius");
  return Math.trunc(
    Math.sqrt(radius * Math.fround(6.9) * Math.fround(7.5) * Math.fround(1.96)),
  );
}

/** CalcSOCs: append ordered section/corner constraints, including the exit
 * tangent overlap cap. Native storage holds ten 8-byte records. */
export function calculateNativeSpeedConstraints(
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
  route: readonly ProjectedPathSection[],
  corners: NativePathCornerRecord[],
  startSlot = 0,
  cheating = false,
): NativeSpeedConstraint[] {
  if (corners.length > 4) throw new Error("Too many native path corners");
  const result: NativeSpeedConstraint[] = [];
  const append = (constraint: NativeSpeedConstraint) => {
    if (result.length >= 10) return false;
    result.push(constraint);
    return true;
  };

  if (
    !Number.isInteger(startSlot) ||
    startSlot < 0 ||
    startSlot >= route.length
  )
    throw new Error("Invalid native SOC starting slot");
  let currentSlot = startSlot;
  for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex++) {
    const corner = corners[cornerIndex];
    const followingSlot = corner.sectionSlot;
    if (
      !Number.isInteger(followingSlot) ||
      followingSlot < 0 ||
      followingSlot >= route.length ||
      !Number.isFinite(corner.tangentReach) ||
      corner.tangentReach < 0
    )
      throw new Error("Invalid native path corner constraint");

    while (currentSlot !== followingSlot && currentSlot >= 0) {
      const [, currentFinish] = endpoints(nodes, sections, route, currentSlot);
      const [followingStart] = endpoints(nodes, sections, route, followingSlot);
      if (
        horizontalDistance(followingStart, currentFinish) <= corner.tangentReach
      )
        break;
      if (
        !append({
          kind: "section",
          sectionSlot: currentSlot,
          speed: getPathEndpointSpeed(
            routeSection(sections, route, currentSlot),
            route[currentSlot].direction,
            true,
            "max",
          ),
        })
      )
        return result;

      currentSlot = nextProjectedPathSlot(
        sections,
        route,
        currentSlot,
        cheating,
      );
    }

    let cornerSpeed = baseCornerSpeed(corner.radius);
    if (
      !append({
        kind: "corner",
        cornerIndex,
        sectionSlot: followingSlot,
        speed: cornerSpeed,
      })
    )
      return result;

    // Entries covered by the entrance tangent cap the corner before advancing
    // to its following section. Exit overlap uses a strict distance bound.
    const capCurrent = () => {
      cornerSpeed = Math.min(
        cornerSpeed,
        getPathEndpointSpeed(
          routeSection(sections, route, currentSlot),
          route[currentSlot].direction,
          true,
          "max",
        ),
      );
    };
    while (currentSlot >= 0 && currentSlot !== followingSlot) {
      capCurrent();
      currentSlot = nextProjectedPathSlot(
        sections,
        route,
        currentSlot,
        cheating,
      );
    }
    const [followingStart] = endpoints(nodes, sections, route, followingSlot);
    while (currentSlot >= 0) {
      const [, currentFinish] = endpoints(nodes, sections, route, currentSlot);
      if (
        horizontalDistance(followingStart, currentFinish) >= corner.tangentReach
      )
        break;
      capCurrent();
      currentSlot = nextProjectedPathSlot(
        sections,
        route,
        currentSlot,
        cheating,
      );
    }
    const constraint = result[result.length - 1];
    if (constraint?.kind === "corner") constraint.speed = cornerSpeed;
    corner.speed = cornerSpeed;
    if (result.length >= 10) return result;
  }
  return result;
}

/** NearestSectionInStraight's accumulated horizontal distance. Equality at a
 * section boundary stays on the current section; the unmerged slot is excluded. */
export function nearestSectionInStraight(
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
  route: readonly ProjectedPathSection[],
  firstSlot: number,
  unmergedSlot: number,
  projectedDistance: number,
  cheating = false,
): number {
  if (
    !Number.isInteger(firstSlot) ||
    !Number.isInteger(unmergedSlot) ||
    firstSlot < 0 ||
    firstSlot >= route.length ||
    unmergedSlot < -1 ||
    unmergedSlot > route.length ||
    !Number.isFinite(projectedDistance)
  )
    throw new Error("Invalid native straight-distance query");
  let slot = firstSlot;
  let cumulative = 0;
  while (true) {
    const next = nextProjectedPathSlot(sections, route, slot, cheating);
    if (next < 0 || next === unmergedSlot) return slot;
    const [start, finish] = endpoints(nodes, sections, route, slot);
    const length = horizontalDistance(start, finish);
    if (!Number.isFinite(length))
      throw new Error("Invalid native straight length");
    const liveSum = cumulative + length;
    cumulative = Math.fround(liveSum);
    if (!(liveSum < projectedDistance)) return slot;
    slot = next;
  }
}

export interface NativeSOCQuery {
  position: Vector3;
  speed: number;
  desiredSpeed: number;
  dtMs: number;
}

/** SetMaxSpeedFromSOCs: return the lowered metric speed target and traversal
 * evidence. Positions are horizontal (world Z, world X); speed is m/s. */
export function applyNativeSOCBraking(
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
  route: readonly ProjectedPathSection[],
  corners: readonly NativePathCornerRecord[],
  constraints: readonly NativeSpeedConstraint[],
  query: NativeSOCQuery,
): { desiredSpeed: number; cumulativeDistances: number[] } {
  if (
    ![
      query.position.x,
      query.position.y,
      query.position.z,
      query.speed,
      query.desiredSpeed,
      query.dtMs,
    ].every(Number.isFinite) ||
    query.speed < 0 ||
    query.desiredSpeed < 0 ||
    query.dtMs < 0
  )
    throw new Error("Invalid native SOC braking query");
  const speed = query.speed;
  const speedSquared = Math.fround(speed * speed);
  const frameTravel = query.dtMs * speed * Math.fround(0.001);
  const horizon = Math.fround(
    (speedSquared / 16 + frameTravel) * Math.fround(1 / 6.9),
  );
  let cumulative = 0;
  let previousTarget = horizontal(query.position);
  let previousWasCorner = false;
  let previousCornerReach = 0;
  let desiredSpeed = query.desiredSpeed;
  const cumulativeDistances: number[] = [];

  for (const constraint of constraints) {
    if (!(cumulative < horizon)) break;
    let target: Vector2;
    let targetSpeed: number;
    let currentCornerReach = 0;
    if (constraint.kind === "section") {
      const [, finish] = endpoints(
        nodes,
        sections,
        route,
        constraint.sectionSlot,
      );
      target = horizontal(finish);
      targetSpeed = getPathEndpointSpeed(
        routeSection(sections, route, constraint.sectionSlot),
        route[constraint.sectionSlot].direction,
        true,
        "max",
      );
    } else {
      const corner = corners[constraint.cornerIndex];
      if (!corner) throw new Error("Invalid native corner constraint index");
      const [start] = endpoints(nodes, sections, route, constraint.sectionSlot);
      target = horizontal(start);
      targetSpeed = constraint.speed;
      currentCornerReach = corner.tangentReach;
    }
    let leg = target.distanceTo(previousTarget);
    if (previousWasCorner) leg -= previousCornerReach;
    if (constraint.kind === "corner") leg -= currentCornerReach;
    cumulative = Math.max(0, Math.fround(cumulative + leg));
    cumulativeDistances.push(cumulative);
    previousTarget = target;
    previousWasCorner = constraint.kind === "corner";
    previousCornerReach = currentCornerReach;

    if (
      cumulative * Math.fround(6.9) <
      (speedSquared - targetSpeed * targetSpeed) / 16 + frameTravel
    )
      desiredSpeed = Math.min(desiredSpeed, targetSpeed);
  }
  return { desiredSpeed, cumulativeDistances };
}
