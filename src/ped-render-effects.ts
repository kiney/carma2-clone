/** Installed pedestrian MODEL scaling and prepared vertex consumers.
 * MODEL resources belong to a personality, while ACT pose belongs to an instance.
 * See docs/c2-ped-render-effects-re.md for evidence and ownership. */
import * as THREE from "three";
import {
  prepareNativeModelVertexOrder,
  type ModelPreparedOptions,
} from "./car-smoke";
import type { DatFace, DatModel } from "./formats";
import type { NativePedAssets } from "./ped-native-assets";
import type { NativePedDeadModels } from "./ped-dead-models";
import type { NativePedInstance } from "./ped-native-instance";
import { nativePedBoxInertia, type PedVector } from "./ped-form";
import { createModelGeometry, updateModelNormals } from "./render-geometry";
import type {
  NativeResourceHandle,
  NativeResourceArena,
} from "./native-resource-arena";
import { nativeRenderMaterialSource } from "./native-material-render";

const f = Math.fround;
const ownedMaterialLeases = new WeakMap<
  NativeResourceArena,
  Map<object, { handle: NativeResourceHandle; users: number }>
>();
type MutableVector = [number, number, number];
function vector(value: PedVector, positive = false): MutableVector {
  if (
    value.length !== 3 ||
    value.some(
      (n) =>
        !Number.isFinite(n) || !Number.isFinite(f(n)) || (positive && n <= 0),
    )
  )
    throw new Error("Invalid native pedestrian render vector");
  return [f(value[0]), f(value[1]), f(value[2])];
}
function multiply(value: PedVector, scale: PedVector): MutableVector {
  return vector(value.map((n, i) => f(n * scale[i])) as MutableVector);
}
function meshOf(actor: THREE.Object3D): THREE.Mesh {
  if (actor instanceof THREE.Mesh) return actor;
  if (actor.children.length !== 1 || !(actor.children[0] instanceof THREE.Mesh))
    throw new Error("Native pedestrian MODEL requires one direct mesh");
  return actor.children[0];
}
function rawModel(geometry: THREE.BufferGeometry): DatModel {
  const positions = geometry.userData.sourcePositions;
  const uvs = geometry.userData.sourceUVs;
  const faces = geometry.userData.sourceFaces as DatFace[] | undefined;
  const flags = geometry.userData.modelFlags;
  if (
    !(positions instanceof Float32Array) ||
    !(uvs instanceof Float32Array) ||
    !faces ||
    !Number.isInteger(flags)
  )
    throw new Error("Native pedestrian requires actual raw MODEL metadata");
  return {
    name: geometry.userData.nativePedRawModel?.name ?? "pedestrian-owned-model",
    positions,
    uvs,
    faces,
    flags,
    materials: [],
    pivot: vector(geometry.userData.c2Pivot ?? [0, 0, 0]),
  };
}

/** 40bba6..40bbd2 writes the powerup triplet into the mapped component.
 * This is inverse axis assignment, unlike general vertex remapping. The native
 * negative-code branch negates the current loop component after assignment. */
export function nativePedPowerupScale(
  scale: PedVector,
  remap: PedVector | null,
): MutableVector {
  const input = vector(scale),
    output: MutableVector = [0, 0, 0];
  if (remap === null) return input;
  if (
    remap.length !== 3 ||
    remap.some((n) => !Number.isInteger(n) || n < 0 || n > 5) ||
    new Set(remap.map((n) => n % 3)).size !== 3
  )
    throw new Error("Invalid native pedestrian powerup remap");
  remap.forEach((code, i) => {
    output[code % 3] = input[i];
    if (code >= 3) output[i] = f(-output[i]);
  });
  return output;
}

/** MODEL-local points, including native pivot subtraction. This captures the
 * actual prepared allocation permutation once; updateable POSITION changes retain
 * its vertex_user order. Sampling reads the live current render vertex each time.
 * group0's inclusive random upper bound may address the next group's first vertex. */
