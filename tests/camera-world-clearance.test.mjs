import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { clearCameraFromWorld } from "../src/camera/world-clearance.ts";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function close(actual, expected, epsilon = 1e-10) {
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);
}
function vector(actual, expected) {
  actual.toArray().forEach((value, i) => close(value, expected[i]));
}
function plane(normal, distance, position = v(0, 0, 1)) {
  return { normal, point: position.clone().addScaledVector(normal, -distance) };
}
function queries(faces = [], ray = () => undefined) {
  return { ray, faces: () => faces };
}

test("native finite world segment extends 1.25 and nearby box uses three near planes", () => {
  const com = v(2, 3, 4),
    proposed = v(2, 4, 6);
  let calls = 0;
  const result = clearCameraFromWorld(proposed, com, 0.06, {
    ray(from, delta) {
      calls++;
      vector(from, [2, 3, 4]);
      vector(delta, [0, 1.25, 2.5]);
      return undefined;
    },
    faces(min, max) {
      vector(min, [1.82, 3.82, 5.82]);
      vector(max, [2.18, 4.18, 6.18]);
      return [];
    },
  });
  assert.equal(calls, 1);
  vector(result.position, [2, 4, 6]);
  assert.equal(result.collided, false);
  vector(proposed, [2, 4, 6]);
});

test("fraction beyond finite endpoint misses, equality enters final collision branch", () => {
  const normal = v(0, 0, -1);
  const miss = clearCameraFromWorld(
    v(0, 0, 2),
    v(),
    0.06,
    queries([], () => ({ fraction: 1.001, normal })),
  );
  vector(miss.position, [0, 0, 2]);
  assert.equal(miss.collided, false);
  const endpoint = clearCameraFromWorld(
    v(0, 0, 2),
    v(),
    0.06,
    queries([], () => ({ fraction: 1, normal })),
  );
  vector(endpoint.position, [0, 0, 2]);
  assert.equal(endpoint.collided, true);
});

test("initial strict endpoint does not set collision flag if bent second ray misses", () => {
  let count = 0;
  const result = clearCameraFromWorld(
    v(0, 0, 0.5),
    v(),
    0.06,
    queries([], () =>
      ++count === 1 ? { fraction: 1, normal: v(0, 0, -1) } : undefined,
    ),
  );
  assert.equal(count, 2);
  assert.equal(result.collided, false);
  vector(result.position, [0, 0, 0.5]);
});

test("first interior hit keeps collision flag when camera bend clears second ray", () => {
  let count = 0;
  const result = clearCameraFromWorld(
    v(0, 0, 1),
    v(),
    0.06,
    queries([], () =>
      ++count === 1 ? { fraction: 0.5, normal: v(0, 0, -1) } : undefined,
    ),
  );
  assert.equal(count, 2);
  assert.equal(result.collided, true);
});

test("sloping hit bends by native Y-biased normal and preserves COM distance", () => {
  let calls = 0;
  const result = clearCameraFromWorld(
    v(0, 0, 1),
    v(),
    0.06,
    queries([], () =>
      ++calls === 1 ? { fraction: 0.5, normal: v(0, 0.8, -0.6) } : undefined,
    ),
  );
  // 0x4126bd onward: deficit .18+.6-.5*.75=.405,
  // bend normal Y +=3, factor abs(.8)*deficit/length(bend).
  const scale = 0.324 / Math.sqrt(14.8);
  const y = 3.8 * scale,
    z = 1 - 0.6 * scale;
  const length = Math.hypot(y, z);
  vector(result.position, [0, y / length, z / length]);
  close(result.position.length(), 1);
  assert.equal(calls, 2);
});

test("slide obstruction clips only added slide displacement by its finite fraction", () => {
  let calls = 0;
  const result = clearCameraFromWorld(
    v(0, 0, 0.5),
    v(),
    0.01,
    queries([], () => ({
      fraction: ++calls === 1 ? 1 : 0.5,
      normal: v(0, 0, -1),
    })),
  );
  vector(result.position, [0, Math.sqrt(0.11) / 2, 0.5]);
  assert.equal(calls, 2);
});

test("near wall retreat retains native .001 correction after short-distance branch", () => {
  const result = clearCameraFromWorld(
    v(0, 0, 1),
    v(),
    0.06,
    queries([], () => ({ fraction: 0.5, normal: v(0, 0, -1) })),
  );
  vector(result.position, [0, 0, 0.62375]);
});

