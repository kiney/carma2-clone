import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Material,
  Matrix4,
  Mesh,
  Object3D,
  Quaternion,
  Texture,
  Vector3,
  DoubleSide,
} from "three";
import type { CarMechanics } from "./mechanics";
import { parseDamagePrograms, type DamageProgramSet } from "./damage-program";
import {
  applyComponentImpact,
  applyDamageUnit,
  type ComponentDamageContext,
} from "./physics/components";
import {
  crushModel,
  crushBentModel,
  constrainCrushVertex,
  classifyCrushVertex,
  prepareCrushLimits,
  queuedCrushForce,
  crushSmashMagnitude,
  type CrushLimits,
  type CrushVector,
} from "./physics/crush";
import { mineRandomFloat, mineRandomInteger } from "./physics/mines";
import { detachedChildCenterOfMass } from "./physics/detached-com";
import {
  createAttachmentState,
  createDetachmentSchedulingContext,
  accumulateSharedDetachmentForce,
  cancelScheduledDetachment,
  detachmentQueueSize,
  detachmentThreshold,
  resetAttachmentState,
  detachedPartMass,
  type AttachmentState,
  type DetachmentSchedulingContext,
} from "./physics/attachment";
import { isWasted } from "./physics/impact";
import { updateModelNormals } from "./render-geometry";
import { selectOrdinaryDetachGeometry } from "./physics/joint";
import {
  applyPlasticFlap,
  createFlapState,
  flapBasis,
  flapCheckVertices,
  flapAngleRadians,
  orderFlapHinges,
  stepFlapAngle,
  type FlapState,
} from "./physics/flap";
import { buildHull, type CollisionHull } from "./physics/geometry";
import {
  validateSplitPlane,
  splitHull,
  splitProperties,
  splitModelGeometry,
  type SplitPlane,
  type SplitProperties,
} from "./physics/split";
import {
  bendPoint,
  compressedModelCoordinate,
  compressedBendReference,
  bendHullVertices,
  selectStructuralBranch,
  createStructuralBend,
  DEFAULT_STRUCTURAL_SETTINGS,
  createBendTransform,
  stepBendRepair,
  bendSteeringCurvature,
  type BendTransform,
  type StructuralSettings,
} from "./physics/structural";
import { NativeSmashQueue } from "./smash-queue";
import { sharedNativeRandom } from "./native-random";

import {
  readSmashConnotations,
  SmashTextReader,
  type SmashConnotations,
} from "./world-smash";

export interface WamSmashLevel {
  connotations: SmashConnotations;
  threshold: number;
  flags: number;
  pixelmaps: string[];
}
/** One native permitted repetition of the final damage tier's effects.
 * Position/direction are car-root model coordinates; actor and bodyActor
 * preserve the scene context needed for world-space outlets. */
export interface WamSmashEvent {
  connotations: SmashConnotations;
  smash: WamSmash;
  part: WamPart;
  actor: Object3D;
  bodyActor: Group;
  mesh: Mesh<BufferGeometry>;
  localPoint: Vector3;
  localDirection: Vector3;
  /** First enqueue's metric starting-step velocity, not later flush velocity. */
  startingVelocity: Vector3;
  timeMs: number;
  oldLevel: number;
  targetLevel: number;
  repetition: number;
  repetitions: number;
}

/** First queued context survives stronger repeat hits until native flush. */
export interface WamSmashQueueContext {
  execute: (targetTier: number, reachedTier: number, timeMs: number) => void;
}
export function flushWamSmashQueue(
  queue: NativeSmashQueue<WamSmashQueueContext>,
  readTimeMs: () => number,
  beforeClear?: () => void,
): number {
  return queue.flush(
    readTimeMs,
    (entry, nowMs) =>
      entry.context.execute(entry.targetTier, entry.reachedTier, nowMs),
    beforeClear,
  );
}

export interface WamSmash {
  material: string;
  intactPixelmap: string;
  levels: WamSmashLevel[];
}
export interface WamPart {
  actor: string;
  softness: string;
  softnessFactor: number;
  type: "boring" | "flap" | "detach";
  hinges: number[];
  shapePoints: number[];
  shape?: string;
  ease?: string;
  detachmentType?: string;
  kevOFlap?: number;
  jointIndex?: number;
  smashes: WamSmash[];
}
export interface WamData {
  version: number;
  limits: { min: number[]; max: number[] }[];
  bendability: number;
  bendZMin: number;
  bendZMax: number;
  snappability: number;
  splitY: number;
  driver: Vector3;
  parts: WamPart[];
}

class WamReader {
  lines: string[];
  cursor = 0;
  constructor(text: string) {
    this.lines = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.split("//")[0].trim())
      .filter(Boolean);
  }
  read(): string {
    if (this.cursor >= this.lines.length) throw new Error("Truncated WAM data");
    return this.lines[this.cursor++];
  }
  number(): number {
    const value = Number(this.read());
    if (!Number.isFinite(value))
      throw new Error(`Invalid WAM number at line ${this.cursor}`);
    return value;
  }
  count(): number {
    const value = this.number();
    if (!Number.isInteger(value) || value < 0 || value > 10000)
      throw new Error("Invalid WAM count");
    return value;
  }
  skip(n: number): void {
    for (let i = 0; i < n; i++) this.read();
  }
  list(): number[] {
    return Array.from({ length: this.count() }, () => this.number());
  }
}

/** Reuse bounded smash token operations without borrowing the WAM cursor. */
class WamConnotationReader extends SmashTextReader {
  constructor(private wam: WamReader) {
    super("", "WAM");
  }
  override read(label: string): string {
    try {
      return this.wam.read();
    } catch {
      this.fail(`incomplete ${label}`);
    }
  }
  override fail(message: string): never {
    throw new Error(`WAM record ${this.wam.cursor}: ${message}`);
  }
}

/** Independent parser of C2 WAM version 4/104 master, part and texture records.
 * Crush planes divide original vertices into regions; mins can exceed maxs.
 */
export function parseWam(text: string): WamData {
  const r = new WamReader(text);
  const match = /^VERSION\s+(\d+)$/i.exec(r.read());
  const version = match ? Number(match[1]) : 0;
  if (version !== 4 && version !== 104)
    throw new Error(`Unsupported WAM version ${version}`);
  const limits = Array.from({ length: 3 }, () => ({
    min: r.list(),
    max: r.list(),
  }));
  const bendability = r.number(),
    bendZMin = r.number(),
    bendZMax = r.number();
  const snappability = r.number(),
    splitY = r.number();
  const driverValues = r
    .read()
    .split(/[\s,]+/)
    .map(Number);
  if (driverValues.length !== 3 || !driverValues.every(Number.isFinite))
    throw new Error("Invalid WAM driver position");
  const parts: WamPart[] = [];
  const count = r.count();
  const softness: Record<string, number> = {
    very_soft: 4,
    soft: 2,
    normal: 1,
    hard: 0.5,
    very_hard: 0.25,
    uncrushable: 0,
  };
  for (let i = 0; i < count; i++) {
    const actor = r.read(),
      soft = r.read().toLowerCase(),
      type = r.read().toLowerCase();
    if (!(soft in softness) || !["boring", "flap", "detach"].includes(type))
      throw new Error(`Invalid WAM part ${actor}`);
    const part: WamPart = {
      actor,
      softness: soft,
      softnessFactor: softness[soft],
      type: type as WamPart["type"],
      hinges: [],
      shapePoints: [],
      smashes: [],
    };
    if (type === "flap") {
      part.hinges = [r.count(), r.count(), r.count()];
      part.kevOFlap = r.count();
      part.ease = r.read();
      part.shape = r.read().toLowerCase();
    } else if (type === "detach") {
      part.ease = r.read();
      part.detachmentType = r.read().toLowerCase();
      if (
        !["normal", "stubborn", "fully_detach", "joint_index"].includes(
          part.detachmentType,
        )
      )
        throw new Error("Unsupported WAM detach type");
      if (part.detachmentType === "joint_index") part.jointIndex = r.count();
      part.shape = r.read().toLowerCase();
    }
    if (part.shape === "poly") part.shapePoints = r.list();
    if (part.shape && part.shape !== "poly" && part.shape !== "box")
      throw new Error("Unsupported WAM crush shape");
    const smashes = r.count();
    for (let j = 0; j < smashes; j++) {
      const smash: WamSmash = {
        material: r.read(),
        intactPixelmap: r.read(),
        levels: [],
      };
      const levels = r.count();
      for (let k = 0; k < levels; k++) {
        const threshold = r.number(),
          flags = r.number();
        const connotations = readSmashConnotations(new WamConnotationReader(r));
        const pixelmaps = Array.from({ length: r.count() }, () => r.read());
        smash.levels.push({ threshold, flags, connotations, pixelmaps });
      }
      part.smashes.push(smash);
    }
    parts.push(part);
  }
  return {
    version,
    limits,
    bendability,
    bendZMin,
    bendZMax,
    snappability,
    splitY,
    driver: new Vector3(...(driverValues as [number, number, number])),
    parts,
  };
}

export interface DamageAssets {
  resolve(path: string): string | undefined;
  text(path: string): Promise<string>;
  manifest?: { path: string }[];
  textures?: Map<string, Texture>;
  warnings?: string[];
  pixelmaps?(path: string, target: Map<string, Texture>): Promise<unknown>;
}
export interface DamageRuntimePart {
  actor: Object3D;
  originalParent: Object3D;
  originalTransform: Matrix4;
  bounds: Box3;
  state: AttachmentState;
  part: WamPart;
  mass: number;
  /** Authored principal model vertices in this actor's local frame. */
  originalVertices: Vector3[];
  /** Impact sample used by flap deformation; separate from the joint anchor. */
  strongestVertex: number;
  strongestDisplacement: number;
  /** Original detach_data +30/+32/+33: anchor, corner mask, car side. */
  detachmentVertex: number;
  detachmentDirection: number;
  detachmentSide: number;
  flap?: FlapState;
  flapHinges: number[];
  flapCheckVertices: Uint8Array;
  flapParentAnchor: Vector3;
  flapParentReference: Vector3;
  /** TotallySpam's direct FullyDetachPart request, consumed by physics owner. */
  forcedFullDetach?: boolean;
  /** Outward velocity in the car frame, magnitude8/6.9. Native spam also adds
   * one extra car velocity after the usual inheritedDetachedVelocity. */
  detachmentVelocityKick?: Vector3;
}
export interface SpamModelResult {
  rays: { start: Vector3; direction: Vector3; force: number }[];
  maxInfluence: number;
  detachedParts: DamageRuntimePart[];
  /** Random split435c90 uses model validator430730; unlike collision split,
   * it does not use the world-edge430d80 gate. Simulation owns partitioning. */
  splitRequest?: { normal: Vector3; constant: number };
  bendCase?: number;
}
interface DamageMesh {
  mesh: Mesh<BufferGeometry>;
  original: Float32Array;
  repairTarget: Float32Array;
  originalToCar: Matrix4;
  regions: Uint16Array;
  runtime?: DamageRuntimePart;
  materials: {
    material: Material & { map?: Texture | null };
    map?: Texture | null;
    centroid: Vector3;
    level: number;
    originalSide: Material["side"];
  }[];
}
interface ShapeDamage {
  vertices: Vector3[];
  original: Vector3[];
  regions: Uint16Array;
  softness: Float64Array;
}
export interface DamageSplitRuntime {
  actor: Group;
  plane: SplitPlane;
  shapes: Vector3[][];
  positive: SplitProperties;
  negative: SplitProperties;
  /** Wheels retained by the primary, driver-facing half. */
  wheelMask: boolean[];
  /** X/Z splits set source18c8=1; horizontal roof splits keep wheel forces. */
  disableMotion: boolean;
}
const textureKey = (name: string) =>
  name.replace(/\.(pix|p16)$/i, "").toLowerCase();
