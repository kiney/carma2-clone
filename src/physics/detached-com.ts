import { Quaternion, Vector3 } from "three";

export interface DetachedTransform {
  position: Vector3;
  orientation: Quaternion;
}

/** Local HW0x433640 selects the car bounds side nearest the part bounds center
 * transformed into car space, skipping the bottom side2. It then shifts that
 * CHILD-local COM coordinate halfway from its center toward its matching bound.
 * The axis index is copied directly, as in the original initializer. */
export function detachedChildCenterOfMass(
  partMin: Vector3,
  partMax: Vector3,
  child: DetachedTransform,
  carMin: Vector3,
  carMax: Vector3,
  parent: DetachedTransform,
): { centerOfMass: Vector3; side: number } {
  const centerOfMass = partMin.clone().add(partMax).multiplyScalar(0.5);
  const carPoint = centerOfMass
    .clone()
    .applyQuaternion(child.orientation)
    .add(child.position)
    .sub(parent.position)
    .applyQuaternion(parent.orientation.clone().conjugate());
  // The original inverse-point helper stores this selector in a float vector.
  carPoint.set(
    Math.fround(carPoint.x),
    Math.fround(carPoint.y),
    Math.fround(carPoint.z),
  );
  let side = 0,
    nearest = Infinity;
  for (let candidate = 0; candidate < 6; candidate++) {
    if (candidate === 2) continue;
    const axis = candidate >> 1;
    const distance = Math.abs(
      carPoint.getComponent(axis) -
        Math.fround((candidate & 1 ? carMax : carMin).getComponent(axis)),
    );
    if (distance < nearest) {
      nearest = distance;
      side = candidate;
    }
  }
  const axis = side >> 1;
  centerOfMass.setComponent(
    axis,
    0.5 *
      (centerOfMass.getComponent(axis) +
        (side & 1 ? partMax : partMin).getComponent(axis)),
  );
  return { centerOfMass, side };
}
