import {
  processOrdinaryPedVolume,
  activateImmersedOrdinaryPed,
  moveOrdinaryPedInVolume,
} from "./ped-ordinary-volume";
import { createOrdinaryPedRecoveryHost } from "./ped-ordinary-recovery";
import type { PedBloodSettings } from "./ped-blood";
import type { Material } from "three";
import { createNativePedRecoveryEffects } from "./ped-recovery-effects";
import type { NativePedGroundCacheSlot } from "./ped-ground-cache";
import type { NativePedOrdinarySupportFace } from "./ped-ordinary-support";
/** Production ownership bridge for existing population actors. Resource/PHIL
 * ownership is native; unrecovered ordinary grounding/object-scan boundaries
 * stay explicit instead of fabricating native addresses or floor groups. */
import { Object3D, Vector3 } from "three";
import type { Ped, PedFrameOptions } from "./pedestrians";
import type { NativePedAssets } from "./ped-native-assets";
import type { NativePedRenderEffects } from "./ped-render-effects";
import {
  NativePedRuntime,
  type NativePedRuntimeCallback,
} from "./ped-native-runtime";
import {
  createOrdinaryNativePedGameplay,
  type OrdinaryNativePedGameplayOptions,
} from "./ped-ordinary-gameplay";
import {
  NativePedProcessCachePool,
  type NativePedProcessCache,
} from "./ped-process-cache";
import { createNativePedPoolSettings } from "./ped-body-pool";
import type { NativePedInstanceResult } from "./ped-native-instance";
import { sharedNativeRandom } from "./native-random";
import { PedAction, pedRandomInteger, type PedSettings } from "./ped-rules";
import type { VehicleSimulation, SimulatedCar } from "./physics/simulation";
import type { PedContactSettings } from "./physics/ped-contact";
import type { NativePedMoveFSM } from "./ped-move-fsm";
import type { NativePedNoiseGroups } from "./ped-noise";
import type { PedVector } from "./ped-form";
import { OrdinaryPedSteering } from "./ped-ordinary-steering";
import { NativePedRecordArray } from "./ped-record-array";
import {
  scanNativeOrdinaryPedObjects,
  type NativeOrdinaryPedScanObject,
} from "./ped-ordinary-object-scan";
import {
  setNativePedXZDirection,
  type NativePedOrdinaryMoveInput,
  type NativePedOrdinaryMoveResult,
} from "./ped-ordinary-move";
import { describeNativePedAttributionOther } from "./physics/ped-other";
import type { RigidBody } from "./physics/contact";
import type { CollisionHull } from "./physics/geometry";
import {
  nativePedInitialFearHeadSequence,
  nativePedScareHeadSequence,
  nativePedCalmHeadSequence,
} from "./ped-head-sequence";
import { selectNativePedNoise } from "./ped-noise";
import { NAPALM_CAPACITY } from "./combat-powerups";
import type { MatMaterial } from "./formats";
import {
  planNativePedScopeExit,
  nativePedFallingHeight,
  type NativePedScopePlan,
} from "./ped-scope-effects";
import {
  activeNativePedBloodPacket,
  createNativePedImpactBloodPacket,
  accumulateNativePedWorldSmear,
  consumeNativePedWorldSmear,
  processNativePedBleeding,
  type NativePedBloodPacket,
  type NativePedSmearSection,
  type NativePedSmearSectionResult,
} from "./ped-native-blood-phases";
import type {
  NativePedContactDispatch,
  NativePedContactResult,
} from "./physics/ped-body";
import type {
  NativePedGameplay,
  NativePedGameplayCache,
} from "./ped-native-gameplay";

type GroundSlot = NativePedGroundCacheSlot<NativePedOrdinarySupportFace>;
type Process = NativePedProcessCache<Object3D, GroundSlot>;

export interface OrdinaryPedRuntimeOptions {
  simulation: VehicleSimulation;
  peds: readonly Ped[];
  templates: ReadonlyMap<string, NativePedAssets>;
  effects: ReadonlyMap<string, NativePedRenderEffects>;
  noises: ReadonlyMap<string, NativePedNoiseGroups>;
  settings: PedSettings;
  contactSettings: PedContactSettings;
  moveFSM: NativePedMoveFSM;
  spurtingPeriodMs: number;
  dismemberSpurtCount?: number;
  frame: () => PedFrameOptions;
  retainedPresentation?: () => ReadonlySet<object>;
  onAdmitted?: (ped: Ped) => void;
  readSlick: () => PedBloodSettings["slick"] | null;
  readSlickMaterials: () => ReadonlyMap<string, Material> | null;
  resolveMaterial?: (name: string) => MatMaterial | null | undefined;
  groundAt: (x: number, z: number, nearY: number) => number | null;
  readScopeFloor?: (position: PedVector) => {
    height: number;
    requiredProviders: readonly string[];
  };
  bind: (
    ped: Ped,
    character: ReturnType<NativePedRuntime<Object3D>["enroll"]>,
  ) => void;
  onVanish?: (context: NativePedRuntimeCallback<Object3D>) => void;
  clearBurning?: (ped: Ped, signedIndex: number) => void | readonly string[];
  burningRequirements?: (ped: Ped, signedValue: number) => readonly string[];
  readBloodSettings?: () => {
    scrapeStart: number;
    lumpsPerEmission: number;
  } | null;
  emitBlood?: (
    context: NativePedRuntimeCallback<Object3D>,
    packet: NativePedBloodPacket,
  ) => void | readonly string[];
  preflightBlood?: (
    context: NativePedRuntimeCallback<Object3D>,
    packet: NativePedBloodPacket,
  ) => readonly string[];
  skidSection?: (section: NativePedSmearSection) => NativePedSmearSectionResult;
  oneLess: OrdinaryNativePedGameplayOptions<Object3D>["oneLess"];
  scoreDeath: OrdinaryNativePedGameplayOptions<Object3D>["scoreDeath"];
  killGiblets: OrdinaryNativePedGameplayOptions<Object3D>["killGiblets"];
  contactEffects: OrdinaryNativePedGameplayOptions<Object3D>["contactEffects"];
  electric: (ped: Ped, body: RigidBody, timeMs: number) => void;
  playNoise: (id: number, position: Vector3) => void;
  warn: (message: string) => void;
}
const complete = (): NativePedInstanceResult => ({
  status: "complete",
  requiredProviders: [],
  processedFrames: 0,
  completedMove: false,
});

