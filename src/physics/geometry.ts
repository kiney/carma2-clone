import { Box3, Quaternion, Triangle, Vector3 } from "three";
import type { RigidBody } from "./contact";
import { recoverHull } from "./hull-recovery";
import {
  createEdgeFeatureIndex,
  getHullEdgeFeatureIndex,
  type EdgeFeatureIndex,
  type EdgeFeatureDiagnostics,
} from "./edge-feature-index";

export interface HullFace {
  normal: Vector3;
  constant: number;
  indices: number[];
}
export interface CollisionHull {
  /** Native shape tag retained by analytic BOX/WIRE constructors. Undefined
   * means a prepared polygon; never infer a BOX from polygon dimensions. */
  nativeType?: "BOX" | "WIRE" | "POLY" | "WIREPOLY";
  vertices: Vector3[];
  /** Compact source feature order, expressed as authored vertex indices. */
  vertexOrder?: number[];
  faces: HullFace[];
  edges: [number, number][];
  /** Undefined on successful native-order builds; retained for crash captures. */
  recoveredFrom?: "open-horizon";
  /** Solver/candidate transforms retain authored local planes for point CCD. */
  localHull?: CollisionHull;
  position?: Vector3;
  orientation?: Quaternion;
}
export interface HullContact {
  normal: Vector3;
  points: Vector3[];
  /** Independent old-frame torque points for body B in object-pair CCD. */
  pointsB?: Vector3[];
  penetration: number;
  fraction?: number;
  /** Original emitter's sortable measure, one value per point. */
  measures?: number[];
  pointNormals?: Vector3[];
  pointFractions?: number[];
  vertexIndices?: number[];
  /** Original emitter flags: world edge0, body vertex1, world vertex2, pair5. */
  contactTypes?: number[];
  faceFriction?: number;
  sourceSurface?: import("../world").Surface;
}
export interface WorldSurfaceOptions {
  /** Phase-owned transformed endpoints; acquired only for enabled edge tests. */
  getEdgeIndex?: () => EdgeFeatureIndex;
  edgeDiagnostics?: EdgeFeatureDiagnostics;
  materialIdentifier?: string;
  materialFlags?: number;
  /** BRender face bits1/2/4 suppress coplanar edges0/1/2 respectively. */
  faceFlags?: number;
  twoSided?: boolean;
  /** Gather all faces first, then call reduceWorldContacts once per shape. */
  deferReduction?: boolean;
  /** Original recovery marks endpoints unavailable to moving-vertex CCD. */
  suppressedVertices?: ReadonlySet<number>;
  /** Successful recovery replaces static-world-vertex and moving-edge CCD. */
  skipWorldEdges?: boolean;
  /** Prior object+ed disables world-vertex tests even without current recovery. */
  skipWorldVertices?: boolean;
  /** Browser guard certificate for world-space moving hull features only.
   * Static world vertices follow an inverse-frame path and remain enabled. */
  skipMovingHullFeatures?: boolean;
  sourceSurface?: import("../world").Surface;
  edgeOnly?: boolean;
}

export interface WorldRecoverySurface extends WorldSurfaceOptions {
  a: Vector3;
  b: Vector3;
  c: Vector3;
  faceFriction?: number;
}
export interface WorldRecoveryResult {
  contacts: HullContact[];
  suppressedVertices: Set<number>;
  /** Carry to the next frame's original object+ed recovery flag. */
  overlapDetected: boolean;
}
export interface PairSweepOptions {
  edgeDiagnostics?: EdgeFeatureDiagnostics;
  /** Lazily obtain certified OLD target-local vertices and inside flags.
   * Recovery may return before this data is needed; fraction guards stay live. */
  getOldGeometry?: () => PairOldGeometry;
  /** Original flag0x100 enables old-geometry overlap recovery. */
  recovery?: {
    a: RigidBody;
    b: RigidBody;
    sameAttachmentGroup?: boolean;
    boundsCenterA?: Vector3;
    boundsCenterB?: Vector3;
    /** Certified OLD geometry only; live velocity/attachment gates still run. */
    geometry?: HullRecoveryGeometry;
  };
  /** Original start-inside/recovery evidence sets flag0x200 for the next tick. */
  onOverlap?: () => void;
}
const EPS = 1e-7;
const SWEEP_EXTENSION = 0.0010434782598167658;
const worldTrianglePlanes = new WeakMap<
  NonNullable<WorldSurfaceOptions["sourceSurface"]>,
  { values: number[]; normal: Vector3; constant: number }
>();
/** Retain the exact existing cross-product arithmetic, rather than substituting
 * native prepared/F32 planes. Captured surfaces are immutable; value checks
 * also protect standalone providers that edit their vectors in place. */
function worldTrianglePlane(
  a: Vector3,
  b: Vector3,
  c: Vector3,
  source?: WorldSurfaceOptions["sourceSurface"],
) {
  const shared = source && source.a === a && source.b === b && source.c === c;
  const old = shared ? worldTrianglePlanes.get(source) : undefined;
  if (
    old &&
    a.x === old.values[0] &&
    a.y === old.values[1] &&
    a.z === old.values[2] &&
    b.x === old.values[3] &&
    b.y === old.values[4] &&
    b.z === old.values[5] &&
    c.x === old.values[6] &&
    c.y === old.values[7] &&
    c.z === old.values[8]
  )
    return old;
  const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  const value = {
    normal,
    constant: normal.dot(a),
    values: shared ? [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z] : [],
  };
  if (shared) worldTrianglePlanes.set(source, value);
  return value;
}

/** Independent finite segment/triangle ray equations for local0x422610 and
 *0x45f1c0. Rays choose the first nearest cached face and orient its normal
 * against their direction. These recovery rays have no sweep extension. */
function recoveryRay(
  start: Vector3,
  end: Vector3,
  surfaces: readonly WorldRecoverySurface[],
) {
  const direction = end.clone().sub(start);
  let best: {
    point: Vector3;
    normal: Vector3;
    fraction: number;
    surface: WorldRecoverySurface;
  } | null = null;
  for (const surface of surfaces) {
    if (surface.edgeOnly || /^[!>?]/.test(surface.materialIdentifier ?? ""))
      continue;
    const { a, b, c } = surface;
    const normal = worldTrianglePlane(
      a,
      b,
      c,
      surface.sourceSurface,
    ).normal.clone();
    if (!normal.lengthSq()) continue;
    const denominator = direction.dot(normal);
    const twoSided =
      surface.twoSided ??
      (surface.materialFlags === undefined ||
        (surface.materialFlags & 0x1800) !== 0);
    if (
      Math.abs(denominator) < 2.384185791015625e-7 ||
      (!twoSided && denominator > 0)
    )
      continue;
    const distance = start.clone().sub(a).dot(normal);
    if (denominator > 0) {
      if (distance > 0 || -distance > denominator + 0.003) continue;
    } else if (distance < 0 || distance > 0.003 - denominator) continue;
    const fraction = Math.fround(Math.min(1, -distance / denominator));
    if (best && fraction >= best.fraction) continue;
    const point = start.clone().addScaledVector(direction, fraction);
    const barycentric = new Triangle(a, b, c).getBarycoord(
      point,
      new Vector3(),
    );
    if (
      !barycentric ||
      barycentric.x < -0.0001 ||
      barycentric.y < -0.0001 ||
      barycentric.z < -0.0001
    )
      continue;
    if (denominator > 0) normal.negate();
    best = { point, normal, fraction, surface };
  }
  return best;
}

/** Original old-hull/world recovery0x4235f0. Invoke only when the prior frame
 * set object+ed. It selects edge ray intersections facing the old world COM,
 * suppresses the endpoint beyond that face, and emits only inward candidate
 * drift. Detection still suppresses later edge CCD even when drift is zero. */
export function recoverWorldContacts(
  old: CollisionHull,
  predicted: CollisionHull,
  surfaces: readonly WorldRecoverySurface[],
  centerOfMassWorld: Vector3,
): WorldRecoveryResult {
  const result: WorldRecoveryResult = {
    contacts: [],
    suppressedVertices: new Set(),
    overlapDetected: false,
  };
  if (
    !old.position ||
    !old.orientation ||
    !predicted.position ||
    !predicted.orientation
  )
    return result;
  const alignment = (hit: NonNullable<ReturnType<typeof recoveryRay>>) => {
    const inward = centerOfMassWorld.clone().sub(hit.point);
    if (inward.length() <= 2.384185791015625e-7) inward.set(1, 0, 0);
    else inward.normalize();
    return Math.fround(inward.dot(hit.normal));
  };
  for (const [a, b] of old.edges) {
    const forward = recoveryRay(old.vertices[a], old.vertices[b], surfaces);
    const reverse = recoveryRay(old.vertices[b], old.vertices[a], surfaces);
    let selected: NonNullable<typeof forward>, suppressed: number;
    if (!forward) {
      if (!reverse || alignment(reverse) < 0.009999999776482582) continue;
      selected = reverse;
      suppressed = a;
    } else if (!reverse) {
      if (alignment(forward) <= 0.009999999776482582) continue;
      selected = forward;
      suppressed = b;
    } else {
      const first = alignment(forward),
        second = alignment(reverse);
      if (first < 0.05000000074505806 && second < 0.05000000074505806) continue;
      if (second <= first) {
        selected = forward;
        suppressed = b;
      } else {
        selected = reverse;
        suppressed = a;
      }
    }
    result.suppressedVertices.add(suppressed);
    result.overlapDetected = true;
    const localPoint = selected.point
      .clone()
      .sub(old.position)
      .applyQuaternion(old.orientation.clone().conjugate());
    const candidatePoint = localPoint
      .applyQuaternion(predicted.orientation)
      .add(predicted.position);
    const drift = Math.fround(
      selected.point.clone().sub(candidatePoint).dot(selected.normal),
    );
    if (drift <= 0) continue;
    result.contacts.push({
      normal: selected.normal,
      points: [selected.point],
      penetration: 0,
      fraction: 0,
      measures: [0],
      contactTypes: [1],
      faceFriction: selected.surface.faceFriction,
      sourceSurface: selected.surface.sourceSurface,
    });
  }
  return result;
}

