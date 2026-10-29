import test from "node:test";
import assert from "node:assert/strict";
import {
  NativePedRecordArray,
  NATIVE_PED_RECORD_BYTES,
  NATIVE_PED_RECORD_CLASS,
  NATIVE_PED_RECORD_INITIAL_CAPACITY,
  NATIVE_PED_RECORD_MEMORY_PAGES,
} from "../src/ped-record-array.ts";

const dv = (array) =>
  new DataView(array.buffer, array.byteOffset, array.byteLength);

test("records use actual nonzero aligned Wasm linear offsets and source field offsets", () => {
  const records = new NativePedRecordArray(2);
  const first = records.append({
    position: [1.25, -2.5, 3.75],
    action: 6,
    flags: 0x40,
    objective: true,
  });
  const address = records.address(first);
  const bytes = records.record(first);
  const view = dv(bytes);
  assert.equal(records.classId, NATIVE_PED_RECORD_CLASS);
  assert.equal(records.initialCapacity, NATIVE_PED_RECORD_INITIAL_CAPACITY);
  assert.ok(records.memory instanceof WebAssembly.Memory);
  assert.ok(address > 0 && address % 4 === 0);
  assert.equal(bytes.byteLength, NATIVE_PED_RECORD_BYTES);
  assert.equal(bytes.buffer, records.memory.buffer);
  assert.equal(view.getInt8(0x04), 100);
  assert.equal(view.getUint16(0x08, true), 0x240);
  assert.equal(view.getInt32(0x10, true), 6);
  assert.equal(
    view.getUint32(0x14, true),
    0,
    "unknown movement pointer remains NULL",
  );
  assert.equal(
    view.getUint32(0x18, true),
    0,
    "unknown exclusion pointer remains NULL",
  );
  assert.deepEqual(
    [0, 1, 2].map((axis) => view.getFloat32(0x1c + axis * 4, true)),
    [1.25, -2.5, 3.75],
  );
  assert.equal(view.getFloat32(0x4c, true), 1);
  assert.equal(
    view.getUint32(0, true),
    0,
    "unknown owner pointer remains NULL",
  );
  assert.equal(
    view.getUint32(0x0c, true),
    0,
    "unknown process pointer remains NULL",
  );
  assert.equal(records.count, 1);
});

test("updates preserve threat/fear fields and compaction copies exact live record bytes", () => {
  const records = new NativePedRecordArray(3);
  records.append({ position: [10, 20, 30], action: 1 });
  records.append({ position: [-1, 0, 1], action: 4 });
  const beforeAddress = records.address(0);
  const first = dv(records.record(0));
  first.setUint32(0x28, 0x12345678, true);
  first.setUint32(0x2c, 0x90abcdef, true);
  records.update(0, {
    position: [11, 22, 33],
    action: 3,
    hitPoints: 72,
    speedFactor: 1.5,
  });
  assert.equal(first.getUint32(0x28, true), 0x12345678);
  assert.equal(first.getUint32(0x2c, true), 0x90abcdef);
  const bytesBefore = [...records.record(0)];
  const expectedSecond = [...records.record(1)];
  records.finish();
  assert.equal(records.byteLength, 2 * NATIVE_PED_RECORD_BYTES);
  assert.notEqual(
    records.address(0),
    beforeAddress,
    "live array moved to its exact-count compact allocation",
  );
  assert.deepEqual([...records.record(0)], bytesBefore);
  assert.deepEqual([...records.record(1)], expectedSecond);
  assert.equal(
    records.address(1) - records.address(0),
    NATIVE_PED_RECORD_BYTES,
  );
  assert.equal(dv(records.record(0)).getUint32(0x28, true), 0x12345678);
  assert.equal(dv(records.record(0)).getUint32(0x2c, true), 0x90abcdef);
  assert.throws(
    () => records.append({ position: [0, 0, 0], action: 0 }),
    /after.*compaction/,
  );
});

test("capacity bounds and disposed-owner checks reject stale record access", () => {
  assert.throws(
    () => new NativePedRecordArray(2001),
    /maximum count.*0\.\.2000/,
  );
  assert.throws(() => new NativePedRecordArray(-1), /maximum count/);
  const zero = new NativePedRecordArray(0);
  assert.throws(
    () => zero.append({ position: [0, 0, 0], action: 0 }),
    /capacity exhausted/,
  );
  zero.finish();
  assert.equal(zero.count, 0);
  const records = new NativePedRecordArray(1);
  records.append({ position: [0, 0, 0], action: 0 });
  assert.throws(
    () => records.append({ position: [0, 0, 0], action: 0 }),
    /capacity exhausted/,
  );
  assert.ok(records.memory.buffer.byteLength < 400 * 1024);
  assert.equal(
    records.memory.buffer.byteLength,
    NATIVE_PED_RECORD_MEMORY_PAGES * 65536,
  );
  records.dispose();
  for (const read of [
    () => records.count,
    () => records.byteLength,
    () => records.address(0),
    () => records.record(0),
    () => records.update(0, { action: 1 }),
    () => records.finish(),
    () => records.memory,
  ])
    assert.throws(read, /disposed/);
});
