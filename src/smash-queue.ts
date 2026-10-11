/** Installed C2 shares these twenty pending records between car WAM and
 * texture/decal world smashes. Context values must be copied by the caller. */
export interface NativeSmashQueueRequest<Context> {
  key: object;
  targetTier: number;
  context: Context;
  getReachedTier: () => number;
  getLevelCount: () => number;
  hasModel: () => boolean;
}

export type NativeSmashQueueEntry<Context> = Readonly<
  NativeSmashQueueRequest<Context>
>;

export interface NativeSmashQueueDispatch<Context>
  extends NativeSmashQueueEntry<Context> {
  /** Live state sampled before the consumer applies the final texture. */
  readonly reachedTier: number;
  readonly levelCount: number;
}

function tierState(levelCount: number, reachedTier: number): void {
  if (
    !Number.isInteger(levelCount) ||
    levelCount < 0 ||
    !Number.isInteger(reachedTier) ||
    reachedTier < 0
  )
    throw new Error("Invalid native smash queue tier state");
}

/** The consumer owns texture-first execution, crossed-tier flags, final-tier
 * payload repetition and model updates. This queue owns pending record order. */
export class NativeSmashQueue<Context> {
  static readonly capacity = 20;
  private readonly records: NativeSmashQueueRequest<Context>[] = [];
  private pendingCount = 0;
  private flushing = false;

  get count(): number {
    return this.pendingCount;
  }

  /** Native initialization clears the count; it does not erase backing slots. */
  initialize(): void {
    if (this.flushing)
      throw new Error("Cannot initialize native smash queue during flush");
    this.pendingCount = 0;
  }

  enqueue(
    request: NativeSmashQueueRequest<Context>,
  ): "inserted" | "upgraded" | "ignored" {
    if (
      request.key === null ||
      typeof request.key !== "object" ||
      !Number.isInteger(request.targetTier) ||
      request.targetTier < 0 ||
      typeof request.getLevelCount !== "function" ||
      typeof request.getReachedTier !== "function" ||
      typeof request.hasModel !== "function"
    )
      throw new Error("Invalid native smash queue request");
    const levelCount = request.getLevelCount(),
      reachedTier = request.getReachedTier();
    tierState(levelCount, reachedTier);
    if (reachedTier >= levelCount - 1) return "ignored";
    // Capacity precedes both the model gate and identity lookup in 4ee010.
    if (this.pendingCount >= NativeSmashQueue.capacity) return "ignored";
    if (!request.hasModel()) return "ignored";
    if (request.targetTier >= levelCount)
      throw new Error("Native smash queue target is outside authored levels");
    if (request.targetTier <= reachedTier) return "ignored";
    for (let i = 0; i < this.pendingCount; i++) {
      const entry = this.records[i];
      if (entry.key !== request.key) continue;
      if (entry.targetTier >= request.targetTier) return "ignored";
      // The original changes only +38. In particular, retain first context,
      // actor/model getters, velocity snapshots and transform references.
      entry.targetTier = request.targetTier;
      return "upgraded";
    }
    this.records[this.pendingCount++] = { ...request };
    return "inserted";
  }

  /** Immutable shallow record snapshots; context ownership stays with callers. */
  snapshot(): readonly NativeSmashQueueEntry<Context>[] {
    return Object.freeze(
      this.records
        .slice(0, this.pendingCount)
        .map((entry) => Object.freeze({ ...entry })),
    );
  }

  /** The clock is sampled separately for every entry with a live model, even
   * if its live tier subsequently proves exhausted. Appends during consume are
   * visited in this flush while capacity and dedup still see pending records.
   * A callback failure leaves the count intact and propagates the error. */
  flush(
    readTimeMs: () => number,
    consume: (entry: NativeSmashQueueDispatch<Context>, nowMs: number) => void,
    beforeClear?: () => void,
  ): number {
    if (this.flushing)
      throw new Error("Cannot recursively flush native smash queue");
    if (typeof readTimeMs !== "function" || typeof consume !== "function")
      throw new Error("Invalid native smash queue flush callbacks");
    this.flushing = true;
    let consumed = 0;
    try {
      for (let i = 0; i < this.pendingCount; i++) {
        const entry = this.records[i];
        if (!entry.hasModel()) continue;
        const nowMs = readTimeMs();
        if (!Number.isInteger(nowMs) || nowMs < 0 || nowMs > 0xffffffff)
          throw new Error("Invalid native smash queue clock");
        const levelCount = entry.getLevelCount(),
          reachedTier = entry.getReachedTier();
        tierState(levelCount, reachedTier);
        if (reachedTier >= levelCount - 1) continue;
        consume(
          Object.freeze({
            ...entry,
            targetTier: Math.min(entry.targetTier, levelCount - 1),
            reachedTier,
            levelCount,
          }),
          nowMs,
        );
        consumed++;
      }
      // Final native powerup grants run while consumed smash records still
      // occupy capacity, before clearing this count at4ed011.
      beforeClear?.();
      this.pendingCount = 0;
      return consumed;
    } finally {
      this.flushing = false;
    }
  }
}
