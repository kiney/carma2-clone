/** Concrete ordinary FORM resource host. See c2-ped-body-pool-re.md and
 * c2-ped-bone-runtime-re.md. The owning pedestrian array supplies gameplay
 * contact/halt continuations; this module owns ACT/object/PHIL lifetimes. */
import { Group, Mesh, Vector3 } from "three";
import type { PedVector } from "./ped-form";
import type { NativePedAssets } from "./ped-native-assets";
import type { NativePedDeadModels } from "./ped-dead-models";
import {
  createNativePedInstance,
  advanceNativePedPose,
  poseNativePedFrame,
  synchronizeNativePedPhysicalPose,
  selectNativePedMove,
  selectNativePedBoneModel,
  releaseNativePedActorSet,
  type NativePedActorSet,
  type NativePedInstance,
  type NativePedInstanceResult,
  type NativePedMoveSelectionOptions,
  type NativePedAdvanceOptions,
} from "./ped-native-instance";
import {
  NativePedBodyPool,
  type NativePedPoolAllocation,
  type NativePedPoolCharacter,
  type NativePedPoolFrame,
  type NativePedPoolVisit,
} from "./ped-body-pool";
import { NativePedBonePool } from "./physics/ped-bone-pool";
import {
  createNativePedBody,
  prepareNativePedBody,
  finishNativePedBodyInitialization,
  activateNativePedBody,
  nativePedRootPose,
  type NativePedBody,
  type NativePedContactContext,
  type NativePedContactDispatch,
  type NativePedContactResult,
} from "./physics/ped-body";
import {
  createNativePedBoneResource,
  prepareNativePedBoneResource,
  finishNativePedBoneInitialization,
  commitNativePedBoneBody,
  type NativePedBoneBody,
  type NativePedBoneResource,
} from "./physics/ped-bone-body";
import type {
  NativePedSeverBoneRequest,
  NativePedSeverBoneSnapshot,
  NativePedSeverRegistration,
  NativePedSeverKillModelEffect,
} from "./physics/ped-sever";
import type { RigidBody } from "./physics/contact";
import type { VehicleSimulation } from "./physics/simulation";
import {
  setNativePedPosition,
  type NativePedSetPositionResult,
} from "./ped-set-position";
import type { NativePedMoveCallbackState } from "./physics/ped-active-move";

export type NativePedRuntimeSimulation = Pick<
  VehicleSimulation,
  | "scene"
  | "phil"
  | "addPedBody"
  | "removePedBody"
  | "addPedBoneBody"
  | "removePedBoneBody"
