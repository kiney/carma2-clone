import { Vector3 as V3 } from "three";
import type { Surface } from "./world";

export interface FaceIndexDiagnostics {
  nodeTests?: number;
  leafTests?: number;
  indexBuilds?: number;
  faceBoundsBuilds?: number;
  candidateReferences?: number;
  returnedFaces?: number;
}

type Bounds = readonly [number, number, number, number, number, number];
interface IndexNode {
  bounds: Bounds;
  left?: IndexNode;
  right?: IndexNode;
  indices?: number[];
}
interface ArrayIndex {
  root: IndexNode;
}

const faceBounds = new WeakMap<Surface, Bounds>();
const arrayIndexes = new WeakMap<readonly Surface[], ArrayIndex>();
const LINEAR_LIMIT = 16;
const LEAF_SIZE = 8;
const EPSILON_SCALE = 32 * Number.EPSILON;

function add(
  diagnostics: FaceIndexDiagnostics | undefined,
  key: keyof FaceIndexDiagnostics,
  value = 1,
) {
  if (diagnostics) diagnostics[key] = (diagnostics[key] ?? 0) + value;
}

function makeFaceBounds(surface: Surface): Bounds {
  const points = [surface.a, surface.b, surface.c];
  const values = points.flatMap((point) => [point.x, point.y, point.z]);
  if (!values.every(Number.isFinite))
    return [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity];

  const rounded = values.map(Math.fround);
  if (!rounded.every(Number.isFinite))
    return [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity];
  // Keep both the source doubles used by ordinary Three.js ray tests and the
  // f32 vertices used by native/batched paths. The padding also covers small
  // barycentric differences at shared edges and vertices.
  const min = [
    Math.min(
      values[0],
      values[3],
      values[6],
      rounded[0],
      rounded[3],
      rounded[6],
    ),
    Math.min(
      values[1],
      values[4],
      values[7],
      rounded[1],
      rounded[4],
      rounded[7],
    ),
    Math.min(
      values[2],
      values[5],
      values[8],
      rounded[2],
      rounded[5],
      rounded[8],
    ),
  ];
  const max = [
    Math.max(
      values[0],
      values[3],
      values[6],
      rounded[0],
      rounded[3],
      rounded[6],
    ),
    Math.max(
      values[1],
      values[4],
      values[7],
      rounded[1],
      rounded[4],
      rounded[7],
    ),
    Math.max(
      values[2],
      values[5],
      values[8],
      rounded[2],
      rounded[5],
      rounded[8],
    ),
  ];
  const maxAbs = Math.max(1, ...values.map(Math.abs), ...rounded.map(Math.abs));
  const padding = min.map(
    (value, axis) => 2 * 0.0001 * (max[axis] - value) + EPSILON_SCALE * maxAbs,
  );
  const result: Bounds = [
    min[0] - padding[0],
    min[1] - padding[1],
    min[2] - padding[2],
    max[0] + padding[0],
    max[1] + padding[1],
    max[2] + padding[2],
  ];
  return result.every(Number.isFinite)
    ? result
    : [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity];
}

function unionBounds(
  indices: readonly number[],
  bounds: readonly Bounds[],
): Bounds {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const index of indices) {
    const b = bounds[index];
    minX = Math.min(minX, b[0]);
    minY = Math.min(minY, b[1]);
    minZ = Math.min(minZ, b[2]);
    maxX = Math.max(maxX, b[3]);
    maxY = Math.max(maxY, b[4]);
    maxZ = Math.max(maxZ, b[5]);
  }
  return [minX, minY, minZ, maxX, maxY, maxZ];
}

function intersects(a: Bounds, b: Bounds): boolean {
  for (let axis = 0; axis < 3; axis++) {
    const lo = axis,
      hi = axis + 3;
    if (a[lo] === -Infinity || a[hi] === Infinity) continue;
    const scale = Math.max(
      Math.abs(a[lo]),
      Math.abs(a[hi]),
      Math.abs(b[lo]),
      Math.abs(b[hi]),
    );
    const tolerance = EPSILON_SCALE * scale;
    if (a[hi] + tolerance < b[lo] || b[hi] + tolerance < a[lo]) return false;
  }
  return true;
}

function makeNode(indices: number[], bounds: readonly Bounds[]): IndexNode {
  const nodeBounds = unionBounds(indices, bounds);
  if (indices.length <= LEAF_SIZE) return { bounds: nodeBounds, indices };

  const spans = [
    nodeBounds[3] - nodeBounds[0],
    nodeBounds[4] - nodeBounds[1],
    nodeBounds[5] - nodeBounds[2],
  ];
  const axis =
    spans[1] > spans[0] && spans[1] >= spans[2]
      ? 1
      : spans[2] > spans[0] && spans[2] > spans[1]
        ? 2
        : 0;
  const high = axis + 3;
  indices.sort(
    (a, b) =>
      bounds[a][axis] + bounds[a][high] - (bounds[b][axis] + bounds[b][high]),
  );
  const middle = indices.length >>> 1;
  return {
    bounds: nodeBounds,
    left: makeNode(indices.slice(0, middle), bounds),
    right: makeNode(indices.slice(middle), bounds),
  };
}

/** Ordered conservative face lookup for immutable cell snapshots. */
export class OrderedWorldFaceIndex {
  /** Drop a cell snapshot after its membership is changed in place. */
  invalidate(rows: readonly Surface[]): void {
    arrayIndexes.delete(rows);
  }

  query(
    rows: readonly Surface[],
    min: V3,
    max: V3,
    diagnostics?: FaceIndexDiagnostics,
  ): Surface[] {
    const queryBounds: Bounds = [min.x, min.y, min.z, max.x, max.y, max.z];
    if (!queryBounds.every(Number.isFinite)) {
      add(diagnostics, "candidateReferences", rows.length);
      add(diagnostics, "returnedFaces", rows.length);
      return [...rows];
    }

    let cached = arrayIndexes.get(rows);
    if (!cached) {
      const bounds = rows.map((surface) => {
        let result = faceBounds.get(surface);
        if (!result) {
          result = makeFaceBounds(surface);
          faceBounds.set(surface, result);
          add(diagnostics, "faceBoundsBuilds");
        }
        return result;
      });
      const root =
        rows.length >= LINEAR_LIMIT
          ? makeNode(
              rows.map((_, index) => index),
              bounds,
            )
          : {
              bounds: unionBounds(
                rows.map((_, index) => index),
                bounds,
              ),
              indices: rows.map((_, index) => index),
            };
      cached = { root };
      arrayIndexes.set(rows, cached);
      add(diagnostics, "indexBuilds");
    }

    const matches: number[] = [];
    const visit = (node: IndexNode) => {
      add(diagnostics, "nodeTests");
      if (!intersects(node.bounds, queryBounds)) return;
      if (node.indices) {
        add(diagnostics, "leafTests", node.indices.length);
        for (const index of node.indices) {
          add(diagnostics, "candidateReferences");
          const bounds = faceBounds.get(rows[index])!;
          if (intersects(bounds, queryBounds)) matches.push(index);
        }
        return;
      }
      if (node.left) visit(node.left);
      if (node.right) visit(node.right);
    };
    visit(cached.root);
    matches.sort((a, b) => a - b);
    add(diagnostics, "returnedFaces", matches.length);
    return matches.map((index) => rows[index]);
  }
}
