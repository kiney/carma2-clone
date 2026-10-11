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
  if (!Number.isFinite(value) || !Number.isFinite(f(value)))
    throw new Error("native actor pick requires finite Float32 scalars");
  return f(value);
}
function mat(value: NativeActorMatrix): number[] {
  if (value.length !== 12)
    throw new Error("native actor pick requires twelve matrix scalars");
  return Array.from(value, scalar);
}
function vec(value: NativeActorPickVector): [number, number, number] {
  if (value.length !== 3)
    throw new Error("native actor pick requires three vector scalars");
  return [scalar(value[0]), scalar(value[1]), scalar(value[2])];
}
function bounds(value: NativeActorBounds): NativeActorBounds {
  const min = vec(value.min),
    max = vec(value.max);
  if (min.some((v, i) => v > max[i]))
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
    B = mat(b),
    orders = [
      [2, 1, 0],
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
      [0, 2, 1],
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 0, 2],
      [0, 1, 2],
      [1, 0, 2],
      [0, 1, 2],
    ],
    out = [];
  for (let row = 0; row < 4; row++)
    for (let column = 0; column < 3; column++) {
      const terms = [0, 1, 2].map((k) => A[row * 3 + k] * B[k * 3 + column]),
        order = orders[row * 3 + column];
      const value = terms[order[0]] + terms[order[1]] + terms[order[2]];
      out.push(scalar(row === 3 ? value + B[9 + column] : value));
    }
  return out;
}
/** Installed5324f0 transposes even a scaled/sheared basis. It is not a general inverse. */
export function nativeActorPickLPInverse(value: NativeActorMatrix): number[] {
  const M = mat(value),
    out = Array<number>(12);
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++)
      out[row * 3 + column] = M[column * 3 + row];
  const orders = [
    [0, 2, 1],
    [2, 0, 1],
    [2, 0, 1],
  ];
  for (let column = 0; column < 3; column++) {
    const terms = [0, 1, 2].map((k) => M[9 + k] * out[k * 3 + column]),
      order = orders[column];
    out[9 + column] = scalar(
      -(terms[order[0]] + terms[order[1]] + terms[order[2]]),
    );
  }
  return out;
}
/** Installed532ae0: live Y+Z+X for X (commutative first pair), Z+Y+X for Y/Z. */
export function nativeActorPickApplyPoint(
  value: NativeActorPickVector,
  transform: NativeActorMatrix,
): [number, number, number] {
  const V = vec(value),
    M = mat(transform);
  return [0, 1, 2].map((column) =>
    scalar(
      V[2] * M[6 + column] +
        V[1] * M[3 + column] +
        V[0] * M[column] +
        M[9 + column],
    ),
  ) as [number, number, number];
}
/** Installed45fab0: stored min point, stored extents/products, sequential row additions. */
export function nativeActorPickTransformBounds(
  value: NativeActorBounds,
  transform: NativeActorMatrix,
): NativeActorBounds {
  const box = bounds(value),
    M = mat(transform),
    first = nativeActorPickApplyPoint(box.min, M),
    min = [...first],
    max = [...first];
  const extent = box.min.map((v, i) => scalar(box.max[i] - v));
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
  return [...a.min, ...a.max, ...b.min, ...b.max].every(Number.isFinite);
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
    extent = box.min.map((v, i) => scalar(box.max[i] - v));
  for (const column of [0, 2, 1]) {
    const terms = [0, 1, 2].map((row) => M[row * 3 + column] * box.min[row]);
    const base =
      (column === 0
        ? terms[0] + terms[1] + terms[2]
        : terms[0] + terms[2] + terms[1]) + M[9 + column];
    const high = [0, 1, 2].map((row) =>
      M[row * 3 + column] > 0 ? M[row * 3 + column] * extent[row] : 0,
    );
    if (base + high[2] + high[1] + high[0] < other.min[column]) return false;
    const low = [0, 1, 2].map((row) =>
      M[row * 3 + column] < 0 ? M[row * 3 + column] * extent[row] : 0,
    );
    if (base + low[2] + low[1] + low[0] > other.max[column]) return false;
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
