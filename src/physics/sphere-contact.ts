/** Independent installed PHIL sphere mathematics. See docs/c2-sphere-contact-re.md.
 * Points are MODEL-local or in the caller's explicitly chosen reference frame.
 * Primitive normals point moving sphere -> static feature, except world faces,
 * whose normal points world face -> sphere, matching the installed routines. */
import { Vector3 } from "three";
import type { PedBounds, PedVector } from "../ped-form";
import type { HullContact } from "./geometry";

export interface NativeSphereData {
  radius: number;
  center: PedVector;
  radiusSquared: number;
}
export interface NativeSphereHit {
  fraction: number;
  normal: PedVector;
  /** Static feature point, when the installed routine produces one. */
  point?: PedVector;
  featureIndex?: number;
}
export interface NativeSpherePlane {
  /** Inward unit normal; the interior satisfies normal.dot(x)+offset >= 0. */
  normal: PedVector;
  offset: number;
}
export interface NativeSphereWorldFace {
  a: PedVector;
  b: PedVector;
  c: PedVector;
  /** Source cached normal and plane equation normal.dot(x)=constant. */
  normal: PedVector;
  constant: number;
  materialIdentifier?: string;
  /** Undefined represents the native NULL material, which rejects backfaces. */
  materialFlags?: number;
  faceFlags?: number;
  faceFriction?: number;
  sourceSurface?: import("../world").Surface;
}
export interface NativeSphereBodyPose {
  sphere: NativeSphereData;
  /** Native12: three basis rows followed by the translation row. No scaling. */
  oldPose: ArrayLike<number>;
  predictedPose: ArrayLike<number>;
}
const f = Math.fround;
const tinyMotionSquared = 1e-6;
const tinyNormal = 2 ** -22;
const margin = f(0.002);
function scalar(n: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(f(n)))
    throw new Error("PHIL SPHERE: non-finite scalar");
  return f(n);
}
function vec(v: PedVector): PedVector {
  if (v.length !== 3)
    throw new Error("PHIL SPHERE: expected three-value vector");
  return [scalar(v[0]), scalar(v[1]), scalar(v[2])];
}
function sphere(s: NativeSphereData): NativeSphereData {
  const radius = scalar(s.radius),
    radiusSquared = scalar(s.radiusSquared);
  if (radius <= 0 || radiusSquared <= 0 || radiusSquared !== f(radius * radius))
    throw new Error("PHIL SPHERE: invalid source radius/radiusSquared");
  return { radius, radiusSquared, center: vec(s.center) };
}
function sub(a: PedVector, b: PedVector): PedVector {
  return [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2])];
}
function dot(a: PedVector, b: PedVector): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function addScaled(a: PedVector, b: PedVector, t: number): PedVector {
  return [f(a[0] + b[0] * t), f(a[1] + b[1] * t), f(a[2] + b[2] * t)];
}
function normalize(v: PedVector, spillLength = false): PedVector {
  const length = spillLength ? f(Math.sqrt(dot(v, v))) : Math.sqrt(dot(v, v));
  return length > tinyNormal
    ? [f(v[0] / length), f(v[1] / length), f(v[2] / length)]
    : [1, 0, 0];
}
function bounds(b: PedBounds): PedBounds {
  const min = vec(b.min),
    max = vec(b.max);
  if (min.some((v, i) => v > max[i]))
    throw new Error("PHIL SPHERE: inverted bounds");
  return { min, max };
}
function unit(v: PedVector): PedVector {
  const n = vec(v);
  if (Math.abs(dot(n, n) - 1) > 0.0001)
    throw new Error("PHIL SPHERE: expected authored unit normal");
  return n;
}
/** 45dae0/45dd60. Relative old/new moving centers are expressed in static
 * sphere's MODEL frame. Resting fallback tests END only, in a strict outer shell. */
