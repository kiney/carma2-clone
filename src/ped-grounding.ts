/** Current-root support phase, installed 4d1b30/4d3e62.
 * Evidence: docs/c2-ped-grounding-re.md. This kernel does not allocate native
 * cache lists, traverse actors or replace CheckSingleFace with a scene ray. */
import {
  groundPedRootOrigin,
  transformPedPoint,
  type PedBounds,
  type PedVector,
} from "./ped-form";

const f = Math.fround;
export const NATIVE_PED_GROUND_CACHE_CAPACITIES = [5, 10, 40, 75] as const;
export type NativePedGroundCacheCapacity =
  (typeof NATIVE_PED_GROUND_CACHE_CAPACITIES)[number];
export interface NativePedGroundFace {
  a: PedVector;
  b: PedVector;
  c: PedVector;
  normal: PedVector;
  /** Source face +40 byte, separate from material flags. */
  rawFlags: number;
  materialIdentifier?: string | null;
}
export interface NativePedGroundFaceHit {
  /** Actual CheckSingleFace finite-segment parameter and output point. */
  parameter: number;
  point: PedVector;
}
export interface NativePedGroundHit<F extends NativePedGroundFace>
  extends NativePedGroundFaceHit {
  face: F;
  pass: 0 | 1;
  origin: PedVector;
}
export interface NativePedGroundCache<
  F extends NativePedGroundFace,
  Identity = unknown,
> {
  identity: Identity;
  bounds: PedBounds;
  capacity: NativePedGroundCacheCapacity;
  faces: readonly F[];
  selectedFace: F | null;
}
export interface NativePedGroundQuery {
  origin: PedVector;
  segment: PedVector;
  /** Source gEnablePlingMaterials; provider retains other sided/material rules. */
  excludePlingMaterials: boolean;
}
export interface NativePedGroundCollectRequest {
  /** Actual character basis +5c..7c with current root translation. */
  characterPose: Float32Array;
  localBounds: PedBounds;
  worldBounds: PedBounds;
  limit: 76;
  owner: unknown;
  timeMs: number;
}
export interface NativePedGroundAcquireRequest<
  F extends NativePedGroundFace,
  Identity,
> {
  previous: NativePedGroundCache<F, Identity> | null;
  /** Native reuse is allowed only for the same capacity bucket. */
  preferredIdentity: Identity | null;
  capacity: NativePedGroundCacheCapacity;
  faces: readonly F[];
  bounds: PedBounds;
  owner: unknown;
  timeMs: number;
}
export interface NativePedGroundProviders<
  F extends NativePedGroundFace,
  Identity = unknown,
> {
  /** Read-only finite-face query. Must preserve installed CheckSingleFace
   * material/sided/endpoint policy; wheel MultiRay is a different helper. */
  queryFace?: (
    face: F,
    query: NativePedGroundQuery,
  ) => NativePedGroundFaceHit | null;
  /** Ordered ACT collector; at most the requested 76 records. */
  collectFaces?: (request: NativePedGroundCollectRequest) => readonly F[];
  /** Actual cache owner supplies bucket rotation, eviction and owner unlinking.
   * Returning null means allocation unavailable, not an unsupported floor. */
  acquireCache?: (
    request: NativePedGroundAcquireRequest<F, Identity>,
  ) => Identity | null;
}
export interface NativePedGroundInput<
  F extends NativePedGroundFace,
  Identity = unknown,
