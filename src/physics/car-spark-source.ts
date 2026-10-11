import { Vector3 } from "three";
import type { CarSparkParticipant, CarSparkSource } from "../car-sparks";
import type { RigidState } from "./contact";
import { NATIVE_IMPACT_MINIMUM_LAMBDA } from "./impact-groups";
const f32 = Math.fround;
function stored(v: Vector3) {
  v.set(f32(v.x), f32(v.y), f32(v.z));
  if (![v.x, v.y, v.z].every(Number.isFinite))
    throw new Error("Invalid native car spark vector");
  return v;
}
/** Installed41d4b1–41d593. Secondary LINEAR velocity feeds this allocator;
 * there is no relative angular point velocity or downward force doubling. */
export function nativeCarSparkSource(input: {
  primary: CarSparkParticipant;
  secondary: CarSparkParticipant;
  primaryState: RigidState;
  secondaryState: RigidState;
  totalLambda: number;
  localPoint: Vector3;
  worldForce: Vector3;
  timeSyncMs: number;
}): CarSparkSource | undefined {
  const total = f32(input.totalLambda);
  if (!Number.isFinite(total) || total < 0)
    throw new Error("Invalid native car spark severity");
  if (total <= NATIVE_IMPACT_MINIMUM_LAMBDA) return;
  // Installed 41d43d–41d4ab: either world's linear velocity must move.
  // Angular speed and a large stationary contact force do not pass this gate.
  const primaryVelocity = stored(input.primaryState.velocity.clone());
  const velocity = stored(input.secondaryState.velocity.clone());
  if (!(primaryVelocity.lengthSq() > 0.0009 || velocity.lengthSq() > 0.0009))
    return;
  // Installed X/Y spill the doubled value before halving; Z has one store.
  velocity.x = f32(f32(velocity.x * 2) * 0.5);
  velocity.y = f32(f32(velocity.y * 2) * 0.5);
  const orientation = input.primaryState.orientation;
  const force = stored(
    input.worldForce.clone().applyQuaternion(orientation.clone().invert()),
  );
  stored(force.applyQuaternion(orientation));
  stored(force.multiplyScalar(6.9));
  const position = stored(
    stored(input.localPoint.clone())
      .applyQuaternion(orientation)
      .add(input.primaryState.position),
  );
  return {
    position,
    velocity,
    force,
    cars: [input.primary, input.secondary],
    timeSyncMs: input.timeSyncMs,
  };
}
