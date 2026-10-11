import { Box3, Matrix4, Quaternion, Vector3 } from "three";
import type { WorldCollision, Surface } from "../world";
import type { SimulatedCar } from "./simulation";
import type { RigidBody } from "./contact";
import {
  hullBounds,
  placementHullsOverlap,
  transformHull,
  type CollisionHull,
} from "./geometry";
import { SafeCarHistory } from "./recovery";
import { C2_WORLD_SCALE } from "./motion";

type SpawnWorld = Pick<
  WorldCollision,
  "raycast" | "wheelRaycast" | "querySurfaces"
>;
export interface StartPlacementOptions {
  /** Nearby search limit in model/world units, never physics metres. */
  searchRadius?: number;
  /** Vertical ground search around the authored race start. */
  groundRange?: number;
}
export interface StartPlacementResult {
  placed: boolean;
  attempts: number;
  moved: number;
  reason?: "no-supported-clear-pose";
}
const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);

function segmentInsideHull(hull: CollisionHull, start: Vector3, end: Vector3) {
  const direction = end.clone().sub(start);
  let enter = 0,
    exit = 1;
  for (const plane of hull.faces) {
    const distance = plane.normal.dot(start) - plane.constant + 1e-7;
    const speed = plane.normal.dot(direction);
    if (Math.abs(speed) < 1e-12) {
      if (distance >= 0) return false;
    } else {
      const fraction = -distance / speed;
      if (speed < 0) enter = Math.max(enter, fraction);
      else exit = Math.min(exit, fraction);
      if (enter >= exit) return false;
    }
  }
  return hull.faces.length > 0;
}

/** Independent static safety guard: triangle/convex-hull separating axes.
 * Tests finite authored faces, including a wall wholly inside a large hull.
 * Touching within numerical tolerance is permitted; crossing is not. */
export function startHullIntersectsSurface(hull: CollisionHull, face: Surface) {
  if (
    face.enabled === false ||
    face.collisionMode === "passthrough" ||
    /^[!>]/.test(face.material)
  )
    return false;
  const points = [face.a, face.b, face.c];
  if (face.collisionMode === "edges" || face.material.startsWith("?")) {
    return points.some(
      (point, i) =>
        !(face.faceFlags & (1 << i)) &&
        segmentInsideHull(hull, point, points[(i + 1) % 3]),
    );
  }
  const edges = [
    face.b.clone().sub(face.a),
    face.c.clone().sub(face.b),
    face.a.clone().sub(face.c),
  ];
  const axes = [face.normal, ...hull.faces.map((plane) => plane.normal)];
  for (const [a, b] of hull.edges) {
    const edge = hull.vertices[b].clone().sub(hull.vertices[a]);
    for (const triangleEdge of edges)
      axes.push(edge.clone().cross(triangleEdge));
  }
  for (const axis of axes) {
    if (axis.lengthSq() < 1e-16) continue;
    const normal = axis.clone().normalize();
    let hullMin = Infinity,
      hullMax = -Infinity;
    for (const vertex of hull.vertices) {
      const distance = normal.dot(vertex);
      hullMin = Math.min(hullMin, distance);
      hullMax = Math.max(hullMax, distance);
    }
    const distances = points.map((point) => normal.dot(point));
    if (
      hullMax <= Math.min(...distances) + 1e-7 ||
      Math.max(...distances) <= hullMin + 1e-7
    )
      return false;
  }
  return true;
}

function clearPose(
  hulls: CollisionHull[],
  world: SpawnWorld,
  reserved: CollisionHull[],
) {
  for (const hull of hulls) {
    const bounds = hullBounds(hull);
    if (
      reserved.some(
        (other) =>
          bounds
            .clone()
            .expandByScalar(0.005)
            .intersectsBox(hullBounds(other)) &&
          placementHullsOverlap(hull, other),
      )
    )
      return false;
    if (
      world
        .querySurfaces(bounds.min, bounds.max)
        .some((face) => startHullIntersectsSurface(hull, face))
    )
      return false;
  }
  return true;
}

function slopeOrientation(normal: Vector3, heading: number) {
  // Keep the horizontal heading exactly, even after adding pitch and roll.
  const z = new Vector3(Math.sin(heading), 0, Math.cos(heading));
  z.y = -(normal.x * z.x + normal.z * z.z) / normal.y;
  z.normalize();
  const x = normal.clone().cross(z).normalize();
  return new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(x, normal, z),
  );
}

function groundNearStart(
  world: SpawnWorld,
  x: number,
  z: number,
  y: number,
  range: number,
) {
  const origin = new Vector3(x, y + range, z);
  let best: ReturnType<SpawnWorld["raycast"]> = null;
  // A high probe alone can select an unrelated bridge or ceiling. Keep the
  // supporting layer nearest the authored start while retaining finite faces.
  for (let layer = 0; layer < 16 && origin.y > y - range; layer++) {
    const hit = world.raycast(origin, DOWN, origin.y - (y - range));
    if (!hit) break;
    if (
      !hit.body &&
      hit.normal.y >= 0.5 &&
      hit.surface.normal.y >= 0.5 &&
      (!best || Math.abs(hit.point.y - y) < Math.abs(best.point.y - y))
    )
      best = hit;
    origin.y = hit.point.y - 0.00001;
  }
  return best;
}

