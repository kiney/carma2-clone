import test from "node:test";
import assert from "node:assert/strict";
import {
  selectOpponentIds,
  selectNativeOpponentRoster,
} from "../src/opponent-selection.ts";
import { NativeRandom } from "../src/native-random.ts";
const catalog = [1, 1, 1, 2, 3].map((strengthRating) => ({ strengthRating }));

test("native random roster draws candidate then ranking for each filler; explicit slots draw nothing", () => {
  const raw = [0, 32767, 32767, 0],
    calls = [];
  const rows = selectNativeOpponentRoster([3, -1, 3, -1], catalog, 99, () => {
    const n = raw[calls.length];
    calls.push(n);
    return n / 32768;
  });
  assert.deepEqual(rows, [
    { id: 3, ranking: -1 },
    { id: 0, ranking: 99 },
    { id: 3, ranking: -3 },
    { id: 2, ranking: 0 },
  ]);
  assert.deepEqual(calls, raw);
});

test("ChooseOpponent quantizes continuous callbacks to the native15-bit integer before the bound", () => {
  let calls = 0;
  assert.deepEqual(
    selectOpponentIds([-1], catalog, 99, () => {
      calls++;
      return 1 / 3;
    }),
    [0],
  );
  assert.equal(calls, 2);
});

test("retained rankings match independent CRT recurrence without changing explicit duplicate eligibility", () => {
  const stream = new NativeRandom(1);
  const rows = selectNativeOpponentRoster(
    [4, 4, -1, -1],
    catalog,
    99,
    stream.random,
  );
  assert.deepEqual(rows, [
    { id: 4, ranking: -1 },
    { id: 4, ranking: -2 },
    { id: 0, ranking: 56 },
    { id: 1, ranking: 80 },
  ]);
  assert.equal(stream.state, 3884216597);
});

test("invalid native roster samples fail in either candidate or ranking draw", () => {
  for (const index of [0, 1])
    for (const invalid of [NaN, Infinity, -0.1, 1]) {
      let calls = 0;
      assert.throws(
        () =>
          selectNativeOpponentRoster([-1], catalog, 99, () =>
            calls++ === index ? invalid : 0,
          ),
        /random/,
      );
      assert.equal(calls, index + 1);
    }
});
