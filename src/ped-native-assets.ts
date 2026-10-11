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
  /** DAT names in source ACT traversal order. */
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
  /** Source root ACT material inherited by flat FORM bone ACTs, including
   * raw NULL face materials and native dead-MAT capacity overflow. */
  inheritedActorMaterial: THREE.Material;
  /** The loaded scene library; textures/materials/geometries are shared read-only. */
  scene: Awaited<ReturnType<Assets["scene"]>>;
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
    !/^[\w-]{1,64}$/.test(stem) ||
    !["data", "adv_data"].includes(dataRoot)
  )
    throw new Error("Invalid native pedestrian asset path");

  const prefix = `${dataRoot}/${personDirectory}`;
  const personalityText = await assets.text(`${prefix}/${stem}.TXT`);
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
  const form = parsePedForm(await assets.text(formPath));
  const remap = form.remapFilename
    ? parsePedRemap(
        await assets.text(`${dataRoot}/PEDS/REMAPS/${form.remapFilename}`),
      )
    : undefined;
  const defaultMovesText = await assets.text(
    `${dataRoot}/PEDS/MOVES/${defaultsStem}.TXT`,
  );
  const profile = parsePedPersonalitySimpleBody(
    personalityText,
    form,
    remap,
    defaultMovesText,
  );
  const actorFiles = assets
    .files(prefix, /^[^/]+\.act$/i)
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
  const actorPath = required(actorFiles[0], `${prefix} actor scene`);
  const sceneStem = actorPath
    .split("/")
    .pop()!
    .replace(/\.act$/i, "");
  const scene = await assets.scene(prefix, sceneStem);
  const group = new THREE.Group();
  group.name = `native-ped:${stem}`;
  group.matrix.identity();
  group.matrixAutoUpdate = false;
  const geometryCache = new Map<string, THREE.BufferGeometry>();
  const rootBone = form.bones[0];
  const rootIdentifier = required(
    profile.modelsByBone.get(rootBone.name)?.[0],
    `${stem} root model`,
  );
  const rootDatName = rootIdentifier.replace(/\.ACT$/i, ".DAT");
  required(scene.models.get(assetKey(rootDatName)), `${prefix}/${rootDatName}`);
  const sceneNative = scene as typeof scene & {
    defaultMaterial?: THREE.Material;
  };
  let rootActor: THREE.Object3D | undefined;
  scene.group.traverse((object) => {
    if (rootActor || !(object as THREE.Mesh).isMesh) return;
    const mesh = object as THREE.Mesh;
    if (assetKey(mesh.name) === assetKey(rootDatName))
      rootActor = mesh.parent ?? undefined;
  });
  const selectedRootActor = required(
    rootActor,
    `${prefix} ACT node for root model ${rootDatName}`,
  );
  if (
    !Object.prototype.hasOwnProperty.call(
      selectedRootActor.userData,
      "c2ActorMaterialName",
    )
  )
    throw new Error(
      `Native pedestrian asset missing: ACT material metadata for ${rootDatName}`,
    );
  const inheritedName = selectedRootActor.userData.c2ActorMaterialName;
  const inheritedActorMaterial =
    inheritedName === null
      ? required(
          sceneNative.defaultMaterial,
          `${prefix} BRender default material`,
        )
      : required(
          scene.materials.get(assetKey(String(inheritedName))),
          `${prefix}/${String(inheritedName)}.MAT (ACT inherited material)`,
        );

  const buildModel = (name: string, boneName: string, updateable: boolean) => {
    const model = required(
      scene.models.get(assetKey(name)),
      `${prefix}/${name}`,
    );
    const remapped = remappedModel(model, remap?.get(boneName));
    // ReadPersonality marks contiguous nonnull set0 poses updateable as part
    // of set1 preparation. The cached original library MODEL stays untouched.
    if (updateable) remapped.flags |= 0x80;
    const bounds = modelBounds(remapped);
    const cacheKey = `${assetKey(name)}:${remapped.flags}:${(remap?.get(boneName)?.general ?? []).join(",")}`;
    let geometry = geometryCache.get(cacheKey);
    if (!geometry) {
      geometry = createModelGeometry(remapped);
      geometryCache.set(cacheKey, geometry);
    }
    const materials = [
      ...new Set(model.faces.map((face) => face.material)),
    ].map((slot) => {
      if (slot === 0) return inheritedActorMaterial;
      const materialName = required(
        model.materials[slot - 1],
        `${name} material slot ${slot}`,
      );
      return required(
        scene.materials.get(assetKey(materialName)),
        `${prefix}/${materialName}.MAT`,
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
      // Personality entries may use .ACT for historical model names. The
      // library's flattened geometry is still the corresponding DAT model.
      const datName = identifier.replace(/\.ACT$/i, ".DAT");
      const { model, bounds, geometry, materials } = buildModel(
        datName,
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
    const motion = parsePedMotion(
      await assets.bytes(`${dataRoot}/PEDS/MOVES/${move.filename}`),
    );
    moves.set(move.id, {
      id: move.id,
      form: move,
      personality: profile.movement.get(move.id) ?? null,
      motion,
    });
  }
  group.updateMatrixWorld(true);
  return { group, form, profile, bones, moves, scene, inheritedActorMaterial };
}
