import { Vector3 } from "three";
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

/** One native car's outer-frame damage snapshot. Caller begins once per game
 * frame, not per40ms substep; accepted attribution clears only accumulated
 * damage, while the first-contact face survives until the next frame. */
export class NativeCrashRecord {
  cachedSpeed = 0;
  preSpeed = 0;
  frameKnackered = false;
  localVelocity = new Vector3();
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
    this.firstContactFace = 7;
    this.accumulator = 0;
    // Native RecordLastDamage does not clear the stale normalized-Z field.
  }

  finishFrame(worldVelocity: Vector3): void {
    this.cachedSpeed = nativeCrashSpeedCache(this.cachedSpeed, worldVelocity);
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