>;
export interface NativePedRuntimeBody<Owner extends object>
  extends NativePedBody {
  /** Source Object+23c owner, cleared only after actual PHIL release. */
  owner: Owner | null;
}
export interface NativePedRuntimeRender {
  actorSet: NativePedActorSet;
  instance: NativePedInstance | null;
}
interface Personality {
  assets: NativePedAssets;
  formKey: string;
  modelSet1?: NativePedDeadModels["modelSet1"];
}
export interface NativePedRuntimeCharacter<Owner extends object>
  extends NativePedPoolCharacter<Owner> {
  personality: string;
  rootPose: Float32Array;
  direction: PedVector;
  groundNormal: PedVector;
  moveId: number;
  moveOptions: NativePedMoveSelectionOptions;
  modelSet: 0 | 1;
  modelPoses: number[];
  removedBoneMask: number;
  vanishedBoneMask: number;
  bonedSlot: number;
  movementDisabled: boolean;
  /** BON freeze mode, independent of disabled translational movement. */
  poseMode?: 0 | 1 | 2 | 3;
  instance: NativePedInstance | null;
  body: NativePedRuntimeBody<Owner> | null;
  diagnostics: Set<string>;
  hitPoints: number;
  impactCount: number;
}
export interface NativePedRuntimeCallback<Owner extends object> {
  character: NativePedRuntimeCharacter<Owner>;
  owner: Owner;
  instance: NativePedInstance;
  body: NativePedRuntimeBody<Owner>;
  timeMs: number;
  framePeriodMs: number;
}
export interface NativePedRuntimeHooks<Owner extends object> {
  /** Original outer current-root grounding/proximity phase after resource
   * admission and before this frame's BON advancement or passive PHIL write. */
  beforePose?: (
    context: NativePedRuntimeCallback<Owner>,
  ) => NativePedInstanceResult | void;
  /** After BON/passive Object V, before ped.pos/root record stores. Stillify
   * observes the preceding ped.pos while the current ACT/root is available. */
  beforeSaveRoot?: (
    context: NativePedRuntimeCallback<Owner>,
  ) => NativePedInstanceResult | void;
  /** Processed outer visit after BON, passive V/matrix and ped.pos stores.
   * Head animation belongs here, never in PHIL moved/halt substeps. */
  afterPose?: (
    context: NativePedRuntimeCallback<Owner>,
  ) => NativePedInstanceResult | void;
  contactProvider?: (
    context: NativePedRuntimeCallback<Owner>,
    dispatch: NativePedContactDispatch,
  ) => NativePedContactContext;
  onDamage?: (
    context: NativePedRuntimeCallback<Owner>,
    result: NativePedContactResult,
    phase: "passive" | "active",
  ) => void;
  onActivated?: (
    context: NativePedRuntimeCallback<Owner>,
    other?: RigidBody,
  ) => void;
  /** Source moved tail owns speed-period/low-gravity RNG and gameplay outlets. */
  onMoved?: (context: NativePedRuntimeCallback<Owner>) => void;
  /** Return the actual native0/1, or explicit unresolved providers. The wrapper
   * has derived O/posed mode3 and cleared character active bit4 beforehand. */
  onHalt?: (
    context: NativePedRuntimeCallback<Owner>,
    reason: "quiet" | "release",
  ) => { returnValue: 0 | 1 | null; requiredProviders?: readonly string[] };
  activeSetMove?: (
    context: NativePedRuntimeCallback<Owner>,
    id: number,
    direction: PedVector,
    groundNormal: PedVector,
    options: NativePedMoveSelectionOptions,
  ) => NativePedInstanceResult;
  beforeRelease?: (
    context: NativePedRuntimeCallback<Owner>,
  ) => readonly string[];
  /** Source bounded stored-dismembered table owner. Do not replace it with an
   * unlimited per-ped snapshot cache. Invoked after all PHIL removals. */
  storeRemovedPoses?: (
    character: NativePedRuntimeCharacter<Owner>,
    instance: NativePedInstance,
  ) => void;
  restoreRemovedPoses?: (
    character: NativePedRuntimeCharacter<Owner>,
    instance: NativePedInstance,
  ) => readonly string[];
  readBone?: (
    character: NativePedRuntimeCharacter<Owner>,
    index: number,
  ) => NativePedSeverBoneSnapshot<Group, Group> | null;
  /** Required for an actual retained articulated owner; never clear joint2. */
  unlinkBone?: (
    character: NativePedRuntimeCharacter<Owner>,
    body: NativePedBoneBody<Group>,
  ) => void;
  onMoveCompleted?: (
    character: NativePedRuntimeCharacter<Owner>,
    instance: NativePedInstance,
    timeMs: number,
  ) => void;
  onHeadSequenceCleared?: (character: NativePedRuntimeCharacter<Owner>) => void;
}
export interface NativePedRuntimeOptions<Owner extends object> {
  /** Original global74299c; source character owner supplies it, without default. */
  levelOut: number;
  hooks?: NativePedRuntimeHooks<Owner>;
}
export type NativePedRuntimeAllocation<Owner extends object> =
  NativePedPoolAllocation<
    Owner,
    NativePedRuntimeRender,
    NativePedRuntimeBody<Owner>
  >;
export interface NativePedRuntimeFrameVisit<Owner extends object> {
  pool: NativePedPoolVisit<
    Owner,
    NativePedRuntimeRender,
    NativePedRuntimeBody<Owner>
  >;
  pose: NativePedInstanceResult | null;
  /** Failure retains completed BON and passive Object V stores. */
  beforeSaveRoot?: NativePedInstanceResult;
  /** Does not undo an already completed BON advance on a missing outlet. */
  afterPose?: NativePedInstanceResult;
}
const identity = () => new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
const f = Math.fround;
function matrix(input: ArrayLike<number>): Float32Array {
  if (
    input.length !== 12 ||
    Array.from(input).some((value) => !Number.isFinite(f(value)))
  )
    throw new Error("Native runtime requires a finite native12 root ACT");
  return Float32Array.from(input);
}
function missing(...providers: string[]): NativePedInstanceResult {
  return {
    status: "provider-required",
    requiredProviders: providers,
    processedFrames: 0,
    completedMove: false,
  };
}

