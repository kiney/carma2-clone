import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { nativeWorldSparkSource } from "../src/physics/world-sparks.ts";
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function input(extra = {}) {
  return {
    car: new Group(),
    state: {
      position: v(5, 2, 3),
      orientation: new Quaternion(),
      velocity: v(1),
      angularVelocity: v(0, 1),
    },
    driver: 8,
    totalLambda: 0.03,
    hasSecondary: false,
    hasFace: true,
    localPoint: v(2, 0, -1),
    worldForce: v(0.1, 0.2, 0.3),
    sparkiness: 1,
    timeSyncMs: 17,
    ...extra,
  };
}
function close(a, b, tolerance = 1e-6) {
  assert.ok(a.distanceTo(b) < tolerance, `${a.toArray()} != ${b.toArray()}`);
}
test("world spark dispatcher preserves source point velocity and scales only force", () => {
  const source = input();
  const packet = nativeWorldSparkSource(source);
  close(packet.position, v(7, 2, 2));
  close(packet.velocity, v(0, 0, -2));
  close(packet.force, v(0.69, 1.38, 2.07));
  assert.equal(packet.timeSyncMs, 17);
  assert.equal(packet.car, source.car);
  close(source.state.velocity, v(1));
  close(source.worldForce, v(0.1, 0.2, 0.3));
});
test("native strict group/velocity gates, first face and driver flags select world sparks", () => {
  assert.equal(
    nativeWorldSparkSource(input({ totalLambda: Math.fround(0.02) })),
    undefined,
  );
  for (const extra of [
    { hasSecondary: true },
    { hasFace: false },
    { driver: 5 },
  ])
    assert.equal(nativeWorldSparkSource(input(extra)), undefined);
  assert.ok(nativeWorldSparkSource(input({ driver: 5, carFlags: 0x200000 })));
  const stopped = input();
  stopped.state.velocity.set(0, 0, 0);
  assert.equal(nativeWorldSparkSource(stopped), undefined);
  // Nonzero angular velocity alone does not pass the world translation gate.
  stopped.state.angularVelocity.set(10, 10, 10);
  assert.equal(nativeWorldSparkSource(stopped), undefined);
  stopped.state.velocity.set(0.031, 0, 0);
  assert.ok(nativeWorldSparkSource(stopped));
});
test("downward native threshold doubles raw force without changing severity or point", () => {
  const source = input();
  source.state.velocity.y = Math.fround(-2.8985507488250732);
  const ordinary = nativeWorldSparkSource(source);
  source.state.velocity.y -= 2 ** -20;
  const falling = nativeWorldSparkSource(source);
  close(falling.force, ordinary.force.clone().multiplyScalar(2));
  close(falling.position, ordinary.position);
});
test("rotated source actor transforms weighted point and raw local angular velocity", () => {
  const source = input();
  source.state.orientation.setFromAxisAngle(v(0, 1), Math.PI / 2);
  source.state.velocity.set(0, 0, -1);
  const packet = nativeWorldSparkSource(source);
  close(packet.position, v(4, 2, 1));
  close(packet.velocity, v(-2, 0, 0));
  close(packet.force, v(0.69, 1.38, 2.07));
});
