import { Vector3 } from "three";
import type { PedSpawnSpec } from "./pedestrians";

export const PED_POPULATION_CAPACITY = 2000;
/** Installed ReadSettings4cac1b..42: native16 angle, then x87 cosine. The
 * degree multiplier is182f, not65536/360 and not a direct radian conversion. */
export function nativePedSlopeCosine(degrees: number): number {
  const value = Math.fround(degrees);
  if (!Number.isFinite(value) || value < 0 || value >= 90)
    throw new Error("Invalid native pedestrian maximum slope");
  const angle = Math.trunc(value * 182) & 0xffff;
  return Math.fround(Math.cos(angle * 9.587379924285257e-5));
}
const nativeSample = (random: () => number) =>
  Math.max(0, Math.min(0x7fff, Math.floor(random() * 0x8000)));
/** Installed IRandomBetween 0x512f00 and SRandomBetween 0x513000. */
export const pedRandomInteger = (
  random: () => number,
  low: number,
  high: number,
) => low + Math.trunc(Math.imul(nativeSample(random), high + 1 - low) / 0x8000);
export const pedRandomFloat = (
  random: () => number,
  low: number,
  high: number,
) => low + ((high - low) * nativeSample(random)) / 0x8000;
/** SetPedXZDirection 0x4cc1aa..0x4cc245, before vector interpolation. */
export function pedTurnDuration(
  period: number,
  distance: number,
  speed: number,
) {
  return (
    Math.min(0.5, ((period * distance) / speed) * Math.fround(1 / 30)) * 1000
  );
}
export function pedInterpolateDirection(from: number, to: number, t: number) {
  return Math.atan2(
    (1 - t) * Math.sin(from) + t * Math.sin(to),
    (1 - t) * Math.cos(from) + t * Math.cos(to),
  );
}
export enum PedAction {
  Walking = 0,
  Running = 1,
  Panicking = 2,
  Falling = 3,
  GettingUp = 4,
  Impacting = 5,
  Dead = 6,
}
export interface PedMovement {
  minTurnMs: number;
  maxTurnMs: number;
  maxTurnRadians: number;
  /** Native frame period at 30 Hz. Smaller periods produce faster movement. */
  minWalkPeriod: number;
  maxWalkPeriod: number;
}
export interface PedSettings {
  processDistance: number;
  popupDistance: number;
  maxSlopeDegrees: number;
  reach: number;
  avoidDistance: number;
  movements: PedMovement[];
}
const rows = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.split("//")[0].trim())
    .filter(Boolean);
export function parsePedSettings(text: string): PedSettings {
  const general = rows(text);
  const movementMarker = /\/\/\s*MOVEMENT STUFF\b/i.exec(text);
  if (!movementMarker) throw new Error("Missing pedestrian movement settings");
  const motion = rows(
    text.slice(movementMarker.index + movementMarker[0].length),
  );
  let at = 0;
  const number = () => {
    const n = Number(motion[at++]);
    if (!Number.isFinite(n))
      throw new Error("Invalid pedestrian movement settings");
    return n;
  };
  const count = number();
  if (!Number.isInteger(count) || count < 0 || count > 1000)
    throw new Error("Invalid pedestrian movement count");
  const movements = Array.from({ length: count }, () => {
    const minTurnMs = Math.trunc(number() * 1000),
      maxTurnMs = Math.trunc(number() * 1000),
      maxTurnRadians = (number() * Math.PI) / 180;
    const minimumMultiplier = number(),
      maximumMultiplier = number();
    // Zero speed is accepted explicitly for stationary browser fixtures. Original
    // BuildPedestrian also chooses move0 when max_walk_speed_factor is zero.
    return {
      minTurnMs,
      maxTurnMs,
      maxTurnRadians,
      minWalkPeriod: minimumMultiplier
        ? Math.trunc(1000 / (minimumMultiplier * 30))
        : 0,
      maxWalkPeriod: maximumMultiplier
        ? Math.trunc(1000 / (maximumMultiplier * 30))
        : 0,
    };
  });
  const values = general.slice(0, 5).map(Number);
  if (
    values.some((v) => !Number.isFinite(v)) ||
    values[0] <= 0 ||
    values[1] < 0 ||
    values[2] < 0 ||
    values[2] >= 90 ||
    values[3] < 0 ||
    values[4] < values[3] ||
    movements.some(
      (m) =>
        m.minTurnMs < 0 ||
        m.maxTurnMs < m.minTurnMs ||
        m.maxTurnRadians < 0 ||
        m.minWalkPeriod < 0 ||
        m.maxWalkPeriod < 0,
    )
  )
    throw new Error("Invalid pedestrian settings");
  return {
    processDistance: values[0],
    popupDistance: values[1],
    maxSlopeDegrees: values[2],
    reach: values[3],
    avoidDistance: values[4],
    movements,
  };
}
export const DEFAULT_PED_SETTINGS: PedSettings = {
  processDistance: 12,
  popupDistance: 9,
  maxSlopeDegrees: 25,
  reach: 0.5,
  avoidDistance: 4,
  movements: [
    {
      minTurnMs: 2000,
      maxTurnMs: 30000,
      maxTurnRadians: Math.PI,
      minWalkPeriod: Math.trunc(1000 / (0.7 * 30)),
      maxWalkPeriod: Math.trunc(1000 / (1.7 * 30)),
    },
  ],
};
export const pedMaterialKey = (name: string) =>
  name.replace(/\.(mat|dat|act)$/i, "").toLowerCase();
