/** Production native ACT/MODEL query ownership. Immutable DAT/ACT records remain
 * read-only; mutable resource tables and linked actors own load-time changes. */
import * as THREE from "three";
import type { ActNode, DatModel, MatMaterial } from "./formats";
import {
  allocateNativeOrderedActor,
  createNativeActorOrder,
  extractNativeActorColumns,
  prependNativeActor,
  removeNativeActor,
  knownNativeActorValue as known,
  nativeSingleActorColumn,
  type NativeOrderedActor,
} from "./native-actor-order";
import {
  compactNativeTrackNonCars,
  findNativeTrackNonCars,
  setNativeTrackSmashableModel,
  type NativeTrackActorLoadContext,
  type NativeTrackActorSmashSpec,
} from "./native-track-actor-load";
import {
  createNativeTrackModelResource,
  invalidateNativeTrackResource,
  migrateNativeTrackResource,
  mungeNativeTrackResourceEdges,
  prepareNativeTrackResource,
  type NativeTrackModelResource,
} from "./native-track-resources";
import type { NativeResourceArena } from "./native-resource-arena";
import type { NativeFindFacesLayout } from "./native-find-faces";
import type { NativeTrackLayoutResult } from "./native-track-layout";
import {
  nativeTrackTextureReserve,
  type NativeTrackSmashSpec,
  type NativeTrackFaceVisit,
} from "./native-track-models";

export interface NativeWorldScene {
  layout: NativeFindFacesLayout;
  columns: readonly (readonly (NativeOrderedActor | null)[])[];
  additionalActors: NativeOrderedActor | null;
  /** DoPullActorFromWorld moves ACTs here, outside FindFacesInBox roots. */
  nonTrackActors: NativeOrderedActor;
  blackMaterial: MatMaterial;
  resources: Map<object, NativeTrackModelResource>;
  arena: NativeResourceArena;
  findModelResource?: (
    identifier: string,
  ) => NativeTrackModelResource | undefined;
  meshes: ReadonlyMap<NativeOrderedActor, THREE.Mesh>;
  initialPoses?: ReadonlyMap<
    NativeOrderedActor,
    { values: readonly number[]; parent: THREE.Object3D | null }
  >;
  initialGeometries: ReadonlyMap<NativeOrderedActor, THREE.BufferGeometry>;
  resolveRenderedMaterial?: (
    material: THREE.Material,
  ) => MatMaterial | undefined;
  actorObjects: ReadonlyMap<NativeOrderedActor, THREE.Object3D>;
  /** The original ACT object owns migrated triangles for smash/gameplay outlets. */
  faceActors: ReadonlyMap<NativeOrderedActor, THREE.Object3D>;
  actors: readonly NativeOrderedActor[];
  noncars: readonly NativeOrderedActor[];
  provenance: "native-query-with-host-resource-addresses";
}
export interface NativeWorldSceneSource {
  sourceActors: readonly ActNode[];
  sourceActorObjects: ReadonlyMap<ActNode, THREE.Object3D>;
  sourceModelStorage: readonly DatModel[];
  /** Raw DAT material-index lookup results captured at the MODEL load episode. */
  sourceModelMaterialBindings?: ReadonlyMap<
    DatModel,
    readonly (MatMaterial | null)[]
  >;
  findSourceModel(name: string): DatModel | undefined;
  findSourceMaterial(name: string): MatMaterial | undefined;
  materialArena: NativeResourceArena;
}
export interface NativeWorldSceneOptions {
  initialLayout: Extract<NativeTrackLayoutResult, { resolved: true }>;
  defaultTrackMaterial: MatMaterial;
  blackMaterial: MatMaterial;
  smashSpecs: readonly NativeTrackSmashSpec<MatMaterial>[];
  actorSpecs: readonly NativeTrackActorSmashSpec[];
  race: NativeTrackActorLoadContext["race"];
  pixelBits: number;
  /** Actual enrollment or an explicit deferred owner preserving original faces. */
  spawnPedsOnFace(
    visit: NativeTrackFaceVisit<MatMaterial, null, import("./formats").DatFace>,
  ): void;
  addSmashableRaceTarget?: NativeTrackActorLoadContext["providers"]["addSmashableRaceTarget"];
  updateMaterial?: (material: MatMaterial, flags: 6) => void;
  /** The host keeps exact MAT resources borrowed by process-global copies live. */
  retainChangingPowerupMaterial?: (material: MatMaterial) => void;
  resolveRenderedMaterial?: (
    material: THREE.Material,
  ) => MatMaterial | undefined;
}
// Installed69f170/174/178 survive track disposal. The actual host arena identifies
// the Assets/application lifetime; independent asset sessions do not share copies.
const changingPowerupModels = new WeakMap<
  NativeResourceArena,
  NativeTrackModelResource[]
