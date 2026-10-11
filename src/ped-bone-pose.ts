/** Independent installed407b20/407e60 bone pose math. Evidence:
 * docs/c2-ped-bone-pose-re.md. Matrices are native BRender basis rows followed
 * by a translation row; all vectors/model vertices have already been remapped. */
import {
  composePedRootPose,
  flipPedExportMatrix,
  lpNormalisePedMatrix,
  type PedRootMotionInput,
  type PedVector,
} from "./ped-form";

export type NativePedAngleBytes = readonly [number, number, number];
export interface NativePedPoseBone {
  /** FORM parent index, -1 for root0. Parents precede children in stock forms. */
  parent: number;
  /** Personality first vector, remapped through this bone's general map. */
  childAttachment: PedVector | null;
  /** Personality second vector, remapped through the FORM parent's general map. */
  parentAttachment: PedVector | null;
}
export interface NativePedBoneMotion {
  boneNames: readonly string[];
  /** Frame-major FORM order: three high-byte XYZ_S angles per bone. */
  frames: readonly Uint8Array[];
}
export interface NativePedBonePoseInput {
  bones: readonly NativePedPoseBone[];
  angles: ArrayLike<number>;
  /** Already computed root world matrix, including full animation or solver basis. */
  rootPose: ArrayLike<number>;
  /** Character+8c, with translation zero. Physics uses inverse(frameRoot)*root. */
  characterOrientation: ArrayLike<number>;
  /** Indexed old world matrices, retained for skipped/removed actors. */
  currentPoses: readonly ArrayLike<number>[];
  removedBoneMask: number;
  /** Source1/2 retain children;0/3 pose eligible children. Root is caller-owned. */
  mode: 0 | 1 | 2 | 3;
  selectedMoveValid: boolean;
  renderAvailable: boolean;
  physicsActive: boolean;
  boned: boolean;
  temporaryMatricesAvailable: boolean;
  morphActive: boolean;
  mutantSpeed: number;
}
export interface NativePedBonePoseResult {
  status: "posed" | "retained" | "provider-required";
  poses: Float32Array[];
  updatedBoneIndices: number[];
  retainedBoneIndices: number[];
  requiredProviders: string[];
}
const f = Math.fround;
const angleUnitsPerRadian = 10430.378350470453;
const radiansPerAngleUnit = 9.587379924285257e-5;
const sine = Float32Array.from({ length: 256 }, (_, q) =>
  Math.sin(q * 256 * radiansPerAngleUnit),
);
const cosine = Float32Array.from({ length: 256 }, (_, q) =>
  Math.cos(q * 256 * radiansPerAngleUnit),
);
function scalar(n: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(f(n)))
    throw new Error("PED POSE: non-finite scalar");
  return f(n);
}
function matrix(input: ArrayLike<number>): Float32Array {
  if (input.length !== 12)
    throw new Error("PED POSE: expected native12 matrix");
  return Float32Array.from(input, scalar);
}
function vector(input: PedVector): PedVector {
  if (input.length !== 3)
    throw new Error("PED POSE: expected three-value vector");
  return [scalar(input[0]), scalar(input[1]), scalar(input[2])];
}
function byte(n: number): number {
  if (!Number.isInteger(n) || n < 0 || n > 255)
    throw new Error("PED POSE: invalid angle byte");
  return n;
}
/** Installed531710 ->575190 ->ReadMove: truncate double angle16, wrap, high byte. */
export function quantizeNativePedAngle(radians: number): number {
  if (!Number.isFinite(radians) || Math.abs(radians) > Math.PI)
    throw new Error("PED POSE: angle outside atan2 range");
  return (Math.trunc(radians * angleUnitsPerRadian) & 0xffff) >>> 8;
}
/** XYZ_S order0 from an already export-flipped, LP-normalized native matrix. */
export function nativePedMatrixToAngleBytes(
  input: ArrayLike<number>,
): NativePedAngleBytes {
  const m = matrix(input),
    cy = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
  const radians =
    cy > 2 ** -19
      ? [Math.atan2(m[5], m[8]), Math.atan2(-m[2], cy), Math.atan2(m[1], m[0])]
      : [Math.atan2(-m[7], m[4]), Math.atan2(-m[2], cy), 0];
  return [
    quantizeNativePedAngle(radians[0]),
    quantizeNativePedAngle(radians[1]),
    quantizeNativePedAngle(radians[2]),
  ];
}
/** Native name matching ignores extra exporter bones, but missing FORM angles
 * are diagnosed instead of inventing the native uninitialized storage values. */
