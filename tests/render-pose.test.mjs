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

function descendantVisits(actor) {
  const child = new Group();
  actor.add(child);
  let visits = 0;
  const update = child.updateMatrixWorld;
  // Instrument only a descendant: final scene preparation still owns custom
  // descendant outlets, and no native Object3D prototype is changed.
  child.updateMatrixWorld = function (...args) {
    visits++;
    return update.apply(this, args);
  };
  return () => visits;
}

test("unchanged parentless poses skip temporary subtree updates and restoration at every alpha", () => {
  const actor = new Group(),
    poses = new RenderPoses();
  actor.position.set(3, 4, 5);
  const body = {
    state: {
      position: actor.position.clone(),
      orientation: actor.quaternion.clone(),
    },
  };
  const visits = descendantVisits(actor);
  poses.capture([body]);
  for (const alpha of [0, 0.25, 0.5, 1]) {
    assert.equal(poses.apply(body, actor, alpha), false);
    poses.restore();
  }
  assert.equal(visits(), 0);
  assert.deepEqual(actor.position.toArray(), [3, 4, 5]);
  // The ordinary final render preparation remains live, including descendants.
  actor.updateMatrixWorld(true);
  assert.equal(visits(), 1);
});

test("paused alpha1 skips subtree work even when the preceding physics pose differs", () => {
  const actor = new Group(),
    poses = new RenderPoses();
  const body = {
    state: { position: new Vector3(), orientation: new Quaternion() },
  };
  poses.capture([body]);
  body.state.position.set(2, 3, 4);
  actor.position.copy(body.state.position);
  const visits = descendantVisits(actor);
  assert.equal(poses.apply(body, actor, 1), false);
  poses.restore();
  assert.equal(visits(), 0);
  assert.deepEqual(body.state.position.toArray(), [2, 3, 4]);
});

test("unchanged transformed parent pose tolerates only world-to-local numerical roundoff", () => {
  const parent = new Group(),
    actor = new Group(),
    poses = new RenderPoses();
  parent.position.set(13.1, -2.4, 72.7);
  parent.quaternion.setFromAxisAngle(new Vector3(1, 2, 3).normalize(), 0.63);
  actor.position.set(4.33, -0.09, -2.17);
  actor.quaternion.setFromAxisAngle(new Vector3(3, 1, 2).normalize(), 0.36);
  parent.add(actor);
  parent.updateMatrixWorld(true);
  const body = {
    state: {
      position: actor.getWorldPosition(new Vector3()),
      orientation: actor.getWorldQuaternion(new Quaternion()),
    },
  };
  const position = actor.position.clone(),
    orientation = actor.quaternion.clone();
  const visits = descendantVisits(actor);
  poses.capture([body]);
  assert.equal(poses.apply(body, actor, 0.5), false);
  poses.restore();
  assert.equal(visits(), 0);
  assert.deepEqual(actor.position.toArray(), position.toArray());
  assert.deepEqual(actor.quaternion.toArray(), orientation.toArray());
  // Visible/subpixel motion remains ordinary interpolation, not a sleep gate.
  body.state.position.x += 1e-8;
  assert.equal(poses.apply(body, actor, 1), true);
  poses.restore();
  assert.equal(visits(), 2);
});

test("live parent movement invalidates an unchanged body's local target", () => {
  const parent = new Group(),
    actor = new Group(),
    poses = new RenderPoses();
  parent.position.x = 10;
  actor.position.x = 2;
  parent.add(actor);
  const body = {
    state: {
      position: new Vector3(12, 0, 0),
      orientation: new Quaternion(),
    },
  };
  poses.capture([body]);
  parent.position.x = 20;
  assert.equal(poses.apply(body, actor, 1), true);
  assert.equal(actor.position.x, -8);
  assert.equal(actor.matrixWorld.elements[12], 12);
  assert.equal(body.state.position.x, 12);
  poses.restore();
  assert.equal(actor.position.x, 2);
  assert.equal(actor.matrixWorld.elements[12], 22);
});

