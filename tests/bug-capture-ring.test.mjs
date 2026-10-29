import assert from "node:assert/strict";
import {
  BoundedCaptureRing,
  CAPTURE_RECORD_OVERHEAD_BYTES,
  CAPTURE_SLOT_OVERHEAD_BYTES,
} from "../src/bug-capture/ring.ts";
import {
  createCaptureBlob,
  decodeCapture,
  CAPTURE_FILE_HEADER_BYTES,
  CAPTURE_RECORD_HEADER_BYTES,
} from "../src/bug-capture/format.ts";

const smallRing = (options = {}) =>
  new BoundedCaptureRing({
    maxBytes: 4096,
    maxAgeMs: 100,
    maxRecords: 4,
    reserveBytes: 0,
    ...options,
  });
const payload = (...values) => new Uint8Array(values);

// Automatic slot sizing must leave usable payload space in a small budget.
{
  const ring = new BoundedCaptureRing({ maxBytes: 1024, reserveBytes: 0 });
  assert.equal(ring.push(0, 1, new Uint8Array(256)), true);
  assert.ok(ring.stats.accountedBytes <= 1024);
}

// Inclusive age boundary, same timestamps, backwards clock and idle expiry.
{
  const ring = smallRing();
  ring.push(0, 1, payload(0));
  ring.push(100, 1, payload(1));
  assert.equal(ring.stats.count, 2);
  ring.push(99, 1, payload(2));
  assert.deepEqual(
    ring.snapshot().records.map((r) => r.timeMs),
    [0, 100, 100],
  );
  ring.advance(101);
  assert.equal(ring.stats.evictedAge, 1);
  ring.advance(201);
  assert.equal(ring.stats.count, 0);
  assert.equal(ring.stats.payloadBytes, 0);
  assert.equal(ring.stats.oldestTimeMs, null);
  ring.push(150, 2, payload(3));
  assert.equal(ring.stats.newestTimeMs, 201);
}

// Capacity wraparound releases each removed slot; snapshot holds only its era.
{
  const ring = smallRing({ maxRecords: 2 });
  ring.push(0, 1, payload(0));
  ring.push(1, 2, payload(1));
  const snapshot = ring.snapshot();
  for (let i = 2; i < 20; i++) ring.push(i, 3, payload(i));
  assert.deepEqual(
    ring.snapshot().records.map((r) => r.payload[0]),
    [18, 19],
  );
  assert.equal(ring.stats.evictedCapacity, 18);
  assert.deepEqual(
    snapshot.records.map((r) => r.payload[0]),
    [0, 1],
  );
  assert.equal(snapshot.stats.count, 2);
  assert.equal(ring.slots.length, 2);
  ring.advance(1000);
  assert.ok(ring.slots.every((entry) => entry === undefined));
}

// Payload plus slots and per-entry bookkeeping must all fit in the budget.
{
  const fixed = 3 * CAPTURE_SLOT_OVERHEAD_BYTES;
  const budget = fixed + 2 * CAPTURE_RECORD_OVERHEAD_BYTES + 200;
  const ring = smallRing({ maxBytes: budget, maxRecords: 3 });
  ring.push(0, 1, new Uint8Array(100));
  ring.push(1, 1, new Uint8Array(100));
  assert.equal(ring.stats.accountedBytes, budget);
  ring.push(2, 1, new Uint8Array(100));
  assert.equal(ring.stats.evictedBytes, 1);
  assert.equal(ring.stats.count, 2);
  assert.ok(ring.stats.accountedBytes <= budget);
  const before = ring.snapshot();
  assert.equal(ring.push(2, 1, new Uint8Array(budget)), false);
  assert.equal(ring.stats.droppedOversize, 1);
  assert.deepEqual(ring.snapshot().records, before.records);
  assert.equal(ring.push(NaN, 1, payload()), false);
  assert.equal(ring.push(2, -1, payload()), false);
  assert.equal(ring.push(2, 0x1_0000_0000, payload()), false);
  assert.equal(ring.stats.droppedInvalid, 3);
}

// Exact backing allocations prevent small views retaining large engine buffers.
{
  const source = new Uint8Array(8192);
  source.set([7, 8, 9], 5000);
  const ring = smallRing();
  ring.push(4, 0xffffffff, source.subarray(5000, 5003));
  source.fill(0);
  const record = ring.snapshot().records[0];
  assert.deepEqual([...record.payload], [7, 8, 9]);
  assert.equal(record.payload.buffer.byteLength, 3);
  assert.notEqual(record.payload.buffer, source.buffer);
}

