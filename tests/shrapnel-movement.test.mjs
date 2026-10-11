import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { NativeRandom } from "../src/native-random.ts";
import { nativeShrapnelMovement } from "../src/shrapnel-movement.ts";

function fixture(overrides = {}) {
  return {
    speed: {
      towards: [0, 0],
      impacteeVelocityFactor: 0,
      randomVelocityMax: 0,
      randomUpVelocityMax: 0,
      randomNormalVelocityMax: 0,
      randomSpinRateMax: 0,
    },
    impacteeVelocity: new Vector3(),
    normal: new Vector3(),
    sizeFactor: 1,
    random: () => 0.5,
    ...overrides,
  };
}
function sequence(values) {
  let used = 0;
  return {
    random: () => {
      assert.ok(used < values.length, "source consumes no extra draws");
      return values[used++];
    },
    get used() {
      return used;
    },
  };
}

test("all-zero ranges still consume thirteen interleaved source draws", () => {
  const rng = sequence(Array(13).fill(0));
  const packet = nativeShrapnelMovement(fixture({ random: rng.random }));
  assert.equal(rng.used, 13);
  assert.deepEqual(packet.velocity.toArray(), [0, 0, 0]);
  assert.ok(packet.spin.toArray().every((value) => value === 0));
});

test("authored scatter, normalized normal and independent spin use native stores", () => {
  const rng = sequence([
    0, 0.25, 0.5, 0.5, 0.75, 0.75, 0.25, 0.5, 0.25, 0.75, 0, 0.5, 0.75,
  ]);
  const packet = nativeShrapnelMovement(
    fixture({
      speed: {
        towards: [0, 0],
        impacteeVelocityFactor: 2,
        randomVelocityMax: 4,
        randomUpVelocityMax: 8,
        randomNormalVelocityMax: 6,
        randomSpinRateMax: 20,
      },
      impacteeVelocity: new Vector3(1, 2, 3),
      normal: new Vector3(0, 3, 4),
      sizeFactor: 0.5,
      random: rng.random,
    }),
  );
  assert.deepEqual(packet.velocity.toArray(), [
    -1,
    Math.fround(4.9),
    Math.fround(7.6),
  ]);
  assert.deepEqual(packet.spin.toArray(), [
    -Math.fround(1 / Math.sqrt(14)),
    0,
    Math.fround(Math.fround(3 / Math.sqrt(14)) * 0.5),
  ]);
  assert.equal(rng.used, 13);
});

test("towards applies three independent speeds before size scaling", () => {
  const rng = sequence([0, 0.5, 0.75, ...Array(13).fill(0.5)]);
  const input = fixture({
    speed: { ...fixture().speed, towards: [2, 6] },
    towardsPosition: new Vector3(2, 4, 4),
    piecePosition: new Vector3(1, 2, 2),
    sizeFactor: 0.5,
    random: rng.random,
  });
  const packet = nativeShrapnelMovement(input);
  // Delta(1,2,2), length3: speeds2,4,5; each contribution spills before*.5.
  assert.deepEqual(packet.velocity.toArray(), [
    Math.fround(Math.fround(2 / 3) * 0.5),
    Math.fround(Math.fround(8 / 3) * 0.5),
    Math.fround(Math.fround(10 / 3) * 0.5),
  ]);
  assert.equal(rng.used, 16);
  assert.deepEqual(input.towardsPosition.toArray(), [2, 4, 4]);
  assert.deepEqual(input.piecePosition.toArray(), [1, 2, 2]);
});

test("either zero towards bound or missing endpoint suppresses exactly three draws", () => {
  for (const bounds of [
    [0, 2],
    [2, 0],
    [0, 0],
    [2, 2],
  ]) {
    const rng = sequence(Array(13).fill(0.5));
    nativeShrapnelMovement(
      fixture({
        speed: { ...fixture().speed, towards: bounds },
        towardsPosition: bounds[0] && bounds[1] ? null : new Vector3(1, 0, 0),
        piecePosition: new Vector3(),
        random: rng.random,
      }),
    );
    assert.equal(rng.used, 13);
  }
});

test("zero normal falls back to X, and zero spin axis retains the X fallback", () => {
  const rng = sequence([
    0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0.5, 0.5, 0.5, 0.75, 0.75, 0.75,
  ]);
  const packet = nativeShrapnelMovement(
    fixture({
      speed: {
        ...fixture().speed,
        randomNormalVelocityMax: 4,
        randomSpinRateMax: 10,
      },
      random: rng.random,
    }),
  );
  assert.deepEqual(packet.velocity.toArray(), [2, 0, 0]);
  assert.deepEqual(packet.spin.toArray(), [0.5, 0, 0]);
  assert.equal(rng.used, 13);
});

test("shared MSVC stream advances directly; routine never reseeds or restores", () => {
  const stream = new NativeRandom(1);
  nativeShrapnelMovement(fixture({ random: stream.random }));
  assert.equal(stream.state, 0xdaf1b4cc);
  const reference = new NativeRandom(1);
  for (let i = 0; i < 13; i++) reference.nextInteger();
  assert.equal(stream.nextInteger(), reference.nextInteger());
});

test("invalid providers fail before draws and singular towards is explicit", () => {
  let draws = 0;
  const random = () => {
    draws++;
    return 0.5;
  };
  assert.throws(
    () => nativeShrapnelMovement(fixture({ normal: undefined, random })),
    /vector provider/,
  );
  assert.throws(
    () => nativeShrapnelMovement(fixture({ sizeFactor: Infinity, random })),
    /scalar/,
  );
  assert.equal(draws, 0);
  assert.throws(
    () => nativeShrapnelMovement(fixture({ random: () => 1 })),
    /random sample/,
  );
  assert.throws(
    () =>
      nativeShrapnelMovement(
        fixture({
          speed: { ...fixture().speed, towards: [1, 1] },
          towardsPosition: new Vector3(),
          piecePosition: new Vector3(),
          random,
        }),
      ),
    /zero separation/,
  );
  assert.equal(draws, 0);
});
