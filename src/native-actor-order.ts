/** Independent actor-list reconstruction from installed C2/BRender behavior.
 * Resource lookup and game model mutation are explicit host responsibilities. */
import type { ActNode } from "./formats";

export type NativeActorValue<T> =
  | { resolved: true; value: T | null }
  | { resolved: false; requiredProvider: string };
export const knownNativeActorValue = <T>(
  value: T | null,
): NativeActorValue<T> => ({ resolved: true, value });
export type NativeActorMatrix = readonly number[];
export type NativeActorBounds = NonNullable<ActNode["bounds"]>;
export interface NativeOrderedActor {
  readonly id: string;
  readonly source: ActNode | null;
  readonly provenance: string;
  name: string;
  type: number;
  renderStyle: number;
  matrix: NativeActorMatrix;
  localModel: NativeActorValue<object>;
  localMaterial: NativeActorValue<object>;
  bounds: NativeActorValue<NativeActorBounds>;
  parent: NativeOrderedActor | null;
  firstChild: NativeOrderedActor | null;
  previous: NativeOrderedActor | null;
  next: NativeOrderedActor | null;
  depth: number;
}
export interface NativeActorOrderState {
  readonly roots: NativeOrderedActor[];
  readonly actors: NativeOrderedActor[];
}
export interface NativeActorLoadProviders {
  model?: (name: string, source: ActNode) => NativeActorValue<object>;
  material?: (name: string, source: ActNode) => NativeActorValue<object>;
}
const identity = () => [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
function matrix(value: NativeActorMatrix): number[] {
  if (value.length !== 12 || !value.every(Number.isFinite))
    throw new Error("native actor matrix must contain twelve finite scalars");
  const stored = value.map(Math.fround);
  if (!stored.every(Number.isFinite))
    throw new Error(
      "native actor matrix must remain finite after Float32 storage",
    );
  return stored;
}
function byte(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0 || value > 255)
    throw new Error(`invalid native actor ${label}`);
  return value;
}
function validateBinding<T>(binding: NativeActorValue<T>): NativeActorValue<T> {
  if (
    !binding ||
    typeof binding.resolved !== "boolean" ||
    (!binding.resolved && !binding.requiredProvider)
  )
    throw new Error("invalid native actor resource binding");
  if (binding.resolved && binding.value === undefined)
    throw new Error(
      "known native actor resource must explicitly contain a value or NULL",
    );
  return binding;
}
function identityBinding(
  binding: NativeActorValue<object>,
): NativeActorValue<object> {
  validateBinding(binding);
  if (
    binding.resolved &&
    binding.value !== null &&
    typeof binding.value !== "object"
  )
    throw new Error(
      "native MODEL/MAT identity must be an object, not a name or rank",
    );
  return binding;
}
function validateBounds(bounds: NativeActorBounds): NativeActorBounds {
  if (
    bounds.min.length !== 3 ||
    bounds.max.length !== 3 ||
    ![...bounds.min, ...bounds.max].every(Number.isFinite) ||
    bounds.min.some((v, i) => v > bounds.max[i])
  )
    throw new Error("invalid native actor bounds");
  const stored = {
    min: bounds.min.map(Math.fround) as [number, number, number],
    max: bounds.max.map(Math.fround) as [number, number, number],
  };
  if (![...stored.min, ...stored.max].every(Number.isFinite))
    throw new Error(
      "native actor bounds must remain finite after Float32 storage",
    );
  return stored;
}
export interface NativeActorDescriptor {
  name?: string;
  type: number;
  renderStyle: number;
  matrix: NativeActorMatrix;
  localModel: NativeActorValue<object>;
  localMaterial: NativeActorValue<object>;
  bounds: NativeActorValue<NativeActorBounds>;
  provenance: string;
}
export function allocateNativeOrderedActor(
  state: NativeActorOrderState,
  descriptor: NativeActorDescriptor,
): NativeOrderedActor {
  const bounds = validateBinding(descriptor.bounds);
  const actor: NativeOrderedActor = {
    id: `generated:${state.actors.length}`,
    source: null,
    provenance: descriptor.provenance,
    name: descriptor.name ?? "",
    type: byte(descriptor.type, "type"),
    renderStyle: byte(descriptor.renderStyle, "render style"),
    matrix: matrix(descriptor.matrix),
    localModel: identityBinding(descriptor.localModel),
    localMaterial: identityBinding(descriptor.localMaterial),
    bounds:
      bounds.resolved && bounds.value
        ? knownNativeActorValue(validateBounds(bounds.value))
        : bounds,
    parent: null,
    firstChild: null,
    previous: null,
    next: null,
    depth: 0,
  };
  state.actors.push(actor);
  return actor;
}
function renumber(actor: NativeOrderedActor, depth: number): void {
  const pending: [NativeOrderedActor, number][] = [[actor, depth]],
    seen = new Set<NativeOrderedActor>();
  while (pending.length) {
    const [current, d] = pending.pop()!;
    if (seen.has(current))
      throw new Error("cycle or shared actor in native subtree");
    seen.add(current);
    current.depth = d & 0xffff;
    const siblings = new Set<NativeOrderedActor>();
    for (let child = current.firstChild; child; child = child.next) {
      if (siblings.has(child)) throw new Error("cycle in native sibling list");
      siblings.add(child);
      pending.push([child, current.depth + 1]);
    }
  }
}
/** BrActorAdd/BrSimpleAddHead: the actor must already be detached. */
export function prependNativeActor(
  parent: NativeOrderedActor,
  actor: NativeOrderedActor,
): void {
  if (actor.parent || actor.previous || actor.next)
    throw new Error("native actor must be detached before prepend");
  for (
    let ancestor: NativeOrderedActor | null = parent;
    ancestor;
    ancestor = ancestor.parent
  )
    if (ancestor === actor)
      throw new Error("native actor prepend would create a cycle");
  actor.next = parent.firstChild;
  if (actor.next) actor.next.previous = actor;
  parent.firstChild = actor;
  actor.parent = parent;
  actor.previous = null;
  renumber(actor, parent.depth + 1);
}
/** Detached roots are not members of a synthetic native sibling list. */
export function removeNativeActor(actor: NativeOrderedActor): void {
  if (!actor.parent) {
    if (actor.previous || actor.next)
      throw new Error("invalid detached native actor links");
    return;
  }
  if (actor.previous) actor.previous.next = actor.next;
  else actor.parent.firstChild = actor.next;
  if (actor.next) actor.next.previous = actor.previous;
  actor.parent = null;
  actor.previous = null;
  actor.next = null;
  renumber(actor, 0);
}
/** Transform must come from the actual source actor-to-actor provider. */
export function relinkNativeActor(
  parent: NativeOrderedActor,
  actor: NativeOrderedActor,
  actorToParent: NativeActorMatrix,
): void {
  if (actor.parent === parent) return;
  const prepared = matrix(actorToParent);
  for (
    let ancestor: NativeOrderedActor | null = parent;
    ancestor;
    ancestor = ancestor.parent
  )
    if (ancestor === actor)
      throw new Error("native actor relink would create a cycle");
  removeNativeActor(actor);
  actor.matrix = prepared;
  prependNativeActor(parent, actor);
}
/** BrActorEnum: save next BEFORE each callback; return nonzero stops enumeration. */
export function enumerateNativeActorChildren(
  parent: NativeOrderedActor,
  callback: (actor: NativeOrderedActor) => number,
): number {
  const seen = new Set<NativeOrderedActor>();
  for (let child = parent.firstChild; child; ) {
    if (seen.has(child))
      throw new Error("cycle during native actor enumeration");
    seen.add(child);
    const next = child.next;
    const result = callback(child);
    if (!Number.isFinite(result))
      throw new Error("invalid native actor callback result");
    if (result !== 0) return result;
    child = next;
  }
  return 0;
}
export function createNativeActorOrder(
  rawRoots: readonly ActNode[],
  providers: NativeActorLoadProviders = {},
): NativeActorOrderState {
  const state: NativeActorOrderState = { roots: [], actors: [] },
    seen = new Set<ActNode>();
  function create(source: ActNode, path: string): NativeOrderedActor {
    if (seen.has(source)) throw new Error("cycle or shared raw ACT node");
    seen.add(source);
    const lookup = (kind: "model" | "material") =>
      source[kind] === undefined
        ? knownNativeActorValue<object>(null)
        : validateBinding(
            providers[kind]?.(source[kind]!, source) ?? {
              resolved: false,
              requiredProvider: `native-${kind}-identity:${source[kind]}`,
            },
          );
    const actor = allocateNativeOrderedActor(state, {
      name: source.name,
      type: source.type,
      renderStyle: source.renderStyle,
      matrix: source.transform,
      localModel: lookup("model"),
      localMaterial: lookup("material"),
      bounds: source.bounds
        ? knownNativeActorValue(source.bounds)
        : source.type === 5 || source.type === 6
          ? { resolved: false, requiredProvider: `native-actor-bounds:${path}` }
          : knownNativeActorValue(null),
      provenance: `ACT file root/child path ${path}`,
    });
    Object.defineProperties(actor, {
      id: { value: `file:${path}` },
      source: { value: source },
    });
    source.children.forEach((child, index) =>
      prependNativeActor(actor, create(child, `${path}/${index}`)),
    );
    return actor;
  }
  rawRoots.forEach((source, index) =>
    state.roots.push(create(source, String(index))),
  );
  return state;
}
export interface NativeActorInheritance {
  model: NativeActorValue<object>;
  material: NativeActorValue<object>;
}
/** Known NULL inherits; unresolved local identity cannot safely inherit. */
export function resolveNativeActorInheritance(
  actor: NativeOrderedActor,
  inherited: NativeActorInheritance,
): NativeActorInheritance {
  const pick = (
    local: NativeActorValue<object>,
    parent: NativeActorValue<object>,
  ) => (local.resolved && local.value === null ? parent : local);
  return {
    model: pick(actor.localModel, inherited.model),
    material: pick(actor.localMaterial, inherited.material),
  };
}
export interface NativeActorColumn {
  readonly x: number;
  readonly z: number;
  readonly wrapper: NativeOrderedActor;
  readonly tile: NativeOrderedActor | null;
  blendy: NativeOrderedActor | null;
}
export type NativeActorPreparationResult =
  | { resolved: true; evidence: string }
  | { resolved: false; requiredProvider: string };
