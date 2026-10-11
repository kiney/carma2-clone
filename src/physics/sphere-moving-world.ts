/** Analytic source sphere features in the engine's moving-world extension.
 * Installed422f30 itself emits B=NULL. Relative target frames and B torque
 * points here are a derived extension; see docs/c2-sphere-moving-world-re.md. */
import { Vector3 } from "three";
import type { PedVector } from "../ped-form";
import type { Surface } from "../world";
import type { HullContact } from "./geometry";
import type { MovingWorldBody, MovingWorldPose } from "./moving-world";
import {
  nativeSphereEdgeSweep,
  nativeSphereWorldContacts,
  nativeSphereWorldFaceSweep,
  type NativeSphereBodyPose,
  type NativeSphereData,
  type NativeSphereWorldFace,
} from "./sphere-contact";

export interface NativeSphereMovingWorldSurface extends Surface {
  owner: MovingWorldBody;
  /** Geometry, packed normal and plane constant are at this query's candidate
   * pose, even if StopGroovidelic subsequently changes the live owner's pose. */
  collectedPose?: MovingWorldPose;
  /** Cached N.dot(x)=D. Preserve this independently supplied source constant. */
  constant?: number;
  faceFriction?: number;
  /** Preserve the actual cache identity when a host supplies a pose wrapper. */
  sourceSurface?: Surface;
}
const f = Math.fround;
function scalar(n: number): number {
  if (!Number.isFinite(n) || !Number.isFinite(f(n)))
    throw new Error("Moving world SPHERE requires finite native scalars");
  return f(n);
}
function vector(v: Vector3): PedVector {
  return [scalar(v.x), scalar(v.y), scalar(v.z)];
}
function dot(a: PedVector, b: PedVector): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function sub(a: PedVector, b: PedVector): PedVector {
  return [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2])];
}
function translation(m: ArrayLike<number>): PedVector {
  return [m[9], m[10], m[11]];
}
function rotate(m: ArrayLike<number>, v: PedVector): PedVector {
  return [
    f(m[0] * v[0] + m[3] * v[1] + m[6] * v[2]),
    f(m[1] * v[0] + m[4] * v[1] + m[7] * v[2]),
    f(m[2] * v[0] + m[5] * v[1] + m[8] * v[2]),
  ];
}
function inverseRotate(m: ArrayLike<number>, v: PedVector): PedVector {
  return [
    f(m[0] * v[0] + m[1] * v[1] + m[2] * v[2]),
    f(m[3] * v[0] + m[4] * v[1] + m[5] * v[2]),
    f(m[6] * v[0] + m[7] * v[1] + m[8] * v[2]),
  ];
}
function transform(m: ArrayLike<number>, v: PedVector): PedVector {
  const q = rotate(m, v),
    t = translation(m);
  return [f(q[0] + t[0]), f(q[1] + t[1]), f(q[2] + t[2])];
}
function inverseTransform(m: ArrayLike<number>, v: PedVector): PedVector {
  return inverseRotate(m, sub(v, translation(m)));
}
function nativePose(
  position: Vector3,
  orientation: MovingWorldPose["orientation"],
): Float32Array {
  if (
    ![orientation.x, orientation.y, orientation.z, orientation.w].every(
      Number.isFinite,
    ) ||
    Math.abs(orientation.lengthSq() - 1) > 0.0001
  )
    throw new Error(
      "Moving world SPHERE requires an orthonormal rigid target pose",
    );
  const axes = [
    new Vector3(1, 0, 0),
    new Vector3(0, 1, 0),
    new Vector3(0, 0, 1),
  ].map((axis) => vector(axis.applyQuaternion(orientation)));
  return Float32Array.from([
    ...axes[0],
    ...axes[1],
    ...axes[2],
    ...vector(position),
  ]);
}
function spherePose(input: ArrayLike<number>): Float32Array {
  if (input.length !== 12)
    throw new Error("Moving world SPHERE requires native12 sphere poses");
  const result = Float32Array.from(input, scalar);
  // Reject scale/shear before inverse basis operations; use the source unit
  // tolerance, retaining packed Float32 bases rather than renormalizing them.
  const axes: PedVector[] = [0, 1, 2].map((i) => [
    result[i * 3],
    result[i * 3 + 1],
    result[i * 3 + 2],
  ]);
  if (
    axes.some(
      (a, i) =>
        Math.abs(dot(a, a) - 1) > 0.0001 ||
        axes.some((b, j) => i !== j && Math.abs(dot(a, b)) > 0.0001),
    )
  )
    throw new Error(
      "Moving world SPHERE requires orthonormal native12 sphere poses",
    );
  return result;
}
function relativePose(
  a: ArrayLike<number>,
  b: ArrayLike<number>,
): Float32Array {
  const axes: PedVector[] = [0, 1, 2].map((i) =>
    inverseRotate(b, [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]),
  );
  return Float32Array.from([
    ...axes[0],
    ...axes[1],
    ...axes[2],
    ...inverseTransform(b, translation(a)),
  ]);
}
const three = (v: PedVector) => new Vector3(...v);

