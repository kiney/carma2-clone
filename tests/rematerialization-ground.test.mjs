import test from "node:test";
import assert from "node:assert/strict";
import { Matrix3, Vector3 } from "three";
import { alignNativeRematerializationGround } from "../src/ai/rematerialization-ground.ts";

const f = Math.fround;
const modelPerMetric = f(1 / 6.9);
const near = (actual, expected, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`);
const row2Identity = new Vector3(0, 0, 1);
const up = new Vector3(0, 1, 0);

function rayWithFractions(fractions, normals = []) {
  const calls = [];
  const ray = (origin, direction) => {
    calls.push({ origin: origin.clone(), direction: direction.clone() });
    const index = calls.length - 1;
    return {
      fraction: fractions[Math.min(index, fractions.length - 1)],
      normal: (normals[index] ?? up).clone(),
    };
  };
  return { ray, calls };
}

test("ground alignment preserves the native identity-yaw quirk and uses first hit", () => {
  const { ray, calls } = rayWithFractions([0.25, 100]);
  const result = alignNativeRematerializationGround(
    new Vector3(1.25, 2, -3),
    row2Identity,
    ray,
  );

  assert.equal(result.yaw, 65532);
  assert.equal(result.queries, 2);
  assert.equal(result.fraction, f(0.25));
  assert.equal(result.aligned, true);
  assert.deepEqual(calls[0].direction.toArray(), [
    0,
    f(-100 * modelPerMetric),
    0,
  ]);
  assert.deepEqual(calls[1].direction.toArray(), calls[0].direction.toArray());

  // The native metric wrapper performs two Float32 scale stores around the ray.
  const metricPosition = [1.25, 2, -3].map((v) => f(f(v) * 6.9));
  assert.deepEqual(calls[0].origin.toArray(), [
    f(f(metricPosition[0]) * modelPerMetric),
    f(f(metricPosition[1] + 1) * modelPerMetric),
    f(f(metricPosition[2]) * modelPerMetric),
  ]);
  assert.equal(
    result.position.y,
    f(f(metricPosition[1] - (0.25 * 100 - 2)) * (1 / 6.9)),
  );
  assert.ok(Math.abs(result.row2.x) < 0.001);
  assert.ok(result.row2.z > 0.999);
});

test("second-hit retry uses a repeated origin and the negative 5.01 direction", () => {
  const { ray, calls } = rayWithFractions([0.8, 1, 100, 0.25]);
  const result = alignNativeRematerializationGround(
    new Vector3(0, 0, 0),
    row2Identity,
    ray,
  );

  assert.equal(result.queries, 4);
  assert.equal(result.fraction, -f(2 * f(0.05) - f(0.25) * f(0.05)));
  assert.deepEqual(calls[3].origin.toArray(), calls[2].origin.toArray());
  assert.deepEqual(calls[2].direction.toArray(), [
    0,
    f(f(-5.01) * modelPerMetric),
    0,
  ]);
  near(calls[2].origin.y, f(f(f(f(0) - 100) + 5) * modelPerMetric));
});

test("lower-ray retry counts hits and the twenty-miss path performs 22 rays", () => {
  const hitFractions = [0.9, 1, 0.5];
  const hit = rayWithFractions(hitFractions);
  const hitResult = alignNativeRematerializationGround(
    new Vector3(),
    row2Identity,
    hit.ray,
  );
  assert.equal(hitResult.queries, 3);
  assert.equal(hitResult.fraction, -f(f(0.05) - f(0.5) * f(0.05)));

  const miss = rayWithFractions([0.9, 1, ...Array(20).fill(100)]);
  const missResult = alignNativeRematerializationGround(
    new Vector3(),
    row2Identity,
    miss.ray,
  );
  assert.equal(missResult.queries, 22);
  assert.equal(miss.calls.length, 22);
  assert.equal(missResult.fraction, -f(21 * f(0.05) - 100 * f(0.05)));
  assert.equal(missResult.aligned, false);
  const twentieth = rayWithFractions([1, 1, ...Array(19).fill(100), 0.5]);
  const lastHit = alignNativeRematerializationGround(
    new Vector3(),
    row2Identity,
    twentieth.ray,
  );
  assert.equal(lastHit.queries, 22);
  assert.equal(lastHit.fraction, -f(20 * f(0.05) - f(0.5) * f(0.05)));
  assert.equal(lastHit.aligned, true);
});

test("pitch then roll uses native separate quantized angles, retaining its residual slope", () => {
  const normal = new Vector3(
    f(0.25),
    f(Math.sqrt(1 - 0.25 ** 2 - 0.5 ** 2)),
    f(0.5),
  );
  const fixture = rayWithFractions([0.25, 100], [normal]);
  const pose = alignNativeRematerializationGround(
    new Vector3(),
    row2Identity,
    fixture.ray,
  );
  // Derive expected rows with independent matrix products. Native uses each
  // normal component's asin, rather than an exact normal-aligned basis.
  const radians = 65532 * 9.587379924285257e-5;
  const s = f(Math.sin(radians)),
    c = f(Math.cos(radians));
  const basis = new Matrix3().set(c, 0, -s, 0, 1, 0, s, 0, c);
  const angle = (dot, sign) =>
    (Math.trunc(Math.asin(dot) * 10430.378350470453 * sign) & 0xffff) *
    9.587379924285257e-5;
  const pitch = angle(s * normal.x + c * normal.z, 1);
  const roll = angle(-s * normal.z + c * normal.x, -1);
  const rx = new Matrix3().set(
    1,
    0,
    0,
    0,
    f(Math.cos(pitch)),
    f(Math.sin(pitch)),
    0,
    -f(Math.sin(pitch)),
    f(Math.cos(pitch)),
  );
  const rz = new Matrix3().set(
    f(Math.cos(roll)),
    f(Math.sin(roll)),
    0,
    -f(Math.sin(roll)),
    f(Math.cos(roll)),
    0,
    0,
    0,
    1,
  );
  rx.multiply(basis);
  rx.elements = rx.elements.map(f);
  rz.multiply(rx);
  const e = rz.elements.map(f);
  assert.deepEqual(pose.row0.toArray(), [e[0], e[3], e[6]]);
  assert.deepEqual(pose.row1.toArray(), [e[1], e[4], e[7]]);
  assert.deepEqual(pose.row2.toArray(), [e[2], e[5], e[8]]);
  for (const row of [pose.row0, pose.row1, pose.row2])
    near(row.length(), 1, 1e-6);
  const inclusive = alignNativeRematerializationGround(
    new Vector3(),
    row2Identity,
    rayWithFractions([1, 100]).ray,
  );
  const outside = alignNativeRematerializationGround(
    new Vector3(),
    row2Identity,
    rayWithFractions([1 + 2 ** -23, 100]).ray,
  );
  assert.equal(inclusive.aligned, true);
  assert.equal(outside.aligned, false);
});

test("ground alignment rejects invalid vectors and nonfinite ray fractions", () => {
  assert.throws(
    () =>
      alignNativeRematerializationGround(
        new Vector3(Number.MAX_VALUE, 0, 0),
        row2Identity,
        () => ({ fraction: 0.5, normal: up }),
      ),
    /Invalid native rematerialization ground vector/,
  );
  assert.throws(
    () =>
      alignNativeRematerializationGround(new Vector3(), row2Identity, () => ({
        fraction: Number.NaN,
        normal: up,
      })),
    /Invalid native rematerialization ground fraction/,
  );
});
