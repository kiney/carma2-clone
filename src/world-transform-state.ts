import { Matrix4, Object3D } from "three";

export interface WorldTransformDiagnostics {
  resolved: number;
  cacheHits: number;
  localChecks: number;
  compositions: number;
  multiplications: number;
  nativeUpdates: number;
}

export interface WorldTransformResolution {
  /** Retained independently of presentation updates to object.matrixWorld. */
  matrix: Matrix4;
  revision: number;
  ordinary: boolean;
}

interface TransformRecord extends WorldTransformResolution {
  local: Matrix4;
  values: number[];
  auto: boolean;
  worldAuto: boolean;
  parent: Object3D | null;
  parentRevision: number;
}

const native = Object3D.prototype;
export function ordinaryTransformMethods(object: Object3D): boolean {
  return (
    object.updateMatrix === native.updateMatrix &&
    object.updateWorldMatrix === native.updateWorldMatrix &&
    object.updateMatrixWorld === native.updateMatrixWorld
  );
}

export function worldLocalValue(object: Object3D, index: number): number {
  if (!object.matrixAutoUpdate) return object.matrix.elements[index];
  switch (index) {
    case 0:
      return object.position.x;
    case 1:
      return object.position.y;
    case 2:
      return object.position.z;
    case 3:
      return object.quaternion.x;
    case 4:
      return object.quaternion.y;
    case 5:
      return object.quaternion.z;
    case 6:
      return object.quaternion.w;
    case 7:
      return object.scale.x;
    case 8:
      return object.scale.y;
    default:
      return object.scale.z;
  }
}

function sameMatrix(a: Matrix4, b: Matrix4): boolean {
  for (let index = 0; index < 16; index++)
    if (!Object.is(a.elements[index], b.elements[index])) return false;
  return true;
}

/** Hot unchanged-owner check; manual matrices retain all 16 exact elements. */
export function sameWorldLocalValues(
  object: Object3D,
  values: readonly number[],
): boolean {
  if (!object.matrixAutoUpdate) {
    for (let i = 0; i < 16; i++)
      if (!Object.is(values[i], object.matrix.elements[i])) return false;
    return true;
  }
  const p = object.position,
    q = object.quaternion,
    s = object.scale;
  return (
    Object.is(values[0], p.x) &&
    Object.is(values[1], p.y) &&
    Object.is(values[2], p.z) &&
    Object.is(values[3], q.x) &&
    Object.is(values[4], q.y) &&
    Object.is(values[5], q.z) &&
    Object.is(values[6], q.w) &&
    Object.is(values[7], s.x) &&
    Object.is(values[8], s.y) &&
    Object.is(values[9], s.z)
  );
}

/** Exact transform ownership for immutable collision synchronization phases.
 * Call invalidatePhase after callbacks or any other live transform mutation.
 * Returned matrices are borrowed; callers must not modify them. */
export class WorldTransformState {
  private records = new WeakMap<Object3D, TransformRecord>();
  private phase = new WeakMap<Object3D, WorldTransformResolution>();
  private ordinaryPhase = new WeakMap<Object3D, boolean>();
  private candidate = new Matrix4();

  beginPhase(): void {
    this.phase = new WeakMap();
    this.ordinaryPhase = new WeakMap();
  }

  invalidatePhase(): void {
    this.beginPhase();
  }

  /** Classify custom update outlets without invoking their side effects. */
  isOrdinary(object: Object3D): boolean {
    const cached = this.ordinaryPhase.get(object);
    if (cached !== undefined) return cached;
    const value =
      ordinaryTransformMethods(object) &&
      (!object.parent || this.isOrdinary(object.parent));
    this.ordinaryPhase.set(object, value);
    return value;
  }

  resolve(
    object: Object3D,
    diagnostics?: WorldTransformDiagnostics,
  ): WorldTransformResolution {
    if (diagnostics) diagnostics.resolved++;
    const cached = this.phase.get(object);
    if (cached) {
      if (diagnostics) diagnostics.cacheHits++;
      return cached;
    }
    const ordinary = this.isOrdinary(object);
    let record = this.records.get(object);
    if (!ordinary) {
      // Classify without updating ancestors: calling an opaque ancestor first
      // would run its potentially stateful override twice during this request.
      if (diagnostics) diagnostics.nativeUpdates++;
      try {
        object.updateWorldMatrix(true, false);
      } finally {
        this.invalidatePhase();
      }
      if (!record) {
        record = this.createRecord(object);
        record.matrix.copy(object.matrixWorld);
      } else if (!sameMatrix(record.matrix, object.matrixWorld)) {
        record.matrix.copy(object.matrixWorld);
        record.revision++;
      } else if (diagnostics) diagnostics.cacheHits++;
      record.ordinary = false;
      // A later return to ordinary methods must rebuild its local signature.
      record.values.length = 0;
      return record;
    }

    const parent = object.parent
      ? this.resolve(object.parent, diagnostics)
      : null;
    if (diagnostics) diagnostics.localChecks++;
    const fresh = !record;
    record ??= this.createRecord(object);
    const count = object.matrixAutoUpdate ? 10 : 16;
    let localChanged =
      record.auto !== object.matrixAutoUpdate || record.values.length !== count;
    if (!localChanged)
      for (let index = 0; index < count; index++)
        if (!Object.is(record.values[index], worldLocalValue(object, index))) {
          localChanged = true;
          break;
        }
    if (localChanged) {
      record.values.length = count;
      for (let index = 0; index < count; index++)
        record.values[index] = worldLocalValue(object, index);
      if (object.matrixAutoUpdate) {
        record.local.compose(object.position, object.quaternion, object.scale);
        if (diagnostics) diagnostics.compositions++;
      } else record.local.copy(object.matrix);
    }
    const changed =
      fresh ||
      localChanged ||
      !record.ordinary ||
      record.worldAuto !== object.matrixWorldAutoUpdate ||
      record.parent !== object.parent ||
      record.parentRevision !== (parent?.revision ?? 0);
    if (!object.matrixWorldAutoUpdate) {
      // updateWorldMatrix deliberately leaves this authoritative matrix alone,
      // even when the local pose or an ancestor has changed.
      this.candidate.copy(object.matrixWorld);
    } else if (changed) {
      if (parent) {
        this.candidate.multiplyMatrices(parent.matrix, record.local);
        if (diagnostics) diagnostics.multiplications++;
      } else this.candidate.copy(record.local);
    }
    if (!object.matrixWorldAutoUpdate || changed) {
      if (fresh || !sameMatrix(record.matrix, this.candidate)) {
        record.matrix.copy(this.candidate);
        if (!fresh) record.revision++;
      } else if (diagnostics) diagnostics.cacheHits++;
    } else if (diagnostics) diagnostics.cacheHits++;
    record.auto = object.matrixAutoUpdate;
    record.worldAuto = object.matrixWorldAutoUpdate;
    record.parent = object.parent;
    record.parentRevision = parent?.revision ?? 0;
    record.ordinary = true;
    this.phase.set(object, record);
    return record;
  }

  private createRecord(object: Object3D): TransformRecord {
    const record: TransformRecord = {
      matrix: new Matrix4(),
      revision: 1,
      ordinary: false,
      local: new Matrix4(),
      values: [],
      auto: object.matrixAutoUpdate,
      worldAuto: object.matrixWorldAutoUpdate,
      parent: null,
      parentRevision: 0,
    };
    this.records.set(object, record);
    return record;
  }
}
