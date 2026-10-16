import { Vector3, type Quaternion } from "three";
import type { CollisionHull } from "./geometry";
import { hullPenetrationExceeds } from "./geometry";
import { translationHullFraction } from "./continuous-sat";

// Native advanceRigidBody first-order branch, HW4b8fd0/4c1990/4c1cc0.
const SMALL_ROTATION_SQUARED = 1e-7;
const FIRST_ORDER_LIMIT = 0.00800000037997961;
const RAD_TO_ANGLE = 10430.378350470453;
const ANGLE_TO_RAD = (2 * Math.PI) / 65536;

/** Producer-owned free motion only. Canonical fixed-axis rotation is smooth;
 * native poses are its quantized staircase plus the small-rotation gate. */
export interface FirstOrderMotion {
  readonly duration: number;
  readonly fractionScale: number;
  readonly angularSpeed: number;
  readonly angularSpeedSquared: number;
  readonly centerOfMass: Vector3;
  readonly axisWorld: Vector3;
}
export function captureFirstOrderMotion(
  localOmega: Vector3,
  duration: number,
  centerOfMass: Vector3,
  rotationLocked = false,
  orientation?: Quaternion,
): FirstOrderMotion | undefined {
  const angularSpeedSquared = rotationLocked ? 0 : localOmega.lengthSq();
  // Preserve the native sequential multiplication at its branch thresholds.
  if (
    !(Number.isFinite(duration) && duration >= 0) ||
    !Number.isFinite(angularSpeedSquared) ||
    (orientation &&
      Math.abs(orientation.lengthSq() - 1) > 128 * Number.EPSILON) ||
    angularSpeedSquared * duration * duration > FIRST_ORDER_LIMIT
  )
    return;
  const com = centerOfMass.clone();
  const axisWorld = localOmega.clone().normalize();
  if (orientation) axisWorld.applyQuaternion(orientation).normalize();
  Object.freeze(com);
  Object.freeze(axisWorld);
  return Object.freeze({
    duration,
    fractionScale: 1,
    angularSpeed: rotationLocked ? 0 : localOmega.length(),
    angularSpeedSquared,
    centerOfMass: com,
    axisWorld,
  });
}
export function prefixFirstOrderMotion(
  motion: FirstOrderMotion,
  fraction: number,
): FirstOrderMotion {
  return {
    ...motion,
    fractionScale: motion.fractionScale * fraction,
  };
}
function durationAt(motion: FirstOrderMotion, fraction: number) {
  return motion.duration * (fraction * motion.fractionScale);
}
function angleUnits(motion: FirstOrderMotion | undefined, fraction: number) {
  if (!motion) return 0;
  const dt = durationAt(motion, fraction);
  if (
    motion.angularSpeedSquared * dt * dt < SMALL_ROTATION_SQUARED ||
    motion.angularSpeed * dt < 0.0001
  )
    return 0;
  return Math.trunc(motion.angularSpeed * dt * RAD_TO_ANGLE) & 0xffff;
}
function nextAngleEvent(
  motion: FirstOrderMotion | undefined,
  lo: number,
  hi: number,
): number | undefined {
  if (!motion || angleUnits(motion, lo) === angleUnits(motion, hi)) return;
  const units = angleUnits(motion, lo);
  if (angleUnits(motion, hi) - units > 4) return;
  const duration = motion.duration * motion.fractionScale;
  return units === 0
    ? Math.sqrt(SMALL_ROTATION_SQUARED / motion.angularSpeedSquared) / duration
    : (units + 1) / (motion.angularSpeed * duration * RAD_TO_ANGLE);
}
function comDelta(
  a: CollisionHull,
  b: CollisionHull,
  motion?: FirstOrderMotion,
) {
  if (!motion) return new Vector3();
  return motion.centerOfMass
    .clone()
    .applyQuaternion(b.orientation!)
    .add(b.position!)
    .sub(
      motion.centerOfMass
        .clone()
        .applyQuaternion(a.orientation!)
        .add(a.position!),
    );
}
function translated(hull: CollisionHull, delta: Vector3): CollisionHull {
  return {
    ...hull,
    vertices: hull.vertices.map((point) => point.clone().add(delta)),
    position: hull.position!.clone().add(delta),
    faces: hull.faces.map((face) => ({
      ...face,
      constant: face.constant + face.normal.dot(delta),
    })),
  };
}
function radius(hull: CollisionHull, center: Vector3): number {
  let value = 0;
  for (const index of hull.vertexOrder ?? hull.vertices.map((_, i) => i))
    value = Math.max(value, hull.vertices[index].distanceTo(center));
  return value;
}
const frozenThickness = new WeakMap<CollisionHull, number>();
function hullThickness(hull: CollisionHull): number {
  const cached = frozenThickness.get(hull);
  if (cached !== undefined) return cached;
  let thickness = Infinity;
  const axes = [
    new Vector3(1, 0, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, 0, 1),
  ];
  for (const face of hull.faces) axes.push(face.normal);
  for (const direction of axes) {
    const squared = direction.lengthSq();
    if (!(Number.isFinite(squared) && squared > 1e-12)) continue;
    const [low, high] = project(hull, direction);
    thickness = Math.min(thickness, (high - low) / Math.sqrt(squared));
  }
  if (!(Number.isFinite(thickness) && thickness >= 0)) return 0;
  if (
    Object.isFrozen(hull) &&
    Object.isFrozen(hull.vertices) &&
    hull.vertices.every(Object.isFrozen) &&
    Object.isFrozen(hull.faces) &&
    hull.faces.every(
      (face) => Object.isFrozen(face) && Object.isFrozen(face.normal),
    ) &&
    (!hull.vertexOrder || Object.isFrozen(hull.vertexOrder))
  )
    frozenThickness.set(hull, thickness);
  return thickness;
}
/** Browser commitment margin, not a native force/contact equation. Native
 * world features have .005 plane discovery skin; checking an extra guard down
 * to micrometre penetration needlessly resolves individual angle quanta. Keep
 * this margin smaller and bound it by local hull thickness, including face
 * directions so a diagonally thin hull does not inherit a thick AABB's margin. */
