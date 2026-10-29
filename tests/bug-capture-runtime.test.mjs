import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { PlaytestCapture } from "../src/bug-capture/runtime.ts";
import { decodeCapture } from "../src/bug-capture/format.ts";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { sharedNativeRandom } from "../src/native-random.ts";
import { worldJointFixture } from "./support/world-joint-phase-fixture.mjs";

const MiB = 1024 * 1024;
const vector = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const json = (record) => JSON.parse(new TextDecoder().decode(record.payload));
const numbers = (record) =>
  new Float64Array(
    record.payload.buffer,
    record.payload.byteOffset,
    record.payload.byteLength / 8,
  );
const decoded = async (capture) =>
  decodeCapture(await capture.exportBlob({ test: "procedural" }).arrayBuffer());

function body() {
  return {
    group: { name: "procedural car" },
    state: {
      position: vector(11, 12, 13),
      orientation: new Quaternion(0.1, 0.2, 0.3, 0.9),
      velocity: vector(21, 22, 23),
      angularVelocity: vector(31, 32, 33),
      predictedPosition: vector(41, 42, 43),
      predictedOrientation: new Quaternion(0.4, 0.5, 0.6, 0.7),
    },
    properties: {
      mass: 7,
      inertia: vector(51, 52, 53),
      centerOfMass: vector(61, 62, 63),
      worldFriction: 0.4,
    },
    input: { throttle: 0.75, steer: -0.25, brake: true, handbrake: true },
    hulls: [buildBoxHull(vector(-1, -2, -3), vector(1, 2, 3))],
    damage: {
      componentLevels: Uint8Array.from({ length: 12 }, (_, i) => i * 3),
      deformationRevision: 81,
      repairRevision: 82,
    },
    revision: 71,
    structuralRevision: 72,
    splitRevision: 73,
    poseEpoch: 74,
  };
}

function row(record, schema, index = 0, columnKey = "bodyColumns") {
  const values = numbers(record),
    columns = schema[columnKey];
  const start = schema.header.length + index * columns.length;
  assert.ok(
    start + columns.length <= values.length,
    "declared schema must fit the payload",
  );
  return Object.fromEntries(
    columns.map((name, i) => [name, values[start + i]]),
  );
}

function freezeTree(value, seen = new Set()) {
  if (
    !value ||
    typeof value !== "object" ||
    seen.has(value) ||
    ArrayBuffer.isView(value)
  )
    return;
  seen.add(value);
  for (const item of Object.values(value)) freezeTree(item, seen);
  Object.freeze(value);
}

test("capture retains the inclusive three-minute active window and preserves it through a long pause", () => {
  const capture = new PlaytestCapture({ maxBytes: 4 * MiB, now: () => 0 });
  capture.beginFrame(0, true);
  capture.event("origin", {});
  capture.beginFrame(180_000, true);
  assert.ok(
    capture.ring
      .snapshot()
      .records.some((r) => r.kind === 5 && json(r).event === "origin"),
  );
  capture.beginFrame(180_001, true);
  assert.ok(
    !capture.ring
      .snapshot()
      .records.some((r) => r.kind === 5 && json(r).event === "origin"),
  );
  capture.beginFrame(180_001, false);
  capture.event("pause-marker", {});
  const before = capture.ring.snapshot();
  capture.beginFrame(900_001, false);
  assert.equal(capture.status.timeMs, 180_001);
  assert.deepEqual(capture.ring.snapshot().records, before.records);
  capture.beginFrame(900_001, true);
  capture.beginFrame(900_051, true);
  assert.equal(capture.status.timeMs, 180_051);
  assert.ok(
    capture.ring
      .snapshot()
      .records.some((r) => r.kind === 5 && json(r).event === "pause-marker"),
  );
});

test("pause events preserve history when the browser stops delivering frames for an hour", () => {
  const capture = new PlaytestCapture({ maxBytes: 4 * MiB, now: () => 0 });
  capture.beginFrame(0, true);
  capture.event("before-blur", { x: 12 });
  // Blur can pause the game before another animation callback runs.
  capture.setPlaying(20, false);
  capture.beginFrame(3_600_020, false);
  assert.equal(capture.status.timeMs, 20);
  const events = capture.ring
    .snapshot()
    .records.filter((r) => r.kind === 5)
    .map(json);
  assert.ok(
    events.some(
      (entry) => entry.event === "before-blur" && entry.details.x === 12,
    ),
  );
  assert.equal(capture.status.ring.evictedAge, 0);
  capture.setPlaying(3_600_030, true);
  capture.beginFrame(3_600_040, true);
  assert.equal(capture.status.timeMs, 30);
});

