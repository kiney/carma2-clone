/** Ordinary installed C2 contact/recovery owner; see c2-ped-native-gameplay-re.md.
 * Physical launch, admission, pose and impulse ownership stay in NativePedRuntime/PHIL. */
import type {
  NativePedRuntime,
  NativePedRuntimeCallback,
  NativePedRuntimeHooks,
} from "./ped-native-runtime";
import type {
  NativePedContactContext,
  NativePedContactDispatch,
  NativePedContactResult,
} from "./physics/ped-body";
import {
  nativePedRootPose,
  resetNativePedWaterPlane,
} from "./physics/ped-body";
import type {
  PedContactSettings,
  PedContactState,
  PedCommonDamageTailInput,
} from "./physics/ped-contact";
import { createPedSeverDamageTail } from "./physics/ped-sever-contact";
import type { NativePedSeverState } from "./physics/ped-sever";
import {
  createNativeActivePedMoveCallback,
  type NativePedMoveCallbackState,
} from "./physics/ped-active-move";
import {
  completeNativePedMove,
  decideNativePedHalt,
  mutateNativePedHalt,
  sharedNativePedHaltState,
  type NativePedHaltCache,
  type NativePedHaltEffect,
  type NativePedHaltInput,
  type NativePedHaltDecision,
  type NativePedHaltSharedState,
  type NativePedHaltState,
} from "./physics/ped-halt";
import type { PedVector } from "./ped-form";
import type { NativePedInstanceResult } from "./ped-native-instance";
import { createNativePedRecoveryMoveCallback } from "./ped-recovery-move";
import type { NativePedMovePlan } from "./ped-move-fsm";
import {
  advanceNativePedHeadSequence,
  startNativePedHeadSequence,
  clearNativePedHeadSequence,
  nativePedInitialFearHeadSequence,
  nativePedScareHeadSequence,
  nativePedCalmHeadSequence,
  type NativePedHeadSequence,
  type NativePedHeadSequenceState,
  type NativePedHeadSequenceResult,
  type NativePedHeadModelRequest,
} from "./ped-head-sequence";
import type { NativePedInstanceBone } from "./ped-native-instance";

const f = Math.fround;
type OutletResult = void | readonly string[];
export interface NativePedGameplayCache extends NativePedHaltCache {
  /** Process cache+2e; not the character/pedestrian or rigid flag fields. */
  flags: number;
  stumpCounters: Uint8Array;
  directionInterpolationMs: number;
  killer: object | null;
  killerDriver?: number;
  napalmDeadlineMs: number;
}
export interface NativePedGameplayState {
  action: number;
  cache: NativePedGameplayCache | null;
  callback: NativePedMoveCallbackState;
  runningTimeMs?: number;
  deathTimeMs?: number;
  /** Native OneLessPed flag100 determines this; no second invented once guard. */
  countCommitted: boolean;
  /** Cause supplied by an external installed KillPedestrian caller. Vehicle
   * contacts leave this unset and retain the existing attribution-derived path. */
  deathCause?: "annihilator" | "electric" | "napalm" | "environment";
  diagnostics: Set<string>;
}
export type NativePedCauseKillResult =
  | { status: "complete"; requiredProviders: [] }
  | { status: "ineligible"; requiredProviders: [] }
  | { status: "provider-required"; requiredProviders: string[] };
export interface NativePedGameplayGlobals {
  suicidal?: boolean;
  immortal: boolean;
  exploding: boolean;
  brittle: boolean;
  goreLevel: number;
  dismemberSpurtCount: number;
  mutantSpeed: number;
  blind: boolean;
  valiumTimeMs: number;
  replay: boolean;
  /** Unknown special owned type32 mass remains unknown. */
  specialMass?: number;
  /** Missing-leg/powerup SetPedMove substitutions are not ordinary identity. */
  moveSubstitutionRequired?: boolean;
}
export interface NativePedGameplayNoise<Owner extends object> {
  context: NativePedRuntimeCallback<Owner>;
  dispatch: NativePedContactDispatch | null;
  index: 0 | 1 | 2 | 4 | 5;
  phase: "common" | "passive-continuation";
}
export interface NativePedGameplayOptions<Owner extends object> {
  settings: PedContactSettings;
  readGlobals: () => NativePedGameplayGlobals;
  /** Actual shared CRT rand() output, including effects invoked by these outlets. */
  nextCrtInteger: () => number;
  /** Actual AR outlet or explicitly disabled recording. Missing is unresolved,
   * even when ordinary ACT/model selection is available. The recorder owns any
   * original pointer/resource serialization; a render name is not that pointer. */
  headModelRecording?:
    | "disabled"
    | {
        record: (
          context: NativePedRuntimeCallback<Owner>,
          packet: {
            headBone: number;
            oldModel: NativePedInstanceBone["model"];
            requestedPose: number;
            oldModelSet: 0 | 1;
            targetModelSet: 0 | 1;
            timeMs: number;
          },
        ) => OutletResult;
      };
  onNoise?: (event: NativePedGameplayNoise<Owner>) => OutletResult;
  /** Installed4cdc60. Mutates this cache before passive Damage/score. */
  attributeContact?: (
    context: NativePedRuntimeCallback<Owner>,
    dispatch: NativePedContactDispatch,
    state: NativePedGameplayState,
  ) => OutletResult;
  /** Installed DoGiblets4ccda0 Kill packet: force is literal .4f, point is ped.pos. */
  onKillGiblets?: (
    context: NativePedRuntimeCallback<Owner>,
    dispatch: NativePedContactDispatch | null,
    packet: {
      force: number;
      position: PedVector;
      nativeBody: NativePedRuntimeCallback<Owner>["body"];
    },
  ) => OutletResult;
  /** Called after flag100 is set, only on its first source transition. */
  onOneLessPed?: (
    context: NativePedRuntimeCallback<Owner>,
    state: NativePedGameplayState,
  ) => OutletResult;
  /** Source ScoreForKilledPedestrian receives the retained cache, not a guessed latest hitter. */
  onScoreDeath?: (
    context: NativePedRuntimeCallback<Owner>,
    state: NativePedGameplayState,
    packet?: { height: number; position?: PedVector },
  ) => OutletResult;
  /** Remaining active blood/scrape/player-car or passive car/status effects. */
  onContactEffects?: (
    context: NativePedRuntimeCallback<Owner>,
    dispatch: NativePedContactDispatch,
    result: NativePedContactResult,
  ) => OutletResult;
  /** Explicit installed SetPedMove substitution provider, before selecting authored assets. */
  resolveMove?: (
    context: NativePedRuntimeCallback<Owner>,
    requestedId: number,
    state: NativePedGameplayState,
  ) => number;
  /** Full original SetPedMove substitution/fallback plan from local FSM data. */
  planMove?: (
    context: NativePedRuntimeCallback<Owner>,
    request: {
      id: number;
      speed: number;
      completion: boolean;
      action: number;
      retainRoot: boolean;
    },
    state: NativePedGameplayState,
  ) => NativePedMovePlan;
  readVolumeGravity?: (
    context: NativePedRuntimeCallback<Owner>,
  ) => number | null;
  readGroundHeight?: (
    context: NativePedRuntimeCallback<Owner>,
    id: number,
  ) => number | undefined;
  writeGroundedRoot?: (
    context: NativePedRuntimeCallback<Owner>,
    root: Float32Array,
  ) => void;
  /** Halt inactive retained-root transitions need the actual source core owner. */
  setRecoveryMove?: (
    context: NativePedRuntimeCallback<Owner>,
    request: {
      id: number;
      speed: number;
      completion: boolean;
      retainRoot: boolean;
    },
  ) => NativePedInstanceResult;
  readHaltInput?: (
    context: NativePedRuntimeCallback<Owner>,
    state: NativePedGameplayState,
  ) => Omit<NativePedHaltInput, "replay">;
  /** Resolve actual recovery owners before any halt mutation or CRT draw. */
  preflightRecoveryEffects?: (
    context: NativePedRuntimeCallback<Owner>,
    state: NativePedHaltState,
    input: NativePedHaltInput,
    decision: NativePedHaltDecision,
  ) => OutletResult;
  /** Executes actual cache/direction/proximity/slick/head sequence/status effects in order. */
  onRecoveryEffect?: (
    context: NativePedRuntimeCallback<Owner>,
    effect: NativePedHaltEffect,
    state: NativePedGameplayState,
  ) => OutletResult;
  /** Source low-gravity moved tail4d2880..29aa: no fabricated buoyancy/random spin. */
  onMovedVolume?: (context: NativePedRuntimeCallback<Owner>) => OutletResult;
  sharedHalt?: NativePedHaltSharedState;
}
interface ContactReceipt {
  dispatch: NativePedContactDispatch;

