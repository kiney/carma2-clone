import { Vector3 } from "three";
import { sharedNativeRandom } from "./native-random";
import type { SmashInitialSpeed } from "./world-smash";

export interface NativeShrapnelMovementInput {
  /** Authored values: the reader's Float32 .1 spin conversion occurs here. */
  speed: SmashInitialSpeed;
  /** Captured starting-step metric velocity, already multiplied by double6.9. */
  impacteeVelocity: Vector3;
  normal: Vector3;
  /** Explicit placement/geometry result from the caller; not inferred here. */
  sizeFactor: number;
  towardsPosition?: Vector3 | null;
  piecePosition?: Vector3 | null;
  random?: () => number;
}

export interface NativeShrapnelMovement {
  /** Native fragment metric velocity. Noncar physics callers divide by6.9. */
  velocity: Vector3;
  /** Native fragment spin. Noncar physics callers additionally multiply2pi. */
  spin: Vector3;
}

const f32 = Math.fround;
const EPSILON = f32(2 ** -22);

function scalar(value: number): number {
  const stored = f32(value);
  if (!Number.isFinite(stored))
    throw new Error("Invalid native shrapnel-movement scalar");
  return stored;
}

function vector(value: Vector3): Vector3 {
  if (!value || typeof value.toArray !== "function")
    throw new Error("Missing native shrapnel-movement vector provider");
  return new Vector3(scalar(value.x), scalar(value.y), scalar(value.z));
}

function normalized(value: Vector3): Vector3 {
  const length = value.length();
  if (!(length > EPSILON)) return new Vector3(1, 0, 0);
  return vector(value.clone().multiplyScalar(1 / length));
}

/** Independent port of installed ApplyInitialMovement4eaef0–4eb206.
 * This routine does not position/rotate an ACT: those operations belong to
 * 4eb210/4eb410. It consumes all thirteen base CRT draws, including zero
 * ranges, and three further towards draws only when both endpoint pointers exist
 * and both speed bounds are nonzero. Source callers own their rand/srand sequence;
 * this helper never seeds or restores the stream. Float32 stores are explicit;
 * JavaScript live arithmetic is not claimed to reproduce every x87 boundary. */
export function nativeShrapnelMovement(
  input: NativeShrapnelMovementInput,
): NativeShrapnelMovement {
  const authored = input.speed;
  if (!authored || !authored.towards || authored.towards.length !== 2)
    throw new Error("Missing native shrapnel-movement authored speed");
  const minimum = scalar(authored.towards[0]);
  const maximum = scalar(authored.towards[1]);
  const impacteeFactor = scalar(authored.impacteeVelocityFactor);
  const randomVelocity = scalar(authored.randomVelocityMax);
  const randomUp = scalar(authored.randomUpVelocityMax);
  const randomNormal = scalar(authored.randomNormalVelocityMax);
  const preparedSpin = scalar(scalar(authored.randomSpinRateMax) * f32(0.1));
  const factor = scalar(input.sizeFactor);
  const incoming = vector(input.impacteeVelocity);
  const normal = normalized(vector(input.normal));
  const towards = input.towardsPosition ? vector(input.towardsPosition) : null;
  const piece = input.piecePosition ? vector(input.piecePosition) : null;
  const random = input.random ?? sharedNativeRandom.random;
  if (typeof random !== "function")
    throw new Error("Missing native shrapnel-movement random provider");
  // Installed512f90/512fc0 use the shared 15-bit sample, including equal bounds.
  const between = (a: number, b: number): number => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("Invalid native shrapnel-movement random sample");
    return a + (b - a) * (Math.floor(value * 32768) / 32768);
  };
  const velocity = vector(incoming.multiplyScalar(impacteeFactor));
  if (towards && piece && minimum !== 0 && maximum !== 0) {
    const delta = vector(towards.sub(piece));
    const distance = scalar(delta.length());
    if (distance === 0)
      throw new Error("Native shrapnel towards endpoints have zero separation");
    // Each component samples independently; this is not one radial speed.
    for (let axis = 0; axis < 3; axis++) {
      const live =
        (between(minimum, maximum) / distance) * delta.getComponent(axis);
      // X/Y reload their spills; Z's FST keeps the live value through its add.
      const component = axis === 2 ? live : scalar(live);
      velocity.setComponent(
        axis,
        scalar(velocity.getComponent(axis) + component),
      );
    }
  }
  const axis = new Vector3();
  // Source interleaves velocity X, spin-axis X, then Y and Z (4eb01c–49).
  for (let component = 0; component < 3; component++) {
    velocity.setComponent(
      component,
      scalar(
        (velocity.getComponent(component) +
          between(-randomVelocity, randomVelocity)) *
          factor,
      ),
    );
    axis.setComponent(component, scalar(between(0, 1)));
  }
  velocity.y = scalar(velocity.y + between(0, randomUp));
  // Normal zero selects positive X, while every component still consumes RNG.
  for (let component = 0; component < 3; component++) {
    const live = normal.getComponent(component) * between(0, randomNormal);
    // Installed4eb0fb/4eb10d spill X/Y; 4eb122 FST leaves Z live for4eb133.
    const contribution = component === 2 ? live : scalar(live);
    velocity.setComponent(
      component,
      scalar(velocity.getComponent(component) + contribution),
    );
  }
  const spin = normalized(axis);
  const spinBound = scalar(factor * preparedSpin);
  for (let component = 0; component < 3; component++)
    spin.setComponent(
      component,
      scalar(spin.getComponent(component) * between(-spinBound, spinBound)),
    );
  return { velocity, spin };
}
