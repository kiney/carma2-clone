import test from "node:test";
import assert from "node:assert/strict";
import {
  Group,
  Mesh,
  BoxGeometry,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import { parseNonCarMechanics } from "../src/noncars.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";
import {
  sealCollisionHulls,
  hasImmutableCollisionHulls,
} from "../src/physics/immutable-hulls.ts";
import { hullsBounds, transformHull } from "../src/physics/geometry.ts";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { StationaryBoundsCache } from "../src/physics/stationary-bounds-cache.ts";
import { BodyTrajectoryGuard } from "../src/physics/pair-guard.ts";
import { legacyGuardBodyTrajectories } from "./support/legacy-physics-guard.mjs";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function mechanics() {
  return parseNonCarMechanics(
    "101\n7\n0,0,0\n0,0,0\n1\nbox\n-1,-2,-3\n1,2,3\n1,1\n2,3,4\n0\n0\n0\nEND",
  );
}
function actor() {
  const result = new Group();
  result.name = "&07!0001.ACT";
  result.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  return result;
}
function boundedBody(hulls) {
  return {
    hulls,
    state: {
      position: v(),
      orientation: new Quaternion(),
      predictedPosition: v(0.25, -0.5, 0.75),
      predictedOrientation: new Quaternion(),
    },
    properties: { immovable: true },
  };
}
function oracle(body) {
  return hullsBounds(
    body.hulls.map((h) =>
      transformHull(h, body.state.position, body.state.orientation),
    ),
  ).union(
    hullsBounds(
      body.hulls.map((h) =>
        transformHull(
          h,
          body.state.predictedPosition,
          body.state.predictedOrientation,
        ),
      ),
    ),
  );
}
function exact(bounds, body) {
  const expected = oracle(body);
  assert.deepEqual(bounds.min.toArray(), expected.min.toArray());
  assert.deepEqual(bounds.max.toArray(), expected.max.toArray());
}

test("only explicit NONCAR construction seals independently-owned hulls", () => {
  const definition = mechanics();
  const mutable = createNonCarBody(actor(), definition);
  assert.equal(hasImmutableCollisionHulls(mutable.hulls), false);
  mutable.hulls[0].vertices[0].x += 1;

  const sealed = createNonCarBody(actor(), definition, {
    immutableHulls: true,
  });
  assert.equal(hasImmutableCollisionHulls(sealed.hulls), true);
  assert.notEqual(sealed.hulls, mutable.hulls);
  assert.notEqual(sealed.hulls[0].vertices[0], definition.shapes[0].bounds.min);
  assert.throws(() => sealed.hulls.push(sealed.hulls[0]), TypeError);
  assert.throws(() => sealed.hulls[0].vertices.push(v()), TypeError);
  assert.throws(() => sealed.hulls[0].vertices[0].set(9, 9, 9), TypeError);
  assert.throws(() => sealed.hulls[0].faces[0].indices.push(99), TypeError);
  assert.throws(() => (sealed.hulls[0].faces[0].normal.x = 4), TypeError);
  assert.throws(() => sealed.hulls[0].edges[0].push(99), TypeError);
  sealed.state.position.x = 8;
  sealed.properties.inertia.x = 7;
  assert.equal(sealed.state.position.x, 8);
  assert.equal(sealed.properties.inertia.x, 7);
});

test("sealing rejects solver-transformed hulls", () => {
  const hull = buildBoxHull(v(-1, -1, -1), v(1, 1, 1));
  hull.position = v(2, 0, 0);
  assert.throws(
    () => sealCollisionHulls([hull]),
    /transformed collision hulls/,
  );
});

test("sealed bounds skip local vertex scans while poses remain exact cache inputs", () => {
  const hull = buildBoxHull(v(-1, -2, -3), v(1, 2, 3));
  const a = boundedBody(sealCollisionHulls([hull]));
  const diagnostics = {};
  const cache = new StationaryBoundsCache(diagnostics);
  exact(cache.get(a), a);
  assert.equal(diagnostics.boundsVertexTests ?? 0, 0);
  const first = cache.get(a);
  assert.equal(cache.get(a), first);
  assert.equal(diagnostics.boundsVertexTests ?? 0, 0);
  a.state.predictedPosition.x += 2;
  const moved = cache.get(a);
  assert.notEqual(moved, first);
  exact(moved, a);
  a.properties.immovable = false;
  assert.equal(cache.get(a), moved);
  assert.equal(diagnostics.boundsVertexTests ?? 0, 0);
});

test("unsealed local changes and hull replacements retain numeric fallback", () => {
  const a = boundedBody([buildBoxHull(v(-1, -2, -3), v(1, 2, 3))]);
  const diagnostics = {};
  const cache = new StationaryBoundsCache(diagnostics);
  let current = cache.get(a);
  exact(current, a);
  a.hulls[0].vertices[0].x -= 3;
  const changed = cache.get(a);
  assert.notEqual(changed, current);
  exact(changed, a);
  current = changed;
  a.hulls = [buildBoxHull(v(-1, -2, -3), v(1, 2, 3))];
  const replaced = cache.get(a);
  assert.notEqual(replaced, current);
  exact(replaced, a);
  assert.ok(diagnostics.boundsVertexTests > 0);
});

test("switching sealed and unsealed arrays invalidates identity and uses fallback", () => {
  const original = sealCollisionHulls([
    buildBoxHull(v(-1, -1, -1), v(1, 1, 1)),
  ]);
  const a = boundedBody(original);
  const cache = new StationaryBoundsCache();
  const first = cache.get(a);
  a.hulls = [buildBoxHull(v(-1, -1, -1), v(1, 1, 1))];
  const mutable = cache.get(a);
  assert.notEqual(mutable, first);
  exact(mutable, a);
  a.hulls = sealCollisionHulls([buildBoxHull(v(-1, -1, -1), v(1, 1, 1))]);
  const resealed = cache.get(a);
  assert.notEqual(resealed, mutable);
  exact(resealed, a);
});

test("retained immutable guard geometry preserves collisions across pose, wake and shape changes", () => {
  const source = () => [buildBoxHull(v(-0.2, -0.2, -0.2), v(0.2, 0.2, 0.2))];
  const moving = boundedBody(source()),
    fixed = boundedBody(sealCollisionHulls(source()));
  moving.properties.immovable = false;
  moving.properties.centerOfMass = fixed.properties.centerOfMass = v();
  moving.state.position.x = -0.6;
  const guard = new BodyTrajectoryGuard();
  function run(fixedDelta = 0, certified = true, oldOverlap = false) {
    const paths = new Map(
      [moving, fixed].map((body) => {
        const path = (t) => ({
          position: body.state.position
            .clone()
            .addScaledVector(v(body === moving ? 1 : fixedDelta), t),
          orientation: body.state.orientation.clone(),
        });
        path.stable = certified;
        if (certified && body === fixed && fixedDelta === 0)
          path.constantPose = path(0);
        return [body, path];
      }),
    );
    const bodies = [moving, fixed],
      diagnostics = {};
    const historical = legacyGuardBodyTrajectories(bodies, paths);
    const privatePaths = new Map(
      [...paths].map(([body, trajectory]) => [body, (t) => trajectory(t)]),
    );
    const expected = new BodyTrajectoryGuard().run(bodies, privatePaths);
    const actual = guard.run(bodies, paths, undefined, diagnostics);
    assert.deepEqual([...actual.values()], [...expected.values()]);
    if (oldOverlap) {
      // The in-place vertex edit below creates a real OLD hull overlap. PHY-16
      // intentionally admits it; the frozen historical oracle still clips any
      // depth increase. Cache invalidation must match fresh current geometry.
      assert.ok(historical.get(moving) < 1);
      assert.equal(actual.get(moving), 1);
      assert.ok(diagnostics.recoveryHullAdmissions > 0);
    } else assert.deepEqual([...actual.values()], [...historical.values()]);
    return diagnostics;
  }
  const cold = run(),
    warm = run();
  assert.equal(warm.hullTransforms, cold.hullTransforms - 1);
  fixed.state.position.x = 0.1;
  run();
  fixed.state.orientation.setFromAxisAngle(v(0, 1), 0.3);
  run();
  fixed.properties.immovable = false;
  run(-0.15);
  fixed.properties.immovable = true;
  run(0.15); // Custom moving path is not a constant-pose certificate.
  run(0, false);
  fixed.hulls = source();
  run();
  fixed.hulls[0].vertices[0].x -= 0.5;
  run(0, true, true);
  fixed.hulls = sealCollisionHulls(source());
  run();
  const recached = run();
  guard.clear();
  assert.equal(run().hullTransforms, recached.hullTransforms + 1);
});
