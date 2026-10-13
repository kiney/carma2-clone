import type { Object3D } from "three";

/** Native outer-frame animation owns these ACT transforms. A physics helper
 * snapshot must not overwrite the authored graphical pose or restore an older
 * pose after drawing. Includes retained NONCARs nested beneath a GROOVE actor. */
export function hasGraphicalPoseOwner(
  actor: Object3D,
  owners: ReadonlySet<Object3D> | undefined,
  allowInherited = true,
): boolean {
  if (!owners?.size) return false;
  if (!allowInherited) return owners.has(actor);
  for (let current: Object3D | null = actor; current; current = current.parent)
    if (owners.has(current)) return true;
  return false;
}
