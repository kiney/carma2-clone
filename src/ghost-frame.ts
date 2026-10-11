import { Matrix4, Vector2, Vector3 } from "three";

export interface NativeGhostVertex {
  position: Vector3;
  /** UV after the source material mapping transform, before clipping. */
  uv: Vector2;
}

export type NativeGhostTriangle = readonly [
  NativeGhostVertex,
  NativeGhostVertex,
  NativeGhostVertex,
];

export interface NativeGhostQuad {
  /** Model coordinates, ordered (u0,v0), (u1,v0), (u0,v1), (u1,v1). */
  points: readonly [Vector3, Vector3, Vector3, Vector3];
  /** Captured face-list normal, supplied independently of the model points. */
  normal: Vector3;
}

const f32 = Math.fround;
const NORMAL_EPSILON = 2 ** -22;

function scalar(value: number): number {
  const stored = f32(value);
  if (!Number.isFinite(stored))
    throw new Error("Invalid native ghost-frame scalar");
  return stored;
}

function vector(value: Vector3): Vector3 {
  if (!value) throw new Error("Missing native ghost-frame vector provider");
  return new Vector3(scalar(value.x), scalar(value.y), scalar(value.z));
}

function normalize(value: Vector3): Vector3 {
  const length = value.length();
  return length > NORMAL_EPSILON
    ? vector(value.clone().multiplyScalar(1 / length))
    : new Vector3(1, 0, 0);
}

/** Installed SmashEnvironment4f0ef6 and SmashObject4f4c49 use the effect-force
 * components, not the contact point. __ftol truncates a Float32 input to signed
 * 64-bit and the callers XOR only EAX. Invalid signed-64 conversions have zero
 * low DWORD. No RNG is consumed here; WAM's original spec-pointer seed is a
 * different provider and cannot be reconstructed from a browser object ID. */
export function nativeDirectSmashSeed(effectForce: Vector3): number {
  const force = vector(effectForce);
  const lowDword = (value: number): number =>
    value >= 2 ** 63 || value < -(2 ** 63) ? 0 : Math.trunc(value) >>> 0;
  return (lowDword(force.z) ^ lowDword(force.y) ^ lowDword(force.x)) >>> 0;
}

function vertex(value: NativeGhostVertex): NativeGhostVertex {
  if (!value?.uv) throw new Error("Missing native ghost-frame vertex provider");
  return {
    position: vector(value.position),
    uv: new Vector2(scalar(value.uv.x), scalar(value.uv.y)),
  };
}

function sameVertex(a: NativeGhostVertex, b: NativeGhostVertex): boolean {
  return a.position.equals(b.position) && a.uv.equals(b.uv);
}

/** Installed 4f3460/4f34e0: choose the nearest triangle's off-diagonal UV,
 * then lift without an inside-triangle test or clamping. Points remain in the
 * original model domain; no actor matrix is applied. Both maps reconstruct their
 * omitted coordinate with the FIRST model face plane, including a bent pair.
 * Dominant-axis selection instead uses the separately captured face-list normal.
 * Float32 loads/stores are explicit; JS live arithmetic and independently
 * derived plane coefficients do not promise every original x87 rounding bit. */
