import { Box3 } from "three";
import type { HullBody, PosePath } from "./pair-guard";

/** Native free integration keeps COM on a line even through full gyro turns.
 * This bounds the complete physical path without evaluating angular samples.
 * Parent-driven/custom paths and analytic spheres require their own bounds. */
export function freeWorldEnvelope(
  body: HullBody,
  path: PosePath,
): Box3 | undefined {
  const motion = path.guardMotion;
  if (!motion || path.temporalGroup !== body || (motion.centerError ?? 0) !== 0)
    return;
  const old = path(0);
  const normError = Math.abs(old.orientation.lengthSq() - 1);
  if (!Number.isFinite(normError) || normError > 1e-6) return;
  const com = motion.centerOfMass;
  let radius = 0;
  for (const hull of body.hulls)
    for (const vertex of hull.vertices)
      radius = Math.max(radius, vertex.distanceTo(com));
  const start = com.clone().applyQuaternion(old.orientation).add(old.position);
  const end = start.clone().add(motion.delta);
  if (![radius, ...start.toArray(), ...end.toArray()].every(Number.isFinite))
    return;
  const magnitude = Math.max(
    1,
    radius,
    ...start.toArray().map(Math.abs),
    ...end.toArray().map(Math.abs),
  );
  return new Box3()
    .setFromPoints([start, end])
    .expandByScalar(
      radius * (1 + 4 * normError) + 0.005 + 64 * Number.EPSILON * magnitude,
    );
}
