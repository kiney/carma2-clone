import { Box3, Group, Object3D, Quaternion, Vector3 } from "three";
import {
  parseCarMechanics,
  type CarMechanics,
  type MechanicsShape,
} from "../mechanics";
import type { DamageSystem } from "../damage";
import type { VehicleState, VehicleInput } from "../gameplay";
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
} from "./contact";
import {
  buildHull,
  sweepHulls,
  hullBounds,
  hullsBounds,
  reduceWorldContacts,
  finalizeWorldContacts,
  recoverWorldContacts,
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
  projectJointPositions,
  prepareJointVelocities,
  type RigidJoint,
} from "./joint";
import { advanceRigidBody } from "./integrate";
import { scaleImpactVectors } from "./impact";
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
  suspensionBendActive: boolean;
  splitRevision: number;
  wastedAt?: number;
  /** Source car+1d4: wasting persists through model/component repair. */
  knackered: boolean;
  repairing: boolean;
  repairAwaitingShapeSwap: boolean;
  lastAttributedImpactMs: number;
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
  Object.assign(state, { heading, speed: 0, health: 100 });
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
    suspensionBendActive: false,
    splitRevision: 0,
    repairing: false,
    repairAwaitingShapeSwap: false,
    knackered: false,
    lastAttributedImpactMs: 0,
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
  return car;
}
function candidate(body: RigidBody, dt: number) {
  advanceRigidBody(body, dt, true);
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
  accumulator = 0;
  elapsed = 0;
  lastImpacts: ContactImpact[] = [];
  onRepair?: (car: SimulatedCar, cost: number, finished?: boolean) => void;
  onImpact?: (car: SimulatedCar, impact: number) => void;
  onWasted?: (car: SimulatedCar) => void;
  settings?: UpgradeSettings;
  skill: 0 | 1 | 2 = 0;
  minSplitForcePerTonne = 2.5; // GENERAL gMin_force_to_split_XZ_per_tonne.
  /** Native BSS state survives car/race loads and advances once per force call. */
  readonly motionContext = sharedMotionContext;
  private detachmentScheduling = createDetachmentSchedulingContext();
  private contactSurfaces = new Map<RigidBody, Surface[]>();
  constructor(
    public world: WorldCollision,
    public scene: Object3D,
  ) {}
  add(car: SimulatedCar) {
    car.damage.configureDetachmentScheduling(this.detachmentScheduling);
    this.cars.push(car);
    this.sync(car);
  }
  sync(car: SimulatedCar) {
    car.group.position.copy(car.state.position);
    car.group.quaternion.copy(car.state.orientation);
    car.group.updateMatrixWorld(true);
  }
  reset(car: SimulatedCar) {
    car.overlapRecovery = true;
    car.worldRecovery = true;
    car.state.orientation.setFromAxisAngle(Y, car.state.heading);
    car.state.angularVelocity.set(0, 0, 0);
    car.state.curvature = car.state.turnSpeed = 0;
    this.sync(car);
  }
  /** Full powerup repair439460 also resets suspension, including an unbent
   * car. Restore partition properties before recalculating axle loads. */
  repair(car: SimulatedCar) {
    car.damage.repair();
    this.syncStructuralState(car);
    resetMotionSuspension(car.motion);
  }
  update(dt: number) {
    this.accumulator = Math.min(
      this.accumulator + Math.max(0, dt),
      PHYSICS_STEP * 5,
    );
    while (this.accumulator >= PHYSICS_STEP) {
      this.step();
      this.accumulator -= PHYSICS_STEP;
    }
  }
  private recoverySurfaces(surfaces: readonly Surface[]) {
    return surfaces.map((surface) => ({
      ...surface,
      materialIdentifier: surface.material,
      faceFriction: surface.modifier.wallFriction,
    }));
  }
  private worldContacts(body: RigidBody, hulls: CollisionHull[]): Contact[] {
    const carBody = body as SimulatedCar | DetachedBody;
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
      const recovery = carBody.worldRecovery
        ? recoverWorldContacts(
            old[i],
            next[i],
            this.recoverySurfaces(nearby),
            center,
          )
        : undefined;
      carBody.worldOverlapDetected ||= !!recovery?.overlapDetected;
      const candidates: HullContact[] = [...(recovery?.contacts ?? [])];
      for (const surface of nearby) {
        const hit = sweepHullTriangle(
          old[i],
          next[i],
          surface.a,
          surface.b,
          surface.c,
          {
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
      point: hit.points[0],
      pointB: hit.pointsB?.[0],
      normal: hit.normal,
      sourceType: hit.contactTypes?.[0],
      penetration: hit.penetration,
      faceFriction: hit.faceFriction ?? 1,
    }));
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
    for (const other of [...this.cars, ...this.debris]) {
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
  private trySplit(
    impacts: ContactImpact[],
    restarts: Set<SimulatedCar | DetachedBody>[],
  ): { occurred: boolean; restart: boolean } {
    let restarting = false;
    let occurred = false;
    const members = new Set<SimulatedCar | DetachedBody>();
    for (const impact of impacts) {
      members.add(impact.a as SimulatedCar | DetachedBody);
      if (impact.b) members.add(impact.b as SimulatedCar | DetachedBody);
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
        const oldCenter = body.properties.centerOfMass.clone(),
          oldVelocity = body.state.velocity.clone();
        const result = body.damage.splitAtPlane(plane, body.human);
        if (!result) continue;
        occurred = true;
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
        members.add(child);
        this.syncStructuralState(body);
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
        if (
          child.joint &&
          members.has(child.joint.parent as SimulatedCar | DetachedBody)
        )
          members.add(child);
      restarts.push(members);
    }
    return { occurred, restart: restarting };
  }
  private collectContacts(
    bodies: Array<SimulatedCar | DetachedBody>,
  ): Contact[] {
    const contacts: Contact[] = [];
    for (const body of bodies)
      contacts.push(...this.worldContacts(body, body.hulls));
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i],
          b = bodies[j];
        if (
          ("owner" in a && a.joint?.parent === b) ||
          ("owner" in b && b.joint?.parent === a)
        )
          continue;
        const oldA = transformHulls(a, a.hulls),
          oldB = transformHulls(b, b.hulls);
        const nextA = transformHulls(a, a.hulls, true),
          nextB = transformHulls(b, b.hulls, true);
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
            const attachmentRoot = (
              body: SimulatedCar | DetachedBody,
            ): RigidBody =>
              "owner" in body && body.joint ? body.joint.parent : body;
            const hit = sweepHulls(oldA[ai], nextA[ai], oldB[bi], nextB[bi], {
              ...(a.overlapRecovery || b.overlapRecovery
                ? {
                    recovery: {
                      a,
                      b,
                      sameAttachmentGroup:
                        attachmentRoot(a) === attachmentRoot(b),
                      boundsCenterA: hullsBounds(oldA).getCenter(new Vector3()),
                      boundsCenterB: hullsBounds(oldB).getCenter(new Vector3()),
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
    restarts: Set<SimulatedCar | DetachedBody>[],
  ): boolean | void {
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
      const members = new Set<SimulatedCar | DetachedBody>();
      for (const impact of impacts) {
        members.add(impact.a as SimulatedCar | DetachedBody);
        if (impact.b) members.add(impact.b as SimulatedCar | DetachedBody);
        impact.sourceType = 9;
        impact.normalImpulse = 0;
      }
      for (const impact of jointImpacts) {
        members.add(impact.a as SimulatedCar | DetachedBody);
        members.add(impact.b as SimulatedCar | DetachedBody);
        impact.sourceType = 9;
        impact.normalImpulse = impact === row ? threshold : 0;
      }
      part.state.phase = 2;
      child.joint = undefined;
      child.overlapRecovery = child.worldRecovery = true;
      restarts.push(members);
      return false;
    }
    const groups = new Map<
      SimulatedCar,
      Map<
        RigidBody | undefined,
        {
          contacts: Vector3[];
          impulse: Vector3;
          severity: number;
          mean: Vector3;
          weight: number;
        }
      >
    >();
    for (const impact of impacts) {
      if (
        impact.sourceType === 9 ||
        impact.closingSpeed <= 0.01 ||
        impact.normalImpulse <= 0
      )
        continue;
      for (const [body, other, sign] of [
        [impact.a, impact.b, 1],
        [impact.b, impact.a, -1],
      ] as const) {
        if (!body || !("damage" in body)) continue;
        const car = body as SimulatedCar;
        let byOther = groups.get(car);
        if (!byOther) groups.set(car, (byOther = new Map()));
        let group = byOther.get(other);
        if (!group)
          byOther.set(
            other,
            (group = {
              contacts: [],
              impulse: new Vector3(),
              severity: 0,
              mean: new Vector3(),
              weight: 0,
            }),
          );
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
        group.mean.addScaledVector(point, impact.normalImpulse);
        group.weight += impact.normalImpulse;
        group.impulse.addScaledVector(
          impact.normal,
          impact.normalImpulse * sign,
        );
        group.severity = Math.max(group.severity, impact.closingSpeed);
      }
    }
    for (const [car, byOther] of groups)
      for (const [other, impact] of byOther) {
        const otherCar =
          other && "damage" in other ? (other as SimulatedCar) : undefined;
        const piece =
          other && "owner" in other ? (other as DetachedBody) : undefined;
        // Source440550 follows saved ownership for free drivers2/3/4 only;
        // semi-detached driver1 and self-owned pieces do not attribute hits.
        const humanSource =
          otherCar?.human ||
          (piece && !piece.joint && piece.owner !== car && piece.owner.human);
        if (humanSource && !car.human)
          car.lastAttributedImpactMs = this.elapsed * 1000;
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
              this.elapsed * 1000 - car.lastAttributedImpactMs,
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
        car.damage.applyImpact(
          impact.contacts,
          vectors.damage,
          !!otherCar,
          car.human,
          this.elapsed * 1000,
          vectors.crush,
          impact.mean.divideScalar(impact.weight),
        );
        this.onImpact?.(car, impact.severity);
      }
    for (const car of this.cars) this.syncStructuralState(car);
  }
  step() {
    this.elapsed += PHYSICS_STEP;
    const previousVelocities = new Map(
      this.cars.map((car) => [car, car.state.velocity.clone()]),
    );
    for (const car of this.cars) {
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
      if (car.damage.splitRuntime?.disableMotion) {
        // Source car+18c8: XZ-snapped primary skips control and WheelForces;
        // both halves are free bodies. Gravity remains active.
        car.state.velocity.y -= (10 / 6.9) * PHYSICS_STEP;
        car.state.rpm = 0;
        car.debug = undefined;
      } else
        car.debug = applyVehicleForces(
          car.state,
          {
            throttle: car.knackered ? 0 : Math.max(0, car.input.throttle),
            steer: car.knackered && !car.human ? 0 : car.input.steer,
            brake:
              car.knackered && !car.human
                ? 0
                : Math.max(
                    Number(car.input.brake),
                    car.knackered ? 0 : -car.input.throttle,
                  ),
            handbrake: !!car.input.handbrake,
          },
          PHYSICS_STEP,
          car.motion,
          this.world,
          this.motionContext,
        );
    }
    this.debris = this.debris.filter((body) => {
      if (body.splitRevision !== undefined) {
        if (body.owner.damage.splitRuntime?.actor !== body.actor) return false;
        body.state.velocity.y -= (10 / 6.9) * PHYSICS_STEP;
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
      body.state.velocity.y -= (10 / 6.9) * PHYSICS_STEP;
      return true;
    });
    const bodies: Array<SimulatedCar | DetachedBody> = [
      ...this.cars,
      ...this.debris,
    ];
    prepareJointVelocities(
      this.debris.flatMap((b) => (b.joint ? [b.joint] : [])),
    );
    for (const body of bodies) {
      body.overlapDetected = false;
      body.worldOverlapDetected = false;
      candidate(body, PHYSICS_STEP);
    }
    const restartGroups: Set<SimulatedCar | DetachedBody>[] = [];
    const beforeApply = (
      impacts: ContactImpact[],
      jointImpacts: JointConstraintImpact[],
    ) => this.processImpactDamage(impacts, jointImpacts, restartGroups);
    const joints = this.debris.flatMap((b) => (b.joint ? [b.joint] : []));
    this.lastImpacts = resolveContactGroups(
      this.collectContacts(bodies),
      PHYSICS_STEP,
      joints,
      beforeApply,
    );
    // Source split invalidates the old contact solve. Rebuild the changed group
    // immediately, with the original 30-pass guard, before advancing this tick.
    for (let pass = 0; restartGroups.length && pass < 30; pass++) {
      const members = restartGroups.shift()!;
      const changed = [...members];
      for (const body of changed) candidate(body, PHYSICS_STEP);
      const changedJoints = this.debris.flatMap((b) =>
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
    for (const car of this.cars) this.syncStructuralState(car);
    for (const body of [...this.cars, ...this.debris]) {
      advance(body, PHYSICS_STEP);
      body.overlapRecovery = body.overlapDetected;
      body.worldRecovery = body.worldOverlapDetected;
    }
    projectJointPositions(
      this.debris.flatMap((b) => (b.joint ? [b.joint] : [])),
    );
    for (const car of this.cars) {
      const forward = new Vector3(0, 0, -1).applyQuaternion(
        car.state.orientation,
      );
      car.state.speed = car.state.velocity.dot(forward);
      car.state.heading = Math.atan2(-forward.x, -forward.z);
      car.state.health = 100 - Math.max(...car.damage.componentLevels);
      if (car.damage.wasted && car.wastedAt === undefined) {
        car.wastedAt = this.elapsed;
        this.onWasted?.(car);
        car.knackered = true;
      }
      this.sync(car);
      car.damage.stepFlaps(
        car.state.velocity
          .clone()
          .sub(previousVelocities.get(car)!)
          .multiplyScalar(1 / PHYSICS_STEP)
          .add(new Vector3(0, 1.44, 0))
          .applyQuaternion(car.state.orientation.clone().invert()),
      );
      this.detachParts(car);
    }
    for (const body of this.debris) {
      body.actor.position.copy(body.state.position);
      body.actor.quaternion.copy(body.state.orientation);
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
      if (!beginPartDetachment(part.state, this.elapsed * 1000)) continue;
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
      if (part.state.type !== 2) {
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
    this.cars = [];
  }
}
