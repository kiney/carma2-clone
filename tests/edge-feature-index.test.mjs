import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  createEdgeFeatureIndex,
  getHullEdgeFeatureIndex,
} from "../src/physics/edge-feature-index.ts";
import { sweepMovingEdges } from "../src/physics/geometry.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const hull = (vertices, edges) => ({ vertices, edges, faces: [] });
const diagnostic = () => ({ queries: 0, edgesVisited: 0, candidates: 0 });
let seed = 171819;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const range = (scale = 1) => (random() * 2 - 1) * scale;

test("edge discovery preserves authored slots, duplicates and inclusive touches", () => {
  const vertices = [v(-1), v(1), v(10), v(11)];
  const index = createEdgeFeatureIndex(vertices, [
    [2, 3],
    [0, 1],
    [1, 0],
    [0, 1],
  ]);
  assert.deepEqual(index.query(v(1, -1), v(1, 1)), [1, 2, 3]);
  assert.deepEqual(index.query(v(30), v(31)), []);
});

test("BVH prunes large hulls and restores authored order", () => {
  const vertices = [],
    edges = [];
  for (let i = 79; i >= 0; i--) {
    edges.push([vertices.length, vertices.length + 1]);
    vertices.push(v(i * 0.25, -1), v(i * 0.25, 1));
  }
  const index = createEdgeFeatureIndex(vertices, edges),
    counts = diagnostic();
  assert.deepEqual(
    index.query(v(-0.01), v(0.01), undefined, undefined, counts),
    [79],
  );
  assert.equal(counts.queries, 1);
  assert.equal(counts.candidates, 1);
  assert.ok(counts.edgesVisited < 40, JSON.stringify(counts));
  const all = index.query(v(0), v(20));
  assert.deepEqual(
    all,
    edges.map((_, i) => i),
  );
});

test("the four endpoint bounds retain an interior crossing with clear endpoints", () => {
  const vertices = [v(-1), v(1)];
  const index = createEdgeFeatureIndex(vertices, [[0, 1]]);
  const motion = [v(0, -1, -10), v(0, 1, -10), v(0, -1, 10), v(0, 1, 10)];
  assert.ok(sweepMovingEdges(...vertices, ...motion));
  assert.deepEqual(index.query(...motion), [0]);
});

test("static-edge index retains every accepted seeded quadratic crossing", () => {
  const vertices = [],
    edges = [];
  for (let i = 0; i < 40; i++) {
    const center = v(range(3), range(3), range(3));
    const direction = v(range(), range(), range());
    edges.push([vertices.length, vertices.length + 1]);
    vertices.push(center.clone().sub(direction), center.clone().add(direction));
  }
  const index = createEdgeFeatureIndex(vertices, edges);
  let accepted = 0;
  for (let iteration = 0; iteration < 400; iteration++) {
    const [a, b] = edges[iteration % edges.length];
    const center = vertices[a].clone().lerp(vertices[b], random());
    const axis = v(range(), range(), range());
    const travel = v(range(2), range(2), range(2));
    const motion = [
      center.clone().sub(axis).sub(travel),
      center.clone().add(axis).sub(travel),
      center.clone().sub(axis).add(travel),
      center.clone().add(axis).add(travel),
    ];
    const candidates = new Set(index.query(...motion));
    for (let slot = 0; slot < edges.length; slot++) {
      const [start, end] = edges[slot];
      if (!sweepMovingEdges(vertices[start], vertices[end], ...motion))
        continue;
      accepted++;
      assert.ok(
        candidates.has(slot),
        `missing accepted slot ${slot} at ${iteration}`,
      );
    }
  }
  assert.ok(accepted > 300, `only ${accepted} accepted crossings`);
});

test("swept-edge index supports static world-edge queries conservatively", () => {
  const vertices = [],
    next = [],
    edges = [];
  for (let i = 0; i < 48; i++) {
    const x = range(4),
      y = range(4),
      z = range(2);
    edges.push([vertices.length, vertices.length + 1]);
    vertices.push(v(x, y - 0.5, z - 1), v(x, y + 0.5, z - 1));
    next.push(v(x, y - 0.5, z + 1), v(x, y + 0.5, z + 1));
  }
  const index = createEdgeFeatureIndex(vertices, edges, next);
  let accepted = 0;
  for (let iteration = 0; iteration < 150; iteration++) {
    const point = vertices[(iteration % edges.length) * 2];
    const start = v(point.x - 1, point.y + 0.5, point.z + 1);
    const end = v(point.x + 1, point.y + 0.5, point.z + 1);
    const candidates = new Set(index.query(start, end));
    edges.forEach(([a, b], slot) => {
      if (
        !sweepMovingEdges(
          start,
          end,
          vertices[a],
          vertices[b],
          next[a],
          next[b],
        )
      )
        return;
      accepted++;
      assert.ok(candidates.has(slot));
    });
  }
  assert.ok(accepted >= 150);
});

