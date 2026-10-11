/** Independent installed RescanPedProximity4cf860 cache writer. This function
 * owns no random stream, move selection, object scan, or character direction. */
import type { PedVector } from "./ped-form";

export interface NativePedProximityFace {
  a: PedVector;
  b: PedVector;
  c: PedVector;
  /** These fields are actual mutable borrowed face records, not frozen source snapshots. */
  normal: PedVector;
  constant: number;
  material: object | null;
  materialFlags: number;
  nativeGroup: number;
  nativeFace: number;
}
export interface NativePedProximityProcess<F extends NativePedProximityFace> {
  /** Actual canonical process record; flags+18 differ from gameplay flags+2e. */
  storage: Uint8Array;
  faceCache: { faces: readonly F[]; selectedFace: F | null } | null;
}
export interface NativePedProximityIndices {
  model: object;
  group: number;
  indices: readonly [number, number, number];
}
export type NativePedProximityIndexResult =
  | { kind: "indexed"; value: NativePedProximityIndices }
  /** Native out-of-range face/group checks skip this face. */
  | { kind: "invalid-face" }
  | { kind: "provider-required"; requiredProvider: string };
export type NativePedProximityEdgeResult =
  | { kind: "vertices"; vertices: readonly [PedVector, PedVector, PedVector] }
  | { kind: "provider-required"; requiredProvider: string };
export interface NativePedProximityExclusions {
  exclusionsOkWhenRunning: boolean;
  exclusions: readonly { material: object | null; flags: number }[];
  exceptions: readonly (object | null)[];
}
export interface NativePedProximityInput<F extends NativePedProximityFace> {
  process: NativePedProximityProcess<F>;
  /** GetCharacterMatrixPtr407a90 translation, not ped.pos or an estimated foot. */
  rootPosition: PedVector;
  characterDirection: PedVector;
  direction: PedVector | null;
  personalityBoundsMaxX: number;
  cosMaxSlope: number;
  action: number;
  suicidal: boolean;
  exclusionSpec: NativePedProximityExclusions | null;
  /** Read-only actual ACT->MODEL identity and raw/prepared face-index lookup.
   * Never key the native scratch cache by actor or material name. */
  readIndexedFace?: (face: F) => NativePedProximityIndexResult;
  /** Read-only MODEL-local prepared group vertex lookup, without world transform.
   * Installed excluded-floor code indexes g even when g<0; that unchecked memory
   * access is explicitly unsupported here, never replaced by raw/world vertices. */
  readPreparedGroupVertices?: (
    face: F,
    indexed: NativePedProximityIndices,
  ) => NativePedProximityEdgeResult;
}
export interface NativePedProximityState {
  floorNormal: PedVector;
  retainedDirection: PedVector;
  flags: number;
  velocity: PedVector;
  position: PedVector;
  normal: PedVector;
  distanceSquared: number;
}
export interface NativePedProximityResult<F extends NativePedProximityFace> {
  status: "complete" | "provider-required";
  requiredProviders: string[];
  distance: number;
  mutatedFaces: F[];
  state: NativePedProximityState;
}
const f = Math.fround;
const epsilon = 2 ** -22;
const crossEpsilon = f(2.384185791015625e-6);
const maximum = f(3.4028234663852886e38);
function scalar(n: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(f(n)))
    throw new Error("Native proximity requires finite Float32 inputs");
  return f(n);
}
function vector(v: PedVector): PedVector {
  if (v.length !== 3)
    throw new Error("Native proximity requires three components");
  return [scalar(v[0]), scalar(v[1]), scalar(v[2])];
}
function uint(n: number, limit: number): number {
  if (!Number.isInteger(n) || n < 0 || n > limit)
    throw new Error("Invalid native proximity integer");
  return n;
}
function view(storage: Uint8Array): DataView {
  if (!(storage instanceof Uint8Array) || storage.length < 0x12c)
    throw new Error(
      "Native proximity requires the actual 300-byte process record",
    );
  return new DataView(storage.buffer, storage.byteOffset, storage.byteLength);
}
function readVector(v: DataView, offset: number): PedVector {
  return [0, 4, 8].map((i) =>
    v.getFloat32(offset + i, true),
  ) as unknown as PedVector;
}
export function readNativePedProximityState(
  process: Pick<NativePedProximityProcess<NativePedProximityFace>, "storage">,
): NativePedProximityState {
  const v = view(process.storage);
  return {
    floorNormal: readVector(v, 0),
    retainedDirection: readVector(v, 0xc),
    flags: v.getUint8(0x18),
    velocity: readVector(v, 0x30),
    position: readVector(v, 0x3c),
    normal: readVector(v, 0xa4),
    distanceSquared: v.getFloat32(0xbc, true),
  };
}
function normalize(v: PedVector, explicit = false): PedVector {
  const length = Math.sqrt(
    explicit
      ? v[1] * v[1] + v[2] * v[2] + v[0] * v[0]
      : v[0] * v[0] + v[1] * v[1] + v[2] * v[2],
  );
  if (!(length > epsilon)) return [1, 0, 0];
  const inverse = 1 / length;
  return [f(v[0] * inverse), f(v[1] * inverse), f(v[2] * inverse)];
}
function negate(v: PedVector): PedVector {
  return [-v[0], -v[1], -v[2]];
}
/** SafeCross403f90 with fixed first operand native global Y. Its epsilon
 * fallback is Y cross X; all three installed component checks are retained. */
