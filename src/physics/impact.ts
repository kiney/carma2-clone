import { Vector3 } from "three";

export interface ImpactScalingParameters {
  human: boolean;
  hitCar: boolean;
  attackerHuman: boolean;
  receiverSoftness: number;
  attackerSoftness: number;
  difficultySoftness?: number;
  difficultyCarCar?: number;
  armorLevel?: number;
  offenseLevel?: number;
  armorFactor?: number;
  offenseFactor?: number;
  damageMultiplier?: number;
  protection?: number;
  sinceLastAttributedImpactMs?: number;
  /** Compatibility alias; +13e4 is crash attribution time, not repair time. */
  sinceLastRepairMs?: number;
}

/** Independent equations from collision postprocess HW 0x41ded0. rawVector
 * is the group sum of normal impulses in receiving-car local coordinates.
 * Original model impulse units feed this directly: no WORLD_SCALE multiplier.
 * The caller handles distant-opponent/network authority gates separately.
 * Default GENERAL skill tables are1; armour .91^level, offense1.06^level.
 */
export function scaleImpactVectors(
  rawVector: Vector3,
  parameters: ImpactScalingParameters,
) {
  const p = parameters;
  let factor = p.difficultySoftness ?? 1;
  if (p.hitCar) {
    if (p.human) factor *= (p.armorFactor ?? Math.pow(0.91, p.armorLevel ?? 0)) * 1.2;
    if (p.attackerHuman)
      factor *=
        (p.difficultyCarCar ?? 1) *
        (p.offenseFactor ?? Math.pow(1.06, p.offenseLevel ?? 0)) *
        (p.damageMultiplier ?? 1) *
        0.9;
    if (!p.human && !p.attackerHuman) factor *= 0.2;
    factor /= (p.attackerSoftness + 0.7) / 0.7;
  } else if (!p.human) {
    factor *= p.receiverSoftness;
    if ((p.sinceLastAttributedImpactMs ?? p.sinceLastRepairMs ?? 0) > 5000)
      factor *= 0.2;
  }
  factor *= 0.2;
  const damage = rawVector.clone().multiplyScalar(factor);
  if (p.human && (p.protection ?? 1) !== 0)
    damage.divideScalar(p.protection ?? 1);
  return { damage, crush: damage.clone().multiplyScalar(p.human ? 0.5 : 1.5) };
}

/** CheckForWastedCars0x43f620: steering and brakes alone do not waste a car.
 * Network mode3, immortality and already-wasted flags belong to the caller. */
export function isWasted(levels: ArrayLike<number>): boolean {
  if (levels.length !== 12) throw new Error("C2 cars have twelve damage units");
  return (
    levels[0] >= 99 ||
    levels[1] >= 99 ||
    levels[2] >= 99 ||
    (levels[8] >= 99 && levels[9] >= 99 && levels[10] >= 99 && levels[11] >= 99)
  );
}
