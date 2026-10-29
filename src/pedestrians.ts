import { NativePedSlickMaterialRegistry } from "./ped-slick-materials";
import { createNativeRenderMaterial } from "./native-material-render";
import { OrdinaryPedRuntime } from "./ped-ordinary-runtime";
import { parseNativePedGoreOption } from "./ped-gore-options";
import { loadNativePedSmearMaterial } from "./ped-smear-material";
import type { ShardRuntime } from "./smash-shards";
import type { SkidMarkSystem } from "./skidmarks";
import type { NativePedRuntimeCallback } from "./ped-native-runtime";
import type { NativePedBloodPacket } from "./ped-native-blood-phases";
import {
  parsePedContactSettings,
  type PedContactSettings,
} from "./physics/ped-contact";
import {
  parseNativePedNoiseGroups,
  nativePedNoiseDiagnostics,
  type NativePedNoiseGroups,
} from "./ped-noise";
import type { VehicleSimulation } from "./physics/simulation";
import type { NativePedPopulationEntry } from "./ped-native-population";
import { parsePedMotion } from "./ped-motion";
import { parsePedPersonalityOptions } from "./ped-form";
export { parsePedMotion } from "./ped-motion";
export type { PedMotion } from "./ped-motion";
import * as THREE from "three";
import { Assets } from "./content";
import { loadNativePedAssets, type NativePedAssets } from "./ped-native-assets";
import { NativePedPresentation } from "./ped-presentation";
import { NativePedRenderEffects } from "./ped-render-effects";
import {
  NativePedDeadMaterialRegistry,
  prepareNativePedDeadModels,
  type NativePedDeadModels,
} from "./ped-dead-models";
import {
  readNativePedMoveFSM,
  planNativePedMove,
  type NativePedMoveFSM,
} from "./ped-move-fsm";
import { WorldCollision } from "./world";
import {
  DEFAULT_PED_SETTINGS,
  PED_POPULATION_CAPACITY,
  PedAction,
  parsePedSettings,
  pedFacePopulation,
  pedFloorAllowed,
  pedMaterialKey,
  pedObstacleIgnored,
  pedTrianglePoint,
  predictPedThreat,
  pedRandomFloat,
  pedRandomInteger,
  pedTurnDuration,
  pedInterpolateDirection,
  nativePedSlopeCosine,
} from "./ped-rules";
import type { PedMovement, PedSettings, PedThreat } from "./ped-rules";
import { PedBloodRuntime, parsePedBloodSettings } from "./ped-blood";
import {
  emptyPedProximity,
  pedFaceCacheBox,
  pedFaceInsideCache,
  scanPedProximity,
  selectPedAvoidanceDirection,
  PED_FACE_CACHE_CAPACITY,
} from "./ped-proximity";
import type { PedProximity } from "./ped-proximity";
import type { Surface as WorldSurface } from "./world";
import {
  pedestrianRepulsionImpulse,
  repulsionParameters,
  selectCombatPedestrians,
  selectNapalmTarget,
  electricRayHits,
  stepNapalmMotion,
  NAPALM_CAPACITY,
  NAPALM_BURN_MS,
} from "./combat-powerups";
import type { NapalmMotion } from "./combat-powerups";
import { NativeRandom, sharedNativeRandom } from "./native-random";
import { parsePix } from "./formats";
import { ExplosionRuntime, parseWastedExplosionSettings } from "./explosion";
import type { SmashExplosion } from "./world-smash";
import {
  PED_COUNTED_FLAG,
  PedPopulationAccounting,
} from "./ped-population-accounting";
import { pedestrianMapEligible, type PedestrianMapPolicy } from "./ped-map";
export { PedAction } from "./ped-rules";
export type { PedThreat } from "./ped-rules";

export interface PedSpawnSpec {
  material: string;
  movement: number;
  group: number;
  density: number;
  exclusions: string[];
  exclusionFlags?: number[];
  exceptions: string[];
}
export interface PedHitEvent {
  /** Simulation clock, unaffected by frozen race countdown. */
  timeMs: number;
  /** Original spawn group index, used by SmashAndPed mission accounting. */
  group: number;
  count: number;
  total: number;
  speed: number;
  position: THREE.Vector3;
  owner?: object;
  cause?: "vehicle" | "annihilator" | "electric" | "napalm" | "environment";
  /** Native cache score inputs, retained independently of the eventual killer. */
  awardContext: {
    cachePresent: boolean;
    cacheFlags: number;
    height: number;
    napalmDeadlineMs: number;
    pedVelocity?: THREE.Vector3;
    pedStartingVelocity?: THREE.Vector3;
  };
}
export interface PedCountEvent {
  timeMs: number;
  group: number;
  count: 1;
  total: number;
  actor: THREE.Object3D;
  source: "ordinary" | "native";
}
export interface NativePedCountingCharacter {
  flags: number;
  body?: { pedestrianFlags: number } | null;
}
export interface PedCombatSource {
  /** Native car.pos: live world centre of mass in raw actor units. */
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** Raw special-volume multiplier, not global low-gravity powerup state. */
  gravityMultiplier?: number;
  pedestrianAnimation?: {
    bodyScale: readonly [number, number, number];
    headScale: number;
    mutantSpeed: number;
    revision: number;
  };
  goreLevel?: number;
  owner?: object;
  /** Repulse links retain native pointers to live world COM positions. */
  readPosition?: () => THREE.Vector3;
  /** Live car origin including native local downward model-height/5 offset. */
  readRayOrigin?: () => THREE.Vector3;
}
export type PedGround = (x: number, z: number, nearY: number) => number | null;
export interface PedOptions {
  shards?: ShardRuntime;
  skidmarks?: SkidMarkSystem;
  /** Match the selected Stock/Advanced race resource tree. */
  dataRoot?: "data" | "adv_data";
  nativePopulation?: readonly NativePedPopulationEntry[];
  nativeMaterials?: ReadonlyMap<string, import("./formats").MatMaterial | null>;
  onNoiseSound?: (id: number, position: THREE.Vector3) => void;
  spawn: THREE.Vector3;
  /** Explicit test/debug override; production uses the original 2000 cap. */
  maxCount?: number;
  random?: () => number;
  /** Combat calls share the native CRT stream; population/movement retain their own stream. */
  combatRandom?: () => number;
  readGravityMultiplier?: (position: THREE.Vector3) => number | undefined;
  collision?: Pick<WorldCollision, "raycast"> &
    Partial<Pick<WorldCollision, "querySurfaces">>;
  onHit?: (event: PedHitEvent) => void;
  /** Normal Kill counts before scoring; the original inactive-burning score
   * caller precedes its later vanish/count. This outlet always sees committed counts. */
  onCount?: (event: PedCountEvent) => void;
  onNapalmIgnited?: (
    actor: THREE.Object3D,
    velocity: THREE.Vector3,
    omega: THREE.Vector3,
  ) => void;
  onNapalmExtinguished?: (actor: THREE.Object3D) => void;
  onCombatSound?: (id: 3701 | 3702, position: THREE.Vector3) => void;
}
type PedAssets = Pick<Assets, "manifest" | "scene" | "text" | "bytes">;
const clean = (text: string) =>
  text
    .split(/\r?\n/)
    .map((s) => s.replace(/\/\/.*$/, "").trim())
    .filter(Boolean);
const normalized = (name: string) =>
  name.replace(/\.(mat|dat|act)$/i, "").toLowerCase();

/** Read the commented pedestrian section without changing the other track parsers. */
export function parsePedSpawnSpecs(text: string): PedSpawnSpec[] {
  const marker = /\/\/\s*Ped(?:estrian)?\s+specs\b/i.exec(text);
  if (!marker) return [];
  const lines = clean(text.slice(marker.index + marker[0].length));
  let at = 0;
  const integer = () => {
    const n = Number(lines[at++]);
    if (!Number.isInteger(n) || n < 0 || n > 1000)
      throw new Error("Invalid pedestrian config count");
    return n;
  };
  const count = integer(),
    specs: PedSpawnSpec[] = [];
  for (let i = 0; i < count; i++) {
    const material = lines[at++],
      movement = integer(),
      group = integer(),
      density = Number(lines[at++]);
    if (!material || !Number.isFinite(density) || Math.abs(density) > 1000)
      throw new Error("Invalid pedestrian spawn specification");
    const exclusions: string[] = [],
      exceptions: string[] = [],
      exclusionFlags: number[] = [];
    const exclusionCount = integer();
    for (let j = 0; j < exclusionCount; j++) {
      exclusionFlags.push(integer());
      exclusions.push(lines[at++]);
    }
    const exceptionCount = integer();
    for (let j = 0; j < exceptionCount; j++) exceptions.push(lines[at++]);
    if ([...exclusions, ...exceptions].some((s) => !s))
      throw new Error("Truncated pedestrian material lists");
    specs.push({
      material,
      movement,
      group,
      density,
      exclusions,
      exclusionFlags,
      exceptions,
    });
  }
  return specs;
}

/** Group IDs in settings.txt choose original pedestrian personalities. */
export function parsePedGroups(text: string): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const markers = [...text.matchAll(/\/\/\s*Group\s*#(\d+)\b/gi)];
  markers.forEach((match, i) => {
    const lines = clean(
      text.slice(match.index! + match[0].length, markers[i + 1]?.index),
    );
    const count = Number(lines[0]);
    if (
      Number.isInteger(count) &&
      count >= 0 &&
      count <= 100 &&
      lines.length > count
    ) {
      out.set(Number(match[1]), lines.slice(1, count + 1));
    }
  });
  return out;
}

interface Surface {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  spec: PedSpawnSpec;
  count: number;
  nativeSpawn?: NativePedPopulationEntry;
}
interface Limb {
  object: THREE.Group;
  side: number;
  kind: "arm" | "leg" | "knee";
}
export interface Ped {
  personality: string;
  nativeObjective?: boolean;
  nativeCountingCharacter?: NativePedCountingCharacter;
  object: THREE.Group;
  visual: THREE.Group;
  presentation?: NativePedPresentation;
  limbs: Limb[];
  footOffset: number;
  home: THREE.Vector3;
  initialYaw: number;
  heading: number;
  phase: number;
  alive: boolean;
  vanished: boolean;
  fallTime: number;
  velocity: THREE.Vector3;
  spec: PedSpawnSpec;
  movement: PedMovement;
  walkPeriod: number;
  nextTurnMs: number;
  lastScareMs: number;
  firstScareMs: number;
  nextAvoidMs: number;
  turnFrom: number;
  turnTo: number;
  turnStart: number;
  turnEnd: number;
  actionSinceMs: number;
  runPeriod: number;
  action: PedAction;
  moveId: number;
  active: boolean;
  corporeal: boolean;
  angularVelocity: THREE.Vector3;
  networkStateCutoffMs: number;
  combatOwner?: object;
  /** Cache+2e cause bits survive subsequent ray callbacks until cache reset. */
  awardCauseFlags: number;
  startingVelocity: THREE.Vector3;
  burningUntilMs: number;
  napalmSlot: number;
  settled: boolean;
  deadModelSet?: 0 | 1;
  profile: PedProfile;
  proximity: PedProximity;
  faceCache?: {
    box: ReturnType<typeof pedFaceCacheBox>;
    faces: WorldSurface[];
  };
}
export interface PedProfile {
  available: Set<number>;
  movePeriod: Map<number, number>;
  groundingOffset: Map<number, number>;
  bounds: THREE.Box3;
  jumpHeight: number;
  moveDistance: Map<number, number>;
  moveDuration: Map<number, number>;
  mass: number;
}
export interface PedFrameOptions {
  cameraPosition?: THREE.Vector3;
  threats?: readonly PedThreat[];
  gameTimeMs?: number;
  physicsTickMs?: number;
  /** Full native outer-frame period; bolt movement is not physics-step capped. */
  framePeriodMs?: number;
  electricRayDistanceSquared?: number;
  combatOwner?: object;
  /** Native car.pos is the live world centre of mass, not actor translation. */
  combatPosition?: THREE.Vector3;
  readCombatRayOrigin?: () => THREE.Vector3;
  cameraOrientation?: THREE.Quaternion;
  immortalPedestrians?: boolean;
  gravityMultiplier?: number;
  pedestrianAnimation?: {
    bodyScale: readonly [number, number, number];
    headScale: number;
    mutantSpeed: number;
    revision: number;
  };
  goreLevel?: number;
  readGravityMultiplier?: (position: THREE.Vector3) => number | undefined;
}
interface PedCombatRay {
  startMs: number;
  source: PedCombatSource;
  target: Ped;
  object: THREE.Line;
}
interface PedRepulseRay {
  startMs: number;
  readSourcePosition: () => THREE.Vector3;
  readTargetPosition: () => THREE.Vector3;
  innerRadius: number;
  outerRadius: number;
  source?: PedCombatSource;
  target?: Ped;
}
interface PedNapalmBolt extends NapalmMotion {
  target: Ped;
  source: PedCombatSource;
  flames: THREE.Vector3[];
}
const NAPALM_FLAME_SCALES = [0.275, 0.2245, 0.2, 0.175, 0.15, 0.075, 0.05];

/** Reparent the original rigid body parts around anatomical joints.
 * Their DAT vertices are in the exported T pose and already have the right UVs. */
function rigPedestrian(visual: THREE.Group): {
  limbs: Limb[];
  footOffset: number;
} {
  const parts = new Map<string, THREE.Object3D>();
  visual.updateMatrixWorld(true);
  visual.traverse((o) => {
    if (o instanceof THREE.Mesh && /^[LR](TOP|BOT)[AL]/i.test(o.name))
      parts.set(o.name.toUpperCase().slice(0, 5), o.parent!);
  });
  const limbs: Limb[] = [];
  for (const side of ["L", "R"])
    for (const kind of ["A", "L"]) {
      const upper = parts.get(`${side}TOP${kind}`),
        lower = parts.get(`${side}BOT${kind}`);
      if (!upper) continue;
      const box = new THREE.Box3().setFromObject(upper),
        center = box.getCenter(new THREE.Vector3());
      const sign = side === "L" ? 1 : -1;
      const anchor =
        kind === "A"
          ? new THREE.Vector3(
              sign > 0 ? box.min.x : box.max.x,
              center.y,
              center.z,
            )
          : new THREE.Vector3(center.x, box.max.y, center.z);
      const pivot = new THREE.Group();
      pivot.name = `ped-${side}-${kind}-joint`;
      visual.add(pivot);
      pivot.position.copy(anchor);
      pivot.updateMatrixWorld(true);
      pivot.attach(upper);
      limbs.push({
        object: pivot,
        side: sign,
        kind: kind === "A" ? "arm" : "leg",
      });
      if (lower) {
        const lowerBox = new THREE.Box3().setFromObject(lower),
          lowerCenter = lowerBox.getCenter(new THREE.Vector3());
        const joint =
          kind === "A"
            ? new THREE.Vector3(
                sign > 0 ? lowerBox.min.x : lowerBox.max.x,
                lowerCenter.y,
                lowerCenter.z,
              )
            : new THREE.Vector3(lowerCenter.x, lowerBox.max.y, lowerCenter.z);
        const lowerPivot = new THREE.Group();
        lowerPivot.name = `ped-${side}-${kind}-lower`;
        pivot.add(lowerPivot);
        lowerPivot.position.copy(joint.sub(anchor));
        lowerPivot.updateMatrixWorld(true);
        lowerPivot.attach(lower);
        if (kind === "L")
          limbs.push({ object: lowerPivot, side: sign, kind: "knee" });
      }
      if (kind === "A") pivot.rotation.z = -sign * 1.35;
    }
  visual.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(visual);
  return { limbs, footOffset: -bounds.min.y + 0.005 };
}

/** Visits original face order with an independent remainder for each spawn set. */
export function collectPedSurfaces(
  track: THREE.Object3D,
  specs: PedSpawnSpec[],
  maxSlopeDegrees = 25,
): Surface[] {
  const byMaterial = new Map(specs.map((s) => [pedMaterialKey(s.material), s]));
  const carry = new Map<PedSpawnSpec, number>();
  const out: Surface[] = [];
  track.updateMatrixWorld(true);
  track.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geometry = o.geometry,
      pos = geometry.getAttribute("position"),
      index = geometry.index;
    if (!pos) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    const sourceFaces = geometry.userData.sourceFaces as
      | Array<{ material: number }>
      | undefined;
    const sourceSlots = sourceFaces
      ? [...new Set(sourceFaces.map((face) => face.material))]
      : [];
    const faces: Array<{ indices: number[]; material: THREE.Material }> = [];
    if (sourceFaces && pos.count === sourceFaces.length * 3) {
      // Render indices are batched by material. Recover original face order so
      // reaching the2000 cap cannot favor an entire material batch.
      sourceFaces.forEach((face, i) =>
        faces.push({
          indices: [i * 3, i * 3 + 1, i * 3 + 2],
          material: materials[sourceSlots.indexOf(face.material)],
        }),
      );
    } else {
      const groups = geometry.groups.length
        ? geometry.groups
        : [{ start: 0, count: index?.count ?? pos.count, materialIndex: 0 }];
      for (const group of groups)
        for (let i = group.start; i < group.start + group.count; i += 3)
          faces.push({
            indices: [0, 1, 2].map((j) => (index ? index.getX(i + j) : i + j)),
            material: materials[group.materialIndex ?? 0],
          });
    }
    for (const face of faces) {
      const spec = byMaterial.get(pedMaterialKey(face.material?.name ?? ""));
      if (!spec || spec.density === 0) continue;
      const [a, b, c] = face.indices.map((i) =>
        new THREE.Vector3()
          .fromBufferAttribute(pos, i)
          .applyMatrix4(o.matrixWorld),
      );
      const cross = b.clone().sub(a).cross(c.clone().sub(a));
      if (
        !cross.lengthSq() ||
        cross.y / cross.length() <= nativePedSlopeCosine(maxSlopeDegrees)
      )
        continue;
      const population = pedFacePopulation(
        Math.abs(cross.y) / 2,
        spec.density,
        carry.get(spec) ?? 0,
      );
      carry.set(spec, population.carry);
      if (population.count)
        out.push({ a, b, c, spec, count: population.count });
    }
  });
  return out;
}