function lateralFor(dir: PedVector): PedVector {
  let cross: PedVector = [f(dir[2]), f(0 * dir[0] - 0 * dir[2]), f(-dir[0])];
  if (cross.every((n) => Math.abs(n) < crossEpsilon)) cross = [0, 0, -1];
  return normalize(cross);
}
/** Installed5150e0: inclusive, no barycentric epsilon, including zero normals. */
export function nativePedProximityPlaneContains(
  point: PedVector,
  normal: PedVector,
  constant: number,
): boolean {
  const p = vector(point),
    n = vector(normal),
    d = scalar(constant);
  return (
    (n[1] * p[1] + n[2] * p[2] + n[0] * p[0] - d) *
      (n[1] * n[1] + n[2] * n[2] + n[0] * n[0]) >=
    0
  );
}
type Plane = { n: PedVector; d: number };
function dot(n: PedVector, p: PedVector): number {
  return n[1] * p[1] + n[2] * p[2] + n[0] * p[0];
}
function planesFor(
  p: PedVector,
  dir: PedVector,
  floor: NativePedProximityFace,
  width: number,
): Plane[] {
  const lateral = lateralFor(dir),
    opposite = negate(lateral),
    upper = negate(floor.normal);
  // X/Y shifted coordinates remain live x87 values; Z is spilled/reloaded.
  const shiftedD = (n: PedVector, shift: PedVector) => {
    const x = p[0] + shift[0] * width,
      y = p[1] + shift[1] * width,
      z = f(p[2] + shift[2] * width);
    return f(x * n[0] + y * n[1] + z * n[2]);
  };
  return [
    { n: dir, d: f(dot(dir, p)) },
    { n: lateral, d: shiftedD(lateral, opposite) },
    { n: opposite, d: shiftedD(opposite, lateral) },
    { n: upper, d: f(dot(upper, p)) },
    { n: vector(floor.normal), d: scalar(floor.constant) },
  ];
}
function edgeIntersection(
  p: PedVector,
  flat: PedVector,
  vertices: readonly [PedVector, PedVector, PedVector],
) {
  const [a, b, c] = vertices.map(vector);
  const deltas = [
    [b[0] - a[0], b[2] - a[2]],
    [c[0] - b[0], c[2] - b[2]],
    [a[0] - c[0], a[2] - c[2]],
  ];
  const candidates = deltas.map(([liveX, liveZ], i) => {
    const dx = f(liveX),
      dz = f(liveZ);
    // First denominator retains the live coordinate differences. The others
    // consume stored Float32 differences. Every numerator reuses A/B.
    const denominator =
      (i === 0 ? liveZ : dz) * flat[0] - (i === 0 ? liveX : dx) * flat[2];
    let t =
      Math.abs(denominator) > 0.0001
        ? (p[2] * dx - p[0] * dz + a[0] * b[2] - b[0] * a[2]) / denominator
        : maximum;
    if (i !== 0) t = f(t);
    if (t < 0) t = maximum;
    return { t, n: [dx, 0, -dz] as PedVector };
  });
  const [first, second, third] = candidates;
  return first.t < second.t && first.t < third.t
    ? first
    : second.t < first.t && second.t < third.t
      ? second
      : third;
}

/** Providers are read-only. A private decision pass checks required storage
 * before committing source stores; it does not create persistent per-ped state. */
