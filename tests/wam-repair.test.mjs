import test from "node:test";
import assert from "node:assert/strict";
import { NativeWamRepairQueue } from "../src/wam-repair.ts";

function subject(initialTier) {
  let tier = initialTier;
  const changes = [];
  return {
    read: () => tier,
    apply: (next) => {
      tier = next;
      changes.push(next);
    },
    get tier() {
      return tier;
    },
    changes,
  };
}

test("repair decrements immediately and animates exactly at 150 ms", () => {
  const queue = new NativeWamRepairQueue();
  const key = {},
    owner = {},
    damage = subject(3);
  assert.equal(queue.start(key, owner, 1000, damage.read, damage.apply), true);
  assert.deepEqual(damage.changes, [2]);
  assert.equal(queue.update(1149), 0);
  assert.equal(damage.tier, 2);
  assert.equal(queue.update(1150), 1);
  assert.equal(damage.tier, 1);
  assert.equal(queue.size, 1);
  assert.equal(queue.update(1300), 1);
  assert.equal(damage.tier, 0);
  assert.equal(queue.size, 0);
});

test("starting an existing key refreshes owner and its last-step time", () => {
  const queue = new NativeWamRepairQueue();
  const key = {},
    firstOwner = {},
    secondOwner = {};
  const first = subject(4),
    second = subject(3);
  queue.start(key, firstOwner, 100, first.read, first.apply);
  queue.start(key, secondOwner, 500, second.read, second.apply);
  assert.equal(queue.size, 1);
  assert.deepEqual(queue.snapshot()[0], {
    key,
    owner: secondOwner,
    lastStepMs: 500,
  });
  assert.equal(queue.update(649), 0);
  assert.equal(second.tier, 2);
  assert.equal(queue.update(650), 1);
  assert.equal(second.tier, 1);
});

test("25-entry capacity preserves immediate repair when full", () => {
  const queue = new NativeWamRepairQueue();
  const records = Array.from({ length: 26 }, () => subject(2));
  for (let index = 0; index < 25; index++)
    assert.equal(
      queue.start({}, {}, 0, records[index].read, records[index].apply),
      true,
    );
  assert.equal(
    queue.start({}, {}, 0, records[25].read, records[25].apply),
    false,
  );
  assert.equal(records[25].tier, 1);
  assert.equal(queue.size, 25);
});

test("damage cancels its queued repair, while full repair waits for due clear", () => {
  const queue = new NativeWamRepairQueue();
  const damageHit = subject(3),
    fullRepair = subject(3);
  const hitKey = {},
    fullKey = {};
  queue.start(hitKey, {}, 0, damageHit.read, damageHit.apply);
  queue.start(fullKey, {}, 0, fullRepair.read, fullRepair.apply);
  assert.equal(queue.cancel(hitKey), true);
  damageHit.apply(4); // subsequent damage tier commit
  fullRepair.apply(0); // full repair intentionally leaves its queue record
  assert.equal(queue.size, 1);
  assert.equal(queue.update(150), 0);
  assert.equal(queue.size, 0);
  assert.equal(damageHit.tier, 4);
  assert.equal(fullRepair.tier, 0);
});

test("clock subtraction and timestamp advancement wrap as unsigned 32-bit", () => {
  const queue = new NativeWamRepairQueue();
  const damage = subject(3);
  const key = {};
  queue.start(key, {}, 0xffff_ffc0, damage.read, damage.apply);
  assert.equal(queue.update(0x0000_0055), 0); // 149 ms elapsed
  assert.equal(queue.update(0x0000_0056), 1); // 150 ms elapsed
  assert.equal(damage.tier, 1);
  assert.equal(queue.snapshot()[0].lastStepMs, 0x0000_0056);
});

test("last-step timestamp remains unsigned above the signed 32-bit boundary", () => {
  const queue = new NativeWamRepairQueue();
  const damage = subject(3);
  const start = 0x7fff_ff80;
  queue.start({}, {}, start, damage.read, damage.apply);
  assert.equal(queue.update(start + 149), 0);
  assert.equal(queue.update(start + 150), 1);
  assert.equal(queue.snapshot()[0].lastStepMs, 0x8000_0016);
});

test("long frame gaps step once and occupied slots update in ascending order", () => {
  const queue = new NativeWamRepairQueue();
  const order = [];
  const records = [0, 1, 2].map((id) => {
    const value = subject(4);
    const apply = (tier) => {
      order.push(id);
      value.apply(tier);
    };
    return { value, apply };
  });
  const keys = records.map(() => ({}));
  for (let index = 0; index < records.length; index++)
    queue.start(
      keys[index],
      {},
      1000,
      records[index].value.read,
      records[index].apply,
    );
  order.length = 0;
  assert.equal(queue.update(10_000), 3);
  assert.deepEqual(order, [0, 1, 2]);
  assert.deepEqual(
    records.map(({ value }) => value.tier),
    [2, 2, 2],
  );
  assert.deepEqual(
    queue
      .snapshot()
      .filter(Boolean)
      .map((record) => record.lastStepMs),
    [1150, 1150, 1150],
  );
});
