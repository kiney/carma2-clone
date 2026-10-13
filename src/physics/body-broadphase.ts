import { Box3 } from "three";

export interface BroadphaseBody {
  readonly properties: { readonly immovable?: boolean };
}

/** Per-call work counters. Omit the argument in normal runtime. */
export interface BodyBroadphaseDiagnostics {
  bodies: number;
  movable: number;
  immovable: number;
  exceptionalBounds: number;
  staticRebuilds: number;
  nodeTests: number;
  candidates: number;
  boundsTests: number;
  pairs: number;
}

interface StaticSnapshot {
  body: BroadphaseBody;
  index: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}
interface BoundsNode {
  bounds: Box3;
  indices?: number[];
  left?: BoundsNode;
  right?: BoundsNode;
}

function ordinaryBounds(box: Box3): boolean {
  return (
    Number.isFinite(box.min.x) &&
    Number.isFinite(box.min.y) &&
    Number.isFinite(box.min.z) &&
    Number.isFinite(box.max.x) &&
    Number.isFinite(box.max.y) &&
    Number.isFinite(box.max.z) &&
    !box.isEmpty()
  );
}

function unchanged(snapshot: StaticSnapshot, box: Box3): boolean {
  return (
    Object.is(snapshot.minX, box.min.x) &&
    Object.is(snapshot.minY, box.min.y) &&
    Object.is(snapshot.minZ, box.min.z) &&
    Object.is(snapshot.maxX, box.max.x) &&
    Object.is(snapshot.maxY, box.max.y) &&
    Object.is(snapshot.maxZ, box.max.z)
  );
}

/** Balanced median AABB tree: no cell-size tuning or large-bound cell expansion. */
function buildTree(
  indices: number[],
  bounds: readonly Box3[],
): BoundsNode | undefined {
  if (!indices.length) return undefined;
  const union = new Box3();
  for (const index of indices) union.union(bounds[index]);
  if (indices.length <= 4) return { bounds: union, indices };
  const extent = union.max.clone().sub(union.min);
  const axis =
    extent.x >= extent.y && extent.x >= extent.z
      ? "x"
      : extent.y >= extent.z
        ? "y"
        : "z";
  // Half before adding, so even finite bounds near Number.MAX_VALUE stay finite.
  const center = (index: number) =>
    bounds[index].min[axis] * 0.5 + bounds[index].max[axis] * 0.5;
  indices.sort((a, b) => {
    const ca = center(a),
      cb = center(b);
    return ca < cb ? -1 : ca > cb ? 1 : a - b;
  });
  const middle = Math.floor(indices.length / 2);
  return {
    bounds: union,
    left: buildTree(indices.slice(0, middle), bounds),
    right: buildTree(indices.slice(middle), bounds),
  };
}

/** Discovers precisely the i<j pairs selected by immovability and Box3 overlap.
 * Bounds must correspond by index and remain immutable for this synchronous call.
 * No callback, mask, attachment-root or identity deduplication semantics live here.
 * Returned pairs have the original nested-loop i-then-j order.
 *
 * Static reuse checks every supplied component, index and body identity each call;
 * in-place edits, wake-up, replacement and reorder therefore cannot stale the tree.
 * A moving tree is rebuilt each phase. Verification is O(B); median-sort tree
 * construction is O(K log² K) for K entries (static construction only on change).
 * Queries visit intersecting tree nodes; output ordering is O(P log P), without
 * static/static discovery. Storage is O(B + P), excluding temporary build slices.
 * Dense overlap can still produce quadratic output. Exceptional boxes conservatively
 * scan eligible bodies to preserve Three's exact NaN/infinity/inverted-box semantics.
 * An incident set restricts discovery to pairs touching that set: changed moving
 * bodies query both trees, while changed fixed bodies query only moving bodies.
 * The full roster still validates the static tree and supplies potential neighbors.
 */
export class BodyBroadphase {
  private snapshots: StaticSnapshot[] = [];
  private staticTree?: BoundsNode;
  private exceptionalStatic: number[] = [];

