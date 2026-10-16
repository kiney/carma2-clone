import type { CollisionHull } from "./geometry";

interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
interface Bounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}
interface Entry extends Bounds {
  slot: number;
}
interface Node extends Bounds {
  entries?: Entry[];
  left?: Node;
  right?: Node;
}
export interface EdgeFeatureDiagnostics {
  queries: number;
  edgesVisited: number;
  candidates: number;
  potentialEdges?: number;
}
const empty = (): Bounds => ({
  minX: Infinity,
  minY: Infinity,
  minZ: Infinity,
  maxX: -Infinity,
  maxY: -Infinity,
  maxZ: -Infinity,
});
function include(bounds: Bounds, point: Point | undefined): boolean {
  if (
    !point ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y) ||
    !Number.isFinite(point.z)
  )
    return false;
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.minZ = Math.min(bounds.minZ, point.z);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.maxY = Math.max(bounds.maxY, point.y);
  bounds.maxZ = Math.max(bounds.maxZ, point.z);
  return true;
}
function union(bounds: Bounds, other: Bounds) {
  bounds.minX = Math.min(bounds.minX, other.minX);
  bounds.minY = Math.min(bounds.minY, other.minY);
  bounds.minZ = Math.min(bounds.minZ, other.minZ);
  bounds.maxX = Math.max(bounds.maxX, other.maxX);
  bounds.maxY = Math.max(bounds.maxY, other.maxY);
  bounds.maxZ = Math.max(bounds.maxZ, other.maxZ);
}
function build(entries: Entry[]): Node {
  const bounds = empty();
  for (const entry of entries) union(bounds, entry);
  if (entries.length <= 8) return { ...bounds, entries };
  const extents = [
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ,
  ];
  const axis = extents.indexOf(Math.max(...extents));
  const center = (entry: Entry) =>
    axis === 0
      ? entry.minX * 0.5 + entry.maxX * 0.5
      : axis === 1
        ? entry.minY * 0.5 + entry.maxY * 0.5
        : entry.minZ * 0.5 + entry.maxZ * 0.5;
  entries.sort((a, b) => center(a) - center(b) || a.slot - b.slot);
  const middle = Math.floor(entries.length / 2);
  return {
    ...bounds,
    left: build(entries.slice(0, middle)),
    right: build(entries.slice(middle)),
  };
}

/** Conservative candidate discovery only. The quadratic feature solver remains
 * authoritative. Moving endpoints linearly interpolate inside their four-point
 * bounds; no source sweep extension belongs to the moving-edge feature family.
 * Small authored hulls use scalar scans; larger hulls share a median BVH across
 * their edge queries. Duplicate edges retain their distinct authored slots. */
