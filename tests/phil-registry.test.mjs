import test from "node:test";
import assert from "node:assert/strict";
import {
  NativePhilRegistry,
  NativePhilProviderRequired,
  NATIVE_PHIL_NORMAL_CAPACITY,
} from "../src/physics/phil-registry.ts";

function body(name, flags = 0) {
  return {
    name,
    flags,
    header: null,
    indicator: 0,
    next: null,
    previous: null,
    velocity: [12, 13, 14],
    localOmega: [5, 6, 7],
    ec: 1,
    owner: {},
    contactRing: {},
  };
}
function setup(extra = {}) {
  const log = [];
  const access = {
    readFlags: (b) => b.flags,
    writeFlags: (b, flags) => {
      b.flags = flags;
      log.push(["flags", b.name, flags]);
    },
    writeBinding: (b, header, indicator) => {
      b.header = header;
      b.indicator = indicator;
      log.push(["binding", b.name, header?.index ?? null, indicator]);
    },
    writeLinks: (b, next, previous) => {
      b.next = next;
      b.previous = previous;
      log.push(["links", b.name, next?.name ?? null, previous?.name ?? null]);
    },
    writeVelocity: (b, v) => {
      b.velocity = [...v];
      log.push(["velocity", b.name]);
    },
    writeLocalOmega: (b, v) => {
      b.localOmega = [...v];
      log.push(["omega", b.name]);
    },
    writePassiveMatrix: (b, m) => {
      b.matrix = [...m];
      log.push(["matrix", b.name]);
    },
    onActivated: (b) => log.push(["activated", b.name]),
    ...extra,
  };
  return { registry: new NativePhilRegistry(access), log, access };
}

test("normal100 capacity shared by source car/noncar/part/mine/ped/bone identities, no implicit children", () => {
  const { registry } = setup(),
    kinds = ["car", "noncar", "part", "mine", "ped", "bone"];
  const list = Array.from({ length: 100 }, (_, i) =>
    body(`${kinds[i % kinds.length]}:${i}`),
  );
  assert.equal(NATIVE_PHIL_NORMAL_CAPACITY, 100);
  const child = body("jointed child");
  list[0].children = [child];
  for (const [i, b] of list.entries()) {
    assert.equal(registry.registerImmediate(b), 0);
    assert.equal(b.header.index, i);
    assert.equal(registry.freeCount, 99 - i);
  }
  assert.equal(registry.count, 100);
  assert.equal(registry.getHeader(child), null);
  assert.equal(
    registry.registerImmediate(list[99]),
    2,
    "duplicate wins over full",
  );
  const rejected = body("extra");
  assert.equal(registry.registerImmediate(rejected), 1);
  assert.equal(rejected.indicator, 0);
  assert.equal(registry.count, 100);
});

test("first free index and after-head list insertion; head/middle/tail removal repairs links", () => {
  const { registry } = setup(),
    a = body("a"),
    b = body("b"),
    c = body("c"),
    d = body("d");
  for (const x of [a, b, c, d]) registry.registerImmediate(x);
  assert.deepEqual(registry.registeredBodies, [a, d, c, b]);
  assert.equal(registry.getPrevious(c), d);
  assert.deepEqual(registry.remove(c), { code: 0, phase: "complete" });
  assert.deepEqual(registry.registeredBodies, [a, d, b]);
  assert.equal(b.previous, d);
  const slot = c.header,
    replacement = body("replacement");
  assert.equal(slot, null);
  registry.registerImmediate(replacement);
  assert.equal(replacement.header.index, 2);
  assert.deepEqual(registry.registeredBodies, [a, replacement, d, b]);
  registry.remove(a);
  assert.equal(registry.first, replacement);
  assert.equal(replacement.previous, null);
  registry.remove(b);
  assert.equal(d.next, null);
  registry.remove(replacement);
  registry.remove(d);
  assert.equal(registry.first, null);
  assert.equal(registry.freeCount, 100);
  assert.deepEqual(registry.remove(d), { code: 3, phase: "complete" });
});

