// Numerical oracle copied from redistributable project source at 02528bb.
// These SAT/manifold, transform/bounds, and complete guard functions retain the
// baseline operations and constants; do not update them alongside optimizations.
// The unchanged source feature sweep and analytic sphere primitives are shared.
import { Box3, Vector3 } from "three";
import { sweepHulls } from "../../src/physics/geometry.ts";
import {
  isNativeSphereBody,
  nativeBodyWorldBounds,
  nativeSpherePairRows,
} from "../../src/physics/sphere-body.ts";
const EPS = 1e-7;
export function transformHull(hull, position, orientation) {
  const vertices = hull.vertices.map((p) =>
    p.clone().applyQuaternion(orientation).add(position),
  );
  return {
    vertices,
    vertexOrder: hull.vertexOrder,
    edges: hull.edges,
    localHull: hull,
    position: position.clone(),
    orientation: orientation.clone(),
    faces: hull.faces.map((f) => {
      const normal = f.normal.clone().applyQuaternion(orientation);
      return {
        normal,
        constant: f.constant + normal.dot(position),
        indices: f.indices,
      };
    }),
  };
}
export function hullBounds(hull) {
  return hullsBounds([hull]);
}
/** Source shape/cache bounds use compact collision points, not preserved
 * authored storage. Useful for aggregate body bounds and recovery centers. */
export function hullsBounds(hulls) {
  const bounds = new Box3();
  for (const hull of hulls) {
    if (hull.vertexOrder) {
      for (const index of hull.vertexOrder)
        bounds.expandByPoint(hull.vertices[index]);
    } else {
      for (const point of hull.vertices) bounds.expandByPoint(point);
    }
  }
  return bounds;
}
function projection(points, axis, vertexOrder) {
  let lo = Infinity,
    hi = -Infinity;
  for (const index of vertexOrder ?? points.map((_, index) => index)) {
    const p = points[index];
    const d = p.dot(axis);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [lo, hi];
}
function unique(points, max = 4) {
  const result = [];
  for (const p of points)
    if (!result.some((q) => p.distanceToSquared(q) < 1e-10)) result.push(p);
  // Keep spatially spread manifold samples; arbitrary first vertices bias torque.
  if (result.length <= max) return result;
  const selected = [result[0]];
  while (selected.length < max) {
    let best,
      dist = -1;
    for (const p of result) {
      const d = Math.min(...selected.map((q) => p.distanceToSquared(q)));
      if (d > dist) {
        dist = d;
        best = p;
      }
    }
    selected.push(best);
  }
  return selected;
}
function clip(polygon, normal, constant) {
  const out = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length],
      da = a.dot(normal) - constant,
      db = b.dot(normal) - constant;
    if (da <= EPS) out.push(a.clone());
    if (da < 0 !== db < 0) {
      const t = da / (da - db);
      out.push(a.clone().lerp(b, t));
    }
  }
  return out;
}
function facePolygon(hull, direction) {
  let face = hull.faces[0];
  for (const f of hull.faces)
    if (f.normal.dot(direction) > face.normal.dot(direction)) face = f;
  return face.indices.map((i) => hull.vertices[i].clone());
}
function manifold(a, b, normal) {
  const pa = facePolygon(a, normal.clone().negate()),
    pb = facePolygon(b, normal);
  const constant =
    (projection(a.vertices, normal, a.vertexOrder)[0] +
      projection(b.vertices, normal, b.vertexOrder)[1]) *
    0.5;
  const project = (p) => p.addScaledVector(normal, constant - p.dot(normal));
  pa.forEach(project);
  pb.forEach(project);
  let result = pb;
  // pa winding is opposite normal; outward side plane is normal cross edge.
  for (let i = 0; i < pa.length && result.length; i++) {
    const edge = pa[(i + 1) % pa.length].clone().sub(pa[i]);
    const out = normal.clone().cross(edge).normalize();
    result = clip(result, out, out.dot(pa[i]));
  }
  if (result.length) return unique(result);
  // Edge-edge SAT contacts have no reference-face overlap. The midpoint of the
  // nearest support features supplies the torque arm, never the actor origin.
  const av = (
      a.vertexOrder
        ? a.vertexOrder.map((index) => a.vertices[index])
        : a.vertices
    ).reduce((p, q) => (q.dot(normal) < p.dot(normal) ? q : p)),
    bv = (
      b.vertexOrder
        ? b.vertexOrder.map((index) => b.vertices[index])
        : b.vertices
    ).reduce((p, q) => (q.dot(normal) > p.dot(normal) ? q : p));
  return [project(av.clone().add(bv).multiplyScalar(0.5))];
}
export function eagerAxes(a, b) {
  const result = [];
  const add = (v) => {
    if (v.lengthSq() < 1e-12) return;
    v.normalize();
    if (!result.some((p) => Math.abs(p.dot(v)) > 1 - EPS)) result.push(v);
  };
  a.faces.forEach((f) => add(f.normal.clone()));
  b.faces.forEach((f) => add(f.normal.clone()));
  for (const [a0, a1] of a.edges)
    for (const [b0, b1] of b.edges)
      add(
        a.vertices[a1]
          .clone()
          .sub(a.vertices[a0])
          .cross(b.vertices[b1].clone().sub(b.vertices[b0])),
      );
  return result;
}
/** Depth-only solid-hull SAT for placement/integration verification. Wire
 * shapes retain their native feature contacts; they have no solid volume. */
