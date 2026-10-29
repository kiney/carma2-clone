import assert from "node:assert/strict";
import test from "node:test";
import {
  activeNativePedBloodPacket,
  createNativePedImpactBloodPacket,
  accumulateNativePedWorldSmear,
  consumeNativePedWorldSmear,
  createNativePedSpurtBloodPacket,
  processNativePedBleeding,
  nativePedBloodCacheOffsets,
} from "../src/ped-native-blood-phases.ts";

const f = Math.fround;
const identity = (position = [0, 0, 0]) =>
  Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, ...position]);
function cache() {
  const bytes = new Uint8Array(0x12c);
  return { bytes, view: new DataView(bytes.buffer) };
}
const read = (view, at) => [0, 4, 8].map((i) => view.getFloat32(at + i, true));
const impact = (extra = {}) => ({
  goreLevel: 1,
  volumeGravity: null,
  effectiveLambda: 0.25,
  simpleMass: f(0.068),
  point: [1.5, -2.2, 3.8],
  pedestrianPosition: [9, 8, 7],
  velocity: [1, -2, 3],
  other: null,
  pedAddress: 10,
  timeMs: 100,
  startSize: 0,
  ...extra,
});
const smear = (extra = {}) => ({
  goreLevel: 2,
  volumeGravity: null,
  hitPoints: 0,
  otherPresent: false,
  point: [0, 0, 1],
  velocity: [1, 0, 0],
  face: { normal: [0, 1, 0] },
  ...extra,
});
function newBatch(view) {
  // Source process-cache visit clears only this per-Munge batch bit.
  view.setUint32(0xc4, view.getUint32(0xc4, true) & ~2, true);
}
function bleeding(extra = {}) {
  const c = cache();
  c.view.setUint32(0x84, 100, true);
  c.view.setUint8(0x24, 10);
  const packets = [],
    observations = [];
  const root = Float32Array.from([0, 1, 0, -1, 0, 0, 0, 0, 1, 10, 20, 30]);
  const snapshots = new Map([
    [0, { matrix: root, velocity: null }],
    [1, { matrix: identity([2, 3, 4]), velocity: [1, 2, 3] }],
    [2, { matrix: identity([5, 6, 7]), velocity: [0, 0, 0] }],
  ]);
  const input = {
    processStorage: c.bytes,
    timeMs: 201,
    hitPoints: 100,
    action: 5,
    mutantSpeed: 0,
    removedBoneMask: 2,
    vanishedBoneMask: 0,
    pedestrianPosition: [1, 2, 3],
    pedAddress: 100,
    bodyVelocity: [2, 0, 0],
    characterVelocity: [4, 5, 6],
    scrapeStart: 0,
    lumpsPerEmission: 5,
    bones: [
      { parent: 0, childAttachment: null, parentAttachment: null },
      { parent: 0, childAttachment: [1, 0, 0], parentAttachment: [0, 1, 0] },
    ],
    goreLevel: 1,
    volumeGravity: null,
    globals: { lastMutantBleedTimeMs: 0 },
    ...extra,
  };
  let draws = 0;
  const host = {
    readBone: (index) => snapshots.get(index) ?? null,
    nextCrtInteger: () => {
      draws++;
      return 0;
    },
    emit: (packet) => {
      observations.push({
        period: c.view.getUint32(0x84, true),
        time: c.view.getUint32(0x88, true),
        counter: c.view.getUint8(0x24),
      });
      packets.push(packet);
    },
  };
  return {
    ...c,
    input,
    host,
    packets,
    observations,
    snapshots,
    draws: () => draws,
  };
}

