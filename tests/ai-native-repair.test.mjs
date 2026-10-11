import test from "node:test";
import assert from "node:assert/strict";
import {
  NativeOpponentRepairState,
  readNativeOpponentRepairLimits,
} from "../src/ai/repair.ts";

const query = (nowMs, overrides = {}) => ({
  nowMs,
  lastContactMs: 0,
  cheating: true,
  police: false,
  objective: "complete-race",
  knackered: false,
  ...overrides,
});

test("GENERAL's repeated seconds label retains the installed integer values", () => {
  assert.deepEqual(
    readNativeOpponentRepairLimits(
      "120 // Min time in secs after last contact with play before opponent considers repairing\r\n240 // Min time in secs after last contact with play before opponent considers repairing\r\n",
    ),
    [120, 240],
  );
  assert.throws(() =>
    readNativeOpponentRepairLimits("120 // Missing authored label"),
  );
});

test("repair gates preserve timers and RNG; periodic checks are strict", () => {
  let draws = 0,
    repairs = 0;
  const state = new NativeOpponentRepairState(0, 1, 1, () => {
    draws++;
    return 0;
  });
  assert.equal(draws, 1);
  for (const overrides of [
    { cheating: false },
    { police: true },
    { knackered: true },
    { objective: "freewheel" },
    { objective: "levitate" },
  ])
    assert.equal(
      state.run(query(60001, overrides), () => repairs++),
      false,
    );
  assert.equal(draws, 1);
  assert.equal(
    state.run(query(60000), () => repairs++),
    false,
  );
  assert.equal(state.snapshot.nextCheckMs, 63000);
  assert.equal(
    state.run(query(63000), () => repairs++),
    false,
  );
  assert.equal(
    state.run(query(63001), () => repairs++),
    true,
  );
  assert.equal(repairs, 1);
  assert.equal(draws, 4);
  assert.equal(state.snapshot.lastRepairMs, 63001);
});

test("repair eligibility uses contact time plus interval and callback precedes interval reroll", () => {
  const events = [];
  const state = new NativeOpponentRepairState(10, 0, 2, () => {
    events.push("draw");
    return 0.999999;
  });
  assert.equal(state.snapshot.repairIntervalMs, 120000);
  assert.equal(
    state.run(query(120001, { lastContactMs: 1 }), () => events.push("repair")),
    false,
  );
  assert.equal(
    state.run(query(125002, { lastContactMs: 1 }), () => events.push("repair")),
    true,
  );
  assert.deepEqual(events, ["draw", "draw", "draw", "repair", "draw"]);
  assert.equal(state.snapshot.nextCheckMs, 130002);
});

test("zero authored interval still repairs a valid undamaged car after contact equality", () => {
  const state = new NativeOpponentRepairState(0, 0, 0, () => 0);
  let repaired = false;
  assert.equal(
    state.run(query(1), () => {
      repaired = true;
    }),
    true,
  );
  assert.equal(repaired, true);
});
