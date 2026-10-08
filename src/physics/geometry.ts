import { Box3, Quaternion, Triangle, Vector3 } from "three";
import type { RigidBody } from "./contact";

export interface HullFace {
  normal: Vector3;
  constant: number;
  indices: number[];
}
export interface CollisionHull {
  vertices: Vector3[];
  /** Compact source feature order, expressed as authored vertex indices. */
  vertexOrder?: number[];
  faces: HullFace[];
  edges: [number, number][];
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
  /** Original flag0x100 enables old-geometry overlap recovery. */
  recovery?: {
    a: RigidBody;
    b: RigidBody;
    sameAttachmentGroup?: boolean;
    boundsCenterA?: Vector3;
    boundsCenterB?: Vector3;
  };
  /** Original start-inside/recovery evidence sets flag0x200 for the next tick. */
  onOverlap?: () => void;
}
const EPS = 1e-7;
const SWEEP_EXTENSION = 0.0010434782598167658;

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
    if (surface.edgeOnly || /^[!>?]/.test(surface.materialIdentifier ?? "")) continue;
    const { a, b, c } = surface;
    const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
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
  const edge = staticEnd.clone().sub(staticStart);
  const original = oldEnd.clone().sub(oldStart);
  const movement = newStart.clone().sub(oldStart);
  const edgeChange = newEnd.clone().sub(newStart).sub(original);
  const relative = oldStart.clone().sub(staticStart);
  const normal0 = edge.clone().cross(original);
  const normalDelta = edge.clone().cross(edgeChange);
  const a = movement.dot(normalDelta);
  const b = relative.dot(normalDelta) + movement.dot(normal0);
  const c = relative.dot(normal0);
  const roots: number[] = [];
  const coefficientScale = Math.max(
    Math.abs(a),
    Math.abs(b),
    Math.abs(c),
    1e-30,
  );
  if (Math.abs(a) <= 1e-12 * coefficientScale) {
    if (Math.abs(b) > 1e-12 * coefficientScale) roots.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      // Stable quadratic roots, with the zero-q double root handled separately.
      const q = -0.5 * (b + (b >= 0 ? root : -root));
      if (q === 0) roots.push(-b / (2 * a));
      else roots.push(q / a, c / q);
    }
  }
  roots.sort((x, y) => x - y);
  for (const fraction of roots) {
    if (fraction < 0 || fraction > 1) continue;
    const currentEdge = original.clone().addScaledVector(edgeChange, fraction);
    const normal = edge.clone().cross(currentEdge);
    const normalSquared = normal.lengthSq();
    if (normalSquared < 1e-7) continue;
    const offset = relative.clone().addScaledVector(movement, fraction);
    const staticParameter =
      offset.clone().cross(currentEdge).dot(normal) / normalSquared;
    const movingParameter =
      offset.clone().cross(edge).dot(normal) / normalSquared;
    if (
      staticParameter < 0 ||
      staticParameter > 1 ||
      movingParameter < 0 ||
      movingParameter > 1
    )
      continue;
    normal.normalize().multiplyScalar(c < 0 ? -1 : 1);
    return {
      normal,
      points: [oldStart.clone().addScaledVector(original, movingParameter)],
      pointsB: [staticStart.clone().addScaledVector(edge, staticParameter)],
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
export function buildHull(points: readonly Vector3[]): CollisionHull {
  if (
    points.length < 4 ||
    points.length > 1024 ||
    points.some((point) => !point.toArray().every(Number.isFinite))
  )
    throw new Error("Invalid collision hull vertices");
  const vertices = points.map((point) => point.clone());
  const geometry = vertices.map((point) => storedVector(point.clone()));
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
  for (const index of vertexOrder ?? points.map((_, index) => index)) {
    const p = points[index];
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
function axes(a: CollisionHull, b: CollisionHull): Vector3[] {
  const result: Vector3[] = [];
  const add = (v: Vector3) => {
    if (v.lengthSq() < 1e-12) return;
    v.normalize();
    if (!result.some((p) => Math.abs(p.dot(v)) > 1 - EPS)) result.push(v);
  };
  a.faces.forEach((f) => add(f.normal.clone()));
  b.faces.forEach((f) => add(f.normal.clone()));
  for (const [a0, a1] of a.edges)
    for (const [b0, b1] of b.edges)
      add(
        a.vertices[a1]
          .clone()
          .sub(a.vertices[a0])
          .cross(b.vertices[b1].clone().sub(b.vertices[b0])),
      );
  return result;
}
/** Full convex SAT, including edge-edge axes. Normal points from B into A. */
export function collideHulls(
  a: CollisionHull,
  b: CollisionHull,
  tolerance = 0,
): HullContact | null {
  let penetration = Infinity,
    normal: Vector3 | undefined;
  for (const axis of axes(a, b)) {
    const [al, ah] = projection(a.vertices, axis, a.vertexOrder),
      [bl, bh] = projection(b.vertices, axis, b.vertexOrder);
    if (ah < bl - tolerance || bh < al - tolerance) return null;
    const left = ah - bl,
      right = bh - al;
    if (Math.min(left, right) < penetration) {
      penetration = Math.min(left, right);
      normal = axis.clone().multiplyScalar(right < left ? 1 : -1);
    }
  }
  if (!normal) return null;
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
): PointHullEntry | null {
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
    const normal = new Vector3(
      Math.fround(face.normal.x),
      Math.fround(face.normal.y),
      Math.fround(face.normal.z),
    );
    const distance = Math.fround(Math.fround(face.constant) - normal.dot(from));
    const movement = Math.fround(-normal.dot(delta));
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
  return normal.lengthSq()
    ? { point: to.clone(), normal: normal.normalize(), fraction: 1.05 }
    : null;
}
function hullLocal(hull: CollisionHull, point: Vector3): Vector3 {
  const result = point
    .clone()
    .sub(hull.position!)
    .applyQuaternion(hull.orientation!.clone().conjugate());
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
  return hull.faces.every((face) => {
    const normal = new Vector3(
      Math.fround(face.normal.x),
      Math.fround(face.normal.y),
      Math.fround(face.normal.z),
    );
    return Math.fround(Math.fround(face.constant) - normal.dot(point)) >= 0;
  });
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
/** Original0x427f20 recovery uses old edge/hull intersections, center-facing
 * outward normals and positive closing speed. It supplies no arbitrary MTV. */
export function recoverHullOverlap(
  oldA: CollisionHull,
  oldB: CollisionHull,
  options: NonNullable<PairSweepOptions["recovery"]>,
): { overlap: boolean; contact: HullContact | null } {
  const centerA =
    options.boundsCenterA ?? hullBounds(oldA).getCenter(new Vector3());
  const centerB =
    options.boundsCenterB ?? hullBounds(oldB).getCenter(new Vector3());
  const direction = centerA.clone().sub(centerB);
  if (direction.length() <= 2.384185791015625e-7)
    direction.set(1, 0, 0).applyQuaternion(oldB.orientation!);
  else direction.normalize();
  let overlap = false;
  const candidates: HullContact[] = [];
  const edges = (
    moving: CollisionHull,
    target: CollisionHull,
    movingBody: RigidBody,
    targetBody: RigidBody,
    swapped: boolean,
  ) => {
    const points = moving.vertices.map((point) => hullLocal(target, point));
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
      const relative = pairPointVelocity(movingBody, movingPoint).sub(
        pairPointVelocity(targetBody, targetPoint),
      );
      if (-normal.dot(relative) <= 0) continue;
      candidates.push({
        normal: swapped ? normal.negate() : normal,
        points: [swapped ? targetPoint : movingPoint],
        pointsB: [swapped ? movingPoint : targetPoint],
        penetration: 0,
        fraction: 0,
        measures: [0],
        contactTypes: [6],
      });
    }
  };
  edges(oldA, oldB, options.a, options.b, false);
  edges(oldB, oldA, options.b, options.a, true);
  return {
    overlap,
    contact: options.sameAttachmentGroup
      ? null
      : reducePairContacts(candidates),
  };
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
  const candidates: HullContact[] = [];
  const vertices = (
    moving: CollisionHull,
    nextMoving: CollisionHull,
    target: CollisionHull,
    nextTarget: CollisionHull,
    swapped: boolean,
  ) => {
    const relativeOld = moving.vertices.map((point) =>
      hullLocal(target, point),
    );
    const relativeNew = nextMoving.vertices.map((point) =>
      hullLocal(nextTarget, point),
    );
    const inside = relativeOld.map((point) =>
      localPointInside(target.localHull!, point),
    );
    const featureOrder =
      moving.vertexOrder ?? moving.vertices.map((_, index) => index);
    if (featureOrder.some((index) => inside[index])) options.onOverlap?.();
    for (const i of featureOrder) {
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
  for (const [a0, a1] of oldA.edges) {
    if (relative.inside[a0] || relative.inside[a1]) continue;
    for (const [b0, b1] of oldB.edges) {
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
  return reducePairContacts(candidates);
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
  const planeNormal = b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  if (!planeNormal.lengthSq()) return null;
  const planeConstant = planeNormal.dot(a);
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
    if(options.edgeOnly) break;
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
    if(options.edgeOnly) break;
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
    if (options.skipWorldEdges) break;
    if (((options.faceFlags ?? 0) & (1 << i)) !== 0) continue;
    const intersections: HullContact[] = [];
    for (const [start, end] of old.edges) {
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
      sourceSurface:options.sourceSurface,
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
