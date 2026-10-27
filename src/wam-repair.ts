const UINT32 = 0xffff_ffff;
const REPAIR_STEP_MS = 150;

export interface WamRepairQueueEntry<Key extends object, Owner> {
  key: Key;
  owner: Owner;
  lastStepMs: number;
}

interface RepairRecord<Key extends object, Owner> {
  key: Key;
  owner: Owner;
  lastStepMs: number;
  readTier: () => number;
  applyTier: (tier: number) => void;
}

/** Native clean-principal WAM repair animation queue (HW global25 records).
 * Repair commits one tier immediately and then animates one tier per due
 * outer-frame update. Callbacks should only update tier/texture state. */
export class NativeWamRepairQueue<Key extends object, Owner> {
  private readonly records: Array<RepairRecord<Key, Owner> | undefined>;

  constructor(capacity = 25) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error("Invalid WAM repair queue capacity");
    this.records = Array(capacity);
  }

  get capacity() {
    return this.records.length;
  }

  get size() {
    return this.records.reduce((count, record) => count + Number(!!record), 0);
  }

  /** Apply the immediate repair tier, then insert or refresh its animation.
   * A full queue still performs the immediate repair and returns false. */
  start(
    key: Key,
    owner: Owner,
    nowMs: number,
    readTier: () => number,
    applyTier: (tier: number) => void,
  ): boolean {
    const now = this.clock(nowMs);
    const currentTier = this.tier(readTier());
    if (currentTier <= 0) return false;
    applyTier(currentTier - 1);

    let slot = this.records.findIndex((record) => record?.key === key);
    if (slot < 0) slot = this.records.findIndex((record) => !record);
    if (slot < 0) return false;
    this.records[slot] = {
      key,
      owner,
      lastStepMs: now,
      readTier,
      applyTier,
    };
    return true;
  }

  /** A newly committed damage tier supersedes the queued repair animation. */
  cancel(key: Key): boolean {
    const slot = this.records.findIndex((record) => record?.key === key);
    if (slot < 0) return false;
    this.records[slot] = undefined;
    return true;
  }

  /** Process slots in native ascending order and at most one tier per call. */
  update(nowMs: number): number {
    const now = this.clock(nowMs);
    let stepped = 0;
    for (let slot = 0; slot < this.records.length; slot++) {
      const record = this.records[slot];
      if (!record) continue;
      if ((now - record.lastStepMs) >>> 0 < REPAIR_STEP_MS) continue;
      const tier = this.tier(record.readTier());
      if (tier !== 0) {
        record.applyTier(tier - 1);
        stepped++;
      }
      record.lastStepMs = (record.lastStepMs + REPAIR_STEP_MS) >>> 0;
      if (this.tier(record.readTier()) === 0) this.records[slot] = undefined;
    }
    return stepped;
  }

  snapshot(): Array<WamRepairQueueEntry<Key, Owner> | undefined> {
    return this.records.map((record) =>
      record
        ? {
            key: record.key,
            owner: record.owner,
            lastStepMs: record.lastStepMs,
          }
        : undefined,
    );
  }

  clear() {
    this.records.fill(undefined);
  }

  private clock(value: number) {
    if (!Number.isInteger(value) || value < 0 || value > UINT32)
      throw new Error("Invalid WAM repair clock");
    return value;
  }

  private tier(value: number) {
    if (!Number.isInteger(value) || value < 0)
      throw new Error("Invalid WAM damage tier");
    return value;
  }
}
