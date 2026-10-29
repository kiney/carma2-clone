import test from "node:test";
import assert from "node:assert/strict";
import {
  NativePhysicsObjectRecords,
  NATIVE_PHYSICS_OBJECT_RECORD_BYTES,
} from "../src/physics/native-object-records.ts";

test("addresses are stable actual WebAssembly offsets with zero reserved and distinct records", () => {
  const records = new NativePhysicsObjectRecords(3),
    a = {},
    b = {},
    addressA = records.address(a),
    addressB = records.address(b);
  assert.ok(records.memory instanceof WebAssembly.Memory);
  assert.ok(addressA >= 0x100);
  assert.equal(addressA % 16, 0);
  assert.equal(addressA, records.address(a));
  assert.notEqual(addressA, addressB);
  assert.equal(addressB - addressA, NATIVE_PHYSICS_OBJECT_RECORD_BYTES);
  assert.equal(
    records.memory.buffer.byteLength >= addressB + records.recordBytes,
    true,
  );
  assert.equal(records.readView(a).getUint8(0x238), 0);
  assert.equal(records.stats.count, 2);
  assert.equal(records.stats.capacity, 3);
  assert.equal(records.stats.bytes, 3 * records.recordBytes);
  assert.equal(
    new Uint8Array(records.memory.buffer, 0, 0x100).some((byte) => byte !== 0),
    false,
  );
});

test("updates write verified native world/local velocities, rigid mass and type byte", () => {
  const records = new NativePhysicsObjectRecords(1),
    body = {};
  records.update(body, {
    worldVelocity: [1.25, -2.5, 3.75],
    localVelocity: [4, 5, 6],
    mass: 0.125,
    typeByte: 5,
  });
  const view = records.readView(body);
  assert.deepEqual(
    [0, 1, 2].map((i) => view.getFloat32(0x68 + i * 4, true)),
    [1.25, -2.5, 3.75],
  );
  assert.deepEqual(
    [0, 1, 2].map((i) => view.getFloat32(0x1a8 + i * 4, true)),
    [4, 5, 6],
  );
  assert.equal(view.getFloat32(0x04, true), 0.125);
  assert.equal(view.getUint8(0x238), 5);
  assert.equal(
    view.getUint8(0x1a0),
    0,
    "collision filter fields remain unwritten",
  );
  records.update(body, { worldVelocity: [0, 0, 0], typeByte: 2 });
  assert.equal(view.getFloat32(0x1a8, true), 4, "omitted local V is retained");
  assert.equal(view.getFloat32(0x04, true), 0.125, "omitted mass is retained");
});

test("invalid updates reject before allocation or mutation", () => {
  const records = new NativePhysicsObjectRecords(1),
    body = {};
  assert.throws(
    () => records.update(body, { worldVelocity: [1, Number.NaN, 3] }),
    /finite Float32/,
  );
  assert.equal(records.stats.count, 0);
  assert.throws(
    () =>
      records.update(body, {
        worldVelocity: [1, 2, 3],
        localVelocity: [0, 0, Infinity],
      }),
    /finite Float32/,
  );
  assert.equal(records.stats.count, 0);
  assert.throws(
    () => records.update(body, { worldVelocity: [1, 2, 3], mass: -1 }),
    /mass must be finite nonnegative/,
  );
  assert.equal(records.stats.count, 0);
  assert.throws(
    () => records.update(body, { worldVelocity: [1, 2, 3], typeByte: 256 }),
    /type byte/,
  );
  assert.equal(records.stats.count, 0);

  records.update(body, { worldVelocity: [1, 2, 3] });
  const view = records.readView(body),
    before = new Uint8Array(
      view.buffer,
      view.byteOffset,
      view.byteLength,
    ).slice();
  assert.throws(
    () => records.update(body, { worldVelocity: [9, 8, 7], mass: Number.NaN }),
    /mass must be finite nonnegative/,
  );
  assert.deepEqual(
    new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    before,
  );
});

test("capacity is bounded and clear zeroes records and releases owners", () => {
  const records = new NativePhysicsObjectRecords(1),
    a = {},
    b = {};
  records.update(a, { worldVelocity: [1, 2, 3] });
  const staleAddress = records.address(a);
  assert.throws(() => records.address(b), /capacity exhausted/);
  assert.equal(records.stats.count, 1);
  records.clear();
  assert.equal(records.stats.count, 0);
  assert.equal(
    new Uint8Array(
      records.memory.buffer,
      staleAddress,
      records.recordBytes,
    ).some((byte) => byte !== 0),
    false,
  );
  assert.equal(
    records.address(a),
    staleAddress,
    "post-clear request receives a fresh zeroed allocation",
  );
  assert.equal(records.readView(a).getFloat32(0x68, true), 0);
  assert.throws(() => records.address(b), /capacity exhausted/);
});

test("constructor bounds capacity and disposal releases owners and blocks future access", () => {
  assert.throws(() => new NativePhysicsObjectRecords(0), /capacity/);
  assert.throws(() => new NativePhysicsObjectRecords(4097), /capacity/);
  const records = new NativePhysicsObjectRecords(2),
    body = {};
  records.address(body);
  records.dispose();
  assert.throws(() => records.address(body), /disposed/);
  assert.throws(() => records.readView(body), /disposed/);
  assert.throws(() => records.stats, /disposed/);
});

test("retired physical owners release zeroed slots without displacing live records", () => {
  const records = new NativePhysicsObjectRecords(2),
    survivor = {};
  records.update(survivor, { worldVelocity: [7, 8, 9], mass: 0 });
  const survivorAddress = records.address(survivor);
  for (let cycle = 0; cycle < 20; cycle++) {
    const transient = {};
    records.update(transient, { worldVelocity: [cycle, 2, 3], typeByte: 5 });
    const address = records.address(transient);
    assert.equal(records.release(transient), true);
    assert.equal(
      records.release(transient),
      false,
      "duplicate release cannot duplicate free slots",
    );
    assert.equal(
      new Uint8Array(records.memory.buffer, address, records.recordBytes).some(
        Boolean,
      ),
      false,
    );
    assert.equal(records.stats.count, 1);
    assert.equal(records.address(survivor), survivorAddress);
    assert.equal(records.readView(survivor).getFloat32(0x68, true), 7);
  }
});
