import test from "node:test";
import assert from "node:assert/strict";
import { Vector2, Vector3 } from "three";
import {
  findNearestPathSection,
  getPathEndpointSpeed,
  getStraightPathGeometry,
} from "../src/ai/path-geometry.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const section = (node0, node1, options = {}) => ({
  nodeIndices: [node0, node1],
  minSpeed: options.minSpeed ?? [0, 0],
  maxSpeed: options.maxSpeed ?? [255, 255],
  width: options.width ?? 1,
  type: options.type ?? 0,
  oneWay: options.oneWay ?? false,
});

test("nearest-section selection doubles Y and preserves authored endpoint ties", () => {
  const weighted = findNearestPathSection(
    v(),
    [v(0, 0.2), v(0, 0.2), v(0.3), v(0.3)],
    [section(0, 1), section(2, 3)],
  );
  assert.equal(weighted.section, 1);
  assert.deepEqual(weighted.intersection.toArray(), [0.3, 0, 0]);

  const tie = findNearestPathSection(
    v(),
    [v(0, 1), v(0, 1), v(-1, 1), v(1, 1)],
    [section(0, 1), section(2, 3)],
  );
  // The projection on authored section 1 is exactly as close as section 0's
  // endpoint; native <= lets the projected candidate replace that endpoint.
  assert.equal(tie.section, 1);
  assert.deepEqual(tie.intersection.toArray(), [0, 1, 0]);

  const authoredTie = findNearestPathSection(
    v(),
    [v(0, 0), v(0, 0), v(0, 0), v(0, 0)],
    [section(0, 1), section(2, 3)],
  );
  assert.equal(
    authoredTie.section,
    0,
    "strict improvement retains first section",
  );
});

test("nearest section returns an unweighted 3D projection, direction, and distance", () => {
  const result = findNearestPathSection(
    v(1.5, 3, 4),
    [v(0, 2), v(3, 4)],
    [section(0, 1)],
  );
  assert.equal(result.section, 0);
  assert.deepEqual(result.intersection.toArray(), [1.5, 3, 0]);
  assert.ok(Math.abs(result.direction.x - 3 / Math.sqrt(13)) < 1e-12);
  assert.ok(Math.abs(result.direction.y - 2 / Math.sqrt(13)) < 1e-12);
  assert.equal(result.direction.z, 0);
  assert.equal(result.distance, 4);

  const endpoint = findNearestPathSection(v(4), [v(0), v(3)], [section(0, 1)]);
  assert.deepEqual(endpoint.intersection.toArray(), [3, 0, 0]);
  assert.equal(endpoint.distance, 1);
});

test("nearest-section projection skips squared lengths below the native cutoff safely", () => {
  const result = findNearestPathSection(
    v(0.00005, 0, 1),
    [v(), v(0.00005)],
    [section(0, 1)],
  );
  assert.ok(result);
  assert.ok(result.distance > 0.99);
  assert.deepEqual(result.direction.toArray(), [1, 0, 0]);
  assert.ok(Number.isFinite(result.distance));

  // A sub-cutoff segment has no interior candidate. With the query exactly
  // midway, native finish-before-start endpoint scanning and strict ties keep
  // the finish endpoint.
  const midpoint = findNearestPathSection(
    v(0.0025),
    [v(0), v(0.005)],
    [section(0, 1)],
  );
  assert.deepEqual(midpoint.intersection.toArray(), [0.005, 0, 0]);
  assert.deepEqual(midpoint.direction.toArray(), [1, 0, 0]);
});

test("straight grouping uses world Z/X, minimum width, reverse direction, and no fixed horizon", () => {
  const nodes = [
    v(0, 0, 0),
    v(0, 0, 1),
    v(0.05, 0, 2),
    v(0.05, 0, 3),
    v(0.05, 0, 4),
    v(0.05, 0, 5),
    v(0.05, 0, 6),
  ];
  const sections = Array.from({ length: 6 }, (_, i) =>
    section(i, i + 1, { width: i === 3 ? 0.4 : 1 - i * 0.05 }),
  );
  const route = sections.map((_, index) => ({ section: index, direction: 1 }));
  const straight = getStraightPathGeometry(nodes, sections, route);
  assert.deepEqual(straight.start, new Vector2(0, 0));
  assert.deepEqual(straight.finish, new Vector2(6, 0.05));
  assert.equal(straight.width, 0.4);
  assert.equal(straight.nextSlot, -1);

  const reverse = getStraightPathGeometry(nodes, sections, [
    { section: 0, direction: 0 },
  ]);
  assert.deepEqual(reverse.start, new Vector2(1, 0));
  assert.deepEqual(reverse.finish, new Vector2(0, 0));
  assert.equal(reverse.nextSlot, -1);
});