test("recorder keeps export headroom and evicts within a deliberately small memory budget", async () => {
  const defaultCapture = new PlaytestCapture();
  assert.equal(defaultCapture.memoryLimitBytes, 512 * MiB);
  assert.ok(
    defaultCapture.ring.maxBytes * 2 + 16 * MiB <=
      defaultCapture.memoryLimitBytes,
  );
  const capture = new PlaytestCapture({ maxBytes: 256 * 1024, now: () => 0 });
  for (let i = 0; i < 200; i++)
    capture.event("bounded-entry", { i, text: "x".repeat(2048) });
  assert.equal(capture.status.errors, 0);
  assert.ok(
    capture.status.ring.count > 0,
    "small budgets must leave usable payload storage",
  );
  assert.ok(capture.status.ring.evictedBytes > 0);
  assert.ok(capture.status.ring.accountedBytes <= capture.ring.maxBytes);
  const blob = capture.exportBlob();
  assert.ok(
    blob.size + capture.status.ring.accountedBytes < capture.memoryLimitBytes,
  );
  const file = decodeCapture(await blob.arrayBuffer());
  const events = file.records.filter((r) => r.kind === 5).map(json);
  assert.equal(events.at(-1).details.i, 199);
  assert.ok(events[0].details.i > 0);
});

test("packed body schema preserves exact state, damage, stable IDs and nonfinite diagnostics", async () => {
  const capture = new PlaytestCapture({
    maxBytes: 8 * MiB,
    now: () => 0,
    readContext: () => ({ track: "procedural-track" }),
  });
  const car = body(),
    bone = body(),
    part = body();
  delete bone.damage;
  delete part.damage;
  bone.kind = "pedestrian-bone";
  bone.owner = car;
  part.owner = car;
  bone.state.position.x = NaN;
  bone.state.velocity.z = Infinity;
  bone.properties.mass = 1e300;
  capture.session();
  const simulation = { elapsed: 12.25 };
  capture.startStep(simulation, [car, bone, part]);
  const oldRecords = capture.ring.snapshot().records;
  car.state.position.x = -999;
  car.state.velocity.x = -888;
  car.damage.componentLevels[0] = 99;
  car.hulls[0].vertices[0].x = -777;
  capture.finishStep(simulation, [car, bone, part], true);
  const file = await decoded(capture),
    schema = file.metadata.schemas["1"];
  const states = file.records.filter((r) => r.kind === 1);
  assert.equal(states.length, 2);
  const first = row(states[0], schema),
    after = row(states[1], schema);
  assert.equal(numbers(states[0])[schema.header.indexOf("bodyCount")], 3);
  assert.equal(
    numbers(states[0]).length,
    schema.header.length + 3 * schema.bodyColumns.length,
  );
  assert.equal(first.px, 11);
  assert.equal(first.py, 12);
  assert.equal(first.pz, 13);
  assert.equal(first.qw, 0.9);
  assert.equal(first.vx, 21);
  assert.equal(first.wz, 33);
  assert.equal(first.candidatePx, 41);
  assert.equal(first.candidateQw, 0.7);
  assert.equal(first.mass, 7);
  assert.equal(first.ix, 51);
  assert.equal(first.comZ, 63);
  assert.equal(first.throttle, 0.75);
  assert.equal(first.steer, -0.25);
  assert.equal(first.brake, 1);
  assert.equal(first.handbrake, 1);
  assert.equal(first.shapeRevision, 71);
  assert.equal(first.structuralRevision, 72);
  assert.equal(first.splitRevision, 73);
  assert.equal(first.poseEpoch, 74);
  assert.equal(first.deformationRevision, 81);
  assert.equal(first.repairRevision, 82);
  assert.equal(first.damage11, 33);
  assert.equal(after.id, first.id);
  assert.equal(after.px, -999);
  assert.equal(after.vx, -888);
  assert.equal(first.damage0, 0);
  assert.equal(after.damage0, 99);
  const boneRow = row(states[0], schema, 1),
    partRow = row(states[0], schema, 2);
  assert.equal(boneRow.kind, 5);
  assert.equal(partRow.kind, 3);
  assert.ok(Number.isNaN(boneRow.px));
  assert.equal(boneRow.vz, Infinity);
  assert.equal(boneRow.mass, 1e300);
  assert.notEqual(boneRow.id, first.id);
  assert.equal(
    row(
      oldRecords.find((r) => r.kind === 1),
      schema,
    ).px,
    11,
  );
  const keyframe = json(file.records.find((r) => r.kind === 6));
  assert.equal(keyframe.bodies[2].kind, "part");
  assert.notEqual(keyframe.bodies[0].hulls[0].vertices[0][0], -777);
  assert.ok(
    file.metadata.directory.some(
      (entry) => entry.id === first.id && entry.name === "procedural car",
    ),
  );
  assert.ok(capture.ids instanceof WeakMap);
  assert.ok(
    [...capture.directory.values()].every((entry) =>
      Object.values(entry).every(
        (value) => value === null || typeof value !== "object",
      ),
    ),
  );
});

