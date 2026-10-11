import test from "node:test";
import assert from "node:assert/strict";
import {
  NativeSpamQueue,
  SPAM_QUEUE_CAPACITY,
} from "../src/physics/spam-queue.ts";

test("capacity is checked before deduplication, including a stronger repeat of a full queue identity", () => {
  const queue = new NativeSpamQueue();
  const cars = Array.from({ length: SPAM_QUEUE_CAPACITY + 1 }, () => ({}));
  for (let i = 0; i < SPAM_QUEUE_CAPACITY; i++)
    assert.equal(queue.enqueue(cars[i], i + 1), true);
  assert.equal(queue.count, 8);
  assert.equal(queue.enqueue(cars[0], 100), false);
  assert.equal(queue.enqueue(cars[8], 1), false);
  assert.equal(queue.snapshot()[0].strength, 1);
});

test("below capacity keeps only strictly increasing F32 strength without reordering", () => {
  const queue = new NativeSpamQueue();
  const [first, second, third] = [{}, {}, {}];
  assert.equal(queue.enqueue(first, 1), true);
  assert.equal(queue.enqueue(second, 2), true);
  assert.equal(queue.enqueue(third, 3), true);
  assert.equal(queue.enqueue(second, 1.5), false);
  assert.equal(queue.enqueue(second, 2), false);
  assert.equal(queue.enqueue(second, 4), true);
  assert.deepEqual(
    queue.snapshot().map(({ identity, strength }) => [identity, strength]),
    [
      [first, 1],
      [second, 4],
      [third, 3],
    ],
  );
});

test("records contain only car identity and F32 strength, with no event context or tick", () => {
  const queue = new NativeSpamQueue();
  const car = {};
  assert.equal(queue.enqueue(car, 0.1), true);
  const [entry] = queue.snapshot();
  assert.deepEqual(Object.keys(entry), ["identity", "strength"]);
  assert.equal(entry.identity, car);
  assert.equal(entry.strength, Math.fround(0.1));
});

test("cancel stable-compacts survivors and permits re-admission at the end", () => {
  const queue = new NativeSpamQueue();
  const cars = Array.from({ length: 4 }, () => ({}));
  cars.forEach((car, index) =>
    assert.equal(queue.enqueue(car, index + 1), true),
  );
  assert.equal(queue.cancel(cars[1]), true);
  assert.equal(queue.cancel(cars[1]), false);
  assert.equal(queue.enqueue(cars[1], 9), true);
  assert.deepEqual(
    queue.snapshot().map(({ identity }) => identity),
    [cars[0], cars[2], cars[3], cars[1]],
  );
});

test("strength validation rejects negative, nonfinite, and out-of-range values", () => {
  const queue = new NativeSpamQueue();
  const car = {};
  for (const strength of [-1, Number.NaN, Infinity, 3.5e38])
    assert.throws(() => queue.enqueue(car, strength), /strength/);
  assert.equal(queue.count, 0);
});

test("drain returns insertion order and clears; initialize also clears", () => {
  const queue = new NativeSpamQueue();
  const cars = [{}, {}, {}];
  cars.forEach((car, index) => queue.enqueue(car, index + 1));
  assert.deepEqual(
    queue.drain().map(({ identity }) => identity),
    cars,
  );
  assert.equal(queue.count, 0);
  queue.enqueue(cars[0], 4);
  queue.initialize();
  assert.deepEqual(queue.snapshot(), []);
});
