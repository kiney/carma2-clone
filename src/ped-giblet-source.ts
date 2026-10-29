/** Installed DoGiblets/DoSpurt fragment factories and sphere-clumped placement.
 * The host owns actual models and GetNextShrapnel admission; no private pool. */
import { Matrix4, Vector3 } from "three";
import type { PedVector } from "./ped-form";
import type { SmashInitialPosition, SmashInitialSpeed } from "./world-smash";
import { nativeShrapnelMovement } from "./shrapnel-movement";

export interface NativePedGibletCrt {
  nextInteger(): number;
  seed(value: number): void;
}
export interface NativePedGibletModel {
  name: string;
  scale: number;
  color: number;
  indexedColor?: number;
  /** Reader's Float32 argument to ScaleModel, separate from legacy metadata. */
  nativeScale?: number;
}
export interface NativePedGibletSize {
  minForce: number;
  instanceForce: number;
  maxCount: number;
  models: readonly NativePedGibletModel[];
  flags?: number;
}
export interface NativePedGibletSpec {
  position: SmashInitialPosition;
  speed: SmashInitialSpeed;
  lifetimeMs: readonly [number, number];
}
export interface NativePedGibletPiece<Model> {
  model: Model;
  matrix: Matrix4;
  velocity: Vector3;
  spin: Vector3;
  visibleMs: number;
  maximumMs: number;
}
export interface NativePedGibletFactoryHost<Model> {
  crt: NativePedGibletCrt;
  /** Resource availability is preflighted by the owning runtime. */
  model(sizeIndex: number, modelIndex: number): Model;
  /** The callback must run only after successful actual shared-pool admission. */
  reserve(priority: 1 | 2, produce: () => NativePedGibletPiece<Model>): boolean;
}
export interface NativePedGibletFactoryResult {
  created: number;
  poolFull: number;
  randomDraws: number;
}
const f = Math.fround;
const epsilon = 2 ** -22;
function scalar(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(f(value)))
    throw new Error("Native pedestrian giblets require finite Float32 inputs");
  return f(value);
}
function vector(value: PedVector): Vector3 {
  if (value.length !== 3) throw new Error("Invalid pedestrian giblet vector");
  return new Vector3(...value.map(scalar));
}
function stored(value: Vector3): Vector3 {
  return new Vector3(f(value.x), f(value.y), f(value.z));
}
function normalize(value: Vector3): Vector3 {
  const length = value.length();
  return length > epsilon
    ? stored(value.multiplyScalar(1 / length))
    : new Vector3(1, 0, 0);
}
/** Rotation consumes six SFRand1 draws, followed by three offset direction
 * draws and one radius draw. A source-degenerate offset is diagnosed; a guessed
 * direction would change both placement and the authored size factor. */
export function nativePedSphereClumpedPlacement(
  point: PedVector,
  radius0: number,
  next: () => number,
): { matrix: Matrix4; sizeFactor: number } {
  const radius = scalar(radius0),
    centre = vector(point);
  if (!(radius > 0))
    throw new Error("source-ped-giblet-positive-sphere-radius");
  const draw = () => {
    const value = next();
    if (!Number.isFinite(value) || value < 0 || value >= 1)
      throw new Error("Invalid native pedestrian placement CRT sample");
    return value;
  };
  const signed = () => f(-1 + 2 * draw());
  const a = new Vector3(signed(), signed(), signed());
  const b = normalize(new Vector3(signed(), signed(), signed()));
  const row0 = normalize(stored(a.cross(b)));
  const row1 = stored(b.clone().cross(row0));
  const matrix = new Matrix4();
  if (row1.lengthSq() >= 0.9)
    matrix.set(
      row0.x,
      row1.x,
      b.x,
      0,
      row0.y,
      row1.y,
      b.y,
      0,
      row0.z,
      row1.z,
      b.z,
      0,
      0,
      0,
      0,
      1,
    );
  const direction = new Vector3(signed(), signed(), signed());
  const r = f(radius * draw()),
    length = direction.length();
  if (!(length > 0))
    throw new Error("source-ped-giblet-nonzero-sphere-direction");
  const position = stored(centre.addScaledVector(direction, r / length));
  matrix.setPosition(position);
  return { matrix, sizeFactor: f(r / radius) };
}
function uint(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error(`Invalid native pedestrian giblet ${name}`);
}
export function nativePedGibletSpecRequirements(
  spec: NativePedGibletSpec,
): string[] {
  if (
    !spec ||
    spec.position?.kind !== "sphereclumped" ||
    spec.position.center !== "impact"
  )
    return ["source-native-ped-giblet-sphere-impact-placement"];
  if (!(spec.position.radius > 0) || !Number.isFinite(f(spec.position.radius)))
    return ["source-ped-giblet-positive-sphere-radius"];
  const speed = spec.speed;
  if (
    !speed ||
    !speed.towards ||
    speed.towards.length !== 2 ||
    [
      ...speed.towards,
      speed.impacteeVelocityFactor,
      speed.randomVelocityMax,
      speed.randomUpVelocityMax,
      speed.randomNormalVelocityMax,
      speed.randomSpinRateMax,
    ].some((value) => !Number.isFinite(f(value)))
  )
    return ["source-native-ped-giblet-authored-speed"];
  if (
    !spec.lifetimeMs ||
    spec.lifetimeMs.length !== 2 ||
    spec.lifetimeMs.some(
      (value) => !Number.isInteger(value) || value < 0 || value > 0x7fffffff,
    ) ||
    spec.lifetimeMs[0] > spec.lifetimeMs[1]
  )
    return ["source-native-ped-giblet-authored-lifetime"];
  return [];
}
/** Impact model selection precedes admission, including single-model sizes.
 * Failure skips the rest of that size; the next size still selects a model.
 * Spurt admission has no model-choice draw and stops the whole lump batch.
 * Both factories restore one captured rand OUTPUT, not the prior CRT state. */
