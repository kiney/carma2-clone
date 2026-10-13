import { Box3, Matrix4, Quaternion, Vector3 } from "three";
import type { RigidBody } from "./contact";

type Vec3 = [number, number, number];
export interface SpecialVolume {
  boundary:
    | { kind: "box"; matrixRows: [Vec3, Vec3, Vec3, Vec3] }
    | { kind: "plane"; normal: Vec3; distance: number }
    | { kind: "default" };
  gravityMultiplier: number;
  viscosityMultiplier: number;
  carDamagePerMs: number;
  pedDamagePerMs: number;
  cameraEffectIndex: number;
  skyColor: number;
  screenMaterial: string;
  entryNoise: number;
  exitNoise: number;
  engineNoiseIndex: number;
  materialModifierIndex: number;
  sound?: {
    type: "SATURATED" | "SCATTERED";
    periodicity: "NONE" | "RANDOM" | "PERIODIC" | "CONTINUOUS";
    periodMs: number[];
    volume: number;
    alternatives: number[];
  };
}
export interface SpecialVolumeConfig {
  volumes: SpecialVolume[];
  defaultWater: SpecialVolume | null;
  defaultEngineNoiseIndex: number;
  diagnostics: string[];
}
interface DataLine {
  value: string;
  line: number;
}
const clean = (line: string) => line.replace(/\/\/.*$/, "").trim();
const command = (value: string) => value.trim().split(/\s+/)[0].toUpperCase();
const boundaries = new Set(["BOX", "PLANE", "DEFAULT", "NEW"]);
function dataLines(text: string): DataLine[] {
  return text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((value, line) => ({ value: clean(value), line }))
    .filter(({ value }) => value.length > 0);
}
class Cursor {
  constructor(
    public lines: DataLine[],
    public index: number,
  ) {}
  string() {
    const row = this.lines[this.index++];
    if (!row) throw new Error("Unexpected end of special-volume data");
    return row.value;
  }
  numbers(count: number) {
    const value = this.string();
    const numbers = value.split(/[\s,]+/).map(Number);
    if (numbers.length !== count || numbers.some((v) => !Number.isFinite(v)))
      throw new Error(
        `Expected ${count} numbers at line ${this.lines[this.index - 1].line + 1}`,
      );
    return numbers;
  }
  number() {
    return this.numbers(1)[0];
  }
  integer() {
    // Original GetAnInt reads an integer prefix (sscanf %d). Stock Carrier
    // sky colour rows contain "0,0,0" and intentionally yield integer zero.
    const value = this.string();
    const match = /^[+-]?\d+/.exec(value);
    const n = match ? Number(match[0]) : NaN;
    if (!Number.isSafeInteger(n))
      throw new Error("Expected integer in special-volume data");
    return n;
  }
}
/** ParseSpecialVolume, installed HW 0x4ff670; the eleven shared data rows. */
function readParameters(
  cursor: Cursor,
  boundary: SpecialVolume["boundary"],
  allowNegativeGravity = false,
): SpecialVolume {
  const gravity = cursor.number();
  return {
    boundary,
    gravityMultiplier: gravity < 0 && !allowNegativeGravity ? 1 : gravity,
    viscosityMultiplier: cursor.number(),
    carDamagePerMs: cursor.number(),
    pedDamagePerMs: cursor.number(),
    cameraEffectIndex: cursor.integer(),
    skyColor: cursor.integer(),
    screenMaterial: cursor.string(),
    entryNoise: cursor.integer(),
    exitNoise: cursor.integer(),
    engineNoiseIndex: cursor.integer(),
    materialModifierIndex: cursor.integer(),
  };
}
function readSound(cursor: Cursor, volume: SpecialVolume) {
  const type = command(cursor.string());
  if (type === "NONE") return;
  if (type !== "SATURATED" && type !== "SCATTERED")
    throw new Error(`Unknown volume sound type ${type}`);
  const periodicity = command(cursor.string());
  if (!["NONE", "RANDOM", "PERIODIC", "CONTINUOUS"].includes(periodicity))
    throw new Error(`Unknown volume sound periodicity ${periodicity}`);
  const periodMs =
    periodicity === "RANDOM"
      ? cursor.numbers(2).map((v) => Math.trunc(v * 1000))
      : periodicity === "PERIODIC"
        ? [Math.trunc(cursor.number() * 1000)]
        : [];
  const sound: NonNullable<SpecialVolume["sound"]> = {
    type,
    periodicity: periodicity as NonNullable<
      SpecialVolume["sound"]
    >["periodicity"],
    periodMs,
    volume: 0,
    alternatives: [],
  };
  if (periodicity !== "NONE") {
    sound.volume = cursor.integer();
    const count = cursor.integer();
    if (count < 0 || count > 5)
      throw new Error("Volume sound requires zero to five alternatives");
    for (let i = 0; i < count; i++) sound.alternatives.push(cursor.integer());
  }
  volume.sound = sound;
}
/** ReadSpecialVolumes, installed HW 0x4ffb20. NEW becomes BOX, but its
 * original command index is retained to omit the BOX sound-spec rows.
 * Options.startLine addresses a count row when a larger parser owns the cursor.
 */
