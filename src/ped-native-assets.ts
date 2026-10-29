/** Native flat pedestrian render assets assembled from the original FORM,
 * personality, DAT/ACT and BON/SKL files. The root and every FORM bone actor
 * are siblings; pose is applied by the native bone-pose provider. */
import * as THREE from "three";
import type { Assets } from "./content";
import { createModelGeometry } from "./render-geometry";
import type { DatModel } from "./formats";
import {
  parsePedForm,
  parsePedPersonalitySimpleBody,
  parsePedRemap,
  remapPedVector,
  type PedBoneRemap,
  type PedForm,
  type PedPersonalityMove,
  type PedSimpleBodyProfile,
} from "./ped-form";
import { parsePedMotion, type PedMotion } from "./ped-motion";

export interface NativePedModelVariant {
  /** Authored personality token (DAT or ACT name). */
  identifier: string;
  /** Null entries are retained exactly and do not allocate an actor. */
  actor: THREE.Group | null;
  /** Bounds of remapped source DAT vertices, before ACT node transforms. */
  modelBounds: ReadonlyMap<string, THREE.Box3>;
  /** Exact resolved source MODEL identity; a flat actor has one MODEL. */
  sourceModels: readonly string[];
}
export interface NativePedBoneAsset {
  index: number;
  name: string;
  parent: number | null;
  massKg: number;
  mass: number;
  collisionType: string | null;
  jointType: string | null;
  actor: THREE.Group | null;
  variants: readonly NativePedModelVariant[];
  attachments: PedSimpleBodyProfile["attachmentsByBone"] extends ReadonlyMap<
    string,
    infer A
  >
    ? A | null
    : never;
}
export interface NativePedMoveAsset {
  id: number;
  form: PedForm["moves"][number];
  personality: PedPersonalityMove | null;
  /** Parsed source matrices are preserved; bone-pose mapping is a separate step. */
  motion: PedMotion;
}
export interface NativePedAssets {
  group: THREE.Group;
  form: PedForm;
  profile: PedSimpleBodyProfile;
  bones: readonly NativePedBoneAsset[];
  moves: ReadonlyMap<number, NativePedMoveAsset>;
  /** BRender inherited/default material for newly allocated flat FORM actors,
   * including raw NULL face materials and dead-MAT capacity overflow. */
  inheritedActorMaterial: THREE.Material;
  /** The loaded scene library; textures/materials/geometries are shared read-only. */
  scene: Awaited<ReturnType<Assets["scene"]>>;
  /** Loader evidence; missing required resources throw NativePedAssetError. */
  diagnostics: readonly NativePedAssetDiagnostic[];
  /** Release template geometry and its owned resource library once unused. */
  dispose(): void;
}

export interface NativePedAssetDiagnostic {
  code: "missing-resource" | "missing-model" | "invalid-source";
  path: string;
  identifier?: string;
  bone?: string;
  poseIndex?: number;
  message: string;
}
export class NativePedAssetError extends Error {
  constructor(readonly diagnostics: readonly NativePedAssetDiagnostic[]) {
    super(diagnostics.map((entry) => entry.message).join("; "));
    this.name = "NativePedAssetError";
  }
}

// Source BON/SKL records are borrowed read-only by every personality using the
// same Assets instance/root/path. Failures remain retryable after a reload.
const motionLibraries = new WeakMap<Assets, Map<string, Promise<PedMotion>>>();
function sourceMotion(assets: Assets, path: string): Promise<PedMotion> {
  let library = motionLibraries.get(assets);
  if (!library) motionLibraries.set(assets, (library = new Map()));
  const key = (assets.resolve(path) ?? path).toLowerCase();
  let promise = library.get(key);
  if (!promise) {
    promise = assets.bytes(path).then((bytes) => {
      const motion = parsePedMotion(bytes);
      for (const bone of motion.bones) {
        Object.freeze(bone.children);
        Object.freeze(bone);
      }
      Object.freeze(motion.bones);
      return Object.freeze(motion);
    });
    library.set(key, promise);
    const request = promise;
    void request.catch(() => {
      if (library!.get(key) === request) library!.delete(key);
    });
  }
  return promise;
}

const assetKey = (name: string) =>
  name.replace(/\.(?:pix|mat|dat|act|tif|tiff)$/i, "").toLowerCase();
