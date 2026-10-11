import assert from "node:assert/strict";
import test from "node:test";
import { Vector3 } from "three";
import { enterCheatyPath, stepCheatyPath } from "../src/ai/cheaty-path.ts";

const section = (a, b) => ({
  nodeIndices: [a, b],
  minSpeed: [0, 0],
  maxSpeed: [255, 255],
  width: 4,
  type: 0,
  oneWay: false,
});
const route = (...sections) =>
  sections.map((section, i) => ({ section, direction: 1 }));
const nodes = (...positions) =>
  positions.map(([x, y, z]) => new Vector3(x, y, z));

test("cheat entry projects, approaches with Float32 stores, and requests physics-off", () => {
  const result = enterCheatyPath(
    new Vector3(4, 3, 0),
    0,
    route(0),
    nodes([0, 0, 0], [10, 0, 0]),
    [section(0, 1)],
    100,
  );

  assert.equal(result.kind, "ok");
  assert.equal(result.requestPhysicsOff, true);
  assert.equal(result.state.sectionSlot, 0);
  assert.equal(result.state.movingToIntersection, true);
  assert.deepEqual(result.state.intersection.toArray(), [4, 0, 0]);
  assert.deepEqual(result.position.toArray(), [4, Math.fround(2.4), 0]);
  assert.equal(
    result.lookVector,
    undefined,
    "entry does not reorient the actor",
  );
  assert.equal(result.velocity, undefined);
});

test("projection clamps outside the authored segment and interpolates endpoints inclusively", () => {
  const path = [section(0, 1)];
  const route1 = route(0);
  const points = nodes([0, 0, 0], [10, 0, 0]);

  const before = enterCheatyPath(
    new Vector3(-2, 0, 0),
    0,
    route1,
    points,
    path,
    0,
  );
  assert.deepEqual(before.state.intersection.toArray(), [0, 0, 0]);
  assert.equal(before.state.movingToIntersection, true);

  const atFinish = enterCheatyPath(
    new Vector3(10, 0, 0),
    0,
    route1,
    points,
    path,
    0,
  );
  assert.deepEqual(atFinish.state.intersection.toArray(), [10, 0, 0]);
  assert.equal(atFinish.state.movingToIntersection, true);
});

test("approach equality retains the moving flag and discards the frame remainder", () => {
  const points = nodes([0, 0, 0], [10, 0, 0]);
  const result = enterCheatyPath(
    new Vector3(4, Math.fround(0.6), 0),
    0,
    route(0),
    points,
    [section(0, 1)],
    100,
  );
  assert.deepEqual(result.position.toArray(), [4, 0, 0]);
  assert.equal(result.state.movingToIntersection, true);

  const next = stepCheatyPath(
    new Vector3(0, 1, 0),
    {
      sectionSlot: 0,
      movingToIntersection: true,
      intersection: new Vector3(0, 0, 0),
    },
    route(0),
    points,
    [section(0, 1)],
    100,
  );
  assert.deepEqual(next.position.toArray(), [
    0,
    Math.fround(1 - Math.fround(0.6)),
    0,
  ]);
  assert.equal(next.state.sectionSlot, 0);
  assert.equal(next.state.movingToIntersection, true);
  assert.deepEqual(next.lookVector.toArray(), [10, 0, 0]);
  assert.deepEqual(next.velocity.toArray(), [0, Math.fround(41.4), 0]);
});

test("ordinary path traversal carries leftover frame distance across sections", () => {
  const path = [section(0, 1), section(1, 2)];
  const result = stepCheatyPath(
    new Vector3(0, 0, 0),
    {
      sectionSlot: 0,
      movingToIntersection: false,
      intersection: new Vector3(),
    },
    route(0, 1),
    nodes([0, 0, 0], [0.3, 0, 0], [1, 0, 0]),
    path,
    100,
  );
  assert.equal(result.kind, "ok");
  assert.equal(result.state.sectionSlot, 1);
  assert.deepEqual(result.position.toArray(), [Math.fround(0.6), 0, 0]);
  assert.deepEqual(result.lookVector.toArray(), [
    Math.fround(1 - Math.fround(0.6)),
    0,
    0,
  ]);
});

