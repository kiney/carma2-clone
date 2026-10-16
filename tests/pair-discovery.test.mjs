import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import { BodyBroadphase } from "../src/physics/body-broadphase.ts";
import { RetainedPairDiscovery } from "../src/physics/pair-discovery.ts";

const body = (immovable = false) => ({ properties: { immovable } });
const box = (min, max) => new Box3(new Vector3(...min), new Vector3(...max));
const cube = (x, half = 0.5) =>
  box([x - half, -half, -half], [x + half, half, half]);
function oracle(bodies, bounds, incident) {
  const pairs = [];
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++)
      if (
        !(bodies[i].properties.immovable && bodies[j].properties.immovable) &&
        (!incident || incident.has(bodies[i]) || incident.has(bodies[j])) &&
        bounds[i].intersectsBox(bounds[j])
      )
        pairs.push([i, j]);
  return pairs;
}

class CountingIndex extends BodyBroadphase {
  calls = [];
  pairs(bodies, bounds, diagnostics, incident) {
    this.calls.push(incident ? new Set(incident) : undefined);
    return super.pairs(bodies, bounds, diagnostics, incident);
  }
}

function check(
  discovery,
  bodies,
  bounds,
  versions,
  incident,
  diagnostics = {},
) {
  assert.deepEqual(
    discovery.pairs(bodies, bounds, versions, diagnostics, incident),
    oracle(bodies, bounds, incident),
  );
  assert.equal(diagnostics.pairDiscoveryCalls, 1);
  assert.equal(
    diagnostics.retainedPairCandidates,
    oracle(bodies, bounds).length,
  );
  assert.equal(diagnostics.bodies, bodies.length);
  assert.equal(
    diagnostics.immovable,
    bodies.filter((b) => b.properties.immovable).length,
  );
  assert.equal(diagnostics.movable, bodies.length - diagnostics.immovable);
  assert.equal(diagnostics.pairs, oracle(bodies, bounds, incident).length);
  return diagnostics;
}

test("response-only changes hit retained adjacency without querying the persistent index", () => {
  const index = new CountingIndex();
  const discovery = new RetainedPairDiscovery(index);
  const bodies = [body(), body(true), body()];
  const bounds = [cube(0), cube(0), cube(20)];
  const versions = bodies.map(() => ({}));
  const diagnostics = check(discovery, bodies, bounds, versions);
  assert.equal(index.calls.length, 1);
  assert.equal(diagnostics.pairDiscoveryHits, 0);
  assert.equal(diagnostics.pairDiscoveryChangedSources, 3);
  assert.ok(diagnostics.nodeTests > 0);
  bodies[0].velocity = new Vector3(5, 0, 0);
  bodies[1].damage = 500;
  for (const incident of [new Set(), new Set([bodies[0]]), undefined]) {
    check(discovery, bodies, bounds, versions, incident, diagnostics);
    assert.equal(diagnostics.pairDiscoveryHits, 1);
    assert.equal(diagnostics.pairDiscoveryChangedSources, 0);
    for (const counter of [
      "staticRebuilds",
      "movingRebuilds",
      "qualityRebuilds",
      "boundsChanges",
      "treeRefits",
      "nodeTests",
      "candidates",
      "boundsTests",
    ])
      assert.equal(diagnostics[counter], 0, counter);
  }
  assert.equal(index.calls.length, 1);
  // An explicit shape certificate change still refreshes discovery when its
  // broadphase bound happens to remain identical.
  versions[0] = {};
  check(discovery, bodies, bounds, versions, undefined, diagnostics);
  assert.equal(index.calls.length, 2);
  assert.equal(diagnostics.pairDiscoveryChangedSources, 1);
  assert.equal(diagnostics.pairDiscoveryHits, 0);
  assert.equal(diagnostics.boundsChanges, 0);
  assert.ok(diagnostics.nodeTests > 0);
  // A new tick retains the existing BVH but establishes its own adjacency.
  check(new RetainedPairDiscovery(index), bodies, bounds, versions);
  assert.equal(index.calls.length, 3);
});

