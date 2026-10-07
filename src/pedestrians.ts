import * as THREE from "three";
import type { Assets } from "./content";
import { WORLD_METRES_PER_UNIT } from "./gameplay";

export interface PedSpawnSpec {
  material: string;
  movement: number;
  group: number;
  density: number;
  exclusions: string[];
  exceptions: string[];
}
export interface PedHitEvent {
  count: number;
  total: number;
  speed: number;
  position: THREE.Vector3;
}
export type PedGround = (x: number, z: number, nearY: number) => number | null;
export interface PedOptions {
  spawn: THREE.Vector3;
  maxCount?: number;
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
      exceptions: string[] = [];
    const exclusionCount = integer();
    for (let j = 0; j < exclusionCount; j++) {
      integer();
      exclusions.push(lines[at++]);
    }
    const exceptionCount = integer();
    for (let j = 0; j < exceptionCount; j++) exceptions.push(lines[at++]);
    if ([...exclusions, ...exceptions].some((s) => !s))
      throw new Error("Truncated pedestrian material lists");
    specs.push({ material, movement, group, density, exclusions, exceptions });
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
  weight: number;
  expected: number;
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

function collectSurfaces(
  track: THREE.Object3D,
  specs: PedSpawnSpec[],
  spawn: THREE.Vector3,
): Surface[] {
  const byMaterial = new Map(specs.map((s) => [normalized(s.material), s]));
  const out: Surface[] = [];
  track.updateMatrixWorld(true);
  track.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const geometry = o.geometry,
      pos = geometry.getAttribute("position"),
      index = geometry.index;
    if (!pos) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    const groups = geometry.groups.length
      ? geometry.groups
      : [{ start: 0, count: index?.count ?? pos.count, materialIndex: 0 }];
    for (const group of groups) {
      const material = materials[group.materialIndex ?? 0];
      const spec = byMaterial.get(normalized(material?.name ?? ""));
      if (!spec || spec.density === 0) continue;
      for (let i = group.start; i < group.start + group.count; i += 3) {
        const [a, b, c] = [0, 1, 2].map((j) =>
          new THREE.Vector3()
            .fromBufferAttribute(pos, index ? index.getX(i + j) : i + j)
            .applyMatrix4(o.matrixWorld),
        );
        const cross = b.clone().sub(a).cross(c.clone().sub(a)),
          area = cross.length() / 2;
        if (!area || cross.y / cross.length() < 0.75) continue;
        const center = a
          .clone()
          .add(b)
          .add(c)
          .multiplyScalar(1 / 3);
        const distance = Math.hypot(center.x - spawn.x, center.z - spawn.z);
        // The browser's bounded population favors nearby configured surfaces.
        const expected =
          spec.density < 0
            ? -spec.density
            : (area * WORLD_METRES_PER_UNIT ** 2 * spec.density) / 100;
        const weight = expected / (1 + (distance / 15) ** 2);
        out.push({ a, b, c, spec, weight, expected });
      }
    }
  });
  return out;
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

