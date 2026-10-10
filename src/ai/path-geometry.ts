import { Vector2, Vector3 } from "three";
import type { TrackPathSection } from "../config";
import { nextProjectedPathSlot, type ProjectedPathSection } from "./path-route";

export interface NearestPathSection {
  section: number;
  intersection: Vector3;
  direction: Vector3;
  distance: number;
}

export interface StraightPathGeometry {
  /** Native horizontal coordinates are ordered world Z, then world X. */
  start: Vector2;
  finish: Vector2;
  width: number;
  /** Route slot of the first entry not merged, or -1 at route end. */
  nextSlot: number;
}

function finiteVector(value: Vector3): boolean {
  return value.toArray().every(Number.isFinite);
}

function checkedSectionNodes(
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
  sectionIndex: number,
) {
  const section = sections[sectionIndex];
  if (!section) throw new Error("Invalid opponent path section");
  const [startIndex, finishIndex] = section.nodeIndices;
  const start = nodes[startIndex],
    finish = nodes[finishIndex];
  if (
    !Number.isInteger(startIndex) ||
    !Number.isInteger(finishIndex) ||
    !start ||
    !finish ||
    !finiteVector(start) ||
    !finiteVector(finish) ||
    !Number.isFinite(section.width)
  )
    throw new Error("Invalid opponent path section geometry");
  return { section, start, finish };
}

/** FindNearestGeneralSection's installed weighted selection, expressed in
 * world coordinates. Y is doubled only for choosing a candidate; returned
 * intersection, unit direction, and distance retain original 3D units. */
export function findNearestPathSection(
  position: Vector3,
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
): NearestPathSection | undefined {
  if (!finiteVector(position) || nodes.some((node) => !finiteVector(node)))
    throw new Error("Invalid opponent path query geometry");

  let endpointSection = -1;
  let endpoint = new Vector3();
  let endpointScore = Infinity;
  let projectedSection = -1;
  let projection = new Vector3();
  let projectionScore = Infinity;

  const weighted = (point: Vector3) =>
    new Vector3(point.x, point.y * 2, point.z);
  const weightedPosition = weighted(position);
  for (let index = 0; index < sections.length; index++) {
    const { start, finish } = checkedSectionNodes(nodes, sections, index);
    for (const point of [finish, start]) {
      const score = weighted(point).distanceToSquared(weightedPosition);
      if (score < endpointScore) {
        endpointScore = score;
        endpointSection = index;
        endpoint.copy(point);
      }
    }

    const direction = finish.clone().sub(start);
    const weightedDirection = weighted(direction);
    const lengthSquared = weightedDirection.lengthSq();
    if (lengthSquared < Math.fround(0.0001)) continue;
    const weightedOffset = weighted(position.clone().sub(start));
    const t = weightedOffset.dot(weightedDirection) / lengthSquared;
    if (t < 0 || t > 1) continue;
    const weightedHit = weighted(start).addScaledVector(weightedDirection, t);
    const score = weightedHit.distanceToSquared(weightedPosition);
    if (score < projectionScore) {
      projectionScore = score;
      projectedSection = index;
      projection.copy(start).addScaledVector(direction, t);
    }
  }

  if (endpointSection < 0) return undefined;
  const projectionWins =
    projectedSection >= 0 && projectionScore <= endpointScore;
  const selectedSection = projectionWins ? projectedSection : endpointSection;
  const intersection = projectionWins ? projection : endpoint;
  const { start, finish } = checkedSectionNodes(
    nodes,
    sections,
    selectedSection,
  );
  const direction = finish.clone().sub(start);
  if (direction.lengthSq() > 0) direction.normalize();
  else direction.set(0, 0, 0);
  return {
    section: selectedSection,
    intersection: intersection.clone(),
    direction,
    distance: intersection.distanceTo(position),
  };
}

function horizontal(point: Vector3): Vector2 {
  return new Vector2(point.z, point.x);
}

/** GetStraight's cumulative two-dimensional grouping. The .1 threshold is a
 * strict lateral-deviation bound; degenerate directions stop grouping rather
 * than producing NaN. */
export function getStraightPathGeometry(
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
  route: readonly ProjectedPathSection[],
  startSlot = 0,
  cheating = false,
): StraightPathGeometry | undefined {
  if (!Number.isInteger(startSlot) || startSlot < 0 || startSlot > route.length)
    throw new Error("Invalid projected route slot");
  if (!route.length) return undefined;
  if (startSlot === route.length) return undefined;

  const pointsFor = (entry: ProjectedPathSection) => {
    if (entry.direction !== 0 && entry.direction !== 1)
      throw new Error("Invalid projected path direction");
    const { section, start, finish } = checkedSectionNodes(
      nodes,
      sections,
      entry.section,
    );
    return entry.direction === 1
      ? {
          start: horizontal(start),
          finish: horizontal(finish),
          width: section.width,
        }
      : {
          start: horizontal(finish),
          finish: horizontal(start),
          width: section.width,
        };
  };

  const initial = pointsFor(route[startSlot]);
  const start = initial.start.clone();
  let finish = initial.finish.clone();
  let width = initial.width;
  let nextSlot = nextProjectedPathSlot(sections, route, startSlot, cheating);
  for (
    ;
    nextSlot >= 0;
    nextSlot = nextProjectedPathSlot(sections, route, nextSlot, cheating)
  ) {
    const next = pointsFor(route[nextSlot]);
    const incoming = finish.clone().sub(start);
    const outgoing = next.finish.clone().sub(finish);
    const total = incoming.clone().add(outgoing);
    const totalLength = total.length();
    if (
      incoming.lengthSq() === 0 ||
      outgoing.lengthSq() === 0 ||
      totalLength === 0 ||
      !Number.isFinite(totalLength)
    )
      break;
    if (incoming.dot(total) < 0) break;
    const cross = incoming.x * total.y - incoming.y * total.x;
    if (Math.abs(cross) / totalLength >= Math.fround(0.1)) break;
    finish.copy(next.finish);
    width = Math.min(width, next.width);
  }
  return {
    start,
    finish,
    width,
    nextSlot: nextSlot < route.length ? nextSlot : -1,
  };
}

/** Return the authored byte limit at the endpoint selected by native direction
 * semantics. No speed-unit conversion is applied here. */
export function getPathEndpointSpeed(
  section: TrackPathSection,
  direction: 0 | 1,
  towardsFinish: boolean,
  limit: "min" | "max",
): number {
  if (direction !== 0 && direction !== 1)
    throw new Error("Invalid projected path direction");
  const endpointIndex = direction === Number(towardsFinish) ? 1 : 0;
  const values = limit === "min" ? section.minSpeed : section.maxSpeed;
  const speed = values[endpointIndex];
  if (!Number.isFinite(speed)) throw new Error("Invalid path endpoint speed");
  return speed;
}
