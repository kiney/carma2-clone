import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import { BodyBroadphase } from "../src/physics/body-broadphase.ts";

const body = (immovable = false) => ({ properties: { immovable } });
const box = (min, max) => new Box3(new Vector3(...min), new Vector3(...max));
const cube = (x, y = 0, z = 0, half = 0.5) =>
  box([x - half, y - half, z - half], [x + half, y + half, z + half]);
function naive(bodies, bounds) {
  const pairs = [];
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++)
      if (
        !(bodies[i].properties.immovable && bodies[j].properties.immovable) &&
        bounds[i].intersectsBox(bounds[j])
      )
        pairs.push([i, j]);
  return pairs;
}
function random(seed) {
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}
function equivalent(index, bodies, bounds, diagnostics) {
  const before = bounds.map((b) => [...b.min.toArray(), ...b.max.toArray()]);
  assert.deepEqual(
    index.pairs(bodies, bounds, diagnostics),
    naive(bodies, bounds),
  );
  assert.deepEqual(
    bounds.map((b) => [...b.min.toArray(), ...b.max.toArray()]),
    before,
  );
}

test("body broadphase preserves original pair order, inclusive touches and duplicate identities", () => {
  const duplicate = body();
  const bodies = [
    body(true),
    duplicate,
    body(true),
    duplicate,
    body(),
    body(true),
  ];
  const bounds = [cube(0), cube(1), cube(1), cube(1), cube(2), cube(100)];
  const index = new BodyBroadphase();
  equivalent(index, bodies, bounds);
  assert.deepEqual(index.pairs(bodies, bounds), [
    [0, 1],
    [0, 3],
    [1, 2],
    [1, 3],
    [1, 4],
    [2, 3],
    [2, 4],
    [3, 4],
  ]);
  assert.deepEqual(index.pairs([], []), []);
  assert.throws(() => index.pairs(bodies, []), /one bound per body/);
});

test("static topology refits exact bounds and rebuilds for waking, reorder and replacement", () => {
  const index = new BodyBroadphase();
  const bodies = [body(true), body(), body(true), body(true)];
  const bounds = [cube(0), cube(0), cube(100), cube(200)];
  const diagnostics = {};
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.staticRebuilds, 1);
  equivalent(
    index,
    bodies,
    bounds.map((b) => b.clone()),
    diagnostics,
  );
  assert.equal(diagnostics.staticRebuilds, 0);
  bounds[1].translate(new Vector3(100, 0, 0));
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.staticRebuilds, 0);
  // Mutating the already supplied Box3 must invalidate a retained tree.
  bounds[2].translate(new Vector3(100, 0, 0));
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.staticRebuilds, 0);
  assert.equal(diagnostics.treeRefits, 1);
  assert.equal(diagnostics.boundsChanges, 1);
  bodies[2].properties.immovable = false;
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.staticRebuilds, 1);
  bodies[2].properties.immovable = true;
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.staticRebuilds, 1);
  [bodies[0], bodies[3]] = [bodies[3], bodies[0]];
  [bounds[0], bounds[3]] = [bounds[3], bounds[0]];
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.staticRebuilds, 1);
  bodies[0] = body(true);
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.staticRebuilds, 1);
  bodies.push(body(true));
  bounds.push(cube(100));
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.staticRebuilds, 1);
  bodies.splice(1, 1);
  bounds.splice(1, 1);
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.staticRebuilds, 1);
});

test("pathological bounds exactly retain Three overlap semantics without unsafe tree pruning", () => {
  const shapes = [
    new Box3(),
    box([10, 10, 10], [0, 0, 0]),
    box([-Infinity, -Infinity, -Infinity], [Infinity, Infinity, Infinity]),
    cube(0),
    cube(100),
    cube(0, 0, 0, 1000),
    box([-0, -0, -0], [0, 0, 0]),
    box([-Number.MAX_VALUE, -1, -1], [Number.MAX_VALUE, 1, 1]),
    box([Number.MAX_VALUE * 0.9, -1, -1], [Number.MAX_VALUE, 1, 1]),
  ];
  for (const axis of ["x", "y", "z"])
    for (const endpoint of ["min", "max"])
      for (const value of [NaN, Infinity, -Infinity]) {
        const altered = cube(0);
        altered[endpoint][axis] = value;
        shapes.push(altered);
      }
  const index = new BodyBroadphase();
  const bodies = shapes.map((_, i) => body(i % 3 !== 0));
  equivalent(index, bodies, shapes);
  // An inverted finite box can intersect an enclosing box under intersectsBox.
  assert.equal(shapes[1].intersectsBox(shapes[5]), true);
  shapes[0].copy(cube(100));
  shapes[1].min.x = NaN;
  equivalent(index, bodies, shapes);
  bodies.reverse();
  shapes.reverse();
  equivalent(index, bodies, shapes);
  for (const b of bodies) b.properties.immovable = false;
  equivalent(index, bodies, shapes);
});