export function rescanNativePedProximity<F extends NativePedProximityFace>(
  input: NativePedProximityInput<F>,
): NativePedProximityResult<F> {
  const actual = view(input.process.storage),
    slot = input.process.faceCache;
  const result = (
    distance: number,
    requiredProviders: string[] = [],
    mutatedFaces: F[] = [],
  ): NativePedProximityResult<F> => ({
    status: requiredProviders.length ? "provider-required" : "complete",
    requiredProviders,
    distance,
    mutatedFaces,
    state: readNativePedProximityState(input.process),
  });
  // Native returns before floor/direction/flag stores at these two gates.
  if (!slot || !slot.selectedFace) return result(10000);
  if (slot.faces.length > 255)
    throw new Error("Native proximity face count exceeds BYTE");
  uint(input.action, 0xffffffff);
  const p = vector(input.rootPosition),
    requested = vector(input.direction ?? input.characterDirection),
    dir = normalize(requested, input.direction !== null),
    width = scalar(input.personalityBoundsMaxX) * 1.3,
    cosine = scalar(input.cosMaxSlope),
    running = input.action === 1;
  const copied = new Map<F, F>();
  const copyFace = (face: F): F => {
    let copy = copied.get(face);
    if (!copy) {
      if (
        !Number.isInteger(face.nativeGroup) ||
        face.nativeGroup < -32768 ||
        face.nativeGroup > 32767
      )
        throw new Error("Invalid native proximity signed group");
      uint(face.nativeFace, 65535);
      uint(face.materialFlags, 0xffffffff);
      if (
        face.material !== null &&
        typeof face.material !== "object" &&
        typeof face.material !== "function"
      )
        throw new Error(
          "Native proximity requires actual MAT identity or NULL",
        );
      copy = {
        ...face,
        a: vector(face.a),
        b: vector(face.b),
        c: vector(face.c),
        normal: vector(face.normal),
        constant: scalar(face.constant),
      };
      copied.set(face, copy);
    }
    return copy;
  };
  const floor = copyFace(slot.selectedFace);
  const writes: { offset: number; value: number; byte?: true }[] = [];
  const staged = new DataView(input.process.storage.slice().buffer);
  const store = (offset: number, value: number, byte?: true) => {
    if (byte) staged.setUint8(offset, value);
    else staged.setFloat32(offset, value, true);
    writes.push({ offset, value: byte ? value : f(value), byte });
  };
  const storeVector = (offset: number, v: PedVector) =>
    v.forEach((n, i) => store(offset + 4 * i, n));
  storeVector(0, floor.normal);
  storeVector(0xc, dir);
  store(0x18, actual.getUint8(0x18) & 0xf4, true);
  const horizontalLength = f(Math.sqrt(dir[0] * dir[0] + dir[2] * dir[2]));
  // Native divides even for a vertical direction; retain that NaN path.
  const flat: PedVector = [
    f(dir[0] / horizontalLength),
    0,
    f(dir[2] / horizontalLength),
  ];
  const spec = input.exclusionSpec;
  if (spec) {
    if (spec.exclusions.length > 255 || spec.exceptions.length > 255)
      throw new Error("Native proximity exclusion counts exceed BYTE");
    spec.exclusions.forEach((entry) => uint(entry.flags, 255));
  }
  let best = 10000,
    planes: Plane[] | null = null;
  const mutations = new Set<F>();
  const scratch: {
    model: object;
    group: number;
    codes: Map<number, Map<number, boolean>>;
  }[] = [];
  for (const original of slot.faces) {
    const face = copyFace(original),
      excludedFloor = face.normal[1] > cosine;
    if (excludedFloor) {
      if (input.suicidal || !spec || (running && spec.exclusionsOkWhenRunning))
        continue;
      if (
        !spec.exclusions.some(
          (entry) =>
            entry.material === face.material && (!running || entry.flags === 0),
        )
      )
        continue;
    } else if (spec?.exceptions.some((material) => material === face.material))
      continue;
    let t = 20;
    if (!excludedFloor) {
      const denominator =
        dir[0] * face.normal[0] +
        dir[1] * face.normal[1] +
        dir[2] * face.normal[2];
      if (!(Math.abs(denominator) < 0.001))
        t = f(
          (face.constant -
            p[0] * face.normal[0] -
            p[1] * face.normal[1] -
            p[2] * face.normal[2]) /
            denominator,
        );
      if (t < 0 || t > 20 || t > best) continue;
    }
    planes ??= planesFor(p, dir, floor, width);
    if (!input.readIndexedFace)
      return result(best, ["source-proximity-indexed-model-face-provider"]);
    const lookup = input.readIndexedFace(original);
    if (lookup.kind === "provider-required")
      return result(best, [lookup.requiredProvider]);
    if (lookup.kind === "invalid-face") continue;
    const indexed = lookup.value;
    if (
      !indexed.model ||
      (typeof indexed.model !== "object" &&
        typeof indexed.model !== "function") ||
      indexed.group !== face.nativeGroup ||
      indexed.indices.length !== 3
    )
      throw new Error("Invalid native proximity MODEL/group identity");
    indexed.indices.forEach((index) => uint(index, 65535));
    let cache = scratch.find(
      (entry) => entry.model === indexed.model && entry.group === indexed.group,
    );
    if (!cache && scratch.length < 16) {
      cache = { model: indexed.model, group: indexed.group, codes: new Map() };
      scratch.push(cache);
    }
    const vertices = [face.a, face.b, face.c];
    const anySide = (planeIndex: number): boolean =>
      vertices.some((point, i) => {
        const index = indexed.indices[i],
          plane = planes![planeIndex];
        const codes = index < 512 ? cache?.codes : undefined;
        let code = codes?.get(index);
        if (code?.has(planeIndex)) return code.get(planeIndex)!;
        const inside = nativePedProximityPlaneContains(point, plane.n, plane.d);
        if (codes) {
          if (!code) {
            code = new Map();
            codes.set(index, code);
          }
          code.set(planeIndex, inside);
        }
        return inside;
      });
    if (!anySide(0) || !anySide(1) || !anySide(2)) continue;
    if (excludedFloor) {
      if (face.nativeGroup < 0)
        return result(best, [
          "source-proximity-unchecked-negative-prepared-group-storage",
        ]);
      if (!input.readPreparedGroupVertices)
        return result(best, [
          "source-proximity-prepared-group-local-vertices-provider",
        ]);
      const edges = input.readPreparedGroupVertices(original, indexed);
      if (edges.kind === "provider-required")
        return result(best, [edges.requiredProvider]);
      if (edges.vertices.length !== 3)
        throw new Error("Native proximity requires three prepared vertices");
      const edge = edgeIntersection(p, flat, edges.vertices);
      if (!(edge.t < best)) continue;
      best = f(edge.t);
      storeVector(0xa4, edge.n);
      if (best > 20) continue;
      store(0xbc, best * best);
      storeVector(0x30, [0, 0, 0]);
      storeVector(0x3c, [
        f(p[0] + flat[0] * best),
        p[1],
        f(p[2] + flat[2] * best),
      ]);
      storeVector(0xa4, normalize(edge.n));
      store(0x18, staged.getUint8(0x18) | 8, true);
    } else {
      let back = dot(face.normal, dir) > 0;
      if (back) {
        if (face.material === null)
          return result(best, ["source-proximity-backface-material-pointer"]);
        if (face.materialFlags & 0x1000) {
          face.normal = negate(face.normal);
          face.constant = -face.constant;
          mutations.add(original);
          back = false;
        }
      }
      if (anySide(back ? 3 : 4))
        store(0x18, staged.getUint8(0x18) | (back ? 1 : 2), true);
      // Installed tests the accumulated whole byte, including retained bit4.
      if (staged.getUint8(0x18) !== 0) {
        store(0xbc, t * t);
        storeVector(0x30, [0, 0, 0]);
        storeVector(0x3c, [
          f(p[0] + dir[0] * t),
          f(p[1] + f(dir[1] * t)),
          f(p[2] + dir[2] * t),
        ]);
        best = t;
        storeVector(0xa4, face.normal);
      }
    }
  }
  // No provider sees this commit. Only native-addressed fields are written;
  // every unspecified recycled record field remains untouched.
  for (const write of writes) {
    if (write.byte) actual.setUint8(write.offset, write.value);
    else actual.setFloat32(write.offset, write.value, true);
  }
  for (const original of mutations) {
    const changed = copied.get(original)!;
    original.normal = changed.normal;
    original.constant = changed.constant;
  }
  return result(best, [], [...mutations]);
}
