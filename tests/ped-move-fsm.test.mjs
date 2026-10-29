import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  readNativePedMoveFSM,
  planNativePedMove,
} from "../src/ped-move-fsm.ts";

function fixture(duplicates = false, prefixLength = 0) {
  const tableOffset = 0x400 + prefixLength;
  const bytes = new Uint8Array(
      tableOffset + (duplicates ? 2 : 1) * 118 * 7 * 4,
    ),
    view = new DataView(bytes.buffer);
  view.setUint16(0, 0x5a4d, true);
  view.setUint32(0x3c, 0x80, true);
  view.setUint32(0x80, 0x4550, true);
  view.setUint16(0x84, 0x14c, true);
  view.setUint16(0x86, 1, true);
  view.setUint16(0x94, 224, true);
  view.setUint16(0x98, 0x10b, true);
  view.setUint32(0x98 + 28, 0x400000, true);
  const section = 0x98 + 224;
  view.setUint32(section + 12, 0x2000, true);
  view.setUint32(section + 16, bytes.length - 0x400, true);
  view.setUint32(section + 20, 0x400, true);
  view.setUint32(section + 36, 0x40, true);
  const rows = Array.from({ length: 118 }, () => [0, -3, -3, -3, -3, -3, -3]);
  rows[0] = [0, -2, 5, 6, 111, 31, 112];
  rows[1] = [0, 0, 5, 6, 111, 31, 112];
  for (let copy = 0; copy < (duplicates ? 2 : 1); copy++)
    rows
      .flat()
      .forEach((value, i) =>
        view.setInt32(tableOffset + (copy * 118 * 7 + i) * 4, value, true),
      );
  return { bytes, view, section };
}
const request = (extra = {}) => ({
  requestedId: 1,
  previousAction: 0,
  requestedAction: -1,
  walkSpeed: -1,
  pedestrianSpeedFactor: 0,
  removedBoneMask: 0,
  drunk: false,
  dancing: false,
  panicking: false,
  availableMoves: new Set([0, 1, 5, 6, 31, 111, 112]),
  ...extra,
});

