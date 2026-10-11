/** Independent installed ExtractColumns initial state and BrActorToBounds.
 * Capture before ProcessModels/FindNonCars mutate actor transforms or models. */
import type {
  NativeActorBounds,
  NativeActorMatrix,
  NativeActorValue,
  NativeOrderedActor,
} from "./native-actor-order";
import { knownNativeActorValue } from "./native-actor-order";
import { nativeActorPickMultiply } from "./native-actor-pick";
import type { NativeFindFacesLayout } from "./native-find-faces";
import { nativeTrackRawBounds } from "./native-track-resources";
import type { NativeTrackModelResource } from "./native-track-resources";

export class NativeTrackLayoutError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeTrackLayoutError";
  }
}
export interface NativeTrackLayoutHeader {
  conversionCount: number;
  processColumns: boolean;
  rawCountX: number;
  rawCountZ: number;
  countX: number;
  countZ: number;
  extraRoom: number;
  /** Pre-AssertNonCars signed count; never replace by the compact survivor count. */
  rawNonCarCount: number;
  nonCarCapacity: number;
}
export interface NativeTrackBoundsProviders {
  /** Actual v1db.default_model, or explicitly unresolved if no branch uses it. */
  defaultModel: NativeActorValue<object>;
  /** Ordinary source MODEL bounds, not a prepared group or renderer mesh box. */
  modelBounds: (model: object) => NativeActorValue<NativeActorBounds>;
}
export type NativeTrackActorBoundsResult =
  | { resolved: true; bounds: NativeActorBounds; modelActorCount: number }
  | { resolved: false; requiredProvider: string };
export type NativeTrackLayoutResult =
  | {
      resolved: true;
      header: NativeTrackLayoutHeader;
      initialBounds: NativeActorBounds;
      modelActorCount: number;
      layout: NativeFindFacesLayout;
    }
  | {
      resolved: false;
      header: NativeTrackLayoutHeader;
      requiredProvider: string;
    };
const f = Math.fround;
const I = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const MAX_FLOAT = 3.4028234663852886e38;
function fail(code: string, message: string): never {
  throw new NativeTrackLayoutError(code, message);
}
function scalar(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(f(value)))
    fail(
      "nonfinite-scalar",
      "Native track layout requires finite Float32 scalars",
    );
  return f(value);
}
function vector(value: readonly number[]): [number, number, number] {
  if (value.length !== 3)
    fail("vector-size", "Native track layout requires three vector components");
  return [scalar(value[0]), scalar(value[1]), scalar(value[2])];
}
function bounds(value: NativeActorBounds): NativeActorBounds {
  const min = vector(value.min),
    max = vector(value.max);
  if (min.some((v, i) => v > max[i]))
    fail("reversed-bounds", "Native MODEL bounds are reversed");
  return { min, max };
}
function matrix(value: NativeActorMatrix): number[] {
  if (value.length !== 12)
    fail(
      "matrix-size",
      "Native track layout requires twelve matrix components",
    );
  return Array.from(value, scalar);
}
function binding<T>(value: NativeActorValue<T>): NativeActorValue<T> {
  if (
    !value ||
    typeof value.resolved !== "boolean" ||
    (value.resolved ? value.value === undefined : !value.requiredProvider)
  )
    fail(
      "invalid-binding",
      "Native track layout needs explicit resource bindings",
    );
  return value;
}

/** Installed40cc50 scans %u%u%f%d after a supported PP prefix. Decimal numeric
 * tokens are supported; malformed exponents/overflow fail explicitly rather
 * than inventing a result for unsupported CRT conversion behavior. */
