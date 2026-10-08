import { Box3, Quaternion, Vector3 } from "three";

export const MINE_CAPACITY = 20;
export const MINE_EXPLODED_LIFETIME_MS = 1600;
export const MINE_MODEL_PATH = "data/MINE/ShitMine.dat";
export const MINE_FLAGS = Object.freeze({
  active: 1,
  exploded: 2,
  timed: 4,
  pendingExplosion: 0x20,
  mortar: 0x40,
  pendingDamage: 0x80,
});

export interface MineParameters {
  lifetimeSeconds: number;
  minimumUpImpulse: number;
  maximumUpImpulse: number;
  zAngularFactor: number;
  xAngularFactor: number;
  collisionForceThreshold: number;
  launchUpVelocity: number;
  launchZVelocity: number;
  mortar: boolean;
}

/** Action 34 / InitMine 0x4dd1f0: all eight floats are authored parameters. */
export function mineParameters(
  floats: readonly number[],
  integers: readonly number[] = [0],
): MineParameters {
  if (floats.length < 8 || floats.slice(0, 8).some((v) => !Number.isFinite(v)))
    throw new Error("Mine powerup requires eight finite float parameters");
  return {
    lifetimeSeconds: floats[0],
    minimumUpImpulse: floats[1],
    maximumUpImpulse: floats[2],
    zAngularFactor: floats[3],
    xAngularFactor: floats[4],
    collisionForceThreshold: floats[5],
    launchUpVelocity: floats[6],
    launchZVelocity: floats[7],
    mortar: (integers[0] ?? 0) !== 0,
  };
}

/** Source rand() produces 15 bits. Injection accepts a unit sample, as powerups do. */
function randomSample(random: () => number): number {
  return Math.max(0, Math.min(0x7fff, Math.floor(random() * 0x8000)));
}

/** Installed IRandomBetween 0x512f00 uses signed multiplication/division. */
export function mineRandomInteger(
  random: () => number,
  low: number,
  high: number,
) {
  return (
    low + Math.trunc(Math.imul(randomSample(random), high + 1 - low) / 0x8000)
  );
}

/** FRandomBetween 0x512f90 and FRandomPosNeg 0x512fc0 exclude the upper endpoint. */
export function mineRandomFloat(
  random: () => number,
  low: number,
  high: number,
) {
  return low + ((high - low) * randomSample(random)) / 0x8000;
}

export interface MineLaunchBody {
  /** All positions, bounds and velocities are in original model/physics units. */
  position: Vector3;
  orientation: Quaternion;
  velocity: Vector3;
  /** Native bb1, not the centered render bounds or bb2. */
  bounds: Box3;
}

export interface MinePose {
  position: Vector3;
  orientation: Quaternion;
  velocity: Vector3;
  angularVelocity: Vector3;
  predictedPosition?: Vector3;
  predictedOrientation?: Quaternion;
}

/** Placement 0x4dd390 inherits rotation and normal/mortar momentum exactly. */
export function mineLaunchPose(
  body: MineLaunchBody,
  parameters: MineParameters,
): MinePose {
  const local = new Vector3(
    0,
    (body.bounds.max.y - body.bounds.min.y) * 0.5,
    parameters.mortar ? body.bounds.min.z - 0.15 : body.bounds.max.z + 0.15,
  );
  return {
    position: local.applyQuaternion(body.orientation).add(body.position),
    orientation: body.orientation.clone(),
    velocity: new Vector3(
      0,
      parameters.launchUpVelocity,
      parameters.launchZVelocity,
    )
      .applyQuaternion(body.orientation)
      .addScaledVector(body.velocity, parameters.mortar ? 2 : 1),
    angularVelocity: new Vector3(),
  };
}

/** GENERAL stores mine weight separately; absence is reported rather than invented. */
export function parseMineMass(text: string): number | null {
  const lines = text.split(/\r?\n/);
  const marker = lines.findIndex((line) =>
    /mine\s*\/\s*mortar\s+weight/i.test(line),
  );
  if (marker < 0) return null;
  for (const line of lines.slice(marker + 1)) {
    const value = line.split("//")[0].trim();
    if (!value) continue;
    const mass = Number.parseFloat(value);
    return Number.isFinite(mass) && mass > 0 ? mass : null;
  }
  return null;
}

