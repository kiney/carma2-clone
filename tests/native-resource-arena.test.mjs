import assert from "node:assert/strict";
import test from "node:test";
import { createAssetStore } from "../server/assets.mjs";
import { Assets } from "../src/content.ts";
import { knownNativeActorValue as known } from "../src/native-actor-order.ts";
import {
  createNativeTrackModelResource,
  prepareNativeTrackResource,
} from "../src/native-track-resources.ts";
import { prepareNativeFaceOrder } from "../src/native-face-order.ts";
import {
  NativeResourceArena,
  NativeResourceArenaError,
} from "../src/native-resource-arena.ts";

const data = (bytes) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const code = (expected) => (error) =>
  error instanceof NativeResourceArenaError && error.code === expected;
const classes =
  (alignment, free = null) =>
  () => ({ resolved: true, value: { alignment, free } });

test("MAT resources own bytes with native 24-byte header and 180-byte allocation", () => {
  const arena = new NativeResourceArena({
    initialCapacity: 184,
    maxCapacity: 1024,
  });
  const mat = { name: "actual material identity" };
  const source = Uint8Array.from([1, 2, 3]);
  const h = arena.allocateMaterial(mat, { payload: source });
  const s = arena.snapshot(h),
    v = data(s.bytes);
  assert.equal(s.start, 4);
  assert.equal(h.address, s.start + 24);
  assert.equal(h.size, 0x9c);
  assert.equal(s.roundedSize, (0x9c + 27) & ~3);
  assert.equal(s.allocationSize, 180);
  assert.deepEqual([...s.bytes.slice(0, 12)], Array(12).fill(0));
  assert.deepEqual([...s.bytes.slice(12, 16)], [45, 0, 0, 8]);
  assert.equal(v.getUint32(16, true), s.start);
  assert.equal(v.getUint32(20, true), 0xdeadbeef);
  assert.deepEqual([...arena.read(h, 0, 5)], [1, 2, 3, 0, 0]);
  source[0] = 255;
  s.bytes.fill(88);
  assert.equal(arena.read(h)[0], 1);
  assert.equal(arena.materialAddress(mat).address, h.address);
  assert.equal(arena.allocatedBytes, 180);
  assert.equal(arena.liveCount, 1);
});

test("backing growth retains live byte addresses and every exposed byte array is a copy", () => {
  const arena = new NativeResourceArena({
    initialCapacity: 184,
    maxCapacity: 1024,
  });
  const first = arena.allocateMaterial({});
  arena.write(first, 150, new Uint8Array([3, 4, 5, 6, 7, 8]));
  const old = arena.read(first),
    snapshot = arena.snapshot(first);
  const second = arena.allocateMaterial({});
  assert.equal(first.address, 28);
  assert.equal(second.address, 208);
  assert.ok(arena.capacity > 184);
  arena.write(first, 150, new Uint8Array([30]));
  assert.equal(old[150], 3);
  assert.equal(snapshot.bytes[24 + 150], 3);
  old[150] = 222;
  assert.equal(arena.read(first, 150, 1)[0], 30);
  assert.equal(arena.snapshot(first).start, 4);
});

test("generic resource class alignment uses native padding and safe size encoding", () => {
  for (const alignment of [-1, 0, 1, 2, 4, 8, 16, 32, 64]) {
    const arena = new NativeResourceArena({
      initialCapacity: 512,
      classProvider: classes(alignment),
    });
    const h = arena.allocate({ classId: 10, size: 7 });
    const s = arena.snapshot(h),
      a = alignment <= 0 ? 4 : alignment;
    const rounded = (7 + 24 + 3) & ~3;
    const pad = ~(4 - 1) & (a - 1);
    assert.equal(s.allocationSize, rounded + pad);
    assert.equal(h.address, Math.ceil((s.start + 24) / a) * a);
    assert.equal(h.address % a, 0);
    assert.ok(h.address + 7 <= s.start + s.allocationSize);
    const b = s.bytes;
    assert.equal(((b[12] | (b[13] << 8) | (b[14] << 16)) >>> 0) * 4, rounded);
    assert.equal(b[15], 10);
    assert.deepEqual([...arena.read(h)], Array(7).fill(0));
  }
  const arena = new NativeResourceArena({ maxCapacity: 512 });
  assert.throws(
    () => arena.allocate({ classId: 10, size: 1 }),
    code("provider-required"),
  );
  assert.throws(
    () => arena.allocate({ classId: 127, size: 1 }),
    code("resource-class"),
  );
  assert.throws(
    () =>
      new NativeResourceArena({ classProvider: classes(3) }).allocate({
        classId: 1,
        size: 0,
      }),
    code("alignment"),
  );
  assert.throws(
    () => arena.allocate({ classId: 8, size: 0x3ffffe5 }),
    code("bounds"),
  );
  assert.equal(arena.liveCount, 0);
});

