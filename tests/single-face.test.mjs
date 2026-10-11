import test from "node:test";
import assert from "node:assert/strict";
import { nativeCheckSingleFace } from "../src/physics/single-face.ts";
import {
  nativePedGroundingStep,
  nativePedSelectGroundSupport,
} from "../src/ped-grounding.ts";

const f = Math.fround;
function face(extra = {}) {
  return {
    a: [0, 0, 0],
    b: [1, 0, 0],
    c: [0, 0, 1],
    normal: [0, 1, 0],
    constant: 0,
    materialFlags: 0,
    rawFlags: 0,
    ...extra,
  };
}
function query(extra = {}) {
  return {
    origin: [0.2, 1, 0.3],
    segment: [0, -2, 0],
    excludePlingMaterials: false,
    ...extra,
  };
}

test("finite single-face interior uses source negative second determinant, not rec2 beta sign", () => {
  const hit = nativeCheckSingleFace(face(), query());
  assert.deepEqual(hit, {
    parameter: 0.5,
    point: [f(0.2), 0, f(0.3)],
    normal: [0, 1, 0],
  });
  const reverse = face({ b: [0, 0, 1], c: [1, 0, 0] });
  assert.deepEqual(nativeCheckSingleFace(reverse, query()), hit);
});

test("cached normal is copied unchanged and packed D is not read by CheckSingleFace", () => {
  const n = [0, 2, 0],
    a = face({ normal: n, constant: 12345 });
  const hit = nativeCheckSingleFace(a, query());
  assert.deepEqual(hit.normal, n);
  assert.equal(hit.parameter, 0.5);
  assert.deepEqual(
    nativeCheckSingleFace({ ...a, constant: -999 }, query()),
    hit,
  );
  // A stored cached normal can differ from triangle winding; no regeneration.
  assert.deepEqual(
    nativeCheckSingleFace(
      face({ normal: [0, -1, 0], materialFlags: 0x1000 }),
      query(),
    ).normal,
    [-0, 1, -0],
  );
});

test("native NULL material permits backfaces while present material0 rejects them", () => {
  const fromBelow = query({ origin: [0.2, -1, 0.3], segment: [0, 2, 0] });
  assert.equal(nativeCheckSingleFace(face(), fromBelow), null);
  const expected = {
    parameter: 0.5,
    point: [f(0.2), 0, f(0.3)],
    normal: [-0, -1, -0],
  };
  assert.deepEqual(
    nativeCheckSingleFace(face({ materialFlags: undefined }), fromBelow),
    expected,
  );
  for (const flags of [0x800, 0x1000, 0x1800])
    assert.deepEqual(
      nativeCheckSingleFace(face({ materialFlags: flags }), fromBelow),
      expected,
    );
  assert.equal(
    nativeCheckSingleFace(face({ materialFlags: 0x4000 }), fromBelow),
    null,
  );
});

test("material prefix rejection requires actual material, identifier and enabled native switch", () => {
  for (const prefix of ["!", ">", "?"]) {
    const special = face({ materialIdentifier: `${prefix}surface` });
    assert.equal(
      nativeCheckSingleFace(special, query({ excludePlingMaterials: true })),
      null,
    );
    assert.ok(nativeCheckSingleFace(special, query()));
    assert.ok(
      nativeCheckSingleFace(
        { ...special, materialFlags: undefined },
        query({ excludePlingMaterials: true }),
      ),
    );
  }
  for (const identifier of [null, "", "ordinary", " !inside"])
    assert.ok(
      nativeCheckSingleFace(
        face({ materialIdentifier: identifier }),
        query({ excludePlingMaterials: true }),
      ),
    );
});

