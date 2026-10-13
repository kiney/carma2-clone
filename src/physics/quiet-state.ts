import type { PedBounds, PedVector } from "../ped-form";

const f = Math.fround;
export interface NativeQuietInput {
  previousQuietState: number;
  singleton: boolean;
  collisionFlags: number;
  /** ec after the caller resolves f0/passive-registration flags. */
  doNothing: boolean;
  beforeWorldVelocity: PedVector;
  worldVelocity: PedVector;
  beforeLocalOmega: PedVector;
  localOmega: PedVector;
  /** Solver-maintained +1a8, after normal and friction impulses. */
  localVelocity: PedVector;
  gravityIncrement: PedVector;
  mass: number;
  inertia: PedVector;
  bounds: PedBounds;
  centreOfMass: PedVector;
  /** null for an intact simple pedestrian's absent +18c joint-info pointer. */
  jointInfoOrientationY: number | null;
}
export type NativeQuietGate =
  | "already-do-nothing"
  | "linear-speed"
  | "angular-energy"
  | "upward-speed"
  | "gravity-response"
  | "corner-speed"
  | "joint-without-contact"
  | "quiet";
export interface NativeQuietResult {
  quietEligible: boolean;
  /** Leaf +1df: own quiet bit plus all-descendant quiet bit. */
  quietState: number;
  gate: NativeQuietGate;
  zeroVelocities: {
    worldVelocity: PedVector;
    localOmega: PedVector;
    auxiliaryLocalOmega: PedVector;
  } | null;
  linearSpeedSquared?: number;
  angularEnergy?: number;
  /** The native 0/0 projection compares unordered; no NaN escapes the API. */
  gravityComparisonUnordered?: boolean;
  rejectedCorner?: number;
}

function scalar(value: number): number {
  const result = f(value);
  if (!Number.isFinite(result))
    throw new Error("Non-finite native quiet scalar");
  return result;
}
function byte(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 255)
    throw new Error("Invalid native quiet byte");
  return value;
}
function vector(value: PedVector): [number, number, number] {
  if (value.length !== 3) throw new Error("Invalid native quiet vector");
  return [scalar(value[0]), scalar(value[1]), scalar(value[2])];
}
function cross(a: PedVector, b: PedVector): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Installed 4babcf..4bac06; children=null denotes a leaf, including the
 * native byte multiplication. The caller folds already-evaluated children. */
export function foldNativeQuietHierarchy(
  ownState: number,
  children: readonly number[] | null,
): number {
  const own = byte(ownState);
  if (children === null) return (own * 3) & 255;
  const childStates = children.map(byte);
  return own !== 0
    ? (own + (childStates.every((state) => (state & 2) !== 0) ? 2 : 0)) & 255
    : 0;
}
/** Installed 4ba6cc..4ba6ff. Native traverses the circular contact ring. */
export function canSleepNativeQuietGroup(states: readonly number[]): boolean {
  const values = states.map(byte);
  return values.length > 0 && values.every((state) => (state & 2) !== 0);
}

/** Independent leaf evaluation of installed HW 4ba7a0. Explicit Float32
 * stores are retained; live x87 expressions use JS doubles. No timer/RNG.
 * This only proposes quiet state; the group fold requests ec sleep later.
 * Evidence: docs/c2-ped-physics-lifecycle-re.md. */
