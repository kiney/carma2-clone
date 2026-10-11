import { Vector3 } from "three";

const f = Math.fround;

export interface NativeFreeLevelOutInput {
  /** Object+08/+0c/+10: BODY moments, used only to choose an ACT axis. */
  inertia: Vector3;
  /** Native ACT matrix34: X/Y/Z world basis vectors, then translation.
   * Supply the retained full ACT matrix, including scale/shear. */
  actorMatrix: ArrayLike<number>;
  /** Retained Object+244, in world space; do not negate or normalize here. */
  waterPlaneNormal: Vector3;
}

export interface NativeFreeLevelOutResult {
  /** The installed parallel-axis singularity produces NaNs, not a zero torque. */
  status: "applied" | "skipped" | "singular";
  axis: 0 | 1 | 2;
  /** Live dot used for the strict comparison against DOUBLE(-.99). */
  dot: number;
  worldDelta: Vector3;
  bodyDelta: Vector3;
}

function scalar(value: number): number {
  const result = f(value);
  if (!Number.isFinite(result))
    throw new RangeError("Non-finite native level-out input");
  return result;
}

/** Installed LevelOutOnSurface4b6d50. The generic force owner supplies its
 * headerbit8/L!=0/viscosity>2/depth<1 gate and adds bodyDelta to BODY omega
 * with Float32 stores. No dt, mass, depth or L multiplier occurs inside.
 * Sequential component normalization and scratch spills are intentional;
 * replacing them with Vector3.normalize changes the installed result. */
export function nativeFreeLevelOutDelta(
  input: NativeFreeLevelOutInput,
): NativeFreeLevelOutResult {
  if (input.actorMatrix.length !== 12)
    throw new RangeError("Native level-out requires native12 ACT matrix");
  const matrix = Array.from(input.actorMatrix, scalar),
    moments = input.inertia.toArray().map(scalar),
    n = input.waterPlaneNormal.toArray().map(scalar),
    axis: 0 | 1 | 2 =
      moments[0] > moments[1] && moments[0] > moments[2]
        ? 0
        : moments[1] > moments[2] && moments[1] > moments[0]
          ? 1
          : 2,
    a = matrix.slice(axis * 3, axis * 3 + 3).map((value) => -value),
    // 4b6dfd/e01 adds X+Y before Z; compare the live value, not its spill.
    dot = n[0] * a[0] + n[1] * a[1] + n[2] * a[2];
  if (dot <= -0.99)
    return {
      status: "skipped",
      axis,
      dot,
      worldDelta: new Vector3(),
      bodyDelta: new Vector3(),
    };

  const x = n[1] * a[2] - n[2] * a[1],
    y = n[2] * a[0] - n[0] * a[2],
    z = n[0] * a[1] - n[1] * a[0],
    storedY = f(y),
    storedZ = f(z),
    ySquare = f(y * storedY),
    zSquare = f(z * storedZ),
    q = f(dot) + 1,
    storedQ = f(q),
    // Source X retains its cross product and q live; Y/Z use scratch stores.
    nextX = x * (q / Math.sqrt(x * x + zSquare + ySquare)),
    storedX = f(nextX),
    xSquare = f(nextX * storedX),
    nextY = storedY * (storedQ / Math.sqrt(zSquare + ySquare + xSquare)),
    nextZ =
      storedZ * (storedQ / Math.sqrt(nextY * f(nextY) + zSquare + xSquare)),
    worldDelta = new Vector3(storedX, f(nextY), f(nextZ)),
    bodyDelta = new Vector3();
  // BrMatrix34TApplyV532cd0: dot with each ACT basis; this is a transpose,
  // never an inverse or a rotation-only quaternion reconstruction.
  for (let i = 0; i < 3; i++) {
    const j = i * 3;
    bodyDelta.setComponent(
      i,
      f(
        matrix[j] * worldDelta.x +
          matrix[j + 1] * worldDelta.y +
          matrix[j + 2] * worldDelta.z,
      ),
    );
  }
  return {
    status: bodyDelta.toArray().every(Number.isFinite) ? "applied" : "singular",
    axis,
    dot,
    worldDelta,
    bodyDelta,
  };
}