function required<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null)
    throw new Error(`Native pedestrian asset missing: ${label}`);
  return value;
}
function modelBounds(model: DatModel): THREE.Box3 {
  const bounds = new THREE.Box3();
  for (let i = 0; i + 2 < model.positions.length; i += 3)
    bounds.expandByPoint(
      new THREE.Vector3(
        model.positions[i],
        model.positions[i + 1],
        model.positions[i + 2],
      ),
    );
  if (bounds.isEmpty())
    throw new Error(`Native pedestrian model has no vertices: ${model.name}`);
  return bounds;
}
function remappedModel(
  model: DatModel,
  remap: PedBoneRemap | undefined,
): DatModel {
  const positions = new Float32Array(model.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const v = remapPedVector(
      [model.positions[i], model.positions[i + 1], model.positions[i + 2]],
      remap?.general ?? null,
    );
    positions.set(v, i);
  }
  return { ...model, positions };
}

/** Load one original personality. personDirectory is relative to dataRoot and
 * normally `PEDS/PEEPS/<person>`; stem is the personality/archive stem. */
export async function loadNativePedAssets(
  assets: Assets,
  personDirectory: string,
  stem: string,
  dataRoot: "data" | "adv_data",
): Promise<NativePedAssets> {
  if (
    !personDirectory ||
    personDirectory.startsWith("/") ||
    personDirectory
      .split(/[\\/]/)
      .some((part) => !part || part === "." || part === "..") ||
    !/^[\w -]{1,64}$/.test(stem) ||
    !["data", "adv_data"].includes(dataRoot)
  )
    throw new Error("Invalid native pedestrian asset path");

  const prefix = `${dataRoot}/${personDirectory}`;
  const readText = async (path: string) => {
    try {
      return await assets.text(path);
    } catch (error) {
      throw new NativePedAssetError([
        {
          code: "missing-resource",
          path,
          message: `Native pedestrian source resource unavailable: ${path}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    }
  };
  const parseSource = <T>(path: string, parse: () => T): T => {
    try {
      return parse();
    } catch (error) {
      throw new NativePedAssetError([
        {
          code: "invalid-source",
          path,
          message: `Native pedestrian source invalid: ${path}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ]);
    }
  };
  const personalityText = await readText(`${prefix}/${stem}.TXT`);
  const personalityRows = personalityText
    .split(/\r?\n/)
    .map((row) => row.split("//")[0].trim())
    .filter(Boolean);
  const formStem = required(
    personalityRows[0],
    `${prefix}/${stem}.TXT FORM name`,
  );
  const defaultsStem = required(
    personalityRows[1],
    `${prefix}/${stem}.TXT default moves`,
  );
  const formPath = `${dataRoot}/PEDS/FORMS/${formStem}.TXT`;
  const formText = await readText(formPath);
  const form = parseSource(formPath, () => parsePedForm(formText));
  const remap = form.remapFilename
    ? parsePedRemap(
        await readText(`${dataRoot}/PEDS/REMAPS/${form.remapFilename}`),
      )
    : undefined;
  const defaultMovesText = await readText(
    `${dataRoot}/PEDS/MOVES/${defaultsStem}.TXT`,
  );
  const profile = parseSource(`${prefix}/${stem}.TXT`, () =>
    parsePedPersonalitySimpleBody(
      personalityText,
      form,
      remap,
      defaultMovesText,
    ),
  );
  // ReadPersonality finds MODEL identifiers exactly; .ACT is a legal MODEL
  // suffix, not a request to load an actor graph. FORM allocates fresh actors.
  const scene = await assets.scene(prefix, stem, {
    resourceOnly: true,
    storage: `native-peds:${dataRoot}`,
  });
  const group = new THREE.Group();
  group.name = `native-ped:${stem}`;
  group.matrix.identity();
  group.matrixAutoUpdate = false;
  const geometryCache = new Map<string, THREE.BufferGeometry>();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    group.clear();
    for (const geometry of geometryCache.values()) geometry.dispose();
    geometryCache.clear();
    scene.dispose?.();
  };
  try {
    const inheritedActorMaterial = required(
      scene.defaultMaterial,
      `${prefix} BRender default material`,
    );
    // The exact registry preserves suffixes and native newest-first lookup. The
    // compatibility map fallback also compares full source identities exactly.
    const findModel = (name: string) =>
      scene.findSourceModel
        ? scene.findSourceModel(name)
        : [...scene.models.values()].find(
            (model) => model.name.toLowerCase() === name.toLowerCase(),
          );
    const diagnostics: NativePedAssetDiagnostic[] = [];
    for (const [bone, variants] of profile.modelsByBone)
      variants.forEach((identifier, poseIndex) => {
        if (identifier !== null && !findModel(identifier))
          diagnostics.push({
            code: "missing-model",
            path: prefix,
            identifier,
            bone,
            poseIndex,
            message: `Native pedestrian MODEL missing: ${prefix}/${identifier} (${bone}, pose ${poseIndex})`,
          });
      });
    if (diagnostics.length) throw new NativePedAssetError(diagnostics);

    const buildModel = (
      name: string,
      boneName: string,
      updateable: boolean,
    ) => {
      const model = required(findModel(name), `${prefix}/${name}`);
      const remapped = remappedModel(model, remap?.get(boneName));
      // ReadPersonality marks contiguous nonnull set0 poses updateable as part
      // of set1 preparation. The cached original library MODEL stays untouched.
      if (updateable) remapped.flags |= 0x80;
      const bounds = modelBounds(remapped);
      const cacheKey = `${name.toLowerCase()}:${remapped.flags}:${(remap?.get(boneName)?.general ?? []).join(",")}`;
      let geometry = geometryCache.get(cacheKey);
      if (!geometry) {
        geometry = createModelGeometry(remapped);
        geometryCache.set(cacheKey, geometry);
      }
      const materials = scene.modelMaterials
        ? scene.modelMaterials(model, inheritedActorMaterial)
        : [...new Set(model.faces.map((face) => face.material))].map((slot) => {
            if (slot === 0) return inheritedActorMaterial;
            const name = required(
              model.materials[slot - 1],
              `${model.name} material slot ${slot}`,
            );
            // Synthetic/custom asset providers may not expose captured pointers.
            return (
              scene.materials.get(assetKey(name)) ?? inheritedActorMaterial
            );
          });
      return { model, bounds, geometry, materials };
    };

    const bones: NativePedBoneAsset[] = [];
    for (let index = 0; index < form.bones.length; index++) {
      const bone = form.bones[index];
      const names = required(
        profile.modelsByBone.get(bone.name),
        `${stem} model list for ${bone.name}`,
      );
      const variants: NativePedModelVariant[] = [];
      let contiguous = true;
      for (const identifier of names) {
        if (identifier === null) {
          contiguous = false;
          variants.push({
            identifier: "NULL",
            actor: null,
            modelBounds: new Map(),
            sourceModels: [],
          });
          continue;
        }
        const { model, bounds, geometry, materials } = buildModel(
          identifier,
          bone.name,
          contiguous,
        );
        const actor = new THREE.Group();
        actor.name = identifier;
        actor.matrix.identity();
        actor.matrixAutoUpdate = false;
        actor.add(new THREE.Mesh(geometry, materials));
        const built = {
          actor,
          modelBounds: new Map([[model.name, bounds]]),
          sourceModels: [model.name],
        };
        variants.push({ identifier, ...built });
        group.add(built.actor);
        if (variants.length === 1) built.actor.visible = true;
        else built.actor.visible = false;
      }
      const selected = variants[0] ?? null;
      bones.push({
        index,
        name: bone.name,
        parent: bone.parent,
        massKg: bone.massKg,
        mass: bone.mass,
        collisionType: bone.collisionType,
        jointType: bone.jointType,
        actor: selected?.actor ?? null,
        variants,
        attachments: profile.attachmentsByBone.get(bone.name) ?? null,
      });
    }

    const moves = new Map<number, NativePedMoveAsset>();
    for (const move of form.moves) {
      const motion = await sourceMotion(
        assets,
        `${dataRoot}/PEDS/MOVES/${move.filename}`,
      );
      moves.set(move.id, {
        id: move.id,
        form: move,
        personality: profile.movement.get(move.id) ?? null,
        motion,
      });
    }
    group.updateMatrixWorld(true);
    return {
      group,
      form,
      profile,
      bones,
      moves,
      scene,
      inheritedActorMaterial,
      diagnostics,
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