test("payload reads/writes are bounded independently of aligned allocation slack", () => {
  const arena = new NativeResourceArena();
  const h = arena.allocate({
    classId: 8,
    size: 1,
    payload: new Uint8Array([9]),
  });
  assert.equal(arena.snapshot(h).allocationSize, 28);
  assert.deepEqual([...arena.read(h)], [9]);
  assert.throws(() => arena.read(h, 1, 1), code("bounds"));
  assert.throws(() => arena.write(h, -1, new Uint8Array()), code("bounds"));
  assert.throws(
    () => arena.write(h, 0, new Uint8Array([1, 2])),
    code("bounds"),
  );
  assert.throws(
    () =>
      arena.allocate({ classId: 8, size: 1, payload: new Uint8Array([1, 2]) }),
    code("bounds"),
  );
  assert.throws(() => arena.read({ ...h }), code("stale-handle"));
  assert.throws(() => new NativeResourceArena().read(h), code("stale-handle"));
  assert.equal(arena.liveCount, 1);
});

test("parent lists store native next/prev-field pointers and prepend child resources", () => {
  const arena = new NativeResourceArena();
  const p = arena.allocateMaterial({}),
    a = arena.allocateMaterial({}, { parent: p }),
    b = arena.allocateMaterial({}, { parent: p });
  const ps = arena.snapshot(p),
    as = arena.snapshot(a),
    bs = arena.snapshot(b);
  assert.deepEqual(arena.children(p), [b, a]);
  assert.equal(data(ps.bytes).getUint32(8, true), bs.start);
  assert.equal(data(bs.bytes).getUint32(0, true), as.start);
  assert.equal(data(bs.bytes).getUint32(4, true), ps.start + 8);
  assert.equal(data(as.bytes).getUint32(0, true), 0);
  assert.equal(data(as.bytes).getUint32(4, true), bs.start);
  arena.reparent(a, null);
  assert.deepEqual(arena.children(p), [b]);
  assert.equal(arena.parent(a), null);
  assert.equal(data(arena.snapshot(b).bytes).getUint32(0, true), 0);
  assert.deepEqual([...arena.snapshot(a).bytes.slice(0, 8)], Array(8).fill(0));
  arena.reparent(a, b);
  assert.equal(arena.parent(a), b);
  assert.throws(() => arena.reparent(p, a), code("resource-cycle"));
  assert.deepEqual(arena.children(p), [b]);
});

test("native release callback is parent-first, children LIFO and unlinked before recursive callback", () => {
  const events = [];
  const arena = new NativeResourceArena({
    classProvider: classes(4, (event) => events.push(event)),
  });
  const p = arena.allocate({
    classId: 3,
    size: 5,
    payload: new Uint8Array([42]),
  });
  const a = arena.allocate({ classId: 3, size: 0, parent: p });
  const b = arena.allocate({ classId: 3, size: 0, parent: p });
  const child = arena.allocate({ classId: 3, size: 0, parent: b });
  arena.free(p);
  assert.deepEqual(
    events.map((e) => e.handle),
    [p, b, child, a],
  );
  assert.equal(events[0].roundedSize, 32);
  assert.equal(events[0].payload[0], 42);
  for (const e of events) assert.equal(e.header[15], 127);
  for (const e of events.slice(1))
    assert.deepEqual([...e.header.slice(0, 8)], Array(8).fill(0));
  assert.equal(arena.liveCount, 0);
  assert.equal(arena.allocatedBytes, 0);
  for (const h of [p, a, b, child]) assert.equal(arena.isLive(h), false);
  assert.throws(() => arena.free(p), code("stale-handle"));
});

test("no-callback root free still invokes child callbacks; direct child callback retains original parent link", () => {
  const events = [];
  const arena = new NativeResourceArena({
    classProvider: classes(4, (e) => events.push(e)),
  });
  const p = arena.allocate({ classId: 3, size: 0 }),
    a = arena.allocate({ classId: 3, size: 0, parent: p });
  arena.free(a);
  assert.notEqual(data(events[0].header).getUint32(4, true), 0);
  assert.deepEqual(arena.children(p), []);
  const b = arena.allocate({ classId: 3, size: 0, parent: p });
  arena.free(p, { callbacks: false });
  assert.deepEqual(
    events.map((e) => e.handle),
    [a, b],
  );
});

