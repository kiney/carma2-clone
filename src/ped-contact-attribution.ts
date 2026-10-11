import type { NativePedGameplayOptions } from "./ped-native-gameplay";
import type { NativePedRuntimeCallback } from "./ped-native-runtime";
import type { NativePedContactDispatch } from "./physics/ped-body";

/** Installed4cdc60 writes only these process-cache fields (+c0 and WORD+2e). */
export interface NativePedAttributionCache {
  killer: object | null;
  flags: number;
}

export interface NativePedAttributionOther {
  /** Object+238. Type1 includes independent noncar/part car-spec wrappers. */
  typeByte: number;
  /** Object+23c; this is not necessarily the body or its originating car. */
  owner: object | null;
  /** Object+228 is the PHIL hierarchy parent pointer, not culprit ownership. */
  parentPresent: boolean;
  /** Type2..4 owner+e4 -> pedestrian+0c. Null means either link is NULL;
   * undefined means that the host has not provided the native chain. */
  characterCache?: { killer: object | null } | null;
  /** Native mine owner+30 / drone owner+5d4. Undefined is unknown, not NULL. */
  mineCar?: object | null;
  droneCar?: object | null;
}

export interface NativePedAttributionTailState {
  mode: number;
  /** GetTotalTime514610 and global703d10; not required in mode2. */
  nowMs?: number;
  startedAtMs?: number;
}

export interface NativePedAttributionProviders {
  /** Signed car-spec+0c, including independent wrappers with drivers1..4. */
  readCarDriver: (car: object) => number | undefined;
  /** Native car-spec+c8; do not substitute the latest hit or detached.owner. */
  readCarCulprit?: (car: object) => object | null | undefined;
  readTailState?: () => NativePedAttributionTailState | undefined;
}

export interface NativePedAttributionResult {
  route:
    | "unchanged"
    | "character"
    | "direct"
    | "indirect"
    | "provider-required";
  killerWritten: boolean;
  diagnostics: string[];
}

function integer(
  value: number,
  min: number,
  max: number,
  name: string,
): number {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`Invalid native pedestrian attribution ${name}`);
  return value;
}
function pointer(value: object | null, name: string): void {
  if (value !== null && typeof value !== "object")
    throw new Error(`Invalid native pedestrian attribution ${name}`);
}

/** Independent expression of4cdc60..4cddd7. Zero lambda is not a gate.
 * Missing pointer providers leave the unsupported branch explicit; they are
 * never treated as NULL or replaced by a guessed current car. No RNG, motion,
 * impact count, deadline, height, velocity or direction fields are written. */