test("active source force uses effective lambda and squared selected simple mass, not force length", () => {
  const p = activeNativePedBloodPacket(impact());
  assert.equal(p.force, 0.2499999701976776);
  assert.equal(
    activeNativePedBloodPacket(impact({ simpleMass: f(0.136) })).force,
    0.0624999925494194,
  );
  assert.deepEqual(
    p.velocity,
    [6.900000095367432, -13.800000190734863, 20.700000762939453],
  );
  assert.deepEqual(p.point, [1.5, f(-2.2), f(3.8)]);
  assert.deepEqual(p.pedestrianPosition, [9, 8, 7]);
  assert.equal(p.seed, (1 ^ -2 ^ 3 ^ 100 ^ 10) >>> 0);
  const other = activeNativePedBloodPacket(
    impact({ other: { address: 20, velocity: [4, 0, 0] } }),
  );
  assert.deepEqual(other.velocity, [f(27.6), 0, 0]);
  assert.equal(other.seed, (p.seed ^ 20) >>> 0);
  assert.equal(
    activeNativePedBloodPacket(impact({ goreLevel: 0, point: null })),
    null,
  );
  assert.equal(
    activeNativePedBloodPacket(impact({ volumeGravity: f(0.999) })),
    null,
  );
  assert.ok(activeNativePedBloodPacket(impact({ volumeGravity: 1 })));
});

test("DoGiblets packet keeps source start size and NULL optional velocity owner", () => {
  const packet = createNativePedImpactBloodPacket({
    ...impact(),
    force: f(0.4),
    startSize: 1,
  });
  assert.equal(packet.startSize, 1);
  assert.equal(packet.force, f(0.4));
  assert.equal(packet.timeMs, 100);
  assert.throws(
    () =>
      createNativePedImpactBloodPacket({
        ...impact(),
        force: 1,
        pedAddress: undefined,
      }),
    /address/,
  );
  assert.throws(
    () => activeNativePedBloodPacket(impact({ simpleMass: 0 })),
    /mass/,
  );
});

test("world corpse contacts retain native sums, plane, lateral extrema and process bits", () => {
  const c = cache();
  c.view.setUint32(0xc4, 0x80, true);
  assert.equal(accumulateNativePedWorldSmear(c.bytes, smear()).collected, true);
  assert.deepEqual(read(c.view, 0x114), [0, 0, -1]);
  accumulateNativePedWorldSmear(c.bytes, smear({ point: [2, 0, 3] }));
  assert.equal(c.view.getUint32(0xc4, true), 0x82);
  assert.equal(c.view.getUint8(0xca), 2);
  assert.deepEqual(read(c.view, 0xe4), [2, 0, 4]);
  assert.deepEqual(read(c.view, 0xf0), [0, 1, 0]);
  assert.equal(c.view.getFloat32(0x124, true), -1);
  assert.equal(c.view.getFloat32(0x128, true), -3);
  const zero = cache();
  accumulateNativePedWorldSmear(zero.bytes, smear({ velocity: [0, 0, 0] }));
  assert.deepEqual(
    read(zero.view, 0x114),
    [0, 0, -1],
    "zero-speed fallback is positive X",
  );
});

test("world smear excludes the native material filters, living/other/low-gravity contacts", () => {
  for (const extra of [
    { hitPoints: 1 },
    { otherPresent: true },
    { goreLevel: 0 },
    { volumeGravity: 0.5 },
    { face: { normal: [0, 1, 0], pixelmapType: 0x12 } },
    { face: { normal: [0, 1, 0], materialName: "abcde|ghijkl" } },
  ]) {
    const c = cache(),
      before = c.bytes.slice();
    assert.equal(
      accumulateNativePedWorldSmear(c.bytes, smear(extra)).collected,
      false,
    );
    assert.deepEqual(c.bytes, before);
  }
  assert.deepEqual(
    accumulateNativePedWorldSmear(null, smear()).requiredProviders,
    ["native-blood-process-cache"],
  );
  assert.deepEqual(
    accumulateNativePedWorldSmear(cache().bytes, smear({ face: null }))
      .requiredProviders,
    ["native-blood-world-face"],
  );
});

test("additional smear contacts require strict normal and coplanarity gates", () => {
  const c = cache();
  accumulateNativePedWorldSmear(c.bytes, smear());
  const before = c.bytes.slice();
  assert.equal(
    accumulateNativePedWorldSmear(
      c.bytes,
      smear({ face: { normal: [0, f(0.997), 0] } }),
    ).collected,
    false,
  );
  assert.deepEqual(c.bytes, before);
  assert.equal(
    accumulateNativePedWorldSmear(c.bytes, smear({ point: [0, f(0.01), 2] }))
      .collected,
    false,
  );
  assert.deepEqual(c.bytes, before);
  assert.equal(
    accumulateNativePedWorldSmear(c.bytes, smear({ point: [0, f(0.009), 2] }))
      .collected,
    true,
  );
});

