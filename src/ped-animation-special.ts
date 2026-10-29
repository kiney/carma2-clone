/** Independently expressed installed4097b0/40a050 morph and4d69e0 mutant
 * kernels. Evidence and integration contracts: docs/c2-ped-special-animation-re.md. */
import type { NativePedAngleBytes } from "./ped-bone-pose";
import type { PedVector } from "./ped-form";

export interface NativePedMorph {
  progress: number;
  /** Source Float32 reciprocal; Infinity is native for zero child-angle change. */
  rate: number;
  retainRoot: boolean;
  startAngles: Int8Array;
  deltaAngles: Int8Array;
  oldVelocity: PedVector;
  newVelocity: PedVector;
  oldSourceDirection: PedVector;
}
export interface NativePedMorphPreparation {
  /** Frame-major FORM bone order, including root matrix-derived angle triplet. */
  startAngles: ArrayLike<number>;
  targetAngles: ArrayLike<number>;
  /** Actual SetCharacterMove arg4, with optional retained-root bit0x40000000.
   * This is an angular-speed scale, not a fixed duration in milliseconds. */
  morphArgument: number;
  oldVelocity?: PedVector;
  newVelocity?: PedVector;
  oldSourceDirection?: PedVector;
}
const f = Math.fround;
function finite(n: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(f(n)))
    throw new Error("PED SPECIAL: non-finite scalar");
  return f(n);
}
function integer(n: number, low: number, high: number): number {
  if (!Number.isInteger(n) || n < low || n > high)
    throw new Error("PED SPECIAL: integer outside source range");
  return n;
}
function vector(v: PedVector): PedVector {
  if (v.length !== 3) throw new Error("PED SPECIAL: invalid vector");
  return [finite(v[0]), finite(v[1]), finite(v[2])];
}
function signedByte(n: number): number {
  return (integer(n, 0, 255) << 24) >> 24;
}
function validateMorph(morph: NativePedMorph): void {
  if (
    !morph.startAngles.length ||
    morph.startAngles.length > 96 ||
    morph.startAngles.length % 3 ||
    morph.startAngles.length !== morph.deltaAngles.length ||
    !(morph.startAngles instanceof Int8Array) ||
    !(morph.deltaAngles instanceof Int8Array) ||
    !Number.isFinite(morph.progress) ||
    morph.progress < 0 ||
    !(morph.rate >= 0)
  )
    throw new Error("PED SPECIAL: invalid morph state");
}
/** Installed40a324..404 computes signed-period average velocities. The caller
 * supplies old move+40 or new move+34 respectively, without normalizing them. */
export function nativePedMorphVelocity(
  total: PedVector,
  frameCount: number,
  periodMs: number,
  nonAccumulating: boolean,
): PedVector {
  const v = vector(total);
  integer(frameCount, 1, 32767);
  integer(periodMs, -32768, 32767);
  if (nonAccumulating || !periodMs) return [0, 0, 0];
  return v.map((n) => finite(n / (frameCount * periodMs))) as [
    number,
    number,
    number,
  ];
}
/** Native byte subtraction gives shortest wrapped signed deltas, including
 * root; the duration sum excludes root0. No generic quaternion tween is used. */
export function prepareNativePedMorph(
  input: NativePedMorphPreparation,
): NativePedMorph {
  const count = input.startAngles.length;
  if (!count || count > 96 || count % 3 || input.targetAngles.length !== count)
    throw new Error("PED SPECIAL: invalid morph angle shape");
  const argument = integer(input.morphArgument, 1, 0x7fffffff),
    scale = argument & 0xbfffffff;
  if (!scale) throw new Error("PED SPECIAL: zero morph angular scale");
  const startAngles = new Int8Array(count),
    deltaAngles = new Int8Array(count);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    startAngles[i] = signedByte(input.startAngles[i]);
    const target = signedByte(input.targetAngles[i]);
    deltaAngles[i] = target - startAngles[i];
    if (i >= 3) sum += Math.abs(deltaAngles[i]);
  }
  return {
    progress: 0,
    rate: f(1 / (((sum / (3 * (count / 3))) * scale) / 64)),
    retainRoot: !!(argument & 0x40000000),
    startAngles,
    deltaAngles,
    oldVelocity: vector(input.oldVelocity ?? [0, 0, 0]),
    newVelocity: vector(input.newVelocity ?? [0, 0, 0]),
    oldSourceDirection: vector(input.oldSourceDirection ?? [0, 0, 0]),
  };
}
export interface NativePedMorphAdvance {
  active: boolean;
  progress: number;
  /** Native zero-delta/zero-elapsed multiplies Infinity*0. A caller must retain
   * the explicit numerical limitation instead of passing NaN into world poses. */
  requiredProviders: string[];
}
/** elapsed is uint32(now-lastTimestamp), converted to Float32 before the
 * multiply/add; the morph's +0 Float32 progress is not clamped on completion. */