test("source denominator threshold is strict2^-22 and zero/tangent rays reject", () => {
  const minimum = 2 ** -22;
  assert.equal(
    nativeCheckSingleFace(
      face(),
      query({ origin: [0.2, minimum / 2, 0.3], segment: [0, -minimum, 0] }),
    ).parameter,
    0.5,
  );
  assert.equal(
    nativeCheckSingleFace(
      face(),
      query({
        origin: [0.2, minimum / 2, 0.3],
        segment: [0, -f(minimum - 2 ** -46), 0],
      }),
    ),
    null,
  );
  assert.equal(
    nativeCheckSingleFace(face(), query({ segment: [1, 0, 0] })),
    null,
  );
  assert.equal(
    nativeCheckSingleFace(face({ normal: [0, 0, 0] }), query()),
    null,
  );
});

test("nonnegative plane distance has no wheel signed penetration allowance", () => {
  assert.equal(
    nativeCheckSingleFace(
      face(),
      query({ origin: [0.2, -1e-7, 0.3], segment: [0, -1, 0] }),
    ),
    null,
  );
  const atPlane = nativeCheckSingleFace(
    face(),
    query({ origin: [0.2, 0, 0.3], segment: [0, -1, 0] }),
  );
  assert.equal(atPlane.parameter, 0);
  assert.deepEqual(atPlane.point, [f(0.2), 0, f(0.3)]);
  const twoSided = face({ materialFlags: 0x800 });
  assert.equal(
    nativeCheckSingleFace(
      twoSided,
      query({ origin: [0.2, 1e-7, 0.3], segment: [0, 1, 0] }),
    ),
    null,
  );
});

test("double.003 endpoint test precedes Float32 fraction clamp and leaves point at actual endpoint", () => {
  assert.ok(f(1.003) > 1.003);
  assert.equal(
    nativeCheckSingleFace(
      face(),
      query({ origin: [0.2, f(1.003), 0.3], segment: [0, -1, 0] }),
    ),
    null,
  );
  const below = f(1.003 - 1e-7),
    hit = nativeCheckSingleFace(
      face(),
      query({ origin: [0.2, below, 0.3], segment: [0, -1, 0] }),
    );
  assert.equal(hit.parameter, 1);
  assert.deepEqual(hit.point, [f(0.2), f(below - 1), f(0.3)]);
  assert.notEqual(hit.point[1], 0);
  const back = nativeCheckSingleFace(
    face({ materialFlags: undefined }),
    query({ origin: [0.2, -below, 0.3], segment: [0, 1, 0] }),
  );
  assert.equal(back.parameter, 1);
  assert.equal(back.point[1], f(1 - below));
});

test("finite triangle boundaries use double barycentric bounds, vertices inclusive", () => {
  for (const [x, z] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [0.5, 0.5],
    [-0.0001, 0.3],
    [0.3, -0.0001],
  ])
    assert.ok(
      nativeCheckSingleFace(face(), query({ origin: [x, 1, z] })),
      `${x},${z}`,
    );
  for (const [x, z] of [
    [1.0001, 0],
    [0, 1.0001],
    [-0.00010000001, 0.3],
    [0.3, -0.00010000001],
    [0.5001, 0.5001],
    [1, 1],
  ])
    assert.equal(
      nativeCheckSingleFace(face(), query({ origin: [x, 1, z] })),
      null,
      `${x},${z}`,
    );
  assert.ok(
    nativeCheckSingleFace(face(), query({ origin: [f(1.0001 - 2e-7), 1, 0] })),
  );
  assert.equal(nativeCheckSingleFace(face({ c: [2, 0, 0] }), query()), null);
});

test("largest packed normal ties preferX thenY beforeZ, without rebuilding plane", () => {
  // Y/Z projection is degenerate here; dropping Y instead would produce a
  // nondegenerate triangle. A cached X==Y normal must drop X.
  assert.equal(
    nativeCheckSingleFace(
      face({ normal: [1, 1, 0], materialFlags: undefined }),
      query({ origin: [1, -1, 0.2], segment: [-1, -1, 0] }),
    ),
    null,
  );
  const vertical = face({
    a: [0, 0, 0],
    b: [0, 1, 0],
    c: [0, 0, 1],
    normal: [1, 0, 0],
  });
  const hit = nativeCheckSingleFace(
    vertical,
    query({ origin: [1, 0.2, 0.3], segment: [-2, 0, 0] }),
  );
  assert.deepEqual(hit.point, [0, f(0.2), f(0.3)]);
  assert.deepEqual(hit.normal, [1, 0, 0]);
});

