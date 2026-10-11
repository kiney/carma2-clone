import { Box3, Matrix4, Vector3 } from "three";

const ANGLE_SCALE = 65536 / (2 * Math.PI);
const unsigned = (angle: number) => angle & 0xffff;
const bendQuant = 0xe38;

export interface StructuralSettings {
  minimumForce: number;
  bendingChance: number;
  inverseBucklePercent: number;
  battyGravity: number;
  damageMinimum: number;
  damageMaximum: number;
}

export const DEFAULT_STRUCTURAL_SETTINGS: Readonly<StructuralSettings> = {
  minimumForce: 2.5,
  bendingChance: 30,
  inverseBucklePercent: 0,
  battyGravity: 1.44,
  damageMinimum: 10,
  damageMaximum: 40,
};

/** These authored GENERAL fields are stored as native floats by429c0f–50. */
export function parseStructuralSettings(text: string): StructuralSettings {
  const read = (name: string): number => {
    const line = text
      .split(/\r?\n/)
      .find((line) =>
        new RegExp(`\\b${name}\\b`, "i").test(line.split("//")[1] ?? ""),
      );
    const value = Number(line?.split("//")[0].trim());
    if (
      !line ||
      !Number.isFinite(value) ||
      !Number.isFinite(Math.fround(value))
    )
      throw new Error(`GENERAL.TXT: missing or invalid ${name}`);
    return Math.fround(value);
  };
  const settings = {
    minimumForce: read("gMin_bend_force"),
    bendingChance: read("gChance_of_bending"),
    inverseBucklePercent: read("gChance_of_inverse_buckle"),
    battyGravity: read("gBatty_gravity"),
    damageMinimum: Math.trunc(read("gMin_bend_damage")),
    damageMaximum: Math.trunc(read("gMax_bend_damage")),
  };
  if (
    settings.minimumForce <= 0 ||
    settings.damageMinimum < 0 ||
    settings.damageMaximum < settings.damageMinimum
  )
    throw new Error("GENERAL.TXT: invalid structural force or damage range");
  return settings;
}
/** Common original515e70/515f50 packing used by repair and transition-bend
 * references. The expand reciprocal is stored as a Float32 in the binary. */
export function compressedModelCoordinate(value: number): number {
  const code = Math.trunc(
    ((Math.max(-10, Math.min(10, value)) + 10) * 65535) / 20 + 0.5,
  );
  return Math.fround(code * 20 * Math.fround(1 / 65535) - 10);
}
/** Source4358b0 saves CAR-local transition points before adding bend offsets. */
export function compressedBendReference(point: Vector3): Vector3 {
  return new Vector3(
    ...point
      .toArray()
      .map((value) => compressedModelCoordinate(Math.fround(value))),
  );
}
const quantize = (angle: number, minimum: number, maximum: number) => {
  angle = unsigned(angle);
  if (angle < 0x7ff8 && angle > maximum) return maximum;
  if (angle > 0x7ff8 && angle < minimum) return minimum;
  return bendQuant * Math.floor(angle / bendQuant);
};

export interface BendTransform {
  bounds: Box3;
  pivot: Vector3;
  farZ: number;
  angleXUnits: number;
  angleYUnits: number;
  rotation: Matrix4;
  front: boolean;
  coefficients: readonly [Vector3, Vector3, Vector3, Vector3];
}
export interface StructuralImpact {
  mean: Vector3;
  direction: Vector3;
  force: number;
  bendability: number;
  bendZMin: number;
  bendZMax: number;
  bounds: Box3;
  human: boolean;
  raceIndex?: number;
  raceCount?: number;
  random?: () => number;
  seedRandom?: (seed: number) => void;
  physicsTickMs?: number;
  minimumForce?: number;
  bendingChance?: number;
  alreadyBent?: boolean;
}

/** Installed DoCrushing4360c0 marks an event; it does not bend geometry.
 * The probability is consumed even for a car already bent in an earlier frame.
 * Both a successful and a failed structural choice suppress ordinary crush. */
