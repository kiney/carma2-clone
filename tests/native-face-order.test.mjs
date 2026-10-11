import test from "node:test";
import assert from "node:assert/strict";
import { prepareNativeFaceOrder } from "../src/native-face-order.ts";

const evidence = "Installed 527a50/51fe80 invented-key capture";
function order(keys, kind = "native-pointers") {
  const result = prepareNativeFaceOrder(keys.length, { kind, keys, evidence });
  assert.equal(result.resolved, true);
  return result;
}

test("installed equal-material shortsort rotates original faces instead of retaining stable DAT order", () => {
  for (let count = 2; count <= 8; count++) {
    const result = order(Array(count).fill(4096));
    assert.deepEqual(result.faceOrder, [
      ...Array.from({ length: count - 1 }, (_, i) => i + 1),
      0,
    ]);
    assert.deepEqual(result.groups, [
      { groupIndex: 0, materialKey: 4096, faceStart: 0, faceCount: count },
    ]);
  }
  assert.deepEqual(order([4096, 4096, 4096, 4096]).faceOrder, [1, 2, 3, 0]);
});

test("installed 8/9 threshold switches from selection permutation to middle-pivot permutation", () => {
  assert.deepEqual(
    order(Array(8).fill(4096)).faceOrder,
    [1, 2, 3, 4, 5, 6, 7, 0],
  );
  assert.deepEqual(
    order(Array(9).fill(4096)).faceOrder,
    [4, 1, 2, 3, 0, 5, 6, 7, 8],
  );
  assert.deepEqual(
    order(Array(12).fill(4096)).faceOrder,
    [6, 1, 2, 3, 4, 5, 0, 7, 8, 9, 10, 11],
  );
});

// Captured from installed comparator + BrQsort. Keys/indices are invented data,
// generated with private seed981341; no original model geometry is retained.
for (const [caseId, keys, expected] of [
  [
    64,
    [
      4096, 4224, 4352, 4096, 4224, 4352, 4096, 4224, 4352, 4096, 4224, 4352,
      4096, 4224, 4352,
    ],
    [6, 12, 3, 9, 0, 4, 1, 7, 10, 13, 11, 2, 5, 14, 8],
  ],
  [
    65,
    [
      4096, 4864, 4736, 4608, 4480, 4352, 4224, 4096, 4864, 4736, 4608, 4480,
      4352, 4224, 4096, 4864, 4736, 4608, 4480, 4352, 4224,
    ],
    [14, 0, 7, 20, 6, 13, 19, 12, 5, 18, 11, 4, 3, 10, 17, 16, 2, 9, 8, 1, 15],
  ],
  [
    75,
    [0, 128, 0, 128, 0, 128, 0, 128, 0, 128],
    [6, 2, 0, 4, 8, 3, 7, 1, 5, 9],
  ],
  [
    85,
    [
      4096, 4864, 4736, 4608, 4480, 4352, 4224, 4096, 4864, 4736, 4608, 4480,
      4352, 4224,
    ],
    [7, 0, 13, 6, 12, 5, 11, 4, 10, 3, 9, 2, 1, 8],
  ],
]) {
  test(`installed seeded mixed-material case${caseId} preserves equal-key permutation`, () => {
    const result = order(keys);
    assert.deepEqual(result.faceOrder, expected);
    const groupKeys = result.groups.map((group) => group.materialKey);
    assert.deepEqual(
      groupKeys,
      [...new Set(keys)].sort((a, b) => a - b),
    );
    for (const group of result.groups) {
      const faces = result.faceOrder.slice(
        group.faceStart,
        group.faceStart + group.faceCount,
      );
      assert.ok(faces.every((index) => keys[index] === group.materialKey));
    }
  });
}

test("NULL group precedes non-NULL unsigned pointer keys, including high-bit addresses", () => {
  const result = order([0xfffffffc, 0, 0x80000000, 4, 0, 0xfffffffc]);
  assert.deepEqual(
    result.faceOrder.map(
      (index) => [0xfffffffc, 0, 0x80000000, 4, 0, 0xfffffffc][index],
    ),
    [0, 0, 4, 0x80000000, 0xfffffffc, 0xfffffffc],
  );
  assert.deepEqual(result.groups, [
    { groupIndex: 0, materialKey: 0, faceStart: 0, faceCount: 2 },
    { groupIndex: 1, materialKey: 4, faceStart: 2, faceCount: 1 },
    { groupIndex: 2, materialKey: 0x80000000, faceStart: 3, faceCount: 1 },
    { groupIndex: 3, materialKey: 0xfffffffc, faceStart: 4, faceCount: 2 },
  ]);
});

