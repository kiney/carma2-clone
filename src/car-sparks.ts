import * as THREE from "three";
import { sharedNativeRandom } from "./native-random";
import type { SparkShrapnelRequest } from "./sparks";

const f32 = Math.fround;

export interface CarSparkParticipant {
  /** Live rigid master actor, without model scale or deformation. */
  actor: THREE.Object3D;
  driver: number;
  /** Native rigid flags bit 0x200000 (SPARKY). */
  sparky?: boolean;
}
export interface CarSparkSource {
  /** World position; native allocator writes owner-local position in place. */
  position: THREE.Vector3;
  /** Secondary rigid world linear velocity; overwritten in primary actor frame. */
  velocity: THREE.Vector3;
  /** Summed primary group force transformed to world and multiplied by 6.9.
   * Overwritten with raw force in the chosen owner's actor frame. */
  force: THREE.Vector3;
  cars: readonly [CarSparkParticipant, CarSparkParticipant];
  timeSyncMs?: number;
}
export interface CarSparkRecord {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  normal: THREE.Vector3;
  car: THREE.Object3D;
  timeSyncMs: number;
  lifetimeMs: 1000;
  colour: 0;
}
export interface CarSparkOptions {
  /** Shared world/car 32-slot native ring; copies record vectors on insertion. */
  allocateNative: (record: CarSparkRecord) => number;
  random?: () => number;
  timeSyncMs?: () => number;
  shrapnelOutlet?: (request: SparkShrapnelRequest) => void;
}

function scalar(value: number) {
  const result = f32(value);
  if (!Number.isFinite(result)) throw new Error("Invalid car spark scalar");
  return result;
}
function stored(v: THREE.Vector3) {
  return v.set(scalar(v.x), scalar(v.y), scalar(v.z));
}
function clock(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error("Invalid car spark clock");
  return value;
}
function transpose(v: THREE.Vector3, matrix: THREE.Matrix4) {
  const e = matrix.elements,
    { x, y, z } = v;
  return stored(
    v.set(
      e[0] * x + e[1] * y + e[2] * z,
      e[4] * x + e[5] * y + e[6] * z,
      e[8] * x + e[9] * y + e[10] * z,
    ),
  );
}
function rigidMatrix(actor: THREE.Object3D) {
  actor.updateWorldMatrix(true, false);
  const matrix = actor.matrixWorld.clone();
  matrix.elements.forEach((value, index) => {
    matrix.elements[index] = scalar(value);
  });
  return matrix;
}

/** Independent installed HW allocator 4f8020. Rendering and slot ownership stay
 * in the same SparkSystem as the world allocator, including live slot overwrite. */
export class CarSparkAllocator {
  readonly diagnostics: string[] = [];
  private readonly random: () => number;
  private randomDraws = 0;
  private created = 0;
  private shrapnelRequests = 0;

  constructor(private readonly options: CarSparkOptions) {
    this.random = options.random ?? sharedNativeRandom.random;
  }
  private diagnose(message: string) {
    if (this.diagnostics.length < 32 && !this.diagnostics.includes(message))
      this.diagnostics.push(message);
  }
  private readonly sample = () => {
    const value = this.random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("Invalid native car spark RNG sample");
    this.randomDraws++;
    return Math.floor(value * 32768) / 32768;
  };
  private between(low: number, high: number) {
    return low + (high - low) * this.sample();
  }
  spawn(source: CarSparkSource) {
    const ids: number[] = [];
    const position = stored(source.position.clone()),
      velocity = stored(source.velocity.clone()),
      force = stored(source.force.clone());
    const sync = clock(source.timeSyncMs ?? this.options.timeSyncMs?.() ?? 0);
    const [primary, secondary] = source.cars;
    if (
      !primary?.actor ||
      !secondary?.actor ||
      !Number.isInteger(primary.driver) ||
      !Number.isInteger(secondary.driver)
    )
      throw new Error("Invalid native car spark participants");
    const length = force.length(),
      magnitude = scalar(length);
    if (length < 10) return { ids, count: 0, shrapnelRequested: false };
    const normal = stored(force.clone().divideScalar(length));
    this.shrapnelRequests++;
    if (this.options.shrapnelOutlet) {
      this.options.shrapnelOutlet({
        nativeAddress: 0x4f8590,
        position: position.clone(),
        velocity: velocity.clone(),
        normal,
        forceLength: magnitude,
        car: primary.actor,
        trailingArguments: [primary.actor, secondary.actor, 0, 0],
        random: this.sample,
      });
    } else {
      this.diagnose(
        "Native shrapnel outlet 4f8590 unavailable: its RNG side effects remain unresolved",
      );
    }
    if (
      !(primary.driver > 5 || primary.sparky) &&
      !(secondary.driver > 5 || secondary.sparky)
    )
      return { ids, count: 0, shrapnelRequested: true };

    const owner = primary.driver === 8 ? primary : secondary;
    const primaryMatrix = rigidMatrix(primary.actor),
      ownerMatrix = rigidMatrix(owner.actor);
    const squaredMagnitude = scalar(magnitude * magnitude);
    const projection = force.dot(velocity) / squaredMagnitude;
    stored(velocity.addScaledVector(force, -projection));
    // Native quirk: primary frame for velocity even when secondary owns sparks.
    transpose(velocity, primaryMatrix);
    stored(
      position.sub(new THREE.Vector3().setFromMatrixPosition(ownerMatrix)),
    );
    transpose(position, ownerMatrix);
    transpose(force, ownerMatrix);
    source.position.copy(position);
    source.velocity.copy(velocity);
    source.force.copy(force);

    const count = Math.min(20, 3 - Math.trunc(magnitude * f32(-0.1)));
    for (let i = 0; i < count; i++) {
      const z = scalar(this.between(-1, 1)),
        y = scalar(this.between(f32(-0.2), 1)),
        x = scalar(this.between(-1, 1));
      const scatter = new THREE.Vector3(x, y, z);
      stored(
        scatter.addScaledVector(force, -force.dot(scatter) / squaredMagnitude),
      );
      stored(scatter.add(velocity));
      const id = this.options.allocateNative({
        position: position.clone(),
        velocity: scatter,
        normal: new THREE.Vector3(),
        car: owner.actor,
        timeSyncMs: sync,
        lifetimeMs: 1000,
        colour: 0,
      });
      if (!Number.isInteger(id) || id < 0 || id >= 32)
        throw new Error("Native shared spark pool returned invalid slot");
      ids.push(id);
      this.created++;
    }
    return { ids, count, shrapnelRequested: true };
  }
  get stats() {
    return {
      created: this.created,
      randomDraws: this.randomDraws,
      shrapnelRequests: this.shrapnelRequests,
      shrapnelOutletProvided: !!this.options.shrapnelOutlet,
      sharesNativePool: true,
    };
  }
}
