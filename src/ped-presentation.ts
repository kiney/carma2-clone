/** Source-informed FORM/BON rendering over the existing population movement.
 * This owns visuals only; it does not register native physics or replace the
 * legacy movement, grounding, combat or corpse owners. */
import * as THREE from "three";
import type { NativePedAssets } from "./ped-native-assets";
import type { PedVector } from "./ped-form";
import { nativeActivePedOrientation } from "./physics/ped-active-move";
import type { NativePedRenderEffects } from "./ped-render-effects";
import {
  advanceNativePedHeadSequence,
  startNativePedHeadSequence,
  nativePedScareHeadSequence,
  nativePedCalmHeadSequence,
  type NativePedHeadSequenceState,
  type NativePedHeadModelRequest,
} from "./ped-head-sequence";
import {
  advanceNativePedPose,
  createNativePedInstance,
  poseNativePedFrame,
  releaseNativePedActorSet,
  selectNativePedMove,
  selectNativePedBoneModel,
  stopNativePedMorph,
  type NativePedInstanceResult,
} from "./ped-native-instance";

export interface NativePedPresentationInput {
  /** Gameplay actor remains the population, map, visibility and combat identity. */
  parent: THREE.Object3D;
  worldPosition: Readonly<THREE.Vector3>;
  heading: number;
  groundY: number;
  moveId: number;
  periodMs: number;
  timeMs: number;
  alive: boolean;
  up?: PedVector;
  action?: number;
  deadModelSet?: 0 | 1;
  /** Passive corpse Stillify after its BON visit; move113 is exempt. */
  still?: boolean;
  mutantSpeed?: number;
  sameTimeGuard?: boolean;
  morphArgument?: number;
  /** Actual scare/calm caller signal, not a second AI decision. */
  headSequence?: "scare" | "calm";

  /** Alive repulsion/corporeal bridge: freeze BON time and follow the actual
   * gameplay actor's full rigid transform without claiming native PHIL pose. */
  legacyRigid?: boolean;
  /** Existing corpse transport supplies the rigid root until PED-06/08.
   * BON children continue independently; this is not a native PHIL root. */
  legacyFall?: { pitchRadians: number; rootHeight: number };
}

export interface NativePedPresentationOptions {
  effects?: NativePedRenderEffects;
  nextCrtInteger?: () => number;
  resolveMove?: (id: number) => number;
}

const identity = () => new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
const complete = (): NativePedInstanceResult => ({
  status: "complete",
  requiredProviders: [],
  processedFrames: 0,
  completedMove: false,
});

/** Flat native world bone matrices live below an explicit inverse-parent
 * transform. This keeps the existing gameplay actor usable by render culling
 * without applying its translation, yaw or scale to the native pose twice. */
export class NativePedPresentation {
  readonly instance;
  readonly group: THREE.Group;
  readonly diagnostics: string[] = [];
  private readonly previousPosition = new THREE.Vector3();
  private positioned = false;
  private dead = false;
  private rigidFrozen = false;
  private disposed = false;
  private frozenParentInverse = new THREE.Matrix4();
  private frozenRootLocal = new THREE.Vector3();
  private readonly inverseParent = new THREE.Matrix4();
  private readonly translation = new THREE.Matrix4();
  private readonly rotation = new THREE.Matrix4();
  private readonly corpseRoot = new THREE.Matrix4();
  private readonly unbindEffects?: () => void;
  private headState: NativePedHeadSequenceState = {
    sequence: null,
    index: 0,
    lastChangeTimeMs: 0,
  };
  private headSignal?: "scare" | "calm";
  private lastTimeMs?: number;
  private lastHeading = NaN;
  private lastUp: PedVector = [0, 1, 0];

  constructor(
    readonly template: NativePedAssets,
    private readonly options: NativePedPresentationOptions = {},
  ) {
    this.template = options.effects?.template ?? template;
    this.instance = createNativePedInstance(this.template, {
      rootPose: identity(),
      modelSet1: options.effects?.modelSet1,
      nextCrtInteger: options.nextCrtInteger,
    });
    this.unbindEffects = options.effects?.bind(this.instance);
    this.group = this.instance.group;
    this.group.name = `native-ped-presentation:${template.profile.formName}`;
  }

  get moveSlot(): number {
    return this.template.form.moves.findIndex(
      (move) => move.id === this.instance.moveId,
    );
  }

  get groundingOffset(): number {
    return this.instance.move?.asset.personality?.groundingOffset ?? 0;
  }

  private record(result: NativePedInstanceResult): NativePedInstanceResult {
    for (const provider of result.requiredProviders)
      if (!this.diagnostics.includes(provider)) this.diagnostics.push(provider);
    return result;
  }

