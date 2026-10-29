import type { PedVector } from "./ped-form";
import {
  nativePedGroundingStep,
  nativePedGroundCacheBounds,
  nativePedInsideGroundCache,
  nativePedRetainsGroundTriangle,
  nativePedSelectGroundSupport,
  NATIVE_PED_GROUND_CACHE_CAPACITIES,
  type NativePedGroundHit,
  type NativePedGroundCache,
  type NativePedGroundCollectRequest,
  type NativePedGroundEffect,
  type NativePedGroundFace,
  type NativePedGroundFaceHit,
  type NativePedGroundQuery,
  type NativePedGroundResult,
} from "./ped-grounding";
import {
  NativePedGroundCachePool,
  type NativePedGroundCacheSlot,
} from "./ped-ground-cache";
import type { NativePedInstanceResult } from "./ped-native-instance";
import type {
  NativePedRuntime,
  NativePedRuntimeCallback,
} from "./ped-native-runtime";
import type { NativePedMoveCallbackState } from "./physics/ped-active-move";

/** Gameplay/process-cache fields not owned by the character/resource core. */
export interface NativePedGroundingInput {
  action: number;
  /** Standalone fallback only. A live readProcessCache binding takes precedence. */
  processFloorNormal?: PedVector;
  cosMaxSlope: number;
  direction: PedVector;
  smoothTurnTarget: PedVector | null;
  replay: boolean;
  replayOverride: boolean;
  excludePlingMaterials: boolean;
  invalidate?: boolean;
  /** Stored ped.pos, before this visit's BON displacement. */
  pedPosition: PedVector;
  changedPoints?: readonly PedVector[];
  callbackState?: NativePedMoveCallbackState;
}
export interface NativePedGroundingOutletResult {
  requiredProviders?: readonly string[];
}
export interface NativePedGroundingProximityResult
  extends NativePedGroundingOutletResult {
  /** Only an actual process-cache writer may replace this retained normal. */
  processFloorNormal?: PedVector;
  /** Actual RescanPedProximity stores at process+0c/+10/+14. */
  processRetainedDirection?: PedVector;
}
/** Structural view of the actual currently acquired process record. The stable
 * Ped remains the face slot owner; a reused process record is not a Ped snapshot. */
export interface NativePedGroundingProcess<F extends NativePedGroundFace> {
  floorNormal: PedVector;
  retainedDirection: PedVector;
  faceCache: NativePedGroundCacheSlot<F> | null;
}
export interface NativePedGroundingOptions<
  Owner extends object,
  F extends NativePedGroundFace,
> {
  readInput: (
    context: NativePedRuntimeCallback<Owner>,
  ) => NativePedGroundingInput;
  /** Canonical mode: read the actual Ped+0c on every access. NULL is explicit
   * missing ownership, never a request to resurrect the standalone fallback. */
  readProcessCache?: (owner: Owner) => NativePedGroundingProcess<F> | null;
  collectFaces?: (
    context: NativePedRuntimeCallback<Owner>,
    request: NativePedGroundCollectRequest,
  ) => readonly F[];
  queryFace?: (
    context: NativePedRuntimeCallback<Owner>,
    face: F,
    query: NativePedGroundQuery,
  ) => NativePedGroundFaceHit | null;
  stopSmoothTurn?: (
    context: NativePedRuntimeCallback<Owner>,
  ) => NativePedGroundingOutletResult | void;
  setPedXZDirection?: (
    context: NativePedRuntimeCallback<Owner>,
    direction: PedVector,
  ) => NativePedGroundingOutletResult | void;
  /** Actual SetPedMove planner, including active-body move transitions. */
  selectMove?: (
    context: NativePedRuntimeCallback<Owner>,
    effect: Extract<NativePedGroundEffect, { kind: "select-move" }>,
  ) => NativePedGroundingOutletResult | void;
  setAction?: (
    context: NativePedRuntimeCallback<Owner>,
    action: 3,
  ) => NativePedGroundingOutletResult | void;
  /** Source vanish event, level0 and render/resource release belong together. */
  vanish?: (
    context: NativePedRuntimeCallback<Owner>,
    effect: Extract<NativePedGroundEffect, { kind: "vanish" }>,
  ) => NativePedGroundingOutletResult | void;
  /** Receives the source recache output before BON advance. The full ordinary
   * proximity/turn/avoidance owner retains its later gates and cache writers. */
  proximityRescan?: (
    context: NativePedRuntimeCallback<Owner>,
    result: NativePedGroundResult<F, NativePedGroundCacheSlot<F>>,
  ) => NativePedGroundingProximityResult | void;
}
export interface NativePedGroundingState<F extends NativePedGroundFace> {
  cache: NativePedGroundCache<F, NativePedGroundCacheSlot<F>> | null;
  processFloorNormal: PedVector;
  lastResult: NativePedGroundResult<F, NativePedGroundCacheSlot<F>> | null;
  requiredProviders: readonly string[];
}
export interface NativePedGroundingVisit<F extends NativePedGroundFace> {
  ground: NativePedGroundResult<F, NativePedGroundCacheSlot<F>>;
  completion: NativePedInstanceResult;
}
export interface NativePedGroundRecacheResult<F extends NativePedGroundFace> {
  status: "complete" | "provider-required";
  requiredProviders: string[];
  cache: NativePedGroundCache<F, NativePedGroundCacheSlot<F>> | null;
  hit: NativePedGroundHit<F> | null;
  needGround: boolean;
  needProximityRescan: boolean;
  rebuilt: boolean;
  overflow: boolean;
}
const f = Math.fround;
function vector(value: PedVector): PedVector {
  if (
    value.length !== 3 ||
    value.some((n) => !Number.isFinite(n) || !Number.isFinite(f(n)))
  )
    throw new Error("Native grounding requires a finite process vector");
  return [f(value[0]), f(value[1]), f(value[2])];
}
function completion(
  requiredProviders: readonly string[],
): NativePedInstanceResult {
  return {
    status: requiredProviders.length ? "provider-required" : "complete",
    requiredProviders: [...new Set(requiredProviders)],
    processedFrames: 0,
    completedMove: false,
  };
}

