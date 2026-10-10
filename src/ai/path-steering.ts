import { Vector2 } from "three";

const EPSILON = Math.fround(1.192092896e-7);
const cross = (a: Vector2, b: Vector2) => a.x * b.y - a.y * b.x;
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));

export interface PathSteeringErrors {
  error: number;
  headingError: number;
  baseCurvature: number;
}

export interface NativePathEscapeState {
  /** Native zero sentinel; this timer is not cleared while approaching. */
  timeMs: number;
  flipped: boolean;
}

/** Installed outside-lane branch4b011d–4b02ef. Call only after the
 * in-lane branch rejected abs(error)>1. Coordinates are (worldZ, worldX).
 * Keep the mixed x87/Float32 stores; blanket vector rounding changes exits. */
export function nativeOutsideLaneSteering(
  start: Vector2,
  finish: Vector2,
  position: Vector2,
  metricVelocity: Vector2,
  maxCurve: number,
  nowMs: number,
  previous: NativePathEscapeState,
  storedMetricSpeed = Math.fround(metricVelocity.length()),
): { desiredSpeed: number; curvature: number; escape: NativePathEscapeState } {
  if (
    ![start, finish, position, metricVelocity].every((v) =>
      v.toArray().every(Number.isFinite),
    ) ||
    ![maxCurve, nowMs, previous.timeMs, storedMetricSpeed].every(
      Number.isFinite,
    ) ||
    maxCurve < 0 ||
    nowMs < 0 ||
    previous.timeMs < 0 ||
    storedMetricSpeed < 0
  )
    throw new Error("Invalid native opponent escape input");
  const escape = { ...previous };
  const speed = storedMetricSpeed;
  if (speed >= 12) return { desiredSpeed: 6, curvature: 0, escape };
  const dx = finish.x - start.x;
  const dy = Math.fround(finish.y - start.y);
  const rx = Math.fround(position.x - start.x);
  const ry = Math.fround(position.y - start.y);
  const squaredLength = dx * dx + dy * dy;
  // Explicit browser guard for a native divide-by-zero on degenerate data.
  if (squaredLength === 0) return { desiredSpeed: 6, curvature: 0, escape };
  const liveT = (dx * rx + dy * ry) / squaredLength;
  const storedT = Math.fround(liveT);
  let projectedX = dx,
    projectedY = dy;
  if (liveT < 0) projectedX = projectedY = 0;
  else if (storedT <= 1) {
    projectedX *= storedT;
    projectedY *= storedT;
  }
  const deltaX = rx - projectedX;
  const liveDeltaY = ry - projectedY;
  const deltaY = Math.fround(liveDeltaY);
  const length = Math.fround(Math.sqrt(deltaX * deltaX + liveDeltaY * deltaY));
  let crossValue = metricVelocity.x * deltaY - metricVelocity.y * deltaX;
  if (speed !== 0 && length !== 0) crossValue /= speed * length;
  const speedLimited = speed >= 12.5 ? (maxCurve * 12.5) / speed : maxCurve;
  let curvature = -crossValue * speedLimited;
  if (deltaX * metricVelocity.x + deltaY * metricVelocity.y > 0) {
    if (escape.timeMs === 0) {
      escape.timeMs = nowMs;
      escape.flipped = false;
    } else if (nowMs - escape.timeMs > 5000) {
      escape.timeMs = nowMs;
      escape.flipped = !escape.flipped;
    }
    if (escape.flipped) curvature = -curvature;
  }
  return { desiredSpeed: 6, curvature, escape };
}

/** All horizontal vectors use native (worldZ, worldX) coordinates.
 * Positions/width are model units; velocity here is metres/second. */
export function nativeStraightErrors(
  start: Vector2,
  finish: Vector2,
  position: Vector2,
  metricVelocity: Vector2,
  width: number,
  storedMetricSpeed = metricVelocity.length(),
): PathSteeringErrors {
  if (
    ![start, finish, position, metricVelocity].every((v) =>
      v.toArray().every(Number.isFinite),
    )
  )
    throw new Error("Invalid native opponent straight geometry");
  if (!(width > 0 && Number.isFinite(width)))
    throw new Error("Native opponent straight requires a positive width");
  const delta = finish.clone().sub(start);
  const relative = position.clone().sub(start);
  const length = delta.length();
  const speed = storedMetricSpeed;
  if (!Number.isFinite(speed) || speed < 0)
    throw new Error("Invalid native opponent straight speed");
  let error = 0;
  if (length > EPSILON) {
    // Installed4aff90–4affec, not rec2's cross/length reconstruction.
    error = relative.dot(delta) / length;
    if (error > length) error -= length;
    else if (error > 0) error = cross(relative, delta) / (width * length);
  }
  return {
    error,
    headingError:
      length > EPSILON && speed > EPSILON
        ? cross(delta, metricVelocity) / (speed * length)
        : 0,
    baseCurvature: 0,
  };
}

export function nativeCornerErrors(
  center: Vector2,
  radius: number,
  width: number,
  left: boolean,
  position: Vector2,
  metricVelocity: Vector2,
  storedMetricSpeed = metricVelocity.length(),
): PathSteeringErrors {
  if (
    ![center, position, metricVelocity].every((v) =>
      v.toArray().every(Number.isFinite),
    )
  )
    throw new Error("Invalid native opponent corner geometry");
  if (
    !(
      radius > 0 &&
      width > 0 &&
      Number.isFinite(radius) &&
      Number.isFinite(width)
    )
  )
    throw new Error(
      "Native opponent corner requires positive radius and width",
    );
  const radial = position.clone().sub(center);
  const speed = storedMetricSpeed;
  if (!Number.isFinite(speed) || speed < 0)
    throw new Error("Invalid native opponent corner speed");
  const error = (radial.length() - radius) / width;
  // Installed4b00b3–4b00cf divides by radius*speed; rec2 misplaces speed.
  const headingError =
    speed > EPSILON ? metricVelocity.dot(radial) / (radius * speed) : 0;
  return {
    error: left ? error : -error,
    headingError: left ? -headingError : headingError,
    baseCurvature: (left ? 1 : -1) / (Math.fround(6.9) * radius),
  };
}

/** Verified in-lane branch4b0100: the original tests abs(error)<=1.
 * Recovery/escape steering outside the lane belongs to the following state. */
export function nativeInLaneSteering(
  errors: PathSteeringErrors,
  desiredSpeed: number,
  metricSpeed: number,
  maxCurve: number,
): { desiredSpeed: number; curvature: number } | undefined {
  if (
    ![
      errors.error,
      errors.headingError,
      errors.baseCurvature,
      desiredSpeed,
      metricSpeed,
      maxCurve,
    ].every(Number.isFinite) ||
    metricSpeed < 0 ||
    maxCurve < 0
  )
    throw new Error("Invalid native opponent steering input");
  if (Math.abs(errors.error) > 1) return;
  if (desiredSpeed > 6)
    desiredSpeed = Math.fround(
      desiredSpeed + (6 - desiredSpeed) * Math.abs(errors.headingError),
    );
  const speedLimitedCurve =
    metricSpeed >= 12.5 ? (maxCurve * 12.5) / metricSpeed : maxCurve;
  return {
    desiredSpeed,
    curvature: clamp(
      errors.baseCurvature +
        speedLimitedCurve *
          (errors.error * Math.fround(0.1) - errors.headingError),
      -maxCurve,
      maxCurve,
    ),
  };
}
