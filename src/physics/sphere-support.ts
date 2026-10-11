/** Finite sphere support recovery for the final trajectory guard only.
 * This bounded Float32 safety extension is not installed PHIL contact response.
 * See docs/c2-sphere-support-re.md. */
import type { PedVector } from "../ped-form";
import type { HullContact } from "./geometry";
import {
  nativeSphereCenters,
  nativeSphereWorldContacts,
  type NativeSphereBodyPose,
  type NativeSphereWorldFace,
} from "./sphere-contact";

const f = Math.fround;
/** Hard ceiling for this extension, independent of absolute world coordinates.
 * This is deliberately much smaller than PHIL's .002 face acceptance band. */
export const SPHERE_SUPPORT_RADIUS_FRACTION = 1 / 4096;

function ulp(value: number): number {
  const magnitude = Math.abs(f(value));
  return magnitude < 2 ** -126
    ? 2 ** -149
    : 2 ** (Math.floor(Math.log2(magnitude)) - 23);
}
function dot(a: PedVector, b: PedVector): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function mapVector(
  input: PedVector,
  map: (value: number, axis: number) => number,
): [number, number, number] {
  return [map(input[0], 0), map(input[1], 1), map(input[2], 2)];
}

/** Full ULPs bound half-ULP storage errors plus representable outward reprojection.
 * Count native root/model stores, rotation/translation stores, and plane/radius
 * stores. Project each coordinate error through the frozen packed face normal;
 * a large irrelevant X coordinate cannot inflate a horizontal floor's bound. */
function shellAllowance(
  input: NativeSphereBodyPose,
  start: PedVector,
  normal: PedVector,
  constant: number,
  distance: number,
): number {
  const model = input.sphere.center.map(f),
    m = Array.from(input.oldPose, f);
  let bound = ulp(input.sphere.radius) + ulp(constant) + ulp(distance);
  for (let axis = 0; axis < 3; axis++) {
    let rotation = 0,
      error = ulp(m[9 + axis]) + ulp(start[axis]);
    for (let row = 0; row < 3; row++) {
      const basis = m[row * 3 + axis];
      rotation += basis * model[row];
      error +=
        Math.abs(model[row]) * ulp(basis) + Math.abs(basis) * ulp(model[row]);
    }
    error += ulp(rotation);
    bound += Math.abs(normal[axis]) * error;
  }
  // Bound the live double sum's arithmetic independently of Float32 stores.
  bound +=
    Number.EPSILON *
    8 *
    (Math.abs(constant) +
      normal.reduce((sum, n, axis) => sum + Math.abs(n * start[axis]), 0));
  return Math.min(
    bound,
    f(input.sphere.radius) * SPHERE_SUPPORT_RADIUS_FRACTION,
  );
}

function nextFloat(value: number, positive: boolean): number {
  const data = new DataView(new ArrayBuffer(4));
  data.setFloat32(0, value, true);
  if (value === 0) return positive ? 2 ** -149 : -(2 ** -149);
  const bits = data.getUint32(0, true);
  data.setUint32(0, bits + (value > 0 === positive ? 1 : -1), true);
  return data.getFloat32(0, true);
}

/** Return ONLY shallow finite-face recovery rows, in supplied source face order.
 * Append to the final guard's ordinary rows, never to worldContacts/impulses.
 * The actual OLD pose remains untouched, including emitted OLD torque points.
 * Deep OLD overlap, resting/outward motion and new nonpenetrating motion reject.
 */
export function recoverNativeSphereSupport(
  input: NativeSphereBodyPose,
  faces: readonly NativeSphereWorldFace[],
): HullContact[] {
  if (faces.length > 65535)
    throw new Error("Sphere support: source uint16 cached face span exceeded");
  const centers = nativeSphereCenters(input),
    radius = f(input.sphere.radius),
    result: HullContact[] = [];
  for (const face of faces) {
    const normal = mapVector(face.normal, f),
      constant = f(face.constant),
      signed = f(dot(normal, centers.old) - constant),
      side = signed < 0 ? -1 : 1,
      distance = side * signed,
      deficit = radius - distance;
    const normalSquared = dot(normal, normal);
    if (
      !Number.isFinite(constant) ||
      Math.abs(normalSquared - 1) > 0.0001 ||
      !Number.isFinite(normalSquared)
    )
      throw new Error("Sphere support: finite authored unit plane required");
    if (!(deficit > 0)) continue;
    const allowance = shellAllowance(
      input,
      centers.old,
      normal,
      constant,
      distance,
    );
    if (!(deficit <= allowance)) continue;
    const outward = mapVector(normal, (n) => n * side),
      motion = mapVector(
        centers.predicted,
        (value, axis) => value - centers.old[axis],
      ),
      endDistance = side * (dot(normal, centers.predicted) - constant);
    if (!(dot(outward, motion) < 0 && endDistance < radius)) continue;

    const projected = mapVector(centers.old, (value, axis) =>
      f(
        value +
          (outward[axis] * (nextFloat(radius, true) - distance)) /
            normalSquared,
      ),
    );
    let dominant = 0;
    for (let axis = 1; axis < 3; axis++)
      if (Math.abs(outward[axis]) > Math.abs(outward[dominant]))
        dominant = axis;
    // The initial orthogonal projection may round back into the shell. Advance
    // the dominant coordinate by representable values, bounded by the same
    // error allowance. Never move a physical pose or replace the native face test.
    for (let attempt = 0; attempt < 8; attempt++) {
      const remaining = radius - side * f(dot(normal, projected) - constant);
      if (!(remaining > 0)) break;
      // Jump by the remaining plane deficit, rather than walking potentially
      // millions of tiny coordinate ULPs near zero after plane cancellation.
      let next = f(projected[dominant] + remaining / outward[dominant]);
      if (next === projected[dominant])
        next = nextFloat(projected[dominant], outward[dominant] > 0);
      if (!Number.isFinite(next) || next === projected[dominant]) break;
      projected[dominant] = next;
      if (
        dot(
          outward,
          mapVector(projected, (v, i) => v - centers.old[i]),
        ) > allowance
      )
        break;
    }
    // Nonconvergent or over-budget reprojections conservatively return no row.
    const displacement = dot(
      outward,
      mapVector(projected, (v, i) => v - centers.old[i]),
    );
    if (
      side * f(dot(normal, projected) - constant) < radius ||
      !(displacement > 0 && displacement <= allowance)
    )
      continue;
    const rows = nativeSphereWorldContacts(input, [face], {
      placementStart: projected,
    });
    for (const row of rows)
      if (row.contactTypes?.[0] === 3)
        result.push({ ...row, fraction: 0, measures: [0] });
  }
  return result;
}
