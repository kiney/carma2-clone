import type { ActNode, DatModel } from "./formats";
import {
  createNativeActorOrder,
  knownNativeActorValue,
} from "./native-actor-order";
import { nativeRawModelBounds } from "./native-track-resources";
import {
  extractNativeTrackLayout,
  type NativeTrackLayoutResult,
} from "./native-track-layout";

/** Bind actual authored ACT/DAT identities before track load mutations. MAT and
 * prepared-face order are not prerequisites for BrActorToBounds. */
export function captureNativeTrackSceneLayout(scene: {
  sourceActors: readonly ActNode[];
  models: ReadonlyMap<string, DatModel>;
  findSourceModel?: (identifier: string) => DatModel | undefined;
  sourceModelStorage?: readonly DatModel[];
}): NativeTrackLayoutResult {
  if (scene.sourceActors.length !== 1)
    throw new Error(
      "Native track layout requires the actual single loaded ACT root",
    );
  const key = (name: string) =>
    name.replace(/\.(pix|mat|dat|act|tif|tiff)$/i, "").toLowerCase();
  const state = createNativeActorOrder(scene.sourceActors, {
    model: (name) => {
      const model = scene.findSourceModel
        ? scene.findSourceModel(name)
        : scene.models.get(key(name));
      return model
        ? knownNativeActorValue(model)
        : { resolved: false, requiredProvider: `native source MODEL:${name}` };
    },
  });
  const models = new Set(scene.sourceModelStorage ?? scene.models.values());
  return extractNativeTrackLayout(state.roots[0], {
    defaultModel: {
      resolved: false,
      requiredProvider: "actual BRender default MODEL identity/bounds",
    },
    modelBounds: (identity) => {
      const model = identity as DatModel;
      if (!models.has(model))
        throw new Error(
          "Native layout MODEL is not an actual loaded DAT identity",
        );
      function* positions() {
        for (let i = 0; i < model.positions.length; i += 3)
          yield [
            model.positions[i],
            model.positions[i + 1],
            model.positions[i + 2],
          ];
      }
      if (model.positions.length % 3)
        throw new Error(
          "Native layout MODEL needs complete RAW vertex triples",
        );
      const result = nativeRawModelBounds(
        (model.flags | 0x80) & 0xfdfe,
        positions(),
      );
      if (!result.resolved) return result;
      if (!result.value)
        throw new Error("Native RAW bounds returned unexpected NULL");
      return knownNativeActorValue(result.value.bounds);
    },
  });
}