export function advanceNativePedMorph(
  morph: NativePedMorph,
  elapsedMs: number,
): NativePedMorphAdvance {
  validateMorph(morph);
  const elapsed = f(integer(elapsedMs, 0, 0xffffffff)),
    progress = f(morph.progress + elapsed * morph.rate);
  if (Number.isNaN(progress))
    return {
      active: true,
      progress,
      requiredProviders: ["native-ped-degenerate-morph-numerics-provider"],
    };
  morph.progress = progress;
  return { active: progress < 1, progress, requiredProviders: [] };
}
/** Native __ftol truncates before low-byte use; signed start is significant
 * when interpolation crosses zero, e.g. start255 + delta2 *0.25 -> byte0. */
export function sampleNativePedMorphAngles(morph: NativePedMorph): Uint8Array {
  validateMorph(morph);
  if (morph.progress >= 1)
    throw new Error("PED SPECIAL: completed morph requires target-frame pose");
  return Uint8Array.from(morph.startAngles, (start, i) =>
    Math.trunc(start + morph.deltaAngles[i] * morph.progress),
  );
}
/** Installed409b19..bc1, evaluated after progress advances. This returns a
 * displacement to add to the old root origin. Caller skips it for retainRoot
 * and physics-active roots; native morph ignores ordinary mode/movement gates. */
export function sampleNativePedMorphRootDelta(
  morph: NativePedMorph,
  elapsedMs: number,
  movementMatrix: ArrayLike<number>,
): PedVector {
  validateMorph(morph);
  if (morph.progress >= 1 || movementMatrix.length !== 12)
    throw new Error("PED SPECIAL: invalid morph displacement input");
  const matrix = Float32Array.from(movementMatrix, finite),
    oldVelocity = vector(morph.oldVelocity),
    newVelocity = vector(morph.newVelocity),
    elapsed = f(integer(elapsedMs, 0, 0xffffffff)),
    oldWeight = f(1 - morph.progress),
    local = oldVelocity.map((v, i) =>
      finite((v * oldWeight + newVelocity[i] * morph.progress) * elapsed),
    );
  return [0, 1, 2].map((j) =>
    finite(
      local[0] * matrix[j] +
        local[1] * matrix[3 + j] +
        local[2] * matrix[6 + j],
    ),
  ) as [number, number, number];
}

/** Installed40aa14..40aae1 blends selected move+40 with saved old move+40,
 * then normalizes before SetCharacterDirection constructs movement/orientation.
 * Do not use this vector as an extra grounding offset or root displacement. */
export function sampleNativePedMorphSourceDirection(
  morph: NativePedMorph,
  targetDirection: PedVector,
): PedVector {
  validateMorph(morph);
  if (morph.progress >= 1)
    throw new Error("PED SPECIAL: completed morph direction");
  const old = vector(morph.oldSourceDirection),
    target = vector(targetDirection),
    blended = old.map((v, i) =>
      finite(v * (1 - morph.progress) + target[i] * morph.progress),
    ),
    length = Math.hypot(...blended);
  if (length <= 2 ** -22) return [1, 0, 0];
  return blended.map((n) => finite(n / length)) as [number, number, number];
}

export interface NativePedMutantAngleInput {
  angles: NativePedAngleBytes;
  mutantSpeed: number;
  /** Actual signed health byte at gameplay pedestrian+4. */
  health: number;
  action: number;
  /** Global69a370: current outer-update time equals previous time. */
  sameTimeGuard: boolean;
  /** Shared source CRT rand() result, not a fresh per-pedestrian generator. */
  nextCrtInteger?: () => number;
}
export interface NativePedMutantAngleResult {
  angles: NativePedAngleBytes;
  randomDrawCalls: number;
  requiredProviders: string[];
}
/** SetBoner407e60 enters4d69e0 only for nonzero Float32 mutant speed.
 * IRandomPosNeg512f60(30) draws once per XYZ angle, even a resulting delta0. */
export function perturbNativePedMutantAngles(
  input: NativePedMutantAngleInput,
): NativePedMutantAngleResult {
  if (input.angles.length !== 3)
    throw new Error("PED SPECIAL: invalid mutant angle shape");
  const angles = input.angles.map((n) => integer(n, 0, 255)) as [
      number,
      number,
      number,
    ],
    speed = finite(input.mutantSpeed);
  integer(input.health, -128, 127);
  integer(input.action, -0x80000000, 0x7fffffff);
  if (
    speed === 0 ||
    input.health > 0 ||
    input.action !== 6 ||
    input.sameTimeGuard
  )
    return { angles, randomDrawCalls: 0, requiredProviders: [] };
  if (!input.nextCrtInteger)
    return {
      angles,
      randomDrawCalls: 0,
      requiredProviders: ["native-mutant-angle-rng-provider"],
    };
  for (let i = 0; i < 3; i++) {
    const sample = integer(input.nextCrtInteger(), 0, 32767),
      delta = Math.floor((sample * 61) / 32768) - 30;
    angles[i] = (angles[i] + delta) & 255;
  }
  return { angles, randomDrawCalls: 3, requiredProviders: [] };
}