/** Browser trajectory guard only: recognize a shallow EXISTING finite-face
 * intersection before treating a two-sided underside exit as a new collision.
 * Use the source recovery rays/suppression, not a push or alternate impulse.
 * Native worldContacts and its prior-tick flags must remain unchanged.
 * The .003 bound is the source emitter's endpoint slack, in world units. */
export function recoverShallowWorldContacts(
  old: CollisionHull,
  predicted: CollisionHull,
  surface: WorldRecoverySurface,
  centerOfMassWorld: Vector3,
): WorldRecoveryResult | undefined {
  if (!old.faces.length) return;
  const normal = surface.b
    .clone()
    .sub(surface.a)
    .cross(surface.c.clone().sub(surface.a))
    .normalize();
  const side = normal.dot(centerOfMassWorld.clone().sub(surface.a));
  if (Math.abs(side) < EPS) return;
  if (side < 0) normal.negate();
  let minimum = Infinity;
  for (const index of old.vertexOrder ?? old.vertices.map((_, i) => i))
    minimum = Math.min(
      minimum,
      normal.dot(old.vertices[index].clone().sub(surface.a)),
    );
  if (minimum >= -EPS || minimum < -0.003 - EPS) return;
  const result = recoverWorldContacts(
    old,
    predicted,
    [surface],
    centerOfMassWorld,
  );
  return result.overlapDetected ? result : undefined;
}

/** Browser commit guard only. World-space vertex secants and their interpolated
 * edges remain in a common closed halfspace when both endpoint hulls do.
 * This certifies only moving hull features, never inverse-frame world-vertex
 * sweeps or a complete rotating path. Apply separately per angular sample. */
export function worldFaceSeparatesHullSweep(
  old: CollisionHull,
  predicted: CollisionHull,
  surface: WorldRecoverySurface,
): boolean {
  if (!old.faces.length || surface.edgeOnly) return false;
  const { normal, constant } = worldTrianglePlane(
    surface.a,
    surface.b,
    surface.c,
    surface.sourceSurface,
  );
  if (!normal.lengthSq()) return false;
  let above = true,
    below = true;
  for (const hull of [old, predicted])
    for (const vertex of hull.vertices) {
      const distance = normal.dot(vertex) - constant;
      above &&= distance >= -EPS;
      below &&= distance <= EPS;
      if (!above && !below) return false;
    }
  return above || below;
}

/** Original per-shape world emitter deduplication and four-contact limit.
 * Feed all triangle candidates for ONE authored collision shape together. */
export function reduceWorldContacts(contacts: HullContact[]): HullContact[] {
  const candidates: HullContact[] = [];
  const vertexCandidates = new Map<number, number>();
  for (const contact of contacts) {
    for (let i = 0; i < contact.points.length; i++) {
      const normal = contact.pointNormals?.[i] ?? contact.normal;
      const fraction = contact.pointFractions?.[i] ?? contact.fraction;
      const vertex = contact.vertexIndices?.[i];
      const candidate: HullContact = {
        ...contact,
        normal,
        fraction,
        points: [contact.points[i]],
        pointsB: contact.pointsB ? [contact.pointsB[i]] : undefined,
        pointNormals: [normal],
        measures: [contact.measures?.[i] ?? 0],
        pointFractions: fraction === undefined ? undefined : [fraction],
        contactTypes: contact.contactTypes
          ? [contact.contactTypes[i]]
          : undefined,
        vertexIndices:
          vertex === undefined || vertex < 0 ? undefined : [vertex],
      };
      const previous =
        vertex === undefined || vertex < 0
          ? undefined
          : vertexCandidates.get(vertex);
      if (previous !== undefined) {
        if (
          (fraction ?? Infinity) < (candidates[previous].fraction ?? Infinity)
        )
          candidates[previous] = candidate;
      } else {
        if (vertex !== undefined && vertex >= 0)
          vertexCandidates.set(vertex, candidates.length);
        candidates.push(candidate);
      }
    }
  }
  const selected: HullContact[] = [];
  for (const contact of candidates) {
    for (let i = 0; i < contact.points.length; i++) {
      const point = contact.points[i];
      const normal = contact.pointNormals?.[i] ?? contact.normal;
      if (
        selected.some((existing) => {
          const distance = point.distanceToSquared(existing.points[0]);
          const alignment = normal.dot(existing.normal);
          return (
            distance < 0.0045 &&
            (alignment < -0.95 || (alignment > 0.95 && distance < 0.0005))
          );
        })
      )
        continue;
      const measure = contact.measures?.[i] ?? 0;
      selected.push({
        ...contact,
        normal,
        points: [point],
        measures: [measure],
        pointNormals: [normal],
      });
      selected.sort((a, b) => a.measures![0] - b.measures![0]);
      if (selected.length > 4) selected.pop();
    }
  }
  return selected;
}

/** Final object/world selection at local HW0x422800. The linked authored
 * shapes share one sorted four-row list. A later normal at dot<=.95 ends
 * the retained prefix; it is not merely omitted while later rows survive.
 * Input vertex IDs have already served their per-shape earliest-face pass. */
export function finalizeWorldContacts(contacts: HullContact[]): HullContact[] {
  const selected = reduceWorldContacts(
    contacts.map((contact) => ({ ...contact, vertexIndices: undefined })),
  );
  if (!selected.length) return selected;
  const stop = selected.findIndex(
    (contact, index) =>
      index > 0 && contact.normal.dot(selected[0].normal) <= 0.95,
  );
  return stop < 0 ? selected : selected.slice(0, stop);
}

/** Local0x428fc0 placement mode sets0x677cd8, making the candidate transform
 * equal to the solver transform and every old vertex equal to the world COM.
 * It therefore raycasts a COM-to-authored-vertex star, rather than inventing
 * penetration distances or forcing the ordinary recovery drift positive. */
export function worldPlacementContacts(
  hulls: readonly CollisionHull[],
  surfaces: readonly WorldRecoverySurface[],
  centerOfMassWorld: Vector3,
): HullContact[] {
  const contacts: HullContact[] = [];
  for (const hull of hulls) {
    const collapsed = {
      ...hull,
      vertices: hull.vertices.map(() => centerOfMassWorld.clone()),
    };
    const candidates: HullContact[] = [];
    for (const surface of surfaces) {
      const contact = sweepHullTriangle(
        collapsed,
        hull,
        surface.a,
        surface.b,
        surface.c,
        {
          ...surface,
          suppressedVertices: undefined,
          skipWorldEdges: true,
          skipWorldVertices: true,
          deferReduction: true,
        },
      );
      if (contact)
        candidates.push({ ...contact, faceFriction: surface.faceFriction });
    }
    contacts.push(...reduceWorldContacts(candidates));
  }
  return finalizeWorldContacts(contacts);
}

/** Placement0x428fc0 returns the sole normal, otherwise the normalized sum.
 * Its degenerate fallback is solver-local X, then transformed to world. */
export function worldPlacementDirection(
  contacts: readonly HullContact[],
  solverOrientation = new Quaternion(),
): Vector3 | null {
  const normals = contacts.flatMap((contact) =>
    contact.points.map(
      (_, index) => contact.pointNormals?.[index] ?? contact.normal,
    ),
  );
  if (!normals.length) return null;
  if (normals.length === 1) return normals[0].clone();
  const sum = normals.reduce(
    (value, normal) => value.add(normal),
    new Vector3(),
  );
  return sum.length() <= 2.384185791015625e-7
    ? sum.set(1, 0, 0).applyQuaternion(solverOrientation)
    : sum.normalize();
}

/** Source0x428d10 tests authored edges against the other shape in both
 * directions. Box bounds and polyhedron planes are EXPANDED by float .005;
 * touching and smaller gaps are overlaps for the placement retry probe. */
export function placementHullsOverlap(
  a: CollisionHull,
  b: CollisionHull,
): boolean {
  const tolerance = 0.004999999888241291;
  const directed = (moving: CollisionHull, target: CollisionHull) => {
    const local = target.localHull && target.position && target.orientation;
    const planes = local ? target.localHull!.faces : target.faces;
    if (!planes.length) return false; // Native point-vs-wire has no interior.
    const vertices = moving.vertices.map((point) => {
      const value = point.clone();
      if (local)
        value
          .sub(target.position!)
          .applyQuaternion(target.orientation!.clone().conjugate());
      return value.set(
        Math.fround(value.x),
        Math.fround(value.y),
        Math.fround(value.z),
      );
    });
    for (const [first, second] of moving.edges) {
      const start = vertices[first],
        direction = vertices[second].clone().sub(start);
      let enter = 0,
        exit = 1,
        valid = true;
      for (const face of planes) {
        const distance = Math.fround(
          face.normal.dot(start) - face.constant - tolerance,
        );
        const speed = Math.fround(face.normal.dot(direction));
        if (speed === 0) {
          if (distance > 0) {
            valid = false;
            break;
          }
        } else {
          const fraction = Math.fround(-distance / speed);
          if (speed < 0) enter = Math.max(enter, fraction);
          else exit = Math.min(exit, fraction);
          if (enter > exit) {
            valid = false;
            break;
          }
        }
      }
      if (valid && enter <= 1 && exit >= 0) return true;
    }
    return false;
  };
  return directed(a, b) || directed(b, a);
}

