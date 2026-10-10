import { Vector2 } from "three";

export interface NativePathCorner {
  center: Vector2;
  radius: number;
  tangentReach: number;
  left: boolean;
  fallback: boolean;
}

/** Installed CalcCorners4b1300, individual junction construction. Vectors
 * use native (worldZ,worldX) model coordinates. Route traversal is separate. */
export function constructNativePathCorner(
  previousStart: Vector2,
  junction: Vector2,
  nextFinish: Vector2,
  previousWidth: number,
  nextWidth: number,
  random = Math.random,
): NativePathCorner {
  if (
    ![previousStart, junction, nextFinish].every((v) =>
      v.toArray().every(Number.isFinite),
    ) ||
    ![previousWidth, nextWidth].every(Number.isFinite)
  )
    throw new Error("Invalid native opponent corner geometry");
  const incoming = previousStart.clone().sub(junction);
  const outgoing = nextFinish.clone().sub(junction);
  incoming.set(Math.fround(incoming.x), Math.fround(incoming.y));
  outgoing.set(Math.fround(outgoing.x), Math.fround(outgoing.y));
  const incomingSquared = Math.fround(incoming.lengthSq());
  const outgoingSquared = Math.fround(outgoing.lengthSq());
  const dot = incoming.dot(outgoing);
  const cross = outgoing.x * incoming.y - outgoing.y * incoming.x;
  const magnitude = Math.hypot(dot, cross);
  const cosine = magnitude > 2 ** -22 ? dot / magnitude : 1;
  const signedSine = magnitude > 2 ** -22 ? cross / magnitude : 0;
  const sine = Math.abs(signedSine);
  if (
    incomingSquared === 0 ||
    outgoingSquared === 0 ||
    sine < Math.fround(0.001)
  ) {
    const sample = random();
    if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
      throw new Error("Opponent corner random sample must be in [0, 1)");
    const radius = Math.min(previousWidth, nextWidth);
    return {
      center: junction.clone(),
      radius,
      tangentReach: Math.fround(radius * Math.fround(0.7)),
      left: Math.trunc((Math.floor(sample * 32768) * 2) / 32768) !== 0,
      fallback: true,
    };
  }
  const halfAngle = sine / (cosine + 1);
  const combinedWidth = previousWidth + cosine * nextWidth;
  let reach =
    Math.fround(combinedWidth / sine) +
    halfAngle * nextWidth +
    Math.sqrt(
      nextWidth *
        (halfAngle * halfAngle * nextWidth +
          (2 * combinedWidth) / (cosine + 1) -
          nextWidth),
    );
  const unroundedReach = reach;
  reach = Math.fround(reach);
  if (9 * unroundedReach * unroundedReach > incomingSquared)
    reach = Math.fround(Math.sqrt(incomingSquared) * Math.fround(1 / 3));
  if (9 * reach * reach > outgoingSquared)
    reach = Math.fround(Math.sqrt(outgoingSquared) * Math.fround(1 / 3));
  const unroundedRadius = halfAngle * reach;
  const radius = Math.fround(unroundedRadius);
  const left = signedSine > 0;
  // Native stores each numerator before dividing, and only the second uses
  // the previously stored radius (4b153f onward). These stores affect ULPs.
  const sign = left ? 1 : -1;
  const numeratorX = Math.fround(
    outgoing.x * reach - sign * outgoing.y * unroundedRadius,
  );
  const numeratorY = Math.fround(
    outgoing.y * reach + sign * outgoing.x * radius,
  );
  const length = Math.sqrt(outgoingSquared);
  const center = new Vector2(
    Math.fround(junction.x + numeratorX / length),
    Math.fround(junction.y + numeratorY / length),
  );
  if (![radius, reach, center.x, center.y].every(Number.isFinite))
    throw new Error(
      "Native opponent corner construction is undefined for this geometry",
    );
  return {
    center,
    radius,
    tangentReach: Math.fround(reach),
    left,
    fallback: false,
  };
}
