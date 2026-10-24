import test from "node:test";
import assert from "node:assert/strict";
import { createVehicle, updateVehicle } from "../src/legacy-arcade.ts";
import { Vector3 } from "three";
import { RoadNavigator } from "../src/ai.ts";

import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { decodeText } from "../src/formats.ts";
import { parseTrackConfig } from "../src/config.ts";
import { WorldCollision, batchStaticWorld } from "../src/world.ts";

const point = (x, z, y = 0) => new Vector3(x, y, z);
const junction = [point(0, 0), point(0, -5), point(0, -10), point(5, -5)];
const edges = [
  [0, 1],
  [1, 2],
  [1, 3],
];

test("committed graph traversal avoids immediate U turns at junctions and is deterministic", () => {
  const a = new RoadNavigator(junction, edges);
  const b = new RoadNavigator(junction, edges);
  assert.deepEqual(
    a.update(point(0, 0), 0, 1, 1 / 60),
    b.update(point(0, 0), 0, 1, 1 / 60),
  );
  assert.equal(a.currentNode, 0);
  assert.equal(a.nextNode, 1);
  a.update(point(0, -4.8), 0, 1, 1 / 60);
  assert.equal(a.currentNode, 1);
  assert.equal(
    a.nextNode,
    2,
    "aligned continuation is chosen instead of the previous node",
  );
  a.update(point(0, -9.8), 0, 1, 1 / 60);
  assert.equal(
    a.nextNode,
    1,
    "a real dead end permits the necessary return leg",
  );
});

test("optional targets choose road routes at junctions instead of direct off-road pursuit", () => {
  const navigator = new RoadNavigator(junction, edges);
  navigator.update(point(0, 0), 0, 1, 1 / 60, point(5, -5));
  navigator.update(point(0, -4.8), 0, 1, 1 / 60, point(5, -5));
  assert.equal(navigator.nextNode, 3);
  assert.equal(navigator.currentNode, 1);
  assert.ok(navigator.aimPoint.x > 0);
  assert.equal(navigator.aimPoint.z, -5);
  const again = navigator.update(point(0, -4.8), 0, 1, 1 / 60, point(0, -10));
  assert.equal(
    navigator.nextNode,
    3,
    "a moving pursuit target cannot flip the current committed edge",
  );
  assert.ok(
    again.steer < 0,
    "positive X is a right turn under the original heading convention",
  );
});

test("interpolated lookahead remains continuous across a straight graph node", () => {
  const navigator = new RoadNavigator(junction, edges);
  navigator.update(point(0, -4.3), 0, 1, 1 / 60);
  const before = navigator.aimPoint;
  navigator.update(point(0, -4.6), 0, 1, 1 / 60);
  const after = navigator.aimPoint;
  assert.ok(before.distanceTo(after) < 0.5);
  assert.ok(
    after.z < -5,
    "aim follows the upcoming segment rather than the passed node",
  );
  after.x = 100;
  assert.notEqual(
    navigator.aimPoint.x,
    100,
    "diagnostics cannot mutate the planner",
  );
});

test("curvature planning brakes early while straight roads keep forward throttle", () => {
  const straight = new RoadNavigator(
    [point(0, 0), point(0, -20), point(0, -40)],
    [
      [0, 1],
      [1, 2],
    ],
  );
  const straightInput = straight.update(point(0, -15), 0, 4, 1 / 60);
  assert.equal(straightInput.brake, 0);
  assert.ok(straightInput.throttle > 0);
  const corner = new RoadNavigator(
    [point(0, 0), point(0, -20), point(20, -20)],
    [
      [0, 1],
      [1, 2],
    ],
  );
  const input = corner.update(point(0, -16), 0, 4, 1 / 60);
  assert.ok(input.brake > 0);
  assert.equal(input.throttle, 0);
});

test("stuck detection uses measured progress even when the wheels report speed", () => {
  const navigator = new RoadNavigator(junction, edges, { stuckSeconds: 2 });
  let input;
  for (let i = 0; i < 8; i++) input = navigator.update(point(0, 0), 0, 3, 0.25);
  assert.ok(input.recoverTo instanceof Vector3);
  assert.equal(input.recoverTo.z, -5);
  assert.ok(Number.isFinite(input.recoverHeading));
  assert.equal(input.throttle, 0);
  assert.equal(
    navigator.update(input.recoverTo, input.recoverHeading, 0, 0.25).recoverTo,
    undefined,
  );
  const moving = new RoadNavigator(junction, edges, { stuckSeconds: 1 });
  for (let i = 0; i < 8; i++)
    assert.equal(
      moving.update(point(0, -i * 0.4), 0, 0.1, 0.25).recoverTo,
      undefined,
    );
});

test("empty or invalid graphs stop safely and external resets choose connected nodes", () => {
  const empty = new RoadNavigator([], []);
  assert.equal(empty.update(point(0, 0), 0, 0, 0.1).brake, 1);
  const isolated = new RoadNavigator(
    [point(0, 0)],
    [
      [0, 0],
      [0, 99],
    ],
  );
  assert.equal(isolated.update(point(0, 0), 0, 0, 0.1).throttle, 0);
  const disconnected = new RoadNavigator(
    [...junction, point(100, 100)],
    [...edges, [-1, 1], [1, 1], [1, 2]],
  );
  disconnected.reset(point(100, 100), 0);
  assert.notEqual(disconnected.currentNode, 4);
  assert.equal(disconnected.update(point(0, 0), NaN, 0, 0.1).brake, 1);
});

