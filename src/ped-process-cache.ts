/** Installed Munge4d386b..39b7 process-cache ownership and selective Init stores.
 * FORM/render/PHIL resources and the 85-slot ground cache remain separate. */
import type { NativePedGameplayCache } from "./ped-native-gameplay";
import type { PedVector } from "./ped-form";

export const NATIVE_PED_PROCESS_CACHE_CAPACITY = 100;
export const NATIVE_PED_PROCESS_CACHE_BYTES = 0x12c;
export const NATIVE_PED_PROCESS_STUMP_COUNT = 10;
/** Source mask addressing admits32 FORM bones. Beyond the ten declared bytes,
 * original animal indices alias flags+2e and vectors+30; keep the real storage. */
export const NATIVE_PED_PROCESS_STUMP_CAPACITY = 32;
export interface NativePedProcessCache<
  Owner extends object,
  Face extends object,
> extends NativePedGameplayCache {
  readonly index: number;
  readonly replaySingleton: boolean;
  /** Numeric/opaque stores. JS pointer identities live in the reference fields;
   * this storage does not encode fabricated native addresses for host objects. */
  readonly storage: Uint8Array;
  owner: Owner | null;
  faceCache: Face | null;
  lastUsedTimeMs: number;
  processFlags: number;
  nextTurnTimeMs: number;
  spurtingPeriodMs: number;
  floorNormal: PedVector;
  retainedDirection: PedVector;
  runSpeed: number;
  runFactor: number;
}
export interface NativePedProcessCacheVisitInput {
  timeMs: number;
  replay: boolean;
  /** Original movement-spec integer milliseconds, not a new random schedule. */
  minTurnIntervalMs: number;
  maxTurnIntervalMs: number;
  /** Original gPed_spurting_period, stored as DWORD+84. */
  spurtingPeriodMs: number;
}
export interface NativePedProcessCacheHost<
  Owner extends object,
  Face extends object,
> {
  readCache(owner: Owner): NativePedProcessCache<Owner, Face> | null;
  /** Actual ped+0c writer; an internal unlimited per-ped Map is not substituted. */
  writeCache(
    owner: Owner,
    cache: NativePedProcessCache<Owner, Face> | null,
  ): void;
  /** Actual IRandomBetween512f00 outlet using the shared native CRT stream. */
  randomTurnInterval?: (minMs: number, maxMs: number) => number;
  /** Clear only the actual borrowed list Ped owner (+14), preserving list order and
   * records. This runs after old ped+0c eviction and before Init/RNG stores. */
  releaseFaceCache?: (
    face: Face,
    cache: NativePedProcessCache<Owner, Face>,
    previousOwner: Owner | null,
  ) => void;
}
export interface NativePedProcessCacheVisit<
  Owner extends object,
  Face extends object,
