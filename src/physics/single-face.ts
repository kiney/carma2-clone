/** Independent installed CheckSingleFace 45f1c0.
 * Evidence: docs/c2-single-face-re.md. This consumes cached vertices/normal,
 * not a recomputed triangle plane or a wheel MultiRay approximation. */
import type { PedVector } from "../ped-form";

export interface NativeSingleFace {
  a: PedVector;
  b: PedVector;
  c: PedVector;
  normal: PedVector;
  /** Retained cached plane metadata. This helper does not read source D;
   * its numerator is normal dot (origin - vertex A). */
  constant?: number;
  /** Undefined is native NULL material, which permits either ray direction.
   * Zero is a present one-sided material. Bits800/1000 permit backfaces. */
  materialFlags?: number;
  materialIdentifier?: string | null;
}
export interface NativeSingleFaceQuery {
  origin: PedVector;
  /** Finite displacement, never a normalized ray plus arbitrary distance. */
  segment: PedVector;
  excludePlingMaterials: boolean;
}
export interface NativeSingleFaceHit {
  parameter: number;
  point: PedVector;
  /** Copied packed normal, negated for a positive denominator. */
  normal: PedVector;
}
const f = Math.fround;
const denominatorMinimum = 2 ** -22;
const floatMaximum = 3.4028234663852886e38;
const lowerBarycentric = -0.0001;
const upperBarycentric = 1.0001;
function scalar(n: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(f(n)))
    throw new Error("CheckSingleFace requires finite Float32 inputs");
  return f(n);
}
function vector(v: PedVector): PedVector {
  if (v.length !== 3) throw new Error("Invalid CheckSingleFace vector");
  return [scalar(v[0]), scalar(v[1]), scalar(v[2])];
}

/** Returns null for source rt=100 rejection. Raw face80/order/best-parameter
 * filtering belongs to 422610 and is deliberately outside this single-face
 * helper. Point and normal are only exposed on an accepted hit. */
export function nativeCheckSingleFace(
  face: NativeSingleFace,
  query: NativeSingleFaceQuery,
): NativeSingleFaceHit | null {
  const a = vector(face.a),
    b = vector(face.b),
    c = vector(face.c),
    n = vector(face.normal),
    origin = vector(query.origin),
    segment = vector(query.segment),
    material = face.materialFlags;
  if (
    material !== undefined &&
    (!Number.isInteger(material) || material < 0 || material > 0xffffffff)
  )
    throw new Error("Invalid CheckSingleFace material flags");
  // Source accumulation is X+Z+Y, then a Float32 store at45f1f9.
  const denominator = f(
    n[0] * segment[0] + n[2] * segment[2] + n[1] * segment[1],
  );
  if (material !== undefined && !(material & 0x1800) && denominator > 0)
    return null;
  if (
    material !== undefined &&
    query.excludePlingMaterials &&
    /^[!>?]/.test(face.materialIdentifier ?? "")
  )
    return null;
  const absoluteDenominator = Math.abs(denominator);
  if (absoluteDenominator < denominatorMinimum) return null;
  // Differences remain live; numerator accumulation is Y+Z+X before its
  // Float32 store at45f298. Packed plane constant is not referenced.
  const numerator = f(
    n[1] * (origin[1] - a[1]) +
      n[2] * (origin[2] - a[2]) +
      n[0] * (origin[0] - a[0]),
  );
  // Inline BadDiv guard,45f288..45f2b9, keeps the quotient in Float32 range.
  if (
    absoluteDenominator < 1 &&
    absoluteDenominator * floatMaximum < Math.abs(numerator)
  )
    return null;
  if (denominator > 0) {
    if (-numerator < 0 || -numerator > denominator + 0.003) return null;
  } else if (numerator < 0 || numerator > 0.003 - denominator) return null;
  const liveParameter = -numerator / denominator;
  if (!Number.isFinite(liveParameter)) return null;
  const parameter = liveParameter > 1 ? 1 : f(liveParameter);
  // Scale and accumulate are separate stores,45f355..45f392.
  const point: PedVector = [0, 1, 2].map((i) =>
    f(f(segment[i] * parameter) + origin[i]),
  ) as [number, number, number];
  if (point.some((n) => !Number.isFinite(n))) return null;
  let drop = Math.abs(n[0]) >= Math.abs(n[1]) ? 0 : 1;
  if (Math.abs(n[2]) > Math.abs(n[drop])) drop = 2;
  const u = drop === 0 ? 1 : 0,
    v = drop === 2 ? 1 : 2;
  const bu = f(b[u] - a[u]),
    bv = b[v] - a[v],
    cu = f(c[u] - a[u]),
    cv = c[v] - a[v],
    pu = f(point[u] - a[u]),
    pv = point[v] - a[v];
  // Installed partial spills45f444..45f4ad. The live first determinant
  // differs from the separately rounded negative second determinant.
  const bvcu = f(bv * cu),
    cvbu = f(cv * bu),
    determinant = cv * bu - bvcu,
    firstNumerator = pv * bu - bv * pu;
  if (Number.isNaN(determinant) || Number.isNaN(firstNumerator)) return null;
  if (Math.abs(firstNumerator) > upperBarycentric * Math.abs(determinant))
    return null;
  const firstDenominator = f(determinant);
  if (firstDenominator === 0) return null;
  const alpha = f(firstNumerator) / firstDenominator;
  if (Number.isNaN(alpha) || alpha < lowerBarycentric) return null;
  const storedAlpha = f(alpha);
  // 45f4fe reverses determinant sign; rec2's beta sign transcription differs.
  const negativeDeterminant = bvcu - cvbu,
    secondNumerator = cu * f(pv) - pu * f(cv);
  if (Number.isNaN(negativeDeterminant) || Number.isNaN(secondNumerator))
    return null;
  if (
    Math.abs(secondNumerator) >
    upperBarycentric * Math.abs(negativeDeterminant)
  )
    return null;
  const secondDenominator = f(negativeDeterminant);
  if (secondDenominator === 0) return null;
  const beta = f(secondNumerator) / secondDenominator;
  if (
    Number.isNaN(beta) ||
    beta < lowerBarycentric ||
    storedAlpha + beta > upperBarycentric
  )
    return null;
  return {
    parameter,
    point,
    normal: denominator > 0 ? [-n[0], -n[1], -n[2]] : n,
  };
}
