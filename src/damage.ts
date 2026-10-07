import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  Group,
  Material,
  Matrix4,
  Mesh,
  Object3D,
  Texture,
  Vector3,
} from "three";

export interface WamSmashLevel {
  threshold: number;
  flags: number;
  pixelmaps: string[];
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
  kevOFlap?: boolean;
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

/** Consume documented smash connotations to preserve alignment. Audio, debris,
 * non-car activation, explosions and scripted awards are metadata only here.
 */
function skipConnotations(r: WamReader): void {
  r.skip(r.count()); // Sound IDs.
  const shrapnel = r.count();
  for (let i = 0; i < shrapnel; i++) {
    const type = r.read().toLowerCase();
    r.skip(6); // Initial velocity: vector pair plus five scalars.
    if (type !== "shards") {
      if (r.read().toLowerCase() === "sphereclumped") r.skip(2);
    }
    if (type !== "noncars") r.skip(1); // Lifetime pair.
    if (type === "shards") r.skip(3);
    else if (type === "ghostparts") {
      r.skip(1);
      const count = r.count();
      r.skip(Math.max(1, count));
    } else if (type === "noncars") {
      r.skip(1);
      if (r.number() > 0) r.skip(2);
      r.skip(1);
      r.skip(r.count() * 2);
    } else {
      throw new Error(`Unsupported WAM shrapnel type: ${type}`);
    }
  }
  const explosions = r.count();
  for (let i = 0; i < explosions; i++) {
    r.skip(9);
    r.skip(r.count() * 2);
  }
  r.skip(1); // Slick material.
  r.skip(r.count() * 11); // Non-car activation cuboids.
  r.skip(r.count() * 7); // Side-effect smash cuboids.
  r.skip(2); // Extension flags and room code.
  if (r.read().toLowerCase() !== "none") r.skip(4);
  r.skip(r.count()); // Runtime variable changes.
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
      part.kevOFlap = r.number() !== 0;
      part.ease = r.read();
      part.shape = r.read().toLowerCase();
    } else if (type === "detach") {
      part.ease = r.read();
      part.detachmentType = r.read();
      if (part.detachmentType.toLowerCase() === "joint_index") r.skip(1);
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
        skipConnotations(r);
        const pixelmaps = Array.from({ length: r.count() }, () => r.read());
        smash.levels.push({ threshold, flags, pixelmaps });
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
interface DamageMesh {
  mesh: Mesh;
  original: Float32Array;
  originalCar: Vector3[];
  lower: Vector3[];
  upper: Vector3[];
  part?: WamPart;
  materials: {
    material: Material & { map?: Texture | null };
    map?: Texture | null;
  }[];
  materialEnergy: number;
}
const key = (name: string) =>
  name.replace(/\.(act|dat|mat|pix)$/i, "").toLowerCase();
const clamp = (v: number, min: number, max: number) =>
  Math.max(min, Math.min(max, v));

/** Bounded radial deformation using original WAM softness and vertex regions.
 * Flap hinge vertices remain fixed. Shape samples are parsed but poly hulls,
 * hinge articulation, detachment, bending and splitting are not simulated.
 * All coordinates supplied to impact are local to the top-level car group.
 * strength is collision speed in original world units/second; its conversion
 * to dents and smash energy is an arcade approximation, not original physics.
 */
export class DamageSystem {
  wam?: WamData;
  private meshes: DamageMesh[] = [];
  private textures = new Map<string, Texture>();
  private ready = false;
  private bounds = new Box3();
  constructor(
    private assets: DamageAssets,
    private group: Group,
    private configText: string,
  ) {}

  async init(): Promise<void> {
    if (this.ready) return;
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
          const dir = path.slice(0, path.lastIndexOf("/") + 1).toLowerCase();
          for (const entry of this.assets.manifest ?? []) {
            if (
              entry.path.toLowerCase().startsWith(dir) &&
              /\.(pix|p16)$/i.test(entry.path)
            ) {
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
    }
    for (const [name, texture] of this.assets.textures ?? [])
      if (!this.textures.has(key(name))) this.textures.set(key(name), texture);
    this.group.updateMatrixWorld(true);
    const inverse = this.group.matrixWorld.clone().invert();
    this.group.traverse((object) => {
      if (
        !(object instanceof Mesh) ||
        !object.geometry.getAttribute("position")
      )
        return;
      const mesh = object as Mesh<BufferGeometry>;
      // Actors can reuse DAT geometry within a scene. Give every damaged mesh ownership.
      mesh.geometry = mesh.geometry.clone();
      const position = mesh.geometry.getAttribute("position");
      const original = Float32Array.from(position.array);
      const transform = new Matrix4().multiplyMatrices(
        inverse,
        mesh.matrixWorld,
      );
      const originalCar = Array.from({ length: position.count }, (_, i) =>
        new Vector3().fromBufferAttribute(position, i).applyMatrix4(transform),
      );
      originalCar.forEach((point) => this.bounds.expandByPoint(point));
      let part: WamPart | undefined;
      for (
        let actor: Object3D | null = mesh;
        actor && actor !== this.group && !part;
        actor = actor.parent
      ) {
        part = this.wam?.parts.find(
          (entry) => key(entry.actor) === key(actor!.name),
        );
      }
      const materialArray = (
        Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      ).map((material) => material.clone());
      mesh.material = Array.isArray(mesh.material)
        ? materialArray
        : materialArray[0];
      const materials = materialArray.map((material) => {
        const mapped = material as Material & { map?: Texture | null };
        if (mapped.map) this.textures.set(key(mapped.map.name), mapped.map);
        return { material: mapped, map: mapped.map };
      });
      this.meshes.push({
        mesh,
        original,
        originalCar,
        lower: [],
        upper: [],
        part,
        materials,
        materialEnergy: 0,
      });
    });
    for (const data of this.meshes) {
      for (const original of data.originalCar) {
        const lower = this.bounds.min.clone().addScalar(-0.025);
        const upper = this.bounds.max.clone().addScalar(0.025);
        this.wam?.limits.forEach((limits, axis) => {
          const value = original.getComponent(axis);
          const mins = limits.min.filter((plane) => plane <= value);
          const maxs = limits.max.filter((plane) => plane >= value);
          if (mins.length) lower.setComponent(axis, Math.max(...mins));
          if (maxs.length) upper.setComponent(axis, Math.min(...maxs));
        });
        data.lower.push(lower);
        data.upper.push(upper);
      }
    }
    this.ready = true;
  }

  impact(
    localImpactPoint: Vector3,
    direction: Vector3,
    strength: number,
  ): void {
    if (
      !this.ready ||
      !Number.isFinite(strength) ||
      strength <= 0.65 ||
      direction.lengthSq() < 1e-10 ||
      !localImpactPoint.toArray().every(Number.isFinite) ||
      !direction.toArray().every(Number.isFinite)
    )
      return;
    const push = direction.clone().normalize();
    const radius = clamp(0.25 + strength * 0.025, 0.25, 0.55);
    const amount = Math.min(0.12, (strength - 0.65) * 0.025);
    this.group.updateMatrixWorld(true);
    const rootInverse = this.group.matrixWorld.clone().invert();
    for (const data of this.meshes) {
      const softness = data.part?.softnessFactor ?? 1;
      const position = data.mesh.geometry.getAttribute(
        "position",
      ) as BufferAttribute;
      const transform = new Matrix4().multiplyMatrices(
        rootInverse,
        data.mesh.matrixWorld,
      );
      const toMesh = transform.clone().invert();
      let modified = false;
      let influence = 0;
      for (let i = 0; i < position.count; i++) {
        const original = data.originalCar[i];
        const weight = Math.max(
          0,
          1 - original.distanceTo(localImpactPoint) / radius,
        );
        influence = Math.max(influence, weight);
        if (weight <= 0 || softness === 0 || data.part?.hinges.includes(i))
          continue;
        const point = new Vector3()
          .fromBufferAttribute(position, i)
          .applyMatrix4(transform);
        point.addScaledVector(push, amount * softness * weight * weight);
        // Keep each original vertex in its WAM region and bound repeated impacts.
        point.clamp(data.lower[i], data.upper[i]);
        const delta = point.clone().sub(original);
        if (delta.length() > 0.24)
          point.copy(original).add(delta.setLength(0.24));
        point.applyMatrix4(toMesh);
        position.setXYZ(i, point.x, point.y, point.z);
        modified = true;
      }
      if (modified) {
        position.needsUpdate = true;
        data.mesh.geometry.computeVertexNormals();
        data.mesh.geometry.computeBoundingBox();
        data.mesh.geometry.computeBoundingSphere();
      }
      data.materialEnergy += strength * strength * 0.00005 * influence;
      for (const smash of data.part?.smashes ?? []) {
        const level = smash.levels
          .filter((level) => data.materialEnergy >= (level.threshold || 0.001))
          .at(-1);
        const replacement = level?.pixelmaps
          .map((name) => this.textures.get(key(name)))
          .find(Boolean);
        if (!replacement) continue;
        for (const saved of data.materials) {
          if (key(saved.material.name) !== key(smash.material)) continue;
          const current = saved.material.map;
          if (current?.userData.damageSource === replacement.uuid) continue;
          const texture = replacement.clone();
          if (saved.map) {
            texture.matrixAutoUpdate = saved.map.matrixAutoUpdate;
            texture.matrix.copy(saved.map.matrix);
          }
          texture.userData.damageSource = replacement.uuid;
          if (current && current !== saved.map) current.dispose();
          saved.material.map = texture;
          saved.material.needsUpdate = true;
        }
      }
    }
  }

  repair(): void {
    for (const data of this.meshes) {
      const position = data.mesh.geometry.getAttribute(
        "position",
      ) as BufferAttribute;
      position.array.set(data.original);
      position.needsUpdate = true;
      data.mesh.geometry.computeVertexNormals();
      data.mesh.geometry.computeBoundingBox();
      data.mesh.geometry.computeBoundingSphere();
      data.materialEnergy = 0;
      for (const saved of data.materials) {
        if (saved.material.map && saved.material.map !== saved.map)
          saved.material.map.dispose();
        saved.material.map = saved.map;
        saved.material.needsUpdate = true;
      }
    }
  }
}