export function nativeSphereSphereSweep(
  staticSphere: NativeSphereData,
  movingSphere: NativeSphereData,
  oldCenter: PedVector,
  predictedCenter: PedVector,
): NativeSphereHit | null {
  const a = sphere(staticSphere),
    b = sphere(movingSphere),
    start = vec(oldCenter),
    end = vec(predictedCenter),
    motion = sub(end, start),
    p = sub(start, a.center),
    speedSquared = f(dot(motion, motion)),
    radius = f(a.radius + b.radius);
  const stationary = (): NativeSphereHit | null => {
    const n = sub(a.center, end),
      d2 = f(dot(n, n));
    if (!(d2 < (radius + margin) ** 2 && d2 > radius * radius)) return null;
    return { fraction: 1, normal: normalize(n) };
  };
  if (speedSquared < tinyMotionSquared) return stationary();
  const closestTimeExtended = -dot(p, motion) / speedSquared,
    closestTime = f(closestTimeExtended),
    closestSquared = f(
      dot(p, p) - speedSquared * closestTimeExtended * closestTime,
    );
  if ((radius + 0.002) ** 2 < closestSquared) return null;
  if (closestSquared > radius * radius) return stationary();
  const fraction = f(
    closestTime - Math.sqrt((radius * radius - closestSquared) / speedSquared),
  );
  if (fraction < 0 || fraction > 1) return stationary();
  const n: PedVector = [
    f(-p[0] - fraction * motion[0]),
    f(-p[1] - fraction * motion[1]),
    f(-p[2] - fraction * motion[2]),
  ];
  return { fraction, normal: normalize(n, true) };
}
/** 45e520, endpoint cap of the edge sweep. It has no resting fallback. */
export function nativeSpherePointSweep(
  point: PedVector,
  s: NativeSphereData,
  oldCenter: PedVector,
  predictedCenter: PedVector,
): NativeSphereHit | null {
  const source = sphere(s),
    p = vec(point),
    start = vec(oldCenter),
    end = vec(predictedCenter),
    motion = sub(end, start),
    w = sub(p, start),
    a = f(dot(motion, motion));
  if (a === 0) return null;
  const closestTimeExtended = dot(w, motion) / a,
    closestTime = f(closestTimeExtended),
    closestSquared = f(dot(w, w) - closestTimeExtended * closestTime * a);
  if (closestSquared > source.radiusSquared) return null;
  const fraction = f(
    closestTime - Math.sqrt((source.radiusSquared - closestSquared) / a),
  );
  if (fraction < 0 || fraction > 1) return null;
  const n: PedVector = [
    f(p[0] - (start[0] + fraction * motion[0])),
    f(p[1] - (start[1] + fraction * motion[1])),
    f(p[2] - (start[2] + fraction * motion[2])),
  ];
  return { fraction, point: p, normal: normalize(n) };
}
/** 45de20/45e3a0. Endpoint bit80 suppresses moving caps; the native resting
 * helper still tests the clamped nearest endpoint without checking those bits. */
export function nativeSphereEdgeSweep(
  edgeA: PedVector,
  edgeB: PedVector,
  s: NativeSphereData,
  oldCenter: PedVector,
  predictedCenter: PedVector,
  endpointFlagsA = 0,
  endpointFlagsB = 0,
): NativeSphereHit | null {
  const source = sphere(s),
    a = vec(edgeA),
    b = vec(edgeB),
    start = vec(oldCenter),
    end = vec(predictedCenter),
    edge = sub(b, a),
    e2 = f(dot(edge, edge));
  if (!(e2 > 0)) throw new Error("PHIL SPHERE: degenerate source edge");
  const stationary = (): NativeSphereHit | null => {
    const u = f(dot(sub(end, a), edge) / e2),
      point = u <= 0 ? a : u >= 1 ? b : addScaled(a, edge, u),
      n = sub(point, end),
      d2 = f(dot(n, n));
    if (
      !(
        d2 > source.radiusSquared &&
        d2 < source.radiusSquared + source.radius * margin * 2
      )
    )
      return null;
    return { fraction: 1, point, normal: normalize(n) };
  };
  const motion = sub(end, start),
    parallel = f(dot(edge, motion) / e2),
    along: PedVector = [
      f(edge[0] * parallel),
      f(edge[1] * parallel),
      f(edge[2] * parallel),
    ],
    perpendicular = sub(motion, along),
    w = sub(a, start),
    wParallel = f(-dot(w, edge) / e2),
    perpendicularW = addScaled(w, edge, wParallel),
    perpendicular2 = f(dot(perpendicular, perpendicular));
  if (perpendicular2 < tinyMotionSquared) return stationary();
  const closestTime = f(dot(perpendicularW, perpendicular) / perpendicular2),
    sx = perpendicular[0] * closestTime,
    sy = perpendicular[1] * closestTime,
    sz = perpendicular[2] * closestTime,
    closestSquared = f(
      dot(perpendicularW, perpendicularW) - (sx * f(sx) + sy * f(sy) + sz * sz),
    );
  if (closestSquared > source.radiusSquared + source.radius * margin * 2)
    return null;
  if (closestSquared > source.radiusSquared) return stationary();
  const fraction = f(
      closestTime -
        Math.sqrt((source.radiusSquared - closestSquared) / perpendicular2),
    ),
    // Preserve the native projection's Float32 products before dividing by e2.
    offset: PedVector = [
      f(along[0] * fraction + perpendicularW[0] - w[0]),
      f(along[1] * fraction + perpendicularW[1] - w[1]),
      f(along[2] * fraction + perpendicularW[2] - w[2]),
    ],
    u = dot(offset, edge) / e2;
  if (u < 0 || u > 1) {
    const flags = u < 0 ? endpointFlagsA : endpointFlagsB;
    const hit =
      (flags & 0x80) === 0
        ? nativeSpherePointSweep(u < 0 ? a : b, source, start, end)
        : null;
    return hit ?? stationary();
  }
  if (fraction < 0 || fraction > 1) return stationary();
  const point = addScaled(a, offset, 1),
    n: PedVector = [
      f(point[0] - (start[0] + fraction * motion[0])),
      f(point[1] - (start[1] + fraction * motion[1])),
      f(point[2] - (start[2] + fraction * motion[2])),
    ];
  return { fraction, point, normal: normalize(n) };
}

