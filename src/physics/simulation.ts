import {
  BodyBroadphase,
  type BodyBroadphaseDiagnostics,
} from "./body-broadphase";
import { worldFaceSweepEnvelope } from "./world-face-envelope";
import {
  CorrectionWorkingSet,
  type CorrectionDiagnostics,
  type CorrectionBoundsProvider,
  type CorrectionBodySnapshot,
  type CorrectionGeometry,
} from "./correction-working-set";
import {
  StationaryBoundsCache,
  type StationaryBoundsDiagnostics,
} from "./stationary-bounds-cache";
import { CameraContactFrame } from "../camera/contact-frame";
import {
  activateNativePedBody,
  acceptNativePedHalt,
  nativePedRootPose,
  positionPassivePedBody,
  pedBodyPairExcluded,
  type NativePedBody,
  type NativePedContactResult,
} from "./ped-body";
import {
  passivePedContact,
  activePedContact,
  type PedContactOther,
} from "./ped-contact";
import {
  evaluateNativeQuietLeaf,
  canSleepNativeQuietGroup,
  collectNativeCollisionFlags,
} from "./quiet-state";
import { settleNativePedBody } from "./ped-settling";
import { NativePhilRegistry, type NativePhilHeader } from "./phil-registry";
import { classifyNativePedOther } from "./ped-other";
import {
  applyNativeFreeForces40,
  type NativeFreeVolumeSnapshot,
} from "./native-free-forces";
import { nativeFreeLevelOutDelta } from "./native-free-level-out";
import {
  registerNativePedBoneBody,
  type NativePedBoneBody,
} from "./ped-bone-body";
import {
  isNativePedBoneBody,
  isNativeSphereBody,
  nativeBodyLocalBounds,
  nativeBodyWorldBounds,
  nativeRigidPose,
  nativeSphereBodyPose,
  nativeSpherePairRows,
  nativeSphereFace,
  nativeSphereSurfaceContacts,
} from "./sphere-body";
import { recoverNativeSphereSupport } from "./sphere-support";
import { liveModelBounds } from "../render-geometry";
import { nativeSphereMovingWorldContacts } from "./sphere-moving-world";
import {
  support as supportsNativeNonCarQuiet,
  createState as createNativeNonCarQuiet,
  prepare as prepareNativeNonCarQuiet,
  finish as finishNativeNonCarQuiet,
  sleep as sleepNativeNonCarQuiet,
  wake as wakeNativeNonCarQuiet,
  type State as NativeNonCarQuietState,
} from "./noncar-quiet";
import { applyWorldPinball } from "./pinball";
import { projectNativeOil } from "./oil-placement";
import type { OilSpill } from "./oil";
import { nativeCrashSmokeReturn } from "./crash-smoke";
import { planPhysicsFrameWindow } from "./frame-window";
import { NativeCarCrushQueue } from "./crush-queue";
import { NativeSpamQueue } from "./spam-queue";
import { sharedNativeRandom } from "../native-random";
import {
  NativeDelayedSideEffects,
  type NativeDelayedTask,
} from "../smash-delayed";
import { sharedNativeFlapFrame } from "./flap-frame";
import { nativeSmashStartingVelocity } from "../smash-effects";
import {
  opponentRepulsionImpulse,
  repulsionParameters,
} from "../combat-powerups";
import {
  NativeSmashPowerupQueue,
  type NativeSmashPowerup,
} from "../smash-gameplay";
import {
  Box3,
  Group,
  Matrix4,
  Object3D,
  Quaternion,
  Triangle,
  Vector3,
} from "three";
import {
  parseCarMechanics,
  type CarMechanics,
  type MechanicsShape,
} from "../mechanics";
import {
  flushWamSmashQueue,
  type DamageSystem,
  type WamSmashQueueContext,
} from "../damage";
import { NativeSmashQueue } from "../smash-queue";
import type { WorldDestruction } from "../world-destruction";
import type {
  WorldGrooveRuntime,
  WorldGrooveEvaluationOptions,
} from "../world-groove";
import type { WorldSparkSource } from "../sparks";
import { nativeWorldSparkSource } from "./world-sparks";
import type { CarSparkSource } from "../car-sparks";
import { nativeCarSparkSource } from "./car-spark-source";
import {
  NativeWorldFaceCache,
  nativeWheelExtendedBounds,
  type NativeWorldFaceState,
  type NativeWorldFaceQuery,
} from "./world-face-cache";
import { intersectWheelFace } from "./wheel-ray";
import { pointVelocity } from "./contact";
import { DEFAULT_SURFACE } from "./surfaces";
import { WorldActivationRuntime } from "../world-activation";
import {
  prepareMovingWorldPose,
  captureMovingWorldPose,
  commitMovingWorldPose,
  sweepHullMovingTriangle,
  type MovingWorldBody,
  type MovingWorldPose,
} from "./moving-world";
import {
  MineRuntime,
  MINE_FLAGS,
  hitMineReaction,
  mineComponentDamage,
  type MineCar,
  type MineContact,
  type MineParameters,
  type MineEvent,
} from "./mines";
import { createMineBody, type MineBody } from "./mine-body";
import type { VehicleState, VehicleInput } from "../gameplay";
import type { CrashDamageAwards } from "../race-awards";
import {
  redistributeNativeCrashDamage,
  nativeCrashDamageAward,
} from "./crash-components";
import { WorldCollision, type Surface } from "../world";
import {
  applyVehicleForces,
  createMotionParameters,
  initializeMotion,
  resetMotionSuspension,
  sharedMotionContext,
  type MotionParameters,
  type MotionState,
  type MotionDebug,
} from "./motion";
import {
  resolveContactGroups,
  type RigidBody,
  type Contact,
  type ContactImpact,
  type JointConstraintImpact,
  applyImpulse,
} from "./contact";
import {
  buildHull,
  sweepHulls,
  hullBounds,
  hullsBounds,
  reduceWorldContacts,
  finalizeWorldContacts,
  recoverWorldContacts,
  recoverShallowWorldContacts,
  worldPlacementContacts,
  worldPlacementDirection,
  placementHullsOverlap,
  sweepHullTriangle,
  transformHull,
  type CollisionHull,
  type HullContact,
} from "./geometry";
import {
  createOrdinaryDetachJoint,
  createSdbHingeJoint,
  createTranslationJoint,
  projectJointPositions,
  prepareJointVelocities,
  type RigidJoint,
} from "./joint";
import { advanceRigidBody } from "./integrate";
import {
  attachmentRoot,
  BodyTrajectoryGuard,
  type BodyGuardDiagnostics,
  type HullBody,
  type PosePath,
} from "./pair-guard";
import { SafeCarHistory, allWheelsSuspended } from "./recovery";
import { OilRuntime } from "./oil";
import {
  releaseNonCar,
  finalizeNonCarRelease,
  type NonCarBody,
} from "./noncar-body";
import {
  applyNonCarMotionForces,
  notifyNonCarBodyContact,
  notifyNonCarDrivenOn,
  nonCarTorqueExceedsThreshold,
  nonCarBendExceedsThreshold,
  applyNonCarTumble,
} from "./noncar-motion";
import {
  detectWaterPlane,
  findSpecialVolume,
  projectWaterDepth,
  selectSpecialVolume,
  volumeMotionFactors,
  applyGenericVolumeForces,
  NO_WATER_DISTANCE,
  type SpecialVolume,
  type SpecialVolumeConfig,
} from "./volumes";
import { scaleImpactVectors } from "./impact";
import {
  NativeCrashRecord,
  nativeCrashHeadOn,
  nativeCrashViewerDirection,
} from "./crash-record";
import {
  groupNativeImpactRows,
  NATIVE_IMPACT_MINIMUM_LAMBDA,
} from "./impact-groups";
import {
  selectNativeCrashAttribution,
  type NativeCrashCar,
  type NativeCrashHistory,
} from "./crash-attribution";
import { detachedChildCenterOfMass } from "./detached-com";
import {
  skillValue,
  type UpgradeSettings,
  type UpgradeState,
  type SuspensionPowerupValues,
} from "./upgrades";
import { findSplitContactCandidate } from "./split-contact";
import { moveShapeToSensiblePlace } from "./shape-swap";
import { findRoofSplitContactCandidate } from "./split";
import { buildBoxHull } from "./box-hull";
import {
  beginPartDetachment,
  cancelScheduledDetachment,
  createDetachmentSchedulingContext,
  kevFlapTearThreshold,
  detachedBoxInertia,
  inheritedDetachedVelocity,
  shouldFullyDetachPart,
  jointAllowsSeparation,
} from "./attachment";

export const PHYSICS_STEP = 0.04;
export type SimulatedVehicleState = VehicleState & MotionState;
export interface BodyVolumeState {
  volume: SpecialVolume | null;
  automatic: SpecialVolume | null;
  depth: number;
  waterDistance: number;
  /** Source +244: retained when a refresh has no acceptable water plane. */
  waterNormal?: Vector3;
}
export interface SimulatedCar extends RigidBody {
  /** Native +4e8, separate from +4e4 crash-earnings baselines. */
  smokeLastComponentLevels: Uint8Array;
  /** MungeEngineNoise's retained car+13cc world velocity, used next frame. */
  cachedSoundVelocity: Vector3;
  state: SimulatedVehicleState;
  group: Group;
  mechanics: CarMechanics;
  motion: MotionParameters;
  damage: DamageSystem;
  human: boolean;
  overlapRecovery: boolean;
  overlapDetected: boolean;
  worldRecovery: boolean;
  worldOverlapDetected: boolean;
  shapeVertices: Vector3[][];
  hulls: CollisionHull[];
  debug?: MotionDebug;
  input: VehicleInput;
  revision: number;
  structuralRevision: number;
  /** Discontinuous placement invalidates the renderer's previous pose. */
  poseEpoch: number;
  suspensionBendActive: boolean;
  splitRevision: number;
  wastedAt?: number;
  /** Culprit of the damage transition, for DamagePost's player-waste headup. */
  wastedByPlayer?: boolean;
  /** Source car+1d4: wasting persists through model/component repair. */
  knackered: boolean;
  recoveryHistory: SafeCarHistory;
  repairing: boolean;
  repairAwaitingShapeSwap: boolean;
  lastAttributedImpactMs: number;
  /** Separate native earnings attribution: never infer an attacker from time0. */
  lastAwardAttacker?: SimulatedCar;
  lastAwardImpactMs?: number;
  /** Native +4c8; ordinary vehicle mass is not the repulsion divisor. */
  temporaryMassMultiplier: number;
  /** Native +49c rejects older imported multiplayer states, not local contacts. */
  networkStateCutoffMs?: number;
  /** Native outer-frame snapshot, first contact and pre-protection damage. */
  crashRecord: NativeCrashRecord;
  crashHistory: NativeCrashHistory;
  /** Actual accelerator-key bit, independent of synthesized throttle/braking. */
  crashAccelerationKey: boolean;
  armorLevel: number;
  offenseLevel: number;
  armorFactor?: number;
  offenseFactor?: number;
  /** Temporary source powerup fields; these affect damage, never rigid mass. */
  damageMultiplier: number;
  protection: number;
  freeRepairs: boolean;
  /** Last setter event, rather than a per-frame suspension override. */
  suspensionPowerup?: SuspensionPowerupValues;
  upgrades?: UpgradeState;
  specialVolume?: BodyVolumeState;
}
export interface DetachedBody extends RigidBody {
  actor: Object3D;
  owner: SimulatedCar;
  part: number;
  hulls: CollisionHull[];
  joint?: RigidJoint;
  overlapRecovery: boolean;
  overlapDetected: boolean;
  worldRecovery: boolean;
  worldOverlapDetected: boolean;
  splitRevision?: number;
  specialVolume?: BodyVolumeState;
}
export interface BodyContactDiagnostics extends BodyBroadphaseDiagnostics {
  maskRejected: number;
  jointRejected: number;
  spherePairs: number;
  contactRows: number;
}
export type SimulationBody =
  | SimulatedCar
  | DetachedBody
  | NonCarBody
  | MineBody<SimulatedCar>
  | NativePedBody
  | NativePedBoneBody;