export type NativeActorColumnPreparationResult =
  | { resolved: true; evidence: string; blendy: NativeActorDescriptor | null }
  | { resolved: false; requiredProvider: string };
export interface NativeActorColumnProviders {
  /** Actual MungeFaces/reprepare edits must be applied by this callback. */
  prepareColumn?: (
    tile: NativeOrderedActor,
    selectedGround: NativeOrderedActor | null,
    state: NativeActorOrderState,
  ) => NativeActorColumnPreparationResult;
  /** Actual FindNonCars mutations/early callback stop behavior belong to this host. */
  findNonCars?: (
    tile: NativeOrderedActor,
    state: NativeActorOrderState,
  ) => NativeActorPreparationResult;
  /** Native blendy MODEL Add/full reprepare occurs AFTER attachment, before finalization. */
  finishBlendy?: (
    column: NativeActorColumn,
    state: NativeActorOrderState,
  ) => NativeActorPreparationResult;
  setSmashableModel?: (
    actor: NativeOrderedActor,
    state: NativeActorOrderState,
  ) => NativeActorPreparationResult;
  relinkMatrix?: (
    tile: NativeOrderedActor,
    wrapper: NativeOrderedActor,
  ) => NativeActorValue<NativeActorMatrix>;
  /** Only valid when tile and newly allocated sibling wrapper are identity. */
  identityColumnRelink?: { evidence: string };
}
export interface NativeActorColumnInput {
  root: NativeOrderedActor;
  countX: number;
  countZ: number;
  defaultTrackMaterial: NativeActorValue<object>;
  austerity: boolean;
  providers: NativeActorColumnProviders;
}
export interface NativeActorColumnResult {
  resolved: boolean;
  requiredProvider?: string;
  /** Partial source mutations remain visible on provider failure; no rollback is claimed. */
  columns: (NativeActorColumn | null)[][];
  processedColumns: NativeActorColumn[];
}
function columnCoordinates(name: string): [number, number] | null {
  // Two successive CRT %u conversions: whitespace need not separate signed tokens.
  let offset = 0;
  const values: number[] = [];
  for (let i = 0; i < 2; i++) {
    const match = /^[\t\n\v\f\r ]*([+-]?\d+)/.exec(name.slice(offset));
    if (!match) return null;
    const value = BigInt(match[1]);
    if (value > 0xffffffffn || value < -0xffffffffn)
      throw new Error(
        "native column identifier CRT integer overflow is unsupported",
      );
    values.push(Number(value & 0xffffffffn));
    offset += match[0].length;
  }
  return values as [number, number];
}
/** ProcessModelsCB topology only; all game preparation requires explicit providers. */
export function extractNativeActorColumns(
  state: NativeActorOrderState,
  input: NativeActorColumnInput,
): NativeActorColumnResult {
  const { countX, countZ, providers } = input;
  if (
    !Number.isInteger(countX) ||
    !Number.isInteger(countZ) ||
    countX < 1 ||
    countZ < 1 ||
    countX > 255 ||
    countZ > 255
  )
    throw new Error("native column dimensions must be unsigned nonzero bytes");
  if (!state.actors.includes(input.root))
    throw new Error("column root belongs to another actor state");
  const result: NativeActorColumnResult = {
    resolved: false,
    columns: Array.from({ length: countZ }, () =>
      Array<NativeActorColumn | null>(countX).fill(null),
    ),
    processedColumns: [],
  };
  const stop = (requiredProvider: string) => {
    result.requiredProvider = requiredProvider;
    return 1;
  };
  const material = identityBinding(input.defaultTrackMaterial);
  if (!material.resolved) {
    stop(material.requiredProvider);
    return result;
  }
  if (material.value === null) {
    stop("native-default-track-material");
    return result;
  }
  for (const provider of [
    "prepareColumn",
    "findNonCars",
    "setSmashableModel",
  ] as const)
    if (!providers[provider]) {
      stop(`native-${provider}-provider`);
      return result;
    }
  const checked = (r: NativeActorPreparationResult) =>
    r.resolved
      ? r.evidence
        ? 0
        : stop("native-preparation-evidence")
      : stop(r.requiredProvider);
  function process(actor: NativeOrderedActor): number {
    const coordinates = columnCoordinates(actor.name);
    if (coordinates && coordinates[0] < countX && coordinates[1] < countZ) {
      const [x, z] = coordinates;
      if (!actor.parent)
        throw new Error("source tile must have an actual parent");
      // Duplicate coordinates overwrite the table in source callback order; actors remain linked.
      actor.localMaterial = material;
      const wrapper = allocateNativeOrderedActor(state, {
        type: 0,
        renderStyle: 0,
        matrix: identity(),
        localModel: knownNativeActorValue(null),
        localMaterial: knownNativeActorValue(null),
        bounds: knownNativeActorValue(null),
        provenance: `ProcessModelsCB identity column wrapper (${x},${z}) for ${actor.id}`,
      });
      const column: NativeActorColumn = {
        x,
        z,
        wrapper,
        tile: actor,
        blendy: null,
      };
      result.columns[z][x] = column;
      result.processedColumns.push(column);
      prependNativeActor(actor.parent, wrapper);
      let transform: NativeActorValue<NativeActorMatrix>;
      if (providers.relinkMatrix)
        transform = validateBinding(providers.relinkMatrix(actor, wrapper));
      else if (
        providers.identityColumnRelink?.evidence &&
        actor.matrix.every((v, i) => v === identity()[i])
      )
        transform = knownNativeActorValue(identity());
      else
        transform = {
          resolved: false,
          requiredProvider: "native-column-relink-matrix-provider",
        };
      if (!transform.resolved || transform.value === null)
        return stop(
          transform.resolved
            ? "native-column-relink-matrix-provider"
            : transform.requiredProvider,
        );
      relinkNativeActor(wrapper, actor, transform.value);
      let ground: NativeOrderedActor | null = null;
      if (!actor.localModel.resolved)
        return stop(actor.localModel.requiredProvider);
      if (actor.localModel.value !== null && !input.austerity) ground = actor;
      else {
        for (let child = actor.firstChild; child; child = child.next)
          if (!child.name.startsWith("&")) {
            ground = child;
            break;
          }
      }
      if (ground && !ground.localModel.resolved)
        return stop(ground.localModel.requiredProvider);
      const prepared = providers.prepareColumn!(actor, ground, state);
      if (checked(prepared)) return 1;
      if (!prepared.resolved) return 1;
      if (!Object.hasOwn(prepared, "blendy"))
        return stop("native-column-blendy-result");
      if (prepared.blendy)
        column.blendy = allocateNativeOrderedActor(state, prepared.blendy);
      if (checked(providers.findNonCars!(actor, state))) return 1;
      if (column.blendy) {
        prependNativeActor(wrapper, column.blendy);
        if (!providers.finishBlendy)
          return stop("native-blendy-model-preparation-provider");
        if (checked(providers.finishBlendy(column, state))) return 1;
      }
    } else if (enumerateNativeActorChildren(actor, process)) return 1;
    return checked(providers.setSmashableModel!(actor, state));
  }
  if (enumerateNativeActorChildren(input.root, process) === 0)
    result.resolved = true;
  return result;
}
/** FindFacesInBox column pointer order: X outer, Z inner; empty squares are NULL. */
export function orderedNativeActorColumns(
  result: NativeActorColumnResult,
  range?: { minX: number; maxX: number; minZ: number; maxZ: number },
): NativeActorColumn[] {
  if (!result.resolved)
    throw new Error(`unresolved native columns: ${result.requiredProvider}`);
  const countZ = result.columns.length,
    countX = result.columns[0]?.length ?? 0;
  const r = range ?? { minX: 0, maxX: countX - 1, minZ: 0, maxZ: countZ - 1 };
  if (
    ![r.minX, r.maxX, r.minZ, r.maxZ].every(Number.isInteger) ||
    r.minX < 0 ||
    r.minZ < 0 ||
    r.maxX >= countX ||
    r.maxZ >= countZ ||
    r.minX > r.maxX ||
    r.minZ > r.maxZ
  )
    throw new Error("invalid native column query range");
  const columns: NativeActorColumn[] = [];
  for (let x = r.minX; x <= r.maxX; x++)
    for (let z = r.minZ; z <= r.maxZ; z++) {
      const column = result.columns[z][x];
      if (column) columns.push(column);
    }
  return columns;
}

/** ExtractColumns' explicit non-PP fallback; no ProcessModelsCB mutations occur. */
export function nativeSingleActorColumn(
  root: NativeOrderedActor,
): NativeActorColumnResult {
  const column: NativeActorColumn = {
    x: 0,
    z: 0,
    wrapper: root,
    tile: null,
    blendy: null,
  };
  return { resolved: true, columns: [[column]], processedColumns: [] };
}