/** Faces are cached WORLD geometry at the collected candidate pose, unlike
 * sweepHullMovingTriangle's target-MODEL-local input. Returns unreduced rows:
 * one strictly earliest type3 face, then enabled type4 edges in source order.
 * Feed reduction/finalization once per shape through the existing world path.
 * Both torque points are WORLD positions at their respective OLD rigid poses;
 * the solver, not this adapter, subtracts each body's own COM. */
export function nativeSphereMovingWorldContacts(
  input: NativeSphereBodyPose,
  surfaces: readonly NativeSphereMovingWorldSurface[],
  options: { placementStart?: PedVector; edgeOnly?: boolean } = {},
): HullContact[] {
  if (surfaces.length > 65535)
    throw new Error("Moving world SPHERE cached face span exceeded");
  if (input.sphere.center.length !== 3)
    throw new Error("Moving world SPHERE requires a source vector3 center");
  const sphere: NativeSphereData = {
      center: [
        scalar(input.sphere.center[0]),
        scalar(input.sphere.center[1]),
        scalar(input.sphere.center[2]),
      ],
      radius: scalar(input.sphere.radius),
      radiusSquared: scalar(input.sphere.radiusSquared),
    },
    aOld = spherePose(input.oldPose),
    aNew = spherePose(input.predictedPose),
    edges: HullContact[] = [];
  let best: HullContact | null = null;
  for (const surface of surfaces) {
    if (surface.enabled === false || surface.collisionMode === "passthrough")
      continue;
    if (!surface.owner || surface.owner.kind !== "moving-world")
      throw new Error(
        "Moving world SPHERE requires an actual MovingWorldBody owner",
      );
    const pose = surface.collectedPose ?? surface.owner.state,
      bOld = nativePose(pose.position, pose.orientation),
      bNew = nativePose(pose.predictedPosition, pose.predictedOrientation),
      worldNormal = vector(surface.normal),
      worldConstant =
        surface.constant === undefined
          ? scalar(dot(worldNormal, vector(surface.a)))
          : scalar(surface.constant),
      face: NativeSphereWorldFace = {
        a: inverseTransform(bNew, vector(surface.a)),
        b: inverseTransform(bNew, vector(surface.b)),
        c: inverseTransform(bNew, vector(surface.c)),
        normal: inverseRotate(bNew, worldNormal),
        constant: f(worldConstant - dot(worldNormal, translation(bNew))),
        materialIdentifier: surface.material,
        materialFlags: surface.materialFlags,
        faceFlags: surface.faceFlags,
        faceFriction: surface.faceFriction,
        sourceSurface: surface.sourceSurface ?? surface,
      },
      relative: NativeSphereBodyPose = {
        sphere,
        oldPose: relativePose(aOld, bOld),
        predictedPose: relativePose(aNew, bNew),
      },
      placementStart = options.placementStart
        ? inverseTransform(bOld, options.placementStart)
        : undefined,
      start = placementStart ?? transform(relative.oldPose, sphere.center),
      end = transform(relative.predictedPose, sphere.center),
      edgeOnly = options.edgeOnly || surface.collisionMode === "edges",
      rows = nativeSphereWorldContacts(relative, [face], {
        placementStart,
        edgeOnly,
      });
    let rowIndex = 0;
    const emit = (row: HullContact, feature: PedVector): HullContact => ({
      ...row,
      points: row.points.map((point) => three(transform(bOld, vector(point)))),
      pointsB: [three(transform(bOld, feature))],
      normal: three(rotate(bOld, vector(row.normal))),
      sourceSurface: surface.sourceSurface ?? surface,
    });
    if (rows[0]?.contactTypes?.[0] === 3) {
      const hit = nativeSphereWorldFaceSweep(sphere, face, start, end);
      if (!hit)
        throw new Error(
          "Moving world SPHERE finite feature reconstruction mismatch",
        );
      const motion = sub(end, start),
        t = hit.fraction,
        center: PedVector = [
          f(start[0] + f(motion[0] * t)),
          f(start[1] + f(motion[1] * t)),
          f(start[2] + f(motion[2] * t)),
        ],
        distance = f(dot(sub(face.a, center), hit.normal)),
        feature: PedVector = [
          f(center[0] + hit.normal[0] * distance),
          f(center[1] + hit.normal[1] * distance),
          f(center[2] + hit.normal[2] * distance),
        ],
        row = emit(rows[rowIndex++], feature);
      if (!best || row.fraction! < best.fraction!) best = row;
    }
    const flags = face.faceFlags ?? 0,
      vertices = [face.a, face.b, face.c];
    if (!(flags & 0x80))
      for (let i = 0; i < 3; i++) {
        if (flags & (1 << i)) continue;
        const hit = nativeSphereEdgeSweep(
          vertices[i],
          vertices[(i + 1) % 3],
          sphere,
          start,
          end,
        );
        if (!hit) continue;
        const row = rows[rowIndex++];
        if (
          !row ||
          row.contactTypes?.[0] !== 4 ||
          row.fraction !== hit.fraction ||
          !hit.point
        )
          throw new Error(
            "Moving world SPHERE edge feature reconstruction mismatch",
          );
        edges.push(emit(row, hit.point));
      }
    if (rowIndex !== rows.length)
      throw new Error("Moving world SPHERE unconsumed source feature rows");
  }
  return best ? [best, ...edges] : edges;
}
