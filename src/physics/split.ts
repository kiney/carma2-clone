import { Box3, BufferAttribute, BufferGeometry, Matrix4, Vector3 } from "three";
import { dominantCrushAxis } from "./crush";
import { updateModelNormals } from "../render-geometry";
import type { ContactImpact } from "./contact";

export interface SplitPlane {
  normal: Vector3;
  constant: number;
}
/** Decoded GENERAL.TXT splitting block, lines26..29. */
export const ORIGINAL_SPLIT_SETTINGS = Object.freeze({
  minimumForceXZPerTonne: 2.5,
  minimumForceYPerTonne: 2.5,
  minimumDamage: 50,
  maximumDamage: 100,
});
export interface RoofSplitCandidate {
  contacts: ContactImpact[];
  contactIndices: number[];
  totalImpulse: number;
  threshold: number;
  splitY: number;
}
/**42df20 runs only after XZ-edge splitting fails. A car's complete qualifying
 * world-contact group must lie above its authored cut; mixed heights reject
 * the group rather than selecting just its roof contacts. */
export function findRoofSplitContactCandidate(
  contacts: readonly ContactImpact[],
  input: {
    driver: number;
    objectType: number;
    snappability: number;
    softness: number;
    splitY: number;
    immune: boolean;
    snapped: boolean;
    minimumForcePerTonne?: number;
  },
): RoofSplitCandidate | undefined {
  if (
    input.driver <= 5 ||
    input.objectType !== 1 ||
    input.immune ||
    input.snapped ||
    !(input.snappability > 0) ||
    !(input.softness > 0)
  )
    return;
  const eligible = contacts
    .slice(0, 40)
    .map((contact, index) => ({ contact, index }))
    .filter(({ contact }) => !contact.b && contact.normalImpulse >= 0.01);
  if (!eligible.length) return;
  const first = eligible[0].contact;
  const own = eligible.filter(({ contact }) => contact.a === first.a);
  const orientation = first.a.state.orientation.clone().conjugate();
  for (const { contact } of own) {
    const local = contact.point
      .clone()
      .sub(first.a.state.position)
      .applyQuaternion(orientation);
    if (local.y < input.splitY) return;
  }
  const threshold =
    (first.a.properties.mass *
      (input.minimumForcePerTonne ??
        ORIGINAL_SPLIT_SETTINGS.minimumForceYPerTonne)) /
    (input.snappability * input.softness);
  const totalImpulse = own.reduce(
    (sum, { contact }) => sum + contact.normalImpulse,
    0,
  );
  if (!(totalImpulse > threshold)) return;
  return {
    contacts: own.map(({ contact }) => contact),
    contactIndices: own.map(({ index }) => index),
    totalImpulse,
    threshold,
    splitY: input.splitY,
  };
}
const HULL_GAP = 0.007246376946568489;
const MODEL_JITTER = 0.02898551;
const pack = (value: number, min: number, max: number) =>
  Math.trunc(
    ((Math.max(min, Math.min(max, value)) - min) * 65535) / (max - min) + 0.5,
  ) *
    (max - min) *
    Math.fround(1 / 65535) +
  min;

/** 430cd0 snaps endpoints to a nearly .02-unit grid, including outside tests. */
function snapEndpoint(
  value: number,
  min: number,
  max: number,
): number | undefined {
  const count = Math.trunc((max - min) / 0.02 + 0.5) || 1;
  const step = (max - min) / count;
  const index = Math.trunc(
    (value - min) / step + ((value - min) / step > 0 ? 0.5 : -0.5),
  );
  return index >= 0 && index <= count ? min + index * step : undefined;
}

/** Source430730 validates a contact's XZ plane, or the authored horizontal
 * split. Its X branch deliberately samples bbox Y, as the installed binary
 * does. Orient the retained half toward the authored WAM driver point. */
