import test from "node:test";
import assert from "node:assert/strict";
import { NativePedStoredPoses } from "../src/ped-stored-poses.ts";

function instance(count = 4, seed = 10) {
  return {
    bones: Array.from({ length: count }, (_, index) => ({
      pose: Float32Array.from(
        { length: 12 },
        (_v, element) => index * 100 + element + seed,
      ),
    })),
  };
}
function character(owner, overrides = {}) {
  return {
    owner,
    formKey: "form",
    removedBoneMask: (1 << 1) | (1 << 2),
    vanishedBoneMask: 0,
    ...overrides,
  };
}

test("shared FORM records use first-free bounded slots and restore removed poses without aliases", () => {
  const pool = new NativePedStoredPoses(),
    firstOwner = {},
    secondOwner = {},
    fullOwner = {};
  pool.registerForm("form", {
    bones: Array(4).fill(null),
    maxStoredDismembered: 2,
  });
  pool.registerForm("form", {
    bones: Array(4).fill(null),
    maxStoredDismembered: 2,
  });
  const first = instance(),
    second = instance(4, 1000),
    firstExpected1 = [...first.bones[1].pose],
    firstExpected2 = [...first.bones[2].pose],
    secondExpected1 = [...second.bones[1].pose],
    firstCharacter = character(firstOwner),
    secondCharacter = character(secondOwner),
    fullCharacter = character(fullOwner, { vanishedBoneMask: 1 << 3 });
  pool.store(firstCharacter, first);
  pool.store(secondCharacter, second);
  assert.deepEqual(pool.stats, {
    forms: 1,
    occupied: 2,
    capacity: 2,
    bytes: 4 * 2 * 12 * 4,
  });

  first.bones[0].pose.fill(-1);
  first.bones[1].pose.fill(-2);
  first.bones[2].pose.fill(-3);
  pool.restore(firstCharacter, first);
  assert.deepEqual([...first.bones[1].pose], firstExpected1);
  assert.deepEqual([...first.bones[2].pose], firstExpected2);
  assert.deepEqual([...first.bones[0].pose], Array(12).fill(-1));
  assert.equal(pool.stats.occupied, 1);

  const third = instance(4, 2000),
    thirdCharacter = character({});
  pool.store(thirdCharacter, third);
  assert.equal(pool.stats.occupied, 2, "released first slot is reused");
  pool.store(fullCharacter, instance(4, 3000));
  assert.equal(fullCharacter.vanishedBoneMask, 1 << 3);
  assert.equal(pool.stats.occupied, 2);
  pool.restore(secondCharacter, second);
  assert.deepEqual([...second.bones[1].pose], secondExpected1);
  assert.equal(pool.stats.occupied, 1);
});

test("zero-capacity and missing-owner restore mark removed bones vanished", () => {
  const pool = new NativePedStoredPoses();
  pool.registerForm("form", {
    bones: Array(4).fill(null),
    maxStoredDismembered: 0,
  });
  const noSlot = character({});
  pool.store(noSlot, instance());
  assert.equal(noSlot.vanishedBoneMask, 0);
  assert.equal(pool.stats.capacity, 0);
  assert.equal(pool.stats.occupied, 0);

  const noRecordRestore = character({}, { vanishedBoneMask: 1 << 3 });
  pool.restore(noRecordRestore, instance());
  assert.equal(
    noRecordRestore.vanishedBoneMask,
    noRecordRestore.removedBoneMask,
  );
});

test("valid restore preserves prior vanished bits and frees the bounded record", () => {
  const pool = new NativePedStoredPoses(),
    owner = {},
    state = character(owner, { vanishedBoneMask: 1 << 3 }),
    body = instance(),
    expected = [...body.bones[1].pose];
  pool.registerForm("form", {
    bones: Array(4).fill(null),
    maxStoredDismembered: 1,
  });
  pool.store(state, body);
  body.bones[1].pose.fill(0);
  pool.restore(state, body);
  assert.deepEqual([...body.bones[1].pose], expected);
  assert.equal(state.vanishedBoneMask, 1 << 3);
  assert.equal(pool.stats.occupied, 0);
});

test("clear releases every owner and zeroes storage while retaining FORM capacity", () => {
  const pool = new NativePedStoredPoses(),
    state = character({}),
    body = instance();
  pool.registerForm("form", {
    bones: Array(4).fill(null),
    maxStoredDismembered: 2,
  });
  pool.store(state, body);
  assert.equal(pool.stats.occupied, 1);
  pool.clear();
  assert.deepEqual(pool.stats, {
    forms: 1,
    occupied: 0,
    capacity: 2,
    bytes: 4 * 2 * 12 * 4,
  });
  const replacement = character({});
  pool.store(replacement, instance(4, 500));
  assert.equal(pool.stats.occupied, 1);
});

test("zero removed mask is a no-op and bit31 remains an unsigned mask value", () => {
  const pool = new NativePedStoredPoses();
  pool.registerForm("empty", {
    bones: Array(4).fill(null),
    maxStoredDismembered: 1,
  });
  const empty = character({}, { formKey: "empty", removedBoneMask: 0 });
  pool.store(empty, instance());
  assert.equal(pool.stats.occupied, 0);

  pool.registerForm("wide", {
    bones: Array(32).fill(null),
    maxStoredDismembered: 1,
  });
  const wide = character(
    {},
    {
      formKey: "wide",
      removedBoneMask: 0x80000000,
    },
  );
  pool.restore(wide, instance(32));
  assert.equal(wide.vanishedBoneMask, 0x80000000);
});

test("invalid masks and nonfinite source poses reject before changing pool or character", () => {
  const pool = new NativePedStoredPoses(),
    owner = {},
    state = character(owner, { vanishedBoneMask: 1 << 3 }),
    body = instance();
  pool.registerForm("form", {
    bones: Array(4).fill(null),
    maxStoredDismembered: 1,
  });
  body.bones[2].pose[7] = Number.NaN;
  assert.throws(
    () => pool.store(state, body),
    /Invalid native stored-pose matrix/,
  );
  assert.equal(state.vanishedBoneMask, 1 << 3);
  assert.equal(pool.stats.occupied, 0);
  const tooLong = instance();
  tooLong.bones[1].pose = new Float32Array(13);
  assert.throws(() => pool.store(state, tooLong), /stored-pose matrix/);
  assert.equal(pool.stats.occupied, 0);
  assert.throws(
    () => pool.store(character({}, { removedBoneMask: 1 << 8 }), instance()),
    /mask exceeds FORM/,
  );
  assert.equal(pool.stats.occupied, 0);
  assert.throws(() => pool.store(state, instance(3)), /instance FORM mismatch/);
  assert.equal(pool.stats.occupied, 0);
});

test("a second store for an owner with an outstanding record is rejected", () => {
  const pool = new NativePedStoredPoses(),
    state = character({});
  pool.registerForm("form", {
    bones: Array(4).fill(null),
    maxStoredDismembered: 1,
  });
  pool.store(state, instance());
  assert.throws(() => pool.store(state, instance(4, 90)), /already owns/);
  assert.equal(pool.stats.occupied, 1);
});