test("thin, grazing and nearly parallel accepted features remain candidates", () => {
  const cases = [
    [
      v(-1e-6),
      v(1e-6),
      v(0, -1000, -1e-5),
      v(0, 1000, -1e-5),
      v(0, -1000, 1e-5),
      v(0, 1000, 1e-5),
    ],
    [v(-1), v(1), v(1, -1, -1), v(1, 1, -1), v(1, -1, 1), v(1, 1, 1)],
    [
      v(-1000),
      v(1000),
      v(-1000, -0.001, -1),
      v(1000, 0.001, -1),
      v(-1000, -0.001, 1),
      v(1000, 0.001, 1),
    ],
  ];
  for (const [start, end, ...motion] of cases) {
    assert.ok(sweepMovingEdges(start, end, ...motion));
    assert.deepEqual(
      createEdgeFeatureIndex([start, end], [[0, 1]]).query(...motion),
      [0],
    );
  }
});

test("empty and zero-length edge sets are safe without inventing features", () => {
  assert.deepEqual(createEdgeFeatureIndex([], []).query(v(), v()), []);
  const index = createEdgeFeatureIndex(
    [v(), v(10)],
    [
      [0, 0],
      [1, 1],
    ],
  );
  assert.deepEqual(index.query(v(), v()), [0]);
  assert.equal(sweepMovingEdges(v(), v(), v(), v(), v(), v()), null);
});

test("mutable source coordinates, replacement arrays and edge order rebuild live", () => {
  const source = hull(
    [v(-1), v(1), v(10), v(11)],
    [
      [0, 1],
      [2, 3],
    ],
  );
  const first = getHullEdgeFeatureIndex(source);
  assert.deepEqual(first.query(v(), v()), [0]);
  source.vertices[0].x = 20;
  source.vertices[1].x = 21;
  assert.deepEqual(getHullEdgeFeatureIndex(source).query(v(), v()), []);
  source.vertices = [v(-1), v(1), v(10), v(11)];
  source.edges.reverse();
  assert.deepEqual(getHullEdgeFeatureIndex(source).query(v(), v()), [1]);
  source.edges[0][0] = 0;
  source.edges[0][1] = 1;
  assert.deepEqual(getHullEdgeFeatureIndex(source).query(v(), v()), [0, 1]);
});

test("only a deeply frozen source retains its index by identity", () => {
  const source = hull([v(-1), v(1)], [[0, 1]]);
  Object.freeze(source);
  assert.notEqual(
    getHullEdgeFeatureIndex(source),
    getHullEdgeFeatureIndex(source),
  );
  source.vertices.forEach(Object.freeze);
  Object.freeze(source.vertices);
  source.edges.forEach(Object.freeze);
  Object.freeze(source.edges);
  const index = getHullEdgeFeatureIndex(source);
  assert.equal(getHullEdgeFeatureIndex(source), index);
  assert.deepEqual(index.query(v(), v()), [0]);
});

test("nonfinite, invalid and uncertain edge/query bounds retain authored slots", () => {
  const index = createEdgeFeatureIndex(
    [v(), v(1), v(Infinity)],
    [
      [0, 1],
      [1, 2],
      [40, 0],
    ],
  );
  assert.deepEqual(index.query(v(50), v(51)), [1, 2]);
  assert.deepEqual(index.query(v(NaN), v()), [0, 1, 2]);
  assert.deepEqual(index.query(v(Infinity), v()), [0, 1, 2]);
  assert.deepEqual(index.query(v(1e100), v()), [0, 1, 2]);
  assert.deepEqual(index.query(v(2e12), v(2e12)), [0, 1, 2]);
  const huge = createEdgeFeatureIndex([v(-1e308), v(1e308)], [[0, 1]]);
  assert.deepEqual(huge.query(v(), v()), [0]);
});
