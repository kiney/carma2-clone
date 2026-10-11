/** Independent data transform for installed MungeFaces(0x40d530).
 * Registry/model preparation remains an explicit host operation. */
export type NativeTrackPosition = readonly [number, number, number];
export type NativeTrackUv = readonly [number, number];

export interface NativeTrackVertex<V> {
  position: NativeTrackPosition;
  uv: NativeTrackUv;
  /** Complete remaining native vertex record, copied by the supplied adapter. */
  payload: V;
}
export interface NativeTrackFace<M extends object, F> {
  indices: readonly [number, number, number];
  /** Raw face material pointer identity; NULL is distinct from ACT inheritance. */
  material: M | null;
  payload: F;
  /** Original DAT provenance, never the compacted native face index. */
  sourceFaceIndex: number;
}
export interface NativeTrackModel<M extends object, V, F> {
  identity: object;
  flags: number;
  pivot?: NativeTrackPosition;
  actorRenderStyle: number;
  vertices: readonly NativeTrackVertex<V>[];
  faces: readonly NativeTrackFace<M, F>[];
}
export interface NativeTrackSmashSpec<M extends object> {
  material: M | null;
  triggerType: number;
  mode: number;
  levelCount: number;
}
export interface NativeTrackFaceVisit<M extends object, V, F> {
  model: NativeTrackModel<M, V, F>;
  face: NativeTrackFace<M, F>;
  /** Current compacted raw face table, before this face's selection/removal. */
  nativeFaces: readonly NativeTrackFace<M, F>[];
  nativeFaceIndex: number;
  remainingFaceCount: number;
}
export interface NativeTrackMigrationProviders<M extends object, V, F> {
  /** Invoked before selection, once for every original face in source order. */
  spawnPedsOnFace(visit: NativeTrackFaceVisit<M, V, F>): void;
  copyVertexPayload(payload: V): V;
  copyFacePayload(payload: F): F;
}
export interface NativeTrackIndexedFace<M extends object, F>
  extends NativeTrackFace<M, F> {
  sourceModel: object;
  nativeFaceIndex: number;
}
export interface NativeTrackMigratedVertex<V> extends NativeTrackVertex<V> {
  sourceModel: object;
  sourceVertexIndex: number;
}

/** Declarative source requests. Returning these does not perform preparation. */
export type NativeTrackMigrationAction =
  | {
      kind: "spawn-peds-on-face";
      sourceFaceIndex: number;
      nativeFaceIndex: number;
    }
  | { kind: "allocate-generated"; vertexCapacity: 2000; faceCapacity: 2000 }
  | { kind: "update-remaining"; flags: 0x7fff }
  | { kind: "clear-remaining-actor-model"; renderStyle: 1 }
  | { kind: "enumerate-noncars" }
  | { kind: "attach-generated-first-child" }
  | { kind: "register-and-prepare-generated"; flags: 0x7fff }
  | { kind: "calculate-reserve-and-reallocate" }
  | { kind: "prepare-generated-and-restore-group-materials"; flags: 0x7fff };

export interface NativeTrackMigration<M extends object, V, F> {
  remaining: {
    /** Native migration does not alter the original vertex table or pivot. */
    vertices: readonly NativeTrackVertex<V>[];
    faces: NativeTrackIndexedFace<M, F>[];
    flags: number;
    pivot?: NativeTrackPosition;
  };
  remainingActorRenderStyle: number;
  remainingActorModelPresent: boolean;
  generated: {
    actor: {
      type: 1;
      renderStyle: 4;
      identifier: null;
      material: null;
      transform: readonly number[];
    };
    model: {
      identifier: null;
      pivot: NativeTrackPosition;
      flags: 0x80;
      vertexCapacity: 2000;
      faceCapacity: 2000;
      vertices: NativeTrackMigratedVertex<V>[];
      faces: NativeTrackIndexedFace<M, F>[];
    };
  } | null;
  actions: NativeTrackMigrationAction[];
}

export class NativeTrackModelError extends Error {
  constructor(
    readonly code: "invalid-input" | "provider-required" | "capacity-overflow",
    message: string,
  ) {
    super(message);
    this.name = "NativeTrackModelError";
  }
}
const invalid = (message: string): never => {
  throw new NativeTrackModelError("invalid-input", message);
};
const signed32 = (value: number, label: string) => {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff)
    invalid(`Native track ${label} must be signed32`);
};
const materialIdentity = (value: object | null, label: string) => {
  if (
    value !== null &&
    typeof value !== "object" &&
    typeof value !== "function"
  )
    invalid(`Native track ${label} requires a raw material identity or NULL`);
};
const nativeFloat = (value: number) =>
  Number.isFinite(value) && Math.fround(value) === value;
const vertexKey = <V>(vertex: NativeTrackVertex<V>) =>
  [...vertex.position, ...vertex.uv].join(",");

