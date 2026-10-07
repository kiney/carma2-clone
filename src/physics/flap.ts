import { Vector3 } from "three";

/** BRender angles wrap through 65536 units. The original quarter turn is
 * deliberately four units below pi/2. */
export const FLAP_QUARTER_TURN = 0x3ffc;
export const FLAP_INERTIA_FACTOR = 0.02;
export const FLAP_GRAVITY = 1.44;
const ANGLE_SCALE = 65536 / (2 * Math.PI);
const unsigned = (value: number) => value & 0xffff;
const unit = (vector: Vector3) =>
  vector.length() > 2.384185791015625e-7
    ? vector.normalize()
    : vector.set(1, 0, 0);

export interface FlapState {
  active: boolean;
  angleUnits: number;
  minAngleUnits: number;
  maxAngleUnits: number;
  spanUnits: number;
  plastic: boolean;
  plasticOffset: number;
  plasticLimit: number;
  buckled: boolean;
}
export function createFlapState(hinge1: Vector3, hinge2: Vector3): FlapState {
  return {
    active: false,
    angleUnits: 0,
    minAngleUnits: 0,
    maxAngleUnits: FLAP_QUARTER_TURN,
    spanUnits: FLAP_QUARTER_TURN,
    plastic: true,
    plasticOffset: 0,
    plasticLimit: hinge1.distanceTo(hinge2) * 0.5,
    buckled: false,
  };
}
export function flapAngleRadians(state: FlapState): number {
  return state.angleUnits / ANGLE_SCALE;
}
export function flapBasis(
  points: readonly Vector3[],
  hinges: readonly number[],
) {
  const origin = points[hinges[0]];
  const second = points[hinges[1]];
  const third = points[hinges[2]];
  if (!origin || !second || !third)
    throw new Error("Flap hinge index is outside authored vertices");
  const axis = unit(second.clone().sub(origin));
  const radial = unit(third.clone().sub(origin));
  const normal = unit(axis.clone().cross(radial));
  const inward = unit(
    axis.clone().multiplyScalar(axis.dot(radial)).sub(radial),
  );
  return { origin, axis, radial, normal, inward };
}

/** Original setup0x42b930 swaps the first two hinges so the panel opens away
 * from the car COM, unless kev flag bit1 preserves the authored ordering. */
export function orderFlapHinges(
  points: readonly Vector3[],
  indices: readonly number[],
  centerOfMass: Vector3,
  kevFlags = 0,
): number[] {
  const hinges = [...indices];
  const { origin, axis, radial } = flapBasis(points, hinges);
  const min = points[0].clone(),
    max = min.clone();
  for (const point of points) {
    min.min(point);
    max.max(point);
  }
  const center = min.add(max).multiplyScalar(0.5).sub(centerOfMass);
  if (!(kevFlags & 2) && center.dot(radial.clone().cross(axis)) > 0)
    [hinges[0], hinges[1]] = [hinges[1], hinges[0]];
  return hinges;
}

/** Original mark2 vertices: finite hinge-line distance and outward half-plane. */
export function flapCheckVertices(
  points: readonly Vector3[],
  hinges: readonly number[],
): Uint8Array {
  const { origin, axis, normal } = flapBasis(points, hinges);
  const hingeLength = origin.distanceTo(points[hinges[1]]);
  return Uint8Array.from(points, (point) => {
    const delta = point.clone().sub(origin);
    const perpendicular = delta
      .clone()
      .addScaledVector(
        axis,
        -Math.min(hingeLength, Math.max(0, delta.dot(axis))),
      );
    return Number(
      perpendicular.lengthSq() > 0.00021004 && delta.dot(normal) > -0.001449275,
    );
  });
}

export function clampFlapAngle(state: FlapState, candidate: number): number {
  candidate = unsigned(candidate);
  if (unsigned(candidate - state.minAngleUnits) > state.spanUnits)
    candidate =
      unsigned(candidate - state.maxAngleUnits) < FLAP_QUARTER_TURN
        ? state.maxAngleUnits
        : state.minAngleUnits;
  return unsigned(candidate);
}

/** HW FlapBit0x438410. There is no added angular-velocity spring or damping.
 * Force already includes car acceleration and Batty gravity in the car frame. */