export function validateSplitPlane(input: {
  normal: Vector3;
  constant: number;
  bounds: Box3;
  modelBounds: Box3;
  driver: Vector3;
  horizontalY?: number;
  bent?: boolean;
  snapped?: boolean;
}): SplitPlane | undefined {
  if (
    input.bent ||
    input.snapped ||
    input.bounds.isEmpty() ||
    input.modelBounds.isEmpty()
  )
    return;
  const { bounds, normal, constant } = input;
  const size = bounds.getSize(new Vector3());
  let output: SplitPlane | undefined;
  if (input.horizontalY !== undefined) {
    const y = snapEndpoint(input.horizontalY, bounds.min.y, bounds.max.y);
    if (y !== undefined) output = { normal: new Vector3(0, 1, 0), constant: y };
  } else {
    if (Math.abs(normal.x) > 0.001) {
      const first = snapEndpoint(
        (constant - normal.z * bounds.min.y) / normal.x,
        bounds.min.x,
        bounds.max.x,
      );
      const second = snapEndpoint(
        (constant - normal.z * bounds.max.y) / normal.x,
        bounds.min.x,
        bounds.max.x,
      );
      if (
        first !== undefined &&
        second !== undefined &&
        (first + second) / 2 >= bounds.min.x + 0.25 * size.x &&
        (first + second) / 2 <= bounds.max.x - 0.25 * size.x
      ) {
        const n = new Vector3(-size.y, 0, second - first).normalize();
        output = { normal: n, constant: n.x * first + n.z * bounds.min.y };
      }
    }
    if (!output && Math.abs(normal.z) > 0.001) {
      const first = snapEndpoint(
        (constant - normal.x * bounds.min.x) / normal.z,
        bounds.min.z,
        bounds.max.z,
      );
      const second = snapEndpoint(
        (constant - normal.x * bounds.max.x) / normal.z,
        bounds.min.z,
        bounds.max.z,
      );
      if (
        first !== undefined &&
        second !== undefined &&
        (first + second) / 2 >= bounds.min.z + 0.25 * size.z &&
        (first + second) / 2 <= bounds.max.z - 0.25 * size.z
      ) {
        const n = new Vector3(second - first, 0, -size.x).normalize();
        output = { normal: n, constant: n.x * bounds.min.x + n.z * first };
      }
    }
  }
  if (!output) return;
  const axis = dominantCrushAxis(
    output.normal.toArray() as [number, number, number],
  );
  const center = input.modelBounds.getCenter(new Vector3());
  center.setComponent(axis, 0);
  const crossing =
    (output.constant - output.normal.dot(center)) /
    output.normal.getComponent(axis);
  if (
    crossing < input.modelBounds.min.getComponent(axis) + 0.05797101557 ||
    crossing > input.modelBounds.max.getComponent(axis) - 0.05797101557
  )
    return;
  if (output.normal.dot(input.driver) - output.constant < 0) {
    output.normal.negate();
    output.constant = -output.constant;
  }
  output.normal.set(
    pack(output.normal.x, -1, 1),
    pack(output.normal.y, -1, 1),
    pack(output.normal.z, -1, 1),
  );
  output.constant = pack(output.constant, -2.5, 2.5);
  // The original does not renormalize after its uint16 network round trip.
  return output;
}

/** 430310/430550 split the convex vertex cloud and duplicate crossed edges
 * with opposite .007246-unit plane offsets. Counts below four mean no hull. */
export function splitHull(
  vertices: readonly Vector3[],
  edges: readonly (readonly [number, number])[],
  plane: SplitPlane,
) {
  const positive: Vector3[] = [],
    negative: Vector3[] = [];
  const distances = vertices.map(
    (point) => plane.normal.dot(point) - plane.constant,
  );
  vertices.forEach((point, index) =>
    (distances[index] > 0 ? positive : negative).push(point.clone()),
  );
  for (const [a, b] of edges) {
    if (
      distances[a] > 0 === distances[b] > 0 ||
      positive.length >= 16 ||
      negative.length >= 16
    )
      continue;
    const high = distances[a] > 0 ? a : b,
      low = high === a ? b : a;
    const denominator = distances[low] - distances[high];
    positive.push(
      vertices[high]
        .clone()
        .lerp(vertices[low], -(distances[high] - HULL_GAP) / denominator),
    );
    negative.push(
      vertices[high]
        .clone()
        .lerp(vertices[low], -(distances[high] + HULL_GAP) / denominator),
    );
  }
  return {
    positive: positive.length >= 4 ? positive : [],
    negative: negative.length >= 4 ? negative : [],
  };
}

