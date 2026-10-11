import * as THREE from "three";
import { ExplosionRuntime, parseWastedExplosionSettings } from "./explosion";
import { parsePix, parseDat } from "./formats";
import { createModelGeometry } from "./render-geometry";
import type { SmashExplosion } from "./world-smash";
import type { Assets } from "./content";
import { pedRandomFloat, pedRandomInteger } from "./ped-rules";
import { validOilSurface } from "./physics/oil";
import type { OilSurface } from "./physics/oil";

export interface PedGibSize {
  minForce: number;
  instanceForce: number;
  maxCount: number;
  models: Array<{ name: string; scale: number; color: number }>;
}
export interface PedBloodSettings {
  radius: number;
  velocityFactor: number;
  randomVelocity: number;
  randomUp: number;
  spin: number;
  lifetimeMs: [number, number];
  /** Original signed gPed_spurting_period; cache+84 stores its DWORD bits. */
  spurtingPeriodMs: number;
  sizes: PedGibSize[];
  clouds: SmashExplosion[][];
  slick: {
    delayMs: number;
    growth: [number, number];
    initialSize: number;
    fullSize: [number, number];
    friction: [number, number];
    smearDistance: [number, number] | null;
    smearMaterial: string | null;
    pixelmap: string;
  };
}
const clean = (s: string) =>
  s
    .split(/\r?\n/)
    .map((l) => l.split("//")[0].trim())
    .filter(Boolean);