test("the planner and vehicle handling can traverse a circuit through successive corners", () => {
  const nodes = [point(0, 0), point(0, -20), point(20, -20), point(20, 0)];
  const navigator = new RoadNavigator(nodes, [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
  ]);
  const vehicle = createVehicle(point(0, 0, 0.05));
  const visited = new Set();
  let recoveries = 0;
  for (let frame = 0; frame < 3600; frame++) {
    const input = navigator.update(
      vehicle.position,
      vehicle.heading,
      vehicle.speed,
      1 / 60,
    );
    visited.add(navigator.currentNode);
    if (input.recoverTo) {
      recoveries++;
      vehicle.position.copy(input.recoverTo);
      vehicle.position.y = 0.05;
      vehicle.heading = input.recoverHeading;
      vehicle.velocity.set(0, 0, 0);
    }
    updateVehicle(
      vehicle,
      input,
      1 / 60,
      { height: () => 0 },
      { maxSpeed: 4.5, impactDamage: 0 },
    );
  }
  assert.equal(visited.size, 4);
  assert.equal(
    recoveries,
    0,
    "ordinary cornering should not depend on recovery teleports",
  );
  assert.ok(vehicle.position.toArray().every(Number.isFinite));
});

test("sparse road endpoints acquire the closest segment rather than a node across a canal", () => {
  const nodes = [point(0, 20), point(0, -20), point(5, 0), point(5, -20)];
  const navigator = new RoadNavigator(nodes, [
    [0, 1],
    [2, 3],
  ]);
  const input = navigator.update(point(0.5, 0), 0, 0, 1 / 60);
  assert.equal(navigator.currentNode, 0);
  assert.equal(navigator.nextNode, 1);
  assert.equal(navigator.aimPoint.x, 0);
  assert.ok(
    input.steer > 0,
    "acquire the nearby road to the left, not the closer endpoint to the right",
  );
});

test("actual NEWCITY1 road graph follows the starting road without driving across the canal", async (t) => {
  let store;
  try {
    store = await createAssetStore();
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Local game assets absent");
      return;
    }
    throw error;
  }
  const path = "data/RACES/newcity1/newcity1.txt";
  const text = await store.read(path);
  if (!text) {
    t.skip("NEWCITY1 sample absent");
    return;
  }
  const track = parseTrackConfig(decodeText(text));
  const assets = new Assets();
  assets.manifest = store.manifest;
  for (const entry of store.manifest)
    assets.lookup.set(entry.path.toLowerCase(), entry.path);
  assets.bytes = async (path) => {
    const bytes = await store.read(path);
    if (!bytes) throw new Error(`Missing ${path}`);
    return bytes;
  };
  // Collision does not depend on texture decoding; all ACT/DAT transforms remain original.
  assets.pixelmaps = async () => [];
  const result = await assets.scene("data/RACES/newcity1", "newcity1");
  const collision = new WorldCollision(batchStaticWorld(result.group));
  const position = new Vector3(...track.start);
  const height = collision.height(position.x, position.z, position.y + 1);
  assert.notEqual(height, null);
  position.y = height + 0.05;
  const vehicle = createVehicle(position, (track.heading * Math.PI) / 180);
  const navigator = new RoadNavigator(
    track.pathNodes.map((p) => new Vector3(...p)),
    track.pathEdges,
  );
  navigator.update(vehicle.position, vehicle.heading, 0, 1 / 60);
  assert.equal(navigator.currentNode, 20);
  assert.equal(navigator.nextNode, 21);
  let recoveries = 0,
    travel = 0;
  let minimumY = vehicle.position.y;
  for (let frame = 0; frame < 1800; frame++) {
    const input = navigator.update(
      vehicle.position,
      vehicle.heading,
      vehicle.speed,
      1 / 60,
    );
    if (input.recoverTo) {
      recoveries++;
      const h = collision.height(
        input.recoverTo.x,
        input.recoverTo.z,
        input.recoverTo.y + 1,
      );
      vehicle.position.copy(input.recoverTo);
      if (h !== null) vehicle.position.y = h + 0.05;
      vehicle.heading = input.recoverHeading;
      vehicle.velocity.set(0, 0, 0);
    }
    const before = vehicle.position.clone();
    updateVehicle(vehicle, input, 1 / 60, collision, {
      maxSpeed: 4.5,
      impactDamage: 1,
    });
    travel += Math.hypot(
      vehicle.position.x - before.x,
      vehicle.position.z - before.z,
    );
    minimumY = Math.min(minimumY, vehicle.position.y);
  }
  assert.ok(
    travel > 35,
    `Expected sustained original-road travel, got ${travel}`,
  );
  assert.equal(recoveries, 0);
  assert.ok(
    minimumY > -2,
    `Car left the starting street into the canal: y=${minimumY}`,
  );
});