export function attributeNativePedContact(
  cache: NativePedAttributionCache | null,
  other: NativePedAttributionOther | null,
  providers: NativePedAttributionProviders,
): NativePedAttributionResult {
  const result: NativePedAttributionResult = {
    route: "unchanged",
    killerWritten: false,
    diagnostics: [],
  };
  if (!cache || !other) return result;
  integer(cache.flags, 0, 0xffff, "cause WORD");
  pointer(cache.killer, "cached killer");
  const type = integer(other.typeByte, 0, 0xff, "type BYTE");
  pointer(other.owner, "Object+23c owner");
  if (typeof other.parentPresent !== "boolean")
    throw new Error(
      "Invalid native pedestrian attribution parent pointer state",
    );
  const missing = (name: string) => {
    result.route = "provider-required";
    result.diagnostics.push(
      `ped-contact-attribution:${name}-provider-required`,
    );
    return result;
  };
  const writeKiller = (killer: object | null) => {
    pointer(killer, "resolved killer");
    cache.killer = killer;
    result.killerWritten = true;
  };

  //4cdc79..b4 is an independent inheritance stage before the type gate.
  if (other.owner && type >= 2 && type <= 4 && cache.killer === null) {
    if (other.characterCache === undefined) return missing("character-cache");
    if (other.characterCache !== null) {
      writeKiller(other.characterCache.killer);
      result.route = "character";
    }
  }

  let tail: NativePedAttributionTailState | undefined;
  if (type === 0x20) {
    tail = providers.readTailState?.();
    if (!tail) return missing("tail-state");
    integer(tail.mode, -0x80000000, 0x7fffffff, "tail mode");
    if (tail.mode !== 2) {
      if (tail.nowMs === undefined || tail.startedAtMs === undefined)
        return missing("tail-clock");
      integer(tail.nowMs, 0, 0xffffffff, "tail current time");
      integer(tail.startedAtMs, 0, 0xffffffff, "tail start time");
      if ((tail.nowMs - tail.startedAtMs) >>> 0 >= 7500) return result;
    }
  } else if (!(type === 1 && other.owner) && type !== 0x40 && type !== 0x10)
    return result;

  let candidate = other.owner;
  if (type === 0x40 || type === 0x10) {
    // Native dereferences these owners. A NULL host descriptor cannot safely
    // execute that path; it is diagnosed rather than made into a car fallback.
    if (!other.owner)
      return missing(type === 0x40 ? "mine-owner" : "drone-owner");
    const specialized = type === 0x40 ? other.mineCar : other.droneCar;
    if (specialized === undefined)
      return missing(type === 0x40 ? "mine-car" : "drone-car");
    pointer(specialized, "specialized owner car");
    candidate = specialized;
  }

  let direct = other.parentPresent;
  if (candidate && !direct) {
    const driver = providers.readCarDriver(candidate);
    if (driver === undefined) return missing("candidate-driver");
    direct = integer(driver, -0x80000000, 0x7fffffff, "driver") > 5;
  }
  if (direct) {
    writeKiller(candidate); // Parent permits an actual NULL candidate.
    result.route = "direct";
    if (type === 0x20 && other.owner) {
      cache.flags |= 0x08;
      if (tail!.mode === 1) cache.flags |= 0x10;
    }
    if (type === 0x40) cache.flags = 0x40; // WORD replacement, not OR.
    if (type === 0x10) cache.flags = 0x01;
    return result;
  }

  //4cddb1..d1: indirect ownership is sticky; OR1 even for a NULL culprit.
  if (candidate && cache.killer === null) {
    const culprit = providers.readCarCulprit?.(candidate);
    if (culprit === undefined) return missing("car-culprit");
    writeKiller(culprit);
    cache.flags |= 0x01;
    result.route = "indirect";
  }
  return result;
}

export interface NativePedContactAttributionOptions<Owner extends object>
  extends NativePedAttributionProviders {
  /** Called only for an actual dispatch.other; undefined means unsupported
   * native descriptor. World contact (undefined other) is handled as NULL. */
  readOther: (
    context: NativePedRuntimeCallback<Owner>,
    dispatch: NativePedContactDispatch,
  ) => NativePedAttributionOther | undefined;
}

/** Concrete NativePedGameplay.attributeContact outlet. killerDriver is derived
 * browser metadata; native4cdc60 stores a pointer, and Score4cd010 reads its
 * CURRENT driver. Refresh it even on world/rejected contacts so stale driver8
 * metadata cannot award an owner whose pointer is NULL or no longer human. */
export function createNativePedContactAttribution<Owner extends object>(
  options: NativePedContactAttributionOptions<Owner>,
): NonNullable<NativePedGameplayOptions<Owner>["attributeContact"]> {
  return (context, dispatch, state) => {
    if (!state.cache) return;
    const diagnostics: string[] = [];
    if (dispatch.other) {
      const snapshot = options.readOther(context, dispatch);
      if (!snapshot)
        diagnostics.push("ped-contact-attribution:other-provider-required");
      else
        diagnostics.push(
          ...attributeNativePedContact(state.cache, snapshot, options)
            .diagnostics,
        );
    }
    const driver = state.cache.killer
      ? options.readCarDriver(state.cache.killer)
      : undefined;
    if (driver === undefined) {
      delete state.cache.killerDriver;
      if (state.cache.killer)
        diagnostics.push(
          "ped-contact-attribution:killer-driver-provider-required",
        );
    } else
      state.cache.killerDriver = integer(
        driver,
        -0x80000000,
        0x7fffffff,
        "cached killer driver",
      );
    return diagnostics;
  };
}