/** Initial race placement safety guard, independently implemented rather than
 * claiming native grid-search equivalence. C2 InitialiseCar2 (rec2 car.c,
 * annotated0x413f70; installed HW0x413f90) seeds oldd/last_safe_positions
 * after placing the car. WheelForces
 * anchors already include native ride height; adding render wheel radii or
 * render bounds would double-count it. All candidate checks use authored hulls.
 * Failure leaves the car unchanged so callers can report/omit an unsafe start. */
export function placeCarAtStart(
  car: SimulatedCar,
  world: SpawnWorld,
  reservedCars: readonly {
    hulls: CollisionHull[];
    state: Pick<RigidBody["state"], "position" | "orientation">;
  }[] = [],
  options: StartPlacementOptions = {},
): StartPlacementResult {
  const range = options.groundRange ?? 2;
  const radius = options.searchRadius ?? 2;
  if (!(range > 0) || !(radius >= 0) || !Number.isFinite(range + radius))
    throw new Error("Invalid initial placement search range");
  const initial = car.state.position.clone();
  const reserved = reservedCars
    .filter((other) => other !== car)
    .flatMap((other) =>
      other.hulls.map((hull) =>
        transformHull(hull, other.state.position, other.state.orientation),
      ),
    );
  const bounds = new Box3();
  for (const hull of car.hulls) bounds.union(hullBounds(hull));
  const size = bounds.getSize(new Vector3());
  const spacing = Math.max(0.1, Math.min(size.x, size.z) / 2);
  const offsets = [new Vector3()];
  for (let ring = 1; ring * spacing <= radius + 1e-7; ring++) {
    const count = Math.max(8, Math.ceil(2 * Math.PI * ring));
    for (let i = 0; i < count; i++) {
      const angle = car.state.heading + (2 * Math.PI * i) / count;
      offsets.push(
        new Vector3(
          Math.sin(angle) * ring * spacing,
          0,
          Math.cos(angle) * ring * spacing,
        ),
      );
    }
  }
  let attempts = 0;
  for (const offset of offsets) {
    attempts++;
    const position = initial.clone().add(offset);
    let normal = UP.clone();
    let orientation = slopeOrientation(normal, car.state.heading);
    let supported = true;
    // Resample rotated wheel contact XZ coordinates rather than projecting a
    // single center height onto an infinite plane at a ramp or track edge.
    for (let fit = 0; fit < 4; fit++) {
      const up = UP.clone().applyQuaternion(orientation);
      const candidates: Vector3[] = [];
      const normals: Vector3[] = [];
      for (let i = 0; i < 4; i++) {
        const axle = i >> 1;
        const compression = car.motion.suspensionBase.give[axle] * normal.y;
        const length = car.motion.suspensionLength[axle] - compression;
        const anchor = car.motion.wheelPositions[i]
          .clone()
          .multiplyScalar(1 / C2_WORLD_SCALE)
          .applyQuaternion(orientation);
        const contact = anchor
          .clone()
          .addScaledVector(up, -length / C2_WORLD_SCALE)
          .add(position);
        const hit = groundNearStart(
          world,
          contact.x,
          contact.z,
          initial.y,
          range,
        );
        if (!hit || hit.normal.y < 0.5 || hit.body) {
          supported = false;
          break;
        }
        candidates.push(
          hit.point
            .clone()
            .sub(anchor)
            .addScaledVector(up, length / C2_WORLD_SCALE),
        );
        normals.push(hit.normal);
      }
      if (!supported) break;
      normal = normals
        .reduce((sum, value) => sum.add(value), new Vector3())
        .normalize();
      if (normal.y < 0.5) {
        supported = false;
        break;
      }
      position.y =
        candidates.reduce((sum, value) => sum + value.y, 0) / candidates.length;
      orientation = slopeOrientation(normal, car.state.heading);
    }
    if (!supported) continue;
    const up = UP.clone().applyQuaternion(orientation);
    const lengths: number[] = [];
    for (let i = 0; i < 4; i++) {
      const start = car.motion.wheelPositions[i]
        .clone()
        .multiplyScalar(1 / C2_WORLD_SCALE)
        .applyQuaternion(orientation)
        .add(position);
      const hit = world.wheelRaycast(
        start,
        up.clone().negate(),
        (Math.max(...car.motion.suspensionLength) + 0.5) / C2_WORLD_SCALE,
      );
      const length = hit ? hit.distance * C2_WORLD_SCALE : Infinity;
      if (
        !hit ||
        hit.body ||
        length < -0.5 ||
        length >= car.motion.suspensionLength[i >> 1]
      ) {
        supported = false;
        break;
      }
      lengths.push(length);
    }
    if (!supported) continue;
    const hulls = car.hulls.map((hull) =>
      transformHull(hull, position, orientation),
    );
    if (!clearPose(hulls, world, reserved)) continue;
    car.state.position.copy(position);
    car.state.orientation.copy(orientation);
    car.state.velocity.set(0, 0, 0);
    car.state.angularVelocity.set(0, 0, 0);
    (car.state.predictedPosition ??= new Vector3()).copy(position);
    (car.state.predictedOrientation ??= new Quaternion()).copy(orientation);
    car.state.wheelLengths = lengths as SimulatedCar["state"]["wheelLengths"];
    car.state.groundedWheelCount = 4;
    car.state.speed = 0;
    car.crashRecord.resetDirection(orientation);
    car.recoveryHistory = new SafeCarHistory(car.state);
    car.worldRecovery = car.worldOverlapDetected = car.overlapDetected = false;
    car.poseEpoch++;
    return { placed: true, attempts, moved: initial.distanceTo(position) };
  }
  return {
    placed: false,
    attempts,
    moved: 0,
    reason: "no-supported-clear-pose",
  };
}