/** Independently derived quadratic moving-edge CCD, verified against local
 * 0x4248e0. The torque point uses the old edge at the intersection parameter. */
export function sweepMovingEdges(
  staticStart: Vector3,
  staticEnd: Vector3,
  oldStart: Vector3,
  oldEnd: Vector3,
  newStart: Vector3,
  newEnd: Vector3,
): HullContact | null {
  // Scalar storage preserves Vector3's subtraction/cross/dot operation order
  // while avoiding temporary vectors for every rejected authored edge pair.
  const ex = staticEnd.x - staticStart.x,
    ey = staticEnd.y - staticStart.y,
    ez = staticEnd.z - staticStart.z;
  const ox = oldEnd.x - oldStart.x,
    oy = oldEnd.y - oldStart.y,
    oz = oldEnd.z - oldStart.z;
  const mx = newStart.x - oldStart.x,
    my = newStart.y - oldStart.y,
    mz = newStart.z - oldStart.z;
  const dx = newEnd.x - newStart.x - ox,
    dy = newEnd.y - newStart.y - oy,
    dz = newEnd.z - newStart.z - oz;
  const rx = oldStart.x - staticStart.x,
    ry = oldStart.y - staticStart.y,
    rz = oldStart.z - staticStart.z;
  const n0x = ey * oz - ez * oy,
    n0y = ez * ox - ex * oz,
    n0z = ex * oy - ey * ox;
  const ndx = ey * dz - ez * dy,
    ndy = ez * dx - ex * dz,
    ndz = ex * dy - ey * dx;
  const a = mx * ndx + my * ndy + mz * ndz;
  const b = rx * ndx + ry * ndy + rz * ndz + (mx * n0x + my * n0y + mz * n0z);
  const c = rx * n0x + ry * n0y + rz * n0z;
  let root0 = 0,
    root1 = 0,
    rootCount = 0;
  const coefficientScale = Math.max(
    Math.abs(a),
    Math.abs(b),
    Math.abs(c),
    1e-30,
  );
  if (Math.abs(a) <= 1e-12 * coefficientScale) {
    if (Math.abs(b) > 1e-12 * coefficientScale) {
      root0 = -c / b;
      rootCount = 1;
    }
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      // Stable quadratic roots, with the zero-q double root handled separately.
      const q = -0.5 * (b + (b >= 0 ? root : -root));
      if (q === 0) {
        root0 = -b / (2 * a);
        rootCount = 1;
      } else {
        root0 = q / a;
        root1 = c / q;
        rootCount = 2;
        // Stable two-element sort with the original subtraction comparator.
        // Equal/signed-zero/NaN comparisons retain their authored root order.
        if (root1 - root0 < 0) {
          const first = root0;
          root0 = root1;
          root1 = first;
        }
      }
    }
  }
  for (let rootIndex = 0; rootIndex < rootCount; rootIndex++) {
    const fraction = rootIndex === 0 ? root0 : root1;
    if (fraction < 0 || fraction > 1) continue;
    const cx = ox + dx * fraction,
      cy = oy + dy * fraction,
      cz = oz + dz * fraction;
    const nx = ey * cz - ez * cy,
      ny = ez * cx - ex * cz,
      nz = ex * cy - ey * cx;
    const normalSquared = nx * nx + ny * ny + nz * nz;
    if (normalSquared < 1e-7) continue;
    const fx = rx + mx * fraction,
      fy = ry + my * fraction,
      fz = rz + mz * fraction;
    const staticParameter =
      ((fy * cz - fz * cy) * nx +
        (fz * cx - fx * cz) * ny +
        (fx * cy - fy * cx) * nz) /
      normalSquared;
    const movingParameter =
      ((fy * ez - fz * ey) * nx +
        (fz * ex - fx * ez) * ny +
        (fx * ey - fy * ex) * nz) /
      normalSquared;
    if (
      staticParameter < 0 ||
      staticParameter > 1 ||
      movingParameter < 0 ||
      movingParameter > 1
    )
      continue;
    const normal = new Vector3(nx, ny, nz);
    normal.normalize().multiplyScalar(c < 0 ? -1 : 1);
    return {
      normal,
      points: [
        new Vector3(
          oldStart.x + ox * movingParameter,
          oldStart.y + oy * movingParameter,
          oldStart.z + oz * movingParameter,
        ),
      ],
      pointsB: [
        new Vector3(
          staticStart.x + ex * staticParameter,
          staticStart.y + ey * staticParameter,
          staticStart.z + ez * staticParameter,
        ),
      ],
      contactTypes: [0],
      penetration: 0,
      fraction: Math.fround(fraction),
      measures: [Math.fround(fraction)],
    };
  }
  return null;
}

interface IncrementalPlane {
  inward: Vector3;
  offset: number;
}
interface IncrementalEdge {
  a: number;
  b: number;
  planes: IncrementalPlane[];
}
const HULL_PLANE_TOLERANCE = 9.999999974752427e-7;
function storedVector(value: Vector3): Vector3 {
  return value.set(
    Math.fround(value.x),
    Math.fround(value.y),
    Math.fround(value.z),
  );
}
function hullPlane(a: Vector3, b: Vector3, c: Vector3): IncrementalPlane {
  const inward = storedVector(b.clone().sub(a).cross(c.clone().sub(a)));
  if (inward.length() <= 2.384185791015625e-7) inward.set(1, 0, 0);
  else storedVector(inward.normalize());
  return { inward, offset: Math.fround(-inward.dot(a)) };
}
function growthHullPlane(
  a: Vector3,
  point: Vector3,
  b: Vector3,
): IncrementalPlane {
  // Local0x421940..0x421a30 stores the point differences and selected edge
  // differences as float32. Its final cross component remains in x87 while
  // normalization multiplies it by the stored component. Those observable
  // spill points decide nearly-coplanar horizon topology on stock dondump.
  const u = storedVector(point.clone().sub(a));
  const vx = b.x - a.x,
    vy = b.y - a.y,
    vz = b.z - a.z;
  const z = u.x * vy - u.y * vx;
  const inward = storedVector(
    new Vector3(
      u.y * vz - u.z * vy,
      u.z * Math.fround(vx) - u.x * Math.fround(vz),
      z,
    ),
  );
  const length = Math.sqrt(inward.x ** 2 + inward.y ** 2 + z * inward.z);
  if (length <= 2.384185791015625e-7) inward.set(1, 0, 0);
  else storedVector(inward.multiplyScalar(1 / length));
  return { inward, offset: Math.fround(-inward.dot(point)) };
}
function planeValue(plane: IncrementalPlane, point: Vector3): number {
  return plane.inward.dot(point) + plane.offset;
}
function reversePlane(plane: IncrementalPlane): void {
  plane.inward.negate();
  plane.offset = -plane.offset;
}
function planeSide(plane: IncrementalPlane, point: Vector3): number {
  const value = planeValue(plane, point);
  return value < -HULL_PLANE_TOLERANCE
    ? -1
    : value >= HULL_PLANE_TOLERANCE
      ? 1
      : 0;
}

/** Independent incremental convex hull with C2's observable feature order:
 * first consecutive noncollinear triple, first off-plane point, authored-order
 * insertions, stable horizon edges and stable removal of unused vertices.
 * Authored storage remains unchanged; feature indices exclude interior points.
 * Local HW0x420fd0/0x421210/0x4217b0, with stored float32 plane coefficients. */
