import { Vector3 } from "three";
import type { TrackPathSection } from "../config";

const f = Math.fround;
const point = (v: Vector3) => new Vector3(f(v.x), f(v.y), f(v.z));
const mixedSquare = (x: number, y: number, z: number) =>
  x * f(x) + y * f(y) + z * z;

export interface NativeNearestTrailSection {
  section: number;
  sectionSlot: number;
  intersection: Vector3;
  distance: number;
}

/** Installed FindNearestGeneralSection4a8070 with a non-null target car.
 * Selection uses trail geometry; projection finalization deliberately uses
 * the original GLOBAL section's start node4a8438–48d. Endpoint selection
 * retains the native swapped trail-node indices4a8186/4a81cb. */
export function findNativeTrailSection(
  targetTrail: readonly Vector3[],
  position: Vector3,
  globalNodes: readonly Vector3[],
  globalSections: readonly TrackPathSection[],
): NativeNearestTrailSection {
  if (targetTrail.length < 2 || targetTrail.length > 25)
    throw new Error("Invalid native nearest-trail node count");
  const trail = targetTrail.map(point);
  const actor = point(position);
  if (![actor, ...trail].every((v) => v.toArray().every(Number.isFinite)))
    throw new Error("Invalid native nearest-trail geometry");
  let endpointScore = f(3.4028234663852886e38);
  let endpointNode = -1;
  let endpointSection = -1;
  let projectionScore = f(3.4028234663852886e38);
  let projectionSection = -1;
  let projectionT = 0;
  for (let slot = 0; slot + 1 < trail.length; slot++) {
    const start = trail[slot],
      finish = trail[slot + 1];
    //4a810d/133/145: all weighted section components are stored.
    const ax = f(finish.x - start.x);
    const ay = f((finish.y - start.y) * 2);
    const az = f(finish.z - start.z);
    const livePX = actor.x - start.x;
    const livePY = (actor.y - start.y) * 2;
    const livePZ = actor.z - start.z;
    const px = f(livePX),
      py = f(livePY),
      pz = f(livePZ);
    // Finish endpoint uses live relative components minus stored section.
    const finishScore = mixedSquare(livePX - ax, livePY - ay, livePZ - az);
    if (finishScore < endpointScore) {
      endpointScore = f(finishScore);
      endpointSection = slot;
      endpointNode = slot; // Native finish winner copies the START node.
    }
    const startScore = px * px + py * py + pz * pz;
    if (startScore < endpointScore) {
      endpointScore = f(startScore);
      endpointSection = slot;
      endpointNode = slot + 1; // Native start winner copies the FINISH node.
    }
    const lengthSquared = ax * ax + ay * ay + az * az;
    if (lengthSquared < f(0.0001)) continue;
    const t = f((px * ax + py * ay + pz * az) / lengthSquared);
    if (t < 0 || t > 1) continue;
    const score = mixedSquare(px - ax * t, py - ay * t, pz - az * t);
    if (score < projectionScore) {
      projectionScore = f(score);
      projectionSection = slot;
      projectionT = t;
    }
  }
  let sectionSlot: number;
  let intersection: Vector3;
  //4a82f6: endpoint wins only strictly below the stored projection score.
  if (endpointScore < projectionScore) {
    if (endpointNode < 0 || endpointSection < 0)
      throw new Error("Native nearest-trail endpoint exceeds Float32 bounds");
    sectionSlot = endpointSection;
    intersection = trail[endpointNode].clone();
  } else {
    if (projectionSection < 0)
      throw new Error("Native nearest-trail projection is unavailable");
    sectionSlot = projectionSection;
    const section = globalSections[sectionSlot];
    if (
      !section ||
      !section.nodeIndices.every(
        (i) => Number.isInteger(i) && i >= 0 && i < globalNodes.length,
      )
    )
      throw new Error(
        "Native trail projection requires valid original global section metadata",
      );
    const baseInput = globalNodes[section.nodeIndices[0]];
    if (!baseInput)
      throw new Error("Missing native trail projection global node");
    const base = point(baseInput);
    if (!base.toArray().every(Number.isFinite))
      throw new Error("Invalid native trail projection global node");
    const start = trail[sectionSlot],
      finish = trail[sectionSlot + 1];
    //4a841f/425 store Y/Z products; X remains live through base addition.
    intersection = new Vector3(
      f(base.x + (finish.x - start.x) * projectionT),
      f(base.y + f((finish.y - start.y) * projectionT)),
      f(base.z + f((finish.z - start.z) * projectionT)),
    );
  }
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
    !Number.isFinite(distance) ||
    !intersection.toArray().every(Number.isFinite)
  )
    throw new Error("Native nearest-trail result exceeds Float32 bounds");
  return { section: 15000 + sectionSlot, sectionSlot, intersection, distance };
}