  update(input: NativePedPresentationInput): NativePedInstanceResult {
    if (this.disposed)
      throw new Error("Native pedestrian presenter is disposed");
    if (
      ![
        ...input.worldPosition.toArray(),
        input.heading,
        input.groundY,
        input.timeMs,
        input.periodMs,
      ].every(Number.isFinite) ||
      !Number.isInteger(input.timeMs) ||
      input.timeMs < 0 ||
      input.timeMs > 0xffffffff ||
      !Number.isInteger(input.periodMs) ||
      input.periodMs < 0 ||
      input.periodMs > 32767
    )
      throw new Error("Invalid native pedestrian presentation input");
    if (this.group.parent !== input.parent) input.parent.add(this.group);
    input.parent.updateWorldMatrix(true, false);
    if (
      !Number.isFinite(input.parent.matrixWorld.determinant()) ||
      input.parent.matrixWorld.determinant() === 0
    )
      throw new Error("Native pedestrian presentation parent is singular");

    const instance = this.instance;
    instance.mutantHealth = input.alive ? 1 : 0;
    instance.mutantAction = input.action ?? (input.alive ? 0 : 6);
    instance.mutantSpeed = input.mutantSpeed ?? 0;
    instance.mutantSameTimeGuard =
      input.sameTimeGuard ?? input.timeMs === this.lastTimeMs;
    if (!input.alive && this.positioned) return this.updateCorpse(input);
    if (input.legacyRigid && this.positioned) {
      if (!this.rigidFrozen) {
        this.frozenParentInverse.copy(this.inverseParent);
        this.rigidFrozen = true;
      }
      this.group.matrix.copy(this.frozenParentInverse);
      this.group.matrixWorldNeedsUpdate = true;
      this.group.updateMatrixWorld(true);
      this.lastTimeMs = input.timeMs;
      return complete();
    }
    if (this.dead)
      return this.record({
        ...complete(),
        status: "provider-required",
        requiredProviders: ["native-presentation-reset-before-revival"],
      });
    if (this.rigidFrozen) {
      this.rigidFrozen = false;
      this.instance.clock.lastTimeMs = 0;
      this.lastHeading = NaN;
    }

    const position = input.worldPosition,
      up = input.up ?? ([0, 1, 0] as const);
    // Keep gameplay displacement as the single transport owner. The native
    // clock still accumulates authored vertical root deltas between supports.
    instance.rootPose[9] = position.x;
    instance.rootPose[11] = position.z;
    instance.rootPose[10] += this.positioned
      ? position.y - this.previousPosition.y
      : position.y;
    const changedMove = instance.moveId !== input.moveId,
      changedDirection =
        this.lastHeading !== input.heading ||
        up.some((value, index) => value !== this.lastUp[index]);
    let result = complete();
    if (changedMove || changedDirection) {
      result = selectNativePedMove(
        instance,
        input.moveId,
        [Math.sin(input.heading), 0, Math.cos(input.heading)],
        up,
        input.morphArgument ? input.timeMs : 0,
        {
          periodMs: input.periodMs,
          morphArgument: changedMove ? input.morphArgument : undefined,
          ...(changedMove ? { groundHeight: input.groundY } : {}),
        },
      );
      // Installed SetCharacterMove resets lastTime to zero. Its next Munge
      // visit initializes without consuming displacement from the new move.
      if (changedMove && result.status === "complete" && !instance.morph)
        instance.clock.lastTimeMs = 0;
      if (result.status === "complete") {
        this.lastHeading = input.heading;
        this.lastUp = [...up];
      }
    } else instance.clock.periodMs = input.periodMs;
    if (result.status === "complete")
      result = advanceNativePedPose(instance, input.timeMs);
    // Remove only native X/Z transport. Repose children around the corrected
    // root, retaining the full authored basis and vertical animation phase.
    instance.rootPose[9] = position.x;
    instance.rootPose[11] = position.z;
    if (instance.move) {
      const posed = poseNativePedFrame(instance, 0, { reuseLastAngles: true });
      if (result.status === "complete")
        result = {
          ...posed,
          processedFrames: result.processedFrames,
          completedMove: result.completedMove,
        };
    }
    // An unsupported initial move has no authored pose to display. Retaining
    // a prior supported pose is explicit in diagnostics, never an upright rig.
    this.group.visible = !!instance.move;
    this.previousPosition.copy(position);
    this.positioned = true;
    this.group.matrix.copy(
      this.inverseParent.copy(input.parent.matrixWorld).invert(),
    );
    this.group.matrixWorldNeedsUpdate = true;
    this.group.updateMatrixWorld(true);
    this.lastTimeMs = input.timeMs;
    this.updateHead(input);
    return this.record(result);
  }