> {
  status: "complete" | "provider-required";
  requiredProviders: string[];
  cache: NativePedProcessCache<Owner, Face> | null;
  /** Distinct from a retained visit, which only stores owner/time and clears bit2. */
  initialized: boolean;
  evictedOwner: Owner | null;
  randomDrawCalls: number;
}
function uint(n: number, limit = 0xffffffff): number {
  if (!Number.isInteger(n) || n < 0 || n > limit)
    throw new Error("Invalid native pedestrian process-cache integer");
  return n;
}
function reference(value: object | null): void {
  if (
    value !== null &&
    typeof value !== "object" &&
    typeof value !== "function"
  )
    throw new Error("Native process cache requires an actual object identity");
}
function makeCache<Owner extends object, Face extends object>(
  index: number,
  replaySingleton: boolean,
): NativePedProcessCache<Owner, Face> {
  const storage = new Uint8Array(NATIVE_PED_PROCESS_CACHE_BYTES),
    view = new DataView(storage.buffer);
  const word = (offset: number, size: 1 | 2 | 4) => ({
    enumerable: true,
    get: () =>
      size === 1
        ? view.getUint8(offset)
        : size === 2
          ? view.getUint16(offset, true)
          : view.getUint32(offset, true),
    set: (value: number) => {
      uint(value, size === 1 ? 255 : size === 2 ? 65535 : 0xffffffff);
      if (size === 1) view.setUint8(offset, value);
      else if (size === 2) view.setUint16(offset, value, true);
      else view.setUint32(offset, value, true);
    },
  });
  const float = (offset: number) => ({
    enumerable: true,
    get: () => view.getFloat32(offset, true),
    set: (n: number) => {
      const f = Math.fround(n);
      if (!Number.isFinite(f))
        throw new Error("Invalid native process-cache float");
      view.setFloat32(offset, f, true);
    },
  });
  const vector = (offset: number) => ({
    enumerable: true,
    get: () => [
      view.getFloat32(offset, true),
      view.getFloat32(offset + 4, true),
      view.getFloat32(offset + 8, true),
    ],
    set: (value: PedVector) => {
      if (
        value.length !== 3 ||
        value.some((n) => !Number.isFinite(Math.fround(n)))
      )
        throw new Error("Invalid native process-cache vector");
      value.forEach((n, i) => view.setFloat32(offset + 4 * i, n, true));
    },
  });
  let owner: Owner | null = null,
    faceCache: Face | null = null,
    killer: object | null = null;
  const head = Object.defineProperties(
    {},
    {
      address: {
        enumerable: true,
        get: () => {
          const address = view.getUint32(0x1c, true);
          if (!address) return null;
          if (
            address !== 0x65d048 &&
            address !== 0x65d050 &&
            address !== 0x65d054
          )
            throw new Error(
              "Unrecovered native process-cache head sequence pointer",
            );
          return address;
        },
        set: (address: number | null) => {
          if (
            address !== null &&
            address !== 0x65d048 &&
            address !== 0x65d050 &&
            address !== 0x65d054
          )
            throw new Error("Invalid native process-cache head sequence");
          view.setUint32(0x1c, address ?? 0, true);
        },
      },
      index: word(0x1a, 1),
      startTimeMs: word(0x78, 4),
    },
  ) as NonNullable<NativePedGameplayCache["headSequence"]>;
  return Object.defineProperties(
    {
      index,
      replaySingleton,
      storage,
      stumpCounters: storage.subarray(
        0x23,
        0x23 + NATIVE_PED_PROCESS_STUMP_CAPACITY,
      ),
    },
    {
      owner: {
        enumerable: true,
        get: () => owner,
        set: (value: Owner | null) => {
          reference(value);
          owner = value;
        },
      },
      faceCache: {
        enumerable: true,
        get: () => faceCache,
        set: (value: Face | null) => {
          reference(value);
          faceCache = value;
          if (value === null) view.setUint32(0xb0, 0, true);
        },
      },
      killer: {
        enumerable: true,
        get: () => killer,
        set: (value: object | null) => {
          reference(value);
          killer = value;
          if (value === null) view.setUint32(0xc0, 0, true);
        },
      },
      retryCount: word(0x19, 1),
      flags: word(0x2e, 2),
      directionInterpolationMs: word(0x6c, 4),
      runSpeed: word(0x80, 4),
      runFactor: float(0xb8),
      lastUsedTimeMs: word(0x74, 4),
      nextTurnTimeMs: word(0x7c, 4),
      processFlags: word(0xc4, 4),
      spurtingPeriodMs: word(0x84, 4),
      floorNormal: vector(0),
      retainedDirection: vector(0xc),
      napalmDeadlineMs: {
        enumerable: true,
        get: () => view.getInt32(0x98, true),
        set: (value: number) => {
          if (
            !Number.isInteger(value) ||
            value < -0x80000000 ||
            value > 0xffffffff
          )
            throw new Error("Invalid native process-cache napalm DWORD");
          view.setInt32(0x98, value, true);
        },
      },
      headSequence: {
        enumerable: true,
        get: () => head,
        set: (value: NativePedGameplayCache["headSequence"]) => {
          head.address = value?.address ?? null;
          if (value) {
            head.index = value.index;
            head.startTimeMs = value.startTimeMs;
          }
        },
      },
    },
  ) as NativePedProcessCache<Owner, Face>;
}

/** Selection uses unsigned absolute timestamps, including the source(now+1)
 * wrap quirk. It is not elapsed-age sorting or a true modern LRU algorithm. */
export function selectNativePedProcessCacheIndex(
  slots: readonly { owner: object | null; lastUsedTimeMs: number }[],
  timeMs: number,
): number {
  uint(timeMs);
  if (slots.length !== NATIVE_PED_PROCESS_CACHE_CAPACITY)
    throw new Error("Native process cache requires exactly 100 records");
  let candidate = 0,
    oldest = (timeMs + 1) >>> 0;
  for (let index = 0; index < slots.length; index++) {
    reference(slots[index].owner);
    uint(slots[index].lastUsedTimeMs);
    if (slots[index].owner === null) return index;
    if (slots[index].lastUsedTimeMs < oldest) {
      oldest = slots[index].lastUsedTimeMs;
      candidate = index;
    }
  }
  return candidate;
}

export class NativePedProcessCachePool<
  Owner extends object,
  Face extends object,