test("native smear BYTE count wraps and the zero-count batch cannot form a section", () => {
  const c = cache();
  accumulateNativePedWorldSmear(c.bytes, smear());
  c.view.setUint8(0xca, 255);
  accumulateNativePedWorldSmear(c.bytes, smear());
  assert.equal(c.view.getUint8(0xca), 0);
  c.view.setUint32(0xc4, 3, true);
  consumeNativePedWorldSmear(c.bytes, true, {
    skidSection: () => {
      throw new Error("zero-count batch must not render");
    },
  });
  assert.equal(c.view.getUint32(0xc4, true), 2);
  assert.equal(
    accumulateNativePedWorldSmear(c.bytes, smear()).collected,
    true,
    "native C0-only plane comparison accepts unordered0/0 after count wrap",
  );
  assert.equal(c.view.getUint8(0xca), 1);
});

test("LastChance arms one batch then sends source +.01 width and retained section state", () => {
  const c = cache(),
    sections = [];
  const contacts = (offset) => {
    accumulateNativePedWorldSmear(c.bytes, smear({ point: [offset, 0, 1] }));
    accumulateNativePedWorldSmear(
      c.bytes,
      smear({ point: [offset + 2, 0, 3] }),
    );
  };
  const host = {
    skidSection: (section) => {
      sections.push(section);
      return {
        stop: false,
        id: 7,
        start: section.previousPosition,
        end: section.position,
      };
    },
  };
  contacts(0);
  assert.equal(consumeNativePedWorldSmear(c.bytes, true, host).emitted, 0);
  assert.equal(c.view.getInt16(0xc8, true), -1);
  assert.deepEqual(read(c.view, 0xfc), [1, 0, 2]);
  assert.equal(
    c.view.getUint32(0xc4, true),
    3,
    "LastChance retains batch bit until next Munge",
  );
  newBatch(c.view);
  contacts(4);
  assert.equal(consumeNativePedWorldSmear(c.bytes, true, host).emitted, 1);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].id, -1);
  assert.equal(sections[0].totalDistance, 0);
  assert.equal(sections[0].width, f(2 + f(0.01)));
  assert.deepEqual(sections[0].previousPosition, [1, 0, 2]);
  assert.deepEqual(sections[0].position, [5, 0, 2]);
  assert.equal(c.view.getInt16(0xc8, true), 7);
  assert.deepEqual(read(c.view, 0xcc), [1, 0, 2]);
  newBatch(c.view);
  contacts(8);
  consumeNativePedWorldSmear(c.bytes, true, {
    skidSection: (section) => ({
      stop: true,
      id: -1,
      start: section.start,
      end: section.end,
    }),
  });
  assert.equal(c.view.getUint32(0xc4, true), 2);
  assert.deepEqual(read(c.view, 0xfc), [9, 0, 2]);
});

test("LastChance skips unprocessed pedestrians, clears interrupted trails and reports absent section owner", () => {
  const c = cache();
  c.view.setUint32(0xc4, 1, true);
  consumeNativePedWorldSmear(c.bytes, false, {});
  assert.equal(c.view.getUint32(0xc4, true), 1);
  consumeNativePedWorldSmear(c.bytes, true, {});
  assert.equal(c.view.getUint32(0xc4, true), 0);
  accumulateNativePedWorldSmear(c.bytes, smear());
  accumulateNativePedWorldSmear(c.bytes, smear());
  consumeNativePedWorldSmear(c.bytes, true, {});
  const before = c.bytes.slice();
  assert.deepEqual(
    consumeNativePedWorldSmear(c.bytes, true, {}).requiredProviders,
    ["native-blood-shared-skid-section"],
  );
  assert.deepEqual(c.bytes, before);
  assert.throws(
    () => accumulateNativePedWorldSmear(new Uint8Array(4), smear()),
    /0x12c/,
  );
  assert.equal(nativePedBloodCacheOffsets.minimum, 0x128);
});

