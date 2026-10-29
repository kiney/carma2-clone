import * as THREE from "three";
import { ExplosionRuntime, parseWastedExplosionSettings } from "./explosion";
import { parsePix, parseDat } from "./formats";
import { createModelGeometry } from "./render-geometry";
import type { SmashExplosion } from "./world-smash";
import type { Assets } from "./content";
import { pedRandomFloat, pedRandomInteger } from "./ped-rules";
import { validOilSurface } from "./physics/oil";
import type { OilSurface } from "./physics/oil";
import type { SmashInitialPosition, SmashInitialSpeed } from "./world-smash";
import type { PedVector, PedBounds } from "./ped-form";
import { sharedNativeRandom } from "./native-random";
import {
  emitNativePedGiblets,
  nativePedGibletSpecRequirements,
  type NativePedGibletCrt,
  type NativePedGibletModel,
  type NativePedGibletSpec,
} from "./ped-giblet-source";
import type { ShardRuntime } from "./smash-shards";

export interface PedGibSize {
  minForce: number;
  instanceForce: number;
  maxCount: number;
  flags?: number;
  models: NativePedGibletModel[];
}
export interface PedSpurtSettings extends NativePedGibletSpec {
  lumpsPerEmission: number;
  model: NativePedGibletModel;
}
export interface PedBloodSettings {
  impact?: NativePedGibletSpec & { scrapeStart: number };
  spurt?: PedSpurtSettings;
  radius: number;
  velocityFactor: number;
  randomVelocity: number;
  randomUp: number;
  spin: number;
  lifetimeMs: [number, number];
  /** Original signed gPed_spurting_period; cache+84 stores its DWORD bits. */
  spurtingPeriodMs: number;
  dismemberSpurtCount?: number;
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
  const spurtSettings = clean(
    text.slice(spurtMarker.index + spurtMarker[0].length),
  );
  const spurtPeriod = spurtSettings[1];
  const dismemberSpurtCount = Number(spurtSettings[2]);
  if (
    !/^[+-]?\d+$/.test(spurtSettings[2] ?? "") ||
    !Number.isInteger(dismemberSpurtCount) ||
    dismemberSpurtCount < -0x80000000 ||
    dismemberSpurtCount > 0x7fffffff
  )
    throw new Error("Invalid dismembered pedestrian spurt count");
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
  const readPosition = (
    take: () => string,
    values: (count: number) => number[],
  ): SmashInitialPosition => {
    const kind = take().toLowerCase();
    if (kind === "actorbased") return { kind };
    if (kind === "boxclumped")
      return { kind, size: values(3) as [number, number, number] };
    if (kind !== "sphereclumped")
      throw new Error("Unsupported pedestrian giblet position");
    const radius = values(1)[0],
      centre = take().toLowerCase();
    if (
      !Number.isFinite(Math.fround(radius)) ||
      radius < 0 ||
      !["impact", "model"].includes(centre)
    )
      throw new Error("Invalid pedestrian giblet placement");
    return { kind, radius, center: centre as "impact" | "model" };
  };
  const readSpeed = (
    values: (count: number) => number[],
  ): SmashInitialSpeed => ({
    towards: values(2) as [number, number],
    impacteeVelocityFactor: values(1)[0],
    randomVelocityMax: values(1)[0],
    randomUpVelocityMax: values(1)[0],
    randomNormalVelocityMax: values(1)[0],
    randomSpinRateMax: values(1)[0],
  });
  const readModel = (
    take: () => string,
    values: (count: number) => number[],
    factor: number,
  ): NativePedGibletModel => {
    const authoredScale = values(1)[0],
      scale = authoredScale * factor,
      nativeScale = Math.fround(Math.fround(authoredScale) * factor),
      indexedColor = values(1)[0],
      rgb = values(3),
      name = take();
    if (
      !Number.isFinite(Math.fround(scale)) ||
      scale < 0 ||
      !Number.isInteger(indexedColor) ||
      indexedColor < 0 ||
      indexedColor > 255 ||
      rgb.some(
        (value) => !Number.isInteger(value) || value < 0 || value > 255,
      ) ||
      !/^[\w.-]+$/i.test(name)
    )
      throw new Error("Invalid pedestrian giblet model");
    return {
      scale,
      nativeScale,
      indexedColor,
      color: (rgb[0] << 16) | (rgb[1] << 8) | rgb[2],
      name,
    };
  };
  const scrapeStart = n();
  if (
    !Number.isInteger(scrapeStart) ||
    scrapeStart < 0 ||
    scrapeStart > 0x7fffffff
  )
    throw new Error("Invalid pedestrian giblet scrape start");
  const position = readPosition(row, nums),
    speed = readSpeed(nums);
  const radius = position.kind === "sphereclumped" ? position.radius : 0,
    velocityFactor = speed.impacteeVelocityFactor,
    randomVelocity = speed.randomVelocityMax,
    randomUp = speed.randomUpVelocityMax,
    spin = speed.randomSpinRateMax;
  const lifetimeMs = nums(2).map((v) => Math.trunc(v * 1000)) as [
    number,
    number,
  ];
  const count = n();
  if (!Number.isInteger(count) || count < 0 || count > 64)
    throw new Error("Invalid pedestrian giblet count");
  const sizes = Array.from({ length: count }, (_, index) => {
    const flags = n();
    if (!Number.isInteger(flags) || flags < -0x80000000 || flags > 0x7fffffff)
      throw new Error("Invalid pedestrian giblet size flags");
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
    const models = Array.from({ length: modelCount }, () =>
      readModel(row, nums, index === count - 1 ? 0.75 : 1),
    );
    return { flags, minForce, instanceForce, maxCount, models };
  });
  let spurtAt = 3;
  const spurtRow = () => {
    const value = spurtSettings[spurtAt++];
    if (value === undefined)
      throw new Error("Truncated pedestrian spurt settings");
    return value;
  };
  const spurtNums = (count: number) => {
    const values = spurtRow()
      .split(/[\s,]+/)
      .map(Number);
    if (
      values.length !== count ||
      values.some((value) => !Number.isFinite(Math.fround(value)))
    )
      throw new Error("Invalid pedestrian spurt values");
    return values;
  };
  const lumpsPerEmission = Number(spurtSettings[0]);
  if (
    !Number.isInteger(lumpsPerEmission) ||
    lumpsPerEmission < 0 ||
    lumpsPerEmission > 32767
  )
    throw new Error("Invalid pedestrian spurt lump count");
  const spurtPosition = readPosition(spurtRow, spurtNums),
    spurtSpeed = readSpeed(spurtNums),
    spurtLifetimeMs = spurtNums(2).map((value) => Math.trunc(value * 1000)) as [
      number,
      number,
    ],
    spurtModel = readModel(spurtRow, spurtNums, 1);
  if (
    spurtLifetimeMs.some((value) => value < 0 || value > 0x7fffffff) ||
    spurtLifetimeMs[0] > spurtLifetimeMs[1]
  )
    throw new Error("Invalid pedestrian spurt lifetime");
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
    impact: { scrapeStart, position, speed, lifetimeMs },
    spurt: {
      lumpsPerEmission,
      position: spurtPosition,
      speed: spurtSpeed,
      lifetimeMs: spurtLifetimeMs,
      model: spurtModel,
    },
    radius,
    velocityFactor,
    randomVelocity,
    randomUp,
    spin,
    lifetimeMs,
    spurtingPeriodMs,
    dismemberSpurtCount,
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
export interface NativePedBloodEmissionResult {
  status: "complete" | "provider-required";
  requiredProviders: string[];
  created: number;
  clouds: number;
  poolFull: number;
}
export interface NativePedImpactGibletPacket {
  kind: "impact";
  point: PedVector;
  pedestrianPosition: PedVector;
  /** Already metric; the producer owns the native worldV*6.9 conversion. */
  velocity: PedVector;
  force: number;
  startSize: number;
  timeMs: number;
  seed: number;
  goreLevel: number;
  bodyPose: ArrayLike<number>;
  localBounds: PedBounds;
  localCentreOfMass: PedVector;
  /** Capture the actual ROOT ACT identity, not a newly rebound character. */
  readBodyPose?: () => ArrayLike<number>;
}
export interface NativePedSpurtGibletPacket {
  kind: "spurt";
  point: PedVector;
  direction: PedVector;
  velocity: PedVector;
  timeMs: number;
  seed: number;
  goreLevel: number;
}
interface NativeBloodModelResource {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshBasicMaterial;
}
function bloodPose(pose: ArrayLike<number>): THREE.Matrix4 {
  if (
    !pose ||
    pose.length !== 12 ||
    Array.from(pose).some((value) => !Number.isFinite(Math.fround(value)))
  )
    throw new Error("source-native-ped-blood-root-ACT-pose");
  return new THREE.Matrix4().set(
    pose[0],
    pose[3],
    pose[6],
    pose[9],
    pose[1],
    pose[4],
    pose[7],
    pose[10],
    pose[2],
    pose[5],
    pose[8],
    pose[11],
    0,
    0,
    0,
    1,
  );
}
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
  private cloudRandom: () => number;
  private readonly nativeModels = new Map<
    NativePedGibletModel,
    NativeBloodModelResource
  >();
  private readonly nativeResources = new Set<NativeBloodModelResource>();
  private nativeModelsPrepared = false;
  private readonly nativeShards = new Set<ShardRuntime>();
  private readonly nativeCounters = {
    created: 0,
    impacts: 0,
    spurts: 0,
    poolFull: 0,
  };
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
    this.cloudRandom = random;
    for (const [k, v] of textures) this.textures.set(k.toLowerCase(), v);
    for (const [k, v] of models)
      this.geometries.set(k.toLowerCase().replace(/\.dat$/i, ""), v);
    this.cloud = new ExplosionRuntime(this.group, this.textures, {
      random: () => this.cloudRandom(),
    });
  }
  static async create(
    assets: BloodAssets,
    settings: PedBloodSettings,
    groundAt: (x: number, z: number, y: number) => number | null,
    random: () => number,
    surfaceAt?: BloodSurfaceAt,
    dataRoot: "data" | "adv_data" = "data",
  ) {
    const textures = new Map<string, THREE.Texture>(),
      models = new Map<string, THREE.BufferGeometry>();
    const roots = dataRoot === "adv_data" ? ["adv_data", "data"] : ["data"];
    const find = (tail: string) =>
      roots
        .map((root) =>
          assets.manifest.find(
            (entry) =>
              entry.path.toLowerCase() ===
              `${root}/peds/giblets/${tail.toLowerCase()}`,
          ),
        )
        .find(Boolean);
    const wanted = new Set([
      ...settings.clouds.flatMap((c) =>
        c.flatMap((g) => g.frames.map((f) => f.pixelmap.toLowerCase())),
      ),
      settings.slick.pixelmap.toLowerCase(),
      "pedsmear",
    ]);
    for (const name of wanted) {
      const file = find(`pix16/${name.replace(/\.pix$/i, "")}.pix`);
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
    for (const model of [
      ...settings.sizes.flatMap((s) => s.models),
      ...(settings.spurt ? [settings.spurt.model] : []),
    ]) {
      const name = model.name.replace(/\.dat$/i, "").toLowerCase();
      const file = find(`${name}.dat`);
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
      giblets:
        this.giblets.length +
        [...this.nativeShards].reduce(
          (count, shards) => count + shards.countOwner(this),
          0,
        ),
      slicks: this.slicks.length,
      smears: this.smears.length,
    };
  }
  get nativeStats() {
    return {
      ...this.nativeCounters,
      active: [...this.nativeShards].reduce(
        (count, shards) => count + shards.countOwner(this),
        0,
      ),
    };
  }
  private prepareNativeModels(): void {
    if (this.nativeModelsPrepared) return;
    const sources = new Map<THREE.BufferGeometry, NativeBloodModelResource>();
    // ReadSmashableInitialModel mutates the found MODEL in place. A later spurt
    // reference to chunk05 scales the same current vertices a second time.
    try {
      for (const model of [
        ...this.settings.sizes.flatMap((size) => size.models),
        ...(this.settings.spurt ? [this.settings.spurt.model] : []),
      ]) {
        const source = this.geometries.get(
          model.name.toLowerCase().replace(/\.dat$/i, ""),
        );
        if (!source) continue;
        let resource = sources.get(source);
        if (!resource) {
          resource = {
            geometry: source.clone(),
            material: new THREE.MeshBasicMaterial({ color: model.color }),
          };
          sources.set(source, resource);
          this.nativeResources.add(resource);
        }
        const positions = resource.geometry.getAttribute("position"),
          factor = model.nativeScale ?? Math.fround(model.scale);
        if (!positions || !Number.isFinite(factor) || factor < 0)
          throw new Error("source-native-ped-giblet-MODEL-positions");
        for (let i = 0; i < positions.count; i++) {
          const x = Math.fround(positions.getX(i) * factor),
            y = Math.fround(positions.getY(i) * factor),
            z = Math.fround(positions.getZ(i) * factor);
          if (![x, y, z].every(Number.isFinite))
            throw new Error("source-native-ped-giblet-MODEL-positions");
          positions.setXYZ(i, x, y, z);
        }
        positions.needsUpdate = true;
        resource.geometry.computeBoundingBox();
        resource.geometry.computeBoundingSphere();
        resource.material.color.setHex(model.color);
        resource.material.userData.nativeIndexedColor = model.indexedColor;
        this.nativeModels.set(model, resource);
      }
    } catch (error) {
      for (const resource of this.nativeResources) {
        resource.geometry.dispose();
        resource.material.dispose();
      }
      this.nativeResources.clear();
      this.nativeModels.clear();
      throw error;
    }
    this.nativeModelsPrepared = true;
  }
  private nativeEmission(
    packet: NativePedImpactGibletPacket | NativePedSpurtGibletPacket,
    shards: ShardRuntime,
    crt: NativePedGibletCrt,
    preflightOnly = false,
  ): NativePedBloodEmissionResult {
    const result: NativePedBloodEmissionResult = {
      status: "complete",
      requiredProviders: [],
      created: 0,
      clouds: 0,
      poolFull: 0,
    };
    const require = (...names: string[]) => ({
      ...result,
      status: "provider-required" as const,
      requiredProviders: [...new Set(names)],
    });
    if (!packet || (packet.kind !== "impact" && packet.kind !== "spurt"))
      return require("source-native-ped-blood-packet-kind");
    if (
      !packet ||
      !Number.isInteger(packet.goreLevel) ||
      packet.goreLevel < 0 ||
      packet.goreLevel > 2
    )
      return require("source-native-ped-blood-gore-level");
    // DoSpurt itself has no gore gate; its actual MakeEmBleed caller owns it.
    if (packet.kind === "impact" && packet.goreLevel === 0) return result;
    if (
      !shards ||
      typeof shards.spawnFragment !== "function" ||
      typeof shards.createFragmentGroup !== "function"
    )
      return require("source-shared-200-fragment-runtime-owner");
    if (
      !crt ||
      typeof crt.nextInteger !== "function" ||
      typeof crt.seed !== "function"
    )
      return require("source-native-ped-shared-CRT-owner");
    if (
      !Number.isInteger(packet.timeMs) ||
      packet.timeMs < 0 ||
      packet.timeMs > 0xffffffff ||
      !Number.isInteger(packet.seed) ||
      packet.seed < 0 ||
      packet.seed > 0xffffffff ||
      !packet.point ||
      !packet.velocity ||
      packet.point.length !== 3 ||
      packet.velocity.length !== 3 ||
      [...packet.point, ...packet.velocity].some(
        (value) => !Number.isFinite(Math.fround(value)),
      )
    )
      return require("source-native-ped-blood-point-velocity-seed-clock");
    const spec =
      packet.kind === "impact" ? this.settings.impact : this.settings.spurt;
    if (!spec) return require(`source-native-ped-${packet.kind}-SETTINGS`);
    const missing = nativePedGibletSpecRequirements(spec);
    if (
      packet.kind === "impact" &&
      (!Number.isFinite(Math.fround(packet.force)) ||
        !Number.isInteger(packet.startSize) ||
        packet.startSize < 0)
    )
      missing.push("source-native-ped-giblet-force-start-size");
    if (
      packet.kind === "spurt" &&
      (!packet.direction ||
        packet.direction.length !== 3 ||
        packet.direction.some((value) => !Number.isFinite(Math.fround(value))))
    )
      missing.push("source-native-ped-spurt-direction");
    if (missing.length) return require(...missing);
    try {
      this.prepareNativeModels();
    } catch (error) {
      return require(
        error instanceof Error
          ? error.message
          : "source-native-ped-giblet-models",
      );
    }
    const groups =
      packet.kind === "impact"
        ? this.settings.sizes
        : [
            {
              models: [this.settings.spurt!.model],
              minForce: 0,
              instanceForce: 1,
              maxCount: 0,
            },
          ];
    const eligible =
      packet.kind === "impact"
        ? groups.map(
            (size, i) =>
              i >= packet.startSize && pedGibletCount(packet.force, size) > 0,
          )
        : [this.settings.spurt!.lumpsPerEmission > 0];
    groups.forEach((size, i) => {
      if (eligible[i])
        for (const model of size.models)
          if (!this.nativeModels.has(model))
            missing.push(`source-ped-giblet-MODEL:${model.name}`);
    });
    let cloudIndex = -1,
      readCloudTransform: (() => THREE.Matrix4) | undefined,
      cloudBounds: THREE.Box3 | undefined;
    if (packet.kind === "impact") {
      cloudIndex = pedBloodCloudIndex(packet.force);
      if (cloudIndex >= 0) {
        const clouds = this.settings.clouds[cloudIndex];
        if (!clouds) missing.push("source-native-ped-blood-cloud-SETTINGS");
        else
          for (const group of clouds)
            for (const frame of group.frames)
              if (
                !this.textures.has(
                  frame.pixelmap.toLowerCase().replace(/\.pix$/i, ""),
                )
              )
                missing.push(`source-ped-blood-cloud-PIX:${frame.pixelmap}`);
        try {
          const bounds = packet.localBounds,
            com = packet.localCentreOfMass;
          if (
            !bounds ||
            !com ||
            bounds.min?.length !== 3 ||
            bounds.max?.length !== 3 ||
            com.length !== 3 ||
            [...bounds.min, ...bounds.max, ...com].some(
              (value) => !Number.isFinite(Math.fround(value)),
            ) ||
            bounds.min.some((value, i) => value > bounds.max[i])
          )
            throw new Error("source-native-ped-blood-local-bounds-COM");
          const impact = packet;
          readCloudTransform = () =>
            bloodPose(impact.readBodyPose?.() ?? impact.bodyPose);
          readCloudTransform();
          cloudBounds = new THREE.Box3(
            new THREE.Vector3(...bounds.min),
            new THREE.Vector3(...bounds.max),
          );
        } catch (error) {
          missing.push(
            error instanceof Error
              ? error.message
              : "source-native-ped-blood-cloud-pose",
          );
        }
      }
    }
    if (missing.length) return require(...missing);
    // MakeEmBleed validates these exact owners before timers/stump bytes/RNG.
    // Only private derived model clones may have been prepared above.
    if (preflightOnly) return result;
    if (packet.kind === "impact") this.nativeCounters.impacts++;
    else this.nativeCounters.spurts++;
    if (packet.kind === "impact" && cloudIndex >= 0) {
      const previous = this.cloudRandom;
      this.cloudRandom = () => crt.nextInteger() / 32768;
      try {
        result.clouds = this.cloud.spawn(
          this.settings.clouds[cloudIndex],
          new THREE.Vector3(),
          cloudBounds!,
          packet.timeMs,
          new THREE.Vector3(...packet.localCentreOfMass),
          undefined,
          readCloudTransform,
        );
      } finally {
        this.cloudRandom = previous;
      }
    }
    const groupId = shards.createFragmentGroup();
    this.nativeShards.add(shards);
    const emitted = emitNativePedGiblets(
      {
        kind: packet.kind,
        seed: packet.seed,
        point: packet.point,
        velocity: packet.velocity,
        direction: packet.kind === "spurt" ? packet.direction : [0, 0, 0],
        spec,
        sizes: groups,
        force: packet.kind === "impact" ? packet.force : 0,
        startSize: packet.kind === "impact" ? packet.startSize : 0,
        lumpsPerEmission: this.settings.spurt?.lumpsPerEmission,
      },
      {
        crt,
        model: (size, index) =>
          this.nativeModels.get(groups[size].models[index])!,
        reserve: (priority, produce) =>
          shards.spawnFragment(priority, () => {
            const piece = produce(),
              mesh = new THREE.Mesh(piece.model.geometry, piece.model.material);
            mesh.name = `native-ped-${packet.kind}-giblet`;
            mesh.matrixAutoUpdate = false;
            mesh.matrix.copy(piece.matrix);
            mesh.position.setFromMatrixPosition(mesh.matrix);
            return {
              mesh,
              ...piece,
              timeMs: packet.timeMs,
              groupId,
              owner: this,
              fullMatrix: true,
            };
          }),
      },
    );
    result.created = emitted.created;
    result.poolFull = emitted.poolFull;
    this.nativeCounters.created += emitted.created;
    this.nativeCounters.poolFull += emitted.poolFull;
    return result;
  }
  nativeHit(
    packet: NativePedImpactGibletPacket,
    shards: ShardRuntime,
    crt: NativePedGibletCrt = sharedNativeRandom,
  ): NativePedBloodEmissionResult {
    return this.nativeEmission(packet, shards, crt);
  }
  nativeRequirements(
    packet: NativePedImpactGibletPacket | NativePedSpurtGibletPacket,
    shards: ShardRuntime,
  ): readonly string[] {
    return this.nativeEmission(packet, shards, sharedNativeRandom, true)
      .requiredProviders;
  }
  nativeSpurt(
    packet: NativePedSpurtGibletPacket,
    shards: ShardRuntime,
    crt: NativePedGibletCrt = sharedNativeRandom,
  ): NativePedBloodEmissionResult {
    return this.nativeEmission(packet, shards, crt);
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
    for (const shards of this.nativeShards) shards.clearOwner(this);
    this.nativeShards.clear();
    Object.assign(this.nativeCounters, {
      created: 0,
      impacts: 0,
      spurts: 0,
      poolFull: 0,
    });
    this.cloud.dispose();
    this.cloud = new ExplosionRuntime(this.group, this.textures, {
      random: () => this.cloudRandom(),
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
    for (const resource of this.nativeResources) {
      resource.geometry.dispose();
      resource.material.dispose();
    }
    this.nativeResources.clear();
    this.nativeModels.clear();
    for (const geometry of this.geometries.values()) geometry.dispose();
    for (const texture of this.textures.values()) texture.dispose();
    this.group.removeFromParent();
  }
}