export function firstOrderGuardSlop(
  a: CollisionHull,
  b: CollisionHull,
): number {
  return Math.max(
    1e-6,
    Math.min(0.001, 0.05 * Math.min(hullThickness(a), hullThickness(b))),
  );
}
function chordError(
  motion: FirstOrderMotion | undefined,
  radius: number,
  lo: number,
  hi: number,
): number {
  if (!motion || angleUnits(motion, lo) === angleUnits(motion, hi)) return 0;
  const angle =
    motion.angularSpeed * (durationAt(motion, hi) - durationAt(motion, lo));
  // A fixed-axis rotating point differs from its canonical endpoint chord by
  // at most R*angle²/8. Native and canonical endpoints/interior can each differ
  // by one angular quantum. The source SMALL_ROTATION gate adds a separate
  // finite jump; neither discrete allowance shrinks with interval width.
  const gate =
    angleUnits(motion, lo) === 0 ? Math.sqrt(SMALL_ROTATION_SQUARED) : 0;
  return radius * ((angle * angle) / 8 + 2 * ANGLE_TO_RAD + gate);
}
function project(hull: CollisionHull, axis: Vector3): [number, number] {
  let low = Infinity,
    high = -Infinity;
  for (const index of hull.vertexOrder ?? hull.vertices.map((_, i) => i)) {
    const value = hull.vertices[index].dot(axis);
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return [low, high];
}
function edgeDirections(
  hull: CollisionHull,
  cache: WeakMap<CollisionHull, Vector3[]>,
): Vector3[] {
  const cached = cache.get(hull);
  if (cached) return cached;
  const directions: Vector3[] = [];
  for (const [a, b] of hull.edges) {
    const direction = hull.vertices[b].clone().sub(hull.vertices[a]);
    const squared = direction.lengthSq();
    if (!(squared > 1e-12 && Number.isFinite(squared))) continue;
    direction.multiplyScalar(1 / Math.sqrt(squared));
    if (directions.some((old) => Math.abs(old.dot(direction)) > 1 - 1e-12))
      continue;
    directions.push(direction);
  }
  cache.set(hull, directions);
  return directions;
}

/** Necessary temporal overlap inequalities, not a contact claim. Linear
 * interpolation of endpoint support minima/maxima encloses every interpolated
 * vertex. Expanding by the world-space chord errors also encloses native poses.
 * Endpoint face and edge-cross directions provide the ordinary convex SAT
 * witnesses. Omitting skew edge directions would force clear cells through
 * potentially hundreds of native angle events before exact SAT rejected them.
 * Directions remain fixed during this interval's temporal support query. */
function overlapWindow(
  a0: CollisionHull,
  a1: CollisionHull,
  b0: CollisionHull,
  b1: CollisionHull,
  error: (axis: Vector3) => number,
  depthLimit: number,
  directions: WeakMap<CollisionHull, Vector3[]>,
): [number, number] | null | undefined {
  let enter = 0,
    leave = 1,
    invalid = false;
  const seenAxes: Vector3[] = [];
  const inequality = (old: number, next: number) => {
    const rate = next - old;
    if (rate === 0) return old > 0;
    const crossing = -old / rate;
    if (rate > 0) enter = Math.max(enter, crossing);
    else leave = Math.min(leave, crossing);
    return enter < leave;
  };
  const visit = (source: Vector3) => {
    const squared = source.lengthSq();
    if (!Number.isFinite(squared)) {
      invalid = true;
      return false;
    }
    if (squared < 1e-12) return true;
    const axis = source.clone().multiplyScalar(1 / Math.sqrt(squared));
    // Endpoint hulls commonly repeat the same box/parallel-face directions.
    // Omitting a redundant witness can only leave a wider uncertain window.
    if (seenAxes.some((old) => Math.abs(old.dot(axis)) > 1 - 1e-12))
      return true;
    seenAxes.push(axis);
    const [al0, ah0] = project(a0, axis),
      [al1, ah1] = project(a1, axis),
      [bl0, bh0] = project(b0, axis),
      [bl1, bh1] = project(b1, axis);
    const values = [al0, ah0, al1, ah1, bl0, bh0, bl1, bh1];
    if (!values.every(Number.isFinite)) {
      invalid = true;
      return false;
    }
    const padding =
      1e-10 + 64 * Number.EPSILON * Math.max(1, ...values.map(Math.abs));
    const allowance = error(axis) + padding - depthLimit;
    return (
      inequality(ah0 - bl0 + allowance, ah1 - bl1 + allowance) &&
      inequality(bh0 - al0 + allowance, bh1 - al1 + allowance)
    );
  };
  const axes = [
    new Vector3(1, 0, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, 0, 1),
  ];
  for (const axis of axes) if (!visit(axis)) return invalid ? undefined : null;
  for (const hull of [a0, b0, a1, b1])
    for (const face of hull.faces)
      if (!visit(face.normal)) return invalid ? undefined : null;
  const cross = new Vector3();
  for (const [a, b] of [
    [a0, b0],
    [a1, b1],
  ])
    for (const edgeA of edgeDirections(a, directions))
      for (const edgeB of edgeDirections(b, directions))
        if (!visit(cross.crossVectors(edgeA, edgeB)))
          return invalid ? undefined : null;
  return [Math.max(0, enter), Math.min(1, leave)];
}

export type FirstOrderGuardCounter =
  | "firstOrderIntervals"
  | "firstOrderCertificates"
  | "firstOrderTranslationQueries"
  | "firstOrderFallbacks";
export interface FirstOrderHullGuardInput {
  sourceA: CollisionHull;
  sourceB: CollisionHull;
  motionA?: FirstOrderMotion;
  motionB?: FirstOrderMotion;
  hullA(fraction: number): CollisionHull;
  hullB(fraction: number): CollisionHull;
  depthLimit: number;
  count?(key: FirstOrderGuardCounter): void;
}

/** Adaptive temporal SAT for a captured first-order FREE hull cell. Constant
 * native angle segments have exact continuous translation SAT, so fast/thin
 * crossings get geometry-sized entering/exiting windows rather than fixed
 * post-root probes. Discrete rotation events are never assumed Lipschitz. The
 * sub-1e-10 event bracket uses endpoint-orientation combinations; its tiny
 * conservative time shift is a browser guard policy, not a native equation.
 * Undefined requests the previous detailed guard; the work budget is a route
 * selection bound, not permission to accept unresolved movement. */
export function guardFirstOrderHull(
  input: FirstOrderHullGuardInput,
): number | undefined {
  const { motionA, motionB, hullA, hullB, count } = input;
  const depthLimit = Math.max(
    input.depthLimit,
    firstOrderGuardSlop(input.sourceA, input.sourceB),
  );
  const ra = motionA ? radius(input.sourceA, motionA.centerOfMass) : 0,
    rb = motionB ? radius(input.sourceB, motionB.centerOfMass) : 0;
  if (![ra, rb, depthLimit].every(Number.isFinite)) return;
  const angle = (motion: FirstOrderMotion | undefined) =>
    motion ? motion.angularSpeed * durationAt(motion, 1) : 0;
  const intervals = Math.max(
    1,
    Math.ceil((angle(motionA) + angle(motionB)) / 0.025),
  );
  const pending: [number, number, number][] = [];
  // Geometry snapshots are immutable for this captured guard call; mutable
  // source/custom hulls never retain direction caches across calls.
  const directions = new WeakMap<CollisionHull, Vector3[]>();
  for (let i = intervals - 1; i >= 0; i--)
    pending.push([i / intervals, (i + 1) / intervals, 0]);
  let best = 1,
    visits = 0;
  while (pending.length) {
    let [lo, hi, depth] = pending.pop()!;
    if (lo >= best) continue;
    hi = Math.min(hi, best);
    if (++visits > 512 || depth > 48 || hi - lo < 1e-14) {
      count?.("firstOrderFallbacks");
      return;
    }
    count?.("firstOrderIntervals");
    const a0 = hullA(lo),
      a1 = hullA(hi),
      b0 = hullB(lo),
      b1 = hullB(hi);
    if (hi - lo < 1e-10) {
      if (
        angleUnits(motionA, lo) !== angleUnits(motionA, hi) &&
        angleUnits(motionB, lo) !== angleUnits(motionB, hi)
      ) {
        // Independent before/after combinations invent relative rotation when
        // both native angle staircases jump together. The detailed route
        // evaluates the actual coupled poses instead of freezing tangent parts
        // against an orientation combination that never exists.
        count?.("firstOrderFallbacks");
        return;
      }
      // A quantum/gate event has finitely many native orientation states, not
      // a shrinking smooth arc. Test every endpoint-orientation combination
      // with affine COM translation over this tiny event bracket. This can
      // conservatively clip by at most the event bracket's temporal width.
      const deltaA = comDelta(a0, a1, motionA),
        deltaB = comDelta(b0, b1, motionB);
      const versionsA = [a0, translated(a1, deltaA.clone().negate())],
        versionsB = [b0, translated(b1, deltaB.clone().negate())];
      let blocked = false;
      for (const a of versionsA)
        for (const b of versionsB) {
          count?.("firstOrderTranslationQueries");
          blocked ||=
            translationHullFraction(a, b, deltaA, deltaB, depthLimit) < 1;
        }
      if (blocked) best = Math.min(best, lo);
      else count?.("firstOrderCertificates");
      continue;
    }
    if (
      angleUnits(motionA, lo) === angleUnits(motionA, hi) &&
      angleUnits(motionB, lo) === angleUnits(motionB, hi)
    ) {
      count?.("firstOrderTranslationQueries");
      const fraction = translationHullFraction(
        a0,
        b0,
        a1.position!.clone().sub(a0.position!),
        b1.position!.clone().sub(b0.position!),
        depthLimit,
      );
      if (fraction < 1) best = Math.min(best, lo + (hi - lo) * fraction);
      else count?.("firstOrderCertificates");
      continue;
    }
    const errorA = chordError(motionA, ra, lo, hi),
      errorB = chordError(motionB, rb, lo, hi);
    const window = overlapWindow(
      a0,
      a1,
      b0,
      b1,
      (axis) => {
        const projected = (
          motion: FirstOrderMotion | undefined,
          error: number,
        ) =>
          motion
            ? error *
              Math.sqrt(Math.max(0, 1 - axis.dot(motion.axisWorld) ** 2))
            : 0;
        return projected(motionA, errorA) + projected(motionB, errorB);
      },
      depthLimit,
      directions,
    );
    if (window === undefined) {
      count?.("firstOrderFallbacks");
      return;
    }
    if (window === null) {
      count?.("firstOrderCertificates");
      continue;
    }
    const width = hi - lo,
      narrowedLo = lo + width * window[0],
      narrowedHi = lo + width * window[1];
    if (window[1] - window[0] < 0.75) {
      pending.push([narrowedLo, narrowedHi, depth + 1]);
      continue;
    }
    lo = narrowedLo;
    hi = narrowedHi;
    // First dismiss the entire curvature tube using the geometric guard
    // margin. Enumerate angle events only for still-relevant overlap, never
    // merely because an otherwise harmless quantum lies in this interval.
    const eventA = nextAngleEvent(motionA, lo, hi),
      eventB = nextAngleEvent(motionB, lo, hi);
    const event = Math.min(eventA ?? Infinity, eventB ?? Infinity);
    const eventPadding = 256 * Number.EPSILON * Math.max(1, Math.abs(event));
    if (event > lo + eventPadding && event < hi - eventPadding) {
      pending.push(
        [event + eventPadding, hi, depth + 1],
        [event - eventPadding, event + eventPadding, depth + 1],
        [lo, event - eventPadding, depth + 1],
      );
      continue;
    }
    const middle = (lo + hi) / 2;
    if (hullPenetrationExceeds(hullA(middle), hullB(middle), depthLimit)) {
      best = Math.min(best, middle);
      pending.push([lo, middle, depth + 1]);
    } else {
      // Earliest-first traversal handles multiple encounters; a single global
      // bisection would incorrectly presume monotone penetration over the tick.
      pending.push([middle, hi, depth + 1], [lo, middle, depth + 1]);
    }
  }
  return best;
}