const vectorTuple = (point: Vector3): CrushVector => [
  point.x,
  point.y,
  point.z,
];
const ZERO_LIMITS = [0, 1, 2].map(() => ({ min: [], max: [] }));
const WHEEL_PREFIXES = ["FL", "FR", "RL", "RR", "IRL", "IRR"];

/** Setup compression515e70 / repair expansion515f50 stores visual XYZ as
 * rounded uint16 in [-10,10]. Decode uses the binary's Float32 reciprocal;
 * collision-shape repair retains its separate exact saved float coordinates. */
export function modelRepairCoordinate(value: number): number {
  return compressedModelCoordinate(value);
}

/** C2 damage consumers share the original collision impulse, but geometry,
 * texture damage and component levels follow their own audited equations.
 * Supplied contact/energy vectors use car-root model coordinates.
 * Collision and joint bodies are owned by the simulation; runtimeParts retains
 * the original scene parent and matrix so repair can restore actor ownership.
 */
export class DamageSystem {
  wam?: WamData;
  damagePrograms?: DamageProgramSet;
  readonly componentLevels = new Uint8Array(12);
  /** Native damage_units.last_damage_level: outer-frame / earned-pair baseline. */
  readonly lastComponentLevels = new Uint8Array(12);
  /** Native CheckDamage calls after component-program increments. */
  onWastageCheck?: () => void;
  onWamSmash?: (event: WamSmashEvent) => void;
  onStructuralBendSound?: (playbackRate: number) => void;
  readSmashStartingVelocity?: () => Vector3;
  /** Native full repair removes deferred SPAM, not ordinary impact records. */
  cancelQueuedSpam?: () => void;
  /** Return true when the outer physics queue owns this request, including
   * requests rejected by native capacity. Explicit tool impacts run directly. */
  deferOrdinaryCrush?: (
    contacts: readonly Vector3[],
    crushVector: Vector3,
    human: boolean,
    physicsTickMs: number,
  ) => boolean;
  private readonly smashLevels = new Map<WamSmash, number>();
  private sharedSmashQueue?: NativeSmashQueue<WamSmashQueueContext>;
  /** The simulation supplies native shared lifetime; standalone tools flush
   * locally after each explicit impact. */
  configureWamSmashQueue(queue?: NativeSmashQueue<WamSmashQueueContext>): void {
    this.sharedSmashQueue = queue;
  }
  readonly runtimeParts: DamageRuntimePart[] = [];
  damageContext: Partial<ComponentDamageContext> & {
    seedRandom?: (seed: number) => void;
  } = {
    random: sharedNativeRandom.random,
    seedRandom: sharedNativeRandom.seed,
  };
  repairRevision = 0;
  deformationRevision = 0;
  /** Source1pending,2rebuild,4contraction,8pendingCOM. Root clears on success. */
  pendingShapeSwapFlags = 0;
  structuralRevision = 0;
  splitRevision = 0;
  splitRuntime?: DamageSplitRuntime;
  private shellModelActive = false;
  structuralBend?: BendTransform;
  structuralSettings: Readonly<StructuralSettings> =
    DEFAULT_STRUCTURAL_SETTINGS;
  readonly currentCenterOfMass = new Vector3();
  currentWheelPositions: Vector3[] = [];
  private meshes: DamageMesh[] = [];
  private textures = new Map<string, Texture>();
  private ready = false;
  private bounds = new Box3();
  private modelLimits?: CrushLimits;
  private physicsLimits?: CrushLimits;
  private mechanics?: CarMechanics;
  private shapeVertices: Vector3[][] = [];
  private shapes: ShapeDamage[] = [];
  private detachmentScheduling = createDetachmentSchedulingContext();
  private wheelTransforms = new Map<Object3D, Matrix4>();
  private bendVertexReferences = new Map<DamageMesh, Vector3[]>();
  private bendVertexClasses = new Map<DamageMesh, Uint8Array>();
  private bendShapeReferences: Vector3[][] = [];
  private readonly bendCenterReference = new Vector3();
  private bendWheelReferences: Vector3[] = [];
  private originalWheelPositions: Vector3[] = [];
  private bentStopBounds = new Box3();
  private splitGeometryOriginals = new Map<DamageMesh, BufferGeometry>();
  private splitActorOriginals = new Map<
    Object3D,
    { parent: Object3D; transform: Matrix4; visible: boolean }
  >();
  private wheelMotionIndices: number[] = [];
  readonly wheelGrooveOffsets = new Map<Object3D, number>();
  private wheelGrooveReferences = new Map<Object3D, Vector3>();
  private wheelGrooveOwnedActors = new Set<Object3D>();

  constructor(
    private assets: DamageAssets,
    private group: Group,
    private configText: string,
  ) {}

  get carSoftness(): number {
    return this.damagePrograms?.softness ?? 1;
  }
  get snapped(): boolean {
    return !!this.splitRuntime;
  }
  /** Source +e24: clean shell mode excludes held repair until visual damage. */
  get useShellModel(): boolean {
    return this.shellModelActive;
  }
  get steeringDamageCurvature(): number {
    return bendSteeringCurvature(this.structuralBend);
  }

  constrainShapeSwap(activeHulls: readonly CollisionHull[]): void {
    if (!(this.pendingShapeSwapFlags & 4) || !this.physicsLimits) return;
    this.shapes.forEach((shape, index) => {
      const hull = activeHulls[index];
      if (!hull) return;
      const planes = hull.faces.map((face) => ({
        normal: vectorTuple(face.normal),
        constant: face.constant,
      }));
      shape.vertices.forEach((point, vertex) => {
        const previous = hull.vertices[vertex];
        if (!previous) return;
        point.fromArray(
          constrainCrushVertex(
            vectorTuple(point),
            vectorTuple(previous),
            planes,
            shape.regions[vertex],
            this.physicsLimits!,
          ),
        );
      });
    });
  }

  private principalModels(): DamageMesh[] {
    const primary =
      this.runtimeParts.find((part) => part.actor.parent === this.group) ??
      this.runtimeParts[0];
    return this.meshes.filter((data) => data.runtime === primary);
  }
  /** Original car_actor's principal render model, also used by mode-1 fire. */
  get primaryRenderMesh(): Mesh<BufferGeometry> | undefined {
    return this.principalModels()[0]?.mesh;
  }
  /** RenderElectroBastardRays reads the primary render model, not bb1/bb2.
   * Recompute after crush so this remains the live model-space extent. */
  get primaryRenderModelBounds(): Box3 | undefined {
    const geometry = this.principalModels()[0]?.mesh.geometry;
    if (!geometry) return;
    geometry.computeBoundingBox();
    return geometry.boundingBox?.clone() ?? undefined;
  }
  prepareSplitPlane(
    normal: Vector3,
    constant: number,
    horizontalY?: number,
  ): SplitPlane | undefined {
    if (
      !this.ready ||
      !this.wam ||
      this.snapped ||
      this.structuralBend ||
      this.damageContext.invulnerable
    )
      return;
    const bounds = new Box3();
    for (const shape of this.shapes)
      for (const point of shape.vertices) bounds.expandByPoint(point);
    if (bounds.isEmpty()) bounds.copy(this.bounds);
    const modelBounds = new Box3();
    this.group.updateMatrixWorld(true);
    const inverse = this.group.matrixWorld.clone().invert();
    const principal = this.principalModels()[0];
    if (!principal) return;
    const positions = principal.mesh.geometry.getAttribute("position");
    const toCar = new Matrix4().multiplyMatrices(
      inverse,
      principal.mesh.matrixWorld,
    );
    for (let i = 0; i < positions.count; i++)
      modelBounds.expandByPoint(
        new Vector3().fromBufferAttribute(positions, i).applyMatrix4(toCar),
      );
    return validateSplitPlane({
      normal,
      constant,
      bounds,
      modelBounds,
      driver: this.wam.driver,
      horizontalY,
    });
  }

  /** Plane must come from prepareSplitPlane, after the source world-edge gate.
   * The positive half retains the car driver; secondary actor starts with the
   * same world/model transform. Simulation owns its independent rigid body. */
  splitAtPlane(
    plane: SplitPlane,
    human: boolean,
  ): DamageSplitRuntime | undefined {
    if (
      !this.ready ||
      !this.wam ||
      !this.mechanics ||
      this.snapped ||
      this.structuralBend
    )
      return;
    const principal = this.principalModels();
    if (!principal.length) return;
    const bounds = new Box3();
    for (const shape of this.shapes)
      for (const point of shape.vertices) bounds.expandByPoint(point);
    if (bounds.isEmpty()) return;
    const properties = splitProperties(
      {
        mass: this.mechanics.root.mass,
        centerOfMass: this.currentCenterOfMass,
        inertia: new Vector3(...this.mechanics.root.inertia),
      },
      bounds,
      plane,
    );
    if (
      ![properties.positive, properties.negative].every(
        (part) =>
          part.mass > 0 &&
          part.inertia
            .toArray()
            .every((value) => value > 0 && Number.isFinite(value)),
      )
    )
      return;
    const splitShapes = this.shapes.map((shape) =>
      splitHull(shape.vertices, buildHull(shape.vertices).edges, plane),
    );
    if (
      !splitShapes.some((shape) => shape.positive.length) ||
      !splitShapes.some((shape) => shape.negative.length)
    )
      return;
    this.group.updateMatrixWorld(true);
    const inverse = this.group.matrixWorld.clone().invert();
    const actor = new Group();
    actor.name = this.group.name + "_split";
    actor.matrix.copy(this.group.matrixWorld);
    actor.matrix.decompose(actor.position, actor.quaternion, actor.scale);
    actor.updateMatrixWorld(true);
    for (const data of principal) {
      const toCar = new Matrix4().multiplyMatrices(
        inverse,
        data.mesh.matrixWorld,
      );
      const halves = splitModelGeometry(
        data.mesh.geometry,
        toCar,
        plane,
        this.damageContext.random,
      );
      this.splitGeometryOriginals.set(data, data.mesh.geometry);
      data.mesh.geometry = halves.positive;
      const child = new Mesh(halves.negative, data.mesh.material);
      child.name = data.mesh.name;
      child.matrix.copy(toCar);
      toCar.decompose(child.position, child.quaternion, child.scale);
      actor.add(child);
    }
    const saveActor = (part: Object3D) => {
      if (!part.parent || this.splitActorOriginals.has(part)) return;
      part.updateMatrix();
      this.splitActorOriginals.set(part, {
        parent: part.parent,
        transform: part.matrix.clone(),
        visible: part.visible,
      });
    };
    let hidden = 0;
    for (const runtime of this.runtimeParts) {
      if (runtime === principal[0].runtime || runtime.state.phase !== 0)
        continue;
      // Ancestor migration moves owned subactors with their parent exactly once.
      let ancestor = runtime.actor.parent;
      let inCar = false;
      while (ancestor) {
        if (ancestor === this.group) {
          inCar = true;
          break;
        }
        ancestor = ancestor.parent;
      }
      if (!inCar) continue;
      const toCar = new Matrix4().multiplyMatrices(
        inverse,
        runtime.actor.matrixWorld,
      );
      const min = runtime.bounds.min.clone().applyMatrix4(toCar),
        max = runtime.bounds.max.clone().applyMatrix4(toCar);
      const low = plane.normal.dot(min) - plane.constant > 0,
        high = plane.normal.dot(max) - plane.constant > 0;
      if (low === high) {
        if (!low) {
          saveActor(runtime.actor);
          actor.attach(runtime.actor);
        }
      } else if (hidden < 8) {
        saveActor(runtime.actor);
        runtime.actor.visible = false;
        hidden++;
      }
    }
    const wheelMask = this.currentWheelPositions.map(
      (point) => plane.normal.dot(point) - plane.constant > 0,
    );
    this.mechanics.wheels.forEach((wheel, index) => {
      if (wheelMask[this.wheelMotionIndices[index] ?? index]) return;
      const wheelActor = this.group.getObjectByName(wheel.actor);
      if (wheelActor) {
        saveActor(wheelActor);
        actor.attach(wheelActor);
      }
    });
    splitShapes.forEach((shape, index) =>
      this.shapes[index].vertices.splice(
        0,
        this.shapes[index].vertices.length,
        ...shape.positive,
      ),
    );
    this.currentCenterOfMass.copy(properties.positive.centerOfMass);
    const random = this.damageContext.random ?? Math.random;
    for (let index = 0; index < 12; index++) {
      let attempts = 0;
      do {
        this.componentLevels[index] = applyDamageUnit(
          this.componentLevels[index],
          index,
          50 + Math.floor(random() * 51),
          { ...this.damageContext, human },
        );
      } while (index === 0 && this.componentLevels[0] < 80 && ++attempts < 30);
    }
    this.onWastageCheck?.();
    this.splitRuntime = {
      actor,
      plane,
      shapes: splitShapes.map((shape) => shape.negative),
      ...properties,
      wheelMask,
      disableMotion: Math.abs(plane.normal.y) <= 0.707107,
    };
    this.shellModelActive = false;
    this.pendingShapeSwapFlags = 0;
    this.splitRevision++;
    this.structuralRevision++;
    this.deformationRevision++;
    return this.splitRuntime;
  }

