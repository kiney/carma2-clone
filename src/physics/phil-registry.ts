/** Independent normal PHIL header ownership. Installed evidence and the
 * intentionally unsupported deferred union: docs/c2-phil-registration-re.md. */
export const NATIVE_PHIL_NORMAL_CAPACITY = 100;
export interface NativePhilHeader<Body extends object> {
  readonly index: number;
  body: Body | null;
  flags: number;
  state: 1 | 2;
  drag: number;
  gravity: number;
  levelOut: number;
}
export type NativePhilVector = readonly [number, number, number];
export interface NativePhilBodyAccess<Body extends object> {
  readFlags(body: Body): number;
  writeFlags(body: Body, flags: number): void;
  /** Removal preserves normal indicator1 even with a NULL header pointer. */
  writeBinding(
    body: Body,
    header: NativePhilHeader<Body> | null,
    indicator: 1,
  ): void;
  writeLinks(body: Body, next: Body | null, previous: Body | null): void;
  writeVelocity?: (body: Body, velocity: NativePhilVector) => void;
  writeLocalOmega?: (body: Body, omega: NativePhilVector) => void;
  writePassiveMatrix?: (body: Body, nativeMatrix: readonly number[]) => void;
  /** PrepareObject4b9510 is immediate for adds during actual physics. */
  prepareObject?: (body: Body, registry: NativePhilRegistry<Body>) => void;
  /** PHIL activation's4ff2c0 invalidate/update outlet; no ec or V reset. */
  onActivated?: (body: Body) => void;
}
export interface NativePhilContext {
  /** Source65bb74: zero-return without ownership is not normal success. */
  disabled?: boolean;
  /** Source748788, distinct from doingPhysics748798. */
  munging?: boolean;
  doingPhysics?: boolean;
  /** Source690a74. Immediate add wrappers establish this themselves. */
  immediateOverride?: boolean;
}
export class NativePhilProviderRequired extends Error {
  readonly providers: readonly string[];
  constructor(providers: readonly string[]) {
    super(`Native PHIL provider required: ${providers.join(", ")}`);
    this.name = "NativePhilProviderRequired";
    this.providers = [...providers];
  }
}
interface Links<Body> {
  next: Body | null;
  previous: Body | null;
}
const f = Math.fround;
function uint(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new RangeError("Invalid native PHIL flags");
  return value >>> 0;
}
function vector(value: NativePhilVector): NativePhilVector {
  if (value.length !== 3) throw new RangeError("Invalid PHIL vector");
  const result = value.map(f);
  if (result.some((n) => !Number.isFinite(n)))
    throw new RangeError("Non-finite native PHIL vector");
  return [result[0], result[1], result[2]];
}
function matrix(value: ArrayLike<number>): readonly number[] {
  if (value.length !== 12)
    throw new RangeError("PHIL requires native12 matrix");
  const result = Array.from(value, f);
  if (result.some((n) => !Number.isFinite(n)))
    throw new RangeError("Non-finite native PHIL matrix");
  return result;
}

/** A single registrar for real source roots, not generic collision array rows.
 * Headers are retained slot objects; a vacated header is cleared on next add.
 * The host supplies real object-field writes and the source preparation outlet.
 * No FORM/body allocator, gravity tick, deferred mutation or replay is invented. */
export class NativePhilRegistry<Body extends object> {
  private readonly slots: NativePhilHeader<Body>[] = Array.from(
    { length: NATIVE_PHIL_NORMAL_CAPACITY },
    (_, index) => ({
      index,
      body: null,
      flags: 0,
      state: 1,
      drag: 0,
      gravity: 0,
      levelOut: 0,
    }),
  );
  private readonly bindings = new Map<Body, NativePhilHeader<Body>>();
  private readonly links = new Map<Body, Links<Body>>();
  private head: Body | null = null;
  private context: NativePhilContext = {};
  constructor(private readonly access: NativePhilBodyAccess<Body>) {}

