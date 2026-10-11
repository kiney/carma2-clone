import { Object3D, Vector3 } from "three";
import type { WorldSparkSource } from "../sparks";
import type { RigidState } from "./contact";
import { NATIVE_IMPACT_MINIMUM_LAMBDA } from "./impact-groups";

export interface NativeWorldSparkInput {
  car: Object3D;
  state: RigidState;
  driver: number;
  carFlags?: number;
  totalLambda: number;
  hasSecondary: boolean;
  hasFace: boolean;
  /** Lambda-weighted model-origin point, after native cmpos addition. */
  localPoint: Vector3;
  /** Raw sum of world contact normals times lambda, before damage scaling. */
  worldForce: Vector3;
  sparkiness: number;
  timeSyncMs: number;
}

const f32 = Math.fround;
function stored(value: Vector3) {
  value.set(f32(value.x), f32(value.y), f32(value.z));
  if (![value.x, value.y, value.z].every(Number.isFinite))
    throw new Error("Invalid native world spark vector");
  return value;
}

/** Installed collision dispatcher41d65f–41d7d4. This point-velocity formula
 * intentionally uses the model-origin point, not a generic COM-relative lever.
 * Caller invokes after damage dispatch but before applying solver impulses. */
export function nativeWorldSparkSource(
  input: NativeWorldSparkInput,
): WorldSparkSource | undefined {
  const severity = f32(input.totalLambda);
  if (!Number.isFinite(severity) || severity < 0)
    throw new Error("Invalid native world spark severity");
  if (
    severity <= NATIVE_IMPACT_MINIMUM_LAMBDA ||
    input.hasSecondary ||
    !input.hasFace ||
    !(input.driver > 5 || ((input.carFlags ?? 0) & 0x200000) !== 0)
  )
    return;
  const worldVelocity = stored(input.state.velocity.clone());
  if (!(worldVelocity.lengthSq() > 0.0009)) return;
  const point = stored(input.localPoint.clone());
  const inverse = input.state.orientation.clone().invert();
  const omega = stored(
    input.state.angularVelocity.clone().applyQuaternion(inverse),
  );
  const localVelocity = stored(worldVelocity.clone().applyQuaternion(inverse));
  const velocity = stored(
    stored(omega.cross(point).add(localVelocity)).applyQuaternion(
      input.state.orientation,
    ),
  );
  const position = stored(
    point
      .clone()
      .applyQuaternion(input.state.orientation)
      .add(input.state.position),
  );
  // Original group sum is stored in body coordinates, then transformed again.
  const force = stored(input.worldForce.clone().applyQuaternion(inverse));
  if (worldVelocity.y < f32(-2.8985507488250732))
    stored(force.multiplyScalar(2));
  stored(force.applyQuaternion(input.state.orientation));
  stored(force.multiplyScalar(6.9));
  return {
    car: input.car,
    position,
    velocity,
    force,
    sparkiness: input.sparkiness,
    timeSyncMs: input.timeSyncMs,
  };
}