export interface NativeLineSphereResult {
  /** Native -1=start inside,0=miss,1=sweep,2=END resting outer shell. */
  code: -1 | 0 | 1 | 2;
  hit: NativeSphereHit | null;
}
/** 4616b0 -> 461460. Vertex-vs-sphere pair pass; start-inside marks vertex FF. */
export function nativeLineSphereCollide(
  startInput: PedVector,
  endInput: PedVector,
  input: NativeSphereData,
): NativeLineSphereResult {
  const s = sphere(input),
    start = vec(startInput),
    end = vec(endInput),
    w = sub(s.center, start),
    start2 = f(dot(w, w));
  if (start2 < s.radiusSquared) return { code: -1, hit: null };
  const motion = sub(end, start),
    a = f(dot(motion, motion));
  if (a >= tinyMotionSquared) {
    const closestTime = dot(w, motion) / a,
      closestSquared = start2 - closestTime * closestTime * a;
    if (closestSquared <= s.radiusSquared) {
      const fraction = f(
        closestTime - Math.sqrt((s.radiusSquared - closestSquared) / a),
      );
      if (fraction >= 0 && fraction <= 1) {
        const point = addScaled(start, motion, fraction);
        return {
          code: 1,
          hit: { fraction, point, normal: normalize(sub(s.center, point)) },
        };
      }
    }
  }
  const n = sub(s.center, end),
    d2 = f(dot(n, n));
  if (
    d2 > s.radiusSquared &&
    d2 <= s.radiusSquared + s.radiusSquared * margin * 2
  ) {
    const normal = normalize(n);
    return {
      code: 2,
      hit: {
        fraction: 1,
        normal,
        point: addScaled(s.center, normal, s.radius),
      },
    };
  }
  return { code: 0, hit: null };
}

/** 45e9e0. Axis-major min then max finite BOX faces. Normals point into BOX.
 * The near-shell branch returns END center itself; ordinary sweep returns the
 * sphere surface point. This differs from POLY and is deliberately preserved. */
