/** Personality-owned MODEL set1, independently composed from installed
 * ReadPersonality406e61..4070bc and BuildPedestrian4d2e54..4d2f08. */
import * as THREE from "three";
import type { DatFace, DatModel } from "./formats";
import type { NativePedAssets } from "./ped-native-assets";
import { createModelGeometry } from "./render-geometry";

const key = (name: string) => name.replace(/\.(?:mat|dat)$/i, "").toLowerCase();
const clonedName = (name: string, extension: "DAT" | "MAT") => {
  const stem = name.split(".")[0];
  if (!stem || /[\\/\0]/.test(name))
    throw new Error("Invalid native pedestrian clone identifier");
  return `${stem}1.${extension}`;
};

/** The source50-entry MAT ownership table is global, separate from personality
 * MODEL lifetime. Share this object across personalities in one race. Borrowed
 * maps/materials are never disposed by this registry. */
export class NativePedDeadMaterialRegistry {
  readonly materials = new Map<string, THREE.Material>();
  readonly clonedMaterials: THREE.Material[] = [];

  constructor(materials: ReadonlyMap<string, THREE.Material> = new Map()) {
    for (const [name, material] of materials)
      this.materials.set(key(name), material);
  }

  addBorrowed(materials: ReadonlyMap<string, THREE.Material>): void {
    for (const [name, material] of materials)
      if (!this.materials.has(key(name)))
        this.materials.set(key(name), material);
  }

  find(name: string): THREE.Material | undefined {
    return this.materials.get(key(name));
  }

  cloneFirst(original: THREE.Material): THREE.Material | null {
    const name = clonedName(original.name, "MAT");
    const existing = this.find(name);
    if (existing) return existing;
    if (this.clonedMaterials.length >= 50) return null;
    const clone = original.clone();
    clone.name = name;
    this.materials.set(key(name), clone);
    this.clonedMaterials.push(clone);
    return clone;
  }

  dispose(): void {
    for (const material of this.clonedMaterials) {
      if (this.find(material.name) === material)
        this.materials.delete(key(material.name));
      material.dispose();
    }
    this.clonedMaterials.length = 0;
  }
}

export interface NativePedDeadModel {
  boneIndex: number;
  poseIndex: number;
  sourceIdentifier: string;
  identifier: string;
  /** Copied remapped raw source MODEL, with flags80, never a copied header. */
  model: DatModel;
  actor: THREE.Group;
  geometry: THREE.BufferGeometry;
  bounds: THREE.Box3;
  /** The native cloned face MAT pointer mapping, in original face order. */
  faceMaterials: readonly (THREE.Material | null)[];
}
export interface NativePedDeadModels {
  /** Compatible with NativePedInstanceCreateOptions.modelSet1. These are
   * identity MODEL resource containers, not posed/stable physical bone ACTs. */
  modelSet1: readonly (readonly (THREE.Group | null)[])[];
  models: readonly NativePedDeadModel[];
  materialRegistry: NativePedDeadMaterialRegistry;
  diagnostics: readonly string[];
  /** Dispose only owned MODEL geometry after all instances are released.
   * Global MAT ownership remains with materialRegistry.dispose(). */
  dispose(): void;
}
export interface NativePedDeadModelOptions {
  materialRegistry?: NativePedDeadMaterialRegistry;
  /** Nonfirst source faces and native capacity overflow can retain NULL face
   * MAT pointers. Rendering requires the actual ACT inherited/default MAT.
   * A NULL FIRST source face has no defined native cloning path. */
  nullFaceMaterial?: (boneIndex: number, poseIndex: number) => THREE.Material;
}

function sourceMesh(actor: THREE.Group, label: string): THREE.Mesh {
  const meshes = actor.children.filter((child) => child instanceof THREE.Mesh);
  if (meshes.length !== 1 || actor.children.length !== 1)
    throw new Error(
      `Native pedestrian MODEL requires one direct mesh: ${label}`,
    );
  if (!actor.matrix.equals(new THREE.Matrix4()))
    throw new Error(
      `Native pedestrian MODEL resource has an ACT transform: ${label}`,
    );
  return meshes[0] as THREE.Mesh;
}

