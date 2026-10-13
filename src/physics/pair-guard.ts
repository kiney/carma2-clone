import { Box3, Quaternion, Vector3 } from "three";
import type { RigidBody } from "./contact";
import {
  BodyBroadphase,
  type BodyBroadphaseDiagnostics,
} from "./body-broadphase";
import {
  isNativeSphereBody,
  nativeBodyWorldBounds,
  nativeSpherePairRows,
} from "./sphere-body";
import {
  hullBounds,
  hullPenetration,
  hullPenetrationExceeds,
  sweepHullsFraction,
  transformHull,
  type CollisionHull,
} from "./geometry";
import { hasImmutableCollisionHulls } from "./immutable-hulls";

export type HullBody = RigidBody & { hulls: CollisionHull[] };
/** Pure filter: spatial discovery omits calls for non-contacting pairs. */
export type BodyPairPredicate = (a: HullBody, b: HullBody) => boolean;
export interface GuardPose {
  position: Vector3;
  orientation: Quaternion;
}
export type PosePath = ((fraction: number) => GuardPose) & {
  /** Total travel bounds, needed when a path makes complete rotations. */
  angularTravel?: number;
  /** Existing world-sweep angular-rate heuristic, including driven ancestors.
   * Separate from the conservative pair-guard momentum bound above. */
  worldAngularSampling?: number;
  /** Pure poses and immutable source geometry for this synchronous guard phase.
   * Uncertified custom paths retain private samples and conservative bounds. */
  stable?: boolean;
  /** Captured constant pose; never infer stationarity from immovability alone. */
  constantPose?: GuardPose;
  /** Physical joints share time even when their contact masks exclude each other. */
  temporalGroup?: object;
  /** Conservative COM enclosure for parent-driven motion, including full turns. */
  centerBounds?: Box3;
};
const DEPTH_EPSILON = 1e-6;

/** Actual joint ancestry, including a flap attached to a detached roof. */
export function attachmentRoot(body: RigidBody): RigidBody {
  const visited = new Set<RigidBody>();
  while (!visited.has(body)) {
    visited.add(body);
    const joint =
      "joint" in body
        ? (body.joint as { parent: RigidBody } | undefined)
        : undefined;
    if (!joint) break;
    body = joint.parent;
  }
  return body;
}

function radius(body: HullBody) {
  if (isNativeSphereBody(body))
    return (
      new Vector3(...body.shape.center).distanceTo(
        body.properties.centerOfMass,
      ) + body.shape.radius
    );
  let result = 0;
  for (const hull of body.hulls)
    for (const vertex of hull.vertices)
      result = Math.max(
        result,
        vertex.distanceTo(body.properties.centerOfMass),
      );
  return result;
}
function at(body: HullBody, path: PosePath, fraction: number) {
  const pose = path(fraction);
  return body.hulls.map((hull) =>
    transformHull(hull, pose.position, pose.orientation),
  );
}

export interface BodyGuardDiagnostics extends BodyBroadphaseDiagnostics {
  hullTransforms: number;
  snapshotHits: number;
  pairGuardCalls: number;
  maskTests: number;
  maskRejected: number;
  attachmentPairs: number;
  dependencyMerges: number;
  revalidationCalls: number;
  conservativeFallbacks: number;
}
interface GeometrySnapshot {
  hulls: CollisionHull[];
  bounds: Box3[];
}
interface ImmutableSnapshot {
  source: CollisionHull[];
  pose: number[];
  geometry: GeometrySnapshot;
}
/** Only fixed producer-owned source shapes with exact constant poses survive
 * phases. Mutable crash shapes and all moving trajectories stay phase-local. */
class ImmutableGuardGeometry {
  private entries = new WeakMap<HullBody, ImmutableSnapshot>();
  get(body: HullBody, pose: GuardPose): GeometrySnapshot | undefined {
    const entry = this.entries.get(body);
    if (!entry || entry.source !== body.hulls) return;
    const p = pose.position,
      q = pose.orientation;
    return Object.is(p.x, entry.pose[0]) &&
      Object.is(p.y, entry.pose[1]) &&
      Object.is(p.z, entry.pose[2]) &&
      Object.is(q.x, entry.pose[3]) &&
      Object.is(q.y, entry.pose[4]) &&
      Object.is(q.z, entry.pose[5]) &&
      Object.is(q.w, entry.pose[6])
      ? entry.geometry
      : undefined;
  }
  set(body: HullBody, pose: GuardPose, geometry: GeometrySnapshot) {
    const p = pose.position,
      q = pose.orientation;
    this.entries.set(body, {
      source: body.hulls,
      pose: [p.x, p.y, p.z, q.x, q.y, q.z, q.w],
      geometry,
    });
  }
}
/** Moving geometry has phase lifetime. Persistent static reuse additionally
 * requires deep source immutability and an exact constant-pose certificate. */
