import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { NativeChaseCamera } from "../src/camera/chase.ts";
import { readFile } from "node:fs/promises";
import { parseTwt } from "../server/assets.mjs";

const A = 65536 / (2 * Math.PI);
const toAngle = (r) => Math.trunc(r * A) & 65535;
const input = (values = {}) => ({
  dtMs: 40,
  worldCOM: new Vector3(),
  orientation: new Quaternion(),
  modelVelocity: new Vector3(),
  rearWheelZ: 0.3,
  steeringCurvature: 0,
  fovBRenderAngle: 10112,
  ...values,
});
function close(actual, expected, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
}

test("stationary native framing uses COM, zoom and quantized FOV inclination", () => {
  const camera = new NativeChaseCamera();
  const com = new Vector3(3, 0.07, 8);
  const result = camera.update(input({ worldCOM: com }));
  const zoom = Math.fround(0.2),
    distance = Math.sqrt(zoom) + 4 / 6.9;
  close(result.cameraPosition.x, com.x);
  close(result.cameraPosition.z, com.z + distance);
  close(result.cameraPosition.y, com.y + zoom * zoom + 0.3);
  const pitch =
    (Math.trunc(10112 / 5) - toAngle(Math.atan2(zoom * zoom + 0.3, distance))) &
    65535;
  assert.equal(result.pitchBRenderAngle, pitch);
  close(result.aimDirection.y, Math.sin(pitch / A));
  assert.ok(result.aimDirection.z < 0);
});

test("turned car COM and viewing axis transform together without bounds enlargement", () => {
  const rotation = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    Math.PI / 2,
  );
  const origin = new Vector3(12, 2, -4);
  const com = new Vector3(0, 0.279391, 0.142661)
    .applyQuaternion(rotation)
    .add(origin);
  const camera = new NativeChaseCamera();
  const pose = camera.update(input({ worldCOM: com, orientation: rotation }));
  close(pose.cameraPosition.x, com.x + pose.distance);
  close(pose.cameraPosition.z, com.z);
  close(pose.cameraPosition.y, com.y + Math.fround(0.2) ** 2 + 0.3);
});

test("native height filter is rational and long camera periods reset height", () => {
  const camera = new NativeChaseCamera();
  camera.reset(new Vector3(), new Quaternion());
  camera.update(input({ dtMs: 100, worldCOM: new Vector3(0, 3, 0) }));
  close(camera.state.height, 1);
  camera.update(input({ dtMs: 200, worldCOM: new Vector3(0, 3, 0) }));
  close(camera.state.height, 2);
  camera.update(input({ dtMs: 5000, worldCOM: new Vector3(0, 10, 0) }));
  close(camera.state.height, 10);
});

test("stationary steering rotates the camera by authored rear wheel lever", () => {
  const camera = new NativeChaseCamera();
  const pose = camera.update(input({ steeringCurvature: 1, dtMs: 1000 }));
  // First native swing can snap when quantized sqrt(cross) is below min rate.
  const angle = toAngle(Math.atan2(0.3, 1));
  const minimum = toAngle(Math.PI / 36);
  const step = Math.max(
    Math.trunc((1000 * Math.trunc((2 * 65536) / 360)) / 100) & 65535,
    minimum,
  );
  const turn = Math.min(angle, step);
  close(pose.viewDirection.x, -Math.sin(turn / A));
  close(pose.viewDirection.z, -Math.cos(turn / A));
});

test("side velocity tracks with native fast-swing rate and no speed distance term", () => {
  const camera = new NativeChaseCamera();
  camera.update(input({ modelVelocity: new Vector3(1, 0, 0) })); // Native first-moving frame floor.
  const pose = camera.update(input({ modelVelocity: new Vector3(1, 0, 0) }));
  const initialRate = Math.trunc((3 * 65536) / 360);
  const step = Math.trunc((40 * initialRate) / 100);
  close(pose.viewDirection.x, Math.sin(step / A));
  close(pose.viewDirection.z, -Math.cos(step / A));
  assert.equal(camera.state.fastSwing, true);
  assert.equal(
    camera.state.rateBRenderAngle,
    initialRate + Math.trunc((40 * 0.06 * 65536) / 360),
  );
  const faster = camera.update(
    input({ modelVelocity: new Vector3(100, 0, 0) }),
  );
  close(faster.distance, pose.distance);
});

test("high yaw rate sets angular step independently of chase acceleration", () => {
  const camera = new NativeChaseCamera();
  camera.update(input({ modelVelocity: new Vector3(1, 0, 0) }));
  const pose = camera.update(
    input({
      modelVelocity: new Vector3(1, 0, 0),
      angularVelocityLocal: new Vector3(0, 2, 0),
    }),
  );
  const step = toAngle(0.04 * (2 + Math.PI / 36));
  close(pose.viewDirection.x, Math.sin(step / A));
  close(pose.viewDirection.z, -Math.cos(step / A));
});

