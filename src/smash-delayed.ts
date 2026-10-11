/** Installed MungeDelayedSideEffects4ec9f0 visits one shared twenty-slot
 * pool in physical slot order. Noncar cuboids and individual followup smashes
 * share capacity. A slot stays active until its consumer returns. */
export interface NativeDelayedTask {
  advance(nowMs: number): boolean;
}

export interface NativeDelayedSideEffect<Context> {
  kind: "noncar" | "smash";
  context: Context;
}

export class NativeDelayedSideEffects<Context> {
  static readonly capacity = 20;
  private slots: Array<NativeDelayedSideEffect<Context> | undefined> =
    Array.from({ length: NativeDelayedSideEffects.capacity });
  private updating = false;

  get count(): number {
    return this.slots.reduce((count, slot) => count + Number(!!slot), 0);
  }

  find(
    predicate: (entry: Readonly<NativeDelayedSideEffect<Context>>) => boolean,
  ): Readonly<NativeDelayedSideEffect<Context>> | undefined {
    return this.slots.find((entry) => entry && predicate(entry));
  }

  enqueue(entry: NativeDelayedSideEffect<Context>): boolean {
    const free = this.slots.findIndex((slot) => !slot);
    if (free < 0) return false;
    this.slots[free] = { ...entry };
    return true;
  }

  /** No sorted deadline list or pre-removal: newly inserted later slots are
   * visited during this scan; reused earlier slots wait for the next scan.
   * The original accepts uint32 time regressions and compares due times in
   * each consumer. Reentrant updates throw instead of corrupting ownership. */
  update(
    nowMs: number,
    consume: (
      entry: Readonly<NativeDelayedSideEffect<Context>>,
      nowMs: number,
    ) => boolean,
  ): number {
    if (!Number.isSafeInteger(nowMs) || nowMs < 0 || nowMs > 0xffffffff)
      throw new Error("Invalid delayed smash clock");
    if (this.updating)
      throw new Error("Cannot recursively update delayed smashes");
    this.updating = true;
    let completed = 0;
    try {
      for (let i = 0; i < this.slots.length; i++) {
        const entry = this.slots[i];
        if (entry && consume(entry, nowMs)) {
          this.slots[i] = undefined;
          completed++;
        }
      }
      return completed;
    } finally {
      this.updating = false;
    }
  }

  initialize(): void {
    if (this.updating)
      throw new Error("Cannot clear delayed smashes during update");
    this.slots.fill(undefined);
  }
}