/** Form/default move metadata supplies root displacement and periods even while
 * the visual BON/SKL remapping remains the separate ANI-01 work item. */
async function loadPedProfile(
  assets: PedAssets,
  name: string,
  dataRoot: "data" | "adv_data" = "data",
  native?: NativePedAssets,
): Promise<PedProfile> {
  const profile: PedProfile = {
    available: new Set(),
    movePeriod: new Map(),
    groundingOffset: new Map(),
    bounds: new THREE.Box3(
      new THREE.Vector3(-0.065, -0.15, -0.03),
      new THREE.Vector3(0.065, 0.135, 0.03),
    ),
    jumpHeight: 0,
    moveDistance: new Map(),
    moveDuration: new Map(),
    mass: 0.068,
  };
  try {
    const personality = clean(
      await assets.text(`${dataRoot}/PEDS/PEEPS/${name}/${name}.TXT`),
    );
    const formText = await assets.text(
        `${dataRoot}/PEDS/FORMS/${personality[0]}.TXT`,
      ),
      form = clean(formText);
    const moveStart = form.indexOf("START OF MOVES"),
      moveEnd = form.indexOf("END OF MOVES", moveStart);
    const defaults = clean(
      await assets.text(`${dataRoot}/PEDS/MOVES/${personality[1]}.TXT`),
    );
    const scales = new Map<number, number>();
    for (const source of [defaults, personality]) {
      const start = source.indexOf("START OF MOVES"),
        end = source.indexOf("END OF MOVES", start);
      for (let i = start + 1; start >= 0 && i < end; i += 4) {
        scales.set(Number(source[i]), Number(source[i + 1]));
        profile.groundingOffset.set(Number(source[i]), Number(source[i + 3]));
      }
    }
    const personalityEnd = personality.lastIndexOf("END OF MOVES"),
      vectors = personality
        .slice(personalityEnd + 1, personalityEnd + 3)
        .map((row) => row.split(/[\s,]+/).map(Number));
    if (
      personalityEnd >= 0 &&
      vectors.every((v) => v.length === 3 && v.every(Number.isFinite))
    ) {
      profile.bounds = new THREE.Box3().setFromPoints(
        vectors.map(
          (v) => new THREE.Vector3(...(v as [number, number, number])),
        ),
      );
    }
    profile.jumpHeight = parsePedPersonalityOptions(
      personality.join("\n"),
    ).jumpHeight;
    const bonesStart = form.indexOf("START OF BONES");
    const rootName = form[bonesStart + 1];
    let mass = 0;
    for (let i = bonesStart + 1; i < moveStart; i++)
      if (
        form[i + 2] === "BOX" ||
        form[i + 2] === "SPHERE" ||
        form[i + 2] === "POLYHEDRON"
      )
        mass += Number(form[i + 1]);
    if (mass > 0) profile.mass = mass / 1000;
    for (let i = moveStart + 1; i < moveEnd; i += 6) {
      const id = Number(form[i]);
      profile.available.add(id);
      profile.movePeriod.set(id, Math.trunc(1000 / Number(form[i + 1])));
      if (![0, 1, 2, 3, 4, 10, 11, 13, 30, 40, 41].includes(id)) continue;
      const motion =
        native?.moves.get(id)?.motion ??
        parsePedMotion(
          await assets.bytes(`${dataRoot}/PEDS/MOVES/${form[i + 4]}`),
        );
      const root = Math.max(
        0,
        motion.bones.findIndex((b) => b.name === rootName),
      );
      const stride = motion.bones.length * 12,
        start = root * 12 + 9,
        end = (motion.frameCount - 1) * stride + start;
      // Flip3DStoBRaxes: exported Z is up and -Y is forward. Native frame0
      // repeats the first root delta when the axis has no looping reset flag.
      const dx =
        motion.matrices[end] -
        motion.matrices[start] +
        (motion.frameCount > 1
          ? motion.matrices[start + stride] - motion.matrices[start]
          : 0);
      const dz =
        motion.matrices[end + 1] -
        motion.matrices[start + 1] +
        (motion.frameCount > 1
          ? motion.matrices[start + stride + 1] - motion.matrices[start + 1]
          : 0);
      profile.moveDistance.set(
        id,
        (Math.hypot(dx, dz) * (scales.get(id) ?? 0.35)) / motion.frameCount,
      );
      profile.moveDuration.set(
        id,
        motion.frameCount * Math.trunc(1000 / Number(form[i + 1])),
      );
    }
  } catch {
    /* Malformed/minimal fixtures retain a stationary fallback. */
  }
  return profile;
}