> {
  /** Stable source array order; clients must not reorder or replace records. */
  readonly slots: readonly NativePedProcessCache<Owner, Face>[];
  readonly replayCache: NativePedProcessCache<Owner, Face>;
  constructor(private readonly host: NativePedProcessCacheHost<Owner, Face>) {
    if (
      typeof host.readCache !== "function" ||
      typeof host.writeCache !== "function"
    )
      throw new Error(
        "Native process cache requires actual ped pointer owners",
      );
    this.slots = Object.freeze(
      Array.from({ length: NATIVE_PED_PROCESS_CACHE_CAPACITY }, (_, i) =>
        makeCache<Owner, Face>(i, false),
      ),
    );
    this.replayCache = makeCache<Owner, Face>(-1, true);
  }
  /** Only an admitted/processed native Munge visit calls this. Offscreen render
   * release neither frees a process record nor updates its timestamp. */
  visit(
    owner: Owner,
    input: NativePedProcessCacheVisitInput,
  ): NativePedProcessCacheVisit<Owner, Face> {
    reference(owner);
    if (owner === null) throw new Error("Native process owner cannot be NULL");
    uint(input.timeMs);
    uint(input.spurtingPeriodMs);
    uint(input.minTurnIntervalMs, 0x7fffffff);
    uint(input.maxTurnIntervalMs, 0x7fffffff);
    if (
      typeof input.replay !== "boolean" ||
      input.minTurnIntervalMs > input.maxTurnIntervalMs
    )
      throw new Error("Invalid native process-cache visit inputs");
    const prior = this.host.readCache(owner);
    if (
      prior !== null &&
      prior !== this.replayCache &&
      (!this.slots.includes(prior) || prior.owner !== owner)
    )
      throw new Error("Stale or foreign native process cache identity");
    const initialized = prior === null || prior === this.replayCache;
    const cache = initialized
      ? input.replay
        ? this.replayCache
        : this.slots[selectNativePedProcessCacheIndex(this.slots, input.timeMs)]
      : prior!;
    const evictedOwner = initialized && !input.replay ? cache.owner : null;
    if (evictedOwner !== null && this.host.readCache(evictedOwner) !== cache)
      throw new Error("Native process-cache owner link is inconsistent");
    const missing: string[] = [];
    if (initialized && cache.faceCache !== null && !this.host.releaseFaceCache)
      missing.push("native-process-borrowed-face-release-owner");
    if (
      initialized &&
      input.maxTurnIntervalMs !== 0 &&
      !this.host.randomTurnInterval
    )
      missing.push("native-process-next-turn-CRT-owner");
    if (missing.length)
      return {
        status: "provider-required",
        requiredProviders: missing,
        cache: prior,
        initialized: false,
        evictedOwner: null,
        randomDrawCalls: 0,
      };
    let randomDrawCalls = 0;
    if (initialized) {
      // 4d38e4 stores new ped.cache before 4d38ed clears displaced ped.cache.
      this.host.writeCache(owner, cache);
      if (evictedOwner !== null) this.host.writeCache(evictedOwner, null);
      if (cache.faceCache !== null) {
        this.host.releaseFaceCache!(cache.faceCache, cache, cache.owner);
        cache.faceCache = null;
      }
      if (input.maxTurnIntervalMs !== 0) {
        const interval = this.host.randomTurnInterval!(
          input.minTurnIntervalMs,
          input.maxTurnIntervalMs,
        );
        if (
          !Number.isInteger(interval) ||
          interval < -0x80000000 ||
          interval > 0x7fffffff
        )
          throw new Error("Invalid native IRandomBetween process result");
        randomDrawCalls = 1;
        cache.nextTurnTimeMs = (input.timeMs + interval) >>> 0;
      } else cache.nextTurnTimeMs = 0;
      const view = new DataView(
        cache.storage.buffer,
        cache.storage.byteOffset,
        cache.storage.byteLength,
      );
      // Selective installed stores: retain all other numeric/opaque bytes.
      view.setUint8(0x18, 0);
      cache.directionInterpolationMs = 0;
      cache.runSpeed = 0;
      cache.retryCount = 0;
      cache.killer = null;
      cache.headSequence!.address = null;
      cache.flags = 0;
      view.setUint8(0x21, 0);
      view.setInt32(0xa0, -1, true);
      for (const offset of [0x9c, 0x88, 0x8c]) view.setUint32(offset, 0, true);
      cache.spurtingPeriodMs = input.spurtingPeriodMs;
      cache.processFlags = (cache.processFlags & ~1) >>> 0;
      for (const offset of [0x94, 0x90]) view.setUint32(offset, 0, true);
      cache.napalmDeadlineMs = 0;
      cache.stumpCounters.fill(0, 0, NATIVE_PED_PROCESS_STUMP_COUNT);
    }
    cache.owner = owner;
    cache.lastUsedTimeMs = input.timeMs;
    cache.processFlags = (cache.processFlags & ~2) >>> 0;
    return {
      status: "complete",
      requiredProviders: [],
      cache,
      initialized,
      evictedOwner,
      randomDrawCalls,
    };
  }
}
