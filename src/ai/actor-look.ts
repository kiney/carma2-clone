import { Matrix4, Quaternion, Vector3 } from "three";

// The installed binary compares the x87 vector length with the single
// precision constant at 0x58a8a0 (2 * FLT_EPSILON).
const NORMALIZE_EPSILON = 2 ** -22;

function storeVector(value: Vector3): Vector3 {
  const stored = new Vector3(
    Math.fround(value.x),
    Math.fround(value.y),
    Math.fround(value.z),
  );
  if (!stored.toArray().every(Number.isFinite))
    throw new Error("Actor look transform exceeds Float32 bounds");
  return stored;
}

function nativeNormalize(value: Vector3, storeLength = false): Vector3 {
  const source = storeVector(value);
  const liveLength = Math.sqrt(
    source.x * source.x + source.y * source.y + source.z * source.z,
  );
  // LOOK_UP keeps the initial look length live, but stores/reloads the cross
  // axis length at53105e before its threshold test and reciprocal.
  const length = storeLength ? Math.fround(liveLength) : liveLength;
  if (!(length > NORMALIZE_EPSILON)) return new Vector3(1, 0, 0);
  const inverseLength = 1 / length;
  return new Vector3(
    Math.fround(source.x * inverseLength),
    Math.fround(source.y * inverseLength),
    Math.fround(source.z * inverseLength),
  );
}

function nativeCross(a: Vector3, b: Vector3): Vector3 {
  return new Vector3(
    Math.fround(a.y * b.z - a.z * b.y),
    Math.fround(a.z * b.x - a.x * b.z),
    Math.fround(a.x * b.y - a.y * b.x),
  );
}

export interface NativeActorLookResult {
  /** BRender row basis represented as Three.js basis columns, with translation. */
  matrix: Matrix4;
  /** Orientation extracted from `matrix`; translation is not part of it. */
  quaternion: Quaternion;
  /** The three single-precision basis vectors used to form the matrix. */
  x: Vector3;
  y: Vector3;
  z: Vector3;
}

/** Reconstructs PointActorAlongThisBloodyVector / LOOK_UP (HW 0x4013d0).
 * The actor's local +Z basis points opposite the supplied look vector, while
 * its translation is copied unchanged from the actor. */
export function nativeActorLookUp(
  look: Vector3,
  position: Vector3,
): NativeActorLookResult {
  if (![look, position].every((v) => v.toArray().every(Number.isFinite)))
    throw new Error("Invalid actor look transform");

  const z = nativeNormalize(look).negate();
  const worldUp = new Vector3(0, 1, 0);
  const x = nativeNormalize(nativeCross(worldUp, z), true);
  const y = nativeCross(z, x);
  const translation = storeVector(position);
  const matrix = new Matrix4().makeBasis(x, y, z).setPosition(translation);
  const quaternion = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(x, y, z),
  );

  return { matrix, quaternion, x, y, z };
}
