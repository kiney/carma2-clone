import { damagePercentageChance } from "./components";
import type { CrushVector } from "./crush";

/** Original detach_data state values: attached0, jointed/semi-detached1,
 * fully detached2. The renderer/physics owner performs reparenting and creates
 * constraints; these helpers implement the audited transitions and scalars.
 */
export interface AttachmentState {
  type: number;
  phase: 0 | 1 | 2;
  accumulatedForce: number;
  queuedAt: number | null;
  detachedAt: number | null;
}
export function createAttachmentState(type: number): AttachmentState {
  return {
    type,
    phase: 0,
    accumulatedForce: 0,
    queuedAt: null,
    detachedAt: null,
  };
}

const EASE_FACTORS: Readonly<Record<string, number>> = {
  very_easy: 0.25,
  easy: 0.5,
  normal: 1,
  difficult: 2,
  very_difficult: 4,
};
export function detachmentThreshold(ease: string, normalForce = 0.1): number {
  const factor = EASE_FACTORS[ease.toLowerCase()];
  if (factor === undefined)
    throw new Error(`Unknown WAM detachment ease: ${ease}`);
  return normalForce * factor;
}

/** HW 0x43202a adds cappedForce*maximum pre-eligibility influence; WAM
 * softness is deliberately absent. The caller enforces the global queue16,
 * host/offline authority, car immunity/snapped flags and per-part availability.
 * cappedForce is min(queuedForce,.5)/DEDUPLICATED contact count.
 */
export function accumulateDetachmentForce(
  state: AttachmentState,
  cappedForce: number,
  maxInfluence: number,
  threshold: number,
  now: number,
  lastScheduled: number,
  immediate = false,
): number | null {
  if (state.phase !== 0) return null;
  state.accumulatedForce += cappedForce * maxInfluence;
  if (state.queuedAt !== null || !(state.accumulatedForce > threshold))
    return null;
  state.queuedAt = immediate ? now : Math.max(now, lastScheduled + 1000);
  return state.queuedAt;
}

/** Call only after physics creation/placement succeeds. SemiDetachBit can
 * reject an obstructed placement and retain its queue entry for retry. */
export function beginPartDetachment(
  state: AttachmentState,
  now: number,
): boolean {
  if (state.phase !== 0 || state.queuedAt === null || now < state.queuedAt)
    return false;
  state.phase = state.type === 2 ? 2 : 1;
  state.detachedAt = now;
  state.queuedAt = null;
  return true;
}

/** Joint limit directions must already be in the parent's coordinate frame.
 * Actual HW 0x434860 returns true if ANY pair has dot product>.707107. */
export function jointAllowsSeparation(
  limits: readonly { parent: CrushVector; childInParent: CrushVector }[],
): boolean {
  return limits.some(
    ({ parent, childInParent }) =>
      parent[0] * childInParent[0] +
        parent[1] * childInParent[1] +
        parent[2] * childInParent[2] >
      0.707107,
  );
}

/** DoFullyDetaching0x438850: elapsed time alone does not free ordinary bits;
 * normal/stubborn still require the geometric joint predicate after5 seconds.
 * Special subtype5 (kev flap) is not freed by this switch. */
export function shouldFullyDetachPart(
  state: AttachmentState,
  now: number,
  outside: boolean,
  random: () => number = Math.random,
  maxDetachTime = 5000,
): boolean {
  if (state.phase !== 1 || state.detachedAt === null) return false;
  if (state.type === 2 || state.type === 4) return true;
  if (state.type !== 0 && state.type !== 1) return false;
  const elapsed = Math.max(0, now - state.detachedAt);
  return (
    outside &&
    (elapsed >= maxDetachTime ||
      damagePercentageChance((100 * elapsed) / maxDetachTime, random))
  );
}

/** ReAttachBit restores the actor's original parent/hinge alignment and removes
 * detached physics/joints; TotallyRepairModels also clears accumulated force.
 * Those scene/physics actions belong to the caller, which retained the parent.
 */
export function resetAttachmentState(state: AttachmentState): void {
  state.phase = 0;
  state.accumulatedForce = 0;
  state.queuedAt = null;
  state.detachedAt = null;
}

export function detachedPartMass(
  partVolume: number,
  carMass: number,
  carVolume: number,
): number {
  return Math.max(0.01, carVolume > 0 ? (partVolume * carMass) / carVolume : 0);
}
export function detachedBoxInertia(
  mass: number,
  dimensions: CrushVector,
): [number, number, number] {
  const squares = dimensions.map((value) => value * value);
  return [
    (mass * (squares[1] + squares[2])) / 12,
    (mass * (squares[0] + squares[2])) / 12,
    (mass * (squares[0] + squares[1])) / 12,
  ];
}

/** SetUpDetachedBitObject0x433640: all inputs/output are world coordinates.
 * Original physics stores omega in child coordinates after transforming it;
 * world omega itself is inherited unchanged. Ordinary queued crush adds no kick.
 */
export function inheritedDetachedVelocity(
  parentVelocity: CrushVector,
  angularVelocity: CrushVector,
  parentCenter: CrushVector,
  childCenter: CrushVector,
): [number, number, number] {
  const r = childCenter.map((value, axis) => value - parentCenter[axis]);
  return [
    parentVelocity[0] + angularVelocity[1] * r[2] - angularVelocity[2] * r[1],
    parentVelocity[1] + angularVelocity[2] * r[0] - angularVelocity[0] * r[2],
    parentVelocity[2] + angularVelocity[0] * r[1] - angularVelocity[1] * r[0],
  ];
}