export function eagerPenetration(a, b) {
  if (!a.faces.length || !b.faces.length) return 0;
  let depth = Infinity;
  for (const axis of eagerAxes(a, b)) {
    const [al, ah] = projection(a.vertices, axis, a.vertexOrder),
      [bl, bh] = projection(b.vertices, axis, b.vertexOrder);
    if (ah <= bl || bh <= al) return 0;
    depth = Math.min(depth, ah - bl, bh - al);
  }
  return Number.isFinite(depth) ? depth : 0;
}
/** Full convex SAT, including edge-edge axes. Normal points from B into A. */
export function eagerContact(a, b, tolerance = 0) {
  let penetration = Infinity,
    normal;
  for (const axis of eagerAxes(a, b)) {
    const [al, ah] = projection(a.vertices, axis, a.vertexOrder),
      [bl, bh] = projection(b.vertices, axis, b.vertexOrder);
    if (ah < bl - tolerance || bh < al - tolerance) return null;
    const left = ah - bl,
      right = bh - al;
    if (Math.min(left, right) < penetration) {
      penetration = Math.min(left, right);
      normal = axis.clone().multiplyScalar(right < left ? 1 : -1);
    }
  }
  if (!normal) return null;
  return {
    normal,
    points: manifold(a, b, normal),
    penetration: Math.max(0, penetration),
  };
}
const DEPTH_EPSILON = 1e-6;
/** Actual joint ancestry, including a flap attached to a detached roof. */
export function attachmentRoot(body) {
  const visited = new Set();
  while (!visited.has(body)) {
    visited.add(body);
    const joint = "joint" in body ? body.joint : undefined;
    if (!joint) break;
    body = joint.parent;
  }
  return body;
}
function radius(body) {
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
function at(body, path, fraction) {
  const pose = path(fraction);
  return body.hulls.map((hull) =>
    transformHull(hull, pose.position, pose.orientation),
  );
}
function depth(a, b) {
  return hullBounds(a).intersectsBox(hullBounds(b))
    ? eagerPenetration(a, b)
    : 0;
}
/** Independent commit safety guard, NOT an alternative impulse/damage solver.
 * The original feature emitter/normal equations remain authoritative. Verify
 * the actual post-solver integration path so exhausting recollection passes
 * cannot commit interlocking convex shapes. Existing overlap may escape.
 * CCD between short angular samples also catches a crossing with clear ends. */
export function legacyGuardPairTrajectory(a, b, pathA, pathB, pairAllowed) {
  if (pairAllowed && !pairAllowed(a, b)) return 1;
  if (isNativeSphereBody(a) || isNativeSphereBody(b))
    return guardSpherePairTrajectory(a, b, pathA, pathB);
  const cacheA = new Map(),
    cacheB = new Map();
  const sample = (body, path, cache, t) => {
    let hulls = cache.get(t);
    if (!hulls) {
      hulls = at(body, path, t);
      cache.set(t, hulls);
    }
    return hulls;
  };
  const getA = (t) => sample(a, pathA, cacheA, t),
    getB = (t) => sample(b, pathB, cacheB, t);
  let oldA = getA(0),
    oldB = getB(0);
  let allowed = oldA.map((ah) => oldB.map((bh) => depth(ah, bh)));
  const travel = (path) => {
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
  const exceeds = (t) => {
    const ha = getA(t),
      hb = getB(t);
    return ha.some((ah, i) =>
      hb.some((bh, j) => depth(ah, bh) > allowed[i][j] + DEPTH_EPSILON),
    );
  };
  let safe = 0;
  for (let step = 1; step <= steps; step++) {
    const end = step / steps,
      nextA = getA(end),
      nextB = getB(end);
    let blocked = exceeds(end) ? end : Infinity;
    for (let i = 0; i < oldA.length; i++)
      for (let j = 0; j < oldB.length; j++) {
        if (
          allowed[i][j] > DEPTH_EPSILON ||
          !oldA[i].faces.length ||
          !oldB[j].faces.length
        )
          continue;
        if (
          !hullBounds(oldA[i])
            .union(hullBounds(nextA[i]))
            .expandByScalar(0.001)
            .intersectsBox(
              hullBounds(oldB[j])
                .union(hullBounds(nextB[j]))
                .expandByScalar(0.001),
            )
        )
          continue;
        const hit = sweepHulls(oldA[i], nextA[i], oldB[j], nextB[j]);
        if (!hit || hit.fraction < 0 || hit.fraction > 1) continue;
        // Source emitters extend edges and accept resting/tolerance contacts.
        // Require real positive-depth evidence, never freeze a separating touch.
        for (const delta of [0.0001, 0.001, 0.01, 0.1, 0.5]) {
          const t = safe + (end - safe) * Math.min(1, hit.fraction + delta);
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
    allowed = nextA.map((ah, i) =>
      nextB.map((bh, j) => Math.min(allowed[i][j], depth(ah, bh))),
    );
    oldA = nextA;
    oldB = nextB;
    safe = end;
  }
  return 1;
}
/** Independent post-solver safety uses the same analytic sphere features.
 * There is no tessellated fallback or collider expansion. Source old-overlap
 * rejection intentionally allows an already embedded shape to escape. */
function guardSpherePairTrajectory(a, b, pathA, pathB) {
  const angle = (path) =>
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
  const probe = (body, old, next) => ({
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
export function legacyGuardBodyTrajectories(bodies, paths, pairAllowed) {
  const parents = bodies.map((_, i) => i);
  const roots = bodies.map(attachmentRoot);
  const find = (i) => (parents[i] === i ? i : (parents[i] = find(parents[i])));
  const union = (i, j) => {
    parents[find(j)] = find(i);
  };
  const bounds = bodies.map((body) => {
    const path = paths.get(body);
    const center = (pose) =>
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
  const pairs = [];
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
  const limits = new Map();
  for (const [i, j] of pairs) {
    const fraction = legacyGuardPairTrajectory(
      bodies[i],
      bodies[j],
      paths.get(bodies[i]),
      paths.get(bodies[j]),
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
