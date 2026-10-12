import assert from "node:assert/strict";
import test from "node:test";
import {
  createNativeTrackModelResource,
  invalidateNativeTrackResource,
  migrateNativeTrackResource,
  nativeRawModelBounds,
  nativeTrackRawBounds,
} from "../src/native-track-resources.ts";

const source = (positions = [1, 2, 3, -4, 5, -6]) => ({
  name: "synthetic bounds MODEL",
  flags: 0,
  pivot: [30, 40, 50],
  positions: new Float32Array(positions),
  uvs: new Float32Array(),
  materials: [],
  faces: [],
});
const diagnostics = () => ({
  requests: 0,
  cacheHits: 0,
  computations: 0,
  verticesVisited: 0,
  unmanagedRequests: 0,
});
const resource = (model = source()) => {
  const result = createNativeTrackModelResource(
    model,
    () => ({ resolved: true, value: null }),
    4,
  );
  assert.equal(result.resolved, true);
  return result.value;
};
const bounds = (r, d, cache = true) =>
  nativeTrackRawBounds(r, { diagnostics: d, cache });

test("managed raw bounds match the independent raw-vertex calculation and warm reads visit no vertices", () => {
  const r = resource();
  const d = diagnostics();
  const expected = nativeRawModelBounds(0x80, [
    [1, 2, 3],
    [-4, 5, -6],
  ]);
  const first = bounds(r, d);
  assert.deepEqual(first, expected);
  assert.deepEqual(bounds(r, d), expected);
  assert.deepEqual(d, {
    requests: 2,
    cacheHits: 1,
    computations: 1,
    verticesVisited: 2,
    unmanagedRequests: 0,
  });
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.value));
  assert.ok(Object.isFrozen(first.value.bounds));
  assert.ok(Object.isFrozen(first.value.bounds.min));
  assert.ok(Object.isFrozen(first.value.bounds.max));
});

test("cached and uncached scans preserve Float32 radius rounding and signed-zero bounds", () => {
  const r = resource(source([-0, -0, 0, 0, -0, 0, 1.1, 2.2, 3.3]));
  const d = diagnostics();
  const cached = bounds(r, d);
  const uncached = bounds(r, d, false);
  assert.deepEqual(cached, uncached);
  assert.equal(Object.is(cached.value.bounds.min[0], -0), true);
  assert.equal(Object.is(cached.value.bounds.min[1], -0), true);
  const x = Math.fround(1.1),
    y = Math.fround(2.2),
    z = Math.fround(3.3);
  const roundedMaximumSquare = Math.fround(y * y + z * z + x * x);
  assert.equal(
    cached.value.radius,
    Math.fround(Math.sqrt(roundedMaximumSquare)),
  );
  assert.equal(d.computations, 2);
  assert.equal(d.verticesVisited, 6);
});

test("managed in-place XYZ edits become visible after explicit revision invalidation", () => {
  const r = resource();
  const d = diagnostics();
  const old = bounds(r, d);
  invalidateNativeTrackResource(r);
  r.current.vertices[0].position[0] = -20;
  const updated = bounds(r, d);
  assert.equal(updated.value.bounds.min[0], -20);
  assert.equal(
    old.value.bounds.min[0],
    -4,
    "the earlier result remains an immutable snapshot",
  );
  assert.equal(d.computations, 2);
  assert.equal(d.verticesVisited, 4);
});

test("current table, vertex count, flags and vertex-array replacements each miss the cache", () => {
  const r = resource();
  const d = diagnostics();
  bounds(r, d);
  const edits = [
    () => {
      r.current.flags ^= 0x2;
    },
    () => {
      r.current.vertices = [...r.current.vertices];
    },
    () => {
      r.current.vertices.push({
        position: [7, 8, 9],
        uv: [0, 0],
        payload: null,
      });
    },
    () => {
      r.current = {
        ...r.current,
        vertices: r.current.vertices.map((v) => ({
          ...v,
          position: [...v.position],
        })),
      };
    },
  ];
  for (const edit of edits) {
    edit();
    bounds(r, d);
  }
  assert.equal(d.computations, 5);
  assert.equal(d.cacheHits, 0);
});