export function selectStructuralBranch(input: StructuralImpact): {
  skipOrdinary: boolean;
  markedForBend: boolean;
} {
  const minimumForce = Math.fround(input.minimumForce ?? 2.5);
  const raceRatio = (input.raceIndex ?? 0) / Math.max(1, input.raceCount ?? 1);
  const opponentFactor = 1 - (1 - raceRatio) * 99 * -0.05;
  const amount =
    Math.fround(input.force) *
    Math.fround(input.bendability) *
    (input.human ? 1 : opponentFactor);
  if (!(amount > minimumForce))
    return { skipOrdinary: false, markedForBend: false };
  const random = input.random ?? Math.random;
  const chance = Math.trunc(Math.fround(input.bendingChance ?? 30));
  const markedForBend = chance !== 0 && Math.floor(random() * 100) < chance;
  return { skipOrdinary: true, markedForBend };
}

/** DoBending4389e0 resolves marked events against live post-crush bounds.
 * Eligibility and the initial probability were evaluated in another phase. */
export function createStructuralBend(
  input: StructuralImpact,
): BendTransform | undefined {
  const minimumForce = Math.fround(input.minimumForce ?? 2.5);
  const random = input.random ?? Math.random;
  let rear: boolean;
  const pivot = new Vector3();
  let farZ: number;
  if (input.mean.z > input.bendZMax) {
    rear = true;
    pivot.z = input.bendZMax;
    farZ = input.bounds.min.z;
  } else if (input.mean.z < input.bendZMin) {
    rear = false;
    pivot.z = input.bendZMin;
    farZ = input.bounds.max.z;
  } else return;
  let angleX = 0,
    angleY = 0;
  const direction = input.direction;
  // Source tests Z then X against sqrt(.5); the final branch uses Y.
  if (Math.abs(direction.z) > Math.fround(0.707107)) {
    input.seedRandom?.((input.physicsTickMs ?? 0) >>> 0);
    const upper = Math.floor(random() * 100) < 50;
    pivot.y = upper ? input.bounds.max.y : input.bounds.min.y;
    const sign = upper === rear ? 1 : -1;
    angleX = Math.trunc(
      Math.atan2(sign * Math.abs(direction.z) * input.force, minimumForce) *
        ANGLE_SCALE,
    );
  } else if (Math.abs(direction.x) > Math.fround(0.707107)) {
    const negative = direction.x < 0;
    pivot.x = negative ? input.bounds.max.x : input.bounds.min.x;
    const sign = negative === rear ? 1 : -1;
    angleY = Math.trunc(
      Math.atan2(sign * Math.abs(direction.x) * input.force, minimumForce) *
        ANGLE_SCALE,
    );
  } else {
    const negative = direction.y < 0;
    pivot.y = negative ? input.bounds.max.y : input.bounds.min.y;
    const sign = negative === rear ? 1 : -1;
    angleX = Math.trunc(
      Math.atan2(sign * Math.abs(direction.y) * input.force, minimumForce) *
        ANGLE_SCALE,
    );
  }
  angleX = quantize(angleX, 0xce3c, 0x31c4);
  angleY = quantize(angleY, 0xdc74, 0x238c);
  return createBendTransform(input.bounds, pivot, farZ, angleX, angleY);
}

/** Synchronous adapter for explicit standalone impact tools. Production
 * separates these phases through the simulation's retained crush records. */
export function selectStructuralBend(input: StructuralImpact): {
  skipOrdinary: boolean;
  bend?: BendTransform;
} {
  const branch = selectStructuralBranch(input);
  return {
    skipOrdinary: branch.skipOrdinary,
    bend:
      branch.markedForBend && !input.alreadyBent
        ? createStructuralBend(input)
        : undefined,
  };
}

/** HW setup0x4354a0 stores four bend-plane corner displacements as bilinear
 * coefficients. The opposite end remains fixed; beyond the bend plane the
 * whole end rotates rigidly. */