export function nativeSphereBoxFaceSweep(
  input: NativeSphereData,
  inputBounds: PedBounds,
  oldCenter: PedVector,
  predictedCenter: PedVector,
): NativeSphereHit | null {
  const s = sphere(input),
    box = bounds(inputBounds),
    start = vec(oldCenter),
    end = vec(predictedCenter);
  for (let axis = 0; axis < 3; axis++) {
    if (
      (start[axis] > box.max[axis] + s.radius + 0.002 &&
        end[axis] > box.max[axis] + s.radius + 0.002) ||
      (start[axis] < box.min[axis] - s.radius - 0.002 &&
        end[axis] < box.min[axis] - s.radius - 0.002)
    )
      return null;
  }
  for (let axis = 0; axis < 3; axis++) {
    for (const side of [1, -1]) {
      const boundary = f(
          side > 0 ? box.min[axis] - s.radius : box.max[axis] + s.radius,
        ),
        outside = side > 0 ? start[axis] < boundary : start[axis] > boundary,
        reaches =
          side > 0
            ? end[axis] > boundary - 0.002
            : end[axis] < boundary + 0.002;
      if (!outside || !reaches) continue;
      const remainsOutside =
        side > 0 ? end[axis] <= boundary : end[axis] >= boundary;
      let point: PedVector, fraction: number;
      const n: [number, number, number] = [0, 0, 0];
      n[axis] = side;
      if (remainsOutside) {
        fraction = 1;
        point = end;
      } else {
        fraction = f((boundary - start[axis]) / (end[axis] - start[axis]));
        const tComplement = f(1 - fraction),
          partial: PedVector = [
            f(start[0] * tComplement),
            f(start[1] * tComplement),
            f(start[2] * tComplement),
          ];
        point = [
          f(partial[0] + end[0] * fraction),
          f(partial[1] + end[1] * fraction),
          f(partial[2] + end[2] * fraction),
        ];
        const q = [...point] as [number, number, number];
        q[axis] = f(q[axis] + side * s.radius);
        point = q;
      }
      if (
        point.every(
          (v, i) => i === axis || (v >= box.min[i] && v <= box.max[i]),
        )
      )
        return {
          fraction,
          normal: n,
          point,
          featureIndex: axis * 2 + (side < 0 ? 1 : 0),
        };
    }
  }
  return null;
}
/** 45e700. Source plane order, inward normals and strictly positive OTHER
 * plane tests at the sphere surface point. The adapter rejects a plane list exceeding the bounded native workspace. */
export function nativeSpherePolyFaceSweep(
  input: NativeSphereData,
  inputPlanes: readonly NativeSpherePlane[],
  oldCenter: PedVector,
  predictedCenter: PedVector,
): NativeSphereHit | null {
  if (!inputPlanes.length || inputPlanes.length > 124)
    throw new Error("PHIL SPHERE: invalid source POLY plane count");
  const s = sphere(input),
    planes = inputPlanes.map((p) => ({
      normal: unit(p.normal),
      offset: scalar(p.offset),
    })),
    start = vec(oldCenter),
    end = vec(predictedCenter),
    oldDistances = planes.map((p) =>
      f(dot(p.normal, start) + s.radius + p.offset),
    ),
    newDistances = planes.map((p) =>
      f(dot(p.normal, end) + s.radius + p.offset),
    );
  if (
    planes.some((_, i) => oldDistances[i] < -0.002 && newDistances[i] < -0.002)
  )
    return null;
  for (let i = 0; i < planes.length; i++) {
    const oldD = oldDistances[i],
      newD = newDistances[i],
      n = planes[i].normal;
    if (!(newD > -0.002) || !(oldD < 0)) continue;
    const fraction = newD < 0 ? 1 : f(-oldD / (newD - oldD));
    const point0: PedVector =
      newD < 0
        ? end
        : [
            f(f(start[0] * (1 - fraction)) + end[0] * fraction),
            f(f(start[1] * (1 - fraction)) + end[1] * fraction),
            f(f(start[2] * (1 - fraction)) + end[2] * fraction),
          ];
    const point = addScaled(point0, n, s.radius);
    if (planes.every((p, j) => j === i || dot(p.normal, point) + p.offset > 0))
      return { fraction, normal: n, point, featureIndex: i };
  }
  return null;
}
function insideWorldTriangle(
  q: PedVector,
  a: PedVector,
  b: PedVector,
  c: PedVector,
  n: PedVector,
): boolean {
  let dropped = 0;
  if (Math.abs(n[0]) < Math.abs(n[1])) dropped = 1;
  if (Math.abs(n[dropped]) < Math.abs(n[2])) dropped = 2;
  const axes = [0, 1, 2].filter((i) => i !== dropped),
    x = axes[0],
    y = axes[1],
    bx = f(b[x] - a[x]),
    by = f(b[y] - a[y]),
    cx = f(c[x] - a[x]),
    cy = f(c[y] - a[y]),
    qx = f(q[x] - a[x]),
    qy = f(q[y] - a[y]),
    denominator = f(cx * by - cy * bx),
    numerator = f(qx * by - qy * bx);
  if (Math.abs(numerator) > 1.001 * Math.abs(denominator) || denominator === 0)
    return false;
  const u = f(numerator / denominator);
  if (u < -0.0001) return false;
  const denominator2 = f(bx * cy - by * cx),
    numerator2 = f(qx * cy - qy * cx);
  if (
    Math.abs(numerator2) > 1.001 * Math.abs(denominator2) ||
    denominator2 === 0
  )
    return false;
  const v = numerator2 / denominator2;
  return v >= -0.0001 && u + v <= 1.0001;
}
/** 45ed50. World finite triangle; NULL material rejects backfaces. The installed
 * backface quotient reuses SIGNED old distance; it is not symmetrized here. */
