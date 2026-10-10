import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { applyWorldPinball } from "../src/physics/pinball.ts";

function makeBody(mass = 1) {
  return {
    properties: { mass },
    state: {
      position: new Vector3(),
      orientation: new Quaternion(),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
  };
}

function impact(body, normal, impulse, extras = {}) {
  return {
    a: body,
    point: new Vector3(),
    normal: new Vector3(...normal),
    normalImpulse: impulse,
    closingSpeed: 0,
    tangentImpulse: new Vector3(),
    ...extras,
  };
}

test("world pinball groups same-body normals using strict dot and impulse bounds", () => {
  const body = makeBody();
  const rows = [
    impact(body, [1, 0, 0], 1),
    impact(body, [1, 0, 0], 2),
    impact(body, [0.8, 0.6, 0], 3),
    impact(body, [1, 0, 0], 0),
    impact(body, [0, 1, 0], 4),
    impact(body, [1, 0, 0], 0.00019999999494757503),
    impact(body, [0, 0, 1], 0.00020001),
    impact(body, [1, 0, 0], 10, { sourceType: 9 }),
    impact(body, [1, 0, 0], 10, { b: makeBody() }),
  ];
  const groups = applyWorldPinball(rows, 1);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups[0].impacts, rows.slice(0, 4));
  assert.deepEqual(groups[1].impacts, [rows[4]]);
  assert.deepEqual(groups[2].impacts, [rows[6]]);
  assert.equal(groups[0].impulse.x, 5.4);
  assert.ok(Math.abs(groups[0].impulse.y - 1.8) < 1e-12);
  assert.equal(groups[2].impulse.z, 0.00020001);
});

test("resting solved rows are eligible regardless of closing speed; car pairs are not", () => {
  const body = makeBody();
  const resting = impact(body, [0, 1, 0], 1);
  const pair = impact(body, [1, 0, 0], 100, { b: makeBody(), closingSpeed: 9 });
  const groups = applyWorldPinball([pair, resting], 1);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].impacts, [resting]);
});

test("a fifth above-threshold row starts the next four-row group", () => {
  const body = makeBody();
  const rows = Array.from({ length: 5 }, () => impact(body, [1, 0, 0], 1));
  const groups = applyWorldPinball(rows, 1);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].impacts, rows.slice(0, 4));
  assert.deepEqual(groups[1].impacts, [rows[4]]);
  assert.equal(groups[0].impulse.x, 4);
  assert.equal(groups[1].impulse.x, 1);
});

test("seed-normal dot uses a strict native threshold", () => {
  const body = makeBody();
  const threshold = 0.7071070075035095;
  const boundary = impact(
    body,
    [threshold, Math.sqrt(1 - threshold * threshold), 0],
    1,
  );
  const above = impact(
    body,
    [threshold + 1e-12, Math.sqrt(1 - (threshold + 1e-12) ** 2), 0],
    1,
  );
  const seed = impact(body, [1, 0, 0], 1);
  const groups = applyWorldPinball([seed, boundary, above], 1);
  assert.equal(seed.normal.dot(boundary.normal), threshold);
  assert.ok(seed.normal.dot(above.normal) > threshold);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[0].impacts, [seed, above]);
  assert.deepEqual(groups[1].impacts, [boundary]);
});

test("pinball scales by mass and factor, caps squared delta at 500, then flags sound", () => {
  const ordinary = makeBody(2);
  const [small] = applyWorldPinball([impact(ordinary, [0, 0, 1], 1)], 1);
  assert.ok(
    Math.abs(small.deltaVelocity.z - (6.9 * 0.20000000298023224) / 2) < 1e-12,
  );
  assert.equal(small.sound, false);
  assert.ok(ordinary.state.velocity.equals(small.deltaVelocity));

  const capped = makeBody(1);
  const preCap = new Vector3(0, 0, 20 * 6.9 * 0.20000000298023224);
  const [large] = applyWorldPinball([impact(capped, [0, 0, 1], 20)], 1);
  const capScale = 500 / preCap.lengthSq();
  assert.ok(
    Math.abs(
      large.deltaVelocity.lengthSq() - preCap.lengthSq() * capScale ** 2,
    ) < 1e-9,
  );
  assert.equal(large.sound, true);
  assert.ok(capped.state.velocity.equals(large.deltaVelocity));
  assert.throws(() => applyWorldPinball([], Infinity), /finite/);
  assert.throws(
    () => applyWorldPinball([impact(makeBody(0), [1, 0, 0], 1)], 1),
    /mass/,
  );
});

test("disabled pinball skips the callback branch entirely", () => {
  const body = makeBody(1);
  body.state.velocity.set(1, 2, 3);
  assert.deepEqual(applyWorldPinball([impact(body, [0, 1, 0], 100)], 0), []);
  assert.deepEqual(body.state.velocity.toArray(), [1, 2, 3]);
});
