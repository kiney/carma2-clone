import test from "node:test";
import assert from "node:assert/strict";
import {
  NativeNonCarSlots,
  NATIVE_NONCAR_EXTRA_CAPACITY,
} from "../src/physics/noncar-slots.ts";

const owner = (name) => ({ name, actor: { retained: true }, driver: 4 });
const dedicated = (mechanicsIndex) => ({ kind: "dedicated", mechanicsIndex });
const extra = (index) => ({ kind: "extra", index });

test("each mechanics type has its own dedicated slot before the forty global extras", () => {
  const slots = new NativeNonCarSlots();
  for (const index of [0, 7, 50, 99]) {
    const body = owner(`type${index}`);
    assert.deepEqual(slots.claim(body, index), dedicated(index));
    assert.equal(slots.ownerOf(dedicated(index)), body);
  }
  assert.equal(NATIVE_NONCAR_EXTRA_CAPACITY, 40);
  assert.equal(slots.count, 4);
  assert.equal(slots.dedicatedCount, 4);
  assert.equal(slots.extraCount, 0);
  assert.equal(slots.freeExtraCount, 40);
});

test("a full type uses all forty extras then fails without evicting any owner", () => {
  const slots = new NativeNonCarSlots();
  const initial = owner("dedicated");
  assert.deepEqual(slots.claim(initial, 7), dedicated(7));
  const extras = Array.from({ length: 40 }, (_, index) =>
    owner(`extra${index}`),
  );
  for (const [index, body] of extras.entries())
    assert.deepEqual(slots.claim(body, 7), extra(index));
  const rejected = owner("rejected");
  assert.equal(slots.claim(rejected, 7), null);
  assert.equal(slots.get(rejected), null);
  assert.equal(slots.count, 41);
  assert.equal(slots.freeExtraCount, 0);
  assert.equal(slots.ownerOf(dedicated(7)), initial);
  extras.forEach((body, index) =>
    assert.equal(slots.ownerOf(extra(index)), body),
  );
  // Another type still has its own unused dedicated owner at global saturation.
  assert.deepEqual(
    slots.claim(owner("different dedicated"), 50),
    dedicated(50),
  );
  assert.equal(slots.claim(owner("different overflow"), 50), null);
});

test("different mechanics types compete for one shared first-free extra pool", () => {
  const slots = new NativeNonCarSlots();
  slots.claim(owner("type7"), 7);
  slots.claim(owner("type50"), 50);
  const extras = [];
  for (let index = 0; index < 40; index++) {
    const body = owner(`shared${index}`);
    extras.push(body);
    assert.deepEqual(slots.claim(body, index % 2 ? 7 : 50), extra(index));
  }
  assert.equal(slots.claim(owner("type7 full"), 7), null);
  assert.equal(slots.claim(owner("type50 full"), 50), null);
  assert.deepEqual(slots.release(extras[31]), extra(31));
  assert.deepEqual(slots.release(extras[3]), extra(3));
  assert.deepEqual(slots.claim(owner("reuse type50"), 50), extra(3));
  assert.deepEqual(slots.claim(owner("reuse type7"), 7), extra(31));
  assert.equal(slots.extraCount, 40);
  assert.equal(slots.dedicatedCount, 2);
});

test("repeated owner claims are idempotent and conflicting preassignments preserve occupancy", () => {
  const slots = new NativeNonCarSlots(),
    body = owner("same ACT");
  const assigned = slots.claim(body, 7);
  assert.equal(slots.claim(body, 7), assigned);
  assert.equal(
    slots.claim(body, 99),
    assigned,
    "ordinary repeat does not allocate another owner",
  );
  assert.equal(slots.claim(body, 7, dedicated(7)), assigned);
  assert.equal(slots.claim(body, 7, extra(0)), null);
  assert.equal(slots.get(body), assigned);
  assert.equal(slots.count, 1);
  assert.equal(slots.isOccupied(extra(0)), false);
});