export function nativeTrackFaceMustBeUpdateable<M extends object>(
  material: M | null,
  specs: readonly NativeTrackSmashSpec<M>[],
): boolean {
  materialIdentity(material, "face material");
  for (const spec of specs) {
    materialIdentity(spec.material, "spec material");
    signed32(spec.triggerType, "trigger type");
    signed32(spec.mode, "mode");
    signed32(spec.levelCount, "level count");
  }
  return specs.some(
    (spec) =>
      spec.triggerType === 0 &&
      spec.material === material &&
      ((spec.mode === 2 && spec.levelCount > 0) ||
        spec.mode === 3 ||
        spec.mode === 4),
  );
}

/** One selected column MODEL, after its caller has cleared gMr_blendy.
 * Initial overflow is preflighted before spawn outlets. Changes made by an
 * outlet are selected live and rechecked before copying; their earlier outlets
 * have already run. Native unchecked writes never become silent splitting. */
export function migrateNativeTrackModel<M extends object, V, F>(
  model: NativeTrackModel<M, V, F>,
  specs: readonly NativeTrackSmashSpec<M>[],
  providers: NativeTrackMigrationProviders<M, V, F>,
): NativeTrackMigration<M, V, F> {
  for (const name of [
    "spawnPedsOnFace",
    "copyVertexPayload",
    "copyFacePayload",
  ] as const)
    if (typeof providers?.[name] !== "function")
      throw new NativeTrackModelError(
        "provider-required",
        `Native track migration requires ${name}`,
      );
  if (
    !model.identity ||
    (typeof model.identity !== "object" && typeof model.identity !== "function")
  )
    invalid("Native track MODEL requires source identity");
  if (!Number.isInteger(model.flags) || model.flags < 0 || model.flags > 0xffff)
    invalid("Native track MODEL flags must be uint16");
  if (
    !Number.isInteger(model.actorRenderStyle) ||
    model.actorRenderStyle < 0 ||
    model.actorRenderStyle > 0xff
  )
    invalid("Native track ACT render style must be uint8");
  if (model.vertices.length > 0xffff || model.faces.length > 0xffff)
    invalid("Native track MODEL counts exceed native uint16");
  if (
    model.pivot &&
    (model.pivot.length !== 3 || !model.pivot.every(nativeFloat))
  )
    invalid("Native track MODEL pivot requires finite float32 coordinates");
  for (const vertex of model.vertices)
    if (
      vertex.position.length !== 3 ||
      vertex.uv.length !== 2 ||
      ![...vertex.position, ...vertex.uv].every(nativeFloat)
    )
      invalid("Native track vertex requires finite stored float32 XYZ/UV");
  nativeTrackFaceMustBeUpdateable(null, specs);
  const initiallySelected = model.faces.map((face) => {
    if (
      face.indices.length !== 3 ||
      face.indices.some(
        (i) => !Number.isInteger(i) || i < 0 || i >= model.vertices.length,
      )
    )
      invalid("Native track face vertex index exceeds MODEL");
    if (
      !Number.isInteger(face.sourceFaceIndex) ||
      face.sourceFaceIndex < 0 ||
      face.sourceFaceIndex > 0xffffffff
    )
      invalid("Native track face requires uint32 DAT provenance");
    return nativeTrackFaceMustBeUpdateable(face.material, specs);
  });
  const unique = new Set<string>();
  let migratedCount = 0;
  model.faces.forEach((face, i) => {
    if (!initiallySelected[i]) return;
    migratedCount++;
    for (const index of face.indices)
      unique.add(vertexKey(model.vertices[index]));
  });
  if (migratedCount > 2000 || unique.size > 2000)
    throw new NativeTrackModelError(
      "capacity-overflow",
      `Native generated MODEL exceeds 2000 records (${unique.size} vertices, ${migratedCount} faces)`,
    );

  const remaining: NativeTrackIndexedFace<M, F>[] = [];
  const migrated: NativeTrackIndexedFace<M, F>[] = [];
  const vertices: NativeTrackMigratedVertex<V>[] = [];
  const actions: NativeTrackMigrationAction[] = [];
  const selected: boolean[] = [];
  const originalFaceCount = model.faces.length;
  const originalVertexCount = model.vertices.length;
  let allocated = false;
  for (let i = 0; i < model.faces.length; i++) {
    const face = model.faces[i];
    const nativeFaceIndex = remaining.length;
    actions.push({
      kind: "spawn-peds-on-face",
      sourceFaceIndex: face.sourceFaceIndex,
      nativeFaceIndex,
    });
    providers.spawnPedsOnFace({
      model,
      face,
      nativeFaces: [
        ...model.faces.slice(0, i).filter((_, index) => !selected[index]),
        ...model.faces.slice(i),
      ],
      nativeFaceIndex,
      remainingFaceCount: model.faces.length - migrated.length,
    });
    if (
      model.faces.length !== originalFaceCount ||
      model.vertices.length !== originalVertexCount ||
      model.faces[i] !== face
    )
      invalid("Native track spawning cannot replace MODEL tables/face records");
    // The native predicate runs after SpawnPedsOnFace. Initial decisions above
    // only preflight capacity; callback-visible material/spec changes are live.
    selected[i] = nativeTrackFaceMustBeUpdateable(face.material, specs);
    if (
      face.indices.length !== 3 ||
      face.indices.some(
        (index) =>
          !Number.isInteger(index) ||
          index < 0 ||
          index >= model.vertices.length,
      )
    )
      invalid("Native track spawning produced invalid face indices");
    if (selected[i]) {
      const keys = new Set(vertices.map(vertexKey));
      for (const index of face.indices) {
        const vertex = model.vertices[index];
        if (
          vertex.position.length !== 3 ||
          vertex.uv.length !== 2 ||
          ![...vertex.position, ...vertex.uv].every(nativeFloat)
        )
          invalid("Native track spawning produced invalid stored vertex data");
        keys.add(vertexKey(vertex));
      }
      if (migrated.length >= 2000 || keys.size > 2000)
        throw new NativeTrackModelError(
          "capacity-overflow",
          "Native track spawning changed selection beyond generated MODEL capacity",
        );
    }
    if (selected[i] && !allocated) {
      actions.push({
        kind: "allocate-generated",
        vertexCapacity: 2000,
        faceCapacity: 2000,
      });
      allocated = true;
    }
    const indices: [number, number, number] = [...face.indices];
    if (selected[i]) {
      for (let corner = 0; corner < 3; corner++) {
        const sourceIndex = indices[corner];
        const source = model.vertices[sourceIndex];
        // Installed compares five floats, ascending; payload/smoothing/material
        // are deliberately absent. First complete vertex record wins.
        let index = vertices.findIndex(
          (vertex) =>
            vertex.position.every(
              (value, axis) => value === source.position[axis],
            ) && vertex.uv.every((value, axis) => value === source.uv[axis]),
        );
        if (index < 0) {
          index = vertices.length;
          vertices.push({
            position: [...source.position],
            uv: [...source.uv],
            payload: providers.copyVertexPayload(source.payload),
            sourceModel: model.identity,
            sourceVertexIndex: sourceIndex,
          });
        }
        indices[corner] = index;
      }
    }
    const destination = selected[i] ? migrated : remaining;
    destination.push({
      indices,
      material: face.material,
      payload: providers.copyFacePayload(face.payload),
      sourceFaceIndex: face.sourceFaceIndex,
      sourceModel: model.identity,
      nativeFaceIndex: destination.length,
    });
  }
  if (allocated)
    actions.push(
      remaining.length
        ? { kind: "update-remaining", flags: 0x7fff }
        : { kind: "clear-remaining-actor-model", renderStyle: 1 },
    );
  // The following requests belong to ProcessModelsCB, after MungeFaces returns.
  actions.push({ kind: "enumerate-noncars" });
  if (allocated)
    actions.push(
      { kind: "attach-generated-first-child" },
      { kind: "register-and-prepare-generated", flags: 0x7fff },
      { kind: "calculate-reserve-and-reallocate" },
      { kind: "prepare-generated-and-restore-group-materials", flags: 0x7fff },
    );
  return {
    remaining: {
      vertices: model.vertices,
      faces: remaining,
      flags: model.flags,
      pivot: model.pivot,
    },
    remainingActorRenderStyle:
      allocated && !remaining.length ? 1 : model.actorRenderStyle,
    remainingActorModelPresent: !allocated || remaining.length !== 0,
    generated: allocated
      ? {
          actor: {
            type: 1,
            renderStyle: 4,
            identifier: null,
            material: null,
            transform: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
          },
          model: {
            identifier: null,
            pivot: [0, 0, 0],
            flags: 0x80,
            vertexCapacity: 2000,
            faceCapacity: 2000,
            vertices,
            faces: migrated,
          },
        }
      : null,
    actions,
  };
}