test("PE lookup bounds source table and does not assume HW/SW RVA", () => {
  const { bytes } = fixture();
  const parsed = readNativePedMoveFSM(bytes);
  assert.equal(parsed.sourceAddress, 0x402000);
  assert.equal(parsed.sourceOffset, 0x400);
  assert.equal(parsed.rows.length, 118);
  assert.ok(Object.isFrozen(parsed.rows[0]));
  assert.equal(parsed.rows[0][1], -2);
});
test("PE lookup rejects short, out-of-bounds, ambiguous and executable-section tables", () => {
  assert.throws(() => readNativePedMoveFSM(new Uint8Array(12)), /bounds/);
  assert.throws(() => readNativePedMoveFSM(fixture(true).bytes), /found 2/);
  for (const mutate of [
    ({ view }) => view.setUint32(0x3c, 0xffffffff, true),
    ({ view, section }) => view.setUint32(section + 16, 0xffffffff, true),
    ({ view, section }) => view.setUint32(section + 36, 0x20000040, true),
    ({ view }) => view.setInt32(0x400 + 30 * 7 * 4 + 4, 118, true),
    ({ view }) => view.setUint16(0x98, 0x20b, true),
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => readNativePedMoveFSM(input.bytes), /FSM/);
  }
});
test("negative missing-leg substitutions retain only valid cells inside the source section", () => {
  const input = fixture(false, 28);
  input.view.setInt32(0x408, 5, true);
  input.view.setInt32(0x40c, 6, true);
  const table = readNativePedMoveFSM(input.bytes);
  assert.deepEqual(table.negativeLegSubstitutions, {
    values: [5, 6],
    sourceAddress: 0x402008,
    sourceOffset: 0x408,
  });
  for (const [removedBoneMask, expected] of [
    [8, 5],
    [32, 6],
  ]) {
    const result = planNativePedMove(
      table,
      request({ requestedId: -1, removedBoneMask }),
    );
    assert.equal(result.status, "complete");
    assert.equal(result.moveId, expected);
  }
  for (const extra of [{ drunk: true }, { dancing: true }, { panicking: true }])
    assert.equal(
      planNativePedMove(table, request({ requestedId: -1, ...extra })).status,
      "provider-required",
    );
  assert.equal(
    readNativePedMoveFSM(fixture(false, 16).bytes).negativeLegSubstitutions,
    undefined,
  );
  input.view.setInt32(0x408, 118, true);
  assert.equal(
    readNativePedMoveFSM(input.bytes).negativeLegSubstitutions,
    undefined,
  );
  const { negativeLegSubstitutions, ...withoutPrefix } = table;
  assert.equal(
    planNativePedMove(
      withoutPrefix,
      request({ requestedId: -1, removedBoneMask: 8 }),
    ).status,
    "provider-required",
  );
  assert.equal(
    planNativePedMove(
      {
        ...table,
        negativeLegSubstitutions: {
          ...negativeLegSubstitutions,
          sourceOffset: 0,
        },
      },
      request({ requestedId: -1, removedBoneMask: 8 }),
    ).status,
    "provider-required",
  );
});
test("SetPedMove precedence is drunk, dancing, panic, first leg, second leg", () => {
  const table = readNativePedMoveFSM(fixture().bytes);
  for (const [extra, id, column] of [
    [
      { drunk: true, dancing: true, panicking: true, removedBoneMask: 0x28 },
      31,
      5,
    ],
    [{ dancing: true, panicking: true, removedBoneMask: 0x28 }, 111, 4],
    [{ panicking: true, removedBoneMask: 0x28 }, 112, 6],
    [{ removedBoneMask: 0x28 }, 5, 2],
    [{ removedBoneMask: 0x20 }, 6, 3],
    [{}, 1, 0],
  ]) {
    const result = planNativePedMove(table, request(extra));
    assert.equal(result.status, "complete");
    assert.equal(result.moveId, id);
    assert.equal(result.substitutionColumn, column);
  }
});
test("missing authored moves follow source fallback; core/bad/cyclic moves fail explicitly", () => {
  const table = readNativePedMoveFSM(fixture().bytes);
  assert.deepEqual(
    planNativePedMove(table, request({ availableMoves: new Set([0]) }))
      .attempts,
    [1, 0],
  );
  assert.throws(
    () => planNativePedMove(table, request({ availableMoves: new Set() })),
    /core/,
  );
  assert.throws(
    () =>
      planNativePedMove(
        table,
        request({ requestedId: 9, availableMoves: new Set() }),
      ),
    /bad/,
  );
  const rows = table.rows.map((row) => [...row]);
  rows[1][1] = 1;
  assert.throws(
    () =>
      planNativePedMove(
        { ...table, rows },
        request({ availableMoves: new Set() }),
      ),
    /10 attempts/,
  );
});
test("source action/run-speed writes precede fallback and dead action remains sticky ordinarily", () => {
  const table = readNativePedMoveFSM(fixture().bytes);
  assert.equal(
    planNativePedMove(table, request({ previousAction: 6, requestedAction: 0 }))
      .action,
    6,
  );
  const transformed = planNativePedMove(
    table,
    request({ previousAction: 6, requestedAction: 0, drunk: true }),
  );
  assert.equal(
    transformed.action,
    1,
    "native special31 forces running even after ordinary dead guard",
  );
  assert.equal(transformed.clearCachedRunSpeed, false);
  assert.equal(planNativePedMove(table, request()).clearCachedRunSpeed, true);
});
test("native integer speed uses stored Float32 factor; id−1 has no invented substitution", () => {
  const table = readNativePedMoveFSM(fixture().bytes);
  assert.equal(
    planNativePedMove(
      table,
      request({ walkSpeed: 100, pedestrianSpeedFactor: 0.3 }),
    ).speed,
    Math.fround(100 / Math.fround(0.3)),
  );
  assert.equal(
    planNativePedMove(
      table,
      request({ walkSpeed: 100, pedestrianSpeedFactor: 1e-50 }),
    ).speed,
    100,
  );
  const same = planNativePedMove(
    table,
    request({ requestedId: -1, requestedAction: 1, walkSpeed: 0 }),
  );
  assert.equal(same.moveId, -1);
  assert.equal(same.action, 0);
  assert.equal(same.speed, 0);
  assert.equal(
    planNativePedMove(table, request({ requestedId: -1, drunk: true })).status,
    "provider-required",
  );
  assert.throws(
    () => planNativePedMove(table, request({ walkSpeed: 1.5 })),
    /Invalid/,
  );
});
test("installed HW/SW share all FSM values while retaining distinct data addresses", async (t) => {
  let hw, sw;
  try {
    [hw, sw] = await Promise.all(
      ["carma2_HW.exe", "carma2_SW.exe"].map((name) =>
        readFile(new URL(`../carma2_orig/${name}`, import.meta.url)),
      ),
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      t.skip("Original installation unavailable");
      return;
    }
    throw error;
  }
  const hardware = readNativePedMoveFSM(hw),
    software = readNativePedMoveFSM(sw);
  assert.deepEqual(hardware.rows, software.rows);
  assert.equal(hardware.sourceAddress, 0x65c360);
  assert.equal(software.sourceAddress, 0x656ca8);
  for (const table of [hardware, software]) {
    assert.deepEqual(table.negativeLegSubstitutions.values, [0, 0]);
    assert.equal(
      table.negativeLegSubstitutions.sourceAddress,
      table.sourceAddress - 20,
    );
    assert.equal(
      table.negativeLegSubstitutions.sourceOffset,
      table.sourceOffset - 20,
    );
    for (const removedBoneMask of [8, 32, 40]) {
      const result = planNativePedMove(
        table,
        request({ requestedId: -1, removedBoneMask }),
      );
      assert.equal(result.status, "complete");
      assert.equal(result.moveId, 0);
      assert.deepEqual(result.attempts, [0]);
      assert.equal(result.action, 0);
    }
  }
  assert.deepEqual(hardware.rows[41].slice(1), [40, 50, 51, 111, 31, 112]);
  assert.deepEqual(
    planNativePedMove(
      hardware,
      request({ requestedId: 41, availableMoves: new Set([40]) }),
    ).attempts,
    [41, 40],
  );
  assert.equal(
    planNativePedMove(
      hardware,
      request({
        requestedId: 41,
        removedBoneMask: 8,
        availableMoves: new Set([50]),
      }),
    ).moveId,
    50,
  );
  assert.equal(
    planNativePedMove(
      hardware,
      request({ requestedId: 93, availableMoves: new Set([94]) }),
    ).moveId,
    94,
  );
});