test("preassigned debris claims reserve only their requested dedicated or extra slot", () => {
  const slots = new NativeNonCarSlots();
  const reserved = owner("preassigned extra");
  assert.deepEqual(slots.claim(reserved, 7, extra(5)), extra(5));
  assert.equal(slots.isOccupied(dedicated(7)), false);
  assert.deepEqual(slots.claim(owner("ordinary dedicated"), 7), dedicated(7));
  assert.deepEqual(slots.claim(owner("ordinary overflow"), 7), extra(0));
  const rejected = owner("preassigned collision");
  assert.equal(slots.claim(rejected, 50, extra(5)), null);
  assert.equal(
    slots.isOccupied(dedicated(50)),
    false,
    "explicit collision does not fallback",
  );
  assert.equal(slots.ownerOf(extra(5)), reserved);
  assert.deepEqual(
    slots.claim(owner("type50 explicit"), 50, dedicated(50)),
    dedicated(50),
  );
  assert.equal(slots.claim(owner("type50 collision"), 50, dedicated(50)), null);
  assert.equal(slots.count, 4);
});

test("release enables dedicated/extra reuse without changing retained ACTs or counts", () => {
  const slots = new NativeNonCarSlots();
  const first = owner("retained first"),
    second = owner("retained second");
  const retainedActors = [first.actor, second.actor];
  const before = structuredClone([first, second]);
  slots.claim(first, 7);
  slots.claim(second, 7);
  assert.deepEqual(slots.release(first), dedicated(7));
  assert.equal(slots.release(first), null);
  assert.equal(slots.get(first), null);
  assert.equal(slots.ownerOf(dedicated(7)), null);
  assert.deepEqual(slots.claim(owner("new dedicated"), 7), dedicated(7));
  assert.deepEqual(slots.release(second), extra(0));
  assert.deepEqual(
    slots.claim(first, 7),
    extra(0),
    "retained ACT may repull into a different available physical owner",
  );
  assert.deepEqual([first, second], before);
  assert.deepEqual(retainedActors, [first.actor, second.actor]);
  assert.equal(retainedActors.length, 2);
});

test("slot descriptors are captured and immutable; disposal only clears occupancy", () => {
  const slots = new NativeNonCarSlots(),
    body = owner("ACT");
  const requested = extra(35);
  const assigned = slots.claim(body, 7, requested);
  assert.notEqual(assigned, requested);
  assert.ok(Object.isFrozen(assigned));
  requested.index = 20;
  assert.equal(slots.isOccupied(extra(35)), true);
  assert.equal(slots.isOccupied(extra(20)), false);
  assert.throws(() => {
    assigned.index = 20;
  }, TypeError);
  slots.clear();
  assert.equal(slots.count, 0);
  assert.equal(slots.dedicatedCount, 0);
  assert.equal(slots.extraCount, 0);
  assert.equal(slots.freeExtraCount, 40);
  assert.equal(slots.get(body), null);
  assert.equal(body.actor.retained, true);
  assert.equal(body.driver, 4, "driver writes remain host-owned");
  assert.deepEqual(slots.claim(body, 7), dedicated(7));
});

test("invalid mechanics and preassigned descriptors fail without changing ownership", () => {
  const slots = new NativeNonCarSlots(),
    held = owner("held");
  slots.claim(held, 7);
  for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(
      () => slots.claim(owner("invalid"), invalid),
      /mechanics index/,
    );
  for (const invalid of [-1, 40, 0.5, NaN, Infinity]) {
    assert.throws(
      () => slots.claim(owner("invalid"), 7, extra(invalid)),
      /extra slot index/,
    );
    assert.throws(() => slots.isOccupied(extra(invalid)), /extra slot index/);
  }
  assert.throws(
    () => slots.claim(owner("mismatched"), 7, dedicated(50)),
    /mismatch/,
  );
  assert.throws(
    () => slots.claim(owner("invalid"), 7, { kind: "missing" }),
    /slot kind/,
  );
  assert.throws(() => slots.claim(null, 7), /owner must be an object/);
  assert.equal(slots.count, 1);
  assert.equal(slots.ownerOf(dedicated(7)), held);
  assert.equal(slots.freeExtraCount, 40);
});
