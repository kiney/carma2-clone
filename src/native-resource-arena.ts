/** BRender resource wrapper with an explicit browser-owned allocator policy.
 * Header/list layout is installed 526d00/526e30/529090/529100. Heap block
 * selection is host first-fit/coalescing, not Windows HeapAlloc emulation. */
export class NativeResourceArenaError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`Native resource arena: ${message}`);
    this.name = "NativeResourceArenaError";
  }
}

export interface NativeResourceHandle {
  readonly id: number;
  readonly generation: number;
  readonly address: number;
  readonly classId: number;
  readonly size: number;
}
export interface NativeResourceFreeEvent {
  readonly handle: NativeResourceHandle;
  readonly classId: number;
  /** Native header stores rounded header+payload size, excluding alignment pad. */
  readonly roundedSize: number;
  readonly payload: Uint8Array;
  /** Copied header after the native FREE marker, for lifecycle diagnostics. */
  readonly header: Uint8Array;
}
export interface NativeResourceClass {
  /** Installed nonpositive class alignment means four. Positive must be 2^n. */
  alignment: number;
  free: ((event: NativeResourceFreeEvent) => void) | null;
}
export type NativeResourceClassResult =
  | { resolved: true; value: NativeResourceClass }
  | { resolved: false; requiredProvider: string };
export interface NativeResourceArenaOptions {
  initialCapacity?: number;
  maxCapacity?: number;
  classProvider?: (classId: number) => NativeResourceClassResult;
}
export interface NativeResourceRequest {
  size: number;
  classId: number;
  parent?: NativeResourceHandle | null;
  /** Opaque native record bytes; unspecified payload bytes are zero initialized. */
  payload?: Uint8Array;
}
export type NativeMaterialAddress =
  | { resolved: true; address: number; handle: NativeResourceHandle | null }
  | { resolved: false; requiredProvider: string };
export type NativeHostMaterialOrder =
  | {
      kind: "host-resource-addresses";
      keys: readonly number[];
      evidence: string;
    }
  | { kind: "unresolved"; reason: string };

interface Resource {
  handle: NativeResourceHandle;
  start: number;
  allocationSize: number;
  roundedSize: number;
  descriptor: NativeResourceClass;
  parent: Resource | null;
  children: Resource[];
  state: "live" | "freeing" | "freed";
  borrows: number;
}
interface Region {
  start: number;
  size: number;
}
function fail(code: string, message: string): never {
  throw new NativeResourceArenaError(code, message);
}
function uint(value: number, max: number, label: string) {
  if (!Number.isInteger(value) || value < 0 || value > max)
    fail("bounds", `${label} must be an integer in 0..${max}`);
  return value;
}
function align(value: number, alignment: number) {
  return Math.ceil(value / alignment) * alignment;
}

export class NativeResourceArena {
  #bytes: Uint8Array;
  #view: DataView;
  #free: Region[];
  #resources = new WeakMap<NativeResourceHandle, Resource>();
  #live = new Set<Resource>();
  #generations = new Map<number, number>();
  #materials = new WeakMap<object, NativeResourceHandle>();
  #materialIdentities = new WeakMap<NativeResourceHandle, object>();
  #nextId = 1;
  #releaseDepth = 0;
  readonly maxCapacity: number;
  readonly classProvider?: NativeResourceArenaOptions["classProvider"];