export class OrdinaryPedRuntime {
  readonly runtime: NativePedRuntime<Object3D>;
  readonly gameplay: NativePedGameplay<Object3D>;
  readonly processes: NativePedProcessCachePool<Object3D, GroundSlot>;
  readonly steering: OrdinaryPedSteering;
  readonly records = new NativePedRecordArray();
  private recordIndices = new Map<Object3D, number>();
  readonly entries = new Map<Object3D, Ped>();
  private unbind = new Map<Object3D, () => void>();
  private readonly exhaustedOwners = new Set<Object3D>();
  private scanRoster: NativeOrdinaryPedScanObject<RigidBody>[] | null = null;
  private pendingVanish = new Map<
    Object3D,
    NativePedRuntimeCallback<Object3D>
  >();
  private disposed = false;
  private bleedGlobals = { lastMutantBleedTimeMs: 0 };
  private outerVisitSerial = 0;
  private lastSmearSerial = -1;
  private processedEffectsOwners = new Set<Object3D>();
  private pendingScope = new Map<
    Object3D,
    {
      ctx: NativePedRuntimeCallback<Object3D>;
      plan: NativePedScopePlan;
      cache: NativePedGameplayCache | null;
      burning: number;
      height: number;
      position: PedVector;
    }
  >();
  private lastFrame?: { camera: PedVector; time: number };
  private visits = {
    processed: 0,
    exhausted: 0,
    unsupported: 0,
    outOfScope: 0,
  };

