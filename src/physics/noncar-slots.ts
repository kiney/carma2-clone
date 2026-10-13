/** Compatible with the connotation-debris bridge's NativeNonCarBodySlot. */
export type NativeNonCarBodySlot =
  | { readonly kind: "dedicated"; readonly mechanicsIndex: number }
  | { readonly kind: "extra"; readonly index: number };

export const NATIVE_NONCAR_EXTRA_CAPACITY = 40;

function mechanicsIndex(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError("Invalid native noncar mechanics index");
}
function validateSlot(slot: NativeNonCarBodySlot): void {
  if (slot.kind === "dedicated") mechanicsIndex(slot.mechanicsIndex);
  else if (slot.kind === "extra") {
    if (
      !Number.isInteger(slot.index) ||
      slot.index < 0 ||
      slot.index >= NATIVE_NONCAR_EXTRA_CAPACITY
    )
      throw new RangeError("Invalid native noncar extra slot index");
  } else throw new RangeError("Invalid native noncar slot kind");
}
function sameSlot(a: NativeNonCarBodySlot, b: NativeNonCarBodySlot): boolean {
  return a.kind === "dedicated"
    ? b.kind === "dedicated" && a.mechanicsIndex === b.mechanicsIndex
    : b.kind === "extra" && a.index === b.index;
}
function snapshotSlot(slot: NativeNonCarBodySlot): NativeNonCarBodySlot {
  return slot.kind === "dedicated"
    ? Object.freeze({ kind: "dedicated", mechanicsIndex: slot.mechanicsIndex })
    : Object.freeze({ kind: "extra", index: slot.index });
}

/** Independent occupancy from installed DoPullActorFromWorld41ff40:
 * one dedicated owner per mechanics type, then the first free of40 GLOBAL
 * extras (41ff97..41ffb9). Claims represent occupied driver4 owners; the host
 * supplies driver writes, PHIL admission and authoritative reclaim/release.
 *
 * This is not native body-memory aliasing. Owners remain caller identities;
 * ACT retention/count/resources are separate and are never changed here.
 * See docs/c2-noncar-wake-pull-re.md and c2-noncar-slot-reclaim-re.md.
 */
export class NativeNonCarSlots<Owner extends object = object> {
  private readonly dedicated = new Map<number, Owner>();
  private readonly extras: (Owner | undefined)[] = Array(
    NATIVE_NONCAR_EXTRA_CAPACITY,
  ).fill(undefined);
  private readonly owners = new Map<Owner, NativeNonCarBodySlot>();

  get count(): number {
    return this.owners.size;
  }
  get dedicatedCount(): number {
    return this.dedicated.size;
  }
  get extraCount(): number {
    return this.count - this.dedicatedCount;
  }
  get freeExtraCount(): number {
    return NATIVE_NONCAR_EXTRA_CAPACITY - this.extraCount;
  }
  get(owner: Owner): NativeNonCarBodySlot | null {
    return this.owners.get(owner) ?? null;
  }
  ownerOf(slot: NativeNonCarBodySlot): Owner | null {
    validateSlot(slot);
    return slot.kind === "dedicated"
      ? (this.dedicated.get(slot.mechanicsIndex) ?? null)
      : (this.extras[slot.index] ?? null);
  }
  isOccupied(slot: NativeNonCarBodySlot): boolean {
    return this.ownerOf(slot) !== null;
  }

  /** Ordinary pulls prefer the type's dedicated slot before scanning extras.
   * An explicit debris slot reserves ONLY that slot, with no fallback. A
   * repeated owner claim is idempotent; a conflicting explicit slot fails.
   * Invalid descriptors throw before any occupancy mutation. */
  claim(
    owner: Owner,
    index: number,
    preassigned?: NativeNonCarBodySlot,
  ): NativeNonCarBodySlot | null {
    if (
      owner === null ||
      (typeof owner !== "object" && typeof owner !== "function")
    )
      throw new TypeError("Native noncar slot owner must be an object");
    mechanicsIndex(index);
    if (preassigned) {
      validateSlot(preassigned);
      if (
        preassigned.kind === "dedicated" &&
        preassigned.mechanicsIndex !== index
      )
        throw new RangeError(
          "Preassigned noncar slot mechanics index mismatch",
        );
    }
    const existing = this.get(owner);
    if (existing)
      return !preassigned || sameSlot(existing, preassigned) ? existing : null;
    let slot = preassigned;
    if (!slot) {
      if (!this.dedicated.has(index))
        slot = { kind: "dedicated", mechanicsIndex: index };
      else {
        const extra = this.extras.findIndex((entry) => entry === undefined);
        if (extra < 0) return null;
        slot = { kind: "extra", index: extra };
      }
    }
    if (this.isOccupied(slot)) return null;
    const captured = snapshotSlot(slot);
    if (captured.kind === "dedicated")
      this.dedicated.set(captured.mechanicsIndex, owner);
    else this.extras[captured.index] = owner;
    this.owners.set(owner, captured);
    return captured;
  }

  /** Free physical occupancy without changing or destroying the retained ACT. */
  release(owner: Owner): NativeNonCarBodySlot | null {
    const slot = this.get(owner);
    if (!slot) return null;
    if (slot.kind === "dedicated") this.dedicated.delete(slot.mechanicsIndex);
    else this.extras[slot.index] = undefined;
    this.owners.delete(owner);
    return slot;
  }
  /** Race-owner disposal; does not invoke ACT/resource callbacks. */
  clear(): void {
    this.dedicated.clear();
    this.extras.fill(undefined);
    this.owners.clear();
  }
}