> {
  owner: unknown;
  rootPose: ArrayLike<number>;
  /** Nine native basis scalars. Never reconstructed/normalized from heading. */
  characterBasis: ArrayLike<number>;
  cache: NativePedGroundCache<F, Identity> | null;
  processFloorNormal: PedVector;
  slot0Clearance: number;
  currentMoveClearance: number;
  jumpHeight: number;
  cosMaxSlope: number;
  physicsFlags: number;
  flags: number;
  action: number;
  /** Signed native pedestrian HP byte. */
  hitPoints: number;
  timeMs: number;
  direction: PedVector;
  smoothTurnTarget: PedVector | null;
  replay: boolean;
  replayOverride: boolean;
  excludePlingMaterials: boolean;
  invalidate?: boolean;
  /** Changed-point comparison uses stored ped.pos, which can differ from root. */
  pedPosition?: PedVector;
  changedPoints?: readonly PedVector[];
}
export type NativePedGroundEffect =
  | { kind: "set-position"; mode: 1; position: PedVector }
  | { kind: "stop-smooth-turn" }
  | { kind: "set-direction"; direction: PedVector }
  | { kind: "set-physics-level"; level: 5 }
  | {
      kind: "select-move";
      move: 72 | 94;
      period: -1;
      restart: 0;
      completion: 0 | 1;
      action: 3 | 6;
      timeMs: number;
    }
  | { kind: "set-action"; action: 3 }
  /** Host performs source vanish event, flag80 store, level0 and render release. */
  | { kind: "vanish"; flags: number; physicsLevel: 0; releaseRender: true };
export interface NativePedGroundResult<
  F extends NativePedGroundFace,
  Identity = unknown,
> {
  status:
    | "bypassed"
    | "retained"
    | "supported"
    | "fall"
    | "vanish"
    | "already-vanished"
    | "dead-cache-move"
    | "allocation-failed"
    | "provider-required";
  cache: NativePedGroundCache<F, Identity> | null;
  hit: NativePedGroundHit<F> | null;
  needGround: boolean;
  needProximityRescan: boolean;
  rebuilt: boolean;
  overflow: boolean;
  attempts: number;
  flags: number;
  action: number;
  effects: readonly NativePedGroundEffect[];
  missingProviders: readonly ("queryFace" | "collectFaces" | "acquireCache")[];
}

function scalar(n: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(f(n)))
    throw new Error(
      "Native pedestrian grounding requires finite Float32 scalars",
    );
  return f(n);
}
function vector(v: PedVector): PedVector {
  if (v.length !== 3) throw new Error("Invalid native grounding vector");
  return [scalar(v[0]), scalar(v[1]), scalar(v[2])];
}
function matrix(a: ArrayLike<number>, count: number): Float32Array {
  if (a.length !== count)
    throw new Error(`Expected native ${count}-scalar pose`);
  return Float32Array.from(a, scalar);
}
function checkFace(face: NativePedGroundFace): void {
  vector(face.a);
  vector(face.b);
  vector(face.c);
  vector(face.normal);
  if (
    !Number.isInteger(face.rawFlags) ||
    face.rawFlags < 0 ||
    face.rawFlags > 255
  )
    throw new Error("Invalid native grounding raw face byte");
}
function checkCache<F extends NativePedGroundFace, I>(
  cache: NativePedGroundCache<F, I>,
): void {
  const min = vector(cache.bounds.min),
    max = vector(cache.bounds.max);
  if (
    min.some((v, i) => v > max[i]) ||
    !NATIVE_PED_GROUND_CACHE_CAPACITIES.includes(cache.capacity) ||
    cache.faces.length > cache.capacity ||
    cache.identity === null ||
    cache.identity === undefined
  )
    throw new Error("Invalid native grounding cache storage");
  cache.faces.forEach(checkFace);
  if (cache.selectedFace !== null && !cache.faces.includes(cache.selectedFace))
    throw new Error("Selected native grounding face is outside its cache");
}

/** Installed partial Float32 spills at 4d1c24..4d1d36. Edges and zero products
 * retain support. Unspilled operations use JS double, not an invented epsilon. */