  constructor(readonly options: OrdinaryPedRuntimeOptions) {
    const { simulation } = options;
    this.gameplay = createOrdinaryNativePedGameplay<Object3D>({
      simulation,
      contactSettings: options.contactSettings,
      moveFSM: options.moveFSM,
      readGlobals: () => ({
        immortal: !!options.frame().immortalPedestrians,
        exploding: false,
        brittle: false,
        goreLevel: options.frame().goreLevel ?? 1,
        dismemberSpurtCount: options.dismemberSpurtCount ?? 0,
        mutantSpeed: options.frame().pedestrianAnimation?.mutantSpeed ?? 0,
        blind: false,
        valiumTimeMs: 0,
        replay: false,
        drunk: false,
        dancing: false,
        panicking: false,
        pedestrianSpeedFactor: 0,
      }),
      readCache: (owner): NativePedGameplayCache | null =>
        this.entries.has(owner as Object3D)
          ? this.gameplay.state(owner as Object3D).cache
          : null,
      readNoiseGroups: (owner) =>
        options.noises.get(this.entries.get(owner)!.personality) ?? null,
      playNoise: options.playNoise,
      readAllocation: (owner) => this.runtime.allocation(owner),
      oneLess: options.oneLess,
      scoreDeath: options.scoreDeath,
      killGiblets: (ctx, dispatch, packet) =>
        options.emitBlood
          ? this.emitBlood(
              ctx,
              createNativePedImpactBloodPacket({
                point: packet.position,
                pedestrianPosition: ctx.character.position,
                velocity: ctx.body.state.velocity.toArray() as [
                  number,
                  number,
                  number,
                ],
                other: null,
                pedAddress: this.nativeAddress(ctx.owner),
                timeMs: ctx.timeMs,
                force: packet.force,
                startSize: 1,
              }),
            )
          : options.killGiblets(ctx, dispatch, packet),
      contactEffects: (ctx, dispatch, result) =>
        this.contactBlood(ctx, dispatch, result),
      onMovedVolume: (ctx) =>
        moveOrdinaryPedInVolume(ctx.body, ctx.character.hitPoints, () =>
          sharedNativeRandom.nextInteger(),
        ).requiredProviders,
      readGroundHeight: (context) => {
        const p = context.character.position;
        return options.groundAt(p[0], p[2], p[1] + 0.2) ?? undefined;
      },
    });
    this.processes = new NativePedProcessCachePool({
      readCache: (owner) => this.gameplay.state(owner).cache as Process | null,
      writeCache: (owner, cache) => {
        this.gameplay.state(owner).cache = cache;
      },
      randomTurnInterval: (low, high) =>
        pedRandomInteger(sharedNativeRandom.random, low, high),
      releaseFaceCache: (face, cache) => {
        this.steering?.releaseBorrowed(face);
        cache.faceCache = null;
      },
    });
    this.runtime = new NativePedRuntime(simulation, {
      levelOut:
        options.settings.buoyancyFactor ??
        (() => {
          throw new Error("Missing original pedestrian buoyancy factor");
        })(),
      nextCrtInteger: () => sharedNativeRandom.nextInteger(),
      hooks: {
        ...this.gameplay.hooks,
        beforePose: (context) => this.beforePose(context),
        afterPose: (context) => {
          const head = this.gameplay.hooks.afterPose?.(context);
          return head && head.status !== "complete"
            ? head
            : this.bleed(context);
        },
        beforeRelease: (context, reason) =>
          reason === "scope" ? this.beforeScopeRelease(context) : [],
        afterRelease: (character) => this.afterScopeRelease(character.owner),
        onRenderPrepared: (character, instance) => {
          const effect = options.effects.get(character.personality);
          if (effect) this.unbind.set(character.owner, effect.bind(instance));
          const ped = this.entries.get(character.owner)!;
          instance.group.name = `native-ordinary:${ped.object.name}`;
          ped.visual.visible = false;
        },
        onRenderReleased: (character, instance) => {
          const ped = this.entries.get(character.owner);
          if (ped) {
            ped.presentation?.captureStaticPose(instance, ped.object);
            ped.visual.visible = true;
          }
          this.unbind.get(character.owner)?.();
          this.unbind.delete(character.owner);
        },
      },
    });
    this.gameplay.bindRuntime(this.runtime);
    this.steering = new OrdinaryPedSteering({
      runtime: this.runtime,
      gameplay: this.gameplay,
      simulation,
      readPed: (owner) => this.entries.get(owner)!,
      settings: options.settings,
      readFrame: options.frame,
      resolveMaterial: options.resolveMaterial,
      warn: options.warn,
      scanForObjects: (ctx, movement) => this.scanObjects(ctx, movement),
      previewWorldFaces: (query, capacity) =>
        simulation.previewPedestrianFaces(query, capacity),
      vanish: (ctx) => this.vanish(ctx),
    });
    const recovery = createOrdinaryPedRecoveryHost<Object3D, GroundSlot>({
      readAllocation: (owner) => this.runtime.allocation(owner),
      readOil: () => simulation.oil ?? null,
      readSlick: options.readSlick,
      readMaterials: options.readSlickMaterials,
      preflight: (ctx, _state, _input, decision) =>
        decision.kind === "upright" || decision.kind === "lying"
          ? this.steering.preflightRecovery(
              ctx,
              decision.direction,
              decision.kind === "upright" ? 1 : 4,
            )
          : [],
      readProcess: (owner) =>
        this.gameplay.state(owner).cache as Process | null,
      releaseBorrowedFaceSlot: (slot) => this.steering.releaseBorrowed(slot),
      recacheGround: (ctx, request) =>
        this.steering.recacheForRecovery(ctx, request.force, request.timeMs),
      setDirection: (ctx, direction, timeMs) =>
        this.steering.directionForRecovery(ctx, direction, 0, timeMs),
      rescanProximity: (ctx) => this.steering.rescanForRecovery(ctx),
      scanObjects: (ctx) => {
        const movement = this.steering.movementInput(ctx);
        return movement
          ? this.scanObjects(ctx, movement)
          : {
              status: "provider-required",
              requiredProviders: ["source-recovery-movement-owner"],
            };
      },
    });
    this.gameplay.options.onRecoveryEffect =
      createNativePedRecoveryEffects(recovery);
    this.gameplay.options.preflightRecoveryEffects =
      recovery.preflightRecoveryEffects;
    for (const [name, template] of options.templates) {
      const effects = options.effects.get(name);
      this.runtime.registerPersonality(name, effects?.template ?? template, {
        modelSet1: effects?.modelSet1,
      });
    }
    for (const ped of options.peds) {
      if (!ped.presentation || !options.noises.has(ped.personality)) {
        options.warn(
          `${ped.object.name}: native physical prerequisites unavailable; retained ordinary movement owner`,
        );
        continue;
      }
      this.entries.set(ped.object, ped);
      this.recordIndices.set(
        ped.object,
        this.records.append({
          position: ped.object.position.toArray() as PedVector,
          action: ped.action,
          objective: ped.nativeObjective,
        }),
      );
      const pose = ped.presentation.instance.rootPose;
      const character = this.runtime.enroll({
        owner: ped.object,
        personality: ped.personality,
        rootPose: pose,
        moveId: ped.moveId,
        direction: [Math.sin(ped.heading), 0, Math.cos(ped.heading)],
        flags: ped.nativeObjective ? 0x200 : 0,
        groundNormal: [0, 1, 0],
        timeMs: 0,
        moveOptions: {
          periodMs:
            ped.walkPeriod ||
            options.templates.get(ped.personality)?.moves.get(ped.moveId)?.form
              .periodMs ||
            0,
        },
      });
      this.gameplay.enroll(ped.object, { action: ped.action, cache: null });
      Object.defineProperty(character, "cacheEventTimeMs", {
        get: () => {
          const cache = this.gameplay.state(ped.object).cache as Process | null;
          return cache
            ? new DataView(
                cache.storage.buffer,
                cache.storage.byteOffset,
                cache.storage.byteLength,
              ).getUint32(0x8c, true)
            : 0;
        },
      });
      // Counting identity is independent of the bounded physical allocation.
      // Bind before first prepare: its source object scan can already kill.
      options.bind(ped, character);
    }
    this.records.finish();
  }
  owns(ped: Ped): boolean {
    return this.entries.has(ped.object);
  }
  admitted(ped: Ped): boolean {
    return this.owns(ped) && !!this.runtime.character(ped.object).body;
  }
  active(ped: Ped): boolean {
    return !!this.runtime.character(ped.object).instance?.physicsActive;
  }
  private beforePose(
    ctx: NativePedRuntimeCallback<Object3D>,
  ): NativePedInstanceResult {
    const ped = this.entries.get(ctx.owner)!;
    const visit = this.processes.visit(ctx.owner, {
      timeMs: ctx.timeMs,
      replay: false,
      minTurnIntervalMs: ped.movement.minTurnMs,
      maxTurnIntervalMs: ped.movement.maxTurnMs,
      spurtingPeriodMs: this.options.spurtingPeriodMs,
    });
    if (visit.status !== "complete")
      return {
        ...complete(),
        status: "provider-required",
        requiredProviders: visit.requiredProviders,
      };
    const input = () => ({
      body: ctx.body,
      processStorage:
        (this.gameplay.state(ctx.owner).cache as Process | null)?.storage ??
        null,
      hitPoints: ctx.character.hitPoints,
      moveId: ctx.character.moveId,
      timeMs: ctx.timeMs,
      replay: false,
      physicsActive: ctx.instance.physicsActive,
      globalGravity: this.options.simulation.gravityMultiplier,
    });
    const host = {
      setMove: (request: {
        id: 110 | 94;
        speed: -1;
        completion: false;
        action: 5;
        timeMs: number;
      }) => this.gameplay.requestMove(ctx, request).requiredProviders,
      kill: () =>
        this.gameplay.killFromEnvironment(ctx.owner).requiredProviders,
      clearBurning: this.options.clearBurning
        ? (signedIndex: number) => this.options.clearBurning!(ped, signedIndex)
        : undefined,
      stopSmoothTurn: () => {
        const process = this.gameplay.state(ctx.owner).cache as Process | null;
        if (!process) return ["source-ped-volume-process-owner"];
        new DataView(
          process.storage.buffer,
          process.storage.byteOffset,
          process.storage.byteLength,
        ).setUint32(0x6c, 0, true);
      },
      activate: () =>
        this.options.simulation.phil.getState(ctx.body) === 2 ||
        this.runtime.activate(ctx.owner)
          ? undefined
          : ["source-ped-volume-activation-owner"],
      nextCrtInteger: () => sharedNativeRandom.nextInteger(),
    };
    let volume = processOrdinaryPedVolume(input(), host);
    if (volume.status !== "complete") return { ...complete(), ...volume };
    const steering = this.steering.prepare(ctx);
    if (
      steering.status !== "complete" ||
      !ctx.character.body ||
      !ctx.character.instance ||
      ctx.character.flags & 0x80
    )
      return steering;
    volume = activateImmersedOrdinaryPed(input(), host);
    return { ...complete(), ...volume };
  }
  private vanish(ctx: NativePedRuntimeCallback<Object3D>): {
    requiredProviders?: readonly string[];
  } {
    if (!this.options.onVanish)
      return { requiredProviders: ["source-native-vanish-population-owner"] };
    // Position recording is explicitly disabled, matching the ordinary AR policy.
    // Vanish is not Kill: retain HP and process ownership, release current PHIL/ACT.
    ctx.character.flags |= 0x80;
    this.pendingVanish.set(ctx.owner, ctx);
    return this.finishVanish(ctx);
  }
  private finishVanish(ctx: NativePedRuntimeCallback<Object3D>): {
    requiredProviders?: readonly string[];
  } {
    const result = this.runtime.releaseCurrent(ctx.owner);
    if (result.status !== "complete") return result;
    this.entries.get(ctx.owner)!.vanished = true;
    this.options.onVanish!(ctx);
    this.records.update(this.recordIndices.get(ctx.owner)!, {
      position: ctx.character.position,
      action: this.gameplay.state(ctx.owner).action,
      flags: ctx.character.flags & 0xffff,
      hitPoints: ctx.character.hitPoints,
    });
    this.pendingVanish.delete(ctx.owner);
    return {};
  }
  nativeAddress(owner: Object3D): number {
    const index = this.recordIndices.get(owner);
    if (index === undefined)
      throw new Error("Unknown native pedestrian record owner");
    return this.records.address(index);
  }
  private emitBlood(
    ctx: NativePedRuntimeCallback<Object3D>,
    packet: NativePedBloodPacket,
  ): readonly string[] {
    if (!this.options.emitBlood) return ["source-native-blood-consumer-owner"];
    const missing = this.options.preflightBlood?.(ctx, packet) ?? [];
    return missing.length
      ? missing
      : (this.options.emitBlood(ctx, packet) ?? []);
  }
  private contactBlood(
    ctx: NativePedRuntimeCallback<Object3D>,
    dispatch: NativePedContactDispatch,
    result: NativePedContactResult,
  ): readonly string[] {
    if (!this.options.emitBlood)
      return this.options.contactEffects(ctx, dispatch, result) ?? [];
    if (
      dispatch.phase !== "active" ||
      !("applied" in result) ||
      !result.applied
    )
      return [];
    const settings = this.options.readBloodSettings?.();
    const point = dispatch.firstRow?.point;
    const goreLevel = this.options.frame().goreLevel ?? 1;
    const volumeGravity =
      ctx.body.specialVolume?.volume?.gravityMultiplier ?? null;
    if (
      goreLevel <= 0 ||
      (volumeGravity !== null && Math.fround(volumeGravity) < 1)
    )
      return [];
    if (!settings) return ["source-native-blood-settings-owner"];
    if (!point) return ["source-native-blood-contact-point-owner"];
    const packet = activeNativePedBloodPacket({
      goreLevel,
      volumeGravity,
      effectiveLambda: result.effectiveLambda,
      simpleMass: ctx.body.properties.mass,
      point: point.toArray() as [number, number, number],
      pedestrianPosition: ctx.character.position,
      velocity: ctx.body.state.velocity.toArray() as [number, number, number],
      other: dispatch.other
        ? {
            address: this.options.simulation.nativeObjectAddress(
              dispatch.other,
            ),
            velocity: dispatch.other.state.velocity.toArray() as [
              number,
              number,
              number,
            ],
          }
        : null,
      pedAddress: this.nativeAddress(ctx.owner),
      timeMs: ctx.timeMs,
      startSize: settings.scrapeStart,
    });
    const missing = packet ? [...this.emitBlood(ctx, packet)] : [];
    const process = this.gameplay.state(ctx.owner).cache as Process | null;
    if (process) {
      const face = dispatch.firstRow?.sourceSurface;
      const smear = accumulateNativePedWorldSmear(process.storage, {
        goreLevel,
        volumeGravity,
        hitPoints: ctx.character.hitPoints,
        otherPresent: !!dispatch.other,
        point: point.toArray() as [number, number, number],
        velocity: ctx.body.state.velocity.toArray() as [number, number, number],
        face: face
          ? {
              normal: face.normal.toArray() as [number, number, number],
              materialName: face.material,
              pixelmapType: face.pixelmapType,
            }
          : null,
      });
      missing.push(...smear.requiredProviders);
    }
    return missing;
  }
  private bleed(
    ctx: NativePedRuntimeCallback<Object3D>,
  ): NativePedInstanceResult {
    if (!this.options.emitBlood) return complete();
    const frame = this.options.frame(),
      gravity = ctx.body.specialVolume?.volume?.gravityMultiplier ?? null;
    if (
      (frame.goreLevel ?? 1) <= 0 ||
      (gravity !== null && Math.fround(gravity) < 1)
    )
      return complete();
    if (
      !ctx.character.removedBoneMask &&
      (!frame.pedestrianAnimation?.mutantSpeed ||
        ctx.character.hitPoints > 0 ||
        this.gameplay.state(ctx.owner).action !== 6)
    )
      return complete();
    const settings = this.options.readBloodSettings?.();
    if (!settings)
      return {
        ...complete(),
        status: "provider-required",
        requiredProviders: ["source-native-blood-settings-owner"],
      };
    const process = this.gameplay.state(ctx.owner).cache as Process | null;
    const allocation = this.runtime.bonePool.allocation(ctx.character);
    const result = processNativePedBleeding(
      {
        goreLevel: this.options.frame().goreLevel ?? 1,
        volumeGravity:
          ctx.body.specialVolume?.volume?.gravityMultiplier ?? null,
        processStorage: process?.storage ?? null,
        timeMs: ctx.timeMs,
        hitPoints: ctx.character.hitPoints,
        action: this.gameplay.state(ctx.owner).action,
        mutantSpeed: this.options.frame().pedestrianAnimation?.mutantSpeed ?? 0,
        removedBoneMask: ctx.character.removedBoneMask,
        vanishedBoneMask: ctx.character.vanishedBoneMask,
        pedestrianPosition: ctx.character.position,
        pedAddress: this.nativeAddress(ctx.owner),
        bodyVelocity: ctx.body.state.velocity.toArray() as [
          number,
          number,
          number,
        ],
        characterVelocity: ctx.instance.nativeCharacterVelocity,
        ...settings,
        globals: this.bleedGlobals,
        bones: ctx.instance.template.form.bones.map((bone, index) => ({
          parent: bone.parent ?? -1,
          childAttachment:
            ctx.instance.template.bones[index].attachments?.child ?? null,
          parentAttachment:
            ctx.instance.template.bones[index].attachments?.parent ?? null,
        })),
      },
      {
        nextCrtInteger: () => sharedNativeRandom.nextInteger(),
        readBone: (index) => ({
          matrix: ctx.instance.bones[index]?.pose ?? null,
          velocity:
            allocation?.bodies[index]?.owner === ctx.owner
              ? (allocation.bodies[index]?.state?.velocity.toArray() as [
                  number,
                  number,
                  number,
                ])
              : null,
        }),
        preflightPacket: (packet) =>
          this.options.preflightBlood?.(ctx, packet) ?? [],
        emit: (packet) => this.emitBlood(ctx, packet),
      },
    );
    return {
      ...complete(),
      status: result.requiredProviders.length
        ? "provider-required"
        : "complete",
      requiredProviders: [...result.requiredProviders],
    };
  }
  finishEffects(): void {
    if (!this.lastFrame || this.lastSmearSerial === this.outerVisitSerial)
      return;
    this.lastSmearSerial = this.outerVisitSerial;
    for (const owner of this.processedEffectsOwners) {
      const character = this.runtime.character(owner),
        process = this.gameplay.state(owner).cache as Process | null;
      const result = consumeNativePedWorldSmear(
        process?.storage ?? null,
        true,
        { skidSection: this.options.skidSection },
      );
      for (const requirement of result.requiredProviders) {
        character.diagnostics.add(requirement);
        this.options.warn(`Native pedestrian effects: ${requirement}`);
      }
    }
  }
  private beforeScopeRelease(
    ctx: NativePedRuntimeCallback<Object3D>,
  ): readonly string[] {
    if (this.pendingScope.has(ctx.owner)) return [];
    const state = this.gameplay.state(ctx.owner),
      process = state.cache as Process | null;
    const burning = process
      ? new DataView(
          process.storage.buffer,
          process.storage.byteOffset,
          process.storage.byteLength,
        ).getInt32(0x98, true)
      : 0;
    const plan = planNativePedScopeExit({
      rendered: true,
      replay: false,
      active: ctx.instance.physicsActive,
      flags: ctx.character.flags,
      hitPoints: ctx.character.hitPoints,
      burningValue: burning,
    });
    if (!plan.beforeRelease.length && !plan.afterRelease.length) return [];
    if (plan.afterRelease.includes("count") && !this.options.onVanish)
      return ["source-native-vanish-population-owner"];
    if (burning && !this.options.clearBurning)
      return ["source-scope-burning-resource-owner"];
    if (burning) {
      const requirements =
        this.options.burningRequirements?.(
          this.entries.get(ctx.owner)!,
          burning,
        ) ?? (burning < 0 ? ["source-scope-burning-resource-preflight"] : []);
      if (requirements.length) return requirements;
    }
    const position = ctx.character.position;
    let height = 0;
    if (plan.afterRelease.includes("score-fall")) {
      const floor = this.options.readScopeFloor?.(position);
      if (!floor) return ["source-native-scope-floor-owner"];
      if (floor.requiredProviders.length) return floor.requiredProviders;
      height = nativePedFallingHeight(position[1], floor.height);
    }
    this.pendingScope.set(ctx.owner, {
      ctx,
      plan,
      burning,
      height,
      position: [...position],
      cache: state.cache ? { ...state.cache } : null,
    });
    for (const action of plan.beforeRelease)
      if (action === "vanish") ctx.character.flags |= 0x80;
    return [];
  }
  private afterScopeRelease(owner: Object3D): void {
    const pending = this.pendingScope.get(owner);
    if (!pending) return;
    const { ctx, plan, burning, height, cache, position } = pending;
    for (const action of plan.afterRelease) {
      if (action === "vanish") ctx.character.flags |= 0x80;
      else if (action === "count") this.options.onVanish!(ctx);
      else if (action === "score-fall" || action === "score-burn") {
        const result = this.gameplay.scoreFromScope(
          ctx,
          action === "score-fall" ? height : 0,
          action === "score-fall" ? "environment" : "napalm",
          cache,
          position,
        );
        for (const requirement of result.requiredProviders)
          ctx.character.diagnostics.add(requirement);
      } else if (action === "stop-burning") {
        const missing =
          this.options.clearBurning!(this.entries.get(owner)!, burning) ?? [];
        for (const requirement of missing)
          ctx.character.diagnostics.add(requirement);
        const process = this.gameplay.state(owner).cache as Process | null;
        if (process && !missing.length)
          new DataView(
            process.storage.buffer,
            process.storage.byteOffset,
            process.storage.byteLength,
          ).setInt32(0x98, 0, true);
      }
    }
    const ped = this.entries.get(owner)!;
    if (ctx.character.flags & 0x80) ped.vanished = true;
    this.records.update(this.recordIndices.get(owner)!, {
      position: ctx.character.position,
      action: this.gameplay.state(owner).action,
      flags: ctx.character.flags & 0xffff,
      hitPoints: ctx.character.hitPoints,
    });
    this.pendingScope.delete(owner);
  }
  private scanObjects(
    ctx: NativePedRuntimeCallback<Object3D>,
    movement: NativePedOrdinaryMoveInput,
  ): NativePedOrdinaryMoveResult {
    const index = this.recordIndices.get(ctx.owner)!,
      ped = this.entries.get(ctx.owner)!,
      state = this.gameplay.state(ctx.owner);
    const mirror = () =>
      this.records.update(index, {
        position: ctx.character.position,
        action: state.action,
        flags: ctx.character.flags & 0xffff,
        hitPoints: ctx.character.hitPoints,
      });
    mirror();
    const objects: NativeOrdinaryPedScanObject<RigidBody>[] =
      (this.scanRoster ??= this.options.simulation.phil.registeredBodies.map(
        (body) => {
          const descriptor = describeNativePedAttributionOther(body, {
            readCharacterCache: (owner) =>
              this.entries.has(owner as Object3D)
                ? this.gameplay.state(owner as Object3D).cache
                : null,
          });
          const hulls = "hulls" in body ? (body.hulls as CollisionHull[]) : [];
          let ex = 0,
            ey = 0,
            ez = 0;
          for (const hull of hulls)
            for (const vertex of hull.vertices) {
              ex = Math.max(ex, Math.abs(vertex.x));
              ey = Math.max(ey, Math.abs(vertex.y));
              ez = Math.max(ez, Math.abs(vertex.z));
            }
          const radiusSquared = ex * ex + ey * ey + ez * ez;
          return {
            body,
            actorPosition: body.state.position.toArray() as PedVector,
            velocity: body.state.velocity.toArray() as PedVector,
            radiusSquared: Math.fround(radiusSquared),
            typeByte: descriptor?.typeByte ?? 0,
            owner: descriptor?.owner ?? null,
            electricRangeSquared:
              "damage" in body
                ? ((body as SimulatedCar).state.proxyRayDistanceSquared ?? 0)
                : 0,
            ...(descriptor?.typeByte === 1 && descriptor.owner
              ? {
                  driver:
                    this.options.simulation.pedestrianAttributionDriver(
                      descriptor.owner,
                    ) ?? undefined,
                }
              : {}),
          };
        },
      ));
    const player =
      objects.find((o) => o.owner === this.options.frame().combatOwner) ?? null;
    const result = scanNativeOrdinaryPedObjects({
      pedAddress: this.records.address(index),
      pedStorage: this.records.record(index),
      processStorage: (state.cache as Process | null)?.storage ?? null,
      timeMs: ctx.timeMs,
      characterVelocity: ctx.instance.nativeCharacterVelocity,
      removedBoneMask: ctx.instance.removedBoneMask,
      walkPeriodBounds: [
        ped.movement.minWalkPeriod,
        ped.movement.maxWalkPeriod,
      ],
      objects,
      playerObject: player,
      globals: {
        immortal: !!this.options.frame().immortalPedestrians,
        suicidal: false,
        blind: false,
        valiumTimeMs: 0,
        playerThreatOverride: false,
      },
      crt: sharedNativeRandom,
      setDirection: (direction, distance, timeMs) => {
        const r = setNativePedXZDirection(
          { ...movement, timeMs },
          direction,
          distance,
        );
        return r.requiredProviders;
      },
      rescanProximity: () =>
        movement.providers.rescanProximity?.(null)?.requiredProviders ?? [
          "source-object-scan-proximity-owner",
        ],
      setMove: (request) => {
        const r = this.gameplay.requestMove(ctx, request);
        mirror();
        return r.requiredProviders;
      },
      startHead: (request) =>
        this.gameplay.startHeadSequence(
          ctx.owner,
          request.address === 0x65d048
            ? nativePedInitialFearHeadSequence
            : request.address === 0x65d050
              ? nativePedScareHeadSequence
              : nativePedCalmHeadSequence,
          request.timeMs,
        ).requiredProviders,
      electric: (object) => {
        this.options.electric(ped, object.body, ctx.timeMs);
        mirror();
      },
      noise: (group) => {
        const table = this.options.noises.get(ped.personality);
        if (!table) return ["source-personality-noise-table-owner"];
        const id = selectNativePedNoise(table, group, (lo, hi) =>
          pedRandomInteger(sharedNativeRandom.random, lo, hi),
        );
        if (id !== undefined)
          this.options.playNoise(id, new Vector3(...ctx.character.position));
      },
    });
    return {
      status: result.status,
      requiredProviders: result.requiredProviders,
    };
  }
  prepare(camera: Vector3, timeMs: number, near: boolean): void {
    if (this.disposed) return;
    const time = Math.trunc(timeMs) >>> 0;
    this.scanRoster = null;
    for (const ctx of this.pendingVanish.values()) this.finishVanish(ctx);
    this.lastFrame = { camera: [camera.x, camera.y, camera.z], time };
    this.outerVisitSerial++;
    const visits = this.runtime.prepareFrame({
      cameraOrigin: this.lastFrame.camera,
      timeMs: time,
      settings: createNativePedPoolSettings(
        this.options.settings.processDistance,
        this.options.settings.popupDistance,
      ),
      pedNearness: near,
      retainedPresentation: this.options.retainedPresentation?.(),
    });
    this.exhaustedOwners.clear();
    this.visits = { processed: 0, exhausted: 0, unsupported: 0, outOfScope: 0 };
    this.processedEffectsOwners.clear();
    for (const visit of visits) {
      if (visit.pool.status === "processed") {
        this.visits.processed++;
        this.processedEffectsOwners.add(visit.pool.character.owner);
      } else if (visit.pool.status === "exhausted") {
        this.visits.exhausted++;
        this.exhaustedOwners.add(visit.pool.character.owner);
      } else if (visit.pool.status === "out-of-scope") this.visits.outOfScope++;
      else this.visits.unsupported++;
      for (const required of visit.pool.requiredProviders)
        this.options.warn(`Native pedestrian lifecycle: ${required}`);
    }
    this.sync();
  }
  sync(): void {
    if (this.disposed) return;
    for (const [owner, ped] of this.entries) {
      const c = this.runtime.character(owner),
        i = c.instance;
      if (i) {
        if (c.body) this.options.onAdmitted?.(ped);
        const root = i.rootPose;
        ped.object.position.set(
          root[9],
          root[10] - (i.move?.asset.personality?.groundingOffset ?? 0),
          root[11],
        );
        ped.velocity.fromArray(i.nativeCharacterVelocity);
        if (c.body) {
          ped.velocity.copy(c.body.state.velocity);
          ped.angularVelocity.copy(c.body.state.angularVelocity);
        }
        ped.corporeal = !!i.physicsActive;
        ped.action = this.gameplay.state(owner).action;
        ped.moveId = c.moveId;
        ped.active = !!(c.flags & 1);
        ped.visual.visible = false;
      } else {
        ped.active = false;
        ped.visual.visible = true;
      }
      // The identity remains a map/count owner; only its FORM slot draws while acquired.
      ped.object.visible = !i && ped.active && !ped.vanished;
    }
  }
  killFromCause(
    ped: Ped,
    cause: "annihilator" | "electric" | "napalm",
    culprit?: object,
  ): boolean {
    const state = this.gameplay.state(ped.object);
    if (state.cache) state.cache.killer = culprit ?? null;
    const result = this.gameplay.killFromCause(ped.object, cause);
    for (const missing of result.requiredProviders)
      this.options.warn(`Native pedestrian cause: ${missing}`);
    this.sync();
    return result.status === "complete";
  }
  repel(
    ped: Ped,
    periodMs: number,
    deltaV: Vector3,
    deltaOmega: Vector3,
    timeMs: number,
  ): boolean {
    const ctx = this.runtime.callbackContext(ped.object);
    const result = this.gameplay.requestMove(
      { ...ctx, timeMs },
      {
        id: 91,
        speed: periodMs,
        completion: false,
        action: PedAction.Impacting,
      },
    );
    if (result.status !== "complete") {
      for (const missing of result.requiredProviders)
        this.options.warn(`Native pedestrian repulsion: ${missing}`);
      return false;
    }
    if (
      this.options.simulation.phil.getState(ctx.body) !== 2 &&
      !this.runtime.activate(ped.object)
    )
      return false;
    ctx.body.state.velocity.add(deltaV);
    ctx.body.state.angularVelocity.add(deltaOmega);
    this.sync();
    return true;
  }
  finishRepulsion(ped: Ped, timeMs: number): void {
    const cache = this.gameplay.state(ped.object).cache as Process | null;
    if (cache)
      new DataView(
        cache.storage.buffer,
        cache.storage.byteOffset,
        cache.storage.byteLength,
      ).setUint32(0x8c, Math.trunc(timeMs) >>> 0, true);
  }
  canReserveNapalm(ped: Ped): boolean {
    return this.gameplay.state(ped.object).cache?.napalmDeadlineMs === 0;
  }
  reserveNapalm(ped: Ped, slot: number): boolean {
    if (!Number.isInteger(slot) || slot < 0 || slot >= NAPALM_CAPACITY)
      throw new Error("Invalid native pedestrian napalm slot");
    if (!this.canReserveNapalm(ped)) return false;
    // Installed SpawnNapalm4ce43e..45b stores -(zero-based slot+1).
    this.gameplay.state(ped.object).cache!.napalmDeadlineMs = -(slot + 1);
    return true;
  }
  releaseNapalm(ped: Ped, slot: number): void {
    const cache = this.gameplay.state(ped.object).cache;
    // Ignite writes the positive deadline before releasing the bolt. A stale
    // reservation release must not erase that deadline or another slot's owner.
    if (cache?.napalmDeadlineMs === -(slot + 1)) cache.napalmDeadlineMs = 0;
  }
  ignite(ped: Ped, timeMs: number, deadlineMs: number, culprit?: object): void {
    const state = this.gameplay.state(ped.object),
      ctx = this.runtime.callbackContext(ped.object);
    if (state.cache) {
      state.cache.flags |= 0x20;
      state.cache.napalmDeadlineMs = deadlineMs;
      state.cache.killer = culprit ?? null;
    }
    if (!ctx.instance.physicsActive && ctx.character.hitPoints > 0) {
      const result = this.gameplay.requestMove(
        { ...ctx, timeMs },
        { id: 41, speed: 100, completion: false, action: PedAction.Running },
      );
      for (const required of result.requiredProviders)
        this.options.warn(`Native pedestrian burning: ${required}`);
    }
    this.sync();
  }
  canShowRetained(ped: Ped): boolean {
    return !this.exhaustedOwners.has(ped.object);
  }
  movementOwned(ped: Ped): boolean {
    return this.owns(ped);
  }
  invalidateWorldGeometry(): void {
    this.steering.invalidateAll();
  }
  get stats() {
    return {
      enrolled: this.entries.size,
      ...this.visits,
      physical: [...this.entries.keys()].filter(
        (o) => !!this.runtime.character(o).body,
      ).length,
      processes: this.processes.slots.filter((s) => !!s.owner).length,
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.runtime.dispose();
    this.steering.dispose();
    this.records.dispose();
    for (const unbind of this.unbind.values()) unbind();
    this.unbind.clear();
    this.pendingVanish.clear();
    this.pendingScope.clear();
    this.processedEffectsOwners.clear();
    this.entries.clear();
    this.disposed = true;
  }
}