export function prepareNativePedVertexSampler(
  actor: THREE.Object3D,
  options?: ModelPreparedOptions,
) {
  const mesh = meshOf(actor),
    geometry = mesh.geometry;
  const source = rawModel(geometry);
  const prepared =
    (geometry.userData.nativePedPreparedOrder as
      | ReturnType<typeof prepareNativeModelVertexOrder>
      | undefined) ??
    prepareNativeModelVertexOrder(
      source,
      options ?? geometry.userData.nativePedPreparedOptions ?? {},
    );
  if (
    prepared.materialOrder === "browser-first-approximation" ||
    prepared.remainingMaterialOrder ===
      "browser-positive-material-approximation"
  )
    throw new Error(
      "Native pedestrian prepared vertices require actual material pointer order",
    );
  geometry.userData.nativePedPreparedOrder = prepared;
  const positions = geometry.getAttribute("position");
  if (!positions || positions.count !== source.faces.length * 3)
    throw new Error(
      "Native pedestrian prepared vertices require face-corner crosswalk",
    );
  const pivot = source.pivot ?? [0, 0, 0];
  return {
    ...prepared,
    count: prepared.corners.length,
    sampleVertex(index: number, out: THREE.Vector3): boolean {
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= prepared.corners.length ||
        mesh.geometry !== geometry
      )
        return false;
      const corner = prepared.corners[index];
      out.set(
        f(positions.getX(corner) - pivot[0]),
        f(positions.getY(corner) - pivot[1]),
        f(positions.getZ(corner) - pivot[2]),
      );
      return out.toArray().every(Number.isFinite);
    },
  };
}

/** One private mutable personality per race, shared by all its presenters.
 * Source assets, alive/dead MODEL ownership and caller-owned ACTs stay separate.
 * Construct deadModels from the original assets BEFORE constructing this owner. */
export class NativePedRenderEffects {
  readonly template: NativePedAssets;
  readonly modelSet1: readonly (readonly (THREE.Group | null)[])[] | undefined;
  private bodyScale: MutableVector = [1, 1, 1];
  private headScale = 1;
  private readonly geometries = new Map<
    THREE.BufferGeometry,
    THREE.BufferGeometry
  >();
  private readonly instances = new Set<NativePedInstance>();
  private readonly materialReleases: (() => void)[] = [];
  private disposed = false;