  private restoreSplit(): void {
    if (!this.splitRuntime) return;
    for (const [data, geometry] of this.splitGeometryOriginals) {
      data.mesh.geometry.dispose();
      data.mesh.geometry = geometry;
    }
    this.splitGeometryOriginals.clear();
    for (const [actor, saved] of this.splitActorOriginals) {
      saved.parent.add(actor);
      actor.matrix.copy(saved.transform);
      saved.transform.decompose(actor.position, actor.quaternion, actor.scale);
      actor.visible = saved.visible;
    }
    this.splitActorOriginals.clear();
    for (const child of this.splitRuntime.actor.children)
      if (child instanceof Mesh) child.geometry.dispose();
    this.splitRuntime.actor.removeFromParent();
    this.splitRuntime = undefined;
    this.currentCenterOfMass.fromArray(
      this.mechanics?.root.centerOfMass ?? [0, 0, 0],
    );
    this.splitRevision++;
    this.structuralRevision++;
  }

  get wasted(): boolean {
    return isWasted(this.componentLevels);
  }

  get detachQueue(): DamageRuntimePart[] {
    return this.runtimeParts.filter(
      (runtime) => runtime.state.queuedAt !== null && runtime.state.phase === 0,
    );
  }

  /** Give every simulated car the same context before its first impact.
   * A standalone preview/test retains its own original-size queue by default.
   * Existing reservations can transfer only when the shared queue has room. */
  configureDetachmentScheduling(context: DetachmentSchedulingContext): void {
    if (context === this.detachmentScheduling) return;
    const states = this.detachQueue.map((runtime) => runtime.state);
    const newStates = states.filter((state) => !context.queued.has(state));
    if (detachmentQueueSize(context) + newStates.length > 16)
      throw new Error("C2 global detachment queue is full");
    for (const state of states) {
      this.detachmentScheduling.queued.delete(state);
      context.queued.add(state);
      context.lastScheduled = Math.max(context.lastScheduled, state.queuedAt!);
    }
    this.detachmentScheduling = context;
  }