test("changed nonincident neighbors discover and remove contacts before incident selection", () => {
  const index = new CountingIndex();
  const discovery = new RetainedPairDiscovery(index);
  const bodies = [body(), body(true), body(), body(true)];
  const bounds = [cube(0), cube(100), cube(0), cube(0)];
  const versions = bodies.map(() => ({}));
  const incident = new Set([bodies[0]]);
  check(discovery, bodies, bounds, versions, new Set());
  assert.equal(
    index.calls[0],
    undefined,
    "cold discovery uses the full roster",
  );
  bounds[1] = cube(0);
  versions[1] = {};
  const diagnostics = check(discovery, bodies, bounds, versions, incident);
  assert.deepEqual(index.calls.at(-1), new Set([bodies[1]]));
  assert.equal(diagnostics.pairDiscoveryChangedSources, 1);
  assert.equal(diagnostics.pairDiscoveryHits, 0);
  assert.deepEqual(discovery.pairs(bodies, bounds, versions, {}, incident), [
    [0, 1],
    [0, 2],
    [0, 3],
  ]);
  bounds[1] = cube(200);
  versions[1] = {};
  // Empty output still validates and updates the complete roster.
  check(discovery, bodies, bounds, versions, new Set());
  check(discovery, bodies, bounds, versions, incident);
  assert.equal(index.calls.length, 3);
});

test("mobility changes without a new geometry version invalidate all affected pairs", () => {
  const index = new CountingIndex();
  const discovery = new RetainedPairDiscovery(index);
  const bodies = [body(true), body(true), body(), body()];
  const bounds = bodies.map(() => cube(0));
  const versions = bodies.map(() => ({}));
  check(discovery, bodies, bounds, versions);
  bodies[1].properties.immovable = false;
  let diagnostics = check(
    discovery,
    bodies,
    bounds,
    versions,
    new Set([bodies[0]]),
  );
  assert.equal(diagnostics.pairDiscoveryChangedSources, 1);
  assert.deepEqual(index.calls.at(-1), new Set([bodies[1]]));
  bodies[2].properties.immovable = true;
  bodies[3].properties.immovable = true;
  diagnostics = check(
    discovery,
    bodies,
    bounds,
    versions,
    new Set([bodies[0]]),
  );
  assert.equal(diagnostics.pairDiscoveryChangedSources, 2);
  bodies[1].properties.immovable = true;
  check(discovery, bodies, bounds, versions);
  assert.deepEqual(discovery.pairs(bodies, bounds, versions), []);
});

test("duplicate identities retain slot order through single-slot changes and roster edits", () => {
  const index = new CountingIndex();
  const discovery = new RetainedPairDiscovery(index);
  const duplicate = body();
  const fixed = body(true);
  const bodies = [duplicate, fixed, duplicate, body(), fixed];
  const bounds = [cube(0), cube(0), cube(0), cube(1), cube(0)];
  const versions = bodies.map(() => ({}));
  check(discovery, bodies, bounds, versions, new Set([duplicate]));
  bounds[2] = cube(200);
  versions[2] = {};
  const diagnostics = check(
    discovery,
    bodies,
    bounds,
    versions,
    new Set([duplicate]),
  );
  assert.equal(diagnostics.pairDiscoveryChangedSources, 1);
  check(discovery, bodies, bounds, versions);
  duplicate.properties.immovable = true;
  check(discovery, bodies, bounds, versions);
  duplicate.properties.immovable = false;
  check(discovery, bodies, bounds, versions);
  for (const array of [bodies, bounds, versions])
    [array[0], array[3]] = [array[3], array[0]];
  check(discovery, bodies, bounds, versions, new Set([duplicate]));
  assert.equal(index.calls.at(-1), undefined, "reordering rebuilds adjacency");
  for (const array of [bodies, bounds, versions]) array.splice(1, 1);
  check(discovery, bodies, bounds, versions);
  assert.equal(index.calls.at(-1), undefined, "removal rebuilds adjacency");
  bodies[0] = body();
  check(discovery, bodies, bounds, versions);
  assert.equal(index.calls.at(-1), undefined, "replacement rebuilds adjacency");
  assert.throws(() => discovery.pairs(bodies, [], versions), /one bound/);
  assert.throws(() => discovery.pairs(bodies, bounds, []), /geometry version/);
  check(discovery, bodies, bounds, versions);
  check(discovery, [], [], []);
  check(discovery, [], [], []);
});

