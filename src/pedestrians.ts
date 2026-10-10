import * as THREE from "three";
import type { Assets } from "./content";
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
}
export type PedGround = (x: number, z: number, nearY: number) => number | null;
export interface PedOptions {
  spawn: THREE.Vector3;
  /** Explicit test/debug override; production uses the original 2000 cap. */
  maxCount?: number;
  random?: () => number;
  collision?: Pick<WorldCollision, "raycast"> &
    Partial<Pick<WorldCollision, "querySurfaces">>;
  onHit?: (event: PedHitEvent) => void;
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

export interface PedMotion {
  bones: Array<{ name: string; children: number[] }>;
  frameCount: number;
  /** Frame-major, then bone-major, twelve little-endian floats per matrix. */
  matrices: Float32Array;
}
/** BON and SKL share the 3DS exporter layout; they store motion, not meshes.
 * Parsed for inspection/future skeletal playback. The runtime below uses a
 * procedural rigid-part walk rather than reproducing the original bone remaps. */
export function parsePedMotion(bytes: Uint8Array): PedMotion {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const need = (n: number) => {
    if (!Number.isSafeInteger(n) || n < 0 || at + n > bytes.length)
      throw new Error("Truncated BON/SKL motion");
  };
  const u32 = () => {
    need(4);
    const n = view.getUint32(at, true);
    at += 4;
    return n;
  };
  const count = u32(),
    frameCount = u32();
  if (!count || count > 256 || !frameCount || frameCount > 20_000)
    throw new Error("Invalid BON/SKL counts");
  const bones: PedMotion["bones"] = [];
  for (let i = 0; i < count; i++) {
    need(33);
    const end = bytes.subarray(at, at + 33).indexOf(0);
    const name = String.fromCharCode(
      ...bytes.subarray(at, at + (end < 0 ? 33 : end)),
    );
    at += 33;
    const childCount = u32();
    if (childCount > 256) throw new Error("Invalid BON/SKL child count");
    need(childCount * 4);
    const children = Array.from({ length: childCount }, u32);
    // Exported child IDs are one based; 10000 marks a terminal reference.
    if (children.some((c) => c !== 10000 && (c < 1 || c > count)))
      throw new Error("Invalid BON/SKL child reference");
    bones.push({ name, children });
  }
  const length = count * frameCount * 12;
  need(length * 4);
  const matrices = new Float32Array(length);
  for (let i = 0; i < length; i++, at += 4) {
    matrices[i] = view.getFloat32(at, true);
    if (!Number.isFinite(matrices[i]))
      throw new Error("Invalid BON/SKL matrix");
  }
  if (at !== bytes.length) throw new Error("Unexpected trailing BON/SKL data");
  return { bones, frameCount, matrices };
}

interface Surface {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
  spec: PedSpawnSpec;
  count: number;
}
interface Limb {
  object: THREE.Group;
  side: number;
  kind: "arm" | "leg" | "knee";
}
interface Ped {
  object: THREE.Group;
  visual: THREE.Group;
  limbs: Limb[];
  footOffset: number;
  home: THREE.Vector3;
  initialYaw: number;
  heading: number;
  phase: number;
  alive: boolean;
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
  settled: boolean;
  profile: PedProfile;
  proximity: PedProximity;
  faceCache?: {
    box: ReturnType<typeof pedFaceCacheBox>;
    faces: WorldSurface[];
  };
}
interface PedProfile {
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
}

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
        cross.y / cross.length() <= Math.cos((maxSlopeDegrees * Math.PI) / 180)
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
      await assets.text(`data/PEDS/PEEPS/${name}/${name}.TXT`),
    );
    const formText = await assets.text(`data/PEDS/FORMS/${personality[0]}.TXT`),
      form = clean(formText);
    const moveStart = form.indexOf("START OF MOVES"),
      moveEnd = form.indexOf("END OF MOVES", moveStart);
    const defaults = clean(
      await assets.text(`data/PEDS/MOVES/${personality[1]}.TXT`),
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
    const jump = personality.findIndex(
      (row) => row.toUpperCase() === "JUMPHEIGHT",
    );
    if (jump >= 0 && Number.isFinite(Number(personality[jump + 1])))
      profile.jumpHeight = Number(personality[jump + 1]);
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
      const motion = parsePedMotion(
        await assets.bytes(`data/PEDS/MOVES/${form[i + 4]}`),
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

/** Original face populations and reaction rules, with independent rendering.
 * Vehicle sweeps/death physics and rigid-part limb playback remain PED-03/ANI-01. */
export class PedestrianSystem {
  readonly group = new THREE.Group();
  readonly warnings: string[] = [];
  readonly specs: PedSpawnSpec[];
  readonly motionInfo?: { bones: number; frames: number };
  hits = 0;
  private peds: Ped[] = [];
  private previousCar: THREE.Vector3;
  private random = randomGenerator(0x43a2c9);
  private elapsed = 0;
  private settings: PedSettings = DEFAULT_PED_SETTINGS;
  private blood?: PedBloodRuntime;
  private collision?: PedOptions["collision"];
  private nearReset = true;
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
  get states() {
    return this.peds.map((p) => ({
      action: p.action,
      moveId: p.moveId,
      active: p.active,
      position: p.object.position.clone(),
      group: p.spec.group,
      walkPeriod: p.walkPeriod,
    }));
  }
  get count() {
    return this.peds.length;
  }
  get alive() {
    return this.peds.length - this.hits;
  }
  get groupCounts() {
    const groups = new Map<number, { total: number; killed: number }>();
    for (const ped of this.peds) {
      let group = groups.get(ped.spec.group);
      if (!group) {
        group = { total: 0, killed: 0 };
        groups.set(ped.spec.group, group);
      }
      group.total++;
      if (!ped.alive) group.killed++;
    }
    return groups;
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
    if (!specs.length) {
      system.warnings.push(
        "Track has no readable pedestrian spawn specifications",
      );
      return system;
    }
    system.collision = options.collision ?? new WorldCollision(track);
    let settingsText = "";
    try {
      settingsText = await assets.text("data/PEDS/settings.txt");
      system.settings = parsePedSettings(settingsText);
    } catch (e) {
      system.warnings.push(`Pedestrian settings: ${e}`);
    }
    const surfaces = collectPedSurfaces(
      track,
      specs,
      system.settings.maxSlopeDegrees,
    );
    if (!surfaces.length) {
      system.warnings.push(
        "No rendered surfaces match pedestrian spawn materials",
      );
      return system;
    }
    let groups = new Map<number, string[]>();
    try {
      groups = parsePedGroups(
        settingsText || (await assets.text("data/PEDS/settings.txt")),
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
    const templates = new Map<string, THREE.Group>();
    const profiles = new Map<string, PedProfile>();
    for (const name of names) {
      const prefix = `data/peds/peeps/${name.toLowerCase()}/`;
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
        profiles.set(name.toLowerCase(), await loadPedProfile(assets, name));
      } catch (e) {
        system.warnings.push(`Pedestrian ${name}: ${e}`);
      }
    }
    if (!templates.size) {
      system.warnings.push("No original pedestrian actor packages loaded");
      return system;
    }
    const limit = Math.min(
      PED_POPULATION_CAPACITY,
      Math.max(0, options.maxCount ?? PED_POPULATION_CAPACITY),
    );
    const templateNames = [...templates.keys()];
    for (const surface of surfaces) {
      const choices = (groups.get(surface.spec.group) ?? templateNames)
        .map((n) => n.toLowerCase())
        .filter((n) => templates.has(n));
      if (!choices.length) {
        system.warnings.push(
          `No personality for pedestrian group ${surface.spec.group}`,
        );
        continue;
      }
      for (let i = 0; i < surface.count && system.count < limit; i++) {
        const name =
            choices[pedRandomInteger(system.random, 0, choices.length - 1)],
          visual = templates.get(name)!.clone(true);
        const position = pedTrianglePoint(
          surface.a,
          surface.b,
          surface.c,
          system.random,
        );
        const rig = rigPedestrian(visual);
        visual.position.y = rig.footOffset;
        const object = new THREE.Group();
        object.name = `ped-${name}-${system.count}`;
        object.position.copy(position);
        object.add(visual);
        const heading = Math.atan2(
          system.random() * 2 - 1,
          system.random() * 2 - 1,
        );
        object.rotation.y = heading;
        const movement =
          system.settings.movements[surface.spec.movement] ??
          DEFAULT_PED_SETTINGS.movements[0];
        const walkPeriod = pedRandomInteger(
          system.random,
          movement.minWalkPeriod,
          movement.maxWalkPeriod,
        );
        const profile = profiles.get(name)!;
        system.peds.push({
          object,
          visual,
          limbs: rig.limbs,
          footOffset: rig.footOffset,
          home: position.clone(),
          initialYaw: heading,
          heading,
          phase: system.random() * Math.PI * 2,
          alive: true,
          fallTime: 0,
          velocity: new THREE.Vector3(),
          spec: surface.spec,
          movement,
          walkPeriod,
          nextTurnMs: system.nextTurn(movement, 0),
          lastScareMs: 0,
          firstScareMs: 0,
          nextAvoidMs: 0,
          turnFrom: heading,
          turnTo: heading,
          turnStart: 0,
          turnEnd: 0,
          actionSinceMs: 0,
          runPeriod: 100,
          action: PedAction.Walking,
          moveId: walkPeriod ? 30 : 0,
          active: false,
          settled: false,
          profile,
          proximity: emptyPedProximity(),
        });
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
      );
      system.group.add(system.blood.group);
    } catch (e) {
      system.warnings.push(`Pedestrian blood: ${e}`);
    }
    return system;
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
      (hit.normal.y <=
        Math.cos((this.settings.maxSlopeDegrees * Math.PI) / 180) ||
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
    const timeMs = this.elapsed * 1000,
      from = this.previousCar,
      to = car.position,
      dx = to.x - from.x,
      dz = to.z - from.z,
      segmentLength = dx * dx + dz * dz;
    const camera = frame.cameraPosition ?? car.position,
      threats = frame.threats ?? [car];
    for (const ped of this.peds) {
      const p = ped.object.position;
      const inProcess =
        Math.abs(p.x - camera.x) < this.settings.processDistance &&
        Math.abs(p.y - camera.y) < 0.6 * this.settings.processDistance &&
        Math.abs(p.z - camera.z) < this.settings.processDistance;
      const inPopup =
        Math.abs(p.x - camera.x) <= this.settings.popupDistance &&
        Math.abs(p.y - camera.y) <= 0.6 * this.settings.popupDistance &&
        Math.abs(p.z - camera.z) <= this.settings.popupDistance;
      ped.active = inProcess && (ped.active || this.nearReset || !inPopup);
      ped.object.visible = ped.active;
      if (!ped.active) continue;
      if (!ped.alive) {
        ped.fallTime += dt;
        if (ped.fallTime < 2) {
          const previous = p.clone();
          p.addScaledVector(ped.velocity, dt);
          ped.velocity.multiplyScalar(Math.exp(-dt * 3));
          const y = this.groundAt(p.x, p.z, p.y + 0.3);
          if (y !== null) p.y = y + 0.025;
          ped.visual.rotation.x = Math.min(Math.PI / 2, ped.fallTime * 5);
          ped.visual.position.y = Math.max(
            0.055,
            ped.footOffset * (1 - ped.fallTime * 4),
          );
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
        Math.abs(car.speed) > 0.45 &&
        distance < 0.34 &&
        Math.abs(p.y - nearCarY) < 0.45
      ) {
        ped.alive = false;
        ped.action = PedAction.Impacting;
        ped.moveId = 91;
        ped.actionSinceMs = timeMs;
        this.hits++;
        ped.velocity
          .set(-Math.sin(car.yaw), 0, -Math.cos(car.yaw))
          .multiplyScalar(THREE.MathUtils.clamp(car.speed * 0.45, -2, 2));
        const bounds = new THREE.Box3().setFromObject(ped.visual);
        bounds.translate(p.clone().negate());
        const cloudPosition = p.clone();
        cloudPosition.y += ped.footOffset;
        // PED-03's swept contact has no native solver impulse yet. This explicit
        // momentum bridge supplies a dimensional force estimate to source effects.
        this.blood?.hit(
          cloudPosition,
          bounds,
          ped.velocity,
          ped.profile.mass * Math.abs(car.speed) * 6.9,
          timeMs,
        );
        this.options.onHit?.({
          timeMs,
          group: ped.spec.group,
          count: 1,
          total: this.hits,
          speed: Math.abs(car.speed),
          position: p.clone(),
        });
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
      ped.visual.position.y = ped.footOffset + Math.abs(step) * 0.003;
      for (const limb of ped.limbs) {
        if (limb.kind === "arm")
          limb.object.rotation.x = -step * 0.35 * limb.side;
        else if (limb.kind === "leg")
          limb.object.rotation.x = step * 0.4 * limb.side;
        else limb.object.rotation.x = Math.max(0, -step * limb.side) * 0.35;
      }
    }
    this.blood?.update(dt, timeMs);
    this.nearReset = false;
    this.previousCar.copy(car.position);
  }

  resetCar(position: THREE.Vector3) {
    this.previousCar.copy(position);
    this.nearReset = true;
  }
  reset() {
    this.hits = 0;
    this.blood?.reset();
    this.nearReset = true;
    this.elapsed = 0;
    this.previousCar.copy(this.options.spawn);
    for (const ped of this.peds) {
      ped.alive = true;
      ped.action = PedAction.Walking;
      ped.moveId = ped.walkPeriod ? 30 : 0;
      ped.active = false;
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
      ped.heading = ped.initialYaw;
      ped.object.position.copy(ped.home);
      ped.object.rotation.set(0, ped.heading, 0);
      ped.visual.rotation.set(0, 0, 0);
      ped.visual.position.y = ped.footOffset;
      ped.velocity.set(0, 0, 0);
      for (const limb of ped.limbs) limb.object.rotation.x = 0;
    }
  }

  dispose() {
    this.blood?.dispose();
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    this.group.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      geometries.add(o.geometry);
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
        materials.add(m),
      );
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    // Textures belong to the asset cache and may be used by other loaded scenes.
    this.group.removeFromParent();
    this.group.clear();
    this.peds = [];
  }
}
