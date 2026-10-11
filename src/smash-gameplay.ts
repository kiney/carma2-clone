import type { SmashConnotations } from "./world-smash";

export interface NativeSmashPowerup<Car, Actor = object> {
  car: Car;
  index: number;
  actor: Actor | null;
}

/** Installed 0x4f0db0 stores fifty {car,index,actor} records. Unlike the
 * twenty-entry texture queue, these records survive argument-one barriers. */
export class NativeSmashPowerupQueue<Car, Actor = object> {
  static readonly capacity = 50;
  private records: NativeSmashPowerup<Car, Actor>[] = [];
  private pendingCount = 0;
  private flushing = false;

  get count(): number {
    return this.pendingCount;
  }

  initialize(): void {
    if (this.flushing)
      throw new Error("Cannot initialize powerups during flush");
    this.pendingCount = 0;
  }

  enqueue(entry: NativeSmashPowerup<Car, Actor>): boolean {
    if (!Number.isInteger(entry.index) || entry.index < 0)
      throw new Error("Invalid smash powerup index");
    if (this.pendingCount >= NativeSmashPowerupQueue.capacity) return false;
    this.records[this.pendingCount++] = { ...entry };
    return true;
  }

  /** Native FlushSmashQueue(0) grants before respawn and rereads the live
   * count after each grant. Consumed slots still count against capacity until
   * the entire drain ends. FlushSmashQueue(1) leaves this queue untouched. */
  flush(
    mode: 0 | 1,
    grant: (entry: Readonly<NativeSmashPowerup<Car, Actor>>) => void,
    respawn?: (index: number, actor: Actor | null) => void,
  ): number {
    if (mode === 1) return 0;
    if (mode !== 0) throw new Error("Invalid smash powerup flush mode");
    if (this.flushing)
      throw new Error("Cannot recursively flush smash powerups");
    this.flushing = true;
    let consumed = 0;
    try {
      for (let i = 0; i < this.pendingCount; i++) {
        const entry = Object.freeze({ ...this.records[i] });
        grant(entry);
        respawn?.(entry.index, entry.actor);
        consumed++;
      }
      this.pendingCount = 0;
      return consumed;
    } finally {
      this.flushing = false;
    }
  }
}

export interface NativeSmashPowerupPhysics<Car> {
  type: number;
  owner?: { car: Car; driver: number };
  /** Live physics actor translation, in original model/world units. */
  position: readonly [number, number, number];
}

/** Parser compatibility retains `roomCode`; installed DoConnotations
 * 0x4ed29e-0x4ed314 actually interprets it as a powerup table index. This
 * connotation path always supplies a null respawn actor. */
export function enqueueConnotationPowerup<Car, Actor>(
  queue: NativeSmashPowerupQueue<Car, Actor>,
  roomCode: number,
  physics: NativeSmashPowerupPhysics<Car> | undefined,
  effectPoint: readonly [number, number, number] | undefined,
  suppressed = false,
): boolean {
  if (
    suppressed ||
    roomCode === 0 ||
    !physics ||
    physics.type !== 1 ||
    !physics.owner ||
    physics.owner.driver !== 8 ||
    !effectPoint
  )
    return false;
  const distanceSquared = physics.position.reduce(
    (sum, coordinate, axis) =>
      sum + (Math.fround(coordinate) - Math.fround(effectPoint[axis])) ** 2,
    0,
  );
  if (!(distanceSquared < 2)) return false;
  return queue.enqueue({
    car: physics.owner.car,
    index: roomCode,
    actor: null,
  });
}

/** Installed connotation+0x28c is a latch, without an award timestamp.
 * The owner supplies the native runtime connotation scope and resets it when
 * that runtime spec is created; it must not reset at each outer frame. */
export interface NativeSmashAwardState {
  awarded: boolean;
}

export interface NativeSmashAwardContext {
  /** Native physics type1 with a car owner; omitted means no eligible owner. */
  physics?: { type: number; driver: number };
  /** Direct world: solved normal impulse. Queued WAM/decal: magnitude of the
   * first queued starting velocity after native componentwise *6.9. */
  effectMagnitude: number;
  suppressed?: boolean;
  raceFinished?: boolean;
  noTimeAwards?: boolean;
  /** Native EarnCredits2 multiplies only when this global is nonzero. */
  creditMultiplier?: number;
}

export interface NativeSmashAward {
  credits: number;
  timeSeconds: number;
  textIndex: number;
  fancyIndex: number;
}

/** Installed DoConnotations 0x4ed396-0x4ed4c1. The latch is set before
 * finished-race/zero/no-time checks in the award outlets. HUD indexes remain
 * eligible even when those financial outlets reject the amounts. */
export function consumeSmashAward(
  award: SmashConnotations["award"],
  state: NativeSmashAwardState,
  context: NativeSmashAwardContext,
): NativeSmashAward | null {
  if (context.suppressed || award.frequency === "none") return null;
  if (award.frequency !== "doitregardless") {
    if (context.physics?.type !== 1 || context.physics.driver !== 8)
      return null;
    if (award.frequency === "singleshot" && state.awarded) return null;
  }
  state.awarded = true;
  const magnitude = Math.fround(context.effectMagnitude);
  const first = Math.fround(award.first ?? 0);
  const second = Math.fround(award.second ?? 0);
  let credits: number;
  if (first > 0) credits = Math.trunc(first);
  else {
    const integral = Math.trunc(Math.min(20000, -magnitude * first));
    credits = integral + 50 - ((integral + 50) % 100);
  }
  let timeSeconds: number;
  if (second > 0) timeSeconds = Math.trunc(second);
  else {
    const integral = Math.trunc(Math.min(60, -magnitude * second));
    timeSeconds = integral + 2 - ((integral + 2) % 5);
  }
  if (context.raceFinished) credits = timeSeconds = 0;
  else {
    if (context.creditMultiplier)
      credits = Math.imul(credits, context.creditMultiplier);
    if (context.noTimeAwards) timeSeconds = 0;
  }
  return {
    credits,
    timeSeconds,
    textIndex: award.integerFirst ?? 0,
    fancyIndex: award.integerSecond ?? 0,
  };
}
