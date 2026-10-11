import { Matrix4, Vector3 } from "three";
import { sharedNativeRandom } from "../native-random";
import type { SmokePuffSource } from "../smoke";
import type { SurfaceModifier } from "./surfaces";

const f32 = Math.fround;
const SCALE = f32(6.9);
const INV_SCALE = f32(1 / 6.9);

function scalar(value: number): number {
  const result = f32(value);
  if (!Number.isFinite(result)) throw new Error("Invalid native tyre scalar");
  return result;
}
function stored(value: Vector3): Vector3 {
  return value.set(scalar(value.x), scalar(value.y), scalar(value.z));
}
function randomInteger(
  random: () => number,
  low: number,
  high: number,
): number {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
    throw new Error("Invalid native tyre RNG sample");
  return (
    low + Math.floor(((high + 1 - low) * Math.floor(sample * 32768)) / 32768)
  );
}

export interface NativeTyreAxleInput {
  axle: 0 | 1;
  demand: number;
  capacities: readonly [number, number];
  reduction: number;
}
export interface NativeTyreSmokeSelection {
  wheel: number;
  quotient: number;
}

/** Installed rear 0x41ad5a–0x41af2a/front 0x41b1f0–0x41b3ce. This caller gate differs
 * from skid marks: the random wheel choice runs even below the 20/60 threshold.
 * Call rear before front, at their force-allocation phases, not after motion. */
export function selectNativeTyreSmokeWheel(
  input: NativeTyreAxleInput,
  random: () => number = sharedNativeRandom.random,
): NativeTyreSmokeSelection | undefined {
  if (input.axle !== 0 && input.axle !== 1)
    throw new Error("Invalid native tyre axle");
  const demand = scalar(input.demand),
    first = scalar(input.capacities[0]),
    second = scalar(input.capacities[1]),
    reduction = scalar(input.reduction);
  if (Math.min(demand, first, second, reduction) < 0)
    throw new Error("Invalid negative native tyre capacity");
  const base = input.axle * 2;
  if (demand > first && demand > second) {
    const quotient = f32(
      (demand + demand - first - second) / f32(first + second),
    );
    const chosen = randomInteger(random, 0, 1) ? 0 : 1;
    if ([first, second][chosen] <= 0.1) return;
    return { wheel: base + chosen, quotient };
  }
  if (demand > first) {
    const residual = f32(demand - f32(reduction * first) + demand);
    if (residual > second && second > 0.1)
      return { wheel: base + 1, quotient: f32((residual - second) / second) };
  } else if (demand > second) {
    const residual = f32(demand - f32(reduction * second) + demand);
    if (residual > first && first > 0.1)
      return { wheel: base, quotient: f32((residual - first) / first) };
  }
}

export interface NativeTyreSmokeInput<Owner extends object = object>
  extends NativeTyreSmokeSelection {
  owner: Owner;
  driver: number;
  modifier: Pick<SurfaceModifier, "tyreSound" | "smokeType">;
  /** Source wpos storage uses physics coordinates, already 6.9-scaled. */
  wheelPositionPhysics: Vector3;
  /** Source oldd was overwritten with this call's current wheel length at
   * 0x419274, before tyre allocation. Do not pass the prior spring sample. */
  oldSuspensionDistance: number;
  /** Actual mechanics-phase ACT: orthonormal basis and physics translation.
   * A browser actor origin must be multiplied by 6.9 for this translation;
   * its graphics matrix cannot be passed unchanged. No COM subtraction. */
  actorPhysicsMatrix: Matrix4;
  omegaBody: Vector3;
  /** Raw body-local velocity: 0x41c0bf–0x41c0fd multiplies it by Float32(6.9).
   * Motion's already-scaled force-allocation velocity cannot be passed as-is. */
  velocityCarSpace: Vector3;
  /** Source car+1348: normalized aggregate local wheel-support normal. */
  supportNormalBody: Vector3;
  /** Source car+13cc retained S3 world velocity, not a newly inferred value. */
  cachedSoundVelocity: Vector3;
  timeSyncMs: number;
}

export interface NativeTyreSqueal<Owner extends object = object> {
  owner: Owner;
  channel: 0 | 1;
  position: Vector3;
  velocity: Vector3;
  soundId: number;
  volume: number;
  pitch: number;
  repeats: 1;
  speed: 65536;
}
export interface NativeTyreEffectsOptions<Owner extends object> {
  random?: () => number;
  isPlaying: (tag: number) => boolean;
  startSound: (source: NativeTyreSqueal<Owner>) => number;
  stopSound: (tag: number) => void;
}
export interface NativeTyreEffectsResult<Owner extends object = object> {
  channel: 0 | 1;
  admitted: boolean;
  sound?: NativeTyreSqueal<Owner>;
  puff?: SmokePuffSource;
}

