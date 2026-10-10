import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import {
  applyNativeSOCBraking,
  calculateNativePathCorners,
  calculateNativeSpeedConstraints,
  nearestSectionInStraight,
} from "../src/ai/path-constraints.ts";

const p = (x, z) => new Vector3(x, 0, z);
const section = (node0, node1, options = {}) => ({
  nodeIndices: [node0, node1],
  minSpeed: options.minSpeed ?? [0, 0],
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

test("CalcCorners traverses projected straight groups and stops after four records", () => {
  const nodes = [p(0, 0)];
  for (let index = 0; index < 6; index++) {
    const from = nodes[nodes.length - 1];
    nodes.push(
      index % 2 === 0
        ? p(0, (index + 1) * 20)
        : p((index + 1) * 20, index * 20),
    );
    assert.ok(from);
  }
  const sections = Array.from({ length: 6 }, (_, index) =>
    section(index, index + 1),
  );
  let randomCalls = 0;
  const corners = calculateNativePathCorners(
    nodes,
    sections,
    route(6),
    0,
    () => {
      randomCalls++;
      return 0;
    },
  );
  assert.equal(corners.length, 4);
  assert.deepEqual(
    corners.map((corner) => corner.sectionSlot),
    [1, 2, 3, 4],
  );
  assert.equal(
    randomCalls,
    0,
    "these right-angle junctions use normal construction",
  );
});

test("CalcSOCs emits sections beyond the entrance tangent and caps corner speed", () => {
  const nodes = [p(0, 0), p(0, 10), p(0, 20), p(0, 30), p(0, 40)];
  const sections = [
    section(0, 1, { maxSpeed: [40, 41] }),
    section(1, 2, { maxSpeed: [42, 43] }),
    section(2, 3, { maxSpeed: [44, 18] }),
    section(3, 4, { maxSpeed: [19, 20] }),
  ];
  const path = route(4);
  const corner = {
    sectionSlot: 2,
    center: { x: 0, y: 0 },
    radius: 4,
    tangentReach: 5,
    left: true,
    fallback: false,
    speed: 0,
  };
  const constraints = calculateNativeSpeedConstraints(nodes, sections, path, [
    corner,
  ]);
  const base = Math.trunc(
    Math.sqrt(4 * Math.fround(6.9) * Math.fround(7.5) * Math.fround(1.96)),
  );
  assert.deepEqual(constraints, [
    { kind: "section", sectionSlot: 0, speed: 41 },
    {
      kind: "corner",
      cornerIndex: 0,
      sectionSlot: 2,
      speed: base,
    },
  ]);
  assert.equal(corner.speed, base);
});

test("entrance tangent sections cap a corner without emitting their own SOCs", () => {
  const nodes = [p(0, 0), p(0, 10), p(0, 20), p(0, 30)];
  const sections = [
    section(0, 1, { maxSpeed: [40, 41] }),
    section(1, 2, { maxSpeed: [42, 7] }),
    section(2, 3, { maxSpeed: [44, 45] }),
  ];
  const corner = {
    sectionSlot: 2,
    center: { x: 0, y: 0 },
    radius: 100,
    tangentReach: 15,
    left: true,
    fallback: false,
    speed: 0,
  };
  const constraints = calculateNativeSpeedConstraints(
    nodes,
    sections,
    route(3),
    [corner],
  );
  assert.deepEqual(constraints, [
    { kind: "corner", cornerIndex: 0, sectionSlot: 2, speed: 7 },
  ]);
});

test("exit overlap caps include distances strictly below reach but exclude equality", () => {
  const nodes = [p(0, 0), p(0, 10), p(0, 20), p(0, 30), p(0, 40)];
  const sections = [
    section(0, 1),
    section(1, 2),
    section(2, 3, { maxSpeed: [80, 70] }),
    section(3, 4, { maxSpeed: [5, 4] }),
  ];
  const corner = {
    sectionSlot: 2,
    center: { x: 0, y: 0 },
    radius: 100,
    tangentReach: 20,
    left: true,
    fallback: false,
    speed: 0,
  };
  const constraints = calculateNativeSpeedConstraints(
    nodes,
    sections,
    route(4),
    [corner],
  );
  // Slot 2 is always included; slot 3 finishes exactly 20 units from the
  // following start, so the strict overlap check does not cap by its speed 4.
  const cornerConstraint = constraints.find((entry) => entry.kind === "corner");
  assert.equal(cornerConstraint.speed, 70);
});

test("the tenth SOC can be the final corner after its tangent speed cap", () => {
  const nodes = Array.from({ length: 13 }, (_, index) => p(0, index));
  const sections = Array.from({ length: 12 }, (_, index) =>
    section(index, index + 1, {
      maxSpeed: index === 9 ? [7, 7] : [255, 255],
    }),
  );
  const corners = [2, 5, 8, 10].map((sectionSlot) => ({
    sectionSlot,
    center: { x: 0, y: 0 },
    radius: 100,
    tangentReach: 0.5,
    left: true,
    fallback: false,
    speed: 0,
  }));
  const constraints = calculateNativeSpeedConstraints(
    nodes,
    sections,
    route(12),
    corners,
  );
  assert.equal(constraints.length, 10);
  assert.equal(constraints.at(-1).kind, "corner");
  assert.equal(constraints.at(-1).cornerIndex, 3);
  assert.equal(constraints.at(-1).speed, 7);
  assert.equal(corners[3].speed, 7);
});

test("CalcSOCs starts from the supplied nonzero current route slot", () => {
  const nodes = [p(0, 0), p(0, 10), p(0, 20), p(0, 30), p(0, 40)];
  const sections = [
    section(0, 1),
    section(1, 2),
    section(2, 3, { maxSpeed: [10, 6] }),
    section(3, 4),
  ];
  const corner = {
    sectionSlot: 3,
    center: { x: 0, y: 0 },
    radius: 100,
    tangentReach: 0.5,
    left: true,
    fallback: false,
    speed: 0,
  };
  const constraints = calculateNativeSpeedConstraints(
    nodes,
    sections,
    route(4),
    [corner],
    1,
  );
  assert.deepEqual(constraints, [
    { kind: "section", sectionSlot: 1, speed: 255 },
    { kind: "corner", cornerIndex: 0, sectionSlot: 3, speed: 6 },
  ]);
});

test("nearest section uses strict cumulative boundaries and excludes unmerged slot", () => {
  const nodes = [p(0, 0), p(0, 10), p(0, 20), p(0, 30)];
  const sections = [section(0, 1), section(1, 2), section(2, 3)];
  const path = route(3);
  assert.equal(nearestSectionInStraight(nodes, sections, path, 0, 2, -1), 0);
  assert.equal(nearestSectionInStraight(nodes, sections, path, 0, 2, 10), 0);
  assert.equal(
    nearestSectionInStraight(nodes, sections, path, 0, 2, 10.001),
    1,
  );
  assert.equal(nearestSectionInStraight(nodes, sections, path, 0, 2, 100), 1);
  assert.equal(nearestSectionInStraight(nodes, sections, path, 0, -1, 100), 2);
});

test("SOC braking applies strict metric thresholds and stops at its model-unit horizon", () => {
  const speed = 10;
  const rhs = Math.fround(speed * speed) / 16;
  const factor = Math.fround(6.9);
  const lowerDistance = Math.fround(rhs / factor);
  const bits = new ArrayBuffer(4);
  const view = new DataView(bits);
  view.setFloat32(0, lowerDistance, true);
  view.setUint32(0, view.getUint32(0, true) + 1, true);
  const upperDistance = view.getFloat32(0, true);
  const evaluateDistance = (distance) =>
    applyNativeSOCBraking(
      [p(0, 0), p(0, distance)],
      [section(0, 1, { maxSpeed: [0, 0] })],
      route(1),
      [],
      [{ kind: "section", sectionSlot: 0, speed: 0 }],
      { position: p(0, 0), speed, desiredSpeed: speed, dtMs: 0 },
    );
  const below = evaluateDistance(lowerDistance);
  const above = evaluateDistance(upperDistance);
  assert.ok(lowerDistance * factor < rhs);
  assert.ok(upperDistance * factor > rhs);
  assert.equal(below.desiredSpeed, 0);
  assert.equal(above.desiredSpeed, speed);
  assert.deepEqual(below.cumulativeDistances, [lowerDistance]);
  assert.deepEqual(above.cumulativeDistances, [upperDistance]);

  const beyondHorizon = applyNativeSOCBraking(
    [p(0, 0), p(0, lowerDistance), p(0, lowerDistance + 1)],
    [
      section(0, 1, { maxSpeed: [255, 255] }),
      section(1, 2, { maxSpeed: [0, 0] }),
    ],
    route(2),
    [],
    [
      { kind: "section", sectionSlot: 0, speed: 255 },
      { kind: "section", sectionSlot: 1, speed: 0 },
    ],
    { position: p(0, 0), speed, desiredSpeed: speed, dtMs: 0 },
  );
  assert.equal(beyondHorizon.desiredSpeed, speed);
  assert.deepEqual(beyondHorizon.cumulativeDistances, [lowerDistance]);

  const nearTargetNodes = [p(0, 9.5), p(0, 10)];
  const braking = applyNativeSOCBraking(
    nearTargetNodes,
    [section(0, 1, { maxSpeed: [0, 0] })],
    route(1),
    [],
    [{ kind: "section", sectionSlot: 0, speed: 0 }],
    { position: p(0, 9.5), speed, desiredSpeed: speed, dtMs: 0 },
  );
  assert.equal(braking.desiredSpeed, 0);
  assert.deepEqual(braking.cumulativeDistances, [Math.fround(0.5)]);
});

test("SOC braking subtracts previous/current tangent reach and clamps cumulative distance", () => {
  const nodes = [p(0, 0), p(0, 10), p(0, 20)];
  const sections = [section(0, 1), section(1, 2)];
  const corners = [
    {
      sectionSlot: 0,
      center: { x: 0, y: 0 },
      radius: 1,
      tangentReach: 8,
      left: true,
      fallback: false,
      speed: 0,
    },
    {
      sectionSlot: 1,
      center: { x: 0, y: 0 },
      radius: 1,
      tangentReach: 8,
      left: true,
      fallback: false,
      speed: 0,
    },
  ];
  const result = applyNativeSOCBraking(
    nodes,
    sections,
    route(2),
    corners,
    [
      { kind: "corner", cornerIndex: 0, sectionSlot: 0, speed: 0 },
      { kind: "corner", cornerIndex: 1, sectionSlot: 1, speed: 0 },
    ],
    { position: p(0, 0), speed: 20, desiredSpeed: 20, dtMs: 0 },
  );
  assert.deepEqual(result.cumulativeDistances, [0, 0]);
});

test("path constraint helpers reject invalid slots, radii, and time/speed values", () => {
  const nodes = [p(0, 0), p(0, 1)];
  const sections = [section(0, 1)];
  assert.throws(() =>
    nearestSectionInStraight(nodes, sections, route(1), -1, -1, 0),
  );
  assert.throws(() =>
    calculateNativeSpeedConstraints(nodes, sections, route(1), [
      {
        sectionSlot: 0,
        center: { x: 0, y: 0 },
        radius: -1,
        tangentReach: 0,
        left: true,
        fallback: false,
        speed: 0,
      },
    ]),
  );
  assert.throws(() =>
    applyNativeSOCBraking(nodes, sections, route(1), [], [], {
      position: p(0, 0),
      speed: -1,
      desiredSpeed: 1,
      dtMs: 0,
    }),
  );
});