export function createBendTransform(
  bounds: Box3,
  pivot: Vector3,
  farZ: number,
  angleXUnits: number,
  angleYUnits: number,
): BendTransform {
  // BRender post-rotates Y then X: row-vector convention reverses Three order.
  const rotation = new Matrix4()
    .makeTranslation(pivot.x, pivot.y, pivot.z)
    .multiply(new Matrix4().makeRotationX(angleXUnits / ANGLE_SCALE))
    .multiply(new Matrix4().makeRotationY(angleYUnits / ANGLE_SCALE))
    .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z));
  const displacement = (x: number, y: number) => {
    const point = new Vector3(x, y, pivot.z);
    return point.clone().applyMatrix4(rotation).sub(point);
  };
  const upperRight = displacement(bounds.max.x, bounds.max.y);
  const lowerRight = displacement(bounds.max.x, bounds.min.y);
  const upperLeft = displacement(bounds.min.x, bounds.max.y);
  const lowerLeft = displacement(bounds.min.x, bounds.min.y);
  return {
    bounds: bounds.clone(),
    pivot: pivot.clone(),
    farZ,
    angleXUnits,
    angleYUnits,
    rotation,
    front: pivot.z < farZ,
    coefficients: [
      upperRight.sub(lowerRight).sub(upperLeft).add(lowerLeft),
      lowerRight.sub(lowerLeft),
      upperLeft.sub(lowerLeft),
      lowerLeft,
    ],
  };
}

export function bendPoint(point: Vector3, bend: BendTransform): Vector3 {
  const beyond = bend.front ? point.z <= bend.pivot.z : point.z >= bend.pivot.z;
  if (beyond) return point.clone().applyMatrix4(bend.rotation);
  const inside = bend.front ? point.z <= bend.farZ : point.z >= bend.farZ;
  if (!inside) return point.clone();
  const size = bend.bounds.getSize(new Vector3());
  const x = size.x ? (point.x - bend.bounds.min.x) / size.x : 0;
  const y = size.y ? (point.y - bend.bounds.min.y) / size.y : 0;
  const depth = bend.pivot.z - bend.farZ;
  const z = depth ? (point.z - bend.farZ) / depth : 0;
  const [xy, linearX, linearY, base] = bend.coefficients;
  return point
    .clone()
    .addScaledVector(base, z)
    .addScaledVector(linearX, x * z)
    .addScaledVector(linearY, y * z)
    .addScaledVector(xy, x * y * z);
}

/** HW435060 inserts up to eight authored edge crossings at the bend plane
 * before applying the piecewise bend, keeping the hull's kink represented. */
export function bendHullVertices(
  vertices: readonly Vector3[],
  edges: readonly (readonly [number, number])[],
  bend: BendTransform,
): Vector3[] {
  const augmented = vertices.map((point) => point.clone());
  let inserted = 0;
  for (const [a, b] of edges) {
    const first = vertices[a],
      second = vertices[b];
    const da = first.z - bend.pivot.z,
      db = second.z - bend.pivot.z;
    if (da * db >= 0 || Math.abs(da) < 0.02898551 || Math.abs(db) < 0.02898551)
      continue;
    const point = first
      .clone()
      .lerp(second, (bend.pivot.z - first.z) / (second.z - first.z));
    augmented.push(point);
    if (++inserted === 8) break;
  }
  return augmented.map((point) => bendPoint(point, bend));
}

/** Structural repair439b20 uses eight angle units per millisecond, with
 * component repair accounting R=sum(delta angles)/65536, D=2*sum angles/65536. */
export function stepBendRepair(bend: BendTransform, dtMs: number) {
  const step = Math.max(0, Math.trunc(dtMs * 8));
  const signed = (value: number) =>
    value < 0x7ff8 ? value : -unsigned(-value);
  const x = signed(bend.angleXUnits),
    y = signed(bend.angleYUnits);
  const dx = -Math.sign(x) * Math.min(Math.abs(x), step);
  const dy = -Math.sign(y) * Math.min(Math.abs(y), step);
  const next = createBendTransform(
    bend.bounds,
    bend.pivot,
    bend.farZ,
    unsigned(x + dx),
    unsigned(y + dy),
  );
  return {
    next,
    totalDeflection: (2 * (Math.abs(x) + Math.abs(y))) / 65536,
    bodyworkRepair: (Math.abs(dx) + Math.abs(dy)) / 65536,
    complete: next.angleXUnits === 0 && next.angleYUnits === 0,
  };
}

/** Front bend435260/repair43a970: signed yaw degrees times .03. */
export function bendSteeringCurvature(bend: BendTransform | undefined): number {
  if (!bend?.front) return 0;
  let degrees = ((bend.angleYUnits & 0xffff) * 360) / 65536;
  if (degrees >= 180) degrees -= 360;
  return degrees * 0.03;
}
