import { Vector3 } from "three";

/** Source MoveCarToSensiblePlace inside434910. Probe returns a world unit
 * escape direction for an obstruction, or undefined when sensible. Position
 * is restored after ten failed probes; root then restores old active hulls
 * while preserving pending geometry for the next physics tick. */
export function moveShapeToSensiblePlace(
  position: Vector3,
  probe: (position: Vector3) => Vector3 | undefined,
  worldScale = 1,
): { accepted: boolean; attempts: number; displacement: Vector3 } {
  const original = position.clone();
  const previous = new Vector3();
  let step = 0.007246377;
  for (let attempts = 0; attempts < 10; attempts++) {
    const direction = probe(position);
    if (!direction)
      return {
        accepted: true,
        attempts,
        displacement: position.clone().sub(original),
      };
    if (previous.dot(direction) <= 0.707107) {
      previous.copy(direction);
      step = 0.007246377;
    } else step *= 2;
    position.addScaledVector(direction, step * worldScale);
  }
  position.copy(original);
  return { accepted: false, attempts: 10, displacement: new Vector3() };
}
