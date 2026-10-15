/** Independent installed ActorBoxPick traversal. Geometry/resource preparation
 * remains supplied by the host; no renderer traversal or material ordering. */
import {
  enumerateNativeActorChildren,
  resolveNativeActorInheritance,
} from "./native-actor-order";
import type {
  NativeOrderedActor,
  NativeActorValue,
  NativeActorMatrix,
  NativeActorBounds,
  NativeActorInheritance,
} from "./native-actor-order";
export type NativeActorPickVector = readonly [number, number, number];
export interface NativeActorPickQuery {
  matrix: NativeActorMatrix;
  originalBounds: NativeActorBounds;
  realBounds: NativeActorBounds;
  center: NativeActorPickVector;
  radius: number;
}
export interface NativeActorPickEmissionInput {
  actor: NativeOrderedActor;
  model: object;
  material: object | null;
  query: NativeActorPickQuery;
  /** NULL differs from a non-NULL identity matrix. */
  pMat: NativeActorMatrix | null;
  capacity: number;
  outputOffset: number;
}
export type NativeActorPickEmission<Row> =
  | { resolved: true; rows: readonly Row[] }
  | { resolved: false; requiredProvider: string };
export interface NativeActorPickCallbacks {
  /** Known absent callback means native NULL. Non-NULL returned identity prunes. */
  pullActorFromWorld?: (actor: NativeOrderedActor) => NativeActorValue<object>;
  /** Notification after actual transformed emission; its return value does not prune. */
  stopGroovidelic?: (actor: NativeOrderedActor) => void;
}
export interface NativeActorPickProviders<Row> {
  modelBounds: (model: object) => NativeActorValue<NativeActorBounds>;
  emitModel: (
    input: NativeActorPickEmissionInput,
  ) => NativeActorPickEmission<Row>;
}
export interface NativeActorPickInput<Row> {
  actor: NativeOrderedActor;
  query: NativeActorPickQuery;
  inheritedModel: NativeActorValue<object>;
  inheritedMaterial: NativeActorValue<object>;
  pMat: NativeActorMatrix | null;
  capacity: number;
  /** Installed gActorBoxPick_StopGroovidelics: false skips MODEL emission only. */
  emitModels: boolean;
  worldCallbacks: NativeActorValue<NativeActorPickCallbacks>;
  providers: NativeActorPickProviders<Row>;
}
export interface NativeActorPickResult<Row> {
  resolved: boolean;
  requiredProvider?: string;
  rows: Row[];
  remainingCapacity: number;
}
const f = Math.fround;
function scalar(value: number): number {
  if (!Number.isFinite(value))
    throw new Error("native actor pick requires finite Float32 scalars");
  const stored = f(value);
  if (!Number.isFinite(stored))
    throw new Error("native actor pick requires finite Float32 scalars");
  return stored;
}
function mat(value: NativeActorMatrix): number[] {
  if (value.length !== 12)
    throw new Error("native actor pick requires twelve matrix scalars");
  return [
    scalar(value[0]),
    scalar(value[1]),
    scalar(value[2]),
    scalar(value[3]),
    scalar(value[4]),
    scalar(value[5]),
    scalar(value[6]),
    scalar(value[7]),
    scalar(value[8]),
    scalar(value[9]),
    scalar(value[10]),
    scalar(value[11]),
  ];
}
function vec(value: NativeActorPickVector): [number, number, number] {
  if (value.length !== 3)
    throw new Error("native actor pick requires three vector scalars");
  return [scalar(value[0]), scalar(value[1]), scalar(value[2])];
}
function bounds(value: NativeActorBounds): NativeActorBounds {
  const min = vec(value.min),
    max = vec(value.max);
  if (min[0] > max[0] || min[1] > max[1] || min[2] > max[2])
    throw new Error("native actor pick bounds are reversed");
  return { min, max };
}
function binding<T>(value: NativeActorValue<T>): NativeActorValue<T> {
  if (
    !value ||
    typeof value.resolved !== "boolean" ||
    (value.resolved ? value.value === undefined : !value.requiredProvider)
  )
    throw new Error(
      "native actor pick needs an explicit known/NULL/unresolved binding",
    );
  return value;
}
function identityBinding(
  value: NativeActorValue<object>,
): NativeActorValue<object> {
  binding(value);
  if (value.resolved && value.value !== null && typeof value.value !== "object")
    throw new Error(
      "native actor pick MODEL/MAT/pull identity must be an object or NULL",
    );
  return value;
}
/** Installed531c60: different live sum association for individual output cells. */
export function nativeActorPickMultiply(
  a: NativeActorMatrix,
  b: NativeActorMatrix,
): number[] {
  const A = mat(a),
    B = mat(b);
  // Keep each installed sum association, including the translation added last.
  return [
    scalar(A[2] * B[6] + A[1] * B[3] + A[0] * B[0]),
    scalar(A[0] * B[1] + A[1] * B[4] + A[2] * B[7]),
    scalar(A[0] * B[2] + A[1] * B[5] + A[2] * B[8]),
    scalar(A[3] * B[0] + A[4] * B[3] + A[5] * B[6]),
    scalar(A[3] * B[1] + A[5] * B[7] + A[4] * B[4]),
    scalar(A[3] * B[2] + A[4] * B[5] + A[5] * B[8]),
    scalar(A[6] * B[0] + A[8] * B[6] + A[7] * B[3]),
    scalar(A[7] * B[4] + A[6] * B[1] + A[8] * B[7]),
    scalar(A[7] * B[5] + A[6] * B[2] + A[8] * B[8]),
    scalar(A[9] * B[0] + A[10] * B[3] + A[11] * B[6] + B[9]),
    scalar(A[10] * B[4] + A[9] * B[1] + A[11] * B[7] + B[10]),
    scalar(A[9] * B[2] + A[10] * B[5] + A[11] * B[8] + B[11]),
  ];
}
/** Installed5324f0 transposes even a scaled/sheared basis. It is not a general inverse. */
export function nativeActorPickLPInverse(value: NativeActorMatrix): number[] {
  const M = mat(value);
  return [
    M[0],
    M[3],
    M[6],
    M[1],
    M[4],
    M[7],
    M[2],
    M[5],
    M[8],
    scalar(-(M[9] * M[0] + M[11] * M[2] + M[10] * M[1])),
    scalar(-(M[11] * M[5] + M[9] * M[3] + M[10] * M[4])),
    scalar(-(M[11] * M[8] + M[9] * M[6] + M[10] * M[7])),
  ];
}
/** Installed532ae0: live Y+Z+X for X (commutative first pair), Z+Y+X for Y/Z. */
export function nativeActorPickApplyPoint(
  value: NativeActorPickVector,
  transform: NativeActorMatrix,
): [number, number, number] {
  const V = vec(value),
    M = mat(transform);
  return storedPoint(V, M);
}
/** Inputs have just been validated and stored by the public entry point. */
function storedPoint(
  V: NativeActorPickVector,
  M: NativeActorMatrix,
): [number, number, number] {
  return [
    scalar(V[2] * M[6] + V[1] * M[3] + V[0] * M[0] + M[9]),
    scalar(V[2] * M[7] + V[1] * M[4] + V[0] * M[1] + M[10]),
    scalar(V[2] * M[8] + V[1] * M[5] + V[0] * M[2] + M[11]),
  ];
}
/** Installed45fab0: stored min point, stored extents/products, sequential row additions. */
export function nativeActorPickTransformBounds(
  value: NativeActorBounds,
  transform: NativeActorMatrix,
): NativeActorBounds {
  const box = bounds(value),
    M = mat(transform),
    min = storedPoint(box.min, M),
    max = [...min];
  const extent = [
    scalar(box.max[0] - box.min[0]),
    scalar(box.max[1] - box.min[1]),
    scalar(box.max[2] - box.min[2]),
  ];
  for (let column = 0; column < 3; column++)
    for (let row = 0; row < 3; row++) {
      const contribution = scalar(extent[row] * M[row * 3 + column]);
      if (contribution < 0) min[column] = scalar(min[column] + contribution);
      else max[column] = scalar(max[column] + contribution);
    }
  return {
    min: min as [number, number, number],
    max: max as [number, number, number],
  };
}
/** Installed425b00 inclusive overlap; nonfinite components fail, without epsilon. */
export function nativeActorPickBoundsOverlap(
  a: NativeActorBounds,
  b: NativeActorBounds,
): boolean {
  for (let axis = 0; axis < 3; axis++)
    if (a.min[axis] > b.max[axis] || a.max[axis] < b.min[axis]) return false;
  return (
    finiteVector(a.min) &&
    finiteVector(a.max) &&
    finiteVector(b.min) &&
    finiteVector(b.max)
  );
}
function finiteVector(values: readonly number[]): boolean {
  for (let i = 0; i < values.length; i++)
    if (!Number.isFinite(values[i])) return false;
  return true;
}
/** ActorBoxPick's inlined leaf BoundsTransformTest retains a live base sum,
 * unlike the repeatedly stored GetNewBoundingBox output. Tests X, then Z, then Y. */