  constructor(options: NativeResourceArenaOptions = {}) {
    this.maxCapacity = uint(
      options.maxCapacity ?? 64 * 1024 * 1024,
      0xfffffffc,
      "maximum capacity",
    );
    const initial = uint(
      options.initialCapacity ?? Math.min(4096, this.maxCapacity),
      this.maxCapacity,
      "initial capacity",
    );
    if (initial < 4 || initial % 4 || this.maxCapacity % 4)
      fail(
        "alignment",
        "capacity must be a positive multiple of four, at least four",
      );
    try {
      this.#bytes = new Uint8Array(initial);
    } catch {
      fail("capacity", "host initial backing allocation failed");
    }
    this.#view = new DataView(this.#bytes.buffer);
    // Reserve four bytes so native NULL address zero can never be a resource.
    this.#free = [{ start: 4, size: initial - 4 }];
    this.classProvider = options.classProvider;
  }
  get capacity() {
    return this.#bytes.length;
  }
  get liveCount() {
    return this.#live.size;
  }
  get allocatedBytes() {
    return [...this.#live].reduce((sum, r) => sum + r.allocationSize, 0);
  }
  #mutation() {
    if (this.#releaseDepth)
      fail("release-reentrancy", "release callbacks cannot mutate the arena");
  }
  #checked(handle: NativeResourceHandle): Resource {
    const r = this.#resources.get(handle);
    if (
      !r ||
      r.state !== "live" ||
      this.#generations.get(r.start) !== handle.generation
    )
      fail(
        "stale-handle",
        "resource handle is foreign, freed or being released",
      );
    return r;
  }
  isLive(handle: NativeResourceHandle) {
    const r = this.#resources.get(handle);
    return (
      !!r &&
      r.state === "live" &&
      this.#generations.get(r.start) === handle.generation
    );
  }
  #class(classId: number) {
    uint(classId, 255, "resource class");
    if (classId === 127)
      fail("resource-class", "class 127 is the native FREE marker");
    const result =
      this.classProvider?.(classId) ??
      (classId === 8
        ? { resolved: true as const, value: { alignment: 0, free: null } }
        : {
            resolved: false as const,
            requiredProvider: `resource class ${classId} alignment/free callback`,
          });
    if (!result || typeof result.resolved !== "boolean")
      fail("provider-required", "explicit resource class result required");
    if (!result.resolved) {
      if (!result.requiredProvider?.trim())
        fail("provider-required", "resource class provider reason required");
      fail("provider-required", result.requiredProvider);
    }
    const descriptor = result.value;
    if (
      !descriptor ||
      !Number.isInteger(descriptor.alignment) ||
      descriptor.alignment < -0x80000000 ||
      descriptor.alignment > 0x40000000
    )
      fail("alignment", "signed resource-class alignment required");
    const alignment = descriptor.alignment <= 0 ? 4 : descriptor.alignment;
    if ((alignment & (alignment - 1)) !== 0)
      fail(
        "alignment",
        "positive resource-class alignment must be a power of two",
      );
    if (descriptor.free !== null && typeof descriptor.free !== "function")
      fail(
        "provider-required",
        "explicit resource free callback or NULL required",
      );
    return { descriptor: { ...descriptor }, alignment };
  }
  #coalesce() {
    this.#free.sort((a, b) => a.start - b.start);
    const merged: Region[] = [];
    for (const r of this.#free) {
      if (!r.size) continue;
      const last = merged.at(-1);
      if (last && last.start + last.size === r.start) last.size += r.size;
      else merged.push({ ...r });
    }
    this.#free = merged;
  }
  #block(size: number) {
    for (;;) {
      const i = this.#free.findIndex((r) => r.size >= size);
      if (i >= 0) {
        const region = this.#free[i],
          start = region.start;
        region.start += size;
        region.size -= size;
        if (!region.size) this.#free.splice(i, 1);
        return start;
      }
      const old = this.capacity;
      if (old === this.maxCapacity)
        fail(
          "capacity",
          "arena capacity exhausted; existing resources retained",
        );
      const tail = this.#free.at(-1);
      const available = tail && tail.start + tail.size === old ? tail.size : 0;
      const required = old + size - available;
      if (required > this.maxCapacity)
        fail(
          "capacity",
          "allocation exceeds arena capacity; existing resources retained",
        );
      const next = Math.min(this.maxCapacity, Math.max(required, old * 2));
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(next);
      } catch {
        fail(
          "capacity",
          "host backing allocation failed; existing resources retained",
        );
      }
      bytes.set(this.#bytes);
      this.#bytes = bytes;
      this.#view = new DataView(bytes.buffer);
      this.#free.push({ start: old, size: next - old });
      this.#coalesce();
    }
  }
  #u32(address: number, value: number) {
    this.#view.setUint32(address, value, true);
  }
  #links(parent: Resource) {
    this.#u32(parent.start + 8, parent.children[0]?.start ?? 0);
    for (let i = 0; i < parent.children.length; i++) {
      const child = parent.children[i];
      this.#u32(child.start, parent.children[i + 1]?.start ?? 0);
      // prev is the address of the preceding NEXT field, not a preceding node.
      this.#u32(
        child.start + 4,
        i === 0 ? parent.start + 8 : parent.children[i - 1].start,
      );
    }
  }
  allocate(request: NativeResourceRequest): NativeResourceHandle {
    this.#mutation();
    uint(request.size, 0x3ffffe4, "payload size");
    const parent =
      request.parent == null ? null : this.#checked(request.parent);
    const { descriptor, alignment } = this.#class(request.classId);
    if (
      request.payload !== undefined &&
      (!(request.payload instanceof Uint8Array) ||
        request.payload.length > request.size)
    )
      fail("bounds", "opaque payload bytes exceed requested size");
    const roundedSize = align(request.size + 24, 4);
    // Header carries three size bytes in four-byte units, so reject truncation.
    if (roundedSize > 0x3fffffc)
      fail("bounds", "resource size exceeds native 24-bit size field");
    // Native ~(allocatorAlign-1) & (classAlign-1), allocatorAlign is four.
    const pad = Math.max(0, alignment - 4),
      allocationSize = roundedSize + pad;
    if (allocationSize > this.maxCapacity - 4)
      fail("capacity", "resource allocation exceeds arena maximum");
    if (!Number.isSafeInteger(this.#nextId))
      fail("handle-overflow", "resource handle sequence exhausted");
    const start = this.#block(allocationSize),
      address = align(start + 24, alignment);
    const generation = (this.#generations.get(start) ?? 0) + 1;
    if (!Number.isSafeInteger(generation))
      fail("handle-overflow", "resource generation exhausted");
    this.#generations.set(start, generation);
    this.#bytes.fill(0, start, start + allocationSize);
    this.#bytes[start + 12] = roundedSize >>> 2;
    this.#bytes[start + 13] = roundedSize >>> 10;
    this.#bytes[start + 14] = roundedSize >>> 18;
    this.#bytes[start + 15] = request.classId;
    this.#u32(start + 16, start);
    this.#u32(start + 20, 0xdeadbeef);
    const handle = Object.freeze({
      id: this.#nextId++,
      generation,
      address,
      classId: request.classId,
      size: request.size,
    });
    const r: Resource = {
      handle,
      start,
      allocationSize,
      roundedSize,
      descriptor,
      parent,
      children: [],
      state: "live",
      borrows: 0,
    };
    this.#resources.set(handle, r);
    this.#live.add(r);
    if (parent) {
      parent.children.unshift(r);
      this.#links(parent);
    }
    if (request.payload) this.#bytes.set(request.payload, address);
    return handle;
  }
  #range(handle: NativeResourceHandle, offset: number, length: number) {
    const r = this.#checked(handle);
    uint(offset, handle.size, "payload offset");
    uint(length, handle.size - offset, "payload length");
    return r;
  }
  read(
    handle: NativeResourceHandle,
    offset = 0,
    length = handle.size - offset,
  ) {
    this.#range(handle, offset, length);
    return this.#bytes.slice(
      handle.address + offset,
      handle.address + offset + length,
    );
  }
  write(handle: NativeResourceHandle, offset: number, bytes: Uint8Array) {
    this.#mutation();
    if (!(bytes instanceof Uint8Array))
      fail("bounds", "Uint8Array payload required");
    this.#range(handle, offset, bytes.length);
    this.#bytes.set(bytes, handle.address + offset);
  }
  /** Full allocation snapshot is copied; callers never retain a backing view. */
  snapshot(handle: NativeResourceHandle) {
    const r = this.#checked(handle);
    return {
      start: r.start,
      address: handle.address,
      roundedSize: r.roundedSize,
      allocationSize: r.allocationSize,
      bytes: this.#bytes.slice(r.start, r.start + r.allocationSize),
    };
  }
  children(handle: NativeResourceHandle) {
    return this.#checked(handle).children.map((r) => r.handle);
  }
  parent(handle: NativeResourceHandle) {
    return this.#checked(handle).parent?.handle ?? null;
  }
  reparent(
    handle: NativeResourceHandle,
    parentHandle: NativeResourceHandle | null,
  ) {
    this.#mutation();
    const r = this.#checked(handle),
      parent = parentHandle === null ? null : this.#checked(parentHandle);
    for (let p = parent; p; p = p.parent)
      if (p === r)
        fail("resource-cycle", "resource parent would create a cycle");
    if (r.parent) {
      r.parent.children.splice(r.parent.children.indexOf(r), 1);
      this.#links(r.parent);
    }
    r.parent = parent;
    this.#u32(r.start, 0);
    this.#u32(r.start + 4, 0);
    if (parent) {
      parent.children.unshift(r);
      this.#links(parent);
    }
  }
  /** Borrowed addresses retain resources. No compaction is implemented at all. */
  borrow(handle: NativeResourceHandle) {
    this.#mutation();
    const r = this.#checked(handle);
    r.borrows++;
    let released = false;
    return Object.freeze({
      handle,
      address: handle.address,
      release: () => {
        this.#mutation();
        if (released)
          fail("borrow-release", "resource borrow already released");
        released = true;
        r.borrows--;
      },
    });
  }
  free(handle: NativeResourceHandle, options: { callbacks?: boolean } = {}) {
    this.#mutation();
    const root = this.#checked(handle);
    const preflight = (r: Resource) => {
      if (r.borrows)
        fail("resource-borrowed", "resource tree still has borrowed addresses");
      for (const child of r.children) preflight(child);
    };
    preflight(root);
    const release = (r: Resource, callbacks: boolean) => {
      r.state = "freeing";
      this.#bytes[r.start + 15] = 127;
      if (callbacks && r.descriptor.free) {
        // Native callback receives parent before children; no-callback affects
        // only this requested root, children still receive their own callbacks.
        const returned: unknown = r.descriptor.free({
          handle: r.handle,
          classId: r.handle.classId,
          roundedSize: r.roundedSize,
          header: this.#bytes.slice(r.start, r.start + 24),
          payload: this.#bytes.slice(
            r.handle.address,
            r.handle.address + r.handle.size,
          ),
        });
        if (
          returned !== null &&
          (typeof returned === "object" || typeof returned === "function") &&
          "then" in returned &&
          typeof returned.then === "function"
        )
          fail(
            "release-async",
            "resource release callbacks must be synchronous",
          );
      }
      while (r.children.length) {
        // 526ea7 removes head before recursing: child callback is unlinked,
        // unlike directly freeing an attached child whose callback comes first.
        const child = r.children.shift()!;
        this.#links(r);
        child.parent = null;
        this.#u32(child.start, 0);
        this.#u32(child.start + 4, 0);
        release(child, true);
      }
      if (r.parent) {
        const parent = r.parent;
        parent.children.splice(parent.children.indexOf(r), 1);
        this.#links(parent);
        r.parent = null;
      }
      this.#u32(r.start, 0);
      this.#u32(r.start + 4, 0);
      this.#u32(r.start + 16, 0);
      this.#u32(r.start + 20, 1);
      r.state = "freed";
      this.#live.delete(r);
      this.#free.push({ start: r.start, size: r.allocationSize });
    };
    this.#releaseDepth++;
    try {
      release(root, options.callbacks !== false);
    } finally {
      this.#releaseDepth--;
      this.#coalesce();
    }
  }
  bindMaterial(identity: object, handle: NativeResourceHandle) {
    this.#mutation();
    if (!identity || typeof identity !== "object")
      fail("material-identity", "actual material object identity required");
    const r = this.#checked(handle);
    if (r.handle.classId !== 8 || r.handle.size !== 156)
      fail(
        "material-resource",
        "material identity requires native class8 size156 resource",
      );
    const old = this.#materials.get(identity);
    if (old === handle) return handle;
    if (old && this.isLive(old))
      fail(
        "material-duplicate",
        "material identity is already bound to another live resource",
      );
    // Do not revive references belonging to a freed resource episode implicitly.
    if (old)
      fail(
        "material-freed",
        "freed material identity requires explicit unbind before a new episode",
      );
    const other = this.#materialIdentities.get(handle);
    if (other && other !== identity)
      fail(
        "material-duplicate",
        "resource already belongs to another material identity",
      );
    this.#materials.set(identity, handle);
    this.#materialIdentities.set(handle, identity);
    return handle;
  }
  unbindMaterial(identity: object) {
    this.#mutation();
    const handle = this.#materials.get(identity);
    if (handle) this.#materialIdentities.delete(handle);
    this.#materials.delete(identity);
  }
  allocateMaterial(
    identity: object,
    options: Omit<NativeResourceRequest, "classId" | "size"> = {},
  ) {
    if (!identity || typeof identity !== "object")
      fail("material-identity", "actual material object identity required");
    if (this.#materials.has(identity))
      fail(
        "material-duplicate",
        "material identity already has a resource episode",
      );
    const handle = this.allocate({ ...options, size: 156, classId: 8 });
    this.bindMaterial(identity, handle);
    return handle;
  }
  materialAddress(identity: object | null): NativeMaterialAddress {
    if (identity === null) return { resolved: true, address: 0, handle: null };
    if (!identity || typeof identity !== "object")
      fail(
        "material-identity",
        "actual material identity or explicit NULL required",
      );
    const handle = this.#materials.get(identity);
    if (!handle)
      return {
        resolved: false,
        requiredProvider:
          "actual material identity is not allocated in this host arena",
      };
    if (!this.isLive(handle))
      return {
        resolved: false,
        requiredProvider:
          "actual material identity belongs to a freed resource episode",
      };
    return { resolved: true, address: handle.address, handle };
  }
  materialOrder(
    faces: readonly { material: object | null }[],
  ): NativeHostMaterialOrder {
    const keys: number[] = [],
      missing = new Set<string>();
    for (const face of faces) {
      const value = this.materialAddress(face.material);
      if (value.resolved) keys.push(value.address);
      else missing.add(value.requiredProvider);
    }
    if (missing.size)
      return { kind: "unresolved", reason: [...missing].join("; ") };
    return {
      kind: "host-resource-addresses",
      keys,
      evidence:
        "Live byte addresses of owned BRender resources; browser first-fit/coalescing allocator, not captured Windows HeapAlloc order",
    };
  }
}
