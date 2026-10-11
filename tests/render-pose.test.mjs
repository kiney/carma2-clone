import { test } from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3, Quaternion } from "three";
import { RenderPoses } from "../src/render-pose.ts";

test("40ms physics steps render continuously at intermediate frame times without changing physics", () => {
  const body = {
    state: { position: new Vector3(), orientation: new Quaternion() },
    poseEpoch: 0,
  };
  const poses = new RenderPoses();
  poses.capture([body]);
  body.state.position.x = 0.4;
  body.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), 0.4);
  const actor = new Group();
  actor.position.copy(body.state.position);
  actor.quaternion.copy(body.state.orientation);
  for (const alpha of [0, 0.25, 0.5, 0.75, 1]) {
    poses.apply(body, actor, alpha);
    assert.ok(Math.abs(actor.position.x - 0.4 * alpha) < 1e-12);
    assert.ok(
      Math.abs(actor.quaternion.angleTo(new Quaternion()) - 0.4 * alpha) < 1e-7,
    );
    assert.equal(body.state.position.x, 0.4);
    poses.restore();
    assert.equal(actor.position.x, 0.4);
    assert.ok(actor.quaternion.angleTo(body.state.orientation) < 1e-7);
  }
});

test("reset/recovery and newly detached actors never interpolate from a stale location", () => {
  const poses = new RenderPoses();
  const body = {
    state: { position: new Vector3(), orientation: new Quaternion() },
    poseEpoch: 0,
  };
  poses.capture([body]);
  body.state.position.set(100, 20, 30);
  body.poseEpoch++;
  const actor = new Group();
  poses.apply(body, actor, 0);
  assert.deepEqual(actor.position.toArray(), [100, 20, 30]);
  poses.restore();
  const piece = {
    state: { position: new Vector3(5, 6, 7), orientation: new Quaternion() },
  };
  poses.apply(piece, actor, 0.5);
  assert.deepEqual(actor.position.toArray(), [5, 6, 7]);
  poses.restore();
});

test("flat manually posed ACTs interpolate their drawn matrix and restore the exact committed pose", () => {
  const poses = new RenderPoses(),
    actor = new Group(),
    body = {
      state: { position: new Vector3(1, 2, 3), orientation: new Quaternion() },
    };
  actor.matrixAutoUpdate = false;
  actor.matrix.makeTranslation(1, 2, 3);
  actor.matrix.decompose(actor.position, actor.quaternion, actor.scale);
  poses.capture([body]);
  body.state.position.x = 2;
  actor.position.copy(body.state.position);
  actor.updateMatrix();
  const committed = actor.matrix.clone();
  poses.apply(body, actor, 0.5, true);
  assert.equal(actor.matrix.elements[12], 1.5);
  assert.equal(body.state.position.x, 2);
  poses.restore();
  assert.deepEqual(actor.matrix.elements, committed.elements);
  assert.equal(actor.position.x, 2);
  assert.equal(actor.matrixAutoUpdate, false);
});
