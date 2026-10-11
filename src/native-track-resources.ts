/** Current native MODEL tables, separate from immutable DAT/render geometry.
 * Track mutation preserves resource identity and original face provenance. */
import type { DatFace, DatModel, MatMaterial } from "./formats";
import type { NativeActorValue, NativeActorBounds } from "./native-actor-order";
import {
  migrateNativeTrackModel,
  type NativeTrackModel,
  type NativeTrackMigrationProviders,
  type NativeTrackSmashSpec,
  type NativeTrackMigration,
} from "./native-track-models";
import {
  prepareNativeFaceOrder,
  type NativeFaceMaterialOrder,
  type NativePreparedFaceOrder,
} from "./native-face-order";
import {
  emitNativePreparedIndexedFace,
  type NativePreparedFaceRecord,
  type NativePreparedFaceResult,
  type NativePreparedFaceMaterial,
} from "./physics/prepared-face";
import {
  prepareNativeModelFacePlane,
  type NativePreparedFacePlane,
} from "./physics/prepared-plane";

type CurrentModel = NativeTrackModel<MatMaterial, null, DatFace>;
export interface NativePreparedTrackFace {
  nativeFaceIndex: number;
  sourceFaceIndex: number;
  sourceModel: object;
  groupIndex: number;
  groupFaceIndex: number;
  indices: readonly [number, number, number];
  rawFlags: number;
  material: MatMaterial | null;
  plane: Readonly<NativePreparedFacePlane>;
}
export interface NativePreparedTrackModel {
  /** Revision must still match before emission; no stale prepared geometry. */
  revision: number;
  order: Extract<NativePreparedFaceOrder, { resolved: true }>;
  positions: Float32Array;
  pivot: readonly [number, number, number];
  flags: number;
  faces: readonly NativePreparedTrackFace[];
}
export interface NativeTrackModelResource {
  readonly source: DatModel | null;
  current: CurrentModel;
  revision: number;
  prepared: NativePreparedTrackModel | null;
}
export type NativeTrackResourceResult<T> =
  | { resolved: true; value: T }
  | { resolved: false; requiredProviders: readonly string[] };

/** Caller supplies actual loaded MAT identities. No render fallback/name rank. */
export function createNativeTrackModelResource(
  source: DatModel,
  findMaterial: (identifier: string) => NativeActorValue<MatMaterial>,
  actorRenderStyle: number,
): NativeTrackResourceResult<NativeTrackModelResource> {
  if (
    !Number.isInteger(source.flags) ||
    source.flags < 0 ||
    source.flags > 0xffff ||
    !Number.isInteger(actorRenderStyle) ||
    actorRenderStyle < 0 ||
    actorRenderStyle > 0xff
  )
    throw new Error(
      "Native track requires uint16 MODEL flags and uint8 ACT style",
    );
  if (source.faces.length > 0xffff || source.positions.length / 3 > 0xffff)
    throw new Error("Native track MODEL exceeds uint16 table counts");
  if (
    source.positions.length % 3 ||
    (source.uvs.length !== 0 &&
      source.uvs.length !== (source.positions.length / 3) * 2)
  )
    throw new Error("Native track MODEL requires complete XYZ/UV tables");
  if (
    ![...source.positions, ...source.uvs, ...(source.pivot ?? [0, 0, 0])].every(
      (n) => Number.isFinite(n) && Number.isFinite(Math.fround(n)),
    )
  )
    throw new Error("Native track DAT tables require finite Float32 data");
  const missing = new Set<string>();
  const faces = source.faces.map((face, sourceFaceIndex) => {
    if (
      face.indices.length !== 3 ||
      face.indices.some(
        (i) =>
          !Number.isInteger(i) || i < 0 || i * 3 + 2 >= source.positions.length,
      )
    )
      throw new Error("Native track face indices exceed DAT vertex table");
    if (!Number.isInteger(face.flags) || face.flags < 0 || face.flags > 255)
      throw new Error("Native track requires uint8 raw face flags");
    let material: MatMaterial | null = null;
    if (face.material !== 0) {
      if (
        !Number.isInteger(face.material) ||
        face.material < 1 ||
        face.material > source.materials.length
      )
        throw new Error(
          "Native track raw face material index exceeds DAT table",
        );
      const found = findMaterial(source.materials[face.material - 1]);
      if (!found || typeof found.resolved !== "boolean")
        throw new Error("Native track requires explicit MAT lookup result");
      if (!found.resolved) {
        if (
          typeof found.requiredProvider !== "string" ||
          !found.requiredProvider.trim()
        )
          throw new Error(
            "Native track missing MAT identity requires a provider reason",
          );
        missing.add(found.requiredProvider);
      } else {
        if (found.value === undefined)
          throw new Error(
            "Native track MAT lookup requires explicit identity or NULL",
          );
        if (
          found.value !== null &&
          (typeof found.value !== "object" ||
            typeof found.value.name !== "string")
        )
          throw new Error(
            "Native track MAT lookup requires actual parsed resource identity",
          );
        material = found.value;
      }
    }
    return {
      indices: [...face.indices] as [number, number, number],
      material,
      sourceFaceIndex,
      payload: {
        ...face,
        indices: [...face.indices] as [number, number, number],
      },
    };
  });
  if (missing.size) return { resolved: false, requiredProviders: [...missing] };
  const resource = {
    source,
    revision: 0,
    prepared: null,
  } as NativeTrackModelResource;
  resource.current = {
    identity: resource,
    // Installed LoadTrackModels/AddSmoothModels, before column mutation.
    flags: (source.flags | 0x80) & 0xfdfe,
    actorRenderStyle,
    pivot: [...(source.pivot ?? [0, 0, 0])],
    vertices: Array.from({ length: source.positions.length / 3 }, (_, i) => ({
      position: [
        source.positions[i * 3],
        source.positions[i * 3 + 1],
        source.positions[i * 3 + 2],
      ],
      // Native allocated vertex records are zeroed before optional UV chunks.
      uv: [source.uvs[i * 2] ?? 0, source.uvs[i * 2 + 1] ?? 0],
      // Cached-face consumers do not read other br_vertex record fields.
      payload: null,
    })),
    faces,
  };
  return { resolved: true, value: resource };
}

