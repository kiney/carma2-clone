import type {
  NativeSmashPowerupPhysics,
  NativeSmashPowerupQueue,
} from "./smash-gameplay";

/** Installed SmashEnvironment4f0f6b tests byte1, then reads two decimal bytes.
 * Reject malformed authored identifiers instead of emulating unchecked reads. */
export function nativePickupPowerupIndex(identifier: string): number | null {
  if (identifier.charCodeAt(1) !== 0xa3) return null;
  const tens = identifier.charCodeAt(2) - 48;
  const units = identifier.charCodeAt(3) - 48;
  return Number.isInteger(tens) &&
    tens >= 0 &&
    tens <= 9 &&
    Number.isInteger(units) &&
    units >= 0 &&
    units <= 9
    ? 10 * tens + units
    : null;
}

export interface NativePickupPowerupResult {
  queued: boolean;
  /** Index14 falls back to HitMine4d9ad0 when car/capacity admission fails.
   * Host must dispatch its existing reaction on the actual incoming physics. */
  mineReaction: boolean;
}

/** Installed HitPowerup4f0db0 local race path. Upstream ACT/face admission has
 * already happened: there is no connotation distance gate or pickup radius.
 * ACT removal is independent of whether this fifty-entry queue admits a grant.
 * The separate network type32 fallback is deliberately not synthesized. */
export function enqueueNativePickupPowerup<Car, Actor>(input: {
  queue: NativeSmashPowerupQueue<Car, Actor>;
  index: number;
  actor: Actor;
  physics?: NativeSmashPowerupPhysics<Car>;
}): NativePickupPowerupResult {
  if (!Number.isInteger(input.index) || input.index < 0 || input.index > 99)
    throw new Error("Invalid native pickup powerup index");
  const owner = input.physics?.type === 1 ? input.physics.owner : undefined;
  const eligible =
    owner && (input.index === 14 ? owner.driver > 5 : owner.driver === 8);
  const queued =
    !!eligible &&
    input.queue.enqueue({
      car: owner.car,
      index: input.index,
      actor: input.actor,
    });
  return { queued, mineReaction: input.index === 14 && !queued };
}