/** MungeSphereObject 0x4da1d0: radius is mean half extent, inertia r²M/6. */
export function mineSphereProperties(modelBounds: Box3, mass: number) {
  const size = modelBounds.getSize(new Vector3());
  const radius = (size.x + size.y + size.z) / 6;
  if (!(radius > 0) || !(mass > 0))
    throw new Error("Invalid mine bounds or mass");
  return {
    mass,
    radius,
    center: new Vector3(),
    bounds: new Box3(
      new Vector3(-radius, -radius, -radius),
      new Vector3(radius, radius, radius),
    ),
    inertia: new Vector3().setScalar((radius * radius * mass) / 6),
    /** Native field_0x54, distinct from the zero sphere center. */
    forceOffset: new Vector3(0, -0.05797102, 0),
  };
}

export interface MineCar<T> {
  victim: T;
  driver: number;
  mass: number;
  maxDamage: number;
  protection?: number;
  noCrush?: boolean;
  noDamage?: boolean;
  networkProtected?: boolean;
  flags?: number;
}

export type MineDamageMode = "direct" | "filtered";
export interface MineComponentIncrement {
  unit: number;
  /** Source random request. Filtered DoDamage still checks the current level. */
  magnitude: number;
}

/** 0x413ce0 direct addition versus 0x43f820 DoDamage, including its 5..9 guard. */
export function mineComponentDamage(
  current: number,
  component: MineComponentIncrement,
  mode: MineDamageMode,
  driver: number,
  noDamage = false,
): number {
  const magnitude = component.magnitude;
  if (noDamage || magnitude <= 0) return current;
  if (mode === "filtered") {
    if (magnitude < 5 || (driver >= 7 && component.unit === 2)) return current;
    if (current + magnitude >= 99 && magnitude < 10) return current;
  }
  return Math.min(99, current + magnitude);
}

export interface Mine<T> extends MinePose {
  readonly slot: number;
  readonly generation: number;
  readonly owner: MineCar<T>;
  readonly parameters: MineParameters;
  readonly powerupIndex: number;
  flags: number;
  nextThinkTime: number;
  victim: MineCar<T> | null;
  maxDamage: number;
}

export type MineContact<T> =
  | { kind: "car"; car: MineCar<T> }
  | { kind: "mine"; mine: Mine<T> }
  | { kind: "other"; object: unknown };

export type MineEvent<T> =
  | {
      kind: "crush";
      mine: Mine<T> | null;
      victim: T;
      maxDamage: number;
      strength: number;
    }
  | {
      kind: "reaction";
      mine: Mine<T> | null;
      victim: T;
      maxDamage: number;
      deltaVelocity: Vector3;
      deltaAngularVelocity: Vector3;
      damageMode: MineDamageMode;
      components: MineComponentIncrement[];
      /** Non-null only for filtered component damage to a different car. */
      creditOwner: T | null;
      wakeUntilMs: number | null;
    }
  | { kind: "explode" | "release"; mine: Mine<T> }
  | { kind: "impactSound"; mine: Mine<T>; sound: 5403 }
  | { kind: "nonCarContact"; mine: Mine<T>; object: unknown };

function vulnerable<T>(car: MineCar<T>): boolean {
  return (car.protection ?? 1) <= 1 && !car.networkProtected;
}

function increments(
  random: () => number,
  maxDamage: number,
): MineComponentIncrement[] {
  const maximum = Math.trunc(25 * maxDamage);
  return Array.from({ length: 12 }, (_, unit) => ({
    unit,
    magnitude: mineRandomInteger(random, 0, maximum),
  }));
}

function reaction<T>(
  car: MineCar<T>,
  maxDamage: number,
  impulses: readonly number[],
  random: () => number,
  mine: Mine<T> | null,
  mode: MineDamageMode,
  time: number | null,
): Extract<MineEvent<T>, { kind: "reaction" }> {
  if (!(car.mass > 0)) throw new Error("Mine victim requires positive mass");
  // Native angular impulses are body-axis increments; translation is world Y.
  const deltaVelocity = new Vector3(
    0,
    mineRandomFloat(random, impulses[0], impulses[1]) / (car.mass * 6.9),
    0,
  );
  const z =
    (mineRandomFloat(random, -impulses[2], impulses[2]) * Math.PI * 2) /
    car.mass;
  const x =
    (mineRandomFloat(random, -impulses[3], impulses[3]) * Math.PI * 2) /
    car.mass;
  return {
    kind: "reaction",
    mine,
    victim: car.victim,
    maxDamage,
    deltaVelocity,
    deltaAngularVelocity: new Vector3(x, 0, z),
    damageMode: mode,
    components:
      !car.noDamage && (mode === "filtered" || car.driver > 5)
        ? increments(random, maxDamage)
        : [],
    creditOwner:
      mode === "filtered" &&
      !car.noDamage &&
      mine &&
      mine.owner.victim !== car.victim
        ? mine.owner.victim
        : null,
    wakeUntilMs: time === null ? null : (time + 40) >>> 0,
  };
}