export function nativeActorPickLeafBoundsTest(
  value: NativeActorBounds,
  target: NativeActorBounds,
  transform: NativeActorMatrix,
): boolean {
  const box = bounds(value),
    other = bounds(target),
    M = mat(transform),
    ex = scalar(box.max[0] - box.min[0]),
    ey = scalar(box.max[1] - box.min[1]),
    ez = scalar(box.max[2] - box.min[2]);
  for (let pass = 0; pass < 3; pass++) {
    const column = pass === 1 ? 2 : pass === 2 ? 1 : 0,
      mx = M[column],
      my = M[3 + column],
      mz = M[6 + column],
      tx = mx * box.min[0],
      ty = my * box.min[1],
      tz = mz * box.min[2];
    const base = (column === 0 ? tx + ty + tz : tx + tz + ty) + M[9 + column];
    const hx = mx > 0 ? mx * ex : 0,
      hy = my > 0 ? my * ey : 0,
      hz = mz > 0 ? mz * ez : 0;
    if (base + hz + hy + hx < other.min[column]) return false;
    const lx = mx < 0 ? mx * ex : 0,
      ly = my < 0 ? my * ey : 0,
      lz = mz < 0 ? mz * ez : 0;
    if (base + lz + ly + lx > other.max[column]) return false;
  }
  return true;
}
function query(value: NativeActorPickQuery): NativeActorPickQuery {
  const radius = scalar(value.radius);
  if (radius < 0)
    throw new Error("native actor pick radius must be nonnegative");
  return {
    matrix: mat(value.matrix),
    originalBounds: bounds(value.originalBounds),
    realBounds: bounds(value.realBounds),
    center: vec(value.center),
    radius,
  };
}
/** Traversal continues after capacity reaches zero. Only emission is capacity-limited;
 * later pull callbacks, bounds gates and metadata dependencies still occur. */