  async init(): Promise<void> {
    if (this.ready) return;
    try {
      this.damagePrograms = parseDamagePrograms(this.configText);
    } catch {
      /* Geometry-only archive previews need not contain a complete car TXT. */
    }
    const config = this.configText
      .split(/\r?\n/)
      .map((line) => line.split("//")[0])
      .join("\n");
    const wamName = /([^\s,]+\.wam)\b/i.exec(config)?.[1];
    const stem = /([^\s,]+)\.txt\b/i.exec(config)?.[1] ?? this.group.name;
    if (wamName) {
      const path =
        this.assets.resolve(`data/CARS/${stem}/${wamName}`) ??
        this.assets.resolve(`adv_data/CARS/${stem}/${wamName}`) ??
        this.assets.manifest?.find(
          (entry) =>
            entry.path.split("/").pop()?.toLowerCase() ===
            wamName.toLowerCase(),
        )?.path;
      if (path) {
        try {
          this.wam = parseWam(await this.assets.text(path));
        } catch (error) {
          this.assets.warnings?.push(`Damage data ${path}: ${String(error)}`);
        }
        if (this.assets.pixelmaps) {
          const directory = path
            .slice(0, path.lastIndexOf("/") + 1)
            .toLowerCase();
          for (const entry of this.assets.manifest ?? []) {
            if (
              !entry.path.toLowerCase().startsWith(directory) ||
              !/\.(pix|p16)$/i.test(entry.path)
            )
              continue;
            try {
              await this.assets.pixelmaps(entry.path, this.textures);
            } catch (error) {
              this.assets.warnings?.push(
                `Damage texture ${entry.path}: ${String(error)}`,
              );
            }
          }
        }
      }
    }
    for (const [name, texture] of this.assets.textures ?? [])
      this.textures.set(textureKey(name), texture);
    this.group.updateMatrixWorld(true);
    const inverse = this.group.matrixWorld.clone().invert();
    this.group.traverse((object) => {
      if (
        !(object instanceof Mesh) ||
        !object.geometry.getAttribute("position")
      )
        return;
      const mesh = object as Mesh<BufferGeometry>;
      mesh.geometry = mesh.geometry.clone();
      const position = mesh.geometry.getAttribute("position");
      const original = Float32Array.from(position.array);
      const originalToCar = new Matrix4().multiplyMatrices(
        inverse,
        mesh.matrixWorld,
      );
      for (let i = 0; i < position.count; i++)
        this.bounds.expandByPoint(
          new Vector3()
            .fromBufferAttribute(position, i)
            .applyMatrix4(originalToCar),
        );
      const cloned = (
        Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      ).map((material) => material.clone());
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0];
      const materials = cloned.map((material, materialIndex) => {
        const mapped = material as Material & { map?: Texture | null };
        if (mapped.map)
          this.textures.set(textureKey(mapped.map.name), mapped.map);
        return {
          material: mapped,
          map: mapped.map,
          centroid: this.materialCentroid(mesh.geometry, materialIndex),
          level: 0,
          originalSide: material.side,
        };
      });
      this.meshes.push({
        mesh,
        original,
        repairTarget: Float32Array.from(original, modelRepairCoordinate),
        originalToCar,
        regions: new Uint16Array(position.count),
        materials,
      });
    });
    // content.ts represents an ACT actor as a Group, with its own DAT models
    // as direct Mesh children. Match that actor exactly; never inherit a WAM
    // entry down through child ACT actors or remove identifier extensions.
    this.group.traverse((actor) => {
      const part = this.wam?.parts.find(
        (entry) => entry.actor.toLowerCase() === actor.name.toLowerCase(),
      );
      if (!part || !actor.parent) return;
      const models = this.meshes.filter(
        (data) =>
          !data.runtime && (data.mesh === actor || data.mesh.parent === actor),
      );
      if (!models.length) return;
      const type =
        part.type === "flap"
          ? part.kevOFlap
            ? 5
            : 2
          : ["normal", "stubborn", "fully_detach", "joint_index"].indexOf(
              part.detachmentType ?? "normal",
            );
      actor.updateMatrix();
      const sourcePositions =
        (models[0].mesh.geometry.userData.sourcePositions as
          | Float32Array
          | undefined) ?? models[0].original;
      const runtime: DamageRuntimePart = {
        actor,
        originalParent: actor.parent,
        originalTransform: actor.matrix.clone(),
        bounds: new Box3(),
        state: createAttachmentState(type),
        part,
        mass: 0.01,
        originalVertices: Array.from(
          { length: sourcePositions.length / 3 },
          (_, i) => {
            const point = new Vector3().fromArray(sourcePositions, i * 3);
            return models[0].mesh === actor
              ? point
              : point.applyMatrix4(models[0].mesh.matrix);
          },
        ),
        strongestVertex: 0,
        strongestDisplacement: 0,
        detachmentVertex: part.jointIndex ?? 0,
        detachmentDirection: 0,
        detachmentSide: 0,
        flapHinges: [],
        flapCheckVertices: new Uint8Array(),
        flapParentAnchor: new Vector3(),
        flapParentReference: new Vector3(),
      };
      this.runtimeParts.push(runtime);
      for (const model of models) model.runtime = runtime;
      this.updatePartBounds(runtime);
    });
    this.ready = true;
    this.setupRegions();
  }

  configurePhysics(
    mechanics: CarMechanics,
    mutableShapeVertices: Vector3[][],
    resolvedWheelPositions?: readonly Vector3[],
  ): void {
    this.mechanics = mechanics;
    this.currentCenterOfMass.fromArray(
      mechanics.root.centerOfMass ?? [0, 0, 0],
    );
    this.originalWheelPositions = resolvedWheelPositions
      ? resolvedWheelPositions.map((point) => point.clone())
      : mechanics.wheels.map((wheel) => new Vector3(...wheel.position));
    this.currentWheelPositions = this.originalWheelPositions.map((point) =>
      point.clone(),
    );
    this.group.updateMatrixWorld(true);
    const inverse = this.group.matrixWorld.clone().invert();
    this.setupWheelGrooveReferences(inverse);
    this.wheelMotionIndices = mechanics.wheels.map((wheel, index) => {
      if (!resolvedWheelPositions || resolvedWheelPositions.length !== 4)
        return index;
      const actor = this.group.getObjectByName(wheel.actor);
      const x =
        wheel.position[0] ||
        (actor
          ? new Box3()
              .setFromObject(actor)
              .getCenter(new Vector3())
              .applyMatrix4(inverse).x
          : 0);
      return (wheel.steerable ? 2 : 0) + (x > 0 ? 1 : 0);
    });
    for (const wheel of mechanics.wheels) {
      const actor = this.group.getObjectByName(wheel.actor);
      if (actor) {
        actor.updateMatrix();
        this.wheelTransforms.set(actor, actor.matrix.clone());
      }
    }
    this.shapeVertices = mutableShapeVertices;
    if (this.ready) this.setupRegions();
  }

  private setupWheelGrooveReferences(inverse: Matrix4): void {
    this.wheelGrooveReferences.clear();
    this.wheelGrooveOwnedActors.clear();
    const lines = this.configText
      .split(/\r?\n/)
      .map((line) => line.replace(/\/\/.*$/, "").trim())
      .filter(Boolean);
    const start = lines.indexOf("START OF GROOVE"),
      end = lines.indexOf("END OF GROOVE", start + 1);
    if (start < 0 || end < 0) return;
    const centers = new Map<string, Vector3>();
    for (const block of lines
      .slice(start + 1, end)
      .join("\n")
      .split("NEXT GROOVE")) {
      const fields = block.trim().split("\n");
      if (fields[3]?.toLowerCase() !== "straight") continue;
      const values = fields[5]?.split(/[\s,]+/).map(Number);
      if (values?.length === 3 && values.every(Number.isFinite))
        centers.set(fields[0].toLowerCase(), new Vector3(...values));
    }
    for (const prefix of WHEEL_PREFIXES) {
      const wheel = this.group.getObjectByName(prefix + "WHEEL.ACT"),
        pivot = this.group.getObjectByName(prefix + "PIVOT.ACT");
      const selected = pivot ?? wheel;
      if (!selected) continue;
      const center = centers.get(selected.name.toLowerCase());
      if (!center) continue;
      let reference: Vector3;
      if (center.lengthSq() === 0) {
        const box = new Box3().setFromObject(selected);
        reference = box.isEmpty()
          ? new Vector3().setFromMatrixPosition(selected.matrixWorld)
          : box.getCenter(new Vector3());
        reference.applyMatrix4(inverse);
      } else {
        reference = center.clone();
        if (selected.parent)
          reference.applyMatrix4(selected.parent.matrixWorld);
        reference.applyMatrix4(inverse);
      }
      this.wheelGrooveReferences.set(selected, reference);
      this.wheelGrooveOffsets.set(selected, 0);
      selected.userData.c2BendPathOffsetY = 0;
      if (wheel) this.wheelGrooveOwnedActors.add(wheel);
      if (pivot) this.wheelGrooveOwnedActors.add(pivot);
    }
  }

  private updateWheelGrooveOffsets(bend: BendTransform | undefined): void {
    for (const [actor, reference] of this.wheelGrooveReferences) {
      const offset = bend ? bendPoint(reference, bend).y - reference.y : 0;
      this.wheelGrooveOffsets.set(actor, offset);
      actor.userData.c2BendPathOffsetY = offset;
    }
  }

  private materialCentroid(
    geometry: BufferGeometry,
    materialIndex: number,
  ): Vector3 {
    const position = geometry.getAttribute("position");
    const index = geometry.index;
    const indices = new Set<number>();
    const groups = geometry.groups.length
      ? geometry.groups
      : [{ start: 0, count: index?.count ?? position.count, materialIndex: 0 }];
    for (const group of groups) {
      if ((group.materialIndex ?? 0) !== materialIndex) continue;
      for (let i = group.start; i < group.start + group.count; i++)
        indices.add(index ? index.getX(i) : i);
    }
    const centroid = new Vector3();
    const sourceIndices = geometry.userData.sourceVertexIndices as
      | Uint32Array
      | undefined;
    const counted = new Set<number>();
    for (const vertex of indices) {
      const source = sourceIndices?.[vertex] ?? vertex;
      if (counted.has(source)) continue;
      counted.add(source);
      centroid.add(new Vector3().fromBufferAttribute(position, vertex));
    }
    return counted.size ? centroid.divideScalar(counted.size) : centroid;
  }

  private setupRegions(): void {
    if (this.shapeVertices.length) {
      this.bounds.makeEmpty();
      for (const shape of this.shapeVertices)
        for (const point of shape) this.bounds.expandByPoint(point);
    }
    if (this.bounds.isEmpty())
      this.bounds.set(
        new Vector3(-0.1, -0.1, -0.1),
        new Vector3(0.1, 0.1, 0.1),
      );
    const authored = this.wam?.limits ?? ZERO_LIMITS;
    this.modelLimits = prepareCrushLimits(authored, {
      min: vectorTuple(this.bounds.min),
      max: vectorTuple(this.bounds.max),
    });
    for (const data of this.meshes) {
      for (let i = 0; i < data.regions.length; i++)
        data.regions[i] = classifyCrushVertex(
          [
            data.original[i * 3],
            data.original[i * 3 + 1],
            data.original[i * 3 + 2],
          ],
          this.modelLimits,
        ).packed;
    }
    const wheelBounds = new Box3();
    this.group.updateMatrixWorld(true);
    const inverse = this.group.matrixWorld.clone().invert();
    for (const wheel of this.mechanics?.wheels ?? []) {
      const actor = this.group.getObjectByName(wheel.actor);
      const translation = actor
        ? new Vector3().setFromMatrixPosition(
            new Matrix4().multiplyMatrices(inverse, actor.matrixWorld),
          )
        : new Vector3(...wheel.position);
      wheelBounds.expandByPoint(
        wheel.positionFromActor ? translation : new Vector3(...wheel.position),
      );
      if (actor)
        for (const model of this.meshes.filter(
          (data) => data.mesh === actor || data.mesh.parent === actor,
        )) {
          model.mesh.geometry.computeBoundingBox();
          const box = model.mesh.geometry.boundingBox;
          if (box) {
            wheelBounds.expandByPoint(box.min.clone().add(translation));
            wheelBounds.expandByPoint(box.max.clone().add(translation));
          }
        }
    }
    // The original envelope includes six wheel models (inner rear wheels too),
    // regardless of whether mechanics exposes four suspension rays.
    for (const prefix of WHEEL_PREFIXES) {
      const actor = this.group.getObjectByName(prefix + "WHEEL.ACT");
      if (!actor) continue;
      const translation = new Vector3().setFromMatrixPosition(
        new Matrix4().multiplyMatrices(inverse, actor.matrixWorld),
      );
      for (const model of this.meshes.filter(
        (data) => data.mesh === actor || data.mesh.parent === actor,
      )) {
        model.mesh.geometry.computeBoundingBox();
        const box = model.mesh.geometry.boundingBox;
        if (box) {
          wheelBounds.expandByPoint(box.min.clone().add(translation));
          wheelBounds.expandByPoint(box.max.clone().add(translation));
        }
      }
    }
    this.physicsLimits = (
      wheelBounds.isEmpty()
        ? this.modelLimits
        : this.modelLimits.map((axis, i) => ({
            min: [...axis.min, wheelBounds.max.getComponent(i)].sort(
              (a, b) => b - a,
            ),
            max: [...axis.max, wheelBounds.min.getComponent(i)].sort(
              (a, b) => a - b,
            ),
          }))
    ) as CrushLimits;
    this.shapes = this.shapeVertices.map((vertices) => {
      const original = vertices.map((point) => point.clone());
      const regions = new Uint16Array(vertices.length);
      const softness = new Float64Array(vertices.length);
      for (let i = 0; i < vertices.length; i++) {
        const classified = classifyCrushVertex(
          vectorTuple(vertices[i]),
          this.physicsLimits!,
        );
        regions[i] = classified.packed;
        if (classified.invalid) continue;
        let nearest = Infinity;
        softness[i] = 1;
        for (const data of this.meshes) {
          if (!data.runtime) continue;
          for (let v = 0; v < data.original.length; v += 3) {
            const point = new Vector3(
              data.original[v],
              data.original[v + 1],
              data.original[v + 2],
            ).applyMatrix4(data.originalToCar);
            const distance = point.distanceToSquared(vertices[i]);
            if (distance < nearest) {
              nearest = distance;
              softness[i] = data.runtime.part.softnessFactor;
            }
          }
        }
      }
      return { vertices, original, regions, softness };
    });
    const carVolume = this.bounds
      .getSize(new Vector3())
      .toArray()
      .reduce((product, value) => product * value, 1);
    for (const runtime of this.runtimeParts) {
      if (runtime.part.type === "flap") {
        runtime.flapHinges = orderFlapHinges(
          runtime.originalVertices,
          runtime.part.hinges,
          new Vector3(...(this.mechanics?.root.centerOfMass ?? [0, 0, 0])),
          runtime.part.kevOFlap,
        );
        runtime.flap = createFlapState(
          runtime.originalVertices[runtime.flapHinges[1]],
          runtime.originalVertices[runtime.flapHinges[2]],
        );
        runtime.flapCheckVertices = flapCheckVertices(
          runtime.originalVertices,
          runtime.flapHinges,
        );
        const parentModel = this.meshes.find(
          (data) =>
            data.mesh === runtime.originalParent ||
            data.mesh.parent === runtime.originalParent,
        );
        const nearestParent = (point: Vector3) => {
          const mapped = point.clone().applyMatrix4(runtime.originalTransform);
          if (!parentModel) return mapped;
          const positions =
            (parentModel.mesh.geometry.userData.sourcePositions as
              | Float32Array
              | undefined) ?? parentModel.original;
          const nearest = mapped.clone();
          let best = Infinity;
          for (let i = 0; i < positions.length; i += 3) {
            const candidate = new Vector3().fromArray(positions, i);
            if (parentModel.mesh !== runtime.originalParent)
              candidate.applyMatrix4(parentModel.mesh.matrix);
            const distance = mapped.distanceToSquared(candidate);
            if (distance < best) {
              best = distance;
              nearest.copy(candidate);
            }
          }
          return nearest;
        };
        runtime.flapParentAnchor.copy(
          nearestParent(runtime.originalVertices[runtime.flapHinges[0]]),
        );
        runtime.flapParentReference.copy(
          nearestParent(runtime.originalVertices[runtime.flapHinges[2]]),
        );
      }
      if (runtime.originalVertices.length) {
        const geometry = selectOrdinaryDetachGeometry(
          runtime.originalVertices,
          this.bounds.min,
          this.bounds.max,
          runtime.part.detachmentType === "joint_index"
            ? runtime.part.jointIndex
            : undefined,
        );
        runtime.detachmentVertex = geometry.vertexIndex;
        runtime.detachmentDirection = geometry.cornerBits;
        runtime.detachmentSide = geometry.side;
      }
      const volume = runtime.bounds
        .getSize(new Vector3())
        .toArray()
        .reduce((product, value) => product * value, 1);
      runtime.mass = detachedPartMass(
        volume,
        this.mechanics?.root.mass ?? 1,
        carVolume,
      );
    }
  }

  private updatePartBounds(runtime: DamageRuntimePart): void {
    runtime.bounds.makeEmpty();
    for (const data of this.meshes.filter(
      (model) => model.runtime === runtime,
    )) {
      const position = data.mesh.geometry.getAttribute("position");
      const transform =
        data.mesh === runtime.actor ? new Matrix4() : data.mesh.matrix;
      for (let i = 0; i < position.count; i++)
        runtime.bounds.expandByPoint(
          new Vector3()
            .fromBufferAttribute(position, i)
            .applyMatrix4(transform),
        );
    }
  }

  private refreshGeometry(data: DamageMesh): void {
    (
      data.mesh.geometry.getAttribute("position") as BufferAttribute
    ).needsUpdate = true;
    if (data.mesh.geometry.userData.sourceVertexIndices)
      updateModelNormals(data.mesh.geometry);
    else data.mesh.geometry.computeVertexNormals();
    data.mesh.geometry.computeBoundingBox();
    data.mesh.geometry.computeBoundingSphere();
  }

  getPartVertices(runtime: DamageRuntimePart): Vector3[] {
    const data = this.meshes.find((entry) => entry.runtime === runtime);
    if (!data) return runtime.originalVertices.map((point) => point.clone());
    const position = data.mesh.geometry.getAttribute("position");
    const mapping = data.mesh.geometry.userData.sourceVertexIndices as
      | Uint32Array
      | undefined;
    const points = runtime.originalVertices.map((point) => point.clone());
    const seen = new Set<number>();
    for (let i = 0; i < position.count; i++) {
      const source = mapping?.[i] ?? i;
      if (seen.has(source)) continue;
      seen.add(source);
      points[source].fromBufferAttribute(position, i);
      if (data.mesh !== runtime.actor)
        points[source].applyMatrix4(data.mesh.matrix);
    }
    return points;
  }

  private writePartVertices(
    runtime: DamageRuntimePart,
    points: Vector3[],
  ): void {
    const data = this.meshes.find((entry) => entry.runtime === runtime);
    if (!data) return;
    const position = data.mesh.geometry.getAttribute(
      "position",
    ) as BufferAttribute;
    const mapping = data.mesh.geometry.userData.sourceVertexIndices as
      | Uint32Array
      | undefined;
    const inverse =
      data.mesh === runtime.actor ? null : data.mesh.matrix.clone().invert();
    for (let i = 0; i < position.count; i++) {
      const point = points[mapping?.[i] ?? i].clone();
      if (inverse) point.applyMatrix4(inverse);
      position.setXYZ(i, point.x, point.y, point.z);
    }
    this.refreshGeometry(data);
  }

  private updateFlapTransform(
    runtime: DamageRuntimePart,
    points: Vector3[],
  ): void {
    if (!runtime.flap) return;
    const { origin, axis } = flapBasis(points, runtime.flapHinges);
    runtime.actor.matrix
      .makeTranslation(
        runtime.flapParentAnchor.x,
        runtime.flapParentAnchor.y,
        runtime.flapParentAnchor.z,
      )
      .multiply(
        new Matrix4().makeRotationAxis(axis, flapAngleRadians(runtime.flap)),
      )
      .multiply(new Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
    runtime.actor.matrix.decompose(
      runtime.actor.position,
      runtime.actor.quaternion,
      runtime.actor.scale,
    );
    runtime.actor.updateMatrixWorld(true);
  }

  /** Source FlapBits passes (v-now - v-previous)/dt + Batty gravity, transformed
   * into the car frame. Production calls once per native outer frame. */
  stepFlaps(forceInCar: Vector3): number {
    let changed = 0;
    this.group.updateMatrixWorld(true);
    const inverse = this.group.matrixWorld.clone().invert();
    for (const runtime of this.runtimeParts) {
      if (
        !runtime.flap?.active ||
        runtime.part.kevOFlap ||
        runtime.state.phase !== 0
      )
        continue;
      const points = this.getPartVertices(runtime);
      const { axis, radial } = flapBasis(points, runtime.flapHinges);
      const radialInCar = radial.transformDirection(
        new Matrix4().multiplyMatrices(inverse, runtime.actor.matrixWorld),
      );
      if (
        stepFlapAngle(runtime.flap, axis, radialInCar, forceInCar, runtime.mass)
      ) {
        this.shellModelActive = false;
        this.updateFlapTransform(runtime, points);
        changed++;
      }
    }
    return changed;
  }

  private applyStructuralBend(
    bend: BendTransform,
    human: boolean,
    damageComponents = true,
  ): void {
    this.shellModelActive = false;
    this.bendVertexReferences.clear();
    this.bendVertexClasses.clear();
    this.bendCenterReference.copy(this.currentCenterOfMass);
    this.bendWheelReferences = this.currentWheelPositions.map((point) =>
      point.clone(),
    );
    this.group.updateMatrixWorld(true);
    const inverse = this.group.matrixWorld.clone().invert();
    for (const data of this.meshes) {
      if (!data.runtime || !this.partReceivesCrush(data.runtime)) continue;
      const toCar = new Matrix4().multiplyMatrices(
        inverse,
        data.mesh.matrixWorld,
      );
      const toMesh = toCar.clone().invert();
      const positions = data.mesh.geometry.getAttribute(
        "position",
      ) as BufferAttribute;
      const references: Vector3[] = [];
      const classes = new Uint8Array(positions.count);
      for (let i = 0; i < positions.count; i++) {
        const point = new Vector3()
          .fromBufferAttribute(positions, i)
          .applyMatrix4(toCar);
        const outer = bend.front
          ? point.z <= bend.pivot.z
          : point.z >= bend.pivot.z;
        const fixed = bend.front ? point.z >= bend.farZ : point.z <= bend.farZ;
        classes[i] = outer ? 2 : fixed ? 0 : 1;
        references.push(
          classes[i] === 1 ? compressedBendReference(point) : point.clone(),
        );
        point.copy(bendPoint(point, bend)).applyMatrix4(toMesh);
        positions.setXYZ(i, point.x, point.y, point.z);
      }
      this.bendVertexReferences.set(data, references);
      this.bendVertexClasses.set(data, classes);
      this.refreshGeometry(data);
    }
    // Extra bend-plane vertices are source hull edge intersections, not an
    // expanded render bounding box. Store their insertion in the same arrays.
    if (this.wam?.version === 4) {
      this.bendShapeReferences = [];
      for (const shape of this.shapes) {
        const edges =
          shape.vertices.length >= 4 ? buildHull(shape.vertices).edges : [];
        const reference = bendHullVertices(
          shape.vertices,
          edges,
          createBendTransform(bend.bounds, bend.pivot, bend.farZ, 0, 0),
        );
        this.bendShapeReferences.push(reference);
        const bent = bendHullVertices(shape.vertices, edges, bend);
        shape.vertices.splice(0, shape.vertices.length, ...bent);
      }
      this.currentCenterOfMass.copy(bendPoint(this.currentCenterOfMass, bend));
    }
    this.currentWheelPositions = this.currentWheelPositions.map((point) =>
      bendPoint(point, bend),
    );
    this.updateWheelGrooveOffsets(bend);
    for (const wheel of this.mechanics?.wheels ?? []) {
      const actor = this.group.getObjectByName(wheel.actor);
      if (!actor || this.wheelGrooveOwnedActors.has(actor)) continue;
      const toCar = new Matrix4().multiplyMatrices(inverse, actor.matrixWorld);
      const original = new Vector3().setFromMatrixPosition(toCar);
      const bent = bendPoint(original, bend);
      const parentInverse = actor.parent
        ? actor.parent.matrixWorld
            .clone()
            .invert()
            .multiply(this.group.matrixWorld)
        : new Matrix4();
      actor.position.copy(bent.applyMatrix4(parentInverse));
      actor.updateMatrix();
    }
    // DamageSystems43?→DoDamage increments10..40; repeat engine until80 or
    //30 attempts, then visit the other units once. Human driver remains immune.
    if (damageComponents) {
      const random = this.damageContext.random ?? Math.random;
      for (let index = 0; index < 12; index++) {
        let attempts = 0;
        do {
          this.componentLevels[index] = applyDamageUnit(
            this.componentLevels[index],
            index,
            mineRandomInteger(
              random,
              this.structuralSettings.damageMinimum,
              this.structuralSettings.damageMaximum,
            ),
            { ...this.damageContext, human },
          );
        } while (
          index === 0 &&
          this.componentLevels[0] < 80 &&
          ++attempts < 30
        );
      }
      this.onWastageCheck?.();
    }
    this.structuralBend = bend;
    if (this.wam?.version === 4) this.pendingShapeSwapFlags |= 0xb;
    this.bentStopBounds.makeEmpty();
    for (const shape of this.shapes)
      for (const point of shape.vertices)
        this.bentStopBounds.expandByPoint(point);
    if (this.bentStopBounds.isEmpty()) this.bentStopBounds.copy(bend.bounds);
    const inset = this.bentStopBounds
      .getSize(new Vector3())
      .multiplyScalar(0.15);
    this.bentStopBounds.min.add(inset);
    this.bentStopBounds.max.sub(inset);
    this.structuralRevision++;
    this.deformationRevision++;
    for (const runtime of this.runtimeParts) this.updatePartBounds(runtime);
  }

  private resetStructuralState(): void {
    if (!this.structuralBend) return;
    this.structuralBend = undefined;
    this.bendVertexReferences.clear();
    this.bendVertexClasses.clear();
    this.bendShapeReferences = [];
    this.currentCenterOfMass.fromArray(
      this.mechanics?.root.centerOfMass ?? [0, 0, 0],
    );
    this.currentWheelPositions = this.originalWheelPositions.map((point) =>
      point.clone(),
    );
    this.updateWheelGrooveOffsets(undefined);
    for (const [actor, transform] of this.wheelTransforms) {
      actor.matrix.copy(transform);
      transform.decompose(actor.position, actor.quaternion, actor.scale);
    }
    this.structuralRevision++;
  }

  private repairStructuralBend(dtMs: number, unitCost: number) {
    const previous = this.structuralBend!;
    const result = stepBendRepair(previous, dtMs);
    const { next, bodyworkRepair, totalDeflection } = result;
    if (bodyworkRepair > 0) {
      this.group.updateMatrixWorld(true);
      const inverse = this.group.matrixWorld.clone().invert();
      const deltaRotation = next.rotation
        .clone()
        .multiply(previous.rotation.clone().invert());
      for (const [data, references] of this.bendVertexReferences) {
        if (data.runtime?.state.phase !== 0) continue;
        const toCar = new Matrix4().multiplyMatrices(
          inverse,
          data.mesh.matrixWorld,
        );
        const toMesh = toCar.clone().invert();
        const positions = data.mesh.geometry.getAttribute(
          "position",
        ) as BufferAttribute;
        const classes = this.bendVertexClasses.get(data)!;
        for (let i = 0; i < positions.count; i++) {
          if (classes[i] === 0) continue;
          const reference = references[i];
          const point = new Vector3()
            .fromBufferAttribute(positions, i)
            .applyMatrix4(toCar);
          if (classes[i] === 2) point.applyMatrix4(deltaRotation);
          else
            point.add(
              bendPoint(reference, next).sub(bendPoint(reference, previous)),
            );
          point.applyMatrix4(toMesh);
          positions.setXYZ(i, point.x, point.y, point.z);
        }
        this.refreshGeometry(data);
      }
      this.shapes.forEach((shape, index) => {
        const references = this.bendShapeReferences[index];
        if (!references) return;
        const points = references.map((point) => bendPoint(point, next));
        if (result.complete) points.length = shape.original.length;
        shape.vertices.splice(0, shape.vertices.length, ...points);
      });
      this.currentCenterOfMass.copy(bendPoint(this.bendCenterReference, next));
      this.currentWheelPositions = this.bendWheelReferences.map((point) =>
        bendPoint(point, next),
      );
      this.updateWheelGrooveOffsets(next);
      for (const [actor, original] of this.wheelTransforms) {
        if (this.wheelGrooveOwnedActors.has(actor)) continue;
        const parent = actor.parent
          ? new Matrix4().multiplyMatrices(inverse, actor.parent.matrixWorld)
          : new Matrix4();
        const point = new Vector3()
          .setFromMatrixPosition(original)
          .applyMatrix4(parent);
        actor.position.copy(
          bendPoint(point, next).applyMatrix4(parent.invert()),
        );
        actor.updateMatrix();
      }
      this.structuralBend = next;
      if (result.complete) this.resetStructuralState();
      else this.structuralRevision++;
      this.deformationRevision++;
      if (this.wam?.version === 4) this.pendingShapeSwapFlags |= 3;
      for (const runtime of this.runtimeParts) this.updatePartBounds(runtime);
    }
    let componentDifference = 0,
      cost = 0;
    if (dtMs > 0)
      for (let i = 0; i < 12; i++) {
        const old = this.componentLevels[i];
        this.componentLevels[i] =
          totalDeflection === 0
            ? 0
            : Math.max(
                0,
                old - Math.floor((old * bodyworkRepair) / totalDeflection),
              );
        componentDifference += old - this.componentLevels[i];
        cost = Math.trunc(cost + (old - this.componentLevels[i]) * unitCost);
      }
    return {
      bodyworkRepair,
      totalDeflection,
      componentDifference,
      cost: 10 * Math.trunc(cost / 10),
      active: bodyworkRepair > 0 || cost > 0,
      repaired: bodyworkRepair > 0 || componentDifference > 0,
      complete: result.complete,
    };
  }

  /** Legacy API treats strength as an already scaled crush-vector magnitude.
   * It has no speed-to-force conversion; simulation uses applyImpact directly. */
  impact(
    localImpactPoint: Vector3,
    direction: Vector3,
    strength: number,
  ): void {
    const crushVector = direction.clone().normalize().multiplyScalar(strength);
    this.applyImpact(
      [localImpactPoint],
      crushVector.clone().multiplyScalar(2),
      false,
      true,
      0,
      crushVector,
    );
  }

  /** TotallySpamTheModel0x431560 directly sends ten random one-point crushes.
   * It bypasses QueueCarCrush admission, car softness and component programs.
   * Physics consumes forcedFullDetach requests and validates splitRequest.
   */
  spamModel(strength: number, timeMs: number, human = true): SpamModelResult {
    const result: SpamModelResult = {
      rays: [],
      maxInfluence: 0,
      detachedParts: [],
    };
    if (
      !this.ready ||
      !this.wam ||
      !this.modelLimits ||
      this.damageContext.invulnerable ||
      this.snapped ||
      this.structuralBend ||
      !Number.isFinite(strength) ||
      !Number.isFinite(timeMs)
    )
      return result;
    const random = this.damageContext.random ?? Math.random;
    // Original IDs are one-based WAM records, including entries with no detach data.
    const selected = new Set(
      Array.from({ length: 10 }, () =>
        mineRandomInteger(random, 1, this.wam!.parts.length),
      ),
    );
    this.group.updateMatrixWorld(true);
    const inverse = this.group.matrixWorld.clone().invert();
    const bounds = new Box3();
    for (const shape of this.shapes)
      for (const point of shape.vertices) bounds.expandByPoint(point);
    if (bounds.isEmpty()) bounds.copy(this.bounds);
    let detachedCount = this.runtimeParts.filter(
      (part) => part.state.phase === 2 || part.forcedFullDetach,
    ).length;
    const detachOrder: DamageRuntimePart[] = [];
    const visit = (actor: Object3D) => {
      actor.children.forEach(visit);
      const runtime = this.runtimeParts.find((part) => part.actor === actor);
      if (runtime) detachOrder.push(runtime);
    };
    // 435d20 is child-first; a selected child can detach before its parent.
    visit(this.group);
    for (const runtime of detachOrder) {
      if (
        runtime.part.type === "boring" ||
        !this.partReceivesCrush(runtime) ||
        detachedCount >= 24 ||
        !selected.has(this.wam.parts.indexOf(runtime.part) + 1)
      )
        continue;
      const toCar = new Matrix4().multiplyMatrices(
        inverse,
        runtime.actor.matrixWorld,
      );
      const position = new Vector3(),
        orientation = new Quaternion();
      toCar.decompose(position, orientation, new Vector3());
      const childCenter = detachedChildCenterOfMass(
        runtime.bounds.min,
        runtime.bounds.max,
        { position, orientation },
        bounds.min,
        bounds.max,
        { position: new Vector3(), orientation: new Quaternion() },
      ).centerOfMass;
      const kick = childCenter
        .applyMatrix4(toCar)
        .sub(this.currentCenterOfMass);
      if (kick.length() <= 2.384185791015625e-7) kick.set(1, 0, 0);
      else kick.normalize();
      kick.multiplyScalar(8 / 6.9);
      // Native4332a0 fully detaches immediately, separately from queue16.
      cancelScheduledDetachment(this.detachmentScheduling, runtime.state);
      runtime.forcedFullDetach = true;
      runtime.detachmentVelocityKick = kick;
      runtime.state.queuedAt = timeMs;
      result.detachedParts.push(runtime);
      detachedCount++;
    }
    // bb1 is captured once before all ten rays; it does not shrink between rays.
    const expanded = bounds.clone().expandByScalar(0.2 / 6.9);
    const force = Math.min(strength * 1.5, 0.5);
    for (let i = 0; i < 10; i++) {
      const face = mineRandomInteger(random, 0, 5),
        axis = face >> 1;
      const start = new Vector3(),
        end = new Vector3();
      start.setComponent(
        axis,
        (face & 1 ? expanded.min : expanded.max).getComponent(axis),
      );
      end.setComponent(
        axis,
        (face & 1 ? expanded.max : expanded.min).getComponent(axis),
      );
      for (let j = 1; j <= 2; j++) {
        const component = (axis + j) % 3;
        const low = expanded.min.getComponent(component),
          high = expanded.max.getComponent(component);
        start.setComponent(component, mineRandomFloat(random, low, high));
        end.setComponent(component, mineRandomFloat(random, low, high));
      }
      const direction = end.sub(start);
      if (direction.length() <= 2.384185791015625e-7) direction.set(1, 0, 0);
      else direction.normalize();
      result.rays.push({
        start: start.clone(),
        direction: direction.clone(),
        force,
      });
      const crushed = this.applyModelCrush(
        [start],
        start,
        direction,
        force,
        timeMs,
        true,
      );
      result.maxInfluence = Math.max(result.maxInfluence, crushed.maxInfluence);
    }
    // GetCarDamage441240 returns remaining condition; clean cars return100.
    const wheelAverage = Math.trunc(
      Array.from(this.componentLevels.slice(8, 12)).reduce(
        (sum, level) => sum + level,
        0,
      ) / 4,
    );
    const groups = [
      this.componentLevels[0],
      this.componentLevels[1],
      this.componentLevels[2],
      wheelAverage,
    ];
    const condition = this.wasted
      ? 0
      : groups.every((level) => level <= 75)
        ? Math.max(
            25,
            100 - Math.trunc(groups.reduce((sum, level) => sum + level, 0) / 4),
          )
        : 100 - Math.max(...groups);
    if (condition >= 75) return result;
    const snapPercent = Math.trunc(this.wam.snappability * 25);
    if (snapPercent !== 0 && mineRandomInteger(random, 0, 99) < snapPercent) {
      const angle = mineRandomFloat(random, 0, Math.PI * 2);
      const normal = new Vector3(Math.sin(angle), 0, Math.cos(angle));
      result.splitRequest = {
        normal,
        constant: normal.dot(bounds.getCenter(new Vector3())),
      };
      return result;
    }
    if (!this.wam.bendability) return result;
    const choice = mineRandomInteger(random, 1, 8);
    const pivot = new Vector3(0, 0, this.wam.bendZMin);
    let farZ = bounds.max.z,
      angleX = 0,
      angleY = 0;
    if (choice <= 2) {
      pivot.y = choice === 1 ? bounds.max.y : bounds.min.y;
      angleX = choice === 1 ? 0xe002 : 0x1ffe;
    } else if (choice <= 4) {
      pivot.x = choice === 3 ? bounds.min.x : bounds.max.x;
      angleY = choice === 3 ? 0xe002 : 0x1ffe;
    } else {
      pivot.copy(bounds.getCenter(new Vector3()));
      pivot.z = this.wam.bendZMax;
      farZ = bounds.min.z;
      angleY = 0x1ffe;
    }
    // Spam passes BendCar's final pDamageSystems argument0, unlike collisions.
    this.applyStructuralBend(
      createBendTransform(bounds, pivot, farZ, angleX, angleY),
      human,
      false,
    );
    result.bendCase = choice;
    return result;
  }

  applyImpact(
    localContacts: Vector3[],
    localEnergyVector: Vector3,
    hitAnotherCar: boolean,
    human: boolean,
    nowMs: number,
    localCrushVector?: Vector3,
    localDamagePoint?: Vector3,
  ) {
    const empty = { componentEvents: [], queuedForce: 0, maxInfluence: 0 };
    if (
      !this.ready ||
      this.damageContext.invulnerable ||
      !localContacts.length ||
      !localEnergyVector.toArray().every(Number.isFinite) ||
      !localContacts.every((point) => point.toArray().every(Number.isFinite))
    )
      return empty;
    const contacts: Vector3[] = [];
    for (const point of localContacts.slice(0, 4)) {
      if (
        !contacts.some(
          (saved) =>
            Math.abs(saved.x - point.x) < 0.005 &&
            Math.abs(saved.y - point.y) < 0.005 &&
            Math.abs(saved.z - point.z) < 0.005,
        )
      )
        contacts.push(point.clone());
    }
    const mean = contacts
      .reduce((sum, point) => sum.add(point), new Vector3())
      .divideScalar(contacts.length);
    const currentBounds = new Box3();
    for (const shape of this.shapes)
      for (const vertex of shape.vertices) currentBounds.expandByPoint(vertex);
    if (currentBounds.isEmpty()) currentBounds.copy(this.bounds);
    const component = this.damagePrograms
      ? applyComponentImpact(this.componentLevels, this.damagePrograms, {
          point: vectorTuple(localDamagePoint ?? mean),
          bounds: {
            min: vectorTuple(currentBounds.min),
            max: vectorTuple(currentBounds.max),
          },
          energyVector: vectorTuple(localEnergyVector),
          hitAnotherCar,
          context: { ...this.damageContext, human },
        })
      : undefined;
    if (
      component?.events.some(
        (event) => event.increment >= 5 && !(human && event.systemIndex === 2),
      )
    )
      this.onWastageCheck?.();
    const vector =
      localCrushVector?.clone() ??
      localEnergyVector.clone().multiplyScalar(human ? 0.5 : 1.5);
    if (!vector.toArray().every(Number.isFinite)) return empty;
    const force = queuedCrushForce(
      vectorTuple(vector),
      this.damagePrograms?.softness ?? 1,
    );
    if (!this.wam || !this.modelLimits || this.snapped)
      return {
        componentEvents: component?.events ?? [],
        queuedForce: force,
        maxInfluence: 0,
      };
    if (this.deferOrdinaryCrush?.(localContacts, vector, human, nowMs))
      return {
        componentEvents: component?.events ?? [],
        queuedForce: force,
        maxInfluence: 0,
      };
    if (!force)
      return {
        componentEvents: component?.events ?? [],
        queuedForce: 0,
        maxInfluence: 0,
      };
    return {
      ...this.applyQueuedCrush(
        contacts,
        mean,
        vector.normalize(),
        force,
        nowMs,
        human,
      ),
      componentEvents: component?.events ?? [],
      queuedForce: force,
    };
  }

  /** Deferred ordinary physical candidates and model damage share one
   * retained contact primitive. Component damage has already been applied. */
  applyQueuedCrush(
    contacts: Vector3[],
    mean: Vector3,
    direction: Vector3,
    force: number,
    nowMs: number,
    human: boolean,
    deferBend = false,
  ): { maxInfluence: number; markedForBend?: boolean } {
    if (!this.wam || !this.modelLimits || this.snapped)
      return { maxInfluence: 0 };
    const currentBounds = new Box3();
    for (const shape of this.shapes)
      for (const vertex of shape.vertices) currentBounds.expandByPoint(vertex);
    if (currentBounds.isEmpty()) currentBounds.copy(this.bounds);
    {
      const structural = selectStructuralBranch({
        mean,
        direction,
        force,
        bendability: this.wam.bendability,
        bendZMin: this.wam.bendZMin,
        bendZMax: this.wam.bendZMax,
        bounds: currentBounds,
        human,
        raceIndex: this.damageContext.raceIndex,
        raceCount: this.damageContext.raceCount,
        random: this.damageContext.random,
        alreadyBent: !!this.structuralBend,
        minimumForce: this.structuralSettings.minimumForce,
        bendingChance: this.structuralSettings.bendingChance,
      });
      if (structural.skipOrdinary) {
        if (structural.markedForBend && !deferBend && !this.structuralBend)
          this.applyDeferredBend(mean, direction, force, nowMs, human);
        return {
          maxInfluence: 0,
          markedForBend: structural.markedForBend,
        };
      }
    }
    return this.applyModelCrush(contacts, mean, direction, force, nowMs);
  }

  /** Called only for native negatively marked events after ordinary crush,
   * shape swapping and detachment. Later marks still resolve their direction
   * and random pivot even when the first eligible event has bent this car. */
  applyDeferredBend(
    mean: Vector3,
    direction: Vector3,
    force: number,
    physicsTickMs: number,
    human: boolean,
    liveBounds?: Box3,
  ): boolean {
    if (!this.wam || this.snapped) return false;
    const bounds = liveBounds?.clone() ?? new Box3();
    if (!liveBounds)
      for (const shape of this.shapes)
        for (const vertex of shape.vertices) bounds.expandByPoint(vertex);
    if (bounds.isEmpty()) bounds.copy(this.bounds);
    const bend = createStructuralBend({
      mean,
      direction,
      force,
      bendability: this.wam.bendability,
      bendZMin: this.wam.bendZMin,
      bendZMax: this.wam.bendZMax,
      bounds,
      human,
      random: this.damageContext.random,
      seedRandom: this.damageContext.seedRandom,
      physicsTickMs,
      minimumForce: this.structuralSettings.minimumForce,
    });
    if (!bend) return false;
    if (!this.structuralBend) this.applyStructuralBend(bend, human);
    // DoBending438c50 consumes this pitch even when BendCar already bent the
    // car on an earlier eligible mark and refuses another geometry change.
    const pitch = mineRandomInteger(
      this.damageContext.random ?? sharedNativeRandom.random,
      0xe000,
      0x12000,
    );
    this.onStructuralBendSound?.(pitch / 0x10000);
    return true;
  }

  /** Shared ordinary vertex/texture/attachment path, without damage programs. */
  private partReceivesCrush(runtime: DamageRuntimePart): boolean {
    if (runtime.state.phase !== 0 || runtime.forcedFullDetach) return false;
    // The native full-detach prepass removes the whole ACT subtree. Physics
    // consumes our request after this method, so exclude its descendants now.
    for (
      let actor = runtime.actor.parent;
      actor && actor !== this.group;
      actor = actor.parent
    )
      if (
        this.runtimeParts.some(
          (part) => part.actor === actor && part.forcedFullDetach,
        )
      )
        return false;
    return true;
  }

  private applyModelCrush(
    contacts: Vector3[],
    mean: Vector3,
    direction: Vector3,
    force: number,
    nowMs: number,
    spam = false,
  ) {
    this.shellModelActive = false;
    const smashQueue =
      this.sharedSmashQueue ?? new NativeSmashQueue<WamSmashQueueContext>();
    let changed = this.crushShapes(contacts, direction, force, spam);
    let maxInfluence = 0;
    this.group.updateMatrixWorld(true);
    const inverse = this.group.matrixWorld.clone().invert();
    for (const runtime of this.runtimeParts) {
      if (!this.partReceivesCrush(runtime)) continue;
      const models = this.meshes.filter((data) => data.runtime === runtime);
      let influence = 0;
      for (const [detail, data] of models.entries()) {
        const toMesh = new Matrix4()
          .multiplyMatrices(inverse, data.mesh.matrixWorld)
          .invert();
        const modelContacts = contacts.map((point) =>
          vectorTuple(point.clone().applyMatrix4(toMesh)),
        );
        const modelMean = mean.clone().applyMatrix4(toMesh);
        const modelDirection = direction.clone().transformDirection(toMesh);
        const position = data.mesh.geometry.getAttribute(
          "position",
        ) as BufferAttribute;
        if (this.structuralBend) {
          const result = crushBentModel({
            positions: position.array,
            contacts: modelContacts,
            movement: vectorTuple(
              modelDirection.multiplyScalar(
                (runtime.part.softnessFactor * Math.min(force, 0.5)) /
                  contacts.length,
              ),
            ),
            stopBounds: {
              min: vectorTuple(this.bentStopBounds.min),
              max: vectorTuple(this.bentStopBounds.max),
            },
          });
          if (result.movedVertices) {
            this.refreshGeometry(data);
            changed = true;
          }
          continue;
        }
        const result = crushModel({
          positions: position.array,
          vertexRegions: data.regions,
          limits: this.modelLimits!,
          contacts: modelContacts,
          direction: vectorTuple(modelDirection),
          meanImpact: vectorTuple(modelMean),
          force,
          softness: runtime.part.softnessFactor,
        });
        if (result.movedVertices) {
          this.refreshGeometry(data);
          changed = true;
        }
        if (detail === 0) {
          influence = result.maxInfluence;
          runtime.strongestVertex =
            data.mesh.geometry.userData.sourceVertexIndices?.[
              result.strongestVertex
            ] ?? result.strongestVertex;
          runtime.strongestDisplacement = result.strongestDisplacement;
          if (runtime.flap && !runtime.part.kevOFlap) {
            const points = this.getPartVertices(runtime);
            const plastic = applyPlasticFlap(runtime.flap, {
              points,
              hinges: runtime.flapHinges,
              checkVertices: runtime.flapCheckVertices,
              direction:
                data.mesh === runtime.actor
                  ? modelDirection
                  : modelDirection.clone().transformDirection(data.mesh.matrix),
              strongestVertex: runtime.strongestVertex,
              displacement: result.strongestDisplacement,
              parentReference: runtime.flapParentReference
                .clone()
                .applyMatrix4(runtime.actor.matrix.clone().invert()),
              random: this.damageContext.random,
              seedRandom: this.damageContext.seedRandom,
              physicsTickMs: nowMs,
              inverseBucklePercent:
                this.structuralSettings.inverseBucklePercent,
            });
            if (plastic.movedVertices) {
              this.writePartVertices(runtime, points);
              changed = true;
            }
            if (plastic.activated) {
              for (const model of models)
                for (const saved of model.materials) {
                  saved.material.side = DoubleSide;
                  saved.material.needsUpdate = true;
                }
            }
            if (plastic.angleChanged) this.updateFlapTransform(runtime, points);
          }
        }
        for (const smash of runtime.part.smashes) {
          for (const saved of data.materials) {
            if (
              saved.material.name.toLowerCase() !== smash.material.toLowerCase()
            )
              continue;
            const magnitude = crushSmashMagnitude(
              force,
              runtime.part.softnessFactor,
              contacts.length,
              vectorTuple(saved.centroid),
              vectorTuple(modelMean),
            );
            const oldLevel = this.smashLevels.get(smash) ?? 0;
            let level = oldLevel;
            smash.levels.forEach((candidate, index) => {
              if (candidate.threshold <= magnitude && index + 1 > level)
                level = index + 1;
            });
            if (level <= oldLevel) continue;
            const event = {
              smash,
              part: runtime.part,
              actor: runtime.actor,
              bodyActor: this.group,
              mesh: data.mesh,
              localPoint: mean.clone(),
              localDirection: direction.clone(),
              startingVelocity:
                this.readSmashStartingVelocity?.().clone() ?? new Vector3(),
              timeMs: nowMs,
              oldLevel,
              targetLevel: level,
            };
            smashQueue.enqueue({
              key: smash,
              targetTier: level,
              getReachedTier: () => this.smashLevels.get(smash) ?? 0,
              getLevelCount: () => smash.levels.length + 1,
              hasModel: () => !!data.mesh.geometry.getAttribute("position"),
              context: {
                execute: (targetLevel, oldLevel, timeMs) =>
                  this.dispatchWamSmash({
                    ...event,
                    targetLevel,
                    oldLevel,
                    timeMs,
                  }),
              },
            });
          }
        }
      }
      maxInfluence = Math.max(maxInfluence, influence);
      this.updatePartBounds(runtime);
      if (runtime.part.type !== "boring" && runtime.part.ease) {
        accumulateSharedDetachmentForce(
          this.detachmentScheduling,
          runtime.state,
          Math.min(force, 0.5) / contacts.length,
          influence,
          detachmentThreshold(runtime.part.ease),
          nowMs,
        );
      }
    }
    if (!this.sharedSmashQueue)
      flushWamSmashQueue(smashQueue, () => Math.round(nowMs) >>> 0);
    if (changed) this.deformationRevision++;
    return { maxInfluence };
  }

  private dispatchWamSmash(
    event: Omit<WamSmashEvent, "connotations" | "repetition" | "repetitions">,
  ): void {
    // A later LOD/contact can raise the queued target. Bring every linked
    // material to that final tier before any effect callback observes it.
    for (const data of this.meshes) {
      if (data.runtime?.part !== event.part) continue;
      for (const saved of data.materials) {
        if (
          saved.material.name.toLowerCase() !==
            event.smash.material.toLowerCase() ||
          saved.level === event.targetLevel
        )
          continue;
        saved.level = event.targetLevel;
        const replacement = event.smash.levels[event.targetLevel - 1].pixelmaps
          .map((name) => this.textures.get(textureKey(name)))
          .find(Boolean);
        if (!replacement) continue;
        const texture = replacement.clone();
        if (saved.map) {
          texture.matrixAutoUpdate = saved.map.matrixAutoUpdate;
          texture.matrix.copy(saved.map.matrix);
        }
        if (saved.material.map && saved.material.map !== saved.map)
          saved.material.map.dispose();
        saved.material.map = texture;
        saved.material.needsUpdate = true;
      }
    }
    this.smashLevels.set(event.smash, event.targetLevel);
    const crossed = event.smash.levels.slice(event.oldLevel, event.targetLevel);
    const repetitions = crossed.filter(
      (level) => !(level.flags & 1) || event.targetLevel - event.oldLevel === 1,
    ).length;
    const connotations = event.smash.levels[event.targetLevel - 1].connotations;
    for (let repetition = 0; repetition < repetitions; repetition++)
      this.onWamSmash?.({
        ...event,
        connotations,
        repetition,
        repetitions,
        localPoint: event.localPoint.clone(),
        localDirection: event.localDirection.clone(),
      });
  }

  private crushShapes(
    contacts: Vector3[],
    direction: Vector3,
    force: number,
    spam = false,
  ): boolean {
    if (this.wam?.version !== 4 || !this.physicsLimits || this.structuralBend)
      return false;
    const reduced = new Vector3(0, Math.min(direction.y, 0), direction.z);
    const ratio = reduced.length();
    if ((spam ? ratio * force : ratio) < 0.00001) return false;
    reduced.divideScalar(ratio);
    const tuples = contacts.map(vectorTuple);
    let changed = false;
    for (const shape of this.shapes)
      for (let i = 0; i < shape.vertices.length; i++) {
        const point = shape.vertices[i];
        const values = new Float64Array(point.toArray());
        const before = point.clone();
        crushModel({
          positions: values,
          vertexRegions: Uint16Array.of(shape.regions[i]),
          limits: this.physicsLimits,
          contacts: tuples,
          direction: vectorTuple(reduced),
          force: Math.min(force, 0.5) * ratio,
          softness: shape.softness[i],
        });
        point.fromArray(values);
        for (let axis = 0; axis < 3; axis++) {
          const bits = shape.regions[i] >>> (axis * 4);
          const min = this.physicsLimits[axis].min[bits & 3];
          const max = this.physicsLimits[axis].max[(bits >>> 2) & 3];
          const value = point.getComponent(axis);
          point.setComponent(
            axis,
            value < min ? min : value > max ? max : value,
          );
        }
        if (!point.equals(before)) changed = true;
      }
    // Spam's native root callback sets7 after visiting the vertices, even when
    // packed stop planes prevent all movement. Preserve ordinary admission.
    if (changed || spam) this.pendingShapeSwapFlags |= 7;
    return changed;
  }

  private repairModelCoordinates(
    data: DamageMesh,
    step: number,
    move: boolean,
  ) {
    const position = data.mesh.geometry.getAttribute(
      "position",
    ) as BufferAttribute;
    const sourceIndices = data.mesh.geometry.userData.sourceVertexIndices as
      | Uint32Array
      | undefined;
    const counted = new Set<number>();
    let deflection = 0,
      repaired = 0;
    for (let i = 0; i < position.array.length; i++) {
      const difference = data.repairTarget[i] - position.array[i];
      const coordinate =
        (sourceIndices?.[Math.floor(i / 3)] ?? Math.floor(i / 3)) * 3 + (i % 3);
      const first = !counted.has(coordinate);
      counted.add(coordinate);
      if (first) deflection += Math.abs(difference);
      if (!move) continue;
      const previous = position.array[i];
      position.array[i] +=
        Math.sign(difference) * Math.min(Math.abs(difference), step);
      if (first) repaired += Math.abs(position.array[i] - previous);
    }
    if (repaired > 0) this.refreshGeometry(data);
    return { deflection, repaired };
  }

  /** Source43b360 principal-model no-movement branch resets smash history,
   * accumulated detach force and plastic buckling, then skips the other LODs.
   * It leaves the active hinge angle alone until the whole car stops repairing. */
  private finishPrincipalModelRepair(
    runtime: DamageRuntimePart,
    models: DamageMesh[],
  ): boolean {
    for (const smash of runtime.part.smashes) this.smashLevels.delete(smash);
    runtime.state.accumulatedForce = 0;
    runtime.strongestVertex = -1;
    runtime.strongestDisplacement = 0;
    if (runtime.flap && !runtime.part.kevOFlap) {
      runtime.flap.buckled = false;
      runtime.flap.plastic = true;
      runtime.flap.plasticOffset = 0;
    }
    let changed = false;
    for (const data of models)
      for (const saved of data.materials) {
        changed ||= saved.level !== 0 || saved.material.map !== saved.map;
        if (saved.material.map && saved.material.map !== saved.map)
          saved.material.map.dispose();
        saved.material.map = saved.map;
        saved.material.needsUpdate = true;
        saved.level = 0;
      }
    return changed;
  }

  /** Held repair: HW RepairCar2 0x43abd0 / RepairModel 0x43b400 move each
   * coordinate toward its saved original at .00005 model units/ms. Component
   * recovery follows repaired L1 deflection / initial L1 deflection; controls
   * bills recovered unit levels, with GENERAL Medium cost20 credits/unit.
   * The simulation still owns safe hull swaps and destruction/credit gating.
   */
  repairStep(dtMs: number, unitCost = 20) {
    // Source43abd0 rejects snapped cars; TotallyRepairCar43? can reunite them.
    if (this.snapped || this.shellModelActive)
      return {
        bodyworkRepair: 0,
        totalDeflection: 0,
        componentDifference: 0,
        cost: 0,
        active: false,
        repaired: false,
        complete: false,
      };
    if (this.structuralBend) return this.repairStructuralBend(dtMs, unitCost);
    const step = Math.max(0, dtMs) * 0.00005;
    let totalDeflection = 0;
    let bodyworkRepair = 0;
    let changed = false;
    for (const runtime of this.runtimeParts) {
      const models = this.meshes.filter((data) => data.runtime === runtime);
      if (!models.length) continue;
      if (runtime.state.phase === 2) {
        // Free bits contribute all remaining LOD deflection, but do not move.
        for (const model of models)
          totalDeflection += this.repairModelCoordinates(
            model,
            step,
            false,
          ).deflection;
        continue;
      }
      const principal = this.repairModelCoordinates(models[0], step, true);
      totalDeflection += principal.deflection;
      bodyworkRepair += principal.repaired;
      changed ||= principal.repaired > 0;
      if (principal.repaired === 0) {
        changed = this.finishPrincipalModelRepair(runtime, models) || changed;
        continue;
      }
      for (const model of models.slice(1)) {
        const result = this.repairModelCoordinates(model, step, true);
        totalDeflection += result.deflection;
        bodyworkRepair += result.repaired;
        changed ||= result.repaired > 0;
      }
    }
    for (const shape of this.shapes)
      shape.vertices.forEach((point, index) => {
        if (!shape.original[index]) return;
        for (let axis = 0; axis < 3; axis++) {
          const difference =
            shape.original[index].getComponent(axis) - point.getComponent(axis);
          const amount =
            Math.sign(difference) * Math.min(Math.abs(difference), step);
          if (amount) {
            point.setComponent(axis, point.getComponent(axis) + amount);
            changed = true;
            this.pendingShapeSwapFlags |= 3;
          }
        }
      });
    if (totalDeflection === 0 && dtMs > 0 && this.structuralBend) {
      for (const shape of this.shapes)
        shape.vertices.splice(
          0,
          shape.vertices.length,
          ...shape.original.map((point) => point.clone()),
        );
      this.resetStructuralState();
      changed = true;
    }
    // When the current tree stops moving, original repair reattaches remaining
    // bits. Their geometry enters next tick's tree rather than snapping now.
    if (bodyworkRepair === 0 && dtMs > 0) {
      // Source43abd0 clears the whole global detach queue here, unlike full
      // repair's car-specific removal. Other cars retain force/timestamp history.
      for (const state of this.detachmentScheduling.queued)
        cancelScheduledDetachment(this.detachmentScheduling, state);
      for (const runtime of this.runtimeParts) {
        if (runtime.forcedFullDetach) {
          cancelScheduledDetachment(this.detachmentScheduling, runtime.state);
          runtime.forcedFullDetach = false;
          runtime.detachmentVelocityKick = undefined;
          changed = true;
        }
        if (runtime.state.phase !== 0) {
          runtime.originalParent.add(runtime.actor);
          runtime.actor.matrix.copy(runtime.originalTransform);
          runtime.originalTransform.decompose(
            runtime.actor.position,
            runtime.actor.quaternion,
            runtime.actor.scale,
          );
          resetAttachmentState(runtime.state);
          runtime.forcedFullDetach = false;
          runtime.detachmentVelocityKick = undefined;
          changed = true;
        }
        if (runtime.flap && !runtime.part.kevOFlap && runtime.flap.active) {
          runtime.flap.active = false;
          runtime.flap.angleUnits = runtime.flap.minAngleUnits = 0;
          runtime.flap.maxAngleUnits = runtime.flap.spanUnits = 0x3ffc;
          runtime.actor.matrix.copy(runtime.originalTransform);
          runtime.originalTransform.decompose(
            runtime.actor.position,
            runtime.actor.quaternion,
            runtime.actor.scale,
          );
          changed = true;
        }
      }
      for (const data of this.meshes)
        if (data.runtime)
          for (const saved of data.materials)
            saved.material.side = saved.originalSide;
      if (totalDeflection === 0) this.shellModelActive = true;
      if (changed) this.repairRevision++;
    }
    let componentDifference = 0;
    let cost = 0;
    if (dtMs > 0) {
      for (let i = 0; i < this.componentLevels.length; i++) {
        const previous = this.componentLevels[i];
        const next =
          totalDeflection === 0
            ? 0
            : Math.max(
                0,
                previous -
                  Math.floor((previous * bodyworkRepair) / totalDeflection),
              );
        this.componentLevels[i] = next;
        componentDifference += previous - next;
        cost = Math.trunc(cost + (previous - next) * unitCost);
      }
    }
    if (changed) this.deformationRevision++;
    for (const runtime of this.runtimeParts) this.updatePartBounds(runtime);
    this.group.updateMatrixWorld(true);
    const progress = bodyworkRepair || (totalDeflection > 0 ? 1.1920929e-7 : 0);
    return {
      bodyworkRepair: progress,
      totalDeflection,
      componentDifference,
      cost: 10 * Math.trunc(cost / 10),
      active: progress > 0 || cost > 0,
      repaired: bodyworkRepair > 0 || componentDifference > 0 || changed,
      complete: totalDeflection === 0 && this.detachQueue.length === 0,
    };
  }

  repair(): void {
    this.cancelQueuedSpam?.();
    this.smashLevels.clear();
    this.restoreSplit();
    for (const runtime of this.runtimeParts) {
      runtime.originalParent.add(runtime.actor);
      runtime.actor.matrix.copy(runtime.originalTransform);
      runtime.originalTransform.decompose(
        runtime.actor.position,
        runtime.actor.quaternion,
        runtime.actor.scale,
      );
      cancelScheduledDetachment(this.detachmentScheduling, runtime.state);
      resetAttachmentState(runtime.state);
      runtime.forcedFullDetach = false;
      runtime.detachmentVelocityKick = undefined;
      if (runtime.flap)
        runtime.flap = createFlapState(
          runtime.originalVertices[runtime.flapHinges[1]],
          runtime.originalVertices[runtime.flapHinges[2]],
        );
    }
    for (const data of this.meshes) {
      const position = data.mesh.geometry.getAttribute(
        "position",
      ) as BufferAttribute;
      position.array.set(data.runtime ? data.repairTarget : data.original);
      this.refreshGeometry(data);
      for (const saved of data.materials) {
        if (saved.material.map && saved.material.map !== saved.map)
          saved.material.map.dispose();
        saved.material.map = saved.map;
        saved.material.side = saved.originalSide;
        saved.material.needsUpdate = true;
        saved.level = 0;
      }
    }
    for (const shape of this.shapes)
      shape.vertices.splice(
        0,
        shape.vertices.length,
        ...shape.original.map((point) => point.clone()),
      );
    this.resetStructuralState();
    for (const runtime of this.runtimeParts) this.updatePartBounds(runtime);
    this.componentLevels.fill(0);
    this.lastComponentLevels.fill(0);
    this.shellModelActive = true;
    this.repairRevision++;
    this.deformationRevision++;
    if (this.wam?.version === 4) this.pendingShapeSwapFlags |= 3;
    this.group.updateMatrixWorld(true);
  }
}