export function parseTrackSpecialVolumes(
  text: string,
  options: { startLine?: number; allowNegativeGravity?: boolean } = {},
): SpecialVolumeConfig {
  const result: SpecialVolumeConfig = {
    volumes: [],
    defaultWater: null,
    defaultEngineNoiseIndex: 0,
    diagnostics: [],
  };
  const raw = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const lines = dataLines(text);
  let countIndex = -1;
  if (options.startLine !== undefined)
    countIndex = lines.findIndex((row) => row.line >= options.startLine!);
  else {
    const inline = raw.findIndex((row) =>
      /\/\/\s*#\s*special\s+(?:effects\s+)?volumes/i.test(row),
    );
    const marker = raw.findIndex((row) =>
      /^\s*\/\/\s*SPECIAL\s+(?:EFFECTS\s+)?VOLUMES/i.test(row),
    );
    const location = inline >= 0 ? inline : marker;
    if (location >= 0)
      countIndex = lines.findIndex((row) => row.line >= location);
    // Comment-free tracks: a valid count immediately precedes the first boundary.
    else {
      const boundaryIndex = lines.findIndex((row) =>
        boundaries.has(command(row.value)),
      );
      if (boundaryIndex > 0 && /^\d+$/.test(lines[boundaryIndex - 1].value))
        countIndex = boundaryIndex - 1;
    }
  }
  if (countIndex < 0) return result;
  const engineIndex = countIndex - 1;
  if (engineIndex >= 0 && /^\d+$/.test(lines[engineIndex].value))
    result.defaultEngineNoiseIndex = Number(lines[engineIndex].value);
  const cursor = new Cursor(lines, countIndex);
  try {
    const count = cursor.integer();
    if (count < 0 || count > 10000)
      throw new Error("Invalid special-volume count");
    for (let i = 0; i < count; i++) {
      const type = command(cursor.string());
      let boundary: SpecialVolume["boundary"];
      if (type === "BOX" || type === "NEW") {
        const matrixRows = Array.from(
          { length: 4 },
          () => cursor.numbers(3) as Vec3,
        ) as [Vec3, Vec3, Vec3, Vec3];
        boundary = { kind: "box", matrixRows };
        if (boxMatrix(boundary).determinant() === 0)
          throw new Error(`Singular special-volume box ${i}`);
      } else if (type === "PLANE") {
        const [x, y, z, distance] = cursor.numbers(4);
        boundary = { kind: "plane", normal: [x, y, z], distance };
      } else if (type === "DEFAULT") boundary = { kind: "default" };
      else throw new Error(`Unknown special-volume boundary ${type}`);
      const volume = readParameters(
        cursor,
        boundary,
        options.allowNegativeGravity,
      );
      if (type === "BOX" || type === "PLANE") readSound(cursor, volume);
      result.volumes.push(volume);
      if (type === "DEFAULT") result.defaultWater = volume;
    }
  } catch (error) {
    result.diagnostics.push(
      error instanceof Error ? error.message : String(error),
    );
  }
  return result;
}
/** GENERAL's underwater default uses the same eleven parameters, without sound. */
export function parseDefaultWaterVolume(text: string): SpecialVolume | null {
  const raw = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const marker = raw.findIndex((row) =>
    /default\s+underwater\s+special\s+volume\s+parameters/i.test(row),
  );
  if (marker < 0) return null;
  const lines = dataLines(text);
  const index = lines.findIndex((row) => row.line > marker);
  if (index < 0) return null;
  try {
    return readParameters(new Cursor(lines, index), { kind: "default" });
  } catch {
    return null;
  }
}
function boxMatrix(
  boundary: Extract<SpecialVolume["boundary"], { kind: "box" }>,
) {
  const [x, y, z, p] = boundary.matrixRows;
  // BRender's matrix rows are basis vectors; Three stores them as columns.
  return new Matrix4().set(
    x[0],
    y[0],
    z[0],
    p[0],
    x[1],
    y[1],
    z[1],
    p[1],
    x[2],
    y[2],
    z[2],
    p[2],
    0,
    0,
    0,
    1,
  );
}
/** FindSpecialVolume, installed HW 0x4feeb0: first containing volume wins.
 * DEFAULT entries affect automatic water only. Plane boundaries are strict.
 */