/** SpawnPedsOnFace 0x4d2a80: projected XZ area, /1000, carry per spawn spec. */
export function pedFacePopulation(
  areaXZ: number,
  density: number,
  carry: number,
) {
  const expected =
    density < 0 ? -density : carry + (6.9 * 6.9 * areaXZ * density) / 1000;
  const count = Math.floor(expected);
  return { count, carry: expected - count };
}
/** MakeRandomPointInTriangle excludes the outer tenth of alpha/beta range. */
export function pedTrianglePoint(
  a: Vector3,
  b: Vector3,
  c: Vector3,
  random: () => number,
) {
  let alpha = pedRandomFloat(random, 0.1, 0.9),
    beta = pedRandomFloat(random, 0.1, 0.9);
  if (alpha + beta > 1) {
    alpha = 1 - alpha;
    beta = 1 - beta;
  }
  return a
    .clone()
    .multiplyScalar(1 - alpha - beta)
    .addScaledVector(b, alpha)
    .addScaledVector(c, beta);
}
/** Exclusions are floor boundaries. Exceptions are wall materials ignored by
 * the obstacle scanner; they are NOT permitted-floor overrides (0x4cf860). */
export function pedFloorAllowed(
  spec: PedSpawnSpec,
  material: string,
  running: boolean,
) {
  const match = spec.exclusions.findIndex(
    (name) => pedMaterialKey(name) === pedMaterialKey(material),
  );
  return (
    match < 0 || (running && ((spec.exclusionFlags?.[match] ?? 0) & 0xff) !== 0)
  );
}
export function pedObstacleIgnored(spec: PedSpawnSpec, material: string) {
  return spec.exceptions.some(
    (name) => pedMaterialKey(name) === pedMaterialKey(material),
  );
}
export interface PedThreat {
  position: Vector3;
  yaw: number;
  speed: number;
  velocity?: Vector3;
  /** Native physics object radius_squared, tested as twice this value. */
  radiusSquared?: number;
}
export interface PedThreatPrediction {
  threat: PedThreat;
  corridorSquared: number;
  timeToClosest: number;
}
/** Installed PedScanForObjects 0x4ced30: 5-unit box, XZ relative velocity,
 * line-distance test, positive closest approach within 7*[.8,1.2] seconds. */
export function predictPedThreat(
  position: Vector3,
  velocity: Vector3,
  threats: readonly PedThreat[],
  lookaheadFactor: number,
): PedThreatPrediction | null {
  for (const threat of threats) {
    const dx = threat.position.x - position.x,
      dy = threat.position.y - position.y,
      dz = threat.position.z - position.z;
    if (Math.abs(dx) >= 5 || Math.abs(dy) >= 5 || Math.abs(dz) >= 5) continue;
    const vx =
      (threat.velocity?.x ?? -Math.sin(threat.yaw) * threat.speed) - velocity.x;
    const vz =
      (threat.velocity?.z ?? -Math.cos(threat.yaw) * threat.speed) - velocity.z;
    const v2 = vx * vx + vz * vz;
    if (v2 === 0) continue;
    const cross = vz * dx - vx * dz,
      corridorSquared = (cross * cross) / v2;
    const timeToClosest = -(vx * dx + vz * dz) / v2;
    if (
      corridorSquared < 2 * (threat.radiusSquared ?? 0.34 * 0.34) &&
      timeToClosest >= 0 &&
      timeToClosest < 7 * lookaheadFactor
    )
      return { threat, corridorSquared, timeToClosest };
  }
  return null;
}