class GuardWorkingSet {
  // Native fixed props have one explicit constant path for this phase. They
  // need one entry, not two nested maps and a time-sample map per prop.
  private constants = new Map<
    HullBody,
    { path: PosePath; geometry: GeometrySnapshot }
  >();
  private samples = new Map<
    HullBody,
    Map<PosePath, Map<number, GeometrySnapshot>>
  >();
  constructor(
    private diagnostics?: BodyGuardDiagnostics,
    private immutable?: ImmutableGuardGeometry,
  ) {}
  sample(body: HullBody, path: PosePath, fraction: number): GeometrySnapshot {
    if (body.properties.immovable && path.constantPose) {
      const old = this.constants.get(body);
      if (old?.path === path) {
        if (this.diagnostics) this.diagnostics.snapshotHits++;
        return old.geometry;
      }
      const pose = path.constantPose;
      const retain = hasImmutableCollisionHulls(body.hulls);
      let geometry = retain ? this.immutable?.get(body, pose) : undefined;
      if (geometry) {
        if (this.diagnostics) this.diagnostics.snapshotHits++;
      } else {
        geometry = {
          hulls: body.hulls.map((hull) =>
            transformHull(hull, pose.position, pose.orientation),
          ),
          bounds: [],
        };
        if (this.diagnostics)
          this.diagnostics.hullTransforms += body.hulls.length;
        if (retain) this.immutable?.set(body, pose, geometry);
      }
      this.constants.set(body, { path, geometry });
      return geometry;
    }
    const key = path.constantPose ? 0 : fraction;
    let paths = this.samples.get(body);
    if (!paths) this.samples.set(body, (paths = new Map()));
    let samples = paths.get(path);
    if (!samples) paths.set(path, (samples = new Map()));
    let value = samples.get(key);
    if (value) {
      if (this.diagnostics) this.diagnostics.snapshotHits++;
      return value;
    }
    const pose = path.constantPose ?? path(fraction);
    const retain =
      body.properties.immovable &&
      path.constantPose &&
      hasImmutableCollisionHulls(body.hulls);
    if (retain) value = this.immutable?.get(body, pose);
    if (value) {
      if (this.diagnostics) this.diagnostics.snapshotHits++;
      samples.set(key, value);
      return value;
    }
    value = {
      hulls: body.hulls.map((hull) =>
        transformHull(hull, pose.position, pose.orientation),
      ),
      bounds: [],
    };
    if (this.diagnostics) this.diagnostics.hullTransforms += body.hulls.length;
    if (retain) this.immutable?.set(body, pose, value);
    samples.set(key, value);
    return value;
  }
}

/** Independent commit safety guard, NOT an alternative impulse/damage solver.
 * The original feature emitter/normal equations remain authoritative. Verify
 * the actual post-solver integration path so exhausting recollection passes
 * cannot commit interlocking convex shapes. Existing overlap may escape.
 * CCD between short angular samples also catches a crossing with clear ends. */