export function containsSpecialVolume(
  volume: SpecialVolume,
  point: Vector3,
): boolean {
  const boundary = volume.boundary;
  if (boundary.kind === "default") return false;
  if (boundary.kind === "plane")
    return point.dot(new Vector3(...boundary.normal)) < boundary.distance;
  const matrix = boxMatrix(boundary);
  const broad = new Box3(
    new Vector3(-1, -1, -1),
    new Vector3(1, 1, 1),
  ).applyMatrix4(matrix);
  if (
    !(
      point.x > broad.min.x &&
      point.x < broad.max.x &&
      point.y > broad.min.y &&
      point.y < broad.max.y &&
      point.z > broad.min.z &&
      point.z < broad.max.z
    )
  )
    return false;
  const local = point.clone().applyMatrix4(matrix.invert());
  return (
    Math.abs(local.x) <= 1 && Math.abs(local.y) <= 1 && Math.abs(local.z) <= 1
  );
}
export function findSpecialVolume(
  volumes: readonly SpecialVolume[],
  point: Vector3,
): SpecialVolume | null {
  return volumes.find((volume) => containsSpecialVolume(volume, point)) ?? null;
}
export const NO_WATER_DISTANCE = 10000;
export interface WaterPlane {
  normal: Vector3;
  distance: number;
}
/** TestAutoSpecialVolume 0x4ff360 projects oriented bb2 onto the water normal;
 * the 0.001 fully-submerged tolerance belongs to that binary, not C1.
 */
export function projectWaterDepth(
  bounds: { min: Vector3; max: Vector3 },
  position: Vector3,
  orientation: Quaternion,
  plane: WaterPlane,
) {
  const axes = [
    new Vector3(1, 0, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, 0, 1),
  ].map((axis) => axis.applyQuaternion(orientation).dot(plane.normal));
  let minimum = position.dot(plane.normal);
  let maximum = minimum;
  for (let i = 0; i < 3; i++) {
    const a = axes[i] * bounds.min.getComponent(i),
      b = axes[i] * bounds.max.getComponent(i);
    minimum += Math.min(a, b);
    maximum += Math.max(a, b);
  }
  const submerged = plane.distance > minimum;
  const depth =
    !submerged || plane.distance >= maximum - 0.001
      ? 1
      : Math.fround((plane.distance - minimum) / (maximum - minimum));
  return { depth, submerged, minimum, maximum };
}
/** MungeSpecialVolume 0x4ff1a0 gives auto water precedence over neutral gravity. */
export function selectSpecialVolume(
  authored: SpecialVolume | null,
  automatic: SpecialVolume | null,
  waterDistance: number,
  depth: number,
) {
  if (automatic && (!authored || authored.gravityMultiplier === 1)) {
    if (waterDistance === NO_WATER_DISTANCE && depth !== 1) automatic = null;
    else return { volume: automatic, automatic };
  }
  return { volume: authored, automatic };
}
/** WheelForces 0x418870 and AddDrag 0x415f10. Drag scales the ordinary
 * dt*0.0005 coefficient; ability uses the executable's double constant0.6.
 */