  pairs<Body extends BroadphaseBody>(
    bodies: readonly Body[],
    bounds: readonly Box3[],
    diagnostics?: BodyBroadphaseDiagnostics,
    incidentBodies?: ReadonlySet<Body>,
  ): [number, number][] {
    if (bodies.length !== bounds.length)
      throw new Error("Body broadphase requires one bound per body");
    if (diagnostics)
      Object.assign(diagnostics, {
        bodies: bodies.length,
        movable: 0,
        immovable: 0,
        exceptionalBounds: 0,
        staticRebuilds: 0,
        nodeTests: 0,
        candidates: 0,
        boundsTests: 0,
        pairs: 0,
      });
    const moving: number[] = [],
      ordinaryMoving: number[] = [],
      exceptionalMoving: number[] = [];
    const incident: number[] | undefined = incidentBodies ? [] : undefined;
    let staticCount = 0,
      rebuild = false;
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      if (incidentBodies?.has(body)) incident!.push(i);
      if (body.properties.immovable) {
        const old = this.snapshots[staticCount++];
        if (
          !old ||
          old.body !== body ||
          old.index !== i ||
          !unchanged(old, bounds[i])
        )
          rebuild = true;
      } else {
        moving.push(i);
        (ordinaryBounds(bounds[i]) ? ordinaryMoving : exceptionalMoving).push(
          i,
        );
      }
    }
    if (staticCount !== this.snapshots.length) rebuild = true;
    if (rebuild) {
      const ordinaryStatic: number[] = [];
      this.snapshots = [];
      this.exceptionalStatic = [];
      for (let i = 0; i < bodies.length; i++) {
        if (!bodies[i].properties.immovable) continue;
        const box = bounds[i];
        this.snapshots.push({
          body: bodies[i],
          index: i,
          minX: box.min.x,
          minY: box.min.y,
          minZ: box.min.z,
          maxX: box.max.x,
          maxY: box.max.y,
          maxZ: box.max.z,
        });
        (ordinaryBounds(box) ? ordinaryStatic : this.exceptionalStatic).push(i);
      }
      this.staticTree = buildTree(ordinaryStatic, bounds);
      if (diagnostics) diagnostics.staticRebuilds++;
    }
    if (diagnostics) {
      diagnostics.movable = moving.length;
      diagnostics.immovable = staticCount;
      diagnostics.exceptionalBounds =
        exceptionalMoving.length + this.exceptionalStatic.length;
    }
    const movingTree =
      incident?.length === 0 ? undefined : buildTree(ordinaryMoving, bounds);
    const pairs: [number, number][] = [];
    const check = (source: number, target: number, movingTarget: boolean) => {
      if (incidentBodies) {
        // Either dirty endpoint may discover this pair. Let its lower dirty
        // index own it; an unchanged lower endpoint must still be discovered.
        if (
          target === source ||
          (target < source && incidentBodies.has(bodies[target]))
        )
          return;
      } else if (movingTarget && target <= source) return;
      const i = Math.min(source, target),
        j = Math.max(source, target);
      if (diagnostics) {
        diagnostics.candidates++;
        diagnostics.boundsTests++;
      }
      if (bounds[i].intersectsBox(bounds[j])) pairs.push([i, j]);
    };
    const query = (
      node: BoundsNode | undefined,
      source: number,
      movingTarget: boolean,
      ordinary: boolean,
    ) => {
      if (!node) return;
      if (ordinary) {
        if (diagnostics) diagnostics.nodeTests++;
        if (!bounds[source].intersectsBox(node.bounds)) return;
      }
      if (node.indices) {
        for (const target of node.indices) check(source, target, movingTarget);
      } else {
        query(node.left, source, movingTarget, ordinary);
        query(node.right, source, movingTarget, ordinary);
      }
    };
    for (const source of incident ?? moving) {
      const ordinary = ordinaryBounds(bounds[source]);
      const movingSource = !bodies[source].properties.immovable;
      if (movingSource) query(this.staticTree, source, false, ordinary);
      query(movingTree, source, true, ordinary);
      if (movingSource)
        for (const target of this.exceptionalStatic)
          check(source, target, false);
      for (const target of exceptionalMoving) check(source, target, true);
    }
    pairs.sort(([ai, aj], [bi, bj]) => ai - bi || aj - bj);
    if (diagnostics) diagnostics.pairs = pairs.length;
    return pairs;
  }
}