test("DoSpurt transforms attachment/look without normalization and converts velocity exactly once", () => {
  const m = Float32Array.from([2, 0, 0, 0, 3, 0, 0, 0, 4, 10, 20, 30]);
  const packet = createNativePedSpurtBloodPacket({
    matrix: m,
    attachment: [1, 2, 3],
    look: [2, 0, 0],
    velocity: [1, 0, 0],
    timeMs: 100,
  });
  assert.deepEqual(packet.point, [12, 26, 42]);
  assert.deepEqual(packet.direction, [4, 0, 0]);
  assert.deepEqual(packet.velocity, [f(6.9), 0, 0]);
  assert.equal(packet.seed, (12 ^ 26 ^ 42 ^ 100) >>> 0);
});

test("MakeEmBleed emits detached then parent with source root look transformed twice", () => {
  const h = bleeding();
  const result = processNativePedBleeding(h.input, h.host);
  assert.deepEqual(result.requiredProviders, []);
  assert.equal(result.emitted, 2);
  assert.equal(result.randomDraws, 0);
  assert.deepEqual(h.packets[0].point, [3, 3, 4]);
  assert.deepEqual(h.packets[0].direction, [1, 0, 0]);
  assert.deepEqual(h.packets[0].velocity, [f(6.9), f(13.8), f(20.7)]);
  assert.deepEqual(h.packets[1].point, [9, 20, 30]);
  assert.deepEqual(h.packets[1].direction, [0, -1, 0]);
  assert.deepEqual(h.packets[1].velocity, [f(27.6), f(34.5), f(41.4)]);
  assert.deepEqual(
    h.observations,
    Array(2).fill({ period: 100, time: 201, counter: 5 }),
  );
  assert.equal(
    processNativePedBleeding(h.input, h.host).emitted,
    0,
    "same timestamp fails the strict next-period gate",
  );
});

test("dead stump period uses double1.2 and counter subtraction wraps BYTE", () => {
  const h = bleeding({ hitPoints: 0, action: 6 });
  h.view.setUint8(0x24, 1);
  processNativePedBleeding(h.input, h.host);
  assert.equal(h.view.getUint32(0x84, true), 120);
  assert.equal(h.view.getUint8(0x24), 252);
  assert.equal(h.packets.length, 2);
  assert.ok(
    h.observations.every(
      (value) => value.counter === 252 && value.period === 120,
    ),
  );
});

test("stationary detached counter exhaustion does not suppress the intact parent side", () => {
  const h = bleeding({ hitPoints: 0, action: 6, characterVelocity: [0, 0, 0] });
  h.snapshots.get(1).velocity = [0, 0, 0];
  h.view.setUint8(0x24, 4);
  processNativePedBleeding(h.input, h.host);
  assert.equal(h.view.getUint8(0x24), 0);
  assert.equal(h.packets.length, 1);
  assert.deepEqual(h.packets[0].point, [9, 20, 30]);
  const expired = bleeding({
    timeMs: 2000,
    hitPoints: 0,
    action: 6,
    characterVelocity: [0, 0, 0],
  });
  expired.view.setUint32(0x84, 1000, true);
  expired.view.setUint8(0x24, 4);
  expired.snapshots.get(1).velocity = [0, 0, 0];
  assert.equal(
    processNativePedBleeding(expired.input, { readBone: expired.host.readBone })
      .emitted,
    0,
  );
  assert.equal(expired.view.getUint32(0x84, true), 0);
  assert.equal(expired.view.getUint32(0x88, true), 2000);
});

test("removed parent side observes the already decremented child counter", () => {
  for (const [counter, expected] of [
    [5, 1],
    [10, 2],
  ]) {
    const h = bleeding({
      removedBoneMask: 6,
      vanishedBoneMask: 2,
      bones: [
        { parent: 0, childAttachment: null, parentAttachment: null },
        { parent: 0, childAttachment: [1, 0, 0], parentAttachment: [0, 1, 0] },
        { parent: 1, childAttachment: [1, 0, 0], parentAttachment: [0, 1, 0] },
      ],
    });
    h.view.setUint8(0x25, counter);
    h.snapshots.get(2).velocity = [1, 0, 0];
    processNativePedBleeding(h.input, h.host);
    assert.equal(h.packets.length, expected);
    assert.equal(h.view.getUint8(0x25), counter - 5);
    if (expected === 2)
      assert.deepEqual(h.packets[1].velocity, [f(6.9), f(13.8), f(20.7)]);
  }
});