// The file is independent of subsequent writes and survives a roundtrip.
{
  const ring = smallRing();
  ring.push(2.5, 1, payload(1, 2));
  ring.push(2.5, 4, payload());
  ring.push(5, 0xffffffff, payload(255));
  const snapshot = ring.snapshot();
  const metadata = {
    track: "Übermensch",
    settings: { enabled: true },
    values: [1, null, "two"],
  };
  const blob = createCaptureBlob(snapshot, metadata);
  ring.advance(1000);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const decoded = decodeCapture(bytes);
  assert.deepEqual(decoded.metadata, metadata);
  assert.deepEqual(decoded.records, snapshot.records);
  bytes.fill(0);
  assert.deepEqual([...decoded.records[0].payload], [1, 2]);
  assert.equal(blob.type, "application/octet-stream");
  const nodeBuffer = Buffer.from(await blob.arrayBuffer());
  const fromBuffer = decodeCapture(nodeBuffer);
  nodeBuffer.fill(0);
  assert.deepEqual([...fromBuffer.records[0].payload], [1, 2]);
  assert.equal(fromBuffer.records[0].payload.buffer.byteLength, 2);
}

// Untrusted headers and lengths are checked before payload allocation.
{
  const ring = smallRing();
  ring.push(0, 1, payload(1));
  ring.push(1, 2, payload(2));
  const original = new Uint8Array(
    await createCaptureBlob(ring.snapshot(), {}).arrayBuffer(),
  );
  const metadataLength = new DataView(original.buffer).getUint32(12, true);
  const first = CAPTURE_FILE_HEADER_BYTES + metadataLength;
  const second = first + CAPTURE_RECORD_HEADER_BYTES + 1;
  const corrupt = (edit) => {
    const copy = original.slice();
    edit(copy, new DataView(copy.buffer));
    return copy;
  };
  assert.throws(() => decodeCapture(original.subarray(0, 8)), /header/);
  assert.throws(
    () =>
      decodeCapture(
        corrupt((b) => {
          b[0] = 0;
        }),
      ),
    /magic/,
  );
  assert.throws(
    () => decodeCapture(corrupt((b, v) => v.setUint32(8, 2, true))),
    /version/,
  );
  assert.throws(
    () => decodeCapture(corrupt((b, v) => v.setUint32(12, 0xffffffff, true))),
    /metadata/,
  );
  assert.throws(
    () => decodeCapture(corrupt((b, v) => v.setUint32(16, 0xffffffff, true))),
    /records/,
  );
  assert.throws(
    () =>
      decodeCapture(
        corrupt((b, v) => v.setUint32(first + 12, 0xffffffff, true)),
      ),
    /payload/,
  );
  assert.throws(
    () => decodeCapture(original.subarray(0, original.length - 1)),
    /payload/,
  );
  assert.throws(
    () => decodeCapture(corrupt((b, v) => v.setFloat64(second, -1, true))),
    /timestamp/,
  );
  assert.throws(
    () => decodeCapture(corrupt((b, v) => v.setFloat64(first, Infinity, true))),
    /timestamp/,
  );
  assert.throws(
    () =>
      decodeCapture(
        corrupt((b) => {
          b[CAPTURE_FILE_HEADER_BYTES] = 0xff;
        }),
      ),
    /encoded|encoding|valid/i,
  );
  const trailing = new Uint8Array(original.length + 1);
  trailing.set(original);
  assert.throws(() => decodeCapture(trailing), /trailing/);
  assert.throws(
    () => decodeCapture(original, { maxFileBytes: 1 }),
    /size limit/,
  );
  assert.throws(
    () => decodeCapture(original, { maxMetadataBytes: 1 }),
    /metadata/,
  );
  assert.throws(() => decodeCapture(original, { maxRecords: 1 }), /records/);
}

// Metadata cannot grow without bounds or invoke caller-defined serialization.
{
  const snapshot = smallRing().snapshot();
  assert.throws(
    () =>
      createCaptureBlob(
        snapshot,
        { value: "x".repeat(20) },
        { maxMetadataBytes: 10 },
      ),
    /large/,
  );
  assert.throws(
    () =>
      createCaptureBlob(snapshot, {
        get value() {
          throw new Error("executed getter");
        },
      }),
    /getters/,
  );
  const value = {};
  Object.defineProperty(value, "toJSON", {
    value() {
      throw new Error("executed toJSON");
    },
  });
  assert.throws(() => createCaptureBlob(snapshot, value), /toJSON/);
  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => createCaptureBlob(snapshot, cycle), /cycle/);
  assert.throws(() => createCaptureBlob(snapshot, { value: Infinity }), /JSON/);
  assert.throws(
    () => createCaptureBlob(snapshot, { values: new Array(10001).fill(0) }),
    /large/,
  );
  assert.throws(() => new BoundedCaptureRing({ maxBytes: 1 }), /budget/);
  assert.throws(
    () => new BoundedCaptureRing({ maxAgeMs: Infinity }),
    /maxAgeMs/,
  );
}

console.log("Bounded bug capture ring and binary format tests passed.");
