import { Box3, Group, Matrix4, Mesh, Vector3, type Material } from "three";
import { nativeRawModelBounds } from "./native-track-resources";
import type { PedBloodSettings } from "./ped-blood";
import type { NativePedRuntimeAllocation } from "./ped-native-runtime";
import type { NativePedInstance } from "./ped-native-instance";
import type {
  AuthoredOilSpill,
  OilActorFollower,
  OilRuntime,
  OilSpill,
} from "./physics/oil";

export interface NativePedSlickHost<Owner extends object> {
  oil: OilRuntime;
  /** Must be the runtime's current allocation(owner), not a template render. */
  allocation: NativePedRuntimeAllocation<Owner> | null;
  slick: PedBloodSettings["slick"];
  materials: ReadonlyMap<string, Material>;
  timeMs: number;
}

export type NativePedSlickResult =
  | { status: "queued"; spill: OilSpill; requiredProviders: [] }
  | {
      status: "provider-required";
      spill: null;
      requiredProviders: string[];
    }
  | {
      status: "allocation-failed";
      spill: null;
      requiredProviders: ["shared-oil-spill-allocation"];
    };

type MissingSlick = Extract<
  NativePedSlickResult,
  { status: "provider-required" }
>;
const missing = (...requiredProviders: string[]): MissingSlick => ({
  status: "provider-required",
  spill: null,
  requiredProviders,
});
const materialKey = (name: string) => name.replace(/\.mat$/i, "").toLowerCase();

function identityMatrix(group: Group | Mesh): boolean {
  return group.matrix.equals(new Matrix4());
}

/** Validate the actual live source owners without allocating or drawing CRT. */
function prepareNativePedCorpseSlick<Owner extends object>(
  host: NativePedSlickHost<Owner>,
):
  | MissingSlick
  | { status: "ready"; source: OilActorFollower; authored: AuthoredOilSpill } {
  const allocation = host.allocation;
  if (!allocation) return missing("source-current-ped-render-allocation");
  if (
    !Number.isInteger(allocation.renderSlot) ||
    allocation.renderSlot < 0 ||
    allocation.renderSlot > 0x7f ||
    allocation.phase !== "owned"
  )
    return missing("source-current-ped-render-slot");
  const instance: NativePedInstance | null = allocation.render.instance;
  if (
    !instance ||
    allocation.render.actorSet.actors[0] !== instance.bones[0]?.actor
  )
    return missing("source-current-ped-root-ACT");
  const actor = instance.bones[0]?.actor,
    model = instance.bones[0]?.model;
  if (!actor || !(model instanceof Group))
    return missing("source-current-ped-root-MODEL");
  if (
    actor.parent !== instance.group ||
    model.parent !== actor ||
    model.children.length !== 1 ||
    !(model.children[0] instanceof Mesh) ||
    !identityMatrix(model) ||
    !identityMatrix(model.children[0])
  )
    return missing("source-unambiguous-current-ped-root-MODEL");
  const mesh = model.children[0],
    geometry = mesh.geometry,
    sourcePositions = geometry.userData.sourcePositions as
      | Float32Array
      | undefined,
    flags = geometry.userData.modelFlags as number | undefined;
  if (
    !(sourcePositions instanceof Float32Array) ||
    !sourcePositions.length ||
    sourcePositions.length % 3 ||
    !Number.isInteger(flags)
  )
    return missing("source-current-ped-root-MODEL-raw-bounds");
  let nativeBounds: ReturnType<typeof nativeRawModelBounds>;
  try {
    nativeBounds = nativeRawModelBounds(
      flags!,
      Array.from({ length: sourcePositions.length / 3 }, (_, i) =>
        Array.from(sourcePositions.subarray(i * 3, i * 3 + 3)),
      ),
    );
  } catch {
    return missing("source-current-ped-root-MODEL-valid-raw-bounds");
  }
  if (!nativeBounds.resolved) return missing(nativeBounds.requiredProvider);
  if (!nativeBounds.value)
    return missing("source-current-ped-root-MODEL-bounds");
  const pixelmap = host.slick.pixelmap,
    material = host.materials.get(materialKey(pixelmap));
  if (!material)
    return missing(`source-registered-ped-slick-material:${pixelmap}`);
  let smearMaterial: Material | undefined;
  if (host.slick.friction[1] !== 0) {
    if (!host.slick.smearDistance || !host.slick.smearMaterial)
      return missing("source-ped-slick-smear-settings");
    smearMaterial = host.materials.get(materialKey(host.slick.smearMaterial));
    if (!smearMaterial)
      return missing(
        `source-registered-ped-slick-smear-material:${host.slick.smearMaterial}`,
      );
  }
  const source = {
    identity: actor,
    readMatrix: () => {
      actor.updateWorldMatrix(true, false);
      return actor.matrixWorld.clone();
    },
    readPosition: () => {
      actor.updateWorldMatrix(true, false);
      return new Vector3().setFromMatrixPosition(actor.matrixWorld);
    },
    // Native QueueOilSpill2 retains this MODEL pointer, not a bounds snapshot.
    // Selecting another ACT.model must not redirect it to the new resource.
    readModelBounds: () => {
      const positions = geometry.userData.sourcePositions;
      if (
        !(positions instanceof Float32Array) ||
        !positions.length ||
        positions.length % 3
      )
        throw new Error("Retained pedestrian MODEL raw bounds unavailable");
      function* rawPositions() {
        for (let i = 0; i < positions.length; i += 3)
          yield [positions[i], positions[i + 1], positions[i + 2]];
      }
      const current = nativeRawModelBounds(
        geometry.userData.modelFlags,
        rawPositions(),
      );
      if (!current.resolved) throw new Error(current.requiredProvider);
      if (!current.value)
        throw new Error("Retained pedestrian MODEL bounds are NULL");
      return new Box3(
        new Vector3(...current.value.bounds.min),
        new Vector3(...current.value.bounds.max),
      );
    },
  };
  return {
    status: "ready",
    source,
    authored: {
      delayMs: host.slick.delayMs,
      growthPerMs: host.slick.growth,
      initialHalfSize: host.slick.initialSize,
      fullSize: host.slick.fullSize,
      friction: host.slick.friction,
      ...(host.slick.smearDistance
        ? { smearDistance: host.slick.smearDistance }
        : {}),
      material,
      ...(smearMaterial ? { smearMaterial } : {}),
    },
  };
}

/** Preflight prevents unavailable host resources consuming a native halt latch.
 * It makes no allocation, source mutation, chance draw or allocator draw. */
export function nativePedCorpseSlickRequirements<Owner extends object>(
  host: NativePedSlickHost<Owner>,
): string[] {
  const prepared = prepareNativePedCorpseSlick(host);
  return prepared.status === "ready" ? [] : prepared.requiredProviders;
}

/** Queue the already-gated native corpse-slick effect into OilRuntime's shared pool.
 * The halt owner owns chance/latch/CRT ordering; this adapter makes no chance draw. */
export function queueNativePedCorpseSlick<Owner extends object>(
  host: NativePedSlickHost<Owner>,
): NativePedSlickResult {
  const prepared = prepareNativePedCorpseSlick(host);
  if (prepared.status !== "ready") return prepared;
  const spill = host.oil.queueAuthoredSpill(
    prepared.source,
    prepared.authored,
    host.timeMs,
  );
  return spill
    ? { status: "queued", spill, requiredProviders: [] }
    : {
        status: "allocation-failed",
        spill: null,
        requiredProviders: ["shared-oil-spill-allocation"],
      };
}