/** Every host mutation of current tables must invalidate the cached preparation. */
export function invalidateNativeTrackResource(
  resource: NativeTrackModelResource,
): void {
  if (
    !Number.isSafeInteger(resource.revision) ||
    resource.revision < 0 ||
    resource.revision === Number.MAX_SAFE_INTEGER
  )
    throw new Error("Native track MODEL revision overflow");
  resource.revision++;
  resource.prepared = null;
}

/** Installed BrModelUpdate51effe..51f0de consumes ALL raw vertices, before
 * pivot subtraction. Custom-bounds flag400 needs the real retained bounds owner.
 * Empty MODEL allocation fields cannot be recovered as invented geometric bounds. */
export function nativeTrackRawBounds(
  resource: NativeTrackModelResource,
): NativeActorValue<{ bounds: NativeActorBounds; radius: number }> {
  const model = resource.current;
  if (model.flags & 0x400)
    return {
      resolved: false,
      requiredProvider: "native retained custom MODEL bounds/radius",
    };
  if (!model.vertices.length)
    return {
      resolved: false,
      requiredProvider: "native empty MODEL retained bounds/radius",
    };
  const min = [...model.vertices[0].position] as [number, number, number];
  const max = [...min] as [number, number, number];
  let maximumSquare = 0;
  for (const vertex of model.vertices) {
    const p = vertex.position;
    if (
      p.length !== 3 ||
      !p.every((n) => Number.isFinite(n) && Math.fround(n) === n)
    )
      throw new Error(
        "Native MODEL bounds require stored finite Float32 vertices",
      );
    for (let axis = 0; axis < 3; axis++) {
      if (p[axis] > max[axis]) max[axis] = p[axis];
      if (p[axis] < min[axis]) min[axis] = p[axis];
    }
    const square = p[1] * p[1] + p[2] * p[2] + p[0] * p[0];
    if (square > maximumSquare) maximumSquare = Math.fround(square);
  }
  const radius = Math.fround(Math.sqrt(maximumSquare));
  if (!Number.isFinite(radius))
    throw new Error("Native MODEL radius requires a finite stored result");
  return { resolved: true, value: { bounds: { min, max }, radius } };
}

