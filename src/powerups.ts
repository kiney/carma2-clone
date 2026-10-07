import * as THREE from "three";
import type { VehicleState, RaceState } from "./gameplay";
import {
  setTemporaryMotionPowerup,
  resetTemporaryMotionPowerup,
  type SuspensionPowerupValues,
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
}

export interface PowerupEvent {
  kind:
    | "credits"
    | "repair"
    | "time"
    | "engine"
    | "effect"
    | "upgrade"
    | "unsupported";
  name: string;
  definition: PowerupDefinition;
  amount?: number;
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
  action: 5 | 6 | 8 | 9 | 21 | 22 | 27;
}
type AssetTextSource = { text(path: string): Promise<string> };

/**
 * Extracts original `&£NN...` pickup actors from an unbatched source scene.
 * The first two digits after the marker select the POWERUP.TXT record.
 * Supports weighted random effects, credits, repair, time bonuses/freezing,
 * timed engine/grip and damage modifiers, permanent upgrades and cancellation.
 * Other actions collect with an explicit unsupported event.
 */
export class PowerupSystem {
  private motionFactors = { engineFactor: 1, tyreGripFactor: 1 };
  private suspension?: SuspensionPowerupValues;
  private invulnerable = false;
  private freeRepairs = false;
  private damageMultiplier = 1;
  private protection = 1;
  private timerFrozen = false;
  readonly group = new THREE.Group();
  readonly definitions: PowerupDefinition[] = [];
  readonly warnings: string[] = [];
  readonly pickups: Pickup[] = [];
  private active: ActiveEffect[] = [];
  private previous?: THREE.Vector3;
  private unsupportedWarned = new Set<number>();

  constructor(
    private readonly assets: AssetTextSource,
    private readonly sourceWorldGroup: THREE.Group,
    private readonly random: () => number = Math.random,
  ) {
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
      if (
        ![0, 4, 5, 6, 7, 8, 9, 11, 21, 22, 27, 46, 47, 51].includes(
          definition.action,
        )
      ) {
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

  /** Collect by swept sphere test and return vehicle multipliers for this frame. */
  update(
    dt: number,
    vehicle: VehicleState,
    race: RaceState,
    onEvent?: (event: PowerupEvent) => void,
  ): PowerupModifiers {
    if (Number.isFinite(dt) && dt > 0) {
      for (const effect of this.active) {
        if (effect.duration > 0) {
          effect.remaining -= dt;
          if (effect.remaining <= 0) {
            this.resetEffect(effect.action);
          }
        }
      }
      this.active = this.active.filter(
        (effect) => effect.duration <= 0 || effect.remaining > 0,
      );
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
      this.apply(pickup.index, vehicle, race, onEvent);
    }
    this.previous = current;
    const modifiers: PowerupModifiers = {
      accelerationMultiplier: this.motionFactors.engineFactor,
      maxSpeedMultiplier: 1,
      lateralGripMultiplier: this.motionFactors.tyreGripFactor,
      invulnerable: this.invulnerable,
      freeRepairs: this.freeRepairs,
      damageMultiplier: this.damageMultiplier,
      protection: this.protection,
      timerFrozen: this.timerFrozen,
    };
    if (this.suspension) modifiers.suspension = this.suspension;
    return modifiers;
  }

  resetPath(position: THREE.Vector3): void {
    this.previous = position.clone();
  }

  dispose(): void {
    for (const pickup of this.pickups)
      pickup.object.parent?.remove(pickup.object);
    this.pickups.length = 0;
    this.cancelEffects();
  }

  /** Independent reset assignments verified in original handler table.
   * Invulnerability represents both crush+1b4 and component+1b8 immunity. */
  private resetEffect(action: ActiveEffect["action"]): void {
    switch (action) {
      case 5:
        this.invulnerable = false;
        break;
      case 6:
        this.freeRepairs = false;
        break;
      case 8:
        this.timerFrozen = false;
        break;
      case 22:
        this.damageMultiplier = 1;
        break;
      case 27:
        this.protection = 1;
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
    const def = this.definitions[index];
    if (!def) return;
    switch (def.action) {
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
      case 22:
      case 27: {
        if (def.action === 5) this.invulnerable = true;
        if (def.action === 6) this.freeRepairs = true;
        if (def.action === 8) this.timerFrozen = true;
        if (def.action === 22) this.damageMultiplier = def.floatParams[0] ?? 1;
        if (def.action === 27) this.protection = def.floatParams[0] ?? 1;
        // A renewed effect owns its new timeout; an old timeout cannot undo it.
        this.active = this.active.filter(
          (effect) => effect.action !== def.action,
        );
        const duration = def.duration > 0 ? def.duration : 0;
        this.active.push({
          index,
          remaining: duration,
          duration,
          action: def.action,
        });
        onEvent?.({
          kind: "effect",
          name: def.message,
          definition: def,
          amount: def.floatParams[0],
        });
        break;
      }
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
        race.credits += award;
        onEvent?.({
          kind: "credits",
          name: def.message,
          definition: def,
          amount: award,
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
        race.timeLeft += seconds;
        onEvent?.({
          kind: "time",
          name: def.message,
          definition: def,
          amount: seconds,
        });
        break;
      }
      case 9:
      case 21: {
        const suspension = setTemporaryMotionPowerup(
          this.motionFactors,
          def.action,
          def.floatParams,
        );
        if (suspension) this.suspension = suspension;
        // Renewal replaces the previous timer, as for the scalar effects above.
        this.active = this.active.filter(
          (effect) => effect.action !== def.action,
        );
        const duration = def.duration > 0 ? def.duration : 0;
        this.active.push({
          index,
          remaining: duration,
          duration,
          action: def.action,
        });
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