export function guardPairTrajectory(
  a: HullBody,
  b: HullBody,
  pathA: PosePath,
  pathB: PosePath,
  pairAllowed?: BodyPairPredicate,
  workingSet?: GuardWorkingSet,
): number {
  if (pairAllowed && !pairAllowed(a, b)) return 1;
  if (isNativeSphereBody(a) || isNativeSphereBody(b))
    return guardSpherePairTrajectory(a, b, pathA, pathB);
  interface Sample {
    hulls: CollisionHull[];
    bounds: Box3[];
    depths: number[][];
  }
  const cacheA = new Map<number, Sample>(),
    cacheB = new Map<number, Sample>();
  const sample = (
    body: HullBody,
    path: PosePath,
    cache: Map<number, Sample>,
    t: number,
  ) => {
    let value = cache.get(t);
    if (!value) {
      const geometry =
        path.stable && workingSet
          ? workingSet.sample(body, path, t)
          : { hulls: at(body, path, t), bounds: [] };
      // Penetration and escape allowances belong to this pair alone.
      value = { ...geometry, depths: [] };
      cache.set(t, value);
    }
    return value;
  };
  const getA = (t: number) => sample(a, pathA, cacheA, t),
    getB = (t: number) => sample(b, pathB, cacheB, t);
  // Hulls/bounds may be shared in this immutable phase; depths stay private to
  // this pair. Source identity alone cannot validate crush/pedestrian geometry.
  // Auxiliary results live beside pose samples rather than a persistent cache.
  const bounds = (value: Sample, i: number) =>
    (value.bounds[i] ??= hullBounds(value.hulls[i]));
  const depthAt = (sa: Sample, sb: Sample, i: number, j: number) => {
    const row = (sa.depths[i] ??= []);
    return (row[j] ??= bounds(sa, i).intersectsBox(bounds(sb, j))
      ? hullPenetration(sa.hulls[i], sb.hulls[j])
      : 0);
  };
  let oldSampleA = getA(0),
    oldSampleB = getB(0);
  let oldA = oldSampleA.hulls,
    oldB = oldSampleB.hulls;
  let allowed = oldA.map((_, i) =>
    oldB.map((_, j) => depthAt(oldSampleA, oldSampleB, i, j)),
  );
  const travel = (path: PosePath) => {
    const poses = [0, 0.25, 0.5, 0.75, 1].map(path);
    return {
      poses,
      angle: Math.max(
        path.angularTravel ?? 0,
        poses
          .slice(1)
          .reduce(
            (sum, pose, i) =>
              sum + poses[i].orientation.angleTo(pose.orientation),
            0,
          ),
      ),
    };
  };
  const ta = travel(pathA),
    tb = travel(pathB);
  const relative = ta.poses.map((pose, i) =>
    pose.position.clone().sub(tb.poses[i].position),
  );
  const motion =
    relative
      .slice(1)
      .reduce((sum, value, i) => sum + value.distanceTo(relative[i]), 0) +
    ta.angle * radius(a) +
    tb.angle * radius(b);
  if (motion < 1e-12) return 1;
  const steps = Math.min(
    128,
    Math.max(
      1,
      Math.ceil(motion / 0.01),
      Math.ceil((ta.angle + tb.angle) / 0.025),
    ),
  );
  const exceeds = (t: number, retainDepth = false) => {
    const ha = getA(t),
      hb = getB(t);
    return ha.hulls.some((_, i) =>
      hb.hulls.some((_, j) => {
        const limit = allowed[i][j] + DEPTH_EPSILON;
        const known = ha.depths[i]?.[j];
        if (known !== undefined) return known > limit;
        // Positive old overlap needs an exact endpoint depth to lower its
        // escape allowance. Otherwise only the strict SAT predicate matters.
        if (retainDepth && allowed[i][j] > 0)
          return depthAt(ha, hb, i, j) > limit;
        return (
          bounds(ha, i).intersectsBox(bounds(hb, j)) &&
          hullPenetrationExceeds(ha.hulls[i], hb.hulls[j], limit)
        );
      }),
    );
  };
  let safe = 0;
  for (let step = 1; step <= steps; step++) {
    const end = step / steps,
      nextSampleA = getA(end),
      nextSampleB = getB(end),
      nextA = nextSampleA.hulls,
      nextB = nextSampleB.hulls;
    let blocked = exceeds(end, true) ? end : Infinity;
    const sweptA: Box3[] = [],
      sweptB: Box3[] = [];
    for (let i = 0; i < oldA.length; i++)
      for (let j = 0; j < oldB.length; j++) {
        if (
          allowed[i][j] > DEPTH_EPSILON ||
          !oldA[i].faces.length ||
          !oldB[j].faces.length
        )
          continue;
        if (
          !(sweptA[i] ??= bounds(oldSampleA, i)
            .clone()
            .union(bounds(nextSampleA, i))
            .expandByScalar(0.001)).intersectsBox(
            (sweptB[j] ??= bounds(oldSampleB, j)
              .clone()
              .union(bounds(nextSampleB, j))
              .expandByScalar(0.001)),
          )
        )
          continue;
        const fraction = sweepHullsFraction(
          oldA[i],
          nextA[i],
          oldB[j],
          nextB[j],
        );
        if (fraction === undefined || fraction < 0 || fraction > 1) continue;
        // Source emitters extend edges and accept resting/tolerance contacts.
        // Require real positive-depth evidence, never freeze a separating touch.
        for (const delta of [0.0001, 0.001, 0.01, 0.1, 0.5]) {
          const t = safe + (end - safe) * Math.min(1, fraction + delta);
          if (exceeds(t)) {
            blocked = Math.min(blocked, t);
            break;
          }
        }
      }
    if (Number.isFinite(blocked)) {
      let lo = safe,
        hi = blocked;
      for (let iteration = 0; iteration < 18; iteration++) {
        const mid = (lo + hi) / 2;
        if (exceeds(mid)) hi = mid;
        else lo = mid;
      }
      return lo;
    }
    // Each local overlap must not deepen; after it clears, re-entry is new.
    allowed = nextA.map((_, i) =>
      nextB.map((_, j) =>
        // Zero cannot decrease: a full SAT depth here would be discarded.
        allowed[i][j] === 0
          ? allowed[i][j]
          : Math.min(allowed[i][j], depthAt(nextSampleA, nextSampleB, i, j)),
      ),
    );
    oldA = nextA;
    oldB = nextB;
    oldSampleA = nextSampleA;
    oldSampleB = nextSampleB;
    safe = end;
  }
  return 1;
}

