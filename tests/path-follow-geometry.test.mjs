import test from "node:test";
import assert from "node:assert/strict";
import { Vector2, Vector3 } from "three";
import { stepNativeFollowGeometry } from "../src/ai/path-follow-geometry.ts";

const point = (x, z) => new Vector3(x, 0, z);
const section = (node0, node1, options = {}) => ({
  nodeIndices: [node0, node1],
  minSpeed: [0, 0],
  maxSpeed: options.maxSpeed ?? [255, 255],
  width: options.width ?? 1,
  type: 0,
  oneWay: false,
});
const route = (count) =>
  Array.from({ length: count }, (_, sectionIndex) => ({
    section: sectionIndex,
    direction: 1,
  }));
const metricVelocity = (z, x = 0) => new Vector3(x / 6.9, 0, z / 6.9);
const baseState = (options = {}) => ({
  sectionSlot: options.sectionSlot ?? 0,
  desiredSpeed: options.desiredSpeed ?? 17,
  escape: options.escape ?? { timeMs: 0, flipped: false },
  ...(options.corner ? { corner: options.corner } : {}),
});

const turn = (limit = 255) => ({
  nodes: [point(0, 0), point(0, 10), point(10, 10), point(10, 20)],
  sections: [
    section(0, 1, { maxSpeed: [limit, limit] }),
    section(1, 2),
    section(2, 3),
  ],
  route: route(3),
});

test("straight SOC constraints lower desired speed before straight steering", () => {
  const { nodes, sections, route: path } = turn(5);
  const result = stepNativeFollowGeometry(
    nodes,
    sections,
    path,
    baseState({ desiredSpeed: 17 }),
    {
      position: point(0, 5),
      velocity: metricVelocity(20),
      dtMs: 1000,
      nowMs: 1000,
      maxCurve: 0.2,
    },
  );
  assert.equal(
    result.state.corner,
    undefined,
    "strict entry test stays on straight",
  );
  assert.equal(result.state.desiredSpeed, 5);
  assert.equal(result.state.sectionSlot, 0);
});

test("corner-entry comparison uses the strict native time-distance boundary", () => {
  const { nodes, sections, route: path } = turn();
  const tangent = Math.fround(10 * Math.fround(1 / 3));
  const right = Math.fround(6.9) * (5 - tangent);
  const speed = Math.fround(Math.sqrt(10 * Math.fround(10)));
  const boundaryDt = right / (speed * 0.0005);
  const query = (dtMs) => ({
    position: point(0, 5),
    velocity: metricVelocity(10),
    dtMs,
    nowMs: 1000,
    maxCurve: 0.2,
  });

  // The native expression multiplies dt*speed before its 0.0005 factor, so
  // use close values on either side rather than assume a representable exact
  // equality survives that Float64 evaluation order.
  const below = stepNativeFollowGeometry(
    nodes,
    sections,
    path,
    baseState(),
    query(boundaryDt - 0.001),
  );
  assert.equal(below.state.corner, undefined);
  const above = stepNativeFollowGeometry(
    nodes,
    sections,
    path,
    baseState(),
    query(boundaryDt + 0.001),
  );
  assert.ok(above.state.corner);
  assert.equal(above.state.sectionSlot, 0);
});

test("corner entry retains prior desired speed until heading correction", () => {
  const { nodes, sections, route: path } = turn();
  const tangent = Math.fround(10 * Math.fround(1 / 3));
  const center = new Vector2(10 - tangent, tangent);
  const radialZ = 5 - center.x;
  const radialX = -center.y;
  const metricZ = (-radialX / Math.hypot(radialZ, radialX)) * 10;
  const metricX = (radialZ / Math.hypot(radialZ, radialX)) * 10;
  const previous = baseState({ desiredSpeed: 17 });
  const result = stepNativeFollowGeometry(nodes, sections, path, previous, {
    position: point(0, 5),
    velocity: metricVelocity(metricZ, metricX),
    dtMs: 3000,
    nowMs: 1000,
    maxCurve: 0.2,
  });
  assert.ok(result.state.corner);
  assert.equal(result.state.desiredSpeed, 17);
  assert.equal(result.state.sectionSlot, 0);
});

test("active corner retains the section until outside its stored tangent", () => {
  const { nodes, sections, route: path } = turn();
  const tangent = Math.fround(10 * Math.fround(1 / 3));
  const center = new Vector2(10 - tangent, tangent);
  const corner = {
    center,
    radius: tangent,
    tangentReach: tangent,
    left: true,
    fallback: false,
    sectionSlot: 1,
    speed: 5,
    width: 1,
  };
  const previous = baseState({
    corner,
    escape: { timeMs: 123, flipped: true },
  });
  const serializedPrevious = {
    ...previous,
    escape: { ...previous.escape },
    corner: { ...corner, center: corner.center.toArray() },
  };
  const inside = stepNativeFollowGeometry(nodes, sections, path, previous, {
    position: point(center.y, center.x + tangent),
    velocity: metricVelocity(0),
    dtMs: 16,
    nowMs: 500,
    maxCurve: 0.2,
  });
  assert.ok(inside.state.corner);
  assert.equal(inside.state.sectionSlot, 0);
  assert.notEqual(inside.state.corner.center, previous.corner.center);
  assert.deepEqual(
    previous.corner.center.toArray(),
    serializedPrevious.corner.center,
  );
  assert.deepEqual(previous.escape, serializedPrevious.escape);

  const leaving = stepNativeFollowGeometry(nodes, sections, path, previous, {
    position: point(center.y, center.x + tangent + 0.01),
    velocity: metricVelocity(0),
    dtMs: 16,
    nowMs: 500,
    maxCurve: 0.2,
  });
  assert.equal(leaving.state.corner, undefined);
  assert.equal(leaving.state.sectionSlot, 1);
  assert.equal(previous.sectionSlot, 0);
  assert.ok(previous.corner);
});

test("nearest intermediate section is only the SOC cursor, not persistent progress", () => {
  const nodes = [
    point(0, 0),
    point(0, 10),
    point(0, 20),
    point(10, 20),
    point(10, 30),
  ];
  const sections = [section(0, 1), section(1, 2), section(2, 3), section(3, 4)];
  const result = stepNativeFollowGeometry(
    nodes,
    sections,
    route(4),
    baseState({ sectionSlot: 0 }),
    {
      position: point(0, 15),
      velocity: metricVelocity(2),
      dtMs: 0,
      nowMs: 100,
      maxCurve: 0.2,
    },
  );
  assert.equal(result.state.sectionSlot, 0);
  assert.equal(result.state.corner, undefined);
});

test("entering the lane clears escape time while retaining the flip bit", () => {
  const { nodes, sections, route: path } = turn();
  const result = stepNativeFollowGeometry(
    nodes,
    sections,
    path,
    baseState({ escape: { timeMs: 500, flipped: true }, desiredSpeed: 6 }),
    {
      position: point(0, 5),
      velocity: metricVelocity(2),
      dtMs: 0,
      nowMs: 1000,
      maxCurve: 0.2,
    },
  );
  assert.equal(result.state.escape.timeMs, 0);
  assert.equal(result.state.escape.flipped, true);
});
