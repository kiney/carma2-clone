import { Vector3 } from "three";

function timestamp(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error("Invalid native opponent proximity timestamp");
}

/** InitOpponents4adbe4: the camera yon is stored single before adding10;
 * comparison precedes the final store into gIn_view_distance. */
export function nativeOpponentViewDistance(cameraYon: number): number {
  const yon = Math.fround(cameraYon);
  if (!Number.isFinite(yon) || yon < 0)
    throw new Error("Invalid native opponent view distance");
  return Math.fround(Math.max(yon + 10, 45));
}

/** CalcOpponentConspicuousness4a92f0 tests actor-origin proximity, not
 * renderer visibility. X/Y deltas are stored before squaring; Z remains live
 * until after its square. The live length controls the strict threshold. */
export function nativeOpponentProximity(
  opponent: Vector3,
  player: Vector3,
  viewDistance: number,
  nowMs: number,
  previousLastInViewMs: number,
): { displacement: Vector3; playerDistance: number; lastInViewMs: number } {
  timestamp(nowMs);
  timestamp(previousLastInViewMs);
  const inputs = [...opponent.toArray(), ...player.toArray()].map(Math.fround);
  const limit = Math.fround(viewDistance);
  if (!inputs.every(Number.isFinite) || !Number.isFinite(limit) || limit < 0)
    throw new Error("Invalid native opponent proximity geometry");
  const x = Math.fround(inputs[0] - inputs[3]);
  const y = Math.fround(inputs[1] - inputs[4]);
  const z = inputs[2] - inputs[5];
  const length = Math.sqrt(x * x + y * y + z * z);
  const playerDistance = Math.fround(length);
  if (!Number.isFinite(playerDistance))
    throw new Error("Native opponent proximity exceeds Float32 bounds");
  return {
    displacement: new Vector3(x, y, Math.fround(z)),
    playerDistance,
    lastInViewMs: length < limit ? nowMs : previousLastInViewMs,
  };
}

/** Regular-rival mode selection4aa310. Installed map view2/show-opponents
 * suppresses cheating; otherwise use the native unsigned deadline compare. */
export function nativeOpponentCheating(
  nowMs: number,
  lastInViewMs: number,
  mapView: number,
  showOpponents: boolean,
): boolean {
  timestamp(nowMs);
  timestamp(lastInViewMs);
  if (!Number.isInteger(mapView)) throw new Error("Invalid native map view");
  return (
    !(mapView === 2 && showOpponents) && nowMs > (lastInViewMs + 3000) >>> 0
  );
}
