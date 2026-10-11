import type { PedVector } from "./ped-form";
import {
  nativePedGroundingStep,
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
  /** Actual process-cache floor normal; used only when this owner is first seen. */
  processFloorNormal: PedVector;
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
}
export interface NativePedGroundingOptions<
  Owner extends object,
  F extends NativePedGroundFace,
> {
  readInput: (
    context: NativePedRuntimeCallback<Owner>,
  ) => NativePedGroundingInput;
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
    this.pool = new NativePedGroundCachePool((owner) => {
      //4d1fe9 clears the old process's pointer before the slot is overwritten.
      const previous = this.states.get(owner as Owner);
      if (previous) previous.cache = null;
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
  setProcessFloorNormal(owner: Owner, normal: PedVector): void {
    const state = this.states.get(owner);
    if (!state)
      throw new Error("Native grounding process owner is not initialized");
    state.processFloorNormal = vector(normal);
  }
  /** Installed CBMoveCompleted4cbfa3..4cbfa9 releases only the borrowed
   * face-list slot and process cache+b0, retaining the process and its normal. */
  releaseFaceCache(owner: Owner): void {
    this.pool.release(owner);
    const state = this.states.get(owner);
    if (state) state.cache = null;
  }
  release(owner: Owner): void {
    this.pool.release(owner);
    this.states.delete(owner);
    this.invalidated.delete(owner);
  }
  reset(): void {
    this.pool.reset();
    this.states = new WeakMap();
    this.invalidated = new WeakSet();
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
      state = {
        cache: null,
        processFloorNormal: vector(input.processFloorNormal),
        lastResult: null,
        requiredProviders: [],
      };
      this.states.set(owner, state);
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
        acquireCache: (request) => this.pool.acquire(request),
      },
    );
    // Kernel acquisition queried collector scratch. Native memcpy stores its
    // own records: rebind BOTH selected-face pointers to that stable slot copy.
    if (result.cache) {
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
      if (hitIndex < 0 && result.hit)
        throw new Error("Native grounding hit is outside its retained list");
    }
    state.cache = result.cache;
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
      }
    }
    state.requiredProviders = [...new Set(missing)];
    if (missing.length && result.status === "supported" && state.cache) {
      // An incomplete host effect is not native execution. Do not let next
      // visit's triangle-retention shortcut accept a root that was never fully
      // grounded/reoriented. Retain the actual allocated list for reselection.
      state.cache = { ...state.cache, selectedFace: null };
    }
    for (const name of state.requiredProviders) c.diagnostics.add(name);
    return { ground: result, completion: completion(state.requiredProviders) };
  }
}
