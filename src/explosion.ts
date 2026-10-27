import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  Object3D,
  Quaternion,
  Sprite,
  SpriteMaterial,
  Texture,
  Vector3,
} from "three";
import type { SmashExplosion, SmashPair } from "./world-smash";
import { mineRandomFloat, mineRandomInteger } from "./physics/mines";

export const EXPLOSION_CAPACITY = 50;
export const EXPLOSION_FRAME_CAPACITY = 10;
export interface WastedExplosionSettings {
  chancePercent: number;
  soundId: number;
  pixelmapFile: string;
  groups: SmashExplosion[];
}

/** GENERAL's explicitly marked block, not an accidental numeric match elsewhere.
 * Installed reader 0x4ee500 has 68-byte groups and 8-byte frames. */
export function parseWastedExplosionSettings(
  text: string,
): WastedExplosionSettings {
  const lines = text.replace(/\r/g, "").split("\n");
  const marker = lines.findIndex((line) =>
    /^\s*\/\/\s*Wasted explosion settings\s*$/i.test(line),
  );
  if (marker < 0) throw new Error("Missing Wasted explosion settings");
  const rows = lines
    .slice(marker + 1)
    .map((line) => line.split("//")[0].trim())
    .filter(Boolean);
  let cursor = 0;
  const fail = (label: string): never => {
    throw new Error(`Invalid explosion ${label} at row ${cursor + 1}`);
  };
  const row = (label: string) => rows[cursor++] ?? fail(label);
  const numbers = (label: string, count: number) => {
    const tokens = row(label).split(/[\s,]+/);
    if (
      tokens.length !== count ||
      tokens.some(
        (token) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(token),
      )
    )
      fail(label);
    const result = tokens.map(Number);
    if (result.some((value) => !Number.isFinite(value))) fail(label);
    return result;
  };
  const scalar = (label: string) => numbers(label, 1)[0];
  const integer = (label: string, low: number, high: number) => {
    const value = scalar(label);
    if (!Number.isInteger(value) || value < low || value > high) fail(label);
    return value;
  };
  const pair = (label: string, low: number, high: number): SmashPair => {
    const values = numbers(label, 2) as SmashPair;
    if (values[0] < low || values[1] > high || values[0] > values[1])
      fail(label);
    return values;
  };
  const token = (label: string) => {
    const value = row(label);
    if (!/^[\w.\-]+$/.test(value)) fail(label);
    return value;
  };
  const chancePercent = integer("chance", 0, 100);
  const soundId = integer("sound ID", 0, 0x7fffffff);
  const pixelmapFile = token("pixelmap file");
  const count = integer("group count", 0, 64);
  const groups: SmashExplosion[] = [];
  for (let i = 0; i < count; i++) {
    const amount = pair("amount", 0, 32767);
    if (amount.some((value) => !Number.isInteger(value))) fail("amount");
    const delaySeconds = pair("delay", 0, 32.767);
    const offset = numbers("offset", 3) as [number, number, number];
    const xFactor = pair("x factor", 0, 1e6);
    const yFactor = pair("y factor", 0, 1e6);
    const zFactor = pair("z factor", 0, 1e6);
    const frameRate = pair("frame rate", 1000 / 32767, 1000);
    const scale = pair("scale", 0, 1e6);
    const rotation = token("rotation").toLowerCase();
    if (rotation !== "norotate" && rotation !== "randomrotate")
      fail("rotation");
    const frameCount = integer("frame count", 1, EXPLOSION_FRAME_CAPACITY);
    const frames = Array.from({ length: frameCount }, () => {
      const opacity = scalar("opacity");
      if (opacity < 0 || opacity > 100) fail("opacity");
      return { opacity, pixelmap: token("pixelmap") };
    });
    groups.push({
      amount,
      delaySeconds,
      offset,
      xFactor,
      yFactor,
      zFactor,
      frameRate,
      scale,
      rotation: rotation as SmashExplosion["rotation"],
      frames,
    });
  }
  return { chancePercent, soundId, pixelmapFile, groups };
}

interface ExplosionSprite {
  sprite: Sprite;
  start: number;
  period: number;
  frames: SmashExplosion["frames"];
  scale: number;
  localOffset: Vector3;
  position: Vector3;
  orientation?: Quaternion;
  readTransform?: () => Matrix4;
  textures?: ReadonlyMap<string, Texture>;
}