test("seeded arbitrary rosters and bound sizes match naive candidate enumeration", () => {
  const rand = random(0x12abcd);
  const index = new BodyBroadphase();
  for (let run = 0; run < 180; run++) {
    const count = Math.floor(rand() * 110);
    const bodies = Array.from({ length: count }, () => body(rand() < 0.8));
    const bounds = bodies.map(() => {
      const min = Array.from({ length: 3 }, () => (rand() - 0.5) * 80);
      const max = min.map((n) => n + rand() * (run % 9 === 0 ? 150 : 12));
      return box(min, max);
    });
    equivalent(index, bodies, bounds);
    equivalent(
      index,
      bodies,
      bounds.map((b) => b.clone()),
    );
  }
});

test("repeated in-place movement, sleeping, wake-up and roster edits match naive discovery", () => {
  const rand = random(0x334455);
  const index = new BodyBroadphase();
  const bodies = Array.from({ length: 80 }, () => body(rand() < 0.9));
  const bounds = bodies.map(() => cube(rand() * 50, rand() * 5, rand() * 20));
  for (let phase = 0; phase < 160; phase++) {
    for (let edit = 0; edit < 5; edit++) {
      const i = Math.floor(rand() * bodies.length);
      bounds[i].translate(
        new Vector3((rand() - 0.5) * 15, 0, (rand() - 0.5) * 5),
      );
      if (rand() < 0.3)
        bodies[i].properties.immovable = !bodies[i].properties.immovable;
    }
    if (phase % 5 === 0) {
      const i = Math.floor(rand() * bodies.length),
        j = Math.floor(rand() * bodies.length);
      [bodies[i], bodies[j]] = [bodies[j], bodies[i]];
      [bounds[i], bounds[j]] = [bounds[j], bounds[i]];
    }
    if (phase % 7 === 0) {
      bodies.push(body(rand() < 0.9));
      bounds.push(cube(rand() * 50, 0, rand() * 20));
    }
    if (phase % 11 === 0) {
      const i = Math.floor(rand() * bodies.length);
      bodies.splice(i, 1);
      bounds.splice(i, 1);
    }
    equivalent(index, bodies, bounds);
  }
});

test("sparse 480-body fixture avoids static/static discovery and most movable-involving bound tests", () => {
  const bodies = Array.from({ length: 480 }, (_, i) => body(i < 466));
  const bounds = bodies.map((_, i) =>
    cube((i < 466 ? i : (i - 466) * 31) * 10),
  );
  const index = new BodyBroadphase(),
    diagnostics = {};
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.bodies, 480);
  assert.equal(diagnostics.movable, 14);
  assert.equal(diagnostics.immovable, 466);
  assert.equal(diagnostics.exceptionalBounds, 0);
  assert.equal(diagnostics.pairs, 14);
  assert.ok(
    diagnostics.boundsTests < 200,
    `${diagnostics.boundsTests} leaf bound tests`,
  );
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.staticRebuilds, 0);
  assert.ok(
    diagnostics.nodeTests < 400,
    `${diagnostics.nodeTests} node bound tests`,
  );
  for (const b of bodies) b.properties.immovable = true;
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.candidates, 0);
  assert.equal(diagnostics.boundsTests, 0);
});

test("both trees persist topology and refit only changed leaves and ancestors", () => {
  const index = new BodyBroadphase();
  const bodies = Array.from({ length: 256 }, (_, i) => body(i < 128));
  const bounds = bodies.map((_, i) => cube((i % 128) * 10));
  const diagnostics = {};
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.staticRebuilds, 1);
  assert.equal(diagnostics.movingRebuilds, 1);
  assert.equal(diagnostics.boundsChanges, 256);
  equivalent(
    index,
    bodies,
    bounds.map((b) => b.clone()),
    diagnostics,
  );
  assert.equal(diagnostics.staticRebuilds, 0);
  assert.equal(diagnostics.movingRebuilds, 0);
  assert.equal(diagnostics.treeRefits, 0);
  assert.equal(diagnostics.boundsChanges, 0);
  // A 128-entry tree has 32 four-slot leaves: one changed slot refits
  // exactly its leaf plus the five ancestors, independent of roster size.
  for (const slot of [200, 72]) {
    bounds[slot].translate(new Vector3(0.1, 0, 0));
    equivalent(index, bodies, bounds, diagnostics);
    assert.equal(diagnostics.staticRebuilds, 0);
    assert.equal(diagnostics.movingRebuilds, 0);
    assert.equal(diagnostics.treeRefits, 6);
    assert.equal(diagnostics.boundsChanges, 1);
  }
  for (const b of bounds) b.translate(new Vector3(0.1, 0, 0));
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.treeRefits, 126);
  assert.equal(diagnostics.boundsChanges, 256);
  assert.equal(diagnostics.staticRebuilds, 0);
  assert.equal(diagnostics.movingRebuilds, 0);
});

