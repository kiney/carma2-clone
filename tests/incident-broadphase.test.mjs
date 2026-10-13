import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import { BodyBroadphase } from "../src/physics/body-broadphase.ts";

const body = (immovable = false) => ({ properties: { immovable } });
const box = (min, max) => new Box3(new Vector3(...min), new Vector3(...max));
const cube = (x, half = 0.5) =>
  box([x - half, -half, -half], [x + half, half, half]);
function reference(bodies, bounds, incident) {
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
function check(index, bodies, bounds, incident, diagnostics) {
  const before = bounds.map((bound) => [
    ...bound.min.toArray(),
    ...bound.max.toArray(),
  ]);
  const full = index.pairs(bodies, bounds);
  const result = index.pairs(bodies, bounds, diagnostics, incident);
  assert.deepEqual(full, reference(bodies, bounds));
  assert.deepEqual(result, reference(bodies, bounds, incident));
  assert.deepEqual(
    result,
    full.filter(([i, j]) => incident.has(bodies[i]) || incident.has(bodies[j])),
  );
  assert.deepEqual(
    bounds.map((bound) => [...bound.min.toArray(), ...bound.max.toArray()]),
    before,
  );
  return result;
}

test("dirty moving body discovers unchanged lower and higher moving/fixed neighbors", () => {
  const bodies = [body(), body(true), body(), body(true), body(), body()];
  const bounds = [cube(0), cube(0), cube(0), cube(0), cube(0), cube(100)];
  const index = new BodyBroadphase();
  assert.deepEqual(check(index, bodies, bounds, new Set([bodies[2]])), [
    [0, 2],
    [1, 2],
    [2, 3],
    [2, 4],
  ]);
});

test("dirty fixed body discovers all moving neighbors without fixed/fixed pairs", () => {
  const bodies = [body(), body(true), body(), body(true), body()];
  const bounds = bodies.map(() => cube(0));
  assert.deepEqual(
    check(new BodyBroadphase(), bodies, bounds, new Set([bodies[3]])),
    [
      [0, 3],
      [2, 3],
      [3, 4],
    ],
  );
});

test("both incident endpoints, duplicate body identities and touches retain canonical pairs once", () => {
  const duplicate = body();
  const bodies = [body(true), duplicate, body(true), duplicate, body()];
  const bounds = [cube(0), cube(1), cube(1), cube(1), cube(2)];
  const index = new BodyBroadphase();
  check(index, bodies, bounds, new Set([duplicate]));
  check(index, bodies, bounds, new Set([bodies[0], duplicate, bodies[2]]));
  assert.deepEqual(
    check(index, bodies, bounds, new Set(bodies)),
    index.pairs(bodies, bounds),
  );
});

test("empty/foreign incident sets do no spatial discovery while validating the roster", () => {
  const index = new BodyBroadphase();
  const bodies = [body(), body(true), body()];
  const bounds = bodies.map(() => cube(0));
  const diagnostics = {};
  assert.deepEqual(index.pairs(bodies, bounds, diagnostics, new Set()), []);
  assert.equal(diagnostics.staticRebuilds, 1);
  assert.equal(diagnostics.bodies, 3);
  assert.equal(diagnostics.movable, 2);
  assert.equal(diagnostics.immovable, 1);
  assert.equal(diagnostics.nodeTests, 0);
  assert.equal(diagnostics.candidates, 0);
  bounds[1].translate(new Vector3(100, 0, 0));
  assert.deepEqual(
    index.pairs(bodies, bounds, diagnostics, new Set([body()])),
    [],
  );
  assert.equal(diagnostics.staticRebuilds, 1);
  check(index, bodies, bounds, new Set([bodies[0]]));
  assert.deepEqual(index.pairs([], [], diagnostics, new Set()), []);
  assert.throws(
    () => index.pairs(bodies, [], diagnostics, new Set()),
    /one bound per body/,
  );
});

test("incident discovery validates changed static bounds, wake/sleep, replacement and roster order", () => {
  const index = new BodyBroadphase();
  const bodies = [body(), body(true), body(true), body(), body(true)];
  const bounds = [cube(0), cube(100), cube(200), cube(200), cube(300)];
  const diagnostics = {};
  index.pairs(bodies, bounds);
  // A callback moves a fixed collider into an unchanged moving body's path.
  bounds[1].copy(cube(0));
  assert.deepEqual(
    index.pairs(bodies, bounds, diagnostics, new Set([bodies[1]])),
    [[0, 1]],
  );
  assert.equal(diagnostics.staticRebuilds, 1);
  assert.deepEqual(
    index.pairs(bodies, bounds, diagnostics, new Set([bodies[1]])),
    [[0, 1]],
  );
  assert.equal(diagnostics.staticRebuilds, 0);
  bodies[1].properties.immovable = false;
  check(index, bodies, bounds, new Set([bodies[1]]), diagnostics);
  bodies[1].properties.immovable = true;
  check(index, bodies, bounds, new Set([bodies[1]]), diagnostics);
  [bodies[0], bodies[4]] = [bodies[4], bodies[0]];
  [bounds[0], bounds[4]] = [bounds[4], bounds[0]];
  check(index, bodies, bounds, new Set([bodies[1]]), diagnostics);
  bodies[1] = body(true);
  check(index, bodies, bounds, new Set([bodies[1]]), diagnostics);
  bodies.push(body());
  bounds.push(cube(300));
  check(index, bodies, bounds, new Set([bodies[0], bodies.at(-1)]));
  bodies.splice(2, 1);
  bounds.splice(2, 1);
  check(index, bodies, bounds, new Set(bodies));
});

test("malformed and extreme bounds preserve Three intersection semantics for incident endpoints", () => {
  const bounds = [
    new Box3(),
    box([10, 10, 10], [0, 0, 0]),
    box([-Infinity, -Infinity, -Infinity], [Infinity, Infinity, Infinity]),
    cube(0),
    cube(100),
    cube(0, 1000),
    box([-0, -0, -0], [0, 0, 0]),
    box([-Number.MAX_VALUE, -1, -1], [Number.MAX_VALUE, 1, 1]),
    box([Number.MAX_VALUE * 0.9, -1, -1], [Number.MAX_VALUE, 1, 1]),
  ];
  for (const axis of ["x", "y", "z"])
    for (const endpoint of ["min", "max"])
      for (const value of [NaN, Infinity, -Infinity]) {
        const altered = cube(0);
        altered[endpoint][axis] = value;
        bounds.push(altered);
      }
  const bodies = bounds.map((_, i) => body(i % 3 !== 0));
  const index = new BodyBroadphase();
  for (const incident of bodies)
    check(index, bodies, bounds, new Set([incident]));
  check(index, bodies, bounds, new Set(bodies.filter((_, i) => i % 2 === 0)));
  bodies.reverse();
  bounds.reverse();
  check(index, bodies, bounds, new Set(bodies.filter((_, i) => i % 2 === 0)));
});

test("bounded seeded small rosters match a full query filtered by incident membership", () => {
  let seed = 0x5315ab;
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const index = new BodyBroadphase();
  for (let run = 0; run < 40; run++) {
    const bodies = Array.from({ length: 2 + Math.floor(rand() * 14) }, () =>
      body(rand() < 0.6),
    );
    const bounds = bodies.map(() => {
      const min = Array.from({ length: 3 }, () => (rand() - 0.5) * 10);
      return box(
        min,
        min.map((value) => value + rand() * 5),
      );
    });
    const incident = new Set(bodies.filter(() => rand() < 0.25));
    check(index, bodies, bounds, incident);
  }
});

test("localized incident queries reduce actual tree traversal and candidate/bounds work", () => {
  const bodies = [];
  const bounds = [];
  for (let cluster = 0; cluster < 12; cluster++) {
    bodies.push(body(), body(true), body(), body(true));
    bounds.push(
      cube(cluster * 10),
      cube(cluster * 10),
      cube(cluster * 10),
      cube(cluster * 10),
    );
  }
  const index = new BodyBroadphase();
  const full = {};
  const local = {};
  const pairs = index.pairs(bodies, bounds, full);
  const incident = new Set([bodies[2]]);
  assert.deepEqual(
    index.pairs(bodies, bounds, local, incident),
    pairs.filter(
      ([i, j]) => incident.has(bodies[i]) || incident.has(bodies[j]),
    ),
  );
  for (const counter of ["nodeTests", "candidates", "boundsTests"])
    assert.ok(
      local[counter] < full[counter] / 4,
      `${counter}: incident=${local[counter]}, full=${full[counter]}`,
    );
  assert.equal(local.staticRebuilds, 0);
  assert.equal(
    local.bodies,
    full.bodies,
    "full roster remains available for discovery",
  );
  assert.equal(local.pairs, 3);
  const fixed = {};
  const fixedIncident = new Set([bodies[1]]);
  assert.deepEqual(
    index.pairs(bodies, bounds, fixed, fixedIncident),
    pairs.filter(
      ([i, j]) => fixedIncident.has(bodies[i]) || fixedIncident.has(bodies[j]),
    ),
  );
  for (const counter of ["nodeTests", "candidates", "boundsTests"])
    assert.ok(
      fixed[counter] < full[counter] / 4,
      `fixed ${counter}: incident=${fixed[counter]}, full=${full[counter]}`,
    );
  assert.equal(fixed.pairs, 2);
});
