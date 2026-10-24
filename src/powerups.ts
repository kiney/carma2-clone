import * as THREE from "three";
import { NativeDrinkDriving } from "./drink-driving";
import { GlobalGravityState } from "./physics/global-gravity";
import {
  setBouncePowerup,
  bouncePowerup,
  type BouncePowerup,
} from "./physics/bounce";
import type { VehicleState, RaceState } from "./gameplay";
import { awardRaceTime, awardRaceCredits } from "./gameplay";
import {
  setTemporaryMotionPowerup,
  resetTemporaryMotionPowerup,
  type SuspensionPowerupValues,
  setSuspensionPowerup,
  resetSuspensionPowerup,
} from "./physics/upgrades";

/** One sequential record from DATA/POWERUP.TXT. Durations are source seconds. */
export interface PowerupDefinition {
  index: number;
  message: string;
  icon: string;
  fizzleType: number;
  duration: number;
  initialValue: number;
  action: number;
  floatParams: number[];
  integerParams: number[];
  groupInclusion: number;
  pratcam: number;
  flags: number;
}

export interface PowerupModifiers {
  accelerationMultiplier: number;
  maxSpeedMultiplier: number;
  lateralGripMultiplier: number;
  suspension?: SuspensionPowerupValues;
  invulnerable: boolean;
  freeRepairs: boolean;
  damageMultiplier: number;
  protection: number;
  timerFrozen: boolean;
  underwaterAbility: boolean;
  instantHandbrake: boolean;
  opponentSpeedFactor: number;
  copSpeedFactor: number;
  bouncePeriodMs: number;
  wallClimb: boolean;
  gravityMultiplier: number;
  pinballFactor: number;
}

export interface PowerupEvent {
  kind:
    | "credits"
    | "repair"
    | "time"
    | "engine"
    | "effect"
    | "upgrade"
    | "ability"
    | "ability-use"
    | "crash"
    | "unsupported";
  name: string;
  definition: PowerupDefinition;
  amount?: number;
}

const implementedActions = new Set([
  0, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 26, 27,
  28, 30, 31, 34, 35, 36, 37, 38, 45, 46, 47, 48, 49, 51,
]);

const combatAbilityActions = new Set([37, 38, 45, 49]);
const inventoryActions = new Set([34, 35, 36, 37, 38, 45, 49]);

export function isPowerupImplemented(definition: PowerupDefinition): boolean {
  return implementedActions.has(definition.action);
}

/** Parse the line-oriented powerup table, retaining positional parameters. */
export function parsePowerups(text: string): PowerupDefinition[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let cursor = 0;
  const next = (what: string): string => {
    while (cursor < lines.length) {
      const raw = lines[cursor++].trim();
      if (!raw || raw.startsWith("//")) continue;
      const line = raw.replace(/\s*\/\/.*$/, "").trim();
      if (line) return line;
    }
    throw new Error(`POWERUP.TXT: missing ${what}`);
  };
  const integer = (what: string): number => {
    const line = next(what),
      value = Number(line);
    if (!Number.isSafeInteger(value))
      throw new Error(`POWERUP.TXT: invalid ${what}: ${line}`);
    return value;
  };
  const values = (
    count: number,
    what: string,
    parse: (s: string) => number,
  ): number[] => {
    if (count < 0 || count > 4096)
      throw new Error(`POWERUP.TXT: invalid ${what} count`);
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      const line = next(`${what} ${i + 1}`),
        value = parse(line);
      if (!Number.isFinite(value))
        throw new Error(`POWERUP.TXT: invalid ${what}: ${line}`);
      result.push(value);
    }
    return result;
  };
  const count = integer("definition count");
  if (count < 0 || count > 10000)
    throw new Error("POWERUP.TXT: invalid definition count");
  const definitions: PowerupDefinition[] = [];
  for (let index = 0; index < count; index++) {
    const message = next(`message for definition ${index}`);
    const icon = next(`icon for definition ${index}`);
    const fizzleType = integer("fizzle type");
    const duration = integer("duration");
    const initialValue = integer("initial value");
    const action = integer("action index");
    const floatParams = values(
      integer("float parameter count"),
      "float parameter",
      Number,
    );
    const integerParams = values(
      integer("integer parameter count"),
      "integer parameter",
      (s) => Number(s),
    );
    const groupInclusion = integer("group inclusion");
    const pratcam = integer("pratcam sequence");
    const flags = integer("flags");
    definitions.push({
      index,
      message,
      icon,
      fizzleType,
      duration,
      initialValue,
      action,
      floatParams,
      integerParams,
      groupInclusion,
      pratcam,
      flags,
    });
  }
  return definitions;
}

