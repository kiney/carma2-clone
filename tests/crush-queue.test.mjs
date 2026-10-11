import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { NativeCarCrushQueue } from "../src/physics/crush-queue.ts";

const vector = (x, y = 0, z = 0) => new Vector3(x, y, z);
const enqueue = (queue, identity, force, context = {}) =>
  queue.enqueue(identity, [vector(0)], vector(force), 1, context);

test("QueueCarCrush rejects the inclusive minimum and stores capped F32 force and normalized direction", () => {
  const queue = new NativeCarCrushQueue();
  const car = {};
  assert.equal(enqueue(queue, car, 0.06), false);
  assert.equal(enqueue(queue, car, 0.06001), true);
  assert.equal(enqueue(queue, car, 20), true);
  const [slight, capped] = queue.drain();
  assert.equal(slight.event.force, Math.fround(Math.fround(0.06001)));
  assert.equal(capped.event.force, 10);
  assert.deepEqual(capped.event.direction.toArray(), [1, 0, 0]);
  assert.equal(queue.count, 0);
});

test("contacts compare Float32 coordinates against the native double epsilon", () => {
  const queue = new NativeCarCrushQueue();
  const car = {};
  const contacts = [
    vector(0, 0, 0),
    vector(0.0049, 0, 0),
    vector(0.005, 0, 0),
    vector(0, 1, 0),
    vector(100, 100, 100),
  ];
  assert.equal(queue.enqueue(car, contacts, vector(1), 1, "payload"), true);
  const [record] = queue.drain();
  assert.equal(record.event.contacts.length, 2);
  assert.deepEqual(
    record.event.contacts.map((point) => point.toArray()),
    [
      [0, 0, 0],
      [0, 1, 0],
    ],
  );
  assert.deepEqual(record.event.meanContact.toArray(), [0, 0.5, 0]);
});

test("native admission retains register precision and mean stores round after each addition", () => {
  const queue = new NativeCarCrushQueue();
  const car = {};
  assert.equal(
    queue.enqueue(car, [vector(0)], vector(0.06, 1e-6), 1, "threshold"),
    true,
  );
  assert.equal(queue.snapshot()[0].event.force, Math.fround(0.06));
  queue.initialize();
  assert.equal(
    queue.enqueue(
      car,
      [vector(1), vector(2 ** -25), vector(-1), vector(0.25)],
      vector(1),
      1,
      "mean",
    ),
    true,
  );
  assert.equal(queue.snapshot()[0].event.meanContact.x, 0.0625);
  queue.initialize();
  queue.enqueue(
    car,
    [vector(0), vector(0.005000000353902578)],
    vector(1),
    1,
    "epsilon",
  );
  assert.equal(queue.snapshot()[0].event.contacts.length, 2);
});

test("a full per-car bucket replaces only a strictly stronger event in the first weakest slot", () => {
  const queue = new NativeCarCrushQueue();
  const car = {};
  [2, 1, 1, 3].forEach((force) =>
    assert.equal(enqueue(queue, car, force), true),
  );
  assert.equal(enqueue(queue, car, 1, "tie"), false);
  assert.equal(enqueue(queue, car, 1.1, "stronger"), true);
  const records = queue.drain();
  assert.deepEqual(
    records.map(({ event }) => event.force),
    [2, Math.fround(1.1), 1, 3],
  );
  assert.equal(records[1].event.context, "stronger");
});

test("eight car identities are retained, existing cars can append, and a ninth is rejected", () => {
  const queue = new NativeCarCrushQueue();
  const cars = Array.from({ length: 9 }, () => ({}));
  for (let i = 0; i < 8; i++)
    assert.equal(enqueue(queue, cars[i], i + 1), true);
  assert.equal(enqueue(queue, cars[8], 20), false);
  assert.equal(enqueue(queue, cars[0], 9), true);
  const records = queue.drain();
  assert.equal(records.length, 9);
  assert.equal(records[0].identity, cars[0]);
  assert.equal(records[1].identity, cars[0]);
  assert.equal(records[1].event.force, 9);
});

test("queued native vectors are copied, context is retained by reference, and events do not aggregate", () => {
  const queue = new NativeCarCrushQueue();
  const car = {};
  const contact = vector(1, 2, 3);
  const force = vector(0, 2, 0);
  const context = { live: true };
  queue.enqueue(car, [contact], force, 1, context);
  contact.set(50, 50, 50);
  force.set(100, 0, 0);
  queue.enqueue(car, [vector(3, 2, 1)], vector(0, 2, 0), 1, context);
  const records = queue.snapshot();
  assert.equal(records.length, 2);
  assert.deepEqual(records[0].event.contacts[0].toArray(), [1, 2, 3]);
  assert.deepEqual(records[0].event.direction.toArray(), [0, 1, 0]);
  assert.deepEqual(records[0].event.meanContact.toArray(), [1, 2, 3]);
  assert.equal(records[0].event.context, context);
  assert.equal(records[0].event.force, 2);
  assert.equal(records[1].event.force, 2);
  records[0].event.contacts[0].set(0, 0, 0);
  assert.deepEqual(queue.snapshot()[0].event.contacts[0].toArray(), [1, 2, 3]);
});

test("initialize clears all car buckets and validates malformed input", () => {
  const queue = new NativeCarCrushQueue();
  const car = {};
  assert.throws(
    () => queue.enqueue(car, [vector(0)], vector(1), Number.NaN, {}),
    /softness/,
  );
  assert.throws(
    () => queue.enqueue(car, [vector(0)], vector(1), 1, {}, -1),
    /minimum force/,
  );
  enqueue(queue, car, 1);
  queue.initialize();
  assert.equal(queue.count, 0);
  assert.deepEqual(queue.drain(), []);
});
