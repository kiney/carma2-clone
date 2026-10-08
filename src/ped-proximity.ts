import { Box3, Triangle, Vector3 } from "three";
import type { Surface } from "./world";
import type { PedSpawnSpec } from "./pedestrians";
import { pedFloorAllowed, pedObstacleIgnored } from "./ped-rules";

export interface PedProximity {
  distance: number;
  flags: number;
  position: Vector3;
  normal: Vector3;
  velocity: Vector3;
}
export const PED_SCAN_NONE = 10000;
export const PED_SCAN_MAX_DISTANCE = 20;
export const PED_FACE_CACHE_CAPACITY = 75;
export function emptyPedProximity(): PedProximity {
  return {
    distance: PED_SCAN_NONE,
    flags: 0,
    position: new Vector3(),
    normal: new Vector3(),
    velocity: new Vector3(),
  };
}
/** RecacheAndSetFace 0x4d1e20: the authored cache box is in character axes. */
export function pedFaceCacheBox(
  position: Vector3,
  direction: Vector3,
  up: Vector3,
  jumpHeight: number,
) {
  const forward = direction.clone().projectOnPlane(up).normalize(),
    right = up.clone().cross(forward).normalize(),
    local = new Box3(
      new Vector3(-3 / 6.9, -2.5 / 6.9 - jumpHeight, -2 / 6.9),
      new Vector3(3 / 6.9, 2.5 / 6.9 + jumpHeight, 10 / 6.9),
    );
  const world = new Box3();
  for (const x of [local.min.x, local.max.x])
    for (const y of [local.min.y, local.max.y])
      for (const z of [local.min.z, local.max.z])
        world.expandByPoint(
          position
            .clone()
            .addScaledVector(right, x)
            .addScaledVector(up, y)
            .addScaledVector(forward, z),
        );
  return { local, world, right, up, forward, position };
}
export function pedFaceInsideCache(
  face: Pick<Surface, "a" | "b" | "c">,
  cache: ReturnType<typeof pedFaceCacheBox>,
) {
  const local = (point: Vector3) => {
    const d = point.clone().sub(cache.position);
    return new Vector3(
      d.dot(cache.right),
      d.dot(cache.up),
      d.dot(cache.forward),
    );
  };
  return cache.local.intersectsTriangle(
    new Triangle(local(face.a), local(face.b), local(face.c)),
  );
}

/** Installed0x4d0520..0x4d08c1. All three native edge numerators reuse A/B's
 * determinant, and the resulting normal is(dx,0,-dz). Preserve these quirks. */
export function pedExcludedFaceIntersection(
  position: Vector3,
  direction: Vector3,
  face: Pick<Surface, "a" | "b" | "c">,
) {
  const points = [face.a, face.b, face.c],
    shared = face.a.x * face.b.z - face.b.x * face.a.z;
  const candidates = points.map((a, i) => {
    const b = points[(i + 1) % 3],
      dx = b.x - a.x,
      dz = b.z - a.z,
      denom = dz * direction.x - dx * direction.z;
    const raw =
      Math.abs(denom) > 0.0001
        ? (shared + position.z * dx - position.x * dz) / denom
        : Infinity;
    return {
      distance: raw < 0 ? Infinity : raw,
      normal: new Vector3(dx, 0, -dz),
    };
  });
  const [a, b, c] = candidates;
  // Strict comparisons mean even a first/second tie falls through to third.
  return a.distance < b.distance && a.distance < c.distance
    ? a
    : b.distance < a.distance && b.distance < c.distance
      ? b
      : c;
}

/** RescanPedProximity 0x4cf860: finite triangle vertex outcodes against the
 * forward/lateral projection planes, followed by native wall/floor selection. */
export function scanPedProximity(
  position: Vector3,
  direction: Vector3,
  floorPosition: Vector3,
  floorNormal: Vector3,
  boundsMaxX: number,
  maxSlopeDegrees: number,
  spec: PedSpawnSpec,
  running: boolean,
  faces: readonly Surface[],
  preserved?: PedProximity,
): PedProximity {
  const scan = preserved
    ? {
        ...preserved,
        flags: preserved.flags & 4,
        position: preserved.position.clone(),
        normal: preserved.normal.clone(),
        velocity: preserved.velocity.clone(),
      }
    : emptyPedProximity();
  scan.distance = PED_SCAN_NONE;
  const dir = direction.clone().normalize(),
    flat = new Vector3(dir.x, 0, dir.z).normalize(),
    lateral = floorNormal.clone().cross(dir).normalize(),
    width = boundsMaxX * 1.3,
    cosine = Math.cos((maxSlopeDegrees * Math.PI) / 180),
    alongD = dir.dot(position),
    lateralD = lateral.dot(position),
    floorD = floorNormal.dot(floorPosition);
  const anySide = (face: Surface, normal: Vector3, d: number) =>
    [face.a, face.b, face.c].some((v) => normal.dot(v) >= d);
  for (const face of faces) {
    const wall = face.normal.y <= cosine;
    if (
      wall
        ? pedObstacleIgnored(spec, face.material)
        : pedFloorAllowed(spec, face.material, running)
    )
      continue;
    let distance = PED_SCAN_MAX_DISTANCE;
    if (wall) {
      const denominator = face.normal.dot(dir);
      distance =
        Math.abs(denominator) >= 0.001
          ? (face.normal.dot(face.a) - face.normal.dot(position)) / denominator
          : PED_SCAN_MAX_DISTANCE;
      if (
        distance < 0 ||
        distance > PED_SCAN_MAX_DISTANCE ||
        distance > scan.distance
      )
        continue;
    }
    if (
      !anySide(face, dir, alongD) ||
      !anySide(face, lateral, lateralD - width) ||
      !anySide(face, lateral.clone().negate(), -lateralD - width)
    )
      continue;
    if (wall) {
      let normal = face.normal.clone(),
        flag: number;
      if (normal.dot(dir) <= 0 || !!(face.materialFlags & 0x1000)) {
        if (normal.dot(dir) > 0) normal.negate();
        if (!anySide(face, floorNormal, floorD)) continue;
        flag = 2;
      } else {
        if (
          !anySide(
            face,
            floorNormal.clone().negate(),
            -floorNormal.dot(position),
          )
        )
          continue;
        flag = 1;
      }
      scan.flags |= flag;
      scan.normal.copy(normal);
      scan.position.copy(position).addScaledVector(dir, distance);
    } else {
      const edge = pedExcludedFaceIntersection(position, flat, face);
      if (!(edge.distance < scan.distance)) continue;
      distance = edge.distance;
      scan.distance = distance;
      if (distance > PED_SCAN_MAX_DISTANCE) continue;
      scan.flags |= 8;
      scan.normal.copy(edge.normal).normalize();
      if (!scan.normal.lengthSq()) scan.normal.set(1, 0, 0);
      scan.position.copy(position).addScaledVector(flat, distance);
    }
    scan.distance = distance;
    scan.velocity.set(0, 0, 0);
  }
  return scan;
}

/** CheckForAvoidingAction: rescan opposite only if first still has flags;
 * select it only when its proximity distance is STRICTLY greater. */
export function selectPedAvoidanceDirection(
  first: Vector3,
  scan: (direction: Vector3) => PedProximity,
  tryOpposite = true,
) {
  const firstScan = scan(first);
  if (!firstScan.flags || !tryOpposite)
    return { direction: first, scan: firstScan };
  const second = first.clone().negate(),
    secondScan = scan(second);
  return secondScan.distance > firstScan.distance
    ? { direction: second, scan: secondScan }
    : { direction: first, scan: firstScan };
}
