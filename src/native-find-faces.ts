/** Independent installed FindFacesInBox4b5570 orchestration. Columns and
 * bindings are source resources supplied by the host, never render traversal. */
import { knownNativeActorValue } from "./native-actor-order";
import type {
  NativeActorBounds,
  NativeActorMatrix,
  NativeActorValue,
  NativeOrderedActor,
} from "./native-actor-order";
import {
  nativeActorPickApplyPoint,
  pickNativeActorBox,
} from "./native-actor-pick";
import type {
  NativeActorPickCallbacks,
  NativeActorPickProviders,
  NativeActorPickQuery,
  NativeActorPickResult,
} from "./native-actor-pick";
import { createNativeModelPickEmitter } from "./native-model-pick";
import type {
  NativeModelPickFace,
  NativeModelPickOptions,
} from "./native-model-pick";
import { nativeTrackRawBounds } from "./native-track-resources";
import type { NativeTrackModelResource } from "./native-track-resources";

export interface NativeFindFacesLayout {
  /** Actual retained tTrack_spec fields; no inferred grid or extra-room sign. */
  originX: number;
  originZ: number;
  columnSizeX: number;
  columnSizeZ: number;
  countX: number;
  countZ: number;
}
export interface NativeFindFacesRange {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export interface NativeFindFacesInput<Row> {
  bounds: NativeActorBounds;
  matrix: NativeActorMatrix;
  layout: NativeFindFacesLayout;
  /** Native columns[z][x]. Each entry is the actual column actor_0x0 or NULL. */
  columns: readonly (readonly (NativeOrderedActor | null)[])[];
  /** One actual container, not a sorted array of its children. */
  additionalActors: NativeActorValue<NativeOrderedActor>;
  blackMaterial: NativeActorValue<object>;
  worldCallbacks: NativeActorValue<NativeActorPickCallbacks>;
  emitModels: boolean;
  capacity: number;
  providers: NativeActorPickProviders<Row>;
}
export interface NativeFindFacesResult<Row> extends NativeActorPickResult<Row> {
  query: NativeActorPickQuery;
  range: NativeFindFacesRange;
}
const f = Math.fround;
function scalar(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(f(value)))
    throw new Error("native find faces requires finite Float32 scalars");
  return f(value);
}
function vector(value: readonly number[]): [number, number, number] {
  if (value.length !== 3)
    throw new Error("native find faces requires three vector components");
  return [scalar(value[0]), scalar(value[1]), scalar(value[2])];
}
function storedLayout(value: NativeFindFacesLayout): NativeFindFacesLayout {
  if (
    !Number.isInteger(value.countX) ||
    !Number.isInteger(value.countZ) ||
    value.countX < 1 ||
    value.countX > 255 ||
    value.countZ < 1 ||
    value.countZ > 255
  )
    throw new Error(
      "native find faces requires nonzero unsigned-byte grid counts",
    );
  const result = {
    ...value,
    originX: scalar(value.originX),
    originZ: scalar(value.originZ),
    columnSizeX: scalar(value.columnSizeX),
    columnSizeZ: scalar(value.columnSizeZ),
  };
  if (result.columnSizeX <= 0 || result.columnSizeZ <= 0)
    throw new Error("native find faces requires positive column sizes");
  return result;
}

/** Installed FillInBounds45fb90, not GetNewBoundingBox45fab0. The radius is
 * local/unscaled; transformed extrema add grouped stored products only once. */
export function nativeFindFacesQuery(
  bounds: NativeActorBounds,
  matrix: NativeActorMatrix,
): NativeActorPickQuery {
  const min = vector(bounds.min),
    max = vector(bounds.max);
  if (min.some((v, i) => v > max[i]))
    throw new Error("native find faces bounds are reversed");
  if (matrix.length !== 12)
    throw new Error("native find faces requires twelve matrix components");
  const M = Array.from(matrix, scalar),
    midpoint = min.map((v, i) => scalar((v + max[i]) * 0.5)) as [
      number,
      number,
      number,
    ],
    raw = max.map((v, i) => v - min[i]),
    extent = raw.map(scalar),
    center = nativeActorPickApplyPoint(midpoint, M),
    radius = scalar(
      Math.sqrt(raw[0] * extent[0] + raw[1] * extent[1] + raw[2] * extent[2]) *
        0.5,
    ),
    origin = nativeActorPickApplyPoint(min, M),
    products = extent.map((v, row) =>
      [0, 1, 2].map((column) => scalar(v * M[row * 3 + column])),
    );
  const realMin = [0, 1, 2].map((column) => {
      const c = products.map((row) => row[column] * Number(row[column] < 0));
      // Installed live x87 order: (row2 + row0) + row1, then stored origin.
      return scalar(origin[column] + (c[2] + c[0] + c[1]));
    }) as [number, number, number],
    realMax = [0, 1, 2].map((column) => {
      const c = products.map((row) => row[column] * Number(row[column] > 0));
      return scalar(origin[column] + (c[1] + c[0] + c[2]));
    }) as [number, number, number];
  return {
    matrix: M,
    originalBounds: { min, max },
    realBounds: { min: realMin, max: realMax },
    center,
    radius,
  };
}