/** Build real set1 from the loader's remapped set0 MODEL metadata. The source
 * does not load dead DAT files or deform vertices at clone time. */
export function prepareNativePedDeadModels(
  personalityName: string,
  assets: Pick<NativePedAssets, "bones" | "scene">,
  options: NativePedDeadModelOptions = {},
): NativePedDeadModels {
  if (!personalityName || /[.\\/\0]/.test(personalityName))
    throw new Error("Invalid native pedestrian personality identifier");
  if (!assets.bones.length || assets.bones.length > 32)
    throw new Error("Invalid native pedestrian bone table");
  const texture = assets.scene.textures.get(
    `${personalityName}B`.toLowerCase(),
  );
  if (!texture)
    throw new Error(
      `Native pedestrian blood texture missing: ${personalityName}B`,
    );
  const registry =
    options.materialRegistry ??
    new NativePedDeadMaterialRegistry(assets.scene.materials);
  registry.addBorrowed(assets.scene.materials);
  const livingMaterials = new Set<THREE.Material>();
  for (const bone of assets.bones)
    for (const variant of bone.variants)
      if (variant.actor) {
        const mesh = sourceMesh(variant.actor, variant.identifier);
        for (const material of Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material])
          livingMaterials.add(material);
      }
  const models: NativePedDeadModel[] = [];
  const diagnostics: string[] = [];
  const modelSet1 = assets.bones.map((bone, boneIndex) => {
    if (bone.variants.length > 4)
      throw new Error("Native pedestrian pose table exceeds four entries");
    const table: (THREE.Group | null)[] = [null, null, null, null];
    for (let poseIndex = 0; poseIndex < bone.variants.length; poseIndex++) {
      const variant = bone.variants[poseIndex];
      // Installed stops at the first NULL even if later set0 entries exist.
      if (!variant.actor) break;
      if (variant.sourceModels.length !== 1)
        throw new Error(
          `Native pedestrian MODEL identity unavailable: ${variant.identifier}`,
        );
      const mesh = sourceMesh(variant.actor, variant.identifier);
      const data = mesh.geometry.userData;
      const positions = data.sourcePositions as Float32Array | undefined;
      const uvs = data.sourceUVs as Float32Array | undefined;
      const faces = data.sourceFaces as DatFace[] | undefined;
      if (
        !(positions instanceof Float32Array) ||
        !positions.length ||
        positions.length % 3 ||
        !(uvs instanceof Float32Array) ||
        uvs.length !== (positions.length / 3) * 2 ||
        !faces?.length ||
        positions.length / 3 > 0xffff ||
        faces.length > 0xffff ||
        !positions.every(Number.isFinite) ||
        !uvs.every(Number.isFinite)
      )
        throw new Error(
          `Native pedestrian raw MODEL metadata missing: ${variant.identifier}`,
        );
      const renderMaterials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      const sourceSlots = [...new Set(faces.map((face) => face.material))];
      if (sourceSlots.length !== renderMaterials.length)
        throw new Error(
          `Native pedestrian MAT slot metadata mismatch: ${variant.identifier}`,
        );
      const slotMaterial = new Map(
        sourceSlots.map((slot, i) => [
          slot,
          slot === 0 ? null : renderMaterials[i],
        ]),
      );
      for (const face of faces)
        if (
          face.indices.length !== 3 ||
          face.indices.some(
            (i) => !Number.isInteger(i) || i < 0 || i >= positions.length / 3,
          ) ||
          !Number.isInteger(face.material) ||
          face.material < 0 ||
          !Number.isInteger(face.smoothing) ||
          !Number.isInteger(face.flags)
        )
          throw new Error(
            `Invalid native pedestrian source face: ${variant.identifier}`,
          );
      // Installed406f49..4f dereferences the first raw face's MAT+4 without
      // checking NULL. Resolved render MAT inheritance cannot fill that pointer.
      const original = slotMaterial.get(faces[0].material);
      if (!original)
        throw new Error(
          `Native first-face MAT is NULL; installed cloning has no defined path: ${variant.identifier}`,
        );
      const derivedName = clonedName(original.name, "MAT");
      const existing = registry.find(derivedName);
      if (existing && livingMaterials.has(existing))
        throw new Error(
          `Native dead MAT aliases a living material: ${derivedName}`,
        );
      const clonedMaterial = registry.cloneFirst(original);
      if (!clonedMaterial)
        diagnostics.push(`native-dead-material-capacity:${derivedName}`);
      const faceMaterials = faces.map((face) => {
        const material = slotMaterial.get(face.material)!;
        return material === original ? clonedMaterial : material;
      });
      const materialPointers = [...new Set(faceMaterials)];
      let nullMaterial: THREE.Material | undefined;
      if (materialPointers.includes(null)) {
        nullMaterial = options.nullFaceMaterial?.(boneIndex, poseIndex);
        if (!nullMaterial)
          throw new Error(
            `Native NULL dead MAT requires ACT material provider: ${derivedName}`,
          );
      }
      const identifier = clonedName(variant.sourceModels[0], "DAT");
      // Preserve pointer equivalence across distinct source material slots.
      const nonnullPointers = materialPointers.filter(
        (material): material is THREE.Material => material !== null,
      );
      const model: DatModel = {
        name: identifier,
        flags: 0x80,
        positions: positions.slice(),
        uvs: uvs.slice(),
        materials: nonnullPointers.map((material) => material.name),
        faces: faces.map((face, i) => ({
          ...face,
          indices: [...face.indices],
          material:
            faceMaterials[i] === null
              ? 0
              : nonnullPointers.indexOf(faceMaterials[i]!) + 1,
        })),
      };
      const geometry = createModelGeometry(model);
      const bounds = new THREE.Box3();
      for (let i = 0; i < positions.length; i += 3)
        bounds.expandByPoint(
          new THREE.Vector3(positions[i], positions[i + 1], positions[i + 2]),
        );
      const actor = new THREE.Group();
      actor.name = identifier;
      actor.matrixAutoUpdate = false;
      actor.matrix.identity();
      actor.visible = false;
      actor.userData.nativePedModelIdentifier = identifier;
      actor.userData.nativePedSourceModelIdentifier = variant.sourceModels[0];
      actor.userData.nativePedModelSet = 1;
      // Group.clone serializes userData; shared MODEL metadata belongs to the
      // borrowed geometry so Float32Array/Box3 identity survives instance clones.
      geometry.userData.nativePedModelBounds = bounds;
      geometry.userData.nativePedRawModel = model;
      const cloneMesh = new THREE.Mesh(
        geometry,
        materialPointers.map((m) => m ?? nullMaterial!),
      );
      cloneMesh.name = identifier;
      actor.add(cloneMesh);
      table[poseIndex] = actor;
      models.push({
        boneIndex,
        poseIndex,
        sourceIdentifier: variant.sourceModels[0],
        identifier,
        model,
        actor,
        geometry,
        bounds,
        faceMaterials,
      });
    }
    return table;
  });
  // BuildPedestrian changes only this named MAT; other derived MATs stay as
  // ordinary copies. Maps are borrowed, not independently recoloured pixels.
  const bloodMaterial = registry.find(`${personalityName}1.MAT`);
  if (bloodMaterial) {
    if (livingMaterials.has(bloodMaterial))
      throw new Error("Native blood MAT aliases a living material");
    if (!("map" in bloodMaterial))
      throw new Error("Native blood MAT colour-map provider unavailable");
    (bloodMaterial as THREE.MeshLambertMaterial).map = texture;
    bloodMaterial.needsUpdate = true;
  }
  return {
    modelSet1,
    models,
    materialRegistry: registry,
    diagnostics,
    dispose: () => {
      for (const model of models) model.geometry.dispose();
    },
  };
}