/** HitMine action 30, 0x4de850: reaction/direct damage precede the crush call. */
export function hitMineReaction<T>(
  car: MineCar<T>,
  impulses: readonly number[],
  random: () => number = Math.random,
  onEvent?: (event: MineEvent<T>) => void,
): MineEvent<T>[] {
  if (
    impulses.length < 4 ||
    impulses.slice(0, 4).some((v) => !Number.isFinite(v))
  )
    throw new Error("HitMine requires four finite float parameters");
  if (!vulnerable(car)) return [];
  const maxDamage = (car.maxDamage * 10) / 7;
  const events: MineEvent<T>[] = [
    reaction(car, maxDamage, impulses, random, null, "direct", null),
  ];
  onEvent?.(events[0]);
  if (car.driver > 5 && !car.noCrush) {
    const event: MineEvent<T> = {
      kind: "crush",
      mine: null,
      victim: car.victim,
      maxDamage,
      strength: 0.1 * maxDamage,
    };
    events.push(event);
    onEvent?.(event);
  }
  return events;
}

export interface MineRuntimeOptions {
  random?: () => number;
  /** Native 0 offline, 1 client, 2 host, 3 spectator. */
  networkMode?: 0 | 1 | 2 | 3;
  suppressForceExplosion?: boolean;
}

/** Native pool 0x703700, callbacks 0x4dda20 and processing 0x4ddc20.
 * Contact only records work: process emits crush/reaction before explosion.
 * Uses distinct loop indices, fixing the installed EBX pool/component reuse bug.
 */
export class MineRuntime<T> {
  private readonly slots: (Mine<T> | null)[] = Array(MINE_CAPACITY).fill(null);
  private readonly generations = new Uint8Array(MINE_CAPACITY);
  private readonly random: () => number;
  readonly networkMode: 0 | 1 | 2 | 3;
  suppressForceExplosion: boolean;

  constructor(options: MineRuntimeOptions = {}) {
    this.random = options.random ?? Math.random;
    this.networkMode = options.networkMode ?? 0;
    this.suppressForceExplosion = options.suppressForceExplosion ?? false;
  }

  get mines(): readonly (Mine<T> | null)[] {
    return this.slots.slice();
  }

  spawn(
    owner: MineCar<T>,
    body: MineLaunchBody,
    parameters: MineParameters,
    time: number,
    powerupIndex = 0,
  ): Mine<T> | null {
    if (this.networkMode === 3) return null;
    const now = time >>> 0;
    let slot = this.slots.findIndex(
      (mine) => !mine || !(mine.flags & MINE_FLAGS.active),
    );
    if (slot < 0) {
      // 0x4dd54a: strict remaining-time comparison starts at NEW lifetime.
      let remaining = Math.trunc(parameters.lifetimeSeconds * 1000) >>> 0;
      this.slots.forEach((mine, index) => {
        if (
          !mine ||
          !(mine.flags & MINE_FLAGS.timed) ||
          mine.flags & MINE_FLAGS.exploded
        )
          return;
        const candidate = (mine.nextThinkTime - now) >>> 0;
        if (candidate < remaining) {
          remaining = candidate;
          slot = index;
        }
      });
      if (slot < 0) return null;
    }
    this.generations[slot]++;
    const mine: Mine<T> = {
      ...mineLaunchPose(body, parameters),
      slot,
      generation: this.generations[slot],
      owner,
      parameters: { ...parameters },
      powerupIndex: powerupIndex & 0xff,
      flags:
        MINE_FLAGS.active |
        MINE_FLAGS.timed |
        (parameters.mortar ? MINE_FLAGS.mortar : 0),
      nextThinkTime:
        (now - Math.trunc(parameters.lifetimeSeconds * -1000)) >>> 0,
      victim: null,
      maxDamage: 0,
    };
    this.slots[slot] = mine;
    return mine;
  }

