import { Matrix4, Object3D, Texture, Vector3 } from "three";
import { nativeOilActorFollower } from "./oil-actor";
import type { ExplosionRuntime } from "./explosion";
import type { SmashExplosion } from "./world-smash";

export interface SmashExplosionContext {
  readMatrix?: () => Matrix4;
  timeMs: number;
  isVisible(point: Vector3): boolean;
  textures?: ReadonlyMap<string, Texture>;
}

/** Spawn WAM/world smash explosions from their queued ACT owner. Installed
 * 0x4ed4e2 culls at that actor's origin before model/resource work or RNG. */
export function spawnSmashExplosions(
  runtime: Pick<ExplosionRuntime, "spawn">,
  groups: readonly SmashExplosion[],
  actor: Object3D,
  context: SmashExplosionContext,
): number {
  const readMatrix =
    context.readMatrix ??
    (() => {
      actor.updateWorldMatrix(true, false);
      return actor.matrixWorld.clone();
    });
  const origin = new Vector3().setFromMatrixPosition(readMatrix());
  if (!context.isVisible(origin)) return 0;

  const follower = nativeOilActorFollower(actor, readMatrix);
  return runtime.spawn(
    groups,
    origin,
    follower.readModelBounds(),
    context.timeMs,
    undefined,
    undefined,
    follower.readMatrix,
    context.textures,
  );
}