function buildHullIncremental(points: readonly Vector3[]): CollisionHull {
  if (
    points.length < 4 ||
    points.length > 1024 ||
    points.some((point) => !point.toArray().every(Number.isFinite))
  )
    throw new Error("Invalid collision hull vertices");
  const vertices = points.map((point) => point.clone());
  const geometry = vertices.map((point) => storedVector(point.clone()));
  if (geometry.some((point) => !point.toArray().every(Number.isFinite)))
    throw new Error("Invalid collision hull vertices");
  let seed = 0;
  while (seed <= geometry.length - 3) {
    const cross = geometry[seed + 1]
      .clone()
      .sub(geometry[seed])
      .cross(geometry[seed + 2].clone().sub(geometry[seed]));
    if (
      cross.toArray().some((value) => Math.abs(value) >= HULL_PLANE_TOLERANCE)
    )
      break;
    seed++;
  }
  if (seed > geometry.length - 3) throw new Error("Degenerate collision hull");
  const order = [seed, seed + 1, seed + 2];
  const base = hullPlane(
    ...(order.map((index) => geometry[index]) as [Vector3, Vector3, Vector3]),
  );
  const fourth = geometry.findIndex(
    (point) => Math.abs(planeValue(base, point)) > HULL_PLANE_TOLERANCE,
  );
  if (fourth < 0) throw new Error("Degenerate collision hull");
  order.push(fourth);
  if (planeValue(base, geometry[fourth]) < HULL_PLANE_TOLERANCE)
    reversePlane(base);
  let planes = [base];
  for (let i = 0; i < 3; i++) {
    const next = (i + 1) % 3;
    const plane = hullPlane(
      geometry[order[i]],
      geometry[fourth],
      geometry[order[next]],
    );
    plane.offset = Math.fround(-plane.inward.dot(geometry[fourth]));
    if (planeValue(plane, geometry[order[(i + 2) % 3]]) < HULL_PLANE_TOLERANCE)
      reversePlane(plane);
    planes.push(plane);
  }
  let edges: IncrementalEdge[] = [
    { a: order[0], b: order[1], planes: [planes[0], planes[1]] },
    { a: order[1], b: order[2], planes: [planes[0], planes[2]] },
    { a: order[0], b: order[2], planes: [planes[0], planes[3]] },
    ...[0, 1, 2].map((i) => ({
      a: order[i],
      b: fourth,
      planes: [planes[i + 1], planes[1 + ((i + 2) % 3)]],
    })),
  ];
  for (let vertex = 0; vertex < geometry.length; vertex++) {
    const point = geometry[vertex];
    if (edges.some((edge) => edge.planes.length < 2))
      throw new Error("Degenerate collision hull horizon");
    const sides = new Map(
      planes.map((plane) => [plane, planeSide(plane, point)]),
    );
    if (![...sides.values()].includes(-1)) continue;
    const additions: IncrementalPlane[] = [];
    const radial = new Map<number, IncrementalEdge>();
    const survivors: IncrementalEdge[] = [];
    const radialEdge = (endpoint: number, plane: IncrementalPlane) => {
      const existing = radial.get(endpoint);
      if (existing) existing.planes[1] = plane;
      else radial.set(endpoint, { a: endpoint, b: vertex, planes: [plane] });
    };
    for (const edge of edges) {
      const [left, right] = edge.planes;
      const sideLeft = sides.get(left)!,
        sideRight = sides.get(right)!;
      if (sideLeft < 0 !== sideRight < 0) {
        let boundary: IncrementalPlane;
        if (sideLeft === 0 || sideRight === 0) {
          boundary = sideLeft === 0 ? left : right;
        } else {
          boundary = growthHullPlane(geometry[edge.a], point, geometry[edge.b]);
          // Choose the inward new-plane orientation from the two old planes.
          // This is the projection of the other plane normal into the first
          // plane's tangent space; it gives the same interior half-space.
          const orientation =
            left.inward.lengthSq() * boundary.inward.dot(right.inward) -
            left.inward.dot(right.inward) * boundary.inward.dot(left.inward);
          if (orientation < 0) reversePlane(boundary);
          boundary.offset = Math.fround(-boundary.inward.dot(point));
          additions.push(boundary);
          edge.planes = sideLeft > 0 ? [left, boundary] : [boundary, right];
        }
        radialEdge(edge.a, boundary);
        radialEdge(edge.b, boundary);
      }
      if (sideLeft > 0 || sideRight > 0) survivors.push(edge);
    }
    edges = [...survivors, ...radial.values()];
    planes = [
      ...planes.filter((plane) => sides.get(plane)! >= 0),
      ...additions,
    ];
    order.push(vertex);
  }
  // An open horizon on the final insertion has no following iteration to
  // detect it. It must not escape as a silently incomplete collision surface.
  if (edges.some((edge) => edge.planes.length < 2))
    throw new Error("Degenerate collision hull horizon");
  const used = new Set(edges.flatMap((edge) => [edge.a, edge.b]));
  const vertexOrder = order.filter((index) => used.has(index));
  const faces = planes.map((plane) => {
    let boundary = edges.filter((edge) => edge.planes.includes(plane));
    // Original hulls can retain coplanar edges branching off a face boundary
    // (native0x420fd0 does so after bending). Keep those CCD features globally;
    // only the auxiliary clipping polygon needs the closed boundary cycle.
    for (;;) {
      const degree = new Map<number, number>();
      for (const edge of boundary)
        for (const vertex of [edge.a, edge.b])
          degree.set(vertex, (degree.get(vertex) ?? 0) + 1);
      const cycle = boundary.filter(
        (edge) => degree.get(edge.a)! > 1 && degree.get(edge.b)! > 1,
      );
      if (cycle.length === boundary.length) break;
      boundary = cycle;
    }
    const indices: number[] = [];
    if (boundary.length) {
      indices.push(boundary[0].a, boundary[0].b);
      const remaining = boundary.slice(1);
      while (remaining.length) {
        const end = indices[indices.length - 1];
        const index = remaining.findIndex(
          (edge) => edge.a === end || edge.b === end,
        );
        if (index < 0) throw new Error("Invalid collision hull boundary");
        const edge = remaining.splice(index, 1)[0];
        const next = edge.a === end ? edge.b : edge.a;
        if (next !== indices[0]) indices.push(next);
      }
    }
    const normal = plane.inward.clone().negate();
    // Render-independent face clipping expects winding with the outward normal.
    // A retained source plane can have no closed feature cycle, notably a
    // near-duplicate plane after bending. Its half-space still participates
    // in original vertex/plane CCD; an auxiliary polygon is optional.
    if (indices.length >= 3) {
      const winding = vertices[indices[1]]
        .clone()
        .sub(vertices[indices[0]])
        .cross(vertices[indices[2]].clone().sub(vertices[indices[1]]));
      if (winding.dot(normal) < 0) indices.reverse();
    }
    return { normal, constant: plane.offset, indices };
  });
  return {
    vertices,
    vertexOrder,
    faces,
    edges: edges.map((edge) => [edge.a, edge.b]),
  };
}

export function buildHull(points: readonly Vector3[]): CollisionHull {
  try {
    return buildHullIncremental(points);
  } catch (error) {
    if (!recoverableHullError(error)) throw error;
    // Preserve the existing native-order exact-collinear retry first. A
    // near-coplanar crush can also break incidence without any collinear
    // interior point; only that undefined topology uses actual-point recovery.
    if (points.length <= 64) {
      try {
        return buildCollinearHull(points, error);
      } catch (retryError) {
        if (!recoverableHullError(retryError)) throw retryError;
      }
    }
    return recoverHull(points, HULL_PLANE_TOLERANCE);
  }
}

function recoverableHullError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error.message === "Degenerate collision hull horizon" ||
      error.message === "Invalid collision hull boundary")
  );
}

function buildCollinearHull(
  points: readonly Vector3[],
  error: Error,
): CollisionHull {
  // Original AddPoint4217b0 can leave a horizon's second plane unwritten
  // after inserting redundant collinear edge vertices. The installed native
  // hull accepts both stock monorails. Repair this undefined incidence only;
  // successful native-order car hulls retain their full original path.
  // Classify the same stored geometry used by the primary builder. Crush
  // coordinates can retain double precision between source float stores;
  // raw-double collinearity must not distinguish identical native inputs.
  const geometry = points.map((point) => storedVector(point.clone()));
  const retained = geometry.flatMap((point, index) => {
    for (let a = 0; a < geometry.length; a++) {
      if (a === index) continue;
      const offset = point.clone().sub(geometry[a]);
      for (let b = a + 1; b < geometry.length; b++) {
        if (b === index) continue;
        const segment = geometry[b].clone().sub(geometry[a]);
        const projection = offset.dot(segment);
        if (
          projection > 0 &&
          projection < segment.lengthSq() &&
          offset.clone().cross(segment).lengthSq() === 0
        )
          return [];
      }
    }
    return [index];
  });
  if (retained.length === points.length || retained.length < 4) throw error;
  const hull = buildHullIncremental(retained.map((index) => points[index]));
  if (
    hull.faces.some((face) =>
      points.some(
        (point) =>
          face.normal.dot(point) - face.constant > HULL_PLANE_TOLERANCE,
      ),
    )
  )
    throw error;
  // Preserve authored IDs for crush/actor references and exact source bounds.
  return {
    vertices: points.map((point) => point.clone()),
    vertexOrder: hull.vertexOrder!.map((index) => retained[index]),
    faces: hull.faces.map((face) => ({
      ...face,
      indices: face.indices.map((index) => retained[index]),
    })),
    edges: hull.edges.map(([a, b]) => [retained[a], retained[b]]),
  };
}
export function transformHull(
  hull: CollisionHull,
  position: Vector3,
  orientation: Quaternion,
): CollisionHull {
  const vertices = hull.vertices.map((p) =>
    p.clone().applyQuaternion(orientation).add(position),
  );
  return {
    vertices,
    vertexOrder: hull.vertexOrder,
    edges: hull.edges,
    localHull: hull,
    position: position.clone(),
    orientation: orientation.clone(),
    faces: hull.faces.map((f) => {
      const normal = f.normal.clone().applyQuaternion(orientation);
      return {
        normal,
        constant: f.constant + normal.dot(position),
        indices: f.indices,
      };
    }),
  };
}
export function hullBounds(hull: CollisionHull): Box3 {
  return hullsBounds([hull]);
}
/** Source shape/cache bounds use compact collision points, not preserved
 * authored storage. Useful for aggregate body bounds and recovery centers. */
