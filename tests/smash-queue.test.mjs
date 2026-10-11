import test from "node:test";
import assert from "node:assert/strict";
import { NativeSmashQueue } from "../src/smash-queue.ts";

function fixture(context = {}, key = {}) {
  const state = { reached: 0, levels: 4, model: true };
  return {
    state,
    request: {
      key,
      context,
      targetTier: 1,
      getReachedTier: () => state.reached,
      getLevelCount: () => state.levels,
      hasModel: () => state.model,
    },
  };
}

test("global capacity precedes duplicate upgrades and model lookup", () => {
  const queue = new NativeSmashQueue();
  const first = fixture();
  assert.equal(queue.enqueue(first.request), "inserted");
  for (let i = 1; i < 20; i++) queue.enqueue(fixture().request);
  assert.equal(queue.count, 20);
  assert.equal(
    queue.enqueue({
      ...first.request,
      targetTier: 3,
      hasModel: () => assert.fail("Capacity must precede model lookup"),
    }),
    "ignored",
  );
  assert.equal(queue.snapshot()[0].targetTier, 1);
  assert.equal(queue.enqueue(fixture().request), "ignored");
});

test("authored object identity and higher tier retain every first-event field", () => {
  const queue = new NativeSmashQueue();
  const first = fixture({ startingVelocity: [6.9, 0, 0], actor: {} });
  queue.enqueue(first.request);
  const before = queue.snapshot();
  const later = fixture({ startingVelocity: [0, 99, 0] }, first.request.key);
  later.request.targetTier = 3;
  assert.equal(queue.enqueue(later.request), "upgraded");
  assert.equal(queue.enqueue({ ...later.request, targetTier: 2 }), "ignored");
  const upgraded = queue.snapshot()[0];
  assert.equal(upgraded.targetTier, 3);
  assert.equal(upgraded.context, first.request.context);
  assert.equal(upgraded.hasModel, first.request.hasModel);
  assert.equal(upgraded.getReachedTier, first.request.getReachedTier);
  assert.equal(upgraded.getLevelCount, first.request.getLevelCount);
  assert.equal(before[0].targetTier, 1);
  assert.ok(Object.isFrozen(before));
  assert.ok(Object.isFrozen(before[0]));
  // Equal contents do not merge distinct authored records.
  assert.equal(queue.enqueue(fixture({}, {}).request), "inserted");
  assert.equal(queue.count, 2);
});

test("enqueue checks live exhaustion/model and ignores uncrossed candidates", () => {
  const queue = new NativeSmashQueue();
  const f = fixture();
  f.state.reached = 3;
  assert.equal(queue.enqueue(f.request), "ignored");
  f.state.reached = 0;
  f.state.model = false;
  assert.equal(queue.enqueue(f.request), "ignored");
  f.state.model = true;
  assert.equal(queue.enqueue({ ...f.request, targetTier: 0 }), "ignored");
  assert.equal(queue.count, 0);
});

test("flush resolves live model/tier/count and samples clocks in native order", () => {
  const queue = new NativeSmashQueue();
  const absent = fixture("absent"),
    exhausted = fixture("exhausted"),
    clamped = fixture("clamped");
  queue.enqueue(absent.request);
  queue.enqueue(exhausted.request);
  queue.enqueue({ ...clamped.request, targetTier: 3 });
  absent.state.model = false;
  exhausted.state.reached = 3;
  clamped.state.levels = 3;
  clamped.state.reached = 1;
  let time = 100;
  const seen = [];
  assert.equal(
    queue.flush(
      () => time++,
      (entry, now) => seen.push([entry, now]),
    ),
    1,
  );
  assert.equal(time, 102); // Exhaustion is tested after its clock sample.
  assert.equal(seen[0][0].context, "clamped");
  assert.equal(seen[0][0].targetTier, 2);
  assert.equal(seen[0][0].reachedTier, 1);
  assert.equal(seen[0][0].levelCount, 3);
  assert.equal(seen[0][1], 101);
  assert.equal(queue.count, 0);
});

