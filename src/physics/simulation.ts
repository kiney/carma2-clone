import { CameraContactFrame } from "../camera/contact-frame";
import { applyWorldPinball } from "./pinball";
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
import type { WorldGrooveRuntime } from "../world-groove";
import { WorldActivationRuntime } from "../world-activation";
import {
  prepareMovingWorldPose,
  commitMovingWorldPose,
  sweepHullMovingTriangle,
  type MovingWorldBody,
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
import type { WorldCollision, Surface } from "../world";
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
  guardBodyTrajectories,
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
}
export interface SimulatedCar extends RigidBody {
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
export type SimulationBody =
  | SimulatedCar
  | DetachedBody
  | NonCarBody
  | MineBody<SimulatedCar>;
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
/** Fixed-tick orchestration. Low-level collision equations live in contact.ts;
 * authored mechanics, source tyre forces and permanent shape crush stay distinct.
 * Remaining special-volume and custom sphere/wire paths are
 * explicitly tracked in docs/c2-physics-re.md rather than hidden as tuning.
 */
export class VehicleSimulation {
  cars: SimulatedCar[] = [];
  debris: DetachedBody[] = [];
  noncars: NonCarBody[] = [];
  movingWorld: MovingWorldBody[] = [];
  grooves?: WorldGrooveRuntime;
  readonly mines = new MineRuntime<SimulatedCar>({
    random: sharedNativeRandom.random,
  });
  mineBodies: MineBody<SimulatedCar>[] = [];
  mineFactory?: { actor: Object3D; bounds: Box3; mass: number };
  onMineEvent?: (event: MineEvent<SimulatedCar>) => void;
  accumulator = 0;
  elapsed = 0;
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
  onOpponentRepulsed?: (source: SimulatedCar, target: SimulatedCar) => void;
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
  onWasted?: (car: SimulatedCar) => void;
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
  private dormantPoses = new WeakMap<
    NonCarBody,
    { old: CollisionHull[]; next: CollisionHull[]; bounds: Box3 }
  >();
  constructor(
    public world: WorldCollision,
    public scene: Object3D,
  ) {}
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
      if (car.damage.wasted) car.knackered = true;
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
      this.inactiveCars.delete(car);
      return;
    }
    this.inactiveCars.add(car);
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
    this.lastImpacts = this.lastImpacts.filter(
      (impact) => impact.a !== car && impact.b !== car,
    );
    this.cameraContacts.bodies.delete(car);
  }
  addNonCar(body: NonCarBody) {
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
  addMovingWorld(body: MovingWorldBody) {
    this.movingWorld.push(body);
    this.world.addDynamic(body, body.actor, true, true);
  }
  private prepareMovingWorld() {
    this.grooves?.update(this.elapsed * 1000);
    for (const body of this.movingWorld) {
      body.actor.updateWorldMatrix(true, true);
      const position = new Vector3(),
        orientation = new Quaternion();
      body.actor.matrixWorld.decompose(position, orientation, new Vector3());
      prepareMovingWorldPose(body, position, orientation, PHYSICS_STEP);
    }
  }
  private movingSurfaceContact(
    body: RigidBody,
    hull: CollisionHull,
    surface: Surface,
  ): HullContact | null {
    const owner = surface.owner as MovingWorldBody;
    const inverse = owner.state.predictedOrientation.clone().invert();
    const local = (point: Vector3) =>
      point.clone().sub(owner.state.predictedPosition).applyQuaternion(inverse);
    return sweepHullMovingTriangle(body, hull, {
      a: local(surface.a),
      b: local(surface.b),
      c: local(surface.c),
      owner,
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
  private syncActor(body: { actor: Object3D; state: RigidBody["state"] }) {
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
    body.actor.updateMatrixWorld(true);
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
    // ProcessOilSpills places it on the next tick; it has no owner cooldown.
    const spill = this.oil.queueSpill(car, this.elapsed * 1000);
    if (!spill) return false;
    this.scene.add(spill.mesh);
    return true;
  }
  private projectOil(
    position: Vector3,
    fullSize: number,
    actor: RigidBody | null,
  ) {
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
      raycast: this.world.raycast.bind(this.world),
      wheelRaycast: this.world.wheelRaycast?.bind(this.world),
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
        const result = this.destruction.handleContact({
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
          timeMs: this.elapsed * 1000,
        });
        this.flushSmashEffectsBarrier();
        if (result.changes.some((change) => change.requiresRebuild)) {
          this.world.rebuildStatic();
          this.world.invalidateDynamic();
          this.onWorldGeometryChanged?.();
        }
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
        const factors = this.oil.wheelFactors(car, points);
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
  /** Installed callback414930 updates the plane from the finite candidate
   * faces. No face sets the sentinel, but intentionally retains full-depth
   * automatic water; MungeSpecialVolume4ff1a0 clears partial-depth exits. */
  private updateSpecialVolume(body: SimulationBody): BodyVolumeState {
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
    const localBounds = hullsBounds(body.hulls);
    const worldBounds = hullsBounds(
      transformHulls(body, body.hulls),
    ).expandByScalar(0.005);
    const plane = detectWaterPlane(
      this.world.querySurfaces(worldBounds.min, worldBounds.max, true),
    );
    state.waterDistance = plane?.distance ?? NO_WATER_DISTANCE;
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
  /** Full powerup repair439460 also resets suspension, including an unbent
   * car. Restore partition properties before recalculating axle loads. */
  repair(car: SimulatedCar) {
    car.damage.repair();
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
    this.collectingOrdinaryCrush = true;
    try {
      while (this.accumulator >= PHYSICS_STEP) {
        this.step();
        this.accumulator -= PHYSICS_STEP;
      }
    } finally {
      this.collectingOrdinaryCrush = false;
    }
    this.flushOrdinaryCrush();
    this.finishCrashFrame();
    this.flushSmashEffects();
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
    if (!this.deferFinalSmashFlush) this.flushSmashEffects();
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
  /** Native argument-one barriers retain configured queue ownership. */
  private flushSmashEffectsBarrier(mode: 0 | 1 = 1): number {
    const revision = this.destruction?.geometryRevision;
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
    if (revision !== this.destruction?.geometryRevision) {
      this.world.rebuildStatic();
      this.world.invalidateDynamic();
      this.onWorldGeometryChanged?.();
    }
    return count;
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
    for (let i = 0; i < old.length; i++) {
      const bounds = hullBounds(old[i])
        .union(hullBounds(next[i]))
        .expandByScalar(0.005);
      const nearby = this.world.querySurfaces(bounds.min, bounds.max);
      for (const surface of nearby)
        if (!surfaces.includes(surface)) surfaces.push(surface);
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
      ("kind" in body &&
        body.kind === "noncar" &&
        body.mechanics.ignoreWorldCollisions)
    )
      return { fraction: 1, contacts: [] as Contact[] };
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
        const nearby = this.world
          .querySurfaces(bounds.min, bounds.max)
          .filter((surface) => !surface.owner);
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
        this.recoverySurfaces(this.world.querySurfaces(bounds.min, bounds.max)),
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
    const poses = new Map(
      bodies.map((body) => {
        if (
          "kind" in body &&
          body.kind === "noncar" &&
          body.properties.immovable
        ) {
          const cached = this.dormantPoses.get(body);
          if (cached) return [body, cached] as const;
        }
        const old = transformHulls(body, body.hulls),
          next = transformHulls(body, body.hulls, true);
        const bounds = hullsBounds(old).union(hullsBounds(next));
        const result = { old, next, bounds };
        if (
          "kind" in body &&
          body.kind === "noncar" &&
          body.properties.immovable
        )
          this.dormantPoses.set(body, result);
        return [body, result] as const;
      }),
    );
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i],
          b = bodies[j];
        if (a.properties.immovable && b.properties.immovable) continue;
        const pa = poses.get(a)!,
          pb = poses.get(b)!;
        if (!pa.bounds.intersectsBox(pb.bounds)) continue;
        if (
          ("owner" in a && a.joint?.parent === b) ||
          ("owner" in b && b.joint?.parent === a)
        )
          continue;
        const oldA = pa.old,
          oldB = pb.old,
          nextA = pa.next,
          nextB = pb.next;
        for (let ai = 0; ai < oldA.length; ai++)
          for (let bi = 0; bi < oldB.length; bi++) {
            if (
              !hullBounds(oldA[ai])
                .union(hullBounds(nextA[ai]))
                .intersectsBox(
                  hullBounds(oldB[bi]).union(hullBounds(nextB[bi])),
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
                a.overlapDetected = true;
                b.overlapDetected = true;
              },
            });
            if (hit)
              hit.points.forEach((point, index) =>
                contacts.push({
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
          timeMs: this.elapsed * 1000,
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
        const rebuild = result.changes.some((change) => change.requiresRebuild);
        if (rebuild) {
          this.world.rebuildStatic();
          this.world.invalidateDynamic();
          this.onWorldGeometryChanged?.();
        }
        const capped =
          result.threshold !== undefined &&
          result.threshold < impact.normalImpulse;
        if (!rebuild && !capped) continue;
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
    };
    const pairs: Pair[] = [];
    for (const nativeGroup of groupNativeImpactRows(impacts)) {
      if (nativeGroup.totalLambda <= NATIVE_IMPACT_MINIMUM_LAMBDA) continue;
      const pair: Pair = {
        a: nativeGroup.a,
        b: nativeGroup.b,
        receivers: [],
      };
      pairs.push(pair);
      for (const impact of nativeGroup.rows) {
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
            hitDetachedPart: !!other && "owner" in other,
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
    if ("damage" in body) return (body as SimulatedCar).human ? 8 : 6;
    if ("owner" in body) {
      const part = body as DetachedBody;
      return part.joint ? 1 : part.part === -1 ? 3 : 2;
    }
    if ("kind" in body && body.kind === "noncar") return 4;
    // Mines have a separate explicit ownership path; do not reinterpret them.
    return undefined;
  }
  private crashOwner(body: RigidBody): RigidBody | undefined {
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
          target.knackered = true;
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
  private finishWastage(car: SimulatedCar): void {
    if (car.wastedAt !== undefined) return;
    car.wastedAt = this.elapsed;
    car.knackered = true;
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
    for (const car of this.cars)
      if (car.human && this.isCarPhysicsActive(car))
        this.lastCrashStepVelocity.set(car, car.state.velocity.clone());
    // Native skid threshold compares against gProgram_state.current_car,
    // rather than driver type. Keep the shared force context tied to this world.
    this.motionContext.currentCar = this.cars.find((car) => car.human)?.state;
    this.elapsed += PHYSICS_STEP;
    this.prepareMovingWorld();
    this.destruction?.update(this.elapsed * 1000);
    if (!this.collectingOrdinaryCrush)
      this.worldActivations.update(this.smashClock());
    this.mines.process(this.elapsed * 1000, (event) =>
      this.handleMineEvent(event),
    );
    this.world.refreshDynamic?.();
    this.oil?.update(this.elapsed * 1000, this.projectOil.bind(this));
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
        car.repairAwaitingShapeSwap =
          repair.bodyworkRepair > 0 && !!(car.damage.pendingShapeSwapFlags & 1);
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
        materialIndex !== 0 ? this.world.modifier?.(materialIndex) : undefined;
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
              car.knackered || !car.human ? 0 : Math.max(0, car.input.throttle),
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
      }
    }
    this.debris = this.debris.filter((body) => {
      if (this.attachedToInactiveCar(body)) return true;
      if (body.splitRevision !== undefined) {
        if (body.owner.damage.splitRuntime?.actor !== body.actor) return false;
        this.applyFreeBodyForces(body);
        return true;
      }
      const part = body.owner.damage.runtimeParts[body.part];
      if (part.state.phase === 0) return false;
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
      if (this.disabledWorldActor(body) || this.attachedToInactiveCar(body))
        continue;
      finalizeNonCarRelease(body);
      if (body.motor.sleeping && body.motor.pauseUntilMs === 0) continue;
      const environment = this.updateSpecialVolume(body);
      applyNonCarMotionForces(body.mechanics, body, body.motor, {
        nowMs: this.elapsed * 1000,
        previousVelocity: body.previousVelocity,
        collisionFlags: body.collisionFlags,
        // Native NonCarCalcForce uses raw volume gravity, without depth or
        // the global pickup multiplier; motor thrust remains independent.
        gravityScale: environment.volume?.gravityMultiplier ?? 1,
      });
      body.properties.immovable = body.motor.sleeping;
      body.collisionFlags = 0;
    }
    for (const body of this.mineBodies)
      if (!(body.mine.flags & MINE_FLAGS.exploded))
        this.applyFreeBodyForces(body);
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
    ) => this.processImpactDamage(impacts, jointImpacts, restartGroups);
    const joints = this.allJoints();
    this.lastImpacts = resolveContactGroups(
      this.collectContacts(bodies),
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
        const changedJoints = [...this.debris, ...this.noncars].flatMap((b) =>
          b.joint && members.has(b) ? [b.joint] : [],
        );
        this.lastImpacts.push(
          ...resolveContactGroups(
            this.collectContacts(changed),
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
      // Every solve can redirect a pair trajectory, including props which
      // intentionally ignore world faces. Their predicted pose must not be
      // inherited from the pre-impulse solve or an early-returning world guard.
      for (const body of this.allBodies()) candidate(body, PHYSICS_STEP);
      guardResults = new Map(
        this.allBodies().map((body) => [body, this.advanceWorldContacts(body)]),
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
          contacts,
          PHYSICS_STEP,
          this.allJoints(),
          beforeApply,
        ),
      );
      resolveRestarts();
      guardResults.clear();
    }
    const committing = this.allBodies();
    const worldFractions = new Map(
      committing.map((body) => [
        body,
        (guardResults.get(body) ?? this.advanceWorldContacts(body, true))
          .fraction,
      ]),
    );
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
    const pairFractions = guardBodyTrajectories(committing, paths);
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
        orientation: orientation.clone().slerp(projectedOrientation, fraction),
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
          return [
            body,
            (fraction) =>
              before
                ? {
                    position: before.position.clone().lerp(position, fraction),
                    orientation: before.orientation
                      .clone()
                      .slerp(orientation, fraction),
                  }
                : { position, orientation },
          ];
        }),
      );
      const fractions = guardBodyTrajectories(
        this.allBodies(),
        projectionPaths,
      );
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
          this.lastImpacts.find((i) => i.a === body || i.b === body)?.normal ??
            Y,
          body.collisionFlags !== 0,
          body.motor.sleeping,
        );
      this.syncActor(body);
    }
    this.world.refreshDynamic?.();
    for (const body of this.movingWorld) commitMovingWorldPose(body);
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
    }
  }
  dispose() {
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
    for (const body of this.movingWorld) this.world.removeDynamic(body);
    this.movingWorld = [];
    this.cars = [];
    this.inactiveCars = new WeakSet();
  }
}