  private selectModels(request: NativePedHeadModelRequest) {
    const pending: string[] = [];
    for (let i = 0; i < this.instance.bones.length; i++) {
      if (request.kind === "bone-model" && i !== request.headBone) continue;
      pending.push(
        ...selectNativePedBoneModel(
          this.instance,
          i,
          request.poseIndex,
          request.modelSet,
        ).requiredProviders,
      );
    }
    return {
      status: pending.length
        ? ("provider-required" as const)
        : ("complete" as const),
      requiredProviders: pending,
    };
  }

  private updateHead(input: NativePedPresentationInput): void {
    const args = {
      hitPoints: input.alive ? 1 : 0,
      renderSlot: 0,
      headBone: this.template.form.headBone,
      timeMs: input.timeMs,
    };
    const providers = {
      setModels: (request: NativePedHeadModelRequest) =>
        this.selectModels(request),
    };
    if (
      input.alive &&
      input.headSequence &&
      input.headSequence !== this.headSignal
    ) {
      const selected =
        input.headSequence === "scare"
          ? nativePedScareHeadSequence
          : nativePedCalmHeadSequence;
      const r = startNativePedHeadSequence(
        this.headState,
        selected,
        args,
        providers,
      );
      for (const key of r.requiredProviders)
        if (!this.diagnostics.includes(key)) this.diagnostics.push(key);
      this.headSignal = input.headSequence;
    }
    const r = advanceNativePedHeadSequence(
      this.headState,
      { ...args, replay: false },
      providers,
    );
    for (const key of r.requiredProviders)
      if (!this.diagnostics.includes(key)) this.diagnostics.push(key);
  }

  /** Native BON continues during death. Only the root is supplied by the
   * existing rigid/corpse transport bridge; articulated contacts remain PED-08. */
  private updateCorpse(
    input: NativePedPresentationInput,
  ): NativePedInstanceResult {
    const instance = this.instance;
    if (!this.dead) {
      this.frozenParentInverse.copy(this.inverseParent);
      this.corpseRoot.copy(instance.bones[0].actor.matrix);
      this.frozenRootLocal
        .setFromMatrixPosition(this.corpseRoot)
        .applyMatrix4(this.frozenParentInverse);
      this.dead = true;
      this.headState.sequence = null;
      if ((input.deadModelSet ?? 0) === 1) {
        for (let i = 0; i < instance.bones.length; i++)
          this.record(selectNativePedBoneModel(instance, i, 0, 1));
        const head = this.template.form.headBone;
        if (head < 0) {
          for (let i = 0; i < instance.bones.length; i++)
            this.record(selectNativePedBoneModel(instance, i, 2, 1));
        } else this.record(selectNativePedBoneModel(instance, head, 2, 1));
      }
    }
    const fall = input.legacyFall ?? {
      pitchRadians: 0,
      rootHeight: this.frozenRootLocal.y,
    };
    if (![fall.pitchRadians, fall.rootHeight].every(Number.isFinite))
      throw new Error("Invalid corpse root transport");
    const root = input.parent.matrixWorld
      .clone()
      .multiply(this.translation.makeTranslation(0, fall.rootHeight, 0))
      .multiply(this.rotation.makeRotationX(fall.pitchRadians))
      .multiply(
        new THREE.Matrix4().makeTranslation(
          -this.frozenRootLocal.x,
          -this.frozenRootLocal.y,
          -this.frozenRootLocal.z,
        ),
      )
      .multiply(this.frozenParentInverse)
      .multiply(this.corpseRoot);
    const e = root.elements;
    const physicalRoot = Float32Array.from([
      e[0],
      e[1],
      e[2],
      e[4],
      e[5],
      e[6],
      e[8],
      e[9],
      e[10],
      e[12],
      e[13],
      e[14],
    ]);
    instance.rootPose.set(physicalRoot);
    // This presentation owns no PHIL body. It supplies the existing legacy
    // root as the explicit active-pose input instead of freezing every bone.
    instance.physicsActive = false;
    const choose = (requested: number, at: number): NativePedInstanceResult => {
      const id = this.options.resolveMove?.(requested) ?? requested;
      const period =
        this.template.moves.get(id)?.form.periodMs ?? input.periodMs;
      const selected = selectNativePedMove(
        instance,
        id,
        [Math.sin(input.heading), 0, Math.cos(input.heading)],
        input.up ?? [0, 1, 0],
        at,
        {
          retainRoot: true,
          periodMs: period,
          completionRequested: [90, 91, 92, 96, 97].includes(id),
          onMoveCompleted: (active, now) => {
            const next = [90, 91, 92].includes(active.moveId!) ? 97 : 94;
            active.physicsActive = false;
            this.record(choose(next, now));
            active.physicsActive = true;
          },
        },
      );
      if (selected.status === "complete") instance.clock.lastTimeMs = 0;
      return selected;
    };
    let result = complete();
    if (instance.moveId !== input.moveId)
      result = choose(input.moveId, input.timeMs);
    if (instance.move)
      instance.characterOrientation = nativeActivePedOrientation(
        instance.move.roots[instance.clock.frame],
        physicalRoot,
      );
    if (result.status === "complete")
      result = advanceNativePedPose(instance, input.timeMs, {
        activeRootPose: physicalRoot,
      });
    const mutantSpeed = Math.fround(input.mutantSpeed ?? 0);
    if (
      input.still &&
      instance.moveId !== 113 &&
      instance.move &&
      ((mutantSpeed !== 0 && instance.clock.periodMs === 0) ||
        (mutantSpeed === 0 && instance.clock.periodMs !== 0))
    ) {
      // Stillify runs AFTER this visit's BON clock, with the direct rate setter.
      const speed = -mutantSpeed;
      instance.clock.periodMs =
        (Math.trunc(
          speed >= 0 ? speed : -instance.move.asset.form.periodMs * speed,
        ) <<
          16) >>
        16;
    }
    const anchored = poseNativePedFrame(instance, 0, { reuseLastAngles: true });
    if (result.status === "complete")
      result = {
        ...anchored,
        processedFrames: result.processedFrames,
        completedMove: result.completedMove,
      };
    this.group.matrix.copy(
      this.inverseParent.copy(input.parent.matrixWorld).invert(),
    );
    this.group.matrixWorldNeedsUpdate = true;
    this.group.visible = !!instance.move;
    this.group.updateMatrixWorld(true);
    this.previousPosition.copy(input.worldPosition);
    this.lastTimeMs = input.timeMs;
    return this.record(result);
  }