/** Uses the original SETTINGS structure, including size#4's native 3/4 scale. */
export function parsePedBloodSettings(text: string): PedBloodSettings {
  const start = /\/\/\s*IMPACT GIBLETS\s*:/i.exec(text);
  if (!start) throw new Error("Missing pedestrian giblets");
  const spurtMarker = /\/\/\s*SPURTING STUMP GIBLETS\s*:/i.exec(text);
  if (!spurtMarker)
    throw new Error("Missing pedestrian stump spurting settings");
  const spurtPeriod = clean(
    text.slice(spurtMarker.index + spurtMarker[0].length),
  )[1];
  if (spurtPeriod === undefined || !/^[+-]?\d+$/.test(spurtPeriod))
    throw new Error("Invalid pedestrian stump spurting period");
  const spurtingPeriodMs = Number(spurtPeriod);
  if (
    !Number.isInteger(spurtingPeriodMs) ||
    spurtingPeriodMs < -0x80000000 ||
    spurtingPeriodMs > 0x7fffffff
  )
    throw new Error("Invalid pedestrian stump spurting period");
  const lines = clean(text.slice(start.index + start[0].length));
  let at = 0;
  const row = () => {
    const l = lines[at++];
    if (l === undefined) throw new Error("Truncated pedestrian blood settings");
    return l;
  };
  const nums = (count: number) => {
    const values = row()
      .split(/[\s,]+/)
      .map(Number);
    if (values.length !== count || values.some((v) => !Number.isFinite(v)))
      throw new Error("Invalid pedestrian blood values");
    return values;
  };
  const n = () => nums(1)[0];
  n();
  if (row().toLowerCase() !== "sphereclumped")
    throw new Error("Unsupported pedestrian giblet position");
  const radius = n();
  if (row().toLowerCase() !== "impact")
    throw new Error("Unsupported pedestrian giblet centre");
  nums(2);
  const velocityFactor = n(),
    randomVelocity = n(),
    randomUp = n();
  n();
  const spin = n();
  const lifetimeMs = nums(2).map((v) => Math.trunc(v * 1000)) as [
    number,
    number,
  ];
  const count = n();
  if (!Number.isInteger(count) || count < 0 || count > 64)
    throw new Error("Invalid pedestrian giblet count");
  const sizes = Array.from({ length: count }, (_, index) => {
    n();
    const minForce = n(),
      instanceForce = n(),
      maxCount = n(),
      modelCount = n();
    if (
      minForce < 0 ||
      instanceForce <= 0 ||
      !Number.isInteger(maxCount) ||
      maxCount < 0 ||
      !Number.isInteger(modelCount) ||
      modelCount < 1 ||
      modelCount > 3
    )
      throw new Error("Invalid pedestrian giblet size");
    const models = Array.from({ length: modelCount }, () => {
      const scale = n() * (index === count - 1 ? 0.75 : 1);
      n();
      const rgb = nums(3);
      const name = row();
      return { scale, color: (rgb[0] << 16) | (rgb[1] << 8) | rgb[2], name };
    });
    return { minForce, instanceForce, maxCount, models };
  });
  const clouds = ["SMALL", "MED", "LARGE"].map((label) => {
    const marker = new RegExp(`//\\s*${label} BLOOD CLOUD SPEC`, "i").exec(
      text,
    );
    if (!marker) throw new Error(`Missing ${label} pedestrian blood cloud`);
    return parseWastedExplosionSettings(
      "// Wasted explosion settings\n100\n0\nGIBLETS\n" +
        text.slice(marker.index + marker[0].length),
    ).groups;
  });
  const slickMarker = /\/\/\s*GIB SLICK!/i.exec(text);
  if (!slickMarker) throw new Error("Missing pedestrian blood slick");
  if (spurtMarker.index <= slickMarker.index)
    throw new Error("Invalid pedestrian blood section order");
  const slickRows = clean(
    text.slice(slickMarker.index + slickMarker[0].length, spurtMarker.index),
  );
  const slickRow = (index: number, count: number, label: string) => {
    const line = slickRows[index];
    if (line === undefined)
      throw new Error(`Truncated pedestrian slick ${label}`);
    const tokens = line.split(",").map((token) => token.trim());
    if (
      tokens.length !== count ||
      tokens.some(
        (token) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token),
      )
    )
      throw new Error(`Invalid pedestrian slick ${label}`);
    const values = tokens.map(Number);
    if (values.some((value) => !Number.isFinite(Math.fround(value))))
      throw new Error(`Invalid pedestrian slick ${label}`);
    return values;
  };
  if (slickRows.length < 4)
    throw new Error("Truncated pedestrian slick settings");
  const pixelmap = slickRows[0];
  if (!/^[\w.-]+$/i.test(pixelmap))
    throw new Error("Invalid pedestrian slick pixelmap");
  const [delayMs, ...growth] = slickRow(1, 3, "delay/growth"),
    [initialSize, ...fullSize] = slickRow(2, 3, "initial/full size"),
    friction = slickRow(3, 2, "friction") as [number, number],
    smearDistance =
      friction[1] !== 0
        ? (slickRow(4, 2, "smear distance") as [number, number])
        : null,
    smearMaterial = friction[1] !== 0 ? slickRows[5] : null;
  if (friction[1] !== 0 && smearMaterial === undefined)
    throw new Error("Truncated pedestrian slick smear material");
  const orderedPair = (pair: number[]) => pair[0] <= pair[1];
  if (
    [
      radius,
      velocityFactor,
      randomVelocity,
      randomUp,
      spin,
      ...lifetimeMs,
      delayMs,
      ...growth,
      initialSize,
      ...fullSize,
      ...friction,
      ...(smearDistance ?? []),
    ].some((v) => !Number.isFinite(v) || v < 0) ||
    lifetimeMs[1] < lifetimeMs[0] ||
    !orderedPair(growth) ||
    !orderedPair(fullSize) ||
    !orderedPair(friction) ||
    (smearDistance !== null && !orderedPair(smearDistance)) ||
    (smearMaterial !== null && !/^[\w.-]+\.mat$/i.test(smearMaterial))
  )
    throw new Error("Invalid pedestrian blood settings");
  return {
    radius,
    velocityFactor,
    randomVelocity,
    randomUp,
    spin,
    lifetimeMs,
    spurtingPeriodMs,
    sizes,
    clouds,
    slick: {
      delayMs,
      growth: growth as [number, number],
      initialSize,
      fullSize: fullSize as [number, number],
      friction,
      smearDistance,
      smearMaterial,
      pixelmap,
    },
  };
}
/** Installed DoGiblets 0x4ccda0 uses STRICT cloud thresholds .05/.25/.5. */
export function pedBloodCloudIndex(force: number): number {
  force = Math.fround(force);
  return force > 0.5 ? 2 : force > 0.25 ? 1 : force > 0.05 ? 0 : -1;
}
/** Installed 0x4cc919: trunc((force-min)/instance - (-1)), then cap. */
export function pedGibletCount(force: number, size: PedGibSize): number {
  force = Math.fround(force);
  const minimum = Math.fround(size.minForce),
    perInstance = Math.fround(size.instanceForce);
  return force < minimum
    ? 0
    : Math.min(size.maxCount, Math.trunc((force - minimum) / perInstance + 1));
}
interface Giblet {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  expires: number;
}
interface Slick {
  mesh: THREE.Mesh;
  start: number;
  full: number;
  growth: number;
  initial: number;
}
type BloodAssets = Pick<Assets, "manifest" | "bytes">;
type BloodSurface = OilSurface & { position: THREE.Vector3 };
type BloodSurfaceAt = (
  position: THREE.Vector3,
  halfSize?: number,
) => BloodSurface | null;
/** Native cloud sprites and authored chunk geometry. Ground decals persist until
 * their native32 slick/100 skid pools replace them; no arbitrary fade timer. */
