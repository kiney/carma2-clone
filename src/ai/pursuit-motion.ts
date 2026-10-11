import { Vector3 } from "three";

const stored = (v: Vector3) =>
  new Vector3(Math.fround(v.x), Math.fround(v.y), Math.fround(v.z));

function liveRelativeLength(a: Vector3, b: Vector3): number {
  const x = a.x - b.x,
    y = a.y - b.y,
    z = a.z - b.z;
  return Math.sqrt(x * Math.fround(x) + y * Math.fround(y) + z * z);
}

/** Installed direct-ram4ab202–375 builds native virtual section10000.
 * Target prediction uses model/world velocity, without metric conversion;
 * each offset is stored before being added to the stored ACT position. */
export function nativePursuitPrediction(
  opponentPosition: Vector3,
  targetPosition: Vector3,
  opponentVelocity: Vector3,
  targetVelocity: Vector3,
): {
  start: Vector3;
  finish: Vector3;
  distance: number;
  relativeSpeed: number;
  time: number;
} {
  const [start, target, ownVelocity, velocity] = [
    opponentPosition,
    targetPosition,
    opponentVelocity,
    targetVelocity,
  ].map(stored);
  if (
    ![start, target, ownVelocity, velocity].every((v) =>
      v.toArray().every(Number.isFinite),
    )
  )
    throw new Error("Invalid native pursuit prediction input");
  const distance = liveRelativeLength(target, start);
  const liveSpeed = liveRelativeLength(velocity, ownVelocity);
  const relativeSpeed = Math.fround(liveSpeed);
  const time = liveSpeed < 1 ? 0 : (distance / relativeSpeed) * 0.5;
  const finish = new Vector3(
    Math.fround(target.x + Math.fround(velocity.x * time)),
    Math.fround(target.y + Math.fround(velocity.y * time)),
    Math.fround(target.z + Math.fround(velocity.z * time)),
  );
  if (
    !Number.isFinite(relativeSpeed) ||
    !finish.toArray().every(Number.isFinite)
  )
    throw new Error("Native pursuit prediction exceeds Float32 bounds");
  return { start, finish, distance, relativeSpeed, time };
}

/** Installed pursuit state3: reverse until strict2200ms, brake through3000ms,
 * then clear forces and return to state0. Deadlines use unsigned wrap. */
export function nativePursuitReverse(
  nowMs: number,
  startedMs: number,
  mass: number,
  currentCurvature: number,
) {
  const storedMass = Math.fround(mass);
  if (
    ![nowMs, startedMs].every(
      (v) => Number.isInteger(v) && v >= 0 && v <= 0xffffffff,
    ) ||
    !Number.isFinite(storedMass) ||
    storedMass <= 0 ||
    !Number.isFinite(currentCurvature)
  )
    throw new Error("Invalid native pursuit reverse input");
  const braking = nowMs > (startedMs + 2200) >>> 0;
  // Native tests completion only inside the braking branch. The two wrapped
  // deadlines can straddle zero, so evaluating completion first is different.
  const finished = braking && nowMs > (startedMs + 3000) >>> 0;
  return {
    finished,
    curvature: braking || finished ? currentCurvature : 0,
    accForce: finished || braking ? 0 : Math.fround(-8 * storedMass),
    brakeForce: !finished && braking ? Math.fround(15 * storedMass) : 0,
  };
}
