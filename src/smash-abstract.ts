import { Vector3, type Material } from "three";
import type { ShrapnelSource } from "./shrapnel";

/** Installed DoShrapnel4eb6ef–4eb717 and wrapper4f88e0.
 * Abstract connotations use authored materials, zero normal and starting-step
 * metric velocity. They do not use the ordinary car-colour random branch. */
export function nativeAbstractShrapnel(input: {
  position: Vector3;
  startingVelocity?: Vector3;
  effectMagnitude: number;
  materials: readonly Material[];
}): ShrapnelSource {
  const magnitude = Math.fround(input.effectMagnitude);
  if (!Number.isFinite(magnitude) || magnitude < 0)
    throw new Error("Invalid abstract shrapnel magnitude");
  if (!input.materials.length)
    throw new Error(
      "Abstract shrapnel requires original material alternatives",
    );
  return {
    position: input.position.clone(),
    // Missing incoming velocity selects installed global660148=(0,1,0).
    velocity: input.startingVelocity?.clone() ?? new Vector3(0, 1, 0),
    normal: new Vector3(),
    forceLength: Math.fround(Math.sqrt(magnitude) * Math.fround(10)),
    cars: [null, null],
    materials: input.materials,
  };
}