export function parseNativeTrackLayoutHeader(
  name: string,
): NativeTrackLayoutHeader {
  if (typeof name !== "string")
    fail("identifier", "Native track layout needs the actual root identifier");
  const terminated = name.split("\0", 1)[0];
  let text = terminated;
  if (text.startsWith("PP")) {
    if (text[3] !== "1")
      fail(
        "track-version",
        "Native fatal: wrong format of track PP identifier",
      );
    if (text.length < 5)
      fail(
        "track-header-pointer",
        "Unsafe native PP header pointer past its terminator",
      );
    text = text.slice(5);
  }
  let offset = 0,
    count = 0;
  const values: number[] = [];
  for (let field = 0; field < 4; field++) {
    const tail = text.slice(offset);
    const match = (
      field === 2
        ? /^[\t\n\v\f\r ]*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/
        : /^[\t\n\v\f\r ]*([+-]?\d+)/
    ).exec(tail);
    if (!match) break;
    offset += match[0].length;
    if (field === 2) {
      if (/^[eE]/.test(text.slice(offset)))
        fail(
          "crt-float-grammar",
          "Unsupported malformed native CRT float exponent",
        );
      values.push(scalar(Number(match[1])));
    } else {
      const integer = BigInt(match[1]);
      if (field < 2) {
        if (integer < -0xffffffffn || integer > 0xffffffffn)
          fail(
            "crt-integer-overflow",
            "Unsupported native CRT unsigned conversion overflow",
          );
        values.push(Number(integer & 0xffffffffn));
      } else {
        if (integer < -0x80000000n || integer > 0x7fffffffn)
          fail(
            "crt-integer-overflow",
            "Unsupported native CRT signed conversion overflow",
          );
        values.push(Number(integer));
      }
    }
    count++;
  }
  if (count === 0 && /^[\t\n\v\f\r ]*$/.test(text)) count = -1;
  if (count === 3)
    fail(
      "ancient-track",
      "Native failure: three-field preprocessed track is unsupported",
    );
  const processColumns = count === 4,
    rawCountX = processColumns ? values[0] : 1,
    rawCountZ = processColumns ? values[1] : 1,
    countX = rawCountX & 255,
    countZ = rawCountZ & 255,
    extraRoom = processColumns ? values[2] : 0,
    rawNonCarCount = processColumns ? values[3] : 0,
    nonCarCapacity = rawNonCarCount + 250;
  if (countX === 0 || countZ === 0)
    fail("zero-column-count", "Unsafe native zero-byte column count");
  if (rawNonCarCount < 0 || nonCarCapacity > 0x3fffffff)
    fail(
      "noncar-allocation",
      "Unsafe native noncar count or four-byte slot allocation overflow",
    );
  return {
    conversionCount: count,
    processColumns,
    rawCountX,
    rawCountZ,
    countX,
    countZ,
    extraRoom,
    rawNonCarCount,
    nonCarCapacity,
  };
}

/** Installed51e28a: live products, ordered row0/1/2 Float32 accumulations.
 * This differs from both FillInBounds and GetNewBoundingBox. */
export function nativeTrackApplyModelBounds(
  value: NativeActorBounds,
  transform: NativeActorMatrix,
): NativeActorBounds {
  const B = bounds(value),
    M = matrix(transform),
    min = vector(M.slice(9)),
    max = [...min] as [number, number, number];
  for (let column = 0; column < 3; column++)
    for (let row = 0; row < 3; row++) {
      const a = M[row * 3 + column] * B.min[row],
        b = M[row * 3 + column] * B.max[row];
      // Native compares live a/b; neither product is spilled before addition.
      min[column] = scalar(min[column] + (a < b ? a : b));
      max[column] = scalar(max[column] + (a < b ? b : a));
    }
  return { min, max };
}

/** Installed51e160/51e200. Root transform is ignored. Rendering styles, MATs,
 * names and BOUNDS type_data never prune this traversal. MODEL NULL inherits. */
