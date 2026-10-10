import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  NativePhysicalPathFollower,
  nativeBorrowedPathDistance,
} from "../src/ai/path-follow.ts";
import { nativeStruggleThresholds } from "../src/ai/path-struggle.ts";

const nodes = [new Vector3(0, 0, 0), new Vector3(0, 0, 100)];
const sections = [
  {
    nodeIndices: [0, 1],
    minSpeed: [0, 0],
    maxSpeed: [255, 255],
    width: 4,
    type: 0,
    oneWay: false,
  },
];
const route = [{ section: 0, direction: 1 }];
const query = (nowMs, overrides = {}) => ({
  position: new Vector3(0, 0, 25),
  velocity: new Vector3(0, 0, 0),
  dtMs: 16,
  nowMs,
  maxCurve: 0.2,
  mass: 1000,
  factor: 1,
  engineDamage: 0,
  transmissionDamage: 0,
  ignoreEnd: false,
  neverStruggle: true,
  pursuit: false,
  currentCurvature: 0,
  ...overrides,
});

test("borrowed distance uses the native stored Float32 width boundary", () => {
  const position = new Vector3(1, Math.fround(0.0001), 5);
  assert.ok(Math.hypot(position.x, position.y) > 1);
  assert.equal(
    nativeBorrowedPathDistance(position, new Vector3(), new Vector3(0, 0, 10)),
    1,
  );
  assert.equal(
    nativeBorrowedPathDistance(
      new Vector3(1, 0, 25),
      new Vector3(),
      new Vector3(0, 0, 10),
    ),
    1,
    "the projection remains infinite rather than clamped to endpoint10",
  );
  assert.throws(() =>
    nativeBorrowedPathDistance(position, new Vector3(), new Vector3()),
  );
});

test("new struggle compares the wrapped u32 last-finish deadline before activation", () => {
  const follower = new NativePhysicalPathFollower();
  follower.start(0xfffffff0);
  follower.run(
    nodes,
    sections,
    route,
    query(0xfffffff1, {
      velocity: new Vector3(0, 0, 1),
      neverStruggle: false,
    }),
  );
  // LastFinish+2000 wraps to1984; initializing the struggle still runs PID.
  const initialized = follower.run(
    nodes,
    sections,
    route,
    query(1985, { neverStruggle: false }),
  );
  assert.ok(initialized.accForce > 0);
  const active = follower.run(
    nodes,
    sections,
    route,
    query(1986, { neverStruggle: false }),
  );
  assert.equal(active.accForce, -6000);
  assert.equal(active.brakeForce, 0);
});

function started(options = {}) {
  const follower = new NativePhysicalPathFollower();
  follower.start(100, 0);
  if (options.prime)
    follower.run(
      nodes,
      sections,
      route,
      query(101, { velocity: new Vector3(0, 0, 1) }),
    );
  return follower;
}

test("first physical frame retains the native zero desired speed and reports direct forces", () => {
  const follower = started();
  const result = follower.run(nodes, sections, route, query(116));
  assert.equal(result.kind, "ok");
  assert.equal(result.geometry.desiredSpeed, 80);
  assert.equal(result.movedOnTask, false);
  assert.ok(result.speed);
  assert.equal(result.accForce, result.speed.accForce);
});

test("a first-frame corner entry leaves the initially zero desired speed untouched", () => {
  const cornerNodes = [
    new Vector3(0, 0, 0),
    new Vector3(0, 0, 10),
    new Vector3(10, 0, 10),
    new Vector3(10, 0, 20),
  ];
  const cornerSections = [0, 1, 2].map((index) => ({
    nodeIndices: [index, index + 1],
    minSpeed: [0, 0],
    maxSpeed: [255, 255],
    width: 1,
    type: 0,
    oneWay: false,
  }));
  const cornerRoute = [0, 1, 2].map((section) => ({ section, direction: 1 }));
  const follower = new NativePhysicalPathFollower();
  follower.start(100);
  const result = follower.run(
    cornerNodes,
    cornerSections,
    cornerRoute,
    query(116, {
      position: new Vector3(0, 0, 5),
      velocity: new Vector3(0, 0, 10 / 6.9),
      dtMs: 3000,
    }),
  );
  assert.ok(result.geometry.corner);
  assert.equal(result.geometry.desiredSpeed, 0);
});