export function evaluateNativeQuietLeaf(
  input: NativeQuietInput,
): NativeQuietResult {
  let previous = byte(input.previousQuietState);
  const flags = byte(input.collisionFlags),
    beforeV = vector(input.beforeWorldVelocity),
    v = vector(input.worldVelocity),
    beforeOmega = vector(input.beforeLocalOmega),
    omega = vector(input.localOmega),
    localV = vector(input.localVelocity),
    gravity = vector(input.gravityIncrement),
    inertia = vector(input.inertia),
    min = vector(input.bounds.min),
    max = vector(input.bounds.max),
    com = vector(input.centreOfMass),
    mass = scalar(input.mass),
    jointY =
      input.jointInfoOrientationY === null
        ? null
        : scalar(input.jointInfoOrientationY);
  if (
    mass <= 0 ||
    inertia.some((n) => n <= 0) ||
    max.some((n, i) => n < min[i])
  )
    throw new Error("Invalid native quiet body");
  if (input.doNothing)
    return {
      quietEligible: false,
      quietState: foldNativeQuietHierarchy(previous, null),
      gate: "already-do-nothing",
      zeroVelocities: null,
    };
  if (input.singleton) previous = 0;
  const metrics: Partial<NativeQuietResult> = {};
  const reject = (gate: NativeQuietGate): NativeQuietResult => ({
    ...metrics,
    quietEligible: false,
    quietState: 0,
    gate,
    zeroVelocities: null,
  });
  const sum = omega.map((n, i) => n + beforeOmega[i]),
    angularEnergy =
      (sum[0] * f(sum[0]) * inertia[0] +
        sum[1] * sum[1] * inertia[1] +
        sum[2] * f(sum[2]) * inertia[2]) /
      mass,
    linearSpeedSquared =
      flags === 0 && previous !== 0
        ? 0
        : v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  metrics.linearSpeedSquared = linearSpeedSquared;
  metrics.angularEnergy = angularEnergy;
  if (!(linearSpeedSquared < 0.001)) return reject("linear-speed");
  if (!(angularEnergy < 0.00009)) return reject("angular-energy");
  if (previous === 0) {
    const magnitude = scalar(
      Math.sqrt(
        gravity[0] * gravity[0] +
          gravity[1] * gravity[1] +
          gravity[2] * gravity[2],
      ),
    );
    const unordered = magnitude === 0;
    metrics.gravityComparisonUnordered = unordered;
    // fcom NaN sets AH=0x45. Both branches test AH&1, so zero-G's two
    // gravity comparisons pass; it still runs every corner and joint gate.
    if (!unordered) {
      const normal = gravity.map((n) => scalar(n / magnitude));
      const upNew = scalar(
          -(v[0] * normal[0] + v[1] * normal[1] + v[2] * normal[2]),
        ),
        upOld = scalar(
          -(
            beforeV[0] * normal[0] +
            beforeV[2] * normal[2] +
            beforeV[1] * normal[1]
          ),
        );
      if (!(upNew < f(0.012))) return reject("upward-speed");
      if (!(f(0.9) * magnitude < upNew - upOld))
        return reject("gravity-response");
    }
    const comSpin = cross(omega, com),
      base = localV.map((n, i) => scalar(n + comSpin[i]));
    for (let index = 0; index < 8; index++) {
      // Native enumeration uses X bit2, Y bit1, Z bit4, starting max/max/max.
      const corner: PedVector = [
          index & 2 ? min[0] : max[0],
          index & 1 ? min[1] : max[1],
          index & 4 ? min[2] : max[2],
        ],
        spin = cross(omega, corner),
        x = base[0] + spin[0],
        y = base[1] + spin[1],
        z = base[2] + spin[2],
        cornerSquared = x * x + y * f(y) + z * f(z);
      if (cornerSquared > f(0.0004)) {
        metrics.rejectedCorner = index;
        return reject("corner-speed");
      }
    }
  }
  if (jointY !== null && flags === 0 && !(jointY > 0.999))
    return reject("joint-without-contact");
  return {
    ...metrics,
    quietEligible: true,
    quietState: foldNativeQuietHierarchy(1, null),
    gate: "quiet",
    zeroVelocities: {
      worldVelocity: [0, 0, 0],
      localOmega: [0, 0, 0],
      auxiliaryLocalOmega: [0, 0, 0],
    },
  };
}

export interface NativeFrictionFlagRow<T> {
  a: T;
  b: T | null;
  sourceType: number;
  lambda: number;
}
/** 4bbc58 queue gates/capacity, then 4c0870 flags. Inputs are accepted normal
 * rows in source order after geometry callbacks, with freshly cleared flags. */
export function collectNativeCollisionFlags<T>(
  rows: readonly NativeFrictionFlagRow<T>[],
): {
  flags: Map<T, number>;
  queuedCount: number;
  droppedCount: number;
} {
  const flags = new Map<T, number>();
  let queuedCount = 0,
    droppedCount = 0;
  for (const row of rows) {
    const lambda = scalar(row.lambda),
      type = row.sourceType;
    if (!Number.isInteger(type) || type < 0 || type > 0xffffffff)
      throw new Error("Invalid native contact type");
    if (lambda === 0 || type === 9 || type === 11) continue;
    if (queuedCount === 50) {
      droppedCount++;
      continue;
    }
    queuedCount++;
    if (row.b !== null && type !== 14) {
      flags.set(row.a, (flags.get(row.a) ?? 0) | 2);
      flags.set(row.b, (flags.get(row.b) ?? 0) | 2);
    } else flags.set(row.a, (flags.get(row.a) ?? 0) | 1);
  }
  return { flags, queuedCount, droppedCount };
}