  unresolved: string[];
  commonInvoked: boolean;
  passiveMomentumSquared?: number;
}
function uint(n: number, label: string): number {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff)
    throw new Error(`Invalid native ${label}`);
  return n;
}
function draw(random: () => number): number {
  const n = random();
  if (!Number.isInteger(n) || n < 0 || n > 32767)
    throw new Error("Native gameplay requires CRT rand result0..32767");
  return n;
}
function diagnostic<Owner extends object>(
  context: NativePedRuntimeCallback<Owner>,
  state: NativePedGameplayState,
  missing: readonly string[],
): void {
  for (const key of missing) {
    state.diagnostics.add(key);
    context.character.diagnostics.add(key);
    context.body.diagnostics.add(key);
  }
}

export class NativePedGameplay<Owner extends object = object> {
  readonly hooks: NativePedRuntimeHooks<Owner>;
  private runtime?: NativePedRuntime<Owner>;
  private readonly records = new Map<Owner, NativePedGameplayState>();
  private readonly contacts = new Map<Owner, ContactReceipt>();
  private readonly speeds = new Map<Owner, number>();
  private readonly recoveryMove: NonNullable<
    NativePedGameplayOptions<Owner>["setRecoveryMove"]
  >;
  constructor(readonly options: NativePedGameplayOptions<Owner>) {
    this.recoveryMove =
      options.setRecoveryMove ??
      createNativePedRecoveryMoveCallback({
        readCallbackState: (ctx) => this.state(ctx.owner).callback,
      });
    const active = createNativeActivePedMoveCallback<Owner>({
      readCallbackState: (ctx) => this.state(ctx.owner).callback,
      readSpeed: (ctx) => this.speeds.get(ctx.owner),
      ...(options.writeGroundedRoot
        ? { writeGroundedRoot: options.writeGroundedRoot }
        : {}),
    });
    this.hooks = {
      activeSetMove: active,
      contactProvider: (ctx, dispatch) => this.contactProvider(ctx, dispatch),
      onDamage: (ctx, result) => this.contactDone(ctx, result),
      onMoved: (ctx) => this.moved(ctx),
      onHalt: (ctx) => this.halt(ctx),
      onMoveCompleted: (c, instance, timeMs) => {
        if (!c.body) {
          c.diagnostics.add("native-completion-physical-body-owner");
          return;
        }
        this.completed({
          character: c,
          owner: c.owner,
          instance,
          body: c.body,
          timeMs,
          framePeriodMs: 0,
        });
      },
      onHeadSequenceCleared: (c) => {
        clearNativePedHeadSequence(this.headState(c.owner));
      },
      beforeSaveRoot: (ctx) => {
        const missing = this.stillifyPassiveCorpse(ctx);
        if (missing.length) diagnostic(ctx, this.state(ctx.owner), missing);
        return {
          status: missing.length ? "provider-required" : "complete",
          requiredProviders: missing,
          processedFrames: 0,
          completedMove: false,
        };
      },
      afterPose: (ctx) => {
        const result = this.advanceHeadSequence(ctx.owner, ctx.timeMs);
        return {
          status: result.status,
          requiredProviders: result.requiredProviders,
          processedFrames: 0,
          completedMove: false,
        };
      },
    };
  }
  /** Munge4d4c0f..4d4c90: character+1e is the signed animation period,
   * not the collision impact serial. This calls SetCharacterMoveAR directly,
   * so the gameplay SetPedMove FSM/speed-factor planner must not run. */
  private stillifyPassiveCorpse(
    ctx: NativePedRuntimeCallback<Owner>,
  ): string[] {
    const s = this.state(ctx.owner);
    if (
      ctx.instance.physicsActive ||
      ctx.character.hitPoints > 0 ||
      s.action !== 6 ||
      ctx.instance.moveId === 113
    )
      return [];
    const mutantSpeed = f(this.options.readGlobals().mutantSpeed);
    if (!Number.isFinite(mutantSpeed))
      throw new Error("Invalid native pedestrian mutant speed");
    const period = (ctx.instance.clock.periodMs << 16) >> 16;
    if ((mutantSpeed !== 0) !== (period === 0)) return [];
    //4d1a20 has a distinct replay mutation/recording owner. Ordinary calls
    // cannot fabricate its permission/global pointer state.
    if (this.options.readGlobals().replay)
      return ["source-replay-Stillify-move-owner"];
    const result = this.recoveryMove(ctx, {
      id: -1,
      speed: mutantSpeed === 0 ? 0 : f(-mutantSpeed),
      completion: false,
      retainRoot: false,
    });
    return [...result.requiredProviders];
  }
  bindRuntime(runtime: NativePedRuntime<Owner>): void {
    if (this.runtime && this.runtime !== runtime)
      throw new Error("Native gameplay runtime already bound");
    this.runtime = runtime;
  }
  enroll(
    owner: Owner,
    input: {
      action: number;
      cache: NativePedGameplayCache | null;
      callback?: NativePedMoveCallbackState;
      runningTimeMs?: number;
      deathTimeMs?: number;
    },
  ): NativePedGameplayState {
    if (this.records.has(owner))
      throw new Error("Native gameplay owner already enrolled");
    if (!Number.isInteger(input.action) || input.action < 0 || input.action > 6)
      throw new Error("Invalid native ped action");
    const c = this.host().character(owner),
      cache = input.cache;
    if (
      cache &&
      cache.stumpCounters.length <
        this.host().character(owner).modelPoses.length
    )
      throw new Error("Native gameplay needs complete FORM stump cache");
    const state = {
      ...input,
      callback: input.callback ?? { flags: 0, queuedMoveIndex: -1 },
      countCommitted: !!(c.flags & 0x100),
      diagnostics: new Set<string>(),
    };
    this.records.set(owner, state);
    return state;
  }
  state(owner: Owner): NativePedGameplayState {
    const state = this.records.get(owner);
    if (!state) throw new Error("Native gameplay owner not enrolled");
    return state;
  }
  /** Accessors bind directly to the existing process-cache fields. No second
   * per-character animation cache can diverge from halt/completion writes. */
  private headState(owner: Owner): NativePedHeadSequenceState | null {
    const cache = this.state(owner).cache;
    if (!cache) return null;
    // New zero-initialized host cache storage. Reused storage retains the two
    // scalar fields when its sequence pointer is cleared by the source owner.
    cache.headSequence ??= { address: null, startTimeMs: 0, index: 0 };
    return {
      get sequence() {
        const address = cache.headSequence!.address;
        if (address === null) return null;
        if (address === 0x65d048) return nativePedInitialFearHeadSequence;
        if (address === 0x65d050) return nativePedScareHeadSequence;
        if (address === 0x65d054) return nativePedCalmHeadSequence;
        throw new Error("Unrecovered native head sequence pointer");
      },
      set sequence(value) {
        cache.headSequence!.address = value?.address ?? null;
      },
      get index() {
        return cache.headSequence!.index;
      },
      set index(value) {
        cache.headSequence!.index = value;
      },
      get lastChangeTimeMs() {
        return cache.headSequence!.startTimeMs;
      },
      set lastChangeTimeMs(value) {
        cache.headSequence!.startTimeMs = value;
      },
    };
  }
  private headInput(owner: Owner, timeMs: number) {
    const c = this.host().character(owner);
    return {
      hitPoints: c.hitPoints,
      renderSlot: this.host().allocation(owner)?.renderSlot ?? -1,
      headBone: this.host().headBone(owner),
      timeMs,
    };
  }
  private headModels(owner: Owner, request: NativePedHeadModelRequest) {
    const c = this.host().character(owner),
      recording = this.options.headModelRecording;
    const missing = (names: string[]) => ({
      status: "provider-required" as const,
      requiredProviders: names,
      processedFrames: 0,
      completedMove: false,
    });
    if (!c.instance || !c.body) return missing(["native-head-ACT-body-owner"]);
    if (recording === undefined)
      return missing(["native-head-model-AR-recording-owner"]);
    const instance = c.instance,
      ctx = {
        character: c,
        owner,
        instance,
        body: c.body,
        timeMs: request.timeMs,
        framePeriodMs: 0,
      };
    if (recording !== "disabled") {
      const oldModel =
        request.kind === "bone-model"
          ? instance.bones[request.headBone]?.model
          : null;
      if (oldModel === undefined)
        throw new Error("Invalid native FORM head bone");
      const pending: string[] = [];
      this.outlet(
        ctx,
        recording.record(ctx, {
          headBone: request.headBone,
          oldModel,
          requestedPose: request.kind === "all-models" ? -1 : request.poseIndex,
          oldModelSet: instance.modelSet,
          targetModelSet: request.modelSet,
          timeMs: request.timeMs,
        }),
        pending,
      );
      if (pending.length) return missing([...new Set(pending)]);
    }
    if (request.kind === "bone-model")
      return this.host().selectModel(
        owner,
        request.headBone,
        request.poseIndex,
        request.modelSet,
      );
    const pending: string[] = [];
    for (let index = 0; index < instance.bones.length; index++)
      pending.push(
        ...this.host().selectModel(
          owner,
          index,
          request.poseIndex,
          request.modelSet,
        ).requiredProviders,
      );
    //40b530 loops ascending, ignoring ordinary individual known-NULL returns0.
    return pending.length
      ? missing([...new Set(pending)])
      : {
          status: "complete" as const,
          requiredProviders: [],
          processedFrames: 0,
          completedMove: false,
        };
  }
  private headResult(owner: Owner, result: NativePedHeadSequenceResult) {
    const c = this.host().character(owner),
      s = this.state(owner);
    for (const key of result.requiredProviders) {
      s.diagnostics.add(key);
      c.diagnostics.add(key);
      c.body?.diagnostics.add(key);
    }
    return result;
  }
  /** Actual caller must select the source move first. This starts the first
   * head MODEL immediately without advancing BON or changing physics. */
  startHeadSequence(
    owner: Owner,
    sequence: NativePedHeadSequence,
    timeMs: number,
  ) {
    return this.headResult(
      owner,
      startNativePedHeadSequence(
        this.headState(owner),
        sequence,
        this.headInput(owner, timeMs),
        { setModels: (request) => this.headModels(owner, request) },
      ),
    );
  }
  /** Once after successful processed outer pose; start effects use the separate
   * entry above. Source replay skips timed advancement but not start itself. */
  advanceHeadSequence(owner: Owner, timeMs: number) {
    return this.headResult(
      owner,
      advanceNativePedHeadSequence(
        this.headState(owner),
        {
          ...this.headInput(owner, timeMs),
          replay: this.options.readGlobals().replay,
        },
        { setModels: (request) => this.headModels(owner, request) },
      ),
    );
  }
  /** Shared source SetPedMove entry for outer grounding/AI owners. Reuses the
   * same authored FSM, speed factors and active/inactive transition providers
   * as contacts and recovery; it does not advance this frame's BON clock. */
  requestMove(
    context: NativePedRuntimeCallback<Owner>,
    request: {
      id: number;
      speed: number;
      completion: boolean;
      action: number;
      retainRoot?: boolean;
    },
  ): NativePedInstanceResult {
    const c = this.host().character(context.owner);
    if (
      context.character !== c ||
      context.instance !== c.instance ||
      context.body !== c.body
    )
      throw new Error(
        "Native move request requires current character/ACT/body ownership",
      );
    uint(context.timeMs, "ped move clock");
    if (
      !Number.isInteger(request.id) ||
      !Number.isInteger(request.action) ||
      request.action < 0 ||
      request.action > 6 ||
      !Number.isFinite(f(request.speed))
    )
      throw new Error("Invalid native gameplay move request");
    const missing: string[] = [];
    this.move(
      context,
      request.id,
      request.speed,
      request.completion,
      request.action,
      missing,
      request.retainRoot ?? false,
    );
    diagnostic(context, this.state(context.owner), missing);
    return {
      status: missing.length ? "provider-required" : "complete",
      requiredProviders: [...new Set(missing)],
      processedFrames: 0,
      completedMove: false,
    };
  }
  /** Reuse the installed shared KillPedestrian continuation for an external
   * cause. This owns no launch impulse; the caller must already have an actual
   * admitted runtime body and supplies any cause-specific physical activation. */
  killFromCause(
    owner: Owner,
    cause: "annihilator" | "electric" | "napalm",
    deadMoveId = 113,
  ): NativePedCauseKillResult {
    return this.killExternal(owner, cause, deadMoveId, false);
  }
  /** FullKill has no immortality gate. The outer selected-volume timeout calls
   * it directly and leaves dead move selection to the next native Munge visit. */
  killFromEnvironment(owner: Owner): NativePedCauseKillResult {
    return this.killExternal(owner, "environment", null, true);
  }
  /** Source ScoreForKilledPedestrian4cd026 stores HP0/action6/time before
   * killer eligibility. Scope callers use it without FullKill effects/count. */
  scoreFromScope(
    ctx: NativePedRuntimeCallback<Owner>,
    height: number,
    cause: "environment" | "napalm",
    cache: NativePedGameplayCache | null,
    position?: PedVector,
  ): NativePedCauseKillResult {
    if (ctx.character.hitPoints <= 0)
      return { status: "ineligible", requiredProviders: [] };
    if (!Number.isFinite(f(height)))
      throw new Error("Invalid native scope death height");
    if (!this.options.onScoreDeath)
      return {
        status: "provider-required",
        requiredProviders: ["source-ScoreForKilledPedestrian-owner"],
      };
    const state = this.state(ctx.owner);
    ctx.character.hitPoints = ctx.body.hitPoints = 0;
    state.action = 6;
    state.deathTimeMs = uint(ctx.timeMs, "scope death clock");
    state.deathCause = cause;
    const missing = [
      ...(this.options.onScoreDeath(
        ctx,
        { ...state, cache },
        { height: f(height), position },
      ) ?? []),
    ];
    diagnostic(ctx, state, missing);
    return missing.length
      ? { status: "provider-required", requiredProviders: missing }
      : { status: "complete", requiredProviders: [] };
  }
  private killExternal(
    owner: Owner,
    cause: NonNullable<NativePedGameplayState["deathCause"]>,
    deadMoveId: number | null,
    bypassImmortal: boolean,
  ): NativePedCauseKillResult {
    const runtime = this.host();
    let ctx: NativePedRuntimeCallback<Owner>;
    try {
      ctx = runtime.callbackContext(owner);
    } catch (error) {
      if (/current ACT\/body ownership/.test(String(error)))
        return { status: "ineligible", requiredProviders: [] };
      throw error;
    }
    const { character: c, instance } = ctx;
    const state = this.state(owner),
      globals = this.options.readGlobals();
    if (
      c.hitPoints <= 0 ||
      c.flags & 0x100 ||
      state.countCommitted ||
      (!bypassImmortal && globals.immortal)
    )
      return { status: "ineligible", requiredProviders: [] };
    if (
      deadMoveId !== null &&
      (!Number.isInteger(deadMoveId) || deadMoveId < 0 || deadMoveId > 117)
    )
      throw new Error("Invalid external pedestrian death move");

    const missing: string[] = [];
    if (globals.replay) missing.push("source-replay-gameplay-owner");
    if (!this.options.onOneLessPed) missing.push("source-OneLessPed-owner");
    if (!this.options.onScoreDeath)
      missing.push("source-ScoreForKilledPedestrian-owner");
    const gravity = this.gravity(ctx);
    if (gravity === undefined) missing.push("source-special-volume-gravity");
    const physical =
      globals.goreLevel > 0 &&
      (gravity === null || (gravity !== undefined && gravity >= 1));
    if (physical) {
      if (!this.options.onKillGiblets)
        missing.push("source-Kill-DoGiblets-owner");
      if (instance.bones.some((bone) => !bone.modelSets[1]))
        missing.push("native-model-set1-provider");
    }
    if (deadMoveId !== null && !instance.template.moves.has(deadMoveId))
      missing.push(`native-authored-move-${deadMoveId}`);
    if (
      (globals.moveSubstitutionRequired || c.removedBoneMask & 0x28) &&
      !this.options.resolveMove &&
      !this.options.planMove
    )
      missing.push("source-SetPedMove-substitution-owner");
    if (missing.length) {
      diagnostic(ctx, state, missing);
      return {
        status: "provider-required",
        requiredProviders: [...new Set(missing)],
      };
    }

    // Preserve the cause for the real population/score outlet before Kill's
    // native ordering: dead visuals/effects, flag100 + OneLessPed, then score.
    state.deathCause = cause;
    this.kill(ctx, null, globals, missing);
    if (deadMoveId !== null) this.move(ctx, deadMoveId, -1, false, 6, missing);
    if (missing.length) {
      diagnostic(ctx, state, missing);
      return {
        status: "provider-required",
        requiredProviders: [...new Set(missing)],
      };
    }
    return { status: "complete", requiredProviders: [] };
  }
  release(owner: Owner): void {
    const c = this.host().character(owner);
    if (c.body || c.instance)
      throw new Error(
        "Release native FORM/PHIL resources before gameplay owner",
      );
    this.records.delete(owner);
    this.contacts.delete(owner);
    this.speeds.delete(owner);
  }
  private host(): NativePedRuntime<Owner> {
    if (!this.runtime)
      throw new Error("Bind native gameplay runtime before use");
    return this.runtime;
  }
  private outlet(
    ctx: NativePedRuntimeCallback<Owner>,
    result: OutletResult,
    pending?: string[],
  ): void {
    if (result !== undefined && !Array.isArray(result))
      throw new Error("Native gameplay outlet must return void or diagnostics");
    const missing = result ?? [];
    diagnostic(ctx, this.state(ctx.owner), missing);
    pending?.push(...missing);
  }
  private gravity(
    ctx: NativePedRuntimeCallback<Owner>,
  ): number | null | undefined {
    if (this.options.readVolumeGravity) {
      const n = this.options.readVolumeGravity(ctx);
      if (n !== null && !Number.isFinite(f(n)))
        throw new Error("Invalid native volume gravity");
      return n === null ? null : f(n);
    }
    // Native +258 is the selected volume pointer. The allocated browser cache
    // itself and its +25c automatic-water candidate do not establish presence.
    const n = ctx.body.specialVolume?.volume?.gravityMultiplier ?? null;
    if (n !== null && !Number.isFinite(f(n)))
      throw new Error("Invalid native volume gravity");
    return n === null ? null : f(n);
  }
  private contactProvider(
    ctx: NativePedRuntimeCallback<Owner>,
    dispatch: NativePedContactDispatch,
  ): NativePedContactContext {
    const g = this.options.readGlobals(),
      c = ctx.character,
      s = this.state(ctx.owner),
      form = ctx.instance.template.form;
    const state: PedContactState = {
      hitPoints: c.hitPoints,
      flags: c.flags,
      immortal: g.immortal,
      exploding: g.exploding,
      brittle: g.brittle,
      goreLevel: g.goreLevel,
      removedBoneMask: c.removedBoneMask,
      headMissing: !!(c.removedBoneMask & (1 << form.headBone)),
    };
    const receipt: ContactReceipt = {
      dispatch,
      unresolved: [],
      commonInvoked: false,
    };
    this.contacts.set(ctx.owner, receipt);
    const attribute = () => {
      if (this.options.attributeContact)
        this.outlet(
          ctx,
          this.options.attributeContact(ctx, dispatch, s),
          receipt.unresolved,
        );
      else receipt.unresolved.push("source-contact-attribution-before-damage");
    };
    // Installed4d210c attributes active contacts before even the force/damage
    // threshold gates. Retry/interpolation/impact-WORD stores are passive-only.
    if (dispatch.phase === "active" && !g.replay) attribute();
    return {
      settings: this.options.settings,
      form: {
        personalityMass: ctx.instance.template.profile.mass,
        simpleBodyMass: ctx.body.properties.mass,
        boneCount: form.bones.length,
        nonHumanoid: form.nonHumanoid,
      },
      state,
      specialMass: g.specialMass,
      passivePrelude: () => {
        if (g.replay) {
          receipt.unresolved.push("source-replay-gameplay-owner");
          return;
        }
        // Simulation/runtime already committed the incremented WORD; do not increment it again.
        if (s.cache) {
          s.cache.retryCount = 0;
          s.cache.directionInterpolationMs = 0;
        }
        attribute();
      },
      damageTail: (request) => this.damageTail(ctx, receipt, request, g),
    };
  }
  private preflight(
    ctx: NativePedRuntimeCallback<Owner>,
    r: ContactReceipt,
    request: PedCommonDamageTailInput,
    g: NativePedGameplayGlobals,
  ): string[] {
    const missing = [...r.unresolved],
      c = ctx.character,
      form = ctx.instance.template.form;
    if (g.replay) missing.push("source-replay-gameplay-owner");
    if (!this.options.onNoise) missing.push("source-ped-noise-owner");
    if (!this.options.onContactEffects)
      missing.push("source-contact-effects-owner");
    const couldSever =
      !!r.dispatch.other &&
      !g.immortal &&
      g.goreLevel >= 2 &&
      request.damage >= (g.brittle ? 5 : this.options.settings.severDamage);
    if (
      (g.moveSubstitutionRequired ||
        c.removedBoneMask & 0x28 ||
        (couldSever && form.bones.length > 5)) &&
      !this.options.resolveMove &&
      !this.options.planMove
    )
      missing.push("source-SetPedMove-substitution-owner");
    // The downstream death branch can be reached after severing, so preflight its owners before RNG/admission/HP mutation.
    if (request.state.hitPoints > 0) {
      if (!this.options.onOneLessPed) missing.push("source-OneLessPed-owner");
      if (!this.options.onScoreDeath)
        missing.push("source-ScoreForKilledPedestrian-owner");
      const gravity = this.gravity(ctx);
      if (gravity === undefined) missing.push("source-special-volume-gravity");
      if (
        g.goreLevel > 0 &&
        (gravity === null || (gravity !== undefined && gravity >= 1))
      ) {
        if (!this.options.onKillGiblets)
          missing.push("source-Kill-DoGiblets-owner");
        if (ctx.instance.bones.some((b) => !b.modelSets[1]))
          missing.push("native-model-set1-provider");
      }
    }
    return [...new Set(missing)];
  }
  private damageTail(
    ctx: NativePedRuntimeCallback<Owner>,
    r: ContactReceipt,
    request: PedCommonDamageTailInput,
    g: NativePedGameplayGlobals,
  ) {
    if (r.commonInvoked)
      return {
        health: null,
        unresolved: ["native-gameplay-common-tail-already-invoked"],
      };
    const missing = this.preflight(ctx, r, request, g);
    if (missing.length) {
      diagnostic(ctx, this.state(ctx.owner), missing);
      r.unresolved.push(...missing);
      return { health: null, unresolved: missing };
    }
    if (r.dispatch.phase === "passive") {
      const mass = f(ctx.instance.template.profile.mass),
        v = ctx.body.characterVelocity,
        other = r.dispatch.other;
      let x = -mass * f(v.x),
        y = f(-mass * f(v.y)),
        z = f(-mass * f(v.z));
      if (other) {
        const m = f(other.properties.mass);
        x += m * f(other.state.velocity.x);
        y += m * f(other.state.velocity.y);
        z += m * f(other.state.velocity.z);
      }
      r.passiveMomentumSquared = x * x + y * y + z * z;
      if (
        other &&
        "rigidType" in other &&
        other.rigidType === 32 &&
        "owner" in other &&
        g.specialMass !== undefined &&
        f(other.properties.mass) === f(g.specialMass)
      )
        r.passiveMomentumSquared *= 10;
    }
    r.commonInvoked = true;
    const c = ctx.character,
      s = this.state(ctx.owner),
      form = ctx.instance.template.form;
    const sever: NativePedSeverState = {
      removedBoneMask: c.removedBoneMask,
      vanishedBoneMask: c.vanishedBoneMask,
      bonedSlot: c.bonedSlot,
      hitPoints: c.hitPoints,
      physicsActive: ctx.instance.physicsActive,
      characterVelocity: [...ctx.instance.nativeCharacterVelocity],
      cache: s.cache,
    };
    const tail = createPedSeverDamageTail({
      state: sever,
      input: {
        otherPresent: !!r.dispatch.other,
        goreLevel: g.goreLevel,
        immortal: g.immortal,
        brittle: g.brittle,
        exploding: g.exploding,
        articulated: ctx.instance.boned,
        form,
        severDamage: this.options.settings.severDamage,
        severChance: this.options.settings.severChance,
        dismemberSpurtCount: g.dismemberSpurtCount,
      },
      providers: {
        sever: {
          preflightBones: (indices) =>
            this.host().preflightSeverBones(ctx.owner, indices),
          nextCrtInteger: this.options.nextCrtInteger,
          reserveBonedSlot: () => this.host().reserveBonedSlot(ctx.owner),
          readBone: (index) => this.host().readBone(ctx.owner, index),
          registerBone: (q) => this.host().registerBone(ctx.owner, q),
          commitBone: (q, registration) =>
            this.host().commitBone(ctx.owner, q, registration),
        },
        onReaction: (health) => {
          c.hitPoints = ctx.body.hitPoints = health.hitPoints;
          if (health.wasAlive && health.reactionMoveId >= 0)
            this.move(ctx, health.reactionMoveId, -1, true, 5, r.unresolved);
        },
        onNoise: (health) => {
          const index = health.wasAlive
            ? health.survived
              ? 4
              : 1
            : health.damage > 2
              ? 5
              : null;
          if (index !== null)
            this.outlet(
              ctx,
              this.options.onNoise!({
                context: ctx,
                dispatch: r.dispatch,
                index,
                phase: "common",
              }),
              r.unresolved,
            );
        },
        onKill: () => {
          this.kill(ctx, r.dispatch, g, r.unresolved);
          request.state.flags = c.flags;
        },
        applyKillModelEffect: (effect) =>
          this.host().applyKillModelEffect(ctx.owner, effect),
        callerContinuation: (health) => {
          // Native caller noise/override is BEFORE its filter/status stores, not a later damage notification.
          if (r.dispatch.phase === "passive") {
            const q = r.passiveMomentumSquared!;
            const index: 0 | 1 | 2 =
              health.hitPoints <= 0 ? (q > 200 ? 2 : 1) : q > 66 ? 1 : 0;
            this.outlet(
              ctx,
              this.options.onNoise!({
                context: ctx,
                dispatch: r.dispatch,
                index,
                phase: "passive-continuation",
              }),
              r.unresolved,
            );
            if (health.hitPoints <= 0)
              this.move(ctx, 94, -1, false, 6, r.unresolved);
          }
        },
      },
    });
    const result = tail.damageTail(request);
    r.unresolved.push(...result.unresolved);
    c.removedBoneMask = sever.removedBoneMask;
    c.vanishedBoneMask = sever.vanishedBoneMask;
    c.bonedSlot = sever.bonedSlot;
    diagnostic(ctx, s, r.unresolved);
    return { health: result.health, unresolved: [...new Set(r.unresolved)] };
  }
  private move(
    ctx: NativePedRuntimeCallback<Owner>,
    id: number,
    speed: number,
    completion: boolean,
    action: number,
    missing: string[],
    retainRoot = false,
  ): void {
    const c = ctx.character,
      s = this.state(ctx.owner),
      g = this.options.readGlobals();
    if (
      (g.moveSubstitutionRequired || c.removedBoneMask & 0x28) &&
      !this.options.resolveMove &&
      !this.options.planMove
    ) {
      missing.push("source-SetPedMove-substitution-owner");
      return;
    }
    const plan = this.options.planMove?.(
      ctx,
      { id, speed, completion, action, retainRoot },
      s,
    );
    if (plan?.status === "provider-required") {
      missing.push(...plan.requiredProviders);
      return;
    }
    const target = plan?.moveId ?? this.options.resolveMove?.(ctx, id, s) ?? id;
    if (plan) {
      speed = plan.speed;
      action = plan.action;
      if (plan.clearCachedRunSpeed && s.cache) s.cache.runSpeed = 0;
    }
    if (target !== -1 && !ctx.instance.template.moves.has(target)) {
      missing.push(`native-authored-move-${target}`);
      return;
    }
    const asset =
      target === -1
        ? ctx.instance.move?.asset
        : ctx.instance.template.moves.get(target);
    if (!ctx.instance.physicsActive && (retainRoot || target === -1)) {
      const result = this.recoveryMove(ctx, {
        id: target,
        speed,
        completion,
        retainRoot,
      });
      missing.push(...result.requiredProviders);
      if (result.status === "complete") {
        c.moveId = ctx.instance.moveId ?? c.moveId;
        if (target !== -1) s.action = action;
      }
      return;
    }
    const groundHeight = this.options.readGroundHeight?.(ctx, target);
    this.speeds.set(ctx.owner, speed);
    try {
      const result = this.host().setMove(
        ctx.owner,
        target,
        c.direction,
        c.groundNormal,
        ctx.timeMs,
        {
          periodMs:
            speed < 0 ? Math.trunc(-speed * asset!.form.periodMs) : speed,
          retainRoot,
          completionRequested: completion,
          ...(groundHeight === undefined ? {} : { groundHeight }),
        },
      );
      missing.push(...result.requiredProviders);
      if (result.status === "complete") s.action = action;
    } finally {
      this.speeds.delete(ctx.owner);
    }
  }
  private kill(
    ctx: NativePedRuntimeCallback<Owner>,
    dispatch: NativePedContactDispatch | null,
    g: NativePedGameplayGlobals,
    missing: string[],
  ): void {
    const c = ctx.character,
      s = this.state(ctx.owner),
      gravity = this.gravity(ctx),
      physical =
        g.goreLevel > 0 &&
        (gravity === null || (gravity !== undefined && gravity >= 1));
    if (physical) {
      this.host().applyKillModelEffect(ctx.owner, {
        kind: "dead-model-all",
        pose: 0,
        modelSet: 1,
      });
      this.host().applyKillModelEffect(ctx.owner, {
        kind: "dead-model-head",
        index: ctx.instance.template.form.headBone,
        pose: 2,
        modelSet: 1,
      });
      this.host().applyKillModelEffect(ctx.owner, {
        kind: "clear-head-sequence",
      });
      this.outlet(
        ctx,
        this.options.onKillGiblets!(ctx, dispatch, {
          force: f(0.4),
          position: [...c.position],
          nativeBody: ctx.body,
        }),
        missing,
      );
    }
    if (!(c.flags & 0x100)) {
      c.flags = (c.flags | 0x100) >>> 0;
      ctx.body.pedestrianFlags = c.flags;
      s.countCommitted = true;
      this.outlet(ctx, this.options.onOneLessPed!(ctx, s), missing);
    }
    c.hitPoints = ctx.body.hitPoints = 0;
    s.action = 6;
    s.deathTimeMs = uint(ctx.timeMs, "ped death clock");
    this.outlet(
      ctx,
      this.options.onScoreDeath!(ctx, s, { height: 0 }),
      missing,
    );
  }
  private contactDone(
    ctx: NativePedRuntimeCallback<Owner>,
    result: NativePedContactResult,
  ): void {
    const r = this.contacts.get(ctx.owner);
    if (!r) return;
    this.contacts.delete(ctx.owner);
    if (
      !result.eligible ||
      ("unresolved" in result && result.unresolved.length) ||
      ("applied" in result && !result.applied)
    )
      return;
    if ("pinned" in result && result.pinned) {
      const missing: string[] = [];
      this.move(ctx, 96, -1, false, 5, missing);
      diagnostic(ctx, this.state(ctx.owner), missing);
    }
    if (this.options.onContactEffects)
      this.outlet(ctx, this.options.onContactEffects(ctx, r.dispatch, result));
    else
      diagnostic(ctx, this.state(ctx.owner), ["source-contact-effects-owner"]);
  }
  private moved(ctx: NativePedRuntimeCallback<Owner>): void {
    const missing: string[] = [],
      gravity = this.gravity(ctx);
    // Simulation already performed the source .1 minimum/gain1.39 settling; do not repeat it.
    if ([93, 94, 97].includes(ctx.character.moveId)) {
      const speed = f(ctx.body.state.velocity.length());
      let period = 0;
      if (speed !== 0) {
        const sample = draw(this.options.nextCrtInteger),
          lo = f(0.6),
          hi = f(1.4);
        period = Math.max(
          20,
          Math.min(
            150,
            Math.trunc(((lo + ((hi - lo) * sample) / 32768) * 25) / speed),
          ),
        );
        if (gravity !== null && gravity !== undefined && gravity < 1)
          period = Math.trunc(period * 1.5);
      }
      missing.push(...this.corePeriod(ctx, period));
    }
    if (gravity === undefined) missing.push("source-special-volume-gravity");
    else if (gravity !== null && gravity < 1 && ctx.character.hitPoints > 0) {
      if (this.options.onMovedVolume)
        this.outlet(ctx, this.options.onMovedVolume(ctx), missing);
      else missing.push("source-moved-low-gravity-continuation");
    }
    diagnostic(ctx, this.state(ctx.owner), missing);
  }
  /** Moved4d2864 and corpse halt4d185e call SetCharacterMoveAR directly.
   * A period update is not SetPedMove: no FSM, speed factor, action or cache80. */
  private corePeriod(
    ctx: NativePedRuntimeCallback<Owner>,
    speed: number,
  ): string[] {
    const result = ctx.instance.physicsActive
      ? this.hooks.activeSetMove?.(
          ctx,
          -1,
          ctx.character.direction,
          ctx.character.groundNormal,
          { periodMs: speed, completionRequested: false },
        )
      : this.recoveryMove(ctx, {
          id: -1,
          speed,
          completion: false,
          retainRoot: false,
        });
    if (!result) return ["native-core-period-owner"];
    if (result.status === "complete")
      ctx.character.moveOptions = {
        ...ctx.character.moveOptions,
        periodMs: ctx.instance.clock.periodMs,
      };
    return [...result.requiredProviders];
  }
  private haltState(ctx: NativePedRuntimeCallback<Owner>): NativePedHaltState {
    const c = ctx.character,
      s = this.state(ctx.owner);
    return {
      hitPoints: c.hitPoints,
      flags: c.flags,
      moveId: c.moveId,
      action: s.action,
      impactSerial: (c.impactCount << 16) >> 16,
      cache: s.cache,
      doNothing: ctx.body.doNothing,
      rigidFlags: ctx.body.rigidFlags,
      rigidPose: nativePedRootPose(ctx.body),
      localOmega: ctx.body.state.angularVelocity
        .clone()
        .applyQuaternion(ctx.body.state.orientation.clone().invert())
        .toArray() as [number, number, number],
      filterA: ctx.body.filterA,
      filterB: ctx.body.filterB,
      runningTimeMs: s.runningTimeMs,
    };
  }
  private recoveryEffect(
    ctx: NativePedRuntimeCallback<Owner>,
    e: NativePedHaltEffect,
    missing: string[],
    retainRoot = false,
  ): void {
    const s = this.state(ctx.owner);
    if (e.kind === "move")
      this.move(
        ctx,
        e.moveId,
        e.speed,
        e.completion,
        e.action,
        missing,
        retainRoot,
      );
    else if (e.kind === "freeze-move")
      missing.push(...this.corePeriod(ctx, e.speed));
    else if (e.kind === "position") ctx.character.position = [...e.position];
    else if (e.kind === "action") s.action = e.action;
    else if (e.kind === "sync-root-basis") ctx.body.rigidFlags |= e.rigidFlag;
    // Historical event name: native4fec00 invalidates only the water plane.
    else if (e.kind === "clear-volume") resetNativePedWaterPlane(ctx.body);
    else if (e.kind !== "settling" && e.kind !== "kill") {
      if (e.kind === "head-sequence")
        missing.push(
          ...this.startHeadSequence(
            ctx.owner,
            nativePedScareHeadSequence,
            e.timeMs,
          ).requiredProviders,
        );
      if (this.options.onRecoveryEffect)
        this.outlet(ctx, this.options.onRecoveryEffect(ctx, e, s), missing);
      else missing.push(`source-recovery-${e.kind}-owner`);
    }
  }
  private halt(ctx: NativePedRuntimeCallback<Owner>) {
    const s = this.state(ctx.owner);
    if (!this.options.readHaltInput)
      return {
        returnValue: null,
        requiredProviders: ["source-halt-input-owner"],
      };
    const provided = this.options.readHaltInput(ctx, s);
    const renderSlot = this.host().allocation(ctx.owner)?.renderSlot ?? -1;
    const input: NativePedHaltInput = {
        ...provided,
        // Source availability is signed character+4, not a MODEL pose index.
        head: {
          boneIndex: this.host().headBone(ctx.owner),
          renderSlot,
          modelState: renderSlot,
        },
        // Gameplay owns the actual global replay state, not an effect adapter.
        replay: this.options.readGlobals().replay,
      },
      state = this.haltState(ctx),
      decision = decideNativePedHalt(state, input);
    if (decision.kind === "unsupported")
      return {
        returnValue: null,
        requiredProviders: decision.requiredProviders,
      };
    const missing: string[] = [];
    if (this.options.preflightRecoveryEffects)
      this.outlet(
        ctx,
        this.options.preflightRecoveryEffects(ctx, state, input, decision),
        missing,
      );
    if (!this.options.onRecoveryEffect)
      missing.push("source-recovery-effect-owner");
    const retainedReaction = [90, 91, 92, 97, 113].includes(state.moveId);
    if (decision.kind === "kill-required") {
      const g = this.options.readGlobals();
      const r: ContactReceipt = {
        dispatch: { phase: "active", other: undefined },
        unresolved: [],
        commonInvoked: false,
      };
      missing.push(
        ...this.preflight(
          ctx,
          r,
          {
            damage: 100,
            form: {
              personalityMass: ctx.instance.template.profile.mass,
              simpleBodyMass: ctx.body.properties.mass,
              boneCount: ctx.instance.bones.length,
              nonHumanoid: ctx.instance.template.form.nonHumanoid,
            },
            state: {
              hitPoints: ctx.character.hitPoints,
              flags: ctx.character.flags,
              immortal: g.immortal,
              exploding: g.exploding,
              brittle: g.brittle,
              goreLevel: g.goreLevel,
              removedBoneMask: ctx.character.removedBoneMask,
              headMissing: false,
            },
            aliveMove: -1,
            deadMove: 94,
          },
          g,
        ),
      );
    }
    if (missing.length)
      return { returnValue: null, requiredProviders: [...new Set(missing)] };
    let retainedMovePending = retainedReaction;
    const result = mutateNativePedHalt(state, input, {
      shared: this.options.sharedHalt ?? sharedNativePedHaltState,
      nextCrtInteger: this.options.nextCrtInteger,
      onEffect: (e) => {
        const retain = e.kind === "move" && retainedMovePending;
        if (e.kind === "move") retainedMovePending = false;
        this.recoveryEffect(ctx, e, missing, retain);
        // Rescan/PedScan can select a later gameplay action after StartPedRunning.
        state.action = s.action;
      },
      kill: () => {
        this.kill(ctx, null, this.options.readGlobals(), missing);
        state.flags = ctx.character.flags;
        return ctx.character.hitPoints;
      },
    });
    this.commitHaltState(ctx, state);
    // Kernel requirements name effect owners even when onEffect fulfilled them. Only consume known implemented outlets.
    const supplied = new Set([
      "source-animation-move-provider",
      "source-ground-face-cache-provider",
      "source-SetPedXZDirection-provider",
      "source-proximity-object-scan-and-pointer-CRT-provider",
      "head-sequence-model-provider",
      "source-corpse-slick-provider",
      "source-volume-state-clear-provider",
    ]);
    missing.push(...result.requiredProviders.filter((x) => !supplied.has(x)));
    diagnostic(ctx, s, missing);
    return {
      returnValue: missing.length ? null : result.returnValue,
      requiredProviders: [...new Set(missing)],
    };
  }
  private commitHaltState(
    ctx: NativePedRuntimeCallback<Owner>,
    state: NativePedHaltState,
  ): void {
    const c = ctx.character,
      s = this.state(ctx.owner);
    c.flags = ctx.body.pedestrianFlags = state.flags;
    c.hitPoints = ctx.body.hitPoints = state.hitPoints;
    c.impactCount = ctx.body.impactCount = state.impactSerial & 0xffff;
    s.action = state.action;
    s.runningTimeMs = state.runningTimeMs;
    ctx.body.doNothing = state.doNothing;
    ctx.body.rigidFlags = state.rigidFlags;
    ctx.body.filterA = state.filterA;
    ctx.body.filterB = state.filterB;
    ctx.body.state.angularVelocity
      .fromArray(state.localOmega)
      .applyQuaternion(ctx.body.state.orientation);
  }
  private completed(ctx: NativePedRuntimeCallback<Owner>): void {
    const s = this.state(ctx.owner),
      g = this.options.readGlobals(),
      missing: string[] = [];
    if (!this.options.onRecoveryEffect) {
      diagnostic(ctx, s, ["source-recovery-effect-owner"]);
      return;
    }
    const state = {
      ...this.haltState(ctx),
      frame: ctx.instance.move!.asset.motion.frameCount,
      completionEnabled: true,
    };
    // Instance already applied the native positive/end/completion gate and cleared the bit before this callback.
    const result = completeNativePedMove(
      state,
      {
        direction: ctx.character.direction,
        removedBoneMask: ctx.character.removedBoneMask,
        suicidal: g.suicidal ?? false,
        frameCount: state.frame,
        positiveAdvance: 1,
        replay: g.replay,
        nowMs: ctx.timeMs,
        blind: g.blind,
        valiumTimeMs: g.valiumTimeMs,
        head: {
          boneIndex: ctx.instance.template.form.headBone,
          renderSlot: this.host().allocation(ctx.owner)?.renderSlot ?? -1,
          modelState: this.host().allocation(ctx.owner)?.renderSlot ?? -1,
        },
      },
      (e) => {
        this.recoveryEffect(
          ctx,
          e,
          missing,
          e.kind === "move" && (e.moveId === 93 || e.moveId === 94),
        );
        state.action = s.action;
      },
    );
    this.commitHaltState(ctx, state);
    missing.push(
      ...result.requiredProviders.filter(
        (x) =>
          ![
            "source-selected-face-cache-release-provider",
            "source-animation-move-provider",
            "head-sequence-model-provider",
          ].includes(x),
      ),
    );
    diagnostic(ctx, s, missing);
  }
}