export function buildNativePedBoneMotion(
  motion: PedRootMotionInput,
  formBoneNames: readonly string[],
): NativePedBoneMotion {
  const count = motion.bones.length,
    frames = motion.frameCount;
  if (
    !count ||
    count > 256 ||
    !Number.isInteger(frames) ||
    frames < 1 ||
    frames > 20000 ||
    motion.matrices.length !== count * frames * 12 ||
    !formBoneNames.length ||
    formBoneNames.length > 32 ||
    new Set(formBoneNames).size !== formBoneNames.length ||
    new Set(motion.bones.map((b) => b.name)).size !== count ||
    [...formBoneNames, ...motion.bones.map((b) => b.name)].some(
      (s) => !s || s.length > 255,
    )
  )
    throw new Error("PED POSE: invalid animation shape/names");
  const indices = formBoneNames.map((name) => {
    const index = motion.bones.findIndex((b) => b.name === name);
    if (index < 0) throw new Error(`PED POSE: missing animation bone ${name}`);
    return index;
  });
  const result: Uint8Array[] = [];
  for (let frame = 0; frame < frames; frame++) {
    const angles = new Uint8Array(formBoneNames.length * 3);
    for (let bone = 0; bone < indices.length; bone++) {
      const offset = (frame * count + indices[bone]) * 12,
        raw = Array.from({ length: 12 }, (_, j) => motion.matrices[offset + j]);
      angles.set(
        nativePedMatrixToAngleBytes(
          lpNormalisePedMatrix(flipPedExportMatrix(raw)),
        ),
        bone * 3,
      );
    }
    result.push(angles);
  }
  return { boneNames: [...formBoneNames], frames: result };
}
/** Installed4080d0 with its four intermediate Float32 product spills. */
export function nativePedAnglesToMatrix(
  angles: NativePedAngleBytes,
): Float32Array {
  if (angles.length !== 3)
    throw new Error("PED POSE: expected XYZ angle triplet");
  const [x, y, z] = angles.map(byte),
    sx = sine[x],
    cx = cosine[x],
    sy = sine[y],
    cy = cosine[y],
    sz = sine[z],
    cz = cosine[z];
  return new Float32Array([
    cy * cz,
    cy * sz,
    -sy,
    sx * sy * cz - f(cx * sz),
    sx * sy * sz + f(cx * cz),
    sx * cy,
    cx * sy * cz + f(sx * sz),
    cx * sy * sz - f(cz * sx),
    cx * cy,
    0,
    0,
    0,
  ]);
}
function applyAxis(
  input: PedVector,
  m: ArrayLike<number>,
  axis: number,
): number {
  return input[0] * m[axis] + input[1] * m[3 + axis] + input[2] * m[6 + axis];
}
/** Installed407e60: child basis=E*O; parent contributes its world joint point.
 * Child-local rotations must never be post-multiplied by the parent's basis. */
export function composeNativePedBonePose(
  angles: NativePedAngleBytes,
  orientationInput: ArrayLike<number> | null,
  parentInput: ArrayLike<number>,
  childAttachmentInput: PedVector,
  parentAttachmentInput: PedVector,
): Float32Array {
  const E = nativePedAnglesToMatrix(angles),
    parent = matrix(parentInput),
    childAttachment = vector(childAttachmentInput),
    parentAttachment = vector(parentAttachmentInput),
    O = orientationInput === null ? null : matrix(orientationInput);
  if (O && (O[9] !== 0 || O[10] !== 0 || O[11] !== 0))
    throw new Error("PED POSE: character orientation translation must be zero");
  const child = O ? composePedRootPose(E, O, [0, 0, 0]) : E,
    offset: PedVector = [
      scalar(-applyAxis(childAttachment, E, 0)),
      scalar(-applyAxis(childAttachment, E, 1)),
      scalar(-applyAxis(childAttachment, E, 2)),
    ];
  // Source first spills -attachment*E, then post-multiplies by O before adding
  // the parent joint point. Retaining those spills avoids direct-anchor drift.
  for (let axis = 0; axis < 3; axis++) {
    const localOffset = O ? scalar(applyAxis(offset, O, axis)) : offset[axis];
    child[9 + axis] = scalar(
      localOffset +
        parent[9 + axis] +
        applyAxis(parentAttachment, parent, axis),
    );
  }
  return child;
}
/** Children-only part of installed407b20. Caller owns root movement/completion,
 * actual model selection, remapping, render/temp storage and detached actors. */