/** Concrete current-root/cache owner, installed4d1b30/4d3e62. One instance
 * serves the whole population, with all85 native slots shared. This bridge
 * never advances a BON clock or supplies an estimated ground/launch vector. */
export class NativePedGrounding<
  Owner extends object,
  F extends NativePedGroundFace,
> {
  readonly pool: NativePedGroundCachePool<F>;
  private states = new WeakMap<Owner, NativePedGroundingState<F>>();
  constructor(
    private readonly runtime: NativePedRuntime<Owner>,
    private readonly options: NativePedGroundingOptions<Owner, F>,
  ) {
    this.pool = new NativePedGroundCachePool((owner, slot) => {
      //4d1fe9 clears the old process's pointer before the slot is overwritten.
      if (this.options.readProcessCache) {
        const process = this.process(owner as Owner);
        if (process.faceCache !== slot)
          throw new Error(
            "Native grounding evicted process face pointer changed",
          );
        process.faceCache = null;
      } else {
        const previous = this.states.get(owner as Owner);
        if (previous) previous.cache = null;
      }
    });
  }
  state(owner: Owner): NativePedGroundingState<F> | null {
    return this.states.get(owner) ?? null;
  }
  /** Completion/source geometry owners invalidate, rather than destroy, a list. */
  invalidate(owner: Owner): void {
    this.invalidated.add(owner);
  }
  private invalidated = new WeakSet<Owner>();
  private process(owner: Owner): NativePedGroundingProcess<F> {
    const process = this.options.readProcessCache?.(owner);
    if (!process)
      throw new Error(
        "Native grounding requires the current process cache owner",
      );
    return process;
  }
  private cacheForProcess(
    owner: Owner,
    process: NativePedGroundingProcess<F>,
  ): NativePedGroundCache<F, NativePedGroundCacheSlot<F>> | null {
    const slot = process.faceCache;
    if (!slot) {
      if (this.pool.get(owner))
        throw new Error("Native grounding process lost its borrowed face slot");
      return null;
    }
    if (
      slot.owner === null ||
      this.pool.get(slot.owner) !== slot ||
      (slot.selectedFace !== null &&
        !this.pool.ownsFaceRecord(slot, slot.selectedFace))
    )
      throw new Error("Stale native grounding process face slot identity");
    return {
      identity: slot,
      bounds: slot.bounds,
      capacity: slot.capacity,
      faces: slot.faces,
      selectedFace: slot.selectedFace,
    };
  }
  private createState(
    owner: Owner,
    input: NativePedGroundingInput,
  ): NativePedGroundingState<F> {
    if (!this.options.readProcessCache) {
      if (!input.processFloorNormal)
        throw new Error(
          "Standalone native grounding requires its retained floor normal",
        );
      return {
        cache: null,
        processFloorNormal: vector(input.processFloorNormal),
        lastResult: null,
        requiredProviders: [],
      };
    }
    const bridge = this;
    return {
      get cache() {
        const process = bridge.options.readProcessCache!(owner);
        return process ? bridge.cacheForProcess(owner, process) : null;
      },
      set cache(cache) {
        const process = bridge.process(owner);
        if (cache) {
          const slot = cache.identity;
          if (slot.owner !== owner || bridge.pool.get(owner) !== slot)
            throw new Error(
              "Native grounding cannot bind an unowned face slot",
            );
          if (
            cache.selectedFace !== null &&
            !slot.faces.includes(cache.selectedFace)
          )
            throw new Error(
              "Native grounding selected face is outside its slot",
            );
          slot.selectedFace = cache.selectedFace;
          process.faceCache = slot;
        } else process.faceCache = null;
      },
      get processFloorNormal() {
        return vector(bridge.process(owner).floorNormal);
      },
      set processFloorNormal(normal) {
        bridge.process(owner).floorNormal = vector(normal);
      },
      lastResult: null,
      requiredProviders: [],
    };
  }
  setProcessFloorNormal(owner: Owner, normal: PedVector): void {
    if (this.options.readProcessCache) {
      this.process(owner).floorNormal = vector(normal);
      return;
    }
    const state = this.states.get(owner);
    if (!state)
      throw new Error("Native grounding process owner is not initialized");
    state.processFloorNormal = vector(normal);
  }
  setProcessRetainedDirection(owner: Owner, direction: PedVector): void {
    this.process(owner).retainedDirection = vector(direction);
  }
  /** Source InitProcessData clears the specific borrowed slot owner after the
   * old Ped+0c was cleared. The caller subsequently clears process+b0 itself. */
  releaseBorrowedFaceSlot(slot: NativePedGroundCacheSlot<F>): void {
    const owner = slot.owner;
    this.pool.releaseSlot(slot);
    if (!this.options.readProcessCache && owner !== null) {
      const state = this.states.get(owner as Owner);
      if (state?.cache?.identity === slot) state.cache = null;
    }
  }
  /** Installed CBMoveCompleted4cbfa3..4cbfa9 releases only the borrowed
   * face-list slot and process cache+b0, retaining the process and its normal. */
  releaseFaceCache(owner: Owner): void {
    if (this.options.readProcessCache) {
      const process = this.process(owner);
      const slot = this.cacheForProcess(owner, process)?.identity;
      if (slot) this.releaseBorrowedFaceSlot(slot);
      process.faceCache = null;
      return;
    }
    this.pool.release(owner);
    const state = this.states.get(owner);
    if (state) state.cache = null;
  }
  release(owner: Owner): void {
    if (this.options.readProcessCache) {
      if (this.options.readProcessCache(owner)) this.releaseFaceCache(owner);
      else if (this.pool.get(owner))
        throw new Error(
          "Release the borrowed face slot before its process owner",
        );
    } else this.pool.release(owner);
    this.states.delete(owner);
    this.invalidated.delete(owner);
  }
  reset(): void {
    if (this.options.readProcessCache)
      for (const capacity of [5, 10, 40, 75] as const)
        for (const slot of this.pool.order(capacity)) {
          if (slot.owner === null) continue;
          const process = this.options.readProcessCache(slot.owner as Owner);
          if (process?.faceCache === slot) process.faceCache = null;
        }
    this.pool.reset();
    this.states = new WeakMap();
    this.invalidated = new WeakSet();
  }
  /** RecacheAndSetFace4d1b30 without its ordinary Munge caller. This is also
   * the forced living-halt/recovery outlet: it does not gate on action or active
   * physics, move/rotate a root, clear Munge flags, activate PHIL, or choose fall.
   * One call performs one acquisition; a caller owning a native NULL retry must
   * make that retry explicitly. The canonical85 slots remain this owner's. */
  recache(
    ctx: NativePedRuntimeCallback<Owner>,
    force = false,
  ): NativePedGroundRecacheResult<F> {
    if (
      this.runtime.character(ctx.owner) !== ctx.character ||
      ctx.character.instance !== ctx.instance ||
      ctx.character.body !== ctx.body
    )
      throw new Error(
        "Native recache requires current character/ACT/body ownership",
      );
    if (
      !Number.isInteger(ctx.timeMs) ||
      ctx.timeMs < 0 ||
      ctx.timeMs > 0xffffffff
    )
      throw new Error("Native recache clock must be uint32");
    const input = this.options.readInput(ctx),
      owner = ctx.owner;
    let state = this.states.get(owner);
    if (!state) {
      state = this.createState(owner, input);
      this.states.set(owner, state);
    }
    const result: NativePedGroundRecacheResult<F> = {
      status: "complete",
      requiredProviders: [],
      cache: state.cache,
      hit: null,
      needGround: false,
      needProximityRescan: false,
      rebuilt: false,
      overflow: false,
    };
    const require = (...names: string[]) => {
      result.status = "provider-required";
      result.requiredProviders.push(...names);
      state!.requiredProviders = result.requiredProviders;
      for (const name of names) ctx.character.diagnostics.add(name);
      return result;
    };
    if (this.options.readProcessCache && !this.options.readProcessCache(owner))
      return require("source-ground-current-process-cache-owner");
    const root: PedVector = [
      ctx.instance.rootPose[9],
      ctx.instance.rootPose[10],
      ctx.instance.rootPose[11],
    ];
    let cache = state.cache;
    const rebuild =
      force ||
      this.invalidated.has(owner) ||
      !cache ||
      !nativePedInsideGroundCache(root, cache.bounds);
    if (
      !rebuild &&
      cache?.selectedFace &&
      nativePedRetainsGroundTriangle(cache.selectedFace, root)
    )
      return result;
    if (rebuild && ctx.character.hitPoints <= 0 && !input.replayOverride) {
      if (!this.options.selectMove) return require("source-ground-selectMove");
      const outlet = this.options.selectMove(ctx, {
        kind: "select-move",
        move: 94,
        period: -1,
        restart: 0,
        completion: 1,
        action: 6,
        timeMs: ctx.timeMs,
      });
      if (outlet?.requiredProviders?.length)
        return require(...outlet.requiredProviders);
      result.needGround = cache !== null;
      result.needProximityRescan = true;
      return result;
    }
    const missing = [
      ...(!this.options.queryFace ? ["source-ground-queryFace"] : []),
      ...(rebuild && !this.options.collectFaces
        ? ["source-ground-collectFaces"]
        : []),
    ];
    if (missing.length) return require(...missing);
    const slot0 = ctx.instance.template.form.moves[0];
    const clearance = slot0
      ? (ctx.instance.template.profile.movement.get(slot0.id)
          ?.groundingOffset ?? 0)
      : 0;
    if (rebuild) {
      const bounds = nativePedGroundCacheBounds(
        ctx.instance.rootPose,
        ctx.instance.movement.subarray(0, 9),
        ctx.instance.template.profile.jumpHeight,
      );
      const collected = this.options.collectFaces!(ctx, {
        ...bounds,
        limit: 76,
        owner,
        timeMs: ctx.timeMs,
      });
      if (collected.length > 76)
        throw new Error("Native recache collector exceeded76 records");
      result.overflow = collected.length > 75;
      const faces = collected.slice(0, 75);
      const capacity = NATIVE_PED_GROUND_CACHE_CAPACITIES.find(
        (count) => faces.length <= count,
      )!;
      const slot = this.pool.acquire({
        previous: cache,
        preferredIdentity: cache?.capacity === capacity ? cache.identity : null,
        capacity,
        faces,
        bounds: bounds.worldBounds,
        owner,
        timeMs: ctx.timeMs,
      });
      if (this.options.readProcessCache) this.process(owner).faceCache = slot;
      cache = {
        identity: slot,
        bounds: slot.bounds,
        capacity,
        faces: slot.faces,
        selectedFace: null,
      };
      result.rebuilt = true;
      result.needProximityRescan = true;
    }
    const old = cache!.selectedFace;
    const hit = nativePedSelectGroundSupport(
      cache!.faces,
      root,
      clearance,
      (face, query) => this.options.queryFace!(ctx, face, query),
      input.excludePlingMaterials,
    );
    if (!rebuild) {
      const normal = state.processFloorNormal;
      result.needProximityRescan =
        !old ||
        !hit ||
        normal[1] * old.normal[1] +
          normal[2] * old.normal[2] +
          normal[0] * old.normal[0] <
          0.99;
    }
    cache = { ...cache!, selectedFace: hit?.face ?? null };
    cache.identity.selectedFace = cache.selectedFace;
    state.cache = cache;
    state.requiredProviders = [];
    this.invalidated.delete(owner);
    result.cache = cache;
    result.hit = hit;
    result.needGround = true;
    return result;
  }
  /** Callable NativePedRuntimeHooks.beforePose; runtime advances BON afterward. */
  readonly beforePose = (
    context: NativePedRuntimeCallback<Owner>,
  ): NativePedInstanceResult => this.advance(context).completion;

  advance(ctx: NativePedRuntimeCallback<Owner>): NativePedGroundingVisit<F> {
    if (
      this.runtime.character(ctx.owner) !== ctx.character ||
      ctx.character.instance !== ctx.instance ||
      ctx.character.body !== ctx.body
    )
      throw new Error(
        "Native grounding requires current owner/ACT/body resources",
      );
    if (
      !Number.isInteger(ctx.timeMs) ||
      ctx.timeMs < 0 ||
      ctx.timeMs > 0xffffffff
    )
      throw new Error("Native grounding clock must be uint32");
    const input = this.options.readInput(ctx),
      owner = ctx.owner,
      c = ctx.character,
      instance = ctx.instance,
      profile = instance.template.profile;
    let state = this.states.get(owner);
    if (!state) {
      state = this.createState(owner, input);
      this.states.set(owner, state);
    }
    if (
      this.options.readProcessCache &&
      !this.options.readProcessCache(owner)
    ) {
      const ground: NativePedGroundResult<F, NativePedGroundCacheSlot<F>> = {
        status: "provider-required",
        cache: null,
        hit: null,
        needGround: false,
        needProximityRescan: false,
        rebuilt: false,
        overflow: false,
        attempts: 0,
        flags: c.flags,
        action: input.action,
        effects: [],
        missingProviders: [],
      };
      state.lastResult = ground;
      state.requiredProviders = ["source-ground-current-process-cache-owner"];
      c.diagnostics.add(state.requiredProviders[0]);
      return { ground, completion: completion(state.requiredProviders) };
    }
    const slot0 = instance.template.form.moves[0],
      current = instance.move?.asset.personality;
    // Native allocation initializes unmatched movement slots with offset0.
    const slot0Clearance = slot0
      ? (profile.movement.get(slot0.id)?.groundingOffset ?? 0)
      : 0;
    let result = nativePedGroundingStep(
      {
        owner,
        rootPose: instance.rootPose,
        characterBasis: instance.movement.subarray(0, 9),
        cache: state.cache,
        processFloorNormal: state.processFloorNormal,
        slot0Clearance,
        currentMoveClearance: current?.groundingOffset ?? 0,
        jumpHeight: profile.jumpHeight,
        cosMaxSlope: input.cosMaxSlope,
        physicsFlags: c.physicsFlags,
        flags: c.flags,
        action: input.action,
        hitPoints: c.hitPoints,
        timeMs: ctx.timeMs,
        direction: input.direction,
        smoothTurnTarget: input.smoothTurnTarget,
        replay: input.replay,
        replayOverride: input.replayOverride,
        excludePlingMaterials: input.excludePlingMaterials,
        invalidate: input.invalidate || this.invalidated.has(owner),
        pedPosition: input.pedPosition,
        changedPoints: input.changedPoints,
      },
      {
        collectFaces: this.options.collectFaces
          ? (request) => this.options.collectFaces!(ctx, request)
          : undefined,
        queryFace: this.options.queryFace
          ? (face, query) => this.options.queryFace!(ctx, face, query)
          : undefined,
        acquireCache: (request) => {
          const slot = this.pool.acquire(request);
          //4d2093 publishes process+b0 before the finite support query.
          if (this.options.readProcessCache)
            this.process(owner).faceCache = slot;
          return slot;
        },
      },
    );
    // Kernel acquisition queried collector scratch. Native memcpy stores its
    // own records: rebind BOTH selected-face pointers to that stable slot copy.
    if (result.cache && result.status !== "bypassed") {
      const cache = result.cache,
        slot = cache.identity,
        selectedIndex = cache.selectedFace
          ? cache.faces.indexOf(cache.selectedFace)
          : -1,
        hitIndex = result.hit ? cache.faces.indexOf(result.hit.face) : -1;
      if (slot.owner !== owner || slot.faces.length !== cache.faces.length)
        throw new Error("Native grounding cache owner/record mapping changed");
      result = {
        ...result,
        cache: {
          identity: slot,
          bounds: slot.bounds,
          capacity: slot.capacity,
          faces: slot.faces,
          selectedFace: selectedIndex < 0 ? null : slot.faces[selectedIndex],
        },
        hit: result.hit ? { ...result.hit, face: slot.faces[hitIndex] } : null,
      };
      slot.selectedFace = result.cache!.selectedFace;
      if (hitIndex < 0 && result.hit)
        throw new Error("Native grounding hit is outside its retained list");
    }
    // Replay singleton aliases may observe another Ped's actual slot pointer.
    // A bypass reads no support state and must not relink that borrowed slot.
    if (result.status !== "bypassed") state.cache = result.cache;
    state.lastResult = result;
    const missing: string[] = result.missingProviders.map(
      (name) => `source-ground-${name}`,
    );
    if (result.status !== "bypassed" && !current)
      missing.push("source-ground-current-personality-move");
    const proximity =
      result.needProximityRescan &&
      !!result.cache?.selectedFace &&
      !(c.physicsFlags & 4) &&
      c.hitPoints > 0 &&
      result.status !== "fall";
    // Preflight all named outlets before changing flags/root or activating PHIL.
    for (const effect of result.effects) {
      const key = {
        "stop-smooth-turn": "stopSmoothTurn",
        "set-direction": "setPedXZDirection",
        "select-move": "selectMove",
        "set-action": "setAction",
        vanish: "vanish",
      }[effect.kind as string] as
        | keyof NativePedGroundingOptions<Owner, F>
        | undefined;
      if (key && !this.options[key]) missing.push(`source-ground-${key}`);
      if (effect.kind === "set-position" && !result.hit)
        throw new Error(
          "Native grounding position effect requires its raw hit",
        );
    }
    if (proximity && !this.options.proximityRescan)
      missing.push("source-ground-proximityRescan");
    if (!missing.length) {
      // MakePedVanish owns its event BEFORE storing newly set flag80. Pass
      // that final mask to the outlet without committing it ahead of the event.
      this.runtime.updateState(owner, {
        flags: result.status === "vanish" ? result.flags & ~0x80 : result.flags,
      });
      this.invalidated.delete(owner);
      const accept = (outlet: NativePedGroundingOutletResult | void) => {
        if (outlet !== undefined) {
          if (
            typeof outlet !== "object" ||
            outlet === null ||
            (outlet.requiredProviders !== undefined &&
              (!Array.isArray(outlet.requiredProviders) ||
                outlet.requiredProviders.some(
                  (name) => typeof name !== "string",
                )))
          )
            throw new Error("Invalid native grounding outlet result");
          missing.push(...(outlet.requiredProviders ?? []));
        }
      };
      for (const effect of result.effects) {
        switch (effect.kind) {
          case "set-position":
            //40b0a0 adds current clearance itself. effect.position already has
            // that offset and MUST NOT be passed as the raw finite hit.
            accept(
              this.runtime.setGroundPosition(
                owner,
                result.hit!.point,
                input.callbackState,
              ),
            );
            break;
          case "stop-smooth-turn":
            accept(this.options.stopSmoothTurn!(ctx));
            break;
          case "set-direction":
            accept(this.options.setPedXZDirection!(ctx, effect.direction));
            break;
          case "set-physics-level":
            if (!this.runtime.activate(owner))
              missing.push("source-ground-live-activation");
            break;
          case "select-move":
            accept(this.options.selectMove!(ctx, effect));
            break;
          case "set-action":
            accept(this.options.setAction!(ctx, effect.action));
            break;
          case "vanish":
            accept(this.options.vanish!(ctx, effect));
            break;
        }
        if (missing.length) break;
      }
      if (!missing.length && proximity) {
        const outlet = this.options.proximityRescan!(ctx, result);
        accept(outlet);
        if (outlet?.processFloorNormal)
          state.processFloorNormal = vector(outlet.processFloorNormal);
        if (outlet?.processRetainedDirection)
          this.setProcessRetainedDirection(
            owner,
            outlet.processRetainedDirection,
          );
      }
    }
    state.requiredProviders = [...new Set(missing)];
    if (missing.length && result.status === "supported" && state.cache) {
      // An incomplete host effect is not native execution. Do not let next
      // visit's triangle-retention shortcut accept a root that was never fully
      // grounded/reoriented. Retain the actual allocated list for reselection.
      state.cache = { ...state.cache, selectedFace: null };
      state.cache.identity.selectedFace = null;
    }
    for (const name of state.requiredProviders) c.diagnostics.add(name);
    return { ground: result, completion: completion(state.requiredProviders) };
  }
}
