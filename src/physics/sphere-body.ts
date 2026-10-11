import { Box3, Matrix4, Quaternion, Vector3 } from "three";
import type { RigidBody, Contact } from "./contact";
import { hullsBounds, type CollisionHull } from "./geometry";
import type { NativePedBoneBody } from "./ped-bone-body";
import type { PedVector } from "../ped-form";
import type { Surface } from "../world";
import {
  nativeSphereSphereContact,
  nativeSphereTargetContacts,
  nativeSphereWorldContacts,
  selectNativeSpherePairContacts,
  type NativeSphereBodyPose,
  type NativeSpherePairContact,
  type NativeSphereTargetShape,
  type NativeSphereWorldFace,
} from "./sphere-contact";

type ShapedBody = RigidBody & { hulls: CollisionHull[] };
export function isNativePedBoneBody(
  body: RigidBody,
): body is NativePedBoneBody {
  return "kind" in body && body.kind === "pedestrian-bone";
}
export function isNativeSphereBody(
  body: RigidBody,
): body is NativePedBoneBody & {
  shape: Extract<NativePedBoneBody["shape"], { type: "SPHERE" }>;
} {
  return isNativePedBoneBody(body) && body.shape.type === "SPHERE";
}

/** Native row basis plus translation. The rigid adapter has already rejected
 * scale/shear; matrix stores, rather than quaternion components, are Float32. */
export function nativeRigidPose(
  position: Vector3,
  orientation: Quaternion,
): Float32Array {
  const a = new Matrix4().compose(
    position,
    orientation,
    new Vector3(1, 1, 1),
  ).elements;
  return new Float32Array([
    a[0],
    a[1],
    a[2],
    a[4],
    a[5],
    a[6],
    a[8],
    a[9],
    a[10],
    a[12],
    a[13],
    a[14],
  ]);
}
function bodyPose(body: RigidBody, predicted = false): Float32Array {
  return nativeRigidPose(
    predicted
      ? (body.state.predictedPosition ?? body.state.position)
      : body.state.position,
    predicted
      ? (body.state.predictedOrientation ?? body.state.orientation)
      : body.state.orientation,
  );
}
export function nativeSphereBodyPose(body: RigidBody): NativeSphereBodyPose {
  if (!isNativeSphereBody(body)) throw new Error("Native SPHERE body required");
  return {
    sphere: body.shape,
    oldPose: bodyPose(body),
    predictedPose: bodyPose(body, true),
  };
}
/** Source bounds, not a sampled sphere's vertices. This is also used by cached
 * face collection and automatic special-volume depth. */
export function nativeBodyLocalBounds(body: ShapedBody): Box3 {
  if (isNativePedBoneBody(body))
    return new Box3(
      new Vector3(...body.shape.bounds.min),
      new Vector3(...body.shape.bounds.max),
    );
  return hullsBounds(body.hulls);
}
export function nativeBodyWorldBounds(
  body: ShapedBody,
  position: Vector3,
  orientation: Quaternion,
): Box3 {
  if (isNativeSphereBody(body)) {
    const center = new Vector3(...body.shape.center)
        .applyQuaternion(orientation)
        .add(position),
      radius = new Vector3().setScalar(body.shape.radius);
    return new Box3(center.clone().sub(radius), center.add(radius));
  }
  return nativeBodyLocalBounds(body).applyMatrix4(
    new Matrix4().compose(position, orientation, new Vector3(1, 1, 1)),
  );
}
export function nativeSphereFace(surface: Surface): NativeSphereWorldFace {
  return {
    a: surface.a.toArray() as PedVector,
    b: surface.b.toArray() as PedVector,
    c: surface.c.toArray() as PedVector,
    normal: surface.normal.toArray() as PedVector,
    constant: Math.fround(surface.normal.dot(surface.a)),
    materialIdentifier: surface.material,
    materialFlags: surface.materialFlags,
    faceFlags: surface.faceFlags,
    faceFriction: surface.modifier.wallFriction,
    sourceSurface: surface,
  };
}
export function nativeSphereSurfaceContacts(
  input: NativeSphereBodyPose,
  surfaces: readonly Surface[],
) {
  // Edge-only connotation is per source face. Suppressing its face bit retains
  // its source edge flags and does not turn every adjacent face into a wire.
  return nativeSphereWorldContacts(
    input,
    surfaces.map((surface) => {
      const face = nativeSphereFace(surface);
      return surface.collisionMode === "edges"
        ? { ...face, materialIdentifier: ">" }
        : face;
    }),
  );
}

/** Current prepared feature order. Bounds alone do not identify an authored
 * BOX: crushed polygons keep their physical planes and vertex/edge storage. */
function targetShape(hull: CollisionHull): NativeSphereTargetShape {
  const box = hullsBounds([hull]);
  const bounds = {
    min: box.min.toArray() as PedVector,
    max: box.max.toArray() as PedVector,
  };
  if (hull.nativeType === "BOX") return { type: "BOX", bounds };
  const vertices = hull.vertices.map((v) => v.toArray() as PedVector);
  if (hull.nativeType === "WIRE" || hull.faces.length === 0)
    return { type: "WIRE", bounds, vertices, edges: hull.edges };
  return {
    type: hull.nativeType === "WIREPOLY" ? "WIREPOLY" : "POLY",
    bounds,
    vertices,
    edges: hull.edges,
    planes: hull.faces.map((plane) => ({
      normal: plane.normal.clone().negate().toArray() as PedVector,
      offset: plane.constant,
    })),
  };
}
export function nativeSpherePairRows(
  a: ShapedBody,
  b: ShapedBody,
): Array<Contact & { fraction: number }> {
  if (!isNativeSphereBody(a) && !isNativeSphereBody(b))
    throw new Error("Analytic pair requires at least one native SPHERE");
  const sphere = isNativeSphereBody(a) ? a : b,
    target = sphere === a ? b : a,
    input = nativeSphereBodyPose(sphere);
  if (isNativeSphereBody(target)) {
    const row = nativeSphereSphereContact(input, nativeSphereBodyPose(target));
    return row
      ? [
          {
            a: sphere,
            b: target,
            point: row.points[0],
            pointB: row.pointsB?.[0],
            normal: row.normal,
            sourceType: 7,
            penetration: row.penetration,
            fraction: row.fraction ?? 0,
          },
        ]
      : [];
  }
  const hits: NativeSpherePairContact[] = [];
  for (const hull of target.hulls)
    hits.push(
      ...nativeSphereTargetContacts(input, {
        shape: targetShape(hull),
        oldPose: bodyPose(target),
        predictedPose: bodyPose(target, true),
      }),
    );
  // 425c00 compares normals after accounting for source object reversal. Only
  // then restore 426920's target-first face/edge rows for the shared solver.
  return selectNativeSpherePairContacts(hits).map(
    (hit): Contact & { fraction: number } =>
      hit.sourceObjectOrder === "target-sphere"
        ? {
            a: target,
            b: sphere,
            point: hit.pointsB![0],
            pointB: hit.points[0],
            normal: hit.normal.clone().negate(),
            sourceType: hit.contactTypes![0],
            penetration: hit.penetration,
            fraction: hit.fraction ?? 0,
          }
        : {
            a: sphere,
            b: target,
            point: hit.points[0],
            pointB: hit.pointsB?.[0],
            normal: hit.normal,
            sourceType: hit.contactTypes![0],
            penetration: hit.penetration,
            fraction: hit.fraction ?? 0,
          },
  );
}
