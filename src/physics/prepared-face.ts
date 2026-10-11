import type { PedVector } from "../ped-form";
import type { NativePedGroundFace } from "../ped-grounding";
import type { WorldSourceTriangle } from "../world-source";
import type { NativeSingleFace } from "./single-face";
import type { NativePreparedFacePlane } from "./prepared-plane";

export type NativePreparedFaceMaterial =
  | { kind: "null" }
  | { kind: "present"; identifier: string | null; flags: number }
  | { kind: "unresolved"; reason: string };

export interface NativePreparedFaceRecord
  extends NativePedGroundFace,
    NativeSingleFace {
  nativeModelFlags: number;
  materialPresence: "null" | "present";
  constant: number;
}

export interface NativePreparedCachedFace extends NativePreparedFaceRecord {
  source: WorldSourceTriangle;
  sourceFaceIndex: number;
}

export interface NativePreparedFaceInput {
  source: WorldSourceTriangle;
  /** Native 12-float basis rows followed by translation. NULL is distinct from
   * an identity matrix and must be explicitly provided by the actor collector. */
  pMat: readonly number[] | Float32Array | null;
  material: NativePreparedFaceMaterial;
  /** Actual prepared edge IDs, required only for the non-updateable branch. */
  preparedEdges?: readonly [number, number, number];
}

export type NativePreparedFaceResult =
  | { kind: "emitted"; face: NativePreparedCachedFace }
  | { kind: "unresolved"; reason: string };

/** Original or migrated indexed MODEL data. Native face/group indices and DAT
 * provenance belong to the collector, not this geometry-only emission stage. */
export interface NativePreparedIndexedFaceInput {
  positions: Float32Array | readonly number[];
  indices: readonly [number, number, number];
  pivot: ArrayLike<number>;
  plane: Readonly<NativePreparedFacePlane>;
  nativeModelFlags: number;
  rawFaceFlags?: number;
  pMat: readonly number[] | Float32Array | null;
  material: NativePreparedFaceMaterial;
  preparedEdges?: readonly [number, number, number];
}
export type NativePreparedIndexedFaceResult =
  | { kind: "emitted"; face: NativePreparedFaceRecord }
  | { kind: "unresolved"; reason: string };

const f = Math.fround;
const unresolved = (
  reason: string,
): { kind: "unresolved"; reason: string } => ({
  kind: "unresolved",
  reason: `prepared-face:${reason}`,
});

function scalar(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(f(value)))
    throw new Error("Prepared face emission requires finite Float32 values");
  return f(value);
}

function vector(values: ArrayLike<number>): PedVector {
  if (values.length !== 3)
    throw new Error("Prepared face emission requires three vector components");
  return [scalar(values[0]), scalar(values[1]), scalar(values[2])];
}

function uint(value: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > maximum)
    throw new Error(`Invalid prepared face ${label}`);
  return value;
}

function transform(
  value: PedVector,
  matrix: readonly number[],
  point: boolean,
): PedVector {
  const component = (axis: number) => {
    const result =
      value[2] * matrix[6 + axis] +
      value[1] * matrix[3 + axis] +
      value[0] * matrix[axis];
    return scalar(point ? result + matrix[9 + axis] : result);
  };
  return [component(0), component(1), component(2)];
}

/** Installed ModelPickBox cached-record emission after admission. This does
 * not choose materials from render fallbacks or establish traversal/order. */
export function emitNativePreparedFace(
  input: NativePreparedFaceInput,
): NativePreparedFaceResult {
  const { source } = input;
  if (!source || source.sourceFaceIndex === null || !source.sourceFace)
    return unresolved("original-face-metadata-required");
  uint(source.sourceFaceIndex, 0xffff, "original face index");
  const positions = source.geometry.userData.sourcePositions;
  if (!(positions instanceof Float32Array))
    return unresolved("original-indexed-positions-required");
  const indices = source.sourceFace.indices;
  if (!Array.isArray(indices))
    return unresolved("original-face-indices-required");
  if (
    indices.length !== 3 ||
    indices.some(
      (index) =>
        !Number.isInteger(index) ||
        index < 0 ||
        index * 3 + 2 >= positions.length,
    )
  )
    throw new Error("Invalid prepared face original vertex indices");
  const pivotMetadata = source.geometry.userData.c2Pivot;
  if (!Array.isArray(pivotMetadata) && !(pivotMetadata instanceof Float32Array))
    return unresolved("original-model-pivot-required");
  const plane = source.nativeModelPlane;
  if (!plane) return unresolved("prepared-model-plane-required");
  const flags = source.effectiveTrackModelFlags;
  if (flags === null || flags === undefined)
    return unresolved("effective-model-flags-required");
  const result = emitNativePreparedIndexedFace({
    positions,
    indices: indices as [number, number, number],
    pivot: pivotMetadata,
    plane,
    nativeModelFlags: flags,
    rawFaceFlags: source.sourceFace.flags as number | undefined,
    pMat: input.pMat,
    material: input.material,
    preparedEdges: input.preparedEdges,
  });
  return result.kind === "emitted"
    ? {
        kind: "emitted",
        face: {
          ...result.face,
          source,
          sourceFaceIndex: source.sourceFaceIndex,
        },
      }
    : result;
}