test("candidate and applied contact phases preserve separate B lever and acceptance without mutating contacts", async () => {
  const capture = new PlaytestCapture({ maxBytes: 8 * MiB, now: () => 0 });
  const a = body(),
    b = body();
  const impact = {
    a,
    b,
    point: vector(1, 2, 3),
    pointB: vector(4, 5, 6),
    normal: vector(0, 1, 0),
    normalImpulse: 17.5,
    closingSpeed: 2.25,
    tangentImpulse: vector(),
    sourceType: 5,
    sourceSurface: {
      actor: { name: "procedural-face" },
      faceIndex: 18,
      a: vector(10, 11, 12),
      b: vector(20, 21, 22),
      c: vector(30, 31, 32),
    },
  };
  const simulation = { elapsed: 1.5 };
  capture.contacts(simulation, [impact], 0, false);
  assert.equal(impact.solverAccepted, undefined);
  impact.solverAccepted = true;
  a.state.velocity.x = 41;
  capture.contacts(simulation, [impact], 1);
  freezeTree(impact);
  capture.contacts(simulation, [impact], 1);
  const file = await decoded(capture),
    schema = file.metadata.schemas["3"];
  const contacts = file.records.filter((r) => r.kind === 3);
  const candidate = row(contacts[0], schema, 0, "contactColumns"),
    applied = row(contacts[1], schema, 0, "contactColumns");
  assert.equal(numbers(contacts[0])[3], 0);
  assert.equal(numbers(contacts[0])[4], 0);
  assert.equal(numbers(contacts[1])[3], 1);
  assert.equal(numbers(contacts[1])[4], -1);
  assert.equal(candidate.solverAccepted, -1);
  assert.equal(applied.solverAccepted, 1);
  assert.equal(candidate.pointBx, 4);
  assert.equal(candidate.pointBy, 5);
  assert.equal(candidate.pointBz, 6);
  assert.equal(candidate.px, 1);
  assert.equal(candidate.normalImpulse, 17.5);
  assert.equal(candidate.closingSpeed, 2.25);
  assert.equal(candidate.face, 18);
  assert.equal(candidate.faceCz, 32);
  assert.equal(candidate.aVx, 21);
  assert.equal(applied.aVx, 41);
  assert.equal(candidate.a, applied.a);
  assert.equal(candidate.b, applied.b);
  assert.equal(capture.status.errors, 0);
});

test("bounded geometry marks skipped hulls and leaves frozen engine inputs unchanged", async () => {
  const capture = new PlaytestCapture({ maxBytes: 8 * MiB, now: () => 0 });
  const b = body();
  b.hulls.push({
    vertices: new Array(16385).fill(vector(1, 2, 3)),
    faces: [],
    edges: [],
    vertexOrder: [],
  });
  freezeTree(b);
  capture.startStep({ elapsed: 0 }, [b]);
  capture.finishStep({ elapsed: 0.04 }, [b], true);
  assert.equal(capture.status.errors, 0);
  const file = await decoded(capture),
    keyframe = json(file.records.find((r) => r.kind === 6));
  assert.equal(keyframe.truncated, true);
  assert.equal(keyframe.bodies[0].hulls[1], null);
  assert.equal(b.hulls[1].vertices.length, 16385);
  assert.equal(b.state.position.x, 11);
  assert.deepEqual(
    [...b.damage.componentLevels],
    Array.from({ length: 12 }, (_, i) => i * 3),
  );
});

test("joint candidates preserve numeric angular rows, rejection and explicit row omissions", async () => {
  const capture = new PlaytestCapture({ maxBytes: 8 * MiB, now: () => 0 });
  const child = body(),
    parent = body();
  const joint = { child, parent };
  const candidate = {
    joint,
    normalImpulse: 123.5,
    closingSpeed: -2.5,
    sourceType: 11,
    rowIndex: 9,
    angularConstraintLocal: vector(1, 2, 3),
    parentAngularConstraintLocal: vector(4, 5, 6),
  };
  freezeTree(candidate);
  capture.joints({ elapsed: 2.25 }, new Array(130).fill(candidate), false);
  const file = await decoded(capture),
    schema = file.metadata.schemas["7"];
  assert.ok(
    schema,
    "joint numeric schema must be published in the exported file",
  );
  const record = file.records.find((r) => r.kind === 7),
    header = numbers(record);
  assert.equal(header[schema.header.indexOf("callbackAccepted")], 0);
  assert.equal(header[schema.header.indexOf("rowCount")], 128);
  assert.equal(header[schema.header.indexOf("omittedRows")], 2);
  const first = row(record, schema, 0, "jointColumns");
  assert.equal(first.normalImpulse, 123.5);
  assert.equal(first.closingSpeed, -2.5);
  assert.equal(first.sourceType, 11);
  assert.equal(first.rowIndex, 9);
  assert.equal(first.childAngularX, 1);
  assert.equal(first.childAngularZ, 3);
  assert.equal(first.parentAngularX, 4);
  assert.equal(first.parentAngularZ, 6);
  assert.notEqual(first.child, first.parent);
  assert.deepEqual(row(record, schema, 127, "jointColumns"), first);
  assert.equal(capture.status.errors, 0);
});

