/** Ordinary pedestrian finite-face adapter. Collection preserves the native
 * world collector's order/capacity; retained cache records own their mutations. */
import { Box3, Matrix4, Vector3 } from "three";
import type {
  Surface,
  WorldCollision,
  WorldFaceCollectorCallbacks,
} from "./world";
import type { NativeModelPickFace } from "./native-model-pick";
import type { NativeTrackModelResource } from "./native-track-resources";
import type {
  NativePedGroundCollectRequest,
  NativePedGroundFace,
  NativePedGroundFaceHit,
  NativePedGroundQuery,
} from "./ped-grounding";
import type {
  NativePedProximityFace,
  NativePedProximityIndexResult,
  NativePedProximityIndices,
  NativePedProximityEdgeResult,
} from "./ped-native-proximity";
import { nativeCheckSingleFace } from "./physics/single-face";
import type { NativeWorldFaceQuery } from "./physics/world-face-cache";
import type { PedVector } from "./ped-form";
import type { MatMaterial } from "./formats";

export interface NativePedOrdinarySupportFace
  extends NativePedGroundFace,
    NativePedProximityFace {
  /** Actual emitted ACT/MODEL identity; copied by the finite ground-cache pool. */
  native: NativeModelPickFace;
  material: MatMaterial | null;
}
export interface NativePedOrdinarySupportResult {
  status: "complete" | "provider-required";
  requiredProviders: string[];
  faces: NativePedOrdinarySupportFace[];
}
export interface NativePedOrdinarySupportOptions {
  /** Use the simulation's actual collector callback outlet when available. */
  collectWorldFaces?: (
    query: NativeWorldFaceQuery,
    capacity: number,
    gatherModels: true,
  ) => readonly Surface[];
  /** Native pull/stop callbacks belong to the simulation, not this adapter. */
  callbacks?: WorldFaceCollectorCallbacks;
}
export class NativePedOrdinarySupportError extends Error {
  constructor(readonly requiredProviders: readonly string[]) {
    super(
      `Ordinary pedestrian support requires ${requiredProviders.join(", ")}`,
    );
    this.name = "NativePedOrdinarySupportError";
  }
}
const f = Math.fround;
const required = (name: string): NativePedOrdinarySupportResult => ({
  status: "provider-required",
  requiredProviders: [name],
  faces: [],
});
function vector(value: readonly number[]): PedVector {
  if (
    value.length !== 3 ||
    value.some((n) => !Number.isFinite(n) || !Number.isFinite(f(n)))
  )
    throw new Error(
      "Native pedestrian support requires finite Float32 vectors",
    );
  return [f(value[0]), f(value[1]), f(value[2])];
}
function storedPose(pose: Float32Array): Matrix4 {
  if (pose.length !== 12 || Array.from(pose).some((n) => !Number.isFinite(n)))
    throw new Error(
      "Native pedestrian support requires the actual 12-scalar pose",
    );
  // Native basis rows are Three matrix columns. Preserve authored scale/shear.
  return new Matrix4().set(
    pose[0],
    pose[3],
    pose[6],
    pose[9],
    pose[1],
    pose[4],
    pose[7],
    pose[10],
    pose[2],
    pose[5],
    pose[8],
    pose[11],
    0,
    0,
    0,
    1,
  );
}
/** No renderer vertices, names, recomputed normals or effective MAT substitutes. */
export function nativePedOrdinarySupportFace(surface: Surface):
  | {
      status: "complete";
      face: NativePedOrdinarySupportFace;
      requiredProviders: [];
    }
  | { status: "provider-required"; requiredProviders: string[] } {
  const native = surface.native;
  if (!native)
    return {
      status: "provider-required",
      requiredProviders: ["source-native-pedestrian-world-face-record"],
    };
  if ((native.material === null) !== (native.materialPresence === "null"))
    return {
      status: "provider-required",
      requiredProviders: ["source-native-pedestrian-MAT-identity"],
    };
  return {
    status: "complete",
    requiredProviders: [],
    face: {
      a: vector(native.a),
      b: vector(native.b),
      c: vector(native.c),
      normal: vector(native.normal),
      constant: f(native.constant),
      rawFlags: native.rawFlags,
      material: native.material,
      materialFlags: native.material?.flags ?? 0,
      materialIdentifier: native.material?.name ?? null,
      nativeGroup: native.nativeGroup,
      nativeFace: native.nativeFace & 0xffff,
      native,
    },
  };
}

/** One adapter can serve every ordinary owner and both finite source pools.
 * The caller retains the85 ground slots and100 process records, not this class. */