/** Installed XZToColumnXZ40cb90: X quotient has a Float32 spill, Z does not. */
export function nativeFindFacesColumnXZ(
  x: number,
  z: number,
  layout: NativeFindFacesLayout,
): [number, number] {
  const L = storedLayout(layout),
    rawX = (scalar(x) - L.originX) / L.columnSizeX,
    rawZ = (scalar(z) - L.originZ) / L.columnSizeZ;
  let X = f(rawX),
    Z = rawZ;
  if (rawX < 0) X = 0;
  if (X >= L.countX) X = L.countX - 1;
  if (Z < 0) Z = 0;
  if (Z >= L.countZ) Z = L.countZ - 1;
  return [Math.trunc(X) & 255, Math.trunc(Z) & 255];
}
export function nativeFindFacesColumnRange(
  query: NativeActorPickQuery,
  layout: NativeFindFacesLayout,
): NativeFindFacesRange {
  const L = storedLayout(layout),
    low = nativeFindFacesColumnXZ(
      query.realBounds.min[0],
      query.realBounds.min[2],
      L,
    ),
    high = nativeFindFacesColumnXZ(
      query.realBounds.max[0],
      query.realBounds.max[2],
      L,
    );
  return {
    minX: low[0] === 0 ? 0 : low[0] - 1,
    minZ: low[1] === 0 ? 0 : low[1] - 1,
    maxX: high[0] + 1 < L.countX ? high[0] + 1 : high[0],
    maxZ: high[1] + 1 < L.countZ ? high[1] + 1 : high[1],
  };
}

/** Concrete resource adapter delegates ModelPickBox; it does not prepare stale
 * resources or invent original material pointer ordering. */
export function createNativeFindFacesProviders(
  resolveModel: (
    identity: object,
  ) => NativeActorValue<NativeTrackModelResource>,
  options: NativeModelPickOptions = {},
): NativeActorPickProviders<NativeModelPickFace> {
  return {
    modelBounds(identity) {
      const binding = resolveModel(identity);
      if (!binding || typeof binding.resolved !== "boolean")
        throw new Error("native find faces requires explicit MODEL lookup");
      if (!binding.resolved) return binding;
      if (binding.value === null || binding.value === undefined)
        return {
          resolved: false,
          requiredProvider: "native-find-faces-model-resource",
        };
      const result = nativeTrackRawBounds(binding.value);
      return result.resolved
        ? knownNativeActorValue(result.value?.bounds ?? null)
        : result;
    },
    emitModel: createNativeModelPickEmitter(resolveModel, options),
  };
}

/** Installed4b5570: capacity limits emitted rows, not traversal/callbacks. A
 * diagnostic retains the completed prefix; the caller must not treat it as a
 * complete face query. Generic providers also permit explicit capture probes. */
export function findNativeFacesInBox<Row>(
  input: NativeFindFacesInput<Row>,
): NativeFindFacesResult<Row> {
  if (
    !Number.isInteger(input.capacity) ||
    input.capacity < 0 ||
    input.capacity > 0x7fffffff
  )
    throw new Error("native find faces capacity must be nonnegative signed32");
  if (typeof input.emitModels !== "boolean")
    throw new Error("native find faces model-emission global must be explicit");
  for (const binding of [input.blackMaterial, input.worldCallbacks])
    if (
      !binding ||
      typeof binding.resolved !== "boolean" ||
      (binding.resolved
        ? binding.value === undefined
        : !binding.requiredProvider)
    )
      throw new Error("native find faces needs explicit MAT/callback bindings");
  const L = storedLayout(input.layout),
    query = nativeFindFacesQuery(input.bounds, input.matrix),
    range = nativeFindFacesColumnRange(query, L),
    rows: Row[] = [];
  if (
    input.columns.length !== L.countZ ||
    input.columns.some((row) => row.length !== L.countX)
  )
    throw new Error("native find faces columns must match the retained grid");
  if (
    !input.additionalActors ||
    typeof input.additionalActors.resolved !== "boolean" ||
    (input.additionalActors.resolved
      ? input.additionalActors.value === undefined
      : !input.additionalActors.requiredProvider)
  )
    throw new Error(
      "native find faces needs an explicit additional ACT binding",
    );
  const result = (resolved: boolean, requiredProvider?: string) => ({
    resolved,
    ...(requiredProvider ? { requiredProvider } : {}),
    rows,
    remainingCapacity: input.capacity - rows.length,
    query,
    range,
  });
  const pick = (actor: NativeOrderedActor) => {
    const prefix = rows.length,
      picked = pickNativeActorBox({
        actor,
        query,
        inheritedModel: knownNativeActorValue<object>(null),
        inheritedMaterial: input.blackMaterial,
        pMat: null,
        capacity: input.capacity - prefix,
        emitModels: input.emitModels,
        worldCallbacks: input.worldCallbacks,
        providers: {
          modelBounds: input.providers.modelBounds,
          emitModel: (emission) =>
            input.providers.emitModel({
              ...emission,
              outputOffset: prefix + emission.outputOffset,
            }),
        },
      });
    for (const row of picked.rows) rows.push(row);
    return picked;
  };
  for (let x = range.minX; x <= range.maxX; x++)
    for (let z = range.minZ; z <= range.maxZ; z++) {
      const actor = input.columns[z][x];
      if (actor !== null) {
        const picked = pick(actor);
        if (!picked.resolved) return result(false, picked.requiredProvider);
      }
    }
  if (!input.additionalActors.resolved)
    return result(false, input.additionalActors.requiredProvider);
  if (input.additionalActors.value !== null) {
    const picked = pick(input.additionalActors.value);
    if (!picked.resolved) return result(false, picked.requiredProvider);
  }
  return result(true);
}
