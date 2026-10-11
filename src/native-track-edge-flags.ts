/** Installed LoadTrack's inlined MungeTrackModel pass, 505050..505502.
 * Raw DAT records remain immutable; the host applies these results to its
 * current MODEL, invalidates preparation and performs the requested update. */
export interface NativeTrackEdgeFace {
  indices: readonly [number, number, number];
  flags: number;
  /** Raw face MAT, before ACT inheritance. Only TWO_SIDED is consumed. */
  material: { readonly flags: number } | null;
}
export interface NativeTrackEdgeModel {
  positions: ArrayLike<number>;
  faces: readonly NativeTrackEdgeFace[];
  modelFlags: number;
}
export interface NativeTrackEdgeFlags {
  faceFlags: Uint8Array;
  /** One-based source IDs, including the initialized unused zero entry. */
  vertexRepresentatives: Uint32Array;
  modelFlags: number;
  /** BrModelUpdate FACES; this result alone does not execute preparation. */
  updateMask: 0x80;
}

export class NativeTrackEdgeFlagsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeTrackEdgeFlagsError";
  }
}
const f = Math.fround;
const fail = (message: string): never => {
  throw new NativeTrackEdgeFlagsError(message);
};

/** Live subtraction uses initialized native PC53; only the indicated temporary
 * stores round to Float32. This is not a conventional all-F32 distance. */
export function nativeTrackVertexWeldDistanceSquared(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const x = a[0] - b[0],
    y = a[1] - b[1],
    z = a[2] - b[2];
  return x * f(x) + y * f(y) + z * z;
}

/** Signed source edge volume, stored Float32 before its double thresholds.
 * a/b are later-face edge endpoints; c is its opposite vertex; earlier is
 * the earlier-face opposite vertex, all selected through representative IDs. */
export function nativeTrackSharedEdgeVolume(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  c: readonly [number, number, number],
  earlier: readonly [number, number, number],
): number {
  const x = b[0] - a[0],
    y = b[1] - a[1],
    z = b[2] - a[2],
    bx = f(c[0] - a[0]),
    by = f(c[1] - a[1]),
    bz = c[2] - a[2],
    cx = f(by * z - bz * y),
    cy = f(bz * x - bx * z),
    cz = f(bx * y - by * x),
    ax = earlier[0] - c[0],
    ay = f(earlier[1] - c[1]),
    az = f(earlier[2] - c[2]);
  return f(cx * ax + cy * ay + cz * az);
}

export function prepareNativeTrackEdgeFlags(
  model: NativeTrackEdgeModel,
): NativeTrackEdgeFlags {
  const { positions, faces, modelFlags } = model;
  if (
    !positions ||
    !Number.isInteger(positions.length) ||
    positions.length % 3 ||
    positions.length < 0 ||
    positions.length / 3 > 0xffff ||
    !Array.isArray(faces) ||
    faces.length > 0xffff ||
    !Number.isInteger(modelFlags) ||
    modelFlags < 0 ||
    modelFlags > 0xffff
  )
    fail("Native track edge pass requires uint16 MODEL counts and flags");
  const count = positions.length / 3;
  const vertices: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const p = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
    if (p.some((n) => !Number.isFinite(n) || f(n) !== n))
      fail("Native track positions must be finite stored Float32 values");
    vertices.push(p as [number, number, number]);
  }
  const flags = new Uint8Array(faces.length);
  for (const [i, face] of faces.entries()) {
    if (
      !face ||
      !Array.isArray(face.indices) ||
      face.indices.length !== 3 ||
      face.indices.some(
        (v: number) => !Number.isInteger(v) || v < 0 || v >= count,
      ) ||
      !Number.isInteger(face.flags) ||
      face.flags < 0 ||
      face.flags > 255 ||
      (face.material !== null &&
        (!face.material ||
          !Number.isInteger(face.material.flags) ||
          face.material.flags < 0 ||
          face.material.flags > 0xffffffff))
    )
      fail("Native track face indices, flags and raw MAT binding are invalid");
    flags[i] = face.flags;
  }
  const representatives = new Uint32Array(count + 1);
  // Installed 50515b..163 includes i==nvertices, unlike reconstructed rec2.
  for (let i = 1; i <= count; i++) {
    if (representatives[i] !== 0) continue;
    representatives[i] = i;
    for (let j = i + 1; j <= count; j++)
      if (
        nativeTrackVertexWeldDistanceSquared(vertices[i - 1], vertices[j - 1]) <
        f(1e-8)
      )
        representatives[j] = i;
  }
  const indices = faces.map((face) =>
    face.indices.map((index: number) => representatives[index + 1]),
  );
  for (let i = 0; i < faces.length - 1; i++)
    for (let j = i + 1; j < faces.length; j++)
      for (let l = 0; l < 3; l++)
        for (let m = 0; m < 3; m++) {
          const a = indices[i][l],
            b = indices[i][(l + 1) % 3],
            c = indices[j][m],
            d = indices[j][(m + 1) % 3];
          if (!((a === c && b === d) || (a === d && b === c))) continue;
          flags[j] |= 1 << m;
          const volume = nativeTrackSharedEdgeVolume(
              vertices[c - 1],
              vertices[d - 1],
              vertices[indices[j][(m + 2) % 3] - 1],
              vertices[indices[i][(l + 2) % 3] - 1],
            ),
            twoSided =
              ((faces[i].material?.flags ?? 0) & 0x1000) !== 0 ||
              ((faces[j].material?.flags ?? 0) & 0x1000) !== 0;
          if (!Number.isFinite(volume))
            fail("Native shared-edge arithmetic produced a nonfinite volume");
          // Installed 505452 writes earlier face i, unlike rec2's face j.
          if (volume < 0.0001 && (!twoSided || volume >= -0.0001))
            flags[i] |= 1 << l;
        }
  return {
    faceFlags: flags,
    vertexRepresentatives: representatives,
    modelFlags: modelFlags | 0x80,
    updateMask: 0x80,
  };
}
