import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import {
  OilRuntime,
  OIL_SPILL_CAPACITY,
  OIL_WORLD_SCALE,
  validOilSurface,
} from "../src/physics/oil.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const body = (position = v()) => ({
  state: {
    position,
    orientation: new Quaternion(),
    velocity: v(),
    angularVelocity: v(),
  },
  properties: { mass: 1, inertia: v(1, 1, 1), centerOfMass: v(), worldFriction: 1 },
});
const near = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);

test("oil slots cap at 32, suppress same-owner renewal for five seconds, then reuse oldest", () => {
  const runtime = new OilRuntime({ random: () => 0.5 });
  const owners = Array.from({ length: OIL_SPILL_CAPACITY + 1 }, () => body());
  const options = (nativeOwnerCar) => ({ nativeOwnerCar });
  const first = runtime.queueSpill(owners[0], undefined, 1000, options(owners[0]));
  assert.ok(first);
  assert.equal(runtime.queueSpill(owners[0], undefined, 5999, options(owners[0])), null);
  assert.ok(runtime.queueSpill(owners[0], undefined, 6000, options(owners[0])));
  // A distinct owner can still fill the pool; owner zero's earlier slot is oldest.
  for (let i = 1; i < OIL_SPILL_CAPACITY; i++)
    assert.ok(runtime.queueSpill(owners[i], undefined, 6000 + i, options(owners[i])));
  const reused = runtime.queueSpill(owners[OIL_SPILL_CAPACITY], undefined, 7000);
  assert.ok(reused);
  assert.equal(runtime.spills.length, OIL_SPILL_CAPACITY);
  assert.equal(runtime.spills.includes(first), false);
  assert.equal(first.mesh.parent, null);
});

test("oil grows from half-size .2 at sampled rate and caps at sampled full size", () => {
  const runtime = new OilRuntime({ random: () => 0 });
  const spill = runtime.queueSpill(null, v(), 2000, { surface: { normal: v(0, 1, 0) } });
  assert.ok(spill);
  assert.equal(spill.fullSize, 0.35);
  assert.equal(spill.growRate, 0.000089);
  assert.equal(spill.mesh.visible, false);
  runtime.update(2000);
  assert.equal(spill.mesh.visible, true);
  assert.equal(spill.mesh.children[0].scale.x, 0.2);
  runtime.update(3000);
  near(spill.currentSize, 0.289);
  runtime.update(5000);
  near(spill.currentSize, 0.35);
  runtime.update(100_000);
  near(spill.currentSize, 0.35); // native code has no natural expiry
});

test("wheel oil test uses scaled x/z bounds, vertical tolerance, and grip/mark ranges", () => {
  const sequence = [0.5, 0.5, 0.5, 0.5, 0.5];
  const runtime = new OilRuntime({ random: () => sequence.shift() ?? 0.5 });
  const spill = runtime.queueSpill(null, v(0, 0, 0), 0, { surface: { normal: v(0, 1, 0) } });
  assert.ok(spill);
  runtime.update(0);
  const within = v(0.17 * OIL_WORLD_SCALE, 0.09 * OIL_WORLD_SCALE, 0.17 * OIL_WORLD_SCALE);
  const car = body();
  const factors = runtime.wheelFactors(car, [within, v(0.4 * OIL_WORLD_SCALE, 0, 0), v(0, OIL_WORLD_SCALE, 0), null]);
  near(factors[0], 0.08);
  assert.equal(factors[1], 1);
  assert.equal(factors[2], 1);
  assert.equal(factors[3], 1);
  assert.deepEqual(runtime.wheelFactors(car, [null, null, null, null]), factors);
  near(runtime.consumeOilMark(car, 0, 1.9), 0.1);
  near(runtime.wheelFactors(car, [null, null, null, null])[0], factors[0]);
  assert.equal(runtime.consumeOilMark(car, 0, 0.2), 0);
  assert.equal(runtime.wheelFactors(car, [null, null, null, null])[0], 1);
  assert.equal(runtime.wheelFactors(body(), [null, null, null, null])[0], 1);
});

