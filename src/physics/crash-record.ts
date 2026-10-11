import { Quaternion, Vector3 } from "three";
import {
  normalizeDamagePoint,
  selectDamageFace,
  type ComponentBounds,
} from "./components";

function stored(value: number): number {
  const result = Math.fround(value);
  if (!Number.isFinite(result))
    throw new Error("Invalid native crash-record Float32 field");
  return result;
}
function vector(value: Vector3): Vector3 {
  return new Vector3(stored(value.x), stored(value.y), stored(value.z));
}

/** Installed post-physics416599–41660e, then copied by RecordLastDamage43f930.
 * The old cache guards the first above-epsilon movement sample. This is an
 * unsigned horizontal magnitude, independent of forward direction and gear. */
export function nativeCrashSpeedCache(
  previousCache: number,
  velocity: Vector3,
): number {
  const previous = stored(previousCache);
  if (previous < 0) throw new Error("Invalid native crash speed cache");
  const v = vector(velocity);
  const speed = stored(Math.sqrt(v.x * v.x + v.z * v.z) * Math.fround(0.001));
  const epsilon = Math.fround(0.0001);
  return previous < epsilon && speed > epsilon ? epsilon : speed;
}

const sectors = {
  top: 0,
  bottom: 1,
  left: 2,
  right: 3,
  front: 4,
  rear: 5,
} as const;

/** BrVector3Normalise: live length/reciprocal, Float32 component stores. */
export function nativeCrashDirection(value: Vector3): Vector3 {
  return normalizeLiveDirection(vector(value));
}
function normalizeLiveDirection(v: Vector3): Vector3 {
  const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (!(length > Math.fround(2 ** -22))) return new Vector3(1, 0, 0);
  const inverse = 1 / length;
  return vector(v.multiplyScalar(inverse));
}

/** Installed4167c1–4168d8: last substep velocity, live interpolation arithmetic. */
export function nativeCrashViewerDirection(
  original: Vector3,
  current: Vector3,
  deltaMs: number,
): Vector3 {
  if (!Number.isInteger(deltaMs) || deltaMs < 0 || deltaMs > 0xffffffff)
    throw new Error("Invalid native crash viewer interpolation delta");
  const oldV = vector(original),
    v = vector(current);
  const dt = deltaMs * Math.fround(0.025);
  return normalizeLiveDirection(
    new Vector3(
      (oldV.x - v.x) * dt + v.x,
      (oldV.y - v.y) * dt + v.y,
      (oldV.z - v.z) * dt + v.z,
    ),
  );
}

/** Installed4411d1–441224 uses original A/B snapshots, not selected roles. */
export function nativeCrashHeadOn(
  a: NativeCrashRecord,
  b: NativeCrashRecord,
): boolean {
  const face = (r: NativeCrashRecord) =>
    r.firstContactFace < 4
      ? r.normalizedContactZ < 0.25
        ? 4
        : r.normalizedContactZ > 0.75
          ? 5
          : r.firstContactFace
      : r.firstContactFace;
  if (
    face(a) !== 4 ||
    face(b) !== 4 ||
    !(a.preSpeed > Math.fround(0.001)) ||
    !(b.preSpeed > Math.fround(0.001))
  )
    return false;
  const da = a.preDirection,
    db = b.preDirection;
  return (
    Math.fround(da.x * db.x + da.y * db.y + da.z * db.z) < Math.fround(-0.7)
  );
}

/** One native car's outer-frame damage snapshot. Caller begins once per game
 * frame, not per40ms substep; accepted attribution clears only accumulated
 * damage, while the first-contact face survives until the next frame. */
export class NativeCrashRecord {
  cachedSpeed = 0;
  preSpeed = 0;
  frameKnackered = false;
  localVelocity = new Vector3();
  cachedDirection = new Vector3(0, 0, -1);
  preDirection = new Vector3(0, 0, -1);
  firstContactFace = 7;
  normalizedContactZ = 0;
  accumulator = 0;

  beginFrame(knackered: boolean, localVelocity: Vector3): void {
    if (typeof knackered !== "boolean")
      throw new Error("Invalid native crash knackered snapshot");
    const velocity = vector(localVelocity);
    this.frameKnackered = knackered;
    this.preSpeed = stored(this.cachedSpeed);
    this.localVelocity.copy(velocity);
    this.preDirection.copy(this.cachedDirection);
    this.firstContactFace = 7;
    this.accumulator = 0;
    // Native RecordLastDamage does not clear the stale normalized-Z field.
  }

  resetDirection(orientation: Quaternion): void {
    this.cachedDirection.copy(
      vector(new Vector3(0, 0, -1).applyQuaternion(orientation)),
    );
  }

  finishFrame(worldVelocity: Vector3, orientation = new Quaternion()): void {
    this.cachedSpeed = nativeCrashSpeedCache(this.cachedSpeed, worldVelocity);
    if (this.cachedSpeed > Math.fround(0.0001)) {
      this.cachedDirection.copy(nativeCrashDirection(worldVelocity));
    } else {
      const k = vector(new Vector3(0, 0, 1).applyQuaternion(orientation));
      const d = this.cachedDirection;
      const dot = d.x * -k.x + d.y * -k.y + d.z * -k.z;
      this.cachedDirection.copy(k.multiplyScalar(dot < 0 ? 1 : -1));
    }
  }

  recordCarContact(point: Vector3, bounds: ComponentBounds): void {
    if (this.firstContactFace !== 7) return;
    const p = vector(point).toArray() as [number, number, number];
    const storedBounds: ComponentBounds = {
      min: bounds.min.map(stored) as [number, number, number],
      max: bounds.max.map(stored) as [number, number, number],
    };
    if (storedBounds.max.some((x, i) => x <= storedBounds.min[i]))
      throw new Error("Invalid native crash contact bounds");
    const face = selectDamageFace(p, storedBounds);
    this.firstContactFace = sectors[face];
    // Installed43fcad always copies this scratch field. For front/back faces
    // it still contains point.x-min.x; only raw sectors0..3 normalize Z.
    this.normalizedContactZ =
      this.firstContactFace < 4
        ? stored(normalizeDamagePoint(p, storedBounds)[2])
        : stored(p[0] - storedBounds.min[0]);
  }

  /** Input is scaleImpactVectors.accumulatedDamage, before protection/crush.
   * Immunity bypasses DamageCar's entire accumulation path. */
  accumulate(damageVector: Vector3, invulnerable: boolean): void {
    if (invulnerable) return;
    const d = vector(damageVector);
    // Installed41e0e3 stores the squared magnitude before41e0f9–ff adds it.
    // The component FST memory stores do not replace the live scaled values.
    const squaredMagnitude = stored(
      damageVector.x * d.x + damageVector.y * d.y + damageVector.z * d.z,
    );
    this.accumulator = stored(this.accumulator + squaredMagnitude);
  }

  clearAcceptedDamage(): void {
    this.accumulator = 0;
  }
}