export interface SplitProperties {
  mass: number;
  centerOfMass: Vector3;
  inertia: Vector3;
}
/** Source42e230 partitions the authored inertial data about its dominant-axis
 * center crossing; geometric volume is not used. Inertia is about each COM. */
export function splitProperties(
  original: SplitProperties,
  bounds: Box3,
  plane: SplitPlane,
) {
  const axis = dominantCrushAxis(
    plane.normal.toArray() as [number, number, number],
  );
  const point = bounds.getCenter(new Vector3()).setComponent(axis, 0);
  const cut =
    (plane.constant - plane.normal.dot(point)) /
    plane.normal.getComponent(axis);
  const lower = bounds.min.getComponent(axis),
    upper = bounds.max.getComponent(axis);
  const a = cut - lower,
    b = upper - cut,
    c = original.centerOfMass.getComponent(axis) - lower;
  const lowOffset = (c * a) / (a + b);
  const balance = (a - lowOffset) * a;
  const lowMass = (original.mass * balance) / (lowOffset * b + balance);
  const highMass = original.mass - lowMass;
  const lowCenter = original.centerOfMass
    .clone()
    .setComponent(axis, Math.min(lower + lowOffset, cut - 0.01449275389));
  const highCenter = original.centerOfMass
    .clone()
    .setComponent(
      axis,
      Math.max(lower + (c * b) / (a + b) + a, cut + 0.01449275389),
    );
  const orbital =
    lowMass *
      (lowCenter.getComponent(axis) -
        original.centerOfMass.getComponent(axis)) **
        2 +
    highMass *
      (highCenter.getComponent(axis) -
        original.centerOfMass.getComponent(axis)) **
        2;
  const intrinsic = original.inertia.clone();
  for (let i = 0; i < 3; i++)
    if (i !== axis)
      intrinsic.setComponent(i, intrinsic.getComponent(i) - orbital);
  const low = {
    mass: lowMass,
    centerOfMass: lowCenter,
    inertia: intrinsic.clone().multiplyScalar(lowMass / original.mass),
  };
  const high = {
    mass: highMass,
    centerOfMass: highCenter,
    inertia: intrinsic.clone().multiplyScalar(highMass / original.mass),
  };
  return plane.normal.getComponent(axis) >= 0
    ? { positive: high, negative: low }
    : { positive: low, negative: high };
}

interface Corner {
  point: Vector3;
  uv: [number, number];
  key: string;
}
/** HW42f520 clips existing faces, keeping winding/UVs/material groups and an
 * open cut seam. A crossed authored edge gets one shared random intersection
 * in both halves. This is deliberately not an added artificial cap surface. */