test("straight grouping stops at the strict 0.1 boundary and at backward bends", () => {
  const nativeThreshold = Math.fround(0.1);
  const boundaryTotalZ = Math.sqrt(1 / nativeThreshold ** 2 - 1);
  const boundaryNodes = [v(0, 0, 0), v(0, 0, 1), v(1, 0, boundaryTotalZ)];
  const boundarySections = [section(0, 1), section(1, 2)];
  const boundary = getStraightPathGeometry(boundaryNodes, boundarySections, [
    { section: 0, direction: 1 },
    { section: 1, direction: 1 },
  ]);
  assert.equal(
    Math.abs(1) / Math.hypot(boundaryTotalZ, 1),
    nativeThreshold,
    "fixture is exactly on the strict native threshold",
  );
  assert.equal(boundary.nextSlot, 1);

  const belowTotalX = Math.sqrt(100 - 0.99 ** 2);
  const belowNodes = [v(0, 0, 0), v(0, 0, 1), v(0.99, 0, belowTotalX)];
  const below = getStraightPathGeometry(belowNodes, boundarySections, [
    { section: 0, direction: 1 },
    { section: 1, direction: 1 },
  ]);
  assert.equal(below.nextSlot, -1);

  const backward = getStraightPathGeometry(
    [v(0, 0, 0), v(0, 0, 1), v(0, 0, -1)],
    boundarySections,
    [
      { section: 0, direction: 1 },
      { section: 1, direction: 1 },
    ],
  );
  assert.equal(backward.nextSlot, 1);
});

test("straight grouping uses the next finish point across discontinuous authored endpoints", () => {
  const nodes = [
    v(0, 0, 0),
    v(1, 0, 0),
    v(100, 0, 100), // Disconnected next start is intentionally far away.
    v(2, 0, 0),
  ];
  const sections = [section(0, 1), section(2, 3)];
  const straight = getStraightPathGeometry(nodes, sections, [
    { section: 0, direction: 1 },
    { section: 1, direction: 1 },
  ]);

  // Native outgoing is next.finish - current.finish: both are one unit along
  // world X, so the entries merge despite the authored start-point gap.
  assert.deepEqual(straight.start, new Vector2(0, 0));
  assert.deepEqual(straight.finish, new Vector2(0, 2));
  assert.equal(straight.nextSlot, -1);
});

test("endpoint speed uses native projected direction and preserves authored bytes", () => {
  const authored = section(0, 1, { minSpeed: [12, 97], maxSpeed: [80, 150] });
  assert.equal(getPathEndpointSpeed(authored, 1, true, "min"), 97);
  assert.equal(getPathEndpointSpeed(authored, 1, false, "min"), 12);
  assert.equal(getPathEndpointSpeed(authored, 0, true, "max"), 80);
  assert.equal(getPathEndpointSpeed(authored, 0, false, "max"), 150);
  assert.throws(() => getPathEndpointSpeed(authored, 2, true, "max"));
});

test("geometry APIs reject nonfinite and invalid references without emitting NaN", () => {
  assert.equal(findNearestPathSection(v(), [], []), undefined);
  assert.throws(() =>
    findNearestPathSection(v(Infinity), [v()], [section(0, 0)]),
  );
  assert.throws(() => findNearestPathSection(v(), [v()], [section(0, 1)]));
  assert.equal(getStraightPathGeometry([], [], []), undefined);
  assert.throws(() =>
    getStraightPathGeometry(
      [v()],
      [section(0, 2)],
      [{ section: 0, direction: 1 }],
    ),
  );
});

test("nearest projection admits the installed Float32 squared-length threshold", () => {
  // Between the native single-precision constant and decimal 0.0001.
  const squaredLength = (Math.fround(0.0001) + 0.0001) / 2;
  const length = Math.sqrt(squaredLength);
  const nodes = [v(0, 0, 0), v(length, 0, 0)];
  const query = v(length / 2, 0, 0);
  const hit = findNearestPathSection(query, nodes, [section(0, 1)]);
  assert.equal(hit.distance, 0);
  assert.deepEqual(hit.intersection, query);
});

test("straight merging uses Float32 0.1 rather than the lower decimal cutoff", () => {
  const ratio = (0.1 + Math.fround(0.1)) / 2;
  const totalZ = Math.sqrt(1 / ratio ** 2 - 1);
  const geometry = getStraightPathGeometry(
    [v(), v(0, 0, 1), v(1, 0, totalZ)],
    [section(0, 1), section(1, 2)],
    [
      { section: 0, direction: 1 },
      { section: 1, direction: 1 },
    ],
  );
  assert.equal(geometry.nextSlot, -1);
});