test("all slots refit before incident queries, including an empty incident call", () => {
  const index = new BodyBroadphase();
  const bodies = Array.from({ length: 64 }, (_, i) => body(i < 32));
  const bounds = bodies.map((_, i) => cube(i * 10));
  const diagnostics = {};
  index.pairs(bodies, bounds);
  // Neither changed slot belongs to the incident set. Both tree branches must
  // nevertheless refit, or the source query would prune these new neighbors.
  bounds[1].copy(bounds[40]);
  bounds[50].copy(bounds[40]);
  const incident = new Set([bodies[40]]);
  const expected = () =>
    naive(bodies, bounds).filter(
      ([i, j]) => incident.has(bodies[i]) || incident.has(bodies[j]),
    );
  assert.deepEqual(
    index.pairs(bodies, bounds, diagnostics, incident),
    expected(),
  );
  assert.equal(diagnostics.boundsChanges, 2);
  assert.ok(diagnostics.treeRefits > 0);
  bounds[2].copy(bounds[40]);
  bounds[51].copy(bounds[40]);
  assert.deepEqual(index.pairs(bodies, bounds, diagnostics, new Set()), []);
  assert.equal(diagnostics.boundsChanges, 2);
  assert.ok(diagnostics.treeRefits > 0);
  assert.equal(diagnostics.nodeTests, 0);
  assert.deepEqual(
    index.pairs(bodies, bounds, diagnostics, incident),
    expected(),
  );
  assert.equal(diagnostics.treeRefits, 0);
});

test("exact scalar snapshots distinguish signed zero and retain unchanged NaN", () => {
  const index = new BodyBroadphase();
  const bodies = [body(true), body(), body()];
  const bounds = [cube(0), box([-0, 0, 0], [1, 1, 1]), cube(0)];
  bounds[2].min.x = NaN;
  const diagnostics = {};
  equivalent(index, bodies, bounds, diagnostics);
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.boundsChanges, 0);
  assert.equal(diagnostics.treeRefits, 0);
  bounds[1].min.x = 0;
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.boundsChanges, 1);
  assert.equal(diagnostics.treeRefits, 1);
  assert.equal(diagnostics.movingRebuilds, 0);
  bounds[1].min.y = NaN;
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.movingRebuilds, 1);
  assert.equal(diagnostics.staticRebuilds, 0);
  bounds[1].min.z = Infinity;
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.movingRebuilds, 0);
  assert.equal(diagnostics.treeRefits, 0);
  bounds[1].copy(cube(0));
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.movingRebuilds, 1);
});

test("spatial permutation triggers a bounded measured quality rebuild for either tree", () => {
  for (const immovable of [false, true]) {
    const index = new BodyBroadphase();
    const bodies = Array.from({ length: 128 }, () => body(immovable));
    const bounds = bodies.map((_, i) => cube(i * 10));
    // Give the static fixture an eligible query source without changing its tree.
    bodies.push(body());
    bounds.push(cube(0));
    const diagnostics = {};
    equivalent(index, bodies, bounds, diagnostics);
    for (let i = 0; i < 128; i++) {
      let reversed = 0;
      for (let bit = 0; bit < 7; bit++)
        reversed = reversed * 2 + ((i >> bit) & 1);
      bounds[i].copy(cube(reversed * 10));
    }
    equivalent(index, bodies, bounds, diagnostics);
    assert.equal(diagnostics.qualityRebuilds, 1);
    assert.equal(
      immovable ? diagnostics.staticRebuilds : diagnostics.movingRebuilds,
      1,
    );
    assert.ok(diagnostics.treeRefits > 0);
    assert.ok(diagnostics.boundsTests < 128 * 16);
    equivalent(index, bodies, bounds, diagnostics);
    assert.equal(diagnostics.qualityRebuilds, 0);
    assert.equal(diagnostics.staticRebuilds, 0);
    assert.equal(diagnostics.movingRebuilds, 0);
    assert.equal(diagnostics.treeRefits, 0);
  }
});