  contact(
    mine: Mine<T>,
    other: MineContact<T> | null,
    force: number,
  ): MineEvent<T>[] {
    if (
      !this.current(mine) ||
      this.networkMode === 3 ||
      mine.flags & (MINE_FLAGS.pendingExplosion | MINE_FLAGS.exploded)
    )
      return [];
    if (other?.kind === "mine") {
      // Source sets the OTHER mine's pending bit and leaves this mine alone.
      if (this.current(other.mine))
        other.mine.flags |= MINE_FLAGS.pendingExplosion;
      return [];
    }
    if (other?.kind === "other") {
      mine.flags |= MINE_FLAGS.pendingExplosion;
      return [{ kind: "nonCarContact", mine, object: other.object }];
    }
    if (other?.kind === "car") {
      const car = other.car;
      const flaggedPart =
        [2, 3, 4].includes(car.driver) && Boolean((car.flags ?? 0) & 0x10000);
      if (!flaggedPart) {
        if (car.driver <= 5) {
          mine.flags |= MINE_FLAGS.pendingExplosion;
          return [{ kind: "nonCarContact", mine, object: car.victim }];
        }
        if (vulnerable(car)) {
          mine.victim = car;
          mine.maxDamage = (car.maxDamage * 10) / 7;
          mine.flags |= MINE_FLAGS.pendingDamage;
        }
        mine.flags |= MINE_FLAGS.pendingExplosion;
        return [];
      }
    }
    if (
      force > mine.parameters.collisionForceThreshold &&
      !this.suppressForceExplosion
    ) {
      mine.flags |= MINE_FLAGS.pendingExplosion;
      return [];
    }
    return force > 0.025 ? [{ kind: "impactSound", mine, sound: 5403 }] : [];
  }

  /** Native action34 placement: obstructed placement reports its last object.
   * Sensible placement still checks the launch segment against cached world faces.
   * No hit in either cached face list means no correction and no callback.
   */
  resolveLaunchContact(
    mine: Mine<T>,
    placement:
      | { sensible: false; other: MineContact<T> | null }
      | { sensible: true; displacement: Vector3; faceFraction: number | null },
  ): MineEvent<T>[] {
    if (!this.current(mine)) return [];
    if (!placement.sensible) return this.contact(mine, placement.other, 1);
    if (placement.faceFraction === null) return [];
    mine.position.addScaledVector(
      placement.displacement,
      -(1 - placement.faceFraction) - 0.1,
    );
    return this.contact(mine, { kind: "car", car: mine.owner }, 1);
  }

  process(
    time: number,
    onEvent?: (event: MineEvent<T>) => void,
  ): MineEvent<T>[] {
    const now = time >>> 0;
    const events: MineEvent<T>[] = [];
    const emit = (event: MineEvent<T>) => {
      events.push(event);
      onEvent?.(event);
    };
    for (const mine of this.slots) {
      if (!mine || !(mine.flags & MINE_FLAGS.active)) continue;
      if (mine.flags & MINE_FLAGS.pendingDamage && mine.victim) {
        mine.flags &= ~MINE_FLAGS.pendingDamage;
        const car = mine.victim;
        if (vulnerable(car) && !car.noCrush) {
          // Synchronous emitter preserves source PRNG order through TotallySpam.
          emit({
            kind: "crush",
            mine,
            victim: car.victim,
            maxDamage: mine.maxDamage,
            strength: 0.1 * mine.maxDamage,
          });
          if (this.networkMode === 0 || this.networkMode === 2) {
            const p = mine.parameters;
            emit(
              reaction(
                car,
                mine.maxDamage,
                [
                  p.minimumUpImpulse,
                  p.maximumUpImpulse,
                  p.zAngularFactor,
                  p.xAngularFactor,
                ],
                this.random,
                mine,
                "filtered",
                now,
              ),
            );
          }
        }
      }
      if (mine.flags & MINE_FLAGS.pendingExplosion) {
        mine.flags &= ~MINE_FLAGS.pendingExplosion;
        this.explode(mine, now, emit);
      } else if (!(mine.flags & MINE_FLAGS.exploded)) {
        if (mine.flags & MINE_FLAGS.timed && now > mine.nextThinkTime)
          this.explode(mine, now, emit);
      } else if (now > mine.nextThinkTime) {
        mine.flags &= ~(MINE_FLAGS.active | MINE_FLAGS.exploded);
        emit({ kind: "release", mine });
      }
    }
    return events;
  }

  clear(): void {
    this.slots.fill(null);
  }

  private current(mine: Mine<T>): boolean {
    return (
      this.slots[mine.slot] === mine && Boolean(mine.flags & MINE_FLAGS.active)
    );
  }

  private explode(
    mine: Mine<T>,
    time: number,
    emit: (event: MineEvent<T>) => void,
  ) {
    if (mine.flags & MINE_FLAGS.exploded) return;
    mine.flags |= MINE_FLAGS.exploded;
    mine.nextThinkTime = (time + MINE_EXPLODED_LIFETIME_MS) >>> 0;
    emit({ kind: "explode", mine });
  }
}
