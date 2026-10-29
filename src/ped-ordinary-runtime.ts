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
import type { MatMaterial } from "./formats";
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
  bind: (
    ped: Ped,
    character: ReturnType<NativePedRuntime<Object3D>["enroll"]>,
  ) => void;
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
  private disposed = false;
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
      killGiblets: options.killGiblets,
      contactEffects: options.contactEffects,
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
    });
    const recovery = createOrdinaryPedRecoveryHost<Object3D, GroundSlot>({
      readAllocation: (owner) => this.runtime.allocation(owner),
      readOil: () => simulation.oil ?? null,
      readSlick: options.readSlick,
      readMaterials: options.readSlickMaterials,
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
    if (ctx.instance.physicsActive || !ped.alive) return complete();
    return this.steering.prepare(ctx);
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
    this.lastFrame = { camera: [camera.x, camera.y, camera.z], time };
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
    for (const visit of visits) {
      if (visit.pool.status === "processed") {
        this.visits.processed++;
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
    this.entries.clear();
    this.disposed = true;
  }
}
