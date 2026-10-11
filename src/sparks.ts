import * as THREE from "three";
import { sharedNativeRandom } from "./native-random";

const f32 = Math.fround;
const CAPACITY = 32;

export interface WorldSparkSource {
  position: THREE.Vector3;
  /** Native world point velocity. The allocator modifies this object in place. */
  velocity: THREE.Vector3;
  /** World collision-group force after the caller's 6.9 scaling. */
  force: THREE.Vector3;
  sparkiness: number;
  /** Native car master actor; its live rigid transform attaches the second batch. */
  car: THREE.Object3D;
  timeSyncMs?: number;
}
export interface SparkShrapnelRequest {
  nativeAddress: 0x4f8590;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  normal: THREE.Vector3;
  forceLength: number;
  car: THREE.Object3D;
  /** Native trailing arguments repeat the car pointer and two zero values. */
  trailingArguments: readonly [THREE.Object3D, THREE.Object3D, 0, 0];
  /** The same source CRT stream, including any outlet's additional draws. */
  random: () => number;
}
export interface SparkOptions {
  random?: () => number;
  timeSyncMs?: () => number;
  shrapnelOutlet?: (request: SparkShrapnelRequest) => void;
}
export interface NativeSparkRecord {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  normal: THREE.Vector3;
  car: THREE.Object3D | null;
  timeSyncMs: number;
  lifetimeMs: 1000;
  colour: 0;
}
type Spark = {
  active: boolean;
  life: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  tail: THREE.Vector3;
  normal: THREE.Vector3;
  sync: number;
  car: THREE.Object3D | null;
  colour: number;
  line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
};

function scalar(value: number, name: string) {
  const result = f32(value);
  if (!Number.isFinite(result)) throw new Error(`Invalid spark ${name}`);
  return result;
}
function stored(v: THREE.Vector3) {
  return v.set(
    scalar(v.x, "vector"),
    scalar(v.y, "vector"),
    scalar(v.z, "vector"),
  );
}
function uint(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error("Invalid spark clock");
  return value;
}
function linear(v: THREE.Vector3, m: THREE.Matrix4) {
  const e = m.elements,
    { x, y, z } = v;
  return stored(
    v.set(
      e[0] * x + e[4] * y + e[8] * z,
      e[1] * x + e[5] * y + e[9] * z,
      e[2] * x + e[6] * y + e[10] * z,
    ),
  );
}
/** Native inverse is a transpose of the orthonormal actor basis, not an arbitrary
 * scale/shear inverse. Browser integration supplies the car's rigid master actor. */
function transpose(v: THREE.Vector3, m: THREE.Matrix4) {
  const e = m.elements,
    { x, y, z } = v;
  return stored(
    v.set(
      e[0] * x + e[1] * y + e[2] * z,
      e[4] * x + e[5] * y + e[6] * z,
      e[8] * x + e[9] * y + e[10] * z,
    ),
  );
}

/** Independent installed HW world allocator 4f7af0 and renderer 4f71e0. */
export class SparkSystem {
  readonly group = new THREE.Group();
  readonly diagnostics: string[] = [];
  readonly capabilities = {
    worldAllocator: true,
    carCarAllocator: false,
    shrapnelAllocator: false,
    hardwareVertexColourLines: true,
  } as const;
  private readonly records: Spark[] = [];
  private readonly material = new THREE.LineBasicMaterial({
    vertexColors: true,
  });
  private cursor = 0;
  private created = 0;
  private overwritten = 0;
  private randomDraws = 0;
  private shrapnelRequests = 0;
  private disposed = false;
  private readonly random: () => number;