interface Pickup {
  index: number;
  object: THREE.Group;
  position: THREE.Vector3;
  collected: boolean;
}
interface ActiveEffect {
  index: number;
  remaining: number;
  duration: number;
  expiresAtMs: number;
  action:
    | 5
    | 6
    | 8
    | 9
    | 10
    | 14
    | 15
    | 16
    | 17
    | 18
    | 19
    | 20
    | 21
    | 22
    | 27
    | 28
    | 31
    | 48;
}
export interface PowerupAbility {
  definition: PowerupDefinition;
  charges: number;
}
type AssetTextSource = { text(path: string): Promise<string> };

/**
 * Extracts original `&£NN...` pickup actors from an unbatched source scene.
 * The first two digits after the marker select the POWERUP.TXT record.
 * Supports weighted random effects, credits, repair, time bonuses/freezing,
 * timed engine/grip and damage modifiers, permanent upgrades and cancellation.
 * Mine and crush actions are dispatched to the simulation as crash events.
 * Other actions collect with an explicit unsupported event.
 */
export class PowerupSystem {
  readonly drinkDriving: NativeDrinkDriving;
  private earnedRace?: RaceState;
  private motionFactors = { engineFactor: 1, tyreGripFactor: 1 };
  private suspension?: SuspensionPowerupValues;
  private invulnerable = false;
  private freeRepairs = false;
  private damageMultiplier = 1;
  private protection = 1;
  private timerFrozen = false;
  private underwaterAbility = false;
  private instantHandbrake = false;
  private opponentSpeedFactor = 1;
  private copSpeedFactor = 1;
  private opponentSpeedRevision = 0;
  get opponentSpeedState() {
    return {
      revision: this.opponentSpeedRevision,
      active: this.active.some((effect) => effect.action === 14),
    };
  }
  private vouchers = 0;
  private bounce?: BouncePowerup;
  private wallClimb = false;
  private readonly gravity: GlobalGravityState;
  private pinballFactor = 0;
  private proxyRayDistanceSquared = 0;
  /** Native car +170c: action31 squares its authored float, reset clears it.
   * Remains active through beginFrame's physics window until finishFrame. */
  get electricRayDistanceSquared(): number {
    return this.proxyRayDistanceSquared;
  }
  private elapsedMs = 0;
  /** Called after physics, matching native DoPowerupPeriodics ordering. */
  periodicBounce(state: {
    velocity: THREE.Vector3;
    groundedWheelCount?: number;
  }): boolean {
    return !!this.bounce && bouncePowerup(state, this.bounce, this.elapsedMs);
  }
  get recoveryVouchers(): number {
    return this.vouchers;
  }
  /** Consume at successful recovery execution, not when the key is pressed. */
  consumeRecoveryVoucher(): boolean {
    if (this.vouchers === 0) return false;
    this.vouchers = (this.vouchers - 1) | 0;
    return true;
  }
  readonly group = new THREE.Group();
  readonly definitions: PowerupDefinition[] = [];
  readonly warnings: string[] = [];
  readonly pickups: Pickup[] = [];
  readonly abilities = new Map<number, PowerupAbility>();
  selectedAbility: number | null = null;
  /** Actual world collection is distinct from applying/granting an effect. */
  onPickup?: (definition: PowerupDefinition) => void;
  private active: ActiveEffect[] = [];
  private previous?: THREE.Vector3;
  private unsupportedWarned = new Set<number>();
  private readonly exclusions: ReadonlySet<number>;