>();
export function nativeWorldMatrix(matrix: THREE.Matrix4): number[] {
  const e = matrix.elements;
  return [
    e[0],
    e[1],
    e[2],
    e[4],
    e[5],
    e[6],
    e[8],
    e[9],
    e[10],
    e[12],
    e[13],
    e[14],
  ].map(Math.fround);
}
function applyMatrix(object: THREE.Object3D, m: readonly number[]): void {
  object.matrix.set(
    m[0],
    m[3],
    m[6],
    m[9],
    m[1],
    m[4],
    m[7],
    m[10],
    m[2],
    m[5],
    m[8],
    m[11],
    0,
    0,
    0,
    1,
  );
  object.matrix.decompose(object.position, object.quaternion, object.scale);
  object.updateMatrixWorld(true);
}
/** Executes current prepared tables, column migration, noncar registration and
 * powerup MODEL ownership. Rendering-specific callbacks stay on the ACT metadata. */
export function prepareNativeWorldScene(
  source: NativeWorldSceneSource,
  options: NativeWorldSceneOptions,
): NativeWorldScene {
  if (source.sourceActors.length !== 1)
    throw new Error("Native world requires one source ACT root");
  const resources = new Map<object, NativeTrackModelResource>();
  const prepare = (resource: NativeTrackModelResource) => {
    const result = prepareNativeTrackResource(
      resource,
      source.materialArena.materialOrder(resource.current.faces),
    );
    if (!result.resolved) throw new Error(result.requiredProviders.join("; "));
    return result.value;
  };
  const admitModel = (model: DatModel): NativeTrackModelResource => {
    const existing = resources.get(model);
    if (existing) return existing;
    const result = createNativeTrackModelResource(
      model,
      // Installed FopRead_MATERIAL_INDEX stores BrMaterialFind's result,
      // including NULL for an absent name in the supplied live registry.
      (name) => {
        const bindings = source.sourceModelMaterialBindings?.get(model);
        if (bindings) {
          const slot = model.materials.indexOf(name);
          if (
            slot < 0 ||
            slot >= bindings.length ||
            bindings[slot] === undefined
          )
            throw new Error(
              `Native DAT material-index binding is missing:${model.name}:${name}`,
            );
          return known(bindings[slot]);
        }
        return known(source.findSourceMaterial(name) ?? null);
      },
      4,
    );
    if (!result.resolved) throw new Error(result.requiredProviders.join("; "));
    mungeNativeTrackResourceEdges(result.value);
    prepare(result.value);
    resources.set(model, result.value);
    resources.set(result.value, result.value);
    return result.value;
  };
  for (const model of source.sourceModelStorage) admitModel(model);
  const state = createNativeActorOrder(source.sourceActors, {
    model: (name) => {
      const model = source.findSourceModel(name);
      return model
        ? known(admitModel(model))
        : { resolved: false, requiredProvider: `native-world-MODEL:${name}` };
    },
    material: (name) => known(source.findSourceMaterial(name) ?? null),
  });
  const actorObjects = new Map<NativeOrderedActor, THREE.Object3D>(),
    faceActors = new Map<NativeOrderedActor, THREE.Object3D>(),
    generatedOwners = new Map<NativeTrackModelResource, THREE.Object3D>();
  for (const actor of state.actors) {
    const object = actor.source && source.sourceActorObjects.get(actor.source);
    if (!object) throw new Error(`Native world ACT object missing:${actor.id}`);
    actorObjects.set(actor, object);
    faceActors.set(actor, object);
  }
  const model = (actor: NativeOrderedActor) => {
    if (!actor.localModel.resolved || !actor.localModel.value)
      throw new Error(`Native local MODEL required:${actor.name}`);
    const resource = resources.get(actor.localModel.value);
    if (!resource) throw new Error("Native powerup MODEL is not admitted");
    return resource;
  };
  const translatePowerup = (actor: NativeOrderedActor) => {
    const m = [...actor.matrix],
      y = Math.fround(0.1);
    for (let axis = 0; axis < 3; axis++)
      m[9 + axis] = Math.fround(m[9 + axis] + m[3 + axis] * y);
    actor.matrix = m;
  };
  const smooth = (material: MatMaterial | null) => {
    if (!material) return;
    const update =
      material.ambient <= 0.9999 ||
      (material.flags & 5) !== 5 ||
      !!(material.flags & 2);
    material.ambient = material.diffuse = 1;
    material.flags = (material.flags | 5) & ~2;
    (material as MatMaterial & { nativeUser?: number }).nativeUser = 0x5ba0;
    if (update) options.updateMaterial?.(material, 6);
  };
  const changing = changingPowerupModels.get(source.materialArena) ?? [];
  for (const resource of changing) resources.set(resource, resource);
  const context: NativeTrackActorLoadContext = {
    rawSlots: Array(options.initialLayout.header.nonCarCapacity).fill(null),
    count: options.initialLayout.header.rawNonCarCount,
    trackCount: options.initialLayout.header.rawNonCarCount,
    capacity: options.initialLayout.header.nonCarCapacity,
    specs: options.actorSpecs.map((spec) => ({
      ...spec,
      model: spec.model ? (resources.get(spec.model) ?? spec.model) : null,
    })),
    race: options.race,
    netGameType: null,
    pixelBits: options.pixelBits,
    providers: {
      readModelIdentifier: (identity) =>
        resources.get(identity)?.source?.name ?? null,
      clearTypeData: (actor) => {
        actorObjects.get(actor)!.userData.c2ActorTypeData = null;
      },
      smoothificatePowerups: (actor) => {
        if (!actor.localMaterial.resolved)
          throw new Error(actor.localMaterial.requiredProvider);
        smooth(actor.localMaterial.value as MatMaterial | null);
        for (const face of model(actor).current.faces) smooth(face.material);
      },
      setSpinningPowerup: (actor) => {
        translatePowerup(actor);
        const resource = model(actor);
        invalidateNativeTrackResource(resource);
        resource.current.flags |= 0x20;
        prepare(resource);
        actorObjects.get(actor)!.userData.c2NativePowerupRender = "spinning";
      },
      setChangingPowerup: (actor) => {
        if (!changing.length) {
          for (const name of [
            "&68powerup1.ACT",
            "&70powerup1.ACT",
            "&69powerup1.ACT",
          ]) {
            const raw = source.findSourceModel(name),
              original = raw && admitModel(raw);
            if (!original)
              throw new Error(
                `Native changing powerup fallback resources required:${name}`,
              );
            const duplicate: NativeTrackModelResource = {
              source: original.source,
              revision: 0,
              prepared: null,
              current: {
                ...original.current,
                flags: original.current.flags | 0x20,
                vertices: original.current.vertices.map((v) => ({
                  ...v,
                  position: [...v.position],
                  uv: [...v.uv],
                })),
                faces: original.current.faces.map((f) => ({
                  ...f,
                  indices: [...f.indices],
                  payload: { ...f.payload, indices: [...f.payload.indices] },
                })),
              },
            };
            duplicate.current.identity = duplicate;
            for (const face of duplicate.current.faces)
              if (face.material)
                options.retainChangingPowerupMaterial?.(face.material);
            resources.set(duplicate, duplicate);
            prepare(duplicate);
            changing.push(duplicate);
          }
          changingPowerupModels.set(source.materialArena, changing);
        }
        translatePowerup(actor);
        actor.localModel = known(changing[0]);
        actorObjects.get(actor)!.userData.c2NativePowerupRender = "changing";
      },
      addSmashableRaceTarget: options.addSmashableRaceTarget,
    },
  };
  const header = options.initialLayout.header;
  const columns = header.processColumns
    ? extractNativeActorColumns(state, {
        root: state.roots[0],
        countX: header.countX,
        countZ: header.countZ,
        defaultTrackMaterial: known(options.defaultTrackMaterial),
        austerity: false,
        providers: {
          identityColumnRelink: {
            evidence:
              "identity ACT and freshly allocated sibling wrapper validated by loader",
          },
          prepareColumn: (_tile, ground) => {
            if (
              !ground ||
              !ground.localModel.resolved ||
              !ground.localModel.value
            )
              return {
                resolved: true,
                evidence: "actual NULL selected ground MODEL",
                blendy: null,
              };
            const resource = model(ground),
              migrated = migrateNativeTrackResource(
                resource,
                options.smashSpecs,
                {
                  spawnPedsOnFace: options.spawnPedsOnFace,
                  copyVertexPayload: (v) => v,
                  copyFacePayload: (f) => ({ ...f, indices: [...f.indices] }),
                },
              );
            ground.renderStyle = migrated.remainingActorRenderStyle;
            if (!migrated.remainingActorModelPresent)
              ground.localModel = known(null);
            if (resource.current.faces.length) prepare(resource);
            if (!migrated.generated)
              return {
                resolved: true,
                evidence: "native ordered migration with no selected faces",
                blendy: null,
              };
            const generated = migrated.generated;
            resources.set(generated, generated);
            generatedOwners.set(generated, faceActors.get(ground)!);
            return {
              resolved: true,
              evidence: "native ordered migration and current MODEL tables",
              blendy: {
                type: 1,
                renderStyle: 4,
                matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
                localModel: known(generated),
                localMaterial: known(null),
                bounds: known(null),
                provenance: `native MungeFaces from ${ground.id}`,
              },
            };
          },
          findNonCars: (tile) => {
            findNativeTrackNonCars(tile, context);
            return {
              resolved: true,
              evidence:
                "installed FindNonCars mutations and saved-next callbacks",
            };
          },
          finishBlendy: (column) => {
            const actor = column.blendy!,
              resource = model(actor),
              prepared = prepare(resource);
            nativeTrackTextureReserve(
              prepared.faces.map(
                (face) =>
                  face.indices.map(
                    (i) => resource.current.vertices[i].uv,
                  ) as unknown as readonly [
                    readonly [number, number],
                    readonly [number, number],
                    readonly [number, number],
                  ],
              ),
            );
            // Reserve changes allocation capacity, not counts/values read by picker.
            prepare(resource);
            const owner = generatedOwners.get(resource);
            if (owner) faceActors.set(actor, owner);
            return {
              resolved: true,
              evidence:
                "actual generated preparation, reserve calculation and final group MAT restoration",
            };
          },
          setSmashableModel: (actor) => {
            setNativeTrackSmashableModel(actor, context);
            return {
              resolved: true,
              evidence: "installed MODEL match/name/target pass",
            };
          },
        },
      })
    : nativeSingleActorColumn(state.roots[0]);
  if (!columns.resolved) throw new Error(columns.requiredProvider);
  const noncars = header.processColumns
    ? compactNativeTrackNonCars(context).actors
    : [];
  for (const actor of state.actors) {
    const object = actorObjects.get(actor);
    if (!object) continue;
    object.name = actor.name;
    object.userData.c2NativeOrderedActor = actor;
    object.userData.c2ActorRenderStyle = actor.renderStyle;
    applyMatrix(object, actor.matrix);
  }
  const initialPoses = new Map<
    NativeOrderedActor,
    { values: number[]; parent: THREE.Object3D | null }
  >();
  for (const [actor, object] of actorObjects)
    initialPoses.set(actor, {
      values: [
        ...object.position.toArray(),
        ...object.quaternion.toArray(),
        ...object.scale.toArray(),
      ],
      parent: object.parent,
    });
  const meshes = new Map<NativeOrderedActor, THREE.Mesh>(),
    initialGeometries = new Map<NativeOrderedActor, THREE.BufferGeometry>();
  for (const [actor, object] of faceActors) {
    const mesh = object.children.find(
      (child) => child instanceof THREE.Mesh,
    ) as THREE.Mesh | undefined;
    if (mesh) {
      meshes.set(actor, mesh);
      initialGeometries.set(actor, mesh.geometry);
    }
  }
  const nonTrackActors = allocateNativeOrderedActor(state, {
    type: 0,
    renderStyle: 0,
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    localModel: known(null),
    localMaterial: known(null),
    bounds: known(null),
    provenance: "native gNon_track_actor host container",
  });
  return {
    nonTrackActors,
    arena: source.materialArena,
    findModelResource: (identifier) => {
      const identity = source.findSourceModel(identifier);
      return identity ? resources.get(identity) : undefined;
    },
    meshes,
    initialPoses,
    initialGeometries,
    resolveRenderedMaterial: options.resolveRenderedMaterial,
    layout: options.initialLayout.layout,
    columns: columns.columns.map((row) => row.map((c) => c?.wrapper ?? null)),
    additionalActors: null,
    blackMaterial: options.blackMaterial,
    resources,
    actorObjects,
    faceActors,
    actors: state.actors,
    noncars,
    provenance: "native-query-with-host-resource-addresses",
  };
}

/** Installed42006a..42007a uses remove/add (no ACT transform rewrite). Linked
 * child traversal already saves next, so moving current ACT preserves siblings. */
export function pullNativeWorldActor(
  scene: NativeWorldScene,
  actor: NativeOrderedActor,
): void {
  removeNativeActor(actor);
  prependNativeActor(scene.nonTrackActors, actor);
}