export function splitModelGeometry(
  geometry: BufferGeometry,
  toCar: Matrix4,
  plane: SplitPlane,
  random: () => number = Math.random,
) {
  const positions = geometry.getAttribute("position"),
    uvs = geometry.getAttribute("uv");
  const indices = geometry.index;
  const sourceIndices = geometry.userData.sourceVertexIndices as
    | Uint32Array
    | undefined;
  const inverse = toCar.clone().invert();
  const intersections = new Map<string, Corner>();
  const positive = new Map<number, Corner[]>(),
    negative = new Map<number, Corner[]>();
  const positiveMasks = new Map<
      number,
      { smoothing: number; flags: number }[]
    >(),
    negativeMasks = new Map<number, { smoothing: number; flags: number }[]>();
  const getCorner = (index: number): Corner => ({
    point: new Vector3()
      .fromBufferAttribute(positions, index)
      .applyMatrix4(toCar),
    uv: uvs ? [uvs.getX(index), uvs.getY(index)] : [0, 0],
    key: String(sourceIndices?.[index] ?? index),
  });
  const intersection = (first: Corner, second: Corner) => {
    const firstDist = plane.normal.dot(first.point) - plane.constant;
    const high = firstDist > 0 ? first : second,
      low = high === first ? second : first;
    const key = high.key + ":" + low.key;
    let crossing = intersections.get(key);
    if (!crossing) {
      const highDist = plane.normal.dot(high.point) - plane.constant;
      const lowDist = plane.normal.dot(low.point) - plane.constant;
      const fraction = Math.max(
        0.0001,
        Math.min(
          0.9999,
          Math.abs(
            (lowDist + (2 * random() - 1) * MODEL_JITTER) /
              (highDist - lowDist),
          ),
        ),
      );
      crossing = {
        point: low.point.clone().lerp(high.point, fraction),
        uv: [
          low.uv[0] + (high.uv[0] - low.uv[0]) * fraction,
          low.uv[1] + (high.uv[1] - low.uv[1]) * fraction,
        ],
        key,
      };
      intersections.set(key, crossing);
    }
    return crossing;
  };
  const count = indices?.count ?? positions.count;
  const groups = geometry.groups.length
    ? geometry.groups
    : [{ start: 0, count, materialIndex: 0 }];
  for (const group of groups) {
    const material = group.materialIndex ?? 0;
    for (let face = group.start; face < group.start + group.count; face += 3) {
      const corners = [0, 1, 2].map((corner) =>
        getCorner(indices ? indices.getX(face + corner) : face + corner),
      );
      const sourceFace =
        geometry.userData.sourceFaces?.[
          Math.floor((indices ? indices.getX(face) : face) / 3)
        ];
      for (const [keepPositive, output, masks] of [
        [true, positive, positiveMasks],
        [false, negative, negativeMasks],
      ] as const) {
        const polygon: Corner[] = [];
        for (let i = 0; i < 3; i++) {
          const first = corners[i],
            second = corners[(i + 1) % 3];
          const inside =
            plane.normal.dot(first.point) - plane.constant > 0 === keepPositive;
          const nextInside =
            plane.normal.dot(second.point) - plane.constant > 0 ===
            keepPositive;
          if (inside) polygon.push(first);
          if (inside !== nextInside) polygon.push(intersection(first, second));
        }
        let outputCorners = output.get(material);
        if (!outputCorners) output.set(material, (outputCorners = []));
        let outputMasks = masks.get(material);
        if (!outputMasks) masks.set(material, (outputMasks = []));
        for (let i = 1; i + 1 < polygon.length; i++) {
          outputCorners.push(polygon[0], polygon[i], polygon[i + 1]);
          outputMasks.push({
            smoothing: sourceFace?.smoothing ?? 0,
            flags: sourceFace?.flags ?? 0,
          });
        }
      }
    }
  }
  const build = (
    output: Map<number, Corner[]>,
    masks: Map<number, { smoothing: number; flags: number }[]>,
  ) => {
    const result = new BufferGeometry(),
      points: number[] = [],
      uv: number[] = [];
    const sourceFaces: {
      indices: number[];
      smoothing: number;
      flags: number;
      material: number;
    }[] = [];
    for (const [material, corners] of output) {
      const start = points.length / 3;
      for (const corner of corners) {
        const point = corner.point.clone().applyMatrix4(inverse);
        points.push(point.x, point.y, point.z);
        uv.push(...corner.uv);
      }
      if (corners.length) result.addGroup(start, corners.length, material);
      masks.get(material)?.forEach((mask, index) =>
        sourceFaces.push({
          indices: [
            start + index * 3,
            start + index * 3 + 1,
            start + index * 3 + 2,
          ],
          ...mask,
          material,
        }),
      );
    }
    result.setAttribute(
      "position",
      new BufferAttribute(Float32Array.from(points), 3),
    );
    result.setAttribute("uv", new BufferAttribute(Float32Array.from(uv), 2));
    result.setAttribute(
      "normal",
      new BufferAttribute(new Float32Array(points.length), 3),
    );
    result.userData.sourcePositions = Float32Array.from(points);
    result.userData.sourceVertexIndices = Uint32Array.from(
      { length: points.length / 3 },
      (_, index) => index,
    );
    result.userData.sourceFaces = sourceFaces;
    updateModelNormals(result);
    result.computeBoundingBox();
    result.computeBoundingSphere();
    return result;
  };
  return {
    positive: build(positive, positiveMasks),
    negative: build(negative, negativeMasks),
  };
}
