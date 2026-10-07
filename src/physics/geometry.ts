import { Box3, Quaternion, Triangle, Vector3 } from "three";
import { ConvexHull } from "three/addons/math/ConvexHull.js";

export interface HullFace {
  normal: Vector3;
  constant: number;
  indices: number[];
}
export interface CollisionHull {
  vertices: Vector3[];
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
  penetration: number;
  fraction?: number;
  /** Original emitter's sortable measure, one value per point. */
  measures?: number[];
  pointNormals?: Vector3[];
  pointFractions?: number[];
  vertexIndices?: number[];
}
export interface WorldSurfaceOptions {
  materialIdentifier?: string;
  materialFlags?: number;
  twoSided?: boolean;
  /** Gather all faces first, then call reduceWorldContacts once per shape. */
  deferReduction?: boolean;
}
const EPS = 1e-7;
const SWEEP_EXTENSION = 0.0010434782598167658;

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
        pointNormals: [normal],
        measures: [contact.measures?.[i] ?? 0],
        pointFractions: fraction === undefined ? undefined : [fraction],
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
      penetration: 0,
      fraction,
      measures: [fraction],
    };
  }
  return null;
}

/** Geometry helper only. Authored C2 collision vertices remain independently
 * crushable; the contact solver supplies the reconstructed C2 response. */
export function buildHull(points: readonly Vector3[]): CollisionHull {
  if (
    points.length < 4 ||
    points.length > 1024 ||
    points.some((p) => !p.toArray().every(Number.isFinite))
  )
    throw new Error("Invalid collision hull vertices");
  const vertices = points.map((p) => p.clone()),
    quick = new ConvexHull().setFromPoints(vertices);
  const faces: HullFace[] = [];
  for (const f of quick.faces) {
    let merged = faces.find(
      (a) =>
        a.normal.dot(f.normal) > 1 - EPS &&
        Math.abs(a.constant - f.constant) < EPS,
    );
    if (!merged) {
      merged = { normal: f.normal.clone(), constant: f.constant, indices: [] };
      faces.push(merged);
    }
    let e = f.edge;
    do {
      const index = vertices.indexOf(e.head().point);
      if (index >= 0 && !merged.indices.includes(index))
        merged.indices.push(index);
      e = e.next;
    } while (e !== f.edge);
  }
  if (faces.length < 4) throw new Error("Degenerate collision hull");
  const edges: [number, number][] = [];
  for (const f of faces) {
    const center = f.indices
      .reduce((p, i) => p.add(vertices[i]), new Vector3())
      .divideScalar(f.indices.length);
    const u = vertices[f.indices[0]].clone().sub(center).normalize(),
      v = f.normal.clone().cross(u);
    f.indices.sort(
      (a, b) =>
        Math.atan2(
          vertices[a].clone().sub(center).dot(v),
          vertices[a].clone().sub(center).dot(u),
        ) -
        Math.atan2(
          vertices[b].clone().sub(center).dot(v),
          vertices[b].clone().sub(center).dot(u),
        ),
    );
    for (let i = 0; i < f.indices.length; i++) {
      const a = f.indices[i],
        b = f.indices[(i + 1) % f.indices.length];
      if (
        !edges.some(
          (e) => (e[0] === b && e[1] === a) || (e[0] === a && e[1] === b),
        )
      )
        edges.push([a, b]);
    }
  }
  return { vertices, faces, edges };
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
    edges: hull.edges,
    localHull: hull,
    position: position.clone(),
    orientation: orientation.clone(),
    faces: hull.faces.map((f) => {
      const normal = f.normal.clone().applyQuaternion(orientation);
      return {
        normal,
        constant: normal.dot(vertices[f.indices[0]]),
        indices: f.indices,
      };
    }),
  };
}
export function hullBounds(hull: CollisionHull): Box3 {
  return new Box3().setFromPoints(hull.vertices);
}
function projection(
  points: readonly Vector3[],
  axis: Vector3,
): [number, number] {
  let lo = Infinity,
    hi = -Infinity;
  for (const p of points) {
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
    (projection(a.vertices, normal)[0] + projection(b.vertices, normal)[1]) *
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
  const av = a.vertices.reduce((p, q) =>
      q.dot(normal) < p.dot(normal) ? q : p,
    ),
    bv = b.vertices.reduce((p, q) => (q.dot(normal) > p.dot(normal) ? q : p));
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
    const [al, ah] = projection(a.vertices, axis),
      [bl, bh] = projection(b.vertices, axis);
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
  let enteringFace: HullFace | undefined;
  for (const face of old.localHull.faces) {
    const distance = face.constant - face.normal.dot(from);
    const movement = -face.normal.dot(delta);
    if (distance < 0) startInside = false;
    if (movement === 0) {
      if (distance < 0) return null;
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
  if (enteringFace && enter >= 0 && enter <= 1 && enter <= exit) {
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
  const startInterval = projection(old.vertices, planeNormal);
  const endInterval = projection(predicted.vertices, planeNormal);
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
  for (let i = 0; i < old.vertices.length; i++) {
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
      measures: [normal.dot(direction)],
      vertexIndices: [i],
    });
  }
  const edgeContacts: HullContact[] = [];
  const triangleVertices = [a, b, c];
  const faceContacts: HullContact[] = [];
  for (const vertex of triangleVertices) {
    const candidate = sweepWorldVertex(old, predicted, vertex);
    if (!candidate || (!twoSided && startInterval[1] < planeConstant - 0.005))
      continue;
    faceContacts.push(candidate);
  }
  for (let i = 0; i < 3; i++) {
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
      edgeContacts.push(candidate);
    }
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
      normal: retained[0].normal,
      points: retained.flatMap((contact) => contact.points),
      pointNormals: retained.map((contact) => contact.normal),
      pointFractions: retained.map((contact) => contact.fraction!),
      vertexIndices: retained.map(
        (contact) => contact.vertexIndices?.[0] ?? -1,
      ),
      measures: retained.map((contact) => contact.measures![0]),
      penetration: 0,
      fraction: Math.min(...retained.map((contact) => contact.fraction!)),
    };
  return null;
}