export function nativeSphereWorldFaceSweep(
  input: NativeSphereData,
  inputFace: NativeSphereWorldFace,
  oldCenter: PedVector,
  predictedCenter: PedVector,
): NativeSphereHit | null {
  const s = sphere(input),
    face = {
      ...inputFace,
      a: vec(inputFace.a),
      b: vec(inputFace.b),
      c: vec(inputFace.c),
      normal: unit(inputFace.normal),
      constant: scalar(inputFace.constant),
    },
    start = vec(oldCenter),
    end = vec(predictedCenter);
  if (/^[!>?]/.test(face.materialIdentifier ?? "")) return null;
  const d0 = f(dot(face.normal, start) - face.constant),
    back = d0 < 0;
  if (
    back
      ? d0 > -s.radius ||
        face.materialFlags === undefined ||
        !(face.materialFlags & 0x1000)
      : d0 < s.radius
  )
    return null;
  const n: PedVector = back
      ? [-face.normal[0], -face.normal[1], -face.normal[2]]
      : face.normal,
    d1 = dot(n, end) + (back ? face.constant : -face.constant);
  if (d1 > s.radius + 0.002) return null;
  const quotient = f((s.radius - d0) / (d1 - d0)),
    fraction = quotient > 1 ? 1 : quotient >= 0 ? quotient : 0,
    motion = sub(end, start),
    interpolated: PedVector = [
      f(start[0] + f(motion[0] * fraction)),
      f(start[1] + f(motion[1] * fraction)),
      f(start[2] + f(motion[2] * fraction)),
    ],
    planeDistance = f(dot(sub(face.a, interpolated), n)),
    q = addScaled(interpolated, n, planeDistance);
  return insideWorldTriangle(q, face.a, face.b, face.c, n)
    ? { fraction, normal: n }
    : null;
}

function pose(input: ArrayLike<number>): Float32Array {
  if (input.length !== 12)
    throw new Error("PHIL SPHERE: expected native12 pose");
  const m = Float32Array.from(input, scalar);
  for (let i = 0; i < 3; i++) {
    unit([m[i * 3], m[i * 3 + 1], m[i * 3 + 2]]);
    for (let j = i + 1; j < 3; j++)
      if (
        Math.abs(
          m[i * 3] * m[j * 3] +
            m[i * 3 + 1] * m[j * 3 + 1] +
            m[i * 3 + 2] * m[j * 3 + 2],
        ) > 0.0001
      )
        throw new Error("PHIL SPHERE: scaled/sheared sphere pose unsupported");
  }
  return m;
}
function rotate(m: ArrayLike<number>, v: PedVector): PedVector {
  return [
    f(m[0] * v[0] + m[3] * v[1] + m[6] * v[2]),
    f(m[1] * v[0] + m[4] * v[1] + m[7] * v[2]),
    f(m[2] * v[0] + m[5] * v[1] + m[8] * v[2]),
  ];
}
function inverseRotate(m: ArrayLike<number>, v: PedVector): PedVector {
  return [
    f(m[0] * v[0] + m[1] * v[1] + m[2] * v[2]),
    f(m[3] * v[0] + m[4] * v[1] + m[5] * v[2]),
    f(m[6] * v[0] + m[7] * v[1] + m[8] * v[2]),
  ];
}
function transform(m: ArrayLike<number>, v: PedVector): PedVector {
  return addScaled([m[9], m[10], m[11]], rotate(m, v), 1);
}
/** Validated source Float32 center transforms, shared with guard-only callers. */
export function nativeSphereCenters(input: NativeSphereBodyPose): {
  old: PedVector;
  predicted: PedVector;
} {
  const s = sphere(input.sphere);
  return {
    old: transform(pose(input.oldPose), s.center),
    predicted: transform(pose(input.predictedPose), s.center),
  };
}
function inverseTransform(m: ArrayLike<number>, v: PedVector): PedVector {
  return inverseRotate(m, sub(v, [m[9], m[10], m[11]]));
}
function blend(a: PedVector, b: PedVector, t: number): PedVector {
  return [
    f(a[0] * (1 - t) + f(b[0] * t)),
    f(a[1] * (1 - t) + f(b[1] * t)),
    f(a[2] * (1 - t) + f(b[2] * t)),
  ];
}
const three = (v: PedVector) => new Vector3(...v);
/** 42640f..42669f. Independent old-frame surface points; source inline branch
 * blends normals without an additional normalize. COM subtraction is solver-owned. */