test("first-fit/coalescing reuse changes actual addresses while stale generations never revive", () => {
  const arena = new NativeResourceArena({
    initialCapacity: 544,
    maxCapacity: 544,
  });
  const a = arena.allocateMaterial({}),
    b = arena.allocateMaterial({}),
    c = arena.allocateMaterial({});
  arena.write(b, 0, new Uint8Array([99]));
  arena.free(b);
  const d = arena.allocateMaterial({});
  assert.equal(d.address, b.address);
  assert.equal(d.generation, b.generation + 1);
  assert.notEqual(d.id, b.id);
  assert.throws(() => arena.read(b), code("stale-handle"));
  assert.equal(arena.read(d)[0], 0);
  arena.free(a);
  arena.free(d);
  const large = arena.allocate({ classId: 8, size: 300 });
  assert.equal(arena.snapshot(large).start, 4);
  assert.equal(arena.isLive(c), true);
  assert.throws(() => arena.allocateMaterial({}), code("capacity"));
  assert.equal(arena.liveCount, 2);
});

test("borrowed descendant blocks whole-tree free before any callbacks or state mutation", () => {
  let calls = 0;
  const arena = new NativeResourceArena({
    classProvider: classes(4, () => calls++),
  });
  const p = arena.allocateMaterial({}),
    a = arena.allocateMaterial({}, { parent: p });
  const lease = arena.borrow(a);
  arena.allocateMaterial({});
  assert.equal(lease.address, a.address);
  assert.throws(() => arena.free(p), code("resource-borrowed"));
  assert.equal(calls, 0);
  assert.equal(arena.isLive(p), true);
  assert.equal(arena.isLive(a), true);
  lease.release();
  assert.throws(() => lease.release(), code("borrow-release"));
  arena.free(p);
  assert.equal(calls, 2);
});

test("material binding is actual identity, with explicit NULL/missing/freed results and duplicate rejection", () => {
  const arena = new NativeResourceArena();
  const a = { name: "same" },
    b = { name: "same" },
    missing = {};
  const h = arena.allocateMaterial(a),
    k = arena.allocateMaterial(b);
  assert.notEqual(h.address, k.address);
  assert.equal(arena.bindMaterial(a, h), h);
  assert.throws(() => arena.bindMaterial(a, k), code("material-duplicate"));
  assert.throws(() => arena.bindMaterial({}, h), code("material-duplicate"));
  assert.throws(() => arena.allocateMaterial(a), code("material-duplicate"));
  assert.deepEqual(arena.materialAddress(null), {
    resolved: true,
    address: 0,
    handle: null,
  });
  assert.equal(arena.materialAddress(missing).resolved, false);
  assert.equal(arena.materialOrder([{ material: missing }]).kind, "unresolved");
  arena.free(h);
  assert.match(
    arena.materialAddress(a).requiredProvider,
    /freed resource episode/,
  );
  assert.throws(() => arena.bindMaterial(a, k), code("material-freed"));
  arena.unbindMaterial(a);
  const next = arena.allocateMaterial(a);
  assert.equal(next.address, h.address);
  assert.notEqual(next.generation, h.generation);
  assert.equal(arena.materialAddress(a).handle, next);
  assert.throws(
    () => arena.bindMaterial({}, arena.allocate({ classId: 8, size: 1 })),
    code("material-resource"),
  );
});

test("owned MAT byte addresses feed exact comparator without names, load-rank ordinals or Windows-capture claims", () => {
  const arena = new NativeResourceArena();
  const Z = { name: "Z" },
    A = { name: "A" };
  const z = arena.allocateMaterial(Z),
    a = arena.allocateMaterial(A);
  const faces = [A, Z, null, Z, A, null].map((material) => ({ material }));
  const order = arena.materialOrder(faces);
  assert.equal(order.kind, "host-resource-addresses");
  assert.deepEqual(order.keys, [
    a.address,
    z.address,
    0,
    z.address,
    a.address,
    0,
  ]);
  assert.match(order.evidence, /not captured Windows/);
  const prepared = prepareNativeFaceOrder(faces.length, order);
  assert.equal(prepared.resolved, true);
  assert.equal(prepared.keySource, "host-resource-addresses");
  assert.deepEqual(
    prepared.groups.map((g) => g.materialKey),
    [0, z.address, a.address],
  );
  for (const g of prepared.groups)
    for (const index of prepared.faceOrder.slice(
      g.faceStart,
      g.faceStart + g.faceCount,
    ))
      assert.equal(order.keys[index], g.materialKey);
});