  /** ScaleForm changes occupied ACT origins around supplied ground support.
   * Repose cached angles once so retained distant actors also keep their newly
   * scaled attachment anchors; no BON time, movement or CRT draw is consumed. */
  refreshScaledPose(
    ratioX: number,
    support: (point: THREE.Vector3) => number | null,
  ): void {
    if (!this.positioned || this.disposed || !this.instance.move) return;
    this.group.updateWorldMatrix(true, true);
    const oldRoot = this.instance.bones[0].actor.matrixWorld.clone();
    const inverse = this.group.matrixWorld.clone().invert();
    if (ratioX !== 1)
      for (const bone of this.instance.bones) {
        const p = bone.actor.getWorldPosition(new THREE.Vector3());
        const height = support(p.clone());
        if (height === null || height <= -100) continue;
        p.y = Math.fround((p.y - height) * ratioX + height);
        p.applyMatrix4(inverse);
        bone.pose.set(p.toArray().map(Math.fround), 9);
      }
    this.record(
      poseNativePedFrame(this.instance, 0, { reuseLastAngles: true }),
    );
    this.group.updateMatrixWorld(true);
    if (this.dead) {
      const newRoot = this.instance.bones[0].actor.matrixWorld;
      this.corpseRoot.multiply(oldRoot.invert()).multiply(newRoot);
    }
  }

  reset(input: NativePedPresentationInput): NativePedInstanceResult {
    if (this.disposed)
      throw new Error("Native pedestrian presenter is disposed");
    const instance = this.instance;
    stopNativePedMorph(instance);
    instance.physicsActive = false;
    for (let i = 0; i < instance.bones.length; i++)
      selectNativePedBoneModel(instance, i, 0, 0);
    instance.move = null;
    instance.moveId = null;
    instance.rootPose.set(identity());
    instance.clock = { frame: 0, fraction: 0, lastTimeMs: 0, periodMs: 0 };
    instance.nativeCharacterVelocity.fill(0);
    this.positioned = false;
    this.dead = false;
    this.rigidFrozen = false;
    this.lastHeading = NaN;
    this.lastTimeMs = undefined;
    this.headState = { sequence: null, index: 0, lastChangeTimeMs: 0 };
    this.headSignal = undefined;
    this.diagnostics.length = 0;
    return this.update(input);
  }

  dispose(): void {
    if (this.disposed) return;
    // This adapter never admits PHIL bodies or lends detached ACTs. Shared
    // source geometry, textures and materials retain their asset owner.
    this.unbindEffects?.();
    releaseNativePedActorSet(this.instance, { isPhysicsReleased: () => true });
    this.group.removeFromParent();
    this.disposed = true;
  }
}
