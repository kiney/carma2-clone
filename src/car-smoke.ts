import { Mesh, Object3D, Vector3 } from "three";
import type { DatFace, DatModel } from "./formats";

const f32 = Math.fround;
type SourceModel = Pick<DatModel, "positions" | "faces">;
type PreparedSourceModel = Pick<
  DatModel,
  "positions" | "uvs" | "faces" | "flags"
>;
export interface CarPreparedOptions {
  /** Actual resolved native material addresses, keyed by DAT face material ID.
   * Zero is the native NULL face material, even with an inherited actor MAT. */
  materialPointers?: ReadonlyMap<number, number>;
  /** Only supply when BR_MODF_CREASE and its source angle are known. */
  creaseCos?: number;
}
export interface ModelPreparedOptions extends CarPreparedOptions {}

export interface NativePreparedVertexGroup {
  /** Offset in the single contiguous prepared vertex allocation. */
  start: number;
  count: number;
  /** More than one DAT ID may resolve to the same actual native MAT pointer. */
  materialIndices: number[];
}
export interface CarSmokeSamplerOptions extends CarPreparedOptions {
  /** Native car_actor: the browser principal model ACT, not its mesh child. */
  principalActor?: Object3D;
  modelPivot?: Vector3;
  /** Installed 0x7590ec is program_state.cockpit_on. This is a live provider. */
  cockpit?: () => { enabled: boolean; driver: number; driverZOffset: number };
}

/** LoadCar consumes the first resolution-independent line after this marker
 * as driver XYZ; preceding variable cockpit fields come from a separate file. */
export function parseNativeDriverZOffset(text: string): number | undefined {
  if (text.length > 1024 * 1024) return;
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length > 20_000) return;
  const data = lines.map((line) => line.replace(/\/\/.*$/, "").trim());
  const marker = data.indexOf("START OF DRIVABLE STUFF");
  if (marker < 0) return;
  const line = data.slice(marker + 1).find((line) => line.length !== 0);
  if (!line) return;
  const parts = line.split(/[\s,]+/);
  const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[Ee][+-]?\d+)?$/;
  if (parts.length !== 3 || !parts.every((part) => numeric.test(part))) return;
  const values = parts.map((part) => f32(Number(part)));
  if (!values.every(Number.isFinite)) return;
  return values[2];
}

/** Independent reconstruction of installed CRT qsort (0x575aa0). Equal-key
 * ordering matters because smoothing accumulates Float32 normals in this order.
 * Small partitions select the first strict maximum and swap it to the end. */
function nativeSort<T>(values: T[], compare: (a: T, b: T) => number): void {
  const swap = (a: number, b: number) => {
    [values[a], values[b]] = [values[b], values[a]];
  };
  const pending: Array<[number, number]> = [[0, values.length - 1]];
  while (pending.length) {
    const [low, high] = pending.pop()!;
    if (high <= low) continue;
    if (high - low + 1 <= 8) {
      for (let end = high; end > low; end--) {
        let maximum = low;
        for (let i = low + 1; i <= end; i++)
          if (compare(values[i], values[maximum]) > 0) maximum = i;
        swap(maximum, end);
      }
      continue;
    }
    swap(low, low + Math.floor((high - low + 1) / 2));
    let left = low,
      right = high + 1;
    for (;;) {
      do {
        left++;
      } while (left <= high && compare(values[left], values[low]) <= 0);
      do {
        right--;
      } while (right > low && compare(values[right], values[low]) >= 0);
      if (right < left) break;
      swap(left, right);
    }
    swap(low, right);
    if (low + 1 < right) pending.push([low, right - 1]);
    if (left < high) pending.push([left, high]);
  }
}
function xyz(a: Vector3, b: Vector3): number {
  return a.x - b.x || a.y - b.y || a.z - b.z;
}
function planeNormal(a: Vector3, b: Vector3, c: Vector3): Vector3 {
  const u = b.clone().sub(a),
    v = c.clone().sub(a);
  u.set(f32(u.x), f32(u.y), f32(u.z));
  v.set(f32(v.x), f32(v.y), f32(v.z));
  const n = u.cross(v);
  n.set(f32(n.x), f32(n.y), f32(n.z));
  const length = Math.sqrt(f32(n.x * n.x + n.y * n.y + n.z * n.z));
  // Installed BrPlaneEquation 0x5366bb explicitly handles zero length.
  if (length === 0) n.set(0, 0, 1);
  else n.multiplyScalar(1 / length);
  const clamp = (x: number) =>
    f32(x < -1 ? -0.9999998807907104 : x >= 1 ? 1 : x);
  return n.set(clamp(n.x), clamp(n.y), clamp(n.z));
}