function randomGenerator(seed: number) {
  let value = seed >>> 0 || 1;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

/** Original face populations and reaction rules with native FORM/BON visuals.
 * Gameplay movement, sweeps and corpse transport remain the PED-06/07/08 bridge. */
export class PedestrianSystem {
  readonly group = new THREE.Group();
  /** Render-only identities; population and physical ownership stay unchanged. */
  readonly renderActors = new Set<THREE.Object3D>();
  /** Visible retained poses owned entirely by this system, without processing. */
  readonly dormantRenderActors = new Set<THREE.Object3D>();
  presentationRevision = 0;
  private readonly presentationSphere = new THREE.Sphere(
    new THREE.Vector3(),
    2,
  );
  readonly warnings: string[] = [];
  /** Missing population inputs; optional visual/audio warnings stay separate. */
  readonly populationFailures: { group?: number; reason: string }[] = [];
  readonly specs: PedSpawnSpec[];
  readonly motionInfo?: { bones: number; frames: number };
  private readonly population = new PedPopulationAccounting<THREE.Object3D>();
  private readonly nativeCountingOwners = new Map<
    object,
    {
      ped: Ped;
      character: NativePedCountingCharacter;
    }
  >();
  private peds: Ped[] = [];
  private readonly nativeTemplates = new Map<string, NativePedAssets>();
  private readonly nativeVisuals = new Map<string, NativePedRenderEffects>();
  private readonly nativeDeadModels = new Map<string, NativePedDeadModels>();
  private readonly nativeDeadMaterials = new NativePedDeadMaterialRegistry();
  private moveFSM?: NativePedMoveFSM;
  private nativeSlickMaterials?: NativePedSlickMaterialRegistry;
  private nativeBridge?: OrdinaryPedRuntime;
  private nativeSimulation?: VehicleSimulation;
  private nativeContactSettings?: PedContactSettings;
  private nativeSpurtingPeriod = 0;
  private nativeGoreLevel = 1;
  private nativeSmear?: Awaited<ReturnType<typeof loadNativePedSmearMaterial>>;
  private readonly nativeNoises = new Map<string, NativePedNoiseGroups>();
  get nativeRuntime() {
    return this.nativeBridge?.runtime;
  }
  get nativeLifecycle() {
    return this.nativeBridge?.stats;
  }
  get needsLegacyThreats(): boolean {
    return (
      !this.nativeBridge || this.nativeBridge.entries.size !== this.peds.length
    );
  }
  private visualRevision = -1;
  private visualBodyX = 1;
  private lastAnimationTime?: number;

  nativePresentation(actor: THREE.Object3D): NativePedPresentation | undefined {
    return this.peds.find((ped) => ped.object === actor)?.presentation;
  }
  nativeInstance(actor: THREE.Object3D) {
    const ped = this.peds.find((ped) => ped.object === actor);
    if (!ped) return undefined;
    return this.nativeBridge?.owns(ped)
      ? (this.nativeRuntime!.character(actor).instance ??
          ped.presentation?.instance)
      : ped.presentation?.instance;
  }
  private previousCar: THREE.Vector3;
  private random = randomGenerator(0x43a2c9);
  private elapsed = 0;
  private settings: PedSettings = DEFAULT_PED_SETTINGS;
  private blood?: PedBloodRuntime;
  private collision?: PedOptions["collision"];
  private nearReset = true;
  private previousCamera?: THREE.Vector3;
  private combatFrame: PedFrameOptions = {};
  private napalm: Array<PedNapalmBolt | undefined> = Array.from({
    length: NAPALM_CAPACITY,
  });
  private flameSprites: THREE.Sprite[][] = [];
  // Native actors persist through slot release; spawn changes only the head.
  private flamePositions = Array.from({ length: NAPALM_CAPACITY }, () =>
    Array.from({ length: 7 }, () => new THREE.Vector3()),
  );
  private combatTextures = new Map<string, THREE.Texture>();
  private burnExplosion?: ExplosionRuntime;
  private burnGroups: SmashExplosion[] = [];
  private proximityRays: Array<PedCombatRay | undefined> = Array.from({
    length: 20,
  });
  private repulseRays: Array<PedRepulseRay | undefined> = Array.from({
    length: 6,
  });
  private repulseMeshes: THREE.Mesh[] = [];
  private constructor(
    private groundAt: PedGround,
    private options: PedOptions,
    specs: PedSpawnSpec[],
  ) {
    this.specs = specs;
    this.random = options.random ?? this.random;
    this.previousCar = options.spawn.clone();
    this.group.name = "original-pedestrians";
  }
  get bloodStats() {
    return this.blood?.stats ?? { clouds: 0, giblets: 0, slicks: 0, smears: 0 };
  }
  get bloodNativeStats() {
    return (
      this.blood?.nativeStats ?? {
        created: 0,
        impacts: 0,
        spurts: 0,
        poolFull: 0,
        active: 0,
      }
    );
  }
  get nativeProcessDistance() {
    return this.settings.processDistance;
  }
  get states() {
    return this.peds.map((p) => {
      const instance = this.nativeBridge?.owns(p)
        ? (this.nativeRuntime!.character(p.object).instance ??
          p.presentation?.instance)
        : p.presentation?.instance;
      return {
        action: p.action,
        moveId: p.moveId,
        active: p.active,
        alive: p.alive,
        corporeal: p.corporeal,
        velocity: p.velocity.clone(),
        angularVelocity: p.angularVelocity.clone(),
        mass: p.profile.mass,
        networkStateCutoffMs: p.networkStateCutoffMs,
        burningUntilMs: p.burningUntilMs,
        napalmSlot: p.napalmSlot,
        combatOwner: p.combatOwner,
        awardCauseFlags: p.awardCauseFlags,
        position: p.object.position.clone(),
        group: p.spec.group,
        walkPeriod: p.walkPeriod,
        animation: instance
          ? {
              source: "original-bon-skl",
              moveId: instance.moveId,
              moveSlot: instance.template.form.moves.findIndex(
                (move) => move.id === instance.moveId,
              ),
              frame: instance.clock.frame,
              fraction: instance.clock.fraction,
              diagnostics: this.nativeBridge?.owns(p)
                ? [...this.nativeRuntime!.character(p.object).diagnostics]
                : [...(p.presentation?.diagnostics ?? [])],
            }
          : undefined,
      };
    });
  }
  get combatStats() {
    return {
      bolts: this.napalm.flatMap((bolt, slot) =>
        bolt
          ? [
              {
                slot,
                position: bolt.position.clone(),
                target: bolt.target.object,
                owner: bolt.source.owner,
              },
            ]
          : [],
      ),
      proximityRays: this.proximityRays.filter(
        (ray) => ray && ray.startMs !== 0,
      ).length,
      repulseRays: this.repulseRays.filter((ray) => ray && ray.startMs !== 0)
        .length,
      burning: this.peds.filter((ped) => ped.burningUntilMs > 0).length,
      reserved: this.peds.filter((ped) => ped.napalmSlot >= 0).length,
    };
  }
  get count() {
    return this.peds.length;
  }
  /** Borrow live positions without allocating diagnostic state snapshots.
   * Presentation visibility is not the native processed/alive map gate.
   */
  forEachMapPedestrian(
    policy: PedestrianMapPolicy,
    visit: (position: Readonly<THREE.Vector3>) => void,
  ): void {
    for (const ped of this.peds)
      if (pedestrianMapEligible(ped.alive, ped.active, ped.spec.group, policy))
        visit(ped.object.position);
  }
  get hits() {
    return this.population.hits;
  }
  get alive() {
    return this.population.alive;
  }
  get groupCounts() {
    return this.population.groupCounts;
  }

  /** Bind only counting identity to an existing authored population actor.
   * FORM/PHIL admission, pose and effects remain the caller's actual owners. */
  bindNativeCountingOwner(
    owner: object,
    actor: THREE.Object3D,
    character: NativePedCountingCharacter,
  ): void {
    const ped = this.peds.find((entry) => entry.object === actor);
    if (
      !ped ||
      this.nativeCountingOwners.has(owner) ||
      ped.nativeCountingCharacter ||
      !Number.isInteger(character.flags) ||
      character.flags < 0 ||
      character.flags > 0xffffffff
    )
      throw new Error("Invalid native pedestrian population binding");
    character.flags = (character.flags | this.population.flags(actor)) >>> 0;
    if (character.body) character.body.pedestrianFlags = character.flags;
    ped.nativeCountingCharacter = character;
    this.nativeCountingOwners.set(owner, { ped, character });
    this.dormantRenderActors.delete(actor);
    this.presentationRevision++;
  }

  /** Native Kill has already set character flag100 before this outlet. Never
   * call the estimated visual kill/launch/blood path from this callback. */
  oneLessNativePed(
    owner: object,
    character: NativePedCountingCharacter,
    timeMs: number,
    reason: "killed" | "vanished" = "killed",
  ): boolean {
    const binding = this.nativeCountingOwners.get(owner);
    if (!binding || binding.character !== character)
      throw new Error("Unknown native pedestrian counting owner");
    if (!(character.flags & (reason === "vanished" ? 0x80 : PED_COUNTED_FLAG)))
      return false;
    const event = this.population.oneLess(binding.ped.object);
    if (!event) return false;
    binding.ped.alive = false;
    if (reason === "vanished") {
      // Installed OneLessPed owns flag100; vanish supplied only80 before count.
      character.flags |= PED_COUNTED_FLAG;
      binding.ped.vanished = true;
    }
    this.options.onCount?.({
      ...event,
      timeMs,
      actor: binding.ped.object,
      source: "native",
    });
    return true;
  }

  static async create(
    assets: PedAssets,
    track: THREE.Object3D,
    configText: string,
    groundAt: PedGround,
    options: PedOptions,
  ) {
    let specs: PedSpawnSpec[] = [];
    try {
      specs = parsePedSpawnSpecs(configText);
    } catch {
      /* Other config variants may lack readable section markers. */
    }
    const system = new PedestrianSystem(groundAt, options, specs);
    const dataRoot = options.dataRoot ?? "data";
    const goreOptions = [`${dataRoot}/OPTIONS.TXT`, "data/OPTIONS.TXT"]
      .map(
        (path) =>
          assets.manifest.find(
            (entry) => entry.path.toLowerCase() === path.toLowerCase(),
          )?.path,
      )
      .find((path) => path !== undefined);
    if (goreOptions) {
      try {
        system.nativeGoreLevel = parseNativePedGoreOption(
          await assets.text(goreOptions),
        );
      } catch (error) {
        system.warnings.push(`Native pedestrian gore option: ${error}`);
      }
    }
    if (!specs.length) {
      system.warnings.push(
        "Track has no readable pedestrian spawn specifications",
      );
      return system;
    }
    system.collision = options.collision ?? new WorldCollision(track);
    let settingsText = "";
    try {
      settingsText = await assets.text(`${dataRoot}/PEDS/settings.txt`);
      system.settings = parsePedSettings(settingsText);
      system.nativeContactSettings = parsePedContactSettings(settingsText);
      system.nativeSpurtingPeriod =
        parsePedBloodSettings(settingsText).spurtingPeriodMs;
    } catch (e) {
      system.warnings.push(`Pedestrian settings: ${e}`);
    }
    const surfaces: Surface[] = options.nativePopulation
      ? options.nativePopulation.map((entry) => ({
          a: new THREE.Vector3(...entry.sourceTriangle[0]),
          b: new THREE.Vector3(...entry.sourceTriangle[1]),
          c: new THREE.Vector3(...entry.sourceTriangle[2]),
          spec: entry.spec,
          count: 1,
          nativeSpawn: entry,
        }))
      : collectPedSurfaces(track, specs, system.settings.maxSlopeDegrees);
    if (!surfaces.length) {
      system.warnings.push(
        "No rendered surfaces match pedestrian spawn materials",
      );
      return system;
    }
    let groups = new Map<number, string[]>();
    try {
      groups = parsePedGroups(
        settingsText || (await assets.text(`${dataRoot}/PEDS/settings.txt`)),
      );
    } catch (e) {
      system.warnings.push(String(e));
    }
    const requested = [
      ...new Set(specs.flatMap((spec) => groups.get(spec.group) ?? [])),
    ];
    const names = requested.length
      ? requested
      : ["Blokebl", "Bandsman", "Attend2", "Bismanbm"];
    if (assets instanceof Assets) {
      const executable =
        assets.resolve("carma2_HW.exe") ?? assets.resolve("carma2_SW.exe");
      if (executable)
        system.moveFSM = readNativePedMoveFSM(await assets.bytes(executable));
      else
        system.warnings.push(
          "Original pedestrian move fallback table unavailable: missing C2 executable",
        );
    }
    const templates = new Map<string, THREE.Group>();
    const profiles = new Map<string, PedProfile>();
    for (const name of names) {
      if (assets instanceof Assets) {
        let template: NativePedAssets | undefined;
        let deadModels: NativePedDeadModels | undefined;
        let effects: NativePedRenderEffects | undefined;
        try {
          template = await loadNativePedAssets(
            assets,
            `PEDS/PEEPS/${name}`,
            name,
            dataRoot,
          );
          // Reject unsupported FORM render prerequisites once, before any
          // ordinary population identity can borrow this template.
          deadModels = prepareNativePedDeadModels(name, template, {
            materialRegistry: system.nativeDeadMaterials,
            nullFaceMaterial: () => template!.inheritedActorMaterial,
          });
          effects = new NativePedRenderEffects(template, deadModels);
          const probe = new NativePedPresentation(template, { effects });
          probe.dispose();
          try {
            const sounds = parseNativePedNoiseGroups(
              await assets.text(
                `${dataRoot}/PEDS/SOUND/${template.profile.soundFilename}`,
              ),
            );
            system.nativeNoises.set(name.toLowerCase(), sounds);
            system.warnings.push(
              ...nativePedNoiseDiagnostics(sounds).map(
                (reason) => `${name}: ${reason}`,
              ),
            );
          } catch (error) {
            system.warnings.push(
              `${name}: native noise prerequisites: ${String(error)}`,
            );
          }
          system.nativeTemplates.set(name.toLowerCase(), template);
          system.nativeVisuals.set(name.toLowerCase(), effects);
          system.nativeDeadModels.set(name.toLowerCase(), deadModels);
          system.warnings.push(...deadModels.diagnostics);
          templates.set(name.toLowerCase(), template.group);
          profiles.set(
            name.toLowerCase(),
            await loadPedProfile(assets, name, dataRoot, template),
          );
        } catch (error) {
          effects?.dispose();
          deadModels?.dispose();
          template?.dispose();
          const reason = `Pedestrian ${name}: ${String(error)}`;
          system.warnings.push(reason);
        }
        continue;
      }
      // Minimal asset hosts used by isolated gameplay fixtures have no native
      // registry/FORM library. Keep their explicit procedural fixture path.
      const prefix = `${dataRoot}/peds/peeps/${name.toLowerCase()}/`;
      const acts = assets.manifest
        .filter(
          (e) =>
            e.path.toLowerCase().startsWith(prefix) &&
            /^[^/]+\.act$/i.test(e.path.slice(prefix.length)),
        )
        .sort((a, b) => b.size - a.size);
      if (!acts.length) continue;
      const path = acts[0].path,
        dir = path.slice(0, path.lastIndexOf("/")),
        stem = path.slice(path.lastIndexOf("/") + 1, -4);
      try {
        const result = await assets.scene(dir, stem);
        const box = new THREE.Box3().setFromObject(result.group),
          size = box.getSize(new THREE.Vector3());
        if (!Number.isFinite(size.y) || size.y <= 0) continue;
        templates.set(name.toLowerCase(), result.group);
        profiles.set(
          name.toLowerCase(),
          await loadPedProfile(assets, name, dataRoot),
        );
      } catch (e) {
        system.warnings.push(`Pedestrian ${name}: ${e}`);
      }
    }
    if (!templates.size) {
      system.warnings.push("No original pedestrian actor packages loaded");
      system.populationFailures.push({
        reason: "No original pedestrian actor packages loaded.",
      });
      return system;
    }
    const limit = Math.min(
      PED_POPULATION_CAPACITY,
      Math.max(0, options.maxCount ?? PED_POPULATION_CAPACITY),
    );
    const templateNames = [...templates.keys()];
    for (const surface of surfaces) {
      const declared = (groups.get(surface.spec.group) ?? templateNames).map(
        (n) => n.toLowerCase(),
      );
      const choices = surface.nativeSpawn
        ? templates.has(surface.nativeSpawn.personality.toLowerCase())
          ? [surface.nativeSpawn.personality.toLowerCase()]
          : []
        : declared.filter((n) => templates.has(n));
      if (
        assets instanceof Assets &&
        surface.count > 0 &&
        choices.length > 0 &&
        declared.some((name) => !templates.has(name)) &&
        !system.populationFailures.some(
          (failure) => failure.group === surface.spec.group,
        )
      )
        system.populationFailures.push({
          group: surface.spec.group,
          reason: `Pedestrian group ${surface.spec.group} has unavailable original personalities: ${declared.filter((name) => !templates.has(name)).join(", ")}`,
        });
      if (!choices.length) {
        if (
          surface.count > 0 &&
          !system.populationFailures.some(
            (failure) => failure.group === surface.spec.group,
          )
        )
          system.populationFailures.push({
            group: surface.spec.group,
            reason: `Pedestrian group ${surface.spec.group} has no loadable actor personality.`,
          });
        system.warnings.push(
          `No personality for pedestrian group ${surface.spec.group}`,
        );
        continue;
      }
      for (let i = 0; i < surface.count && system.count < limit; i++) {
        const name =
          surface.nativeSpawn?.personality.toLowerCase() ??
          choices[pedRandomInteger(system.random, 0, choices.length - 1)];
        const native = system.nativeTemplates.get(name);
        const presentation = native
          ? new NativePedPresentation(native, {
              effects: system.nativeVisuals.get(name),
              nextCrtInteger: () =>
                Math.floor(
                  (options.combatRandom ?? sharedNativeRandom.random)() * 32768,
                ),
              resolveMove: (id) => {
                if (!system.moveFSM) return id;
                const plan = planNativePedMove(system.moveFSM, {
                  requestedId: id,
                  previousAction: 6,
                  requestedAction: -1,
                  walkSpeed: -1,
                  pedestrianSpeedFactor: 1,
                  removedBoneMask: 0,
                  drunk: false,
                  dancing: false,
                  panicking: false,
                  availableMoves: new Set(native.moves.keys()),
                });
                if (plan.status !== "complete")
                  throw new Error(plan.requiredProviders.join(", "));
                return plan.moveId;
              },
            })
          : undefined;
        const visual = presentation?.group ?? templates.get(name)!.clone(true);
        const position = surface.nativeSpawn
          ? new THREE.Vector3(...surface.nativeSpawn.position)
          : pedTrianglePoint(surface.a, surface.b, surface.c, system.random);
        const rig = presentation
          ? { limbs: [], footOffset: 0 }
          : rigPedestrian(visual);
        if (!presentation) visual.position.y = rig.footOffset;
        const object = new THREE.Group();
        object.name = `ped-${name}-${system.count}`;
        object.position.copy(position);
        object.add(visual);
        const heading = surface.nativeSpawn
          ? Math.atan2(
              surface.nativeSpawn.direction[0],
              surface.nativeSpawn.direction[2],
            )
          : Math.atan2(system.random() * 2 - 1, system.random() * 2 - 1);
        object.rotation.y = heading;
        const movement =
          system.settings.movements[surface.spec.movement] ??
          DEFAULT_PED_SETTINGS.movements[0];
        const walkPeriod =
          surface.nativeSpawn?.walkPeriod ??
          pedRandomInteger(
            system.random,
            movement.minWalkPeriod,
            movement.maxWalkPeriod,
          );
        const profile = profiles.get(name)!;
        let initialMove = walkPeriod ? 30 : 0;
        let initialAction = PedAction.Walking;
        if (native && system.moveFSM) {
          const initial = planNativePedMove(system.moveFSM, {
            requestedId: initialMove,
            previousAction: 0,
            requestedAction: 0,
            walkSpeed: walkPeriod || -1,
            pedestrianSpeedFactor: 0,
            removedBoneMask: 0,
            drunk: false,
            dancing: false,
            panicking: false,
            availableMoves: new Set(native.moves.keys()),
          });
          if (initial.status !== "complete")
            throw new Error(initial.requiredProviders.join(", "));
          initialMove = initial.moveId;
          initialAction = initial.action;
        }
        system.peds.push({
          personality: name,
          nativeObjective: surface.nativeSpawn?.objective,
          object,
          visual,
          presentation,
          limbs: rig.limbs,
          footOffset: rig.footOffset,
          home: position.clone(),
          initialYaw: heading,
          heading,
          phase: surface.nativeSpawn ? 0 : system.random() * Math.PI * 2,
          alive: true,
          vanished: false,
          fallTime: 0,
          velocity: new THREE.Vector3(),
          startingVelocity: new THREE.Vector3(),
          awardCauseFlags: 0,
          spec: surface.spec,
          movement,
          walkPeriod,
          nextTurnMs: surface.nativeSpawn ? 0 : system.nextTurn(movement, 0),
          lastScareMs: 0,
          firstScareMs: 0,
          nextAvoidMs: 0,
          turnFrom: heading,
          turnTo: heading,
          turnStart: 0,
          turnEnd: 0,
          actionSinceMs: 0,
          runPeriod: 100,
          action: initialAction,
          moveId: initialMove,
          active: false,
          corporeal: false,
          angularVelocity: new THREE.Vector3(),
          networkStateCutoffMs: 0,
          burningUntilMs: 0,
          napalmSlot: -1,
          settled: false,
          profile,
          proximity: emptyPedProximity(),
        });
        const created = system.peds[system.peds.length - 1];
        if (presentation) system.posePresentation(created, 0, true);
        system.population.enroll(object, surface.spec.group);
        system.renderActors.add(object);
        system.group.add(object);
      }
      if (system.count === limit) break;
    }
    try {
      const bloodSettings = parsePedBloodSettings(settingsText);
      system.blood = await PedBloodRuntime.create(
        assets,
        bloodSettings,
        groundAt,
        system.random,
        (position, halfSize) => {
          const height = groundAt(position.x, position.z, position.y + 0.2);
          if (height === null) return null;
          const hit = system.collision?.raycast(
            new THREE.Vector3(position.x, height + 0.05, position.z),
            new THREE.Vector3(0, -1, 0),
            0.1,
            true,
          );
          const floorPosition = new THREE.Vector3(
              position.x,
              height,
              position.z,
            ),
            nearby = halfSize
              ? (system.collision?.querySurfaces?.(
                  floorPosition
                    .clone()
                    .add(new THREE.Vector3(-halfSize, -0.1, -halfSize)),
                  floorPosition
                    .clone()
                    .add(new THREE.Vector3(halfSize, 0.1, halfSize)),
                  true,
                ) ?? [])
              : [];
          return {
            position: new THREE.Vector3(position.x, height, position.z),
            normal: hit?.normal.clone() ?? new THREE.Vector3(0, 1, 0),
            nearbyFaceNormals: nearby.map((s) => s.normal),
            sameSideOfNearbyPlanes: nearby.map(
              (s) => s.normal.dot(floorPosition.clone().sub(s.a)) >= 0,
            ),
          };
        },
        dataRoot,
      );
      system.group.add(system.blood.group);
    } catch (e) {
      system.warnings.push(`Pedestrian blood: ${e}`);
    }
    if (assets instanceof Assets) {
      const rendering = assets.nativeRenderingOptions;
      system.nativeSlickMaterials = new NativePedSlickMaterialRegistry(assets, {
        dataRoot,
        pixelmapDirectory: "PIX16",
        textureQuality: {
          interpolation: !!rendering.interpolation,
          antialiasing: !!rendering.antialiasing,
          perspective: !!rendering.perspective,
          exceptionFlags: (name) =>
            rendering.textureExceptions?.get(name.toLowerCase()) ?? null,
        },
        mapMaterial: (source, pixelmap, kind) => {
          const material = createNativeRenderMaterial(source, pixelmap, {
            ...rendering,
            shading: kind === "procedural-gibslick" ? 0 : 4,
          });
          return {
            status: "complete",
            owned: true,
            requiredProviders: [],
            material,
            ownedTextures: material.map ? [material.map] : [],
          };
        },
      });
      const slickPreparation = await system.nativeSlickMaterials.prepare();
      for (const missing of slickPreparation.requiredProviders)
        system.warnings.push(`Pedestrian slick: ${missing}`);
    }
    await system.loadCombatVisuals(assets, settingsText);
    try {
      system.nativeSmear = await loadNativePedSmearMaterial(assets, dataRoot);
      for (const missing of system.nativeSmear.requiredProviders)
        system.warnings.push(`Native pedestrian smear: ${missing}`);
    } catch (error) {
      system.warnings.push(`Native pedestrian smear: ${error}`);
    }
    return system;
  }

  private targetGravity(position: THREE.Vector3): number | undefined {
    return (
      this.combatFrame.readGravityMultiplier ??
      this.options.readGravityMultiplier
    )?.(position);
  }
  private combatPosition(ped: Ped): THREE.Vector3 {
    return this.nativeBridge?.admitted(ped)
      ? this.nativeRuntime!.character(ped.object).body!.state.position
      : ped.object.position;
  }
  private combatTargets() {
    return this.peds.map((ped) => ({
      ped,
      position: this.combatPosition(ped),
      alive: ped.alive,
      inSight: ped.active,
      burningOrReserved:
        ped.burningUntilMs > 0 ||
        ped.napalmSlot >= 0 ||
        (!!this.nativeBridge?.owns(ped) &&
          !this.nativeBridge.canReserveNapalm(ped)),
      specialVolumeGravityMultiplier: this.targetGravity(ped.object.position),
    }));
  }
  private firstFaceFraction(
    source: THREE.Vector3,
    target: { position: THREE.Vector3 },
  ): number {
    const delta = target.position.clone().sub(source),
      distance = delta.length();
    if (distance === 0) return 1;
    const hit = this.collision?.raycast(
      source,
      delta.divideScalar(distance),
      distance,
    );
    return hit ? hit.distance / distance : 1;
  }
  /** Installed callbacks report success for any qualifying target. */
  useCombatPowerup(
    action: 37 | 45 | 49,
    floatParams: readonly number[],
    source: PedCombatSource,
    physicsTickMs: number,
    gameTimeMs: number,
  ): boolean {
    if (
      ![
        ...source.position.toArray(),
        ...source.velocity.toArray(),
        physicsTickMs,
        gameTimeMs,
      ].every(Number.isFinite) ||
      physicsTickMs < 0 ||
      gameTimeMs < 0
    )
      throw new Error("Invalid pedestrian combat context");
    const immortal = this.combatFrame.immortalPedestrians ?? false;
    const targets = this.combatTargets();
    const random = this.options.combatRandom ?? sharedNativeRandom.random;
    if (action === 49) {
      const chosen = selectNapalmTarget(
        source.position,
        targets,
        this.napalm.map(Boolean),
        source.gravityMultiplier,
        immortal,
        (origin, target) => this.firstFaceFraction(origin, target),
      );
      if (!chosen) return false;
      if (
        this.nativeBridge?.owns(chosen.target.ped) &&
        !this.nativeBridge.reserveNapalm(chosen.target.ped, chosen.slot)
      )
        return false;
      chosen.target.ped.napalmSlot = chosen.slot;
      const bolt: PedNapalmBolt = {
        target: chosen.target.ped,
        source,
        position: source.position.clone(),
        direction: new THREE.Vector3(),
        bornAtMs: gameTimeMs,
        lastDirectionAtMs: 0,
        flames: this.flamePositions[chosen.slot],
      };
      bolt.flames[0].copy(source.position);
      this.napalm[chosen.slot] = bolt;
      const sprites = this.flameSprites[chosen.slot];
      if (sprites) {
        for (const sprite of sprites) sprite.visible = false;
        sprites[0].position.copy(bolt.position);
        sprites[0].visible = true;
      }
      this.options.onCombatSound?.(3701, source.position);
      return true;
    }
    const parameters =
      action === 45 ? repulsionParameters(45, floatParams) : undefined;
    const range = parameters?.range ?? floatParams[0];
    const selected = selectCombatPedestrians(
      source.position,
      targets,
      range,
      immortal,
      (origin, target) => this.firstFaceFraction(origin, target),
    );
    for (const target of selected) {
      const ped = target.ped;
      ped.combatOwner = source.owner;
      if (action === 37) {
        this.electrocute(ped, source, gameTimeMs, "annihilator");
      } else {
        // Source sets move91 and draws its period before the three omega draws.
        ped.moveId = 91;
        ped.runPeriod = pedRandomInteger(random, 75, 200);
        ped.action = PedAction.Impacting;
        ped.actionSinceMs = gameTimeMs;
        ped.corporeal = true;
        const impulse = pedestrianRepulsionImpulse(
          source.position,
          target.position,
          this.nativeBridge?.admitted(ped)
            ? this.nativeRuntime!.character(ped.object).body!.properties.mass
            : ped.profile.mass,
          parameters!,
          physicsTickMs,
          random,
        );
        if (!impulse) continue;
        if (this.nativeBridge?.admitted(ped)) {
          this.nativeBridge.repel(
            ped,
            ped.runPeriod,
            impulse.deltaVelocity,
            impulse.deltaAngularVelocity,
            gameTimeMs,
          );
          ped.startingVelocity.copy(ped.velocity);
          ped.networkStateCutoffMs = impulse.networkStateCutoffMs;
          this.addRepulseRay(ped, source, gameTimeMs);
          this.nativeBridge.finishRepulsion(ped, gameTimeMs);
          continue;
        }
        ped.velocity.add(impulse.deltaVelocity);
        ped.startingVelocity.copy(ped.velocity);
        ped.angularVelocity.add(impulse.deltaAngularVelocity);
        ped.networkStateCutoffMs = impulse.networkStateCutoffMs;
        this.addRepulseRay(ped, source, gameTimeMs);
      }
    }
    return selected.length > 0;
  }
  private electrocute(
    ped: Ped,
    source: PedCombatSource,
    timeMs: number,
    cause: "annihilator" | "electric",
  ) {
    this.kill(
      ped,
      timeMs,
      0,
      ped.velocity.clone(),
      0,
      source.owner,
      cause,
      113,
    );
    // Callback's animation substitution is independent of ordinary kill success.
    ped.action = PedAction.Dead;
    ped.moveId = 113;
    ped.actionSinceMs = timeMs;
    const slot = this.proximityRays.findIndex(
      (ray) => !ray || ray.startMs === 0,
    );
    if (slot < 0) return;
    const old = this.proximityRays[slot];
    old?.object.geometry.dispose();
    old?.object.removeFromParent();
    if (old) (old.object.material as THREE.Material).dispose();
    const object = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xd7ffe9 }),
    );
    object.name = `ped-proximity-ray-${slot}`;
    this.group.add(object);
    this.proximityRays[slot] = { startMs: timeMs, target: ped, source, object };
  }
  private addRepulseRay(target: Ped, source: PedCombatSource, timeMs: number) {
    this.allocateRepulseRay({
      target,
      source,
      readSourcePosition: () => source.readPosition?.() ?? source.position,
      readTargetPosition: () => this.combatPosition(target),
      innerRadius: Math.fround(0.03),
      outerRadius: Math.fround(0.05),
      startMs: timeMs,
    });
  }
  /** Opponent action38 shares the pedestrian six-slot visual pool, with
   * installed caller radii .06/.12 and live car.pos endpoint pointers. */
  emitOpponentRepulsion(
    readSourcePosition: () => THREE.Vector3,
    readTargetPosition: () => THREE.Vector3,
    timeMs: number,
  ): void {
    this.allocateRepulseRay({
      readSourcePosition,
      readTargetPosition,
      innerRadius: Math.fround(0.06),
      outerRadius: Math.fround(0.12),
      startMs: timeMs,
    });
  }
  private allocateRepulseRay(ray: PedRepulseRay) {
    let slot = this.repulseRays.findIndex((ray) => !ray || ray.startMs === 0);
    if (slot < 0) {
      slot = 0;
      for (let i = 1; i < 6; i++)
        if (this.repulseRays[i]!.startMs < this.repulseRays[slot]!.startMs)
          slot = i;
    }
    this.repulseRays[slot] = ray;
  }
  private updateCombatRays(nowMs: number) {
    for (let slot = 0; slot < 20; slot++) {
      const ray = this.proximityRays[slot];
      if (!ray) continue;
      if (ray.startMs === 0 || (nowMs - ray.startMs) >>> 0 >= 500) {
        ray.object.geometry.dispose();
        (ray.object.material as THREE.Material).dispose();
        ray.object.removeFromParent();
        this.proximityRays[slot] = undefined;
        continue;
      }
      const origin = ray.source.readRayOrigin?.() ?? ray.source.position;
      const target = this.combatPosition(ray.target);
      const delta = target.clone().sub(origin),
        distance = delta.length();
      const direction =
        distance > 2 ** -22
          ? delta.divideScalar(distance)
          : new THREE.Vector3(1, 0, 0);
      // RenderElectroBastardRays reseeds the CRT from time + endpoint sum.
      // Injected combat RNGs remain isolated; production uses the shared stream.
      // The installed executable passes the stored float's bits to srand,
      // rather than the numeric cast shown in the reconstruction.
      const seedBytes = new DataView(new ArrayBuffer(4));
      seedBytes.setFloat32(
        0,
        target.x + target.y + target.z + origin.x + origin.y + origin.z,
        true,
      );
      const seed = (nowMs + seedBytes.getUint32(0, true)) >>> 0;
      const stream = this.options.combatRandom
        ? new NativeRandom(seed)
        : sharedNativeRandom;
      stream.seed(seed);
      const points = [origin.clone()];
      for (
        let t = 0;
        t < distance;
        t = Math.fround(Math.fround(t + Math.fround(0.05)) + Math.fround(0.05))
      ) {
        const jitter = new THREE.Vector3(
          -0.1 + 0.2 * stream.random(),
          -0.1 + 0.2 * stream.random(),
          -0.1 + 0.2 * stream.random(),
        );
        if (this.combatFrame.cameraOrientation)
          jitter.applyQuaternion(this.combatFrame.cameraOrientation);
        points.push(origin.clone().addScaledVector(direction, t).add(jitter));
      }
      points.push(target.clone());
      ray.object.geometry.dispose();
      ray.object.geometry = new THREE.BufferGeometry().setFromPoints(points);
    }
    for (let slot = 0; slot < 6; slot++) {
      const ray = this.repulseRays[slot],
        mesh = this.repulseMeshes[slot];
      if (!ray) continue;
      const age = (nowMs - ray.startMs) >>> 0;
      if (ray.startMs === 0 || age >= 700) {
        this.repulseRays[slot] = undefined;
        if (mesh) mesh.visible = false;
        continue;
      }
      const origin = ray.readSourcePosition();
      const delta = ray.readTargetPosition().clone().sub(origin);
      if ((delta.x === 0 && delta.z === 0) || !mesh) continue;
      const direction = delta.clone().normalize();
      const base = delta
        .clone()
        .cross(new THREE.Vector3(0, 1, 0))
        .normalize();
      const offsets = Array.from({ length: 5 }, (_, index) =>
        base
          .clone()
          .applyAxisAngle(
            direction,
            (Math.trunc((index * 65536) / 5) * Math.PI * 2) / 65536,
          ),
      );
      const positions = mesh.geometry.getAttribute("position");
      for (let j = 0; j < 51; j++) {
        const center = origin.clone().addScaledVector(delta, (j + 1) / 50);
        for (const [row, radius] of [
          [0, ray.innerRadius],
          [1, ray.outerRadius],
        ]) {
          const point = center.clone().addScaledVector(offsets[j % 5], radius);
          positions.setXYZ(j + row * 51, point.x, point.y, point.z);
        }
      }
      positions.needsUpdate = true;
      mesh.geometry.computeBoundingSphere();
      const fraction = Math.fround(age * Math.fround(1 / 700));
      (mesh.material as THREE.MeshBasicMaterial).opacity =
        fraction > 0.9
          ? 0.25
          : fraction > 0.8
            ? 0.5
            : fraction > 0.7
              ? 0.75
              : 1;
      mesh.visible = true;
    }
  }
  private kill(
    ped: Ped,
    timeMs: number,
    speed: number,
    velocity: THREE.Vector3,
    force: number,
    owner: object | undefined,
    cause: PedHitEvent["cause"],
    moveId: number,
    inactiveBurnScore = false,
  ): boolean {
    if (
      this.nativeBridge?.admitted(ped) &&
      (cause === "annihilator" || cause === "electric" || cause === "napalm")
    )
      return this.nativeBridge.killFromCause(ped, cause, owner);
    const gravity = this.targetGravity(ped.object.position);
    if (
      !ped.alive ||
      ped.nativeCountingCharacter ||
      (!inactiveBurnScore && this.combatFrame.immortalPedestrians)
    )
      return false;
    // Installed KillPedestrian 4ccc8b jumps over gore/rigid setup in a
    // low-gravity volume, then still runs OneLessPed and scoring at 4ccd84.
    const physicalDeath =
      !inactiveBurnScore && (gravity === undefined || gravity >= 1);
    ped.alive = false;
    ped.deadModelSet =
      physicalDeath && (this.combatFrame.goreLevel ?? this.nativeGoreLevel) > 0
        ? 1
        : 0;
    // Installed KillPedestrian commits action6 independently of the requested
    // death BON. Rigid transport continues through its separate corpse owner.
    ped.action = PedAction.Dead;
    ped.moveId = moveId;
    ped.actionSinceMs = timeMs;
    ped.fallTime = physicalDeath ? 0 : 2;
    ped.settled = !physicalDeath;
    ped.combatOwner = owner;
    ped.velocity.copy(velocity);
    if (physicalDeath && !ped.corporeal) {
      ped.startingVelocity.copy(velocity);
      ped.corporeal = true;
    }
    if (!inactiveBurnScore) {
      const count = this.population.oneLess(ped.object);
      if (count)
        this.options.onCount?.({
          ...count,
          timeMs,
          actor: ped.object,
          source: "ordinary",
        });
    }
    const position = ped.object.position;
    const bounds = new THREE.Box3()
      .setFromObject(ped.visual)
      .translate(position.clone().negate());
    const cloudPosition = position.clone();
    cloudPosition.y += ped.footOffset;
    if (physicalDeath)
      this.blood?.hit(cloudPosition, bounds, ped.velocity, force, timeMs);
    this.options.onHit?.({
      timeMs,
      group: ped.spec.group,
      count: inactiveBurnScore ? 0 : 1,
      total: this.hits,
      speed,
      position: position.clone(),
      owner,
      cause,
      awardContext: {
        cachePresent: ped.active || inactiveBurnScore,
        cacheFlags: ped.awardCauseFlags,
        height: 0,
        napalmDeadlineMs: ped.burningUntilMs,
        pedVelocity: ped.corporeal ? ped.velocity.clone() : undefined,
        pedStartingVelocity: ped.corporeal
          ? ped.startingVelocity.clone()
          : undefined,
      },
    });
    return true;
  }
  private releaseNapalm(slot: number): void {
    const bolt = this.napalm[slot];
    if (bolt && this.nativeBridge?.owns(bolt.target))
      this.nativeBridge.releaseNapalm(bolt.target, slot);
    if (bolt?.target.napalmSlot === slot) bolt.target.napalmSlot = -1;
    this.napalm[slot] = undefined;
    for (const sprite of this.flameSprites[slot] ?? []) sprite.visible = false;
  }
  private updateNapalm(nowMs: number, dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs < 0)
      throw new Error("Invalid napalm frame period");
    const random = this.options.combatRandom ?? sharedNativeRandom.random;
    for (let slot = 0; slot < NAPALM_CAPACITY; slot++) {
      const bolt = this.napalm[slot];
      if (!bolt) continue;
      const ped = bolt.target;
      const gravity = this.targetGravity(ped.object.position);
      if (!ped.active || (gravity !== undefined && gravity < 1)) {
        this.releaseNapalm(slot);
        continue;
      }
      const nativeBody = this.nativeBridge?.admitted(ped)
        ? this.nativeRuntime!.character(ped.object).body!
        : null;
      const position = this.combatPosition(ped);
      stepNapalmMotion(bolt, position, nowMs, dtMs, random);
      bolt.flames[0].copy(bolt.position);
      // Native first checks head distance against each of the six simple-box
      // coordinate squares, then tests seven current flame actors in body axes.
      const bounds = nativeBody
        ? new THREE.Box3(
            new THREE.Vector3(...nativeBody.profile.bounds.min),
            new THREE.Vector3(...nativeBody.profile.bounds.max),
          )
        : ped.profile.bounds;
      const distanceSquared = bolt.position.distanceToSquared(position);
      const broad = [...bounds.min.toArray(), ...bounds.max.toArray()].some(
        (value) => distanceSquared < value * value,
      );
      const orientation =
        nativeBody?.state.orientation ?? ped.object.quaternion;
      const inverse = orientation.clone().invert();
      const hit =
        broad &&
        bolt.flames.some((position) =>
          bounds.containsPoint(
            position
              .clone()
              .sub(this.combatPosition(ped))
              .applyQuaternion(inverse),
          ),
        );
      if (hit) {
        ped.burningUntilMs = (nowMs + NAPALM_BURN_MS) >>> 0;
        ped.combatOwner = bolt.source.owner;
        ped.awardCauseFlags |= 0x20;
        ped.lastScareMs = nowMs;
        ped.firstScareMs ||= nowMs;
        if (nativeBody)
          this.nativeBridge!.ignite(
            ped,
            nowMs,
            ped.burningUntilMs,
            bolt.source.owner,
          );
        else if (!ped.corporeal && ped.alive) {
          ped.action = PedAction.Running;
          ped.moveId = this.reactionMove(ped, 41);
          ped.runPeriod = 100;
          ped.actionSinceMs = nowMs;
        }
        this.burnExplosion?.spawn(
          this.burnGroups,
          ped.object.position,
          bounds,
          nowMs,
          undefined,
          ped.object.quaternion,
        );
        this.options.onNapalmIgnited?.(
          ped.object,
          ped.velocity,
          ped.angularVelocity,
        );
        this.options.onCombatSound?.(3702, ped.object.position);
        this.releaseNapalm(slot);
        continue;
      }
      // Installed float-to-int conversion truncates (time - .036) at every
      // segment. +24 remains zero, so its clamped history index stays zero.
      let trailTime = nowMs;
      for (let i = 0; i < 7; i++) {
        trailTime = Math.trunc(trailTime - 0.036);
        if (i > 0) {
          if (trailTime < bolt.bornAtMs) break;
          bolt.flames[i]
            .copy(bolt.flames[i - 1])
            .addScaledVector(bolt.direction, -0.036);
        }
        const sprite = this.flameSprites[slot]?.[i];
        if (sprite) {
          sprite.position.copy(bolt.flames[i]);
          sprite.visible = true;
        }
      }
    }
  }
  private async loadCombatVisuals(
    assets: PedAssets,
    settingsText: string,
  ): Promise<void> {
    const marker = /\/\/\s*NAPALMED PED SPEC\b/i.exec(settingsText);
    if (marker) {
      try {
        // ReadExplosion's group grammar is shared; adapt only the three
        // WastedExplosion header fields before the independently parsed groups.
        this.burnGroups = parseWastedExplosionSettings(
          "// Wasted explosion settings\n100\n0\nboom\n" +
            settingsText.slice(marker.index + marker[0].length),
        ).groups;
      } catch (error) {
        this.warnings.push(`Pedestrian burning animation: ${error}`);
      }
    }
    const names = new Set([
      "ex00006",
      ...this.burnGroups.flatMap((group) =>
        group.frames.map((frame) => frame.pixelmap.toLowerCase()),
      ),
    ]);
    for (const name of names) {
      const file = assets.manifest.find((entry) =>
        new RegExp(`^data/common/boom/pix16/${name}\\.pix$`, "i").test(
          entry.path,
        ),
      );
      if (!file) continue;
      try {
        const map = parsePix(await assets.bytes(file.path))[0];
        if (!map) continue;
        const texture = new THREE.DataTexture(
          map.rgba,
          map.width,
          map.height,
          THREE.RGBAFormat,
        );
        texture.name = map.name || name;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        texture.needsUpdate = true;
        this.combatTextures.set(name, texture);
      } catch (error) {
        this.warnings.push(`Pedestrian flame texture: ${error}`);
      }
    }
    this.burnExplosion = new ExplosionRuntime(this.group, this.combatTextures, {
      random: this.options.combatRandom ?? sharedNativeRandom.random,
    });
    const repulseFile = assets.manifest.find((entry) =>
      /^data\/pixelmap\/pix16\/repulse\.pix$/i.test(entry.path),
    );
    if (repulseFile) {
      try {
        const map = parsePix(await assets.bytes(repulseFile.path))[0];
        if (map) {
          const texture = new THREE.DataTexture(
            map.rgba,
            map.width,
            map.height,
            THREE.RGBAFormat,
          );
          texture.name = map.name || "REPULSE";
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.flipY = false;
          texture.needsUpdate = true;
          this.combatTextures.set("repulse", texture);
          this.repulseMeshes = Array.from({ length: 6 }, (_, slot) => {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute(
              "position",
              new THREE.Float32BufferAttribute(new Float32Array(102 * 3), 3),
            );
            const uvs = Array.from({ length: 102 }, (_, j) => [
              j % 2,
              j < 51 ? 0 : 1,
            ]).flat();
            geometry.setAttribute(
              "uv",
              new THREE.Float32BufferAttribute(uvs, 2),
            );
            geometry.setIndex(
              Array.from({ length: 50 }, (_, j) => [
                j,
                j + 1,
                j + 52,
                j + 51,
                j + 52,
                j,
              ]).flat(),
            );
            const mesh = new THREE.Mesh(
              geometry,
              new THREE.MeshBasicMaterial({
                map: texture,
                side: THREE.DoubleSide,
                transparent: true,
                depthWrite: false,
              }),
            );
            mesh.name = `ped-repulse-ray-${slot}`;
            mesh.visible = false;
            this.group.add(mesh);
            return mesh;
          });
        }
      } catch (error) {
        this.warnings.push(`Pedestrian repulse texture: ${error}`);
      }
    }
    const texture = this.combatTextures.get("ex00006");
    if (!texture) return;
    const image = texture.image as { width: number; height: number };
    this.flameSprites = Array.from({ length: NAPALM_CAPACITY }, (_, slot) =>
      NAPALM_FLAME_SCALES.map((scale, index) => {
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
          }),
        );
        sprite.name = `napalm-${slot}-${index}`;
        sprite.visible = false;
        // Native quad coordinates span -.5..1 in both billboard axes.
        sprite.scale.set(
          (image.width * scale * 1.5) / 128,
          (image.height * scale * 1.5) / 128,
          1,
        );
        sprite.center.set(1 / 3, 1 / 3);
        this.group.add(sprite);
        return sprite;
      }),
    );
  }

  /** The existing population object remains the only map/count/mission owner. */
  initializeNativePhysics(simulation: VehicleSimulation): void {
    this.disposeNativePhysics();
    this.nativeSimulation = simulation;
    if (!this.moveFSM || !this.nativeContactSettings) {
      this.warnings.push(
        "Native pedestrian physical prerequisites unavailable: original move/contact tables",
      );
      return;
    }
    const warn = (text: string) => {
      if (!this.warnings.includes(text)) this.warnings.push(text);
    };
    this.nativeBridge = new OrdinaryPedRuntime({
      simulation,
      peds: this.peds,
      templates: this.nativeTemplates,
      effects: this.nativeVisuals,
      noises: this.nativeNoises,
      settings: this.settings,
      contactSettings: this.nativeContactSettings,
      moveFSM: this.moveFSM,
      spurtingPeriodMs: this.nativeSpurtingPeriod,
      dismemberSpurtCount: this.blood?.settings.dismemberSpurtCount ?? 0,
      frame: () => ({
        ...this.combatFrame,
        goreLevel: this.combatFrame.goreLevel ?? this.nativeGoreLevel,
      }),
      retainedPresentation: () => this.dormantRenderActors,
      onAdmitted: (ped) => {
        if (this.dormantRenderActors.delete(ped.object))
          this.presentationRevision++;
      },
      groundAt: this.groundAt,
      readScopeFloor:
        typeof simulation.world.nativePedFloorBelow === "function"
          ? (position) =>
              simulation.world.nativePedFloorBelow(
                new THREE.Vector3(...position),
                simulation.cars.find((car) => car.human)?.group,
              )
          : undefined,
      warn,
      resolveMaterial: (name) =>
        this.options.nativeMaterials?.get(name.toLowerCase()),
      readSlick: () => this.blood?.settings.slick ?? null,
      readSlickMaterials: () => this.nativeSlickMaterials?.materials ?? null,
      readBloodSettings: () =>
        this.blood?.settings.impact && this.blood.settings.spurt
          ? {
              scrapeStart: this.blood.settings.impact.scrapeStart,
              lumpsPerEmission: this.blood.settings.spurt.lumpsPerEmission,
            }
          : null,
      emitBlood: (ctx, packet) => {
        if (!this.blood || !this.options.shards)
          return ["source-shared-native-ped-blood-owner"];
        const enriched = this.nativeBloodPacket(ctx, packet);
        return (
          enriched.kind === "impact"
            ? this.blood.nativeHit(enriched, this.options.shards)
            : this.blood.nativeSpurt(enriched, this.options.shards)
        ).requiredProviders;
      },
      preflightBlood: (ctx, packet) => {
        if (!this.blood || !this.options.shards)
          return ["source-shared-native-ped-blood-owner"];
        return this.blood.nativeRequirements(
          this.nativeBloodPacket(ctx, packet),
          this.options.shards,
        );
      },
      skidSection:
        this.options.skidmarks && this.nativeSmear?.material
          ? (section) =>
              this.options.skidmarks!.nativeSection(
                section,
                this.nativeSmear!.material!,
              )
          : undefined,
      bind: (ped, character) =>
        this.bindNativeCountingOwner(ped.object, ped.object, character),
      onVanish: (ctx) => {
        this.oneLessNativePed(ctx.owner, ctx.character, ctx.timeMs, "vanished");
      },
      clearBurning: (ped, signedIndex) =>
        this.clearNativeBurning(ped, signedIndex),
      burningRequirements: (ped, signedIndex) =>
        this.nativeBurningRequirements(ped, signedIndex),
      oneLess: (ctx) => {
        this.oneLessNativePed(ctx.owner, ctx.character, ctx.timeMs);
      },
      electric: (ped, body, timeMs) =>
        this.electrocute(
          ped,
          {
            position: body.state.position,
            velocity: body.state.velocity,
            owner: body,
          },
          timeMs,
          "electric",
        ),
      playNoise: (id, position) => this.options.onNoiseSound?.(id, position),
      // The ordinary bridge owns native packets and delegates to the shared emitter above.
      killGiblets: () => ["source-native-impact-packet-owner"],
      contactEffects: () => {},
      scoreDeath: (ctx, state, packet) => {
        const ped = this.peds.find((p) => p.object === ctx.owner)!;
        if (!packet || !Number.isFinite(Math.fround(packet.height)))
          return ["source-pedestrian-score-height-provider"];
        this.options.onHit?.({
          timeMs: ctx.timeMs,
          group: ped.spec.group,
          count: ctx.character.flags & 0x100 ? 1 : 0,
          total: this.hits,
          speed: ctx.body.state.velocity.length(),
          position: new THREE.Vector3(
            ...(packet.position ?? ctx.character.position),
          ),
          owner: state.cache?.killer ?? undefined,
          cause: state.deathCause ?? "vehicle",
          awardContext: {
            cachePresent: state.cache !== null,
            cacheFlags: state.cache?.flags ?? 0,
            height: packet.height,
            napalmDeadlineMs: state.cache?.napalmDeadlineMs ?? 0,
            pedVelocity: ctx.body.state.velocity.clone(),
            pedStartingVelocity: ctx.body.beforeWorldVelocity.clone(),
          },
        });
      },
    });
  }
  finishPhysics(): void {
    this.nativeBridge?.sync();
  }
  private nativeBurningRequirements(
    ped: Ped,
    signedValue: number,
  ): readonly string[] {
    if (signedValue >= 0) return [];
    const slot = -signedValue - 1;
    return Number.isInteger(slot) &&
      slot >= 0 &&
      slot < NAPALM_CAPACITY &&
      ped.napalmSlot === slot &&
      this.napalm[slot]?.target === ped
      ? []
      : ["source-negative-napalm-resource-owner"];
  }
  private clearNativeBurning(ped: Ped, signedValue: number): readonly string[] {
    const requirements = this.nativeBurningRequirements(ped, signedValue);
    if (requirements.length) return requirements;
    if (ped.napalmSlot >= 0) this.releaseNapalm(ped.napalmSlot);
    if (ped.burningUntilMs > 0) this.options.onNapalmExtinguished?.(ped.object);
    ped.burningUntilMs = 0;
    return [];
  }
  finishEffects(): void {
    this.nativeBridge?.finishEffects();
  }
  private nativeBloodPacket(
    ctx: NativePedRuntimeCallback<THREE.Object3D>,
    packet: NativePedBloodPacket,
  ) {
    const goreLevel = this.combatFrame.goreLevel ?? this.nativeGoreLevel;
    if (packet.kind === "spurt") return { ...packet, goreLevel };
    const actor = ctx.instance.bones[0].actor;
    const readBodyPose = () => {
      actor.updateWorldMatrix(true, false);
      const e = actor.matrixWorld.elements;
      return Float32Array.from([
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
    };
    return {
      ...packet,
      goreLevel,
      bodyPose: readBodyPose(),
      readBodyPose,
      localBounds: ctx.instance.template.profile.bounds,
      localCentreOfMass: ctx.body.properties.centerOfMass.toArray() as [
        number,
        number,
        number,
      ],
    };
  }
  disposeNativePhysics(): void {
    this.nativeBridge?.dispose();
    this.nativeBridge = undefined;
  }

  private nextTurn(movement: PedMovement, timeMs: number) {
    return movement.maxTurnMs
      ? timeMs +
          pedRandomInteger(this.random, movement.minTurnMs, movement.maxTurnMs)
      : 0;
  }
  private rescan(ped: Ped, heading: number, preserved?: PedProximity) {
    const result = preserved ?? ped.proximity;
    if (!this.collision?.querySurfaces) {
      return { ...result, flags: result.flags & 4, distance: 10000 };
    }
    const offset = ped.profile.groundingOffset.get(ped.moveId) ?? 0.15,
      root = ped.object.position.clone().add(new THREE.Vector3(0, offset, 0)),
      ground = this.collision.raycast(
        ped.object.position.clone().add(new THREE.Vector3(0, 0.05, 0)),
        new THREE.Vector3(0, -1, 0),
        0.1,
        true,
      ),
      up = ground?.normal.clone() ?? new THREE.Vector3(0, 1, 0);
    const old = ped.faceCache?.box.world,
      margin = 1.5 / 6.9;
    if (
      !old ||
      root.x < old.min.x + margin ||
      root.x > old.max.x - margin ||
      root.y < old.min.y + margin ||
      root.y > old.max.y - margin ||
      root.z < old.min.z + margin ||
      root.z > old.max.z - margin ||
      ped.faceCache!.faces.some((face) => face.owner)
    ) {
      const box = pedFaceCacheBox(
          root,
          new THREE.Vector3(Math.sin(ped.heading), 0, Math.cos(ped.heading)),
          up,
          ped.profile.jumpHeight,
        ),
        faces = this.collision
          .querySurfaces(box.world.min, box.world.max, true)
          .filter((face) => pedFaceInsideCache(face, box))
          .slice(0, PED_FACE_CACHE_CAPACITY);
      ped.faceCache = { box, faces };
    }
    return scanPedProximity(
      root,
      new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading))
        .projectOnPlane(up)
        .normalize(),
      ped.object.position,
      up,
      ped.profile.bounds.max.x,
      this.settings.maxSlopeDegrees,
      ped.spec,
      ped.action === PedAction.Running,
      ped.faceCache!.faces,
      result,
    );
  }
  /** Native changed-point notifications force face recaching after world edits. */
  invalidateWorldGeometry() {
    for (const ped of this.peds) ped.faceCache = undefined;
    this.nativeBridge?.invalidateWorldGeometry();
  }
  private setDirection(
    ped: Ped,
    heading: number,
    distance: number,
    timeMs: number,
  ) {
    if (ped.turnEnd && Math.cos(ped.turnTo - heading) > 0.95) return;
    ped.turnTo = heading;
    if (!distance) {
      ped.heading = heading;
      ped.turnEnd = 0;
      return;
    }
    const period =
      ped.action === PedAction.Running
        ? ped.runPeriod
        : ped.walkPeriod || ped.profile.movePeriod.get(ped.moveId) || 33;
    const speed =
      ((ped.profile.moveDistance.get(ped.moveId) ?? 0) * 1000) /
      Math.max(1, period);
    ped.turnFrom = ped.heading;
    ped.turnStart = timeMs;
    ped.turnEnd = Math.trunc(timeMs + pedTurnDuration(period, distance, speed));
  }
  private reactionMove(ped: Ped, selected: number) {
    const fallback: Record<number, number> = {
      2: 1,
      3: 2,
      4: 2,
      10: 2,
      11: 10,
      13: 10,
      41: 40,
    };
    while (
      ped.profile.available.size &&
      !ped.profile.available.has(selected) &&
      fallback[selected] !== undefined
    )
      selected = fallback[selected];
    return selected;
  }
  private floorAt(ped: Ped, x: number, z: number) {
    const ground = this.groundAt(x, z, ped.object.position.y + 0.2);
    if (ground === null) return null;
    const hit = this.collision?.raycast(
      new THREE.Vector3(x, ground + 0.05, z),
      new THREE.Vector3(0, -1, 0),
      0.1,
      true,
    );
    if (
      hit &&
      (hit.normal.y <= nativePedSlopeCosine(this.settings.maxSlopeDegrees) ||
        (!this.collision?.querySurfaces &&
          !pedFloorAllowed(
            ped.spec,
            hit.surface.material,
            ped.action === PedAction.Running,
          )))
    )
      return null;
    return ground;
  }
  update(dt: number, car: PedThreat, frame: PedFrameOptions = {}) {
    dt = THREE.MathUtils.clamp(dt, 0, 0.1);
    this.elapsed += dt;
    this.combatFrame = frame;
    const visual = frame.pedestrianAnimation;
    if (visual && visual.revision !== this.visualRevision) {
      for (const effects of this.nativeVisuals.values()) {
        effects.setBodyScale(visual.bodyScale);
        effects.setHeadScale(visual.headScale);
      }
      const ratioX = Math.fround(visual.bodyScale[0] / this.visualBodyX);
      for (const ped of this.peds)
        ped.presentation?.refreshScaledPose(ratioX, (p) => {
          for (let attempt = 0; attempt <= 10; attempt++) {
            const y = this.groundAt(p.x, p.z, p.y);
            if (y !== null && y >= -100) return y;
            p.y = Math.fround(p.y + Math.fround(0.2));
          }
          return null;
        });
      this.visualBodyX = visual.bodyScale[0];
      this.visualRevision = visual.revision;
      this.dormantRenderActors.clear();
      this.presentationRevision++;
    }
    const timeMs = frame.gameTimeMs ?? this.elapsed * 1000,
      from = this.previousCar,
      to = car.position,
      dx = to.x - from.x,
      dz = to.z - from.z,
      segmentLength = dx * dx + dz * dz;
    const camera = frame.cameraPosition ?? car.position,
      threats = frame.threats ?? [car];
    const presented: Ped[] = [];
    this.nativeBridge?.sync();
    this.nativeBridge?.prepare(camera, timeMs, this.nearReset);
    for (const ped of this.peds) {
      // A native-counted body retains actual native transport ownership.
      if (!ped.alive && ped.nativeCountingCharacter) continue;
      const p = ped.object.position;
      if (!this.nativeBridge?.owns(ped)) {
        const inProcess =
          Math.abs(p.x - camera.x) < this.settings.processDistance &&
          Math.abs(p.y - camera.y) < 0.6 * this.settings.processDistance &&
          Math.abs(p.z - camera.z) < this.settings.processDistance;
        const inPopup =
          Math.abs(p.x - camera.x) <= this.settings.popupDistance &&
          Math.abs(p.y - camera.y) <= 0.6 * this.settings.popupDistance &&
          Math.abs(p.z - camera.z) <= this.settings.popupDistance;
        // Native popup suppression assumes unprocessed actors are not rendered.
        // Extended presentation can already expose one inside that box; admit
        // that visible actor before movement/combat/ordinary hit processing.
        // The original process box still bounds all simulation work.
        ped.active =
          inProcess &&
          (ped.active ||
            this.nearReset ||
            !inPopup ||
            this.dormantRenderActors.has(ped.object));
        if (ped.active) this.dormantRenderActors.delete(ped.object);
        ped.object.visible = ped.active && !ped.vanished;
      }
      if (!ped.active) {
        // Installed4d545d scores an inactive burning target immediately, without
        // OneLessPed, ordinary immortality/volume gates or waiting for expiry.
        if ((ped.burningUntilMs | 0) > 0) {
          if (ped.alive)
            this.kill(
              ped,
              timeMs,
              0,
              ped.velocity.clone(),
              0,
              ped.combatOwner,
              "napalm",
              113,
              true,
            );
          this.options.onNapalmExtinguished?.(ped.object);
          ped.burningUntilMs = 0;
          ped.vanished = true;
        }
        continue;
      }
      if (ped.presentation && !ped.nativeCountingCharacter) presented.push(ped);
      const volumeGravity = this.targetGravity(ped.object.position);
      if (volumeGravity !== undefined && volumeGravity < 1) {
        if (ped.napalmSlot >= 0) this.releaseNapalm(ped.napalmSlot);
        if (ped.burningUntilMs > 0)
          this.options.onNapalmExtinguished?.(ped.object);
        ped.burningUntilMs = 0;
      }
      if (
        ped.alive &&
        ped.burningUntilMs > 0 &&
        timeMs >= ped.burningUntilMs &&
        !frame.immortalPedestrians
      ) {
        this.kill(
          ped,
          timeMs,
          0,
          ped.velocity.clone(),
          0,
          ped.combatOwner,
          "napalm",
          113,
        );
        ped.burningUntilMs = 0;
      }
      if (
        !this.nativeBridge?.owns(ped) &&
        ped.alive &&
        !frame.immortalPedestrians &&
        electricRayHits(
          frame.combatPosition ?? car.position,
          car.velocity ??
            new THREE.Vector3(
              -Math.sin(car.yaw) * car.speed,
              0,
              -Math.cos(car.yaw) * car.speed,
            ),
          p,
          ped.velocity,
          frame.electricRayDistanceSquared ?? 0,
        )
      )
        this.electrocute(
          ped,
          {
            position: frame.combatPosition ?? car.position,
            velocity: car.velocity ?? new THREE.Vector3(),
            owner: frame.combatOwner,
            readRayOrigin: frame.readCombatRayOrigin,
          },
          timeMs,
          "electric",
        );
      if (!ped.alive) {
        ped.fallTime += dt;
        if (ped.fallTime < 2) {
          const previous = p.clone();
          p.addScaledVector(ped.velocity, dt);
          ped.velocity.multiplyScalar(Math.exp(-dt * 3));
          const y = this.groundAt(p.x, p.z, p.y + 0.3);
          if (y !== null) p.y = y + 0.025;
          if (!ped.presentation) {
            ped.visual.rotation.x = Math.min(Math.PI / 2, ped.fallTime * 5);
            ped.visual.position.y = Math.max(
              0.055,
              ped.footOffset * (1 - ped.fallTime * 4),
            );
          }
          if (
            y !== null &&
            ped.fallTime > 0.2 &&
            Math.hypot(p.x - previous.x, p.z - previous.z) > 0
          )
            this.blood?.smear(
              previous,
              p,
              0.1 +
                new THREE.Box3()
                  .setFromObject(ped.visual)
                  .getSize(new THREE.Vector3()).x,
            );
        }
        if (!ped.settled && ped.fallTime >= 2) {
          ped.settled = true;
          ped.action = PedAction.Dead;
          ped.moveId = 94;
          this.blood?.settled(p, timeMs);
        }
        continue;
      }
      if (this.nativeBridge?.movementOwned(ped)) continue;
      if (ped.turnEnd) {
        if (timeMs >= ped.turnEnd) {
          ped.heading = ped.turnTo;
          ped.turnEnd = 0;
        } else {
          ped.heading = pedInterpolateDirection(
            ped.turnFrom,
            ped.turnTo,
            (timeMs - ped.turnStart) / (ped.turnEnd - ped.turnStart),
          );
        }
      }
      const t = segmentLength
        ? THREE.MathUtils.clamp(
            ((p.x - from.x) * dx + (p.z - from.z) * dz) / segmentLength,
            0,
            1,
          )
        : 1;
      const distance = Math.hypot(p.x - from.x - dx * t, p.z - from.z - dz * t),
        nearCarY = from.y + (to.y - from.y) * t;
      if (
        !this.nativeBridge?.owns(ped) &&
        Math.abs(car.speed) > 0.45 &&
        distance < 0.34 &&
        Math.abs(p.y - nearCarY) < 0.45
      ) {
        const velocity = new THREE.Vector3(
          -Math.sin(car.yaw),
          0,
          -Math.cos(car.yaw),
        ).multiplyScalar(THREE.MathUtils.clamp(car.speed * 0.45, -2, 2));
        this.kill(
          ped,
          timeMs,
          Math.abs(car.speed),
          velocity,
          ped.profile.mass * Math.abs(car.speed) * 6.9,
          frame.combatOwner,
          "vehicle",
          91,
        );
        continue;
      }
      if (ped.corporeal) {
        // Generic PHIL gravity in actor units (installed 0x4b6c60); the native
        // combat V increment is already in these units and is not divided again.
        ped.velocity.y -=
          (9.8 / 6.9) *
          (frame.gravityMultiplier ?? 1) *
          (volumeGravity ?? 1) *
          dt;
        p.addScaledVector(ped.velocity, dt);
        const rate = ped.angularVelocity.length();
        if (rate > 0)
          ped.object.quaternion
            .multiply(
              new THREE.Quaternion().setFromAxisAngle(
                ped.angularVelocity.clone().divideScalar(rate),
                rate * dt,
              ),
            )
            .normalize();
        // This is the existing height bridge, not native articulated contacts.
        const ground = this.groundAt(p.x, p.z, p.y + 0.3);
        if (ground !== null && p.y < ground) {
          p.y = ground;
          if (ped.velocity.y < 0) ped.velocity.y = 0;
        }
        continue;
      }
      if (
        ped.action === PedAction.Panicking &&
        [2, 3, 4, 5, 6, 10, 11, 13].includes(ped.moveId) &&
        timeMs - ped.actionSinceMs >=
          (ped.profile.moveDuration.get(ped.moveId) ?? 500)
      ) {
        // CBMoveCompleted: scared/pleading moves2..6/10/11 reverse direction,
        // start move41 and accelerate by reducing its100ms frame period to30.
        if (ped.moveId !== 13)
          this.setDirection(ped, ped.heading + Math.PI, 0, timeMs);
        ped.action = PedAction.Running;
        ped.moveId = this.reactionMove(ped, 41);
        ped.runPeriod = 100;
        ped.actionSinceMs = timeMs;
      }
      if (ped.action === PedAction.Running)
        ped.runPeriod = Math.max(
          30,
          Math.trunc(ped.runPeriod - dt * 1000 * 0.09),
        );
      const period =
        ped.action === PedAction.Running ? ped.runPeriod : ped.walkPeriod;
      const speed =
        ped.action === PedAction.Panicking || !period
          ? 0
          : ((ped.profile.moveDistance.get(ped.moveId) ?? 0) * 1000) / period;
      const velocity = new THREE.Vector3(
        Math.sin(ped.heading) * speed,
        0,
        Math.cos(ped.heading) * speed,
      );
      const movingAction =
          ped.action === PedAction.Walking || ped.action === PedAction.Running,
        causesMovement =
          !ped.profile.available.size ||
          (ped.profile.moveDistance.get(ped.moveId) ?? 0) !== 0;
      if (movingAction && causesMovement) {
        ped.proximity = this.rescan(ped, ped.heading);
        if (
          ped.action === PedAction.Walking &&
          !ped.turnEnd &&
          ped.nextTurnMs &&
          timeMs >= ped.nextTurnMs
        ) {
          ped.nextTurnMs = this.nextTurn(ped.movement, timeMs);
          const angle =
              (pedRandomInteger(this.random, 0, 99) < 50 ? 1 : -1) *
              pedRandomInteger(
                this.random,
                Math.trunc((65536 * 10) / 360),
                Math.trunc(
                  (65536 * ped.movement.maxTurnRadians) / (Math.PI * 2),
                ),
              ) *
              ((Math.PI * 2) / 65536),
            candidate = ped.heading + angle,
            scan = this.rescan(ped, candidate);
          if (!scan.flags) {
            this.setDirection(ped, candidate, 1, timeMs);
            ped.proximity = scan;
          }
        }
      }
      ped.proximity.flags &= ~4;
      const root = p
        .clone()
        .add(
          new THREE.Vector3(
            0,
            ped.profile.groundingOffset.get(ped.moveId) ?? 0.15,
            0,
          ),
        );
      let threat =
        movingAction && causesMovement
          ? predictPedThreat(
              root,
              velocity,
              threats,
              pedRandomFloat(this.random, 0.8, 1.2),
            )
          : null;
      if (
        threat &&
        ped.proximity.flags & 2 &&
        !(threat.corridorSquared / ped.proximity.distance ** 2 < 0.25)
      )
        threat = null;
      if (threat) {
        ped.proximity.flags |= 4;
        ped.proximity.position.copy(threat.threat.position);
        ped.proximity.normal.copy(root).sub(threat.threat.position).normalize();
        if (!ped.proximity.normal.lengthSq()) ped.proximity.normal.set(1, 0, 0);
        ped.proximity.velocity.copy(
          threat.threat.velocity ??
            new THREE.Vector3(
              -Math.sin(threat.threat.yaw) * threat.threat.speed,
              0,
              -Math.cos(threat.threat.yaw) * threat.threat.speed,
            ),
        );
      }
      if (
        threat &&
        (threat.threat.velocity?.lengthSq() ?? threat.threat.speed ** 2) > 1
      ) {
        ped.lastScareMs = timeMs;
        if (ped.action === PedAction.Walking) {
          const moves = [2, 2, 2, 2, 2, 2, 3, 4];
          ped.moveId = this.reactionMove(
            ped,
            moves[pedRandomInteger(this.random, 0, 7)],
          );
          ped.action = PedAction.Panicking;
          ped.actionSinceMs = timeMs;
          ped.firstScareMs = timeMs;
          this.setDirection(
            ped,
            Math.atan2(
              threat.threat.position.x - p.x,
              threat.threat.position.z - p.z,
            ),
            0,
            timeMs,
          );
        } else if (timeMs - ped.firstScareMs > 9999) {
          // The installed scanner samples this table on every eligible scan
          // after ten seconds; it does not reset the initial scare timestamp.
          const choices = [2, 2, 2, 10, 11, 13, -41, -41, -41];
          const selected = choices[pedRandomInteger(this.random, 0, 8)],
            move = this.reactionMove(ped, Math.abs(selected));
          if (![13, 40, 41].includes(move))
            this.setDirection(
              ped,
              Math.atan2(
                threat.threat.position.x - p.x,
                threat.threat.position.z - p.z,
              ),
              0,
              timeMs,
            );
          if (move !== ped.moveId) ped.actionSinceMs = timeMs;
          ped.moveId = move;
          ped.action = selected < 0 ? PedAction.Running : PedAction.Panicking;
        }
      } else if (
        ped.action === PedAction.Running &&
        timeMs - ped.lastScareMs > 9999
      ) {
        ped.action = PedAction.Walking;
        ped.moveId = ped.walkPeriod ? 30 : 0;
        ped.walkPeriod = pedRandomInteger(
          this.random,
          ped.movement.minWalkPeriod,
          ped.movement.maxWalkPeriod,
        );
        ped.actionSinceMs = timeMs;
      }
      if (
        movingAction &&
        causesMovement &&
        (ped.action === PedAction.Walking ||
          ped.action === PedAction.Running) &&
        ped.proximity.flags
      ) {
        const proximity = ped.proximity,
          delta = root.clone().sub(proximity.position),
          squared = delta.lengthSq();
        if (
          squared < this.settings.avoidDistance ** 2 &&
          !(proximity.flags === 4 && timeMs < ped.nextAvoidMs)
        ) {
          const distance = Math.min(
            0.5,
            Math.max(0, Math.sqrt(squared) - this.settings.reach) *
              pedRandomFloat(this.random, 0.7, 1),
          );
          if (
            proximity.flags === 1 &&
            !distance &&
            ped.action === PedAction.Running
          )
            ped.proximity.flags = 0;
          else {
            if (proximity.flags === 4)
              ped.nextAvoidMs =
                timeMs + pedRandomInteger(this.random, 200, 500);
            const normal = proximity.normal,
              current = new THREE.Vector3(
                Math.sin(ped.heading),
                0,
                Math.cos(ped.heading),
              )
                .projectOnPlane(
                  ped.faceCache?.box.up ?? new THREE.Vector3(0, 1, 0),
                )
                .normalize();
            let first: THREE.Vector3;
            if (!squared) first = normal.clone();
            else {
              let transverse: THREE.Vector3;
              if (Math.abs(normal.dot(current)) > 0.985)
                transverse = new THREE.Vector3(
                  0,
                  pedRandomInteger(this.random, 0, 99) < 50 ? -1 : 1,
                  0,
                );
              else transverse = normal.clone().cross(current).normalize();
              first = transverse.clone().cross(normal).normalize();
              if (
                proximity.velocity.lengthSq() &&
                first.dot(proximity.velocity) < 0
              )
                first.negate();
            }
            let scanned = proximity;
            const chosen = selectPedAvoidanceDirection(
              first,
              (candidate) => {
                const heading = Math.atan2(candidate.x, candidate.z);
                this.setDirection(ped, heading, distance, timeMs);
                scanned = this.rescan(ped, heading, scanned);
                return scanned;
              },
              squared !== 0,
            );
            this.setDirection(
              ped,
              Math.atan2(chosen.direction.x, chosen.direction.z),
              distance,
              timeMs,
            );
            ped.proximity = chosen.scan;
          }
        }
      }
      if (
        ped.action === PedAction.Walking ||
        ped.action === PedAction.Running
      ) {
        const stepSpeed =
          ((ped.profile.moveDistance.get(ped.moveId) ?? 0) * 1000) /
          (ped.action === PedAction.Running
            ? ped.runPeriod
            : Math.max(1, ped.walkPeriod));
        const x = p.x + Math.sin(ped.heading) * stepSpeed * dt,
          z = p.z + Math.cos(ped.heading) * stepSpeed * dt;
        const ground = this.floorAt(ped, x, z);
        if (ground !== null && Math.abs(ground - p.y) < 0.4347826)
          p.set(x, ground, z);
        else ped.heading += Math.PI;
      }
      ped.object.rotation.y = ped.heading;
      const moving =
        ped.action === PedAction.Walking || ped.action === PedAction.Running;
      const step = moving
        ? Math.sin(
            ((timeMs /
              (ped.action === PedAction.Running
                ? ped.runPeriod
                : Math.max(1, ped.walkPeriod))) *
              Math.PI) /
              15 +
              ped.phase,
          )
        : 0;
      if (!ped.presentation)
        ped.visual.position.y = ped.footOffset + Math.abs(step) * 0.003;
      for (const limb of ped.limbs) {
        if (limb.kind === "arm")
          limb.object.rotation.x = -step * 0.35 * limb.side;
        else if (limb.kind === "leg")
          limb.object.rotation.x = step * 0.4 * limb.side;
        else limb.object.rotation.x = Math.max(0, -step * limb.side) * 0.35;
      }
    }
    // Only processed ordinary actors advance their original animation. Distant
    // visible actors retain their last pose; PHIL-backed owners have a separate
    // pose owner under PED-06 and must never receive this presentation bridge.
    for (const ped of presented) this.posePresentation(ped, timeMs);

    this.updateNapalm(timeMs, frame.framePeriodMs ?? dt * 1000);
    this.updateCombatRays(timeMs);
    this.burnExplosion?.update(timeMs);
    this.blood?.update(dt, timeMs);
    this.nearReset = false;
    this.lastAnimationTime = Math.trunc(timeMs) >>> 0;
    this.previousCar.copy(car.position);
  }

  private posePresentation(ped: Ped, timeMs: number, reset = false): void {
    const presentation = ped.presentation;
    if (!presentation) return;
    const period =
      ped.action === PedAction.Running
        ? ped.runPeriod
        : ped.action === PedAction.Walking
          ? ped.walkPeriod || (ped.profile.movePeriod.get(ped.moveId) ?? 0)
          : (ped.profile.movePeriod.get(ped.moveId) ?? 0);
    const input = {
      parent: ped.object,
      worldPosition: ped.object.position,
      heading: ped.heading,
      groundY: ped.object.position.y,
      moveId: ped.moveId,
      periodMs: period,
      timeMs: Math.trunc(timeMs) >>> 0,
      alive: ped.alive,
      action: ped.action,
      deadModelSet: ped.deadModelSet,
      still: !ped.alive && ped.settled,
      mutantSpeed: this.combatFrame.pedestrianAnimation?.mutantSpeed ?? 0,
      sameTimeGuard: this.lastAnimationTime === Math.trunc(timeMs) >>> 0,
      headSequence: ped.alive
        ? ped.action === PedAction.Walking
          ? ("calm" as const)
          : ped.lastScareMs
            ? ("scare" as const)
            : undefined
        : undefined,
      legacyRigid: ped.corporeal,
      legacyFall: !ped.alive
        ? {
            pitchRadians: Math.min(Math.PI / 2, ped.fallTime * 5),
            rootHeight: Math.max(
              0.055,
              ped.footOffset * (1 - ped.fallTime * 4),
            ),
          }
        : undefined,
    };
    const result = reset
      ? presentation.reset(input)
      : presentation.update(input);
    if (ped.alive) ped.footOffset = presentation.groundingOffset;
    else if (
      result.status === "complete" &&
      presentation.instance.moveId !== null
    )
      ped.moveId = presentation.instance.moveId;
    for (const required of result.requiredProviders) {
      const warning = `${ped.object.name}: animation provider required: ${required}`;
      if (!this.warnings.includes(warning)) this.warnings.push(warning);
    }
  }

  /** Presentation alone may expose retained distant poses. Processing, combat
   * eligibility, movement and animation still use the original active flag. */
  updatePresentation(
    cameraPosition: THREE.Vector3,
    visualDistance: number,
    frustum?: THREE.Frustum,
  ): void {
    this.dormantRenderActors.clear();
    this.group.updateWorldMatrix(true, false);
    const sphere = this.presentationSphere;
    // Original pedestrian models fit comfortably inside this conservative
    // envelope; include group scaling without traversing any limb hierarchy.
    sphere.radius = 2 * this.group.matrixWorld.getMaxScaleOnAxis();
    const distance = Math.max(0, visualDistance) + sphere.radius;
    for (const ped of this.peds) {
      // An exhausted native slot must not become a visible, unhittable nearby
      // substitute. Far retained poses remain the presentation-only extension.
      if (
        this.nativeBridge?.owns(ped) &&
        !this.nativeBridge.canShowRetained(ped)
      ) {
        ped.object.visible = false;
        continue;
      }
      // Native transport may reparent and animate this actor independently.
      if (
        this.nativeBridge?.admitted(ped) ||
        (ped.nativeCountingCharacter && !this.nativeBridge?.owns(ped))
      )
        continue;
      sphere.center
        .copy(ped.object.position)
        .applyMatrix4(this.group.matrixWorld);
      ped.object.visible =
        !ped.vanished &&
        (ped.active ||
          (sphere.center.distanceToSquared(cameraPosition) <=
            distance * distance &&
            (!frustum || frustum.intersectsSphere(sphere))));
      if (ped.object.visible && !ped.active)
        this.dormantRenderActors.add(ped.object);
    }
  }

  resetCar(position: THREE.Vector3) {
    this.previousCar.copy(position);
    this.nearReset = true;
  }

  /** CalculateCameraStuff resets nearness after a camera jump greater than 20
   * actor units. Camera calculation follows pedestrian processing, so this
   * one-frame override belongs to the next ordinary population update. */
  noteCameraPosition(position: THREE.Vector3): void {
    if (
      this.previousCamera &&
      position.distanceToSquared(this.previousCamera) > 400
    )
      this.nearReset = true;
    (this.previousCamera ??= new THREE.Vector3()).copy(position);
  }

  reset() {
    const nativeSimulation = this.nativeSimulation;
    this.disposeNativePhysics();
    this.dormantRenderActors.clear();
    this.presentationRevision++;
    this.population.reset();
    this.nativeCountingOwners.clear();
    for (let slot = 0; slot < NAPALM_CAPACITY; slot++) this.releaseNapalm(slot);
    for (const ped of this.peds)
      this.options.onNapalmExtinguished?.(ped.object);
    this.burnExplosion?.dispose();
    if (this.burnExplosion)
      this.burnExplosion = new ExplosionRuntime(
        this.group,
        this.combatTextures,
        { random: this.options.combatRandom ?? sharedNativeRandom.random },
      );
    this.clearCombatRays();
    this.combatFrame = {};
    this.blood?.reset();
    this.nearReset = true;
    this.previousCamera = undefined;
    this.elapsed = 0;
    this.previousCar.copy(this.options.spawn);
    for (const ped of this.peds) {
      ped.nativeCountingCharacter = undefined;
      ped.alive = true;
      ped.vanished = false;
      ped.action = PedAction.Walking;
      ped.moveId = ped.walkPeriod ? 30 : 0;
      ped.active = false;
      ped.corporeal = false;
      ped.angularVelocity.set(0, 0, 0);
      ped.networkStateCutoffMs = 0;
      ped.combatOwner = undefined;
      ped.awardCauseFlags = 0;
      ped.startingVelocity.set(0, 0, 0);
      ped.burningUntilMs = 0;
      ped.napalmSlot = -1;
      ped.settled = false;
      ped.lastScareMs = 0;
      ped.proximity = emptyPedProximity();
      ped.faceCache = undefined;
      ped.firstScareMs = 0;
      ped.nextAvoidMs = 0;
      ped.turnEnd = 0;
      ped.actionSinceMs = 0;
      ped.runPeriod = 100;
      ped.nextTurnMs = this.nextTurn(ped.movement, 0);
      ped.fallTime = 0;
      ped.deadModelSet = 0;
      ped.heading = ped.initialYaw;
      ped.object.position.copy(ped.home);
      ped.object.rotation.set(0, ped.heading, 0);
      if (ped.presentation) this.posePresentation(ped, 0, true);
      else {
        ped.visual.rotation.set(0, 0, 0);
        ped.visual.position.y = ped.footOffset;
      }
      ped.velocity.set(0, 0, 0);
      for (const limb of ped.limbs) limb.object.rotation.x = 0;
    }
    if (nativeSimulation) this.initializeNativePhysics(nativeSimulation);
  }

  private clearCombatRays() {
    for (const ray of this.proximityRays)
      if (ray) {
        ray.object.geometry.dispose();
        (ray.object.material as THREE.Material).dispose();
        ray.object.removeFromParent();
      }
    this.proximityRays.fill(undefined);
    this.repulseRays.fill(undefined);
    for (const mesh of this.repulseMeshes) mesh.visible = false;
  }
  dispose() {
    this.disposeNativePhysics();
    this.nativeSimulation = undefined;
    this.previousCamera = undefined;
    this.lastAnimationTime = undefined;
    this.dormantRenderActors.clear();
    this.presentationRevision++;
    this.clearCombatRays();
    for (const ped of this.peds)
      if (ped.burningUntilMs > 0)
        this.options.onNapalmExtinguished?.(ped.object);
    this.blood?.dispose();
    for (let slot = 0; slot < NAPALM_CAPACITY; slot++) this.releaseNapalm(slot);
    this.burnExplosion?.dispose();
    this.combatTextures.forEach((texture) => texture.dispose());
    this.combatTextures.clear();
    for (const sprites of this.flameSprites)
      for (const sprite of sprites) {
        sprite.material.dispose();
        sprite.removeFromParent();
      }
    this.flameSprites = [];
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    // Native templates own their borrowed scene resources and remapped models.
    // Remove instance trees before disposing procedural fixture resources.
    for (const ped of this.peds) ped.presentation?.dispose();
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      geometries.add(o.geometry);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
        materials.add(m),
      );
    });
    for (const effects of this.nativeVisuals.values()) effects.dispose();
    this.nativeVisuals.clear();
    for (const models of this.nativeDeadModels.values()) models.dispose();
    this.nativeDeadModels.clear();
    this.nativeSlickMaterials?.dispose(() => !this.nativeBridge);
    this.nativeSmear?.dispose();
    this.nativeSmear = undefined;
    this.nativeDeadMaterials.dispose();
    for (const template of this.nativeTemplates.values()) template.dispose();
    this.nativeTemplates.clear();
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    // Textures belong to the asset cache and may be used by other loaded scenes.
    this.group.removeFromParent();
    this.group.clear();
    this.renderActors.clear();
    this.peds = [];
    this.population.clear();
    this.nativeCountingOwners.clear();
  }
}
