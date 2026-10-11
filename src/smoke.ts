import * as THREE from "three";
import type { Assets } from "./content";
import { NativeRandom, sharedNativeRandom } from "./native-random";

const f32 = Math.fround;
const INV_SCALE = f32(1 / 6.9);
const RISE = f32(0.43478259);
const BASE_SHADES = [0x000000, 0x404040, 0x808080, 0xc8c8c8, 0xc8c8c8];
export const FLAME_FRAME_DIMENSIONS = [
  [20, 25],
  [24, 32],
  [24, 34],
  [28, 44],
  [28, 49],
  [32, 53],
  [28, 61],
  [28, 69],
  [24, 61],
  [28, 64],
  [24, 70],
  [20, 65],
  [20, 64],
  [20, 74],
  [28, 55],
  [24, 62],
  [28, 47],
  [20, 51],
  [20, 45],
  [20, 45],
] as const;

export interface SmokeRigid {
  /** Native world velocity in actor units per second, and body-axis omega. */
  velocity: THREE.Vector3;
  omega: THREE.Vector3;
  actor?: THREE.Object3D;
}
export interface SmokeCar {
  velocity: THREE.Vector3;
  /** Native mode-1 upside-down attachment needs the car's rigid-shape height. */
  invertedSourceY?: () => number;
  isOnDetachedHalf?: (local: THREE.Vector3) => boolean;
}
export interface SmokeColumnSource {
  mode: 1 | 2;
  actor: THREE.Object3D;
  car?: SmokeCar;
  rigid?: SmokeRigid;
  colour: number;
  vertex: number;
  lifetimeMs: number;
  /** Write the current actor-local first prepared-group vertex. Native prepared
   * vertex order differs from Three's face-corner order. False expires the source. */
  sampleVertex?: (vertex: number, out: THREE.Vector3) => boolean;
}
export interface SmokePuffSource {
  position: THREE.Vector3;
  /** Input velocity before native 1/6.9 scaling and Y rise. */
  velocity: THREE.Vector3;
  strength: number;
  decay: number;
  type: number;
  /** Physics-to-render synchronization duration, not an absolute timestamp. */
  timeSyncMs?: number;
}
export interface SurfaceSmokeSource {
  actor: THREE.Object3D;
  wheel: number;
  wheelPosition: THREE.Vector3;
  suspensionDistance: number;
  suspensionHeight: number;
  velocityCarSpace: THREE.Vector3;
  omega: THREE.Vector3;
  bounds: THREE.Box3;
  smokeType: number;
  dustRotate: number;
  dustCount: number;
  driver: number;
  disabled: boolean;
}
export interface SmokeOptions {
  camera?: THREE.Camera;
  alternateCamera?: THREE.Camera;
  random?: () => number;
  enabled?: boolean;
  /** Original dust shade-table RGB values occupy indices 8..15. */
  shadeColours?: readonly (number | undefined)[];
  /** Physics sync duration for explicit surface/impact puffs. Columns use 1 ms. */
  timeSyncMs?: () => number;
}

type Flame = {
  frame: number;
  width: number;
  height: number;
  x: number;
  z: number;
  visible: boolean;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
};
type Column = {
  active: boolean;
  source: SmokeColumnSource | null;
  remaining: number;
  time: number;
  count: number;
  whiter: number;
  upright: boolean;
  position: THREE.Vector3;
  flames: Flame[];
  group: THREE.Group;
  glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
};
type Puff = {
  active: boolean;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  strength: number;
  decay: number;
  radius: number;
  type: number;
  timeSync: number;
  sprite: THREE.Sprite;
};

function finiteVector(v: THREE.Vector3): boolean {
  return [v.x, v.y, v.z].every((n) => Number.isFinite(f32(n)));
}
function storeVector(v: THREE.Vector3): THREE.Vector3 {
  return v.set(f32(v.x), f32(v.y), f32(v.z));
}
function uint(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error(`Invalid smoke ${name}`);
  return value;
}

