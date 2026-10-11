import type { PedBounds, PedVector } from "../ped-form";

const f = Math.fround;
export const NATIVE_PED_SETTLING_GAIN = f(1.39);
export const NATIVE_PED_SETTLING_MINIMUM_SPEED = f(0.1);

export interface NativePedSettlingInput {
  /** Native world units; ordinary moved callback supplies body.worldV. */
  worldVector: PedVector;
  /** First cached world face, not a replacement averaged support normal. */
  firstWorldFaceNormal: PedVector | null;
  /** BRender basis rows followed by translation row, from the root actor. */
  actorMatrix: ArrayLike<number>;
  mass: number;
  inertia: PedVector;
  bounds: PedBounds;
  localOmega: PedVector;
  collisionFlag: boolean;
  doNothing: boolean;
  gain?: number;
  minimumSpeed?: number;
}
export type PedSettlingGate =
  | "applied"
  | "no-collision-or-sleep"
  | "below-minimum-speed"
  | "face-unavailable"
  | "angular-projection";
export interface NativePedSettlingResult {
  localOmega: [number, number, number];
  applied: boolean;
  gate: PedSettlingGate;
  capped: boolean;
  worldAxis?: PedVector;
  localAxis?: PedVector;
}

function scalar(value: number): number {
  const n = f(value);
  if (!Number.isFinite(n)) throw new Error("Non-finite native settling scalar");
  return n;
}
function vector(value: PedVector): [number, number, number] {
  if (value.length !== 3) throw new Error("Invalid native settling vector");
  return [scalar(value[0]), scalar(value[1]), scalar(value[2])];
}
function cross(a: PedVector, b: PedVector): [number, number, number] {
  return [
    scalar(a[1] * b[2] - a[2] * b[1]),
    scalar(a[2] * b[0] - a[0] * b[2]),
    scalar(a[0] * b[1] - a[1] * b[0]),
  ];
}
function safeCross(a: PedVector, b: PedVector): PedVector {
  const axis = cross(a, b);
  // Installed DRVector3SafeCross 403f90: all three strict comparisons.
  if (axis.every((n) => Math.abs(n) < 2.384185791015625e-6)) {
    const [x, y, z] = a.map(Math.abs);
    const unit: PedVector =
      x <= y && x <= z ? [1, 0, 0] : y <= x && y <= z ? [0, 1, 0] : [0, 0, 1];
    return cross(a, unit);
  }
  return axis;
}

/** Installed HW 417fd0. Independent angular settling increment, with native
 * Float32 stores; x87 live expressions use JS doubles. No timestep or RNG.
 * A missing face is a host diagnostic, since native code dereferences faceStart.
 * Evidence and lifecycle: docs/c2-ped-physics-lifecycle-re.md. */
export function settleNativePedBody(
  input: NativePedSettlingInput,
): NativePedSettlingResult {
  const v = vector(input.worldVector),
    omega = vector(input.localOmega),
    inertia = vector(input.inertia),
    min = vector(input.bounds.min),
    max = vector(input.bounds.max),
    mass = scalar(input.mass),
    gain = scalar(input.gain ?? NATIVE_PED_SETTLING_GAIN),
    minimum = scalar(input.minimumSpeed ?? NATIVE_PED_SETTLING_MINIMUM_SPEED);
  if (mass <= 0 || inertia.some((n) => n <= 0) || minimum < 0)
    throw new Error("Invalid native settling body or minimum speed");
  const dimensions = max.map((n, i) => scalar(n - min[i]));
  if (dimensions.some((n) => n <= 0))
    throw new Error("Degenerate native settling bounds");
  if (input.actorMatrix.length !== 12)
    throw new Error("Native settling requires a BRender 4x3 matrix");
  const matrix = Float32Array.from(input.actorMatrix, scalar);
  const unchanged = (gate: PedSettlingGate): NativePedSettlingResult => ({
    localOmega: [...omega],
    applied: false,
    gate,
    capped: false,
  });
  if (!input.collisionFlag && !input.doNothing)
    return unchanged("no-collision-or-sleep");
  // 418024 spills speed squared; the comparison uses its still-live value.
  const speedSquared = v[0] * v[0] + (v[1] * v[1] + v[2] * v[2]);
  if (speedSquared < minimum * minimum) return unchanged("below-minimum-speed");
  if (input.firstWorldFaceNormal === null) return unchanged("face-unavailable");
  const normal = vector(input.firstWorldFaceNormal),
    axis = safeCross(normal, v),
    length = Math.sqrt(
      axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2],
    ),
    worldAxis: PedVector =
      length > 2 ** -22
        ? (axis.map((n) => scalar(n / length)) as [number, number, number])
        : [1, 0, 0];
  // BrMatrix34ApplyTV 532cd0; translation is ignored, rows are dotted with V.
  const localAxis = [0, 1, 2].map((i) =>
    scalar(
      matrix[i * 3] * worldAxis[0] +
        (matrix[i * 3 + 1] * worldAxis[1] + matrix[i * 3 + 2] * worldAxis[2]),
    ),
  ) as [number, number, number];
  const projection =
    omega[0] * localAxis[0] + omega[1] * localAxis[1] + omega[2] * localAxis[2];
  if (projection > 1.5)
    return {
      ...unchanged("angular-projection"),
      worldAxis,
      localAxis,
    };
  const extra = Math.sqrt(scalar(speedSquared)) - minimum,
    k = gain * f(0.1) * extra * mass,
    live = localAxis.map(
      (n, i) =>
        scalar((n * inertia[i]) / (f(0.5) * dimensions[i])) * k + omega[i],
    );
  // Native 4181bb..4181fc multiplies each live component by its stored copy.
  const stored = live.map(scalar),
    norm = live[0] * stored[0] + live[1] * stored[1] + live[2] * stored[2],
    capped = norm > 400;
  let result = stored;
  if (capped) {
    const scale = Math.sqrt(400 / scalar(norm));
    // X/Y remain live on x87, while Z is reloaded from its Float32 spill.
    result = [
      scalar(live[0] * scale),
      scalar(live[1] * scale),
      scalar(stored[2] * scale),
    ];
  }
  return {
    localOmega: result as [number, number, number],
    applied: true,
    gate: "applied",
    capped,
    worldAxis,
    localAxis,
  };
}