  get count(): number {
    return this.bindings.size;
  }
  get freeCount(): number {
    return NATIVE_PHIL_NORMAL_CAPACITY - this.count;
  }
  get first(): Body | null {
    this.enabled();
    return this.head;
  }
  getHeader(body: Body): NativePhilHeader<Body> | null {
    return this.bindings.get(body) ?? null;
  }
  getState(body: Body): 0 | 1 | 2 {
    this.enabled();
    return this.getHeader(body)?.state ?? 0;
  }
  getNext(body: Body): Body | null {
    this.enabled();
    return this.links.get(body)?.next ?? null;
  }
  getPrevious(body: Body): Body | null {
    this.enabled();
    return this.links.get(body)?.previous ?? null;
  }
  get registeredBodies(): readonly Body[] {
    this.enabled();
    const result: Body[] = [];
    for (let body = this.head; body !== null; body = this.getNext(body)) {
      if (result.length >= this.count)
        throw new Error("Corrupt PHIL root list");
      result.push(body);
    }
    if (result.length !== this.count)
      throw new Error("Incomplete PHIL root list");
    return result;
  }
  setContext(context: NativePhilContext): void {
    for (const value of Object.values(context))
      if (typeof value !== "boolean") throw new Error("Invalid PHIL context");
    this.context = { ...context };
  }
  /** PrepareObject can sort the native root list. The host supplies its actual
   * resulting order; this owner validates identities and synchronizes links,
   * without substituting render/camera coordinates for the source pose. */
  reorderRegisteredBodies(order: readonly Body[]): void {
    this.enabled();
    if (
      order.length !== this.count ||
      new Set(order).size !== this.count ||
      order.some((body) => !this.bindings.has(body))
    )
      throw new Error("PHIL root order must contain each registered body once");
    this.head = order[0] ?? null;
    for (let i = 0; i < order.length; i++)
      this.setLinks(order[i], order[i + 1] ?? null, order[i - 1] ?? null);
  }
  private enabled(): void {
    if (this.context.disabled)
      throw new NativePhilProviderRequired(["disabled/replay ownership"]);
  }
  private normalMutation(immediate: boolean): void {
    this.enabled();
    if (this.context.munging && !this.context.immediateOverride && !immediate)
      throw new NativePhilProviderRequired(["deferred PHIL union mutation"]);
  }
  private immediate<T>(operation: () => T): T {
    this.enabled();
    const munging = !!this.context.munging;
    if (munging) this.context.immediateOverride = true;
    try {
      return operation();
    } finally {
      // 4b6050/4b6080 clear the override, rather than restoring a saved value.
      if (munging) this.context.immediateOverride = false;
    }
  }
  private setLinks(body: Body, next: Body | null, previous: Body | null): void {
    this.links.set(body, { next, previous });
    this.access.writeLinks(body, next, previous);
  }

  /** Generic4b5ae0. Unsupported pending-add never silently consumes a header. */
  add(body: Body): 0 | 1 | 2 {
    return this.addNormal(body, false);
  }
  /** 4b6050 establishes the immediate override during munging. */
  registerImmediate(body: Body): 0 | 1 | 2 {
    return this.immediate(() => this.addNormal(body, true));
  }
  private addNormal(body: Body, immediate: boolean): 0 | 1 | 2 {
    this.normalMutation(immediate);
    if (body === null || typeof body !== "object")
      throw new TypeError("PHIL registration requires body identity");
    let free: NativePhilHeader<Body> | null = null;
    for (const slot of this.slots) {
      if (slot.body === null) {
        free ??= slot;
      } else if (slot.body === body) return 2;
    }
    if (free === null) return 1;
    const flags = uint(this.access.readFlags(body));
    if (this.context.doingPhysics && !this.access.prepareObject)
      throw new NativePhilProviderRequired(["PrepareObject4b9510"]);
    Object.assign(free, {
      body,
      flags: 0,
      state: 1,
      drag: 0,
      gravity: 0,
      levelOut: 0,
    });
    this.bindings.set(body, free);
    this.access.writeBinding(body, free, 1);
    this.access.writeFlags(body, (flags | 0x20) >>> 0);
    if (this.head === null) {
      this.head = body;
      this.setLinks(body, null, null);
    } else {
      const head = this.head,
        next = this.getNext(head);
      this.setLinks(body, next, head);
      this.setLinks(head, body, this.getPrevious(head));
      if (next !== null) this.setLinks(next, this.getNext(next), body);
    }
    if (this.context.doingPhysics) this.access.prepareObject!(body, this);
    return 0;
  }