  constructor(private readonly options: SparkOptions = {}) {
    this.random = options.random ?? sharedNativeRandom.random;
    this.group.name = "C2 sparks";
    for (let id = 0; id < CAPACITY; id++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(new Float32Array(6), 3),
      );
      // DrawLine3D receives the tail first: vertex zero is red, head yellow.
      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute([1, 0, 0, 1, 1, 0], 3),
      );
      const line = new THREE.Line(geometry, this.material);
      line.name = `C2 spark ${id}`;
      line.visible = false;
      line.frustumCulled = false;
      this.group.add(line);
      this.records.push({
        active: false,
        life: 0,
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        tail: new THREE.Vector3(),
        normal: new THREE.Vector3(),
        sync: 0,
        car: null,
        colour: 0,
        line,
      });
    }
  }
  private diagnose(message: string) {
    if (this.diagnostics.length < 32 && !this.diagnostics.includes(message))
      this.diagnostics.push(message);
  }
  private readonly sample = () => {
    const value = this.random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("Invalid native spark RNG sample");
    this.randomDraws++;
    return Math.floor(value * 32768) / 32768;
  };
  private between(low: number, high: number) {
    // FRandomBetween returns a live x87 result; callers decide where to spill.
    return low + (high - low) * this.sample();
  }
  private allocate(
    position: THREE.Vector3,
    normal: THREE.Vector3,
    velocity: THREE.Vector3,
    car: THREE.Object3D | null,
    sync: number,
  ) {
    const id = this.cursor,
      record = this.records[id];
    if (record.active) this.overwritten++;
    record.active = true;
    record.life = 1000;
    record.position.copy(position);
    record.normal.copy(normal);
    record.velocity.copy(velocity);
    record.sync = sync;
    record.car = car;
    record.colour = 0;
    record.line.visible = false;
    this.cursor = (id + 1) % CAPACITY;
    this.created++;
    return id;
  }
  /** Native car/car producer shares this exact 32-record pool with world sparks.
   * Copy mutable producer vectors; the allocator reuses them for later slots. */
  readonly allocateNative = (source: NativeSparkRecord): number => {
    if (this.disposed) throw new Error("Native spark pool already disposed");
    if (source.lifetimeMs !== 1000 || source.colour !== 0)
      throw new Error("Unsupported native spark record type");
    return this.allocate(
      stored(source.position.clone()),
      stored(source.normal.clone()),
      stored(source.velocity.clone()),
      source.car,
      uint(source.timeSyncMs),
    );
  };
  spawnWorld(source: WorldSparkSource) {
    const ids: number[] = [];
    if (this.disposed)
      return { ids, worldCount: 0, attachedCount: 0, shrapnelRequested: false };
    const position = stored(source.position.clone()),
      force = stored(source.force.clone());
    const velocity = stored(source.velocity.clone());
    const sparkiness = scalar(source.sparkiness, "sparkiness");
    const sync = uint(source.timeSyncMs ?? this.options.timeSyncMs?.() ?? 0);
    const magnitude = scalar(force.length(), "force length");
    if (magnitude === 0) {
      this.diagnose("Zero native spark force rejected before division");
      return { ids, worldCount: 0, attachedCount: 0, shrapnelRequested: false };
    }
    const normal = stored(force.clone().divideScalar(magnitude));
    const dot = force.dot(velocity);
    const factor =
      1 / (10 * magnitude) - (dot < 0 ? dot / (magnitude * magnitude) : 0);
    stored(velocity.addScaledVector(force, factor));
    source.velocity.copy(velocity);
    const upper = scalar(0.7 + 0.5 * velocity.length(), "random bound");
    const worldCount = Math.max(
      0,
      Math.min(10, Math.trunc(this.between(0, upper) * sparkiness)),
    );
    for (let n = 0; n < worldCount; n++) {
      const v = stored(
        new THREE.Vector3(
          velocity.x * this.between(f32(0.5), f32(0.9)),
          velocity.y * this.between(f32(0.5), f32(0.9)),
          velocity.z * this.between(f32(0.5), f32(0.9)),
        ),
      );
      ids.push(this.allocate(position, normal, v, null, sync));
    }
    const energy = scalar(magnitude * sparkiness, "force product");
    if (energy < 10)
      return { ids, worldCount, attachedCount: 0, shrapnelRequested: false };
    source.car.updateWorldMatrix(true, false);
    const matrix = source.car.matrixWorld;
    const e = matrix.elements;
    const localNormal = transpose(normal.clone(), matrix);
    const localPosition = transpose(
      position.clone().sub(new THREE.Vector3(e[12], e[13], e[14])),
      matrix,
    );
    stored(localPosition.addScaledVector(localNormal, f32(0.01)));
    const attachedCount = Math.max(
      0,
      Math.min(10, 3 - Math.trunc(energy * f32(-0.1))),
    );
    for (let n = 0; n < attachedCount; n++) {
      // Installed argument evaluation order is Z, Y, X. R is not normalized.
      const z = f32(this.between(-1, 1));
      const y = f32(this.between(f32(-0.2), 1));
      const x = f32(this.between(-1, 1));
      const v = new THREE.Vector3(x, y, z);
      stored(v.addScaledVector(localNormal, -v.dot(localNormal)));
      ids.push(this.allocate(localPosition, localNormal, v, source.car, sync));
    }
    this.shrapnelRequests++;
    if (this.options.shrapnelOutlet)
      this.options.shrapnelOutlet({
        nativeAddress: 0x4f8590,
        position: source.position,
        velocity: source.velocity,
        normal,
        forceLength: magnitude,
        car: source.car,
        trailingArguments: [source.car, source.car, 0, 0],
        random: this.sample,
      });
    else
      this.diagnose(
        "Native shrapnel 4f8590 outlet unresolved; its RNG side effects are not reconstructed",
      );
    return { ids, worldCount, attachedCount, shrapnelRequested: true };
  }
  /** One call per native render frame, after physics producers; sync is a duration. */
  update(timeMs: number, framePeriodMs: number) {
    uint(timeMs);
    uint(framePeriodMs);
    if (this.disposed) return;
    for (const record of this.records) {
      record.line.visible = false;
      if (!record.active) continue;
      if (record.life <= 0) {
        record.life = 0;
        record.active = false;
      }
      stored(
        record.velocity.addScaledVector(
          record.normal,
          -record.normal.dot(record.velocity),
        ),
      );
      stored(
        record.position.addScaledVector(
          record.velocity,
          (record.sync || framePeriodMs) * f32(0.001),
        ),
      );
      record.life += record.sync ? record.sync - framePeriodMs : -framePeriodMs;
      record.sync = 0;
      stored(
        record.tail
          .copy(record.velocity)
          .multiplyScalar(-Math.min(150, 1000 - record.life) * f32(0.001)),
      );
      const head = record.position.clone();
      const gravity = scalar(
        framePeriodMs * 10 * 0.00014492753623188405,
        "gravity",
      );
      if (record.car) {
        record.car.updateWorldMatrix(true, false);
        const matrix = record.car.matrixWorld,
          e = matrix.elements;
        linear(record.tail, matrix);
        stored(head.applyMatrix4(matrix));
        stored(
          record.velocity.sub(
            new THREE.Vector3(e[1], e[5], e[9]).multiplyScalar(gravity),
          ),
        );
      } else
        record.velocity.y = scalar(
          record.velocity.y - gravity,
          "gravity velocity",
        );
      const end = stored(head.clone().add(record.tail));
      const z = f32(this.between(f32(-0.1), f32(0.1)));
      const y = f32(this.between(f32(-0.1), f32(0.1)));
      const x = f32(this.between(f32(-0.1), f32(0.1)));
      stored(record.velocity.add(new THREE.Vector3(x, y, z)));
      const drag = Math.max(
        f32(0.1),
        1 -
          record.velocity.length() * f32(1 / 1.4) * framePeriodMs * f32(0.001),
      );
      stored(record.velocity.multiplyScalar(drag));
      const vertices = record.line.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      vertices.setXYZ(0, end.x, end.y, end.z);
      vertices.setXYZ(1, head.x, head.y, head.z);
      vertices.needsUpdate = true;
      record.line.visible = true;
    }
  }
  get stats() {
    return {
      active: this.records.filter((r) => r.active).length,
      visible: this.records.filter((r) => r.line.visible).length,
      cursor: this.cursor,
      created: this.created,
      overwritten: this.overwritten,
      randomDraws: this.randomDraws,
      shrapnelRequests: this.shrapnelRequests,
      shrapnelOutletProvided: !!this.options.shrapnelOutlet,
    };
  }
  snapshot() {
    return {
      ...this.stats,
      records: this.records.map((r, id) => ({
        id,
        active: r.active,
        life: r.life,
        position: r.position.clone(),
        velocity: r.velocity.clone(),
        tail: r.tail.clone(),
        normal: r.normal.clone(),
        sync: r.sync,
        car: r.car,
        visible: r.line.visible,
        vertices: Array.from(r.line.geometry.getAttribute("position").array),
      })),
    };
  }
  clear() {
    for (const record of this.records) {
      record.active = false;
      record.line.visible = false;
    }
    // ResetSparks4f8530 only clears the mask; cursor and records survive.
  }
  dispose() {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    for (const record of this.records) record.line.geometry.dispose();
    this.material.dispose();
    this.group.clear();
    this.group.removeFromParent();
  }
}