function isNativePedBody(body: RigidBody): body is NativePedBody {
  return "kind" in body && body.kind === "pedestrian";
}
function nativePairAllowed(a: RigidBody, b: RigidBody): boolean {
  return !pedBodyPairExcluded(
    a as { filterA?: number; filterB?: number },
    b as { filterA?: number; filterB?: number },
  );
}
const Y = new Vector3(0, 1, 0);
export function boxVertices(bounds: Box3): Vector3[] {
  const result: Vector3[] = [];
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z])
        result.push(new Vector3(x, y, z));
  return result;
}
function shapeVertices(shape: MechanicsShape): Vector3[] {
  if (shape.kind === "box")
    return boxVertices(
      new Box3(
        new Vector3(...shape.bounds.min),
        new Vector3(...shape.bounds.max),
      ),
    );
  if (shape.kind === "sphere") {
    // Original spheres have an analytic contact path. This sampled hull remains
    // explicitly provisional until that separate path is ported.
    const points: Vector3[] = [];
    for (let ring = 0; ring <= 6; ring++)
      for (let az = 0; az < 12; az++) {
        const a = (ring * Math.PI) / 6,
          b = (az * Math.PI) / 6;
        points.push(
          new Vector3(
            Math.sin(a) * Math.cos(b),
            Math.cos(a),
            Math.sin(a) * Math.sin(b),
          )
            .multiplyScalar(shape.radius)
            .add(new Vector3(...shape.center)),
        );
      }
    return points;
  }
  return shape.vertices.map((p) => new Vector3(...p));
}
export function createSimulatedCar(
  group: Group,
  text: string,
  damage: DamageSystem,
  position: Vector3,
  heading: number,
  human: boolean,
): SimulatedCar {
  const mechanics = parseCarMechanics(text);
  group.updateMatrixWorld(true);
  const inverse = group.matrixWorld.clone().invert();
  const motion = createMotionParameters(mechanics, (wheel) => {
    let actor: Object3D | undefined;
    group.traverse((o) => {
      if (o.name.toLowerCase() === wheel.actor.toLowerCase()) actor = o;
    });
    if (!actor) return undefined;
    // Native loading centers each wheel model and moves its ACT hub to that
    // center. Our DAT stays in authored coordinates, so resolve the same hub
    // through the model bounds rather than a frequently-zero ACT translation.
    const bounds = new Box3().setFromObject(actor);
    return bounds.isEmpty()
      ? actor.getWorldPosition(new Vector3()).applyMatrix4(inverse)
      : bounds.getCenter(new Vector3()).applyMatrix4(inverse);
  });
  const state = initializeMotion(
    {
      position: position.clone(),
      orientation: new Quaternion().setFromAxisAngle(Y, heading),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    motion,
  ) as SimulatedVehicleState;
  Object.assign(state, {
    heading,
    speed: 0,
    health: 100,
    driver: human ? 8 : 6,
  });
  const initialHulls = mechanics.shapes.map((shape) =>
    shape.kind === "box"
      ? buildBoxHull(
          new Vector3(...shape.bounds.min),
          new Vector3(...shape.bounds.max),
        )
      : buildHull(shapeVertices(shape)),
  );
  // Native FillInShape compacts physical polygon storage. These slots are
  // independent of DAT/WAM model indices; discard unused input points before
  // damage classification so a later dent cannot resurrect retired vertices.
  const hulls = initialHulls.map((hull) => {
    const order = hull.vertexOrder ?? hull.vertices.map((_, i) => i);
    const remap = new Map(order.map((index, i) => [index, i]));
    return {
      nativeType: hull.nativeType,
      vertices: order.map((index) => hull.vertices[index].clone()),
      vertexOrder: order.map((_, i) => i),
      faces: hull.faces.map((face) => ({
        ...face,
        indices: face.indices.map((index) => remap.get(index)!),
      })),
      edges: hull.edges.map(
        ([a, b]) => [remap.get(a)!, remap.get(b)!] as [number, number],
      ),
    };
  });
  const vertices = hulls.map((hull) =>
    hull.vertices.map((point) => point.clone()),
  );
  const car: SimulatedCar = {
    smokeLastComponentLevels: new Uint8Array(12),
    state,
    group,
    mechanics,
    motion,
    damage,
    human,
    overlapRecovery: true,
    overlapDetected: false,
    worldRecovery: false,
    worldOverlapDetected: false,
    shapeVertices: vertices,
    hulls,
    properties: {
      mass: mechanics.root.mass,
      inertia: new Vector3(...mechanics.root.inertia),
      centerOfMass: new Vector3(...mechanics.root.centerOfMass),
      worldFriction: 0,
      objectFriction: 0.4,
    },
    input: { throttle: 0, steer: 0, brake: 0, handbrake: false },
    revision: 0,
    structuralRevision: 0,
    poseEpoch: 0,
    suspensionBendActive: false,
    splitRevision: 0,
    repairing: false,
    repairAwaitingShapeSwap: false,
    knackered: false,
    cachedSoundVelocity: new Vector3(),
    recoveryHistory: new SafeCarHistory(state),
    lastAttributedImpactMs: 0,
    temporaryMassMultiplier: 1,
    crashRecord: new NativeCrashRecord(),
    crashHistory: {
      lastAttacker: null,
      lastMs: 0,
      previousAttacker: null,
      previousMs: 0,
    },
    crashAccelerationKey: false,
    armorLevel: human ? 1 : 0,
    offenseLevel: human ? 1 : 0,
    damageMultiplier: 1,
    protection: 1,
    freeRepairs: false,
  };
  // DamageSystem owns the authored shape vertices, never the render bounds.
  damage.configurePhysics(
    mechanics,
    vertices,
    motion.wheelPositions.map((p) => p.clone().multiplyScalar(1 / 6.9)),
  );
  car.crashRecord.resetDirection(state.orientation);
  return car;
}
function candidate(body: RigidBody, dt: number) {
  if (body.properties.immovable) {
    (body.state.predictedPosition ??= new Vector3()).copy(body.state.position);
    (body.state.predictedOrientation ??= new Quaternion()).copy(
      body.state.orientation,
    );
  } else advanceRigidBody(body, dt, true);
}
function advance(body: RigidBody, dt: number) {
  advanceRigidBody(body, dt);
}
function transformHulls(
  body: RigidBody,
  hulls: CollisionHull[],
  predicted = false,
) {
  const s = body.state;
  return hulls.map((h) =>
    transformHull(
      h,
      predicted ? s.predictedPosition! : s.position,
      predicted ? s.predictedOrientation! : s.orientation,
    ),
  );
}
const correctionBounds: CorrectionBoundsProvider = (
  body,
  position,
  orientation,
  hulls,
) =>
  isNativeSphereBody(body)
    ? nativeBodyWorldBounds(body, position, orientation).expandByScalar(0.005)
    : hullsBounds(hulls);
/** Providers receive fresh rows even when geometry is retained. */
function copyContactRows(rows: readonly Contact[]): Contact[] {
  return rows.map((row) => {
    const point = row.point.clone();
    return {
      ...row,
      point,
      pointB: row.pointB === row.point ? point : row.pointB?.clone(),
      normal: row.normal.clone(),
    };
  });
}
/** Fixed-tick orchestration. Low-level collision equations live in contact.ts;
 * authored mechanics, source tyre forces and permanent shape crush stay distinct.
 * Remaining special-volume and custom sphere/wire paths are
 * explicitly tracked in docs/c2-physics-re.md rather than hidden as tuning.
 */
export class VehicleSimulation {
  cars: SimulatedCar[] = [];
  debris: DetachedBody[] = [];
  noncars: NonCarBody[] = [];
  pedBodies: NativePedBody[] = [];
  /** Stable FORM-owned detached objects. Sleeping does not release the owner. */
  pedBoneBodies: NativePedBoneBody[] = [];
  /** One source header owner shared by actual registered roots. Loaded static
   * world ACTs and unpromoted joint children do not reserve headers. */
  private readonly philFields = new WeakMap<
    RigidBody,
    {
      flags: number;
      header: NativePhilHeader<RigidBody> | null;
      indicator: number;
      next: RigidBody | null;
      previous: RigidBody | null;
    }
  >();
  private philFieldsFor(body: RigidBody) {
    let fields = this.philFields.get(body);
    if (!fields) {
      fields = {
        flags: 0,
        header: null,
        indicator: 0,
        next: null,
        previous: null,
      };
      this.philFields.set(body, fields);
    }
    return fields;
  }
  readonly phil = new NativePhilRegistry<RigidBody>({
    readFlags: (body) =>
      "rigidFlags" in body
        ? Number(body.rigidFlags) >>> 0
        : this.philFieldsFor(body).flags,
    writeFlags: (body, flags) => {
      if ("rigidFlags" in body) body.rigidFlags = flags;
      else this.philFieldsFor(body).flags = flags;
    },
    writeBinding: (body, header, indicator) => {
      Object.assign(this.philFieldsFor(body), { header, indicator });
      if (isNativePedBody(body) || isNativePedBoneBody(body))
        body.headerState = header?.state ?? 0;
    },
    writeLinks: (body, next, previous) => {
      Object.assign(this.philFieldsFor(body), { next, previous });
    },
    writeVelocity: (body, velocity) => body.state.velocity.set(...velocity),
    writeLocalOmega: (body, omega) => {
      body.state.angularVelocity
        .set(...omega)
        .applyQuaternion(body.state.orientation);
    },
    writePassiveMatrix: (body, pose) => {
      if (!isNativePedBody(body))
        throw new Error(
          "Native passive matrix provider required for this body",
        );
      positionPassivePedBody(body, pose);
    },
    onActivated: (body) => {
      if (isNativePedBody(body) || isNativePedBoneBody(body))
        body.headerState = 2;
      this.invalidateWorldFaceCache(body);
    },
  });
  /** Existing generic bodies lack the native quiet hierarchy provider. Their
   * unknown state blocks whole-ring sleep rather than sleeping a partial ring. */
  nativeQuietRingState?: (body: RigidBody) => number;
  /** Applies ec to the complete generic ring; true confirms that ownership. */
  nativeQuietRingSleep?: (members: readonly RigidBody[]) => boolean;
  private pedContactRings = new Map<RigidBody, Set<RigidBody>>();
  private noncarQuiet = new Map<NonCarBody, NativeNonCarQuietState>();
  private pedBoneQuiet = new Map<
    NativePedBoneBody,
    {
      quietState: number;
      inertiaScale: 1 | 50;
      collisionFlags: number;
      beforeWorldV: Vector3;
      beforeLocalOmega: Vector3;
      gravityIncrement: Vector3;
      requiredProviders: Set<string>;
    }
  >();
  nativePedBoneQuietState(body: NativePedBoneBody) {
    return this.pedBoneQuiet.get(body) ?? null;
  }
  /** Actual PHIL-like ec for supported simple free props, independent of the
   * motor's pause/sleep state. Unsupported joint/hierarchy owners return null. */
  nativeNonCarQuietState(
    body: NonCarBody,
  ): Readonly<NativeNonCarQuietState> | null {
    return this.noncarQuiet.get(body) ?? null;
  }
  private genericQuietState(body: RigidBody): number {
    if (isNativePedBoneBody(body))
      return this.pedBoneQuiet.get(body)?.quietState ?? 0;
    if ("kind" in body && body.kind === "noncar")
      return this.noncarQuiet.get(body as NonCarBody)?.quietState ?? 0;
    return this.nativeQuietRingState?.(body) ?? 0;
  }
  private sleepGenericQuietRing(members: readonly RigidBody[]): boolean {
    if (
      !members.every(
        (body) =>
          isNativePedBody(body) ||
          isNativePedBoneBody(body) ||
          ("kind" in body &&
            body.kind === "noncar" &&
            this.noncarQuiet.has(body as NonCarBody)),
      )
    )
      return this.nativeQuietRingSleep?.(members) ?? false;
    for (const body of members)
      if (isNativePedBoneBody(body)) {
        body.doNothing = true;
        body.properties.immovable = true;
        this.pedBoneQuiet.get(body)!.quietState = 0;
      } else if ("kind" in body && body.kind === "noncar")
        sleepNativeNonCarQuiet(
          body as NonCarBody,
          this.noncarQuiet.get(body as NonCarBody)!,
        );
    return true;
  }
  private finishNonCarQuietLeaves(): void {
    const flags = collectNativeCollisionFlags(
      this.lastImpacts
        .filter((row) => row.solverAccepted)
        .map((row) => ({
          a: row.a,
          b: row.b ?? null,
          sourceType: row.sourceType ?? (row.b ? 5 : 1),
          lambda: row.normalImpulse,
        })),
    ).flags;
    for (const [body, state] of this.noncarQuiet) {
      body.collisionFlags = flags.get(body) ?? 0;
      state.localVelocity
        .copy(body.state.velocity)
        .applyQuaternion(body.state.orientation.clone().invert());
      finishNativeNonCarQuiet(
        body,
        state,
        (this.pedContactRings.get(body)?.size ?? 1) === 1,
      );
    }
  }
  private finishNonCarQuietRings(): void {
    for (const [body, state] of this.noncarQuiet) {
      if (state.doNothing) continue;
      const ring = this.pedContactRings.get(body) ?? new Set<RigidBody>([body]);
      const states = [...ring].map((member) =>
        isNativePedBody(member)
          ? member.quietState
          : this.genericQuietState(member),
      );
      if (
        !canSleepNativeQuietGroup(states) ||
        !this.sleepGenericQuietRing([...ring])
      )
        continue;
      for (const member of ring)
        if (isNativePedBody(member)) {
          member.doNothing = true;
          member.properties.immovable = true;
          member.quietState = 0;
        }
    }
  }
  movingWorld: MovingWorldBody[] = [];
  grooves?: WorldGrooveRuntime;
  private worldGrooveFrameActive = false;
  private worldGrooveOptions: WorldGrooveEvaluationOptions = {};
  private collectedMovingWorldPoses = new WeakMap<Surface, MovingWorldPose>();
  readonly worldFaceCache = new NativeWorldFaceCache<Surface>();
  private worldFaceStates = new Map<RigidBody, NativeWorldFaceState>();
  readonly mines = new MineRuntime<SimulatedCar>({
    random: sharedNativeRandom.random,
  });
  mineBodies: MineBody<SimulatedCar>[] = [];
  mineFactory?: { actor: Object3D; bounds: Box3; mass: number };
  onMineEvent?: (event: MineEvent<SimulatedCar>) => void;
  accumulator = 0;
  elapsed = 0;
  /** Installed mechanics interpolation debt: current frame end minus tick. */
  mechanicsTimeSync = 1;
  private frameWindowActive = false;
  private inactiveCars = new WeakSet<SimulatedCar>();
  gravityMultiplier = 1;
  flapGravity = 1.44;
  pinballFactor = 0;
  onPinball?: (body: RigidBody) => void;
  lastImpacts: ContactImpact[] = [];
  readonly cameraContacts = new CameraContactFrame();
  onBeforeStep?: () => void;
  onRepair?: (car: SimulatedCar, cost: number, finished?: boolean) => void;
  onImpact?: (car: SimulatedCar, impact: number) => void;
  onWorldSparks?: (source: WorldSparkSource) => void;
  onCarSparks?: (source: CarSparkSource) => void;
  onTyreAxle?: (
    car: SimulatedCar,
    input: Parameters<
      NonNullable<import("./motion").MotionGround["tyreAxle"]>
    >[0],
  ) => void;
  onStopTyreEffects?: (car: SimulatedCar) => void;
  onOpponentRepulsed?: (source: SimulatedCar, target: SimulatedCar) => void;
  onFinishCars?: (framePeriodMs: number) => void;
  /** Native end-of-force-step tyre mark consumer, distinct from FinishCars smoke. */
  onWheelMarks?: (car: SimulatedCar) => void;
  /** First-seen body order, after both receivers' damage and before the next pair. */
  onImpactPair?: (
    a: Readonly<SimulatedCar> | undefined,
    b: Readonly<SimulatedCar> | undefined,
  ) => void;
  /** Native selected roles, while victim accumulation is still available. */
  onCrashAttribution?: (attacker: SimulatedCar, victim: SimulatedCar) => void;
  onCrashDamageAward?: (
    victim: SimulatedCar,
    credits: number,
    seconds: number,
    multiplier: number,
  ) => void;
  crashDamageAwards?: CrashDamageAwards;
  /** PDGetTotalTime is the raw platform clock, not pause-adjusted GetTotalTime. */
  crashClock: () => number = () => Math.floor(performance.now()) >>> 0;
  private readonly crashCars = new Map<string, SimulatedCar>();
  /** Native car-spec owner slot0xc8; separate from attachment/repair ownership. */
  private readonly crashOwnerSlots = new WeakMap<RigidBody, RigidBody>();
  private readonly lastCrashStepVelocity = new WeakMap<SimulatedCar, Vector3>();
  private collectingOrdinaryCrush = false;
  readonly smashQueue = new NativeSmashQueue<WamSmashQueueContext>();
  readonly spamCrushQueue = new NativeSpamQueue<SimulatedCar>();
  /** Production's final barrier follows ordinary effects, before glass update. */
  deferFinalSmashFlush = false;
  smashClock: () => number = () => Math.round(this.elapsed * 1000) >>> 0;
  readonly ordinaryCrushQueue = new NativeCarCrushQueue<
    SimulatedCar,
    { human: boolean; physicsTickMs: number }
  >();
  /** AI earnings redistribution alone does not invoke native CheckDamage. */
  private readonly deferredCrashWastage = new WeakSet<SimulatedCar>();
  private readonly wreckSmokeStarted = new WeakSet<SimulatedCar>();
  onWasted?: (car: SimulatedCar) => void;
  /** CheckDamage's immediate column producer, before crash attribution. */
  onKnackeredSmoke?: (car: SimulatedCar) => void;
  onFullRepair?: (car: SimulatedCar) => void;
  onWetSmoke?: (car: SimulatedCar) => void;
  onDamageSmoke?: (car: SimulatedCar) => void;
  onStopCarSmoke?: (car: SimulatedCar) => void;
  onWorldGeometryChanged?: () => void;
  settings?: UpgradeSettings;
  skill: 0 | 1 | 2 = 0;
  specialVolumes?: SpecialVolumeConfig;
  defaultWaterVolume: SpecialVolume | null = null;
  oil?: OilRuntime;
  destruction?: WorldDestruction;
  readonly delayedSmashes = new NativeDelayedSideEffects<NativeDelayedTask>();
  readonly worldActivations = new WorldActivationRuntime(() => this.noncars, {
    delayed: this.delayedSmashes,
    readTimeMs: () => this.smashClock(),
    readPhysics: (contact) => this.liveSmashPhysics(contact.bodyActor),
    random: sharedNativeRandom.random,
    onActivate: (body) => this.dormantPoses.delete(body),
  });
  private oilWheelPrevious = new WeakMap<SimulatedCar, Array<Vector3 | null>>();
  minSplitForcePerTonne = 2.5; // GENERAL gMin_force_to_split_XZ_per_tonne.
  /** Native BSS state survives car/race loads and advances once per force call. */
  readonly motionContext = sharedMotionContext;
  private detachmentScheduling = createDetachmentSchedulingContext();
  private contactSurfaces = new Map<RigidBody, Surface[]>();
  private bodyBroadphase = new BodyBroadphase();
  private bodyTrajectoryGuard = new BodyTrajectoryGuard();
  /** Diagnostic A/B switch; production defaults to validated reuse. */
  correctionReuse = true;
  correctionDiagnostics?: CorrectionDiagnostics &
    StationaryBoundsDiagnostics & {
      correctionPasses?: number;
      contactCollections?: number;
      worldCollections?: number;
      worldHullTransforms?: number;
    };
  private correctionWorkingSet?: CorrectionWorkingSet;
  private correctionGeometry = new CorrectionWorkingSet();
  /** Only validated dormant geometry persists; contacts and paths never do. */
  private dormantCorrectionGeometry = new CorrectionWorkingSet();
  private stationaryCorrectionBounds = new StationaryBoundsCache();
  private dormantCorrectionPoses = new WeakMap<
    SimulationBody,
    {
      shape: object;
      old: object;
      next: object;
      geometry: CorrectionGeometry;
    }
  >();
  /** Opt-in diagnostics; no counters or retained captures in normal gameplay. */
  bodyPairDiagnostics?: (
    phase: "contacts" | "commit" | "projection",
    counters: BodyContactDiagnostics | BodyGuardDiagnostics,
  ) => void;
  private dormantPoses = new WeakMap<
    NonCarBody,
    { old: CollisionHull[]; next: CollisionHull[]; bounds: Box3 }
  >();
  constructor(
    public world: WorldCollision,
    public scene: Object3D,
  ) {}
  addPedBody(body: NativePedBody): void {
    if (this.pedBodies.includes(body)) return;
    if (!this.phil.getHeader(body)) {
      const wasActive = body.headerState === 2;
      if (this.phil.registerImmediate(body) !== 0)
        throw new Error("No native PHIL header available for pedestrian body");
      if (wasActive) this.phil.activate(body, { flag2: true });
    }
    const header = this.phil.getHeader(body)!;
    header.gravity = body.gravity;
    header.drag = body.drag;
    header.levelOut = body.levelOut;
    header.flags = (header.flags & ~8) | (body.volumeEnabled ? 8 : 0);
    // The character/render pool owns actor allocation, hierarchy and release.
    this.pedBodies.push(body);
  }
  removePedBody(body: NativePedBody): void {
    this.phil.remove(body);
    this.pedBodies = this.pedBodies.filter((entry) => entry !== body);
    this.contactSurfaces.delete(body);
    const faces = this.worldFaceStates.get(body);
    if (faces) this.worldFaceCache.invalidate(faces);
    this.worldFaceStates.delete(body);
    this.pedContactRings.delete(body);
  }
  addPedBoneBody(body: NativePedBoneBody): { accepted: boolean; code: number } {
    if (
      body.rigidType !== 5 ||
      !body.actor ||
      body.model == null ||
      !(body.properties.mass > 0)
    )
      throw new Error(
        "A prepared native bone object is required for admission",
      );
    if (this.pedBoneBodies.includes(body)) return { accepted: true, code: 1 };
    if (body.shape.type === "LINE")
      throw new Error(
        "Native detached LINE movement/contact provider required",
      );
    const existing = this.phil.getHeader(body);
    if (!existing) {
      const result = registerNativePedBoneBody(body, {
        supportsShape: (shape) =>
          shape.type === "BOX" || shape.type === "SPHERE",
        registerImmediate: (part) => this.phil.registerImmediate(part),
        onProperty: (part) => {
          const header = this.phil.getHeader(part)!;
          header.flags = part.headerFlags;
          header.gravity = part.gravity;
          header.levelOut = part.levelOut;
        },
      });
      if (!result.accepted) return result;
    } else if (!body.registered)
      throw new Error(
        "Native bone registration properties must precede admission",
      );
    this.pedBoneBodies.push(body);
    this.pedBoneQuiet.set(body, {
      quietState: 0,
      inertiaScale: 1,
      collisionFlags: 0,
      beforeWorldV: new Vector3(),
      beforeLocalOmega: new Vector3(),
      gravityIncrement: new Vector3(),
      requiredProviders: new Set(),
    });
    return { accepted: true, code: 0 };
  }
  removePedBoneBody(body: NativePedBoneBody): void {
    this.phil.remove(body);
    body.registered = false;
    this.pedBoneBodies = this.pedBoneBodies.filter((entry) => entry !== body);
    this.contactSurfaces.delete(body);
    const faces = this.worldFaceStates.get(body);
    if (faces) this.worldFaceCache.invalidate(faces);
    this.worldFaceStates.delete(body);
    this.pedContactRings.delete(body);
    this.pedBoneQuiet.delete(body);
  }
  readonly smashPowerupQueue = new NativeSmashPowerupQueue<
    SimulatedCar,
    Object3D
  >();
  onSmashPowerup?: (
    entry: Readonly<NativeSmashPowerup<SimulatedCar, Object3D>>,
  ) => void;
  liveSmashPhysics(actor: Object3D | undefined) {
    if (!actor) return undefined;
    const body =
      this.cars.find((car) => car.group === actor) ??
      this.noncars.find((body) => body.actor === actor) ??
      this.debris.find((body) => body.actor === actor) ??
      this.movingWorld.find((body) => body.actor === actor);
    if (!body) return undefined;
    return {
      velocity: body.state.velocity.clone(),
      transform: new Matrix4().compose(
        body.state.position,
        body.state.orientation,
        actor.getWorldScale(new Vector3()),
      ),
    };
  }
  add(car: SimulatedCar) {
    if (this.phil.addActiveImmediate(car) !== 0)
      throw new Error("No native PHIL header available for active car");
    car.damage.readSmashStartingVelocity = () =>
      nativeSmashStartingVelocity(this.startingCarSmashVelocity(car));
    car.damage.cancelQueuedSpam = () => this.spamCrushQueue.cancel(car);
    car.damage.deferOrdinaryCrush = (
      contacts,
      vector,
      human,
      physicsTickMs,
    ) => {
      if (!this.collectingOrdinaryCrush) return false;
      this.ordinaryCrushQueue.enqueue(
        car,
        contacts,
        vector,
        car.damage.carSoftness,
        { human, physicsTickMs },
      );
      return true;
    };
    car.damage.onWastageCheck = () => {
      this.deferredCrashWastage.delete(car);
      if (car.damage.wasted) {
        car.knackered = true;
        this.startWreckSmoke(car);
      }
    };
    car.damage.configureDetachmentScheduling(this.detachmentScheduling);
    this.crashCars.set(car.group.uuid, car);
    this.cars.push(car);
    this.sync(car);
  }
  isCarPhysicsActive(car: SimulatedCar): boolean {
    return !this.inactiveCars.has(car);
  }
  /** Last physics broad-phase face cache, also used by C2's fallen-world test. */
  cachedCarMaterialNames(car: SimulatedCar): readonly string[] {
    return (this.contactSurfaces.get(car) ?? []).map((face) => face.material);
  }
  /** Collision+1b4 snapshots velocity before the40ms step's forces/contacts.
   * The smash queue converts this starting model vector to metric shard units.
   */
  startingCarSmashVelocity(car: SimulatedCar): Vector3 {
    return (this.lastCrashStepVelocity.get(car) ?? car.state.velocity).clone();
  }
  /** Delayed texture effects use the source body's current starting-step
   * snapshot when admitted to the smash queue, rather than cuboid-time velocity.
   * Noncar starting-velocity storage is not reconstructed yet. */
  startingActorSmashVelocity(actor: Object3D): Vector3 {
    const car = this.cars.find((candidate) => candidate.group === actor);
    return car
      ? nativeSmashStartingVelocity(this.startingCarSmashVelocity(car))
      : new Vector3();
  }
  /** Installed action38 visits registered car categories without a wasted or
   * sleeping gate. Angular increments are native body axes; browser omega is
   * stored in world axes. Keep local collisions enabled after repulsion. */
  repulseOpponents(source: SimulatedCar, floats: readonly number[]): boolean {
    if (!this.cars.includes(source))
      throw new Error("Repulsion source must be a registered car");
    const parameters = repulsionParameters(38, floats);
    // Native car +4c is FinishCars' world COM, not actor translation.
    const sourcePosition = source.properties.centerOfMass
      .clone()
      .applyQuaternion(source.state.orientation)
      .add(source.state.position);
    let hit = false;
    for (const target of this.cars) {
      if (target === source) continue;
      const impulse = opponentRepulsionImpulse(
        sourcePosition,
        target.properties.centerOfMass
          .clone()
          .applyQuaternion(target.state.orientation)
          .add(target.state.position),
        target.temporaryMassMultiplier,
        parameters,
        Math.round(this.elapsed * 1000) >>> 0,
        source.damage.damageContext.random ?? sharedNativeRandom.random,
      );
      if (!impulse) continue;
      this.setCarPhysicsActive(target, true);
      target.state.velocity.add(impulse.deltaVelocity);
      target.state.angularVelocity.add(
        impulse.deltaAngularVelocity.applyQuaternion(target.state.orientation),
      );
      target.networkStateCutoffMs = impulse.networkStateCutoffMs;
      target.crashHistory.lastAttacker = source.group.uuid;
      target.crashHistory.lastMs = this.crashClock();
      target.lastAwardAttacker = source;
      target.lastAwardImpactMs = target.crashHistory.lastMs;
      target.lastAttributedImpactMs = target.crashHistory.lastMs;
      this.crashCars.set(source.group.uuid, source);
      this.onOpponentRepulsed?.(source, target);
      hit = true;
    }
    return hit;
  }
  /** Collision activity subset of native TurnOpponentPhysicsOff. Call between
   * physics steps; objective/matrix placement and active-list rendering belong
   * to the AI dispatcher. Keep drivetrain and permanent damage untouched. */
  setCarPhysicsActive(car: SimulatedCar, active: boolean): void {
    if (!this.cars.includes(car))
      throw new Error("Cannot change physics activity for an unregistered car");
    if (active) {
      if (!this.phil.getHeader(car) && this.phil.addActiveImmediate(car) !== 0)
        throw new Error("No native PHIL header available to activate car");
      this.inactiveCars.delete(car);
      return;
    }
    this.inactiveCars.add(car);
    this.phil.remove(car);
    car.input.throttle = 0;
    car.input.steer = 0;
    car.input.brake = 0;
    car.input.handbrake = false;
    car.state.velocity.set(0, 0, 0);
    car.state.angularVelocity.set(0, 0, 0);
    car.state.curvature = 0;
    car.state.speed = 0;
    car.state.accForce = 0;
    car.state.brakeForce = 0;
    car.state.predictedPosition = undefined;
    car.state.predictedOrientation = undefined;
    car.overlapDetected = false;
    car.worldOverlapDetected = false;
    this.contactSurfaces.delete(car);
    this.invalidateWorldFaceCache(car);
    this.lastImpacts = this.lastImpacts.filter(
      (impact) => impact.a !== car && impact.b !== car,
    );
    this.cameraContacts.bodies.delete(car);
  }
  addNonCar(body: NonCarBody) {
    // Authored debris is already pulled at this outlet. Ordinary level ACTs
    // stay outside PHIL until their actual wheel/contact promotion.
    if (body.actor.userData.noncarPulled && !this.admitPulledNonCar(body))
      throw new Error("No native PHIL header available for pulled noncar");
    const definition = body.mechanics.worldJoint;
    if (definition?.kind === "translation") {
      const local = new Vector3(...definition.position);
      const world = local
        .clone()
        .applyQuaternion(body.state.orientation)
        .add(body.state.position);
      const parent: RigidBody = {
        state: {
          position: new Vector3(),
          orientation: new Quaternion(),
          velocity: new Vector3(),
          angularVelocity: new Vector3(),
        },
        properties: {
          mass: 1,
          inertia: new Vector3(1, 1, 1),
          centerOfMass: new Vector3(),
          worldFriction: 0,
          immovable: true,
          rotationLocked: true,
        },
      };
      body.joint = createTranslationJoint(
        body,
        parent,
        local,
        world,
        new Vector3(...definition.axis),
        definition.travel,
      );
    }
    this.noncars.push(body);
    this.world.addDynamic(body, body.actor, body.mechanics.drivableOn);
  }
  private admitPulledNonCar(body: NonCarBody): boolean {
    if (this.phil.getHeader(body)) return true;
    return this.phil.addActiveImmediate(body) === 0;
  }
  addMovingWorld(body: MovingWorldBody) {
    this.movingWorld.push(body);
    this.world.addDynamic(body, body.actor, true, true);
  }
  /** Production brackets the entire outer gameplay frame, not each 40ms tick.
   * Camera culling belongs to the supplied native visibility provider. */
  beginWorldGrooveFrame(options: WorldGrooveEvaluationOptions = {}): void {
    this.worldGrooveFrameActive = true;
    this.worldGrooveOptions = options;
    this.grooves?.beginFrame();
  }
  finishWorldGrooveFrame(
    timeMs: number,
    options: WorldGrooveEvaluationOptions = this.worldGrooveOptions,
  ): void {
    this.grooves?.finishFrame(timeMs, options);
    this.prepareMovingWorldPoses();
    this.world.refreshDynamic?.();
    this.worldGrooveFrameActive = false;
  }
  private prepareMovingWorld() {
    // Direct step()/legacy tool callers have no outer-frame owner. Preserve
    // their historical immediate physics-clock poses explicitly; production
    // uses begin/finishWorldGrooveFrame and never advances GROOVE per tick.
    if (!this.worldGrooveFrameActive && this.grooves) {
      this.grooves.update(this.elapsed * 1000);
      // Standalone legacy tools advance ACT geometry every tick without the
      // native outer-frame StopGroovidelic owner. Their cached world-space
      // faces must be recollected; production retains the native ring.
      this.invalidateWorldFaceCache();
    }
    this.prepareMovingWorldPoses();
  }
  private prepareMovingWorldPoses() {
    for (const body of this.movingWorld) {
      body.actor.updateWorldMatrix(true, true);
      const position = new Vector3(),
        orientation = new Quaternion();
      body.actor.matrixWorld.decompose(position, orientation, new Vector3());
      prepareMovingWorldPose(body, position, orientation, PHYSICS_STEP);
    }
  }
  /** Discontinuous placement/world topology changes invalidate retained faces.
   * Normal pose motion uses GetFacesNearObject's containment and ring lifetime. */
  invalidateWorldFaceCache(body?: RigidBody): void {
    if (body) {
      const state = this.worldFaceStates.get(body);
      if (state) this.worldFaceCache.invalidate(state);
    } else
      for (const state of this.worldFaceStates.values())
        this.worldFaceCache.invalidate(state);
  }
  private facesNearBody(
    body: RigidBody,
    hulls: CollisionHull[],
    candidate = false,
  ): Surface[] {
    let state = this.worldFaceStates.get(body);
    if (!state) {
      state = this.worldFaceCache.createState();
      this.worldFaceStates.set(body, state);
    }
    const shapeBounds = isNativePedBoneBody(body)
      ? nativeBodyLocalBounds(body)
      : hullsBounds(hulls);
    const bounds =
      "motion" in body
        ? nativeWheelExtendedBounds(
            shapeBounds,
            (body as SimulatedCar).motion.wheelPositions,
            (body as SimulatedCar).motion.suspensionLength,
          )
        : shapeBounds;
    const matrix = (predicted: boolean) =>
      new Matrix4().compose(
        predicted
          ? (body.state.predictedPosition ?? body.state.position)
          : body.state.position,
        predicted
          ? (body.state.predictedOrientation ?? body.state.orientation)
          : body.state.orientation,
        new Vector3(1, 1, 1),
      );
    let refreshed = false;
    let lastWaterSlot: number | undefined;
    const emittedSlots = new Map<number, Surface>();
    const faces = this.worldFaceCache.get(
      state,
      {
        bounds,
        matrix: matrix(candidate),
        committedMatrix: matrix(false),
      },
      (query, maximum, gatherModels) => {
        refreshed = true;
        // Native gPling_face is cleared ONCE before both possible collection
        // passes. It points into the shared ring, so a wrap can overwrite its
        // slot even when that second pass emits no new ! material.
        const offset =
          maximum === this.worldFaceCache.capacity
            ? 0
            : this.worldFaceCache.count;
        const emitted = this.collectWorldFaces(query, maximum, gatherModels);
        for (let i = 0; i < emitted.length; i++) {
          emittedSlots.set(offset + i, emitted[i]);
          if (emitted[i].material.startsWith("!")) lastWaterSlot = offset + i;
        }
        return emitted;
      },
    );
    if (refreshed) {
      const volume = this.initializeSpecialVolume(body as SimulationBody);
      const face =
        lastWaterSlot === undefined
          ? undefined
          : emittedSlots.get(lastWaterSlot);
      // The callback receives the pointed-to face directly. A ring-overwrite
      // alias can now point to another material; do not re-filter its name.
      const plane = face
        ? detectWaterPlane([{ ...face, material: "!" }])
        : null;
      volume.waterDistance = plane?.distance ?? NO_WATER_DISTANCE;
      if (plane) volume.waterNormal = plane.normal;
    }
    return faces;
  }
  /** Native finite emission and ACT callbacks run before eligibility filtering. */
  private collectWorldFaces(
    query: NativeWorldFaceQuery,
    maximum: number,
    gatherModels: boolean,
  ): Surface[] {
    const collect =
      this.world.collectFaces ?? WorldCollision.prototype.collectFaces;
    const collected = collect.call(this.world, query, maximum, gatherModels, {
      pullActorFromWorld: (actor) => this.pullWorldActor(actor),
      stopGroovidelic: (actor) => this.stopCollectedWorldActor(actor),
      onFace: (surface) => {
        if (
          surface.owner &&
          "kind" in surface.owner &&
          surface.owner.kind === "moving-world"
        )
          this.collectedMovingWorldPoses.set(
            surface,
            captureMovingWorldPose(surface.owner as MovingWorldBody),
          );
      },
    });
    if (!this.world.nativeScene) this.stopGroovesForCollectedFaces(collected);
    return collected;
  }
  private stopCollectedWorldActor(actor: Object3D): void {
    if (!this.worldGrooveFrameActive || !this.grooves) return;
    if (this.grooves.stopActor(actor, this.worldGrooveOptions)) {
      this.prepareMovingWorldPoses();
      this.world.refreshDynamic?.();
    }
  }
  private pullWorldActor(actor: Object3D): object | null {
    if (!this.physicsQueryDepth) return null;
    const body = this.noncars.find((body) => body.actor === actor);
    if (!body || actor.userData.noncarPulled) return null;
    if (!this.admitPulledNonCar(body)) return null;
    actor.userData.noncarPulled = true;
    actor.userData.c2ActorTypeData = body;
    body.state.velocity.set(0, 0, 0);
    body.state.angularVelocity.set(0, 0, 0);
    this.dormantPoses.delete(body);
    return body;
  }
  private physicsQueryDepth = 0;
  /** ActorBoxPick calls once per model that emitted at least one face. */
  private stopGroovesForCollectedFaces(surfaces: readonly Surface[]): void {
    if (!this.worldGrooveFrameActive || !this.grooves) return;
    const models = new Set<Object3D>();
    let evaluated = false;
    for (const surface of surfaces) {
      if (!surface.actor || models.has(surface.actor)) continue;
      models.add(surface.actor);
      for (
        let actor: Object3D | null = surface.actor;
        actor;
        actor = actor.parent
      ) {
        if (this.grooves.actors.has(actor)) {
          evaluated =
            this.grooves.stopActor(actor, this.worldGrooveOptions) || evaluated;
          break;
        }
      }
    }
    if (evaluated) {
      // WorldCollision replaces its dynamic arrays. Surfaces already returned
      // above retain their vertices and captured CCD pose for this query.
      this.prepareMovingWorldPoses();
      this.world.refreshDynamic?.();
    }
  }
  private movingSurfaceContact(
    body: RigidBody,
    hull: CollisionHull,
    surface: Surface,
  ): HullContact | null {
    const owner = surface.owner as MovingWorldBody;
    const collectedPose = this.collectedMovingWorldPoses.get(surface);
    const target = collectedPose ?? owner.state;
    const inverse = target.predictedOrientation.clone().invert();
    const local = (point: Vector3) =>
      point.clone().sub(target.predictedPosition).applyQuaternion(inverse);
    return sweepHullMovingTriangle(body, hull, {
      a: local(surface.a),
      b: local(surface.b),
      c: local(surface.c),
      owner,
      collectedPose,
      sourceSurface: surface,
      edgeOnly: surface.collisionMode === "edges",
      materialIdentifier: surface.material,
      materialFlags: surface.materialFlags,
      faceFlags: surface.faceFlags,
      twoSided: surface.twoSided,
      deferReduction: true,
    });
  }
  private allBodies(): SimulationBody[] {
    return [
      ...this.cars.filter((car) => this.isCarPhysicsActive(car)),
      ...this.debris.filter((body) => !this.attachedToInactiveCar(body)),
      ...this.noncars.filter(
        (body) =>
          !this.disabledWorldActor(body) && !this.attachedToInactiveCar(body),
      ),
      ...this.mineBodies.filter(
        (body) => !(body.mine.flags & MINE_FLAGS.exploded),
      ),
      ...this.pedBodies,
      ...this.pedBoneBodies.filter((body) => this.phil.getState(body) !== 0),
    ];
  }
  private mineCar(car: SimulatedCar): MineCar<SimulatedCar> {
    return {
      victim: car,
      driver: car.human ? 8 : 6,
      mass: car.properties.mass,
      maxDamage: car.damage.carSoftness,
      protection: car.protection,
      noCrush: !!car.damage.damageContext.invulnerable,
      noDamage: !!car.damage.damageContext.invulnerable,
    };
  }
  private mineContact(
    body: RigidBody | undefined,
  ): MineContact<SimulatedCar> | null {
    if (!body) return null;
    if ("damage" in body)
      return { kind: "car", car: this.mineCar(body as SimulatedCar) };
    if ("kind" in body && body.kind === "mine")
      return { kind: "mine", mine: (body as MineBody<SimulatedCar>).mine };
    return { kind: "other", object: body };
  }
  launchMine(car: SimulatedCar, parameters: MineParameters, powerupIndex = 0) {
    if (!this.mineFactory || !this.isCarPhysicsActive(car)) return false;
    const mine = this.mines.spawn(
      this.mineCar(car),
      { ...car.state, bounds: hullsBounds(car.hulls) },
      parameters,
      this.elapsed * 1000,
      powerupIndex,
    );
    if (!mine) return false;
    this.mineBodies = this.mineBodies.filter((body) => {
      if (body.mine.slot !== mine.slot) return true;
      this.phil.remove(body);
      body.actor.removeFromParent();
      return false;
    });
    const actor = this.mineFactory.actor.clone(true);
    this.scene.add(actor);
    const body = createMineBody(
      mine,
      actor,
      this.mineFactory.bounds,
      this.mineFactory.mass,
      car.specialVolume,
    );
    if (this.phil.addActiveImmediate(body) !== 0) {
      actor.removeFromParent();
      // A failed shared-header admission must not erase other deployed mines.
      mine.flags &= ~MINE_FLAGS.active;
      return false;
    }
    this.mineBodies.push(body);
    const hull = transformHulls(body, body.hulls),
      center = mine.position;
    const bounds = hullsBounds(hull).expandByScalar(0.005);
    const worldOverlap =
      worldPlacementContacts(
        hull,
        this.recoverySurfaces(this.world.querySurfaces(bounds.min, bounds.max)),
        center,
      ).length > 0;
    const other = this.allBodies().find(
      (other) =>
        other !== body &&
        other !== car &&
        transformHulls(other, other.hulls).some((b) =>
          hull.some((a) => placementHullsOverlap(a, b)),
        ),
    );
    if (worldOverlap || other)
      this.mines
        .resolveLaunchContact(mine, {
          sensible: false,
          other: this.mineContact(other),
        })
        .forEach((event) => this.handleMineEvent(event));
    else {
      const displacement = mine.position.clone().sub(car.state.position);
      const distance = displacement.length();
      const face = this.world.raycast(
        car.state.position,
        displacement,
        distance,
      );
      this.mines
        .resolveLaunchContact(mine, {
          sensible: true,
          displacement,
          faceFraction: face ? face.distance / distance : null,
        })
        .forEach((event) => this.handleMineEvent(event));
    }
    this.syncActor(body);
    return true;
  }
  hitMine(car: SimulatedCar, impulses: readonly number[]) {
    if (!this.isCarPhysicsActive(car)) return;
    hitMineReaction(
      this.mineCar(car),
      impulses,
      car.damage.damageContext.random ?? Math.random,
      (event) => this.handleMineEvent(event),
    );
  }
  spamCar(car: SimulatedCar, strength: number) {
    if (this.collectingOrdinaryCrush) {
      this.spamCrushQueue.enqueue(car, strength);
      return undefined;
    }
    const result = car.damage.spamModel(
      strength,
      this.elapsed * 1000,
      car.human,
    );
    if (result.splitRequest) {
      const plane = car.damage.prepareSplitPlane(
        result.splitRequest.normal,
        result.splitRequest.constant,
      );
      if (plane) this.performSplit(car, plane);
    }
    this.syncStructuralState(car);
    this.detachParts(car);
    return result;
  }
  private handleMineEvent(event: MineEvent<SimulatedCar>) {
    if (event.kind === "crush") this.spamCar(event.victim, event.strength);
    else if (event.kind === "reaction") {
      const car = event.victim;
      const wasWasted = car.knackered;
      car.state.velocity.add(event.deltaVelocity);
      car.state.angularVelocity.add(
        event.deltaAngularVelocity
          .clone()
          .applyQuaternion(car.state.orientation),
      );
      for (const increment of event.components) {
        car.damage.componentLevels[increment.unit] = mineComponentDamage(
          car.damage.componentLevels[increment.unit],
          increment,
          event.damageMode,
          car.human ? 8 : 6,
          !!car.damage.damageContext.invulnerable,
        );
        if (
          event.damageMode === "filtered" &&
          increment.magnitude >= 5 &&
          !car.damage.damageContext.invulnerable &&
          !(car.human && increment.unit === 2)
        ) {
          // DoDamage43f885 checks even a rejected5..9 finishing increment.
          car.damage.onWastageCheck?.();
          if (car.damage.wasted) car.knackered = true;
        }
      }
      if (event.creditOwner && event.creditOwner !== car) {
        this.crashCars.set(event.creditOwner.group.uuid, event.creditOwner);
        car.crashHistory.lastAttacker = event.creditOwner.group.uuid;
        car.crashHistory.lastMs = this.crashClock();
        car.lastAwardAttacker = event.creditOwner;
        car.lastAwardImpactMs = car.crashHistory.lastMs;
      }
      car.lastAttributedImpactMs = car.crashHistory.lastMs;
      if (
        !wasWasted &&
        (car.knackered ||
          (car.damage.wasted && !this.deferredCrashWastage.has(car)))
      ) {
        car.wastedByPlayer = !!event.creditOwner?.human;
        car.knackered = true;
      }
      car.state.health = 100 - Math.max(...car.damage.componentLevels);
    } else if (event.kind === "explode" || event.kind === "release") {
      const body = this.mineBodies.find((body) => body.mine === event.mine);
      if (body) this.phil.remove(body);
      body?.actor.removeFromParent();
      if (event.kind === "release")
        this.mineBodies = this.mineBodies.filter(
          (candidate) => candidate !== body,
        );
    }
    this.onMineEvent?.(event);
  }
  private disabledWorldActor(body: SimulationBody) {
    if (!("actor" in body)) return false;
    for (let node: Object3D | null = body.actor; node; node = node.parent)
      if (node.userData.worldSmashDisabled) return true;
    return false;
  }
  private syncActor(body: {
    actor: Object3D;
    state: RigidBody["state"];
    kind?: string;
  }) {
    body.actor.position.copy(body.state.position);
    body.actor.quaternion.copy(body.state.orientation);
    if (body.actor.parent) {
      body.actor.parent.updateWorldMatrix(true, false);
      body.actor.position.applyMatrix4(
        body.actor.parent.matrixWorld.clone().invert(),
      );
      body.actor.quaternion.premultiply(
        body.actor.parent.getWorldQuaternion(new Quaternion()).invert(),
      );
    }
    if (body.kind === "pedestrian-bone") body.actor.updateMatrix();
    body.actor.updateMatrixWorld(true);
    if (body.kind === "pedestrian-bone") {
      const bone = body as NativePedBoneBody;
      bone.nativeMatrix.copy(body.actor.matrixWorld);
      if (bone.poseTarget) {
        const m = bone.nativeMatrix.elements;
        bone.poseTarget.set([
          m[0],
          m[1],
          m[2],
          m[4],
          m[5],
          m[6],
          m[8],
          m[9],
          m[10],
          m[12],
          m[13],
          m[14],
        ]);
      }
    }
  }
  private allJoints(): RigidJoint[] {
    return [...this.debris, ...this.noncars].flatMap((b) =>
      b.joint && !b.properties.immovable && !this.attachedToInactiveCar(b)
        ? [b.joint]
        : [],
    );
  }
  private attachedToInactiveCar(body: DetachedBody | NonCarBody): boolean {
    let parent: RigidBody | undefined = body.joint?.parent;
    const seen = new Set<RigidBody>();
    while (parent && !seen.has(parent)) {
      if (
        "damage" in parent &&
        !this.isCarPhysicsActive(parent as SimulatedCar)
      )
        return true;
      seen.add(parent);
      parent = (parent as DetachedBody | NonCarBody).joint?.parent;
    }
    return false;
  }
  sync(car: SimulatedCar) {
    car.group.position.copy(car.state.position);
    car.group.quaternion.copy(car.state.orientation);
    car.group.updateMatrixWorld(true);
  }
  /** Installed rematerialization4a8884–4a8bb4 resets motion caches after each
   * ground-aligned attempt. Preserve damage and the complete supplied rotation.
   */
  rematerializePose(
    car: SimulatedCar,
    position: Vector3,
    orientation: Quaternion,
    velocity: Vector3,
  ): void {
    car.state.position.copy(position);
    car.state.orientation.copy(orientation);
    car.poseEpoch++;
    car.state.velocity.copy(velocity);
    car.state.angularVelocity.set(0, 0, 0);
    car.state.curvature = car.state.turnSpeed = car.state.rpm = 0;
    car.state.gear = 0;
    car.state.speed = velocity.length();
    car.state.wheelLengths.fill(car.motion.suspensionBase.rideHeight);
    car.state.predictedPosition = undefined;
    car.state.predictedOrientation = undefined;
    car.overlapDetected = car.worldOverlapDetected = false;
    car.overlapRecovery = car.worldRecovery = true;
    car.crashRecord.resetDirection(orientation);
    const forward = new Vector3(0, 0, -1).applyQuaternion(orientation);
    car.state.heading = Math.atan2(-forward.x, -forward.z);
    this.contactSurfaces.delete(car);
    this.invalidateWorldFaceCache(car);
    this.oilWheelPrevious.delete(car);
    this.sync(car);
  }
  /** Native sensible-place public polarity: an obstruction is0, clear is-1.
   * Reuse the current authored/deformed hull and finite world feature queries.
   */
  testCarPlacement(car: SimulatedCar): 0 | -1 {
    return this.placementDirection(car, car.hulls) ? 0 : -1;
  }
  /** Installed ResetCarSpecialVolume4ff2c0 changes only automatic volume/depth.
   * Recompute immediately; do not erase authored volume or water-plane caches.
   */
  resetCarSpecialVolume(car: SimulatedCar): void {
    const hit = this.world.raycast(
      car.state.position,
      new Vector3(0, 1, 0),
      200,
      true,
    );
    const automatic =
      hit && /^[!#]/.test(hit.surface.material)
        ? (this.specialVolumes?.defaultWater ?? this.defaultWaterVolume)
        : null;
    if (car.specialVolume) {
      car.specialVolume.automatic = automatic;
      car.specialVolume.depth = 1;
    } else
      car.specialVolume = {
        automatic,
        depth: 1,
        waterDistance: NO_WATER_DISTANCE,
        volume: null,
      };
  }
  reset(car: SimulatedCar) {
    car.poseEpoch++;
    car.overlapRecovery = true;
    car.worldRecovery = true;
    car.state.orientation.setFromAxisAngle(Y, car.state.heading);
    car.state.angularVelocity.set(0, 0, 0);
    car.state.curvature = car.state.turnSpeed = 0;
    car.state.predictedPosition = undefined;
    car.state.predictedOrientation = undefined;
    car.specialVolume = undefined;
    this.invalidateWorldFaceCache(car);
    this.oilWheelPrevious.delete(car);
    this.sync(car);
  }
  /** Ordinary FlipUpCar: native saved poses, ceiling clearance, placement retry,
   * attached-child reorientation and drive-state reset. Damage stays persistent. */
  recover(car: SimulatedCar) {
    let skipNewest = allWheelsSuspended({
      wheelLengths: car.state.wheelLengths,
      suspensionLengths: car.motion.suspensionLength,
      roadFrictions: [],
    });
    for (let attempt = 0; attempt < 3; attempt++) {
      const saved = car.recoveryHistory.next(car.state.position, skipNewest);
      skipNewest &&= saved.selectedIndex === 1;
      car.state.position.copy(saved.position);
      car.state.orientation.copy(saved.orientation);
      const upwardClearance = 0.28985506296157837;
      if (!this.world.raycast(car.state.position, Y, upwardClearance))
        car.state.position.y += upwardClearance;
      let sensible = false;
      for (let push = 0; push <= 10; push++) {
        const direction = this.placementDirection(car, car.hulls);
        if (!direction) {
          sensible = true;
          break;
        }
        if (push === 10) break;
        car.state.position.addScaledVector(direction, 0.07246376574039459);
      }
      // Local HW/SW retries older entries only after all ten nudges fail.
      // rec2's unconditional three-iteration loop differs from this revision.
      if (sensible) break;
    }
    const recoveredBodies: RigidBody[] = [car];
    for (let i = 0; i < recoveredBodies.length; i++) {
      const parent = recoveredBodies[i];
      for (const child of this.debris) {
        if (child.joint?.parent !== parent || recoveredBodies.includes(child))
          continue;
        child.state.orientation.copy(parent.state.orientation);
        child.state.position
          .copy(child.joint.parentAnchor)
          .applyQuaternion(parent.state.orientation)
          .add(parent.state.position)
          .sub(
            child.joint.childAnchor
              .clone()
              .applyQuaternion(child.state.orientation),
          );
        child.state.velocity.set(0, 0, 0);
        child.state.angularVelocity.set(0, 0, 0);
        child.state.predictedPosition = undefined;
        child.state.predictedOrientation = undefined;
        this.syncActor(child);
        recoveredBodies.push(child);
      }
    }
    car.poseEpoch++;
    car.state.angularVelocity.set(0, 0, 0);
    car.state.velocity
      .set(0, 0, -Math.fround(0.0002))
      .applyQuaternion(car.state.orientation);
    const forward = new Vector3(0, 0, -1).applyQuaternion(
      car.state.orientation,
    );
    car.state.heading = Math.atan2(-forward.x, -forward.z);
    car.state.curvature =
      car.state.turnSpeed =
      car.state.rpm =
      car.state.gear =
      car.state.speed =
        0;
    car.state.wheelLengths = [0, 1, 2, 3].map(
      (i) => car.motion.suspensionBase.rideHeight,
    ) as typeof car.state.wheelLengths;
    car.state.predictedPosition = undefined;
    car.state.predictedOrientation = undefined;
    car.overlapRecovery = car.worldRecovery = true;
    if (car.specialVolume) car.specialVolume.automatic = null;
    this.oilWheelPrevious.delete(car);
    this.sync(car);
  }
  dropOil(car: SimulatedCar): boolean {
    if (!this.oil) return false;
    // Installed PissOutOil4dde40 queues the live actor with native pCar=null.
    // The retained source is car_actor/MODEL, independent from pCar attribution.
    // Final outer-frame processing places it; no owner cooldown applies.
    const mesh = car.damage.primaryRenderMesh;
    if (!mesh?.parent) return false;
    const sourceModel = mesh.geometry;
    // Installed4dde57..96 follows the MASTER ACT but retains the principal
    // car ACT's MODEL. The graphics phase supplies its interpolated matrix.
    const source = {
      identity: car.group,
      readMatrix: () => {
        car.group.updateWorldMatrix(true, false);
        return car.group.matrixWorld.clone();
      },
      readPosition: () => car.group.getWorldPosition(new Vector3()),
      readModelBounds: () => liveModelBounds(sourceModel),
    };
    const spill = this.oil.queueChargedSpill(source, this.smashClock());
    if (!spill) return false;
    this.scene.add(spill.mesh);
    return true;
  }
  private projectOil(
    position: Vector3,
    fullSize: number,
    actor: RigidBody | null,
    spill?: OilSpill,
  ) {
    if (spill?.source)
      return projectNativeOil(
        spill.source.readMatrix(),
        spill.source.readModelBounds(),
        fullSize,
        spill.mesh.position,
        (query, capacity) => this.collectWorldFaces(query, capacity, true),
      );
    const origin = position.clone().add(new Vector3(0, 0.2, 0));
    const hit = this.world.raycast(origin, new Vector3(0, -1, 0), 1);
    if (!hit) return null;
    const projected = origin.addScaledVector(
      new Vector3(0, -1, 0),
      hit.distance,
    );
    const own =
      actor && "hulls" in actor
        ? hullsBounds(transformHulls(actor, actor.hulls as CollisionHull[]))
        : new Box3(position.clone(), position.clone());
    // Native x/z bounds use the generated half-size, not the car width.
    const bounds = new Box3(
      new Vector3(
        position.x - fullSize,
        own.min.y - 1 / 6.9,
        position.z - fullSize,
      ),
      new Vector3(position.x + fullSize, own.max.y, position.z + fullSize),
    );
    // FindFacesInBox performs a finite face/box test after its cell lookup.
    // A broad-phase cell may also contain a distant wall, which must not
    // prevent an otherwise valid spill from being placed on a flat road.
    const faces = this.world
      .querySurfaces(bounds.min, bounds.max)
      .filter((face) =>
        bounds.intersectsTriangle(new Triangle(face.a, face.b, face.c)),
      );
    return {
      position: projected,
      normal: hit.normal,
      nearbyFaceNormals: faces.map((face) => face.normal),
      sameSideOfNearbyPlanes: faces.map(
        (face) => position.clone().sub(face.a).dot(face.normal) >= 0,
      ),
    };
  }
  private oilGround(car: SimulatedCar) {
    return {
      stopTyreEffects: () => this.onStopTyreEffects?.(car),
      tyreAxle: (
        input: Parameters<
          NonNullable<import("./motion").MotionGround["tyreAxle"]>
        >[0],
      ) => this.onTyreAxle?.(car, input),
      raycast: this.world.raycast.bind(this.world),
      wheelRaycast: (origin: Vector3, direction: Vector3, distance: number) =>
        this.cachedWheelRaycast(car, origin, direction, distance),
      worldWheelContact: (
        wheels: readonly {
          hit: import("./motion").MotionGroundHit | null | undefined;
          load: number;
          point?: Vector3;
        }[],
      ) => {
        if (!this.destruction) return;
        const seen = new Set<Surface>();
        let selected: (typeof wheels)[number] | undefined,
          maximum = 0;
        for (const wheel of wheels) {
          const surface = wheel.hit?.surface;
          if (
            !surface ||
            !this.destruction.hasMaterialTrigger(surface.material) ||
            seen.has(surface)
          )
            continue;
          if (
            surface.owner &&
            !("kind" in surface.owner && surface.owner.kind === "moving-world")
          )
            continue;
          seen.add(surface);
          const metric = Math.fround(
            Math.fround(wheel.load) * Math.fround(0.04),
          );
          if (metric > maximum) {
            maximum = metric;
            selected = wheel;
          }
        }
        const surface = selected?.hit?.surface;
        if (!surface?.actor) return;
        this.destruction.handleContact({
          actor: surface.actor,
          faceIndex: surface.faceIndex,
          material: surface.material,
          normalImpulse: maximum,
          kind: "wheel",
          point: selected!.point,
          bodyActor: car.group,
          impacteeVelocity: car.state.velocity,
          smashStartingVelocity: nativeSmashStartingVelocity(
            this.startingCarSmashVelocity(car),
          ),
          impacteeTransform: car.group.matrixWorld,
          timeMs: this.smashClock(),
        });
        this.flushSmashEffectsBarrier();
      },
      springReaction: (
        hit: import("./motion").MotionGroundHit,
        impulse: Vector3,
      ) => {
        const body = hit.body;
        if (!body || !hit.point) return;
        const noncar = this.noncars.find((n) => n === body);
        // Native wheel reaction leaves dormant translation motors inert; all
        // four supports must first activate a driven-on lift.
        if (
          noncar?.motor.sleeping &&
          noncar.mechanics.worldJoint?.kind === "translation"
        )
          return;
        if (noncar) {
          if (!this.admitPulledNonCar(noncar)) return;
          noncar.motor.sleeping = false;
          noncar.properties.immovable = false;
          noncar.actor.userData.noncarPulled = true;
        }
        applyImpulse(body.state, body.properties, hit.point, impulse);
      },
      supports: (owners: readonly unknown[]) => {
        for (const body of new Set(owners)) {
          const noncar = this.noncars.find((n) => n === body);
          if (
            noncar &&
            notifyNonCarDrivenOn(noncar.mechanics, noncar.motor, owners, noncar)
          )
            noncar.properties.immovable = false;
        }
      },
      sampleOil: (
        points: readonly (Vector3 | null)[],
        grounded: readonly boolean[],
      ) => {
        if (!this.oil) return [1, 1, 1, 1];
        const factors = this.oil.wheelFactors(car, points, {
          driver: car.state.driver ?? (car.human ? 8 : 6),
        });
        // Production consumes distance only when native SkidMark accepts a
        // section. Standalone tools without a renderer retain their old adapter.
        if (this.onWheelMarks) return factors;
        const previous = this.oilWheelPrevious.get(car) ?? [
          null,
          null,
          null,
          null,
        ];
        for (let i = 0; i < 4; i++) {
          const point = points[i];
          if (!point || !grounded[i]) {
            previous[i] = null;
            continue;
          }
          if (previous[i]) {
            const distance = previous[i]!.distanceTo(point) / 6.9;
            if (distance < 0.05) continue;
            this.oil!.consumeOilMark(car, i, distance);
          }
          previous[i] = point.clone();
        }
        this.oilWheelPrevious.set(car, previous);
        return factors;
      },
    };
  }
  private cachedWheelRaycast(
    car: SimulatedCar,
    origin: Vector3,
    direction: Vector3,
    maxDistance: number,
  ) {
    const faces = this.facesNearBody(car, car.hulls);
    const segment = direction.clone().normalize().multiplyScalar(maxDistance);
    let best: import("./motion").MotionGroundHit | null = null;
    let bestDistance = Infinity;
    for (const surface of faces) {
      // Installed MultiRayCheckSingleFace45f5d0: normal gPling_materials
      // excludes !, >, ?. Collection still retains these faces for callbacks.
      if (
        surface.enabled === false ||
        /^[!>?]/.test(surface.material) ||
        surface.collisionMode === "edges" ||
        surface.collisionMode === "passthrough"
      )
        continue;
      const hit = intersectWheelFace(origin, segment, surface);
      const distance = hit ? hit.fraction * maxDistance : Infinity;
      if (!hit || distance >= bestDistance) continue;
      bestDistance = distance;
      best = {
        distance,
        normal: hit.normal,
        point: hit.point,
        surface,
        body: surface.owner,
        velocity: surface.owner
          ? pointVelocity(
              surface.owner.state,
              surface.owner.properties,
              hit.point,
            )
          : undefined,
        friction: surface.modifier.tyreFriction,
        rollingResistance: 0,
        downforce: surface.modifier.downforce,
        bumpiness: surface.modifier.bumpiness,
      };
    }
    // Native WheelForces has a separate drivable physics-object pass. Keep
    // that existing finite dynamic query, without admitting static faces that
    // did not survive the shared ring's finite collection/capacity.
    const dynamic = this.world.drivableWheelRaycast
      ? this.world.drivableWheelRaycast(origin, direction, maxDistance)
      : this.world.wheelRaycast?.(origin, direction, maxDistance);
    if (
      dynamic?.body &&
      !("kind" in dynamic.body && dynamic.body.kind === "moving-world") &&
      dynamic.distance < bestDistance
    )
      return dynamic;
    return best;
  }
  /** Installed callback414930 updates the plane from the finite candidate
   * faces. No face sets the sentinel, but intentionally retains full-depth
   * automatic water; MungeSpecialVolume4ff1a0 clears partial-depth exits. */
  private initializeSpecialVolume(body: SimulationBody): BodyVolumeState {
    const defaultWater =
      this.specialVolumes?.defaultWater ?? this.defaultWaterVolume;
    let state = body.specialVolume;
    if (!state) {
      const overhead = this.world.raycast(
        body.state.position,
        new Vector3(0, 1, 0),
        200,
        true,
      );
      state = body.specialVolume = {
        volume: null,
        automatic:
          overhead &&
          "surface" in overhead &&
          /^[!#]/.test((overhead.surface as Surface).material)
            ? defaultWater
            : null,
        depth: 1,
        waterDistance: NO_WATER_DISTANCE,
      };
    }
    return state;
  }
  private updateSpecialVolume(body: SimulationBody): BodyVolumeState {
    const defaultWater =
      this.specialVolumes?.defaultWater ?? this.defaultWaterVolume;
    const state = this.initializeSpecialVolume(body);
    const shapeBounds = nativeBodyLocalBounds(body);
    const localBounds =
      "motion" in body
        ? nativeWheelExtendedBounds(
            shapeBounds,
            body.motion.wheelPositions,
            body.motion.suspensionLength,
          )
        : shapeBounds;
    const plane =
      state.waterDistance !== NO_WATER_DISTANCE && state.waterNormal
        ? { normal: state.waterNormal, distance: state.waterDistance }
        : null;
    if (plane) {
      const projected = projectWaterDepth(
        localBounds,
        body.state.position,
        body.state.orientation,
        plane,
      );
      state.depth = projected.depth;
      state.automatic = projected.submerged ? defaultWater : null;
    }
    const selected = selectSpecialVolume(
      findSpecialVolume(
        this.specialVolumes?.volumes ?? [],
        body.state.position,
      ),
      state.automatic,
      state.waterDistance,
      state.depth,
    );
    state.volume = selected.volume;
    state.automatic = selected.automatic;
    // Installed4ff27a–4ff2a8 repeats this check even without a volume change.
    if (
      "motion" in body &&
      state.volume &&
      Math.fround(state.volume.gravityMultiplier) < 1
    )
      this.onWetSmoke?.(body);
    return state;
  }
  private applyFreeBodyForces(body: SimulationBody) {
    const previous = body.specialVolume;
    const wasWater =
      !!previous?.volume && previous.volume.viscosityMultiplier > 2;
    const wasFull = wasWater && previous!.depth >= 1;
    const environment = this.updateSpecialVolume(body);
    const isWater =
      !!environment.volume && environment.volume.viscosityMultiplier > 2;
    applyGenericVolumeForces(
      body,
      environment.volume,
      environment.depth,
      PHYSICS_STEP,
      (isWater && environment.depth === 1 && !wasFull) ||
        (!isWater && wasWater),
      this.gravityMultiplier,
    );
  }
  private applyPedFreeForces(
    body: NativePedBody | NativePedBoneBody,
    gravityIncrement: Vector3,
    diagnostics: Set<string>,
  ) {
    const header = this.phil.getHeader(body)!;
    const snapshot = (
      environment: BodyVolumeState | undefined,
    ): NativeFreeVolumeSnapshot => ({
      depth: environment?.depth ?? 1,
      volume: environment?.volume
        ? {
            identity: environment.volume,
            gravity: environment.volume.gravityMultiplier,
            viscosity: environment.volume.viscosityMultiplier,
          }
        : null,
    });
    const before = snapshot(body.specialVolume),
      environment =
        header.flags & 8 && header.state === 2 && !body.doNothing
          ? this.updateSpecialVolume(body)
          : body.specialVolume,
      omega = body.state.angularVelocity
        .clone()
        .applyQuaternion(body.state.orientation.clone().invert()),
      forces = applyNativeFreeForces40(
        {
          headerState: header.state,
          doNothing: body.doNothing,
          headerFlags: header.flags,
          gravity: header.gravity,
          drag: header.drag,
          levelOut: header.levelOut,
          mass: body.properties.mass,
          inertia: body.properties.inertia,
          worldVelocity: body.state.velocity,
          localOmega: omega,
          gravityIncrement,
        },
        {
          globalGravity: this.gravityMultiplier,
          volumeStep: { before, after: snapshot(environment) },
          retainedJoint2:
            isNativePedBoneBody(body) && body.nativeJoint2
              ? "present"
              : "absent",
          levelOut: environment?.waterNormal
            ? ({ packet }) => {
                const delta = nativeFreeLevelOutDelta({
                  inertia: packet.inertia,
                  actorMatrix: nativeRigidPose(
                    body.state.position,
                    body.state.orientation,
                  ),
                  waterPlaneNormal: environment.waterNormal!,
                });
                if (delta.status === "singular") {
                  // Verified native4b6d50 produces NaN here. Explicit stability
                  // deviation: keep gravity/drag but omit this singular torque.
                  diagnostics.add("native-level-out-singularity-suppressed");
                  return new Vector3();
                }
                return delta.bodyDelta;
              }
            : undefined,
        },
      );
    for (const provider of forces.requiredProviders) diagnostics.add(provider);
    if (forces.jointConstraintProviderRequired)
      diagnostics.add("native-retained-joint2-constraint");
    if (forces.applied)
      body.state.angularVelocity
        .copy(omega)
        .applyQuaternion(body.state.orientation);
    return forces;
  }
  private preparePedPhysics(): void {
    this.pedContactRings.clear();
    for (const body of this.pedBodies) {
      if (body.headerState === 2 && this.phil.getState(body) === 1)
        this.phil.activate(body, { flag2: true });
      else if (body.headerState === 1 && this.phil.getState(body) === 2)
        this.phil.makePassive(body);
      // Installed4b674a marks passive headers for this collision phase.
      if (body.headerState === 1) body.phaseMarker = 2;
      this.applyPedFreeForces(body, body.gravityIncrement, body.diagnostics);
      // Installed4b9780 snapshots AFTER forces and BEFORE all lambda solves.
      body.beforeWorldVelocity.copy(body.state.velocity);
      body.beforeLocalOmega
        .copy(body.state.angularVelocity)
        .applyQuaternion(body.state.orientation.clone().invert());
      body.solverLocalVelocity
        .copy(body.state.velocity)
        .applyQuaternion(body.state.orientation.clone().invert());
      if (body.quietState !== 0 && !body.doNothing) {
        body.properties.inertia.multiplyScalar(50);
        body.properties.inertia.set(
          Math.fround(body.properties.inertia.x),
          Math.fround(body.properties.inertia.y),
          Math.fround(body.properties.inertia.z),
        );
        body.solverInertiaScale = 50;
      }
      body.collisionFlags = 0;
      this.pedContactRings.set(body, new Set([body]));
    }
  }
  private preparePedBonePhysics(): void {
    for (const body of this.pedBoneBodies) {
      const header = this.phil.getHeader(body);
      if (!header) continue;
      body.headerState = header.state;
      body.headerFlags = header.flags;
      const state = this.pedBoneQuiet.get(body)!;
      state.requiredProviders.clear();
      this.applyPedFreeForces(
        body,
        state.gravityIncrement,
        state.requiredProviders,
      );
      body.properties.immovable = header.state === 1 || body.doNothing;
      state.beforeWorldV.copy(body.state.velocity);
      state.beforeLocalOmega
        .copy(body.state.angularVelocity)
        .applyQuaternion(body.state.orientation.clone().invert());
      body.localOmega.copy(state.beforeLocalOmega);
      body.solverLocalVelocity
        .copy(body.state.velocity)
        .applyQuaternion(body.state.orientation.clone().invert());
      if (state.quietState !== 0 && !body.doNothing) {
        body.properties.inertia.multiplyScalar(50);
        body.properties.inertia.set(
          ...(body.properties.inertia.toArray().map(Math.fround) as [
            number,
            number,
            number,
          ]),
        );
        state.inertiaScale = 50;
      }
      state.collisionFlags = 0;
      this.pedContactRings.set(body, new Set([body]));
    }
  }
  private pedOther(other: RigidBody | undefined): PedContactOther | null {
    return classifyNativePedOther(other);
  }
  private pedDamageResult(
    body: NativePedBody,
    result: NativePedContactResult,
    phase: "passive" | "active",
  ): void {
    if (result.eligible && "unresolved" in result) {
      for (const diagnostic of result.unresolved)
        body.diagnostics.add(diagnostic);
      // The common HP tail is downstream of severing; no fabricated limb state.
      if (result.unresolved.length === 0) {
        if ("hitPoints" in result) body.hitPoints = result.hitPoints;
        if ("flags" in result) body.pedestrianFlags = result.flags;
        if ("impactCount" in result) body.impactCount = result.impactCount;
        if ("collisionFilterA" in result) {
          body.filterA = result.collisionFilterA;
          body.filterB = result.collisionFilterB;
        }
      }
    }
    body.onContactDamage?.(body, result, phase);
  }
  private preparePedContacts(contacts: Contact[]): Contact[] {
    for (const contact of contacts) {
      // 4bda86 joins the geometry contact ring even if its later lambda is0.
      if (contact.b) {
        const a = this.pedContactRings.get(contact.a) ?? new Set([contact.a]),
          b = this.pedContactRings.get(contact.b) ?? new Set([contact.b]);
        const ring = new Set([...a, ...b]);
        for (const member of ring) this.pedContactRings.set(member, ring);
      }
      for (const [body, other] of [
        [contact.a, contact.b],
        [contact.b, contact.a],
      ] as const) {
        if (body && isNativePedBoneBody(body)) {
          if (body.headerState === 1) {
            body.doNothing = false;
            body.properties.immovable = false;
            this.phil.activate(body, { flag2: true });
            body.headerFlags = this.phil.getHeader(body)!.flags;
          } else if (body.doNothing && other && !other.properties.immovable) {
            body.doNothing = false;
            body.properties.immovable = false;
          }
        }
        // Installed4bda6d invokes4bde80 after actual pair geometry, BEFORE
        // lambdas. Two ordinary ec1 bodies and world-only rows do not wake
        // one another. Jointed hierarchies need their separate native owner.
        if (body && other && "kind" in body && body.kind === "noncar") {
          const noncar = body as NonCarBody;
          const quietState = this.noncarQuiet.get(noncar);
          const passiveOther =
            isNativePedBody(other) && other.phaseMarker === 2;
          if (
            quietState?.doNothing &&
            (!other.properties.immovable || passiveOther)
          ) {
            wakeNativeNonCarQuiet(noncar, quietState);
            this.invalidateWorldFaceCache(noncar);
          }
        }
        if (!body || !isNativePedBody(body)) continue;
        if (body.headerState === 1) {
          activateNativePedBody(body, body.characterVelocity);
          // CharacterMakeActive40b6d9 and level5409692 enable the intact
          // moved/halt callback bit; severed type5 uses flag2=false instead.
          this.phil.activate(body, { flag2: true });
          body.onActivated?.(body, other);
          const context = body.contactProvider?.(body, {
            phase: "passive",
            other,
            contact,
          });
          if (context)
            this.pedDamageResult(
              body,
              passivePedContact({
                ...context,
                state: {
                  ...context.state,
                  hitPoints: body.hitPoints,
                  flags: body.pedestrianFlags,
                },
                other: this.pedOther(other),
                characterVelocity: body.characterVelocity,
                pedRigidType: 2,
                impactCount: body.impactCount,
                passivePrelude: (prelude) => {
                  body.impactCount = prelude.impactCount;
                  context.passivePrelude?.(prelude);
                },
              }),
              "passive",
            );
          else body.diagnostics.add("ped-contact-provider-unavailable");
        } else if (body.doNothing) {
          body.doNothing = false;
          body.properties.immovable = false;
        }
      }
    }
    return contacts;
  }
  private processPedContactDamage(impacts: ContactImpact[]): void {
    // Installed4bbbf5 callback precedes4bbc30 normal application. Group sums
    // and first-row lambda are independent, retaining the source greedy order.
    for (const group of groupNativeImpactRows(impacts)) {
      for (const [body, other, sign] of [
        [group.a, group.b, 1],
        [group.b, group.a, -1],
      ] as const) {
        if (!body || !isNativePedBody(body) || body.headerState !== 2) continue;
        const force = new Vector3();
        for (const row of group.rows)
          force.addScaledVector(
            row.normal,
            row.normalImpulse * (row.a === body ? 1 : -1),
          );
        const first = group.rows[0];
        const context = body.contactProvider?.(body, {
          phase: "active",
          other,
          firstRow: first,
          totalLambda: group.totalLambda,
          firstLambda: first.normalImpulse,
          force: force.clone(),
        });
        if (!context) continue;
        this.pedDamageResult(
          body,
          activePedContact({
            ...context,
            state: {
              ...context.state,
              hitPoints: body.hitPoints,
              flags: body.pedestrianFlags,
            },
            other: this.pedOther(other),
            pedRigidType: 2,
            pedOwnerPresent: true,
            replay: false,
            totalLambda: group.totalLambda,
            firstRowLambda: first.normalImpulse,
            pedVelocityY: body.state.velocity.y,
            worldForce: force,
            faceNormal:
              first.sourceSurface?.normal.clone().multiplyScalar(sign) ?? null,
          }),
          "active",
        );
      }
    }
  }
  private finishPedQuiet(): void {
    const accepted = this.lastImpacts.filter((row) => row.solverAccepted);
    const flags = collectNativeCollisionFlags(
      accepted.map((row) => ({
        a: row.a,
        b: row.b ?? null,
        sourceType: row.sourceType ?? (row.b ? 5 : 1),
        lambda: row.normalImpulse,
      })),
    ).flags;
    for (const body of this.pedBodies) {
      body.collisionFlags = flags.get(body) ?? 0;
      // Installed4ba7eb clears the marker and resolves ec from registration
      // before the leaf evaluator; activation has already removed bit0x20.
      if (body.phaseMarker !== 0) {
        body.phaseMarker = 0;
        body.doNothing = body.headerState === 1;
        body.properties.immovable = body.doNothing;
      }
      if (body.headerState !== 2) continue;
      // Installed4ba7bb restores the temporary prepare-phase moments before
      // eligibility evaluation; no scaled inertia leaks into integration.
      if (body.solverInertiaScale === 50) {
        body.properties.inertia.divideScalar(50);
        body.properties.inertia.set(
          Math.fround(body.properties.inertia.x),
          Math.fround(body.properties.inertia.y),
          Math.fround(body.properties.inertia.z),
        );
        body.solverInertiaScale = 1;
      }
      body.solverLocalVelocity
        .copy(body.state.velocity)
        .applyQuaternion(body.state.orientation.clone().invert());
      const omega = body.state.angularVelocity
          .clone()
          .applyQuaternion(body.state.orientation.clone().invert()),
        ring = this.pedContactRings.get(body) ?? new Set([body]);
      const quiet = evaluateNativeQuietLeaf({
        previousQuietState: body.quietState,
        singleton: ring.size === 1,
        collisionFlags: body.collisionFlags,
        doNothing: body.doNothing,
        beforeWorldVelocity: body.beforeWorldVelocity.toArray(),
        worldVelocity: body.state.velocity.toArray(),
        beforeLocalOmega: body.beforeLocalOmega.toArray(),
        localOmega: omega.toArray(),
        localVelocity: body.solverLocalVelocity.toArray(),
        gravityIncrement: body.gravityIncrement.toArray(),
        mass: body.properties.mass,
        inertia: body.properties.inertia.toArray(),
        bounds: body.profile.bounds,
        centreOfMass: body.profile.centreOfMass,
        jointInfoOrientationY: null,
      });
      body.quietState = quiet.quietState;
      if (quiet.zeroVelocities) {
        body.state.velocity.set(0, 0, 0);
        body.state.angularVelocity.set(0, 0, 0);
        body.auxiliaryLocalOmega.set(0, 0, 0);
      }
    }
    for (const body of this.pedBodies) {
      if (body.headerState !== 2 || body.doNothing) continue;
      const ring = this.pedContactRings.get(body) ?? new Set([body]),
        states = [...ring].map((member) =>
          isNativePedBody(member)
            ? member.quietState
            : this.genericQuietState(member),
        );
      if (
        [...ring].some((member) => !isNativePedBody(member)) &&
        !this.nativeQuietRingState &&
        [...ring].some(
          (member) =>
            !isNativePedBody(member) &&
            !isNativePedBoneBody(member) &&
            !(
              "kind" in member &&
              member.kind === "noncar" &&
              this.noncarQuiet.has(member as NonCarBody)
            ),
        )
      )
        body.diagnostics.add("mixed-contact-ring-quiet-provider-unavailable");
      if (!canSleepNativeQuietGroup(states)) continue;
      if (
        [...ring].some((member) => !isNativePedBody(member)) &&
        !this.sleepGenericQuietRing([...ring])
      ) {
        body.diagnostics.add("mixed-contact-ring-sleep-provider-unavailable");
        continue;
      }
      for (const member of ring)
        if (isNativePedBody(member)) {
          member.doNothing = true;
          member.properties.immovable = true;
          member.quietState = 0;
        }
    }
  }
  private finishPedBoneQuiet(): void {
    const flags = collectNativeCollisionFlags(
      this.lastImpacts
        .filter((row) => row.solverAccepted)
        .map((row) => ({
          a: row.a,
          b: row.b ?? null,
          sourceType: row.sourceType ?? (row.b ? 5 : 1),
          lambda: row.normalImpulse,
        })),
    ).flags;
    for (const body of this.pedBoneBodies) {
      const state = this.pedBoneQuiet.get(body)!;
      state.collisionFlags = flags.get(body) ?? 0;
      if (state.inertiaScale === 50) {
        body.properties.inertia.divideScalar(50);
        body.properties.inertia.set(
          ...(body.properties.inertia.toArray().map(Math.fround) as [
            number,
            number,
            number,
          ]),
        );
        state.inertiaScale = 1;
      }
      if (body.headerState !== 2) continue;
      body.localOmega
        .copy(body.state.angularVelocity)
        .applyQuaternion(body.state.orientation.clone().invert());
      body.solverLocalVelocity
        .copy(body.state.velocity)
        .applyQuaternion(body.state.orientation.clone().invert());
      const ring = this.pedContactRings.get(body) ?? new Set([body]),
        result = evaluateNativeQuietLeaf({
          previousQuietState: state.quietState,
          singleton: ring.size === 1,
          collisionFlags: state.collisionFlags,
          doNothing: body.doNothing,
          beforeWorldVelocity: state.beforeWorldV.toArray(),
          worldVelocity: body.state.velocity.toArray(),
          beforeLocalOmega: state.beforeLocalOmega.toArray(),
          localOmega: body.localOmega.toArray(),
          localVelocity: body.solverLocalVelocity.toArray(),
          gravityIncrement: state.gravityIncrement.toArray(),
          mass: body.properties.mass,
          inertia: body.properties.inertia.toArray(),
          bounds: body.shape.bounds,
          centreOfMass: body.properties.centerOfMass.toArray(),
          jointInfoOrientationY: body.nativeJoint2?.quietOrientationY ?? null,
        });
      state.quietState = result.quietState;
      if (result.zeroVelocities) {
        body.state.velocity.set(0, 0, 0);
        body.state.angularVelocity.set(0, 0, 0);
        body.localOmega.set(0, 0, 0);
        body.auxiliaryLocalOmega.set(0, 0, 0);
      }
    }
    for (const body of this.pedBoneBodies) {
      if (body.headerState !== 2 || body.doNothing) continue;
      const ring = this.pedContactRings.get(body) ?? new Set([body]),
        states = [...ring].map((member) =>
          isNativePedBody(member)
            ? member.quietState
            : this.genericQuietState(member),
        );
      if (
        !canSleepNativeQuietGroup(states) ||
        !this.sleepGenericQuietRing([...ring])
      )
        continue;
      for (const member of ring)
        if (isNativePedBody(member)) {
          member.doNothing = true;
          member.properties.immovable = true;
          member.quietState = 0;
        }
    }
  }
  private finishPedFrame(framePeriodMs: number): void {
    for (const body of this.pedBoneBodies) {
      const header = this.phil.getHeader(body);
      if (header?.state !== 2) continue;
      this.syncActor(body);
      // Detached type5 has no character moved/halt/get-up dispatch. Initial
      // sever callbackbit2=false retains active registration even at ec1.
      if (body.doNothing && header.flags & 2) {
        this.phil.makePassive(body);
        body.headerState = 1;
      }
    }
    for (const body of [...this.pedBodies]) {
      if (body.headerState !== 2) continue;
      body.actor.position.copy(body.state.position);
      body.actor.quaternion.copy(body.state.orientation);
      body.actor.updateMatrix();
      if (body.doNothing) {
        if (!body.haltCallbackEnabled) continue;
        if (!body.onHalt) {
          body.diagnostics.add("native-halt-provider-unavailable");
          continue;
        }
        if (body.onHalt(body, framePeriodMs)) {
          acceptNativePedHalt(body);
          this.phil.makePassive(body);
        } else {
          body.doNothing = false;
          body.properties.immovable = false;
        }
      } else {
        const result = settleNativePedBody({
          worldVector: body.state.velocity.toArray(),
          firstWorldFaceNormal: body.firstWorldFaceNormal?.toArray() ?? null,
          actorMatrix: nativePedRootPose(body),
          mass: body.properties.mass,
          inertia: body.properties.inertia.toArray(),
          bounds: body.profile.bounds,
          localOmega: body.state.angularVelocity
            .clone()
            .applyQuaternion(body.state.orientation.clone().invert())
            .toArray(),
          collisionFlag: body.collisionFlags !== 0,
          doNothing: body.doNothing,
        });
        if (result.gate === "face-unavailable")
          body.diagnostics.add("native-settling-face-unavailable");
        body.state.angularVelocity
          .fromArray(result.localOmega)
          .applyQuaternion(body.state.orientation);
        body.characterVelocity.copy(body.state.velocity);
        body.onMoved?.(body, framePeriodMs);
      }
    }
  }
  /** Full powerup repair439460 also resets suspension, including an unbent
   * car. Restore partition properties before recalculating axle loads. */
  repair(car: SimulatedCar) {
    this.onFullRepair?.(car);
    car.damage.repair();
    car.smokeLastComponentLevels.fill(0);
    this.syncStructuralState(car);
    resetMotionSuspension(car.motion);
  }
  update(dt: number) {
    this.beginCrashFrame();
    this.beginSmashEffects();
    this.ordinaryCrushQueue.initialize();
    this.spamCrushQueue.initialize();
    // updateFrame's accumulator is a pose fraction, not legacy step debt.
    if (this.frameWindowActive) {
      this.accumulator = 0;
      this.frameWindowActive = false;
    }
    this.accumulator = Math.min(
      this.accumulator + Math.max(0, dt),
      PHYSICS_STEP * 5,
    );
    this.mechanicsTimeSync = Math.round(this.accumulator * 1000);
    this.collectingOrdinaryCrush = true;
    try {
      while (this.accumulator >= PHYSICS_STEP) {
        this.step();
        this.accumulator -= PHYSICS_STEP;
      }
    } finally {
      this.collectingOrdinaryCrush = false;
    }
    this.finishPedFrame(Math.round(Math.max(0, dt) * 1000) >>> 0);
    this.onFinishCars?.(Math.round(Math.max(0, dt) * 1000) >>> 0);
    this.flushOrdinaryCrush();
    this.finishCrashFrame();
    if (!this.deferFinalSmashFlush) this.processOilFrame();
    this.flushSmashEffects();
    this.mechanicsTimeSync = 1;
  }
  /** Native absolute race-relative window; elapsed remains the physics tick.
   * A skipped interval advances timed physics state without inventing forces.
   * Calling legacy update next clears the interpolation-only accumulator. */
  updateFrame(frameStartMs: number, framePeriodMs: number) {
    const window = planPhysicsFrameWindow(
      Math.round(this.elapsed * 1000),
      frameStartMs,
      framePeriodMs,
    );
    this.frameWindowActive = true;
    this.beginCrashFrame();
    this.beginSmashEffects();
    this.ordinaryCrushQueue.initialize();
    this.spamCrushQueue.initialize();
    this.cameraContacts.begin();
    this.elapsed = window.stepStartMs / 1000;
    this.mechanicsTimeSync = window.frameEndMs - window.stepStartMs;
    this.collectingOrdinaryCrush = true;
    try {
      for (let i = 0; i < window.steps; i++) {
        this.step();
        this.cameraContacts.step(this.lastImpacts);
      }
    } finally {
      this.collectingOrdinaryCrush = false;
    }
    this.cameraContacts.finish(window.lastPhysicsTickMs, window.frameEndMs);
    this.elapsed = window.lastPhysicsTickMs / 1000;
    this.accumulator = window.interpolationAlpha * PHYSICS_STEP;
    this.finishPedFrame(Math.round(framePeriodMs) >>> 0);
    this.onFinishCars?.(Math.round(framePeriodMs) >>> 0);
    this.flushOrdinaryCrush();
    this.finishCrashFrame();
    for (const car of this.cars) {
      const original = this.lastCrashStepVelocity.get(car);
      if (
        car.human &&
        this.isCarPhysicsActive(car) &&
        original &&
        window.lastPhysicsTickMs > window.frameEndMs &&
        car.crashRecord.cachedSpeed > Math.fround(0.0001)
      )
        car.crashRecord.cachedDirection.copy(
          nativeCrashViewerDirection(
            original,
            car.state.velocity,
            window.lastPhysicsTickMs - window.frameEndMs,
          ),
        );
    }
    if (!this.deferFinalSmashFlush) {
      this.processOilFrame();
      this.flushSmashEffects();
    }
    this.mechanicsTimeSync = 1;
    return window;
  }
  private beginSmashEffects(): void {
    this.smashQueue.initialize();
    this.destruction?.configureSmashQueue(this.smashQueue);
    for (const car of this.cars)
      car.damage.configureWamSmashQueue(this.smashQueue);
  }
  /** Standalone tools return to immediate effects after their outer frame. */
  flushSmashEffects(): number {
    // Installed493752 runs the shared delayed pass once before final49378b.
    this.worldActivations.update(this.smashClock());
    const count = this.flushSmashEffectsBarrier(0);
    this.destruction?.configureSmashQueue();
    for (const car of this.cars) car.damage.configureWamSmashQueue();
    return count;
  }
  /** Mainloop49373c runs after graphics, before delayed effects/final flush.
   * Final-flush connotations therefore wait for the next accepted frame. */
  processOilFrame(timeMs = this.smashClock()): void {
    this.oil?.update(timeMs, this.projectOil.bind(this));
  }
  /** Native argument-one barriers retain configured queue ownership. */
  private flushSmashEffectsBarrier(mode: 0 | 1 = 1): number {
    const count = flushWamSmashQueue(
      this.smashQueue,
      this.smashClock,
      mode === 0
        ? () =>
            this.smashPowerupQueue.flush(0, (entry) =>
              this.onSmashPowerup?.(entry),
            )
        : undefined,
    );
    this.synchronizeWorldDestruction();
    return count;
  }
  /** Native notification/restart is independent of physical dirtiness. Keep
   * finite-ring invalidation on genuine changes at the established barriers;
   * narrow its geometry work without inventing spatial ring/callback policy. */
  synchronizeWorldDestruction(): boolean {
    const actors = this.destruction?.drainCollisionChanges?.() ?? [];
    if (!actors.length) return false;
    if (this.world.invalidateActors) this.world.invalidateActors(actors);
    else {
      // Legacy standalone adapters without explicit owner invalidation.
      this.world.rebuildStatic();
      this.world.invalidateDynamic();
    }
    this.invalidateWorldFaceCache();
    this.onWorldGeometryChanged?.();
    return true;
  }
  /** Installed4360c0 consumes retained car-local events after outer physics,
   * then commits candidate hulls. Explicit single-step diagnostic calls keep
   * their historical immediate execution; production uses updateFrame. */
  private flushOrdinaryCrush(): void {
    // Native431560 executes directly once the physics-active flag is cleared.
    for (const { identity, strength } of this.spamCrushQueue.drain())
      this.spamCar(identity, strength);
    const marked: ReturnType<typeof this.ordinaryCrushQueue.drain> = [];
    for (const retained of this.ordinaryCrushQueue.drain()) {
      const { identity: car, event } = retained;
      const result = car.damage.applyQueuedCrush(
        event.contacts,
        event.meanContact,
        event.direction,
        event.force,
        event.context.physicsTickMs,
        event.context.human,
        true,
      );
      if (result.markedForBend) marked.push(retained);
    }
    for (const car of this.cars) {
      if (!this.isCarPhysicsActive(car)) continue;
      this.syncStructuralState(car);
    }
    for (const car of this.cars) {
      if (!this.isCarPhysicsActive(car) || !car.damage.wam) continue;
      const force = sharedNativeFlapFrame.sample(
        car,
        Math.round(this.elapsed * 1000) >>> 0,
        car.state.velocity,
        car.state.orientation,
        this.flapGravity,
      );
      if (force) car.damage.stepFlaps(force);
    }
    for (const car of this.cars) {
      if (!this.isCarPhysicsActive(car)) continue;
      this.detachParts(car);
    }
    // DoBending4389e0 checks already-bent/split once at bucket entry. It still
    // visits later eligible marks after an earlier bend, preserving RNG order.
    const eligibility = new Map<SimulatedCar, boolean>();
    for (const { identity: car, event } of marked) {
      if (!eligibility.has(car))
        eligibility.set(car, !car.damage.snapped && !car.damage.structuralBend);
      if (!eligibility.get(car)) continue;
      car.damage.applyDeferredBend(
        event.meanContact,
        event.direction,
        event.force,
        event.context.physicsTickMs,
        event.context.human,
        hullsBounds(car.hulls),
      );
    }
    for (const car of this.cars) {
      if (!this.isCarPhysicsActive(car)) continue;
      this.syncStructuralState(car);
      // Deferred bend/SPAM can damage components after the last force step.
      car.state.health = 100 - Math.max(...car.damage.componentLevels);
      if (
        car.knackered ||
        (car.damage.wasted && !this.deferredCrashWastage.has(car))
      )
        this.finishWastage(car);
    }
  }
  private beginCrashFrame(): void {
    for (const car of this.cars) {
      if (!this.isCarPhysicsActive(car)) continue;
      if (car.state.slipping === 0) this.onStopTyreEffects?.(car);
      car.smokeLastComponentLevels.set(car.damage.componentLevels);
      car.damage.lastComponentLevels.set(car.damage.componentLevels);
      car.crashRecord.beginFrame(
        car.knackered,
        car.state.velocity
          .clone()
          .applyQuaternion(car.state.orientation.clone().invert()),
      );
    }
  }
  private finishCrashFrame(): void {
    for (const car of this.cars)
      if (this.isCarPhysicsActive(car))
        car.crashRecord.finishFrame(car.state.velocity, car.state.orientation);
  }
  private recoverySurfaces(surfaces: readonly Surface[]) {
    return surfaces.map((surface) => ({
      ...surface,
      sourceSurface: surface,
      edgeOnly: surface.collisionMode === "edges",
      materialIdentifier: surface.material,
      faceFriction: surface.modifier.wallFriction,
    }));
  }
  private worldContacts(body: RigidBody, hulls: CollisionHull[]): Contact[] {
    if (
      body.properties.immovable ||
      ((isNativePedBody(body) || isNativePedBoneBody(body)) &&
        body.suppressWorldFaces) ||
      ("kind" in body &&
        body.kind === "noncar" &&
        (body as NonCarBody).mechanics.ignoreWorldCollisions)
    )
      return [];
    const carBody = body as SimulationBody;
    const old = transformHulls(body, hulls),
      next = transformHulls(body, hulls, true);
    const surfaces: Surface[] = [];
    this.contactSurfaces.set(body, surfaces);
    const allHits: HullContact[] = [];
    const center = body.properties.centerOfMass
      .clone()
      .applyQuaternion(body.state.orientation)
      .add(body.state.position);
    const nearby = this.facesNearBody(body, hulls, true).filter(
      (surface) =>
        surface.enabled !== false &&
        (!surface.owner || nativePairAllowed(body, surface.owner)) &&
        !/^[!>]/.test(surface.material) &&
        surface.collisionMode !== "passthrough",
    );
    surfaces.push(...nearby);
    if (isNativePedBody(body)) {
      body.worldFaceNormals = nearby.map((surface) => surface.normal.clone());
      body.firstWorldFaceNormal = body.worldFaceNormals[0]?.clone() ?? null;
    }
    if (isNativeSphereBody(body)) {
      const pose = nativeSphereBodyPose(body);
      // Cached world faces retain the candidate owner pose collected before
      // StopGroovidelic. Use relative endpoints and independent old B points.
      const staticHits = nativeSphereSurfaceContacts(
        pose,
        nearby.filter((surface) => !surface.owner),
      );
      const movingHits = nativeSphereMovingWorldContacts(
        pose,
        nearby
          .filter((surface) => !!surface.owner)
          .map((surface) => ({
            ...surface,
            owner: surface.owner as MovingWorldBody,
            collectedPose: this.collectedMovingWorldPoses.get(surface),
            sourceSurface: surface,
            faceFriction: surface.modifier.wallFriction,
          })),
      );
      return finalizeWorldContacts(
        reduceWorldContacts([...staticHits, ...movingHits]),
      ).map((hit) => ({
        a: body,
        b: hit.sourceSurface?.owner,
        point: hit.points[0],
        pointB: hit.pointsB?.[0],
        normal: hit.normal,
        sourceType: hit.contactTypes?.[0],
        penetration: hit.penetration,
        faceFriction: hit.faceFriction ?? 1,
        sourceSurface: hit.sourceSurface,
      }));
    }
    for (let i = 0; i < old.length; i++) {
      const staticNearby = nearby.filter((surface) => !surface.owner);
      const recovery = carBody.worldRecovery
        ? recoverWorldContacts(
            old[i],
            next[i],
            this.recoverySurfaces(staticNearby),
            center,
          )
        : undefined;
      carBody.worldOverlapDetected ||= !!recovery?.overlapDetected;
      const candidates: HullContact[] = [...(recovery?.contacts ?? [])];
      for (const surface of nearby) {
        if (surface.owner) {
          const hit = this.movingSurfaceContact(body, hulls[i], surface);
          if (hit)
            candidates.push({
              ...hit,
              faceFriction: surface.modifier.wallFriction,
            });
          continue;
        }
        const hit = sweepHullTriangle(
          old[i],
          next[i],
          surface.a,
          surface.b,
          surface.c,
          {
            sourceSurface: surface,
            edgeOnly: surface.collisionMode === "edges",
            materialIdentifier: surface.material,
            materialFlags: surface.materialFlags,
            faceFlags: surface.faceFlags,
            twoSided: surface.twoSided,
            deferReduction: true,
            suppressedVertices: recovery?.suppressedVertices,
            skipWorldEdges: !!recovery?.overlapDetected,
            skipWorldVertices: carBody.worldRecovery,
          },
        );
        if (hit)
          candidates.push(
            Object.assign(hit, { faceFriction: surface.modifier.wallFriction }),
          );
      }
      allHits.push(...reduceWorldContacts(candidates));
    }
    return finalizeWorldContacts(allHits).map((hit) => ({
      a: body,
      b: hit.sourceSurface?.owner,
      point: hit.points[0],
      pointB: hit.pointsB?.[0],
      normal: hit.normal,
      sourceType: hit.contactTypes?.[0],
      penetration: hit.penetration,
      faceFriction: hit.faceFriction ?? 1,
      sourceSurface: hit.sourceSurface,
    }));
  }
  /** The impulse solve changes the trajectory which was used to collect its
   * contacts. In particular a wall impulse can pitch a previously clear bumper
   * through a road face. Check that new trajectory against the same finite
   * source features before committing it. Angular samples also catch a vertex
   * whose arc crosses a face although both full-tick endpoints are clear.
   * This integration guard is separate from the original contact selection:
   * its normal-prefix rule can deliberately discard a simultaneous road face.
   */
  private advanceWorldContacts(body: SimulationBody, refine = false) {
    if (
      body.properties.immovable ||
      ((isNativePedBody(body) || isNativePedBoneBody(body)) &&
        body.suppressWorldFaces) ||
      ("kind" in body &&
        body.kind === "noncar" &&
        body.mechanics.ignoreWorldCollisions)
    )
      return this.computeAdvanceWorldContacts(body, refine);
    const working = this.correctionWorkingSet;
    const revision = this.movingWorld.length
      ? undefined
      : this.world.getStaticGuardRevision?.();
    if (!working || revision === undefined)
      return this.computeAdvanceWorldContacts(body, refine);
    const result = working.world(
      body,
      working.capture(body),
      revision,
      refine,
      () => this.computeAdvanceWorldContacts(body, refine),
    );
    (body.state.predictedPosition ??= new Vector3()).copy(result.position);
    (body.state.predictedOrientation ??= new Quaternion()).copy(
      result.orientation,
    );
    return {
      ...result.value,
      contacts: copyContactRows(result.value.contacts),
    };
  }
  private computeAdvanceWorldContacts(body: SimulationBody, refine = false) {
    if (
      body.properties.immovable ||
      ((isNativePedBody(body) || isNativePedBoneBody(body)) &&
        body.suppressWorldFaces) ||
      ("kind" in body &&
        body.kind === "noncar" &&
        body.mechanics.ignoreWorldCollisions)
    )
      return { fraction: 1, contacts: [] as Contact[] };
    if (this.correctionDiagnostics)
      this.correctionDiagnostics.worldCollections =
        (this.correctionDiagnostics.worldCollections ?? 0) + 1;
    const samples = Math.min(
      128,
      Math.max(
        1,
        Math.ceil((body.state.angularVelocity.length() * PHYSICS_STEP) / 0.05),
      ),
    );
    const pose = (fraction: number) => {
      candidate(body, PHYSICS_STEP * fraction);
      return {
        position: body.state.predictedPosition!,
        orientation: body.state.predictedOrientation!,
      };
    };
    const guard = this.sweepWorldTrajectory(body, samples, pose);
    if (
      refine &&
      guard.contacts.length &&
      guard.crossingFraction > guard.fraction
    ) {
      // A single angular sample formerly rejected the entire tick even with
      // clearance before the contact. Prove a safe prefix against actual poses
      // rather than assuming the interpolated time is safe for rigid rotation.
      // Only final commitment needs this; contact solving retains its own rows.
      let safe = guard.fraction,
        blocked = guard.crossingFraction;
      for (let i = 0; i < 8; i++) {
        const trial = (safe + blocked) / 2;
        const prefix = this.sweepWorldTrajectory(
          body,
          Math.max(1, Math.ceil(samples * trial)),
          (fraction) => pose(fraction * trial),
        );
        if (prefix.contacts.length) blocked = trial;
        else safe = trial;
      }
      guard.fraction = safe;
      pose(safe);
    }
    return guard;
  }
  private sweepWorldTrajectory(
    body: SimulationBody,
    samples: number,
    pose: (fraction: number) => { position: Vector3; orientation: Quaternion },
    basePosition = body.state.position,
    baseOrientation = body.state.orientation,
  ) {
    if (isNativeSphereBody(body))
      return this.sweepSphereWorldTrajectory(
        body,
        samples,
        pose,
        basePosition,
        baseOrientation,
      );
    if (this.correctionDiagnostics)
      this.correctionDiagnostics.worldHullTransforms =
        (this.correctionDiagnostics.worldHullTransforms ?? 0) +
        body.hulls.length * (samples + 1);
    let old = body.hulls.map((hull) =>
      transformHull(hull, basePosition, baseOrientation),
    );
    let earliest = 1;
    const hits: HullContact[] = [];
    for (let sample = 1; sample <= samples; sample++) {
      const { position, orientation } = pose(sample / samples);
      const next = body.hulls.map((hull) =>
        transformHull(hull, position, orientation),
      );
      for (let shape = 0; shape < old.length; shape++) {
        const bounds = hullBounds(old[shape])
          .union(hullBounds(next[shape]))
          .expandByScalar(0.005);
        const envelope = worldFaceSweepEnvelope(old[shape], next[shape]);
        const nearby = (
          envelope && this.world.queryLocalSurfaces
            ? this.world.queryLocalSurfaces(
                bounds.min,
                bounds.max,
                false,
                envelope,
              )
            : this.world.querySurfaces(bounds.min, bounds.max)
        ).filter((surface) => !surface.owner);
        if (this.world.faceDiagnostics) {
          this.world.faceDiagnostics.guardSweepFaces =
            (this.world.faceDiagnostics.guardSweepFaces ?? 0) + nearby.length;
          if (!envelope)
            this.world.faceDiagnostics.guardEnvelopeFallbacks =
              (this.world.faceDiagnostics.guardEnvelopeFallbacks ?? 0) + 1;
        }
        const recovery =
          body.worldRecovery || body.worldOverlapDetected
            ? recoverWorldContacts(
                old[shape],
                next[shape],
                this.recoverySurfaces(nearby),
                body.properties.centerOfMass
                  .clone()
                  .applyQuaternion(old[shape].orientation!)
                  .add(old[shape].position!),
              )
            : undefined;
        // Only this independent trajectory guard detects shallow old overlap
        // without a native prior flag. Keep normal worldContacts untouched.
        // Per-face suppression prevents an old floor overlap hiding a NEW wall.
        const shallow = new Map<
          Surface,
          ReturnType<typeof recoverShallowWorldContacts>
        >();
        if (!recovery) {
          const center = body.properties.centerOfMass
            .clone()
            .applyQuaternion(old[shape].orientation!)
            .add(old[shape].position!);
          for (const surface of nearby) {
            const found = recoverShallowWorldContacts(
              old[shape],
              next[shape],
              this.recoverySurfaces([surface])[0],
              center,
            );
            if (found) shallow.set(surface, found);
          }
        }
        const shapeHits = [...(recovery?.contacts ?? [])];
        for (const found of shallow.values())
          shapeHits.push(...found!.contacts);
        for (const surface of nearby) {
          const faceRecovery = recovery ?? shallow.get(surface);
          const hit = sweepHullTriangle(
            old[shape],
            next[shape],
            surface.a,
            surface.b,
            surface.c,
            {
              sourceSurface: surface,
              edgeOnly: surface.collisionMode === "edges",
              materialIdentifier: surface.material,
              materialFlags: surface.materialFlags,
              faceFlags: surface.faceFlags,
              twoSided: surface.twoSided,
              deferReduction: true,
              suppressedVertices: faceRecovery?.suppressedVertices,
              skipWorldEdges: !!faceRecovery?.overlapDetected,
              skipWorldVertices: body.worldRecovery || !!shallow.get(surface),
            },
          );
          if (hit)
            shapeHits.push({
              ...hit,
              faceFriction: surface.modifier.wallFriction,
            });
        }
        for (const hit of shapeHits) {
          for (let index = 0; index < hit.points.length; index++) {
            const normal = hit.pointNormals?.[index] ?? hit.normal;
            const local = hit.points[index]
              .clone()
              .sub(old[shape].position!)
              .applyQuaternion(old[shape].orientation!.clone().conjugate());
            const end = local
              .clone()
              .applyQuaternion(next[shape].orientation!)
              .add(next[shape].position!);
            if (end.sub(hit.points[index]).dot(normal) >= -1e-7) continue;
            const fraction = hit.pointFractions?.[index] ?? hit.fraction ?? 0;
            if (fraction < 0) continue;
            const time = (sample - 1 + fraction) / samples;
            earliest = Math.min(earliest, time);
            hits.push({
              normal,
              points: [
                local.applyQuaternion(baseOrientation).add(basePosition),
              ],
              penetration: 0,
              fraction: time,
              measures: [time],
              contactTypes: [hit.contactTypes?.[index] ?? 1],
              faceFriction: hit.faceFriction,
              sourceSurface: hit.sourceSurface,
            });
          }
        }
      }
      old = next;
    }
    // Preserve four source rows per direction while allowing both independent
    // faces at a road/wall corner to constrain the newly solved movement.
    const groups: HullContact[][] = [];
    for (const hit of hits) {
      let group = groups.find(
        (group) => group[0].normal.dot(hit.normal) > 0.95,
      );
      if (!group) groups.push((group = []));
      group.push(hit);
    }
    const contacts = groups
      .flatMap((group) => reduceWorldContacts(group))
      .map(
        (hit): Contact => ({
          a: body,
          point: hit.points[0],
          normal: hit.normal,
          sourceType: hit.contactTypes?.[0],
          faceFriction: hit.faceFriction,
          sourceSurface: hit.sourceSurface,
        }),
      );
    // A source feature sweep interpolates its endpoints linearly. Committing
    // the interpolated crossing time through the nonlinear rigid integrator
    // can land just beyond the face; retain the preceding tested pose instead.
    return {
      contacts,
      fraction: hits.length ? Math.max(0, earliest - 1 / samples) : 1,
      crossingFraction: earliest,
    };
  }
  private sweepSphereWorldTrajectory(
    body: NativePedBoneBody & {
      shape: Extract<NativePedBoneBody["shape"], { type: "SPHERE" }>;
    },
    samples: number,
    pose: (fraction: number) => { position: Vector3; orientation: Quaternion },
    basePosition: Vector3,
    baseOrientation: Quaternion,
  ) {
    let previous = { position: basePosition, orientation: baseOrientation },
      earliest = 1;
    const contacts: Contact[] = [];
    for (let sample = 1; sample <= samples; sample++) {
      const next = pose(sample / samples),
        bounds = nativeBodyWorldBounds(
          body,
          previous.position,
          previous.orientation,
        )
          .union(nativeBodyWorldBounds(body, next.position, next.orientation))
          .expandByScalar(0.005),
        faces = this.world
          .querySurfaces(bounds.min, bounds.max)
          .filter(
            (surface) =>
              !surface.owner &&
              surface.enabled !== false &&
              !/^[!>]/.test(surface.material) &&
              surface.collisionMode !== "passthrough",
          ),
        spherePose = {
          sphere: body.shape,
          oldPose: nativeRigidPose(previous.position, previous.orientation),
          predictedPose: nativeRigidPose(next.position, next.orientation),
        },
        rows = nativeSphereSurfaceContacts(spherePose, faces).concat(
          // The strict original OLD gate can reject a supported double pose
          // rounded just inside the Float32 shell. This final commit guard
          // alone admits the bounded recovery; solver/damage rows are unchanged.
          recoverNativeSphereSupport(
            spherePose,
            faces.map((surface) => ({
              ...nativeSphereFace(surface),
              ...(surface.collisionMode === "edges"
                ? { materialIdentifier: ">" }
                : {}),
            })),
          ),
        ),
        centerMotion = new Vector3(...body.shape.center)
          .applyQuaternion(next.orientation)
          .add(next.position)
          .sub(
            new Vector3(...body.shape.center)
              .applyQuaternion(previous.orientation)
              .add(previous.position),
          );
      for (const hit of rows) {
        const local = hit.points[0]
            .clone()
            .sub(previous.position)
            .applyQuaternion(previous.orientation.clone().invert()),
          inward = centerMotion.dot(hit.normal);
        // Sphere support in a fixed world normal is center-normal*radius.
        // Rotating the old material point lifts it off that envelope and could
        // discard a descending sphere's genuine floor crossing. This is the
        // final commit guard only; source OLD torque points remain untouched.
        if (inward >= 0) continue;
        earliest = Math.min(
          earliest,
          (sample - 1 + (hit.fraction ?? 0)) / samples,
        );
        contacts.push({
          a: body,
          point: local.applyQuaternion(baseOrientation).add(basePosition),
          normal: hit.normal,
          sourceType: hit.contactTypes?.[0],
          sourceSurface: hit.sourceSurface,
          faceFriction: hit.faceFriction,
        });
      }
      // candidate() reuses its predicted pose objects. Retain values across
      // angular samples; otherwise the next prediction also mutates OLD and
      // erases every sweep after the first subinterval.
      previous = {
        position: next.position.clone(),
        orientation: next.orientation.clone(),
      };
    }
    return {
      contacts,
      fraction: contacts.length ? Math.max(0, earliest - 1 / samples) : 1,
      crossingFraction: earliest,
    };
  }
  private placementDirection(
    car: SimulatedCar,
    hulls: CollisionHull[],
  ): Vector3 | undefined {
    const transformed = transformHulls(car, hulls);
    const bounds = hullsBounds(transformed);
    const center = car.properties.centerOfMass
      .clone()
      .applyQuaternion(car.state.orientation)
      .add(car.state.position);
    bounds.expandByPoint(center).expandByScalar(0.005);
    const worldDirection = worldPlacementDirection(
      worldPlacementContacts(
        transformed,
        this.recoverySurfaces(
          (this.world.queryLocalSurfaces ?? this.world.querySurfaces).call(
            this.world,
            bounds.min,
            bounds.max,
          ),
        ),
        center,
      ),
      car.state.orientation,
    );
    if (worldDirection) return worldDirection;
    for (const other of [
      ...this.cars.filter((candidate) => this.isCarPhysicsActive(candidate)),
      ...this.debris.filter((body) => !this.attachedToInactiveCar(body)),
    ]) {
      if (other === car || ("joint" in other && other.joint?.parent === car))
        continue;
      const otherHulls = transformHulls(other, other.hulls);
      if (
        !transformed.some((a) =>
          otherHulls.some((b) => placementHullsOverlap(a, b)),
        )
      )
        continue;
      const difference = bounds
        .getCenter(new Vector3())
        .sub(hullsBounds(otherHulls).getCenter(new Vector3()));
      return difference.length() > 2.384185791015625e-7
        ? difference.normalize()
        : new Vector3(1, 0, 0);
    }
    return undefined;
  }
  private syncStructuralState(car: SimulatedCar) {
    if (car.splitRevision !== car.damage.splitRevision) {
      if (!car.damage.snapped) {
        car.properties.mass = car.motion.mass = car.mechanics.root.mass;
        car.properties.inertia.fromArray(car.mechanics.root.inertia);
        car.motion.inertia.fromArray(car.mechanics.root.inertia);
      }
      car.splitRevision = car.damage.splitRevision;
    }
    const flags = car.damage.pendingShapeSwapFlags;
    let accepted = true;
    if (car.revision !== car.damage.deformationRevision) {
      if (flags & 4) car.damage.constrainShapeSwap(car.hulls);
      const pending = car.shapeVertices
        .filter((v) => v.length >= 4)
        .map(buildHull);
      if (flags && !(flags & 4))
        accepted = moveShapeToSensiblePlace(car.state.position, () =>
          this.placementDirection(car, pending),
        ).accepted;
      if (accepted) {
        car.hulls = pending;
        car.revision = car.damage.deformationRevision;
        car.damage.pendingShapeSwapFlags = 0;
      }
    }
    if (car.structuralRevision !== car.damage.structuralRevision) {
      car.damage.currentWheelPositions.forEach((point, i) =>
        car.motion.wheelPositions[i].copy(point).multiplyScalar(6.9),
      );
      if (accepted || !(flags & 8)) {
        car.properties.centerOfMass.copy(car.damage.currentCenterOfMass);
        car.motion.centerOfMassModel.copy(car.damage.currentCenterOfMass);
        car.motion.centerOfMass
          .copy(car.damage.currentCenterOfMass)
          .multiplyScalar(6.9);
        if (car.damage.structuralBend || car.suspensionBendActive)
          resetMotionSuspension(car.motion);
        car.suspensionBendActive = !!car.damage.structuralBend;
        car.structuralRevision = car.damage.structuralRevision;
      }
    }
  }
  private performSplit(
    body: SimulatedCar,
    plane: NonNullable<ReturnType<DamageSystem["prepareSplitPlane"]>>,
  ) {
    if (body.protection !== 1) return;
    const oldCenter = body.properties.centerOfMass.clone(),
      oldVelocity = body.state.velocity.clone();
    const result = body.damage.splitAtPlane(plane, body.human);
    if (!result) return;
    const velocityFor = (center: Vector3) =>
      oldVelocity
        .clone()
        .add(
          new Vector3().crossVectors(
            body.state.angularVelocity,
            center
              .clone()
              .sub(oldCenter)
              .applyQuaternion(body.state.orientation),
          ),
        );
    const child: DetachedBody = {
      actor: result.actor,
      owner: body,
      part: -1,
      splitRevision: body.damage.splitRevision,
      hulls: result.shapes.filter((v) => v.length >= 4).map(buildHull),
      overlapRecovery: true,
      overlapDetected: false,
      worldRecovery: true,
      worldOverlapDetected: false,
      state: {
        position: body.state.position.clone(),
        orientation: body.state.orientation.clone(),
        velocity: velocityFor(result.negative.centerOfMass),
        angularVelocity: body.state.angularVelocity.clone(),
      },
      properties: {
        ...result.negative,
        centerOfMass: result.negative.centerOfMass.clone(),
        inertia: result.negative.inertia.clone(),
        worldFriction: 0,
        objectFriction: 0.4,
      },
    };
    // Source42e230 assigns physics children by the original parent-local
    // joint anchor. Their world pose and joint geometry remain unchanged.
    for (const piece of this.debris)
      if (
        piece.joint?.parent === body &&
        result.plane.normal.dot(piece.joint.parentAnchor) -
          result.plane.constant <
          0
      ) {
        piece.joint.parent = child;
        piece.overlapRecovery = piece.worldRecovery = true;
      }
    body.state.velocity.copy(velocityFor(result.positive.centerOfMass));
    body.properties.mass = body.motion.mass = result.positive.mass;
    body.properties.inertia.copy(result.positive.inertia);
    body.motion.inertia.copy(result.positive.inertia);
    body.properties.centerOfMass.copy(result.positive.centerOfMass);
    // Source42e230 retains spring/damping after the partition but resets
    // prior wheel lengths to ride height for the next suspension tick.
    body.state.wheelLengths.fill(body.motion.suspensionBase.rideHeight);
    body.state.groundedWheelCount = 0;
    if (result.disableMotion) body.state.rpm = 0;
    this.scene.add(result.actor);
    if (this.phil.addActiveImmediate(child) !== 0)
      throw new Error("No native PHIL header available for split car root");
    this.debris.push(child);
    this.syncStructuralState(body);
    return child;
  }
  private trySplit(
    impacts: ContactImpact[],
    restarts: Set<SimulationBody>[],
  ): { occurred: boolean; restart: boolean } {
    let restarting = false;
    let occurred = false;
    const members = new Set<SimulationBody>();
    for (const impact of impacts) {
      members.add(impact.a as SimulationBody);
      if (impact.b) members.add(impact.b as SimulationBody);
    }
    // Source42df20 gives all XZ-edge candidates precedence over every roof
    // candidate. The qualifying roof contacts are capped as one summed group.
    const cars = [...members].filter(
      (body): body is SimulatedCar => "damage" in body && !!body.damage.wam,
    );
    for (const roof of [false, true]) {
      for (const body of cars) {
        const wam = body.damage.wam!;
        const ownContacts = impacts
          .slice(0, 40)
          .filter((impact) => impact.a === body);
        const eligibility = {
          minForcePerTonne: this.minSplitForcePerTonne,
          snappability: wam.snappability,
          softness: body.damage.carSoftness,
          driver: body.human ? 8 : 6,
          objectType: 1,
          immune: !!body.damage.damageContext.invulnerable,
          snapped: body.damage.snapped,
        };
        let plane: ReturnType<DamageSystem["prepareSplitPlane"]>;
        let capped: ContactImpact[], total: number, threshold: number;
        if (roof) {
          const candidate = findRoofSplitContactCandidate(ownContacts, {
            ...eligibility,
            splitY: wam.splitY,
            minimumForcePerTonne: this.minSplitForcePerTonne,
          });
          if (
            !candidate ||
            !(plane = body.damage.prepareSplitPlane(
              new Vector3(0, 1, 0),
              candidate.splitY,
              candidate.splitY,
            ))
          )
            continue;
          capped = candidate.contacts;
          total = candidate.totalImpulse;
          threshold = candidate.threshold;
        } else {
          const candidate = findSplitContactCandidate(
            ownContacts,
            this.contactSurfaces.get(body) ?? [],
            eligibility,
            (c) =>
              !!(plane = body.damage.prepareSplitPlane(
                c.horizontalNormalLocal,
                c.horizontalConstantLocal,
              )),
          );
          if (!candidate || !plane) continue;
          capped = [candidate.contact];
          total = candidate.contact.normalImpulse;
          threshold = candidate.threshold;
        }
        const child = this.performSplit(body, plane);
        if (!child) continue;
        occurred = true;
        members.add(child);
        if (total > threshold) {
          restarting = true;
          const factor = threshold / total;
          for (const impact of impacts)
            impact.normalImpulse = capped.includes(impact)
              ? impact.normalImpulse * factor
              : 0;
        }
        break;
      }
      if (occurred) break;
    }
    if (restarting) {
      for (const impact of impacts) impact.sourceType = 9;
      // Include jointed bodies even if their only graph edges were joint rows.
      for (const child of this.debris)
        if (child.joint && members.has(child.joint.parent as SimulationBody))
          members.add(child);
      restarts.push(members);
    }
    return { occurred, restart: restarting };
  }
  private collectContacts(bodies: Array<SimulationBody>): Contact[] {
    const contacts: Contact[] = [];
    for (const body of bodies)
      contacts.push(...this.worldContacts(body, body.hulls));
    contacts.push(...this.collectBodyContacts(bodies));
    return contacts;
  }
  private collectBodyContacts(bodies: SimulationBody[]): Contact[] {
    const contacts: Contact[] = [];
    if (this.correctionDiagnostics)
      this.correctionDiagnostics.contactCollections =
        (this.correctionDiagnostics.contactCollections ?? 0) + 1;
    const working = this.correctionWorkingSet;
    const snapshots = new Map<SimulationBody, CorrectionBodySnapshot>();
    const poses = new Map<
      SimulationBody,
      {
        old: CollisionHull[];
        next: CollisionHull[];
        bounds: Box3;
        oldHullBounds?: Box3[];
        nextHullBounds?: Box3[];
      }
    >();
    const geometryFor = (
      body: SimulationBody,
    ): NonNullable<ReturnType<typeof poses.get>> => {
      const available = poses.get(body);
      if (available) return available;
      const build = () => {
        if (working) {
          const snapshot = working.capture(body);
          snapshots.set(body, snapshot);
          if (
            "kind" in body &&
            body.kind === "noncar" &&
            body.properties.immovable
          ) {
            let retained = this.dormantCorrectionPoses.get(body);
            if (
              retained?.shape !== snapshot.shapeToken ||
              retained.old !== snapshot.oldPoseToken ||
              retained.next !== snapshot.nextPoseToken
            ) {
              this.dormantCorrectionGeometry.diagnostics =
                this.correctionDiagnostics;
              retained = {
                shape: snapshot.shapeToken,
                old: snapshot.oldPoseToken,
                next: snapshot.nextPoseToken,
                geometry: this.dormantCorrectionGeometry.geometry(
                  body,
                  undefined,
                  correctionBounds,
                ),
              };
              this.dormantCorrectionPoses.set(body, retained);
            } else if (this.correctionDiagnostics) {
              this.correctionDiagnostics.geometryHits =
                (this.correctionDiagnostics.geometryHits ?? 0) + 2;
            }
            return retained.geometry;
          }
          return working.geometry(body, snapshot, correctionBounds);
        }
        if (
          "kind" in body &&
          body.kind === "noncar" &&
          body.properties.immovable
        ) {
          const cached = this.dormantPoses.get(body);
          if (cached) {
            if (this.correctionDiagnostics)
              this.correctionDiagnostics.geometryHits =
                (this.correctionDiagnostics.geometryHits ?? 0) + 2;
            return cached;
          }
        }
        if (this.correctionDiagnostics)
          this.correctionDiagnostics.geometryTransforms =
            (this.correctionDiagnostics.geometryTransforms ?? 0) +
            body.hulls.length * 2;
        const old = transformHulls(body, body.hulls),
          next = transformHulls(body, body.hulls, true);
        const bounds = isNativeSphereBody(body)
          ? nativeBodyWorldBounds(
              body,
              body.state.position,
              body.state.orientation,
            )
              .union(
                nativeBodyWorldBounds(
                  body,
                  body.state.predictedPosition!,
                  body.state.predictedOrientation!,
                ),
              )
              .expandByScalar(0.005)
          : hullsBounds(old).union(hullsBounds(next));
        const result = { old, next, bounds };
        if (
          "kind" in body &&
          body.kind === "noncar" &&
          body.properties.immovable
        )
          this.dormantPoses.set(body, result);
        return result;
      };
      const result = build();
      poses.set(body, result);
      return result;
    };
    // Dormant props need an exact swept box to discover newly entering pairs,
    // but full face/edge certificates and transforms only after pair filtering.
    // Source vertices remain checked each collection; no assumed immutability.
    this.stationaryCorrectionBounds.diagnostics = this.correctionDiagnostics;
    const bounds = bodies.map((body) =>
      working &&
      "kind" in body &&
      body.kind === "noncar" &&
      body.properties.immovable &&
      !isNativeSphereBody(body)
        ? this.stationaryCorrectionBounds.get(body)
        : geometryFor(body).bounds,
    );
    const diagnostics = this.bodyPairDiagnostics
      ? ({} as BodyContactDiagnostics)
      : undefined;
    const pairs = this.bodyBroadphase.pairs(bodies, bounds, diagnostics);
    if (diagnostics) {
      diagnostics.maskRejected =
        diagnostics.jointRejected =
        diagnostics.spherePairs =
        diagnostics.contactRows =
          0;
    }
    for (const [i, j] of pairs) {
      const a = bodies[i],
        b = bodies[j];
      if (!nativePairAllowed(a, b)) {
        if (diagnostics) diagnostics.maskRejected++;
        continue;
      }
      if (a.properties.immovable && b.properties.immovable) continue;
      if (!bounds[i].intersectsBox(bounds[j])) continue;
      if (
        ("joint" in a && a.joint?.parent === b) ||
        ("joint" in b && b.joint?.parent === a)
      ) {
        if (diagnostics) diagnostics.jointRejected++;
        continue;
      }
      const pa = geometryFor(a),
        pb = geometryFor(b);
      if (isNativeSphereBody(a) || isNativeSphereBody(b)) {
        if (diagnostics) diagnostics.spherePairs++;
        if (!working && this.correctionDiagnostics)
          this.correctionDiagnostics.pairTests =
            (this.correctionDiagnostics.pairTests ?? 0) + 1;
        const result = working
          ? working.pair(a, b, snapshots.get(a)!, snapshots.get(b)!, () => ({
              contacts: nativeSpherePairRows(a, b),
              overlap: false,
            }))
          : { contacts: nativeSpherePairRows(a, b), overlap: false };
        contacts.push(
          ...(working ? copyContactRows(result.contacts) : result.contacts),
        );
        continue;
      }
      const oldA = pa.old,
        oldB = pb.old,
        nextA = pa.next,
        nextB = pb.next;
      const emit = () => {
        const rows: Contact[] = [];
        let overlap = false;
        for (let ai = 0; ai < oldA.length; ai++)
          for (let bi = 0; bi < oldB.length; bi++) {
            if (
              !(pa.oldHullBounds?.[ai]?.clone() ?? hullBounds(oldA[ai]))
                .union(pa.nextHullBounds?.[ai] ?? hullBounds(nextA[ai]))
                .intersectsBox(
                  (
                    pb.oldHullBounds?.[bi]?.clone() ?? hullBounds(oldB[bi])
                  ).union(pb.nextHullBounds?.[bi] ?? hullBounds(nextB[bi])),
                )
            )
              continue;
            const hit = sweepHulls(oldA[ai], nextA[ai], oldB[bi], nextB[bi], {
              ...(a.overlapRecovery || b.overlapRecovery
                ? {
                    recovery: {
                      a,
                      b,
                      sameAttachmentGroup:
                        attachmentRoot(a) === attachmentRoot(b),
                      // HW0x427b56..427c67 transforms each LOCAL bounds
                      // center. World AABB centers differ under rotation/crush.
                      boundsCenterA: hullsBounds(a.hulls)
                        .getCenter(new Vector3())
                        .applyQuaternion(a.state.orientation)
                        .add(a.state.position),
                      boundsCenterB: hullsBounds(b.hulls)
                        .getCenter(new Vector3())
                        .applyQuaternion(b.state.orientation)
                        .add(b.state.position),
                    },
                  }
                : {}),
              onOverlap: () => {
                overlap = true;
              },
            });
            if (hit)
              hit.points.forEach((point, index) =>
                rows.push({
                  a,
                  b,
                  point,
                  pointB: hit.pointsB?.[index] ?? point,
                  normal: hit.pointNormals?.[index] ?? hit.normal,
                  sourceType: hit.contactTypes?.[index],
                  penetration: hit.penetration,
                }),
              );
          }
        return { contacts: rows, overlap };
      };
      if (!working && this.correctionDiagnostics)
        this.correctionDiagnostics.pairTests =
          (this.correctionDiagnostics.pairTests ?? 0) + 1;
      const result = working
        ? working.pair(a, b, snapshots.get(a)!, snapshots.get(b)!, emit)
        : emit();
      if (result.overlap) a.overlapDetected = b.overlapDetected = true;
      contacts.push(
        ...(working ? copyContactRows(result.contacts) : result.contacts),
      );
    }
    if (diagnostics) {
      diagnostics.contactRows = contacts.length;
      this.bodyPairDiagnostics!("contacts", diagnostics);
    }
    return contacts;
  }
  private processImpactDamage(
    impacts: ContactImpact[],
    jointImpacts: JointConstraintImpact[],
    restarts: Set<SimulationBody>[],
  ): boolean | void {
    for (const impact of impacts) {
      if (impact.sourceType === 9 || impact.normalImpulse <= 0) continue;
      for (const [body, other] of [
        [impact.a, impact.b],
        [impact.b, impact.a],
      ] as const)
        if (body && "kind" in body && body.kind === "mine")
          this.mines
            .contact(
              (body as MineBody<SimulatedCar>).mine,
              this.mineContact(other),
              impact.normalImpulse,
            )
            .forEach((event) => this.handleMineEvent(event));
    }
    const worldRestart = this.processWorldSmash(impacts, restarts);
    const noncarRestart = worldRestart
      ? false
      : this.processNonCarContacts(impacts, restarts);
    // Installed41cb88 runs before cap/restart exits and ordinary crush.
    this.flushSmashEffectsBarrier();
    if (worldRestart || noncarRestart) return false;
    const split = this.trySplit(impacts, restarts);
    if (split.restart) return false;
    if (split.occurred) return;
    // Source431260: tear the first over-torque KEV flap angular LIMIT only,
    // after splitting but before ordinary crush and impulse application.
    for (const row of jointImpacts) {
      const child = this.debris.find(
        (b) => b === row.a && b.joint === row.joint,
      );
      if (!child || child.part < 0 || !row.joint.childAxis) continue;
      const part = child.owner.damage.runtimeParts[child.part];
      const threshold = kevFlapTearThreshold({
        sourceType: row.sourceType,
        impulse: row.normalImpulse,
        childMass: child.properties.mass,
        angularConstraint: row.angularConstraintLocal.toArray(),
        hingeAxis: row.joint.childAxis.toArray(),
        kevFlap: !!part.part.kevOFlap,
        driver: child.owner.human ? 8 : 6,
        immune: !!child.owner.damage.damageContext.invulnerable,
      });
      if (threshold === undefined) continue;
      const members = new Set<SimulationBody>();
      for (const impact of impacts) {
        members.add(impact.a as SimulationBody);
        if (impact.b) members.add(impact.b as SimulationBody);
        impact.sourceType = 9;
        impact.normalImpulse = 0;
      }
      for (const impact of jointImpacts) {
        members.add(impact.a as SimulationBody);
        members.add(impact.b as SimulationBody);
        impact.sourceType = 9;
        impact.normalImpulse = impact === row ? threshold : 0;
      }
      part.state.phase = 2;
      child.joint = undefined;
      child.overlapRecovery = child.worldRecovery = true;
      restarts.push(members);
      return false;
    }
    this.applyImpactDamage(impacts);
    for (const group of applyWorldPinball(impacts, this.pinballFactor))
      if (group.sound) this.onPinball?.(group.body);
  }
  private processWorldSmash(
    impacts: ContactImpact[],
    restarts: Set<SimulationBody>[],
  ) {
    if (!this.destruction) return false;
    for (const [index, impact] of impacts.entries()) {
      if (impact.sourceType === 9 || impact.normalImpulse <= 0) continue;
      const targets: Array<{
        actor: Object3D;
        body: RigidBody;
        point: Vector3;
        surface?: Surface;
      }> = [];
      if (impact.sourceSurface?.actor)
        targets.push({
          actor: impact.sourceSurface.actor,
          body: impact.a,
          point: impact.pointB ?? impact.point,
          surface: impact.sourceSurface,
        });
      else
        for (const [body, other, point] of [
          [impact.a, impact.b, impact.point],
          [impact.b, impact.a, impact.pointB ?? impact.point],
        ] as const)
          if (body && other && "kind" in body && body.kind === "noncar")
            targets.push({ actor: (body as NonCarBody).actor, body, point });
      for (const target of targets) {
        // Thresholds apply to EACH solved row, not their sum. Stop after the
        // first topology change and recollect before using any old face index.
        const bodyActor =
          "group" in target.body
            ? (target.body as SimulatedCar).group
            : "actor" in target.body
              ? (target.body as NonCarBody).actor
              : undefined;
        const result = this.destruction.handleContact({
          actor: target.actor,
          faceIndex: target.surface?.faceIndex,
          material: target.surface?.material,
          normalImpulse: impact.normalImpulse,
          kind: "body",
          point: target.point,
          timeMs: this.smashClock(),
          bodyActor,
          impacteeVelocity: target.body.state.velocity,
          smashStartingVelocity:
            "group" in target.body
              ? nativeSmashStartingVelocity(
                  this.startingCarSmashVelocity(target.body as SimulatedCar),
                )
              : new Vector3(),
          impacteeTransform: bodyActor?.matrixWorld,
        });
        if (!result.changed) continue;
        const restartRequested = result.changes.some(
          (change) => change.requiresRebuild,
        );
        this.synchronizeWorldDestruction();
        const capped =
          result.threshold !== undefined &&
          result.threshold < impact.normalImpulse;
        if (!restartRequested && !capped) continue;
        // Installed41c1d0 returns BEFORE crush/split on a smash cap. Native
        // 4ba2f0 sums up to20 positive rows from its first threshold onward;
        // old type9 rows carry this cap but do not apply stale velocities.
        const selected = capped
          ? impacts
              .slice(index)
              .filter((row) => row.normalImpulse > 0)
              .slice(0, 20)
          : [];
        const total = selected.reduce((sum, row) => sum + row.normalImpulse, 0);
        const factor = capped ? Math.min(1, result.threshold! / total) : 0;
        const members = new Set<SimulationBody>();
        for (const row of impacts) {
          if ("hulls" in row.a) members.add(row.a as SimulationBody);
          if (row.b && "hulls" in row.b) members.add(row.b as SimulationBody);
          row.normalImpulse = selected.includes(row)
            ? row.normalImpulse * factor
            : 0;
          row.sourceType = 9;
        }
        restarts.push(members);
        return true;
      }
    }
    return false;
  }
  private applyImpactDamage(impacts: ContactImpact[]) {
    type Receiver = {
      car: SimulatedCar;
      other: RigidBody | undefined;
      impact: {
        contacts: Vector3[];
        impulse: Vector3;
        severity: number;
        mean: Vector3;
        weight: number;
      };
    };
    type Pair = {
      a: RigidBody;
      b: RigidBody | undefined;
      receivers: Receiver[];
      firstSurface?: Surface;
      totalLambda: number;
      sparkPoint: Vector3;
      sparkForce: Vector3;
    };
    const pairs: Pair[] = [];
    for (const nativeGroup of groupNativeImpactRows(impacts)) {
      if (nativeGroup.totalLambda <= NATIVE_IMPACT_MINIMUM_LAMBDA) continue;
      const pair: Pair = {
        a: nativeGroup.a,
        b: nativeGroup.b,
        receivers: [],
        firstSurface: nativeGroup.rows[0]?.sourceSurface,
        totalLambda: nativeGroup.totalLambda,
        sparkPoint: new Vector3(),
        sparkForce: new Vector3(),
      };
      pairs.push(pair);
      for (const impact of nativeGroup.rows) {
        // Native type-one props and detached wrappers also participate in
        // sparks. Accumulate their primary packet before damage eligibility.
        const primarySign = impact.a === pair.a ? 1 : -1;
        const primaryPoint = (
          primarySign === 1 ? impact.point : (impact.pointB ?? impact.point)
        )
          .clone()
          .sub(pair.a.state.position)
          .applyQuaternion(pair.a.state.orientation.clone().invert());
        const primaryLambda = Math.fround(impact.normalImpulse);
        pair.sparkPoint.addScaledVector(primaryPoint, primaryLambda);
        pair.sparkForce.addScaledVector(
          impact.normal,
          primaryLambda * primarySign,
        );
        for (const [body, other, sign] of [
          [impact.a, impact.b, 1],
          [impact.b, impact.a, -1],
        ] as const) {
          if (!body || !("damage" in body)) continue;
          const car = body as SimulatedCar;
          let receiver = pair.receivers.find((entry) => entry.car === car);
          if (!receiver) {
            receiver = {
              car,
              other,
              impact: {
                contacts: [],
                impulse: new Vector3(),
                severity: 0,
                mean: new Vector3(),
                weight: 0,
              },
            };
            pair.receivers.push(receiver);
          }
          const group = receiver.impact;
          const point = (
            sign === 1 ? impact.point : (impact.pointB ?? impact.point)
          )
            .clone()
            .sub(car.state.position)
            .applyQuaternion(car.state.orientation.clone().invert());
          if (
            group.contacts.length < 4 &&
            !group.contacts.some(
              (p) =>
                Math.abs(p.x - point.x) < 0.005 &&
                Math.abs(p.y - point.y) < 0.005 &&
                Math.abs(p.z - point.z) < 0.005,
            )
          )
            group.contacts.push(point);
          const lambda = Math.fround(impact.normalImpulse);
          group.mean.addScaledVector(point, lambda);
          group.weight = Math.fround(group.weight + lambda);
          group.impulse.addScaledVector(impact.normal, lambda * sign);
          group.severity = Math.max(group.severity, impact.closingSpeed);
        }
      }
    }
    for (const pair of pairs) {
      this.recordCrashOwners(pair.a, pair.b);
      const newlyWasted = new Set<SimulatedCar>();
      const sparkInputs: Parameters<typeof nativeWorldSparkSource>[0][] = [];
      let carSparkInput: Parameters<typeof nativeCarSparkSource>[0] | undefined;
      const primary = this.nativeSparkParticipant(pair.a);
      const secondary = pair.b
        ? this.nativeSparkParticipant(pair.b)
        : undefined;
      if (primary) {
        const localPoint = pair.sparkPoint
          .clone()
          .divideScalar(pair.totalLambda);
        if (pair.b && secondary) {
          carSparkInput = {
            primary,
            secondary,
            primaryState: pair.a.state,
            secondaryState: pair.b.state,
            totalLambda: pair.totalLambda,
            localPoint,
            worldForce: pair.sparkForce.clone(),
            timeSyncMs: this.mechanicsTimeSync,
          };
        }
        if (!pair.b && pair.firstSurface) {
          // Installed 41d77b clamps this consumer to modifiers0..9, unlike
          // general surface/tyre consumers that also accept10 and11.
          const rawIndex = pair.firstSurface.material.charCodeAt(0) - 47;
          const index = rawIndex >= 0 && rawIndex <= 9 ? rawIndex : 0;
          sparkInputs.push({
            car: primary.actor,
            state: pair.a.state,
            driver: primary.driver,
            carFlags: primary.sparky ? 0x200000 : 0,
            totalLambda: pair.totalLambda,
            hasSecondary: false,
            hasFace: true,
            localPoint,
            worldForce: pair.sparkForce.clone(),
            sparkiness: (this.world.modifier?.(index) ?? DEFAULT_SURFACE)
              .sparkiness,
            timeSyncMs: this.mechanicsTimeSync,
          });
        }
      }
      for (const { car, other, impact } of pair.receivers) {
        this.crashCars.set(car.group.uuid, car);
        const otherCar =
          other && "damage" in other ? (other as SimulatedCar) : undefined;
        const vectors = scaleImpactVectors(
          impact.impulse
            .clone()
            .applyQuaternion(car.state.orientation.clone().invert()),
          {
            human: car.human,
            hitCar: !!otherCar,
            hitDetachedPart:
              !!other && !isNativePedBoneBody(other) && "owner" in other,
            attackerHuman: otherCar?.human ?? false,
            receiverSoftness: car.damage.carSoftness,
            attackerSoftness: otherCar?.damage.carSoftness ?? 0.7,
            sinceLastAttributedImpactMs:
              (this.crashClock() - car.crashHistory.lastMs) | 0,
            armorLevel: car.armorLevel,
            offenseLevel: otherCar?.offenseLevel ?? 0,
            armorFactor: car.armorFactor,
            offenseFactor: otherCar?.offenseFactor,
            damageMultiplier: otherCar?.damageMultiplier ?? 1,
            protection: car.protection,
            difficultySoftness: this.settings
              ? skillValue(this.settings.softness, { skill: this.skill })
              : 1,
            difficultyCarCar: this.settings
              ? skillValue(this.settings.carDamageMultiplier, {
                  skill: this.skill,
                })
              : 1,
          },
        );
        const wasWasted = car.knackered;
        car.crashRecord.accumulate(
          vectors.accumulatedDamage,
          !!car.damage.damageContext.invulnerable,
        );
        if (otherCar) {
          const bounds = new Box3();
          for (const shape of car.shapeVertices)
            for (const vertex of shape) bounds.expandByPoint(vertex);
          if (!bounds.isEmpty())
            car.crashRecord.recordCarContact(
              impact.mean.clone().divideScalar(impact.weight),
              {
                min: bounds.min.toArray() as [number, number, number],
                max: bounds.max.toArray() as [number, number, number],
              },
            );
        }
        car.damage.applyImpact(
          impact.contacts,
          vectors.damage,
          !!otherCar,
          car.human,
          this.elapsed * 1000,
          vectors.crush,
          impact.mean.divideScalar(impact.weight),
        );
        if (
          !wasWasted &&
          (car.knackered ||
            (car.damage.wasted && !this.deferredCrashWastage.has(car)))
        ) {
          newlyWasted.add(car);
          car.wastedByPlayer = false;
          // Native DoDamage checks wasting before earnings attenuation. Lower
          // attacker component levels cannot revive an already-knackered car.
          car.knackered = true;
        }
        this.onImpact?.(car, impact.severity);
      }
      if (pair.receivers.length)
        this.onImpactPair?.(
          "damage" in pair.a ? (pair.a as SimulatedCar) : undefined,
          pair.b && "damage" in pair.b ? (pair.b as SimulatedCar) : undefined,
        );
      this.attributeCrashPair(pair.a, pair.b, newlyWasted);
      for (const car of newlyWasted) this.finishWastage(car);
      for (const input of sparkInputs) {
        const source = nativeWorldSparkSource(input);
        if (source) this.onWorldSparks?.(source);
      }
      if (carSparkInput) {
        const source = nativeCarSparkSource(carSparkInput);
        if (source) this.onCarSparks?.(source);
      }
    }
    for (const car of this.cars)
      if (this.isCarPhysicsActive(car)) this.syncStructuralState(car);
  }
  private nativeCrashView(car: SimulatedCar): NativeCrashCar {
    this.crashCars.set(car.group.uuid, car);
    return {
      identity: car.group.uuid,
      driver: car.human ? 8 : 6,
      frameKnackered: car.crashRecord.frameKnackered,
      get accumulatorF32() {
        return car.crashRecord.accumulator;
      },
      set accumulatorF32(value) {
        car.crashRecord.accumulator = value;
      },
      firstContactFace: car.crashRecord.firstContactFace,
      normalizedContactZ: car.crashRecord.normalizedContactZ,
      preSpeedF32: car.crashRecord.preSpeed,
      localVelocityF32: car.crashRecord.localVelocity,
      gear: car.state.gear,
      accelKey: car.crashAccelerationKey,
      joystick: 0,
      history: car.crashHistory,
    };
  }
  private nativeCrashDriver(body: RigidBody): number | undefined {
    if (isNativePedBody(body) || isNativePedBoneBody(body)) return undefined;
    if ("damage" in body) {
      const car = body as SimulatedCar;
      return car.state.driver ?? (car.human ? 8 : 6);
    }
    if ("owner" in body) {
      const part = body as DetachedBody;
      return part.joint ? 1 : part.part === -1 ? 3 : 2;
    }
    if ("kind" in body && body.kind === "noncar") return 4;
    // Mines have a separate explicit ownership path; do not reinterpret them.
    return undefined;
  }
  /** Current independent source car-spec wrapper driver for4cdc60/4cd010.
   * Pedestrian/bone owners and mine objects are not car-spec wrappers. */
  pedestrianAttributionDriver(owner: object): number | undefined {
    if (!("properties" in owner) || !("state" in owner)) return undefined;
    return this.nativeCrashDriver(owner as RigidBody);
  }
  /** Source car-spec+c8. Initial free-part ownership is copied once; later
   * sticky crash ownership may differ from the original repair owner. */
  pedestrianAttributionCulprit(owner: object): object | null | undefined {
    if (this.pedestrianAttributionDriver(owner) === undefined) return undefined;
    return this.crashOwner(owner as RigidBody) ?? null;
  }
  private nativeSparkParticipant(body: RigidBody) {
    const driver = this.nativeCrashDriver(body);
    if (driver === undefined) return undefined;
    if ("damage" in body) {
      const car = body as SimulatedCar;
      return {
        actor: car.group,
        driver: car.state.driver ?? driver,
        sparky: false,
      };
    }
    if ("owner" in body)
      // Independent zero-filled wrappers do not inherit driver/flags/palette.
      return { actor: (body as DetachedBody).actor, driver, sparky: false };
    const prop = body as NonCarBody;
    return { actor: prop.actor, driver, sparky: prop.mechanics.sparky };
  }
  private crashOwner(body: RigidBody): RigidBody | undefined {
    if (isNativePedBoneBody(body)) return undefined;
    if (!this.crashOwnerSlots.has(body) && "owner" in body)
      this.crashOwnerSlots.set(body, (body as DetachedBody).owner);
    return this.crashOwnerSlots.get(body);
  }
  private recordCrashOwners(a: RigidBody, b: RigidBody | undefined): void {
    if (!b) return;
    const driverA = this.nativeCrashDriver(a);
    const driverB = this.nativeCrashDriver(b);
    if (driverA === undefined || driverB === undefined) return;
    // DamageCar41deea executes before driver/immunity gates, even for two props.
    // Both calls apply this rule, idempotently. Cars replace the slot; noncars
    // retain the first owner, including a noncar owner that cannot earn credits.
    if (!this.crashOwner(b) || driverB > 5) this.crashOwnerSlots.set(b, a);
    if (!this.crashOwner(a) || driverA > 5) this.crashOwnerSlots.set(a, b);
  }
  private attributeCrashPair(
    first: RigidBody,
    second: RigidBody | undefined,
    newlyWasted: Set<SimulatedCar>,
  ): void {
    const a = "damage" in first ? (first as SimulatedCar) : undefined;
    const b =
      second && "damage" in second ? (second as SimulatedCar) : undefined;
    if (!a && !b) return;
    const receiver = a ?? b!;
    const other = a ? second : first;
    const now = this.crashClock();
    if (!Number.isInteger(now) || now < 0 || now > 0xffffffff)
      throw new Error("Invalid native crash platform timestamp");
    // Source440550 normalizes drivers2/3/4 after both damage calls. Initialized
    // free-part owners and first-hit world-prop owners remain sticky. Driver1
    // semi-detached parts and self/noncar owners cannot create attribution.
    const driver = other ? this.nativeCrashDriver(other) : undefined;
    if (other && driver !== undefined && driver >= 2 && driver <= 4) {
      const owner = this.crashOwner(other);
      if (owner && "damage" in owner && owner !== receiver) {
        const source = owner as SimulatedCar;
        this.crashCars.set(source.group.uuid, source);
        receiver.crashHistory.lastAttacker = source.group.uuid;
        receiver.crashHistory.lastMs = now;
      }
    }
    // CrashEarnings440530 tests DoCrashEarnings' return value, not whether an
    // attacker was selected. Snapshot its separate saved-damage channel before
    // attribution refreshes history and clears the live accumulators.
    const smokeCar = (car: SimulatedCar) => ({
      frameKnackered: car.crashRecord.frameKnackered,
      accumulatorF32: car.crashRecord.accumulator,
      lastAttackerMs: car.crashHistory.lastMs,
    });
    const damageSmoke = nativeCrashSmokeReturn({
      originalFirst: {
        driver: this.nativeCrashDriver(first) ?? 0,
        accumulatorF32: a?.crashRecord.accumulator ?? 0,
      },
      originalSecond: second
        ? {
            driver: this.nativeCrashDriver(second) ?? 0,
            accumulatorF32: b?.crashRecord.accumulator ?? 0,
          }
        : null,
      normalizedFirst: smokeCar(receiver),
      normalizedSecond: a && b ? smokeCar(b) : null,
      nowMs: now,
    });
    selectNativeCrashAttribution(
      this.nativeCrashView(receiver),
      a && b ? this.nativeCrashView(b) : null,
      now,
      (id) => {
        const car = typeof id === "string" ? this.crashCars.get(id) : undefined;
        return car ? this.nativeCrashView(car) : null;
      },
      (attacker, victim) => {
        const source = this.crashCars.get(String(attacker.identity))!;
        const target = this.crashCars.get(String(victim.identity))!;
        this.onCrashAttribution?.(source, target);
        const delta = redistributeNativeCrashDamage(
          source.damage.componentLevels,
          source.damage.lastComponentLevels,
          target.damage.componentLevels,
          target.damage.lastComponentLevels,
        );
        // Offline AI selections redistribute components but skip the additional
        // CheckDamage43f620 at440df1, which is past the local-human guard.
        if (source.human && !target.knackered && target.damage.wasted) {
          target.damage.onWastageCheck?.();
          newlyWasted.add(target);
        }
        if (!source.human && !target.knackered && target.damage.wasted)
          this.deferredCrashWastage.add(target);
        if (newlyWasted.has(target)) target.wastedByPlayer = source.human;
        // Native completion runs before ordinary crash credit/time awards.
        for (const car of newlyWasted) this.finishWastage(car);
        this.awardCrashDamage(source, target, a, b, delta);
      },
    );
    if (damageSmoke) {
      // The wrapper retains ORIGINAL argument order after normalization.
      if (a) this.onDamageSmoke?.(a);
      if (b) this.onDamageSmoke?.(b);
    }
    for (const car of [a, b]) {
      if (!car) continue;
      const history = car.crashHistory;
      car.lastAwardAttacker =
        history.lastAttacker === null
          ? undefined
          : this.crashCars.get(String(history.lastAttacker));
      car.lastAwardImpactMs =
        history.lastAttacker === null ? undefined : history.lastMs;
      car.lastAttributedImpactMs = history.lastMs;
    }
  }
  private awardCrashDamage(
    attacker: SimulatedCar,
    victim: SimulatedCar,
    a: SimulatedCar | undefined,
    b: SimulatedCar | undefined,
    componentDelta: number,
  ): void {
    if (
      !attacker.human ||
      victim.damage.damageContext.invulnerable ||
      !this.crashDamageAwards
    )
      return;
    let multiplier =
      a && b && nativeCrashHeadOn(a.crashRecord, b.crashRecord) ? 2 : 1;
    const omega = victim.state.angularVelocity
      .clone()
      .applyQuaternion(victim.state.orientation.clone().invert());
    omega.set(Math.fround(omega.x), Math.fround(omega.y), Math.fround(omega.z));
    if (Math.abs(omega.x) > 4 || Math.abs(omega.y) > 6 || Math.abs(omega.z) > 4)
      multiplier *= 2;
    const award = nativeCrashDamageAward(
      componentDelta,
      victim.damage.carSoftness,
      multiplier,
      this.crashDamageAwards.creditsPerDamage[this.skill],
      this.crashDamageAwards.secondsPerDamage[this.skill],
    );
    if (award.rawCredits === 0 && !victim.knackered) return;
    if (!victim.knackered)
      this.onCrashDamageAward?.(
        victim,
        award.credits,
        award.seconds,
        multiplier,
      );
    victim.damage.lastComponentLevels.set(victim.damage.componentLevels);
  }
  private startWreckSmoke(car: SimulatedCar): void {
    if (this.wreckSmokeStarted.has(car)) return;
    this.wreckSmokeStarted.add(car);
    this.onKnackeredSmoke?.(car);
  }
  private finishWastage(car: SimulatedCar): void {
    if (car.wastedAt !== undefined) return;
    car.wastedAt = this.elapsed;
    car.knackered = true;
    this.startWreckSmoke(car);
    this.onWasted?.(car);
  }
  private processNonCarContacts(
    impacts: ContactImpact[],
    restarts: Set<SimulationBody>[],
  ): boolean {
    let changed = false;
    const torque = new Map<NonCarBody, Vector3>();
    const members = new Set<SimulationBody>();
    for (const impact of impacts) {
      if (impact.normalImpulse <= 0 || impact.sourceType === 9) continue;
      for (const [body, other, sign] of [
        [impact.a, impact.b, 1],
        [impact.b, impact.a, -1],
      ] as const) {
        if (!body || !("kind" in body) || body.kind !== "noncar") continue;
        const noncar = body as NonCarBody;
        noncar.collisionFlags |= other ? 2 : 1;
        if (other) {
          notifyNonCarBodyContact(noncar.mechanics, noncar.motor);
          if (noncar.properties.immovable) {
            if (!this.admitPulledNonCar(noncar)) continue;
            this.dormantPoses.delete(noncar);
            noncar.properties.immovable = false;
            changed = true;
            noncar.actor.userData.noncarPulled = true;
          }
        }
        const lever = (
          sign === 1 ? impact.point : (impact.pointB ?? impact.point)
        )
          .clone()
          .sub(noncar.state.position)
          .sub(
            noncar.properties.centerOfMass
              .clone()
              .applyQuaternion(noncar.state.orientation),
          );
        const impulse = impact.normal
          .clone()
          .multiplyScalar(sign * impact.normalImpulse);
        const sum = torque.get(noncar) ?? new Vector3();
        sum.add(lever.cross(impulse));
        torque.set(noncar, sum);
        members.add(noncar);
        if (other && "hulls" in other) members.add(other as SimulationBody);
      }
    }
    for (const [body, sum] of torque) {
      if (
        body.joint &&
        body.mechanics.worldJoint?.kind !== "translation" &&
        nonCarTorqueExceedsThreshold(body.mechanics, sum)
      ) {
        releaseNonCar(body);
        changed = true;
      }
    }
    if (changed) {
      for (const impact of impacts) impact.sourceType = 9;
      restarts.push(members);
    }
    return changed;
  }
  step() {
    this.onBeforeStep?.();
    this.physicsQueryDepth++;
    const previousWorkingSet = this.correctionWorkingSet;
    this.correctionWorkingSet = this.correctionReuse
      ? this.correctionGeometry.createTick(this.correctionDiagnostics)
      : undefined;
    try {
      for (const car of this.cars)
        if (car.human && this.isCarPhysicsActive(car))
          this.lastCrashStepVelocity.set(car, car.state.velocity.clone());
      // Native skid threshold compares against gProgram_state.current_car,
      // rather than driver type. Keep the shared force context tied to this world.
      this.motionContext.currentCar = this.cars.find((car) => car.human)?.state;
      this.elapsed += PHYSICS_STEP;
      this.prepareMovingWorld();
      // Destruction/queued connotations share GetTotalTime's gameplay clock.
      // Physics elapsed can be fractional or ahead of the rendered frame.
      this.destruction?.update(this.smashClock());
      if (!this.collectingOrdinaryCrush)
        this.worldActivations.update(this.smashClock());
      this.mines.process(this.elapsed * 1000, (event) =>
        this.handleMineEvent(event),
      );
      this.world.refreshDynamic?.();
      this.world.setDrivableOwnerOrder?.(this.phil.registeredBodies);
      // Direct diagnostic steps retain an explicit standalone placement adapter.
      // Production and outer-window callers use the post-graphics frame phase.
      if (!this.collectingOrdinaryCrush) this.processOilFrame();
      const previousVelocities = new Map(
        this.cars
          .filter((car) => this.isCarPhysicsActive(car))
          .map((car) => [car, car.state.velocity.clone()]),
      );
      for (const car of this.cars) {
        if (!this.isCarPhysicsActive(car)) continue;
        if (!(car.damage.pendingShapeSwapFlags & 1))
          car.repairAwaitingShapeSwap = false;
        if (
          car.repairing &&
          !car.repairAwaitingShapeSwap &&
          !car.knackered &&
          !car.damage.wasted
        ) {
          const repair = car.damage.repairStep(
            PHYSICS_STEP * 1000,
            this.settings
              ? skillValue(this.settings.repairCost, { skill: this.skill })
              : 10,
          );
          car.smokeLastComponentLevels.set(car.damage.componentLevels);
          this.onStopCarSmoke?.(car);
          car.repairAwaitingShapeSwap =
            repair.bodyworkRepair > 0 &&
            !!(car.damage.pendingShapeSwapFlags & 1);
          this.onRepair?.(
            car,
            repair.cost,
            repair.cost === 0 && repair.bodyworkRepair === 0,
          );
        }
        this.syncStructuralState(car);
        car.state.steeringDamageCurvature = car.damage.steeringDamageCurvature;
        car.state.wheelEnabled = car.damage.splitRuntime?.wheelMask;
        car.state.componentDamage = Array.from(car.damage.componentLevels);
        // Car force preparation refreshes faces BEFORE TestAutoSpecialVolume.
        // Generic PHIL objects retain their existing force-before-collision
        // phase; their last plane changes only when collision collection runs.
        this.facesNearBody(car, car.hulls);
        const environment = this.updateSpecialVolume(car);
        const factors = volumeMotionFactors(
          environment.volume,
          environment.depth,
          car.state.underwaterAbility,
        );
        car.state.volumeGravityFactor = factors.gravity;
        car.state.globalGravityMultiplier = this.gravityMultiplier;
        car.state.settlingVolumeGravity = environment.volume
          ? car.state.underwaterAbility &&
            (car.state.driver ?? (car.human ? 8 : 6)) > 5
            ? 1 - (1 - environment.volume.gravityMultiplier) * 0.6
            : environment.volume.gravityMultiplier
          : undefined;
        car.state.volumeDragFactor = factors.drag;
        const materialIndex =
          environment.volume === environment.automatic && environment.automatic
            ? 10
            : factors.materialModifierIndex;
        car.state.volumeSurface =
          materialIndex !== 0
            ? this.world.modifier?.(materialIndex)
            : undefined;
        if (car.damage.splitRuntime?.disableMotion) {
          // Source car+18c8: XZ-snapped primary skips control and WheelForces;
          // both halves are free bodies. Gravity remains active.
          this.applyFreeBodyForces(car);
          car.state.rpm = 0;
          car.debug = undefined;
        } else {
          if (car.knackered && !car.human)
            car.state.accForce = car.state.brakeForce = 0;
          car.debug = applyVehicleForces(
            car.state,
            {
              throttle:
                car.knackered || !car.human
                  ? 0
                  : Math.max(0, car.input.throttle),
              steer: !car.human ? 0 : car.input.steer,
              brake: !car.human
                ? 0
                : Math.max(
                    Number(car.input.brake),
                    car.knackered ? 0 : -car.input.throttle,
                  ),
              handbrake: car.human && !!car.input.handbrake,
            },
            PHYSICS_STEP,
            car.motion,
            this.oilGround(car),
            this.motionContext,
          );
          this.onWheelMarks?.(car);
        }
      }
      this.debris = this.debris.filter((body) => {
        if (this.attachedToInactiveCar(body)) return true;
        if (body.splitRevision !== undefined) {
          if (body.owner.damage.splitRuntime?.actor !== body.actor) {
            this.phil.remove(body);
            return false;
          }
          this.applyFreeBodyForces(body);
          return true;
        }
        const part = body.owner.damage.runtimeParts[body.part];
        if (part.state.phase === 0) {
          this.phil.remove(body);
          return false;
        }
        if (body.joint) {
          const relative = body.joint.parent.state.orientation
            .clone()
            .invert()
            .multiply(body.state.orientation);
          const outside = jointAllowsSeparation(
            body.joint.planeLimits.map((limit) => ({
              parent: limit.parentNormal.toArray(),
              childInParent: limit.childDirection
                .clone()
                .applyQuaternion(relative)
                .toArray(),
            })),
          );
          if (shouldFullyDetachPart(part.state, this.elapsed * 1000, outside)) {
            part.state.phase = 2;
            body.joint = undefined;
          }
        }
        this.applyFreeBodyForces(body);
        return true;
      });
      for (const body of this.noncars) {
        if (this.disabledWorldActor(body) || this.attachedToInactiveCar(body)) {
          this.noncarQuiet.delete(body);
          continue;
        }
        finalizeNonCarRelease(body);
        const supportedQuiet =
          supportsNativeNonCarQuiet(body).supported &&
          !!body.actor.userData.noncarPulled;
        let quietState = this.noncarQuiet.get(body);
        if (!supportedQuiet && quietState) {
          this.noncarQuiet.delete(body);
          quietState = undefined;
        } else if (supportedQuiet && !quietState) {
          quietState = createNativeNonCarQuiet(body);
          this.noncarQuiet.set(body, quietState);
        }
        if (quietState?.doNothing) {
          prepareNativeNonCarQuiet(body, quietState, new Vector3());
          body.properties.immovable = true;
          body.collisionFlags = 0;
          continue;
        }
        if (body.motor.sleeping && body.motor.pauseUntilMs === 0) continue;
        const environment = this.updateSpecialVolume(body);
        const beforeForces = body.state.velocity.clone();
        applyNonCarMotionForces(body.mechanics, body, body.motor, {
          nowMs: this.elapsed * 1000,
          previousVelocity: body.previousVelocity,
          collisionFlags: body.collisionFlags,
          // Native NonCarCalcForce uses raw volume gravity, without depth or
          // the global pickup multiplier; motor thrust remains independent.
          gravityScale: environment.volume?.gravityMultiplier ?? 1,
        });
        body.properties.immovable = body.motor.sleeping;
        if (quietState)
          prepareNativeNonCarQuiet(
            body,
            quietState,
            body.state.velocity.clone().sub(beforeForces),
          );
        body.collisionFlags = 0;
      }
      for (const body of this.mineBodies)
        if (!(body.mine.flags & MINE_FLAGS.exploded))
          this.applyFreeBodyForces(body);
      this.preparePedPhysics();
      this.preparePedBonePhysics();
      const bodies = this.allBodies();
      prepareJointVelocities(this.allJoints());
      for (const body of this.noncars)
        body.previousVelocity.copy(body.state.velocity);
      for (const body of bodies) {
        body.overlapDetected = false;
        body.worldOverlapDetected = false;
        candidate(body, PHYSICS_STEP);
      }
      const restartGroups: Set<SimulationBody>[] = [];
      const beforeApply = (
        impacts: ContactImpact[],
        jointImpacts: JointConstraintImpact[],
      ) => {
        const accepted = this.processImpactDamage(
          impacts,
          jointImpacts,
          restartGroups,
        );
        if (accepted !== false) this.processPedContactDamage(impacts);
        return accepted;
      };
      const joints = this.allJoints();
      this.lastImpacts = resolveContactGroups(
        this.preparePedContacts(this.collectContacts(bodies)),
        PHYSICS_STEP,
        joints,
        beforeApply,
      );
      // Source split invalidates the old contact solve. Rebuild the changed group
      // immediately, with the original 30-pass guard, before advancing this tick.
      const restartCounts = new Map<SimulationBody, number>();
      const resolveRestarts = () => {
        while (restartGroups.length) {
          const members = restartGroups.shift()!;
          const changed = [...members].filter(
            (body) => "hulls" in body && !this.disabledWorldActor(body),
          );
          if (changed.some((body) => (restartCounts.get(body) ?? 0) >= 30))
            continue;
          for (const body of changed)
            restartCounts.set(body, (restartCounts.get(body) ?? 0) + 1);
          for (const body of changed) candidate(body, PHYSICS_STEP);
          const changedJoints = [...this.debris, ...this.noncars].flatMap(
            (b) => (b.joint && members.has(b) ? [b.joint] : []),
          );
          this.lastImpacts.push(
            ...resolveContactGroups(
              this.preparePedContacts(this.collectContacts(changed)),
              PHYSICS_STEP,
              changedJoints,
              beforeApply,
            ),
          );
        }
      };
      resolveRestarts();
      for (const car of this.cars)
        if (this.isCarPhysicsActive(car)) this.syncStructuralState(car);
      // Recollect after impulses, rather than advancing an unchecked trajectory.
      // The bounded final sweep conservatively stops at the actual triangle;
      // it neither assumes an infinite floor nor changes authored body shapes.
      let guardResults = new Map<
        SimulationBody,
        ReturnType<VehicleSimulation["advanceWorldContacts"]>
      >();
      for (let pass = 0; pass < 8; pass++) {
        if (this.correctionDiagnostics)
          this.correctionDiagnostics.correctionPasses =
            (this.correctionDiagnostics.correctionPasses ?? 0) + 1;
        // Every solve can redirect a pair trajectory, including props which
        // intentionally ignore world faces. Their predicted pose must not be
        // inherited from the pre-impulse solve or an early-returning world guard.
        for (const body of this.allBodies()) candidate(body, PHYSICS_STEP);
        guardResults = new Map(
          this.allBodies().map((body) => [
            body,
            this.advanceWorldContacts(body),
          ]),
        );
        const contacts = [...guardResults.values()].flatMap(
          (guard) => guard.contacts,
        );
        // Impulses may create a body-pair crossing which was absent from the
        // first trajectory. Recollect the same authored hulls, not only roads.
        contacts.push(...this.collectBodyContacts(this.allBodies()));
        if (this.movingWorld.length)
          for (const body of this.allBodies())
            contacts.push(
              ...this.worldContacts(body, body.hulls).filter(
                (contact) =>
                  contact.b &&
                  "kind" in contact.b &&
                  contact.b.kind === "moving-world",
              ),
            );
        if (!contacts.length) break;
        this.lastImpacts.push(
          ...resolveContactGroups(
            this.preparePedContacts(contacts),
            PHYSICS_STEP,
            this.allJoints(),
            beforeApply,
          ),
        );
        resolveRestarts();
        guardResults.clear();
      }
      this.finishNonCarQuietLeaves();
      this.finishPedBoneQuiet();
      this.finishPedQuiet();
      this.finishNonCarQuietRings();
      const committing = this.allBodies();
      const worldFractions = new Map(
        committing.map((body) => [
          body,
          (guardResults.get(body) ?? this.advanceWorldContacts(body, true))
            .fraction,
        ]),
      );
      // Final pair commitment and joint projection own fresh path/coupling
      // certificates. No correction result survives into those phases.
      this.correctionWorkingSet = undefined;
      const paths = new Map<HullBody, PosePath>(
        committing.map((body) => {
          const probe = {
            ...body,
            state: {
              ...body.state,
              position: body.state.position.clone(),
              orientation: body.state.orientation.clone(),
              velocity: body.state.velocity.clone(),
              angularVelocity: body.state.angularVelocity.clone(),
              predictedPosition: new Vector3(),
              predictedOrientation: new Quaternion(),
            },
          };
          const cache = new Map<
            number,
            { position: Vector3; orientation: Quaternion }
          >();
          const path: PosePath = (fraction) => {
            let pose = cache.get(fraction);
            if (!pose) {
              candidate(
                probe,
                PHYSICS_STEP * worldFractions.get(body)! * fraction,
              );
              pose = {
                position: probe.state.predictedPosition.clone(),
                orientation: probe.state.predictedOrientation.clone(),
              };
              cache.set(fraction, pose);
            }
            return pose;
          };
          path.stable = true;
          if (body.properties.immovable) path.constantPose = path(0);
          // Momentum / smallest principal inertia bounds all midpoint angular
          // rates, including full turns hidden by identical endpoint quaternions.
          const inertia = body.properties.inertia;
          path.angularTravel =
            body.properties.immovable || body.properties.rotationLocked
              ? 0
              : (body.state.angularVelocity
                  .clone()
                  .applyQuaternion(body.state.orientation.clone().invert())
                  .multiply(inertia)
                  .length() /
                  Math.min(inertia.x, inertia.y, inertia.z)) *
                PHYSICS_STEP *
                worldFractions.get(body)!;
          return [body, path];
        }),
      );
      const pairDiagnostics = this.bodyPairDiagnostics
        ? ({} as BodyGuardDiagnostics)
        : undefined;
      const pairFractions = this.bodyTrajectoryGuard.run(
        committing,
        paths,
        nativePairAllowed,
        pairDiagnostics,
      );
      if (pairDiagnostics) this.bodyPairDiagnostics!("commit", pairDiagnostics);
      for (const body of committing) {
        if (!body.properties.immovable)
          advance(
            body,
            PHYSICS_STEP * worldFractions.get(body)! * pairFractions.get(body)!,
          );
        body.overlapRecovery = body.overlapDetected;
        body.worldRecovery = body.worldOverlapDetected;
      }
      const joined = [...this.debris, ...this.noncars].filter(
        (body) => body.joint && !body.properties.immovable,
      );
      const beforeProjection = joined.map((body) => ({
        body,
        position: body.state.position.clone(),
        orientation: body.state.orientation.clone(),
      }));
      projectJointPositions(joined.map((body) => body.joint!));
      // Anchor/hinge projection is a second transform mutation after integration.
      // A constrained part must not teleport through a track face to satisfy it.
      for (const { body, position, orientation } of beforeProjection) {
        const projectedPosition = body.state.position.clone();
        const projectedOrientation = body.state.orientation.clone();
        if (
          position.distanceToSquared(projectedPosition) < 1e-14 &&
          orientation.angleTo(projectedOrientation) < 1e-7
        )
          continue;
        const samples = Math.min(
          128,
          Math.max(
            1,
            Math.ceil(orientation.angleTo(projectedOrientation) / 0.05),
          ),
        );
        const pose = (fraction: number) => ({
          position: position.clone().lerp(projectedPosition, fraction),
          orientation: orientation
            .clone()
            .slerp(projectedOrientation, fraction),
        });
        const guard = this.sweepWorldTrajectory(
          body,
          samples,
          pose,
          position,
          orientation,
        );
        if (guard.fraction < 1) {
          const accepted = pose(guard.fraction);
          body.state.position.copy(accepted.position);
          body.state.orientation.copy(accepted.orientation);
          body.worldRecovery = true;
        }
      }
      // Joint projection can otherwise put an already-safe flap/roof through
      // another car. Verify this second trajectory as well, without impulses.
      if (beforeProjection.length) {
        const projected = new Map(
          beforeProjection.map((entry) => [entry.body, entry]),
        );
        const projectionPaths = new Map<HullBody, PosePath>(
          this.allBodies().map((body) => {
            const before = projected.get(body as (typeof joined)[number]);
            const position = body.state.position.clone(),
              orientation = body.state.orientation.clone();
            const path: PosePath = (fraction) =>
              before
                ? {
                    position: before.position.clone().lerp(position, fraction),
                    orientation: before.orientation
                      .clone()
                      .slerp(orientation, fraction),
                  }
                : { position, orientation };
            path.stable = true;
            if (!before) path.constantPose = { position, orientation };
            return [body, path];
          }),
        );
        const projectionDiagnostics = this.bodyPairDiagnostics
          ? ({} as BodyGuardDiagnostics)
          : undefined;
        const fractions = this.bodyTrajectoryGuard.run(
          this.allBodies(),
          projectionPaths,
          nativePairAllowed,
          projectionDiagnostics,
        );
        if (projectionDiagnostics)
          this.bodyPairDiagnostics!("projection", projectionDiagnostics);
        for (const { body } of beforeProjection) {
          const fraction = fractions.get(body)!;
          if (fraction < 1) {
            const pose = projectionPaths.get(body)!(fraction);
            body.state.position.copy(pose.position);
            body.state.orientation.copy(pose.orientation);
          }
        }
      }
      for (const car of this.cars) {
        if (!this.isCarPhysicsActive(car)) continue;
        const forward = new Vector3(0, 0, -1).applyQuaternion(
          car.state.orientation,
        );
        car.state.speed = car.state.velocity.dot(forward);
        car.state.heading = Math.atan2(-forward.x, -forward.z);
        car.state.health = 100 - Math.max(...car.damage.componentLevels);
        if (
          (car.knackered ||
            (car.damage.wasted && !this.deferredCrashWastage.has(car))) &&
          car.wastedAt === undefined
        ) {
          this.finishWastage(car);
        }
        this.sync(car);
        if (!this.collectingOrdinaryCrush)
          car.damage.stepFlaps(
            car.state.velocity
              .clone()
              .sub(previousVelocities.get(car)!)
              .multiplyScalar(1 / PHYSICS_STEP)
              .add(new Vector3(0, this.flapGravity, 0))
              .applyQuaternion(car.state.orientation.clone().invert()),
          );
        if (!this.collectingOrdinaryCrush) this.detachParts(car);
        if (car.human)
          car.recoveryHistory.remember(PHYSICS_STEP * 1000, car.state, {
            wheelLengths: car.state.wheelLengths,
            suspensionLengths: car.motion.suspensionLength,
            roadFrictions: car.debug?.wheelRoadFrictions ?? [],
            dynamicSupport: car.debug?.dynamicWheelSupport,
            volumeGravity: car.specialVolume?.volume?.gravityMultiplier,
            split: car.damage.snapped,
            disabled: car.knackered,
          });
      }
      for (const body of this.debris) {
        body.actor.position.copy(body.state.position);
        body.actor.quaternion.copy(body.state.orientation);
      }
      for (const body of this.mineBodies)
        if (!(body.mine.flags & MINE_FLAGS.exploded)) this.syncActor(body);
      for (const body of this.pedBoneBodies) this.syncActor(body);
      for (const body of this.noncars) {
        if (
          body.attached &&
          body.mechanics.worldJoint?.kind !== "translation" &&
          nonCarBendExceedsThreshold(body.mechanics, body)
        )
          releaseNonCar(body);
        if (body.mechanics.tumble)
          applyNonCarTumble(
            body,
            body.mechanics.tumble,
            hullsBounds(body.hulls).getSize(new Vector3()),
            this.lastImpacts.find((i) => i.a === body || i.b === body)
              ?.normal ?? Y,
            body.collisionFlags !== 0,
            body.motor.sleeping,
          );
        this.syncActor(body);
      }
      this.world.refreshDynamic?.();
      for (const body of this.movingWorld) commitMovingWorldPose(body);
      // PHILDoPhysics consumes the current debt, then subtracts40. Its final
      // outer-frame exit restores1; direct standalone steps have that same exit.
      this.mechanicsTimeSync = this.collectingOrdinaryCrush
        ? this.mechanicsTimeSync - PHYSICS_STEP * 1000
        : 1;
      if (!this.collectingOrdinaryCrush)
        this.finishPedFrame(PHYSICS_STEP * 1000);
    } finally {
      this.correctionWorkingSet = previousWorkingSet;
      this.physicsQueryDepth--;
    }
  }
  private detachParts(car: SimulatedCar) {
    for (let index = 0; index < car.damage.runtimeParts.length; index++) {
      const part = car.damage.runtimeParts[index];
      if (
        part.state.queuedAt === null ||
        this.elapsed * 1000 < part.state.queuedAt ||
        part.state.phase !== 0
      )
        continue;
      // Source436a20 consumes due entries even when436cb0/4332a0 refuses
      // invulnerable owners. Existing jointed bits still simulate/release.
      if (car.damage.damageContext.invulnerable) {
        cancelScheduledDetachment(this.detachmentScheduling, part.state);
        continue;
      }
      if (this.debris.filter((b) => b.owner === car).length >= 24) continue;
      if (
        !part.forcedFullDetach &&
        part.state.type !== 2 &&
        (this.debris.filter((b) => b.owner === car && b.joint).length >= 3 ||
          this.debris.filter((b) => b.joint).length >= 32)
      )
        continue;
      const actor = part.actor;
      // Parts queued before a split may still be attached to the secondary
      // actor when their queue slot becomes due. Use that physical parent for
      // velocity, COM and joint inheritance; owner remains repair history.
      const parent =
        this.debris.find(
          (body) =>
            body.part < 0 &&
            body.owner === car &&
            (() => {
              let node: Object3D | null = actor;
              while (node) {
                if (node === body.actor) return true;
                node = node.parent;
              }
              return false;
            })(),
        ) ?? car;
      actor.updateWorldMatrix(true, true);
      const position = new Vector3(),
        orientation = new Quaternion(),
        scale = new Vector3();
      actor.matrixWorld.decompose(position, orientation, scale);
      const bounds = part.bounds.clone();
      const size = bounds.getSize(new Vector3()).multiply(scale);
      const carBounds = hullsBounds(parent.hulls);
      const mass = part.mass;
      const com = detachedChildCenterOfMass(
        bounds.min,
        bounds.max,
        { position, orientation },
        carBounds.min,
        carBounds.max,
        parent.state,
      ).centerOfMass;
      const worldCenter = com
        .clone()
        .applyQuaternion(orientation)
        .add(position);
      const parentCenter = parent.properties.centerOfMass
        .clone()
        .applyQuaternion(parent.state.orientation)
        .add(parent.state.position);
      const velocity = new Vector3(
        ...inheritedDetachedVelocity(
          parent.state.velocity.toArray(),
          parent.state.angularVelocity.toArray(),
          parentCenter.toArray(),
          worldCenter.toArray(),
        ),
      );
      if (part.forcedFullDetach) {
        velocity.add(car.state.velocity);
        if (part.detachmentVelocityKick)
          velocity.add(
            part.detachmentVelocityKick
              .clone()
              .applyQuaternion(car.state.orientation),
          );
      }
      if (!beginPartDetachment(part.state, this.elapsed * 1000)) continue;
      if (part.forcedFullDetach) part.state.phase = 2;
      this.scene.attach(actor);
      const body: DetachedBody = {
        actor,
        owner: car,
        part: index,
        overlapRecovery: true,
        overlapDetected: false,
        worldRecovery: true,
        worldOverlapDetected: false,
        state: {
          position,
          orientation,
          velocity,
          angularVelocity: parent.state.angularVelocity.clone(),
        },
        properties: {
          mass,
          inertia: new Vector3(...detachedBoxInertia(mass, size.toArray())),
          centerOfMass: com,
          worldFriction: 0,
          objectFriction: 0.4,
        },
        hulls: [buildBoxHull(bounds.min, bounds.max)],
      };
      if (part.part.shape === "poly" && part.part.shapePoints.length >= 4) {
        const points = part.part.shapePoints.map((i) =>
          car.damage.getPartVertices(part)[i]?.clone(),
        );
        if (points.every((p): p is Vector3 => !!p))
          body.hulls = [buildHull(points)];
      }
      if (part.state.type !== 2 && !part.forcedFullDetach) {
        body.joint =
          part.part.type === "flap"
            ? createSdbHingeJoint(
                body,
                parent,
                part.flapHinges.map((i) => car.damage.getPartVertices(part)[i]),
                ((part.flap?.maxAngleUnits ?? 0x3ffc) * Math.PI * 2) / 65536,
              )
            : createOrdinaryDetachJoint(body, parent, part.originalVertices, {
                vertexIndex: part.detachmentVertex,
                cornerBits: part.detachmentDirection,
                side: part.detachmentSide,
              });
      }
      this.debris.push(body);
      if (this.phil.addActiveImmediate(body) !== 0)
        throw new Error(
          "No native PHIL header available for detached car root",
        );
    }
  }
  dispose() {
    this.bodyBroadphase = new BodyBroadphase();
    this.correctionGeometry = new CorrectionWorkingSet();
    this.dormantCorrectionGeometry = new CorrectionWorkingSet();
    this.stationaryCorrectionBounds = new StationaryBoundsCache();
    this.dormantCorrectionPoses = new WeakMap();
    this.bodyTrajectoryGuard.clear();
    this.bodyPairDiagnostics = undefined;
    this.smashPowerupQueue.initialize();
    this.worldActivations.dispose();
    this.ordinaryCrushQueue.initialize();
    this.spamCrushQueue.initialize();
    this.smashQueue.initialize();
    for (const car of this.cars) {
      car.damage.deferOrdinaryCrush = undefined;
      car.damage.cancelQueuedSpam = undefined;
      car.damage.readSmashStartingVelocity = undefined;
      car.damage.configureWamSmashQueue();
    }
    this.oil?.dispose();
    this.destruction?.dispose();
    this.mines.clear();
    for (const body of this.mineBodies) body.actor.removeFromParent();
    this.mineBodies = [];
    for (const body of [...this.pedBodies]) this.removePedBody(body);
    for (const body of [...this.pedBoneBodies]) this.removePedBoneBody(body);
    // Reunite private split geometries before the content loader disposes the
    // scene. Otherwise pristine and secondary meshes become unreachable.
    for (const car of this.cars) car.damage.repair();
    for (const body of this.debris) {
      if (body.part < 0) {
        body.actor.removeFromParent();
        continue;
      }
      const part = body.owner.damage.runtimeParts[body.part];
      part.originalParent.add(body.actor);
      body.actor.matrix.copy(part.originalTransform);
      body.actor.matrix.decompose(
        body.actor.position,
        body.actor.quaternion,
        body.actor.scale,
      );
    }
    this.debris = [];
    for (const body of this.noncars) this.world.removeDynamic(body);
    this.noncars = [];
    this.noncarQuiet.clear();
    for (const body of this.movingWorld) this.world.removeDynamic(body);
    this.movingWorld = [];
    this.cars = [];
    for (const body of this.phil.registeredBodies) this.phil.remove(body);
    this.inactiveCars = new WeakSet();
  }
}