  constructor(
    private readonly assets: AssetTextSource,
    private readonly sourceWorldGroup: THREE.Group,
    private readonly random: () => number = Math.random,
    exclusions: readonly number[] = [],
    defaultGravityMultiplier = 1,
  ) {
    this.gravity = new GlobalGravityState(defaultGravityMultiplier);
    this.drinkDriving = new NativeDrinkDriving(random);
    this.exclusions = new Set(exclusions);
    this.group.name = "Original powerups";
  }

  async init(): Promise<this> {
    let text: string;
    try {
      text = await this.assets.text("data/powerup.txt");
    } catch (error) {
      this.warnings.push(`Power-up table unavailable: ${String(error)}`);
      return this;
    }
    try {
      this.definitions.push(...parsePowerups(text));
    } catch (error) {
      this.warnings.push(
        `Power-up table could not be parsed: ${String(error)}`,
      );
      return this;
    }

    this.sourceWorldGroup.updateMatrixWorld(true);
    const candidates: Array<{ node: THREE.Group; index: number }> = [];
    this.sourceWorldGroup.traverse((node) => {
      if (!(node instanceof THREE.Group) || node === this.sourceWorldGroup)
        return;
      const match = /^&£(\d{2})/i.exec(node.name);
      if (match) candidates.push({ node, index: Number(match[1]) });
    });
    for (const { node, index } of candidates) {
      const definition = this.definitions[index];
      if (!definition) {
        this.warnings.push(
          `${node.name}: power-up definition ${index} is missing`,
        );
        continue;
      }
      if (!isPowerupImplemented(definition)) {
        if (!this.unsupportedWarned.has(index)) {
          this.unsupportedWarned.add(index);
          this.warnings.push(
            `Power-up ${index} (${definition.message}) uses unsupported action ${definition.action}`,
          );
        }
      }
      const worldMatrix = node.matrixWorld.clone();
      node.parent?.remove(node);
      node.matrix.copy(worldMatrix);
      node.matrix.decompose(node.position, node.quaternion, node.scale);
      node.matrixAutoUpdate = true;
      node.updateMatrixWorld(true);
      const position = new THREE.Vector3();
      node.getWorldPosition(position);
      node.userData.powerupIndex = index;
      node.userData.powerupName = definition.message;
      this.group.add(node);
      this.pickups.push({ index, object: node, position, collected: false });
    }
    this.group.updateMatrixWorld(true);
    return this;
  }

  /** Combined compatibility API for direct tools/tests. */
  update(
    dt: number,
    vehicle: VehicleState,
    race: RaceState,
    onEvent?: (event: PowerupEvent) => void,
    gameTimeMs?: number,
  ): PowerupModifiers {
    this.beginFrame(dt, vehicle, race, onEvent, gameTimeMs);
    return this.finishFrame();
  }

