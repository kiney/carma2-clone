import { Matrix4, Object3D, Quaternion, Vector3 } from "three";

/** Replace only the car's interpolated render pose. A queued ACT may have
 * detached before effects flush; its independent world pose then wins.
 * Geometry ownership and the retained physics/car owner are separate. */
export function wamEffectFrame(
  car: Object3D,
  actor: Object3D,
  position: Vector3,
  orientation: Quaternion,
): Matrix4 {
  actor.updateWorldMatrix(true, false);
  let ancestor: Object3D | null = actor;
  while (ancestor && ancestor !== car) ancestor = ancestor.parent;
  if (!ancestor) return actor.matrixWorld.clone();
  return new Matrix4()
    .compose(position, orientation, new Vector3(1, 1, 1))
    .multiply(car.matrixWorld.clone().invert())
    .multiply(actor.matrixWorld);
}
