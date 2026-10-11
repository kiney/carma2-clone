import test from "node:test";
import assert from "node:assert/strict";
import { Object3D, Vector3 } from "three";
import { SparkSystem } from "../src/sparks.ts";
import { CarSparkAllocator } from "../src/car-sparks.ts";
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
test("car and world allocators overwrite the same native 32-slot ring", () => {
  const primary = new Object3D();
  const secondary = new Object3D();
  const sparks = new SparkSystem({ random: () => 0, shrapnelOutlet: () => {} });
  const cars = new CarSparkAllocator({
    allocateNative: sparks.allocateNative,
    random: () => 0,
    shrapnelOutlet: () => {},
  });
  const world = sparks.spawnWorld({
    car: primary,
    position: v(),
    velocity: v(),
    force: v(10),
    sparkiness: 1,
  });
  assert.deepEqual(world.ids, [0, 1, 2, 3]);
  const source = () => ({
    position: v(1, 2, 3),
    velocity: v(0, 1),
    force: v(200),
    cars: [
      { actor: primary, driver: 8 },
      { actor: secondary, driver: 6 },
    ],
    timeSyncMs: 20,
  });
  assert.deepEqual(
    cars.spawn(source()).ids,
    Array.from({ length: 20 }, (_, i) => i + 4),
  );
  assert.deepEqual(
    cars.spawn(source()).ids,
    [24, 25, 26, 27, 28, 29, 30, 31, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
  assert.equal(sparks.stats.active, 32);
  assert.equal(sparks.stats.overwritten, 12);
  assert.equal(sparks.stats.cursor, 12);
  for (const record of sparks.snapshot().records) {
    assert.equal(record.car, primary);
    assert.deepEqual(record.normal.toArray(), [0, 0, 0]);
  }
  sparks.update(40, 40);
  assert.equal(sparks.stats.visible, 32);
  sparks.clear();
  assert.equal(sparks.stats.active, 0);
  assert.equal(sparks.stats.cursor, 12);
  sparks.dispose();
});
