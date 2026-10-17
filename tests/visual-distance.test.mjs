import test from "node:test";
import assert from "node:assert/strict";
import { Group, Vector3, Quaternion } from "three";
import {
  visualDistances,
  DistantOpponentPresentation,
} from "../src/visual-distance.ts";
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const body = () => ({
  group: new Group(),
  poseEpoch: 0,
  state: { position: v(60), orientation: new Quaternion() },
});
test("presentation distances expand authored ranges fourfold without rewriting their inputs", () => {
  const yon = 35,
    process = 12;
  assert.deepEqual(visualDistances(yon, process), {
    nativeYon: 35,
    landscape: 140,
    opponents: 140,
    pedestrians: 48,
    fogScale: 4,
  });
  assert.equal(visualDistances(70, 20).pedestrians, 80);
  assert.equal(visualDistances(10, 12).pedestrians, 40);
  for (const value of [0, -1, NaN, Infinity])
    assert.throws(() => visualDistances(value, 12));
});
test("only explicitly published cheaty poses become temporarily visible within the visual range", () => {
  const p = new DistantOpponentPresentation(),
    a = body(),
    b = body();
  a.group.visible = b.group.visible = false;
  const initial = JSON.stringify(a.state);
  p.publish(a);
  assert.equal(p.apply([a, b], v(), 48), 0);
  assert.equal(a.group.visible, false);
  assert.equal(p.apply([a, b], v(), 140), 1);
  assert.equal(a.group.visible, true);
  assert.equal(b.group.visible, false);
  assert.equal(JSON.stringify(a.state), initial);
  p.restore();
  assert.equal(a.group.visible, false);
  a.group.visible = true;
  p.apply([a, b], v(), 140);
  p.restore();
  assert.equal(
    a.group.visible,
    true,
    "native visible roots are never hidden by restoration",
  );
});
test("placement, epoch, pose changes and physics invalidation cannot expose a stale cheaty pose", () => {
  for (const change of [
    (a) => a.poseEpoch++,
    (a) => a.state.position.x++,
    (a) => a.state.orientation.setFromAxisAngle(v(0, 1), 0.2),
  ]) {
    const p = new DistantOpponentPresentation(),
      a = body();
    a.group.visible = false;
    p.publish(a);
    change(a);
    assert.equal(p.apply([a], v(), 140), 0);
    assert.equal(a.group.visible, false);
    p.publish(a);
    assert.equal(p.apply([a], v(), 140), 1);
    p.restore();
    p.invalidate(a);
    assert.equal(p.apply([a], v(), 140), 0);
  }
});
test("render failure cleanup restores native visibility without changing native game state", () => {
  const p = new DistantOpponentPresentation(),
    a = body();
  a.group.visible = false;
  p.publish(a);
  assert.throws(() => {
    try {
      p.apply([a], v(), 140);
      assert.equal(a.group.visible, true);
      throw new Error("render failed");
    } finally {
      p.restore();
    }
  }, /render failed/);
  assert.equal(a.group.visible, false);
  p.reset();
  assert.equal(p.apply([a], v(), 140), 0);
});