test("mutant corpse bleeding uses a shared strict300ms clock and exact40 percent draw", () => {
  const h = bleeding({
    removedBoneMask: 0,
    processStorage: null,
    mutantSpeed: 2,
    hitPoints: 0,
    action: 6,
    timeMs: 300,
  });
  processNativePedBleeding(h.input, h.host);
  assert.equal(h.draws(), 0);
  h.input.timeMs = 301;
  h.host.nextCrtInteger = () => 13108;
  assert.equal(processNativePedBleeding(h.input, h.host).emitted, 0);
  assert.equal(h.input.globals.lastMutantBleedTimeMs, 0);
  h.host.nextCrtInteger = () => 13107;
  const result = processNativePedBleeding(h.input, h.host);
  assert.equal(result.randomDraws, 1);
  assert.equal(h.input.globals.lastMutantBleedTimeMs, 301);
  assert.equal(h.packets[0].kind, "impact");
  assert.equal(h.packets[0].force, f(0.06));
  assert.deepEqual(h.packets[0].velocity, [f(13.8), 0, 0]);
  const nextPed = bleeding({ ...h.input, timeMs: 500 });
  assert.equal(
    processNativePedBleeding(nextPed.input, nextPed.host).randomDraws,
    0,
  );
});

test("unsigned time wrap, zero-period corpse state and strict timer equality follow source", () => {
  const h = bleeding({ timeMs: 0x80 });
  h.view.setUint32(0x88, 0xfffffff0, true);
  assert.equal(processNativePedBleeding(h.input, h.host).emitted, 2);
  const equality = bleeding({ timeMs: 100 });
  assert.equal(
    processNativePedBleeding(equality.input, equality.host).emitted,
    0,
  );
  const mutant = bleeding({
    timeMs: 0x130,
    processStorage: null,
    removedBoneMask: 0,
    mutantSpeed: 1,
    hitPoints: 0,
    action: 6,
    globals: { lastMutantBleedTimeMs: 0xfffffff0 },
  });
  assert.equal(processNativePedBleeding(mutant.input, mutant.host).emitted, 1);
});

test("post-pose emissions preserve mutant then timer/counter then child/parent chronology", () => {
  const h = bleeding({ timeMs: 400, mutantSpeed: 1, hitPoints: 0, action: 6 });
  processNativePedBleeding(h.input, h.host);
  assert.deepEqual(
    h.packets.map((packet) => packet.kind),
    ["impact", "spurt", "spurt"],
  );
  assert.deepEqual(h.observations[0], { period: 100, time: 0, counter: 10 });
  assert.deepEqual(h.observations[1], { period: 120, time: 400, counter: 5 });
  assert.equal(h.draws(), 1);
});

test("missing providers preflight before shared RNG, source timers and stump counters", () => {
  for (const change of [
    (h) => {
      h.host.readBone = undefined;
    },
    (h) => {
      h.host.emit = undefined;
    },
    (h) => {
      h.host.nextCrtInteger = undefined;
    },
    (h) => {
      h.host.preflightPacket = () => ["actual-fragment-pool-owner"];
    },
    (h) => {
      h.snapshots.get(1).matrix = null;
    },
  ]) {
    const h = bleeding({
      timeMs: 400,
      mutantSpeed: 1,
      hitPoints: 0,
      action: 6,
    });
    change(h);
    const before = h.bytes.slice();
    assert.ok(
      processNativePedBleeding(h.input, h.host).requiredProviders.length,
    );
    assert.deepEqual(h.bytes, before);
    assert.equal(h.input.globals.lastMutantBleedTimeMs, 0);
    assert.equal(h.draws(), 0);
    assert.equal(h.packets.length, 0);
  }
});

test("gore and selected low-gravity gates skip all bleeding providers and cache mutations", () => {
  for (const extra of [{ goreLevel: 0 }, { volumeGravity: 0.5 }]) {
    const h = bleeding({
      ...extra,
      timeMs: 400,
      mutantSpeed: 1,
      hitPoints: 0,
      action: 6,
    });
    const before = h.bytes.slice();
    assert.deepEqual(processNativePedBleeding(h.input, {}), {
      requiredProviders: [],
      emitted: 0,
      randomDraws: 0,
    });
    assert.deepEqual(h.bytes, before);
  }
});
