import * as THREE from "three";
import { sharedNativeRandom } from "./native-random";
import type { SparkShrapnelRequest } from "./sparks";

const f32 = Math.fround;
export interface ShrapnelOptions {
  /** Original FRAG4.DAT, FRAG5.DAT geometry before native half scaling. */
  models?: readonly [THREE.BufferGeometry, THREE.BufferGeometry];
  /** Native GetSimpleMaterial("M14.MAT",4) result. */
  blackMaterial?: THREE.Material;
  carMaterials: (car: THREE.Object3D) => readonly THREE.Material[];
  random?: () => number;
  timeSyncMs?: () => number;
}
export interface ShrapnelSource {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  normal: THREE.Vector3;
  forceLength: number;
  cars: readonly [THREE.Object3D | null, THREE.Object3D | null];
  /** Native optional explicit material array; world sparks leave it absent. */
  materials?: readonly THREE.Material[];
  timeSyncMs?: number;
  random?: () => number;
}
type Fragment = {
  active: boolean;
  age: number;
  sync: number;
  velocity: THREE.Vector3;
  axis: THREE.Vector3;
  shear1: number;
  shear2: number;
  material?: THREE.Material;
  mesh: THREE.Mesh<THREE.BufferGeometry>;
};
function scalar(n: number) {
  const value = f32(n);
  if (!Number.isFinite(value))
    throw new Error("Invalid native shrapnel scalar");
  return value;
}
function stored(v: THREE.Vector3) {
  return v.set(scalar(v.x), scalar(v.y), scalar(v.z));
}
function clock(n: number) {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff)
    throw new Error("Invalid native shrapnel clock");
  return n;
}
// Independently generated six-decimal quarter-wave table, not copied data.
const sine = Array.from({ length: 91 }, (_, degree) =>
  f32(Math.round(Math.sin((degree * Math.PI) / 180) * 1e6) / 1e6),
);
function sin(degree: number) {
  const d = ((degree % 360) + 360) % 360;
  if (d > 270) return -sine[360 - d];
  if (d > 180) return -sine[d - 180];
  if (d > 90) return sine[180 - d];
  return sine[d];
}
/** Installed age*182 (UInt16) then angle-to-integer-degrees lookup. */
export function shrapnelRotation(
  age: number,
  axis: THREE.Vector3,
  shear1: number,
  shear2: number,
) {
  clock(age);
  const { x, y, z } = stored(axis.clone());
  const degree = Math.trunc(((age * 182) & 0xffff) * (360 / 65536));
  const s = sin(degree),
    c = sin(degree + 90),
    t = f32(1 - c);
  const xy = f32(t * x * y),
    xz = f32(t * x * z),
    yz = f32(t * y * z);
  const sx = f32(x * s),
    sy = f32(y * s),
    sz = f32(z * s);
  const rotation = new THREE.Matrix4().set(
    f32(x * x * t + c),
    f32(xy - sz),
    f32(xz + sy),
    0,
    f32(xy + sz),
    f32(y * y * t + c),
    f32(yz - sx),
    0,
    f32(xz - sy),
    f32(yz + sx),
    f32(z * z * t + c),
    0,
    0,
    0,
    0,
    1,
  );
  // BRender pre-multiplies its row-vector matrix: Three uses R * shear.
  const shear = new THREE.Matrix4().set(
    1,
    0,
    0,
    0,
    scalar(shear1),
    1,
    0,
    0,
    scalar(shear2),
    0,
    1,
    0,
    0,
    0,
    0,
    1,
  );
  rotation.multiply(shear);
  for (let i = 0; i < 16; i++)
    rotation.elements[i] = scalar(rotation.elements[i]);
  return rotation;
}

