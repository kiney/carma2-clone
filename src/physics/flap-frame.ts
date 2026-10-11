import { Matrix4, Quaternion, Vector3 } from "three";
import { FLAP_GRAVITY } from "./flap";

const f32 = Math.fround;
const MILLISECONDS_TO_SECONDS = f32(0.001);

/** Installed DoFlapping438100 keeps one process-wide tick and each car's
 * previous raw model velocity. Call in native active-car order, including
 * eligible cars whose attached flaps are currently inactive. */
export class NativeFlapFrame<Identity extends object = object> {
  private tick = 0;
  private readonly velocities = new WeakMap<Identity, Vector3>();

  get previousTick(): number {
    return this.tick;
  }

  /** Returns force in the current car frame. The zero-period return is a
   * browser guard: native divides by zero and permits IEEE temporaries.
   * It still captures velocity/tick, preserving the shared-clock quirk.
   * A new identity starts with zero saved velocity; prime inactive cars before
   * activation, as the ordinary installed path does. */
  sample(
    identity: Identity,
    tickMs: number,
    rawVelocity: Vector3,
    orientation: Quaternion,
    gravity = FLAP_GRAVITY,
  ): Vector3 | undefined {
    if (!identity || typeof identity !== "object")
      throw new Error("Flap identity must be an object");
    if (!Number.isInteger(tickMs) || tickMs < 0 || tickMs > 0xffffffff)
      throw new Error("Flap physics tick must be a uint32 timestamp");
    const velocity = new Vector3(
      f32(rawVelocity.x),
      f32(rawVelocity.y),
      f32(rawVelocity.z),
    );
    if (!velocity.toArray().every(Number.isFinite))
      throw new Error("Flap velocity must contain finite Float32 values");
    if (
      !orientation.toArray().every(Number.isFinite) ||
      !Number.isFinite(orientation.lengthSq()) ||
      orientation.lengthSq() === 0
    )
      throw new Error("Flap orientation must be finite and nonzero");
    const battyGravity = f32(gravity);
    if (!Number.isFinite(battyGravity))
      throw new Error("Flap gravity must be a finite Float32 value");

    const previous = this.velocities.get(identity) ?? new Vector3();
    const seconds = f32(((tickMs - this.tick) >>> 0) * MILLISECONDS_TO_SECONDS);
    this.velocities.set(identity, velocity);
    this.tick = tickMs;
    if (seconds === 0) return;

    // X/Y differences are stored before division; Z remains in the x87
    // register until its acceleration store. Each gravity addition stores F32.
    const x = f32(f32(f32(velocity.x - previous.x) / seconds) + 0);
    const y = f32(f32(f32(velocity.y - previous.y) / seconds) + battyGravity);
    const z = f32(f32((velocity.z - previous.z) / seconds) + 0);
    const matrix = new Matrix4().makeRotationFromQuaternion(orientation);
    const m = matrix.elements.map(f32);
    // BrMatrix34TApplyV532cd0: dot each car-axis world vector with force,
    // adding the Z/Y products before X, then storing the result as Float32.
    const force = new Vector3(
      f32(z * m[2] + y * m[1] + x * m[0]),
      f32(z * m[6] + y * m[5] + x * m[4]),
      f32(z * m[10] + y * m[9] + x * m[8]),
    );
    // Finite source values can overflow F32 during acceleration/rotation.
    // Keep those temporaries out of persistent browser actor transforms.
    return force.toArray().every(Number.isFinite) ? force : undefined;
  }
}

/** Native clock lifetime is process-wide: race/disposal must not reset it. */
export const sharedNativeFlapFrame = new NativeFlapFrame();
