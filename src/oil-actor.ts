import { Matrix4, Mesh, Object3D, Vector3 } from "three";
import { liveModelBounds } from "./render-geometry";
import type { OilActorFollower } from "./physics/oil";

/** A source ACT owns one MODEL. Child ACT models and a smash point cannot
 * substitute for its bounds. The loader retains all original MODEL vertices. */
export function nativeOilActorFollower(
  actor: Object3D,
  readMatrix?: () => Matrix4,
): OilActorFollower {
  const mesh =
    actor instanceof Mesh
      ? actor
      : (actor.children.find((child) => child instanceof Mesh) as
          | Mesh
          | undefined);
  if (!mesh) throw new Error(`Oil source ACT has no MODEL: ${actor.name}`);
  const source = mesh.geometry.userData.sourcePositions as
    | Float32Array
    | undefined;
  const flags = mesh.geometry.userData.modelFlags as number | undefined;
  if (!source?.length || source.length % 3 || flags === undefined)
    throw new Error(`Oil source MODEL data unavailable: ${actor.name}`);
  if (flags & 0x400)
    throw new Error(
      `Oil source custom MODEL bounds provider required: ${actor.name}`,
    );
  const model = mesh.geometry;
  liveModelBounds(model); // Fail before allocating a spill slot.
  const liveMatrix =
    readMatrix ??
    (() => {
      actor.updateWorldMatrix(true, false);
      return actor.matrixWorld.clone();
    });
  return {
    identity: actor,
    readMatrix: liveMatrix,
    readPosition: () => new Vector3().setFromMatrixPosition(liveMatrix()),
    readModelBounds: () => liveModelBounds(model),
  };
}
