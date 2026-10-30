import { Box3, Matrix4, Vector3 } from "three";

export interface NativeWorldFaceState {
  start: number;
  end: number;
  reference: number;
  bounds: Box3;
  inverse: Matrix4;
}
export interface NativeWorldFaceQuery {
  bounds: Box3;
  matrix: Matrix4;
}
export interface NativeWorldFaceInput {
  /** Physics bb2; bb1 extended downward by the suspension setter. */
  bounds: Box3;
  /** Live actor transform; candidate pose during collision, committed at forces. */
  matrix: Matrix4;
  /** Physics +8c, retained committed pose throughout a trial collision. */
  committedMatrix: Matrix4;
  flags?: number;
  parent?: NativeWorldFaceState;
  worldBounds?: Box3;
  velocity?: Vector3;
}

const f32 = Math.fround;
function floatBox(box: Box3): Box3 {
  for (const vector of [box.min, box.max])
    vector.set(f32(vector.x), f32(vector.y), f32(vector.z));
  return box;
}
function floatMatrix(matrix: Matrix4): Matrix4 {
  for (let i = 0; i < 16; i++) matrix.elements[i] = f32(matrix.elements[i]);
  return matrix;
}
function transformBounds(bounds: Box3, matrix: Matrix4): Box3 {
  // FillInBoundsTransform stores its six results as br_scalar/Float32.
  return floatBox(bounds.clone().applyMatrix4(matrix));
}
function strictlyInside(inner: Box3, outer: Box3): boolean {
  return (
    inner.min.x > outer.min.x &&
    inner.min.y > outer.min.y &&
    inner.min.z > outer.min.z &&
    inner.max.x < outer.max.x &&
    inner.max.y < outer.max.y &&
    inner.max.z < outer.max.z
  );
}
export function nativeWheelExtendedBounds(
  shapeBounds: Box3,
  wheelPositions: readonly Vector3[],
  suspensionLength: readonly number[],
): Box3 {
  const bounds = shapeBounds.clone();
  // Installed SetCarSuspGiveAndHeight 41fd96..41fe5f. Native wpos and
  // suspension heights are metres; physics bounds use model units.
  const scale = f32(1 / 6.9);
  bounds.min.y = Math.min(
    bounds.min.y,
    f32((f32(wheelPositions[0].y) - f32(suspensionLength[0])) * scale),
    f32((f32(wheelPositions[2].y) - f32(suspensionLength[1])) * scale),
  );
  return bounds;
}

/** Installed GetFacesNearObject 4c1e10..4c234d. One shared 300-face ring,
 * persistent across ticks/frames. Collection owns finite ModelPickBox tests
 * and ACT callbacks; callbacks can therefore run twice on a ring wrap.
 * The flags are raw source flags, not inferred gameplay classifications. */
export class NativeWorldFaceCache<Face> {
  readonly capacity = 300;
  count = 0;
  epoch = 1;
  private readonly faces: Face[] = [];
  createState(): NativeWorldFaceState {
    return {
      start: 0,
      end: 0,
      reference: (this.epoch - 2) & 0xffff,
      bounds: new Box3(),
      inverse: new Matrix4(),
    };
  }
  invalidate(state: NativeWorldFaceState): void {
    state.reference = (this.epoch - 2) & 0xffff;
  }
  valid(state: NativeWorldFaceState): boolean {
    return (
      state.reference === this.epoch ||
      (state.reference === this.epoch - 1 && state.start > this.count)
    );
  }
  read(state: NativeWorldFaceState): Face[] {
    return this.valid(state) ? this.faces.slice(state.start, state.end) : [];
  }
  /** Installed settling41803a..418051 dereferences the shared slot at start
   * without checking the owner's end or epoch. NULL means a valid slot's known
   * initial zero-filled record, never a missing provider. Written slots retain
   * their current record across owner invalidation, empty ranges and ring wraps.
   * Read at callback time: another collection can overwrite the slot meanwhile. */
  rawSlot(index: number): Face | null {
    if (!Number.isInteger(index) || index < 0 || index >= this.capacity)
      throw new RangeError("Native world face raw slot outside capacity");
    return this.faces[index] ?? null;
  }
  get(
    state: NativeWorldFaceState,
    input: NativeWorldFaceInput,
    collect: (
      query: NativeWorldFaceQuery,
      maximum: number,
      gatherModels: boolean,
    ) => readonly Face[],
  ): Face[] {
    const flags = input.flags ?? 0;
    if (flags & 0x40) {
      state.start = state.end;
      return [];
    }
    if (flags & 2 && input.parent) {
      state.start = input.parent.start;
      state.end = input.parent.end;
      state.reference = input.parent.reference;
      return this.read(state);
    }
    let query: NativeWorldFaceQuery;
    if (flags & 1) {
      if (!input.worldBounds || !input.velocity)
        throw new Error(
          "Native world-space face cache requires bounds and raw velocity",
        );
      if (this.valid(state) && strictlyInside(input.worldBounds, state.bounds))
        return this.read(state);
      const bounds = input.worldBounds.clone();
      for (let axis = 0; axis < 3; axis++) {
        const displacement = f32(input.velocity.getComponent(axis) * f32(0.12));
        bounds.min.setComponent(
          axis,
          f32(
            f32(bounds.min.getComponent(axis) - 0.15) +
              Math.min(0, displacement),
          ),
        );
        bounds.max.setComponent(
          axis,
          f32(bounds.max.getComponent(axis) + 0.15 + Math.max(0, displacement)),
        );
      }
      // 4c1fbe subtracts -.005 from MIN; 4c1fc6 subtracts +.005
      // from MAX. Cache is inset, collection retains the larger query box.
      state.bounds.copy(floatBox(bounds.clone().expandByScalar(-0.005)));
      query = { bounds, matrix: new Matrix4() };
    } else {
      // BRender uses row vectors. Three uses column vectors, so the source
      // O*inverse(A) and A*savedInverse products have reversed operands here.
      const relativeToCache = floatMatrix(
        state.inverse.clone().multiply(input.matrix),
      );
      if (
        this.valid(state) &&
        strictlyInside(
          transformBounds(input.bounds, relativeToCache),
          state.bounds,
        )
      )
        return this.read(state);
      const inverse = floatMatrix(input.matrix.clone().invert());
      const delta = floatMatrix(
        inverse.clone().multiply(input.committedMatrix),
      );
      const bounds = transformBounds(input.bounds, delta).union(input.bounds);
      floatBox(bounds.expandByScalar(f32(0.0025)));
      const squared = floatMatrix(delta.clone().multiply(delta));
      const cubed = floatMatrix(delta.clone().multiply(squared));
      bounds.union(transformBounds(input.bounds, floatMatrix(cubed.invert())));
      floatBox(bounds.expandByScalar(f32(0.02)));
      state.bounds.copy(bounds);
      state.inverse.copy(inverse);
      query = { bounds, matrix: input.matrix.clone() };
    }
    state.start = this.count & 0xffff;
    const gatherModels = !(flags & 0x80);
    const append = (maximum: number, offset: number) => {
      const collected = collect(query, maximum, gatherModels).slice(0, maximum);
      for (let i = 0; i < collected.length; i++)
        this.faces[offset + i] = collected[i];
      return collected.length;
    };
    this.count += append(this.capacity - this.count, this.count);
    if (this.count >= this.capacity) {
      state.start = 0;
      this.count = append(this.capacity, 0);
      this.epoch = (this.epoch + 1) | 0;
    }
    state.end = this.count & 0xffff;
    state.reference = this.epoch & 0xffff;
    if (flags & 0x80) state.end = state.start;
    return this.read(state);
  }
}