export function poseNativePedBones(
  input: NativePedBonePoseInput,
): NativePedBonePoseResult {
  const count = input.bones.length;
  if (
    count < 1 ||
    count > 32 ||
    input.currentPoses.length !== count ||
    input.angles.length !== count * 3 ||
    !Number.isInteger(input.mode) ||
    input.mode < 0 ||
    input.mode > 3 ||
    !Number.isInteger(input.removedBoneMask) ||
    input.removedBoneMask < 0 ||
    input.removedBoneMask > 0xffffffff ||
    (count < 32 && input.removedBoneMask >= 2 ** count)
  )
    throw new Error("PED POSE: invalid form/mask/frame/mode");
  input.bones.forEach((bone, index) => {
    if (
      !Number.isInteger(bone.parent) ||
      (index === 0
        ? bone.parent !== -1
        : bone.parent < 0 || bone.parent >= index)
    )
      throw new Error("PED POSE: FORM parents must precede children/root0");
    if (index && (!bone.childAttachment || !bone.parentAttachment))
      throw new Error("PED POSE: missing remapped personality attachment");
    if (bone.childAttachment) vector(bone.childAttachment);
    if (bone.parentAttachment) vector(bone.parentAttachment);
  });
  for (let i = 0; i < input.angles.length; i++) byte(input.angles[i]);
  const poses = input.currentPoses.map(matrix),
    root = matrix(input.rootPose),
    orientation = matrix(input.characterOrientation);
  if (orientation[9] || orientation[10] || orientation[11])
    throw new Error("PED POSE: character orientation translation must be zero");
  scalar(input.mutantSpeed);
  const updatedBoneIndices: number[] = [],
    retainedBoneIndices: number[] = [],
    requiredProviders: string[] = [];
  // Root is the caller's selected native matrix, never reconstructed from angles.
  poses[0] = root;
  const earlyReturn =
    !input.selectedMoveValid ||
    (input.physicsActive && input.boned && !input.temporaryMatricesAvailable);
  if (!earlyReturn && input.morphActive)
    requiredProviders.push("native-ped-morph-pose-provider");
  const eligibleChildren =
    input.renderAvailable &&
    input.mode !== 1 &&
    input.mode !== 2 &&
    input.bones.some(
      (bone, index) =>
        index > 0 &&
        !(input.removedBoneMask & ((2 ** index) >>> 0)) &&
        !(input.removedBoneMask & ((2 ** bone.parent) >>> 0)),
    );
  if (
    !earlyReturn &&
    !input.morphActive &&
    eligibleChildren &&
    input.mutantSpeed !== 0
  )
    requiredProviders.push("native-mutant-angle-rng-provider");
  const retained =
    requiredProviders.length > 0 ||
    earlyReturn ||
    !input.renderAvailable ||
    input.mode === 1 ||
    input.mode === 2;
  for (let index = 1; index < count; index++) {
    const bone = input.bones[index],
      missing =
        (input.removedBoneMask & ((2 ** index) >>> 0)) !== 0 ||
        (input.removedBoneMask & ((2 ** bone.parent) >>> 0)) !== 0;
    // Native checks only the immediate parent. A fully removed subtree freezes
    // all descendants; partial registration failures can leave other bits clear.
    if (retained || missing) {
      retainedBoneIndices.push(index);
      continue;
    }
    poses[index] = composeNativePedBonePose(
      [
        input.angles[index * 3],
        input.angles[index * 3 + 1],
        input.angles[index * 3 + 2],
      ],
      orientation,
      poses[bone.parent],
      bone.childAttachment!,
      bone.parentAttachment!,
    );
    updatedBoneIndices.push(index);
  }
  return {
    status: requiredProviders.length
      ? "provider-required"
      : retained
        ? "retained"
        : "posed",
    poses,
    updatedBoneIndices,
    retainedBoneIndices,
    requiredProviders,
  };
}