test("identity alone is part of the managed bounds cache key", () => {
  const r = resource();
  const d = diagnostics();
  bounds(r, d);
  r.current.identity = {};
  bounds(r, d);
  assert.equal(d.computations, 2);
  assert.equal(d.cacheHits, 0);
});

test("custom and empty bounds stay unresolved; unknown structural resources are rescanned live", () => {
  const custom = resource(source([1, 2, 3]));
  custom.current.flags |= 0x400;
  assert.equal(bounds(custom, diagnostics()).resolved, false);
  const empty = resource(source([]));
  assert.equal(bounds(empty, diagnostics()).resolved, false);

  const unmanaged = {
    current: {
      flags: 0,
      identity: {},
      vertices: [{ position: [1, 2, 3] }],
    },
  };
  const d = diagnostics();
  assert.equal(
    nativeTrackRawBounds(unmanaged, { diagnostics: d }).value.bounds.max[0],
    1,
  );
  unmanaged.current.vertices[0].position[0] = 12;
  assert.equal(
    nativeTrackRawBounds(unmanaged, { diagnostics: d }).value.bounds.max[0],
    12,
  );
  assert.equal(d.unmanagedRequests, 2);
  assert.equal(d.cacheHits, 0);
});

test("cached values cannot be changed by callers; pivot, UV and ACT style are not bounds inputs", () => {
  const r = resource();
  const d = diagnostics();
  const original = bounds(r, d);
  r.current.pivot[0] = -1000;
  r.current.vertices[0].uv[0] = 1000;
  r.current.actorRenderStyle ^= 0xff;
  const again = bounds(r, d);
  assert.deepEqual(again, original);
  assert.throws(() => {
    again.value.bounds.min[0] = -999;
  }, TypeError);
  assert.deepEqual(bounds(r, d), original);
  assert.equal(d.computations, 1);
  assert.equal(d.cacheHits, 2);
});

test("bounds cache is suspended through migration callbacks, including a throwing callback", () => {
  const model = source([0, 0, 0, 1, 0, 0]);
  model.faces = [{ indices: [0, 1, 0], material: 0, flags: 0, smoothing: 0 }];
  const r = resource(model);
  const d = diagnostics();
  const initial = bounds(r, d);
  const specs = [{ material: null, triggerType: 0, mode: 3, levelCount: 0 }];
  let observed, firstObserved;
  const providers = {
    spawnPedsOnFace() {
      r.current.vertices[0].position[0] = 25;
      observed = bounds(r, d);
    },
    copyVertexPayload: structuredClone,
    copyFacePayload: structuredClone,
  };
  assert.throws(
    () =>
      migrateNativeTrackResource(r, specs, {
        ...providers,
        spawnPedsOnFace() {
          r.current.vertices[0].position[0] = 25;
          firstObserved = bounds(r, d);
          r.current.vertices[0].position[0] = 50;
          observed = bounds(r, d);
          throw new Error("synthetic migration callback failure");
        },
      }),
    /synthetic migration callback failure/,
  );
  assert.equal(firstObserved.value.bounds.max[0], 25);
  assert.notDeepEqual(observed, initial);
  assert.equal(observed.value.bounds.max[0], 50);
  assert.equal(bounds(r, d).value.bounds.max[0], 50);
  bounds(r, d);
  assert.equal(d.computations, 4);
  assert.equal(d.cacheHits, 1);
});

test("successful migration callbacks cannot leave a reentrant bounds read cached", () => {
  const model = source([0, 0, 0, 1, 0, 0]);
  model.faces = [{ indices: [0, 1, 0], material: 0, flags: 0, smoothing: 0 }];
  const r = resource(model);
  const d = diagnostics();
  bounds(r, d);
  let observed;
  const migration = migrateNativeTrackResource(
    r,
    [{ material: null, triggerType: 0, mode: 3, levelCount: 0 }],
    {
      spawnPedsOnFace() {
        r.current.vertices[0].position[0] = 25;
        observed = bounds(r, d);
      },
      copyVertexPayload: structuredClone,
      copyFacePayload: structuredClone,
    },
  );
  assert.equal(migration.generated?.current.vertices.length, 2);
  assert.equal(observed.value.bounds.max[0], 25);
  assert.equal(bounds(r, d).value.bounds.max[0], 25);
  assert.equal(d.cacheHits, 0);
  assert.equal(d.computations, 3);
});
