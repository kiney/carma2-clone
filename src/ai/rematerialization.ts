import { Vector3 } from "three";

const f = Math.fround;
const EPSILON = 2 ** -22;
const stored = (v: Vector3) => new Vector3(f(v.x), f(v.y), f(v.z));
function checked(v: Vector3): Vector3 {
  const result = stored(v);
  if (!result.toArray().every(Number.isFinite))
    throw new Error("Invalid native rematerialization vector");
  return result;
}

/** Installed4a8bd9–8daa retries after restoring the SAVED actor matrix.
 * One initial placement test precedes retries0..22 (24 tests total).
 * Ground alignment and TestForCarInSensiblePlace remain caller obligations.
 */
export function nativeRematerializationRetry(
  savedPosition: Vector3,
  savedRow2: Vector3,
  retry: number,
): Vector3 {
  if (!Number.isInteger(retry) || retry < 0 || retry > 22)
    throw new Error("Invalid native rematerialization retry index");
  const position = checked(savedPosition);
  const row = checked(savedRow2);
  if (retry > 20) {
    position.y = f(position.y + 2 * (retry - 20));
    return checked(position);
  }
  const forward = row.negate();
  const lateral = retry % 4 >= 2;
  const direction = lateral ? new Vector3(forward.z, 0, -forward.x) : forward;
  const length = Math.sqrt(direction.lengthSq());
  if (length <= EPSILON) direction.set(1, 0, 0);
  else direction.multiplyScalar(1 / length);
  // Unlike the velocity normalizer, these normalized components stay live.
  const radius = Math.trunc(retry / 4) * f(lateral ? 0.1 : 0.5);
  const sign = retry % 2 ? -1 : 1;
  return checked(position.addScaledVector(direction, radius * sign));
}

/** Installed4a8914–4a8a8e: normalize negative ACTrow2 with a live norm,
 * store normalized components, then scale by the upper-only speed cap10.
 * The 6.9 ground-query translation conversion does not apply to this speed.
 */
export function nativeRematerializationVelocity(
  row2: Vector3,
  speed: number,
): Vector3 {
  const direction = checked(row2).negate();
  const value = f(speed);
  if (!Number.isFinite(value))
    throw new Error("Invalid native rematerialization speed");
  const length = Math.sqrt(direction.lengthSq());
  if (length <= EPSILON) direction.set(1, 0, 0);
  else direction.multiplyScalar(1 / length);
  return checked(stored(direction).multiplyScalar(Math.min(value, 10)));
}