export function emitNativePedGiblets<Model>(
  input: {
    kind: "impact" | "spurt";
    seed: number;
    point: PedVector;
    velocity: PedVector;
    direction: PedVector;
    spec: NativePedGibletSpec;
    sizes: readonly NativePedGibletSize[];
    force: number;
    startSize: number;
    lumpsPerEmission?: number;
  },
  host: NativePedGibletFactoryHost<Model>,
): NativePedGibletFactoryResult {
  uint(input.seed, "seed");
  const requirements = nativePedGibletSpecRequirements(input.spec);
  if (requirements.length) throw new Error(requirements.join(", "));
  if (
    !Number.isInteger(input.startSize) ||
    input.startSize < 0 ||
    input.startSize > 0xffffffff
  )
    throw new Error("Invalid native pedestrian giblet start size");
  const force = scalar(input.force),
    velocity = vector(input.velocity),
    normal = vector(input.direction);
  vector(input.point);
  const result = { created: 0, poolFull: 0, randomDraws: 0 };
  const nextInteger = () => {
    const value = host.crt.nextInteger();
    if (!Number.isInteger(value) || value < 0 || value > 32767)
      throw new Error("Invalid native pedestrian giblet CRT output");
    result.randomDraws++;
    return value;
  };
  const saved = nextInteger();
  host.crt.seed(input.seed);
  try {
    const random = () => nextInteger() / 32768;
    const produce = (model: Model): NativePedGibletPiece<Model> => {
      const placement = nativePedSphereClumpedPlacement(
        input.point,
        (
          input.spec.position as Extract<
            SmashInitialPosition,
            { kind: "sphereclumped" }
          >
        ).radius,
        random,
      );
      const movement = nativeShrapnelMovement({
        speed: input.spec.speed,
        impacteeVelocity: velocity,
        normal,
        sizeFactor: placement.sizeFactor,
        random,
      });
      const [min, max] = input.spec.lifetimeMs;
      return {
        model,
        matrix: placement.matrix,
        ...movement,
        visibleMs: min + Math.trunc((nextInteger() * (max - min + 1)) / 32768),
        maximumMs: max,
      };
    };
    if (input.kind === "spurt") {
      const count = input.lumpsPerEmission;
      if (!Number.isInteger(count) || count! < 0 || count! > 32767)
        throw new Error("Invalid native pedestrian spurt lump count");
      for (let i = 0; i < count!; i++) {
        if (!host.reserve(1, () => produce(host.model(0, 0)))) {
          result.poolFull++;
          break;
        }
        result.created++;
      }
    } else
      for (
        let sizeIndex = input.startSize;
        sizeIndex < input.sizes.length;
        sizeIndex++
      ) {
        const size = input.sizes[sizeIndex];
        const min = scalar(size.minForce),
          perInstance = scalar(size.instanceForce);
        if (
          !(perInstance > 0) ||
          !Number.isInteger(size.maxCount) ||
          size.maxCount < 0 ||
          !size.models.length
        )
          throw new Error("Invalid native pedestrian giblet size");
        const count =
          force < min
            ? 0
            : Math.min(
                size.maxCount,
                Math.trunc((force - min) / perInstance + 1),
              );
        for (let i = 0; i < count; i++) {
          const index = Math.trunc(
            (nextInteger() * size.models.length) / 32768,
          );
          const model = host.model(sizeIndex, index);
          if (!host.reserve(2, () => produce(model))) {
            result.poolFull++;
            break;
          }
          result.created++;
        }
      }
  } finally {
    host.crt.seed(saved);
  }
  return result;
}