  /** Generic4b5c40 normal branch. Removed body's links/flags/V/owner remain
   * untouched; the source release owner clears its own FORM/contact fields. */
  remove(body: Body): { code: 0 | 3; phase: "complete" } {
    this.normalMutation(false);
    const header = this.bindings.get(body);
    if (!header) return { code: 3, phase: "complete" };
    const links = this.links.get(body)!;
    header.body = null;
    this.bindings.delete(body);
    this.access.writeBinding(body, null, 1);
    if (this.head === body) {
      this.head = links.next;
      if (links.next !== null)
        this.setLinks(links.next, this.getNext(links.next), null);
    } else {
      // Installed4b5d04 finds the predecessor among normal registered headers.
      const predecessor = this.slots.find(
        (s) => s.body !== null && this.getNext(s.body) === body,
      )?.body;
      if (predecessor) {
        this.setLinks(predecessor, links.next, this.getPrevious(predecessor));
        if (links.next !== null)
          this.setLinks(links.next, this.getNext(links.next), predecessor);
      } else throw new Error("PHIL removed root has no predecessor");
    }
    this.links.delete(body);
    return { code: 0, phase: "complete" };
  }

  /** 4b5de0 changes header state/passive20 only, not body ec or velocity. */
  makePassive(body: Body): 0 | 3 {
    this.enabled();
    const header = this.getHeader(body);
    if (header === null) return 3;
    const flags = uint(this.access.readFlags(body));
    header.state = 1;
    this.access.writeFlags(body, (flags | 0x20) >>> 0);
    return 0;
  }

  /** 4b5e30 normal branch: optional pointers COPY, never clear absent V/omega.
   * BODY omega is passed raw. Header bit2 follows the source final argument. */
  activate(
    body: Body,
    input: {
      velocity?: NativePhilVector;
      localOmega?: NativePhilVector;
      flag2?: boolean;
    } = {},
  ): 0 | 3 {
    this.enabled();
    const header = this.getHeader(body);
    if (header === null) return 3;
    const v = input.velocity ? vector(input.velocity) : null,
      omega = input.localOmega ? vector(input.localOmega) : null,
      flags = uint(this.access.readFlags(body));
    const required: string[] = [];
    if (v && !this.access.writeVelocity) required.push("world velocity writer");
    if (omega && !this.access.writeLocalOmega)
      required.push("BODY omega writer");
    if (!this.access.onActivated) required.push("activation4ff2c0 outlet");
    if (required.length) throw new NativePhilProviderRequired(required);
    header.state = 2;
    this.access.writeFlags(body, (flags & ~0x20) >>> 0);
    header.flags = (header.flags & ~2) | (input.flag2 ? 2 : 0);
    if (v) this.access.writeVelocity!(body, v);
    if (omega) this.access.writeLocalOmega!(body, omega);
    this.access.onActivated!(body);
    return 0;
  }

  /** Passive-only matrix write4b5f40. Matrix is source12, not a Three visual
   * world wrapper; host owns the actual stable ACT field update. */
  setPassiveMatrix(body: Body, value: ArrayLike<number>): 0 | 3 | 4 {
    this.enabled();
    const header = this.getHeader(body);
    if (header === null) return 3;
    if (header.state !== 1) return 4;
    const pose = matrix(value);
    if (!this.access.writePassiveMatrix)
      throw new NativePhilProviderRequired(["passive ACT matrix writer"]);
    this.access.writePassiveMatrix(body, pose);
    return 0;
  }

  /** Generic4b5fb0 and immediate4b6080 share normal add-active ownership.
   * Already registered returns duplicate2 instead of reactivating it. */
  addActive(body: Body): 0 | 1 | 2 | 3 {
    return this.addActiveNormal(body, false);
  }
  addActiveImmediate(body: Body): 0 | 1 | 2 | 3 {
    return this.immediate(() => this.addActiveNormal(body, true));
  }
  private addActiveNormal(body: Body, immediate: boolean): 0 | 1 | 2 | 3 {
    this.normalMutation(immediate);
    // Source always has this callback. Reject a missing host outlet before
    // acquiring a header rather than pretending activation was implemented.
    if (
      !this.bindings.has(body) &&
      this.freeCount > 0 &&
      !this.access.onActivated
    )
      throw new NativePhilProviderRequired(["activation4ff2c0 outlet"]);
    const code = this.addNormal(body, immediate);
    return code === 0 ? this.activate(body) : code;
  }
}
