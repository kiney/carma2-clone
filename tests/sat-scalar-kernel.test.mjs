import test from "node:test";
import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  transformHull,
  hullPenetration,
  hullPenetrationExceeds,
  collideHulls,
} from "../src/physics/geometry.ts";
import {
  eagerPenetration,
  eagerContact,
} from "./support/legacy-physics-guard.mjs";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
const box = () => buildBoxHull(v(-1, -0.7, -0.5), v(1, 0.7, 0.5));
function compare(a, b, label) {
  const depth = eagerPenetration(a, b);
  assert(Object.is(hullPenetration(a, b), depth), `${label}: exact depth`);
  for (const threshold of [
    -1,
    -0,
    0,
    depth,
    depth + 1e-12,
    depth - 1e-12,
    NaN,
    Infinity,
  ])
    assert.equal(
      hullPenetrationExceeds(a, b, threshold),
      depth > threshold,
      `${label}: threshold ${threshold}`,
    );
  for (const tolerance of [0, 0.001])
    assert.deepEqual(
      collideHulls(a, b, tolerance),
      eagerContact(a, b, tolerance),
      `${label}: exact normal/manifold`,
    );
}
function extraEdge(hull, end, count = 1) {
  const index = hull.vertices.length;
  return {
    ...hull,
    // Extra storage is excluded from projection but deliberately provides the
    // exceptional authored edge; SAT must still run its original arithmetic.
    vertexOrder: hull.vertexOrder ?? hull.vertices.map((_, i) => i),
    vertices: [...hull.vertices, v(), end],
    edges: Array.from({ length: count }, () => [index, index + 1]),
  };
}

test("scalar SAT preserves exceptional cross normalization and the large-edge fallback", () => {
  const a = transformHull(box(), v(), new Quaternion());
  const b = transformHull(
    box(),
    v(0.2, 0.1, 0.05),
    new Quaternion().setFromAxisAngle(v(0, 1, 0), 0.21),
  );
  for (const [label, edge] of [
    ["signed-zero", v(-0, 2, -0)],
    ["tiny", v(1e-200, -0, 1e-200)],
    ["cross cutoff", v(1e-6, 0, 0)],
    ["large finite", v(1e76, -1e76, 1e76)],
    ["overflow length", v(1e150, -1e150, 1e150)],
    ["overflow cross", v(1e308, -1e308, 1e308)],
    ["positive infinity", v(Infinity, 1, -0)],
    ["negative infinity", v(-Infinity, 1, 0)],
    ["NaN", v(NaN, 1, -0)],
  ]) {
    for (const count of [1, 65]) {
      const exceptional = extraEdge(a, edge, count);
      compare(exceptional, b, `${label} A/${count}`);
      compare(b, exceptional, `${label} B/${count}`);
    }
  }
  compare(
    extraEdge(a, v(1e150, 1e150, 1e150)),
    extraEdge(b, v(-1e150, 1e150, 0), 65),
    "both lists exceptional",
  );
});

test("scalar face axes retain signed zeros, NaN and infinite normalization", () => {
  const a = transformHull(box(), v(), new Quaternion()),
    b = transformHull(box(), v(0.4), new Quaternion());
  for (const normal of [
    v(-0, 1, -0),
    v(NaN, 0, -0),
    v(Infinity, 0, 1),
    v(-Infinity, -0, 0),
    v(1e308, 1e308, -0),
  ]) {
    const changed = { ...a, faces: [{ ...a.faces[0], normal }, ...a.faces] };
    compare(changed, b, `face ${normal.toArray()}`);
  }
});

test("SAT world edge subtraction remains exact under large translations", () => {
  const rotation = new Quaternion().setFromAxisAngle(
    v(1, 2, 3).normalize(),
    0.73,
  );
  for (const translation of [v(1e8, -1e8, 1e8), v(1e15, -1e15, 1e15)]) {
    const a = transformHull(box(), translation, rotation);
    const b = transformHull(
      box(),
      translation.clone().add(v(0.25, 0.125, 0.25)),
      new Quaternion().setFromAxisAngle(v(0, 1, 0), 0.19),
    );
    compare(a, b, `translated ${translation.x}`);
  }
});

test("depth SAT allocates no cloned face, edge or cross Vector3 values", () => {
  const a = transformHull(box(), v(), new Quaternion()),
    b = transformHull(
      box(),
      v(0.2),
      new Quaternion().setFromAxisAngle(v(0, 1, 0), 0.17),
    );
  const expected = eagerPenetration(a, b);
  const calls = { clone: 0, cross: 0, normalize: 0 };
  const originals = Object.fromEntries(
    Object.keys(calls).map((key) => [key, Vector3.prototype[key]]),
  );
  try {
    for (const key of Object.keys(calls))
      Vector3.prototype[key] = function (...args) {
        calls[key]++;
        return originals[key].apply(this, args);
      };
    assert(Object.is(hullPenetration(a, b), expected));
    assert.equal(hullPenetrationExceeds(a, b, expected * 0.5), true);
  } finally {
    for (const key of Object.keys(calls))
      Vector3.prototype[key] = originals[key];
  }
  assert.deepEqual(calls, { clone: 0, cross: 0, normalize: 0 });
});
