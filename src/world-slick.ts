import type { Material } from "three";
import type { SmashSlick } from "./world-smash";
import type { OilActorFollower, OilRuntime } from "./physics/oil";

/** DoConnotations4ed50e retains ACT/MODEL and all ReadSpillData fields.
 * Neither texturechange suppression nor impact magnitude gates this outlet. */
export function queueWorldSlick(
  runtime: OilRuntime,
  spec: SmashSlick,
  source: OilActorFollower,
  materials: ReadonlyMap<string, Material>,
  timeMs: number,
) {
  const key = (name: string) => name.replace(/\.mat$/i, "").toLowerCase();
  const material = materials.get(key(spec.material));
  if (!material)
    throw new Error(`World slick material missing: ${spec.material}`);
  const smearMaterial = spec.secondMaterial
    ? materials.get(key(spec.secondMaterial))
    : null;
  if (
    spec.firstPair[1] !== 0 &&
    (!spec.secondPair || !spec.secondMaterial || !smearMaterial)
  )
    throw new Error(
      `World slick smear material/parameters missing: ${spec.secondMaterial ?? spec.material}`,
    );
  return runtime.queueAuthoredSpill(
    source,
    {
      delayMs: Math.trunc(Math.fround(spec.first[0])),
      growthPerMs: [spec.first[1], spec.first[2]],
      initialHalfSize: spec.second[0],
      fullSize: [spec.second[1], spec.second[2]],
      friction: spec.firstPair,
      ...(spec.firstPair[1] !== 0
        ? { smearDistance: spec.secondPair, smearMaterial }
        : {}),
      material,
    },
    timeMs,
  );
}