export function nativeTrackActorBounds(
  root: NativeOrderedActor,
  providers: NativeTrackBoundsProviders,
): NativeTrackActorBoundsResult {
  const defaultModel = binding(providers.defaultModel);
  let dest: NativeActorBounds = {
      min: [MAX_FLOAT, MAX_FLOAT, MAX_FLOAT],
      max: [-MAX_FLOAT, -MAX_FLOAT, -MAX_FLOAT],
    },
    modelActorCount = 0,
    requiredProvider: string | null = null;
  const active = new Set<NativeOrderedActor>(),
    seen = new Set<NativeOrderedActor>();
  const select = (
    actor: NativeOrderedActor,
    inherited: NativeActorValue<object>,
  ) => {
    const local = binding(actor.localModel);
    return local.resolved && local.value === null ? inherited : local;
  };
  const read = (model: NativeActorValue<object>): NativeActorBounds | null => {
    if (!model.resolved) {
      requiredProvider = model.requiredProvider;
      return null;
    }
    if (model.value === null) {
      requiredProvider = "native-v1db-default-MODEL";
      return null;
    }
    if (!providers.modelBounds)
      fail(
        "bounds-provider",
        "Native track layout requires a MODEL bounds reader",
      );
    const found = binding(providers.modelBounds(model.value));
    if (!found.resolved) {
      requiredProvider = found.requiredProvider;
      return null;
    }
    if (found.value === null) {
      requiredProvider = "native-retained-MODEL-bounds";
      return null;
    }
    return bounds(found.value);
  };
  const visit = (
    actor: NativeOrderedActor,
    inherited: NativeActorValue<object>,
    parentMatrix: NativeActorMatrix,
  ) => {
    if (active.has(actor) || seen.has(actor))
      fail("actor-cycle", "Cycle or shared actor in native bounds subtree");
    active.add(actor);
    seen.add(actor);
    const model = select(actor, inherited),
      current = nativeActorPickMultiply(matrix(actor.matrix), parentMatrix);
    if (actor.type === 1) {
      const box = read(model);
      if (!box) return;
      const transformed = nativeTrackApplyModelBounds(box, current);
      for (let i = 0; i < 3; i++) {
        if (transformed.min[i] < dest.min[i]) dest.min[i] = transformed.min[i];
        if (transformed.max[i] > dest.max[i]) dest.max[i] = transformed.max[i];
      }
      modelActorCount++;
    }
    for (
      let child = actor.firstChild;
      child && !requiredProvider;
      child = child.next
    )
      visit(child, model, current);
    active.delete(actor);
  };
  seen.add(root);
  const rootModel = select(root, defaultModel);
  if (root.type === 1) {
    const box = read(rootModel);
    if (box) {
      dest = box;
      modelActorCount++;
    }
  }
  for (
    let child = root.firstChild;
    child && !requiredProvider;
    child = child.next
  )
    visit(child, rootModel, I);
  return requiredProvider
    ? { resolved: false, requiredProvider }
    : { resolved: true, bounds: dest, modelActorCount };
}

/** Optional actual prepared-resource ownership adapter. Direct original DAT
 * hosts can instead supply nativeRawModelBounds without MAT preparation. */
export function createNativeTrackLayoutBoundsProvider(
  resolveModel: (
    identity: object,
  ) => NativeActorValue<NativeTrackModelResource>,
): NativeTrackBoundsProviders["modelBounds"] {
  return (identity) => {
    const found = binding(resolveModel(identity));
    if (!found.resolved) return found;
    if (found.value === null)
      return {
        resolved: false,
        requiredProvider: "native-track-layout-MODEL-resource",
      };
    const result = nativeTrackRawBounds(found.value);
    return result.resolved
      ? knownNativeActorValue(result.value?.bounds ?? null)
      : result;
  };
}

/** Installed40cd3f..40cdc4. Capture initial bounds before any column/noncar
 * callbacks; return detached snapshots, never a post-normalization recompute. */
export function extractNativeTrackLayout(
  root: NativeOrderedActor,
  providers: NativeTrackBoundsProviders,
): NativeTrackLayoutResult {
  const header = parseNativeTrackLayoutHeader(root.name),
    result = nativeTrackActorBounds(root, providers);
  if (!result.resolved)
    return {
      resolved: false,
      header,
      requiredProvider: result.requiredProvider,
    };
  if (result.modelActorCount === 0)
    fail(
      "empty-model-subtree",
      "Native track has no MODEL bounds for a finite layout",
    );
  const initialBounds = result.bounds,
    doubledRoom = header.extraRoom * 2,
    columnSizeX = scalar(
      (initialBounds.max[0] - initialBounds.min[0] - doubledRoom) /
        header.countX,
    ),
    columnSizeZ = scalar(
      (initialBounds.max[2] - initialBounds.min[2] - doubledRoom) /
        header.countZ,
    ),
    originX = scalar(initialBounds.min[0] - header.extraRoom),
    originZ = scalar(initialBounds.min[2] - header.extraRoom);
  if (columnSizeX <= 0 || columnSizeZ <= 0)
    fail("column-size", "Native track layout has nonpositive column widths");
  return {
    resolved: true,
    header,
    initialBounds,
    modelActorCount: result.modelActorCount,
    layout: {
      originX,
      originZ,
      columnSizeX,
      columnSizeZ,
      countX: header.countX,
      countZ: header.countZ,
    },
  };
}
