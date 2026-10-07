/** Independently implemented C2 crush equations, checked against the supplied HW
 * executable. Coordinates are original model units, in the affected actor's
 * local frame. WORLD_SCALE (6.9) belongs at the physics/render boundary.
 */
export type CrushVector = readonly [number, number, number];
export interface AxisCrushLimits {
  min: readonly number[];
  max: readonly number[];
}
export type CrushLimits = readonly [
  AxisCrushLimits,
  AxisCrushLimits,
  AxisCrushLimits,
];
export interface CrushSettings {
  minForce: number;
  maxForce: number;
  maxDistanceSquared: number;
  forceToMovement: number;
  distortionFactor: number;
}
export const ORIGINAL_CRUSH_SETTINGS: Readonly<CrushSettings> = Object.freeze({
  minForce: 0.06,
  maxForce: 0.5,
  maxDistanceSquared: 0.01,
  forceToMovement: 1.5,
  distortionFactor: 0.0135,
});

/** InitPhysMasterCrushData appends the original collision bounds, then
 * InitVertexData sorts minimum planes descending and maximum planes ascending.
 * Pass the car's master collision bounds, rather than individual part bounds.
 */
export function prepareCrushLimits(
  authored: readonly AxisCrushLimits[],
  bounds: { min: CrushVector; max: CrushVector },
): CrushLimits {
  if (authored.length !== 3) throw new Error("Crush limits require three axes");
  return authored.map((axis, i) => {
    if (axis.min.length > 2 || axis.max.length > 2)
      throw new Error("WAM supports at most two authored planes per side");
    return {
      min: [...axis.min, bounds.min[i] - 0.02898551].sort((a, b) => b - a),
      max: [...axis.max, bounds.max[i] + 0.02898551].sort((a, b) => a - b),
    };
  }) as unknown as CrushLimits;
}

/** Original 0x42b410: final outer plane is a stop, not a classification plane.
 * Each nibble is minIndex | (maxIndex << 2), with X in the lowest nibble.
 * Equality advances the index. The invalid flag is metadata, not a dent filter.
 */
export function classifyCrushVertex(
  position: CrushVector,
  limits: CrushLimits,
) {
  let packed = 0;
  let invalid = true;
  for (let axis = 0; axis < 3; axis++) {
    const planes = limits[axis];
    let minIndex = 0;
    let maxIndex = 0;
    while (maxIndex < planes.max.length - 1) {
      if (position[axis] < planes.max[maxIndex]) {
        invalid = false;
        break;
      }
      maxIndex++;
    }
    while (minIndex < planes.min.length - 1) {
      if (planes.min[minIndex] < position[axis]) {
        invalid = false;
        break;
      }
      minIndex++;
    }
    packed |= (minIndex | (maxIndex << 2)) << (axis * 4);
  }
  return { packed, invalid };
}

/** QueueCarCrush 0x42d350 scales vector length by car softness, rejects forces
 * at or below the minimum, and caps queued force at 10. WAM part softness is
 * applied later, during deformation, rather than during queue admission.
 */
export function queuedCrushForce(
  forceVector: CrushVector,
  carSoftness = 1,
  settings: Readonly<CrushSettings> = ORIGINAL_CRUSH_SETTINGS,
): number {
  const force = Math.hypot(...forceVector) * carSoftness;
  return force > settings.minForce ? Math.min(force, 10) : 0;
}

const subtract = (a: CrushVector, b: CrushVector): [number, number, number] => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const dot = (a: CrushVector, b: CrushVector) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lengthSquared = (a: CrushVector) => dot(a, a);
const clampUnit = (n: number) => Math.max(0, Math.min(1, n));

function segmentDistanceSquared(
  p: CrushVector,
  a: CrushVector,
  b: CrushVector,
) {
  const edge = subtract(b, a);
  const relative = subtract(p, a);
  const denominator = lengthSquared(edge);
  const along =
    denominator > 0 ? clampUnit(dot(relative, edge) / denominator) : 0;
  return lengthSquared([
    relative[0] - along * edge[0],
    relative[1] - along * edge[1],
    relative[2] - along * edge[2],
  ]);
}

function triangleDistanceSquared(
  p: CrushVector,
  a: CrushVector,
  b: CrushVector,
  c: CrushVector,
) {
  const u = subtract(b, a);
  const v = subtract(c, a);
  const relative = subtract(p, a);
  const uu = dot(u, u),
    uv = dot(u, v),
    vv = dot(v, v);
  const determinant = uu * vv - uv * uv;
  if (determinant > 1e-20) {
    const ru = dot(relative, u),
      rv = dot(relative, v);
    const s = (ru * vv - rv * uv) / determinant;
    const t = (rv * uu - ru * uv) / determinant;
    if (s >= 0 && t >= 0 && s + t <= 1) {
      return lengthSquared([
        relative[0] - s * u[0] - t * v[0],
        relative[1] - s * u[1] - t * v[1],
        relative[2] - s * u[2] - t * v[2],
      ]);
    }
  }
  return Math.min(
    segmentDistanceSquared(p, a, b),
    segmentDistanceSquared(p, b, c),
    segmentDistanceSquared(p, c, a),
  );
}