test("native slide discriminant uses b=dot without doubling and inverts upside down", () => {
  // Installed 0x412a57–0x412b27: b²-4a(l-.6²), (sqrt(discriminant)-b)/(2a).
  for (const upsideDown of [false, true]) {
    let calls = 0;
    const result = clearCameraFromWorld(
      v(0, 0.2, 0.5),
      v(),
      0.01,
      queries([], (from, delta) => {
        if (++calls === 1) return { fraction: 1, normal: v(0, 0, -1) };
        vector(from, [0, 0.2, 0.5]);
        close(
          delta.y,
          upsideDown
            ? -(Math.sqrt(0.32) + 0.2) / 2
            : (Math.sqrt(0.32) - 0.2) / 2,
        );
        return undefined;
      }),
      upsideDown,
    );
    close(
      result.position.y,
      upsideDown
        ? 0.2 - (Math.sqrt(0.32) + 0.2) / 2
        : 0.2 + (Math.sqrt(0.32) - 0.2) / 2,
    );
    close(result.position.z, 0.5);
    assert.equal(calls, 2);
  }
});

test("first nearby plane pushes by clearance deficit without setting ray collision flag", () => {
  const result = clearCameraFromWorld(
    v(0, 0, 1),
    v(),
    0.06,
    queries([plane(v(1, 0, 0), 0.05)]),
  );
  vector(result.position, [0.13, 0, 1]);
  assert.equal(result.collided, false);
});

test("orthogonal second nearby plane preserves first-plane clearance", () => {
  const result = clearCameraFromWorld(
    v(0, 0, 1),
    v(),
    0.06,
    queries([plane(v(1, 0, 0), 0.05), plane(v(0, 1, 0), 0.06)]),
  );
  vector(result.position, [0.13, 0.12, 1]);
});

test("oblique second push uses unnormalized orthogonal remainder, not first normal", () => {
  // Binary correction 0x41319b–0x413236: n1 -= n0*dot; push by resulting n1.
  const second = plane(v(0.6, 0.8, 0), 0.06);
  const result = clearCameraFromWorld(
    v(0, 0, 1),
    v(),
    0.06,
    queries([plane(v(1, 0, 0), 0.05), second]),
  );
  vector(result.position, [0.13, 0.0336, 1]);
  vector(second.normal, [0.6, 0.8, 0]);
});

test("parallel second plane is replaced by third and suppresses third-plane stage", () => {
  const result = clearCameraFromWorld(
    v(0, 0, 1),
    v(),
    0.06,
    queries([
      plane(v(1, 0, 0), 0.01),
      plane(v(1, 0, 0), 0.02),
      plane(v(0, 1, 0), 0.03),
    ]),
  );
  vector(result.position, [0.17, 0.15, 1]);
});

test("third-plane displacement retains native selected-second distance and .5 gate", () => {
  const small = clearCameraFromWorld(
    v(0, 0, 1),
    v(),
    0.06,
    queries([
      plane(v(1, 0, 0), 0.05),
      plane(v(0.6, 0.8, 0), 0.06),
      plane(v(0, 0, 1), 0.1),
    ]),
  );
  vector(small.position, [0.13, 0.0336, 1]);
  const large = clearCameraFromWorld(
    v(0, 0, 1),
    v(),
    0.4,
    queries([
      plane(v(1, 0, 0), 0.55),
      plane(v(0.6, 0.8, 0), 0.65),
      plane(v(0, 0, 1), 0.7),
    ]),
  );
  vector(large.position, [0.65, 0.128, 1.6816]);
});

test("nearby consumer caps six faces and excludes nonpositive plane distances", () => {
  const planes = Array.from({ length: 6 }, () => plane(v(1, 0, 0), 0));
  planes.push(plane(v(0, 1, 0), 0.01));
  const result = clearCameraFromWorld(v(0, 0, 1), v(), 0.06, queries(planes));
  vector(result.position, [0, 0, 1]);
});

test("two-sided nearby planes flip toward ray before measuring positive clearance", () => {
  const face = { normal: v(0, 0, 1), point: v(0, 0, 1.05), twoSided: true };
  const result = clearCameraFromWorld(v(0, 0, 1), v(), 0.06, queries([face]));
  vector(result.position, [0, 0, 0.87]);
  vector(face.normal, [0, 0, 1]);
});