test("reparenting recomputes the live world-to-local target without changing physics", () => {
  const left = new Group(),
    right = new Group(),
    actor = new Group();
  const poses = new RenderPoses();
  left.position.x = 10;
  right.position.x = -4;
  actor.position.x = 2;
  left.add(actor);
  const body = {
    state: {
      position: new Vector3(12, 0, 0),
      orientation: new Quaternion(),
    },
  };
  poses.capture([body]);
  right.add(actor);
  assert.equal(poses.apply(body, actor, 1), true);
  assert.equal(actor.position.x, 16);
  assert.equal(actor.matrixWorld.elements[12], 12);
  poses.restore();
  assert.equal(actor.parent, right);
  assert.equal(actor.position.x, 2);
  assert.equal(body.state.position.x, 12);
});

test("manual matrix mismatch rebuilds despite equal PQ and restores the exact committed matrix", () => {
  const actor = new Group(),
    poses = new RenderPoses();
  actor.matrixAutoUpdate = false;
  actor.position.set(1, 2, 3);
  actor.matrix.makeTranslation(100, 200, 300);
  const committed = actor.matrix.toArray();
  const body = {
    state: {
      position: actor.position.clone(),
      orientation: actor.quaternion.clone(),
    },
  };
  const visits = descendantVisits(actor);
  assert.equal(poses.apply(body, actor, 1, true), true);
  assert.deepEqual(actor.matrix.elements.slice(12, 15), [1, 2, 3]);
  poses.restore();
  assert.equal(visits(), 2);
  assert.deepEqual(actor.matrix.toArray(), committed);
  assert.deepEqual(actor.position.toArray(), [1, 2, 3]);
});

test("matching manual pose and exact matrix skip temporary updates", () => {
  const actor = new Group(),
    poses = new RenderPoses();
  actor.matrixAutoUpdate = false;
  actor.position.set(1, 2, 3);
  actor.updateMatrix();
  const committed = actor.matrix.toArray();
  const body = {
    state: {
      position: actor.position.clone(),
      orientation: actor.quaternion.clone(),
    },
  };
  const visits = descendantVisits(actor);
  assert.equal(poses.apply(body, actor, 0.4, true), false);
  poses.restore();
  assert.equal(visits(), 0);
  assert.deepEqual(actor.matrix.toArray(), committed);
});

test("external actor mutation and stale epoch take the changed path with exact restoration", () => {
  const actor = new Group(),
    poses = new RenderPoses();
  const body = {
    state: {
      position: new Vector3(3, 2, 1),
      orientation: new Quaternion(),
    },
    poseEpoch: 0,
  };
  poses.capture([body]);
  actor.position.set(20, 21, 22);
  body.state.position.set(10, 11, 12);
  body.poseEpoch++;
  assert.equal(poses.apply(body, actor, 0), true);
  assert.deepEqual(actor.position.toArray(), [10, 11, 12]);
  assert.deepEqual(body.state.position.toArray(), [10, 11, 12]);
  poses.restore();
  assert.deepEqual(actor.position.toArray(), [20, 21, 22]);
});

test("custom root update outlets retain native apply and restore calls for equal poses", () => {
  const actor = new Group(),
    poses = new RenderPoses();
  let calls = 0;
  const update = actor.updateMatrixWorld;
  actor.updateMatrixWorld = function (...args) {
    calls++;
    return update.apply(this, args);
  };
  const body = {
    state: {
      position: new Vector3(),
      orientation: new Quaternion(),
    },
  };
  assert.equal(poses.apply(body, actor, 1), true);
  poses.restore();
  assert.equal(calls, 2);
});

test("custom ancestor outlets preserve the original actor mutation and restoration boundary", () => {
  const ancestor = new Group(),
    parent = new Group(),
    actor = new Group();
  ancestor.add(parent);
  parent.add(actor);
  actor.position.x = 10;
  const poses = new RenderPoses();
  const body = {
    state: {
      position: new Vector3(3, 0, 0),
      orientation: new Quaternion(),
    },
  };
  const observed = [];
  const update = ancestor.updateWorldMatrix;
  ancestor.updateWorldMatrix = function (...args) {
    observed.push(actor.position.x);
    return update.apply(this, args);
  };
  assert.equal(poses.apply(body, actor, 1), true);
  // Original apply samples directly into the actor before native parent calls.
  assert.equal(observed[0], 3);
  assert.equal(actor.position.x, 3);
  poses.restore();
  assert.equal(actor.position.x, 10);
  assert.equal(body.state.position.x, 3);
});
