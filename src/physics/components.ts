import {
  evaluateDamageProgram,
  type DamageProgramSet,
  type ImpactLocation,
  type NormalizedPoint,
} from "../damage-program";
import type { CrushVector } from "./crush";

/** Independent implementation of DamageSystems (HW 0x43fa60) and DoDamage
 * (0x43f820). Input energy comes from collision postprocessing, before crush
 * queue capping; it is not a speed, health percentage or mesh displacement.
 */
export interface ComponentBounds {
  min: CrushVector;
  max: CrushVector;
}
export interface ComponentDamageContext {
  human: boolean;
  multiplayer?: boolean;
  invulnerable?: boolean;
  raceIndex?: number;
  raceCount?: number;
  /** Uniform sample in [0,1), used only for offline human damage. */
  random?: () => number;
}

/** Z wins nearest-face ties, then X. On each axis, positive X/Z wins ties;
 * positive Y is top, and wins its tie as well. */
export function selectDamageFace(
  point: CrushVector,
  bounds: ComponentBounds,
): ImpactLocation {
  const min = point.map((value, axis) => value - bounds.min[axis]);
  const max = point.map((value, axis) => bounds.max[axis] - value);
  const near = min.map((value, axis) => Math.min(value, max[axis]));
  if (near[2] <= near[0] && near[2] <= near[1])
    return max[2] <= min[2] ? "rear" : "front";
  if (near[0] <= near[1] && near[0] <= near[2])
    return max[0] <= min[0] ? "right" : "left";
  return min[1] < max[1] ? "bottom" : "top";
}

/** Original programs refer to the two axes lying on the selected surface.
 * Normalize all three here to make unused-axis values well-defined; unlike the
 * original stack temporary, malformed clauses cannot read stale coordinates.
 * No clamping: impacts outside the bounds can legitimately exceed [0,1]. */
export function normalizeDamagePoint(
  point: CrushVector,
  bounds: ComponentBounds,
): NormalizedPoint {
  return point.map((value, axis) => {
    const extent = bounds.max[axis] - bounds.min[axis];
    return extent !== 0 ? (value - bounds.min[axis]) / extent : 0.5;
  }) as NormalizedPoint;
}

export function componentImpactMagnitude(
  energyVector: CrushVector,
  carSoftness: number,
  face: ImpactLocation,
  hitAnotherCar: boolean,
): number {
  const magnitude = (Math.hypot(...energyVector) * carSoftness) / 0.7;
  return face === "bottom" && !hitAnotherCar ? magnitude * 0.5 : magnitude;
}

/** PercentageChance (0x512f30) compares a random integer 0..99 with the
 * integer percentage; rec2's reconstructed inclusive 0..100 differs. */
export function damagePercentageChance(
  percent: number,
  random: () => number,
): boolean {
  const integerPercent = Math.trunc(percent);
  if (integerPercent === 0) return false;
  return Math.floor(random() * 100) < integerPercent;
}

export function componentDamageIncrement(
  weakness: number,
  energy: number,
  context: ComponentDamageContext,
): number {
  const weighted = weakness * energy;
  if (context.human) {
    if (context.multiplayer) return Math.trunc(weighted * 15);
    return damagePercentageChance(
      weighted * 1500,
      context.random ?? Math.random,
    )
      ? Math.trunc(weighted * 30)
      : 0;
  }
  const raceCount = context.raceCount ?? 1;
  const fraction = raceCount !== 0 ? (context.raceIndex ?? 0) / raceCount : 0;
  return Math.trunc(weighted * 10 * (5.95 - 4.95 * fraction));
}

/** Twelve levels range 0..99. A small increment cannot finish a component:
 * when it would reach99, the entire increment is discarded. */
export function applyDamageUnit(
  level: number,
  systemIndex: number,
  increment: number,
  context: Pick<ComponentDamageContext, "human" | "invulnerable">,
): number {
  if (
    context.invulnerable ||
    (context.human && systemIndex === 2) ||
    increment < 5
  )
    return level;
  const next = level + Math.trunc(increment);
  return next >= 99 ? (increment < 10 ? level : 99) : next;
}

export interface ComponentImpactInput {
  point: CrushVector;
  bounds: ComponentBounds;
  energyVector: CrushVector;
  hitAnotherCar: boolean;
  context: ComponentDamageContext;
}
export interface ComponentDamageEvent {
  systemIndex: number;
  increment: number;
  previous: number;
  level: number;
}

/** Every matching clause applies, preserving authored clause/effect order.
 * Sequential updates matter near99 because increments below10 are rejected
 * individually rather than summed into an invented aggregate hit. */
export function applyComponentImpact(
  levels: { length: number; [index: number]: number },
  data: DamageProgramSet,
  input: ComponentImpactInput,
) {
  if (levels.length !== 12) throw new Error("C2 cars have twelve damage units");
  const face = selectDamageFace(input.point, input.bounds);
  const normalizedPoint = normalizeDamagePoint(input.point, input.bounds);
  const energy = componentImpactMagnitude(
    input.energyVector,
    data.softness,
    face,
    input.hitAnotherCar,
  );
  const events: ComponentDamageEvent[] = [];
  if (!energy || input.context.invulnerable)
    return { face, normalizedPoint, energy, events };
  for (const effect of evaluateDamageProgram(
    data.programs[face],
    normalizedPoint,
  )) {
    const increment = componentDamageIncrement(
      effect.weaknessFactor,
      energy,
      input.context,
    );
    const previous = levels[effect.systemIndex];
    const level = applyDamageUnit(
      previous,
      effect.systemIndex,
      increment,
      input.context,
    );
    levels[effect.systemIndex] = level;
    events.push({
      systemIndex: effect.systemIndex,
      increment,
      previous,
      level,
    });
  }
  return { face, normalizedPoint, energy, events };
}

const WOBBLE_Y = [0, -0.15, 0.4, 0.15, -0.4, 0.25, 0, -0.25];
const WOBBLE_Z = [0.4, -0.25, 0, 0.25, 0, 0.15, -0.4, -0.15];
/** Wheel damage affects orientation above30 (DoWheelDamage); returned angles
 * are degrees to apply around the wheel actor's local Y and Z axes. */
export function wheelDamageWobble(level: number, raceFinished = false) {
  if (level <= 30 || raceFinished) return { yDegrees: 0, zDegrees: 0 };
  const index = Math.trunc(level) % 8;
  return {
    yDegrees: (level - 30) * WOBBLE_Y[index],
    zDegrees: (level - 30) * WOBBLE_Z[index],
  };
}