export interface NativeTrackResourceMigration {
  generated: NativeTrackModelResource | null;
  remainingActorModelPresent: boolean;
  remainingActorRenderStyle: number;
  actions: NativeTrackMigration<MatMaterial, null, DatFace>["actions"];
}
/** Perform mutation once per selected native MODEL; all sharing ACTs see the same
 * resource. Registration/preparation requests must still execute in host order. */
export function migrateNativeTrackResource(
  resource: NativeTrackModelResource,
  specs: readonly NativeTrackSmashSpec<MatMaterial>[],
  providers: NativeTrackMigrationProviders<MatMaterial, null, DatFace>,
): NativeTrackResourceMigration {
  // Callbacks may mutate live material/spec state or fail after partial effects.
  // Invalidate before invoking them; failed preparation must never stay usable.
  invalidateNativeTrackResource(resource);
  const migration = migrateNativeTrackModel(resource.current, specs, providers);
  resource.current = {
    ...resource.current,
    ...migration.remaining,
    actorRenderStyle: migration.remainingActorRenderStyle,
  };
  let generated: NativeTrackModelResource | null = null;
  if (migration.generated) {
    const model = migration.generated.model;
    generated = {
      source: null,
      revision: 0,
      prepared: null,
    } as NativeTrackModelResource;
    generated.current = {
      ...model,
      identity: generated,
      actorRenderStyle: migration.generated.actor.renderStyle,
    };
  }
  return {
    generated,
    remainingActorModelPresent: migration.remainingActorModelPresent,
    remainingActorRenderStyle: migration.remainingActorRenderStyle,
    actions: migration.actions,
  };
}

/** NULL is less than every real pointer; with at most one non-NULL identity that
 * is the complete proven ordering. More identities require actual host evidence. */
export function nativeTrackMaterialOrder(
  resource: NativeTrackModelResource,
): NativeFaceMaterialOrder {
  const materials = new Set(
    resource.current.faces
      .map((face) => face.material)
      .filter((m) => m !== null),
  );
  return materials.size <= 1
    ? {
        kind: "verified-pointer-order",
        keys: resource.current.faces.map((face) =>
          face.material === null ? 0 : 1,
        ),
        evidence:
          "known NULL below the only non-NULL MAT identity; equal keys use installed CRT permutation",
      }
    : {
        kind: "unresolved",
        reason:
          "native multi-material pointer order requires an actual ordering provider",
      };
}

/** Cached-face preparation only: not full BRender render/smoothing preparation,
 * registration, edge allocation, normal welding or resource reserve fulfillment. */
