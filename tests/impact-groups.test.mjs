import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  groupNativeImpactRows,
  NATIVE_IMPACT_MINIMUM_LAMBDA,
} from "../src/physics/impact-groups.ts";

function row(a, b, normal = [1, 0, 0], lambda = 1, extras = {}) {
  return {
    a,
    b,
    normal: new Vector3(...normal),
    normalImpulse: lambda,
    point: new Vector3(),
    tangentImpulse: new Vector3(),
    closingSpeed: 0,
    ...extras,
  };
}

test("native impact grouping uses strict same and reversed normal boundaries", () => {
  const a = {},
    b = {};
  const bound = Math.fround(0.707107);
  const y = Math.sqrt(1 - bound * bound);
  const seed = row(a, b);
  const equal = row(a, b, [bound, y, 0]);
  const above = row(a, b, [bound + 2 ** -24, y, 0]);
  assert.deepEqual(
    groupNativeImpactRows([seed, equal, above]).map((g) => g.rows),
    [[seed, above], [equal]],
  );
  const reversedEqual = row(b, a, [-bound, -y, 0]);
  const reversedAbove = row(b, a, [-bound - 2 ** -24, -y, 0]);
  assert.deepEqual(
    groupNativeImpactRows([seed, reversedEqual, reversedAbove]).map(
      (g) => g.rows,
    ),
    [[seed, reversedAbove], [reversedEqual]],
  );
});

test("native impact grouping greedily scans ahead with zero rows consuming four slots", () => {
  const a = {},
    b = {},
    c = {};
  const seed = row(a, b, undefined, 0);
  const foreign = row(a, c);
  const rows = [
    seed,
    foreign,
    row(a, b, undefined, 0),
    row(a, b),
    row(b, a, [-1, 0, 0]),
    row(a, b),
  ];
  const groups = groupNativeImpactRows(rows);
  assert.deepEqual(
    groups.map((g) => g.rows),
    [[rows[0], rows[2], rows[3], rows[4]], [foreign], [rows[5]]],
  );
  assert.equal(groups[0].totalLambda, 2);
  assert.equal(groups[0].a, a);
  assert.equal(groups[0].b, b);
});

test("native normal comparison retains live products above a rounded threshold tie", () => {
  const a = {},
    b = {};
  const seed = row(a, b, [0.9995500445365906, 0.029995501041412354, 0]);
  const candidate = row(a, b, [0.6855788230895996, 0.7279984354972839, 0]);
  const liveDot =
    seed.normal.x * candidate.normal.x + seed.normal.y * candidate.normal.y;
  assert.equal(Math.fround(liveDot), Math.fround(0.707107));
  assert.ok(liveDot > Math.fround(0.707107));
  assert.deepEqual(groupNativeImpactRows([seed, candidate])[0].rows, [
    seed,
    candidate,
  ]);
});

test("native impact groups retain seed orientation and row impulse signs", () => {
  const a = {},
    b = {};
  const first = row(b, a, [-1, 0, 0], 2);
  const second = row(a, b, [1, 0, 0], 3);
  const [group] = groupNativeImpactRows([first, second]);
  assert.equal(group.a, b);
  assert.equal(group.b, a);
  assert.deepEqual(group.rows, [first, second]);
  assert.deepEqual(
    group.rows.map((r) => r.normal.x * r.normalImpulse),
    [-2, 3],
  );
  assert.equal(group.totalLambda, 5);
  const [opposite] = groupNativeImpactRows([second, first]);
  assert.equal(opposite.a, a);
  assert.deepEqual(opposite.rows, [second, first]);
});

test("browser invalidated type9 rows cannot seed or consume primitive slots", () => {
  const a = {},
    b = {};
  const invalid = row(a, b, [NaN, 0, 0], NaN, { sourceType: 9 });
  const live = Array.from({ length: 4 }, () => row(a, b));
  assert.deepEqual(groupNativeImpactRows([invalid, ...live])[0].rows, live);
  assert.deepEqual(groupNativeImpactRows([invalid]), []);
});

test("native impact groups retain rest, low and zero impulses for consumer threshold", () => {
  const a = {},
    b = {},
    c = {},
    d = {};
  const threshold = row(a, b, undefined, Math.fround(0.02));
  const above = row(a, c, undefined, Math.fround(0.02) + 2 ** -29);
  const zero = row(a, d, undefined, 0);
  const groups = groupNativeImpactRows([threshold, above, zero]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].totalLambda, NATIVE_IMPACT_MINIMUM_LAMBDA);
  assert.deepEqual(
    groups
      .filter((g) => g.totalLambda > NATIVE_IMPACT_MINIMUM_LAMBDA)
      .map((g) => g.rows),
    [[above]],
  );
  assert.equal(groups[2].totalLambda, 0);
  assert.deepEqual(
    groupNativeImpactRows([
      row(a, b, undefined, 0.01),
      row(a, b, undefined, 0.01),
    ])[0].rows.length,
    2,
  );
});

test("native impact lambda rounds every operand and accumulator store", () => {
  const a = {},
    b = {};
  const rows = [row(a, b, undefined, 2 ** 24), row(a, b), row(a, b)];
  assert.equal(groupNativeImpactRows(rows)[0].totalLambda, 2 ** 24);
  assert.equal(
    rows.reduce((sum, r) => sum + r.normalImpulse, 0),
    2 ** 24 + 2,
  );
  assert.equal(
    groupNativeImpactRows([row(a, b, undefined, 0.1)])[0].totalLambda,
    Math.fround(0.1),
  );
});

test("native impact grouping rejects invalid live numerical inputs", () => {
  const a = {},
    b = {};
  for (const lambda of [-1, Infinity, NaN, 2 ** 128])
    assert.throws(
      () => groupNativeImpactRows([row(a, b, undefined, lambda)]),
      /lambda/,
    );
  for (const normal of [
    [0, 0, 0],
    [Infinity, 0, 0],
    [2, 0, 0],
    [1.001, 0, 0],
  ])
    assert.throws(() => groupNativeImpactRows([row(a, b, normal)]), /normal/);
  assert.throws(() => groupNativeImpactRows([row(a, a)]), /distinct/);
  assert.throws(
    () =>
      groupNativeImpactRows([
        row(a, b, undefined, 3e38),
        row(a, b, undefined, 3e38),
      ]),
    /bounds/,
  );
});

test("native impact grouping retains captured Float32 rotated sphere normal", () => {
  const a = {},
    b = {};
  // Actual Stock Blokebl HEAD type3 contact in Chromium, not a normalized fixture.
  const normal = [
    -1.7029471166551957e-8, 1.0000001192092896, 1.170059604760354e-8,
  ];
  const sphere = row(a, undefined, normal, 0.03, { sourceType: 3 });
  const peer = row(a, undefined, [0, 1, 0], 0.04, { sourceType: 3 });
  const [group] = groupNativeImpactRows([sphere, peer]);
  assert.deepEqual(group.rows, [sphere, peer]);
  assert.deepEqual(sphere.normal.toArray(), normal);
  assert.equal(
    group.totalLambda,
    Math.fround(Math.fround(0.03) + Math.fround(0.04)),
  );
});
