/** Browser-owned linear storage for source pedestrian array records. Addresses
 * are live WebAssembly.Memory byte offsets under the documented host allocator
 * policy; they are not Windows heap pointers or captured native addresses. */
export const NATIVE_PED_RECORD_BYTES = 0x54;
export const NATIVE_PED_RECORD_INITIAL_CAPACITY = 2000;
export const NATIVE_PED_RECORD_CLASS = 0xc1;
export const NATIVE_PED_RECORD_MAX_COUNT = 2000;
export const NATIVE_PED_RECORD_MEMORY_PAGES = 6;
const NULL_RESERVED_BYTES = 0x100;
const MEMORY_BYTES = NATIVE_PED_RECORD_MEMORY_PAGES * 0x10000;
const f = Math.fround;

export interface NativePedRecordInitial {
  position: readonly [number, number, number];
  action: number;
  flags?: number;
  objective?: boolean;
}

export interface NativePedRecordUpdate {
  position?: readonly [number, number, number];
  action?: number;
  flags?: number;
  objective?: boolean;
  hitPoints?: number;
  speedFactor?: number;
}

function boundedInteger(
  value: number,
  low: number,
  high: number,
  name: string,
): number {
  if (!Number.isInteger(value) || value < low || value > high)
    throw new Error(
      `Native pedestrian record ${name} must be an integer in ${low}..${high}`,
    );
  return value;
}

