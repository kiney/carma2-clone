import test from "node:test";
import assert from "node:assert/strict";
import {
  createAttachmentState,
  detachmentThreshold,
  accumulateDetachmentForce,
  beginPartDetachment,
  jointAllowsSeparation,
  shouldFullyDetachPart,
  resetAttachmentState,
  detachedPartMass,
  detachedBoxInertia,
  inheritedDetachedVelocity,
} from "../src/physics/attachment.ts";

test("WAM ease thresholds and accumulated contact influence trigger strict detachment", () => {
  assert.deepEqual(
    ["very_easy", "easy", "normal", "difficult", "very_difficult"].map((ease) =>
      detachmentThreshold(ease),
    ),
    [0.025, 0.05, 0.1, 0.2, 0.4],
  );
  const state = createAttachmentState(0);
  assert.equal(accumulateDetachmentForce(state, 0.1, 0.5, 0.1, 100, 0), null);
  assert.equal(accumulateDetachmentForce(state, 0.1, 0.5, 0.1, 200, 0), null);
  assert.equal(accumulateDetachmentForce(state, 0.1, 0.1, 0.1, 300, 0), 1000);
  assert.equal(accumulateDetachmentForce(state, 1, 1, 0.1, 400, 1000), null);
  assert.equal(beginPartDetachment(state, 999), false);
  assert.equal(beginPartDetachment(state, 1000), true);
  assert.equal(state.phase, 1);
  assert.equal(accumulateDetachmentForce(state, 1, 1, 0.1, 1001, 0), null);
});

test("fully detachable subtype2 skips joint state and repair clears all attachment history", () => {
  const state = createAttachmentState(2);
  assert.equal(
    accumulateDetachmentForce(state, 0.5, 1, 0.1, 1500, 2000, true),
    1500,
  );
  assert.equal(beginPartDetachment(state, 1500), true);
  assert.equal(state.phase, 2);
  resetAttachmentState(state);
  assert.deepEqual(state, createAttachmentState(2));
});

test("ordinary parts require geometric separation even after detach time elapses", () => {
  const state = { ...createAttachmentState(1), phase: 1, detachedAt: 1000 };
  assert.equal(
    jointAllowsSeparation([
      { parent: [1, 0, 0], childInParent: [0.707107, 0, 0] },
    ]),
    false,
  );
  assert.equal(
    jointAllowsSeparation([
      { parent: [1, 0, 0], childInParent: [0.8, 0.6, 0] },
    ]),
    true,
  );
  assert.equal(
    shouldFullyDetachPart(state, 3500, true, () => 0.49),
    true,
  );
  assert.equal(
    shouldFullyDetachPart(state, 3500, true, () => 0.5),
    false,
  );
  assert.equal(
    shouldFullyDetachPart(state, 6000, false, () => 0),
    false,
  );
  assert.equal(
    shouldFullyDetachPart(state, 6000, true, () => 0.9999),
    true,
  );
  assert.equal(shouldFullyDetachPart({ ...state, type: 5 }, 6000, true), false);
});

test("detached mass, inertia and inherited angular point velocity match physics equations", () => {
  assert.equal(detachedPartMass(0.1, 2, 1), 0.2);
  assert.equal(detachedPartMass(0.0001, 2, 1), 0.01);
  assert.deepEqual(detachedBoxInertia(12, [1, 2, 3]), [13, 10, 5]);
  assert.deepEqual(
    inheritedDetachedVelocity([10, 0, 0], [0, 0, 2], [0, 0, 0], [1, 0, 0]),
    [10, 2, 0],
  );
  assert.deepEqual(
    inheritedDetachedVelocity([10, 0, 0], [0, 0, 2], [1, 0, 0], [1, 0, 0]),
    [10, 0, 0],
  );
});