export function captureNativeGhostQuad(
  pair: readonly [NativeGhostTriangle, NativeGhostTriangle],
  bounds: readonly [number, number, number, number],
  capturedNormal: Vector3,
): NativeGhostQuad {
  if (!pair || pair.length !== 2 || pair.some((face) => face.length !== 3))
    throw new Error("Native ghost-frame requires two triangles");
  if (!bounds || bounds.length !== 4)
    throw new Error("Missing native ghost-frame UV bounds");
  const [u0, v0, u1, v1] = bounds.map(scalar);
  if (!(u1 > u0 && v1 > v0))
    throw new Error("Invalid native ghost-frame UV bounds");
  const normal = vector(capturedNormal);
  const triangles = pair.map((face) => face.map(vertex));
  const unique = triangles.map((face, index) =>
    face.filter(
      (candidate) =>
        !triangles[1 - index].some((other) => sameVertex(candidate, other)),
    ),
  );
  if (unique.some((vertices) => vertices.length !== 1))
    throw new Error("Native ghost-frame pair requires one shared edge");
  const determinants = triangles.map(([a, b, c]) => {
    const determinant =
      (b.uv.x - a.uv.x) * (c.uv.y - a.uv.y) -
      (b.uv.y - a.uv.y) * (c.uv.x - a.uv.x);
    if (determinant === 0)
      throw new Error("Degenerate native ghost-frame UV mapping");
    return determinant;
  });
  const [a, b, c] = triangles[0];
  const plane = b.position
    .clone()
    .sub(a.position)
    .cross(c.position.clone().sub(a.position));
  if (plane.length() === 0)
    throw new Error("Degenerate native ghost-frame model face");
  const planeNormal = vector(plane.normalize());
  const planeConstant = scalar(planeNormal.dot(a.position));
  const absolute = normal
    .clone()
    .set(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z));
  // 4f1f02/31/42: strict maxima only; all ties fall through to Z.
  const omitted =
    absolute.x > absolute.y && absolute.x > absolute.z
      ? 0
      : absolute.y > absolute.x && absolute.y > absolute.z
        ? 1
        : 2;
  if (planeNormal.getComponent(omitted) === 0)
    throw new Error(
      "Native ghost-frame normal and model plane are incompatible",
    );
  const lift = (u: number, v: number): Vector3 => {
    const du0 = unique[0][0].uv.x - u;
    const dv0 = unique[0][0].uv.y - v;
    const du1 = unique[1][0].uv.x - u;
    const dv1 = unique[1][0].uv.y - v;
    // 4f3483/89/8f spills three differences, retaining the first U live.
    const d0 = du0 * du0 + dv0 * f32(dv0);
    const d1 = du1 * f32(du1) + dv1 * f32(dv1);
    const selected = d0 <= d1 ? 0 : 1;
    const [p, q, r] = triangles[selected];
    const du = u - p.uv.x;
    const dv = v - p.uv.y;
    const qWeight =
      (du * (r.uv.y - p.uv.y) - dv * (r.uv.x - p.uv.x)) /
      determinants[selected];
    const rWeight =
      ((q.uv.x - p.uv.x) * dv - (q.uv.y - p.uv.y) * du) /
      determinants[selected];
    const point = new Vector3();
    for (let axis = 0; axis < 3; axis++) {
      if (axis === omitted) continue;
      point.setComponent(
        axis,
        scalar(
          p.position.getComponent(axis) +
            qWeight *
              (q.position.getComponent(axis) - p.position.getComponent(axis)) +
            rWeight *
              (r.position.getComponent(axis) - p.position.getComponent(axis)),
        ),
      );
    }
    let remaining = planeConstant;
    for (let axis = 0; axis < 3; axis++)
      if (axis !== omitted)
        remaining -= point.getComponent(axis) * planeNormal.getComponent(axis);
    point.setComponent(
      omitted,
      scalar(remaining / planeNormal.getComponent(omitted)),
    );
    return point;
  };
  return {
    points: [lift(u0, v0), lift(u1, v0), lift(u0, v1), lift(u1, v1)],
    normal,
  };
}

/** Installed DoShrapnel4ebec3: retain the independent, potentially sheared basis
 * and put P1 at the origin. Actor-based placement uses this frame directly;
 * composing the source actor matrix again is not native. Container X/Y scaling
 * and the strict .001 tiny-face abort occur only when BOTH bounds are nonzero.
 * The caller owns that abort and its already-consumed RNG/seed sequence. */
export function prepareNativeGhostFrame(
  quad: NativeGhostQuad | null,
  fallbackFrame: Matrix4,
  containerSize?: readonly [number, number, number],
): { frame: Matrix4; tinyFace: boolean } {
  if (!quad) {
    if (
      !fallbackFrame ||
      fallbackFrame.elements.some((value) => !Number.isFinite(value))
    )
      throw new Error("Invalid native ghost-frame fallback matrix");
    return { frame: fallbackFrame.clone(), tinyFace: false };
  }
  if (!quad.points || quad.points.length !== 4)
    throw new Error("Missing native ghost-frame quad provider");
  const points = quad.points.map(vector);
  const edgeX = points[1].clone().sub(points[0]);
  const edgeY = points[2].clone().sub(points[0]);
  const x = normalize(edgeX);
  const y = normalize(edgeY);
  const z = normalize(vector(quad.normal));
  const frame = new Matrix4().makeBasis(x, y, z).setPosition(points[1]);
  if (containerSize) {
    if (containerSize.length !== 3)
      throw new Error("Invalid native ghost-frame container bounds");
    const [dx, dy] = containerSize.map(scalar);
    if (dx !== 0 && dy !== 0) {
      // Scaling's separate lengths spill X/Z for the first edge and all three
      // components of the second edge (4eb88a/8a8/8ca/8d0/8dc).
      const scaleLengthX = Math.sqrt(
        edgeX.x * f32(edgeX.x) + edgeX.y * edgeX.y + edgeX.z * f32(edgeX.z),
      );
      const scaleLengthY = Math.sqrt(
        edgeY.x * f32(edgeY.x) +
          edgeY.y * f32(edgeY.y) +
          edgeY.z * f32(edgeY.z),
      );
      // First length stays live across its spill; second is reloaded from F32.
      if (scaleLengthX < 0.001 || f32(scaleLengthY) < 0.001)
        return { frame, tinyFace: true };
      frame.scale(
        new Vector3(
          scalar(f32(scaleLengthX) / dx),
          scalar(f32(scaleLengthY) / dy),
          1,
        ),
      );
      for (let index = 0; index < 16; index++)
        frame.elements[index] = scalar(frame.elements[index]);
    }
  }
  return { frame, tinyFace: false };
}