/** Independent post-solver safety uses the same analytic sphere features.
 * There is no tessellated fallback or collider expansion. Source old-overlap
 * rejection intentionally allows an already embedded shape to escape. */
function guardSpherePairTrajectory(
  a: HullBody,
  b: HullBody,
  pathA: PosePath,
  pathB: PosePath,
): number {
  const angle = (path: PosePath) =>
    Math.max(
      path.angularTravel ?? 0,
      [0, 0.25, 0.5, 0.75].reduce(
        (n, t) => n + path(t).orientation.angleTo(path(t + 0.25).orientation),
        0,
      ),
    );
  const samples = Math.min(
    128,
    Math.max(1, Math.ceil(Math.max(angle(pathA), angle(pathB)) / 0.05)),
  );
  const probe = (
    body: HullBody,
    old: GuardPose,
    next: GuardPose,
  ): HullBody => ({
    ...body,
    state: {
      ...body.state,
      position: old.position,
      orientation: old.orientation,
      predictedPosition: next.position,
      predictedOrientation: next.orientation,
    },
  });
  let oldA = pathA(0),
    oldB = pathB(0);
  for (let i = 1; i <= samples; i++) {
    const nextA = pathA(i / samples),
      nextB = pathB(i / samples),
      aa = probe(a, oldA, nextA),
      bb = probe(b, oldB, nextB);
    const boundsA = nativeBodyWorldBounds(a, oldA.position, oldA.orientation)
        .union(nativeBodyWorldBounds(a, nextA.position, nextA.orientation))
        .expandByScalar(0.005),
      boundsB = nativeBodyWorldBounds(b, oldB.position, oldB.orientation)
        .union(nativeBodyWorldBounds(b, nextB.position, nextB.orientation))
        .expandByScalar(0.005);
    if (boundsA.intersectsBox(boundsB)) {
      const rows = nativeSpherePairRows(aa, bb);
      if (rows.length) {
        // Preserve the clear portion of a fast straight sweep. Returning the
        // previous angular sample alone could freeze a whole 40ms tick even
        // when the original feature is reached near its end.
        let safe = (i - 1) / samples,
          blocked = i / samples;
        for (let iteration = 0; iteration < 8; iteration++) {
          const mid = (safe + blocked) / 2;
          if (
            nativeSpherePairRows(
              probe(a, oldA, pathA(mid)),
              probe(b, oldB, pathB(mid)),
            ).length
          )
            blocked = mid;
          else safe = mid;
        }
        return safe;
      }
    }
    oldA = nextA;
    oldB = nextB;
  }
  return 1;
}

/** Couple attachment and actual conflicting trajectories, not broadphase
 * proximity. Revalidate unequal prefixes: slowing one body can create a new
 * crossing. Full-path bounds enclose every tested prefix and rotation arc.
 * Only certified immutable constant geometry and broadphase indexes survive
 * phases; damage, motion, masks, coupling and fractions are recomputed. */
