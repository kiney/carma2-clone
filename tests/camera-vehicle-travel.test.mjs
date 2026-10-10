import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { CameraVehicleTravel } from "../src/camera/vehicle-travel.ts";
import { NativeChaseCamera } from "../src/camera/chase.ts";

test("FinishCars first-motion floor retains direction for one frame", () => {
  const travel = new CameraVehicleTravel();
  const orientation = new Quaternion();
  travel.reset(orientation);
  const first = travel.update(new Vector3(0, 0, 1), orientation);
  assert.equal(first.speed, 0.0001);
  assert.equal(first.direction.z, -1);
  const second = travel.update(new Vector3(0, 0, 1), orientation);
  assert.equal(second.speed, 0.001);
  assert.equal(second.speedometer, -0.001);
  assert.equal(second.direction.z, 1);
});

test("reverse travel survives a stop and follows body orientation without chase updates", () => {
  const travel = new CameraVehicleTravel();
  const orientation = new Quaternion();
  travel.reset(orientation);
  travel.update(new Vector3(0, 0, 1), orientation);
  travel.update(new Vector3(0, 0, 1), orientation);
  const turned = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    Math.PI / 3,
  );
  const stopped = travel.update(new Vector3(), turned);
  const backward = new Vector3(0, 0, 1).applyQuaternion(turned);
  assert.ok(stopped.direction.distanceTo(backward) < 1e-12);
  assert.equal(stopped.speed, 0);
  const camera = new NativeChaseCamera();
  const com = new Vector3(0, 0.1, 0);
  camera.reset(com, turned, stopped.direction);
  const pose = camera.update({
    dtMs: 0,
    worldCOM: com,
    orientation: turned,
    modelVelocity: new Vector3(),
    movement: stopped,
    rearWheelZ: 0,
    steeringCurvature: 0,
    fovBRenderAngle: 10112,
  });
  assert.equal(camera.state.reverse, true);
  assert.ok(pose.travelDirection.distanceTo(backward) < 1e-12);
});

test("provided FinishCars movement avoids reapplying the first-motion floor after camera reset", () => {
  const travel = new CameraVehicleTravel();
  const orientation = new Quaternion();
  const velocity = new Vector3(1, 0, 1);
  travel.reset(orientation);
  travel.update(velocity, orientation);
  const movement = travel.update(velocity, orientation);
  const camera = new NativeChaseCamera();
  const com = new Vector3();
  camera.reset(com, orientation, movement.direction);
  const pose = camera.update({
    dtMs: 40,
    worldCOM: com,
    orientation,
    modelVelocity: velocity,
    movement,
    rearWheelZ: 0,
    steeringCurvature: 0,
    fovBRenderAngle: 10112,
  });
  assert.ok(
    pose.travelDirection.distanceTo(velocity.clone().normalize()) < 1e-12,
  );
});

test("travel snapshots cannot mutate retained direction and new cars seed forward", () => {
  const travel = new CameraVehicleTravel();
  const orientation = new Quaternion();
  travel.reset(orientation);
  travel.snapshot().direction.set(1, 2, 3);
  assert.equal(travel.snapshot().direction.z, -1);
  const vertical = travel.update(new Vector3(0, 5, 0), orientation);
  assert.equal(vertical.speed, 0);
  assert.equal(vertical.direction.z, -1);
});

test("installed low-speed speedometer uses the untransformed local Z temporary", () => {
  const travel = new CameraVehicleTravel();
  const orientation = new Quaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    Math.PI / 2,
  );
  const velocity = new Vector3(-10, 0, 2);
  travel.reset(orientation);
  const first = travel.update(velocity, orientation);
  assert.equal(first.speed, 0.0001);
  assert.equal(first.speedometer, -0.002);
  const next = travel.update(velocity, orientation);
  assert.ok(Math.abs(next.speedometer - 0.01) < 1e-12);
});
