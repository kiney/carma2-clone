/** Production ordinary supported-root owner. Canonical process/ground slots and
 * BON displacement retain their existing owners; no estimated transport is added. */
import type { Object3D } from "three";
import type { MatMaterial } from "./formats";
import type { Ped, PedFrameOptions } from "./pedestrians";
import type { PedSettings } from "./ped-rules";
import { nativePedSlopeCosine } from "./ped-rules";
import { pedRootMotionDirection, type PedVector } from "./ped-form";
import { NativePedGrounding } from "./ped-native-grounding";
import type { NativePedGroundCacheSlot } from "./ped-ground-cache";
import type { NativePedProcessCache } from "./ped-process-cache";
import type {
  NativePedRuntime,
  NativePedRuntimeCallback,
} from "./ped-native-runtime";
import type { NativePedGameplay } from "./ped-native-gameplay";
import type {
  NativePedInstanceResult,
  NativePedInstanceMove,
} from "./ped-native-instance";
import type { VehicleSimulation } from "./physics/simulation";
import type { NativeWorldFaceQuery } from "./physics/world-face-cache";
import type { Surface } from "./world";
import { sharedNativeRandom } from "./native-random";
import {
  rescanNativePedProximity,
  type NativePedProximityExclusions,
} from "./ped-native-proximity";
import {
  accelerateNativeOrdinaryPed,
  setNativePedXZDirection,
  smoothTurnNativeOrdinaryPed,
  wanderNativeOrdinaryPed,
  avoidNativeOrdinaryPed,
  type NativePedOrdinaryMoveInput,
  type NativePedOrdinaryMoveResult,
} from "./ped-ordinary-move";
import {
  NativePedOrdinarySupport,
  NativePedOrdinarySupportError,
  type NativePedOrdinarySupportFace,
} from "./ped-ordinary-support";

type Process = NativePedProcessCache<
  Object3D,
  NativePedGroundCacheSlot<NativePedOrdinarySupportFace>
>;
export interface OrdinaryPedSteeringOptions {
  runtime: NativePedRuntime<Object3D>;
  gameplay: NativePedGameplay<Object3D>;
  simulation: Pick<VehicleSimulation, "world"> & {
    /** The simulation publishes its actual pull/stop callbacks through this outlet. */
    collectPedestrianFaces(
      query: NativeWorldFaceQuery,
      capacity?: number,
    ): readonly Surface[];
  };
  readPed(owner: Object3D): Ped;
  settings: PedSettings;
  readFrame(): PedFrameOptions;
  /** Undefined is unresolved; NULL is an actual resolved native MAT pointer. */
  resolveMaterial?: (name: string) => MatMaterial | null | undefined;
  warn(message: string): void;
  /** Source scanNativeOrdinaryPedObjects provider at the verified source slot.
   * The host supplies actual allocated Ped bytes/address, PHIL order and live
   * gameplay/head/noise/electric outlets, and synchronizes its Ped record.
   * A returned native object-scan result satisfies this status contract. */
  scanForObjects?: (
    context: NativePedRuntimeCallback<Object3D>,
    movement: NativePedOrdinaryMoveInput,
  ) => NativePedOrdinaryMoveResult;
  /** Optional compatibility owner, called at the source object-scan position.
   * Its canonical process writes remain an explicit adapter, without invented
   * pointer-based CRT reseeding or a claim of full PedScanForObjects parity. */
  scanForObjectsAdapter?: (
    context: NativePedRuntimeCallback<Object3D>,
    movement: NativePedOrdinaryMoveInput,
  ) => NativePedOrdinaryMoveResult | void;
}
const f = Math.fround;
const objectScanBoundary = "source-PedScanForObjects-pointer-CRT-provider";
const complete = (): NativePedInstanceResult => ({
  status: "complete",
  requiredProviders: [],
  processedFrames: 0,
  completedMove: false,
});
function finish(result: NativePedOrdinaryMoveResult): NativePedInstanceResult {
  return { ...result, processedFrames: 0, completedMove: false };
}
const readVector = (storage: Uint8Array, offset: number): PedVector => {
  const v = new DataView(
    storage.buffer,
    storage.byteOffset,
    storage.byteLength,
  );
  return [
    v.getFloat32(offset, true),
    v.getFloat32(offset + 4, true),
    v.getFloat32(offset + 8, true),
  ];
};
const view = (process: Process) =>
  new DataView(
    process.storage.buffer,
    process.storage.byteOffset,
    process.storage.byteLength,
  );

