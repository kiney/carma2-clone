import type { BufferGeometry } from "three";
import type { DatModel, MatMaterial } from "./formats";
import {
  prepareNativeTrackEdgeFlags,
  type NativeTrackEdgeFlags,
  type NativeTrackEdgeFace,
} from "./native-track-edge-flags";

export interface NativeTrackSceneEdgePreparation {
  status: "complete" | "provider-required";
  requiredProviders: string[];
  /** Actual loaded MODEL identities, not names or render traversal ranks. */
  models: ReadonlyMap<DatModel, NativeTrackEdgeFlags>;
  appliedGeometries: number;
  changedFaces: number;
}
const key = (name: string) =>
  name.replace(/\.(pix|mat|dat|act|tif|tiff)$/i, "").toLowerCase();

/** Run the native load-time pass before noncar/destruction/render mutations.
 * Authored DAT and geometry sourceFaces remain immutable; existing consumers
 * read sourceFaceFlags in render-triangle order and carry it through batching,
 * mirrored winding and local smash replacement. */
export function prepareNativeTrackSceneEdges(scene: {
  models: ReadonlyMap<string, DatModel>;
  sourceMaterials: ReadonlyMap<string, MatMaterial>;
  sourceModelGeometries: ReadonlyMap<DatModel, BufferGeometry>;
}): NativeTrackSceneEdgePreparation {
  const missing = new Set<string>(),
    prepared = new Map<DatModel, NativeTrackEdgeFlags>();
  let appliedGeometries = 0,
    changedFaces = 0;
  for (const model of new Set(scene.models.values())) {
    const geometry = scene.sourceModelGeometries.get(model);
    if (!geometry) {
      missing.add(`native-track-edge-MODEL-geometry:${model.name}`);
      continue;
    }
    let unresolved = false;
    const faces: NativeTrackEdgeFace[] = model.faces.map((face) => {
      if (
        !Number.isInteger(face.material) ||
        face.material < 0 ||
        face.material > model.materials.length
      )
        throw new Error(
          `Native track edge raw MAT index exceeds MODEL ${model.name}`,
        );
      const material =
        face.material === 0
          ? null
          : scene.sourceMaterials.get(key(model.materials[face.material - 1]));
      if (material === undefined) {
        missing.add(
          `native-track-edge-raw-MAT:${model.materials[face.material - 1]}`,
        );
        unresolved = true;
      }
      return {
        indices: face.indices,
        flags: face.flags,
        material: material ?? null,
      };
    });
    if (unresolved) continue;
    const index = geometry.index,
      count = index?.count ?? geometry.getAttribute("position")?.count ?? 0;
    if (
      count !== model.faces.length * 3 ||
      geometry.getAttribute("position")?.count !== model.faces.length * 3
    )
      throw new Error(
        `Native track edge geometry is not an initial MODEL: ${model.name}`,
      );
    const renderFaces = new Uint32Array(model.faces.length),
      seen = new Uint8Array(model.faces.length);
    for (let triangle = 0; triangle < model.faces.length; triangle++) {
      const vertex = index ? index.getX(triangle * 3) : triangle * 3,
        face = Math.floor(vertex / 3);
      if (!Number.isInteger(face) || face < 0 || face >= model.faces.length)
        throw new Error(
          `Native track edge triangle exceeds MODEL ${model.name}`,
        );
      if (seen[face])
        throw new Error(
          `Native track edge triangle repeats a source face: ${model.name}`,
        );
      seen[face] = 1;
      for (let corner = 0; corner < 3; corner++)
        if (
          (index
            ? index.getX(triangle * 3 + corner)
            : triangle * 3 + corner) !==
          face * 3 + corner
        )
          throw new Error(
            `Native track edge triangle has a changed source layout: ${model.name}`,
          );
      renderFaces[triangle] = face;
    }
    const result = prepareNativeTrackEdgeFlags({
      positions: model.positions,
      faces,
      // LoadTrackModels/AddSmoothModels clears these authored flags before
      // MungeTrackModel. Keep the DAT resource itself unchanged.
      modelFlags: (model.flags | 0x80) & 0xfdfe,
    });
    const renderFlags = Uint8Array.from(
      renderFaces,
      (face) => result.faceFlags[face],
    );
    geometry.userData.sourceFaceFlags = renderFlags;
    geometry.userData.c2NativeTrackEdgeFlags = true;
    geometry.userData.modelFlags = result.modelFlags;
    prepared.set(model, result);
    appliedGeometries++;
    for (let i = 0; i < model.faces.length; i++)
      if (result.faceFlags[i] !== model.faces[i].flags) changedFaces++;
  }
  return {
    status: missing.size ? "provider-required" : "complete",
    requiredProviders: [...missing],
    models: prepared,
    appliedGeometries,
    changedFaces,
  };
}