  /** Sample grant time and collect swept pickups; retain existing effects for
   * the whole physics window. Installed MainGameLoop expires them afterward. */
  beginFrame(
    dt: number,
    vehicle: VehicleState,
    race: RaceState,
    onEvent?: (event: PowerupEvent) => void,
    gameTimeMs?: number,
  ): PowerupModifiers {
    if (
      gameTimeMs !== undefined &&
      (!Number.isFinite(gameTimeMs) || gameTimeMs < 0)
    )
      throw new Error("Invalid powerup game timestamp");
    if (Number.isFinite(dt) && dt > 0) {
      const nextTime = gameTimeMs ?? this.elapsedMs + dt * 1000;
      this.elapsedMs = nextTime;
    }
    const current = vehicle.position.clone();
    const from = this.previous?.clone() ?? current.clone();
    const segment = current.clone().sub(from);
    const lengthSq = segment.lengthSq();
    const hits: Array<{ pickup: Pickup; t: number }> = [];
    for (const pickup of this.pickups) {
      if (pickup.collected) continue;
      const t =
        lengthSq > 1e-12
          ? THREE.MathUtils.clamp(
              pickup.position.clone().sub(from).dot(segment) / lengthSq,
              0,
              1,
            )
          : 0;
      const closest = from.clone().addScaledVector(segment, t);
      if (closest.distanceToSquared(pickup.position) > 0.7 * 0.7) continue;
      hits.push({ pickup, t });
    }
    // Actor traversal order is unrelated to the order encountered while driving.
    hits.sort((a, b) => a.t - b.t);
    for (const { pickup } of hits) {
      pickup.collected = true;
      pickup.object.visible = false;
      this.onPickup?.(this.definitions[pickup.index]);
      this.apply(pickup.index, vehicle, race, onEvent);
    }
    this.previous = current;
    return this.currentModifiers();
  }

  /** Native DoPowerupPeriodics expiry precedes periodic callbacks (e.g. Bounce). */
  finishFrame(): PowerupModifiers {
    for (const effect of this.active) {
      if (effect.duration > 0) {
        effect.remaining = (effect.expiresAtMs - this.elapsedMs) / 1000;
        if (this.elapsedMs >= effect.expiresAtMs)
          this.resetEffect(effect.action);
      }
    }
    this.active = this.active.filter(
      (effect) => effect.duration <= 0 || effect.remaining > 0,
    );
    return this.currentModifiers();
  }

  private currentModifiers(): PowerupModifiers {
    const modifiers: PowerupModifiers = {
      accelerationMultiplier: this.motionFactors.engineFactor,
      maxSpeedMultiplier: 1,
      lateralGripMultiplier: this.motionFactors.tyreGripFactor,
      invulnerable: this.invulnerable,
      freeRepairs: this.freeRepairs,
      damageMultiplier: this.damageMultiplier,
      protection: this.protection,
      timerFrozen: this.timerFrozen,
      underwaterAbility: this.underwaterAbility,
      instantHandbrake: this.instantHandbrake,
      opponentSpeedFactor: this.opponentSpeedFactor,
      copSpeedFactor: this.copSpeedFactor,
      bouncePeriodMs: this.bounce?.periodMs ?? 0,
      wallClimb: this.wallClimb,
      gravityMultiplier: this.gravity.multiplier,
      pinballFactor: this.pinballFactor,
    };
    if (this.suspension) modifiers.suspension = this.suspension;
    return modifiers;
  }

  resetPath(position: THREE.Vector3): void {
    this.previous = position.clone();
  }

