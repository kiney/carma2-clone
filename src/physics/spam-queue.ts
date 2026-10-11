export const SPAM_QUEUE_CAPACITY = 8;

export interface SpamQueueEntry<TIdentity extends object> {
  identity: TIdentity;
  strength: number;
}

/** Physics-active TotallySpamTheModel 0x431560 deferred work list. */
export class NativeSpamQueue<TIdentity extends object = object> {
  private entries: SpamQueueEntry<TIdentity>[] = [];

  get count(): number {
    return this.entries.length;
  }

  enqueue(identity: TIdentity, strength: number): boolean {
    if (!identity || typeof identity !== "object")
      throw new Error("Spam queue identity must be an object");
    if (!Number.isFinite(strength) || strength < 0)
      throw new Error("Spam queue strength must be finite and nonnegative");
    const savedStrength = Math.fround(strength);
    if (!Number.isFinite(savedStrength))
      throw new Error("Spam queue strength exceeds Float32 range");

    // The installed routine checks count==8 before searching for this identity.
    if (this.entries.length >= SPAM_QUEUE_CAPACITY) return false;
    const existing = this.entries.find((entry) => entry.identity === identity);
    if (existing) {
      if (savedStrength <= existing.strength) return false;
      existing.strength = savedStrength;
      return true;
    }
    this.entries.push({ identity, strength: savedStrength });
    return true;
  }

  /** Stable-compacting RemoveCarFromCrushLists behavior for deferred SPAM. */
  cancel(identity: TIdentity): boolean {
    const index = this.entries.findIndex(
      (entry) => entry.identity === identity,
    );
    if (index < 0) return false;
    this.entries.splice(index, 1);
    return true;
  }

  drain(): SpamQueueEntry<TIdentity>[] {
    const entries = this.snapshot();
    this.entries = [];
    return entries;
  }

  initialize(): void {
    this.entries = [];
  }

  snapshot(): SpamQueueEntry<TIdentity>[] {
    return this.entries.map(({ identity, strength }) => ({
      identity,
      strength,
    }));
  }
}