/** Installed DONT_WELD preparation sorts material pointer, source vertex ID,
 * then unnormalized smoothing sum (0x520030). The normalized render normal
 * cannot determine either the native split count or ordering. */
export function prepareNativeCarVertexOrder(
  model: SourceModel,
  options: CarPreparedOptions = {},
) {
  // Installed car loading forces BR_MODF_DONT_WELD before model preparation.
  // Keep this API independent of the original DAT's own flags and UV presence.
  return prepareVertexOrder(model, options, true);
}

/** Installed generic model preparation: flags bit1 selects 520030 DONT_WELD;
 * otherwise 51ff20 compares material, XYZ/UV (only when source IDs differ),
 * then unnormalized smoothing sums. Original positive MAT addresses remain an
 * explicit provider; without them only NULL-first/single-material order is
 * authoritative. This shares the independent CRT sort and smoothing with cars.
 * It returns one contiguous allocation order, including all material groups;
 * a first-group smoke index can intentionally reach a following group's vertex.
 * Prepared model pivot subtraction is a separate caller-owned provider. */
export function prepareNativeModelVertexOrder(
  model: PreparedSourceModel,
  options: ModelPreparedOptions = {},
) {
  if (
    !model ||
    !Number.isInteger(model.flags) ||
    model.flags < 0 ||
    model.flags > 0xffff
  )
    throw new Error("Invalid native model flags");
  if (!model.uvs || model.uvs.length !== (model.positions.length / 3) * 2)
    throw new Error("Invalid native model source UV count");
  if (!Array.from(model.uvs).every(Number.isFinite))
    throw new Error("Invalid native model source UV");
  if (model.positions.length / 3 > 0xffff || model.faces.length > 0xffff)
    throw new Error("Native model source exceeds 16-bit counts");
  if ((model.flags & 0x100) !== 0 && options.creaseCos === undefined)
    throw new Error("Missing native model crease cosine provider");
  return prepareVertexOrder(
    model,
    {
      ...options,
      creaseCos: (model.flags & 0x100) !== 0 ? options.creaseCos : undefined,
    },
    (model.flags & 1) !== 0,
    model.uvs,
  );
}