/** Prepared face UV triples, after actual BrModelAdd/prepare. Source uses double
 * .9 and truncation, then signed32 IMUL/add; there is no float32 range store. */
export function nativeTrackTextureReserve(
  preparedFaces: readonly (readonly [
    NativeTrackUv,
    NativeTrackUv,
    NativeTrackUv,
  ])[],
): { extraFaces: number; extraVertices: number } {
  let area = 0;
  for (const face of preparedFaces) {
    if (
      face.length !== 3 ||
      face.some((uv) => uv.length !== 2 || !uv.every(nativeFloat))
    )
      invalid(
        "Native track reserve requires prepared finite float32 UV triples",
      );
    const minimum = [10000, 10000];
    const maximum = [-10000, -10000];
    for (const uv of face)
      for (let axis = 0; axis < 2; axis++) {
        if (uv[axis] < minimum[axis]) minimum[axis] = uv[axis];
        if (uv[axis] > maximum[axis]) maximum[axis] = uv[axis];
      }
    const x = Math.trunc(maximum[0] - minimum[0] + 0.9);
    const y = Math.trunc(maximum[1] - minimum[1] + 0.9);
    // __ftol low DWORD is sufficient for the installed integer consumers.
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y))
      invalid("Native track UV reserve exceeds exact integer conversion range");
    area = (area + Math.imul(x, y)) | 0;
  }
  const extra = Math.min(250, (area + 50) | 0);
  return { extraFaces: extra, extraVertices: extra };
}
