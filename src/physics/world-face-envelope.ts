import { Box3 } from "three";
import { hullBounds, type CollisionHull } from "./geometry";

const ENDPOINT_SLACK = 0.005;
const PLANE_SLACK = 1e-5;
const radiusCache = new WeakMap<
  CollisionHull,
  { planes: number[]; radius: number | null }
>();
const bits = new DataView(new ArrayBuffer(8));

/** Directed rounding validates the certificate, independently of the solve
 * that proposed its weights. No accurately inverted plane triple is assumed. */
function upward(value: number): number {
  if (value === Infinity) return value;
  if (!Number.isFinite(value)) return Infinity;
  if (value === 0) return Number.MIN_VALUE;
  bits.setFloat64(0, value);
  const word = bits.getBigUint64(0);
  bits.setBigUint64(0, word + (value > 0 ? 1n : -1n));
  return bits.getFloat64(0);
}
function downward(value: number): number {
  return -upward(-value);
}
type Interval = [number, number];
function add(a: Interval, b: Interval): Interval {
  return [downward(a[0] + b[0]), upward(a[1] + b[1])];
}
function multiply(a: Interval, positive: number): Interval {
  return [downward(a[0] * positive), upward(a[1] * positive)];
}
function hypotUpper(values: readonly number[]): number {
  let square = 0;
  for (const value of values) square = upward(square + upward(value * value));
  return upward(Math.sqrt(square));
}

interface Certificate {
  indices: [number, number, number];
  weights: [number, number, number];
  score: number;
}

function certifiedRadius(hull: CollisionHull): number | null {
  const cached = radiusCache.get(hull);
  if (cached && cached.planes.length === hull.faces.length * 4) {
    let unchanged = true;
    for (let i = 0; i < hull.faces.length; i++) {
      const { normal, constant } = hull.faces[i];
      if (
        !Object.is(normal.x, cached.planes[4 * i]) ||
        !Object.is(normal.y, cached.planes[4 * i + 1]) ||
        !Object.is(normal.z, cached.planes[4 * i + 2]) ||
        !Object.is(constant, cached.planes[4 * i + 3])
      ) {
        unchanged = false;
        break;
      }
    }
    if (unchanged) return cached.radius;
  }
  const planes = hull.faces.flatMap((face) => [
    face.normal.x,
    face.normal.y,
    face.normal.z,
    face.constant,
  ]);
  const remember = (radius: number | null) => {
    radiusCache.set(hull, { planes, radius });
    return radius;
  };
  if (!planes.every(Number.isFinite)) return remember(null);
  const certificates: (Certificate | undefined)[] = Array(6).fill(undefined);
  // In three dimensions, a bounded plane volume has a nonnegative dual
  // certificate using at most three normals for each signed coordinate axis.
  // Nonnegative computed weights are sufficient; interval validation below
  // accounts for any residual of the proposed inverse.
  for (let a = 0; a < hull.faces.length; a++)
    for (let b = a + 1; b < hull.faces.length; b++)
      for (let c = b + 1; c < hull.faces.length; c++) {
        const na = hull.faces[a].normal,
          nb = hull.faces[b].normal,
          nc = hull.faces[c].normal;
        const bc = nb.clone().cross(nc),
          ca = nc.clone().cross(na),
          ab = na.clone().cross(nb),
          determinant = na.dot(bc);
        if (!Number.isFinite(determinant) || determinant === 0) continue;
        for (let axis = 0; axis < 3; axis++)
          for (const sign of [1, -1]) {
            const weights: [number, number, number] = [
              (sign * bc.getComponent(axis)) / determinant,
              (sign * ca.getComponent(axis)) / determinant,
              (sign * ab.getComponent(axis)) / determinant,
            ];
            if (
              !weights.every((weight) => Number.isFinite(weight) && weight >= 0)
            )
              continue;
            const score =
              weights[0] * (hull.faces[a].constant + PLANE_SLACK) +
              weights[1] * (hull.faces[b].constant + PLANE_SLACK) +
              weights[2] * (hull.faces[c].constant + PLANE_SLACK);
            const slot = 2 * axis + (sign < 0 ? 1 : 0);
            if (
              Number.isFinite(score) &&
              (!certificates[slot] || score < certificates[slot]!.score)
            )
              certificates[slot] = { indices: [a, b, c], weights, score };
          }
      }
  if (certificates.some((certificate) => !certificate)) return remember(null);
  const bounds = [0, 0, 0],
    errors = [0, 0, 0];
  for (let slot = 0; slot < 6; slot++) {
    const certificate = certificates[slot]!;
    let bound: Interval = [0, 0];
    const normal: Interval[] = [
      [0, 0],
      [0, 0],
      [0, 0],
    ];
    let predicateError = 0;
    for (let term = 0; term < 3; term++) {
      const face = hull.faces[certificate.indices[term]],
        weight = certificate.weights[term];
      if (weight === 0) continue;
      // The plane predicate subtracts a three-term dot product. Its double
      // arithmetic contributes a constant error and a radius-scaled error.
      const arithmetic = 8 * Number.EPSILON;
      const constant = add(
        add([face.constant, face.constant], [PLANE_SLACK, PLANE_SLACK]),
        [0, upward(arithmetic * Math.abs(face.constant))],
      );
      bound = add(bound, multiply(constant, weight));
      predicateError = upward(
        predicateError +
          upward(weight * arithmetic * hypotUpper(face.normal.toArray())),
      );
      for (let axis = 0; axis < 3; axis++) {
        const component = face.normal.getComponent(axis);
        normal[axis] = add(
          normal[axis],
          multiply([component, component], weight),
        );
      }
    }
    const axis = Math.floor(slot / 2),
      sign = slot % 2 ? -1 : 1;
    const residual = normal.map(([low, high], component) => {
      const target = component === axis ? sign : 0;
      return Math.max(
        Math.abs(downward(target - high)),
        Math.abs(upward(target - low)),
      );
    });
    bounds[axis] = Math.max(bounds[axis], bound[1]);
    errors[axis] = Math.max(
      errors[axis],
      upward(hypotUpper(residual) + predicateError),
    );
  }
  // |h_j| <= B_j + E_j |h| implies |h| <= |B|/(1-|E|).
  const error = hypotUpper(errors),
    denominator = downward(1 - error),
    radius = upward(hypotUpper(bounds) / denominator);
  return remember(denominator > 0 && Number.isFinite(radius) ? radius : null);
}

