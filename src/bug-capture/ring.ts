export const DEFAULT_CAPTURE_MAX_AGE_MS = 180_000;
export const DEFAULT_CAPTURE_MAX_BYTES = 512 * 1024 * 1024;
export const DEFAULT_CAPTURE_MAX_RECORDS = 262_144;
export const CAPTURE_RECORD_OVERHEAD_BYTES = 128;
export const CAPTURE_SLOT_OVERHEAD_BYTES = 8;
export const DEFAULT_CAPTURE_RESERVE_BYTES = 64 * 1024;

export interface CaptureRecord {
  readonly timeMs: number;
  readonly kind: number;
  /** Owned, exact-size storage. Consumers must not mutate this payload. */
  readonly payload: Uint8Array<ArrayBuffer>;
}

export interface CaptureRingOptions {
  maxBytes?: number;
  maxAgeMs?: number;
  maxRecords?: number;
  reserveBytes?: number;
}

export interface CaptureRingStats {
  count: number;
  payloadBytes: number;
  accountedBytes: number;
  maxBytes: number;
  maxAgeMs: number;
  maxRecords: number;
  oldestTimeMs: number | null;
  newestTimeMs: number | null;
  droppedOversize: number;
  droppedInvalid: number;
  evictedAge: number;
  evictedBytes: number;
  evictedCapacity: number;
}

export interface CaptureSnapshot {
  readonly records: readonly CaptureRecord[];
  readonly stats: CaptureRingStats;
}