test("persistent randomized edits preserve full and incident discovery with exceptional and duplicate slots", () => {
  const rand = random(0x194795);
  const index = new BodyBroadphase();
  const duplicate = body();
  const bodies = Array.from({ length: 70 }, (_, i) =>
    i % 9 === 0 ? duplicate : body(rand() < 0.5),
  );
  const bounds = bodies.map(() => cube(rand() * 80, rand() * 2, rand() * 20));
  for (let phase = 0; phase < 160; phase++) {
    for (let edit = 0; edit < 6; edit++) {
      const i = Math.floor(rand() * bodies.length);
      if (edit === 0) {
        bounds[i].copy(cube(rand() * 80, rand() * 2, rand() * 20));
        const variant = phase % 6;
        if (variant === 0) bounds[i].min.x = NaN;
        if (variant === 1) bounds[i].max.y = Infinity;
        if (variant === 2) bounds[i].min.z = bounds[i].max.z + 1;
        if (variant === 3) bounds[i].makeEmpty();
      } else if (edit === 1) {
        bodies[i].properties.immovable = !bodies[i].properties.immovable;
      } else
        bounds[i].translate(
          new Vector3((rand() - 0.5) * 4, 0, (rand() - 0.5) * 4),
        );
    }
    if (phase % 4 === 0) {
      const i = Math.floor(rand() * bodies.length),
        j = Math.floor(rand() * bodies.length);
      [bodies[i], bodies[j]] = [bodies[j], bodies[i]];
      [bounds[i], bounds[j]] = [bounds[j], bounds[i]];
    }
    if (phase % 11 === 0) {
      const i = Math.floor(rand() * bodies.length);
      bodies.splice(i, 1);
      bounds.splice(i, 1);
    }
    if (phase % 7 === 0) {
      bodies.push(phase % 14 === 0 ? duplicate : body(rand() < 0.5));
      bounds.push(cube(rand() * 80));
    }
    const incident = new Set(bodies.filter(() => rand() < 0.2));
    const expected = naive(bodies, bounds);
    // Query incident first so an intervening full query cannot hide stale refits.
    assert.deepEqual(
      index.pairs(bodies, bounds, undefined, incident),
      expected.filter(
        ([i, j]) => incident.has(bodies[i]) || incident.has(bodies[j]),
      ),
    );
    equivalent(index, bodies, bounds);
  }
});

test("coincident zero-extent and extreme finite bounds retain stable quality", () => {
  for (const point of [
    0,
    Number.MIN_VALUE,
    Number.MAX_VALUE,
    -Number.MAX_VALUE,
  ]) {
    const index = new BodyBroadphase();
    const bodies = Array.from({ length: 32 }, (_, i) => body(i < 16));
    const bounds = bodies.map(() =>
      box([point, point, point], [point, point, point]),
    );
    const diagnostics = {};
    equivalent(index, bodies, bounds, diagnostics);
    for (let run = 0; run < 3; run++) {
      equivalent(index, bodies, bounds, diagnostics);
      assert.equal(diagnostics.staticRebuilds, 0);
      assert.equal(diagnostics.movingRebuilds, 0);
      assert.equal(diagnostics.qualityRebuilds, 0);
      assert.equal(diagnostics.treeRefits, 0);
    }
    // Refit both zero-span trees to another coincident point, including
    // opposite extreme endpoints, without spuriously degrading their quality.
    const destination =
      point === Number.MAX_VALUE ? -Number.MAX_VALUE : Number.MAX_VALUE;
    for (const b of bounds) {
      b.min.set(destination, destination, destination);
      b.max.copy(b.min);
    }
    equivalent(index, bodies, bounds, diagnostics);
    assert.equal(diagnostics.staticRebuilds, 0);
    assert.equal(diagnostics.movingRebuilds, 0);
    assert.equal(diagnostics.qualityRebuilds, 0);
    assert.ok(diagnostics.treeRefits > 0);
  }
  const index = new BodyBroadphase();
  const bodies = Array.from({ length: 48 }, (_, i) => body(i < 24));
  const bounds = bodies.map((_, i) =>
    box(
      [-Number.MAX_VALUE, -i, -Number.MIN_VALUE],
      [Number.MAX_VALUE, i, Number.MIN_VALUE],
    ),
  );
  equivalent(index, bodies, bounds);
  for (let i = 0; i < bounds.length; i++) bounds[i].max.y += 1;
  const diagnostics = {};
  equivalent(index, bodies, bounds, diagnostics);
  assert.equal(diagnostics.qualityRebuilds, 0);
  assert.equal(diagnostics.staticRebuilds, 0);
  assert.equal(diagnostics.movingRebuilds, 0);
});