test("verified pointer-order ordinals preserve the same permutation without inventing render/name order", () => {
  const keys = [4096, 4352, 4224, 0, 4096, 4224, 4352, 0, 4096, 4352],
    ranks = keys.map((key) =>
      key === 0 ? 0 : key === 4096 ? 1 : key === 4224 ? 2 : 3,
    ),
    pointers = order(keys),
    ordinals = order(ranks, "verified-pointer-order");
  assert.deepEqual(ordinals.faceOrder, pointers.faceOrder);
  assert.equal(ordinals.keySource, "verified-pointer-order");
  assert.equal(ordinals.evidence, evidence);
});

test("unavailable native pointer order returns explicit unresolved metadata without substitute face order", () => {
  assert.deepEqual(
    prepareNativeFaceOrder(300, {
      kind: "unresolved",
      reason: "Native material heap order unavailable",
    }),
    {
      resolved: false,
      reason: "Native material heap order unavailable",
      faceOrder: null,
      groups: null,
    },
  );
});

test("model-count/key/evidence validation rejects malformed metadata and never silently truncates", () => {
  for (const count of [-1, 0.5, 65536, NaN, Infinity])
    assert.throws(
      () =>
        prepareNativeFaceOrder(count, {
          kind: "unresolved",
          reason: "missing",
        }),
      /uint16/,
    );
  for (const key of [-1, 0.5, 2 ** 32, NaN, Infinity, undefined])
    assert.throws(
      () =>
        prepareNativeFaceOrder(1, {
          kind: "native-pointers",
          keys: [key],
          evidence,
        }),
      /unsigned/,
    );
  assert.throws(
    () =>
      prepareNativeFaceOrder(2, {
        kind: "native-pointers",
        keys: [0],
        evidence,
      }),
    /one material key/,
  );
  assert.throws(
    () =>
      prepareNativeFaceOrder(1, {
        kind: "native-pointers",
        keys: [0],
        evidence: " ",
      }),
    /evidence/,
  );
  assert.throws(
    () => prepareNativeFaceOrder(1, { kind: "unresolved", reason: " " }),
    /reason/,
  );
  assert.throws(
    () =>
      prepareNativeFaceOrder(1, {
        kind: "render-first-seen",
        keys: [0],
        evidence,
      }),
    /explicit/,
  );
});

test("empty/single face results are bounded and source material inputs remain unchanged", () => {
  assert.deepEqual(order([]).faceOrder, []);
  assert.deepEqual(order([]).groups, []);
  assert.deepEqual(order([4]).faceOrder, [0]);
  const keys = Object.freeze([0, 8, 4, 8, 0]);
  assert.doesNotThrow(() => order(keys));
  assert.deepEqual(keys, [0, 8, 4, 8, 0]);
});

test("full uint16 model span retains each original index and capacity prefixes are applied after permutation", () => {
  const keys = Array.from({ length: 65535 }, (_, i) => (i % 7) * 128),
    result = order(keys);
  assert.equal(result.faceOrder.length, keys.length);
  assert.equal(new Set(result.faceOrder).size, keys.length);
  assert.equal(
    result.groups.reduce((sum, group) => sum + group.faceCount, 0),
    keys.length,
  );
  for (let i = 1; i < result.faceOrder.length; i++)
    assert.ok(keys[result.faceOrder[i - 1]] <= keys[result.faceOrder[i]]);
  for (const capacity of [76, 300]) {
    const allEqual = order(Array(capacity + 100).fill(4));
    const prefix = allEqual.faceOrder.slice(0, capacity);
    assert.equal(prefix.length, capacity);
    assert.equal(prefix[0], Math.floor((capacity + 100) / 2));
    assert.notDeepEqual(
      prefix,
      Array.from({ length: capacity }, (_, i) => i),
    );
  }
});