function integer(value: number, name: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be an integer >= ${minimum}`);
  }
  return value;
}

/**
 * O(1) removal with fixed slot storage; each record is copied exactly once.
 * The budget charges payload backing buffers plus conservative bookkeeping
 * estimates. It is not a measurement or guarantee of the JavaScript heap.
 * Snapshots retain payloads outside this budget: the exporter must bound their
 * lifetime and reserve space for Blob copies. The ring never mutates payloads.
 */
export class BoundedCaptureRing {
  readonly maxBytes: number;
  readonly maxAgeMs: number;
  readonly maxRecords: number;
  private readonly baseBytes: number;
  private readonly slots: (CaptureRecord | undefined)[];
  private head = 0;
  private count = 0;
  private payloadBytes = 0;
  private logicalTimeMs = -Infinity;
  private droppedOversize = 0;
  private droppedInvalid = 0;
  private evictedAge = 0;
  private evictedBytes = 0;
  private evictedCapacity = 0;

  constructor(options: CaptureRingOptions = {}) {
    this.maxBytes = integer(
      options.maxBytes ?? DEFAULT_CAPTURE_MAX_BYTES,
      "maxBytes",
      1,
    );
    this.maxAgeMs = options.maxAgeMs ?? DEFAULT_CAPTURE_MAX_AGE_MS;
    if (!Number.isFinite(this.maxAgeMs) || this.maxAgeMs < 0) {
      throw new RangeError("maxAgeMs must be finite and nonnegative");
    }
    const reserve = integer(
      options.reserveBytes ?? DEFAULT_CAPTURE_RESERVE_BYTES,
      "reserveBytes",
      0,
    );
    const requested = integer(
      options.maxRecords ?? DEFAULT_CAPTURE_MAX_RECORDS,
      "maxRecords",
      1,
    );
    // Slots themselves consume budget even when the ring is empty.
    this.maxRecords = Math.min(
      requested,
      Math.floor(
        (this.maxBytes - reserve) /
          (CAPTURE_SLOT_OVERHEAD_BYTES + CAPTURE_RECORD_OVERHEAD_BYTES),
      ),
    );
    if (this.maxRecords < 1)
      throw new RangeError(
        "capture budget cannot hold the reserve and one record",
      );
    this.baseBytes = reserve + this.maxRecords * CAPTURE_SLOT_OVERHEAD_BYTES;
    this.slots = new Array(this.maxRecords).fill(undefined);
  }

  /** Backward timestamps clamp to the latest observed finite timestamp. */
  advance(timeMs: number): void {
    if (!Number.isFinite(timeMs)) return;
    this.logicalTimeMs = Math.max(this.logicalTimeMs, timeMs);
    const cutoff = this.logicalTimeMs - this.maxAgeMs;
    while (this.count && this.slots[this.head]!.timeMs < cutoff) {
      this.removeOldest();
      this.evictedAge = Math.min(Number.MAX_SAFE_INTEGER, this.evictedAge + 1);
    }
  }

  push(timeMs: number, kind: number, payload: Uint8Array): boolean {
    if (
      !Number.isFinite(timeMs) ||
      !Number.isInteger(kind) ||
      kind < 0 ||
      kind > 0xffffffff ||
      !(payload instanceof Uint8Array)
    ) {
      this.droppedInvalid = Math.min(
        Number.MAX_SAFE_INTEGER,
        this.droppedInvalid + 1,
      );
      return false;
    }
    this.advance(timeMs);
    // Preflight before copying: a tiny view cannot retain a huge input buffer,
    // and an oversized input cannot cause a transient huge allocation.
    const bytes = payload.byteLength;
    if (
      bytes + this.baseBytes + CAPTURE_RECORD_OVERHEAD_BYTES >
      this.maxBytes
    ) {
      this.droppedOversize = Math.min(
        Number.MAX_SAFE_INTEGER,
        this.droppedOversize + 1,
      );
      return false;
    }
    if (this.count === this.maxRecords) {
      this.removeOldest();
      this.evictedCapacity = Math.min(
        Number.MAX_SAFE_INTEGER,
        this.evictedCapacity + 1,
      );
    }
    while (
      this.baseBytes +
        this.payloadBytes +
        (this.count + 1) * CAPTURE_RECORD_OVERHEAD_BYTES +
        bytes >
      this.maxBytes
    ) {
      this.removeOldest();
      this.evictedBytes = Math.min(
        Number.MAX_SAFE_INTEGER,
        this.evictedBytes + 1,
      );
    }
    // Release old entries before allocating the replacement buffer.
    const owned = new Uint8Array(bytes);
    owned.set(payload);
    this.slots[(this.head + this.count) % this.maxRecords] = {
      timeMs: this.logicalTimeMs,
      kind,
      payload: owned,
    };
    this.count++;
    this.payloadBytes += bytes;
    return true;
  }

  private removeOldest(): void {
    this.payloadBytes -= this.slots[this.head]!.payload.byteLength;
    this.slots[this.head] = undefined;
    this.head = (this.head + 1) % this.maxRecords;
    this.count--;
  }

  get stats(): CaptureRingStats {
    return {
      count: this.count,
      payloadBytes: this.payloadBytes,
      accountedBytes:
        this.baseBytes +
        this.payloadBytes +
        this.count * CAPTURE_RECORD_OVERHEAD_BYTES,
      maxBytes: this.maxBytes,
      maxAgeMs: this.maxAgeMs,
      maxRecords: this.maxRecords,
      oldestTimeMs: this.count ? this.slots[this.head]!.timeMs : null,
      newestTimeMs: this.count
        ? this.slots[(this.head + this.count - 1) % this.maxRecords]!.timeMs
        : null,
      droppedOversize: this.droppedOversize,
      droppedInvalid: this.droppedInvalid,
      evictedAge: this.evictedAge,
      evictedBytes: this.evictedBytes,
      evictedCapacity: this.evictedCapacity,
    };
  }

  /** Stable under pushes/eviction; payload ownership remains shared read-only. */
  snapshot(): CaptureSnapshot {
    const records = new Array<CaptureRecord>(this.count);
    for (let i = 0; i < this.count; i++)
      records[i] = this.slots[(this.head + i) % this.maxRecords]!;
    return { records, stats: this.stats };
  }
}
