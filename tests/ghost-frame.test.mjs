import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4, Vector2, Vector3 } from "three";
import {
  captureNativeGhostQuad,
  nativeDirectSmashSeed,
  prepareNativeGhostFrame,
} from "../src/ghost-frame.ts";

const f32 = Math.fround;
function v(position, uv) {
  return { position: new Vector3(...position), uv: new Vector2(...uv) };
}
function pair(dPosition = [1, 1, 0], dUv = [1, 1]) {
  const a = v([0, 0, 0], [0, 0]);
  const b = v([1, 0, 0], [1, 0]);
  const c = v([0, 1, 0], [0, 1]);
  const d = v(dPosition, dUv);
  return [
    [a, b, c],
    [b, d, c],
  ];
}
function quad(points, normal = [0, 0, 1]) {
  return {
    points: points.map((point) => new Vector3(...point)),
    normal: new Vector3(...normal),
  };
}
function near(actual, expected, tolerance = 2e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) =>
    assert.ok(
      Math.abs(value - expected[i]) <= tolerance,
      `${i}: ${value} != ${expected[i]}`,
    ),
  );
}

test("direct smash seed truncates stored force to signed64 then XORs low DWORDs", () => {
  for (const components of [
    [12.75, -3.9, 0.99],
    [2 ** 32 + 511, -(2 ** 32) - 1023, 2 ** 31 + 255],
    [-(2 ** 63), 2 ** 63, 2 ** 64],
    [1.99999999, -1.99999999, 7.25],
  ]) {
    const words = components.map((value) => {
      const stored = f32(value);
      return stored >= 2 ** 63 || stored < -(2 ** 63)
        ? 0n
        : BigInt.asUintN(32, BigInt(Math.trunc(stored)));
    });
    assert.equal(
      nativeDirectSmashSeed(new Vector3(...components)),
      Number(words[0] ^ words[1] ^ words[2]),
    );
  }
  assert.equal(
    nativeDirectSmashSeed(new Vector3(12.75, -3.9, 0.99)),
    0xfffffff1,
  );
  assert.throws(() => nativeDirectSmashSeed(new Vector3(NaN, 0, 0)), /scalar/);
});