/** Installed 4fa340 numerical surface kernel. The caller supplies contact gates
 * and wheel timing; the actor is already in the engine's native coordinate map. */
export function surfaceSmokePuff(
  input: SurfaceSmokeSource,
): SmokePuffSource | null {
  if (
    !finiteVector(input.wheelPosition) ||
    !finiteVector(input.velocityCarSpace) ||
    !finiteVector(input.omega) ||
    !finiteVector(input.bounds.min) ||
    !finiteVector(input.bounds.max) ||
    !Number.isFinite(input.suspensionDistance)
  )
    throw new Error("Invalid surface smoke geometry");
  uint(input.dustCount, "dust count");
  if (
    input.dustCount < 1 ||
    input.dustCount > 8 ||
    !Number.isInteger(input.dustRotate) ||
    input.dustRotate < 0 ||
    input.dustRotate >= input.dustCount ||
    !Number.isInteger(input.smokeType) ||
    input.smokeType < 2
  )
    throw new Error("Invalid authored surface smoke table");
  const velocity = storeVector(
    input.omega
      .clone()
      .cross(input.wheelPosition)
      .addScaledVector(input.velocityCarSpace, f32(6.9)),
  );
  if (velocity.lengthSq() < 25) return null;
  const strength = f32(Math.min(1, Math.sqrt(velocity.lengthSq()) * f32(0.04)));
  const local = storeVector(
    input.wheelPosition.clone().multiplyScalar(INV_SCALE),
  );
  local.y = f32(local.y - input.suspensionDistance / 6.9);
  const projected = (axis: "x" | "z") =>
    velocity[axis] === 0
      ? -1000
      : ((velocity[axis] < 0
          ? input.bounds.max[axis]
          : input.bounds.min[axis]) -
          local[axis]) /
        velocity[axis];
  local.addScaledVector(velocity, Math.max(projected("x"), projected("z")));
  input.actor.updateWorldMatrix(true, false);
  const position = storeVector(local.applyMatrix4(input.actor.matrixWorld));
  // Apply only the actor's linear transform, including authored scale.
  const e = input.actor.matrixWorld.elements,
    x = velocity.x,
    y = velocity.y,
    z = velocity.z;
  storeVector(
    velocity.set(
      e[0] * x + e[4] * y + e[8] * z,
      e[1] * x + e[5] * y + e[9] * z,
      e[2] * x + e[6] * y + e[10] * z,
    ),
  );
  if (!finiteVector(position) || !finiteVector(velocity))
    throw new Error("Non-finite surface smoke transform");
  return {
    position,
    velocity,
    strength,
    decay: f32(2 * strength),
    type: 8 + ((input.dustRotate + input.smokeType - 2) % input.dustCount),
  };
}

/** Bounded native column/puff pools; original textures are loaded lazily through
 * Assets. This owns materials/geometries, never the Assets texture cache. */