test("fresh header zeroing on reuse; remove preserves indicator, flags, V, owner, contacts and removed links", () => {
  const { registry } = setup(),
    a = body("a", 0x80000001),
    b = body("b");
  registry.registerImmediate(a);
  registry.registerImmediate(b);
  const header = a.header;
  Object.assign(header, { flags: 12, gravity: 1, drag: 7, levelOut: 0.3 });
  const before = {
    owner: a.owner,
    contactRing: a.contactRing,
    velocity: a.velocity,
    localOmega: a.localOmega,
    next: a.next,
    previous: a.previous,
  };
  registry.remove(a);
  assert.equal(a.header, null);
  assert.equal(a.indicator, 1);
  assert.equal(a.flags, 0x80000021);
  for (const [key, value] of Object.entries(before))
    assert.equal(a[key], value);
  assert.equal(header.body, null);
  assert.equal(header.gravity, 1, "remove only clears header body pointer");
  const c = body("c");
  registry.registerImmediate(c);
  assert.equal(c.header, header, "native header slot pointer reused");
  assert.deepEqual(
    {
      state: header.state,
      flags: header.flags,
      drag: header.drag,
      gravity: header.gravity,
      levelOut: header.levelOut,
    },
    { state: 1, flags: 0, drag: 0, gravity: 0, levelOut: 0 },
  );
});

test("activation changes header/passive20 and optionally copies raw V/BODY omega before invalidate", () => {
  const { registry, log } = setup(),
    b = body("b", 0x80000001);
  registry.registerImmediate(b);
  b.header.flags = 12;
  assert.equal(
    registry.activate(b, {
      velocity: [12.345, -0.012, 77],
      localOmega: [1.234, 2, 3],
      flag2: true,
    }),
    0,
  );
  assert.deepEqual(b.velocity, [Math.fround(12.345), Math.fround(-0.012), 77]);
  assert.deepEqual(b.localOmega, [Math.fround(1.234), 2, 3]);
  assert.equal(b.flags, 0x80000001);
  assert.equal(b.header.state, 2);
  assert.equal(b.header.flags, 14);
  assert.equal(b.ec, 1, "PHIL activation does not clear owner-managed ec");
  assert.deepEqual(log.slice(-4), [
    ["flags", "b", 0x80000001],
    ["velocity", "b"],
    ["omega", "b"],
    ["activated", "b"],
  ]);
  const v = b.velocity,
    omega = b.localOmega;
  registry.activate(b);
  assert.equal(b.velocity, v);
  assert.equal(b.localOmega, omega);
  assert.equal(b.header.flags, 12);
  registry.makePassive(b);
  assert.equal(b.header.state, 1);
  assert.equal(b.flags, 0x80000021);
  assert.equal(registry.activate(body("absent")), 3);
  assert.equal(registry.makePassive(body("absent")), 3);
});

test("generic and immediate add-active preserve add failure/duplicate codes", () => {
  const { registry, log } = setup(),
    b = body("b");
  assert.equal(registry.addActive(b), 0);
  assert.equal(registry.getState(b), 2);
  const size = log.length;
  assert.equal(registry.addActiveImmediate(b), 2);
  assert.equal(log.length, size);
  for (let i = 1; i < 100; i++) registry.addActive(body(String(i)));
  assert.equal(registry.addActive(body("full")), 1);
});

test("PrepareObject runs after complete registration during physics; immediate guard covers nested mutations", () => {
  let registry;
  const parent = body("parent"),
    child = body("new independent child"),
    prepared = [];
  const x = setup({
    prepareObject: (b) => {
      prepared.push(b.name);
      assert.equal(registry.getState(b), 1);
      assert.equal(b.flags & 0x20, 0x20);
      assert.ok(registry.registeredBodies.includes(b));
      if (b === parent) assert.equal(registry.add(child), 0);
    },
  });
  registry = x.registry;
  registry.setContext({ munging: true, doingPhysics: true });
  registry.registerImmediate(parent);
  assert.deepEqual(prepared, ["parent", "new independent child"]);
  assert.deepEqual(registry.registeredBodies, [parent, child]);
  assert.throws(
    () => registry.add(body("generic delayed")),
    NativePhilProviderRequired,
    "immediate wrapper clears its guard afterward",
  );
  assert.throws(() => registry.remove(parent), /deferred PHIL union/);
  registry.setContext({});
  assert.equal(registry.remove(parent).code, 0);
});

