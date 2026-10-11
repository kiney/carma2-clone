/** Independent installed ModelPickBox460490 admission and ordered track-record
 * emission. Prepared resources and material pointer ordering remain explicit. */
import type { MatMaterial } from "./formats";
import type {
  NativeActorValue,
  NativeOrderedActor,
} from "./native-actor-order";
import type {
  NativeActorPickEmissionInput,
  NativeActorPickQuery,
  NativeActorPickEmission,
} from "./native-actor-pick";
import { emitNativeTrackPreparedFace } from "./native-track-resources";
import type {
  NativeTrackModelResource,
  NativeTrackCachedFace,
  NativePreparedTrackModel,
  NativePreparedTrackFace,
} from "./native-track-resources";
import { nativeModelPickFaceInBox } from "./physics/model-pick-box";

export type NativeModelPickVector = readonly [number, number, number];
export interface NativeModelPickFace extends NativeTrackCachedFace {
  actor: NativeOrderedActor;
  material: MatMaterial | null;
  /** Native tFace_ref g/f are signed16 storage; nativeFaceIndex retains unsigned ownership. */
  nativeGroup: -1;
  nativeFace: number;
  recordIndex: number;
  /** Borrow the current raw vertex UV identities, matching the updateable MODEL branch. */
  map: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ];
}
export interface NativeModelPickGroupSpan {
  groupIndex: number;
  /** Absolute record index, including the caller's existing record prefix. */
  recordStart: number;
  recordCount: number;
}
export type NativeModelPickResult =
  | {
      resolved: true;
      rows: NativeModelPickFace[];
      remainingCapacity: number;
      groupSpans: NativeModelPickGroupSpan[];
      /** NULL means no global write; prior gPling_face must be retained. */ plingFace: NativeModelPickFace | null;
    }
  | { resolved: false; requiredProvider: string };