function prepareVertexOrder(
  model: SourceModel,
  options: CarPreparedOptions,
  dontWeld: boolean,
  uvs?: Float32Array,
) {
  if (model.positions.length % 3 !== 0)
    throw new Error("Invalid car source positions");
  const points: Vector3[] = [];
  for (let i = 0; i < model.positions.length; i += 3) {
    const point = new Vector3(...model.positions.subarray(i, i + 3));
    if (!point.toArray().every(Number.isFinite))
      throw new Error("Invalid car source position");
    points.push(point);
  }
  const materials = [...new Set(model.faces.map((face) => face.material))];
  let materialOrder:
    | "native-null-first"
    | "single-material"
    | "native-pointers"
    | "browser-first-approximation";
  let selected: number[];
  const rank = new Map<number, number>();
  if (options.materialPointers) {
    const pointers = options.materialPointers;
    const address = (material: number) => {
      const pointer = material === 0 ? 0 : pointers.get(material);
      if (
        pointer === undefined ||
        !Number.isInteger(pointer) ||
        pointer < 0 ||
        pointer > 0xffffffff
      )
        throw new Error("Missing native car material pointer");
      return pointer;
    };
    const minimum = Math.min(...materials.map(address));
    selected = materials.filter((material) => address(material) === minimum);
    for (const material of materials) rank.set(material, address(material));
    materialOrder = "native-pointers";
  } else if (materials.includes(0)) {
    selected = [0];
    materialOrder = "native-null-first";
  } else {
    selected = materials.slice(0, 1);
    materialOrder =
      materials.length <= 1 ? "single-material" : "browser-first-approximation";
  }
  if (!options.materialPointers) {
    const order = materials.includes(0)
      ? [0, ...materials.filter((material) => material !== 0)]
      : materials;
    order.forEach((material, i) => rank.set(material, i));
  }
  if (options.creaseCos !== undefined && !Number.isFinite(options.creaseCos))
    throw new Error("Invalid car crease cosine");
  const normals = model.faces.map((face) => {
    if (
      face.indices.length !== 3 ||
      !Number.isInteger(face.material) ||
      face.material < 0 ||
      !Number.isInteger(face.smoothing) ||
      face.smoothing < 0 ||
      face.smoothing > 0xffff ||
      face.indices.some(
        (i) => !Number.isInteger(i) || i < 0 || i >= points.length,
      )
    )
      throw new Error("Invalid car source face");
    return planeNormal(
      ...(face.indices.map((i) => points[i]) as [Vector3, Vector3, Vector3]),
    );
  });
  const corners = model.faces.flatMap((face, faceIndex) =>
    face.indices.map((source, corner) => ({
      source,
      faceIndex,
      corner: faceIndex * 3 + corner,
      sum: new Vector3(),
    })),
  );
  nativeSort(corners, (a, b) =>
    a.source === b.source ? 0 : xyz(points[a.source], points[b.source]),
  );
  const mask = (face: DatFace) =>
    face.smoothing === 0 ? 0xffff : face.smoothing & 0xffff;
  for (let start = 0; start < corners.length; ) {
    let end = start + 1;
    while (
      end < corners.length &&
      xyz(points[corners[start].source], points[corners[end].source]) === 0
    )
      end++;
    for (let i = start; i < end; i++) {
      const outer = corners[i],
        outerNormal = normals[outer.faceIndex];
      for (let j = start; j < end; j++) {
        const inner = corners[j],
          normal = normals[inner.faceIndex];
        if (
          i !== j &&
          (!(
            mask(model.faces[outer.faceIndex]) &
            mask(model.faces[inner.faceIndex])
          ) ||
            (options.creaseCos !== undefined &&
              !(normal.dot(outerNormal) > options.creaseCos)))
        )
          continue;
        outer.sum.set(
          f32(outer.sum.x + normal.x),
          f32(outer.sum.y + normal.y),
          f32(outer.sum.z + normal.z),
        );
      }
    }
    start = end;
  }
  const materialRank = (faceIndex: number) =>
    rank.get(model.faces[faceIndex].material)!;
  const compare = (
    a: (typeof corners)[number],
    b: (typeof corners)[number],
  ) => {
    const material = materialRank(a.faceIndex) - materialRank(b.faceIndex);
    if (material) return material;
    if (dontWeld) return a.source - b.source || xyz(a.sum, b.sum);
    if (a.source !== b.source) {
      const position = xyz(points[a.source], points[b.source]);
      if (position) return position;
      const mapping =
        uvs![2 * a.source] - uvs![2 * b.source] ||
        uvs![2 * a.source + 1] - uvs![2 * b.source + 1];
      if (mapping) return mapping;
    }
    return xyz(a.sum, b.sum);
  };
  nativeSort(corners, compare);
  const distinct = corners.filter(
    (corner, i) => i === 0 || compare(corner, corners[i - 1]) !== 0,
  );
  const groups: NativePreparedVertexGroup[] = [];
  for (let start = 0; start < distinct.length; ) {
    const pointerRank = materialRank(distinct[start].faceIndex);
    let end = start + 1;
    while (
      end < distinct.length &&
      materialRank(distinct[end].faceIndex) === pointerRank
    )
      end++;
    groups.push({
      start,
      count: end - start,
      materialIndices: materials.filter(
        (material) => rank.get(material) === pointerRank,
      ),
    });
    start = end;
  }
  return {
    welding: dontWeld ? ("dont-weld" as const) : ("weld" as const),
    groups,
    materialOrder,
    materialIndices: selected,
    remainingMaterialOrder:
      options.materialPointers ||
      materials.filter((material) => material !== 0).length <= 1
        ? ("known-order" as const)
        : ("browser-positive-material-approximation" as const),
    firstGroupCount: distinct.filter((corner) =>
      selected.includes(model.faces[corner.faceIndex].material),
    ).length,
    // Installed 0x4fbef7 indexes the contiguous allocation from group0.vertices;
    // raw wreck indices can extend past group0.nvertices into later groups.
    corners: distinct.map((corner) => corner.corner),
    sourceVertexIndices: distinct.map((corner) => corner.source),
  };
}