test("flush dynamically visits appended records and preserves pending dedup", () => {
  const queue = new NativeSmashQueue();
  const a = fixture("A"),
    b = fixture("B"),
    c = fixture("C");
  queue.enqueue(a.request);
  queue.enqueue(b.request);
  const visits = [];
  queue.flush(
    () => 7,
    (entry) => {
      visits.push([entry.context, entry.targetTier]);
      if (entry.context === "A") {
        assert.equal(queue.count, 2);
        assert.equal(queue.enqueue(c.request), "inserted");
        assert.equal(
          queue.enqueue({
            ...b.request,
            context: "replacement",
            targetTier: 3,
          }),
          "upgraded",
        );
        assert.equal(queue.enqueue(a.request), "ignored");
      }
    },
  );
  assert.deepEqual(visits, [
    ["A", 1],
    ["B", 3],
    ["C", 1],
  ]);
  assert.equal(queue.count, 0);
});

test("consumer applies final texture before final-payload repeated tier effects", () => {
  const queue = new NativeSmashQueue();
  const f = fixture({
    flags: [0, 0, 1, 0],
    payloads: ["zero", "one", "two", "three"],
  });
  queue.enqueue({ ...f.request, targetTier: 3 });
  const order = [];
  queue.flush(
    () => 50,
    (entry, now) => {
      order.push(["texture", entry.targetTier, now]);
      f.state.reached = entry.targetTier;
      for (let tier = entry.reachedTier + 1; tier <= entry.targetTier; tier++) {
        if (
          entry.context.flags[tier] & 1 &&
          entry.targetTier - entry.reachedTier !== 1
        )
          continue;
        order.push(["effect", entry.context.payloads[entry.targetTier], now]);
      }
      assert.equal(queue.count, 1); // Reset follows the entire consume callback.
    },
  );
  assert.deepEqual(order, [
    ["texture", 3, 50],
    ["effect", "three", 50],
    ["effect", "three", 50],
  ]);
  assert.equal(f.state.reached, 3);
});

test("initialize discards pending count and successful empty flush remains reusable", () => {
  const queue = new NativeSmashQueue();
  queue.enqueue(fixture("discarded").request);
  queue.initialize();
  assert.deepEqual(queue.snapshot(), []);
  assert.equal(
    queue.flush(
      () => assert.fail("No clock for empty queue"),
      () => assert.fail(),
    ),
    0,
  );
  queue.enqueue(fixture("new").request);
  const seen = [];
  queue.flush(
    () => 0xffffffff,
    (entry) => seen.push(entry.context),
  );
  assert.deepEqual(seen, ["new"]);
});

test("reentrancy and invalid data fail clearly without corrupting pending records", () => {
  const queue = new NativeSmashQueue();
  const f = fixture();
  assert.throws(() => queue.enqueue({ ...f.request, key: "name" }), /Invalid/);
  assert.throws(
    () => queue.enqueue({ ...f.request, targetTier: 4 }),
    /outside/,
  );
  queue.enqueue(f.request);
  assert.throws(
    () =>
      queue.flush(
        () => -1,
        () => {},
      ),
    /clock/,
  );
  assert.equal(queue.count, 1);
  queue.flush(
    () => 0,
    () => {
      assert.throws(
        () =>
          queue.flush(
            () => 0,
            () => {},
          ),
        /recursively/,
      );
      assert.throws(() => queue.initialize(), /during flush/);
    },
  );
  queue.enqueue(f.request);
  assert.throws(
    () =>
      queue.flush(
        () => 0,
        () => {
          throw new Error("consumer failed");
        },
      ),
    /consumer failed/,
  );
  assert.equal(queue.count, 1);
  f.state.levels = 1.5;
  assert.throws(
    () =>
      queue.flush(
        () => 0,
        () => {},
      ),
    /tier state/,
  );
  queue.initialize();
  assert.equal(queue.count, 0);
});
