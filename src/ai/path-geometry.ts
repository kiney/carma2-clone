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

/** Installed FindNearestGeneralSection4a8070 with a null/global selector.
 * Weighted selection stores native Float32 candidates/scores/parameter; final
 * intersection, normalized direction and distance use original 3D units. */
export function findNearestPathSection(
  position: Vector3,
  nodes: readonly Vector3[],
  sections: readonly TrackPathSection[],
): NearestPathSection | undefined {
  const f = Math.fround;
  const stored = (v: Vector3) => new Vector3(f(v.x), f(v.y), f(v.z));
  const actor = stored(position);
  const points = nodes.map(stored);
  if (!finiteVector(actor) || points.some((node) => !finiteVector(node)))
    throw new Error("Invalid opponent path query geometry");
  if (!sections.length) return undefined;
  const mixedSquare = (x: number, y: number, z: number) =>
    x * f(x) + y * f(y) + z * z;
  let endpointSection = -1;
  let endpointNode = -1;
  let endpointScore = f(3.4028234663852886e38);
  let projectedSection = -1;
  let projectionScore = f(3.4028234663852886e38);
  let projectionT = 0;
  for (let index = 0; index < sections.length; index++) {
    const { section, start, finish } = checkedSectionNodes(
      points,
      sections,
      index,
    );
    const ax = f(finish.x - start.x);
    const ay = f((finish.y - start.y) * 2);
    const az = f(finish.z - start.z);
    const livePX = actor.x - start.x;
    const livePY = (actor.y - start.y) * 2;
    const livePZ = actor.z - start.z;
    const px = f(livePX),
      py = f(livePY),
      pz = f(livePZ);
    const finishScore = mixedSquare(livePX - ax, livePY - ay, livePZ - az);
    if (finishScore < endpointScore) {
      endpointScore = f(finishScore);
      endpointSection = index;
      endpointNode = section.nodeIndices[1]; //4a818a: GLOBAL finish node.
    }
    const startScore = px * px + py * py + pz * pz;
    if (startScore < endpointScore) {
      endpointScore = f(startScore);
      endpointSection = index;
      endpointNode = section.nodeIndices[0]; //4a81d0: GLOBAL start node.
    }
    const lengthSquared = ax * ax + ay * ay + az * az;
    if (lengthSquared < f(0.0001)) continue;
    const t = f((px * ax + py * ay + pz * az) / lengthSquared);
    if (t < 0 || t > 1) continue;
    const score = mixedSquare(px - ax * t, py - ay * t, pz - az * t);
    if (score < projectionScore) {
      projectionScore = f(score);
      projectedSection = index;
      projectionT = t;
    }
  }
  const endpointWins = endpointScore < projectionScore;
  const selectedSection = endpointWins ? endpointSection : projectedSection;
  if (selectedSection < 0)
    throw new Error("Native nearest path candidate exceeds Float32 bounds");
  const { start, finish } = checkedSectionNodes(
    points,
    sections,
    selectedSection,
  );
  const dx = finish.x - start.x,
    dy = finish.y - start.y,
    dz = finish.z - start.z;
  const intersection = endpointWins
    ? points[endpointNode].clone()
    : new Vector3(
        f(start.x + dx * projectionT),
        f(start.y + f(dy * projectionT)),
        f(start.z + f(dz * projectionT)),
      );
  //4a8490–4a84d1 retains the unweighted delta and live length. Native
  // division by zero has undefined direction; explicitly return zero for a
  // degenerate authored section rather than exposing NaN to route callers.
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const inverse = length === 0 ? 0 : 1 / length;
  const direction = new Vector3(
    f(dx * inverse),
    f(dy * inverse),
    f(dz * inverse),
  );
  const distance = f(
    Math.sqrt(
      mixedSquare(
        actor.x - intersection.x,
        actor.y - intersection.y,
        actor.z - intersection.z,
      ),
    ),
  );
  if (
    !finiteVector(intersection) ||
    !finiteVector(direction) ||
    !Number.isFinite(distance)
  )
    throw new Error("Native nearest path result exceeds Float32 bounds");
  return { section: selectedSection, intersection, direction, distance };
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