/** Native 30-fragment pool; borrowed original materials, owned geometry clones. */
export class ShrapnelSystem {
  readonly group = new THREE.Group();
  readonly diagnostics: string[] = [];
  private readonly records: Fragment[] = [];
  private readonly empty = new THREE.MeshBasicMaterial();
  private readonly models: [THREE.BufferGeometry, THREE.BufferGeometry];
  private readonly random: () => number;
  private cursor = 0;
  private created = 0;
  private overwritten = 0;
  private draws = 0;
  private disposed = false;
  constructor(private readonly options: ShrapnelOptions) {
    this.random = options.random ?? sharedNativeRandom.random;
    this.group.name = "C2 shrapnel";
    this.models = [0, 1].map(
      (i) =>
        options.models?.[i].clone().scale(0.5, 0.5, 0.5) ??
        new THREE.BufferGeometry(),
    ) as [THREE.BufferGeometry, THREE.BufferGeometry];
    if (!options.models)
      this.diagnose("Original FRAG4.DAT/FRAG5.DAT geometry unavailable");
    for (let id = 0; id < 30; id++) {
      const mesh = new THREE.Mesh(this.models[id % 2], this.empty);
      mesh.name = `C2 shrapnel ${id}`;
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      this.group.add(mesh);
      const shear1 = f32(this.between(-2, 2)),
        shear2 = f32(this.between(-2, 2));
      const z = f32(this.between(-1, 1)),
        y = f32(this.between(-1, 1)),
        x = f32(this.between(-1, 1));
      const axis = new THREE.Vector3(x, y, z),
        length = axis.length();
      if (length <= 2 ** -22) axis.set(1, 0, 0);
      else stored(axis.divideScalar(length));
      this.records.push({
        active: false,
        age: 0,
        sync: 0,
        velocity: new THREE.Vector3(),
        axis,
        shear1,
        shear2,
        mesh,
      });
    }
  }
  private diagnose(message: string) {
    if (!this.diagnostics.includes(message) && this.diagnostics.length < 32)
      this.diagnostics.push(message);
  }
  private sample(random = this.random) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("Invalid native shrapnel RNG sample");
    this.draws++;
    return Math.floor(value * 32768) / 32768;
  }
  private between(a: number, b: number, random = this.random) {
    return a + (b - a) * this.sample(random);
  }
  private integer(low: number, high: number, random: () => number) {
    return low + Math.trunc((high + 1 - low) * this.sample(random));
  }
  /** Direct adapter for SparkSystem's verified native outlet argument packet. */
  spawnFromSpark(request: SparkShrapnelRequest) {
    return this.spawn({
      position: request.position,
      velocity: request.velocity,
      normal: request.normal,
      forceLength: request.forceLength,
      cars: [request.trailingArguments[0], request.trailingArguments[1]],
      random: request.random,
    });
  }
  spawn(source: ShrapnelSource) {
    const ids: number[] = [];
    if (this.disposed) return ids;
    const force = scalar(source.forceLength),
      normal = stored(source.normal.clone());
    const position = stored(source.position.clone()),
      velocity = stored(source.velocity.clone());
    const sync = clock(source.timeSyncMs ?? this.options.timeSyncMs?.() ?? 0);
    if (source.materials && source.materials.length === 0)
      throw new Error("Empty native shrapnel material array");
    if (force < 10) return ids;
    const random = source.random ?? this.random;
    const lift = f32(source.materials ? 0.7 : 0.3) - Math.min(0, velocity.y);
    const base = stored(
      velocity
        .clone()
        .add(new THREE.Vector3(0, lift, 0))
        .addScaledVector(normal, -normal.y * lift),
    );
    const count = Math.min(20, 12 * Math.trunc(force * f32(0.1)));
    const amplitude = scalar((force + 20) * f32(3) * f32(0.005));
    const yLow = scalar(0.3 - base.y);
    for (let n = 0; n < count; n++) {
      const z = f32(this.between(-amplitude, amplitude, random));
      const y = f32(this.between(yLow, amplitude, random));
      const x = f32(this.between(-amplitude, amplitude, random));
      const scatter = new THREE.Vector3(x, y, z);
      stored(scatter.addScaledVector(normal, -normal.dot(scatter)));
      stored(scatter.add(base));
      let material: THREE.Material | undefined;
      if (source.materials)
        material =
          source.materials[
            this.integer(0, source.materials.length - 1, random)
          ];
      else if (this.integer(0, 2, random) === 0)
        material = this.options.blackMaterial;
      else {
        const car = source.cars[this.integer(0, 1, random) ? 0 : 1];
        const materials = car ? this.options.carMaterials(car) : [];
        // Missing provider still consumes the source's one material-choice draw.
        const sample = this.sample(random);
        if (materials.length)
          material = materials[Math.trunc(materials.length * sample)];
      }
      if (!material)
        this.diagnose("Original shrapnel material provider unavailable");
      const id = this.cursor,
        record = this.records[id];
      if (record.active) this.overwritten++;
      record.active = true;
      record.age = 0;
      record.sync = sync;
      record.velocity.copy(scatter);
      record.material = material;
      record.mesh.material = material ?? this.empty;
      record.mesh.matrix.setPosition(position);
      record.mesh.matrixWorldNeedsUpdate = true;
      record.mesh.visible = !!material && !!this.options.models;
      this.cursor = (id + 1) % 30;
      this.created++;
      ids.push(id);
    }
    return ids;
  }
  update(timeMs: number, framePeriodMs: number) {
    clock(timeMs);
    clock(framePeriodMs);
    if (this.disposed) return;
    for (const record of this.records) {
      if (!record.active) continue;
      if (record.age === -1) {
        record.active = false;
        record.mesh.visible = false;
        continue;
      }
      const position = new THREE.Vector3().setFromMatrixPosition(
        record.mesh.matrix,
      );
      stored(
        position.addScaledVector(
          record.velocity,
          (record.sync || framePeriodMs) * f32(0.001),
        ),
      );
      if (!record.sync) record.age = (record.age + framePeriodMs) >>> 0;
      record.sync = 0;
      record.velocity.y = scalar(
        record.velocity.y - framePeriodMs * 10 * f32(0.00014492753623188405),
      );
      record.mesh.matrix
        .copy(
          shrapnelRotation(
            record.age,
            record.axis,
            record.shear1,
            record.shear2,
          ),
        )
        .setPosition(position);
      record.mesh.matrixWorldNeedsUpdate = true;
      const drag = Math.max(
        f32(0.1),
        1 -
          record.velocity.length() * f32(1 / 1.4) * framePeriodMs * f32(0.001),
      );
      stored(record.velocity.multiplyScalar(drag));
      if (record.age > 1000) record.age = -1;
    }
  }
  get stats() {
    return {
      active: this.records.filter((r) => r.active).length,
      visible: this.records.filter((r) => r.mesh.visible).length,
      cursor: this.cursor,
      created: this.created,
      overwritten: this.overwritten,
      randomDraws: this.draws,
    };
  }
  snapshot() {
    return {
      ...this.stats,
      records: this.records.map((r, id) => ({
        id,
        active: r.active,
        age: r.age,
        sync: r.sync,
        velocity: r.velocity.clone(),
        axis: r.axis.clone(),
        shear1: r.shear1,
        shear2: r.shear2,
        material: r.material?.name,
        matrix: r.mesh.matrix.toArray(),
        visible: r.mesh.visible,
      })),
    };
  }
  clear() {
    for (const record of this.records) {
      record.active = false;
      record.mesh.visible = false;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
    for (const model of this.models) model.dispose();
    this.empty.dispose();
    this.group.clear();
    this.group.removeFromParent();
  }
}
