import {
  NATIVE_PED_GROUND_CACHE_CAPACITIES,
  type NativePedGroundAcquireRequest,
  type NativePedGroundCacheCapacity,
  type NativePedGroundFace,
} from "./ped-grounding";
import type { PedBounds } from "./ped-form";

/** Installed 65c328: number of lists, distinct from faces per list65c318. */
export const NATIVE_PED_GROUND_CACHE_COUNTS = [40, 25, 15, 5] as const;
export interface NativePedGroundCacheSlot<F extends NativePedGroundFace> {
  readonly index: number;
  readonly capacity: NativePedGroundCacheCapacity;
  owner: object | null;
  timeMs: number;
  faces: readonly F[];
  bounds: PedBounds;
}

/** Actual four finite circular buckets (4cae92/4d59a0/4d1fab).
 * Acquisition rotates a head to the tail; same-capacity reuse moves that
 * specific slot to the tail. Retained support visits do not touch the list.
 * No TTL, per-person allocation or unlimited snapshot cache is substituted. */
export class NativePedGroundCachePool<F extends NativePedGroundFace> {
  private buckets: NativePedGroundCacheSlot<F>[][];
  private owners = new WeakMap<object, NativePedGroundCacheSlot<F>>();
  diagnostics = 0;
  constructor(
    private readonly evicted?: (
      owner: object,
      slot: NativePedGroundCacheSlot<F>,
    ) => void,
  ) {
    this.buckets = NATIVE_PED_GROUND_CACHE_CAPACITIES.map((capacity, bucket) =>
      Array.from(
        { length: NATIVE_PED_GROUND_CACHE_COUNTS[bucket] },
        (_, index) => ({
          index,
          capacity,
          owner: null,
          timeMs: 0,
          faces: [],
          bounds: { min: [0, 0, 0], max: [0, 0, 0] } as PedBounds,
        }),
      ),
    );
  }
  get size(): number {
    return this.buckets.reduce((n, b) => n + b.length, 0);
  }
  get(owner: object): NativePedGroundCacheSlot<F> | null {
    return this.owners.get(owner) ?? null;
  }
  /** Read-only order, with the next candidate first. Slot identity is stable. */
  order(
    capacity: NativePedGroundCacheCapacity,
  ): readonly NativePedGroundCacheSlot<F>[] {
    const index = NATIVE_PED_GROUND_CACHE_CAPACITIES.indexOf(capacity);
    if (index < 0) throw new Error("Invalid native pedestrian face bucket");
    return [...this.buckets[index]];
  }
  acquire(
    request: NativePedGroundAcquireRequest<F, NativePedGroundCacheSlot<F>>,
  ): NativePedGroundCacheSlot<F> {
    const { owner, capacity, faces, bounds, timeMs } = request;
    if (typeof owner !== "object" || owner === null)
      throw new Error("Native pedestrian face cache requires an actual owner");
    const bucketIndex = NATIVE_PED_GROUND_CACHE_CAPACITIES.indexOf(capacity);
    if (bucketIndex < 0 || faces.length > capacity)
      throw new Error("Invalid native pedestrian face cache capacity");
    if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > 0xffffffff)
      throw new Error("Native pedestrian cache time must be uint32");
    if (
      bounds.min.some(
        (n, i) =>
          !Number.isFinite(n) ||
          !Number.isFinite(bounds.max[i]) ||
          n > bounds.max[i],
      )
    )
      throw new Error("Invalid native pedestrian face cache bounds");
    const previous = this.owners.get(owner) ?? null;
    if (
      request.preferredIdentity &&
      (request.preferredIdentity !== previous ||
        previous?.capacity !== capacity)
    )
      throw new Error("Stale native pedestrian face cache reuse identity");
    // Installed4d1fce clears the old owner without moving its bucket entry.
    if (previous && previous.capacity !== capacity) previous.owner = null;
    const bucket = this.buckets[bucketIndex];
    const slot = previous?.capacity === capacity ? previous : bucket[0];
    const priorOwner = slot.owner;
    if (priorOwner && priorOwner !== owner) {
      // Installed4d1fe9 first clears the evicted process's cache pointer.
      this.owners.delete(priorOwner);
      if (slot.timeMs === timeMs) this.diagnostics |= 1;
      slot.owner = null;
      this.evicted?.(priorOwner, slot);
    }
    const index = bucket.indexOf(slot);
    if (index < 0)
      throw new Error("Native pedestrian face cache ring corruption");
    bucket.splice(index, 1);
    bucket.push(slot);
    slot.timeMs = timeMs;
    slot.owner = owner;
    // Native memcpy copies records. Preserve record ordering but do not retain
    // the collector's reusable scratch list as this slot's storage.
    slot.faces = faces.map((face) => ({
      ...face,
      a: [...face.a],
      b: [...face.b],
      c: [...face.c],
      normal: [...face.normal],
    }));
    slot.bounds = {
      min: [
        Math.fround(bounds.min[0]),
        Math.fround(bounds.min[1]),
        Math.fround(bounds.min[2]),
      ],
      max: [
        Math.fround(bounds.max[0]),
        Math.fround(bounds.max[1]),
        Math.fround(bounds.max[2]),
      ],
    };
    this.owners.set(owner, slot);
    return slot;
  }
  /** Owner release clears the back link; it does not promote/rotate a slot. */
  release(owner: object): void {
    const slot = this.owners.get(owner);
    if (slot?.owner === owner) slot.owner = null;
    this.owners.delete(owner);
  }
  /** Installed4d59a0 restores allocation order and clears owners, not faces. */
  reset(): void {
    for (const bucket of this.buckets) {
      bucket.sort((a, b) => a.index - b.index);
      for (const slot of bucket) slot.owner = null;
    }
    this.owners = new WeakMap();
  }
}