  /** Debug grants enter the ordinary pickup path without consuming a world actor.
   * Durations, source parameters, charges and simulation events remain identical. */
  grant(
    index: number,
    vehicle: VehicleState,
    race: RaceState,
    onEvent?: (event: PowerupEvent) => void,
  ): boolean {
    if (!Number.isSafeInteger(index) || !this.definitions[index]) return false;
    this.apply(index, vehicle, race, onEvent);
    return true;
  }
  /** Keyboard powerups use an input edge, not an every-frame cooldown.
   * Negative initialValue is the native charge count; successful calls consume
   * one even when an oil allocator refuses unsuitable placement. */
  activateAbility(
    race: RaceState,
    onEvent?: (event: PowerupEvent) => void | number | boolean,
    knackered = false,
  ): boolean {
    if (
      race.status !== "racing" ||
      race.awardsClosed ||
      knackered ||
      this.selectedAbility === null
    )
      return false;
    const ability = this.abilities.get(this.selectedAbility);
    if (
      !ability ||
      !Number.isSafeInteger(this.selectedAbility) ||
      this.definitions[this.selectedAbility] !== ability.definition ||
      ability.charges <= 0
    )
      return false;
    // GotPowerupX removes group conflicts before calling even a failed command.
    // Merely collecting its inventory did not enter that handler path.
    this.cancelConflictingEffects(ability.definition);
    const result = onEvent?.({
      kind: "ability-use",
      name: ability.definition.message,
      definition: ability.definition,
    });
    // GotPowerupX 0x4d9159 rejects a negative got-handler result;
    // MungeKeyboardPowerup 0x4db36a then leaves inventory unchanged.
    // Oil/mine allocator failure is different: their native handlers still
    // return the definition index, so existing void handlers remain successful.
    if (result === false || (typeof result === "number" && result < 0))
      return false;
    // Combat got handlers return -1 when target selection/allocation fails.
    // A missing runtime handler cannot report success for these actions.
    // Existing mine/oil callbacks retain their successful void convention.
    if (
      combatAbilityActions.has(ability.definition.action) &&
      result !== true &&
      !(typeof result === "number" && Number.isFinite(result) && result >= 0)
    )
      return false;
    ability.charges--;
    if (!ability.charges) {
      this.abilities.delete(ability.definition.index);
      this.selectedAbility = this.abilities.keys().next().value ?? null;
    }
    return true;
  }

  cycleAbility(): PowerupAbility | undefined {
    const available = [...this.abilities.keys()];
    if (!available.length) return undefined;
    const next =
      (available.indexOf(this.selectedAbility ?? -1) + 1) % available.length;
    this.selectedAbility = available[next];
    return this.abilities.get(this.selectedAbility);
  }

  dispose(): void {
    for (const pickup of this.pickups)
      pickup.object.parent?.remove(pickup.object);
    this.pickups.length = 0;
    this.abilities.clear();
    this.selectedAbility = null;
    this.cancelEffects();
    this.vouchers = 0;
  }

  /** Independent reset assignments verified in original handler table.
   * Invulnerability represents both crush+1b4 and component+1b8 immunity. */
  private resetEffect(action: ActiveEffect["action"]): void {
    switch (action) {
      case 48:
        this.drinkDriving.reset();
        if (this.earnedRace) this.earnedRace.earnedCreditMultiplier = 0;
        break;
      case 5:
        this.invulnerable = false;
        break;
      case 6:
        this.freeRepairs = false;
        break;
      case 8:
        this.timerFrozen = false;
        break;
      case 10:
        this.underwaterAbility = false;
        break;
      case 14:
        this.opponentSpeedFactor = 1;
        this.opponentSpeedRevision++;
        break;
      case 15:
        this.copSpeedFactor = 1;
        break;
      case 22:
        this.damageMultiplier = 1;
        break;
      case 27:
        this.protection = 1;
        break;
      case 28:
        this.instantHandbrake = false;
        break;
      case 31:
        this.proxyRayDistanceSquared = 0;
        break;
      case 16:
        this.gravity.reset();
        break;
      case 17:
        this.pinballFactor = 0;
        break;
      case 18:
        this.wallClimb = false;
        break;
      case 19:
        this.bounce = undefined;
        break;
      case 20:
        this.suspension = resetSuspensionPowerup();
        break;
      case 9:
      case 21: {
        const suspension = resetTemporaryMotionPowerup(
          this.motionFactors,
          action,
        );
        if (suspension) this.suspension = suspension;
        break;
      }
    }
  }

  private cancelEffects(): void {
    for (const effect of this.active) this.resetEffect(effect.action);
    this.active.length = 0;
  }

  /** GotPowerupX 0x4d902e scans catalog order, excluding the same record.
   * The loader stores group inclusion as uint16; action identity is irrelevant.
   * Reset conflicting fields before the incoming handler assigns its values.
   */
  private cancelConflictingEffects(definition: PowerupDefinition): void {
    this.active = this.active.filter((effect) => {
      if (
        effect.index === definition.index ||
        !(
          this.definitions[effect.index].groupInclusion &
          definition.groupInclusion &
          0xffff
        )
      )
        return true;
      this.resetEffect(effect.action);
      return false;
    });
  }