export function pickNativeActorBox<Row>(
  input: NativeActorPickInput<Row>,
): NativeActorPickResult<Row> {
  if (
    !Number.isInteger(input.capacity) ||
    input.capacity < 0 ||
    input.capacity > 0x7fffffff
  )
    throw new Error("invalid native actor pick capacity");
  if (typeof input.emitModels !== "boolean")
    throw new Error("native actor pick model-emission global must be explicit");
  const result: NativeActorPickResult<Row> = {
    resolved: true,
    rows: [],
    remainingCapacity: input.capacity,
  };
  const callbacks = binding(input.worldCallbacks),
    initialQuery = query(input.query),
    initialPMat = input.pMat,
    active = new Set<NativeOrderedActor>();
  if (initialPMat !== null) mat(initialPMat); // Validate without collapsing its borrowed identity.
  const stop = (requiredProvider: string) => {
    result.resolved = false;
    result.requiredProvider = requiredProvider;
    return 1;
  };
  function getModelBounds(model: object): NativeActorBounds | null {
    if (!input.providers?.modelBounds) {
      stop("native-model-bounds-provider");
      return null;
    }
    const supplied = binding(input.providers.modelBounds(model));
    if (!supplied.resolved) {
      stop(supplied.requiredProvider);
      return null;
    }
    if (supplied.value === null) {
      stop("native-model-bounds-provider");
      return null;
    }
    return bounds(supplied.value);
  }
  function visit(
    actor: NativeOrderedActor,
    current: NativeActorPickQuery,
    inherited: NativeActorInheritance,
    pMat: NativeActorMatrix | null,
  ): number {
    if (active.has(actor))
      throw new Error("cycle in native actor pick traversal");
    active.add(actor);
    try {
      const resources = resolveNativeActorInheritance(actor, inherited);
      // These pointer loads precede raw-style pruning, but unresolved unused metadata is harmless.
      if (actor.renderStyle === 1) return 0;
      let localQuery = current,
        localPMat = pMat;
      if (actor.name.startsWith("&")) {
        const model = identityBinding(resources.model);
        if (!model.resolved) return stop(model.requiredProvider);
        if (model.value === null) return 0;
        const actorMatrix = mat(actor.matrix);
        if (actor.firstChild === null) {
          if (actor.type !== 1) return 0;
          const modelBox = getModelBounds(model.value);
          if (!result.resolved) return 1;
          if (
            !nativeActorPickLeafBoundsTest(
              modelBox!,
              current.realBounds,
              actorMatrix,
            )
          )
            return 0;
        }
        // Preserve the actual local matrix object when native pMat was NULL.
        localPMat =
          pMat === null
            ? actor.matrix
            : nativeActorPickMultiply(actorMatrix, pMat);
        const inverse = nativeActorPickLPInverse(actorMatrix),
          rebased = nativeActorPickMultiply(current.matrix, inverse);
        localQuery = {
          matrix: rebased,
          originalBounds: current.originalBounds,
          center: nativeActorPickApplyPoint(current.center, inverse),
          radius: current.radius,
          realBounds: nativeActorPickTransformBounds(
            current.originalBounds,
            rebased,
          ),
        };
        if (
          actor.name.length > 1 &&
          actor.name[1] >= "0" &&
          actor.name[1] <= "9"
        ) {
          const modelBox = getModelBounds(model.value);
          if (!result.resolved) return 1;
          if (!nativeActorPickBoundsOverlap(localQuery.realBounds, modelBox!))
            return 0;
          const own = identityBinding(actor.localModel);
          if (!own.resolved) return stop(own.requiredProvider);
          if (own.value === null)
            return stop("native-digit-actor-own-model-provider");
          const ownBox = getModelBounds(own.value);
          if (!result.resolved) return 1;
          const actorToBox = nativeActorPickMultiply(
            actorMatrix,
            nativeActorPickLPInverse(current.matrix),
          );
          if (
            !nativeActorPickBoundsOverlap(
              nativeActorPickTransformBounds(ownBox!, actorToBox),
              current.originalBounds,
            )
          )
            return 0;
          if (!callbacks.resolved) return stop(callbacks.requiredProvider);
          if (callbacks.value?.pullActorFromWorld) {
            const pulled = identityBinding(
              callbacks.value.pullActorFromWorld(actor),
            );
            if (!pulled.resolved) return stop(pulled.requiredProvider);
            if (pulled.value !== null) return 0;
          }
        }
      }
      if (actor.type === 1) {
        const model = identityBinding(resources.model);
        if (!model.resolved) return stop(model.requiredProvider);
        if (model.value === null) return 0;
        if (input.emitModels) {
          const modelBox = getModelBounds(model.value);
          if (!result.resolved) return 1;
          if (nativeActorPickBoundsOverlap(localQuery.realBounds, modelBox!)) {
            const material = identityBinding(resources.material);
            if (!material.resolved) return stop(material.requiredProvider);
            if (!input.providers?.emitModel)
              return stop("native-model-pick-emission-provider");
            const emitted = input.providers.emitModel({
              actor,
              model: model.value,
              material: material.value,
              query: localQuery,
              pMat: localPMat,
              capacity: result.remainingCapacity,
              outputOffset: result.rows.length,
            });
            if (!emitted.resolved) return stop(emitted.requiredProvider);
            if (
              !Array.isArray(emitted.rows) ||
              emitted.rows.length > result.remainingCapacity
            )
              throw new Error(
                "native model emission exceeds remaining capacity",
              );
            for (const row of emitted.rows) result.rows.push(row);
            result.remainingCapacity -= emitted.rows.length;
            if (localPMat !== null && emitted.rows.length !== 0) {
              if (!callbacks.resolved) return stop(callbacks.requiredProvider);
              callbacks.value?.stopGroovidelic?.(actor);
            }
          }
        }
      } else if (actor.type === 5 || actor.type === 6) {
        const authored = binding(actor.bounds);
        if (!authored.resolved) return stop(authored.requiredProvider);
        if (authored.value === null)
          return stop(`native-actor-bounds:${actor.id}`);
        if (
          !nativeActorPickBoundsOverlap(
            localQuery.realBounds,
            bounds(authored.value),
          )
        )
          return 0;
      }
      return enumerateNativeActorChildren(actor, (child) =>
        visit(child, localQuery, resources, localPMat),
      );
    } finally {
      active.delete(actor);
    }
  }
  visit(
    input.actor,
    initialQuery,
    {
      model: binding(input.inheritedModel),
      material: binding(input.inheritedMaterial),
    },
    initialPMat,
  );
  return result;
}