test("capture copies UV-ordered MODEL points and retains explicit face-list normal", () => {
  const source = pair();
  // A source ACT with this matrix is intentionally not a capture input.
  const actorMatrix = new Matrix4()
    .makeRotationY(Math.PI / 2)
    .setPosition(20, 30, 40);
  const normal = new Vector3(0, 0, -7);
  const captured = captureNativeGhostQuad(source, [0, 0, 1, 1], normal);
  assert.deepEqual(
    captured.points.map((p) => p.toArray()),
    [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  );
  assert.deepEqual(captured.normal.toArray(), [0, 0, -7]);
  assert.notDeepEqual(
    captured.points[1].toArray(),
    source[0][1].position.clone().applyMatrix4(actorMatrix).toArray(),
  );
  source[0][1].position.set(100, 100, 100);
  normal.set(1, 2, 3);
  assert.deepEqual(captured.points[1].toArray(), [1, 0, 0]);
  assert.deepEqual(captured.normal.toArray(), [0, 0, -7]);
});

test("nearest unique UV chooses each map, permits extrapolation and ties use first", () => {
  const source = pair([3, 1, 5], [2, 2]);
  const captured = captureNativeGhostQuad(
    source,
    [0, 1, 1, 2],
    new Vector3(0, 0, 1),
  );
  assert.deepEqual(captured.points[0].toArray(), [0, 1, 0]);
  // Distances to unique UVs (0,0) and (2,2) both equal4: first map.
  assert.deepEqual(captured.points[1].toArray(), [1, 1, 0]);
  assert.deepEqual(captured.points[2].toArray(), [0, 2, 0]);
  // Selected second map at (1,2), outside its triangle: X=4u/3+v/3-1/3.
  near(captured.points[3].toArray(), [f32(5 / 3), f32(4 / 3), 0]);
});

test("bent pair shares first face plane while captured-normal strict maxima select omitted axis", () => {
  const a = v([0, 0, 0], [0, 0]);
  const b = v([1, 0, -1], [1, 0]);
  const c = v([0, 1, -1], [0, 1]);
  const d = v([3, 4, 8], [1, 1]);
  const source = [
    [a, b, c],
    [b, d, c],
  ];
  for (const [normal, expected] of [
    [
      [1, 1, 1],
      [3, 4, -7],
    ],
    [
      [2, 1, 1],
      [-12, 4, 8],
    ],
    [
      [-2, 1, 1],
      [-12, 4, 8],
    ],
    [
      [1, 2, 1],
      [3, -11, 8],
    ],
    [
      [2, 2, 1],
      [3, 4, -7],
    ],
  ]) {
    const result = captureNativeGhostQuad(
      source,
      [0, 0, 1, 1],
      new Vector3(...normal),
    );
    near(result.points[3].toArray(), expected);
  }
});

test("prepared frame retains independent shear, second-corner origin and container XY scale", () => {
  const source = quad(
    [
      [2, 3, 4],
      [4, 3, 4],
      [3, 6, 4],
      [5, 6, 4],
    ],
    [0, 0, -9],
  );
  const result = prepareNativeGhostFrame(
    source,
    new Matrix4().makeTranslation(99, 98, 97),
    [2, 3, 0],
  );
  assert.equal(result.tinyFace, false);
  const yScale = f32(f32(Math.sqrt(10)) / 3);
  const yX = f32(f32(1 / Math.sqrt(10)) * yScale);
  const yY = f32(f32(3 / Math.sqrt(10)) * yScale);
  assert.deepEqual(result.frame.elements, [
    1,
    0,
    0,
    0,
    yX,
    yY,
    0,
    0,
    0,
    0,
    -1,
    0,
    4,
    3,
    4,
    1,
  ]);
  assert.ok(yX > 0, "native frame does not orthogonalize its two edge axes");
  assert.deepEqual(source.points[1].toArray(), [4, 3, 4]);
});

test("each axis uses strict 2^-22 normalization with independent positive-X fallback", () => {
  const epsilon = 2 ** -22;
  const at = quad(
    [
      [0, 0, 0],
      [0, epsilon, 0],
      [0, 0, epsilon],
      [0, 1, 1],
    ],
    [0, epsilon, 0],
  );
  assert.deepEqual(
    prepareNativeGhostFrame(at, new Matrix4()).frame.elements.slice(0, 12),
    [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  );
  const above = quad(
    [
      [0, 0, 0],
      [0, 2 * epsilon, 0],
      [0, 0, 2 * epsilon],
      [0, 1, 1],
    ],
    [0, 2 * epsilon, 0],
  );
  assert.deepEqual(
    prepareNativeGhostFrame(above, new Matrix4()).frame.elements.slice(0, 12),
    [0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0],
  );
});

test("tiny-face abort is strict and only within the both-nonzero container gate", () => {
  const small = quad([
    [0, 0, 0],
    [0.0005, 0, 0],
    [0, 0.002, 0],
    [1, 1, 0],
  ]);
  assert.equal(
    prepareNativeGhostFrame(small, new Matrix4(), [1, 1, 1]).tinyFace,
    true,
  );
  for (const dimensions of [undefined, [0, 1, 1], [1, 0, 1]]) {
    const result = prepareNativeGhostFrame(small, new Matrix4(), dimensions);
    assert.equal(result.tinyFace, false);
    assert.deepEqual(
      result.frame.elements.slice(0, 12),
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    );
  }
  const boundary = quad([
    [0, 0, 0],
    [0.001, 0, 0],
    [0, 0.001, 0],
    [1, 1, 0],
  ]);
  assert.equal(
    prepareNativeGhostFrame(boundary, new Matrix4(), [1, 1, 1]).tinyFace,
    false,
  );
  const below = f32(0.001) - 2 ** -33;
  const smallerY = quad([
    [0, 0, 0],
    [0.001, 0, 0],
    [0, below, 0],
    [1, 1, 0],
  ]);
  assert.equal(
    prepareNativeGhostFrame(smallerY, new Matrix4(), [1, 1, 1]).tinyFace,
    true,
  );
});

test("no-face fallback copies full matrix and captured face never falls back", () => {
  const fallback = new Matrix4().set(
    1,
    0.25,
    0,
    7,
    0.5,
    2,
    0,
    8,
    0,
    0,
    -3,
    9,
    0,
    0,
    0,
    1,
  );
  const result = prepareNativeGhostFrame(null, fallback, [1, 1, 1]);
  assert.notEqual(result.frame, fallback);
  assert.deepEqual(result.frame.elements, fallback.elements);
  const collapsed = quad(
    [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
    [0, 0, 0],
  );
  const aborted = prepareNativeGhostFrame(collapsed, fallback, [1, 1, 1]);
  assert.equal(aborted.tinyFace, true);
  assert.deepEqual(aborted.frame.elements.slice(12, 15), [0, 0, 0]);
});

test("invalid geometry, UV and frame providers fail explicitly", () => {
  assert.throws(
    () => captureNativeGhostQuad(pair(), [1, 0, 0, 1], new Vector3(0, 0, 1)),
    /bounds/,
  );
  const unrelated = pair();
  unrelated[1][0] = v([5, 5, 5], [5, 5]);
  assert.throws(
    () => captureNativeGhostQuad(unrelated, [0, 0, 1, 1], new Vector3(0, 0, 1)),
    /shared edge/,
  );
  const degenerate = pair();
  degenerate[0][2].uv.set(2, 0);
  assert.throws(
    () =>
      captureNativeGhostQuad(degenerate, [0, 0, 1, 1], new Vector3(0, 0, 1)),
    /UV mapping/,
  );
  assert.throws(
    () => captureNativeGhostQuad(pair(), [0, 0, 1, 1], new Vector3(1, 0, 0)),
    /incompatible/,
  );
  assert.throws(
    () =>
      prepareNativeGhostFrame(null, new Matrix4().makeTranslation(NaN, 0, 0)),
    /fallback/,
  );
  assert.throws(
    () =>
      prepareNativeGhostFrame(
        quad([
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
          [1, 1, 0],
        ]),
        new Matrix4(),
        [1, Infinity, 1],
      ),
    /scalar/,
  );
});