test("local angular velocity is projected through car orientation onto world Y", () => {
  const camera = new NativeChaseCamera();
  const orientation = new Quaternion().setFromAxisAngle(
    new Vector3(0, 0, 1),
    Math.PI / 2,
  );
  camera.update(input({ orientation, modelVelocity: new Vector3(1, 0, 0) }));
  const pose = camera.update(
    input({
      orientation,
      modelVelocity: new Vector3(1, 0, 0),
      angularVelocityLocal: new Vector3(2, 0, 0),
    }),
  );
  close(pose.viewDirection.x, Math.sin(toAngle(0.04 * (2 + Math.PI / 36)) / A));
});

test("large persistent turns cap native fast tracking rate at40 degrees", () => {
  const camera = new NativeChaseCamera();
  let pose = camera.update(input());
  for (let i = 0; i < 20; i++) {
    const direction = pose.viewDirection
      .clone()
      .applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    pose = camera.update(input({ dtMs: 100, modelVelocity: direction }));
    assert.ok(camera.state.rateBRenderAngle <= Math.trunc((40 * 65536) / 360));
  }
  assert.equal(camera.state.rateBRenderAngle, Math.trunc((40 * 65536) / 360));
});

test("reverse initialization retains native500ms sign transition guard", () => {
  const camera = new NativeChaseCamera();
  camera.reset(new Vector3(), new Quaternion(), new Vector3(0, 0, 1));
  camera.update(input({ modelVelocity: new Vector3(1, 0, 0) }));
  camera.update(input({ modelVelocity: new Vector3(1, 0, 0) }));
  assert.equal(camera.state.reverse, true);
  assert.equal(camera.state.reversalMs, 0);
  for (let i = 0; i < 4; i++)
    camera.update(input({ dtMs: 100, modelVelocity: new Vector3(1, 0, 0) }));
  assert.equal(camera.state.reverse, true);
  assert.equal(camera.state.reversalMs, 400);
  camera.update(input({ dtMs: 100, modelVelocity: new Vector3(1, 0, 0) }));
  assert.equal(camera.state.reverse, false);
  assert.equal(camera.state.reversalMs, 500);
});

test("reverse motion preserves native direction history instead of instant heading flip", () => {
  const camera = new NativeChaseCamera();
  camera.update(input({ modelVelocity: new Vector3(0, 0, -1) }));
  camera.update(input({ modelVelocity: new Vector3(0, 0, -1) }));
  const reverse = camera.update(input({ modelVelocity: new Vector3(0, 0, 1) }));
  assert.equal(camera.state.reverse, false);
  assert.ok(reverse.viewDirection.z < -0.99);
  assert.equal(camera.state.fastSwing, true);
  assert.equal(camera.state.reversalMs, -1);
});

test("collision mode follows its previous resolved position and releases on motion", () => {
  const camera = new NativeChaseCamera();
  camera.update(input());
  camera.resolvePosition(new Vector3(-1, 0.34, 0));
  const held = camera.update(input({ frameCollision: true }));
  assert.equal(camera.state.mode, 1);
  close(held.cameraPosition.x, -held.distance);
  close(held.cameraPosition.z, 0);
  camera.update(input({ modelVelocity: new Vector3(0, 0, -1) }));
  assert.notEqual(camera.state.mode, 1);
});

test("zoom limits and malformed inputs keep finite browser camera state", () => {
  const camera = new NativeChaseCamera();
  camera.zoom = -1;
  close(camera.zoom, Math.fround(0.1));
  camera.zoom = 5;
  close(camera.zoom, 2);
  assert.throws(() => (camera.zoom = NaN));
  for (const values of [
    { dtMs: -1 },
    { dtMs: 0.5 },
    { fovBRenderAngle: 65536 },
    { modelVelocity: new Vector3(NaN, 0, 0) },
  ])
    assert.throws(() => camera.update(input(values)));
  const pose = camera.update(input({ modelVelocity: new Vector3(0, 1, 0) }));
  assert.ok(pose.cameraPosition.toArray().every(Number.isFinite));
});

test("original Eagle and Bigdump camera poses use authored mechanics COM", async (t) => {
  for (const name of ["eaglegreen", "bigdump"]) {
    let buffer;
    try {
      buffer = await readFile(`carma2_orig/data/CARS/${name}.TWT`);
    } catch {
      t.skip("Original installation absent");
      return;
    }
    const entry = parseTwt(buffer).entries.find(
      (e) => e.name.toLowerCase() === `${name}.txt`,
    );
    const text = buffer
      .subarray(entry.offset, entry.offset + entry.size)
      .toString("latin1");
    const line = text
      .split(/\r?\n/)
      .find((line) => /\/\/\s*Centre of mass/i.test(line));
    const values = line
      .split("//")[0]
      .trim()
      .split(/[ ,\t]+/)
      .map(Number);
    const com = new Vector3(...values);
    const camera = new NativeChaseCamera();
    const pose = camera.update(input({ worldCOM: com }));
    close(pose.cameraPosition.y, values[1] + Math.fround(0.2) ** 2 + 0.3);
    close(pose.cameraPosition.z, values[2] + pose.distance);
  }
});