export interface NativeModelPickOptions {
  /** Required only if a prepared NULL group inherits a non-MatMaterial identity. */
  resolveMaterial?: (identity: object) => NativeActorValue<MatMaterial>;
  /** Adapter-only actual global gPling_face write. The direct pure result exposes its row. */
  writePlingFace?: (face: NativeModelPickFace) => void;
}
const f = Math.fround;
function scalar(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(f(value)))
    throw new Error("native model pick requires finite Float32 scalars");
  return f(value);
}
function vector(values: readonly number[]): [number, number, number] {
  if (values.length !== 3)
    throw new Error("native model pick requires three vector components");
  return [scalar(values[0]), scalar(values[1]), scalar(values[2])];
}
function storedQuery(input: NativeActorPickQuery): NativeActorPickQuery {
  if (input.matrix.length !== 12)
    throw new Error(
      "native model pick requires twelve query matrix components",
    );
  const originalBounds = {
      min: vector(input.originalBounds.min),
      max: vector(input.originalBounds.max),
    },
    realBounds = {
      min: vector(input.realBounds.min),
      max: vector(input.realBounds.max),
    },
    radius = scalar(input.radius);
  if (
    radius < 0 ||
    originalBounds.min.some((v, i) => v > originalBounds.max[i]) ||
    realBounds.min.some((v, i) => v > realBounds.max[i])
  )
    throw new Error(
      "native model pick requires ordered bounds and nonnegative radius",
    );
  return {
    matrix: Array.from(input.matrix, scalar),
    originalBounds,
    realBounds,
    center: vector(input.center),
    radius,
  };
}
/** Prepared positions: each raw indexed vertex minus pivot is stored Float32. */
export function nativeModelPickPreparedVertices(
  prepared: NativePreparedTrackModel,
  face: NativePreparedTrackFace,
): readonly [
  NativeModelPickVector,
  NativeModelPickVector,
  NativeModelPickVector,
] {
  const pivot = vector(prepared.pivot);
  if (
    face.indices.length !== 3 ||
    face.indices.some(
      (index) =>
        !Number.isInteger(index) ||
        index < 0 ||
        index * 3 + 2 >= prepared.positions.length,
    )
  )
    throw new Error("native model pick prepared indices exceed vertices");
  return face.indices.map((index) =>
    [0, 1, 2].map((axis) =>
      scalar(scalar(prepared.positions[index * 3 + axis]) - pivot[axis]),
    ),
  ) as unknown as readonly [
    NativeModelPickVector,
    NativeModelPickVector,
    NativeModelPickVector,
  ];
}
/** Installed460532..567: deltas/products/sum remain live, with NO Float32 delta spill. */
export function nativeModelPickPlaneRadiusPass(
  vertex: NativeModelPickVector,
  normal: NativeModelPickVector,
  center: NativeModelPickVector,
  radius: number,
): boolean {
  const V = vector(vertex),
    N = vector(normal),
    C = vector(center),
    R = scalar(radius);
  if (R < 0) throw new Error("native model pick radius must be nonnegative");
  const distance =
    N[1] * (V[1] - C[1]) + N[2] * (V[2] - C[2]) + N[0] * (V[0] - C[0]);
  return Math.abs(distance) <= R;
}
/** Installed46056d..713: all three strictly outside one real-bound plane rejects. */
export function nativeModelPickTriangleBoundsPass(
  vertices: readonly NativeModelPickVector[],
  bounds: NativeActorPickQuery["realBounds"],
): boolean {
  if (vertices.length !== 3)
    throw new Error(
      "native model pick requires exactly three prepared vertices",
    );
  const storedVertices = vertices.map(vector),
    min = vector(bounds.min),
    max = vector(bounds.max);
  if (min.some((value, axis) => value > max[axis]))
    throw new Error("native model pick requires ordered bounds");
  for (let axis = 0; axis < 3; axis++) {
    if (storedVertices.every((v) => min[axis] > v[axis])) return false;
    if (storedVertices.every((v) => max[axis] < v[axis])) return false;
  }
  return true;
}
/** Stored v−translation, then native532cd0 transpose-row vector product and final storage. */
export function nativeModelPickBoxCoordinates(
  vertex: NativeModelPickVector,
  matrix: readonly number[],
): NativeModelPickVector {
  if (matrix.length !== 12)
    throw new Error(
      "native model pick requires twelve query matrix components",
    );
  const V = vector(vertex),
    M = Array.from(matrix, scalar),
    delta = [0, 1, 2].map((axis) => scalar(V[axis] - M[9 + axis]));
  return [0, 1, 2].map((row) =>
    scalar(
      delta[1] * M[row * 3 + 1] +
        delta[2] * M[row * 3 + 2] +
        delta[0] * M[row * 3],
    ),
  ) as [number, number, number];
}
const xyz = (v: NativeModelPickVector) => ({ x: v[0], y: v[1], z: v[2] });
function parsedMaterial(identity: object): identity is MatMaterial {
  const material = identity as Partial<MatMaterial>;
  return (
    typeof material.name === "string" &&
    Number.isInteger(material.flags) &&
    material.flags! >= 0 &&
    material.flags! <= 0xffffffff
  );
}
function inheritedMaterial(
  input: object | null,
  options: NativeModelPickOptions,
): NativeActorValue<MatMaterial> {
  if (input === null) return { resolved: true, value: null };
  const supplied =
    options.resolveMaterial?.(input) ??
    (parsedMaterial(input)
      ? ({ resolved: true, value: input } as const)
      : ({
          resolved: false,
          requiredProvider: "native-inherited-MAT-metadata-provider",
        } as const));
  if (
    !supplied ||
    typeof supplied.resolved !== "boolean" ||
    (supplied.resolved
      ? supplied.value === undefined
      : !supplied.requiredProvider)
  )
    throw new Error(
      "native model pick requires explicit inherited MAT identity or NULL",
    );
  if (
    supplied.resolved &&
    supplied.value !== null &&
    !parsedMaterial(supplied.value)
  )
    throw new Error("native model pick requires actual MAT metadata");
  return supplied;
}
/** Direct callback-compatible source step. Never prepares/sorts lazily or changes resources. */
export function emitNativeModelPickBox(
  resource: NativeTrackModelResource,
  input: NativeActorPickEmissionInput,
  options: NativeModelPickOptions = {},
): NativeModelPickResult {
  if (
    !Number.isInteger(input.capacity) ||
    input.capacity < 0 ||
    input.capacity > 0x7fffffff ||
    !Number.isSafeInteger(input.outputOffset) ||
    input.outputOffset < 0
  )
    throw new Error("invalid native model pick capacity/output offset");
  const empty = () => ({
    resolved: true as const,
    rows: [],
    remainingCapacity: input.capacity,
    groupSpans: [],
    plingFace: null,
  });
  if (input.capacity === 0) return empty();
  if (input.model !== resource)
    return {
      resolved: false,
      requiredProvider: "native-MODEL-resource-identity-provider",
    };
  const prepared = resource.prepared;
  if (!prepared || prepared.revision !== resource.revision)
    return {
      resolved: false,
      requiredProvider: "native-current-prepared-MODEL-provider",
    };
  if (prepared.faces.length === 0) return empty();
  const query = storedQuery(input.query),
    rows: NativeModelPickFace[] = [],
    groupSpans: NativeModelPickGroupSpan[] = [];
  let plingFace: NativeModelPickFace | null = null,
    material: NativeActorValue<MatMaterial> | undefined;
  for (
    let preparedIndex = 0;
    preparedIndex < prepared.faces.length;
    preparedIndex++
  ) {
    const face = prepared.faces[preparedIndex],
      vertices = nativeModelPickPreparedVertices(prepared, face);
    if (
      !nativeModelPickPlaneRadiusPass(
        vertices[0],
        face.plane.normal,
        query.center,
        query.radius,
      )
    )
      continue;
    if (!nativeModelPickTriangleBoundsPass(vertices, query.realBounds))
      continue;
    const polygon = vertices.map((v) =>
      xyz(nativeModelPickBoxCoordinates(v, query.matrix)),
    );
    if (
      !nativeModelPickFaceInBox(
        polygon,
        xyz(query.originalBounds.min),
        xyz(query.originalBounds.max),
      )
    )
      continue;
    if (!(prepared.flags & 0x80))
      return {
        resolved: false,
        requiredProvider:
          "native-non-updateable-prepared-edge/model-owner-provider",
      };
    const currentFace = resource.current.faces[face.nativeFaceIndex];
    if (
      !currentFace ||
      face.nativeFaceIndex < 0 ||
      face.nativeFaceIndex > 0xffff ||
      !Number.isInteger(face.nativeFaceIndex)
    )
      throw new Error(
        "native model pick current face owner exceeds uint16 table",
      );
    if (face.material === null)
      material ??= inheritedMaterial(input.material, options);
    const emitted = emitNativeTrackPreparedFace(
      resource,
      preparedIndex,
      input.pMat,
      material ?? { resolved: true, value: null },
    );
    if (emitted.kind !== "emitted")
      return { resolved: false, requiredProvider: emitted.reason };
    const map = currentFace.indices.map((index) => {
      const uv = resource.current.vertices[index]?.uv;
      if (
        !uv ||
        uv.length !== 2 ||
        !uv.every(
          (value) => Number.isFinite(value) && Number.isFinite(f(value)),
        )
      )
        throw new Error(
          "native model pick requires current raw vertex UV storage",
        );
      return uv;
    }) as unknown as NativeModelPickFace["map"];
    const recordIndex = input.outputOffset + rows.length;
    if (!Number.isSafeInteger(recordIndex))
      throw new Error("native model pick record offset overflow");
    const selectedMaterial =
      face.material ?? (material?.resolved ? material.value : null);
    const row: NativeModelPickFace = {
      ...emitted.face,
      actor: input.actor,
      material: selectedMaterial,
      nativeGroup: -1,
      nativeFace: (face.nativeFaceIndex << 16) >> 16,
      recordIndex,
      map,
    };
    rows.push(row);
    let span = groupSpans.at(-1);
    if (!span || span.groupIndex !== face.groupIndex) {
      span = {
        groupIndex: face.groupIndex,
        recordStart: recordIndex,
        recordCount: 0,
      };
      groupSpans.push(span);
    }
    span.recordCount++;
    if (selectedMaterial?.name.startsWith("!")) plingFace = row;
    if (rows.length === input.capacity) break;
  }
  return {
    resolved: true,
    rows,
    remainingCapacity: input.capacity - rows.length,
    groupSpans,
    plingFace,
  };
}
/** Resolve the actual MODEL identity; capacity-zero calls need no prepared-data lookup. */
export function createNativeModelPickEmitter(
  resolveModel: (
    identity: object,
  ) => NativeActorValue<NativeTrackModelResource>,
  options: NativeModelPickOptions = {},
): (
  input: NativeActorPickEmissionInput,
) => NativeActorPickEmission<NativeModelPickFace> {
  return (input) => {
    if (input.capacity === 0) return { resolved: true, rows: [] };
    const found = resolveModel(input.model);
    if (!found || typeof found.resolved !== "boolean")
      throw new Error("native model pick requires explicit MODEL lookup");
    if (!found.resolved)
      return { resolved: false, requiredProvider: found.requiredProvider };
    if (found.value === null || found.value === undefined)
      return {
        resolved: false,
        requiredProvider: "native-MODEL-resource-identity-provider",
      };
    const result = emitNativeModelPickBox(found.value, input, options);
    if (result.resolved && result.plingFace !== null) {
      if (!options.writePlingFace)
        return {
          resolved: false,
          requiredProvider: "native-pling-face-state-provider",
        };
      options.writePlingFace(result.plingFace);
    }
    return result;
  };
}