export class OrdinaryPedSteering {
  readonly support: NativePedOrdinarySupport;
  readonly grounding: NativePedGrounding<
    Object3D,
    NativePedOrdinarySupportFace
  >;
  private readonly readyOwners = new Set<Object3D>();
  private readonly visited = new Set<Object3D>();
  private readonly warned = new Set<string>();
  private readonly moving = new WeakMap<NativePedInstanceMove, boolean>();
  private disposed = false;
  constructor(readonly options: OrdinaryPedSteeringOptions) {
    this.support = new NativePedOrdinarySupport(options.simulation.world, {
      collectWorldFaces: (query, capacity) =>
        options.simulation.collectPedestrianFaces(query, capacity),
    });
    this.grounding = new NativePedGrounding(options.runtime, {
      readProcessCache: (owner) => this.process(owner),
      readInput: (ctx) => {
        const process = this.process(ctx.owner),
          state = options.gameplay.state(ctx.owner);
        return {
          action: state.action,
          cosMaxSlope: nativePedSlopeCosine(options.settings.maxSlopeDegrees),
          direction: ctx.instance.direction,
          smoothTurnTarget:
            process && view(process).getUint32(0x6c, true)
              ? readVector(process.storage, 0x54)
              : null,
          replay: false,
          replayOverride: false,
          excludePlingMaterials: false,
          pedPosition: ctx.character.position,
          callbackState: state.callback,
        };
      },
      collectFaces: (_ctx, request) => this.support.collectFaces(request),
      queryFace: (_ctx, face, query) => this.support.queryFace(face, query),
      stopSmoothTurn: (ctx) => {
        const process = this.process(ctx.owner);
        if (!process)
          return {
            requiredProviders: ["source-ground-current-process-cache-owner"],
          };
        view(process).setUint32(0x6c, 0, true);
      },
      setPedXZDirection: (ctx, direction) => this.direction(ctx, direction),
      selectMove: (ctx, effect) =>
        options.gameplay.requestMove(ctx, {
          id: effect.move,
          speed: effect.period,
          completion: !!effect.completion,
          action: effect.action,
          retainRoot: true,
        }),
      setAction: (ctx, action) => {
        options.gameplay.state(ctx.owner).action = action;
        options.readPed(ctx.owner).action = action;
      },
      // Vanish/count/release ownership remains PED-07. Omitting that outlet
      // makes NativePedGrounding preflight its unsupported branch before writes.
      proximityRescan: (ctx) => this.scan(ctx, null),
    });
  }
  private process(owner: Object3D): Process | null {
    const cache = this.options.gameplay.state(owner).cache;
    if (!cache) return null;
    const process = cache as Process;
    if (
      !(process.storage instanceof Uint8Array) ||
      process.storage.length !== 0x12c ||
      process.owner !== owner
    )
      return null;
    return process;
  }
  private record(
    ctx: NativePedRuntimeCallback<Object3D>,
    result: NativePedOrdinaryMoveResult,
  ): NativePedInstanceResult {
    for (const requirement of result.requiredProviders) {
      ctx.character.diagnostics.add(requirement);
      this.warning(requirement);
    }
    if (result.status !== "complete") this.readyOwners.delete(ctx.owner);
    return finish(result);
  }
  private warning(name: string): void {
    if (this.warned.has(name)) return;
    this.warned.add(name);
    this.options.warn(`Native pedestrian ordinary movement: ${name}`);
  }
  private exclusions(
    ctx: NativePedRuntimeCallback<Object3D>,
  ): { spec: NativePedProximityExclusions } | { requiredProviders: string[] } {
    const ped = this.options.readPed(ctx.owner),
      resolve = this.options.resolveMaterial;
    const missing: string[] = [];
    const material = (name: string): MatMaterial | null => {
      const value = resolve?.(name);
      if (value === undefined) {
        missing.push(`source-pedestrian-exclusion-MAT:${name}`);
        return null;
      }
      return value;
    };
    const exclusions = ped.spec.exclusions.map((name, i) => ({
      material: material(name),
      flags: (ped.spec.exclusionFlags?.[i] ?? 0) & 0xff,
    }));
    const exceptions = ped.spec.exceptions.map(material);
    return missing.length
      ? { requiredProviders: [...new Set(missing)] }
      : {
          spec: {
            exclusions,
            exceptions,
            exclusionsOkWhenRunning: exclusions.every(
              (entry) => entry.flags !== 0,
            ),
          },
        };
  }
  private scan(
    ctx: NativePedRuntimeCallback<Object3D>,
    direction: PedVector | null,
  ): NativePedOrdinaryMoveResult & { distance: number } {
    const process = this.process(ctx.owner);
    if (!process)
      return {
        status: "provider-required",
        requiredProviders: ["source-ground-current-process-cache-owner"],
        distance: 10000,
      };
    const resolved = this.exclusions(ctx);
    if ("requiredProviders" in resolved)
      return {
        status: "provider-required",
        requiredProviders: resolved.requiredProviders,
        distance: 10000,
      };
    const slot = process.faceCache;
    if (slot)
      this.support.synchronizeMaterialFlags(
        slot.selectedFace && !slot.faces.includes(slot.selectedFace)
          ? [...slot.faces, slot.selectedFace]
          : slot.faces,
      );
    return rescanNativePedProximity({
      process,
      rootPosition: [
        ctx.instance.rootPose[9],
        ctx.instance.rootPose[10],
        ctx.instance.rootPose[11],
      ],
      characterDirection: ctx.instance.direction,
      direction,
      personalityBoundsMaxX: ctx.instance.template.profile.bounds.max[0],
      cosMaxSlope: nativePedSlopeCosine(this.options.settings.maxSlopeDegrees),
      action: this.options.gameplay.state(ctx.owner).action,
      suicidal: false,
      exclusionSpec: resolved.spec,
      readIndexedFace: (face) => this.support.readIndexedFace(face),
      readPreparedGroupVertices: (face, indexed) =>
        this.support.readPreparedGroupVertices(face, indexed),
    });
  }
  private movement(
    ctx: NativePedRuntimeCallback<Object3D>,
  ): NativePedOrdinaryMoveInput | null {
    const process = this.process(ctx.owner);
    if (!process) return null;
    const ped = this.options.readPed(ctx.owner),
      steering = this;
    return {
      process,
      character: {
        get rootPosition() {
          return [
            ctx.instance.rootPose[9],
            ctx.instance.rootPose[10],
            ctx.instance.rootPose[11],
          ] as PedVector;
        },
        get direction() {
          return ctx.instance.direction;
        },
        get up() {
          return ctx.instance.groundNormal;
        },
        get velocity() {
          return ctx.instance.nativeCharacterVelocity;
        },
        get periodMs() {
          return ctx.instance.clock.periodMs;
        },
      },
      get selectedFloorNormal() {
        return process.faceCache?.selectedFace?.normal ?? null;
      },
      timeMs: ctx.timeMs,
      framePeriodMs: this.options.readFrame().framePeriodMs ?? 0,
      movement: {
        minTurnIntervalMs: ped.movement.minTurnMs,
        maxTurnIntervalMs: ped.movement.maxTurnMs,
        maxRandomAngle:
          Math.trunc((ped.movement.maxTurnRadians * 65536) / (2 * Math.PI)) &
          0xffff,
      },
      get action() {
        return steering.options.gameplay.state(ctx.owner).action;
      },
      pedestrianSpeedFactor: 0,
      avoidDistanceSquared: f(this.options.settings.avoidDistance ** 2),
      reachSquared: f(this.options.settings.reach ** 2),
      suicidal: false,
      blind: false,
      providers: {
        nextCrtInteger: () => sharedNativeRandom.nextInteger(),
        setCharacterDirection: (direction, up) => {
          const result = this.options.runtime.setMove(
            ctx.owner,
            ctx.character.moveId,
            direction,
            up,
            ctx.timeMs,
            {
              periodMs: ctx.instance.clock.periodMs,
              retainRoot: true,
            },
          );
          if (result.status !== "complete")
            throw new NativePedOrdinarySupportError(result.requiredProviders);
        },
        setCharacterPeriod: (periodMs) => {
          const result = this.options.runtime.setMove(
            ctx.owner,
            ctx.character.moveId,
            ctx.instance.direction,
            ctx.instance.groundNormal,
            ctx.timeMs,
            {
              periodMs: Math.trunc(periodMs),
              retainRoot: true,
            },
          );
          if (result.status !== "complete")
            throw new NativePedOrdinarySupportError(result.requiredProviders);
        },
        rescanProximity: (direction) => this.scan(ctx, direction),
      },
    };
  }
  private direction(
    ctx: NativePedRuntimeCallback<Object3D>,
    direction: PedVector,
  ): NativePedOrdinaryMoveResult {
    const input = this.movement(ctx);
    return input
      ? setNativePedXZDirection(input, direction, 0)
      : {
          status: "provider-required",
          requiredProviders: ["source-ground-current-process-cache-owner"],
        };
  }
  /** Shared live input for the real object scanner and source recovery outlets. */
  movementInput(
    ctx: NativePedRuntimeCallback<Object3D>,
  ): NativePedOrdinaryMoveInput | null {
    return this.movement(ctx);
  }
  directionForRecovery(
    ctx: NativePedRuntimeCallback<Object3D>,
    direction: PedVector,
    distance = 0,
    timeMs = ctx.timeMs,
  ): NativePedOrdinaryMoveResult {
    try {
      const input = this.movement({ ...ctx, timeMs });
      return input
        ? setNativePedXZDirection(input, direction, distance)
        : {
            status: "provider-required",
            requiredProviders: ["source-ground-current-process-cache-owner"],
          };
    } catch (error) {
      if (error instanceof NativePedOrdinarySupportError)
        return this.record(ctx, {
          status: "provider-required",
          requiredProviders: [...error.requiredProviders],
        });
      throw error;
    }
  }
  rescanForRecovery(
    ctx: NativePedRuntimeCallback<Object3D>,
  ): NativePedOrdinaryMoveResult & { distance: number } {
    return this.scan(ctx, null);
  }
  recacheForRecovery(
    ctx: NativePedRuntimeCallback<Object3D>,
    force = true,
    timeMs = ctx.timeMs,
  ): NativePedInstanceResult {
    try {
      return this.record(
        ctx,
        this.grounding.recache({ ...ctx, timeMs }, force),
      );
    } catch (error) {
      if (error instanceof NativePedOrdinarySupportError)
        return this.record(ctx, {
          status: "provider-required",
          requiredProviders: [...error.requiredProviders],
        });
      throw error;
    }
  }
  /** Root calls after canonical process acquisition, before any BON advance. */
  prepare(ctx: NativePedRuntimeCallback<Object3D>): NativePedInstanceResult {
    const previouslyReady = this.ready(ctx.owner);
    this.readyOwners.delete(ctx.owner);
    if (this.disposed)
      return finish({
        status: "provider-required",
        requiredProviders: ["source-ordinary-steering-disposed"],
      });
    this.visited.add(ctx.owner);
    const state = this.options.gameplay.state(ctx.owner),
      ped = this.options.readPed(ctx.owner);
    if (
      ctx.instance.physicsActive ||
      ctx.character.physicsFlags & 4 ||
      ctx.character.hitPoints <= 0 ||
      !ped.alive
    )
      return complete();
    if (state.action !== 0 && state.action !== 1) {
      // Native Munge skips ordinary support/steering while a fear animation
      // owns action2. Keep its established BON/PHIL owner; legacy movement must
      // not take over merely because this source phase is bypassed.
      if (state.action === 2 && previouslyReady)
        this.readyOwners.add(ctx.owner);
      return complete();
    }
    const input = this.movement(ctx);
    if (!input)
      return this.record(ctx, {
        status: "provider-required",
        requiredProviders: ["source-ground-current-process-cache-owner"],
      });
    try {
      let result = accelerateNativeOrdinaryPed(input);
      if (result.status !== "complete") return this.record(ctx, result);
      const ground = this.grounding.advance(ctx);
      if (ground.completion.status !== "complete")
        return this.record(ctx, ground.completion);
      if (ground.ground.status === "fall" || ctx.instance.physicsActive) {
        this.warning("source-PED07-fall-and-recovery-production-owner");
        return complete();
      }
      if (!input.selectedFloorNormal)
        return this.record(ctx, {
          status: "provider-required",
          requiredProviders: ["source-selected-pedestrian-floor-normal"],
        });
      const process = this.process(ctx.owner)!,
        data = view(process),
        smooth = data.getUint32(0x6c, true) !== 0;
      const scanDirection = process.retainedDirection,
        direction = ctx.instance.direction;
      if (
        !smooth &&
        !ground.ground.needProximityRescan &&
        direction[1] * scanDirection[1] +
          direction[2] * scanDirection[2] +
          direction[0] * scanDirection[0] <
          0.9998
      ) {
        result = this.scan(ctx, null);
        if (result.status !== "complete") return this.record(ctx, result);
      }
      const move = ctx.instance.move;
      if (!move)
        return this.record(ctx, {
          status: "provider-required",
          requiredProviders: ["source-ordinary-current-move"],
        });
      let causesMovement = this.moving.get(move);
      if (causesMovement === undefined) {
        causesMovement = !pedRootMotionDirection(
          move.roots,
          move.asset.form.direction,
          move.asset.form.resetAxes,
        ).stationary;
        this.moving.set(move, causesMovement);
      }
      if (causesMovement) {
        if (smooth) {
          result = smoothTurnNativeOrdinaryPed(input);
          if (result.status === "complete") result = this.scan(ctx, null);
        } else result = wanderNativeOrdinaryPed(input);
        if (result.status !== "complete") return this.record(ctx, result);
        if (this.options.scanForObjects) {
          // Actual source scanner owns CRT reseeding and all its ordered stores.
          // Do not advertise the former missing-pointer boundary after wiring it.
          ctx.character.diagnostics.delete(objectScanBoundary);
          result = this.options.scanForObjects(ctx, input);
        } else {
          this.warning(objectScanBoundary);
          ctx.character.diagnostics.add(objectScanBoundary);
          result = this.options.scanForObjectsAdapter?.(ctx, input) ?? {
            status: "complete",
            requiredProviders: [],
          };
        }
        if (result.status !== "complete") return this.record(ctx, result);
        result = avoidNativeOrdinaryPed(input);
        if (result.status !== "complete") return this.record(ctx, result);
      }
      this.readyOwners.add(ctx.owner);
      ped.heading = Math.atan2(
        ctx.instance.direction[0],
        ctx.instance.direction[2],
      );
      ped.action = state.action;
      ped.moveId = ctx.character.moveId;
      return complete();
    } catch (error) {
      if (error instanceof NativePedOrdinarySupportError)
        return this.record(ctx, {
          status: "provider-required",
          requiredProviders: [...error.requiredProviders],
        });
      throw error;
    }
  }
  /** Synchronous ownership check for the legacy update gate. The first visit
   * must prepare support before this can return true; geometry invalidation,
   * process eviction and physical/resource transitions revoke it immediately. */
  ready(owner: Object3D): boolean {
    if (this.disposed || !this.readyOwners.has(owner)) return false;
    const c = this.options.runtime.character(owner);
    return (
      !!c.instance &&
      !!c.body &&
      !c.instance.physicsActive &&
      !(c.physicsFlags & 4) &&
      !!(c.flags & 1) &&
      !(c.flags & 0x80) &&
      c.hitPoints > 0 &&
      this.options.readPed(owner).alive &&
      !!this.process(owner)?.faceCache?.selectedFace
    );
  }
  releaseBorrowed(
    slot: NativePedGroundCacheSlot<NativePedOrdinarySupportFace>,
  ): void {
    if (slot.owner) this.readyOwners.delete(slot.owner as Object3D);
    this.grounding.releaseBorrowedFaceSlot(slot);
  }
  invalidateAll(): void {
    for (const owner of this.visited) this.grounding.invalidate(owner);
    this.readyOwners.clear();
  }
  reset(): void {
    this.grounding.reset();
    this.readyOwners.clear();
    this.visited.clear();
    this.warned.clear();
  }
  dispose(): void {
    if (this.disposed) return;
    this.reset();
    this.disposed = true;
  }
}