test("Start resets PID histories and timing but preserves desired speed and escape state", () => {
  const follower = started();
  follower.run(
    nodes,
    sections,
    route,
    query(116, { velocity: new Vector3(0, 0, 1) }),
  );
  const before = follower.run(
    nodes,
    sections,
    route,
    query(132, { velocity: new Vector3(0, 0, 1) }),
  );
  follower.start(200, 0);
  const after = follower.run(
    nodes,
    sections,
    route,
    query(216, { velocity: new Vector3(0, 0, 1) }),
  );
  assert.equal(after.geometry.desiredSpeed, before.geometry.desiredSpeed);
  assert.deepEqual(after.geometry.escape, before.geometry.escape);
  const fresh = started().run(
    nodes,
    sections,
    route,
    query(216, { velocity: new Vector3(0, 0, 1) }),
  );
  assert.equal(after.speed.acceleration, fresh.speed.acceleration);
  assert.equal(after.movedOnTask, true);
});

test("borrowed-time uses an unbounded 3D line, strict timer edges, and leaves forces on give-up", () => {
  const follower = new NativePhysicalPathFollower();
  const start = 0x80001000;
  follower.start(start, 0);
  const struggleStart = start + 2001;
  follower.run(
    nodes,
    sections,
    route,
    query(struggleStart, { pursuit: true, neverStruggle: false }),
  );
  const stopAt = nativeStruggleThresholds(struggleStart, 0, 1000).stopAtMs;
  const stopped = follower.run(nodes, sections, route, query(stopAt + 1));
  assert.equal(stopped.madeIt, false);
  // A point far beyond both endpoints but on the authored line counts as made-it.
  const passed = follower.run(
    nodes,
    sections,
    route,
    query(stopAt + 1002, { position: new Vector3(0, 0, 200) }),
  );
  assert.equal(passed.madeIt, true);
  assert.equal(
    follower.run(
      nodes,
      sections,
      route,
      query(stopAt + 11002, { position: new Vector3(20, 0, 200) }),
    ).kind,
    "ok",
  );

  const failed = new NativePhysicalPathFollower();
  failed.start(start, 0);
  failed.run(
    nodes,
    sections,
    route,
    query(struggleStart, { pursuit: true, neverStruggle: false }),
  );
  const failureStopAt = stopAt;
  const forces = failed.run(nodes, sections, route, query(failureStopAt + 1));
  const timedOut = failed.run(
    nodes,
    sections,
    route,
    query(failureStopAt + 10002, {
      position: new Vector3(20, 0, 200),
      ignoreEnd: true,
    }),
  );
  assert.equal(timedOut.kind, "given-up");
  assert.equal(timedOut.accForce, forces.accForce);
  assert.equal(timedOut.brakeForce, forces.brakeForce);
});

test("new struggle continues through geometry, active struggle returns before PID, and stop resumes PID", () => {
  const follower = started();
  const struggle = follower.run(
    nodes,
    sections,
    route,
    query(2101, { pursuit: true, neverStruggle: false }),
  );
  assert.equal(struggle.struggleCount, 0);
  assert.equal(struggle.madeIt, true);
  assert.ok(
    struggle.speed,
    "new struggle proceeds through normal geometry/controller",
  );
  const active = follower.run(
    nodes,
    sections,
    route,
    query(2200, { velocity: new Vector3(0, 0, 1) }),
  );
  assert.equal(active.speed, undefined);
  assert.equal(active.accForce, -6000);
  assert.equal(active.brakeForce, 0);
  const ongoing = follower.run(
    nodes,
    sections,
    route,
    query(2300, { currentCurvature: 0.04 }),
  );
  assert.equal(ongoing.speed, undefined);
  assert.ok(ongoing.curvature < 0.04);
});

test("frozen opponent brake preserves path state while controller history is not advanced", () => {
  const follower = started();
  const before = follower.run(
    nodes,
    sections,
    route,
    query(116, { velocity: new Vector3(0, 0, 1) }),
  );
  const frozen = follower.run(
    nodes,
    sections,
    route,
    query(132, { factor: 0, position: new Vector3(20, 0, 20) }),
  );
  assert.equal(frozen.accForce, 0);
  assert.equal(frozen.brakeForce, 15000);
  assert.equal(frozen.speed, undefined);
  assert.deepEqual(frozen.geometry, before.geometry);
  assert.equal(frozen.movedOnTask, before.movedOnTask);
  assert.equal(frozen.curvature, 0);
});

test("invalid timestamps, route slots and nonfinite queries are rejected", () => {
  const follower = started();
  assert.throws(() => follower.start(-1));
  assert.throws(() => follower.setSectionSlot(-1));
  assert.throws(() =>
    follower.run(nodes, sections, route, query(117, { factor: Infinity })),
  );
});