export class NativePedOrdinarySupport {
  constructor(
    readonly world: Pick<WorldCollision, "nativeScene" | "collectFaces">,
    private readonly options: NativePedOrdinarySupportOptions = {},
  ) {}
  collect(
    request: NativePedGroundCollectRequest,
  ): NativePedOrdinarySupportResult {
    if (!this.world.nativeScene) return required("source-native-world-scene");
    if (request.limit !== 76)
      throw new Error(
        "Ordinary pedestrian collection requires the native76-record request",
      );
    const low = vector(request.localBounds.min),
      high = vector(request.localBounds.max);
    if (low.some((n, i) => n > high[i]))
      throw new Error("Reversed native pedestrian support bounds");
    const query = {
      bounds: new Box3(new Vector3(...low), new Vector3(...high)),
      matrix: storedPose(request.characterPose),
    };
    let surfaces: readonly Surface[];
    try {
      surfaces = this.options.collectWorldFaces
        ? this.options.collectWorldFaces(query, request.limit, true)
        : this.world.collectFaces(
            query,
            request.limit,
            true,
            this.options.callbacks,
          );
    } catch (error) {
      const prefix = "Native world face collector requires ";
      if (error instanceof Error && error.message.startsWith(prefix))
        return required(error.message.slice(prefix.length));
      throw error;
    }
    if (surfaces.length > request.limit)
      throw new Error("Native pedestrian face collector exceeded76 records");
    const faces: NativePedOrdinarySupportFace[] = [];
    for (const surface of surfaces) {
      const result = nativePedOrdinarySupportFace(surface);
      if (result.status !== "complete") return { ...result, faces: [] };
      faces.push(result.face);
    }
    return { status: "complete", requiredProviders: [], faces };
  }
  /** Callback-compatible entry; missing native ownership never becomes no floor. */
  collectFaces(
    request: NativePedGroundCollectRequest,
  ): readonly NativePedOrdinarySupportFace[] {
    const result = this.collect(request);
    if (result.status !== "complete")
      throw new NativePedOrdinarySupportError(result.requiredProviders);
    return result.faces;
  }
  /** Installed45f1c0 on retained mutable face values. Raw bit80 and nearest-hit
   * selection remain in nativePedSelectGroundSupport's422610 policy. */
  queryFace(
    face: NativePedOrdinarySupportFace,
    query: NativePedGroundQuery,
  ): NativePedGroundFaceHit | null {
    const hit = nativeCheckSingleFace(
      {
        a: face.a,
        b: face.b,
        c: face.c,
        normal: face.normal,
        constant: face.constant,
        materialFlags: face.material?.flags,
        materialIdentifier: face.material?.name ?? null,
      },
      query,
    );
    return hit ? { parameter: hit.parameter, point: hit.point } : null;
  }
  /** MAT flags are live dereferences in native scanning. Call before scanning
   * borrowed slot records; spread/memcpy cache copies cannot retain JS getters. */
  synchronizeMaterialFlags(
    faces: readonly NativePedOrdinarySupportFace[],
  ): void {
    for (const face of faces) {
      face.materialFlags = face.material?.flags ?? 0;
      face.materialIdentifier = face.material?.name ?? null;
    }
  }
  private resource(
    face: NativePedOrdinarySupportFace,
  ): { resource: NativeTrackModelResource } | { requiredProvider: string } {
    const scene = this.world.nativeScene;
    if (!scene) return { requiredProvider: "source-native-world-scene" };
    const binding = face.native.actor.localModel;
    if (!binding.resolved)
      return { requiredProvider: binding.requiredProvider };
    if (!binding.value)
      return { requiredProvider: "source-proximity-ACT-local-MODEL-identity" };
    const resource = scene.resources.get(binding.value);
    return resource
      ? { resource }
      : { requiredProvider: "source-proximity-current-MODEL-resource" };
  }
  /** Actual g<0 raw MODEL lookup. Positive prepared-group vertex-index storage
   * is not present in today's updateable track resource owner. */
  readIndexedFace(
    face: NativePedOrdinarySupportFace,
  ): NativePedProximityIndexResult {
    const resolved = this.resource(face);
    if ("requiredProvider" in resolved)
      return {
        kind: "provider-required",
        requiredProvider: resolved.requiredProvider,
      };
    const resource = resolved.resource;
    if (face.nativeGroup >= 0)
      return {
        kind: "provider-required",
        requiredProvider: "source-proximity-prepared-group-index-storage",
      };
    if (
      !Number.isInteger(face.nativeFace) ||
      face.nativeFace < 0 ||
      face.nativeFace > 0xffff
    )
      return { kind: "invalid-face" };
    const raw = resource.current.faces[face.nativeFace];
    if (
      !raw ||
      raw.indices.some(
        (i) =>
          !Number.isInteger(i) ||
          i < 0 ||
          i >= resource.current.vertices.length,
      )
    )
      return { kind: "invalid-face" };
    return {
      kind: "indexed",
      value: {
        model: resource,
        group: face.nativeGroup,
        indices: [...raw.indices],
      },
    };
  }
  /** Installed excluded floors unconditionally index prepared.groups[g]. A raw
   * MODEL or world vertex fallback would hide a proven negative-group access. */
  readPreparedGroupVertices(
    face: NativePedOrdinarySupportFace,
    indexed: NativePedProximityIndices,
  ): NativePedProximityEdgeResult {
    if (indexed.group < 0)
      return {
        kind: "provider-required",
        requiredProvider:
          "source-proximity-unchecked-negative-prepared-group-storage",
      };
    const resolved = this.resource(face);
    if ("requiredProvider" in resolved)
      return {
        kind: "provider-required",
        requiredProvider: resolved.requiredProvider,
      };
    if (
      indexed.model !== resolved.resource ||
      indexed.group !== face.nativeGroup
    )
      return {
        kind: "provider-required",
        requiredProvider: "source-proximity-current-prepared-group-identity",
      };
    return {
      kind: "provider-required",
      requiredProvider: "source-proximity-prepared-group-vertex-storage",
    };
  }
}