export function nativePedRetainsGroundTriangle(
  face: NativePedGroundFace,
  position: PedVector,
): boolean {
  checkFace(face);
  const [ax, , az] = vector(face.a),
    [bx, , bz] = vector(face.b),
    [cx, , cz] = vector(face.c),
    [px, , pz] = vector(position);
  const bax = bx - ax,
    baxF = f(bax),
    bazF = f(bz - az),
    pazF = f(pz - az),
    paxF = f(px - ax),
    cax = cx - ax,
    caz = cz - az;
  if ((bax * pazF - bazF * paxF) * (baxF * caz - bazF * cax) < 0) return false;
  if ((cax * bazF - caz * baxF) * (cax * pazF - f(caz) * paxF) < 0)
    return false;
  const cbxF = f(cx - bx),
    cbz = cz - bz;
  return (
    ((pz - bz) * cbxF - (px - bx) * cbz) *
      ((az - bz) * cbxF - (ax - bx) * cbz) >=
    0
  );
}

/** 4d1b7c..4d1bfa tests AH,41 then JE rebuild: finite equality retains.
 * The differences are not spilled before comparing with the double constant. */
export function nativePedInsideGroundCache(
  position: PedVector,
  bounds: PedBounds,
): boolean {
  const p = vector(position),
    min = vector(bounds.min),
    max = vector(bounds.max),
    margin = -1.5 / 6.9;
  return p.every((n, i) => n - max[i] <= margin && min[i] - n <= margin);
}

/** 4d3de8..4d3e2e: X/Z differences spill without replacing their live x87
 * values; Y is squared unspilled. Strict double400 comparison. */
export function nativePedGroundChangedNear(
  position: PedVector,
  points: readonly PedVector[],
): boolean {
  const p = vector(position);
  return points.some((point) => {
    const q = vector(point),
      dx = p[0] - q[0],
      dy = p[1] - q[1],
      dz = p[2] - q[2];
    return dx * f(dx) + dy * dy + dz * f(dz) < 400;
  });
}

/** Local source box and transformed AABB (4d1e61..4d1f18/45fb90).
 * Uses character orientation, with current ACT root translation. */
export function nativePedGroundCacheBounds(
  rootPose: ArrayLike<number>,
  characterBasis: ArrayLike<number>,
  jumpHeight: number,
): Pick<
  NativePedGroundCollectRequest,
  "characterPose" | "localBounds" | "worldBounds"
> {
  const root = matrix(rootPose, 12),
    basis = matrix(characterBasis, 9),
    jump = scalar(jumpHeight),
    pose = new Float32Array(12);
  pose.set(basis);
  pose.set(root.subarray(9), 9);
  const localBounds: PedBounds = {
    min: [f(-3 / 6.9), f(-2.5 / 6.9 - jump), f(-2 / 6.9)],
    max: [f(3 / 6.9), f(2.5 / 6.9 + jump), f(10 / 6.9)],
  };
  const base = transformPedPoint(pose, localBounds.min),
    extent = localBounds.max.map((n, i) => f(n - localBounds.min[i])),
    contributions = extent.map((n, i) =>
      [0, 1, 2].map((j) => f(n * basis[i * 3 + j])),
    );
  const min = [0, 1, 2].map((j) =>
      f(
        Math.min(contributions[2][j], 0) +
          Math.min(contributions[1][j], 0) +
          Math.min(contributions[0][j], 0) +
          base[j],
      ),
    ),
    max = [0, 1, 2].map((j) =>
      f(
        Math.max(contributions[0][j], 0) +
          Math.max(contributions[2][j], 0) +
          Math.max(contributions[1][j], 0) +
          base[j],
      ),
    );
  return {
    characterPose: pose,
    localBounds,
    worldBounds: {
      min: vector(min as [number, number, number]),
      max: vector(max as [number, number, number]),
    },
  };
}

/** Ordered 422610 selection followed by the conditional 461e29 second cast.
 * Query provider owns finite feature, denominator and endpoint tolerances. */
