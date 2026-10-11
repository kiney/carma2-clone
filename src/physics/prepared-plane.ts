export type NativePreparedPlaneVector = readonly [number, number, number];

export interface NativePreparedFacePlane {
  normal: [number, number, number];
  /** Prepared D precedes the normal component clamp and is not recomputed. */
  d: number;
  degenerate: boolean;
}

const f = Math.fround;
const lowerClamp = -0.9999998807907104;

function vector(input: NativePreparedPlaneVector): [number, number, number] {
  if (
    input.length !== 3 ||
    ![0, 1, 2].every(
      (i) => Number.isFinite(input[i]) && Number.isFinite(f(input[i])),
    )
  )
    throw new Error("Prepared face plane requires finite Float32 vertices");
  return [f(input[0]), f(input[1]), f(input[2])];
}

/** Installed full model preparation: 5365f0 plane arithmetic, then the
 * 51f361..51f40c normal clamps. Vertices must be original model-local positions;
 * prepared-vertex pivot subtraction is a separate caller operation. */
export function prepareNativeModelFacePlane(
  a: NativePreparedPlaneVector,
  b: NativePreparedPlaneVector,
  c: NativePreparedPlaneVector,
): NativePreparedFacePlane {
  const p = vector(a),
    q = vector(b),
    r = vector(c);
  const ax = f(q[0] - p[0]),
    ay = f(q[1] - p[1]),
    az = f(q[2] - p[2]);
  const bxLive = r[0] - p[0],
    byLive = r[1] - p[1],
    bzLive = r[2] - p[2];
  const bx = f(bxLive),
    by = f(byLive);
  // Native spills are deliberately asymmetric; do not round every difference
  // or every cross-product operation as if these were separate C assignments.
  let nx = f(bzLive * ay - byLive * az);
  const nyLive = bxLive * az - bzLive * ax;
  let ny = f(nyLive);
  const nzLive = by * ax - bx * ay;
  let nz = f(nzLive);
  const squaredLength = f(nx * nx + nyLive * ny + nzLive * nz);
  const length = Math.sqrt(squaredLength);
  const degenerate = length === 0 || Number.isNaN(length);
  if (degenerate) {
    nx = 0;
    ny = 0;
    nz = 1;
  } else {
    const inverseLength = 1 / length;
    nx *= inverseLength;
    ny *= inverseLength;
    nz *= inverseLength;
  }
  // D uses live normalized components, before either their Float32 store or
  // the later br_face normal clamp. Preserve the source Z+Y, then X order.
  const d = f(nz * p[2] + ny * p[1] + nx * p[0]);
  const normal = [nx, ny, nz].map((component) => {
    const stored = f(component);
    return stored <= -1 ? lowerClamp : stored >= 1 ? 1 : stored;
  }) as [number, number, number];
  if (!Number.isFinite(d) || !normal.every(Number.isFinite))
    throw new Error("Prepared face plane arithmetic requires a finite result");
  return { normal, d, degenerate };
}