/** Original textured pedestrians on original spawn materials. Movement, falling,
 * the population cap, and vehicle contacts are browser arcade approximations. */
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
  private constructor(
    private groundAt: PedGround,
    private options: PedOptions,
    specs: PedSpawnSpec[],
  ) {
    this.specs = specs;
    this.previousCar = options.spawn.clone();
    this.group.name = "original-pedestrians";
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
    const surfaces = collectSurfaces(track, specs, options.spawn);
    if (!surfaces.length) {
      system.warnings.push(
        "No rendered surfaces match pedestrian spawn materials",
      );
      return system;
    }
    let groups = new Map<number, string[]>();
    try {
      groups = parsePedGroups(await assets.text("data/PEDS/settings.txt"));
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
    // Cap template libraries separately from the number of visible instances.
    for (const name of names.slice(0, 10)) {
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
        if (!Number.isFinite(size.y) || size.y < 0.1 || size.y > 1.5) continue;
        templates.set(name.toLowerCase(), result.group);
      } catch (e) {
        system.warnings.push(`Pedestrian ${name}: ${e}`);
      }
    }
    if (!templates.size) {
      system.warnings.push("No original pedestrian actor packages loaded");
      return system;
    }
    const totalWeight = surfaces.reduce((n, s) => n + s.weight, 0);
    const expectedCount = Math.ceil(
      surfaces.reduce((n, s) => n + s.expected, 0),
    );
    const limit = Math.min(
      240,
      Math.max(0, options.maxCount ?? 80),
      expectedCount,
    );
    const templateNames = [...templates.keys()];
    for (let tries = 0; system.count < limit && tries < limit * 40; tries++) {
      let choice = system.random() * totalWeight,
        surface = surfaces.at(-1)!;
      for (const s of surfaces) {
        choice -= s.weight;
        if (choice <= 0) {
          surface = s;
          break;
        }
      }
      const u = Math.sqrt(system.random()),
        v = system.random();
      const position = surface.a
        .clone()
        .multiplyScalar(1 - u)
        .addScaledVector(surface.b, u * (1 - v))
        .addScaledVector(surface.c, u * v);
      const y = groundAt(position.x, position.z, position.y + 0.2);
      if (y === null || Math.abs(y - position.y) > 0.35) continue;
      position.y = y;
      if (
        position.distanceToSquared(options.spawn) < 1 ||
        system.peds.some((p) => p.home.distanceToSquared(position) < 0.1)
      )
        continue;
      const choices = (groups.get(surface.spec.group) ?? templateNames)
        .map((n) => n.toLowerCase())
        .filter((n) => templates.has(n));
      const name = (choices.length ? choices : templateNames)[
        Math.floor(system.random() * (choices.length || templateNames.length))
      ];
      const visual = templates.get(name)!.clone(true);
      const rig = rigPedestrian(visual);
      visual.position.y = rig.footOffset;
      const object = new THREE.Group();
      object.name = `ped-${name}-${system.count}`;
      object.position.copy(position);
      object.add(visual);
      const heading = system.random() * Math.PI * 2;
      object.rotation.y = heading;
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
      });
      system.group.add(object);
    }
    return system;
  }

  update(
    dt: number,
    car: { position: THREE.Vector3; yaw: number; speed: number },
  ) {
    dt = THREE.MathUtils.clamp(dt, 0, 0.1);
    this.elapsed += dt;
    const from = this.previousCar,
      to = car.position,
      dx = to.x - from.x,
      dz = to.z - from.z;
    const segmentLength = dx * dx + dz * dz;
    for (const ped of this.peds) {
      const p = ped.object.position;
      if (!ped.alive) {
        ped.fallTime += dt;
        if (ped.fallTime < 2) {
          p.addScaledVector(ped.velocity, dt);
          ped.velocity.multiplyScalar(Math.exp(-dt * 3));
          const y = this.groundAt(p.x, p.z, p.y + 0.3);
          if (y !== null) p.y = y + 0.025;
          ped.visual.rotation.x = Math.min(Math.PI / 2, ped.fallTime * 5);
          ped.visual.position.y = Math.max(
            0.055,
            ped.footOffset * (1 - ped.fallTime * 4),
          );
        }
        continue;
      }
      const t = segmentLength
        ? THREE.MathUtils.clamp(
            ((p.x - from.x) * dx + (p.z - from.z) * dz) / segmentLength,
            0,
            1,
          )
        : 1;
      const distance = Math.hypot(p.x - from.x - dx * t, p.z - from.z - dz * t);
      const nearCarY = from.y + (to.y - from.y) * t;
      if (
        Math.abs(car.speed) > 0.45 &&
        distance < 0.34 &&
        Math.abs(p.y - nearCarY) < 0.45
      ) {
        ped.alive = false;
        this.hits++;
        ped.velocity
          .set(-Math.sin(car.yaw), 0, -Math.cos(car.yaw))
          .multiplyScalar(THREE.MathUtils.clamp(car.speed * 0.45, -2, 2));
        this.options.onHit?.({
          count: 1,
          total: this.hits,
          speed: Math.abs(car.speed),
          position: p.clone(),
        });
        continue;
      }
      // Avoid approaching cars; otherwise wander within the spawn patch.
      const carDistance = p.distanceTo(to),
        fleeing = carDistance < 2 && Math.abs(car.speed) > 0.8;
      if (fleeing) ped.heading = Math.atan2(p.x - to.x, p.z - to.z);
      else if (Math.hypot(p.x - ped.home.x, p.z - ped.home.z) > 2.5)
        ped.heading = Math.atan2(ped.home.x - p.x, ped.home.z - p.z);
      else ped.heading += Math.sin(this.elapsed * 0.4 + ped.phase) * dt * 0.2;
      const speed = fleeing ? 0.55 : 0.16;
      const x = p.x + Math.sin(ped.heading) * speed * dt,
        z = p.z + Math.cos(ped.heading) * speed * dt;
      const ground = this.groundAt(x, z, p.y + 0.1);
      if (ground !== null && Math.abs(ground - p.y) < 0.12) p.set(x, ground, z);
      else ped.heading += Math.PI * 0.75;
      ped.object.rotation.y = ped.heading;
      const step = Math.sin(this.elapsed * (fleeing ? 13 : 7) + ped.phase);
      ped.visual.position.y = ped.footOffset + Math.abs(step) * 0.003;
      for (const limb of ped.limbs) {
        if (limb.kind === "arm")
          limb.object.rotation.x = -step * 0.35 * limb.side;
        else if (limb.kind === "leg")
          limb.object.rotation.x = step * 0.4 * limb.side;
        else limb.object.rotation.x = Math.max(0, -step * limb.side) * 0.35;
      }
    }
    this.previousCar.copy(car.position);
  }

  resetCar(position: THREE.Vector3) {
    this.previousCar.copy(position);
  }
  reset() {
    this.hits = 0;
    this.elapsed = 0;
    this.previousCar.copy(this.options.spawn);
    for (const ped of this.peds) {
      ped.alive = true;
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