function finitePosition(position: readonly number[]): [number, number, number] {
  if (
    position.length !== 3 ||
    position.some((value) => !Number.isFinite(f(value)))
  )
    throw new Error(
      "Native pedestrian record requires a finite Float32 position",
    );
  return [f(position[0]), f(position[1]), f(position[2])];
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

/** Two monotonic allocations mirror MungePedestrians' initial array and
 * 4d331f..3365 exact-count compact copy, without claiming BrMem/Windows heap
 * address parity. Every exposed address is an actual offset into this memory. */
export class NativePedRecordArray {
  readonly classId = NATIVE_PED_RECORD_CLASS;
  readonly initialCapacity = NATIVE_PED_RECORD_INITIAL_CAPACITY;
  readonly maxCount: number;
  private readonly wasmMemory: WebAssembly.Memory;
  private readonly initialBase: number;
  private liveBase: number;
  private liveCount = 0;
  private allocationCursor: number;
  private finished = false;
  private disposed = false;

  constructor(maxCount = NATIVE_PED_RECORD_MAX_COUNT) {
    this.maxCount = boundedInteger(
      maxCount,
      0,
      NATIVE_PED_RECORD_MAX_COUNT,
      "maximum count",
    );
    this.wasmMemory = new WebAssembly.Memory({
      initial: NATIVE_PED_RECORD_MEMORY_PAGES,
      maximum: NATIVE_PED_RECORD_MEMORY_PAGES,
    });
    // This is the browser host's explicit NULL guard/alignment policy, not an
    // emulation of the original process heap's starting address.
    this.initialBase = align4(NULL_RESERVED_BYTES);
    this.liveBase = this.initialBase;
    this.allocationCursor = align4(
      this.initialBase +
        NATIVE_PED_RECORD_INITIAL_CAPACITY * NATIVE_PED_RECORD_BYTES,
    );
    if (
      this.allocationCursor +
        NATIVE_PED_RECORD_MAX_COUNT * NATIVE_PED_RECORD_BYTES >
      MEMORY_BYTES
    )
      throw new Error(
        "Native pedestrian record arena exceeds bounded Wasm memory",
      );
  }

  private assertLive(): void {
    if (this.disposed)
      throw new Error("Native pedestrian record array has been disposed");
  }

  get memory(): WebAssembly.Memory {
    this.assertLive();
    return this.wasmMemory;
  }

  get count(): number {
    this.assertLive();
    return this.liveCount;
  }

  get byteLength(): number {
    this.assertLive();
    return this.liveCount * NATIVE_PED_RECORD_BYTES;
  }

  append(initial: NativePedRecordInitial): number {
    this.assertLive();
    if (this.finished)
      throw new Error(
        "Cannot append after native pedestrian record compaction",
      );
    if (this.liveCount >= this.maxCount)
      throw new Error("Native pedestrian record capacity exhausted");
    const position = finitePosition(initial.position);
    boundedInteger(initial.action, -0x80000000, 0x7fffffff, "action");
    const flags =
      initial.flags === undefined
        ? 0
        : boundedInteger(initial.flags, 0, 0xffff, "flags");
    const address = this.liveBase + this.liveCount * NATIVE_PED_RECORD_BYTES;
    const view = new DataView(
      this.wasmMemory.buffer,
      address,
      NATIVE_PED_RECORD_BYTES,
    );
    view.setInt8(0x04, 100);
    view.setUint16(
      0x08,
      (flags | (initial.objective ? 0x200 : 0)) & 0xffff,
      true,
    );
    view.setInt32(0x10, initial.action, true);
    // +0x14 is the native movement pointer, not a walk-period scalar. The
    // browser keeps it NULL and supplies the character's signed +0x1e period
    // through scanner movement bounds separately. +0x18 exclusion pointer also
    // remains NULL until its real owner is connected.
    position.forEach((value, axis) =>
      view.setFloat32(0x1c + axis * 4, value, true),
    );
    view.setFloat32(0x4c, 1, true);
    // Unknown pointer fields remain the Wasm zero-fill value (NULL).
    const index = this.liveCount++;
    return index;
  }

  /** Update known fields without clearing retained threat/fear timestamps or
   * unknown source pointer fields. */
  update(index: number, fields: NativePedRecordUpdate): void {
    const view = this.recordView(index);
    if (fields.position !== undefined)
      finitePosition(fields.position).forEach((value, axis) =>
        view.setFloat32(0x1c + axis * 4, value, true),
      );
    if (fields.action !== undefined) {
      boundedInteger(fields.action, -0x80000000, 0x7fffffff, "action");
      view.setInt32(0x10, fields.action, true);
    }
    if (fields.flags !== undefined) {
      boundedInteger(fields.flags, 0, 0xffff, "flags");
      const objective = fields.objective ? 0x200 : 0;
      view.setUint16(0x08, (fields.flags | objective) & 0xffff, true);
    } else if (fields.objective !== undefined) {
      const current = view.getUint16(0x08, true);
      view.setUint16(
        0x08,
        fields.objective ? current | 0x200 : current & ~0x200,
        true,
      );
    }
    if (fields.hitPoints !== undefined) {
      boundedInteger(fields.hitPoints, -128, 127, "hit points");
      view.setInt8(0x04, fields.hitPoints);
    }
    if (fields.speedFactor !== undefined) {
      if (!Number.isFinite(f(fields.speedFactor)))
        throw new Error(
          "Native pedestrian record requires finite speed factor",
        );
      view.setFloat32(0x4c, f(fields.speedFactor), true);
    }
  }

  finish(): void {
    this.assertLive();
    if (this.finished) return;
    const byteLength = this.liveCount * NATIVE_PED_RECORD_BYTES;
    const compactBase = this.allocationCursor;
    if (compactBase + byteLength > MEMORY_BYTES)
      throw new Error(
        "Native pedestrian compact record array exceeds bounded Wasm memory",
      );
    new Uint8Array(this.wasmMemory.buffer, compactBase, byteLength).set(
      new Uint8Array(this.wasmMemory.buffer, this.initialBase, byteLength),
    );
    this.liveBase = compactBase;
    this.allocationCursor = compactBase + byteLength;
    this.finished = true;
  }

  address(index: number): number {
    this.recordView(index);
    return this.liveBase + index * NATIVE_PED_RECORD_BYTES;
  }

  record(index: number): Uint8Array {
    const address = this.address(index);
    return new Uint8Array(
      this.wasmMemory.buffer,
      address,
      NATIVE_PED_RECORD_BYTES,
    );
  }

  private recordView(index: number): DataView {
    this.assertLive();
    boundedInteger(index, 0, this.liveCount - 1, "index");
    const address = this.liveBase + index * NATIVE_PED_RECORD_BYTES;
    return new DataView(
      this.wasmMemory.buffer,
      address,
      NATIVE_PED_RECORD_BYTES,
    );
  }

  dispose(): void {
    this.disposed = true;
    this.liveCount = 0;
  }
}