export function prepareNativeTrackResource(
  resource: NativeTrackModelResource,
  materialOrder: NativeFaceMaterialOrder = nativeTrackMaterialOrder(resource),
): NativeTrackResourceResult<NativePreparedTrackModel> {
  const model = resource.current;
  resource.prepared = null;
  const order = prepareNativeFaceOrder(model.faces.length, materialOrder);
  if (!order.resolved) {
    resource.prepared = null;
    return { resolved: false, requiredProviders: [order.reason] };
  }
  if (materialOrder.kind !== "unresolved") {
    const byMaterial = new Map<MatMaterial | null, number>();
    const byKey = new Map<number, MatMaterial | null>();
    model.faces.forEach((face, i) => {
      const key = materialOrder.keys[i];
      if ((face.material === null) !== (key === 0))
        throw new Error(
          "Native material keys must retain genuine NULL as zero",
        );
      if (
        (byMaterial.has(face.material) &&
          byMaterial.get(face.material) !== key) ||
        (byKey.has(key) && byKey.get(key) !== face.material)
      )
        throw new Error(
          "Native material keys must preserve MAT identity equality",
        );
      byMaterial.set(face.material, key);
      byKey.set(key, face.material);
    });
  }
  if (!(model.flags & 0x80))
    return {
      resolved: false,
      requiredProviders: ["native non-updateable prepared edge/model owner"],
    };
  const positions = new Float32Array(
    model.vertices.flatMap((vertex) => vertex.position),
  );
  if (!Array.from(positions).every(Number.isFinite))
    throw new Error("Native track MODEL positions must remain finite Float32");
  const faces: NativePreparedTrackFace[] = [];
  for (const group of order.groups)
    for (
      let groupFaceIndex = 0;
      groupFaceIndex < group.faceCount;
      groupFaceIndex++
    ) {
      const nativeFaceIndex = order.faceOrder[group.faceStart + groupFaceIndex];
      const face = model.faces[nativeFaceIndex];
      if (
        face.indices.length !== 3 ||
        face.indices.some(
          (i) => !Number.isInteger(i) || i < 0 || i >= model.vertices.length,
        )
      )
        throw new Error(
          "Native track prepared face indices exceed current MODEL",
        );
      const vertices = face.indices.map((i) => model.vertices[i].position);
      faces.push({
        nativeFaceIndex,
        sourceFaceIndex: face.sourceFaceIndex,
        sourceModel:
          "sourceModel" in face ? (face.sourceModel as object) : resource,
        groupIndex: group.groupIndex,
        groupFaceIndex,
        indices: [...face.indices],
        rawFlags: face.payload.flags,
        material: face.material,
        plane: prepareNativeModelFacePlane(
          vertices[0],
          vertices[1],
          vertices[2],
        ),
      });
    }
  const prepared: NativePreparedTrackModel = {
    revision: resource.revision,
    order,
    positions,
    pivot: [...(model.pivot ?? [0, 0, 0])],
    flags: model.flags,
    faces,
  };
  resource.prepared = prepared;
  return { resolved: true, value: prepared };
}
export interface NativeTrackCachedFace extends NativePreparedFaceRecord {
  model: NativeTrackModelResource;
  sourceModel: object;
  sourceFaceIndex: number;
  nativeFaceIndex: number;
  groupIndex: number;
  groupFaceIndex: number;
}
export type NativeTrackCachedFaceResult =
  | { kind: "emitted"; face: NativeTrackCachedFace }
  | Extract<NativePreparedFaceResult, { kind: "unresolved" }>;
/** Prepared group NULL falls back to the actual inherited MAT, including NULL.
 * The caller supplies pMat explicitly and separately owns finite query admission. */
export function emitNativeTrackPreparedFace(
  resource: NativeTrackModelResource,
  preparedFaceIndex: number,
  pMat: readonly number[] | Float32Array | null,
  inheritedMaterial: NativeActorValue<MatMaterial>,
): NativeTrackCachedFaceResult {
  const prepared = resource.prepared;
  if (!prepared || prepared.revision !== resource.revision)
    return {
      kind: "unresolved",
      reason: "native current prepared MODEL required",
    };
  if (
    !Number.isInteger(preparedFaceIndex) ||
    preparedFaceIndex < 0 ||
    preparedFaceIndex >= prepared.faces.length
  )
    throw new Error("Native track prepared face index exceeds prepared table");
  const face = prepared.faces[preparedFaceIndex];
  let material: NativePreparedFaceMaterial;
  if (face.material !== null)
    material = {
      kind: "present",
      identifier: face.material.name,
      flags: face.material.flags,
    };
  else if (!inheritedMaterial?.resolved)
    material = {
      kind: "unresolved",
      reason:
        inheritedMaterial?.requiredProvider ??
        "native inherited MAT provider required",
    };
  else if (inheritedMaterial.value === null) material = { kind: "null" };
  else {
    if (!inheritedMaterial.value)
      throw new Error(
        "Native inherited MAT requires explicit identity or NULL",
      );
    material = {
      kind: "present",
      identifier: inheritedMaterial.value.name,
      flags: inheritedMaterial.value.flags,
    };
  }
  const result = emitNativePreparedIndexedFace({
    positions: prepared.positions,
    indices: face.indices,
    pivot: prepared.pivot,
    plane: face.plane,
    nativeModelFlags: prepared.flags,
    rawFaceFlags: face.rawFlags,
    pMat,
    material,
  });
  return result.kind === "emitted"
    ? {
        kind: "emitted",
        face: {
          ...result.face,
          model: resource,
          sourceModel: face.sourceModel,
          sourceFaceIndex: face.sourceFaceIndex,
          nativeFaceIndex: face.nativeFaceIndex,
          groupIndex: face.groupIndex,
          groupFaceIndex: face.groupFaceIndex,
        },
      }
    : result;
}
