import test from "node:test";
import assert from "node:assert/strict";
import { Object3D, Quaternion, Vector3 } from "three";
import { nativeCarSparkSource } from "../src/physics/car-spark-source.ts";
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const state = () => ({
  position: v(1, 2, 3),
  orientation: new Quaternion(),
  velocity: v(0, -10, 2),
  angularVelocity: v(20),
});
function input() {
  return {
    primary: { actor: new Object3D(), driver: 8 },
    secondary: { actor: new Object3D(), driver: 6 },
    primaryState: state(),
    secondaryState: state(),
    totalLambda: 0.03,
    localPoint: v(2, 3, 4),
    worldForce: v(1, 2, 3),
    timeSyncMs: 50,
  };
}
test("car/car source uses secondary linear velocity and never doubles falling force", () => {
  const source = input();
  source.primaryState.velocity.set(100, -100, 100);
  const packet = nativeCarSparkSource(source);
  assert.deepEqual(packet.velocity.toArray(), [0, -10, 2]);
  assert.ok(packet.force.distanceTo(v(6.9, 13.8, 20.7)) < 2e-6);
  assert.deepEqual(packet.position.toArray(), [3, 5, 7]);
  assert.equal(packet.timeSyncMs, 50);
  assert.equal(packet.cars[1], source.secondary);
});
test("native car/car strict group gate runs before either allocator", () => {
  const source = input();
  source.totalLambda = Math.fround(0.02);
  assert.equal(nativeCarSparkSource(source), undefined);
  source.totalLambda = Math.fround(0.02 + 2 ** -29);
  assert.ok(nativeCarSparkSource(source));
});
test("car/car motion gate uses either body's stored linear speed, excluding stationary spin", () => {
  const source = input();
  source.primaryState.velocity.set(0, 0, 0);
  source.secondaryState.velocity.set(0, 0, 0);
  assert.equal(nativeCarSparkSource(source), undefined);
  source.primaryState.velocity.x = 0.03;
  assert.equal(
    nativeCarSparkSource(source),
    undefined,
    "f32(.03) squared is below double .0009",
  );
  source.primaryState.velocity.x = 0.030000002;
  assert.ok(
    nativeCarSparkSource(source),
    "moving primary permits a stationary-secondary packet",
  );
  source.primaryState.velocity.x = 0;
  source.secondaryState.velocity.z = 0.030000002;
  assert.ok(
    nativeCarSparkSource(source),
    "moving secondary independently passes",
  );
});