export class PedBloodRuntime {
  readonly group = new THREE.Group();
  private readonly giblets: Giblet[] = [];
  private readonly slicks: Slick[] = [];
  private readonly smears: THREE.Mesh[] = [];
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private cloud: ExplosionRuntime;
  private readonly plane = new THREE.PlaneGeometry(2, 2);
  private readonly ownedMaterials = new Set<THREE.Material>();
  constructor(
    readonly settings: PedBloodSettings,
    private groundAt: (x: number, z: number, y: number) => number | null,
    private random: () => number,
    textures: ReadonlyMap<string, THREE.Texture> = new Map(),
    models: ReadonlyMap<string, THREE.BufferGeometry> = new Map(),
    private surfaceAt?: BloodSurfaceAt,
  ) {
    this.group.name = "original-pedestrian-blood";
    for (const [k, v] of textures) this.textures.set(k.toLowerCase(), v);
    for (const [k, v] of models)
      this.geometries.set(k.toLowerCase().replace(/\.dat$/i, ""), v);
    this.cloud = new ExplosionRuntime(this.group, this.textures, { random });
  }
  static async create(
    assets: BloodAssets,
    settings: PedBloodSettings,
    groundAt: (x: number, z: number, y: number) => number | null,
    random: () => number,
    surfaceAt?: BloodSurfaceAt,
  ) {
    const textures = new Map<string, THREE.Texture>(),
      models = new Map<string, THREE.BufferGeometry>();
    const wanted = new Set([
      ...settings.clouds.flatMap((c) =>
        c.flatMap((g) => g.frames.map((f) => f.pixelmap.toLowerCase())),
      ),
      settings.slick.pixelmap.toLowerCase(),
      "pedsmear",
    ]);
    for (const name of wanted) {
      const file = assets.manifest.find((e) =>
        new RegExp(`^data/peds/giblets/pix16/${name}\\.pix$`, "i").test(e.path),
      );
      if (!file) continue;
      for (const map of parsePix(await assets.bytes(file.path))) {
        const texture = new THREE.DataTexture(
          map.rgba,
          map.width,
          map.height,
          THREE.RGBAFormat,
        );
        texture.name = map.name || name;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
        textures.set(name, texture);
      }
    }
    for (const model of settings.sizes.flatMap((s) => s.models)) {
      const name = model.name.replace(/\.dat$/i, "").toLowerCase();
      const file = assets.manifest.find(
        (e) => e.path.toLowerCase() === `data/peds/giblets/${name}.dat`,
      );
      if (!file || models.has(name)) continue;
      const dat = parseDat(await assets.bytes(file.path))[0];
      if (dat) models.set(name, createModelGeometry(dat));
    }
    return new PedBloodRuntime(
      settings,
      groundAt,
      random,
      textures,
      models,
      surfaceAt,
    );
  }
  get stats() {
    return {
      clouds: this.cloud.activeCount,
      giblets: this.giblets.length,
      slicks: this.slicks.length,
      smears: this.smears.length,
    };
  }
  private between(a: number, b: number) {
    return pedRandomFloat(this.random, a, b);
  }
  private int(a: number, b: number) {
    return pedRandomInteger(this.random, a, b);
  }
  hit(
    position: THREE.Vector3,
    bounds: THREE.Box3,
    velocity: THREE.Vector3,
    force: number,
    timeMs: number,
  ) {
    const index = pedBloodCloudIndex(force);
    if (index >= 0)
      this.cloud.spawn(this.settings.clouds[index], position, bounds, timeMs);
    for (const size of this.settings.sizes)
      for (let i = 0; i < pedGibletCount(force, size); i++) {
        if (this.giblets.length >= 200) return;
        const model = size.models[this.int(0, size.models.length - 1)],
          geometry = this.geometries.get(
            model.name.replace(/\.dat$/i, "").toLowerCase(),
          );
        if (!geometry) continue;
        const material = new THREE.MeshBasicMaterial({ color: model.color });
        this.ownedMaterials.add(material);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = "original-ped-giblet";
        mesh.scale.setScalar(model.scale);
        const direction = new THREE.Vector3(
            this.between(-1, 1),
            this.between(-1, 1),
            this.between(-1, 1),
          ).normalize(),
          radius = this.between(0, this.settings.radius),
          factor = radius / this.settings.radius;
        mesh.position.copy(position).addScaledVector(direction, radius);
        const v = velocity
          .clone()
          .multiplyScalar(this.settings.velocityFactor * 6.9);
        for (let axis = 0; axis < 3; axis++)
          v.setComponent(
            axis,
            (v.getComponent(axis) +
              this.between(
                -this.settings.randomVelocity,
                this.settings.randomVelocity,
              )) *
              factor,
          );
        v.y += this.between(0, this.settings.randomUp);
        v.divideScalar(6.9);
        const spin = new THREE.Vector3(
          this.random(),
          this.random(),
          this.random(),
        ).normalize();
        for (let axis = 0; axis < 3; axis++)
          spin.setComponent(
            axis,
            spin.getComponent(axis) *
              this.between(
                -factor * this.settings.spin,
                factor * this.settings.spin,
              ),
          );
        this.giblets.push({
          mesh,
          velocity: v,
          spin,
          expires: timeMs + this.int(...this.settings.lifetimeMs),
        });
        this.group.add(mesh);
      }
  }
  /** CBActiveHalted 0x4d18fa: chance75%, once per corpse, after settling. */
  settled(position: THREE.Vector3, timeMs: number) {
    if (this.int(0, 99) >= 75) return;
    const full = this.between(...this.settings.slick.fullSize),
      growth = this.between(...this.settings.slick.growth);
    const surface =
      this.surfaceAt?.(position, full) ??
      (this.surfaceAt
        ? null
        : { position, normal: new THREE.Vector3(0, 1, 0) });
    // QueueSpill uses OKToSpillOil: the primary floor normal must be at least.97
    // upright. Ground projection is shared with the collision index.
    if (!surface || !validOilSurface(surface)) return;
    const material = new THREE.MeshBasicMaterial({
      map: this.textures.get(this.settings.slick.pixelmap.toLowerCase()),
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.ownedMaterials.add(material);
    const mesh = new THREE.Mesh(this.plane, material);
    mesh.name = "original-ped-blood-slick";
    mesh.position.copy(surface.position).addScaledVector(surface.normal, 0.001);
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      surface.normal.clone().normalize(),
    );
    mesh.rotateZ(this.between(0, Math.PI * 2));
    mesh.scale.setScalar(this.settings.slick.initialSize);
    mesh.visible = false;
    this.group.add(mesh);
    const slick = {
      mesh,
      start: timeMs + this.settings.slick.delayMs,
      full,
      growth,
      initial: this.settings.slick.initialSize,
    };
    if (this.slicks.length === 32) this.releaseMesh(this.slicks.shift()!.mesh);
    this.slicks.push(slick);
  }
  smear(from: THREE.Vector3, to: THREE.Vector3, width: number) {
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    if (length === 0) return;
    const center = from.clone().add(to).multiplyScalar(0.5),
      surface =
        this.surfaceAt?.(center) ??
        (this.surfaceAt
          ? null
          : { position: center, normal: new THREE.Vector3(0, 1, 0) });
    if (
      !surface ||
      !Number.isFinite(surface.normal.lengthSq()) ||
      surface.normal.lengthSq() === 0
    )
      return;
    const material = new THREE.MeshBasicMaterial({
      map: this.textures.get("pedsmear"),
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.ownedMaterials.add(material);
    const mesh = new THREE.Mesh(this.plane, material);
    mesh.name = "original-ped-blood-smear";
    const normal = surface.normal.clone().normalize(),
      along = to.clone().sub(from).projectOnPlane(normal).normalize(),
      across = along.clone().cross(normal).normalize();
    mesh.position.copy(surface.position).addScaledVector(normal, 0.001);
    mesh.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(across, along, normal),
    );
    mesh.scale.set(width / 2, length / 2, 1);
    this.group.add(mesh);
    if (this.smears.length === 100) this.releaseMesh(this.smears.shift()!);
    this.smears.push(mesh);
  }
  update(dt: number, timeMs: number) {
    this.cloud.update(timeMs);
    for (let i = this.giblets.length - 1; i >= 0; i--) {
      const gib = this.giblets[i];
      if (timeMs >= gib.expires) {
        this.releaseMesh(gib.mesh);
        this.giblets.splice(i, 1);
        continue;
      }
      gib.velocity.y -= (10 / 6.9) * dt;
      gib.mesh.position.addScaledVector(gib.velocity, dt);
      gib.mesh.rotation.x += gib.spin.x * dt;
      gib.mesh.rotation.y += gib.spin.y * dt;
      gib.mesh.rotation.z += gib.spin.z * dt;
      const ground = this.groundAt(
        gib.mesh.position.x,
        gib.mesh.position.z,
        gib.mesh.position.y + 0.2,
      );
      if (ground !== null && gib.mesh.position.y <= ground) {
        gib.mesh.position.y = ground + 0.001;
        gib.velocity.set(0, 0, 0);
        gib.spin.set(0, 0, 0);
      }
    }
    for (const slick of this.slicks) {
      slick.mesh.visible = timeMs >= slick.start;
      const size = Math.min(
        slick.full,
        slick.initial + Math.max(0, timeMs - slick.start) * slick.growth,
      );
      slick.mesh.scale.set(size, size, 1);
    }
  }
  private releaseMesh(mesh: THREE.Mesh) {
    mesh.removeFromParent();
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      material.dispose();
      this.ownedMaterials.delete(material);
    }
  }
  reset() {
    this.cloud.dispose();
    this.cloud = new ExplosionRuntime(this.group, this.textures, {
      random: this.random,
    });
    for (const gib of this.giblets) this.releaseMesh(gib.mesh);
    for (const slick of this.slicks) this.releaseMesh(slick.mesh);
    for (const smear of this.smears) this.releaseMesh(smear);
    this.giblets.length = this.slicks.length = this.smears.length = 0;
  }
  dispose() {
    this.reset();
    this.cloud.dispose();
    this.plane.dispose();
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.group.removeFromParent();
  }
}