export class NativePedRuntime<Owner extends object = object> {
  readonly bodyPool: NativePedBodyPool<
    Owner,
    NativePedRuntimeRender,
    NativePedRuntimeBody<Owner>
  >;
  readonly bonePool: NativePedBonePool<
    Owner,
    Group,
    Group,
    NativePedBoneResource<Group>
  >;
  private readonly forms = new Map<string, NativePedAssets>();
  private readonly personalities = new Map<string, Personality>();
  private readonly records = new Map<Owner, NativePedRuntimeCharacter<Owner>>();
  private readonly hooks: NativePedRuntimeHooks<Owner>;
  private currentTimeMs = 0;
  constructor(
    readonly simulation: NativePedRuntimeSimulation,
    readonly options: NativePedRuntimeOptions<Owner>,
  ) {
    if (!Number.isFinite(f(options.levelOut)))
      throw new Error("Native level-out scalar required");
    this.hooks = options.hooks ?? {};
    this.bonePool = new NativePedBonePool({
      createBone: (_key, _slot, _index, bone) =>
        createNativePedBoneResource<Group>(bone.collisionType),
      prepareBone: (a, body, request) => {
        prepareNativePedBoneResource(body, {
          request,
          owner: a.character.owner,
          levelOut: options.levelOut,
        });
      },
      finishBone: (_a, resource) => {
        const body = this.preparedBone(resource);
        body.poseTarget = this.character(body.owner as Owner).instance!.bones[
          body.boneIndex
        ].pose;
        finishNativePedBoneInitialization(body, (part) =>
          this.syncBoneHeader(part),
        );
        const admitted = simulation.addPedBoneBody(body);
        if (!admitted.accepted)
          throw new Error("Registered native bone failed solver admission");
      },
      registrar: {
        registerImmediate: (resource) =>
          simulation.phil.registerImmediate(this.preparedBone(resource)),
        header: (resource) => ({
          state: simulation.phil.getState(resource),
          queued: false,
        }),
        remove: (resource) => {
          const body = this.preparedBone(resource),
            code = simulation.phil.getState(body) === 0 ? 3 : 0;
          simulation.removePedBoneBody(body);
          return { code, phase: "complete" };
        },
      },
      clearBone: (_a, resource) => {
        resource.poseTarget = undefined;
        resource.owner = null;
        resource.registered = false;
        resource.detached = false;
      },
      supportsShape: (bone) =>
        bone.collisionType === "BOX" || bone.collisionType === "SPHERE",
    });
    this.bodyPool = new NativePedBodyPool<
      Owner,
      NativePedRuntimeRender,
      NativePedRuntimeBody<Owner>
    >({
      createRender: (key, slot) => {
        const group = new Group();
        group.name = `${key} render slot ${slot}`;
        group.matrixAutoUpdate = false;
        const actors = this.forms.get(key)!.form.bones.map((bone) => {
          const actor = new Group();
          actor.name = bone.name;
          actor.matrixAutoUpdate = false;
          group.add(actor);
          return actor;
        });
        return { actorSet: { group, actors }, instance: null };
      },
      createSimple: (key) => {
        const body = createNativePedBody({
          actor: new Group(),
          profile: this.forms.get(key)!.profile,
          rootPose: identity(),
          levelOut: 0,
        }) as NativePedRuntimeBody<Owner>;
        // BrMemAllocate supplies zero persistent Object+19c/+64 and no header.
        // createNativePedBody is the prepared convenience constructor; reset
        // its post-registration policy here, before any source preparation.
        body.owner = null;
        body.headerState = 0;
        body.rigidFlags = 0;
        body.properties.worldFriction = 0;
        body.properties.objectFriction = 0;
        body.gravity = 0;
        body.volumeEnabled = false;
        body.suppressWorldFaces = false;
        body.suppressSelfSentinel = false;
        body.suppressJointConstraints = false;
        body.filterA = 0;
        body.filterB = 0;
        return body;
      },
      prepareRender: (c, render) => {
        const record = this.character(c.owner),
          personality = this.personalities.get(record.personality)!;
        const instance = createNativePedInstance(personality.assets, {
          rootPose: record.rootPose,
          actorSet: render.actorSet,
          modelSet1: personality.modelSet1,
        });
        render.instance = record.instance = instance;
        this.copyMasks(record);
        for (let index = 0; index < instance.bones.length; index++) {
          const result = selectNativePedBoneModel(
            instance,
            index,
            record.modelPoses[index],
            record.modelSet,
          );
          this.recordResult(record, result);
        }
        const selected = this.selectMove(
          record,
          record.moveId,
          record.direction,
          record.groundNormal,
          this.currentTimeMs,
          record.moveOptions,
        );
        this.recordResult(record, selected);
        simulation.scene.add(instance.group);
      },
      prepareSimple: (a) => {
        const record = this.character(a.character.owner),
          instance = a.render.instance!;
        prepareNativePedBody(a.body, {
          actor: instance.bones[0].actor,
          profile: instance.hullProfile,
          rootPose: instance.rootPose,
          levelOut: options.levelOut,
        });
        a.body.owner = record.owner;
        a.body.hitPoints = record.hitPoints;
        a.body.pedestrianFlags = record.flags;
        a.body.impactCount = record.impactCount;
        record.body = a.body;
        this.bindCallbacks(record, a.body);
      },
      registrar: {
        registerImmediate: (body) => simulation.phil.registerImmediate(body),
        remove: (body) => {
          const record = this.character(body.owner!),
            code = simulation.phil.getState(body) === 0 ? 3 : 0;
          simulation.removePedBody(body);
          const release = this.bonePool.releaseRemovedParts(record);
          if (release === "release-pending")
            throw new Error("Native removed-part release is still pending");
          record.vanishedBoneMask >>>= 0;
          this.copyMasks(record);
          return { code, phase: "complete" };
        },
      },
      finishSimple: (a) => {
        finishNativePedBodyInitialization(a.body);
        simulation.addPedBody(a.body);
      },
      beforeRelease: (a) =>
        this.beforeRelease(this.character(a.character.owner)),
      clearSimple: (a) => {
        const record = this.character(a.character.owner);
        a.body.owner = null;
        a.body.contactProvider = undefined;
        a.body.onActivated = undefined;
        a.body.onContactDamage = undefined;
        a.body.onMoved = undefined;
        a.body.onHalt = undefined;
        record.body = null;
      },
      releaseRender: (c, render) => {
        const record = this.character(c.owner),
          instance = render.instance!;
        record.rootPose.set(instance.rootPose);
        record.modelSet = instance.modelSet;
        record.modelPoses = instance.bones.map((bone) => bone.poseIndex);
        if (record.removedBoneMask && this.hooks.storeRemovedPoses)
          this.hooks.storeRemovedPoses(record, instance);
        for (const bone of instance.bones) instance.group.add(bone.actor);
        releaseNativePedActorSet(instance, {
          isPhysicsReleased: () =>
            !simulation.phil.registeredBodies.some(
              (body) =>
                "actor" in body &&
                instance.bones.some((bone) => bone.actor === body.actor),
            ),
        });
        instance.group.removeFromParent();
        render.instance = null;
        record.instance = null;
        // Failed admission still retains preparation writes in the free body,
        // but the character does not own that physical slot.
        record.body = null;
      },
      acquireRemovedParts: (a) => {
        const record = this.character(a.character.owner);
        const restored = this.hooks.restoreRemovedPoses?.(
          record,
          record.instance!,
        ) ?? ["native-stored-dismembered-pose-owner"];
        if (restored.length) return restored;
        const acquired = this.bonePool.reacquire(record, (index) =>
          this.readBone(record.owner, index),
        );
        if (acquired.slot !== null) {
          const allocation = this.bonePool.allocation(record)!;
          for (const { index, code } of acquired.results)
            if (code === 0) {
              this.preparedBone(allocation.bodies[index]!).detached = true;
              record.instance!.detachedBoneMask |= (1 << index) >>> 0;
            }
        }
        return [];
      },
    });
  }
  private preparedBone(
    resource: NativePedBoneResource<Group>,
  ): NativePedBoneBody<Group> {
    if (
      resource.rigidType !== 5 ||
      !resource.actor ||
      !resource.model ||
      !resource.owner
    )
      throw new Error("Prepared native bone resource required");
    return resource as NativePedBoneBody<Group>;
  }
  private syncBoneHeader(body: NativePedBoneBody<Group>) {
    const header = this.simulation.phil.getHeader(body)!;
    header.flags = body.headerFlags;
    header.gravity = body.gravity;
    header.levelOut = body.levelOut;
  }
  registerPersonality(
    name: string,
    assets: NativePedAssets,
    options: {
      formKey?: string;
      deadModels?: NativePedDeadModels;
      modelSet1?: NativePedDeadModels["modelSet1"];
    } = {},
  ): void {
    if (!name || this.personalities.has(name))
      throw new Error("Duplicate or missing native personality identity");
    const key = options.formKey ?? assets.profile.formName;
    const old = this.forms.get(key);
    if (old && JSON.stringify(old.form) !== JSON.stringify(assets.form))
      throw new Error("Conflicting shared native FORM definition");
    this.forms.set(key, old ?? assets);
    this.bodyPool.registerForm(key, assets.form);
    this.bonePool.registerForm(key, assets.form);
    this.personalities.set(name, {
      assets,
      formKey: key,
      modelSet1: options.modelSet1 ?? options.deadModels?.modelSet1,
    });
  }
  enroll(input: {
    owner: Owner;
    personality: string;
    rootPose: ArrayLike<number>;
    moveId: number;
    direction: PedVector;
    groundNormal: PedVector;
    timeMs: number;
    flags?: number;
    physicsFlags?: number;
    removedBoneMask?: number;
    vanishedBoneMask?: number;
    moveOptions?: NativePedMoveSelectionOptions;
    modelSet?: 0 | 1;
    hitPoints?: number;
    impactCount?: number;
  }): NativePedRuntimeCharacter<Owner> {
    if (!input.owner || this.records.has(input.owner))
      throw new Error("Native character owner must be distinct");
    const personality = this.personalities.get(input.personality);
    if (!personality)
      throw new Error("Register native personality before enrollment");
    const pose = matrix(input.rootPose);
    if (
      !Number.isInteger(input.timeMs) ||
      input.timeMs < 0 ||
      input.timeMs > 0xffffffff
    )
      throw new Error("Native character uint32 clock required");
    const record: NativePedRuntimeCharacter<Owner> = {
      owner: input.owner,
      personality: input.personality,
      formKey: personality.formKey,
      rootPose: pose,
      position: [pose[9], pose[10], pose[11]],
      direction: input.direction,
      groundNormal: input.groundNormal,
      moveId: input.moveId,
      moveOptions: input.moveOptions ?? {},
      flags: input.flags ?? 0,
      physicsFlags: input.physicsFlags ?? 0,
      removedBoneMask: input.removedBoneMask ?? 0,
      vanishedBoneMask: input.vanishedBoneMask ?? 0,
      bonedSlot: -1,
      modelSet: input.modelSet ?? 0,
      modelPoses: personality.assets.bones.map(() => 0),
      movementDisabled: false,
      instance: null,
      body: null,
      diagnostics: new Set(),
      hitPoints: input.hitPoints ?? 100,
      impactCount: input.impactCount ?? 0,
    };
    this.records.set(input.owner, record);
    return record;
  }
  get characters(): readonly NativePedRuntimeCharacter<Owner>[] {
    return [...this.records.values()];
  }
  character(owner: Owner): NativePedRuntimeCharacter<Owner> {
    const record = this.records.get(owner);
    if (!record) throw new Error("Unknown native character owner");
    return record;
  }
  allocation(owner: Owner): NativePedRuntimeAllocation<Owner> | null {
    return this.bodyPool.allocation(owner);
  }
  /** Read the enrolled personality's actual signed FORM head index, including−1. */
  headBone(owner: Owner): number {
    return this.personalities.get(this.character(owner).personality)!.assets
      .form.headBone;
  }
  /** Explicit source root-position owner. An active PHIL pose must be changed
   * by its physical provider, never overwritten with a walking/render pose. */
  setRootPose(
    owner: Owner,
    rootPose: ArrayLike<number>,
  ): NativePedInstanceResult {
    const c = this.character(owner),
      pose = matrix(rootPose);
    if (c.body && this.simulation.phil.getState(c.body) === 2)
      return missing("native-active-root-position-provider");
    c.rootPose.set(pose);
    c.position = [pose[9], pose[10], pose[11]];
    if (!c.instance)
      return {
        status: "complete",
        requiredProviders: [],
        processedFrames: 0,
        completedMove: false,
      };
    c.instance.rootPose.set(pose);
    const result = poseNativePedFrame(c.instance, 3);
    if (result.status === "complete" && c.body)
      this.simulation.phil.setPassiveMatrix(c.body, c.instance.rootPose);
    this.recordResult(c, result);
    return result;
  }
  /** Installed SetCharacterPosition(mode1). Use the raw finite ground hit,
   * not an already clearance-offset point. Ped.pos remains an outer-tail store;
   * this core does not advance BON clocks or overwrite an active physical root. */
  setGroundPosition(
    owner: Owner,
    groundPoint: PedVector,
    callbackState?: NativePedMoveCallbackState,
  ): NativePedSetPositionResult | NativePedInstanceResult {
    const c = this.character(owner);
    if (!c.instance || !c.body)
      return missing("native-position-render-and-simple-body-owner");
    const result = setNativePedPosition({
      instance: c.instance,
      groundPoint,
      physicsFlags: c.physicsFlags,
      callbackState,
      writePassiveMatrix: (pose) =>
        this.simulation.phil.setPassiveMatrix(c.body!, pose),
    });
    if (result.status === "complete") c.rootPose.set(c.instance.rootPose);
    this.recordResult(c, result);
    return result;
  }
  /** Gameplay owns these source fields; pool ownership remains authoritative.
   * Directly writing physicsFlags cannot add/remove or activate a PHIL object. */
  updateState(
    owner: Owner,
    update: Partial<
      Pick<
        NativePedRuntimeCharacter<Owner>,
        | "flags"
        | "removedBoneMask"
        | "vanishedBoneMask"
        | "movementDisabled"
        | "poseMode"
        | "hitPoints"
        | "impactCount"
        | "cacheEventTimeMs"
      >
    >,
  ): void {
    const c = this.character(owner);
    for (const key of ["flags", "removedBoneMask", "vanishedBoneMask"] as const)
      if (
        update[key] !== undefined &&
        (!Number.isInteger(update[key]) ||
          update[key]! < 0 ||
          update[key]! > 0xffffffff)
      )
        throw new Error("Native character mask/flags must be uint32");
    if (
      update.hitPoints !== undefined &&
      (!Number.isInteger(update.hitPoints) ||
        update.hitPoints < -128 ||
        update.hitPoints > 127)
    )
      throw new Error("Native character HP must be signed byte");
    Object.assign(c, update);
    this.copyMasks(c);
    if (c.body) {
      c.body.hitPoints = c.hitPoints;
      c.body.pedestrianFlags = c.flags;
      c.body.impactCount = c.impactCount;
    }
  }
  private copyMasks(c: NativePedRuntimeCharacter<Owner>) {
    if (!c.instance) return;
    c.instance.removedBoneMask = c.removedBoneMask;
    c.instance.vanishedBoneMask = c.vanishedBoneMask;
    c.instance.movementDisabled = c.movementDisabled;
  }
  private recordResult(
    c: NativePedRuntimeCharacter<Owner>,
    result: NativePedInstanceResult,
  ) {
    for (const provider of result.requiredProviders)
      c.diagnostics.add(provider);
  }
  private saveRoot(c: NativePedRuntimeCharacter<Owner>) {
    c.rootPose.set(c.instance!.rootPose);
    c.position = [c.rootPose[9], c.rootPose[10], c.rootPose[11]];
  }
  private context(
    c: NativePedRuntimeCharacter<Owner>,
    framePeriodMs = 0,
  ): NativePedRuntimeCallback<Owner> {
    if (!c.instance || !c.body)
      throw new Error("Native callback requires current ACT/body ownership");
    return {
      character: c,
      owner: c.owner,
      instance: c.instance,
      body: c.body,
      timeMs: this.currentTimeMs,
      framePeriodMs,
    };
  }
  /** Once before actual physics; source records retain insertion/source order.
   * Ground/proximity/AI owners update root/move state before calling this. */
  prepareFrame(frame: NativePedPoolFrame): NativePedRuntimeFrameVisit<Owner>[] {
    this.currentTimeMs = frame.timeMs;
    const visits = this.bodyPool.visitFrame(this.characters, frame);
    return visits.map((pool) => {
      const c = this.character(pool.character.owner);
      let pose: NativePedInstanceResult | null = null;
      let beforeSaveRoot: NativePedInstanceResult | void = undefined;
      let afterPose: NativePedInstanceResult | void = undefined;
      if (c.body) c.body.pedestrianFlags = c.flags;
      if (pool.status === "processed" && c.instance && c.body) {
        this.copyMasks(c);
        c.instance.physicsActive = this.simulation.phil.getState(c.body) === 2;
        const preparation = this.hooks.beforePose?.(this.context(c));
        if (preparation) {
          this.recordResult(c, preparation);
          if (preparation.status !== "complete")
            return { pool, pose: preparation };
        }
        // Current-root MakePedVanish may have released this admitted ACT/body.
        // Do not pose an unowned resource, or advance a newly vanished record.
        if (!c.instance || !c.body || c.flags & 0x80)
          return { pool, pose: preparation ?? null };
        // Ground/AI owners may have changed the masks or movement state.
        this.copyMasks(c);
        c.body.pedestrianFlags = c.flags;
        const options: NativePedAdvanceOptions = { mode: c.poseMode };
        if (c.instance.physicsActive) {
          options.activeRootPose = nativePedRootPose(c.body);
          options.activeWorldVelocity = c.body.state.velocity.toArray() as [
            number,
            number,
            number,
          ];
        }
        pose = advanceNativePedPose(c.instance, frame.timeMs, options);
        this.recordResult(c, pose);
        if (pose.status === "complete") {
          if (!c.instance.physicsActive) {
            this.simulation.phil.setPassiveMatrix(c.body, c.instance.rootPose);
            // Munge4d4bee..4d4c0c copies character+d8 raw world V into
            // the retained simple Object+68 before passive Stillify/head work.
            c.body.state.velocity.fromArray(c.instance.nativeCharacterVelocity);
            c.body.characterVelocity.fromArray(
              c.instance.nativeCharacterVelocity,
            );
          }
          const posedInstance = c.instance,
            posedBody = c.body;
          beforeSaveRoot = this.hooks.beforeSaveRoot?.(this.context(c));
          if (beforeSaveRoot) {
            this.recordResult(c, beforeSaveRoot);
            if (beforeSaveRoot.status !== "complete")
              return { pool, pose, beforeSaveRoot };
          }
          // A source callback can release/vanish an admitted owner. Its BON
          // and preceding Object V writes remain committed to that resource.
          if (
            !c.instance ||
            !c.body ||
            c.instance !== posedInstance ||
            c.body !== posedBody ||
            c.flags & 0x80
          )
            return {
              pool,
              pose,
              ...(beforeSaveRoot ? { beforeSaveRoot } : {}),
            };
          this.saveRoot(c);
          afterPose = this.hooks.afterPose?.(this.context(c));
          if (afterPose) this.recordResult(c, afterPose);
        }
      }
      for (const provider of pool.requiredProviders)
        c.diagnostics.add(provider);
      return {
        pool,
        pose,
        ...(beforeSaveRoot ? { beforeSaveRoot } : {}),
        ...(afterPose ? { afterPose } : {}),
      };
    });
  }
  private selectMove(
    c: NativePedRuntimeCharacter<Owner>,
    id: number,
    direction: PedVector,
    up: PedVector,
    timeMs: number,
    options: NativePedMoveSelectionOptions,
  ): NativePedInstanceResult {
    const completion = this.hooks.onMoveCompleted;
    return selectNativePedMove(c.instance!, id, direction, up, timeMs, {
      ...options,
      ...(completion
        ? { onMoveCompleted: (instance, time) => completion(c, instance, time) }
        : {}),
    });
  }
  setMove(
    owner: Owner,
    id: number,
    direction: PedVector,
    up: PedVector,
    timeMs: number,
    options: NativePedMoveSelectionOptions = {},
  ): NativePedInstanceResult {
    const c = this.character(owner);
    if (!c.instance) {
      c.moveId = id;
      c.direction = direction;
      c.groundNormal = up;
      c.moveOptions = options;
      return {
        status: "complete",
        requiredProviders: [],
        processedFrames: 0,
        completedMove: false,
      };
    }
    const result = c.instance.physicsActive
      ? (this.hooks.activeSetMove?.(
          { ...this.context(c), timeMs },
          id,
          direction,
          up,
          options,
        ) ?? missing("native-active-direction-and-move-transition-provider"))
      : this.selectMove(c, id, direction, up, timeMs, options);
    if (result.status === "complete") {
      c.moveId = c.instance.moveId ?? c.moveId;
      // Installed40a730 ignores active heading changes outside replay. The
      // source hook also returns1 for id−1/same-ID without replacing the move.
      // Keep the host state coherent with that retained physical orientation.
      if (!("directionIgnored" in result && result.directionIgnored)) {
        c.direction = direction;
        c.groundNormal = up;
      }
      c.moveOptions = options;
      this.saveRoot(c);
    }
    this.recordResult(c, result);
    return result;
  }
  selectModel(
    owner: Owner,
    index: number,
    poseIndex: number,
    modelSet: 0 | 1,
  ): NativePedInstanceResult {
    const c = this.character(owner);
    if (!Number.isInteger(index) || index < 0 || index >= c.modelPoses.length)
      throw new Error("Invalid native bone index");
    if (!c.instance) {
      c.modelPoses[index] = poseIndex;
      c.modelSet = modelSet;
      return {
        status: "complete",
        requiredProviders: [],
        processedFrames: 0,
        completedMove: false,
      };
    }
    const result = selectNativePedBoneModel(
      c.instance,
      index,
      poseIndex,
      modelSet,
    );
    if (result.status === "complete") {
      //40b4b4 stores the set byte before a known-NULL model returns0.
      c.modelSet = c.instance.modelSet;
      if (result.nativeModelReturn === 1)
        c.modelPoses[index] = c.instance.bones[index].poseIndex;
    }
    this.recordResult(c, result);
    return result;
  }
  applyKillModelEffect(
    owner: Owner,
    effect: NativePedSeverKillModelEffect,
  ): void {
    const c = this.character(owner);
    if (effect.kind === "clear-head-sequence") {
      this.hooks.onHeadSequenceCleared?.(c);
      return;
    }
    const indices =
      effect.kind === "dead-model-all" || effect.index < 0
        ? c.modelPoses.map((_p, i) => i)
        : [effect.index];
    for (const index of indices) this.selectModel(owner, index, effect.pose, 1);
  }
  activate(owner: Owner): boolean {
    const c = this.character(owner);
    if (!c.body || !c.instance) return false;
    if (
      !activateNativePedBody(
        c.body,
        new Vector3(...c.instance.nativeCharacterVelocity),
      )
    )
      return false;
    this.simulation.phil.activate(c.body, { flag2: true });
    c.physicsFlags |= 4;
    c.instance.physicsActive = true;
    this.hooks.onActivated?.(this.context(c));
    return true;
  }
  private moved(
    c: NativePedRuntimeCharacter<Owner>,
    framePeriodMs: number,
  ): void {
    // Installed40b770 handles simple resources only; boned dispatch is separate.
    if (!(c.physicsFlags & 1)) return;
    const body = c.body!,
      instance = c.instance!;
    instance.physicsActive = true;
    c.physicsFlags |= 4;
    this.copyMasks(c);
    const pose = synchronizeNativePedPhysicalPose(
      instance,
      nativePedRootPose(body),
    );
    instance.nativeCharacterVelocity.splice(
      0,
      3,
      ...(body.state.velocity.toArray() as [number, number, number]),
    );
    this.recordResult(c, pose);
    if (pose.status === "complete") this.saveRoot(c);
    if (this.hooks.onMoved) this.hooks.onMoved(this.context(c, framePeriodMs));
    else c.diagnostics.add("native-moved-gameplay-continuation");
  }
  private halt(
    c: NativePedRuntimeCharacter<Owner>,
    framePeriodMs: number,
    reason: "quiet" | "release",
  ): 0 | 1 | null {
    this.movedPoseOnly(c);
    c.instance!.physicsActive = false;
    c.physicsFlags &= ~4;
    const result = this.hooks.onHalt?.(this.context(c, framePeriodMs), reason);
    const value = result?.returnValue ?? null;
    for (const provider of result?.requiredProviders ??
      (result ? [] : ["native-active-halt-continuation"]))
      c.diagnostics.add(provider);
    if (value !== 1) {
      c.instance!.physicsActive = true;
      c.physicsFlags |= 4;
    }
    if (value === 1)
      c.instance!.nativeCharacterVelocity.splice(
        0,
        3,
        ...(c.body!.state.velocity.toArray() as [number, number, number]),
      );
    return value;
  }
  private movedPoseOnly(c: NativePedRuntimeCharacter<Owner>): void {
    const result = synchronizeNativePedPhysicalPose(
      c.instance!,
      nativePedRootPose(c.body!),
    );
    this.recordResult(c, result);
    if (result.status === "complete") this.saveRoot(c);
  }
  private beforeRelease(
    c: NativePedRuntimeCharacter<Owner>,
  ): readonly string[] {
    const missingProviders: string[] = [];
    if (c.removedBoneMask && !this.hooks.storeRemovedPoses)
      missingProviders.push("native-stored-dismembered-pose-owner");
    const resources = this.bonePool.allocation(c)?.bodies ?? [];
    if (resources.some((body) => body?.nativeJoint2) && !this.hooks.unlinkBone)
      missingProviders.push("native-retained-joint2-owner");
    if (this.simulation.phil.getState(c.body!) === 2 && !this.hooks.onHalt)
      missingProviders.push("native-active-halt-continuation");
    missingProviders.push(
      ...(this.hooks.beforeRelease?.(this.context(c)) ?? []),
    );
    if (missingProviders.length) return missingProviders;
    if (
      this.simulation.phil.getState(c.body!) === 2 &&
      this.halt(c, 0, "release") === null
    )
      return ["native-active-halt-continuation"];
    // Source lowering physics level proceeds even when its halt callback is0.
    return [];
  }
  private bindCallbacks(
    c: NativePedRuntimeCharacter<Owner>,
    body: NativePedRuntimeBody<Owner>,
  ) {
    body.contactProvider = this.hooks.contactProvider
      ? (_body, dispatch) => {
          const context = this.hooks.contactProvider!(
            this.context(c),
            dispatch,
          );
          return {
            ...context,
            passivePrelude: (input) => {
              // The simulation commits the actual WORD before this owner hook.
              c.impactCount = input.impactCount;
              context.passivePrelude?.(input);
            },
          };
        }
      : undefined;
    body.onActivated = (_body, other) => {
      c.physicsFlags |= 4;
      c.instance!.physicsActive = true;
      this.hooks.onActivated?.(this.context(c), other);
    };
    body.onContactDamage = (_body, result, phase) => {
      c.hitPoints = body.hitPoints;
      c.flags = body.pedestrianFlags;
      c.impactCount = body.impactCount;
      this.hooks.onDamage?.(this.context(c), result, phase);
    };
    body.onMoved = (_body, period) => this.moved(c, period);
    body.onHalt = (_body, period) => this.halt(c, period, "quiet") === 1;
  }
  reserveBonedSlot(owner: Owner): number | null {
    return this.bonePool.reserve(this.character(owner));
  }
  readBone(
    owner: Owner,
    index: number,
  ): NativePedSeverBoneSnapshot<Group, Group> | null {
    const c = this.character(owner);
    if (this.hooks.readBone) return this.hooks.readBone(c, index);
    const bone = c.instance?.bones[index],
      model = bone?.model;
    if (!bone || !model) return null;
    const meshes = model.children.filter((child) => child instanceof Mesh);
    const preparedBounds =
      meshes.length === 1 && model.children.length === 1
        ? meshes[0].geometry.userData.nativePedModelBounds
        : null;
    const variant = c.instance!.template.bones[index].variants[bone.poseIndex],
      bounds =
        preparedBounds ??
        (variant?.modelBounds.size === 1
          ? variant.modelBounds.get(variant.sourceModels[0])
          : null);
    if (!bounds || bounds.isEmpty()) {
      c.diagnostics.add("native-current-bone-MODEL-bounds-provider");
      return null;
    }
    return {
      actor: bone.actor,
      model,
      nativePose: Float32Array.from(bone.pose),
      bounds: {
        min: bounds.min.toArray() as [number, number, number],
        max: bounds.max.toArray() as [number, number, number],
      },
    };
  }
  registerBone(
    owner: Owner,
    request: NativePedSeverBoneRequest<Group, Group>,
  ): NativePedSeverRegistration<NativePedBoneBody<Group>> | null {
    const result = this.bonePool.registerBone(this.character(owner), request);
    return result.registration
      ? {
          ...result.registration,
          body: this.preparedBone(result.registration.body),
        }
      : null;
  }
  commitBone(
    owner: Owner,
    request: NativePedSeverBoneRequest<Group, Group>,
    registration: NativePedSeverRegistration<NativePedBoneBody<Group>>,
  ): void {
    const c = this.character(owner),
      body = registration.body;
    body.poseTarget = c.instance!.bones[request.index].pose;
    if (body.nativeJoint2 && !this.hooks.unlinkBone)
      throw new Error("Native retained joint2 owner required");
    c.removedBoneMask = (c.removedBoneMask | (1 << request.index)) >>> 0;
    this.copyMasks(c);
    c.instance!.detachedBoneMask |= (1 << request.index) >>> 0;
    commitNativePedBoneBody(request, body, {
      unlink: (part) => this.hooks.unlinkBone?.(c, part),
      activate: (part) => {
        this.simulation.phil.activate(part, { flag2: false });
      },
      onProperty: (part) => this.syncBoneHeader(part),
    });
  }
}