export function hullsBounds(hulls: readonly CollisionHull[]): Box3 {
  const bounds = new Box3();
  for (const hull of hulls) {
    if (hull.vertexOrder) {
      for (const index of hull.vertexOrder)
        bounds.expandByPoint(hull.vertices[index]);
    } else {
      for (const point of hull.vertices) bounds.expandByPoint(point);
    }
  }
  return bounds;
}
function projection(
  points: readonly Vector3[],
  axis: Vector3,
  vertexOrder?: readonly number[],
): [number, number] {
  let lo = Infinity,
    hi = -Infinity;
  const count = vertexOrder?.length ?? points.length;
  for (let i = 0; i < count; i++) {
    const p = points[vertexOrder ? vertexOrder[i] : i];
    const d = p.dot(axis);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [lo, hi];
}
function unique(points: Vector3[], max = 4): Vector3[] {
  const result: Vector3[] = [];
  for (const p of points)
    if (!result.some((q) => p.distanceToSquared(q) < 1e-10)) result.push(p);
  // Keep spatially spread manifold samples; arbitrary first vertices bias torque.
  if (result.length <= max) return result;
  const selected = [result[0]];
  while (selected.length < max) {
    let best: Vector3 | undefined,
      dist = -1;
    for (const p of result) {
      const d = Math.min(...selected.map((q) => p.distanceToSquared(q)));
      if (d > dist) {
        dist = d;
        best = p;
      }
    }
    selected.push(best!);
  }
  return selected;
}
function clip(
  polygon: Vector3[],
  normal: Vector3,
  constant: number,
): Vector3[] {
  const out: Vector3[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      da = a.dot(normal) - constant,
      db = b.dot(normal) - constant;
    if (da <= EPS) out.push(a.clone());
    if (da < 0 !== db < 0) {
      const t = da / (da - db);
      out.push(a.clone().lerp(b, t));
    }
  }
  return out;
}
function facePolygon(hull: CollisionHull, direction: Vector3): Vector3[] {
  let face = hull.faces[0];
  for (const f of hull.faces)
    if (f.normal.dot(direction) > face.normal.dot(direction)) face = f;
  return face.indices.map((i) => hull.vertices[i].clone());
}
function manifold(
  a: CollisionHull,
  b: CollisionHull,
  normal: Vector3,
): Vector3[] {
  const pa = facePolygon(a, normal.clone().negate()),
    pb = facePolygon(b, normal);
  const constant =
    (projection(a.vertices, normal, a.vertexOrder)[0] +
      projection(b.vertices, normal, b.vertexOrder)[1]) *
    0.5;
  const project = (p: Vector3) =>
    p.addScaledVector(normal, constant - p.dot(normal));
  pa.forEach(project);
  pb.forEach(project);
  let result = pb;
  // pa winding is opposite normal; outward side plane is normal cross edge.
  for (let i = 0; i < pa.length && result.length; i++) {
    const edge = pa[(i + 1) % pa.length].clone().sub(pa[i]);
    const out = normal.clone().cross(edge).normalize();
    result = clip(result, out, out.dot(pa[i]));
  }
  if (result.length) return unique(result);
  // Edge-edge SAT contacts have no reference-face overlap. The midpoint of the
  // nearest support features supplies the torque arm, never the actor origin.
  const av = (
      a.vertexOrder
        ? a.vertexOrder.map((index) => a.vertices[index])
        : a.vertices
    ).reduce((p, q) => (q.dot(normal) < p.dot(normal) ? q : p)),
    bv = (
      b.vertexOrder
        ? b.vertexOrder.map((index) => b.vertices[index])
        : b.vertices
    ).reduce((p, q) => (q.dot(normal) > p.dot(normal) ? q : p));
  return [project(av.clone().add(bv).multiplyScalar(0.5))];
}
const SAT_EDGE_COMPONENT_LIMIT = Math.sqrt(Math.sqrt(Number.MAX_VALUE)) / 4;
function exactUniqueEdges(edges: number[]): number[] {
  // This is an optional arithmetic shortcut, not a source feature limit. Avoid
  // quadratic dedup work for unusually large/imbalanced external hulls.
  if (edges.length > 64 * 3) return edges;
  const result: number[] = [];
  for (let i = 0; i < edges.length; i += 3) {
    let duplicate = false;
    for (let j = 0; j < result.length; j += 3)
      if (
        Object.is(result[j], edges[i]) &&
        Object.is(result[j + 1], edges[i + 1]) &&
        Object.is(result[j + 2], edges[i + 2])
      ) {
        duplicate = true;
        break;
      }
    if (!duplicate) result.push(edges[i], edges[i + 1], edges[i + 2]);
  }
  return result;
}
/** Visit the original ordered/deduplicated SAT prefix. A separating axis avoids
 * constructing the remaining edge crosses; no axis or tolerance is omitted. */
function visitAxes(
  a: CollisionHull,
  b: CollisionHull,
  visit: (axis: Vector3) => boolean,
): boolean {
  const result: number[] = [];
  const axis = new Vector3();
  const add = (x: number, y: number, z: number) => {
    const lengthSq = x * x + y * y + z * z;
    if (lengthSq < 1e-12) return true;
    // Vector3.normalize -> divideScalar(length() || 1) -> multiplyScalar.
    // Keep reciprocal multiplication, operation order and NaN/Infinity/zero
    // handling exactly; division of each component would change rounding.
    const reciprocal = 1 / (Math.sqrt(lengthSq) || 1);
    x *= reciprocal;
    y *= reciprocal;
    z *= reciprocal;
    for (let i = 0; i < result.length; i += 3)
      if (
        Math.abs(result[i] * x + result[i + 1] * y + result[i + 2] * z) >
        1 - EPS
      )
        return true;
    result.push(x, y, z);
    return visit(axis.set(x, y, z));
  };
  for (const f of a.faces)
    if (!add(f.normal.x, f.normal.y, f.normal.z)) return false;
  for (const f of b.faces)
    if (!add(f.normal.x, f.normal.y, f.normal.z)) return false;
  // Subtract the actual world vertices as before. Rotating local edge vectors
  // would change rounding, particularly for translated/deformed hulls.
  const edgeDirections = (hull: CollisionHull): number[] => {
    const edges: number[] = [];
    for (const [i, j] of hull.edges) {
      const start = hull.vertices[i],
        end = hull.vertices[j];
      edges.push(end.x - start.x, end.y - start.y, end.z - start.z);
    }
    return edges;
  };
  const edgesA = edgeDirections(a),
    edgesB = edgeDirections(b);
  // Repeated world-vector bits produce identical ordered cross/normalization
  // results. Their first axis either remains in the append-only axis list or
  // was already rejected by it. Retain signed zero and first authored order.
  // This bound keeps cross lengthSq below 3*MAX/64; surviving axes normalize
  // outside the zero/overflow regime, so self-dot is safely above 1-EPS.
  // Exceptional geometry retains the complete original arithmetic/axes.
  const safe = (component: number) =>
    Number.isFinite(component) &&
    Math.abs(component) <= SAT_EDGE_COMPONENT_LIMIT;
  const deduplicate = edgesA.every(safe) && edgesB.every(safe),
    directionsA = deduplicate ? exactUniqueEdges(edgesA) : edgesA,
    directionsB = deduplicate ? exactUniqueEdges(edgesB) : edgesB;
  for (let i = 0; i < directionsA.length; i += 3) {
    const ax = directionsA[i],
      ay = directionsA[i + 1],
      az = directionsA[i + 2];
    for (let j = 0; j < directionsB.length; j += 3) {
      const bx = directionsB[j],
        by = directionsB[j + 1],
        bz = directionsB[j + 2];
      // Vector3.crossVectors uses these products/subtractions in this order.
      if (!add(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx))
        return false;
    }
  }
  return true;
}
/** Depth-only solid-hull SAT for placement/integration verification. Wire
 * shapes retain their native feature contacts; they have no solid volume. */
export function hullPenetration(a: CollisionHull, b: CollisionHull): number {
  if (!a.faces.length || !b.faces.length) return 0;
  let depth = Infinity;
  const overlap = visitAxes(a, b, (axis) => {
    const [al, ah] = projection(a.vertices, axis, a.vertexOrder),
      [bl, bh] = projection(b.vertices, axis, b.vertexOrder);
    if (ah <= bl || bh <= al) return false;
    depth = Math.min(depth, ah - bl, bh - al);
    return true;
  });
  return overlap && Number.isFinite(depth) ? depth : 0;
}
/** Exact depth predicate for the integration guard. For a nonnegative limit,
 * one axis at/below that limit certifies rejection without constructing the
 * remaining SAT axes. Keep the original ordered axes/projection arithmetic;
 * this is an independent query optimization, not a native contact change. */
export function hullPenetrationExceeds(
  a: CollisionHull,
  b: CollisionHull,
  threshold: number,
): boolean {
  // Preserve the full depth API's zero fallback and ordinary JS comparison for
  // negative/NaN thresholds, including wire and degenerate geometry.
  if (!(threshold >= 0)) return hullPenetration(a, b) > threshold;
  if (!a.faces.length || !b.faces.length) return false;
  let depth = Infinity;
  const overlap = visitAxes(a, b, (axis) => {
    const [al, ah] = projection(a.vertices, axis, a.vertexOrder),
      [bl, bh] = projection(b.vertices, axis, b.vertexOrder);
    if (ah <= bl || bh <= al) return false;
    depth = Math.min(depth, ah - bl, bh - al);
    return depth > threshold;
  });
  return overlap && Number.isFinite(depth) && depth > threshold;
}
/** Full convex SAT, including edge-edge axes. Normal points from B into A. */
export function collideHulls(
  a: CollisionHull,
  b: CollisionHull,
  tolerance = 0,
): HullContact | null {
  let penetration = Infinity,
    normal: Vector3 | undefined;
  const overlap = visitAxes(a, b, (axis) => {
    const [al, ah] = projection(a.vertices, axis, a.vertexOrder),
      [bl, bh] = projection(b.vertices, axis, b.vertexOrder);
    if (ah < bl - tolerance || bh < al - tolerance) return false;
    const left = ah - bl,
      right = bh - al;
    if (Math.min(left, right) < penetration) {
      penetration = Math.min(left, right);
      normal = axis.clone().multiplyScalar(right < left ? 1 : -1);
    }
    return true;
  });
  if (!overlap || !normal) return null;
  return {
    normal,
    points: manifold(a, b, normal),
    penetration: Math.max(0, penetration),
  };
}

interface PointHullEntry {
  point: Vector3;
  normal: Vector3;
  fraction: number;
}
function clipPointHull(
  from: Vector3,
  to: Vector3,
  hull: CollisionHull,
): PointHullEntry | null;
function clipPointHull(
  from: Vector3,
  to: Vector3,
  hull: CollisionHull,
  fractionOnly: true,
): number | null;
function clipPointHull(
  from: Vector3,
  to: Vector3,
  hull: CollisionHull,
  fractionOnly = false,
): PointHullEntry | number | null {
  // Original pair vertex arrays, plane records and clipping fractions are
  // single-precision. Retain those storage boundaries: double-precision sinπ
  // residuals otherwise turn coplanar side vertices into outside segments.
  from = new Vector3(
    Math.fround(from.x),
    Math.fround(from.y),
    Math.fround(from.z),
  );
  to = new Vector3(Math.fround(to.x), Math.fround(to.y), Math.fround(to.z));
  const delta = to.clone().sub(from);
  let enter = 0,
    exit = 1,
    inside = true,
    parallelOutside = false;
  let plane: HullFace | undefined;
  for (const face of hull.faces) {
    const nx = Math.fround(face.normal.x),
      ny = Math.fround(face.normal.y),
      nz = Math.fround(face.normal.z);
    // Vector3.dot's exact multiply/add order, with the same Float32 stores.
    // Keeping three scalar coefficients avoids one vector per authored plane.
    const distance = Math.fround(
      Math.fround(face.constant) - (nx * from.x + ny * from.y + nz * from.z),
    );
    const movement = Math.fround(-(nx * delta.x + ny * delta.y + nz * delta.z));
    if (distance < 0) inside = false;
    if (movement === 0) {
      if (distance < 0) parallelOutside = true;
      continue;
    }
    const fraction = Math.fround(-distance / movement);
    if (movement > 0 && fraction >= enter) {
      enter = fraction;
      plane = face;
    }
    if (movement < 0) exit = Math.min(exit, fraction);
  }
  if (inside) return null;
  if (!parallelOutside && plane && enter >= 0 && enter <= 1 && enter <= exit) {
    if (fractionOnly) return enter;
    return {
      point: from.clone().addScaledVector(delta, enter),
      normal: plane.normal.clone(),
      fraction: enter,
    };
  }
  // The original polyhedron helper marks a near-inside endpoint with bit0x40;
  // the object-pair emitter assigns those candidates the sortable value1.05.
  const normal = new Vector3();
  for (const face of hull.faces) {
    const distance = face.constant - face.normal.dot(to);
    if (distance < -1e-5) return null;
    if (distance < 0) normal.add(face.normal);
  }
  if (!normal.lengthSq()) return null;
  return fractionOnly
    ? 1.05
    : { point: to.clone(), normal: normal.normalize(), fraction: 1.05 };
}
function hullLocal(
  hull: CollisionHull,
  point: Vector3,
  inverse = hull.orientation!.clone().conjugate(),
): Vector3 {
  const result = point.clone().sub(hull.position!).applyQuaternion(inverse);
  return result.set(
    Math.fround(result.x),
    Math.fround(result.y),
    Math.fround(result.z),
  );
}
function hullWorld(hull: CollisionHull, point: Vector3): Vector3 {
  return point.clone().applyQuaternion(hull.orientation!).add(hull.position!);
}
function blendedPairNormal(
  old: CollisionHull,
  predicted: CollisionHull,
  normal: Vector3,
  fraction: number,
  edge = false,
): Vector3 {
  if (fraction > 1)
    return normal.clone().applyQuaternion(predicted.orientation!).normalize();
  // Vertex and edge emitters use opposite interpolation weights in the HW
  // executable (0x428480 and0x4248e0 respectively).
  const weight = edge ? 1 - fraction : fraction;
  return normal
    .clone()
    .applyQuaternion(old.orientation!)
    .multiplyScalar(1 - weight)
    .addScaledVector(
      normal.clone().applyQuaternion(predicted.orientation!),
      weight,
    )
    .normalize();
}

function localPointInside(hull: CollisionHull, point: Vector3): boolean {
  if (!hull.faces.length) return false;
  for (const face of hull.faces) {
    const nx = Math.fround(face.normal.x),
      ny = Math.fround(face.normal.y),
      nz = Math.fround(face.normal.z);
    if (
      !(
        Math.fround(
          Math.fround(face.constant) -
            (nx * point.x + ny * point.y + nz * point.z),
        ) >= 0
      )
    )
      return false;
  }
  return true;
}
function pairPointVelocity(body: RigidBody, point: Vector3): Vector3 {
  const center = body.properties.centerOfMass
    .clone()
    .applyQuaternion(body.state.orientation)
    .add(body.state.position);
  return body.state.angularVelocity
    .clone()
    .cross(point.clone().sub(center))
    .add(body.state.velocity);
}
function reducePairContacts(candidates: HullContact[]): HullContact | null {
  candidates.sort((a, b) => a.fraction! - b.fraction!);
  const selected = candidates.slice(0, 4);
  if (!selected.length) return null;
  const count = selected.findIndex(
    (entry, index) => index > 0 && entry.normal.dot(selected[0].normal) < 0.707,
  );
  if (count >= 0) selected.splice(count);
  return {
    normal: selected[0].normal,
    points: selected.map((entry) => entry.points[0]),
    pointsB: selected.map((entry) => entry.pointsB![0]),
    pointNormals: selected.map((entry) => entry.normal),
    pointFractions: selected.map((entry) => entry.fraction!),
    contactTypes: selected.map((entry) => entry.contactTypes?.[0] ?? 5),
    measures: selected.map((entry) => entry.fraction!),
    fraction: selected[0].fraction,
    penetration: 0,
  };
}
/** Boolean part of HW0x427f20 recovery admission. Normal/closing-speed gates
 * select rows, not overlap: containment may admit recovery with zero rows.
 * Only transformed authored hulls are accepted, as in recoverHullOverlap. */
export function nativeHullRecoveryOverlap(
  a: CollisionHull,
  b: CollisionHull,
): boolean {
  for (const hull of [a, b])
    if (!hull.localHull || !hull.position || !hull.orientation)
      throw new Error("Recovery admission requires transformed authored hulls");
  const intersects = (moving: CollisionHull, target: CollisionHull) => {
    const inverse = target.orientation!.clone().conjugate();
    const points = moving.vertices.map((point) =>
      hullLocal(target, point, inverse),
    );
    for (const [start, end] of moving.edges) {
      const startInside = localPointInside(target.localHull!, points[start]);
      const endInside = localPointInside(target.localHull!, points[end]);
      if (
        startInside ||
        endInside ||
        clipPointHull(points[start], points[end], target.localHull!)
      )
        return true;
    }
    return false;
  };
  return intersects(a, b) || intersects(b, a);
}

export interface HullRecoveryGeometry {
  readonly overlap: boolean;
  /** Original A edges then B edges, before live closing-speed admission. */
  readonly candidates: readonly {
    readonly normal: Vector3;
    readonly movingPoint: Vector3;
    readonly targetPoint: Vector3;
    readonly swapped: boolean;
  }[];
}

/** OLD edge/hull intersections and center-facing normals of HW0x427f20.
 * Consumers must recertify OLD hulls/bounds centers before reusing this record.
 * No velocity, COM or attachment-dependent admission is retained. */
export function collectHullRecoveryGeometry(
  oldA: CollisionHull,
  oldB: CollisionHull,
  boundsCenterA?: Vector3,
  boundsCenterB?: Vector3,
): HullRecoveryGeometry {
  const centerA = boundsCenterA ?? hullBounds(oldA).getCenter(new Vector3());
  const centerB = boundsCenterB ?? hullBounds(oldB).getCenter(new Vector3());
  const direction = centerA.clone().sub(centerB);
  if (direction.length() <= 2.384185791015625e-7)
    direction.set(1, 0, 0).applyQuaternion(oldB.orientation!);
  else direction.normalize();
  let overlap = false;
  const candidates: Array<HullRecoveryGeometry["candidates"][number]> = [];
  const edges = (
    moving: CollisionHull,
    target: CollisionHull,
    swapped: boolean,
  ) => {
    const inverse = target.orientation!.clone().conjugate();
    const points = moving.vertices.map((point) =>
      hullLocal(target, point, inverse),
    );
    for (const [start, end] of moving.edges) {
      const startInside = localPointInside(target.localHull!, points[start]),
        endInside = localPointInside(target.localHull!, points[end]);
      const entry = clipPointHull(
        startInside ? points[end] : points[start],
        startInside ? points[start] : points[end],
        target.localHull!,
      );
      if (startInside || endInside || entry) overlap = true;
      if (startInside === endInside || !entry || entry.fraction > 1) continue;
      const parameter = startInside ? 1 - entry.fraction : entry.fraction;
      const movingPoint = moving.vertices[start]
        .clone()
        .lerp(moving.vertices[end], parameter);
      const targetPoint = hullWorld(target, entry.point);
      const normal = entry.normal.clone().applyQuaternion(target.orientation!);
      const outward = swapped ? direction.clone().negate() : direction;
      if (normal.dot(outward) < 0.20000000298023224) continue;
      candidates.push({ normal, movingPoint, targetPoint, swapped });
    }
  };
  edges(oldA, oldB, false);
  edges(oldB, oldA, true);
  return { overlap, candidates };
}

/** Original0x427f20 recovery applies live positive closing speed to OLD
 * geometry. It supplies no arbitrary MTV and never exposes retained vectors
 * as mutable solver rows. Attachment suppression remains a live final gate. */
export function recoverHullOverlap(
  oldA: CollisionHull,
  oldB: CollisionHull,
  options: NonNullable<PairSweepOptions["recovery"]>,
): { overlap: boolean; contact: HullContact | null } {
  const geometry =
    options.geometry ??
    collectHullRecoveryGeometry(
      oldA,
      oldB,
      options.boundsCenterA,
      options.boundsCenterB,
    );
  const candidates: HullContact[] = [];
  for (const {
    normal,
    movingPoint,
    targetPoint,
    swapped,
  } of geometry.candidates) {
    const movingBody = swapped ? options.b : options.a,
      targetBody = swapped ? options.a : options.b;
    const relative = pairPointVelocity(movingBody, movingPoint).sub(
      pairPointVelocity(targetBody, targetPoint),
    );
    if (-normal.dot(relative) <= 0) continue;
    candidates.push({
      normal: swapped ? normal.clone().negate() : normal.clone(),
      points: [swapped ? targetPoint.clone() : movingPoint.clone()],
      pointsB: [swapped ? movingPoint.clone() : targetPoint.clone()],
      penetration: 0,
      fraction: 0,
      measures: [0],
      contactTypes: [6],
    });
  }
  return {
    overlap: geometry.overlap,
    contact: options.sameAttachmentGroup
      ? null
      : reducePairContacts(candidates),
  };
}

export interface PairOldGeometry {
  readonly aToB: {
    readonly relativeOld: readonly Vector3[];
    readonly inside: readonly boolean[];
  };
  readonly bToA: PairOldGeometry["aToB"];
}

/** Pure OLD target-local vertex preparation of the ordinary pair emitter.
 * Shape/OLD-pose edits require a new record; NEXT, velocities and callbacks
 * are not cached here. Relative vectors/flags retain authored vertex order. */
export function collectPairOldGeometry(
  oldA: CollisionHull,
  oldB: CollisionHull,
): PairOldGeometry {
  const relative = (
    moving: CollisionHull,
    target: CollisionHull,
  ): PairOldGeometry["aToB"] => {
    const inverse = target.orientation!.clone().conjugate();
    const relativeOld = moving.vertices.map((point) =>
      hullLocal(target, point, inverse),
    );
    return {
      relativeOld,
      inside: relativeOld.map((point) =>
        localPointInside(target.localHull!, point),
      ),
    };
  };
  return { aToB: relative(oldA, oldB), bToA: relative(oldB, oldA) };
}

/** Original object-pair feature CCD, local HW0x425c00 ->0x4277c0 ->
 *0x428480(vertex/hull) and0x4286f0(relative moving edges). Each vertex segment
 * is transformed through BOTH old and candidate inverse target transforms.
 * The manifold uses the four earliest feature crossings, retaining independent
 * solver-frame torque points for both bodies. Transform metadata is required. */
export function sweepHulls(
  oldA: CollisionHull,
  predictedA: CollisionHull,
  oldB: CollisionHull,
  predictedB: CollisionHull,
  options: PairSweepOptions = {},
): HullContact | null {
  return sweepHullFeatures(
    oldA,
    predictedA,
    oldB,
    predictedB,
    options,
    false,
  ) as HullContact | null;
}

/** Earliest native feature fraction for the integration guard, using the same
 * Float32 roots/clipping, authored order and buried-edge exclusion as CCD.
 * Solver normals, torque points and manifold reduction are unnecessary here.
 * Recovery remains the responsibility of the original sweepHulls API. */
export function sweepHullsFraction(
  oldA: CollisionHull,
  predictedA: CollisionHull,
  oldB: CollisionHull,
  predictedB: CollisionHull,
  edgeDiagnostics?: EdgeFeatureDiagnostics,
): number | undefined {
  return sweepHullFeatures(
    oldA,
    predictedA,
    oldB,
    predictedB,
    { edgeDiagnostics },
    true,
  ) as number | undefined;
}

function sweepHullFeatures(
  oldA: CollisionHull,
  predictedA: CollisionHull,
  oldB: CollisionHull,
  predictedB: CollisionHull,
  options: PairSweepOptions,
  fractionOnly: boolean,
): HullContact | null | number | undefined {
  for (const hull of [oldA, predictedA, oldB, predictedB]) {
    if (!hull.localHull || !hull.position || !hull.orientation)
      throw new Error("Object CCD requires transformed authored hulls");
  }
  if (options.recovery) {
    const recovered = recoverHullOverlap(oldA, oldB, options.recovery);
    if (recovered.overlap) {
      options.onOverlap?.();
      return recovered.contact;
    }
  }
  const oldGeometry = fractionOnly ? undefined : options.getOldGeometry?.();
  const candidates: HullContact[] = [];
  let firstFraction: number | undefined;
  const vertices = (
    moving: CollisionHull,
    nextMoving: CollisionHull,
    target: CollisionHull,
    nextTarget: CollisionHull,
    swapped: boolean,
  ) => {
    const preparedOld = swapped ? oldGeometry?.bToA : oldGeometry?.aToB;
    const inverseOld = preparedOld
        ? undefined
        : target.orientation!.clone().conjugate(),
      inverseNew = nextTarget.orientation!.clone().conjugate();
    const relativeOld =
      preparedOld?.relativeOld ??
      moving.vertices.map((point) => hullLocal(target, point, inverseOld!));
    const relativeNew = nextMoving.vertices.map((point) =>
      hullLocal(nextTarget, point, inverseNew),
    );
    // Only A's old-inside flags suppress relative moving-edge features. The
    // fraction query has no overlap callback needing B's redundant flags.
    const inside =
      preparedOld?.inside ??
      (fractionOnly && swapped
        ? []
        : relativeOld.map((point) =>
            localPointInside(target.localHull!, point),
          ));
    const featureOrder =
      moving.vertexOrder ?? moving.vertices.map((_, index) => index);
    if (featureOrder.some((index) => inside[index])) options.onOverlap?.();
    for (const i of featureOrder) {
      if (fractionOnly) {
        const fraction = clipPointHull(
          relativeOld[i],
          relativeNew[i],
          target.localHull!,
          true,
        );
        if (
          fraction !== null &&
          (firstFraction === undefined || fraction < firstFraction)
        )
          firstFraction = fraction;
        continue;
      }
      const entry = clipPointHull(
        relativeOld[i],
        relativeNew[i],
        target.localHull!,
      );
      if (!entry) continue;
      const normal = blendedPairNormal(
        target,
        nextTarget,
        entry.normal,
        entry.fraction,
      );
      const movingPoint = moving.vertices[i].clone(),
        targetPoint = hullWorld(target, entry.point);
      candidates.push({
        normal: swapped ? normal.negate() : normal,
        points: [swapped ? targetPoint : movingPoint],
        pointsB: [swapped ? movingPoint : targetPoint],
        penetration: 0,
        fraction: entry.fraction,
        measures: [entry.fraction],
      });
    }
    return { relativeOld, relativeNew, inside };
  };
  const relative = vertices(oldA, predictedA, oldB, predictedB, false);
  vertices(oldB, predictedB, oldA, predictedA, true);
  // Each original edge pair is tested in one target-local frame. Its relative
  // endpoints vary linearly exactly as the original precomputed vertex arrays.
  const targetEdges =
    oldB.edges === oldB.localHull!.edges
      ? getHullEdgeFeatureIndex(oldB.localHull!)
      : createEdgeFeatureIndex(oldB.localHull!.vertices, oldB.edges);
  for (const [a0, a1] of oldA.edges) {
    if (relative.inside[a0] || relative.inside[a1]) continue;
    for (const slot of targetEdges.query(
      relative.relativeOld[a0],
      relative.relativeOld[a1],
      relative.relativeNew[a0],
      relative.relativeNew[a1],
      options.edgeDiagnostics,
    )) {
      const [b0, b1] = oldB.edges[slot];
      const start = oldB.localHull!.vertices[b0],
        end = oldB.localHull!.vertices[b1];
      const hit = sweepMovingEdges(
        start,
        end,
        relative.relativeOld[a0],
        relative.relativeOld[a1],
        relative.relativeNew[a0],
        relative.relativeNew[a1],
      );
      if (!hit) continue;
      const fraction = Math.fround(hit.fraction!);
      if (fractionOnly) {
        // Keep the source edge eligibility test before recording its root.
        if (
          oldB.localHull!.faces.length > 0 &&
          oldB.localHull!.faces.every(
            (face) => face.normal.dot(hit.points[0]) < face.constant - EPS,
          )
        )
          continue;
        if (firstFraction === undefined || fraction < firstFraction)
          firstFraction = fraction;
        continue;
      }
      const oldEdge = relative.relativeOld[a1]
        .clone()
        .sub(relative.relativeOld[a0]);
      const parameter =
        hit.points[0].clone().sub(relative.relativeOld[a0]).dot(oldEdge) /
        oldEdge.lengthSq();
      const currentPoint = relative.relativeOld[a0]
        .clone()
        .lerp(relative.relativeNew[a0], fraction)
        .lerp(
          relative.relativeOld[a1]
            .clone()
            .lerp(relative.relativeNew[a1], fraction),
          parameter,
        );
      const edge = end.clone().sub(start);
      const targetParameter =
        currentPoint.clone().sub(start).dot(edge) / edge.lengthSq();
      const pointB = start.clone().addScaledVector(edge, targetParameter);
      // Original edge emitter excludes a crossing buried inside the target
      // polyhedron; boundary features remain eligible.
      if (
        oldB.localHull!.faces.length > 0 &&
        oldB.localHull!.faces.every(
          (face) => face.normal.dot(hit.points[0]) < face.constant - EPS,
        )
      )
        continue;
      candidates.push({
        normal: blendedPairNormal(oldB, predictedB, hit.normal, fraction, true),
        points: [hullWorld(oldB, hit.points[0])],
        pointsB: [hullWorld(oldB, pointB)],
        penetration: 0,
        fraction,
        measures: [fraction],
      });
    }
  }
  return fractionOnly ? firstFraction : reducePairContacts(candidates);
}
/** Original static world vertex versus authored moving hull-face path:
 * transform the point into the old/candidate body frames, then clip its local
 * segment against the local hull planes (local HW 0x461810/0x461a20). */
function sweepWorldVertex(
  old: CollisionHull,
  predicted: CollisionHull,
  worldPoint: Vector3,
): HullContact | null {
  if (
    !old.localHull ||
    !old.position ||
    !old.orientation ||
    !predicted.position ||
    !predicted.orientation
  )
    return null;
  const from = worldPoint
    .clone()
    .sub(old.position)
    .applyQuaternion(old.orientation.clone().conjugate());
  const to = worldPoint
    .clone()
    .sub(predicted.position)
    .applyQuaternion(predicted.orientation.clone().conjugate());
  const delta = to.clone().sub(from);
  let enter = 0,
    exit = 1;
  let startInside = true;
  let parallelOutside = false;
  let enteringFace: HullFace | undefined;
  for (const face of old.localHull.faces) {
    const distance = face.constant - face.normal.dot(from);
    const movement = -face.normal.dot(delta);
    if (distance < 0) startInside = false;
    if (movement === 0) {
      if (distance < 0) parallelOutside = true;
      continue;
    }
    const fraction = -distance / movement;
    if (movement > 0 && fraction >= enter) {
      enter = fraction;
      enteringFace = face;
    } else if (movement < 0) exit = Math.min(exit, fraction);
  }
  // Original primitive returns -1 for a point already inside; world emitter
  // ignores it rather than inventing an arbitrary overlap normal.
  if (startInside) return null;
  let normal: Vector3;
  let point: Vector3;
  let fraction: number;
  if (
    !parallelOutside &&
    enteringFace &&
    enter >= 0 &&
    enter <= 1 &&
    enter <= exit
  ) {
    normal = enteringFace.normal.clone().negate();
    point = from.clone().addScaledVector(delta, enter);
    fraction = enter;
  } else {
    normal = new Vector3();
    for (const face of old.localHull.faces) {
      const distance = face.constant - face.normal.dot(to);
      if (distance < -1e-5) return null;
      if (distance < 0) normal.sub(face.normal);
    }
    if (!normal.lengthSq()) return null;
    normal.normalize();
    point = to.clone();
    fraction = 1;
  }
  normal.applyQuaternion(old.orientation);
  point.applyQuaternion(old.orientation).add(old.position);
  return {
    normal,
    points: [point],
    penetration: 0,
    fraction,
    measures: [fraction],
    contactTypes: [2],
  };
}
/** Original world-contact feature families: moving hull vertices, static world
 * vertices against moving hull planes, and quadratic moving-edge crossings.
 * Transformed hull metadata is required for the static-world-vertex path. */
export function sweepHullTriangle(
  old: CollisionHull,
  predicted: CollisionHull,
  a: Vector3,
  b: Vector3,
  c: Vector3,
  options: WorldSurfaceOptions = {},
): HullContact | null {
  const prefix = options.materialIdentifier?.[0];
  if (prefix === "!" || prefix === ">") return null;
  const plane = worldTrianglePlane(a, b, c, options.sourceSurface);
  const planeNormal = plane.normal;
  if (!planeNormal.lengthSq()) return null;
  const planeConstant = plane.constant;
  const startInterval = projection(old.vertices, planeNormal, old.vertexOrder);
  const endInterval = projection(
    predicted.vertices,
    planeNormal,
    predicted.vertexOrder,
  );
  if (
    Math.min(startInterval[0], endInterval[0]) > planeConstant + 0.005 ||
    Math.max(startInterval[1], endInterval[1]) < planeConstant - 0.005
  )
    return null;
  const twoSided =
    options.twoSided ??
    (options.materialFlags === undefined ||
      (options.materialFlags & 0x1800) !== 0);
  const finiteTriangle = new Triangle(a, b, c);
  const vertexContacts: HullContact[] = [];
  for (const i of old.vertexOrder ?? old.vertices.map((_, index) => index)) {
    if (options.edgeOnly || options.skipMovingHullFeatures) break;
    if (options.suppressedVertices?.has(i)) continue;
    const start = old.vertices[i];
    const direction = predicted.vertices[i].clone().sub(start);
    const length = direction.length();
    if (length > 2.384185791015625e-7)
      direction.multiplyScalar(1 + SWEEP_EXTENSION / length);
    else continue;
    const denominator = direction.dot(planeNormal);
    if (
      Math.abs(denominator) < 2.384185791015625e-7 ||
      (!twoSided && denominator > 0)
    )
      continue;
    const distance = start.clone().sub(a).dot(planeNormal);
    if (denominator > 0) {
      if (distance > 0 || -distance > denominator + 0.003) continue;
    } else if (distance < 0 || distance > 0.003 - denominator) continue;
    const fraction = Math.min(1, -distance / denominator);
    const hit = start.clone().addScaledVector(direction, fraction);
    const barycentric = finiteTriangle.getBarycoord(hit, new Vector3());
    if (
      !barycentric ||
      barycentric.x < -0.0001 ||
      barycentric.y < -0.0001 ||
      barycentric.z < -0.0001
    )
      continue;
    const normal = planeNormal.clone().multiplyScalar(denominator > 0 ? -1 : 1);
    vertexContacts.push({
      normal,
      // C2 stores the old vertex lever, rather than the hit point.
      points: [start.clone()],
      penetration: 0,
      fraction,
      measures: [Math.fround(fraction)],
      vertexIndices: [i],
      contactTypes: [1],
    });
  }
  const edgeContacts: HullContact[] = [];
  const triangleVertices = [a, b, c];
  const faceContacts: HullContact[] = [];
  for (let i = 0; i < triangleVertices.length; i++) {
    if (options.edgeOnly) break;
    if (options.skipWorldEdges || options.skipWorldVertices) break;
    // World vertices are emitted as endpoints of an enabled triangle edge.
    if (
      ((options.faceFlags ?? 0) & (1 << i)) !== 0 &&
      ((options.faceFlags ?? 0) & (1 << (i + 2) % 3)) !== 0
    )
      continue;
    const vertex = triangleVertices[i];
    const candidate = sweepWorldVertex(old, predicted, vertex);
    if (!candidate || (!twoSided && startInterval[1] < planeConstant - 0.005))
      continue;
    faceContacts.push(candidate);
  }
  for (let i = 0; i < 3; i++) {
    if (options.skipWorldEdges || options.skipMovingHullFeatures) break;
    if (((options.faceFlags ?? 0) & (1 << i)) !== 0) continue;
    const intersections: HullContact[] = [];
    const edgeSlots = options
      .getEdgeIndex?.()
      .query(
        triangleVertices[i],
        triangleVertices[(i + 1) % 3],
        undefined,
        undefined,
        options.edgeDiagnostics,
      );
    // Generic callers retain the old live scan. Simulation-owned endpoint
    // pairs supply one shared index across all of their world triangles.
    for (const slot of edgeSlots ?? old.edges.map((_, slot) => slot)) {
      const [start, end] = old.edges[slot];
      const candidate = sweepMovingEdges(
        triangleVertices[i],
        triangleVertices[(i + 1) % 3],
        old.vertices[start],
        old.vertices[end],
        predicted.vertices[start],
        predicted.vertices[end],
      );
      if (!candidate) continue;
      if (!twoSided && startInterval[1] < planeConstant - 0.005) continue;
      intersections.push(candidate);
    }
    // Local0x4241c0 has two working records for each static world edge.
    intersections.sort((a, b) => a.fraction! - b.fraction!);
    edgeContacts.push(...intersections.slice(0, 2));
  }
  const retained = options.deferReduction
    ? [...vertexContacts, ...faceContacts, ...edgeContacts]
    : reduceWorldContacts([
        ...vertexContacts,
        ...faceContacts,
        ...edgeContacts,
      ]);
  if (retained.length)
    return {
      sourceSurface: options.sourceSurface,
      normal: retained[0].normal,
      points: retained.flatMap((contact) => contact.points),
      pointsB: retained.map(
        (contact) => contact.pointsB?.[0] ?? contact.points[0],
      ),
      pointNormals: retained.map((contact) => contact.normal),
      pointFractions: retained.map((contact) => contact.fraction!),
      vertexIndices: retained.map(
        (contact) => contact.vertexIndices?.[0] ?? -1,
      ),
      measures: retained.map((contact) => contact.measures![0]),
      contactTypes: retained.map((contact) => contact.contactTypes?.[0] ?? 0),
      penetration: 0,
      fraction: Math.min(...retained.map((contact) => contact.fraction!)),
    };
  return null;
}