test("exceptional bounds preserve exact Three eligibility and cached roster statistics", () => {
  const bounds = [
    new Box3(),
    box([10, 10, 10], [0, 0, 0]),
    box([-Infinity, -Infinity, -Infinity], [Infinity, Infinity, Infinity]),
    cube(0),
    cube(1),
    box([-0, -0, -0], [0, 0, 0]),
    box([-Number.MAX_VALUE, -1, -1], [Number.MAX_VALUE, 1, 1]),
  ];
  for (const axis of ["x", "y", "z"])
    for (const endpoint of ["min", "max"])
      for (const value of [NaN, Infinity, -Infinity]) {
        const altered = cube(0);
        altered[endpoint][axis] = value;
        bounds.push(altered);
      }
  const bodies = bounds.map((_, i) => body(i % 3 !== 0));
  const versions = bodies.map(() => ({}));
  const discovery = new RetainedPairDiscovery(new BodyBroadphase());
  const diagnostics = check(discovery, bodies, bounds, versions);
  const expectedExceptional = diagnostics.exceptionalBounds;
  for (const incident of bodies) {
    check(
      discovery,
      bodies,
      bounds,
      versions,
      new Set([incident]),
      diagnostics,
    );
    assert.equal(diagnostics.exceptionalBounds, expectedExceptional);
    assert.equal(diagnostics.nodeTests, 0);
  }
  bounds[3] = bounds[0].clone();
  versions[3] = {};
  check(discovery, bodies, bounds, versions, new Set([bodies[4]]), diagnostics);
  assert.equal(diagnostics.exceptionalBounds, expectedExceptional + 1);
  bounds[0] = cube(0);
  versions[0] = {};
  check(discovery, bodies, bounds, versions, undefined, diagnostics);
  assert.equal(diagnostics.exceptionalBounds, expectedExceptional);
});

test("seeded motion, versions, roster churn and duplicate classes match the exact oracle", () => {
  let seed = 0x4a4f127;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const index = new CountingIndex();
  const discovery = new RetainedPairDiscovery(index);
  const pool = Array.from({ length: 12 }, () => body(rand() < 0.5));
  const bodies = pool.slice(0, 9);
  const bounds = bodies.map(() => cube(rand() * 10, 1));
  const versions = bodies.map(() => ({}));
  for (let step = 0; step < 180; step++) {
    const slot = Math.floor(rand() * bodies.length);
    switch (step % 7) {
      case 0:
      case 1:
        bounds[slot] = cube(rand() * 10, 1);
        versions[slot] = {};
        break;
      case 2:
        bodies[slot].properties.immovable = !bodies[slot].properties.immovable;
        break;
      case 3: {
        const other = Math.floor(rand() * bodies.length);
        for (const array of [bodies, bounds, versions])
          [array[slot], array[other]] = [array[other], array[slot]];
        break;
      }
      case 4:
        if (bodies.length > 4)
          for (const array of [bodies, bounds, versions]) array.splice(slot, 1);
        break;
      case 5:
        bodies.push(pool[Math.floor(rand() * pool.length)]);
        bounds.push(cube(rand() * 10, 1));
        versions.push({});
        break;
      case 6:
        bodies[slot].responseValue = step;
        break;
    }
    const incident = new Set(bodies.filter(() => rand() < 0.3));
    check(discovery, bodies, bounds, versions, incident);
    const calls = index.calls.length;
    const hit = check(discovery, bodies, bounds, versions);
    assert.equal(index.calls.length, calls);
    assert.equal(hit.pairDiscoveryHits, 1);
    assert.equal(hit.nodeTests, 0);
  }
});
