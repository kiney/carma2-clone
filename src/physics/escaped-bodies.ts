import { Box3, Vector3 } from "three";

export type EscapedBodyReason = "far-horizontal" | "fallen" | "nonfinite";

function validBounds(bounds: Box3): boolean {
  if (bounds.isEmpty()) return false;
  return (
    [...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite) &&
    bounds.min.x <= bounds.max.x &&
    bounds.min.y <= bounds.max.y &&
    bounds.min.z <= bounds.max.z
  );
}

/**
 * Classify only bodies whose conservative sphere has left a padded authored
 * world footprint. Horizontal escape is measured in X/Z; falling is measured
 * below the world minimum. There is deliberately no upper-Y limit or speed
 * gate, so high jumps and fast movement inside the world remain playable.
 * Unknown bounds and invalid radii fail closed. A nonfinite position is
 * quarantinable only when the world bounds and radius are trustworthy.
 */
export function escapedBodyReason(
  worldBounds: Box3,
  position: Vector3,
  bodyRadius: number,
): EscapedBodyReason | undefined {
  if (
    !validBounds(worldBounds) ||
    !Number.isFinite(bodyRadius) ||
    bodyRadius < 0
  )
    return undefined;

  if (![position.x, position.y, position.z].every(Number.isFinite))
    return "nonfinite";

  const size = worldBounds.getSize(new Vector3());
  const diagonal = Math.hypot(size.x, size.y, size.z);
  if (!Number.isFinite(diagonal)) return undefined;
  const padding = Math.max(32, diagonal * 0.25);
  const minX = worldBounds.min.x - padding;
  const maxX = worldBounds.max.x + padding;
  const minY = worldBounds.min.y - padding;
  const minZ = worldBounds.min.z - padding;
  const maxZ = worldBounds.max.z + padding;

  if (
    position.x + bodyRadius < minX ||
    position.x - bodyRadius > maxX ||
    position.z + bodyRadius < minZ ||
    position.z - bodyRadius > maxZ
  )
    return "far-horizontal";

  if (position.y + bodyRadius < minY) return "fallen";
  return undefined;
}