export function nativePedSelectGroundSupport<F extends NativePedGroundFace>(
  faces: readonly F[],
  root: PedVector,
  slot0Clearance: number,
  queryFace: NonNullable<NativePedGroundProviders<F>["queryFace"]>,
  excludePlingMaterials: boolean,
): NativePedGroundHit<F> | null {
  const position = vector(root),
    clearance = scalar(slot0Clearance);
  for (let pass = 0; pass < (clearance !== 0 ? 2 : 1); pass++) {
    const origin: PedVector =
      pass === 0
        ? position
        : [position[0], f(position[1] + clearance), position[2]];
    let best = 2,
      selected: NativePedGroundHit<F> | null = null;
    for (const face of faces) {
      checkFace(face);
      if (face.rawFlags & 0x80) continue;
      if (excludePlingMaterials && /^[!>?]/.test(face.materialIdentifier ?? ""))
        continue;
      const hit = queryFace(face, {
        origin,
        segment: [0, -1, 0],
        excludePlingMaterials,
      });
      if (hit === null) continue;
      const parameter = scalar(hit.parameter),
        point = vector(hit.point);
      if (parameter < best) {
        best = parameter;
        selected = { face, parameter, point, origin, pass: pass as 0 | 1 };
      }
    }
    if (selected) return selected;
  }
  return null;
}

/** One ordinary outer visit. Input state is never mutated. Returned effects
 * must be applied in order by the real character/cache/body owner before BON
 * advance; level5 means live native activation, with no kick or spin. */