  constructor(
    readonly original: NativePedAssets,
    deadModels?: NativePedDeadModels,
  ) {
    const copyActor = (
      actor: THREE.Group | null,
      options?: ModelPreparedOptions,
    ) => {
      if (!actor) return null;
      const sourceMesh = meshOf(actor),
        sourceGeometry = sourceMesh.geometry;
      let geometry = this.geometries.get(sourceGeometry);
      if (!geometry) {
        const model = { ...rawModel(sourceGeometry), name: actor.name };
        geometry = createModelGeometry(model);
        geometry.userData.nativePedPreparedOptions =
          options ?? sourceGeometry.userData.nativePedPreparedOptions;
        geometry.userData.nativePedRawModel = {
          ...rawModel(geometry),
          name: actor.name,
        };
        const bounds = new THREE.Box3();
        for (let i = 0; i < model.positions.length; i += 3)
          bounds.expandByPoint(
            new THREE.Vector3().fromArray(model.positions, i),
          );
        geometry.userData.nativePedModelBounds = bounds;
        this.geometries.set(sourceGeometry, geometry);
      }
      const copied = actor.clone(false);
      const mesh = new THREE.Mesh(geometry, sourceMesh.material);
      mesh.name = sourceMesh.name;
      copied.add(mesh);
      // POSITION-only updates retain preparation membership/order. Capture it
      // before the first scale, including unnormalized smoothing split keys.
      prepareNativePedVertexSampler(copied);
      return copied;
    };
    const bones = original.bones.map((bone) => ({
      ...bone,
      attachments: bone.attachments
        ? {
            child: vector(bone.attachments.child),
            parent: vector(bone.attachments.parent),
          }
        : null,
      variants: bone.variants.map((variant) => {
        const actor = copyActor(variant.actor, variant.preparedOptions);
        return {
          ...variant,
          actor,
          modelBounds: new Map(
            [...variant.modelBounds].map(([name, bounds]) => [
              name,
              bounds.clone(),
            ]),
          ),
        };
      }),
    }));
    const movement = new Map(
      [...original.profile.movement].map(([id, move]) => [id, { ...move }]),
    );
    const profile = {
      ...original.profile,
      bounds: {
        min: vector(original.profile.bounds.min),
        max: vector(original.profile.bounds.max),
      },
      centreOfMass: vector(original.profile.centreOfMass),
      inertia: vector(original.profile.inertia),
      movement,
      attachmentsByBone: new Map(
        bones
          .filter((bone) => bone.attachments)
          .map((bone) => [bone.name, bone.attachments!]),
      ),
    };
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    for (const bone of bones)
      for (const variant of bone.variants)
        if (variant.actor) group.add(variant.actor);
    this.template = {
      ...original,
      group,
      bones,
      profile,
      moves: new Map(
        [...original.moves].map(([id, move]) => [
          id,
          { ...move, personality: movement.get(id) ?? null },
        ]),
      ),
      dispose: () => this.dispose(),
    };
    if (deadModels) {
      const optionsFor = (actor: THREE.Group): ModelPreparedOptions => {
        const entry = deadModels.models.find((entry) => entry.actor === actor);
        if (!entry)
          throw new Error("Native dead MODEL metadata is unavailable");
        const pointers = new Map<number, number>([[0, 0]]);
        const bySlot = new Map<number, THREE.Material | null>();
        entry.model.faces.forEach((face, i) =>
          bySlot.set(face.material, entry.faceMaterials[i]),
        );
        for (const [slot, material] of bySlot) {
          if (material === null) continue;
          // Ordinary Three render clones retain their source MAT identity, but
          // BonerCloneModel's named clone is a NEW native MAT resource.
          const source = deadModels.materialRegistry.clonedMaterials.includes(
            material,
          )
            ? undefined
            : nativeRenderMaterialSource(material);
          const identity = source ?? material;
          let address = original.scene.materialArena.materialAddress(identity);
          if (!source) {
            const arena = original.scene.materialArena;
            let leases = ownedMaterialLeases.get(arena);
            if (!leases) ownedMaterialLeases.set(arena, (leases = new Map()));
            let lease = leases.get(identity);
            if (!address.resolved) {
              lease = { handle: arena.allocateMaterial(identity), users: 0 };
              leases.set(identity, lease);
              address = arena.materialAddress(identity);
            }
            if (lease) {
              lease.users++;
              const held = lease;
              this.materialReleases.push(() => {
                if (--held.users === 0) {
                  leases!.delete(identity);
                  arena.free(held.handle);
                }
              });
            }
          }
          if (!address.resolved)
            throw new Error(
              "Native dead MODEL material address is unavailable",
            );
          pointers.set(slot, address.address);
        }
        return {
          materialPointers: pointers,
          materialPointerProvenance: "host-resource-addresses",
        };
      };
      this.modelSet1 = deadModels.modelSet1.map((poses) =>
        poses.map((actor) =>
          copyActor(actor, actor ? optionsFor(actor) : undefined),
        ),
      );
    }
    // Template initial actor pointers must match its copied MODEL resources.
    bones.forEach((bone) => {
      bone.actor = bone.variants[0]?.actor ?? null;
    });
  }

  bind(instance: NativePedInstance): () => void {
    if (this.disposed || instance.template !== this.template)
      throw new Error(
        "Native pedestrian render effects require their owned personality",
      );
    this.instances.add(instance);
    return () => {
      this.instances.delete(instance);
    };
  }