export class EdgeFeatureIndex {
  private readonly all: number[];
  private readonly exceptional: number[] = [];
  private readonly bounds = empty();
  private readonly entries: Entry[] = [];
  private readonly root?: Node;
  constructor(
    vertices: readonly Point[],
    edges: readonly (readonly [number, number])[],
    nextVertices?: readonly Point[],
  ) {
    this.all = edges.map((_, slot) => slot);
    edges.forEach(([a, b], slot) => {
      const bounds = empty();
      if (
        !Number.isInteger(a) ||
        !Number.isInteger(b) ||
        !include(bounds, vertices[a]) ||
        !include(bounds, vertices[b]) ||
        (nextVertices &&
          (!include(bounds, nextVertices[a]) ||
            !include(bounds, nextVertices[b])))
      ) {
        this.exceptional.push(slot);
        return;
      }
      union(this.bounds, bounds);
      this.entries.push({ ...bounds, slot });
    });
    if (this.entries.length > 16) this.root = build(this.entries.slice());
  }
  query(
    oldStart: Point,
    oldEnd: Point,
    newStart: Point = oldStart,
    newEnd: Point = oldEnd,
    diagnostics?: EdgeFeatureDiagnostics,
  ): number[] {
    if (diagnostics) {
      diagnostics.queries++;
      diagnostics.potentialEdges =
        (diagnostics.potentialEdges ?? 0) + this.all.length;
    }
    const query = empty();
    const finish = (slots: number[]) => {
      if (diagnostics) diagnostics.candidates += slots.length;
      return slots;
    };
    const fallback = () => {
      if (diagnostics) diagnostics.edgesVisited += this.all.length;
      return finish(this.all.slice());
    };
    if (
      !include(query, oldStart) ||
      !include(query, oldEnd) ||
      !include(query, newStart) ||
      !include(query, newEnd)
    )
      return fallback();
    if (!this.entries.length) {
      if (diagnostics) diagnostics.edgesVisited += this.exceptional.length;
      return finish(this.exceptional.slice());
    }
    const extent = Math.max(
      1,
      Math.max(query.maxX, this.bounds.maxX) -
        Math.min(query.minX, this.bounds.minX),
      Math.max(query.maxY, this.bounds.maxY) -
        Math.min(query.minY, this.bounds.minY),
      Math.max(query.maxZ, this.bounds.maxZ) -
        Math.min(query.minZ, this.bounds.minZ),
    );
    const magnitude = Math.max(
      Math.abs(query.minX),
      Math.abs(query.minY),
      Math.abs(query.minZ),
      Math.abs(query.maxX),
      Math.abs(query.maxY),
      Math.abs(query.maxZ),
      Math.abs(this.bounds.minX),
      Math.abs(this.bounds.minY),
      Math.abs(this.bounds.minZ),
      Math.abs(this.bounds.maxX),
      Math.abs(this.bounds.maxY),
      Math.abs(this.bounds.maxZ),
    );
    // The existing solver can accept a slightly noncoplanar root: its linear
    // branch drops a coefficient at relative 1e-12 and the line parameters do
    // not subsequently test residual distance. Pad for that cubic coefficient
    // scale as well as coordinate cancellation, rather than applying a tight
    // geometric AABB test to numerically accepted roots. Extreme scales retain
    // every edge; this is a practical conservative envelope, not a new CCD gate.
    if (!Number.isFinite(extent) || extent > 1e4 || magnitude > 1e12)
      return fallback();
    const padding = 1e-6 * extent * extent * extent + 1e-10 * magnitude;
    const intersects = (bounds: Bounds) =>
      query.minX <= bounds.maxX + padding &&
      query.maxX >= bounds.minX - padding &&
      query.minY <= bounds.maxY + padding &&
      query.maxY >= bounds.minY - padding &&
      query.minZ <= bounds.maxZ + padding &&
      query.maxZ >= bounds.minZ - padding;
    const result = this.exceptional.slice();
    if (diagnostics) diagnostics.edgesVisited += this.exceptional.length;
    const inspect = (entries: Entry[]) => {
      for (const entry of entries) {
        if (diagnostics) diagnostics.edgesVisited++;
        if (intersects(entry)) result.push(entry.slot);
      }
    };
    const visit = (node: Node) => {
      if (!intersects(node)) return;
      if (node.entries) inspect(node.entries);
      else {
        visit(node.left!);
        visit(node.right!);
      }
    };
    if (this.root) visit(this.root);
    else inspect(this.entries);
    return finish(result.sort((a, b) => a - b));
  }
}

export function createEdgeFeatureIndex(
  vertices: readonly Point[],
  edges: readonly (readonly [number, number])[],
  nextVertices?: readonly Point[],
): EdgeFeatureIndex {
  return new EdgeFeatureIndex(vertices, edges, nextVertices);
}
const immutable = new WeakMap<CollisionHull, EdgeFeatureIndex>();
/** Mutable/custom sources rebuild from live coordinates and topology. Trust
 * identity only after checking the complete frozen edge/vertex graph once. */
export function getHullEdgeFeatureIndex(hull: CollisionHull): EdgeFeatureIndex {
  const cached = immutable.get(hull);
  if (cached) return cached;
  const index = createEdgeFeatureIndex(hull.vertices, hull.edges);
  if (
    Object.isFrozen(hull) &&
    Object.isFrozen(hull.vertices) &&
    hull.vertices.every(Object.isFrozen) &&
    Object.isFrozen(hull.edges) &&
    hull.edges.every(Object.isFrozen)
  )
    immutable.set(hull, index);
  return index;
}