export function nativePedGroundingStep<F extends NativePedGroundFace, I>(
  input: NativePedGroundInput<F, I>,
  providers: NativePedGroundProviders<F, I> = {},
): NativePedGroundResult<F, I> {
  if (
    !Number.isInteger(input.hitPoints) ||
    input.hitPoints < -128 ||
    input.hitPoints > 127
  )
    throw new Error("Native pedestrian grounding HP must be a signed byte");
  const result: NativePedGroundResult<F, I> = {
    status: "bypassed",
    cache: input.cache,
    hit: null,
    needGround: false,
    needProximityRescan: false,
    rebuilt: false,
    overflow: false,
    attempts: 0,
    flags: input.flags,
    action: input.action,
    effects: [],
    missingProviders: [],
  };
  if (
    input.physicsFlags & 4 ||
    (input.action !== 0 && input.action !== 1) ||
    (input.replay && !input.replayOverride)
  )
    return result;
  const root = matrix(input.rootPose, 12),
    position: PedVector = [root[9], root[10], root[11]],
    normal = vector(input.processFloorNormal),
    direction = vector(input.direction),
    clearance = scalar(input.slot0Clearance),
    currentClearance = scalar(input.currentMoveClearance),
    jumpHeight = scalar(input.jumpHeight),
    cosSlope = scalar(input.cosMaxSlope);
  if (!Number.isFinite(input.timeMs))
    throw new Error("Invalid native grounding clock");
  if (input.cache) checkCache(input.cache);
  const invalidate =
    input.invalidate ||
    input.replayOverride ||
    nativePedGroundChangedNear(
      input.pedPosition ?? position,
      input.changedPoints ?? [],
    );
  const rebuild =
    invalidate ||
    !input.cache ||
    !nativePedInsideGroundCache(position, input.cache.bounds);
  result.flags &= ~6;
  if (
    !rebuild &&
    input.cache?.selectedFace &&
    nativePedRetainsGroundTriangle(input.cache.selectedFace, position)
  ) {
    result.status = "retained";
    return result;
  }
  const effects: NativePedGroundEffect[] = [];
  if (rebuild && input.hitPoints <= 0 && !input.replayOverride) {
    // 4d1e3d pushes action6, not an RNG maximum; 514610 is GetTotalTime.
    const attempts = input.cache ? 1 : 2;
    for (let i = 0; i < attempts; i++)
      effects.push({
        kind: "select-move",
        move: 94,
        period: -1,
        restart: 0,
        completion: 1,
        action: 6,
        timeMs: input.timeMs,
      });
    return {
      ...result,
      status: "dead-cache-move",
      attempts,
      action: 6,
      needGround: input.cache !== null,
      needProximityRescan: true,
      effects,
    };
  }
  const missing = [
    "queryFace",
    ...(rebuild ? ["collectFaces", "acquireCache"] : []),
  ].filter(
    (name) => !providers[name as keyof NativePedGroundProviders<F, I>],
  ) as NativePedGroundResult<F, I>["missingProviders"];
  if (missing.length)
    return {
      ...result,
      status: "provider-required",
      flags: input.flags,
      missingProviders: missing,
    };
  let cache = input.cache,
    hit: NativePedGroundHit<F> | null = null;
  if (rebuild) {
    result.rebuilt = true;
    result.needProximityRescan = true;
    const bounds = nativePedGroundCacheBounds(
      root,
      input.characterBasis,
      jumpHeight,
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      result.attempts++;
      const collected = providers.collectFaces!({
        ...bounds,
        limit: 76,
        owner: input.owner,
        timeMs: input.timeMs,
      });
      if (collected.length > 76)
        throw new Error(
          "Native grounding collector exceeded its requested limit",
        );
      collected.forEach(checkFace);
      result.overflow ||= collected.length > 75;
      const faces = collected.slice(0, 75),
        capacity = NATIVE_PED_GROUND_CACHE_CAPACITIES.find(
          (n) => faces.length <= n,
        )!;
      const identity = providers.acquireCache!({
        previous: cache,
        preferredIdentity: cache?.capacity === capacity ? cache.identity : null,
        capacity,
        faces,
        bounds: bounds.worldBounds,
        owner: input.owner,
        timeMs: input.timeMs,
      });
      cache =
        identity === null
          ? null
          : {
              identity,
              faces,
              capacity,
              bounds: bounds.worldBounds,
              selectedFace: null,
            };
      if (!cache) continue;
      checkCache(cache);
      hit = nativePedSelectGroundSupport(
        cache.faces,
        position,
        clearance,
        providers.queryFace!,
        input.excludePlingMaterials,
      );
      cache = { ...cache, selectedFace: hit?.face ?? null };
      break;
    }
    if (!cache) return { ...result, status: "allocation-failed", cache: null };
  } else {
    hit = nativePedSelectGroundSupport(
      cache!.faces,
      position,
      clearance,
      providers.queryFace!,
      input.excludePlingMaterials,
    );
    const old = cache!.selectedFace;
    result.needProximityRescan =
      !old ||
      !hit ||
      normal[1] * scalar(old.normal[1]) +
        normal[2] * scalar(old.normal[2]) +
        normal[0] * scalar(old.normal[0]) <
        0.99;
    cache = { ...cache!, selectedFace: hit?.face ?? null };
  }
  result.cache = cache;
  result.hit = hit;
  result.needGround = true;
  const drop = hit ? f(f(position[1] - hit.point[1]) - clearance) : null;
  if (
    hit &&
    drop! <= jumpHeight + 3 / 6.9 &&
    scalar(hit.face.normal[1]) > cosSlope
  ) {
    const target = groundPedRootOrigin(
      hit.point,
      hit.point[1],
      currentClearance,
    );
    effects.push({ kind: "set-position", mode: 1, position: target });
    if (input.smoothTurnTarget) effects.push({ kind: "stop-smooth-turn" });
    effects.push({
      kind: "set-direction",
      direction: input.smoothTurnTarget
        ? vector(input.smoothTurnTarget)
        : direction,
    });
    return {
      ...result,
      status: "supported",
      effects,
      needProximityRescan: true,
    };
  }
  if (!(result.flags & 0x40)) {
    if (result.flags & 0x80) return { ...result, status: "already-vanished" };
    result.flags |= 0x80;
    effects.push({
      kind: "vanish",
      flags: result.flags,
      physicsLevel: 0,
      releaseRender: true,
    });
    return { ...result, status: "vanish", effects };
  }
  result.cache = { ...cache, selectedFace: null };
  effects.push(
    { kind: "stop-smooth-turn" },
    { kind: "set-physics-level", level: 5 },
    {
      kind: "select-move",
      move: 72,
      period: -1,
      restart: 0,
      completion: 0,
      action: 3,
      timeMs: input.timeMs,
    },
    { kind: "set-action", action: 3 },
  );
  return { ...result, status: "fall", action: 3, effects };
}
