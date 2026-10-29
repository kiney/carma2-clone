/** Source-informed FORM/BON rendering over the existing population movement.
 * This owns visuals only; it does not register native physics or replace the
 * legacy movement, grounding, combat or corpse owners. */
import * as THREE from "three";
import type { NativePedAssets } from "./ped-native-assets";
import type { PedVector } from "./ped-form";
import {
  advanceNativePedPose,
  createNativePedInstance,
  poseNativePedFrame,
  releaseNativePedActorSet,
  selectNativePedMove,
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
  /** Alive repulsion/corporeal bridge: freeze BON time and follow the actual
   * gameplay actor's full rigid transform without claiming native PHIL pose. */
  legacyRigid?: boolean;
  /** Existing corpse transport supplies this rigid fall until PED-08. Bone
   * animation freezes; this is explicitly not a native physical root pose. */
  legacyFall?: { pitchRadians: number; rootHeight: number };
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
  private lastHeading = NaN;
  private lastUp: PedVector = [0, 1, 0];

  constructor(readonly template: NativePedAssets) {
    this.instance = createNativePedInstance(template, { rootPose: identity() });
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

    if ((!input.alive || input.legacyRigid) && this.positioned) {
      if (!this.rigidFrozen) {
        // The previous parent matrix belongs to the retained native pose.
        // The current parent may already include this frame's rigid transport.
        this.frozenParentInverse.copy(this.inverseParent);
        this.frozenRootLocal
          .setFromMatrixPosition(this.instance.bones[0].actor.matrix)
          .applyMatrix4(this.frozenParentInverse);
        this.rigidFrozen = true;
      }
      if (!input.alive) this.dead = true;
      if (input.legacyRigid && input.alive) {
        this.group.matrix.copy(this.frozenParentInverse);
        this.group.matrixWorldNeedsUpdate = true;
        this.group.updateMatrixWorld(true);
        return complete();
      }
      const fall = input.legacyFall ?? {
        pitchRadians: 0,
        rootHeight: this.frozenRootLocal.y,
      };
      if (![fall.pitchRadians, fall.rootHeight].every(Number.isFinite))
        throw new Error("Invalid legacy pedestrian fall transform");
      this.group.matrix
        .makeTranslation(0, fall.rootHeight, 0)
        .multiply(this.rotation.makeRotationX(fall.pitchRadians))
        .multiply(
          this.translation.makeTranslation(
            -this.frozenRootLocal.x,
            -this.frozenRootLocal.y,
            -this.frozenRootLocal.z,
          ),
        )
        .multiply(this.frozenParentInverse);
      this.group.matrixWorldNeedsUpdate = true;
      this.group.updateMatrixWorld(true);
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

    const instance = this.instance,
      position = input.worldPosition,
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
        0,
        {
          periodMs: input.periodMs,
          ...(changedMove ? { groundHeight: input.groundY } : {}),
        },
      );
      // Installed SetCharacterMove resets lastTime to zero. Its next Munge
      // visit initializes without consuming displacement from the new move.
      if (changedMove && result.status === "complete")
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
      const posed = poseNativePedFrame(instance, 0);
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
    return this.record(result);
  }

  reset(input: NativePedPresentationInput): NativePedInstanceResult {
    if (this.disposed)
      throw new Error("Native pedestrian presenter is disposed");
    const instance = this.instance;
    instance.move = null;
    instance.moveId = null;
    instance.rootPose.set(identity());
    instance.clock = { frame: 0, fraction: 0, lastTimeMs: 0, periodMs: 0 };
    instance.nativeCharacterVelocity.fill(0);
    this.positioned = false;
    this.dead = false;
    this.rigidFrozen = false;
    this.lastHeading = NaN;
    this.diagnostics.length = 0;
    return this.update(input);
  }

  dispose(): void {
    if (this.disposed) return;
    // This adapter never admits PHIL bodies or lends detached ACTs. Shared
    // source geometry, textures and materials retain their asset owner.
    releaseNativePedActorSet(this.instance, { isPhysicsReleased: () => true });
    this.group.removeFromParent();
    this.disposed = true;
  }
}
