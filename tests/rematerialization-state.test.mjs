import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { NativeRematerializationState } from "../src/ai/rematerialization-state.ts";
import { nativeRematerializationVelocity } from "../src/ai/rematerialization.ts";

const v = (x, y, z) => new Vector3(x, y, z);
const identity = (position = v(1, 2, 3), row2 = v(0, 0, 1)) => ({
  row0: v(1, 0, 0),
  row1: v(0, 1, 0),
  row2: row2.clone(),
  position: position.clone(),
});
const copy = (pose) => ({
  row0: pose.row0.clone(),
  row1: pose.row1.clone(),
  row2: pose.row2.clone(),
  position: pose.position.clone(),
});
const equalPose = (a, b) => {
  for (const key of ["row0", "row1", "row2", "position"])
    assert.deepEqual(a[key].toArray(), b[key].toArray(), key);
};

function fixture({
  physical = false,
  pose = identity(),
  place = () => -1,
} = {}) {
  const actor = {
    pose: copy(pose),
    physical,
    renderStyle: 1,
    collisionFlags: 0x20,
  };
  const events = [];
  const aligned = [];
  const velocities = [];
  let rayCount = 0;
  const ray = (origin, direction) => {
    events.push("ray");
    rayCount++;
    return {
      fraction: rayCount % 2 ? 0.25 : 100,
      normal: rayCount % 2 ? v(0.2, Math.sqrt(0.96), 0) : v(0, 1, 0),
    };
  };
  const state = new NativeRematerializationState(actor, {
    ray,
    applyAttemptReset(attemptPose, velocity) {
      events.push("reset");
      aligned.push(copy(attemptPose));
      velocities.push(velocity.clone());
    },
    sensiblePlace(attemptPose) {
      events.push("sensible");
      return place(attemptPose, aligned.length - 1);
    },
    successResetSpecialVolume() {
      events.push("volume");
    },
    pipe(enabled) {
      events.push(enabled ? "pipe-on" : "pipe-off");
    },
    rebuild() {
      events.push("rebuild");
    },
    clearDynamics() {
      events.push("clear-dynamics");
    },
    fallback() {
      events.push("fallback");
    },
  });
  return { state, actor, events, aligned, velocities };
}

test("already-physical shortcut returns success without lifecycle hooks", () => {
  const { state, actor, events } = fixture({ physical: true });
  assert.equal(state.run(12), 1);
  assert.deepEqual(events, []);
  assert.equal(actor.renderStyle, 1);
});

test("first successful attempt orders activation, reset, sensible test and volume reset", () => {
  const { state, actor, events, aligned, velocities } = fixture();
  assert.equal(state.run(30), 1);
  assert.deepEqual(events, [
    "pipe-on",
    "rebuild",
    "ray",
    "ray",
    "reset",
    "sensible",
    "volume",
  ]);
  assert.equal(actor.physical, true);
  assert.equal(actor.renderStyle, 0);
  assert.equal(actor.collisionFlags, 0x120);
  assert.deepEqual(
    velocities[0].toArray(),
    nativeRematerializationVelocity(aligned[0].row2, 30).toArray(),
  );
  assert.notDeepEqual(aligned[0].row2.toArray(), [0, 0, 1]);
});

test("retry offsets use saved row2 after full pose restoration", () => {
  const original = {
    row0: v(0, 0, -1),
    row1: v(0, 1, 0),
    row2: v(1, 0, 0),
    position: v(4, 5, 6),
  };
  const { state, aligned, actor } = fixture({
    pose: original,
    place: (_pose, index) => (index === 5 ? 1 : 0),
  });
  assert.equal(state.run(8), 1);
  assert.equal(aligned.length, 6);
  for (let index = 0; index < 5; index++)
    assert.equal(aligned[index].position.x, Math.fround(4));
  assert.ok(Math.abs(aligned[5].position.x - Math.fround(3.5)) < 1e-6);
  assert.equal(actor.physical, true);
});

test("exhaustion performs 24 tests, restores every saved pose row, then clears and falls back", () => {
  const original = {
    row0: v(0, 0, -1),
    row1: v(0, 1, 0),
    row2: v(1, 0, 0),
    position: v(4, 5, 6),
  };
  const { state, actor, events, aligned } = fixture({
    pose: original,
    place: () => 0,
  });
  assert.equal(state.run(9), 1);
  assert.equal(aligned.length, 24);
  equalPose(actor.pose, original);
  assert.equal(actor.physical, false);
  assert.equal(actor.renderStyle, 1);
  assert.equal(actor.collisionFlags, 0x120);
  assert.deepEqual(events.slice(-4), [
    "clear-dynamics",
    "pipe-off",
    "rebuild",
    "fallback",
  ]);
  assert.equal(events.filter((event) => event === "sensible").length, 24);
  assert.equal(events.filter((event) => event === "volume").length, 0);
});

test("attempt resets preserve forces and exhaustion clears them only after the last failure", () => {
  const force = { acceleration: 7, brake: 11 };
  let checks = 0;
  const actor = {
    pose: identity(),
    physical: false,
    renderStyle: 1,
    collisionFlags: 0,
  };
  const state = new NativeRematerializationState(actor, {
    ray: (_origin, direction) => ({
      fraction: direction.y < -20 ? 0.25 : 100,
      normal: v(0, 1, 0),
    }),
    applyAttemptReset() {
      assert.deepEqual(force, { acceleration: 7, brake: 11 });
    },
    sensiblePlace() {
      checks++;
      return 0;
    },
    successResetSpecialVolume() {},
    pipe() {},
    rebuild() {},
    clearDynamics() {
      force.acceleration = 0;
      force.brake = 0;
    },
    fallback() {},
  });
  assert.equal(state.run(8), 1);
  assert.equal(checks, 24);
  assert.deepEqual(force, { acceleration: 0, brake: 0 });
});

test("inactive sensible-place fallback still returns one and never retries placement", () => {
  let checks = 0;
  const result = fixture({
    place: () => {
      checks++;
      return 0;
    },
  });
  assert.equal(result.state.run(4), 1);
  assert.equal(checks, 24);
  assert.equal(result.events.filter((event) => event === "fallback").length, 1);
});

test("invalid speed and out-of-Float32 pose are rejected before hooks", () => {
  const first = fixture();
  assert.throws(() => first.state.run(Infinity), /speed/);
  assert.deepEqual(first.events, []);
  const invalid = fixture({ pose: identity(v(Number.MAX_VALUE, 0, 0)) });
  assert.throws(() => invalid.state.run(1), /pose position/);
  assert.deepEqual(invalid.events, []);
});