  private scaleModels(boneIndex: number, ratio: PedVector): void {
    const bone = this.template.bones[boneIndex];
    for (const table of [
      bone.variants.map((variant) => variant.actor),
      this.modelSet1?.[boneIndex] ?? [],
    ]) {
      for (const actor of table) {
        if (!actor) break;
        const geometry = meshOf(actor).geometry,
          model = rawModel(geometry);
        for (let i = 0; i < model.positions.length; i++)
          model.positions[i] = f(model.positions[i] * ratio[i % 3]);
        const mapping = geometry.userData.sourceVertexIndices as Uint32Array;
        const positions = geometry.getAttribute("position");
        for (let i = 0; i < mapping.length; i++)
          positions.setXYZ(
            i,
            model.positions[mapping[i] * 3],
            model.positions[mapping[i] * 3 + 1],
            model.positions[mapping[i] * 3 + 2],
          );
        positions.needsUpdate = true;
        updateModelNormals(geometry);
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        const bounds = new THREE.Box3();
        for (let i = 0; i < model.positions.length; i += 3)
          bounds.expandByPoint(
            new THREE.Vector3().fromArray(model.positions, i),
          );
        geometry.userData.nativePedModelBounds = bounds;
        for (const variant of bone.variants)
          if (variant.actor && meshOf(variant.actor).geometry === geometry)
            for (const value of variant.modelBounds.values())
              value.copy(bounds);
      }
    }
  }

  private scale(ratio: PedVector, selected: number): void {
    if (this.disposed)
      throw new Error("Native pedestrian render effects are disposed");
    for (let index = 0; index < this.template.bones.length; index++) {
      if (selected >= 0 && index !== selected) continue;
      const bone = this.template.bones[index];
      const localRatio = nativePedPowerupScale(
        ratio,
        bone.powerupRemap ?? null,
      );
      this.scaleModels(index, localRatio);
      if (bone.attachments) {
        const attachment = bone.attachments.child as MutableVector;
        attachment.splice(0, 3, ...multiply(attachment, localRatio));
      }
      for (const child of this.template.bones)
        if (child.parent === index && child.attachments) {
          const attachment = child.attachments.parent as MutableVector;
          attachment.splice(0, 3, ...multiply(attachment, localRatio));
        }
    }
    // Bound instances borrow these same private personality attachment vectors.
    for (const instance of this.instances)
      instance.poseBones.forEach((pose, index) => {
        pose.childAttachment =
          this.template.bones[index].attachments?.child ?? null;
        pose.parentAttachment =
          this.template.bones[index].attachments?.parent ?? null;
      });
  }

  setBodyScale(value: PedVector): boolean {
    const next = vector(value, true),
      ratio = vector(
        next.map((n, i) => f(n / this.bodyScale[i])) as MutableVector,
      );
    if (ratio.every((n) => n === 1)) return false;
    this.scale(ratio, -1);
    const profile = this.template.profile;
    for (const move of profile.movement.values())
      move.groundingOffset = f(move.groundingOffset * ratio[0]);
    profile.bounds.min = multiply(profile.bounds.min, ratio);
    profile.bounds.max = multiply(profile.bounds.max, ratio);
    profile.centreOfMass = multiply(profile.centreOfMass, ratio);
    profile.mass = f(profile.mass * ratio[0] * ratio[2] * ratio[1]);
    profile.radius = f(
      profile.radius * (ratio[0] + ratio[2] + ratio[1]) * f(1 / 3),
    );
    profile.inertia = nativePedBoxInertia(profile.mass, profile.bounds);
    this.bodyScale = next;
    return true;
  }

  setHeadScale(value: number): boolean {
    const next = vector([value, value, value], true)[0];
    const ratio = f(next / this.headScale);
    // Installed head setter always invokes scaling, even for a unit ratio.
    this.scale([ratio, ratio, ratio], this.template.form.headBone);
    this.headScale = next;
    return ratio !== 1;
  }

  dispose(): void {
    if (this.disposed) return;
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const release of this.materialReleases) release();
    this.instances.clear();
    this.template.group.clear();
    this.disposed = true;
  }
}