/** Contact primitive distance (0x42c810). Four contacts select the original
 * rectangle routine: the first three define its corner/basis; the fourth is
 * unused. Degenerate edges are treated as points to keep malformed data finite.
 */
export function crushContactDistanceSquared(
  p: CrushVector,
  contacts: readonly CrushVector[],
): number {
  const count = contacts.length;
  if (!count) return 0;
  if (count === 1) return lengthSquared(subtract(p, contacts[0]));
  if (count === 2) return segmentDistanceSquared(p, contacts[0], contacts[1]);
  if (count === 3)
    return triangleDistanceSquared(p, contacts[0], contacts[1], contacts[2]);
  if (count === 4) {
    let origin = contacts[0];
    let u = subtract(contacts[1], origin),
      v = subtract(contacts[2], origin);
    if (Math.abs(dot(u, v)) > 0.001) {
      origin = contacts[1];
      u = subtract(contacts[0], origin);
      v = subtract(contacts[2], origin);
      if (Math.abs(dot(u, v)) > 0.001) {
        origin = contacts[2];
        u = subtract(contacts[0], origin);
        v = subtract(contacts[1], origin);
      }
    }
    const relative = subtract(p, origin);
    const s = lengthSquared(u)
      ? clampUnit(dot(relative, u) / lengthSquared(u))
      : 0;
    const t = lengthSquared(v)
      ? clampUnit(dot(relative, v) / lengthSquared(v))
      : 0;
    return lengthSquared([
      relative[0] - s * u[0] - t * v[0],
      relative[1] - s * u[1] - t * v[1],
      relative[2] - s * u[2] - t * v[2],
    ]);
  }
  let distance = Infinity;
  for (let a = 0; a < count - 2; a++)
    for (let b = a + 1; b < count - 1; b++)
      for (let c = b + 1; c < count; c++)
        distance = Math.min(
          distance,
          triangleDistanceSquared(p, contacts[a], contacts[b], contacts[c]),
        );
  return distance;
}

/** This priority test (0x4367e0) is deliberately different from argmax. */
export function dominantCrushAxis(direction: CrushVector): 0 | 1 | 2 {
  return Math.abs(direction[0]) > 0.707107
    ? 0
    : Math.abs(direction[1]) > 0.707107
      ? 1
      : 2;
}

export interface CrushModelInput {
  positions: { length: number; [index: number]: number };
  vertexRegions: ArrayLike<number>;
  limits: CrushLimits;
  contacts: readonly CrushVector[];
  /** Unit impact direction, transformed into this actor's model frame. */
  direction: CrushVector;
  /** Queued force magnitude: already includes car softness. */
  force: number;
  /** WAM softness: 4, 2, 1, .5, .25 or 0. */
  softness: number;
  meanImpact?: CrushVector;
  settings?: Readonly<CrushSettings>;
}
export interface CrushModelResult {
  maxInfluence: number;
  strongestVertex: number;
  strongestDisplacement: number;
  movedVertices: number;
}

/** SwapShapesIfPossible434910 bit4 projects candidate coordinates sequentially
 * inside the OLD accepted hull. A failed second test/packed limit restores the
 * old accepted point. Plane convention here is outward dot(n,p)<=constant. */
export function constrainCrushVertex(
  point: CrushVector,
  previous: CrushVector,
  planes: readonly { normal: CrushVector; constant: number }[],
  packed: number,
  limits: CrushLimits,
): [number, number, number] {
  const result: [number, number, number] = [...point];
  for (const plane of planes) {
    const distance = dot(result, plane.normal) - plane.constant;
    if (distance > 0)
      for (let axis = 0; axis < 3; axis++)
        result[axis] -= distance * plane.normal[axis];
  }
  if (planes.some((plane) => dot(result, plane.normal) - plane.constant > 1e-5))
    return [...previous];
  for (let axis = 0; axis < 3; axis++) {
    const region = packed >>> (4 * axis);
    if (
      result[axis] < limits[axis].min[region & 3] ||
      result[axis] > limits[axis].max[(region >>> 2) & 3]
    )
      return [...previous];
  }
  return result;
}

/** Already-bent actors use HW42c4a0 instead of packed-region CrushModel.
 * The stop box is the bent collision bounds inset by 15%, saved by BendCar.
 * Only vertices outside that box and moving toward it can move. */