/** Conservative STATIC-face discovery envelope for sweepHullTriangle.
 * Keep the caller's original cell/Y traversal and ordering; null requests its
 * legacy broad candidates. This does not describe moving-owner relative CCD.
 */
export function worldFaceSweepEnvelope(
  old: CollisionHull,
  next: CollisionHull,
): Box3 | null {
  const endpoints = hullBounds(old).union(hullBounds(next));
  if (
    endpoints.isEmpty() ||
    ![...endpoints.min.toArray(), ...endpoints.max.toArray()].every(
      Number.isFinite,
    )
  )
    return null;
  let longestEdge = 0;
  for (const [a, b] of old.edges) {
    if (!old.vertices[a] || !old.vertices[b]) return null;
    longestEdge = Math.max(
      longestEdge,
      old.vertices[a].distanceTo(old.vertices[b]),
    );
  }
  const magnitude = Math.max(
    1,
    ...endpoints.min.toArray().map(Math.abs),
    ...endpoints.max.toArray().map(Math.abs),
  );
  // Recovery's clamped Float32 fraction stays in [0,1], but its plane residual
  // can grow by a half-ULP of that fraction times the old edge length.
  const allowance = upward(
    ENDPOINT_SLACK + longestEdge * 2 ** -24 + 128 * Number.EPSILON * magnitude,
  );
  endpoints.expandByScalar(allowance);
  const local = old.localHull;
  if (!local) return old.faces.length === 0 ? endpoints : null;
  if (local.faces.length === 0) return endpoints;
  if (!old.position || !next.position || !old.orientation || !next.orientation)
    return null;
  const q0 = old.orientation,
    q1 = next.orientation;
  if (
    ![
      ...old.position.toArray(),
      ...next.position.toArray(),
      ...q0.toArray(),
      ...q1.toArray(),
    ].every(Number.isFinite)
  )
    return null;
  const norm0 = q0.lengthSq(),
    norm1 = q1.lengthSq();
  if (
    Math.abs(norm0 - 1) > 64 * Number.EPSILON ||
    Math.abs(norm1 - 1) > 64 * Number.EPSILON
  )
    return null;
  // Lower-bound cos(theta/2); the absolute quaternion dot handles q and -q.
  // Near pi the inverse-frame interpolation can be singular/unbounded.
  const cosine = downward(
    Math.min(1, Math.abs(q0.dot(q1)) / Math.sqrt(norm0 * norm1)) -
      32 * Number.EPSILON,
  );
  // The permitted quaternion norm error and the vector/quaternion operations
  // perturb the inverse-frame matrices. Subtract their operation-count bound
  // from the smallest singular value, rather than padding only after inversion.
  const matrixError = 512 * Number.EPSILON,
    inverseDenominator = downward(cosine - matrixError);
  if (!(inverseDenominator > Math.sqrt(Number.EPSILON))) return null;
  const radius = certifiedRadius(local);
  if (radius === null) return null;
  const sine = upward(
      upward(Math.sqrt(upward(1 - downward(cosine * cosine)))) + matrixError,
    ),
    distance = hypotUpper(next.position.clone().sub(old.position).toArray()),
    reach = upward(
      upward(upward(radius + matrixError * magnitude) / inverseDenominator) +
        upward((0.5 * distance * sine) / inverseDenominator),
    );
  // For M=(1-t)R0^-1+tR1^-1, accepted h gives
  // w=p(t)+M^-1[h-t(1-t)(R0^-1-R1^-1)(p1-p0)].
  // ||M^-1|| <= sec(theta/2), yielding r*sec + |dp|*tan/2.
  const rounding = 128 * Number.EPSILON * Math.max(magnitude, reach);
  if (!Number.isFinite(reach + allowance + rounding)) return null;
  const inverseEnvelope = new Box3()
    .setFromPoints([old.position, next.position])
    .expandByScalar(upward(reach + allowance + rounding));
  return endpoints.union(inverseEnvelope);
}
