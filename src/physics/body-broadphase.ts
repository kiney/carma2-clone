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
  movingRebuilds: number;
  qualityRebuilds: number;
  boundsChanges: number;
  treeRefits: number;
  nodeTests: number;
  candidates: number;
  boundsTests: number;
  pairs: number;
}

interface SlotSnapshot {
  body: BroadphaseBody;
  immovable: boolean;
  ordinary: boolean;
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
  parent?: BoundsNode;
  dirty: boolean;
  span: number;
  relativeCost: number;
}
interface PersistentTree {
  root?: BoundsNode;
  leaves: Map<number, BoundsNode>;
  quality: number;
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

function unchanged(snapshot: SlotSnapshot, box: Box3): boolean {
  return (
    Object.is(snapshot.minX, box.min.x) &&
    Object.is(snapshot.minY, box.min.y) &&
    Object.is(snapshot.minZ, box.min.z) &&
    Object.is(snapshot.maxX, box.max.x) &&
    Object.is(snapshot.maxY, box.max.y) &&
    Object.is(snapshot.maxZ, box.max.z)
  );
}

function snapshot(
  body: BroadphaseBody,
  box: Box3,
  immovable: boolean,
  ordinary: boolean,
  existing?: SlotSnapshot,
): SlotSnapshot {
  if (existing) {
    existing.body = body;
    existing.immovable = immovable;
    existing.ordinary = ordinary;
    existing.minX = box.min.x;
    existing.minY = box.min.y;
    existing.minZ = box.min.z;
    existing.maxX = box.max.x;
    existing.maxY = box.max.y;
    existing.maxZ = box.max.z;
    return existing;
  }
  return {
    body,
    immovable,
    ordinary,
    minX: box.min.x,
    minY: box.min.y,
    minZ: box.min.z,
    maxX: box.max.x,
    maxY: box.max.y,
    maxZ: box.max.z,
  };
}

function updateCost(node: BoundsNode): void {
  // Half-widths stay finite even at opposite finite extremes. Child spans
  // cannot exceed their parent's, so these ratios and aggregate stay bounded.
  const { min, max } = node.bounds;
  const span = Math.max(
    max.x * 0.5 - min.x * 0.5,
    max.y * 0.5 - min.y * 0.5,
    max.z * 0.5 - min.z * 0.5,
  );
  node.span = span;
  node.relativeCost =
    span > 0
      ? 1 +
        (node.left ? node.left.relativeCost * (node.left.span / span) : 0) +
        (node.right ? node.right.relativeCost * (node.right.span / span) : 0)
      : 1;
}

function quality(root: BoundsNode | undefined): number {
  return root?.relativeCost ?? 1;
}

/** Balanced median topology with retained per-roster-slot leaf membership. */
function buildTree(indices: number[], bounds: readonly Box3[]): PersistentTree {
  const leaves = new Map<number, BoundsNode>();
  const build = (
    entries: number[],
    parent?: BoundsNode,
  ): BoundsNode | undefined => {
    if (!entries.length) return undefined;
    const union = new Box3();
    for (const index of entries) union.union(bounds[index]);
    const node: BoundsNode = {
      bounds: union,
      parent,
      dirty: false,
      span: 0,
      relativeCost: 1,
    };
    if (entries.length <= 4) {
      node.indices = entries;
      for (const index of entries) leaves.set(index, node);
    } else {
      const extent = union.max.clone().sub(union.min);
      const axis =
        extent.x >= extent.y && extent.x >= extent.z
          ? "x"
          : extent.y >= extent.z
            ? "y"
            : "z";
      const center = (index: number) =>
        bounds[index].min[axis] * 0.5 + bounds[index].max[axis] * 0.5;
      entries.sort((a, b) => {
        const ca = center(a),
          cb = center(b);
        return ca < cb ? -1 : ca > cb ? 1 : a - b;
      });
      const middle = Math.floor(entries.length / 2);
      node.left = build(entries.slice(0, middle), node);
      node.right = build(entries.slice(middle), node);
    }
    updateCost(node);
    return node;
  };
  const root = build(indices);
  return { root, leaves, quality: quality(root) };
}

function markChanged(tree: PersistentTree, index: number): void {
  let node = tree.leaves.get(index);
  while (node && !node.dirty) {
    node.dirty = true;
    node = node.parent;
  }
}

function refit(
  node: BoundsNode | undefined,
  bounds: readonly Box3[],
  diagnostics?: BodyBroadphaseDiagnostics,
): void {
  if (!node?.dirty) return;
  if (node.indices) {
    node.bounds.makeEmpty();
    for (const index of node.indices) node.bounds.union(bounds[index]);
  } else {
    refit(node.left, bounds, diagnostics);
    refit(node.right, bounds, diagnostics);
    node.bounds.copy(node.left!.bounds).union(node.right!.bounds);
  }
  updateCost(node);
  node.dirty = false;
  if (diagnostics) diagnostics.treeRefits++;
}

/** Discovers precisely the i<j pairs selected by immovability and Box3 overlap.
 * Bounds correspond by index and remain immutable during this synchronous call.
 * No mask, attachment-root or identity deduplication semantics live here.
 * Returned pairs have the original nested-loop i-then-j order.
 *
 * Every roster slot and all six exact bound components are validated each call,
 * including nonincident bodies and repeated identities. Both trees retain their
 * median topology until roster/classification/exceptional membership changes.
 * Changed leaves and ancestors refit before queries. Measured aggregate node
 * span relative to root span triggers a rebuild at 1.75x its build-time quality,
 * preventing prolonged degeneration after spatial rearrangement/teleports.
 * Validation is O(B), refitting O(changed ancestors), and rebuild construction
 * O(K log² K). Dense output can still be quadratic; sorting costs O(P log P).
 * Exceptional boxes scan eligible bodies to preserve Three's exact semantics.
 * Incident discovery queries both trees for moving sources, and moving only for
 * fixed sources, while validating/refitting the complete roster first.
 */
export class BodyBroadphase {
  private snapshots: SlotSnapshot[] = [];
  private staticTree: PersistentTree = buildTree([], []);
  private movingTree: PersistentTree = buildTree([], []);
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
        movingRebuilds: 0,
        qualityRebuilds: 0,
        boundsChanges: 0,
        treeRefits: 0,
        nodeTests: 0,
        candidates: 0,
        boundsTests: 0,
        pairs: 0,
      });
    const moving: number[] = [],
      ordinaryMoving: number[] = [],
      ordinaryStatic: number[] = [],
      exceptionalMoving: number[] = [];
    this.exceptionalStatic = [];
    const incident: number[] | undefined = incidentBodies ? [] : undefined;
    let rebuildStatic = false,
      rebuildMoving = false;
    // Validate every slot before any query, even with an empty incident set.
    for (let i = 0; i < Math.max(bodies.length, this.snapshots.length); i++) {
      const old = this.snapshots[i];
      const body = bodies[i];
      if (!body) {
        if (old.immovable) rebuildStatic = true;
        else rebuildMoving = true;
        continue;
      }
      const box = bounds[i];
      const immovable = Boolean(body.properties.immovable);
      const ordinary = ordinaryBounds(box);
      if (incidentBodies?.has(body)) incident!.push(i);
      if (immovable)
        (ordinary ? ordinaryStatic : this.exceptionalStatic).push(i);
      else {
        moving.push(i);
        (ordinary ? ordinaryMoving : exceptionalMoving).push(i);
      }
      const metadataChanged =
        !old ||
        old.body !== body ||
        old.immovable !== immovable ||
        old.ordinary !== ordinary;
      const boundsChanged = !old || !unchanged(old, box);
      if (metadataChanged) {
        if (old?.immovable || immovable) rebuildStatic = true;
        if ((old && !old.immovable) || !immovable) rebuildMoving = true;
      }
      if (boundsChanged) {
        if (diagnostics) diagnostics.boundsChanges++;
        if (ordinary && !metadataChanged)
          markChanged(immovable ? this.staticTree : this.movingTree, i);
      }
      if (metadataChanged || boundsChanged)
        this.snapshots[i] = snapshot(body, box, immovable, ordinary, old);
    }
    this.snapshots.length = bodies.length;
    const update = (
      tree: PersistentTree,
      entries: number[],
      rebuild: boolean,
      isStatic: boolean,
    ): PersistentTree => {
      if (!rebuild) {
        refit(tree.root, bounds, diagnostics);
        if (quality(tree.root) > tree.quality * 1.75) {
          rebuild = true;
          if (diagnostics) diagnostics.qualityRebuilds++;
        }
      }
      if (!rebuild) return tree;
      if (diagnostics) {
        if (isStatic) diagnostics.staticRebuilds++;
        else diagnostics.movingRebuilds++;
      }
      return buildTree(entries, bounds);
    };
    this.staticTree = update(
      this.staticTree,
      ordinaryStatic,
      rebuildStatic,
      true,
    );
    this.movingTree = update(
      this.movingTree,
      ordinaryMoving,
      rebuildMoving,
      false,
    );
    if (diagnostics) {
      diagnostics.movable = moving.length;
      diagnostics.immovable = bodies.length - moving.length;
      diagnostics.exceptionalBounds =
        exceptionalMoving.length + this.exceptionalStatic.length;
    }
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
      if (movingSource) query(this.staticTree.root, source, false, ordinary);
      query(this.movingTree.root, source, true, ordinary);
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