test("oversized source vertex order is omitted with an explicit geometry truncation flag", async () => {
  const capture = new PlaytestCapture({ maxBytes: 8 * MiB, now: () => 0 });
  const b = body();
  b.hulls[0].vertexOrder = new Array(16385).fill(0);
  capture.startStep({ elapsed: 0 }, [b]);
  const file = await decoded(capture),
    keyframe = json(file.records.find((r) => r.kind === 6));
  assert.equal(keyframe.truncated, true);
  assert.equal(keyframe.bodies[0].hulls[0], null);
  assert.equal(capture.status.errors, 0);
});

test("diagnostic providers cannot invoke custom getters or serializers during capture", () => {
  const capture = new PlaytestCapture({ maxBytes: 4 * MiB, now: () => 0 });
  let calls = 0;
  capture.event("getter", {
    get value() {
      calls++;
      return "unsafe";
    },
  });
  const custom = {};
  Object.defineProperty(custom, "toJSON", {
    value() {
      calls++;
      return "unsafe";
    },
  });
  capture.event("serializer", custom);
  assert.equal(calls, 0);
  assert.equal(capture.status.errors, 2);
  capture.event("valid-after-errors", { value: "safe" });
  assert.ok(
    capture.ring
      .snapshot()
      .records.some(
        (r) => r.kind === 5 && json(r).event === "valid-after-errors",
      ),
  );
});

test("context producer failures stay inside recorder and stop after bounded repeated failures", async () => {
  const capture = new PlaytestCapture({
    maxBytes: 4 * MiB,
    now: () => 0,
    readContext: () => {
      throw new Error("procedural context failure");
    },
  });
  assert.doesNotThrow(() => {
    capture.session();
    capture.session();
    capture.session();
    capture.session();
  });
  assert.equal(capture.status.errors, 3);
  assert.equal(capture.status.enabled, false);
  const file = await decoded(capture);
  assert.equal(file.metadata.failures.length, 3);
  assert.ok(
    file.metadata.failures.every((message) =>
      message.includes("procedural context failure"),
    ),
  );
});

test("one procedural physics step produces the same mechanics with the observer installed", async () => {
  const originalRandomState = sharedNativeRandom.state;
  const plain = worldJointFixture(),
    recorded = worldJointFixture();
  try {
    const capture = new PlaytestCapture({ maxBytes: 8 * MiB, now: () => 0 });
    recorded.simulation.bugCapture = capture;
    const originalProviders = [
      recorded.simulation.world.querySurfaces,
      recorded.simulation.world.queryLocalSurfaces,
      recorded.simulation.world.collectFaces,
    ];
    const originalCache = recorded.simulation.worldFaceCache;
    sharedNativeRandom.seed(originalRandomState);
    plain.simulation.step();
    const expectedRandomState = sharedNativeRandom.state;
    sharedNativeRandom.seed(originalRandomState);
    recorded.simulation.step();
    assert.equal(sharedNativeRandom.state, expectedRandomState);
    for (const property of [
      "position",
      "orientation",
      "velocity",
      "angularVelocity",
    ])
      assert.deepEqual(
        recorded.body.state[property].toArray(),
        plain.body.state[property].toArray(),
      );
    assert.equal(recorded.body.worldRecovery, plain.body.worldRecovery);
    assert.deepEqual(
      [
        recorded.simulation.world.querySurfaces,
        recorded.simulation.world.queryLocalSurfaces,
        recorded.simulation.world.collectFaces,
      ],
      originalProviders,
    );
    assert.equal(recorded.simulation.worldFaceCache, originalCache);
    assert.equal(capture.status.errors, 0);
    const file = await decoded(capture),
      states = file.records.filter((r) => r.kind === 1);
    assert.equal(states.length, 2);
    assert.equal(numbers(states[0])[2], 0);
    assert.equal(numbers(states[1])[2], 1);
  } finally {
    sharedNativeRandom.seed(originalRandomState);
    plain.dispose();
    recorded.dispose();
  }
});