export function nativeSphereSphereContact(
  aInput: NativeSphereBodyPose,
  bInput: NativeSphereBodyPose,
): HullContact | null {
  const a = sphere(aInput.sphere),
    b = sphere(bInput.sphere),
    aOld = pose(aInput.oldPose),
    aNew = pose(aInput.predictedPose),
    bOld = pose(bInput.oldPose),
    bNew = pose(bInput.predictedPose),
    start = inverseTransform(aOld, transform(bOld, b.center)),
    end = inverseTransform(aNew, transform(bNew, b.center)),
    hit = nativeSphereSphereSweep(a, b, start, end);
  if (!hit) return null;
  const pointA = addScaled(a.center, hit.normal, -a.radius),
    normal = blend(
      rotate(aOld, hit.normal),
      rotate(aNew, hit.normal),
      hit.fraction,
    ),
    bLocalNormal = blend(
      inverseRotate(bOld, normal),
      inverseRotate(bNew, normal),
      hit.fraction,
    ),
    pointB = addScaled(b.center, bLocalNormal, b.radius);
  return {
    normal: three(normal),
    points: [three(transform(aOld, pointA))],
    pointsB: [three(transform(bOld, pointB))],
    penetration: 0,
    fraction: hit.fraction,
    measures: [hit.fraction],
    contactTypes: [7],
  };
}
/** 422800 tag4 and423b50/423c30: earliest finite face then source-order edges.
 * Returns candidates for existing per-shape and object-wide native row reduction.
 * placementStart is the explicit world COM override used by placement mode. */
export function nativeSphereWorldContacts(
  input: NativeSphereBodyPose,
  faces: readonly NativeSphereWorldFace[],
  options: { placementStart?: PedVector; edgeOnly?: boolean } = {},
): HullContact[] {
  if (faces.length > 65535)
    throw new Error("PHIL SPHERE: source uint16 cached face span exceeded");
  const s = sphere(input.sphere),
    old = pose(input.oldPose),
    predicted = pose(input.predictedPose),
    start = options.placementStart
      ? vec(options.placementStart)
      : transform(old, s.center),
    end = transform(predicted, s.center),
    result: HullContact[] = [];
  let best: { hit: NativeSphereHit; face: NativeSphereWorldFace } | null = null;
  if (!options.edgeOnly)
    for (const face of faces) {
      const hit = nativeSphereWorldFaceSweep(s, face, start, end);
      if (hit && (!best || hit.fraction < best.hit.fraction))
        best = { hit, face };
    }
  const emit = (
    hit: NativeSphereHit,
    face: NativeSphereWorldFace,
    edge: boolean,
  ) => {
    const outward: PedVector = edge
        ? [-hit.normal[0], -hit.normal[1], -hit.normal[2]]
        : hit.normal,
      oldLocal = inverseRotate(old, outward),
      pointNormal = edge
        ? normalize(
            blend(oldLocal, inverseRotate(predicted, outward), hit.fraction),
          )
        : oldLocal,
      localPoint = addScaled(s.center, pointNormal, -s.radius);
    result.push({
      normal: three(rotate(old, oldLocal)),
      points: [three(transform(old, localPoint))],
      penetration: 0,
      fraction: hit.fraction,
      measures: [hit.fraction],
      contactTypes: [edge ? 4 : 3],
      faceFriction: face.faceFriction,
      sourceSurface: face.sourceSurface,
    });
  };
  if (best) emit(best.hit, best.face, false);
  for (const face of faces) {
    const flags = face.faceFlags ?? 0;
    if (flags & 0x80) continue;
    const vertices = [face.a, face.b, face.c];
    for (let i = 0; i < 3; i++)
      if (!(flags & (1 << i))) {
        const hit = nativeSphereEdgeSweep(
          vertices[i],
          vertices[(i + 1) % 3],
          s,
          start,
          end,
        );
        if (hit) emit(hit, face, true);
      }
  }
  return result;
}

