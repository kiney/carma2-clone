import test from "node:test";
import assert from "node:assert/strict";
import { NativeDelayedSideEffects } from "../src/smash-delayed.ts";

const job = (id, kind = "smash", due = 0) => ({ kind, context: { id, due } });

test("native delayed noncar groups and followup smashes share twenty physical slots", () => {
  const pool = new NativeDelayedSideEffects();
  for (let i = 0; i < 20; i++)
    assert.equal(pool.enqueue(job(i, i % 2 ? "smash" : "noncar", 100)), true);
  assert.equal(pool.count, 20);
  assert.equal(pool.enqueue(job(21)), false);
  assert.equal(pool.find((entry) => entry.context.id === 3).kind, "smash");
  const visited = [];
  assert.equal(
    pool.update(99, (entry, now) => {
      visited.push(entry.context.id);
      return now >= entry.context.due;
    }),
    0,
  );
  assert.deepEqual(
    visited,
    Array.from({ length: 20 }, (_, i) => i),
  );
  assert.equal(
    pool.update(100, (entry, now) => now >= entry.context.due),
    20,
  );
  assert.equal(pool.count, 0);
  assert.equal(pool.enqueue(job(21)), true);
});

test("native delayed scan retains the executing slot and visits inserted later slots", () => {
  const pool = new NativeDelayedSideEffects();
  pool.enqueue(job("parent"));
  const visited = [];
  pool.update(200, (entry) => {
    visited.push(entry.context.id);
    if (entry.context.id === "parent") {
      assert.equal(pool.count, 1);
      assert.equal(
        pool.find((item) => item.context.id === "parent"),
        entry,
      );
      pool.enqueue(job("child"));
      assert.equal(pool.count, 2);
    }
    return true;
  });
  assert.deepEqual(visited, ["parent", "child"]);
  assert.equal(pool.count, 0);
});

test("native delayed first-free reuse before current scan position waits until next pass", () => {
  const pool = new NativeDelayedSideEffects();
  pool.enqueue(job("first"));
  pool.enqueue(job("second"));
  const visited = [];
  pool.update(100, (entry) => {
    visited.push(entry.context.id);
    if (entry.context.id === "second") pool.enqueue(job("child"));
    return true;
  });
  assert.deepEqual(visited, ["first", "second"]);
  assert.equal(pool.count, 1);
  pool.update(101, (entry) => {
    visited.push(entry.context.id);
    return true;
  });
  assert.deepEqual(visited, ["first", "second", "child"]);
});

test("native delayed slots remain occupied during callbacks at full capacity", () => {
  const pool = new NativeDelayedSideEffects();
  for (let i = 0; i < 20; i++) pool.enqueue(job(i));
  let accepted;
  pool.update(0, (entry) => {
    if (entry.context.id === 0) accepted = pool.enqueue(job("child"));
    return false;
  });
  assert.equal(accepted, false);
  assert.equal(pool.count, 20);
  pool.initialize();
  assert.equal(pool.count, 0);
});

test("delayed clock uses unsigned deadlines and permits wrap/regression without synthetic rebasing", () => {
  const pool = new NativeDelayedSideEffects();
  pool.enqueue(job("wrapped", "smash", 20));
  assert.equal(
    pool.update(10, (entry, now) => now >= entry.context.due),
    0,
  );
  assert.equal(
    pool.update(0, (entry, now) => now >= entry.context.due),
    0,
  );
  assert.equal(
    pool.update(20, (entry, now) => now >= entry.context.due),
    1,
  );
  for (const now of [-1, 0.5, 0x100000000, NaN])
    assert.throws(() => pool.update(now, () => true), /clock/);
});

test("browser exception guards retain pending delayed work and prohibit recursive mutation", () => {
  const pool = new NativeDelayedSideEffects();
  pool.enqueue(job(1));
  assert.throws(
    () =>
      pool.update(0, () => {
        throw new Error("consumer failed");
      }),
    /consumer failed/,
  );
  assert.equal(pool.count, 1);
  assert.throws(
    () => pool.update(0, () => pool.update(0, () => true)),
    /recursively/,
  );
  assert.throws(() => pool.update(0, () => pool.initialize()), /during update/);
  assert.equal(
    pool.update(0, () => true),
    1,
  );
});