export function stepFlapAngle(
  state: FlapState,
  hingeAxis: Vector3,
  radialInCar: Vector3,
  forceInCar: Vector3,
  partMass: number,
  inertiaFactor = FLAP_INERTIA_FACTOR,
): boolean {
  if (!state.active) return false;
  const torque = radialInCar.clone().cross(hingeAxis).dot(forceInCar);
  const increment = Math.trunc(
    Math.atan2(torque * inertiaFactor, partMass) * ANGLE_SCALE,
  );
  if (!increment) return false;
  const previous = state.angleUnits;
  state.angleUnits = clampFlapAngle(state, previous + increment);
  return state.angleUnits !== previous;
}

export interface PlasticFlapInput {
  points: Vector3[];
  hinges: readonly number[];
  checkVertices: Uint8Array;
  direction: Vector3;
  strongestVertex: number;
  displacement: number;
  /** Saved parent hinge2 reference transformed into the current actor frame. */
  parentReference: Vector3;
  random?: () => number;
  inverseBucklePercent?: number;
}

/** Independently derived plastic-panel callback0x432120: buckle along the
 * hinge plane normal, recompute permissible hinge angle range, and activate. */
export function applyPlasticFlap(state: FlapState, input: PlasticFlapInput) {
  const unchanged = { movedVertices: 0, activated: false, angleChanged: false };
  if (!state.plastic || input.displacement <= 0) return unchanged;
  const { origin, inward, normal } = flapBasis(input.points, input.hinges);
  const alignment = input.direction.dot(inward);
  const strongest = input.points[input.strongestVertex];
  if (!(alignment > 0.2) || !strongest) return unchanged;
  const lever = inward.dot(origin.clone().sub(strongest)) / alignment;
  if (!(lever > 0)) return unchanged;
  const reference = input.parentReference.clone().sub(origin);
  const denominator = -inward.dot(reference);
  const referenceAngle =
    denominator === 0
      ? 0
      : Math.trunc(
          Math.atan2(normal.dot(reference), denominator) * ANGLE_SCALE,
        );
  let offset = Math.sqrt((lever + input.displacement) ** 2 - lever ** 2) * 0.5;
  const random = input.random ?? Math.random;
  if (
    (input.inverseBucklePercent ?? 0) > 0 &&
    Math.floor(random() * 100) < Math.trunc(input.inverseBucklePercent!)
  )
    offset = -offset;
  state.plasticOffset += offset;
  const excess = Math.abs(state.plasticOffset) - state.plasticLimit;
  if (excess > 0) {
    state.plastic = false;
    offset += offset > 0 ? -excess : excess;
  }
  const taper = (0.3 + 0.4 * random()) * lever;
  const strongestPosition = strongest.clone();
  let minVertexAngle = 0xc004,
    maxVertexAngle = FLAP_QUARTER_TURN;
  let movedVertices = 0;
  for (let i = 0; i < input.points.length; i++) {
    const point = input.points[i];
    const depth = input.direction.dot(point.clone().sub(strongestPosition));
    if (depth > 0) {
      let movement = 0;
      const remainder = depth - taper;
      if (remainder <= 0) movement = (depth * offset) / taper;
      else {
        const localLever = inward.dot(origin.clone().sub(point)) / alignment;
        if (localLever > 0 && localLever + remainder !== 0)
          movement = (localLever * offset) / (localLever + remainder);
      }
      if (movement) {
        point.addScaledVector(normal, movement);
        movedVertices++;
      }
    }
    if (!input.checkVertices[i]) continue;
    const delta = point.clone().sub(origin);
    const denominator = -inward.dot(delta);
    if (denominator === 0) continue;
    const angle = unsigned(
      Math.trunc(Math.atan2(normal.dot(delta), denominator) * ANGLE_SCALE),
    );
    if (unsigned(angle - minVertexAngle) < 0x7ff8) minVertexAngle = angle;
    if (unsigned(maxVertexAngle - angle) < 0x7ff8) maxVertexAngle = angle;
  }
  state.minAngleUnits = unsigned(
    referenceAngle - maxVertexAngle + state.angleUnits,
  );
  state.maxAngleUnits = unsigned(
    referenceAngle - minVertexAngle + FLAP_QUARTER_TURN + state.angleUnits,
  );
  state.spanUnits = unsigned(state.maxAngleUnits - state.minAngleUnits);
  const previous = state.angleUnits;
  // Plastic callback uses a half-turn test when deciding which end to clamp.
  if (unsigned(previous - state.minAngleUnits) > state.spanUnits)
    state.angleUnits =
      unsigned(previous - state.maxAngleUnits) < 0x7ff8
        ? state.maxAngleUnits
        : state.minAngleUnits;
  const activated = !state.active;
  state.active = true;
  state.buckled = true;
  return {
    movedVertices,
    activated,
    angleChanged: state.angleUnits !== previous,
  };
}