export type NativeSphereTargetShape =
  | { type: "BOX"; bounds: PedBounds }
  | {
      type: "POLY" | "WIREPOLY";
      bounds: PedBounds;
      vertices: readonly PedVector[];
      edges: readonly (readonly [number, number])[];
      planes: readonly NativeSpherePlane[];
    }
  | {
      type: "WIRE";
      bounds: PedBounds;
      vertices: readonly PedVector[];
      edges: readonly (readonly [number, number])[];
    };
export interface NativeSphereTargetPose {
  shape: NativeSphereTargetShape;
  oldPose: ArrayLike<number>;
  predictedPose: ArrayLike<number>;
}
export interface NativeSpherePairContact extends HullContact {
  /** Source row+10, independent of fraction/sort key; vertex rows carry zero. */
  sourceProjectedDrift: number;
  /** Installed face/edge emitter reverses native object order. Public output
   * always uses sphere A and target B, with normal B -> A. */
  sourceObjectOrder: "sphere-target" | "target-sphere";
}
const boxSourceEdges: readonly (readonly [number, number])[] = [
  [0, 1],
  [2, 3],
  [4, 5],
  [6, 7],
  [0, 2],
  [1, 3],
  [4, 6],
  [5, 7],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];
function targetFeatures(input: NativeSphereTargetShape) {
  const bb = bounds(input.bounds);
  if (input.type === "BOX")
    return {
      bounds: bb,
      vertices: Array.from(
        { length: 8 },
        (_, i): PedVector => [
          i & 2 ? bb.min[0] : bb.max[0],
          i & 1 ? bb.min[1] : bb.max[1],
          i & 4 ? bb.min[2] : bb.max[2],
        ],
      ),
      edges: boxSourceEdges,
    };
  if (!["POLY", "WIRE", "WIREPOLY"].includes(input.type))
    throw new Error("PHIL SPHERE: unsupported target shape tag");
  // 426920 flags begin+104; source BOX temporary vertices begin+174. Reject
  // oversized supplied arrays rather than silently truncating feature indices.
  if (
    !input.vertices.length ||
    input.vertices.length > 112 ||
    input.edges.length > 65535
  )
    throw new Error("PHIL SPHERE: target feature workspace exceeded");
  const vertices = input.vertices.map(vec);
  for (const pair of input.edges) {
    if (
      pair.length !== 2 ||
      pair.some((i) => !Number.isInteger(i) || i < 0 || i >= vertices.length) ||
      pair[0] === pair[1]
    )
      throw new Error("PHIL SPHERE: invalid source target edge index");
  }
  return { bounds: bb, vertices, edges: input.edges };
}
/** 426920 source passes: target vertices, first accepted BOX/POLY face, then
 * ordered target edges. Results preserve duplicate rows and both objects' OLD
 * points. Feed ALL linked shapes to selectNativeSpherePairContacts once. */