/** Visual effects only. Native Explode 0x4eaa70 / MungeExplosions 0x4ea860.
 * Three's Sprite supplies the camera-facing rotation used by the native quad.
 * Borrowed maps retain their PIX alpha; no additive blend or invented fade.
 * Browser extensions: accept time0 (native uses0 as a free-slot sentinel),
 * release finished slots immediately, and hide absent maps instead of aborting.
 * The parser's 64-group limit bounds malformed input; the native sprite/frame
 * capacities are50/10. Visibility culling belongs to Three's renderer. */
export class ExplosionRuntime {
  private readonly pool: (ExplosionSprite | undefined)[] =
    Array(EXPLOSION_CAPACITY);
  private readonly geometry = new BufferGeometry();
  private readonly random: () => number;
  private readonly textures = new Map<string, Texture>();
  private readonly rotated = new Vector3();
  constructor(
    private readonly scene: Object3D,
    textures: ReadonlyMap<string, Texture>,
    options: { random?: () => number } = {},
  ) {
    this.random = options.random ?? Math.random;
    for (const [name, texture] of textures)
      this.textures.set(this.key(name), texture);
    // Native InitExplosions quad: upper V=0, lower V=1. Standard Three Sprite
    // geometry reverses V, so use this explicit shared quad without altering PIX.
    this.geometry.setAttribute(
      "position",
      new Float32BufferAttribute(
        [-0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0, 0.5, -0.5, 0],
        3,
      ),
    );
    this.geometry.setAttribute(
      "uv",
      new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 1, 1], 2),
    );
    this.geometry.setIndex([0, 2, 1, 0, 3, 2]);
  }
  private key(name: string) {
    return name
      .replace(/\\/g, "/")
      .split("/")
      .pop()!
      .replace(/\.pix$/i, "")
      .toLowerCase();
  }
  get activeCount() {
    return this.pool.filter(Boolean).length;
  }

  /** Positions/bounds use native model units. Like the source actor pointer,
   * position/orientation remain live references until the animation expires.
   * A full ACT matrix provider preserves scale/shear for respawn offsets and
   * takes precedence over the position/quaternion pair. */
  spawn(
    groups: readonly SmashExplosion[],
    position: Vector3,
    modelBounds: Box3,
    timeMs: number,
    offset?: Vector3,
    orientation?: Quaternion,
    readTransform?: () => Matrix4,
    textures?: ReadonlyMap<string, Texture>,
  ): number {
    if (
      !Number.isFinite(timeMs) ||
      ![
        ...position.toArray(),
        ...modelBounds.min.toArray(),
        ...modelBounds.max.toArray(),
        ...(offset?.toArray() ?? []),
        ...(orientation?.toArray() ?? []),
      ].every(Number.isFinite) ||
      modelBounds.isEmpty()
    )
      throw new Error("Invalid explosion pose/bounds");
    this.update(timeMs);
    let spawned = 0;
    for (const group of groups.slice(0, 64)) {
      if (
        !group.frames.length ||
        group.frames.length > EXPLOSION_FRAME_CAPACITY ||
        [
          ...group.amount,
          ...group.delaySeconds,
          ...group.offset,
          ...group.xFactor,
          ...group.yFactor,
          ...group.zFactor,
          ...group.frameRate,
          ...group.scale,
        ].some((value) => !Number.isFinite(value)) ||
        group.frameRate.some(
          (value) =>
            value <= 0 ||
            Math.trunc(1000 / value) < 1 ||
            Math.trunc(1000 / value) > 32767,
        ) ||
        group.amount.some(
          (value) => !Number.isInteger(value) || value < 0 || value > 32767,
        ) ||
        group.delaySeconds.some((value) => value < 0 || value > 32.767)
      )
        throw new Error("Invalid explosion group");
      const amount = mineRandomInteger(this.random, ...group.amount);
      for (let i = 0; i < amount; i++) {
        const localOffset = new Vector3();
        for (const [axis, factors] of [
          group.xFactor,
          group.yFactor,
          group.zFactor,
        ].entries()) {
          // Source uses bounds.max, not full or half extents; Chance(50) is a
          // second independent rand() call after each FRandomBetween sample.
          const distance = mineRandomFloat(
            this.random,
            factors[0] * modelBounds.max.getComponent(axis),
            factors[1] * modelBounds.max.getComponent(axis),
          );
          const positive = mineRandomInteger(this.random, 0, 99) < 50;
          localOffset.setComponent(
            axis,
            distance * (positive ? 1 : -1) +
              group.offset[axis] +
              (offset?.getComponent(axis) ?? 0),
          );
        }
        const rotation =
          group.rotation === "randomrotate"
            ? (mineRandomInteger(this.random, 0, 65535) * Math.PI * 2) / 65536
            : 0;
        // Installed constant 0x589ed8 is exactly 1/6.9. Preserve the native
        // reversed endpoints of IRandomBetween(trunc(1000/min),1000/max).
        const scale = mineRandomFloat(this.random, ...group.scale) / 6.9;
        const period = mineRandomInteger(
          this.random,
          Math.trunc(1000 / group.frameRate[0]),
          Math.trunc(1000 / group.frameRate[1]),
        );
        const delay = mineRandomInteger(
          this.random,
          Math.trunc(group.delaySeconds[0] * 1000),
          Math.trunc(group.delaySeconds[1] * 1000),
        );
        // The source draws the complete candidate before checking the pool.
        // Preserve that RNG order even when this last candidate cannot fit.
        const slot = this.pool.findIndex((entry) => !entry);
        if (slot < 0) {
          this.update(timeMs);
          return spawned;
        }
        const material = new SpriteMaterial({
          transparent: true,
          depthWrite: false,
          fog: false,
          rotation,
          opacity: 1,
        });
        const sprite = new Sprite(material);
        sprite.geometry = this.geometry;
        sprite.visible = false;
        sprite.name = "source-explosion";
        this.scene.add(sprite);
        this.pool[slot] = {
          sprite,
          start: timeMs + delay,
          period,
          scale,
          frames: group.frames.slice(),
          position,
          orientation,
          readTransform,
          textures: textures
            ? new Map(
                [...textures].map(([name, texture]) => [
                  this.key(name),
                  texture,
                ]),
              )
            : undefined,
          localOffset,
        };
        spawned++;
      }
    }
    this.update(timeMs);
    return spawned;
  }

  update(timeMs: number): void {
    if (!Number.isFinite(timeMs)) throw new Error("Invalid explosion time");
    for (let i = 0; i < this.pool.length; i++) {
      const entry = this.pool[i];
      if (!entry) continue;
      const frame = Math.floor((timeMs - entry.start) / entry.period);
      if (frame >= entry.frames.length) {
        this.release(i);
        continue;
      }
      const texture =
        frame < 0
          ? undefined
          : (entry.textures ?? this.textures).get(
              this.key(entry.frames[frame].pixelmap),
            );
      entry.sprite.visible = !!texture;
      if (!texture) continue;
      const material = entry.sprite.material;
      if (material.map !== texture) {
        material.map = texture;
        material.needsUpdate = true;
      }
      // Installed ReadExplosion 0x4ee672 overwrites authored opacity with100,
      // and MungeExplosions never applies a frame opacity. PIX alpha still works.
      material.opacity = 1;
      this.rotated.copy(entry.localOffset);
      if (entry.readTransform)
        entry.sprite.position
          .copy(this.rotated)
          .applyMatrix4(entry.readTransform());
      else {
        if (entry.orientation) this.rotated.applyQuaternion(entry.orientation);
        entry.sprite.position.copy(entry.position).add(this.rotated);
      }
      const image = texture.image as
        | { width?: number; height?: number }
        | undefined;
      entry.sprite.scale.set(
        ((image?.width ?? 128) * entry.scale) / 128,
        ((image?.height ?? 128) * entry.scale) / 128,
        1,
      );
    }
  }
  private release(index: number): void {
    const entry = this.pool[index];
    if (!entry) return;
    entry.sprite.removeFromParent();
    entry.sprite.material.dispose();
    this.pool[index] = undefined;
  }
  dispose(): void {
    for (let i = 0; i < this.pool.length; i++) this.release(i);
    this.geometry.dispose();
  }
}
