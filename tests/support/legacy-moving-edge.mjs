// Independent numerical oracle copied from this MIT project before scalarization.
// Keep the original Vector3 arithmetic, root ordering and storage boundaries.
import { Vector3 } from "three";

export function sweepMovingEdges(
  staticStart,
  staticEnd,
  oldStart,
  oldEnd,
  newStart,
  newEnd,
) {
  const edge = staticEnd.clone().sub(staticStart);
  const original = oldEnd.clone().sub(oldStart);
  const movement = newStart.clone().sub(oldStart);
  const edgeChange = newEnd.clone().sub(newStart).sub(original);
  const relative = oldStart.clone().sub(staticStart);
  const normal0 = edge.clone().cross(original);
  const normalDelta = edge.clone().cross(edgeChange);
  const a = movement.dot(normalDelta);
  const b = relative.dot(normalDelta) + movement.dot(normal0);
  const c = relative.dot(normal0);
  const roots = [];
  const coefficientScale = Math.max(
    Math.abs(a),
    Math.abs(b),
    Math.abs(c),
    1e-30,
  );
  if (Math.abs(a) <= 1e-12 * coefficientScale) {
    if (Math.abs(b) > 1e-12 * coefficientScale) roots.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      // Stable quadratic roots, with the zero-q double root handled separately.
      const q = -0.5 * (b + (b >= 0 ? root : -root));
      if (q === 0) roots.push(-b / (2 * a));
      else roots.push(q / a, c / q);
    }
  }
  roots.sort((x, y) => x - y);
  for (const fraction of roots) {
    if (fraction < 0 || fraction > 1) continue;
    const currentEdge = original.clone().addScaledVector(edgeChange, fraction);
    const normal = edge.clone().cross(currentEdge);
    const normalSquared = normal.lengthSq();
    if (normalSquared < 1e-7) continue;
    const offset = relative.clone().addScaledVector(movement, fraction);
    const staticParameter =
      offset.clone().cross(currentEdge).dot(normal) / normalSquared;
    const movingParameter =
      offset.clone().cross(edge).dot(normal) / normalSquared;
    if (
      staticParameter < 0 ||
      staticParameter > 1 ||
      movingParameter < 0 ||
      movingParameter > 1
    )
      continue;
    normal.normalize().multiplyScalar(c < 0 ? -1 : 1);
    return {
      normal,
      points: [oldStart.clone().addScaledVector(original, movingParameter)],
      pointsB: [staticStart.clone().addScaledVector(edge, staticParameter)],
      contactTypes: [0],
      penetration: 0,
      fraction: Math.fround(fraction),
      measures: [Math.fround(fraction)],
    };
  }
  return null;
}