export function nativeSphereTargetContacts(
  sphereInput: NativeSphereBodyPose,
  targetInput: NativeSphereTargetPose,
): NativeSpherePairContact[] {
  const s = sphere(sphereInput.sphere),
    aOld = pose(sphereInput.oldPose),
    aNew = pose(sphereInput.predictedPose),
    bOld = pose(targetInput.oldPose),
    bNew = pose(targetInput.predictedPose),
    features = targetFeatures(targetInput.shape),
    relativeVertices = features.vertices.map((v) => ({
      old: inverseTransform(aOld, transform(bOld, v)),
      predicted: inverseTransform(aNew, transform(bNew, v)),
    })),
    flagBytes = relativeVertices.map((v) => {
      let flags = 0;
      for (let axis = 0; axis < 3; axis++) {
        const min = f(s.center[axis] - s.radius) - f(0.005),
          max = f(s.center[axis] + s.radius) + f(0.005);
        if (v.old[axis] < min && v.predicted[axis] < min) flags |= 1 << axis;
        if (v.old[axis] > max && v.predicted[axis] > max)
          flags |= 1 << (axis + 3);
      }
      return flags;
    });
  if (flagBytes.reduce((a, b) => a & b, 0xff)) return [];
  const result: NativeSpherePairContact[] = [];
  for (let i = 0; i < features.vertices.length; i++) {
    if (flagBytes[i]) continue;
    const v = relativeVertices[i],
      found = nativeLineSphereCollide(v.old, v.predicted, s);
    if (found.code === -1) {
      flagBytes[i] = 0xff;
      continue;
    }
    if (!found.hit) continue;
    const hit = found.hit,
      normal = normalize(
        blend(rotate(aOld, hit.normal), rotate(aNew, hit.normal), hit.fraction),
      );
    result.push({
      normal: three(normal),
      points: [three(transform(aOld, hit.point!))],
      pointsB: [three(transform(bOld, features.vertices[i]))],
      penetration: 0,
      fraction: hit.fraction,
      measures: [hit.fraction],
      contactTypes: [5],
      sourceProjectedDrift: 0,
      sourceObjectOrder: "sphere-target",
    });
  }
  const start = inverseTransform(bOld, transform(aOld, s.center)),
    end = inverseTransform(bNew, transform(aNew, s.center));
  const emit = (hit: NativeSphereHit) => {
    const inwardWorld = normalize(
        blend(rotate(bOld, hit.normal), rotate(bNew, hit.normal), hit.fraction),
      ),
      sphereLocal = normalize(
        blend(
          inverseRotate(aOld, inwardWorld),
          inverseRotate(aNew, inwardWorld),
          hit.fraction,
        ),
      ),
      spherePoint = addScaled(s.center, sphereLocal, s.radius),
      outwardWorld: PedVector = [
        -inwardWorld[0],
        -inwardWorld[1],
        -inwardWorld[2],
      ],
      drift = f(dot(sub(end, start), hit.normal));
    result.push({
      normal: three(outwardWorld),
      points: [three(transform(aOld, spherePoint))],
      pointsB: [three(transform(bOld, hit.point!))],
      penetration: 0,
      fraction: hit.fraction,
      measures: [hit.fraction],
      contactTypes: [8],
      sourceProjectedDrift: drift,
      sourceObjectOrder: "target-sphere",
    });
  };
  const inputShape = targetInput.shape;
  const face =
    inputShape.type === "BOX"
      ? nativeSphereBoxFaceSweep(s, features.bounds, start, end)
      : inputShape.type === "WIRE"
        ? null
        : nativeSpherePolyFaceSweep(s, inputShape.planes, start, end);
  if (face) emit(face);
  for (const [i, j] of features.edges) {
    if (flagBytes[i] & flagBytes[j] & 0x3f) continue;
    // Native marks BOTH endpoints before loading the flags passed to45de20.
    flagBytes[i] |= 0x80;
    flagBytes[j] |= 0x80;
    const hit = nativeSphereEdgeSweep(
      features.vertices[i],
      features.vertices[j],
      s,
      start,
      end,
      flagBytes[i],
      flagBytes[j],
    );
    if (hit) emit(hit);
  }
  return result;
}
/** 426800 four-row insertion (strict earlier fraction, stable ties, NO
 * geometric deduplication), followed by425c00's dot>=.707 retained prefix. */
export function selectNativeSpherePairContacts<T extends HullContact>(
  input: readonly T[],
): T[] {
  const retained: T[] = [];
  for (const hit of input) {
    const fraction = hit.fraction;
    if (
      fraction === undefined ||
      !Number.isFinite(fraction) ||
      fraction < 0 ||
      fraction > 1 ||
      hit.points.length !== 1
    )
      throw new Error("PHIL SPHERE: invalid pair candidate row");
    const before = retained.findIndex((r) => fraction < r.fraction!);
    if (before < 0) retained.push(hit);
    else retained.splice(before, 0, hit);
    if (retained.length > 4) retained.pop();
  }
  if (!retained.length) return retained;
  const stop = retained.findIndex(
    (hit, i) => i > 0 && hit.normal.dot(retained[0].normal) < 0.707,
  );
  return stop < 0 ? retained : retained.slice(0, stop);
}
