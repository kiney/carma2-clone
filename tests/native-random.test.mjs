import test from "node:test";
import assert from "node:assert/strict";
import { NativeRandom } from "../src/native-random.ts";

test("installed CRT seed1 sequence and state overflow match its 32-bit recurrence", () => {
  const random = new NativeRandom();
  assert.equal(random.state, 1);
  assert.deepEqual(
    Array.from({ length: 10 }, () => random.nextInteger()),
    [41, 18467, 6334, 26500, 19169, 15724, 11478, 29358, 26962, 24464],
  );
  const seed = 0xffffffff;
  random.seed(seed);
  const expectedState = Number(
    (BigInt(seed) * 214013n + 2531011n) & 0xffffffffn,
  );
  assert.equal(random.nextInteger(), (expectedState >>> 16) & 0x7fff);
  assert.equal(random.state, expectedState);
});

test("captured physics ticks reseed the shared stream and expose native 15-bit fractions", () => {
  const random = new NativeRandom(40);
  const expected = random.random();
  random.nextInteger();
  random.seed(40);
  assert.equal(random.random(), expected);
  assert.equal(expected * 32768, Math.trunc(expected * 32768));
  assert.ok(expected >= 0 && expected < 1);
  assert.throws(() => random.seed(NaN), /seed/);
});
