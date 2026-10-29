const NULL_RESERVED_BYTES = 0x100;
const ALIGNMENT = 16;
const MAX_CAPACITY = 4096;
/** Browser host record span covers the verified fields through +0x25b. It is
 * not a claim about the complete installed executable object size. */
export const NATIVE_PHYSICS_OBJECT_RECORD_BYTES = 0x270;
const WORLD_VELOCITY_OFFSET = 0x68;
const LOCAL_VELOCITY_OFFSET = 0x1a8;
const MASS_OFFSET = 0x04;
const TYPE_BYTE_OFFSET = 0x238;

export interface NativePhysicsObjectUpdate {
  worldVelocity: readonly [number, number, number];
  localVelocity?: readonly [number, number, number];
  mass?: number;
  typeByte?: number;
}

export interface NativePhysicsObjectRecordStats {
  count: number;
  capacity: number;
  recordBytes: number;
  bytes: number;
}

const f = Math.fround;

function integer(
  value: number,
  low: number,
  high: number,
  name: string,
): number {
  if (!Number.isInteger(value) || value < low || value > high)
    throw new RangeError(
      `Native physics object ${name} must be an integer in ${low}..${high}`,
    );
  return value;
}

function vector(
  value: readonly [number, number, number],
  label: string,
): [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((component) => !Number.isFinite(f(component)))
  )
    throw new Error(
      `Native physics object ${label} requires finite Float32 XYZ`,
    );
  return [f(value[0]), f(value[1]), f(value[2])];
}

/** Bounded browser-owned WebAssembly records keyed by live body object identity.
 * Returned addresses are offsets into this actual memory, never actor IDs or
 * captured Windows heap pointers. */
export class NativePhysicsObjectRecords<T extends object = object> {
  readonly capacity: number;
  readonly recordBytes = NATIVE_PHYSICS_OBJECT_RECORD_BYTES;
  private readonly wasmMemory: WebAssembly.Memory;
  private readonly base: number;
  private readonly owners = new Map<T, number>();
  private next = 0;
  private free: number[] = [];
  private disposed = false;

  constructor(capacity = MAX_CAPACITY) {
    this.capacity = integer(capacity, 1, MAX_CAPACITY, "capacity");
    this.base = (NULL_RESERVED_BYTES + ALIGNMENT - 1) & ~(ALIGNMENT - 1);
    const required = this.base + capacity * this.recordBytes,
      pages = Math.ceil(required / 0x10000);
    this.wasmMemory = new WebAssembly.Memory({
      initial: pages,
      maximum: pages,
    });
  }

  private assertLive(): void {
    if (this.disposed)
      throw new Error("Native physics object records have been disposed");
  }

  get memory(): WebAssembly.Memory {
    this.assertLive();
    return this.wasmMemory;
  }

  address(body: T): number {
    this.assertLive();
    if (
      (typeof body !== "object" && typeof body !== "function") ||
      body === null
    )
      throw new TypeError(
        "Native physics object record requires an object body",
      );
    const existing = this.owners.get(body);
    if (existing !== undefined) return existing;
    if (!this.free.length && this.next >= this.capacity)
      throw new Error(
        `Native physics object record capacity exhausted (${this.capacity})`,
      );
    const slot = this.free.pop() ?? this.next++;
    const address = this.base + slot * this.recordBytes;
    new Uint8Array(this.wasmMemory.buffer, address, this.recordBytes).fill(0);
    this.owners.set(body, address);
    return address;
  }

  /** PHIL retirement ends this borrowed record's lifetime. Recycle only that
   * slot; addresses of still registered objects remain stable. */
  release(body: T): boolean {
    this.assertLive();
    const address = this.owners.get(body);
    if (address === undefined) return false;
    new Uint8Array(this.wasmMemory.buffer, address, this.recordBytes).fill(0);
    this.owners.delete(body);
    this.free.push((address - this.base) / this.recordBytes);
    return true;
  }

  /** Update only source fields with verified offsets. Validation completes
   * before first allocation or write, so rejected updates are atomic. */
  update(body: T, update: NativePhysicsObjectUpdate): void {
    this.assertLive();
    const world = vector(update.worldVelocity, "world velocity"),
      local = update.localVelocity
        ? vector(update.localVelocity, "solver-local velocity")
        : null,
      mass =
        update.mass === undefined
          ? undefined
          : Number.isFinite(f(update.mass)) && f(update.mass) >= 0
            ? f(update.mass)
            : (() => {
                throw new Error(
                  "Native physics object mass must be finite nonnegative Float32",
                );
              })(),
      typeByte =
        update.typeByte === undefined
          ? undefined
          : integer(update.typeByte, 0, 255, "type byte");
    const address = this.address(body),
      view = new DataView(this.wasmMemory.buffer, address, this.recordBytes);
    world.forEach((value, axis) =>
      view.setFloat32(WORLD_VELOCITY_OFFSET + axis * 4, value, true),
    );
    local?.forEach((value, axis) =>
      view.setFloat32(LOCAL_VELOCITY_OFFSET + axis * 4, value, true),
    );
    if (mass !== undefined) view.setFloat32(MASS_OFFSET, mass, true);
    if (typeByte !== undefined) view.setUint8(TYPE_BYTE_OFFSET, typeByte);
  }

  /** A direct view into the real bounded backing memory; requesting it for an
   * unseen body performs the same first-request allocation as address(). */
  readView(body: T): DataView {
    const address = this.address(body);
    return new DataView(this.wasmMemory.buffer, address, this.recordBytes);
  }

  get stats(): NativePhysicsObjectRecordStats {
    this.assertLive();
    return {
      count: this.owners.size,
      capacity: this.capacity,
      recordBytes: this.recordBytes,
      bytes: this.capacity * this.recordBytes,
    };
  }

  clear(): void {
    this.assertLive();
    new Uint8Array(this.wasmMemory.buffer).fill(0);
    this.owners.clear();
    this.next = 0;
    this.free.length = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    new Uint8Array(this.wasmMemory.buffer).fill(0);
    this.owners.clear();
    this.next = 0;
    this.free.length = 0;
    this.disposed = true;
  }
}