export class SmokeSystem {
  readonly group = new THREE.Group();
  readonly diagnostics: string[] = [];
  enabled: boolean;
  private readonly columns: Column[] = [];
  private readonly puffs: Puff[] = [];
  private readonly flameGeometry = new THREE.PlaneGeometry(1, 1).translate(
    0,
    0.5,
    0,
  );
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly glowGeometry = new THREE.BufferGeometry()
    .setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [-1, 1, 0, -1, 0, 0, 1, 0, 0, 1, 1, 0, -1, -0.25, 0, 1, -0.25, 0],
        3,
      ),
    )
    .setAttribute(
      "uv",
      new THREE.Float32BufferAttribute(
        [0, 1, 0, 0.5, 1, 0.5, 1, 1, 0, 0, 1, 0],
        2,
      ),
    )
    .setIndex([0, 1, 2, 2, 3, 0, 1, 5, 2, 1, 4, 5]);
  private readonly random: () => number;
  private readonly reported = new Set<string>();
  private wheelTimes = new WeakMap<THREE.Object3D, number[]>();
  private columnCursor = 0;
  private puffCursor = 0;
  private columnOverwrites = 0;
  private puffOverwrites = 0;
  private rejectedPuffs = 0;
  private disposed = false;
  private loading?: Promise<void>;

  constructor(
    private assets?: Pick<Assets, "resolve" | "pixelmaps" | "textures">,
    private options: SmokeOptions = {},
  ) {
    this.enabled = options.enabled ?? true;
    this.random = options.random ?? sharedNativeRandom.random;
    this.group.name = "original-smoke-and-flames";
    // Original fire quad has V=1 on its bottom edge.
    const uv = this.flameGeometry.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    for (let i = 0; i < 10; i++) {
      const group = new THREE.Group();
      group.visible = false;
      const flames: Flame[] = Array.from({ length: 3 }, () => {
        const material = new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const mesh = new THREE.Mesh(this.flameGeometry, material);
        mesh.visible = false;
        group.add(mesh);
        return {
          frame: 100,
          width: 0,
          height: 0,
          x: 0,
          z: 0,
          visible: false,
          mesh,
        };
      });
      this.group.add(group);
      const glow = new THREE.Mesh(
        this.glowGeometry,
        new THREE.MeshBasicMaterial({
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          color: 0xfedf43,
          toneMapped: false,
        }),
      );
      glow.visible = false;
      this.group.add(glow);
      this.columns.push({
        active: false,
        source: null,
        remaining: 0,
        time: 0,
        count: 0,
        whiter: 0,
        upright: true,
        position: new THREE.Vector3(),
        flames,
        group,
        glow,
      });
    }
    for (let i = 0; i < 25; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      sprite.visible = false;
      this.group.add(sprite);
      this.puffs.push({
        active: false,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        strength: 0,
        decay: 0,
        radius: 0,
        type: 0,
        timeSync: 0,
        sprite,
      });
    }
  }

  get stats() {
    return {
      columns: this.columns.filter((c) => c.active).length,
      puffs: this.puffs.filter((p) => p.active).length,
      flameSprites: this.columns.reduce(
        (n, c) => n + c.flames.filter((f) => c.active && f.visible).length,
        0,
      ),
      glows: this.columns.filter((c) => c.glow.visible).length,
      columnCursor: this.columnCursor,
      puffCursor: this.puffCursor,
      columnOverwrites: this.columnOverwrites,
      puffOverwrites: this.puffOverwrites,
      rejectedPuffs: this.rejectedPuffs,
      textures: this.textures.size,
      diagnostics: this.diagnostics.length,
    };
  }

  /** Detached snapshots allow conformance/debugging without mutating pool state. */
  snapshot() {
    return {
      columns: this.columns.map((c) => ({
        active: c.active,
        remaining: c.remaining,
        time: c.time,
        count: c.count,
        whiter: c.whiter,
        position: c.position.clone(),
        vertex: c.source?.vertex,
        flames: c.flames.map((f) => ({
          frame: f.frame,
          visible: f.visible,
          width: f.width,
          height: f.height,
          x: f.x,
          z: f.z,
        })),
      })),
      puffs: this.puffs.map((p) => ({
        active: p.active,
        position: p.position.clone(),
        velocity: p.velocity.clone(),
        strength: p.strength,
        decay: p.decay,
        radius: p.radius,
        type: p.type,
        timeSync: p.timeSync,
      })),
    };
  }

  private diagnose(message: string) {
    if (!this.reported.has(message)) {
      this.reported.add(message);
      this.diagnostics.push(message);
    }
  }
  private sample(): number {
    const value = this.random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("Invalid native smoke RNG sample");
    return Math.floor(value * 32768) / 32768;
  }
  private between(a: number, b: number) {
    return f32(a + (b - a) * this.sample());
  }
  private integer(a: number, b: number) {
    return a + Math.floor((b - a + 1) * this.sample());
  }

  /** Loading is explicit-awaitable for browser checks and starts on first spawn. */
  loadTextures(): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      if (!this.assets || this.disposed) return;
      for (const name of [
        "smoke",
        ...Array.from(
          { length: 20 },
          (_, i) => `flm${String(i + 1).padStart(2, "0")}`,
        ),
      ]) {
        if (this.disposed) return;
        const cached = this.assets.textures.get(name);
        if (cached) {
          this.textures.set(name, cached);
          continue;
        }
        const path = this.assets.resolve(
          name === "smoke"
            ? "data/PIXELMAP/PIX16/SMOKE.PIX"
            : `data/COMMON/flames/PIX16/${name}.PIX`,
        );
        if (!path) {
          this.diagnose(`Original smoke texture missing: ${name}`);
          continue;
        }
        try {
          const maps = this.assets.textures;
          await this.assets.pixelmaps(path, maps);
          const texture = maps.get(name);
          if (!texture) this.diagnose(`Original smoke texture empty: ${name}`);
          else if (!this.disposed) this.textures.set(name, texture);
        } catch (error) {
          this.diagnose(`Original smoke texture ${name}: ${String(error)}`);
        }
      }
    })();
    return this.loading;
  }

  spawnColumn(source: SmokeColumnSource): number | null {
    if (this.disposed || !this.enabled) return null;
    uint(source.lifetimeMs, "column lifetime");
    uint(source.vertex, "source vertex");
    if (
      (source.mode !== 1 && source.mode !== 2) ||
      !Number.isInteger(source.colour) ||
      source.colour < 0 ||
      source.colour > 15 ||
      !(source.actor instanceof THREE.Object3D)
    )
      throw new Error("Invalid smoke column source");
    if (
      source.rigid &&
      (!finiteVector(source.rigid.velocity) ||
        !finiteVector(source.rigid.omega))
    )
      throw new Error("Invalid smoke rigid velocity");
    const index = this.columnCursor,
      column = this.columns[index];
    if (column.active) this.columnOverwrites++;
    column.active = true;
    column.source = { ...source };
    column.remaining = source.lifetimeMs;
    column.time = 0;
    column.upright = true;
    column.group.visible = source.colour === 0;
    for (const flame of column.flames) {
      flame.frame = 100;
      flame.visible = false;
      flame.mesh.visible = false;
    }
    this.columnCursor = (index + 1) % 10;
    void this.loadTextures();
    return index;
  }

  /** StopCarSmoking4fc7d0 shortens existing matching car columns without
   * deleting them, changing their cursor or touching free/pedestrian sources. */
  shortenCarColumns(car: SmokeCar, maximumMs: number): void {
    uint(maximumMs, "maximum column lifetime");
    for (const column of this.columns)
      if (column.active && column.source?.car === car)
        column.remaining = Math.min(column.remaining, maximumMs);
  }

  /** StopCarSmokingInstantly4fc800 leaves retirement to the next column pass. */
  expireCarColumns(car: SmokeCar): void {
    this.shortenCarColumns(car, 0);
  }

  spawnPuff(source: SmokePuffSource): number | null {
    if (this.disposed || !this.enabled) return null;
    if (
      !finiteVector(source.position) ||
      !finiteVector(source.velocity) ||
      !Number.isFinite(f32(source.strength)) ||
      !Number.isFinite(f32(source.decay)) ||
      !Number.isInteger(source.type) ||
      source.type < 0 ||
      source.type > 255
    )
      throw new Error("Invalid smoke puff source");
    const sync = uint(
      source.timeSyncMs ?? this.options.timeSyncMs?.() ?? 1,
      "sync duration",
    );
    const near = (camera: THREE.Camera) =>
      source.position.distanceToSquared(
        camera.getWorldPosition(new THREE.Vector3()),
      ) <= 625;
    if (
      this.options.camera &&
      !near(this.options.camera) &&
      (!this.options.alternateCamera || !near(this.options.alternateCamera))
    ) {
      this.rejectedPuffs++;
      return null;
    }
    const index = this.puffCursor,
      puff = this.puffs[index];
    if (puff.active) this.puffOverwrites++;
    puff.active = true;
    storeVector(puff.position.copy(source.position));
    puff.position.y = f32(
      puff.position.y + f32(0.04) * ((source.type & 15) === 7 ? 1 : 2),
    );
    storeVector(puff.velocity.copy(source.velocity).multiplyScalar(INV_SCALE));
    puff.velocity.y = f32(puff.velocity.y + 1 / 6.9);
    puff.radius = f32((source.type & 15) === 7 ? 0.1 : 0.05);
    puff.strength = f32(Math.min(1, source.strength));
    puff.decay = f32(source.decay);
    puff.type = source.type;
    puff.timeSync = sync;
    this.puffCursor = (index + 1) % 25;
    void this.loadTextures();
    return index;
  }

  spawnSurfaceSmoke(
    source: SurfaceSmokeSource,
    framePeriodMs: number,
  ): number | null {
    uint(framePeriodMs, "frame period");
    if (!Number.isInteger(source.wheel) || source.wheel < 0 || source.wheel > 3)
      throw new Error("Invalid smoke wheel index");
    if (
      !Number.isFinite(source.suspensionDistance) ||
      !Number.isFinite(source.suspensionHeight)
    )
      throw new Error("Invalid smoke suspension");
    if (
      this.disposed ||
      !this.enabled ||
      source.driver <= 5 ||
      source.disabled ||
      source.suspensionDistance >= source.suspensionHeight ||
      source.smokeType < 2
    )
      return null;
    let timers = this.wheelTimes.get(source.actor);
    if (!timers) {
      timers = [0, 0, 0, 0];
      this.wheelTimes.set(source.actor, timers);
    }
    if (timers[source.wheel] > framePeriodMs) {
      timers[source.wheel] -= framePeriodMs;
      return null;
    }
    timers[source.wheel] = Math.max(
      0,
      timers[source.wheel] + this.integer(200, 400) - framePeriodMs,
    );
    const puff = surfaceSmokePuff(source);
    return puff ? this.spawnPuff(puff) : null;
  }

  private vertex(source: SmokeColumnSource, out: THREE.Vector3): boolean {
    if (source.sampleVertex)
      return source.sampleVertex(source.vertex, out) && finiteVector(out);
    let mesh: THREE.Mesh | undefined;
    source.actor.traverse((object) => {
      if (!mesh && object instanceof THREE.Mesh) mesh = object;
    });
    if (!mesh) return false;
    const positions = mesh.geometry.getAttribute("position");
    if (!positions) return false;
    const sourceIndices = mesh.geometry.userData.sourceVertexIndices as
      | Uint32Array
      | undefined;
    let index = source.vertex;
    if (sourceIndices) index = sourceIndices.indexOf(source.vertex);
    if (index < 0 || index >= positions.count) return false;
    out.fromBufferAttribute(positions, index);
    mesh.updateWorldMatrix(true, false);
    source.actor.updateWorldMatrix(true, false);
    if (mesh !== source.actor)
      out
        .applyMatrix4(mesh.matrixWorld)
        .applyMatrix4(source.actor.matrixWorld.clone().invert());
    return finiteVector(out);
  }

  private animate(column: Column, dt: number) {
    const source = column.source!;
    if (this.options.camera) {
      this.options.camera.updateWorldMatrix(true, false);
      const forward = new THREE.Vector3(0, 0, 1).transformDirection(
        this.options.camera.matrixWorld,
      );
      column.group.rotation.y = Math.atan2(forward.x, forward.z);
    }
    column.group.position.copy(column.position);
    for (const flame of column.flames) {
      flame.frame++;
      if (flame.frame >= 20) {
        flame.frame = this.integer(-5, -1);
        const width = this.between(1, 1.5) * f32(0.003);
        flame.width = f32((2 * this.integer(0, 1) - 1) * width);
        flame.height = f32(this.between(0.5, 1) * f32(0.003));
        flame.x = this.between(-0.03, 0.03);
        flame.z = this.between(-0.03, 0);
        flame.visible = false;
      }
      if (flame.frame === 0) {
        const velocity = source.car?.velocity;
        if (velocity && !finiteVector(velocity)) {
          this.diagnose("Non-finite car flame velocity");
          flame.frame = -5;
        } else if (
          column.remaining > 30 * dt &&
          (!velocity || velocity.lengthSq() < 11.594202898550725)
        )
          flame.visible = true;
        else flame.frame = -5;
      }
      const texture =
        flame.frame >= 0
          ? this.textures.get(`flm${String(flame.frame + 1).padStart(2, "0")}`)
          : undefined;
      flame.mesh.visible = flame.visible && flame.frame >= 0 && !!texture;
      if (flame.frame >= 0) {
        const dims = FLAME_FRAME_DIMENSIONS[flame.frame];
        flame.mesh.scale.set(
          f32(dims[0] * flame.width),
          f32(dims[1] * flame.height),
          1,
        );
        flame.mesh.position.set(flame.x, 0, flame.z);
        if (flame.mesh.material.map !== (texture ?? null)) {
          flame.mesh.material.map = texture ?? null;
          flame.mesh.material.needsUpdate = true;
        }
      }
    }
  }

  update(timeMs: number, framePeriodMs: number): void {
    this.updateColumns(timeMs, framePeriodMs);
    this.updatePuffs(timeMs, framePeriodMs);
  }

  /** MungeSmokeColumn runs inside MungeShrapnel, before fragment advancement
   * and the final smash flush. Puff rendering has its separate later phase. */
  updateColumns(timeMs: number, framePeriodMs: number): void {
    uint(timeMs, "time");
    const dt = uint(framePeriodMs, "frame period");
    if (this.disposed || dt === 0) return;
    for (const column of this.columns) {
      if (!column.active) continue;
      if (column.remaining < dt) {
        this.deactivateColumn(column);
        continue;
      }
      column.remaining -= dt;
      const source = column.source!,
        local = new THREE.Vector3();
      if (!this.vertex(source, local)) {
        this.diagnose(
          `Smoke source vertex unavailable: mode ${source.mode}, vertex ${source.vertex}`,
        );
        this.deactivateColumn(column);
        continue;
      }
      source.actor.updateWorldMatrix(true, false);
      if (source.mode === 1) {
        const y = source.actor.matrixWorld.elements[5];
        if (y > 0.1) column.upright = true;
        if (y < -0.1) column.upright = false;
        if (!column.upright) {
          if (!source.car?.invertedSourceY) {
            this.diagnose(
              "Mode-1 inverted smoke source requires rigid-shape height",
            );
            this.deactivateColumn(column);
            continue;
          }
          local.y = source.car.invertedSourceY();
        }
        if (source.car?.isOnDetachedHalf?.(local)) column.remaining = 0;
      }
      storeVector(
        column.position.copy(local).applyMatrix4(source.actor.matrixWorld),
      );
      column.position.y = f32(column.position.y - f32(0.03));
      if (!finiteVector(column.position)) {
        this.diagnose("Non-finite smoke actor transform");
        this.deactivateColumn(column);
        continue;
      }
      if (source.colour === 0) this.animate(column, dt);
      column.time += dt;
      if (column.time <= 200) continue;
      column.time -= dt; // Verified native accumulator quirk: not -=200.
      column.count++;
      const position = column.position.clone();
      position.x = f32(position.x + this.between(-0.03, 0.03));
      position.y = f32(position.y + (source.colour === 0 ? f32(0.05) : 0));
      position.z = f32(position.z + this.between(-0.03, 0.03));
      column.whiter =
        column.whiter & 2 && this.integer(0, 3) === 0
          ? column.whiter & 1
          : column.whiter >= 1
            ? 2
            : -1;
      let strength = (Number(column.whiter > 0) + 1) / 2;
      if (column.remaining < 4000)
        strength = f32((column.remaining * strength) / 4000);
      const velocity = new THREE.Vector3(0, f32(2.8985507), 0);
      if (source.rigid) {
        const rigid = source.rigid;
        if (!finiteVector(rigid.velocity) || !finiteVector(rigid.omega)) {
          this.diagnose("Non-finite live smoke rigid velocity");
          continue;
        }
        velocity.copy(rigid.omega).cross(local);
        const actor = rigid.actor ?? source.actor;
        actor.updateWorldMatrix(true, false);
        const e = actor.matrixWorld.elements,
          x = velocity.x,
          y = velocity.y,
          z = velocity.z;
        velocity.set(
          e[0] * x + e[4] * y + e[8] * z,
          e[1] * x + e[5] * y + e[9] * z,
          e[2] * x + e[6] * y + e[10] * z,
        );
        velocity.addScaledVector(rigid.velocity, 6.9);
        velocity.y += 2.898550724637681;
        storeVector(velocity);
      }
      if (!finiteVector(velocity)) {
        this.diagnose("Non-finite smoke emission velocity");
        continue;
      }
      this.spawnPuff({
        position,
        velocity,
        strength,
        decay: strength,
        type: source.colour + 16,
        timeSyncMs: 1,
      });
    }
  }

  /** RenderSmoke runs after RenderSparks. Producers between these phases can
   * add puffs without advancing their columns a second time this frame. */
  updatePuffs(timeMs: number, framePeriodMs: number): void {
    uint(timeMs, "time");
    const dt = uint(framePeriodMs, "frame period");
    if (this.disposed || dt === 0) return;
    this.drawGlow(timeMs);
    // Native RenderSmoke also saves a CRT sample and reseeds to that sample on
    // exit, rather than restoring the preceding full 32-bit CRT state.
    const smokeSeed =
      this.random === sharedNativeRandom.random &&
      this.puffs.some((p) => p.active)
        ? sharedNativeRandom.nextInteger()
        : undefined;
    // Installed RenderSmoke moves every puff before the lonely-strength pass.
    for (const puff of this.puffs)
      if (puff.active) {
        if (puff.strength <= 0) {
          puff.active = false;
          puff.sprite.visible = false;
          continue;
        }
        storeVector(
          puff.position.addScaledVector(
            puff.velocity,
            (puff.timeSync || dt) * f32(0.001),
          ),
        );
        puff.timeSync = 0;
      }
    const notLonely = new Set<number>();
    for (let i = 0; i < 25; i++) {
      const puff = this.puffs[i];
      if (!puff.active) continue;
      if ((puff.type & 15) === 7) notLonely.add(i);
      else if (!notLonely.has(i))
        for (let j = i + 1; j < 25; j++) {
          if (
            this.puffs[j].active &&
            (puff.radius + this.puffs[j].radius) ** 2 > 0
          ) {
            notLonely.add(i);
            notLonely.add(j);
            break;
          }
        }
      if (!notLonely.has(i)) puff.strength = f32(puff.strength * 0.5);
      const aspect = f32(1 + (puff.radius - f32(0.05)) * 2),
        texture = this.textures.get("smoke");
      const shadeIndex = puff.type & 15;
      const shade =
        this.options.shadeColours?.[shadeIndex] ??
        BASE_SHADES[shadeIndex] ??
        (shadeIndex === 7 ? 0xfedf43 : undefined);
      if (shade === undefined)
        this.diagnose(`Original smoke shade unavailable: ${shadeIndex}`);
      puff.sprite.visible = !!texture && shade !== undefined;
      puff.sprite.position.copy(puff.position);
      puff.sprite.scale.set(
        (2 * puff.radius) / (puff.type & 16 ? aspect : 1),
        (2 * puff.radius) / aspect,
        1,
      );
      if (puff.sprite.material.map !== (texture ?? null)) {
        puff.sprite.material.map = texture ?? null;
        puff.sprite.material.needsUpdate = true;
      }
      if (shade !== undefined) puff.sprite.material.color.setHex(shade);
      puff.sprite.material.opacity = (puff.strength * 150) / 256;
      puff.radius = f32(
        Math.min(
          f32(0.3),
          puff.radius + dt * f32(0.001) * puff.strength * 0.5000000000000001,
        ),
      );
      puff.strength = f32(puff.strength - dt * puff.decay * f32(0.001));
      if (puff.strength <= 0) {
        puff.active = false;
        puff.sprite.visible = false;
        continue;
      }
      storeVector(
        puff.velocity.multiplyScalar(Math.max(0.5, 1 - dt * f32(0.002))),
      );
      if (Math.abs(puff.velocity.y) < RISE && shadeIndex < 7)
        puff.velocity.y =
          puff.velocity.y >= 0 ? RISE : f32(puff.velocity.y + RISE);
      if (!finiteVector(puff.position) || !finiteVector(puff.velocity)) {
        this.diagnose("Non-finite live smoke puff");
        puff.active = false;
        puff.sprite.visible = false;
      }
    }
    if (smokeSeed !== undefined) sharedNativeRandom.seed(smokeSeed);
  }

  private drawGlow(timeMs: number) {
    const active = this.columns.filter(
      (c) => c.active && c.source!.colour <= 1,
    );
    for (const column of this.columns) column.glow.visible = false;
    if (!active.length) return;
    // Native saves rand() rather than the CRT state, temporarily seeds by clock,
    // then srand(savedSample). An injected RNG uses an isolated native clock seed.
    const saved =
      this.random === sharedNativeRandom.random
        ? sharedNativeRandom.nextInteger()
        : undefined;
    if (saved !== undefined) sharedNativeRandom.seed(timeMs);
    const random =
      saved === undefined
        ? new NativeRandom(timeMs).random
        : sharedNativeRandom.random;
    const map = this.textures.get("smoke");
    for (const column of active) {
      const glow = column.glow;
      const aspect = f32(0.5 + (0.99 - 0.5) * random());
      glow.visible = !!map;
      glow.position.copy(column.position);
      glow.position.y = f32(glow.position.y + f32(0.02));
      if (this.options.camera)
        this.options.camera.getWorldQuaternion(glow.quaternion);
      glow.scale.set(f32(0.07), f32(0.07) / aspect, 1);
      glow.material.opacity =
        (0.5 * Math.min(1, column.remaining / 4000) * 150) / 256;
      if (glow.material.map !== (map ?? null)) {
        glow.material.map = map ?? null;
        glow.material.needsUpdate = true;
      }
    }
    if (saved !== undefined) sharedNativeRandom.seed(saved);
  }

  private deactivateColumn(column: Column) {
    column.active = false;
    column.source = null;
    column.group.visible = false;
    column.glow.visible = false;
    for (const flame of column.flames) {
      flame.visible = false;
      flame.mesh.visible = false;
    }
  }
  stopObject(rigid: SmokeRigid) {
    for (const column of this.columns)
      if (column.active && column.source?.rigid === rigid) column.remaining = 0;
  }
  stopCar(car: SmokeCar) {
    for (const column of this.columns)
      if (column.active && column.source?.car === car)
        column.remaining = Math.min(2000, column.remaining);
  }
  clear() {
    for (const column of this.columns) this.deactivateColumn(column);
    for (const puff of this.puffs) {
      puff.active = false;
      puff.sprite.visible = false;
    }
    this.wheelTimes = new WeakMap();
    // Native mask resets retain insertion cursors and reused-slot whiteness.
  }
  dispose() {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    for (const column of this.columns) {
      for (const flame of column.flames) flame.mesh.material.dispose();
      column.glow.material.dispose();
    }
    for (const puff of this.puffs) puff.sprite.material.dispose();
    this.flameGeometry.dispose();
    this.glowGeometry.dispose();
    this.group.clear();
    this.group.removeFromParent();
  }
}
