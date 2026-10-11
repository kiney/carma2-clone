import { mineRandomInteger } from "./physics/mines";
import { Vector3 } from "three";

/** Enqueue4ee1e7–244 stores starting-step car velocity * double6.9 as F32.
 * Non-car contexts fail its owner/type gate and contribute the zero vector.
 */
export function nativeSmashStartingVelocity(
  startingModelVelocity: Vector3,
  eligibleCar = true,
): Vector3 {
  if (!eligibleCar) return new Vector3();
  const values = startingModelVelocity
    .toArray()
    .map((value) => Math.fround(Math.fround(value) * 6.9));
  if (!values.every(Number.isFinite))
    throw new Error("Invalid native smash starting velocity");
  return new Vector3(...values);
}

/** Installed DoConnotations4ed243–253 chooses one authored sound, not all.
 * Shares the independently reconstructed 15-bit IRandomBetween mapping.
 */
export function chooseSmashSound(
  sounds: readonly number[],
  random = Math.random,
): number | undefined {
  if (
    sounds.length > 10000 ||
    sounds.some((id) => !Number.isInteger(id) || id < 0 || id > 0x7fffffff)
  )
    throw new Error("Invalid smash sound alternatives");
  if (!sounds.length) return undefined;
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
    throw new Error("Invalid smash sound random sample");
  return sounds[mineRandomInteger(() => sample, 0, sounds.length - 1)];
}

/** DoConnotations4ed227 draws fixed-point pitch before the alternative draw
 * at4ed244. Both draws occur for a single alternative; no sound consumes none. */
export function chooseSmashAudio(
  sounds: readonly number[],
  random = Math.random,
): { id: number; playbackRate: number } | undefined {
  // Validate without consuming a random value before sampling native pitch.
  if (
    sounds.length > 10000 ||
    sounds.some((id) => !Number.isInteger(id) || id < 0 || id > 0x7fffffff)
  )
    throw new Error("Invalid smash sound alternatives");
  if (!sounds.length) return undefined;
  const pitchSample = random();
  if (!Number.isFinite(pitchSample) || pitchSample < 0 || pitchSample >= 1)
    throw new Error("Invalid smash sound random sample");
  const pitch = mineRandomInteger(() => pitchSample, 0xe000, 0x12000);
  return {
    id: chooseSmashSound(sounds, random)!,
    playbackRate: pitch / 0x10000,
  };
}