test("cross-section remainder is stored as Float32 before a non-axis segment", () => {
  const shortEnd = Math.fround(0.0001);
  const remainingStored = Math.fround(60 - shortEnd);
  assert.equal(remainingStored, 59.999900817871094);
  const dx = Math.fround(100 - shortEnd);
  const dy = Math.fround(9);
  const length = Math.sqrt(dx * dx + dy * dy);
  const fraction = remainingStored / length;
  const expected = [
    Math.fround(shortEnd + dx * fraction),
    Math.fround(dy * fraction),
    0,
  ];
  const unroundedFraction = (60 - shortEnd) / length;
  const unrounded = [
    Math.fround(shortEnd + dx * unroundedFraction),
    Math.fround(dy * unroundedFraction),
    0,
  ];
  assert.notDeepEqual(
    expected,
    unrounded,
    "fixture distinguishes the native store",
  );

  const result = stepCheatyPath(
    new Vector3(0, 0, 0),
    {
      sectionSlot: 0,
      movingToIntersection: false,
      intersection: new Vector3(),
    },
    route(0, 1),
    nodes([0, 0, 0], [shortEnd, 0, 0], [100, 9, 0]),
    [section(0, 1), section(1, 2)],
    10000,
  );
  assert.equal(result.state.sectionSlot, 1);
  assert.deepEqual(result.position.toArray(), expected);
});

test("landing exactly on a section finish retains its slot until the next step", () => {
  const result = stepCheatyPath(
    new Vector3(0, 0, 0),
    {
      sectionSlot: 0,
      movingToIntersection: false,
      intersection: new Vector3(),
    },
    route(0, 1),
    nodes([0, 0, 0], [0.6, 0, 0], [2, 0, 0]),
    [section(0, 1), section(1, 2)],
    100,
  );
  assert.deepEqual(result.position.toArray(), [Math.fround(0.6), 0, 0]);
  assert.equal(result.state.sectionSlot, 0);
  assert.equal(result.kind, "ok");
});

test("crossing the last endpoint returns path-end and the native -1 slot", () => {
  const result = stepCheatyPath(
    new Vector3(0.8, 0, 0),
    {
      sectionSlot: 0,
      movingToIntersection: false,
      intersection: new Vector3(),
    },
    route(0),
    nodes([0, 0, 0], [1, 0, 0]),
    [section(0, 1)],
    100,
  );
  assert.equal(result.kind, "path-end");
  assert.equal(result.state.sectionSlot, -1);
  assert.deepEqual(result.position.toArray(), [1, 0, 0]);
  assert.equal(result.lookVector, undefined);
});

test("vertical directed sections preserve 3D movement and stable velocity", () => {
  const result = stepCheatyPath(
    new Vector3(0, 0, 0),
    {
      sectionSlot: 0,
      movingToIntersection: false,
      intersection: new Vector3(),
    },
    route(0),
    nodes([0, 0, 0], [0, 10, 0]),
    [section(0, 1)],
    100,
  );
  assert.deepEqual(result.position.toArray(), [0, Math.fround(0.6), 0]);
  assert.deepEqual(result.lookVector.toArray(), [0, Math.fround(9.4), 0]);
  assert.deepEqual(result.velocity.toArray(), [0, Math.fround(41.4), 0]);
});

test("zero-length entry projection and malformed state fail explicitly", () => {
  assert.throws(
    () =>
      enterCheatyPath(
        new Vector3(),
        0,
        route(0),
        nodes([0, 0, 0]),
        [section(0, 0)],
        16,
      ),
    /zero-length/,
  );
  assert.throws(
    () =>
      stepCheatyPath(
        new Vector3(),
        {
          sectionSlot: -1,
          movingToIntersection: false,
          intersection: new Vector3(),
        },
        route(0),
        nodes([0, 0, 0], [1, 0, 0]),
        [section(0, 1)],
        16,
      ),
    /state/,
  );
});