test("passive matrix status0/3/4 uses native12 without normalizing or losing scale", () => {
  const { registry } = setup(),
    b = body("b"),
    pose = [2, 0, 0, 0, 3, 0, 0, 0, 4, 8, 9, 10];
  assert.equal(registry.setPassiveMatrix(b, pose), 3);
  registry.registerImmediate(b);
  assert.equal(registry.setPassiveMatrix(b, pose), 0);
  assert.deepEqual(b.matrix, pose);
  registry.activate(b);
  assert.equal(registry.setPassiveMatrix(b, pose), 4);
});

test("PrepareObject's explicit source order updates owned links without reallocating headers", () => {
  const { registry } = setup({
    prepareObject: (_b, owner) => {
      owner.reorderRegisteredBodies(
        [...owner.registeredBodies].sort((a, b) => a.sourceX - b.sourceX),
      );
    },
  });
  registry.setContext({ doingPhysics: true });
  const a = Object.assign(body("a"), { sourceX: 2 }),
    b = Object.assign(body("b"), { sourceX: -1 }),
    c = Object.assign(body("c"), { sourceX: 4 });
  for (const x of [a, b, c]) registry.registerImmediate(x);
  assert.deepEqual(registry.registeredBodies, [b, a, c]);
  assert.deepEqual([a.header.index, b.header.index, c.header.index], [0, 1, 2]);
  assert.equal(a.previous, b);
  assert.equal(a.next, c);
  assert.throws(
    () => registry.reorderRegisteredBodies([a, a, c]),
    /each registered body once/,
  );
  assert.deepEqual(registry.registeredBodies, [b, a, c]);
  registry.remove(a);
  assert.deepEqual(registry.registeredBodies, [b, c]);
});

test("disabled/replay, deferred phases and missing source outlets are explicit; no manufactured successful header", () => {
  const x = setup(),
    b = body("b");
  x.registry.setContext({ disabled: true });
  for (const run of [
    () => x.registry.registerImmediate(b),
    () => x.registry.remove(b),
    () => x.registry.activate(b),
  ])
    assert.throws(run, /disabled\/replay ownership/);
  assert.equal(x.registry.count, 0);
  x.registry.setContext({ munging: true });
  assert.throws(() => x.registry.addActive(b), /deferred PHIL union/);
  assert.equal(x.registry.count, 0);
  assert.equal(x.registry.addActiveImmediate(b), 0);
  const noPrepare = setup();
  noPrepare.registry.setContext({ doingPhysics: true });
  assert.throws(
    () => noPrepare.registry.registerImmediate(body("x")),
    /PrepareObject/,
  );
  assert.equal(noPrepare.registry.count, 0);
  const noActivate = setup({ onActivated: undefined });
  assert.throws(
    () => noActivate.registry.addActive(body("x")),
    /activation4ff2c0/,
  );
  assert.equal(noActivate.registry.count, 0);
  const noVelocity = setup({ writeVelocity: undefined });
  noVelocity.registry.registerImmediate(b);
  assert.throws(
    () => noVelocity.registry.activate(b, { velocity: [0, 0, 0] }),
    /velocity writer/,
  );
  assert.equal(noVelocity.registry.getState(b), 1);
});

test("invalid source flags, vectors, matrices and identities fail before normal ownership mutation", () => {
  const { registry } = setup();
  assert.throws(() => registry.registerImmediate(null), /body identity/);
  assert.throws(
    () => registry.registerImmediate(body("bad flags", -1)),
    /PHIL flags/,
  );
  assert.equal(registry.count, 0);
  const b = body("b");
  registry.registerImmediate(b);
  assert.throws(
    () => registry.activate(b, { velocity: [Infinity, 0, 0] }),
    /Non-finite/,
  );
  assert.equal(registry.getState(b), 1);
  assert.throws(() => registry.setPassiveMatrix(b, [1, 2, 3]), /native12/);
  assert.throws(() => registry.setContext({ doingPhysics: 1 }), /context/);
});