  private recordEffect(
    definition: PowerupDefinition,
    action: ActiveEffect["action"],
  ): void {
    // Renewal owns one deadline for this definition, without invoking its reset.
    this.active = this.active.filter(
      (effect) => effect.index !== definition.index,
    );
    // Loader 0x4d9851 distinguishes instant (<0), whole-race (0), timed (>0).
    // An instant setter runs, but has no active record to expire or cancel.
    if (definition.duration < 0) return;
    const duration = definition.duration;
    this.active.push({
      index: definition.index,
      remaining: duration,
      duration,
      expiresAtMs: this.elapsedMs + duration * 1000,
      action,
    });
    // Native expiry and explicit removal also traverse the definition catalog.
    this.active.sort((a, b) => a.index - b.index);
  }

  /** Installed IRandomBetween 0x512f00 scales an inclusive range using a
   * 15-bit rand() sample; its signed integer division truncates toward zero. */
  private randomBetween(low: number, high: number): number {
    const sample = Math.floor(this.random() * 0x8000);
    return low + Math.trunc(Math.imul(sample, high + 1 - low) / 0x8000);
  }

  private apply(
    index: number,
    vehicle: VehicleState,
    race: RaceState,
    onEvent?: (event: PowerupEvent) => void,
    randomPath: ReadonlySet<number> = new Set(),
  ): void {
    // Installed GotPowerupX0x4d8ffc substitutes excluded requests with index0
    // once. Keep world actors, weighted draws and debug grants on this path.
    if (this.exclusions.has(index)) index = 0;
    const def = this.definitions[index];
    if (!def) return;
    this.earnedRace = race;
    if (!inventoryActions.has(def.action)) this.cancelConflictingEffects(def);
    switch (def.action) {
      case 34:
      case 35:
      case 36:
      case 37:
      case 38:
      case 45:
      case 49: {
        // Installed GotPowerupEarwig0x4d8e69 adds the authored initial value
        // to existing inventory; preserve remaining charges on repeat pickups.
        const charges =
          (this.abilities.get(index)?.charges ?? 0) +
          Math.max(0, -def.initialValue);
        this.abilities.set(index, { definition: def, charges });
        this.selectedAbility = index;
        onEvent?.({
          kind: "ability",
          name: def.message,
          definition: def,
          amount: charges,
        });
        break;
      }
      case 12:
      case 30:
        onEvent?.({ kind: "crash", name: def.message, definition: def });
        break;
      case 4: {
        // Repeated indices in the source table are intentional probability weights.
        const choice =
          def.integerParams[
            this.randomBetween(0, def.integerParams.length - 1)
          ];
        if (
          choice === undefined ||
          !this.definitions[choice] ||
          randomPath.has(index)
        ) {
          onEvent?.({
            kind: "unsupported",
            name: def.message,
            definition: def,
          });
          break;
        }
        this.apply(
          choice,
          vehicle,
          race,
          onEvent,
          new Set([...randomPath, index]),
        );
        break;
      }
      case 5:
      case 6:
      case 8:
      case 10:
      case 14:
      case 15:
      case 16:
      case 17:
      case 18:
      case 22:
      case 27:
      case 28:
      case 48:
      case 31: {
        if (def.action === 48) {
          this.drinkDriving.set(
            def.floatParams,
            def.integerParams,
            this.elapsedMs,
          );
          race.earnedCreditMultiplier = this.drinkDriving.creditMultiplier;
        }
        if (def.action === 5) this.invulnerable = true;
        if (def.action === 6) this.freeRepairs = true;
        if (def.action === 8) this.timerFrozen = true;
        if (def.action === 10) this.underwaterAbility = true;
        if (def.action === 31) {
          const value = Math.fround(def.floatParams[0]);
          const squared = Math.fround(value * value);
          if (!Number.isFinite(squared))
            throw new Error(
              "Missing or invalid electric ray powerup parameter",
            );
          this.proxyRayDistanceSquared = squared;
        }
        if (def.action === 14 || def.action === 15) {
          const value = def.floatParams[0];
          if (value === undefined || !Number.isFinite(value))
            throw new Error("Missing opponent speed powerup parameter");
          const factor = Math.fround(value);
          if (!Number.isFinite(factor))
            throw new Error("Invalid opponent speed powerup parameter");
          if (def.action === 14) {
            this.opponentSpeedFactor = factor;
            this.opponentSpeedRevision++;
          } else this.copSpeedFactor = factor;
        }
        if (def.action === 18) this.wallClimb = true;
        if (def.action === 16) this.gravity.setPowerup(def.floatParams);
        if (def.action === 17) {
          const value = Math.fround(def.floatParams[0]);
          if (!Number.isFinite(value))
            throw new Error("Invalid Pinball powerup factor");
          this.pinballFactor = value;
        }
        if (def.action === 22) this.damageMultiplier = def.floatParams[0] ?? 1;
        if (def.action === 27) this.protection = def.floatParams[0] ?? 1;
        if (def.action === 28) this.instantHandbrake = true;
        this.recordEffect(def, def.action);
        onEvent?.({
          kind: "effect",
          name: def.message,
          definition: def,
          amount: def.floatParams[0],
        });
        break;
      }
      case 26:
        this.vouchers = (this.vouchers + (def.integerParams[0] ?? 0)) | 0;
        onEvent?.({
          kind: "effect",
          name: def.message,
          definition: def,
          amount: this.vouchers,
        });
        break;
      case 51:
        this.cancelEffects();
        onEvent?.({ kind: "effect", name: def.message, definition: def });
        break;
      case 46:
      case 47:
        // Permanent APO state, random fallback and source compensation belong
        // to the simulation; preserve all three original integer parameters.
        onEvent?.({ kind: "upgrade", name: def.message, definition: def });
        break;
      case 0: {
        const low = def.integerParams[0] ?? 0,
          high = def.integerParams[1] ?? low;
        // Installed GotCredits 0x4dbf60 truncates the sampled award to hundreds.
        const award = Math.trunc(this.randomBetween(low, high) / 100) * 100;
        const before = race.credits;
        const credited = awardRaceCredits(race, award);
        onEvent?.({
          kind: "credits",
          name: def.message,
          definition: def,
          amount: credited ? (race.credits - before) | 0 : 0,
        });
        break;
      }
      case 7:
        vehicle.health = 100;
        onEvent?.({ kind: "repair", name: def.message, definition: def });
        break;
      case 11: {
        const low = def.integerParams[0] ?? 0,
          high = def.integerParams[1] ?? low;
        const seconds = this.randomBetween(low, high);
        const awarded = awardRaceTime(race, seconds);
        onEvent?.({
          kind: "time",
          name: def.message,
          definition: def,
          amount: awarded ? seconds : 0,
        });
        break;
      }
      case 9:
      case 19:
      case 20:
      case 21: {
        const suspension =
          def.action === 19
            ? undefined
            : def.action === 20
              ? setSuspensionPowerup(def.floatParams)
              : setTemporaryMotionPowerup(
                  this.motionFactors,
                  def.action,
                  def.floatParams,
                );
        if (suspension) this.suspension = suspension;
        if (def.action === 19) this.bounce = setBouncePowerup(def.floatParams);
        this.recordEffect(def, def.action);
        onEvent?.({
          kind: "engine",
          name: def.message,
          definition: def,
          amount: def.floatParams[0],
        });
        break;
      }
      default:
        onEvent?.({ kind: "unsupported", name: def.message, definition: def });
        break;
    }
  }
}