test("oil placement accepts near-flat surfaces and rejects steep/nearby conflicting planes", () => {
  assert.equal(validOilSurface({ normal: v(0, 0.97, Math.sqrt(1 - 0.97 ** 2)) }), true);
  assert.equal(validOilSurface({ normal: v(0, 0.969, Math.sqrt(1 - 0.969 ** 2)) }), false);
  assert.equal(validOilSurface({
    normal: v(0, 1, 0),
    nearbyFaceNormals: [v(0, 0.9, Math.sqrt(1 - 0.9 ** 2))],
    sameSideOfNearbyPlanes: [true],
  }), false);
  assert.equal(validOilSurface({
    normal: v(0, 1, 0),
    nearbyFaceNormals: [v(0, 0.8, 0.6)],
    sameSideOfNearbyPlanes: [false],
  }), false);
  assert.equal(validOilSurface({
    normal: v(0, 1, 0),
    nearbyFaceNormals: [v(0, 0.8, 0.6)],
    sameSideOfNearbyPlanes: [true],
  }), true);
});

test("PissOutOil remains pending for the live actor and bypasses owner cooldown and stopped-car gate", () => {
  const runtime = new OilRuntime({ random: () => 0.5 });
  const actor = body(v(1, 3, 2));
  actor.state.velocity.set(100, 20, -30);
  const first = runtime.queueSpill(actor, 1000);
  const second = runtime.queueSpill(actor, 1000);
  assert.ok(first && second);
  assert.equal(first.pending, true);
  assert.equal(first.mesh.visible, false);
  actor.state.position.set(4, 8, 9);
  let projectedAt;
  runtime.update(1200, (candidate, fullSize, sameActor) => {
    projectedAt = candidate.clone();
    assert.equal(sameActor, actor);
    assert.ok(fullSize >= 0.35 && fullSize <= 0.6);
    return { position: v(candidate.x, 0, candidate.z), normal: v(0, 1, 0) };
  });
  assert.deepEqual(projectedAt.toArray(), [4, 8, 9]);
  assert.equal(first.pending, false);
  assert.deepEqual(first.position.toArray(), [4, 0, 9]);
  assert.equal(first.mesh.visible, true);
  near(first.currentSize, 0.2);
  runtime.update(20_000, () => ({ position: v(4, 0, 9), normal: v(0, 1, 0) }));
  near(first.currentSize, first.fullSize);
  assert.equal(first.stopTime, 0);
});

test("failed projection clears the queued slot", () => {
  const runtime = new OilRuntime({ random: () => 0.5 });
  const spill = runtime.queueSpill(body(), 0);
  assert.ok(spill);
  runtime.update(1, () => null);
  assert.equal(runtime.spills.includes(spill), false);
  assert.equal(spill.mesh.visible, false);
});

test("owner-car displacement uses original actor position, then freezes growth", () => {
  const runtime = new OilRuntime({ random: () => 0 });
  const car = body(v(0, 10, 0));
  const spill = runtime.queueSpill(car, v(0, 10, 0), 0, { nativeOwnerCar: car });
  assert.ok(spill);
  const projector = () => ({ position: v(0, 0, 0), normal: v(0, 1, 0) });
  runtime.update(0, projector);
  assert.deepEqual(spill.originalOwnerPosition.toArray(), [0, 10, 0]);
  assert.equal(spill.stopTime, 0);
  car.state.position.x = 0.1;
  runtime.update(100, projector);
  near(spill.currentSize, 0.2089);
  car.state.position.x = 0.6;
  runtime.update(200, projector);
  assert.equal(spill.stopTime, 200);
  near(spill.currentSize, 0.2089);
});

test("non-finite oil locations and times are ignored", () => {
  const runtime = new OilRuntime();
  assert.equal(runtime.queueSpill(null, v(Number.NaN), 0), null);
  assert.equal(runtime.queueSpill(null, v(), Number.POSITIVE_INFINITY), null);
  assert.equal(runtime.spills.every((spill) => spill === null), true);
});
