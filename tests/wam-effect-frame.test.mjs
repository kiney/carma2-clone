import test from "node:test";
import assert from "node:assert/strict";
import { Euler, Group, Matrix4, Quaternion, Vector3 } from "three";
import { wamEffectFrame } from "../src/wam-effect-frame.ts";

const matrixClose = (actual, expected) => {
  assert.equal(actual.elements.length, expected.elements.length);
  for (let index = 0; index < 16; index++)
    assert.ok(
      Math.abs(actual.elements[index] - expected.elements[index]) < 1e-9,
      `matrix element ${index}: ${actual.elements[index]} != ${expected.elements[index]}`,
    );
};

test("physical root replaces render interpolation and preserves child affine transform", () => {
  const car = new Group();
  car.position.set(90, 80, 70); // stale/interpolated renderer root
  car.rotation.set(0.2, -0.3, 0.1);
  car.scale.set(1.2, 0.8, 1.1);
  const parent = new Group();
  parent.position.set(2, 3, 4);
  parent.rotation.set(-0.1, 0.4, 0.2);
  parent.scale.set(0.7, 1.3, 0.9);
  const actor = new Group();
  actor.position.set(-5, 6, 7);
  actor.rotation.set(0.4, 0.1, -0.2);
  actor.scale.set(1.1, 0.95, 1.25);
  car.add(parent);
  parent.add(actor);
  car.updateWorldMatrix(true, true);
  const actorInCar = car.matrixWorld
    .clone()
    .invert()
    .multiply(actor.matrixWorld);
  const physicalPosition = new Vector3(11, 12, 13);
  const physicalOrientation = new Quaternion().setFromEuler(
    new Euler(0.3, -0.2, 0.5),
  );
  const expected = new Matrix4()
    .compose(physicalPosition, physicalOrientation, new Vector3(1, 1, 1))
    .multiply(actorInCar);
  const result = wamEffectFrame(
    car,
    actor,
    physicalPosition,
    physicalOrientation,
  );
  matrixClose(result, expected);
  assert.notEqual(result.elements[12], car.matrixWorld.elements[12]);
});

test("detached actor uses its own world pose and result is an independent matrix", () => {
  const car = new Group();
  car.position.set(100, 0, 0);
  const actor = new Group();
  actor.position.set(40, 2, 3);
  actor.rotation.set(0.1, 0.2, 0.3);
  actor.updateWorldMatrix(true, false);
  const actorWorld = actor.matrixWorld.clone();
  const position = new Vector3(-10, 0, 1);
  const orientation = new Quaternion();
  const first = wamEffectFrame(car, actor, position, orientation);
  matrixClose(first, actorWorld);
  first.elements[12] = 999;
  const second = wamEffectFrame(car, actor, position, orientation);
  matrixClose(second, actorWorld);
  assert.notEqual(second, actor.matrixWorld);
});