/** Capture prepared order before crush; sample live prepared positions.
 * Native mode 1 adds ONLY car_actor translation before the column/master ACT.
 * The returned point remains local to `actor`, for SmokeSystem's final map. */
export function prepareCarSmokeSampler(
  mesh: Mesh,
  actor: Object3D,
  options: CarSmokeSamplerOptions = {},
) {
  const geometry = mesh.geometry;
  const positions = geometry.getAttribute("position"),
    normals = geometry.getAttribute("normal");
  const sources = geometry.userData.sourceVertexIndices as
    | Uint32Array
    | undefined;
  if (!positions || !normals || normals.count !== positions.count)
    throw new Error("Car smoke requires principal model positions and normals");
  if (sources && sources.length !== positions.count)
    throw new Error("Invalid car smoke source vertex mapping");
  const faces = geometry.userData.sourceFaces as DatFace[] | undefined;
  const original = geometry.userData.sourcePositions as
    | Float32Array
    | undefined;
  let indices: number[],
    materialOrder:
      | ReturnType<typeof prepareNativeCarVertexOrder>["materialOrder"]
      | "render-only-approximation";
  let firstGroupCount: number;
  let remainingMaterialOrder:
    | ReturnType<typeof prepareNativeCarVertexOrder>["remainingMaterialOrder"]
    | "render-only-approximation";
  if (faces && original && sources && positions.count === faces.length * 3) {
    const prepared = prepareNativeCarVertexOrder(
      { positions: original, faces },
      options,
    );
    indices = prepared.corners;
    materialOrder = prepared.materialOrder;
    firstGroupCount = prepared.firstGroupCount;
    remainingMaterialOrder = prepared.remainingMaterialOrder;
  } else {
    materialOrder = "render-only-approximation";
    const group = geometry.groups[0],
      start = group?.start ?? 0;
    const count = group?.count ?? geometry.index?.count ?? positions.count;
    const seen = new Set<number>();
    indices = [];
    for (let corner = start; corner < start + count; corner++) {
      const index = geometry.index?.getX(corner) ?? corner;
      if (!Number.isInteger(index) || index < 0 || index >= positions.count)
        throw new Error("Invalid car smoke group vertex index");
      if (!seen.has(index)) {
        seen.add(index);
        indices.push(index);
      }
    }
    const compare = (a: number, b: number) =>
      (sources?.[a] ?? a) - (sources?.[b] ?? b) ||
      normals.getX(a) - normals.getX(b) ||
      normals.getY(a) - normals.getY(b) ||
      normals.getZ(a) - normals.getZ(b);
    indices.sort(compare);
    indices = indices.filter(
      (index, i) => i === 0 || compare(index, indices[i - 1]) !== 0,
    );
    firstGroupCount = indices.length;
    remainingMaterialOrder = "render-only-approximation";
  }
  const principal = options.principalActor ?? mesh.parent ?? actor;
  return {
    count: indices.length,
    sourceVertexIndices: indices.map((index) => sources?.[index] ?? index),
    materialOrder,
    firstGroupCount,
    remainingMaterialOrder,
    sample(index: number, out: Vector3) {
      if (!Number.isInteger(index) || index < 0 || index >= indices.length)
        return false;
      if (principal.matrixAutoUpdate) principal.updateMatrix();
      out.fromBufferAttribute(positions, indices[index]);
      if (options.modelPivot) out.sub(options.modelPivot);
      const raw = out.clone(),
        e = principal.matrix.elements;
      out.set(f32(out.x + e[12]), f32(out.y + e[13]), f32(out.z + e[14]));
      const cockpit = options.cockpit?.();
      if (cockpit?.enabled && cockpit.driver === 8) {
        if (!Number.isFinite(cockpit.driverZOffset))
          throw new Error("Invalid car smoke driver offset");
        // 0x4fbfcd–0x4fc014: compare translated Z with source head Z−double(-.2).
        if (out.z < f32(cockpit.driverZOffset) - -0.2) {
          out.copy(raw).applyMatrix4(principal.matrix);
          out.set(f32(out.x), f32(out.y), f32(out.z));
        } else out.y = f32(out.y - 0.07);
      }
      return out.toArray().every(Number.isFinite);
    },
  };
}