/** Same installed emission, with explicit current MODEL tables. MungeFaces can
 * compact a MODEL or migrate a face into a zero-pivot blendy MODEL; callers must
 * use that destination's positions/indices/pivot/plane, not its old DAT geometry.
 * No synthetic WorldSourceTriangle or fabricated native face index is needed. */
export function emitNativePreparedIndexedFace(
  input: NativePreparedIndexedFaceInput,
): NativePreparedIndexedFaceResult {
  const { positions, indices } = input;
  if (!(positions instanceof Float32Array) && !Array.isArray(positions))
    return unresolved("original-indexed-positions-required");
  if (positions.length % 3 !== 0)
    throw new Error("Invalid prepared face indexed position table");
  if (!indices) return unresolved("original-face-indices-required");
  if (
    indices.length !== 3 ||
    indices.some(
      (index) =>
        !Number.isInteger(index) ||
        index < 0 ||
        index * 3 + 2 >= positions.length,
    )
  )
    throw new Error("Invalid prepared face original vertex indices");
  if (!input.pivot) return unresolved("original-model-pivot-required");
  const pivot = vector(input.pivot);
  if (!input.plane) return unresolved("prepared-model-plane-required");
  let normal = vector(input.plane.normal),
    constant = scalar(input.plane.d);
  const flags = input.nativeModelFlags;
  if (flags === null || flags === undefined)
    return unresolved("effective-model-flags-required");
  uint(flags, 0xffff, "effective model flags");
  let rawFlags: number;
  if (flags & 0x80) {
    const originalFlags = input.rawFaceFlags;
    if (typeof originalFlags !== "number")
      return unresolved("original-raw-face-flags-required");
    rawFlags = uint(originalFlags, 0xff, "raw face flags");
  } else {
    const edges = input.preparedEdges;
    if (!edges) return unresolved("prepared-edge-indices-required");
    if (edges.length !== 3)
      throw new Error("Invalid prepared face edge index count");
    rawFlags = 0;
    edges.forEach((edge, index) => {
      if (uint(edge, 0xffff, "edge index") === 0) rawFlags |= 1 << index;
    });
  }
  const material = input.material;
  if (!material) return unresolved("material-presence-provider-required");
  if (material.kind === "unresolved") return unresolved(material.reason);
  if (material.kind !== "null" && material.kind !== "present")
    throw new Error("Invalid prepared face material presence");
  if (material.kind === "present") {
    uint(material.flags, 0xffffffff, "material flags");
    if (material.identifier !== null && typeof material.identifier !== "string")
      throw new Error("Invalid prepared face material identifier");
  }
  if (input.pMat === undefined)
    return unresolved("actor-emission-matrix-required");
  const prepared = indices.map(
    (index): PedVector => [
      scalar(scalar(positions[index * 3]) - pivot[0]),
      scalar(scalar(positions[index * 3 + 1]) - pivot[1]),
      scalar(scalar(positions[index * 3 + 2]) - pivot[2]),
    ],
  );
  let [a, b, c] = prepared;
  if (input.pMat !== null) {
    if (input.pMat.length !== 12)
      throw new Error(
        "Prepared face emission requires a native 12-component matrix",
      );
    const matrix = Array.from(input.pMat, scalar);
    a = transform(a, matrix, true);
    b = transform(b, matrix, true);
    c = transform(c, matrix, true);
    normal = transform(normal, matrix, false);
    constant = scalar(normal[2] * a[2] + normal[1] * a[1] + normal[0] * a[0]);
  }
  const face: NativePreparedFaceRecord = {
    a,
    b,
    c,
    normal,
    constant,
    rawFlags,
    materialIdentifier:
      material.kind === "present" ? material.identifier : null,
    nativeModelFlags: flags,
    materialPresence: material.kind,
  };
  if (material.kind === "present") face.materialFlags = material.flags;
  return { kind: "emitted", face };
}
