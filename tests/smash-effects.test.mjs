import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseSmashSound,
  chooseSmashAudio,
  nativeSmashStartingVelocity,
} from "../src/smash-effects.ts";
import { Vector3 } from "three";

test("native connotation audio draws fixed-point pitch before its sound alternative", () => {
  const samples = [0, 32767 / 32768];
  let index = 0;
  assert.deepEqual(
    chooseSmashAudio([4100, 4101], () => samples[index++]),
    {
      id: 4101,
      playbackRate: 0.875,
    },
  );
  assert.equal(index, 2);
  index = 0;
  assert.deepEqual(
    chooseSmashAudio([4100], () => {
      index++;
      return 32767 / 32768;
    }),
    { id: 4100, playbackRate: 1.125 },
  );
  assert.equal(index, 2);
  assert.equal(
    chooseSmashAudio([], () => {
      throw new Error("unexpected draw");
    }),
    undefined,
  );
  assert.throws(() => chooseSmashAudio([1], () => NaN), /random/);
  assert.throws(
    () =>
      chooseSmashAudio([-1], () => {
        throw new Error("unexpected draw");
      }),
    /alternatives/,
  );
});

test("native shard queue snapshots metric starting velocity with Float32 stores and car eligibility", () => {
  const start = new Vector3(10, -0.01, 0.1);
  const stored = nativeSmashStartingVelocity(start);
  assert.deepEqual(
    stored.toArray(),
    [69, -0.0689999982714653, 0.6899999976158142],
  );
  start.set(0, 0, 0); // Contact response does not retroactively change the queue.
  assert.equal(stored.x, 69);
  assert.deepEqual(
    nativeSmashStartingVelocity(new Vector3(10, 20, 30), false).toArray(),
    [0, 0, 0],
  );
  assert.throws(
    () => nativeSmashStartingVelocity(new Vector3(Infinity, 0, 0)),
    /Invalid/,
  );
});

test("native smash sound chooses exactly one alternative with 15-bit integer mapping", () => {
  const ids = [4100, 4101, 4102];
  assert.equal(
    chooseSmashSound(ids, () => 0),
    4100,
  );
  assert.equal(
    chooseSmashSound(ids, () => 10922 / 32768),
    4100,
  );
  assert.equal(
    chooseSmashSound(ids, () => 10923 / 32768),
    4101,
  );
  assert.equal(
    chooseSmashSound(ids, () => 32767 / 32768),
    4102,
  );
  let calls = 0;
  assert.equal(
    chooseSmashSound([], () => {
      calls++;
      return 0;
    }),
    undefined,
  );
  assert.equal(calls, 0);
  assert.throws(() => chooseSmashSound(ids, () => 1), /random/);
  assert.throws(() => chooseSmashSound([-1]), /alternatives/);
});
