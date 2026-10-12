import { Box3, Quaternion, Vector3 } from "three";
import type { RigidBody } from "./contact";
import {
  isNativeSphereBody,
  nativeBodyWorldBounds,
  nativeSpherePairRows,
} from "./sphere-body";
import {
  hullBounds,
  hullPenetration,
  sweepHulls,
  transformHull,
  type CollisionHull,
} from "./geometry";

export type HullBody = RigidBody & { hulls: CollisionHull[] };
export type BodyPairPredicate = (a: HullBody, b: HullBody) => boolean;
export interface GuardPose {
  position: Vector3;
  orientation: Quaternion;
}
export type PosePath = ((fraction: number) => GuardPose) & {
  /** Total travel bounds, needed when a path makes complete rotations. */
  angularTravel?: number;
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
      value = { hulls: at(body, path, t), bounds: [], depths: [] };
      cache.set(t, value);
    }
    return value;
  };
  const getA = (t: number) => sample(a, pathA, cacheA, t),
    getB = (t: number) => sample(b, pathB, cacheB, t);
  // These transformed samples are private to this invocation. Persistent caches
  // keyed by source hull identity would miss in-place crush/pedestrian changes.
  // Store auxiliary results beside the existing pose samples instead of adding
  // a separate fraction Map and per-hull WeakMap in this short-lived hot path.
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
  const exceeds = (t: number) => {
    const ha = getA(t),
      hb = getB(t);
    return ha.hulls.some((_, i) =>
      hb.hulls.some(
        (_, j) => depthAt(ha, hb, i, j) > allowed[i][j] + DEPTH_EPSILON,
      ),
    );
  };
  let safe = 0;
  for (let step = 1; step <= steps; step++) {
    const end = step / steps,
      nextSampleA = getA(end),
      nextSampleB = getB(end),
      nextA = nextSampleA.hulls,
      nextB = nextSampleB.hulls;
    let blocked = exceeds(end) ? end : Infinity;
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
        const hit = sweepHulls(oldA[i], nextA[i], oldB[j], nextB[j]);
        if (!hit || hit.fraction! < 0 || hit.fraction! > 1) continue;
        // Source emitters extend edges and accept resting/tolerance contacts.
        // Require real positive-depth evidence, never freeze a separating touch.
        for (const delta of [0.0001, 0.001, 0.01, 0.1, 0.5]) {
          const t = safe + (end - safe) * Math.min(1, hit.fraction! + delta);
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
        Math.min(allowed[i][j], depthAt(nextSampleA, nextSampleB, i, j)),
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

/** Give each broadphase-connected group a common path parameter. Independent
 * pair clamps can themselves introduce a new crossing when only A is slowed.
 * Broadphase spheres enclose the entire rotation arc about the moving COM,
 * unlike a union of endpoint AABBs. Each child's own hinge path is retained. */
export function guardBodyTrajectories(
  bodies: readonly HullBody[],
  paths: Map<HullBody, PosePath>,
  pairAllowed?: BodyPairPredicate,
): Map<HullBody, number> {
  const parents = bodies.map((_, i) => i);
  const roots = bodies.map(attachmentRoot);
  const find = (i: number): number =>
    parents[i] === i ? i : (parents[i] = find(parents[i]));
  const union = (i: number, j: number) => {
    parents[find(j)] = find(i);
  };
  const bounds = bodies.map((body) => {
    const path = paths.get(body)!;
    const center = (pose: GuardPose) =>
      body.properties.centerOfMass
        .clone()
        .applyQuaternion(pose.orientation)
        .add(pose.position);
    return new Box3()
      .setFromPoints([0, 0.25, 0.5, 0.75, 1].map((t) => center(path(t))))
      .expandByScalar(
        radius(body) +
          2 * body.properties.centerOfMass.length() +
          DEPTH_EPSILON,
      );
  });
  const pairs: [number, number][] = [];
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++) {
      if (pairAllowed && !pairAllowed(bodies[i], bodies[j])) continue;
      if (roots[i] === roots[j]) {
        union(i, j);
        continue;
      }
      if (bodies[i].properties.immovable && bodies[j].properties.immovable)
        continue;
      if (!bounds[i].intersectsBox(bounds[j])) continue;
      // An immovable prop does not need its time scaled and must not join distant
      // vehicles through a large scenery hull. It still constrains each car.
      if (!bodies[i].properties.immovable && !bodies[j].properties.immovable)
        union(i, j);
      pairs.push([i, j]);
    }
  const limits = new Map<number, number>();
  for (const [i, j] of pairs) {
    const fraction = guardPairTrajectory(
      bodies[i],
      bodies[j],
      paths.get(bodies[i])!,
      paths.get(bodies[j])!,
      pairAllowed,
    );
    for (const index of [i, j])
      if (!bodies[index].properties.immovable)
        limits.set(
          find(index),
          Math.min(limits.get(find(index)) ?? 1, fraction),
        );
  }
  return new Map(bodies.map((body, i) => [body, limits.get(find(i)) ?? 1]));
}