export class BodyTrajectoryGuard {
  private broadphase = new BodyBroadphase();
  private immutable = new ImmutableGuardGeometry();
  clear() {
    this.broadphase = new BodyBroadphase();
    this.immutable = new ImmutableGuardGeometry();
  }
  run(
    bodies: readonly HullBody[],
    paths: Map<HullBody, PosePath>,
    pairAllowed?: BodyPairPredicate,
    diagnostics?: BodyGuardDiagnostics,
  ): Map<HullBody, number> {
    if (diagnostics) {
      diagnostics.hullTransforms =
        diagnostics.snapshotHits =
        diagnostics.pairGuardCalls =
        diagnostics.maskRejected =
        diagnostics.maskTests =
        diagnostics.attachmentPairs =
        diagnostics.dependencyMerges =
        diagnostics.revalidationCalls =
        diagnostics.conservativeFallbacks =
          0;
    }
    const workingSet = new GuardWorkingSet(diagnostics, this.immutable);
    const parents = bodies.map((_, i) => i);
    const roots = bodies.map(attachmentRoot);
    const find = (i: number): number =>
      parents[i] === i ? i : (parents[i] = find(parents[i]));
    const union = (i: number, j: number) => {
      parents[find(j)] = find(i);
    };
    const temporalGroups = new Map<object, number>();
    bodies.forEach((body, i) => {
      const group = paths.get(body)!.temporalGroup;
      if (!group) return;
      const previous = temporalGroups.get(group);
      if (previous === undefined) temporalGroups.set(group, i);
      else union(previous, i);
    });
    // Analytic sphere emitters have float/tolerance contacts outside tight hull
    // bounds. Preserve the previous envelope whenever any sphere participates.
    const hasSphere = bodies.some(isNativeSphereBody);
    const bounds = bodies.map((body) => {
      const path = paths.get(body)!;
      if (
        !hasSphere &&
        body.properties.immovable &&
        path.stable &&
        path.constantPose
      ) {
        const sample = workingSet.sample(body, path, 0);
        const box = new Box3();
        for (let i = 0; i < sample.hulls.length; i++)
          box.union((sample.bounds[i] ??= hullBounds(sample.hulls[i])));
        return box.expandByScalar(DEPTH_EPSILON);
      }
      const center = (pose: GuardPose) =>
        body.properties.centerOfMass
          .clone()
          .applyQuaternion(pose.orientation)
          .add(pose.position);
      return (
        path.centerBounds?.clone() ??
        new Box3().setFromPoints(
          [0, 0.25, 0.5, 0.75, 1].map((t) => center(path(t))),
        )
      ).expandByScalar(
        radius(body) +
          2 * body.properties.centerOfMass.length() +
          DEPTH_EPSILON,
      );
    });
    const candidates = this.broadphase.pairs(bodies, bounds, diagnostics);
    // Mask-sensitive attachment unions apply even for nonoverlapping/static
    // siblings. Enumerate only each ancestry group, then restore source i,j order.
    const groups = new Map<RigidBody, number[]>();
    roots.forEach((root, i) => {
      const indices = groups.get(root);
      if (indices) indices.push(i);
      else groups.set(root, [i]);
    });
    for (const indices of groups.values())
      for (let a = 0; a < indices.length; a++)
        for (let b = a + 1; b < indices.length; b++) {
          candidates.push([indices[a], indices[b]]);
          if (diagnostics) diagnostics.attachmentPairs++;
        }
    candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const pairs: [number, number][] = [];
    let previousI = -1,
      previousJ = -1;
    for (const [i, j] of candidates) {
      if (i === previousI && j === previousJ) continue;
      previousI = i;
      previousJ = j;
      if (diagnostics) diagnostics.maskTests++;
      if (pairAllowed && !pairAllowed(bodies[i], bodies[j])) {
        if (diagnostics) diagnostics.maskRejected++;
        continue;
      }
      if (roots[i] === roots[j]) {
        union(i, j);
        continue;
      }
      pairs.push([i, j]);
    }
    // A full-path pair result certifies every common prefix up to its limit.
    // Record all certificates before assigning different component prefixes.
    const certificates = pairs.map(([i, j]) => {
      if (diagnostics) diagnostics.pairGuardCalls++;
      const fraction = guardPairTrajectory(
        bodies[i],
        bodies[j],
        paths.get(bodies[i])!,
        paths.get(bodies[j])!,
        pairAllowed,
        workingSet,
      );
      if (
        fraction < 1 &&
        !bodies[i].properties.immovable &&
        !bodies[j].properties.immovable
      )
        union(i, j);
      return fraction;
    });
    const caps = new Map<number, number>();
    const assignCaps = () => {
      caps.clear();
      for (let k = 0; k < pairs.length; k++)
        for (const index of pairs[k])
          if (!bodies[index].properties.immovable) {
            const root = find(index);
            caps.set(root, Math.min(caps.get(root) ?? 1, certificates[k]));
          }
    };
    assignCaps();
    const limit = (i: number) =>
      bodies[i].properties.immovable ? 1 : (caps.get(find(i)) ?? 1);
    const fallback = (seed?: number) => {
      // An independent clamp can introduce contacts across candidate edges.
      // Fall back over the complete allowed broadphase component, never just
      // the currently known interaction group. Original certificates suffice.
      let affected: Set<number> | undefined;
      if (seed !== undefined) {
        const broadParents = bodies.map((_, i) => find(i));
        const broadFind = (i: number): number =>
          broadParents[i] === i
            ? i
            : (broadParents[i] = broadFind(broadParents[i]));
        for (const [i, j] of pairs)
          if (
            !bodies[i].properties.immovable &&
            !bodies[j].properties.immovable
          )
            broadParents[broadFind(j)] = broadFind(i);
        const root = broadFind(seed);
        affected = new Set(
          bodies.map((_, i) => i).filter((i) => broadFind(i) === root),
        );
      }
      for (const [i, j] of pairs)
        if (
          (!affected || affected.has(i)) &&
          !bodies[i].properties.immovable &&
          !bodies[j].properties.immovable
        )
          union(i, j);
      assignCaps();
      if (diagnostics) diagnostics.conservativeFallbacks++;
    };
    if (
      bodies.some(
        (body) => body.properties.immovable && !paths.get(body)!.constantPose,
      )
    ) {
      // Arbitrary moving immovable providers have no common-prefix proof;
      // retain their previous conservative behavior. Runtime static paths
      // explicitly supply constantPose, including post-projection guards.
      fallback();
    } else {
      const wrappers = new Map<HullBody, { limit: number; path: PosePath }>();
      const prefix = (i: number, value: number): PosePath => {
        const body = bodies[i],
          source = paths.get(body)!;
        if (value === 1 || source.constantPose) return source;
        const old = wrappers.get(body);
        if (old?.limit === value) return old.path;
        const path: PosePath = (t) => source(t * value);
        path.stable = source.stable;
        // Total angular travel is a bound, not a promise of uniform rate.
        path.angularTravel = source.angularTravel;
        wrappers.set(body, { limit: value, path });
        return path;
      };
      const checked = pairs.map(() => [-1, -1]);
      let checks = 0,
        changed = true;
      const budget = Math.max(64, pairs.length * 4);
      while (changed) {
        changed = false;
        for (let k = 0; k < pairs.length; k++) {
          const [i, j] = pairs[k],
            a = limit(i),
            b = limit(j);
          // All same-component paths have the same prefix. Static paths are
          // constant, so their movable partner also retains its certificate.
          if (
            a === b ||
            bodies[i].properties.immovable ||
            bodies[j].properties.immovable
          )
            continue;
          if (checked[k][0] === a && checked[k][1] === b) continue;
          if (++checks > budget) {
            fallback(i);
            // This component is now certified; retain the exhausted global
            // budget and seal other unresolved components without more sweeps.
            changed = true;
            continue;
          }
          checked[k] = [a, b];
          if (diagnostics) {
            diagnostics.pairGuardCalls++;
            diagnostics.revalidationCalls++;
          }
          const fraction = guardPairTrajectory(
            bodies[i],
            bodies[j],
            prefix(i, a),
            prefix(j, b),
            pairAllowed,
            workingSet,
          );
          if (fraction >= 1) continue;
          const first = find(i),
            second = find(j);
          const common = Math.min(caps.get(first) ?? 1, caps.get(second) ?? 1);
          union(first, second);
          caps.delete(first);
          caps.delete(second);
          caps.set(find(i), common);
          // Their original trajectories were certified at a common prefix;
          // applying fraction again would clip the wrong relative-time paths.
          changed = true;
          if (diagnostics) diagnostics.dependencyMerges++;
        }
      }
    }
    return new Map(bodies.map((body, i) => [body, caps.get(find(i)) ?? 1]));
  }
}

/** pairAllowed is a pure predicate; omitted far/static pairs cannot contact. */
export function guardBodyTrajectories(
  bodies: readonly HullBody[],
  paths: Map<HullBody, PosePath>,
  pairAllowed?: BodyPairPredicate,
): Map<HullBody, number> {
  return new BodyTrajectoryGuard().run(bodies, paths, pairAllowed);
}