export function volumeMotionFactors(
  volume: SpecialVolume | null,
  depth = 1,
  underwaterAbility = false,
) {
  if (!volume) return { gravity: 1, drag: 1, materialModifierIndex: 0 };
  const ability = underwaterAbility ? 0.6 : 1;
  return {
    gravity: 1 - (1 - volume.gravityMultiplier) * depth * ability,
    drag: volume.viscosityMultiplier * depth * ability,
    materialModifierIndex: volume.materialModifierIndex,
  };
}
/** Generic PHIL forces, installed gravity4b6c60/drag4b6a80. Detached
 * objects use multiplicative gravity (9.8), whereas WheelForces interpolates
 * car gravity (10). Floating/level-out objects have a separate native path. */
export function applyGenericVolumeForces(
  body: RigidBody,
  volume: SpecialVolume | null,
  depth: number,
  dt: number,
  extraWaterTransitionDrag = false,
  globalGravityMultiplier = 1,
) {
  if (!(dt > 0 && Number.isFinite(dt)))
    throw new Error("Invalid volume force timestep");
  if (!Number.isFinite(globalGravityMultiplier))
    throw new Error("Invalid global gravity");
  const gravity =
    (volume ? volume.gravityMultiplier * depth : 1) * globalGravityMultiplier;
  const gravityIncrement = new Vector3(
    0,
    Math.fround(-(9.8 / 6.9) * gravity * dt),
    0,
  );
  body.state.velocity.y -= (9.8 / 6.9) * gravity * dt;
  const viscosity = volume ? volume.viscosityMultiplier * depth : 1;
  const dragPass = () => {
    const k = dt * 0.0005000000237487257 * viscosity;
    body.state.velocity.multiplyScalar(
      Math.max(
        0,
        1 - (body.state.velocity.length() * k * 6.9) / body.properties.mass,
      ),
    );
    const inverse = body.state.orientation.clone().invert();
    const omega = body.state.angularVelocity.clone().applyQuaternion(inverse);
    const length = omega.length();
    for (let axis = 0; axis < 3; axis++) {
      const inertia = body.properties.inertia.getComponent(axis);
      omega.setComponent(
        axis,
        omega.getComponent(axis) *
          Math.max(0, 1 - (length * k) / (inertia * 47.61000061035156)),
      );
    }
    body.state.angularVelocity.copy(
      omega.applyQuaternion(body.state.orientation),
    );
  };
  dragPass();
  if (extraWaterTransitionDrag) dragPass();
  return gravityIncrement;
}
export interface WaterSurface {
  a: Vector3;
  normal: Vector3;
  material: string;
}
export const NATIVE_WATER_NORMAL_Y_MINIMUM = Math.fround(0.9);
/** Installed HW water update0x414930 consumes the last collected '!' face,
 * accepts abs(normal.y)>Float32(.9), points the normal up, and stores n dot
 * vertex0 as Float32. The caller supplies finite emitted faces, in order;
 * rejected last faces never cause a search for an earlier valid plane.
 */
export function detectWaterPlane(
  surfaces: readonly WaterSurface[],
): WaterPlane | null {
  let last: WaterSurface | undefined;
  for (const surface of surfaces)
    if (surface.material.startsWith("!")) last = surface;
  if (!last) return null;
  const normal = last.normal.clone();
  normal.set(
    Math.fround(normal.x),
    Math.fround(normal.y),
    Math.fround(normal.z),
  );
  if (Math.abs(normal.y) <= NATIVE_WATER_NORMAL_Y_MINIMUM) return null;
  if (normal.y < 0) normal.negate();
  const point = last.a.clone();
  point.set(Math.fround(point.x), Math.fround(point.y), Math.fround(point.z));
  return { normal, distance: Math.fround(normal.dot(point)) };
}