function transform(value: Vector3, matrix: Matrix4, point: boolean): Vector3 {
  if (!matrix.elements.every(Number.isFinite))
    throw new Error("Invalid native tyre ACT");
  const e = matrix.elements;
  return stored(
    new Vector3(
      e[0] * value.x + e[4] * value.y + e[8] * value.z + (point ? e[12] : 0),
      e[1] * value.x + e[5] * value.y + e[9] * value.z + (point ? e[13] : 0),
      e[2] * value.x + e[6] * value.y + e[10] * value.z + (point ? e[14] : 0),
    ),
  );
}

/** Installed 0x41bef0–0x41c1c1. Keep one instance for the process-wide two-channel
 * voice table, not one per car/wheel/frame. Audio callbacks are synchronous
 * source outlets, preserving their position before the optional puff outlet. */
export class NativeTyreEffects<Owner extends object = object> {
  private voices: Array<{ tag: number; owner?: Owner; volume: number }> = [
    { tag: 0, volume: 0 },
    { tag: 0, volume: 0 },
  ];
  private random: () => number;

  constructor(private options: NativeTyreEffectsOptions<Owner>) {
    this.random = options.random ?? sharedNativeRandom.random;
  }
  selectAxle(input: NativeTyreAxleInput) {
    return selectNativeTyreSmokeWheel(input, this.random);
  }
  get channels() {
    return this.voices.map((voice) => ({ ...voice }));
  }
  /** Native StopSkid/0x41b908 preserve the owner/tag after stopping playback. */
  stopOwner(owner: Owner): void {
    for (const voice of this.voices)
      if (voice.owner === owner) this.options.stopSound(voice.tag);
  }
  produce(input: NativeTyreSmokeInput<Owner>): NativeTyreEffectsResult<Owner> {
    // This draw precedes BOTH rejected strength and material gates.
    const channel = randomInteger(this.random, 0, 1) as 0 | 1;
    const result: NativeTyreEffectsResult<Owner> = { channel, admitted: false };
    const quotient = scalar(input.quotient);
    if (quotient < 5 || input.modifier.tyreSound === -1) return result;
    if (randomInteger(this.random, 0, 4) !== 0) return result;
    if (!Number.isInteger(input.wheel) || input.wheel < 0 || input.wheel > 3)
      throw new Error("Invalid native tyre wheel");
    if (!Number.isInteger(input.driver))
      throw new Error("Invalid native tyre driver");
    const wheelPoint = stored(input.wheelPositionPhysics.clone());
    wheelPoint.y = f32(wheelPoint.y - scalar(input.oldSuspensionDistance));
    const position = stored(
      transform(wheelPoint, input.actorPhysicsMatrix, true).multiplyScalar(
        INV_SCALE,
      ),
    );
    const voice = this.voices[channel];
    const scaledVolume = quotient * 10;
    voice.volume =
      scaledVolume >= 2147483648 ? -2147483648 : Math.trunc(scaledVolume);
    result.admitted = true;
    if (
      !this.options.isPlaying(voice.tag) ||
      (input.driver === 8 && voice.owner !== input.owner)
    ) {
      const pitch = randomInteger(this.random, 49152, 81920);
      const soundId = 9000 + randomInteger(this.random, 0, 4);
      result.sound = {
        owner: input.owner,
        channel,
        position: position.clone(),
        velocity: stored(input.cachedSoundVelocity.clone()),
        soundId,
        volume: voice.volume,
        pitch,
        repeats: 1,
        speed: 65536,
      };
      const tag = this.options.startSound(result.sound);
      if (!Number.isInteger(tag))
        throw new Error("Invalid native tyre sound tag");
      voice.tag = tag;
      voice.owner = input.owner;
    }
    if (input.modifier.smokeType !== 1) return result;
    const omega = stored(input.omegaBody.clone()),
      velocity = stored(input.velocityCarSpace.clone()),
      normal = stored(input.supportNormalBody.clone());
    const tangent = stored(omega.cross(wheelPoint));
    tangent.x = f32(tangent.x + velocity.x * SCALE);
    tangent.y = f32(tangent.y + f32(velocity.y * SCALE));
    tangent.z = f32(tangent.z + velocity.z * SCALE);
    const normalSpeed = f32(-normal.dot(tangent));
    stored(tangent.addScaledVector(normal, normalSpeed));
    result.puff = {
      position,
      velocity: transform(tangent, input.actorPhysicsMatrix, false),
      strength: f32(quotient * f32(0.04)),
      decay: 1,
      type: 4,
      timeSyncMs: input.timeSyncMs,
    };
    return result;
  }
}