test("installed synthetic tilted capture preserves distinct scale/accumulate stores bit for bit", () => {
  // Invented inputs and outputs captured by installed45f1c0; not asset geometry.
  const a = face({
    a: [-1.3167999982833862, 1.9250999689102173, 1.496999979019165],
    b: [-2.738800048828125, 0.7336999773979187, -2.9514999389648438],
    c: [1.299399971961975, -1.7299000024795532, 1.068600058555603],
    normal: [-0.7286515235900879, -0.566646933555603, 0.38467928767204285],
  });
  const q = query({
    origin: [-1.1806657314300537, 0.3069964647293091, 0.6711196899414062],
    segment: [0.7286515235900879, 0.566646933555603, -0.38467928767204285],
  });
  const hit = nativeCheckSingleFace(a, q);
  assert.deepEqual(hit, {
    parameter: 0.4999999403953552,
    point: [-0.8163399696350098, 0.5903198719024658, 0.4787800908088684],
    normal: a.normal,
  });
  assert.ok(
    hit.point.some(
      (n, i) => n !== f(q.origin[i] + q.segment[i] * hit.parameter),
    ),
  );
});

test("helper does not apply raw80 or choose scene nearest; source wrapper filters/ordering own that", () => {
  assert.ok(nativeCheckSingleFace(face({ rawFlags: 0x80 }), query()));
  const raw = face({ rawFlags: 0x80 }),
    first = face(),
    tie = face();
  const hit = nativePedSelectGroundSupport(
    [raw, first, tie],
    [0.2, 1, 0.3],
    0,
    nativeCheckSingleFace,
    false,
  );
  assert.equal(hit.face, first);
  assert.equal(hit.parameter, 1);
});

test("production grounding query seam accepts actual finite helper without geometric fallback", () => {
  const floor = face(),
    slot = {},
    identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const result = nativePedGroundingStep(
    {
      owner: {},
      rootPose: [...identity, 0.2, 0.2, 0.3],
      characterBasis: identity,
      cache: null,
      processFloorNormal: [0, 1, 0],
      slot0Clearance: 0,
      currentMoveClearance: 0.1,
      jumpHeight: 0,
      cosMaxSlope: 0.8,
      physicsFlags: 0,
      flags: 0x40,
      action: 0,
      hitPoints: 100,
      timeMs: 123,
      direction: [0, 0, 1],
      smoothTurnTarget: null,
      replay: false,
      replayOverride: false,
      excludePlingMaterials: false,
    },
    {
      collectFaces: () => [floor],
      acquireCache: () => slot,
      queryFace: nativeCheckSingleFace,
    },
  );
  assert.equal(result.status, "supported");
  assert.deepEqual(result.effects[0].position, [f(0.2), f(0.1), f(0.3)]);
  assert.equal(result.cache.identity, slot);
});

test("finite input validation and quotient overflow are explicit", () => {
  assert.throws(
    () => nativeCheckSingleFace(face({ normal: [NaN, 1, 0] }), query()),
    /finite/,
  );
  assert.throws(
    () => nativeCheckSingleFace(face({ materialFlags: -1 }), query()),
    /flags/,
  );
  assert.throws(
    () => nativeCheckSingleFace(face(), query({ origin: [Infinity, 0, 0] })),
    /finite/,
  );
  assert.equal(
    nativeCheckSingleFace(
      face(),
      query({
        origin: [0.2, f(3.4028234663852886e38), 0.3],
        segment: [0, -(2 ** -22), 0],
      }),
    ),
    null,
  );
});
