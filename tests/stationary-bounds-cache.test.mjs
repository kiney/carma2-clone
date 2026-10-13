import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { hullsBounds, transformHull } from "../src/physics/geometry.ts";
import { StationaryBoundsCache } from "../src/physics/stationary-bounds-cache.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function body() {
  const hull = buildBoxHull(v(-1, -2, -3), v(1, 2, 3));
  hull.vertexOrder = hull.vertices.map((_, index) => index);
  return {
    kind: "noncar",
    hulls: [hull],
    state: {
      position: v(),
      orientation: new Quaternion(),
      predictedPosition: v(0.25, -0.5, 0.75),
      predictedOrientation: new Quaternion(),
    },
    properties: { immovable: true },
  };
}
/** Independent previous collection path: transform every stored source vertex,
 * then select compact features and union the independently built endpoints. */
function oracle(a) {
  return hullsBounds(
    a.hulls.map((hull) =>
      transformHull(hull, a.state.position, a.state.orientation),
    ),
  ).union(
    hullsBounds(
      a.hulls.map((hull) =>
        transformHull(
          hull,
          a.state.predictedPosition,
          a.state.predictedOrientation,
        ),
      ),
    ),
  );
}
function exact(actual, a) {
  const expected = oracle(a);
  assert.deepEqual(actual.min.toArray(), expected.min.toArray());
  assert.deepEqual(actual.max.toArray(), expected.max.toArray());
}
function cloneHull(hull) {
  return {
    ...hull,
    vertices: hull.vertices.map((point) => point.clone()),
    vertexOrder: hull.vertexOrder?.slice(),
    faces: hull.faces.map((face) => ({
      normal: face.normal.clone(),
      constant: face.constant,
      indices: face.indices.slice(),
    })),
    edges: hull.edges.map((edge) => edge.slice()),
  };
}

test("stationary boxes exactly match compact source bounds across independent poses", () => {
  const a = body(),
    cache = new StationaryBoundsCache();
  a.hulls[0].vertices.push(v(1000, 2000, 3000));
  a.hulls.push(buildBoxHull(v(-0.4, -0.7, -0.9), v(0.8, 0.6, 0.5)));
  for (const [oldAngle, nextAngle] of [
    [0, 0],
    [0.713, 2.41],
    [Math.PI * 1.99, -Math.PI * 3.75],
    [-Math.PI * 4, Math.PI * 6],
  ]) {
    a.state.position.set(-7.3, 2.17, 19.33);
    a.state.predictedPosition.set(-5.71, -3.25, 21.6);
    a.state.orientation.setFromAxisAngle(v(1, 2, 3).normalize(), oldAngle);
    a.state.predictedOrientation.setFromAxisAngle(
      v(3, 1, 2).normalize(),
      nextAngle,
    );
    exact(cache.get(a), a);
  }
  // The primitive consumes quaternion components directly; avoid normalizing
  // them in the bounds cache even for a standalone nonunit input.
  a.state.orientation.set(0.3, -0.7, 0.2, 1.3);
  a.state.predictedOrientation.set(-0.9, 0.1, 0.7, 0.8);
  exact(cache.get(a), a);
  assert.ok(cache.get(a).max.x < 100);
});

test("source vertex and compact order mutations refresh bounds before pair discovery", () => {
  const a = body(),
    cache = new StationaryBoundsCache();
  let previous = cache.get(a);
  const changed = (mutate) => {
    mutate();
    const next = cache.get(a);
    assert.notEqual(next, previous);
    exact(next, a);
    previous = next;
  };
  changed(() => (a.hulls[0].vertices[0].x = -12));
  assert.equal(previous.min.x, -12);
  changed(() => a.hulls[0].vertices.push(v(20, 30, 40)));
  assert.ok(previous.max.x < 20);
  changed(() => a.hulls[0].vertexOrder.push(a.hulls[0].vertices.length - 1));
  assert.equal(previous.max.x, 20.25);
  changed(() => (a.hulls[0].vertexOrder = [0]));
  changed(() => (a.hulls[0].vertexOrder = undefined));
  changed(() => a.hulls.push(buildBoxHull(v(-30, -1, -1), v(-29, 1, 1))));
});

test("planes, face indices, native tags and edge edits do not rebuild aggregate bounds", () => {
  const a = body(),
    diagnostics = {},
    cache = new StationaryBoundsCache(diagnostics),
    first = cache.get(a);
  a.hulls[0].faces[0].normal.set(0.25, 0.5, -0.75);
  a.hulls[0].faces[0].constant += 0.25;
  a.hulls[0].faces[0].indices.reverse();
  a.hulls[0].edges[0].reverse();
  a.hulls[0].edges.push([1, 7]);
  a.hulls[0].nativeType = "WIREPOLY";
  assert.equal(cache.get(a), first);
  exact(first, a);
  assert.equal(diagnostics.boundsBuilds, 1);
  assert.equal(diagnostics.boundsHits, 1);
});

test("numeric-equivalent state and geometry container replacements preserve warm boxes", () => {
  const a = body(),
    diagnostics = {},
    cache = new StationaryBoundsCache(diagnostics),
    first = cache.get(a);
  a.state = {
    position: a.state.position.clone(),
    orientation: a.state.orientation.clone(),
    predictedPosition: a.state.predictedPosition.clone(),
    predictedOrientation: a.state.predictedOrientation.clone(),
  };
  a.hulls = a.hulls.map(cloneHull);
  assert.equal(cache.get(a), first);
  assert.equal(diagnostics.boundsBuilds, 1);
  assert.equal(diagnostics.boundsHits, 1);
  assert.equal(diagnostics.boundsVertexTests, 16);
  exact(first, a);
  const other = { ...a };
  assert.notEqual(cache.get(other), first);
});

test("each OLD and NEXT position or quaternion component refreshes its certificate", () => {
  const a = body(),
    cache = new StationaryBoundsCache();
  let previous = cache.get(a);
  for (const key of ["position", "predictedPosition"]) {
    for (const axis of ["x", "y", "z"]) {
      a.state[key][axis] += 0.03125;
      const next = cache.get(a);
      assert.notEqual(next, previous);
      exact(next, a);
      previous = next;
    }
  }
  for (const key of ["orientation", "predictedOrientation"]) {
    for (const axis of ["x", "y", "z", "w"]) {
      a.state[key][axis] += 0.0625;
      const next = cache.get(a);
      assert.notEqual(next, previous);
      exact(next, a);
      previous = next;
    }
  }
  a.state.position.x = -0;
  previous = cache.get(a);
  a.state.position.x = 0;
  assert.notEqual(cache.get(a), previous);
});

test("empty source or compact feature sets retain the original empty-box result", () => {
  const a = body(),
    cache = new StationaryBoundsCache();
  a.hulls[0].vertexOrder = [];
  exact(cache.get(a), a);
  assert.equal(cache.get(a).isEmpty(), true);
  a.hulls = [];
  exact(cache.get(a), a);
  assert.equal(cache.get(a).isEmpty(), true);
});

test("missing candidate slots fail even after a valid warm entry", () => {
  const a = body(),
    cache = new StationaryBoundsCache();
  cache.get(a);
  const position = a.state.predictedPosition;
  a.state.predictedPosition = undefined;
  assert.throws(() => cache.get(a), /both candidate pose endpoints/);
  a.state.predictedPosition = position;
  a.state.predictedOrientation = undefined;
  assert.throws(() => cache.get(a), /both candidate pose endpoints/);
});