test("capacity/alignment errors preserve existing owned resources", () => {
  assert.throws(
    () => new NativeResourceArena({ initialCapacity: 3 }),
    code("alignment"),
  );
  assert.throws(
    () => new NativeResourceArena({ maxCapacity: 0x100000000 }),
    code("bounds"),
  );
  const arena = new NativeResourceArena({ maxCapacity: 184 });
  const h = arena.allocateMaterial({});
  const old = arena.snapshot(h);
  assert.throws(() => arena.allocateMaterial({}), code("capacity"));
  assert.deepEqual(arena.snapshot(h), old);
  assert.equal(arena.liveCount, 1);
});

test("release callback mutation is rejected and interrupted lifecycle remains explicit", () => {
  let arena;
  arena = new NativeResourceArena({
    classProvider: classes(4, () => arena.allocateMaterial({})),
  });
  const h = arena.allocateMaterial({});
  assert.throws(() => arena.free(h), code("release-reentrancy"));
  assert.equal(arena.isLive(h), false);
  assert.throws(() => arena.read(h), code("stale-handle"));
  assert.equal(arena.allocatedBytes, 180); // retained interrupted release, never reused
});

test("generic callback providers cannot turn native synchronous release into a deferred task", () => {
  const arena = new NativeResourceArena({
    classProvider: classes(4, () => Promise.resolve()),
  });
  const h = arena.allocateMaterial({});
  assert.throws(() => arena.free(h), code("release-async"));
  assert.equal(arena.isLive(h), false);
  assert.equal(arena.allocatedBytes, 180);
});

test("Stock and Advanced multi-MAT models prepare using actual parsed identity and owned record addresses", async (t) => {
  let store;
  try {
    store = await createAssetStore(process.env.CARMA2_ROOT || "carma2_orig");
  } catch (error) {
    if (/ENOENT|Original installation/.test(String(error))) {
      t.skip("Original installation unavailable");
      return;
    }
    throw error;
  }
  const assets = new Assets();
  assets.manifest = store.manifest;
  assets.lookup = new Map(
    store.manifest.map(({ path }) => [path.toLowerCase(), path]),
  );
  assets.bytes = async (path) => store.read(path);
  for (const root of ["data", "adv_data"]) {
    const prefix = `${root}/races/newcity1/`;
    const files = store.manifest.filter(
      (e) =>
        e.path.toLowerCase().startsWith(prefix) &&
        !e.path.slice(prefix.length).includes("/"),
    );
    if (!files.length) {
      t.diagnostic(`${root} Newcity original resources unavailable`);
      continue;
    }
    const scene = await assets.scene(`${root}/RACES/newcity1`, "newcity1"),
      arena = scene.materialArena,
      models = scene.sourceModelStorage;
    let checked = 0;
    for (const model of models) {
      const used = new Set(
        model.faces.map((f) => f.material).filter((i) => i !== 0),
      );
      if (used.size < 2) continue;
      const made = createNativeTrackModelResource(
        model,
        (name) => {
          const mat = scene.findSourceMaterial(name);
          assert.ok(mat, `actual accepted source MAT ${name}`);
          return known(mat);
        },
        4,
      );
      assert.equal(made.resolved, true);
      const resource = made.value;
      assert.ok(resource.current.faces.some((f) => f.material));
      const order = arena.materialOrder(resource.current.faces);
      assert.equal(order.kind, "host-resource-addresses");
      for (let i = 0; i < resource.current.faces.length; i++) {
        const material = resource.current.faces[i].material;
        assert.equal(order.keys[i], arena.materialAddress(material).address);
        if (material) {
          const s = arena.snapshot(arena.materialAddress(material).handle);
          assert.equal(s.bytes[15], 8);
          assert.equal(s.allocationSize, 180);
        }
      }
      const prepared = prepareNativeTrackResource(resource, order);
      assert.equal(prepared.resolved, true, model.name);
      assert.equal(prepared.value.order.keySource, "host-resource-addresses");
      assert.equal(prepared.value.faces.length, model.faces.length);
      assert.ok(prepared.value.order.groups.length >= 2);
      if (++checked === 5) break;
    }
    assert.equal(checked, 5, `${root} multi-material sample coverage`);
  }
});