export function crushBentModel(input: {
  positions: { length: number; [index: number]: number };
  contacts: readonly CrushVector[];
  movement: CrushVector;
  stopBounds: { min: CrushVector; max: CrushVector };
}): CrushModelResult {
  const result = {
    maxInfluence: 0,
    strongestVertex: -1,
    strongestDisplacement: 0,
    movedVertices: 0,
  };
  if (!input.contacts.length) return result;
  const magnitude = Math.hypot(...input.movement);
  const unit: CrushVector =
    magnitude > 2.384185791015625e-7
      ? [
          input.movement[0] / magnitude,
          input.movement[1] / magnitude,
          input.movement[2] / magnitude,
        ]
      : [1, 0, 0];
  const axis = dominantCrushAxis(unit);
  const amount = input.movement[axis];
  if (!amount) return result;
  for (let i = 0; i < input.positions.length; i += 3) {
    const point: CrushVector = [
      input.positions[i],
      input.positions[i + 1],
      input.positions[i + 2],
    ];
    const distance = crushContactDistanceSquared(point, input.contacts);
    const influence = distance <= 0.01 ? 1 - Math.sqrt(distance * 100) : 0;
    const stop = Math.min(
      (input.stopBounds.min[axis] - point[axis]) / amount,
      (input.stopBounds.max[axis] - point[axis]) / amount,
    );
    const fraction = stop > 0 ? Math.min(influence, stop) : 0;
    if (influence > result.maxInfluence) {
      result.maxInfluence = influence;
      result.strongestVertex = i / 3;
      result.strongestDisplacement = magnitude * fraction;
    }
    if (!fraction) continue;
    for (let component = 0; component < 3; component++)
      input.positions[i + component] += input.movement[component] * fraction;
    result.movedVertices++;
  }
  return result;
}

/** CrushModel 0x432ad0: distances use CURRENT positions, but eligibility and
 * stop planes use the original packed regions. No global displacement cap,
 * squared falloff, per-coordinate clipping or hinge-index exclusion occurs.
 */
export function crushModel(input: CrushModelInput): CrushModelResult {
  const { positions, vertexRegions, limits, direction } = input;
  const settings = input.settings ?? ORIGINAL_CRUSH_SETTINGS;
  const contacts = input.contacts.slice(0, 4);
  const count = positions.length / 3;
  if (!Number.isInteger(count) || vertexRegions.length !== count)
    throw new Error("Crush vertex positions and regions must match");
  const result: CrushModelResult = {
    maxInfluence: 0,
    strongestVertex: 0,
    strongestDisplacement: 0,
    movedVertices: 0,
  };
  if (!contacts.length || !(settings.maxDistanceSquared > 0)) return result;
  const axis = dominantCrushAxis(direction);
  const positive = direction[axis] > 0;
  const side = positive ? limits[axis].max : limits[axis].min;
  const mean =
    input.meanImpact ??
    ([0, 1, 2].map(
      (i) =>
        contacts.reduce((sum, point) => sum + point[i], 0) / contacts.length,
    ) as unknown as CrushVector);
  // The original keeps zero when none of the planes satisfies this test.
  const found = side.findIndex((plane) =>
    positive ? plane > mean[axis] : plane < mean[axis],
  );
  const impactRegion = found < 0 ? 0 : found;
  const movement =
    (Math.min(input.force, settings.maxForce) / contacts.length) *
    input.softness *
    settings.forceToMovement;
  const weights = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const offset = i * 3;
    const point: CrushVector = [
      positions[offset],
      positions[offset + 1],
      positions[offset + 2],
    ];
    const distance = crushContactDistanceSquared(point, contacts);
    const weight =
      distance <= settings.maxDistanceSquared
        ? 1 - Math.sqrt(distance / settings.maxDistanceSquared)
        : 0;
    weights[i] = weight;
    if (weight > result.maxInfluence) {
      result.maxInfluence = weight;
      result.strongestVertex = i;
    }
  }
  if (!movement || !result.maxInfluence || !direction[axis]) return result;
  for (let i = 0; i < count; i++) {
    if (!weights[i]) continue;
    const offset = i * 3;
    const region = (vertexRegions[i] >>> (axis * 4 + (positive ? 2 : 0))) & 3;
    let amount = weights[i] * movement;
    if (region > impactRegion) amount = 0;
    else {
      const cap = (side[region] - positions[offset + axis]) / direction[axis];
      amount = cap < 0 ? 0 : Math.min(amount, cap);
    }
    if (amount > 0) {
      for (let j = 0; j < 3; j++)
        positions[offset + j] += direction[j] * amount;
      result.movedVertices++;
    }
    if (i === result.strongestVertex) result.strongestDisplacement = amount;
  }
  return result;
}

/** Per-impact texture damage magnitude (0x431d70), not accumulated energy. */
export function crushSmashMagnitude(
  force: number,
  softness: number,
  contactCount: number,
  centroid: CrushVector,
  meanImpact: CrushVector,
  settings: Readonly<CrushSettings> = ORIGINAL_CRUSH_SETTINGS,
): number {
  if (contactCount <= 0) return 0;
  return (
    ((Math.min(force, settings.maxForce) / contactCount) *
      softness *
      settings.distortionFactor) /
    Math.sqrt(
      Math.max(lengthSquared(subtract(centroid, meanImpact)), 0.0014492754),
    )
  );
}
