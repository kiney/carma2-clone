import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  nativePedGroundingStep,
  nativePedSelectGroundSupport,
  nativePedRetainsGroundTriangle,
  nativePedInsideGroundCache,
  nativePedGroundChangedNear,
  nativePedGroundCacheBounds,
} from "../src/ped-grounding.ts";
import { parsePedForm, parsePedPersonalityMoves } from "../src/ped-form.ts";
import { decodeText } from "../src/formats.ts";

const f = Math.fround;
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const basis = identity.slice(0, 9);
const bounds = { min: [-5, -5, -5], max: [5, 5, 5] };
function face(id, extra = {}) {
  return {
    id,
    a: [-2, 0, -2],
    b: [2, 0, -2],
    c: [0, 0, 2],
    normal: [0, 1, 0],
    rawFlags: 0,
    ...extra,
  };
}
function cache(faces, selectedFace = null, extra = {}) {
  return { identity: {}, bounds, capacity: 5, faces, selectedFace, ...extra };
}
function input(extra = {}) {
  return {
    owner: {},
    rootPose: [...basis, 0, 0.2, 0],
    characterBasis: basis,
    cache: null,
    processFloorNormal: [0, 1, 0],
    slot0Clearance: 0,
    currentMoveClearance: 0.25,
    jumpHeight: 0,
    cosMaxSlope: 0.8,
    physicsFlags: 0,
    flags: 0x40,
    action: 0,
    hitPoints: 100,
    timeMs: 12345,
    direction: [0, 0, 1],
    smoothTurnTarget: null,
    replay: false,
    replayOverride: false,
    excludePlingMaterials: false,
    ...extra,
  };
}
function host(faces, options = {}) {
  const log = [],
    slot = {},
    allocations = [];
  return {
    log,
    slot,
    allocations,
    providers: {
      collectFaces(request) {
        log.push(["collect", request]);
        return faces;
      },
      acquireCache(request) {
        allocations.push(request);
        log.push(["acquire", request]);
        return options.acquire
          ? options.acquire(request, allocations.length)
          : (request.preferredIdentity ?? slot);
      },
      queryFace(face, query) {
        log.push(["query", face.id, query]);
        return options.query
          ? options.query(face, query)
          : { parameter: 0.2, point: [query.origin[0], 0, query.origin[2]] };
      },
    },
  };
}

test("current native root retains an inclusive finite triangle without any host query", () => {
  const floor = face("floor"),
    retained = cache([floor], floor);
  for (const p of [
    [0, 999, 0],
    [-2, 0, -2],
    [0, 0, 2],
    [0, 0, -2],
  ])
    assert.equal(nativePedRetainsGroundTriangle(floor, p), true);
  assert.equal(nativePedRetainsGroundTriangle(floor, [2, 0, 0]), false);
  const result = nativePedGroundingStep(
    input({ cache: retained, flags: 0x46 }),
  );
  assert.equal(result.status, "retained");
  assert.equal(result.cache, retained);
  assert.equal(result.needGround, false);
  assert.equal(result.needProximityRescan, false);
  assert.equal(result.flags, 0x40);
  assert.deepEqual(result.effects, []);
});

test("retention preserves source partial spills, reversed winding and projected zero area", () => {
  const zero = face("vertical", { a: [0, 0, 0], b: [0, 1, 0], c: [0, 2, 0] });
  assert.equal(nativePedRetainsGroundTriangle(zero, [999, 0, -999]), true);
  const reversed = face("reverse", {
    a: [0, 0, 2],
    b: [2, 0, -2],
    c: [-2, 0, -2],
  });
  assert.equal(nativePedRetainsGroundTriangle(reversed, [0, 0, 0]), true);
  assert.equal(nativePedRetainsGroundTriangle(reversed, [3, 0, 0]), false);
  // Distances large enough that B-A has a Float32 spill distinct from its
  // live value. Source uses live bax in product1 and stored bax in product2.
  const large = face("spill", {
    a: [-16777216, 0, -1],
    b: [1, 0, -1],
    c: [1, 0, 3],
  });
  assert.equal(nativePedRetainsGroundTriangle(large, [0, 0, 0]), true);
  assert.equal(nativePedRetainsGroundTriangle(large, [2, 0, 0]), false);
});

test("cache margin compares unspilled differences to double1.5/6.9 on all six sides", () => {
  const margin = 1.5 / 6.9,
    below = f(margin),
    above = f(margin + 2e-8);
  assert.ok(below < margin && above > margin);
  for (let axis = 0; axis < 3; axis++)
    for (const side of [0, 1]) {
      const min = [-1, -1, -1],
        max = [1, 1, 1],
        p = [0, 0, 0];
      (side ? min : max)[axis] = side ? -below : below;
      assert.equal(nativePedInsideGroundCache(p, { min, max }), false);
      (side ? min : max)[axis] = side ? -above : above;
      assert.equal(nativePedInsideGroundCache(p, { min, max }), true);
    }
  // f32(root-max) would incorrectly equal the rounded margin and retain.
  assert.equal(
    nativePedInsideGroundCache([0, 0, 0], {
      min: [-1, -1, -1],
      max: [f(margin), 1, 1],
    }),
    false,
  );
});

test("cache bounds use actual native character basis and current root translation", () => {
  const rotated = [0, 0, 2, 0, 1, 0, -3, 0, 0];
  const result = nativePedGroundCacheBounds(
    [...basis, 10, 20, 30],
    rotated,
    0.25,
  );
  assert.deepEqual([...result.characterPose], [...rotated, 10, 20, 30]);
  assert.deepEqual(result.localBounds, {
    min: [f(-3 / 6.9), f(-2.5 / 6.9 - 0.25), f(-2 / 6.9)],
    max: [f(3 / 6.9), f(2.5 / 6.9 + 0.25), f(10 / 6.9)],
  });
  const b = result.worldBounds;
  assert.ok(Math.abs(b.min[0] - (10 - (3 * 10) / 6.9)) < 2e-6);
  assert.ok(Math.abs(b.max[0] - (10 + (3 * 2) / 6.9)) < 2e-6);
  assert.ok(Math.abs(b.min[2] - (30 - (2 * 3) / 6.9)) < 2e-6);
  assert.ok(Math.abs(b.max[2] - (30 + (2 * 3) / 6.9)) < 2e-6);
  assert.equal(b.min[1], f(f(20 + result.localBounds.min[1])));
});

test("changed points use stored pedestrian position and strict double400, without TTL", () => {
  assert.equal(nativePedGroundChangedNear([0, 0, 0], [[20, 0, 0]]), false);
  assert.equal(
    nativePedGroundChangedNear([0, 0, 0], [[f(20 - 1e-5), 0, 0]]),
    true,
  );
  assert.equal(nativePedGroundChangedNear([0, 0, 0], [[12, 16, 0]]), false);
  const floor = face("f"),
    old = cache([floor], floor),
    h = host([floor]);
  assert.equal(
    nativePedGroundingStep(
      input({
        cache: old,
        pedPosition: [100, 0, 0],
        changedPoints: [[100, 0, 0]],
      }),
      h.providers,
    ).rebuilt,
    true,
  );
  assert.equal(
    nativePedGroundingStep(
      input({ cache: old, timeMs: 1e12, changedPoints: [[100, 0, 0]] }),
    ).status,
    "retained",
  );
});

test("ordered source face selection uses raw80, conditional material prefixes and first tie", () => {
  const faces = [
    face("raw", { rawFlags: 0x80 }),
    face("pling", { materialIdentifier: "!wall" }),
    face("arrow", { materialIdentifier: ">wall" }),
    face("question", { materialIdentifier: "?wall" }),
    face("first"),
    face("tie"),
    face("too-far"),
  ];
  const calls = [];
  const query = (face, q) => {
    calls.push([face.id, q]);
    return { parameter: face.id === "too-far" ? 2 : 0.25, point: [1, 2, 3] };
  };
  const hit = nativePedSelectGroundSupport(faces, [0, 1, 0], 10, query, true);
  assert.equal(hit.face, faces[4]);
  assert.equal(hit.pass, 0);
  assert.deepEqual(
    calls.map(([id]) => id),
    ["first", "tie", "too-far"],
  );
  assert.deepEqual(calls[0][1], {
    origin: [0, 1, 0],
    segment: [0, -1, 0],
    excludePlingMaterials: true,
  });
  assert.equal(
    nativePedSelectGroundSupport(faces, [0, 1, 0], 0, query, false).face,
    faces[1],
  );
  assert.equal(
    nativePedSelectGroundSupport([faces[6]], [0, 1, 0], 0, query, false),
    null,
  );
});

test("two-pass selection uses slot0 clearance only after no first-pass hit", () => {
  const floor = face("f"),
    log = [];
  const query = (face, q) => {
    log.push(q.origin);
    return q.origin[1] > 1 ? { parameter: 0.5, point: [3, 1, 4] } : null;
  };
  const root = [3, f(0.1), 4],
    hit = nativePedSelectGroundSupport([floor], root, f(1.1), query, false);
  assert.equal(hit.pass, 1);
  assert.deepEqual(log, [root, [3, f(f(0.1) + f(1.1)), 4]]);
  assert.deepEqual(hit.point, [3, 1, 4]);
  log.length = 0;
  assert.equal(
    nativePedSelectGroundSupport([floor], root, 0, query, false),
    null,
  );
  assert.equal(log.length, 1);
});

test("supported target preserves hit X/Z and current offset independent of slot0 or scale", () => {
  const floor = face("floor"),
    h = host([floor], {
      query: () => ({ parameter: 0.1, point: [7, 0.1, 9] }),
    });
  const result = nativePedGroundingStep(
    input({
      slot0Clearance: 0.15,
      currentMoveClearance: 0.4,
      smoothTurnTarget: [1, 0, 0],
    }),
    h.providers,
  );
  assert.equal(result.status, "supported");
  assert.equal(result.needGround, true);
  assert.equal(result.needProximityRescan, true);
  assert.equal(result.cache.identity, h.slot);
  assert.equal(result.cache.selectedFace, floor);
  assert.deepEqual(result.effects, [
    { kind: "set-position", mode: 1, position: [7, f(f(0.1) + f(0.4)), 9] },
    { kind: "stop-smooth-turn" },
    { kind: "set-direction", direction: [1, 0, 0] },
  ]);
  assert.deepEqual(
    h.log.map(([name]) => name),
    ["collect", "acquire", "query"],
  );
});

test("support drop is signed with Float32 stores and double3/6.9, slope is strictly greater", () => {
  const floor = face("f");
  const step = (drop, normalY = 1) => {
    const q = face("f", { normal: [0, normalY, 0] }),
      h = host([q], { query: () => ({ parameter: 0.1, point: [0, 0, 0] }) });
    return nativePedGroundingStep(
      input({ rootPose: [...basis, 0, drop, 0], cosMaxSlope: 0.8 }),
      h.providers,
    );
  };
  const below = f(3 / 6.9),
    above = f(3 / 6.9 + 4e-8);
  assert.ok(below < 3 / 6.9 && above > 3 / 6.9);
  assert.equal(step(below).status, "supported");
  assert.equal(step(above).status, "fall");
  assert.equal(step(-100).status, "supported");
  assert.equal(step(0.1, f(0.8)).status, "fall");
  assert.equal(step(0.1, f(0.800001)).status, "supported");
  assert.equal(step(0.1).cache.selectedFace.id, floor.id);
});

test("reselection uses old normal dot process floor, not new support normal", () => {
  const old = face("old", { a: [9, 0, 9], b: [11, 0, 9], c: [10, 0, 11] }),
    next = face("new", { normal: [0, 0.7, 0.7] }),
    oldCache = cache([old, next], old);
  const h = host([], {
    query: (q) => (q === next ? { parameter: 0.2, point: [0, 0, 0] } : null),
  });
  // Make slope fail: successful positioning independently forces rescan.
  const result = nativePedGroundingStep(
    input({ cache: oldCache, processFloorNormal: [0, 1, 0] }),
    h.providers,
  );
  assert.equal(result.status, "fall");
  assert.equal(result.rebuilt, false);
  assert.equal(result.needProximityRescan, false);
  assert.equal(oldCache.selectedFace, old); // Input unchanged, fall clears output.
  assert.equal(result.cache.selectedFace, null);
  assert.equal(
    nativePedGroundingStep(
      input({ cache: oldCache, processFloorNormal: [0, f(0.99), 0] }),
      h.providers,
    ).needProximityRescan,
    false,
  );
  assert.equal(
    nativePedGroundingStep(
      input({ cache: oldCache, processFloorNormal: [0, f(0.989999), 0] }),
      h.providers,
    ).needProximityRescan,
    true,
  );
});

test("unsupported eligible pedestrian clears support then requests level5/move72/action3 in order", () => {
  const h = host([]),
    result = nativePedGroundingStep(input(), h.providers);
  assert.equal(result.status, "fall");
  assert.equal(result.action, 3);
  assert.equal(result.cache.selectedFace, null);
  assert.deepEqual(result.effects, [
    { kind: "stop-smooth-turn" },
    { kind: "set-physics-level", level: 5 },
    {
      kind: "select-move",
      move: 72,
      period: -1,
      restart: 0,
      completion: 0,
      action: 3,
      timeMs: 12345,
    },
    { kind: "set-action", action: 3 },
  ]);
  assert.equal(
    result.effects.some((e) => "velocity" in e || "omega" in e),
    false,
  );
});

test("unsupported unarmed pedestrian vanishes once without activating a body", () => {
  const h = host([]),
    result = nativePedGroundingStep(input({ flags: 6 }), h.providers);
  assert.equal(result.status, "vanish");
  assert.equal(result.flags, 0x80);
  assert.deepEqual(result.effects, [
    { kind: "vanish", flags: 0x80, physicsLevel: 0, releaseRender: true },
  ]);
  const again = nativePedGroundingStep(input({ flags: 0x80 }), h.providers);
  assert.equal(again.status, "already-vanished");
  assert.deepEqual(again.effects, []);
});

test("native cache capacities, source76 collection overflow and same-bucket identity preference", () => {
  for (const [count, capacity] of [
    [0, 5],
    [5, 5],
    [6, 10],
    [10, 10],
    [11, 40],
    [40, 40],
    [41, 75],
    [75, 75],
    [76, 75],
  ]) {
    const faces = Array.from({ length: count }, (_, i) => face(`f${i}`)),
      h = host(faces),
      result = nativePedGroundingStep(input(), h.providers);
    assert.equal(result.cache.capacity, capacity);
    assert.equal(result.cache.faces.length, Math.min(count, 75));
    assert.equal(result.overflow, count === 76);
    assert.equal(h.log[0][1].limit, 76);
  }
  const floor = face("f"),
    old = cache([floor], floor),
    h = host([floor]);
  const result = nativePedGroundingStep(
    input({ cache: old, invalidate: true }),
    h.providers,
  );
  assert.equal(h.allocations[0].preferredIdentity, old.identity);
  assert.equal(result.cache.identity, old.identity);
  const other = host(Array.from({ length: 6 }, (_, i) => face(i)));
  nativePedGroundingStep(
    input({ cache: old, invalidate: true }),
    other.providers,
  );
  assert.equal(other.allocations[0].preferredIdentity, null);
});

test("cache allocation retries once; failure does not become unsupported fall or vanish", () => {
  const h = host([face("f")], { acquire: () => null }),
    result = nativePedGroundingStep(input(), h.providers);
  assert.equal(result.status, "allocation-failed");
  assert.equal(result.cache, null);
  assert.equal(result.needGround, false);
  assert.equal(result.needProximityRescan, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.effects, []);
  assert.deepEqual(
    h.log.map(([name]) => name),
    ["collect", "acquire", "collect", "acquire"],
  );
  const recovered = host([face("f")], {
    acquire: (_, attempt) => (attempt === 1 ? null : {}),
  });
  assert.equal(
    nativePedGroundingStep(input(), recovered.providers).status,
    "supported",
  );
});

test("missing host providers are explicit and do not start partial cache acquisition", () => {
  let calls = 0;
  const result = nativePedGroundingStep(input(), {
    collectFaces: () => {
      calls++;
      return [];
    },
  });
  assert.equal(result.status, "provider-required");
  assert.deepEqual(result.missingProviders, ["queryFace", "acquireCache"]);
  assert.equal(calls, 0);
  assert.equal(result.needGround, false);
  const floor = face("f"),
    old = cache([floor]);
  assert.deepEqual(
    nativePedGroundingStep(input({ cache: old })).missingProviders,
    ["queryFace"],
  );
});

test("active, nonordinary action and replay gates bypass all support providers", () => {
  const h = host([]);
  for (const extra of [
    { physicsFlags: 4 },
    { action: 3 },
    { action: 5 },
    { action: 6 },
    { replay: true },
  ])
    assert.equal(
      nativePedGroundingStep(input(extra), h.providers).status,
      "bypassed",
    );
  assert.equal(h.log.length, 0);
  const floor = face("f"),
    old = cache([floor], floor);
  assert.equal(
    nativePedGroundingStep(
      input({ cache: old, replay: true, replayOverride: true }),
      host([floor]).providers,
    ).rebuilt,
    true,
  );
});

test("dead cache rebuild selects move94 action6, completion1 and source clock without random/query", () => {
  const result = nativePedGroundingStep(input({ hitPoints: 0 }));
  assert.equal(result.status, "dead-cache-move");
  assert.equal(result.action, 6);
  assert.equal(result.attempts, 2);
  assert.equal(result.needGround, false);
  assert.deepEqual(
    result.effects,
    Array.from({ length: 2 }, () => ({
      kind: "select-move",
      move: 94,
      period: -1,
      restart: 0,
      completion: 1,
      action: 6,
      timeMs: 12345,
    })),
  );
  const floor = face("f"),
    old = cache([floor], floor);
  assert.equal(
    nativePedGroundingStep(input({ cache: old, hitPoints: -1 })).status,
    "retained",
  );
  assert.equal(
    nativePedGroundingStep(
      input({ cache: old, hitPoints: -1, invalidate: true }),
    ).effects.length,
    1,
  );
  assert.equal(
    nativePedGroundingStep(
      input({ hitPoints: 0, replayOverride: true }),
      host([floor]).providers,
    ).status,
    "supported",
  );
});

test("invalid finite cache/provider data fails visibly without silent truncation or triangle guesses", () => {
  assert.throws(
    () => nativePedGroundingStep(input({ hitPoints: 128 })),
    /signed byte/,
  );
  assert.throws(
    () => nativePedGroundingStep(input({ rootPose: [...basis, NaN, 0, 0] })),
    /finite/,
  );
  assert.throws(
    () =>
      nativePedGroundingStep(
        input({ cache: cache([face("f")], face("other")) }),
      ),
    /outside/,
  );
  assert.throws(
    () =>
      nativePedGroundingStep(
        input(),
        host(Array.from({ length: 77 }, (_, i) => face(i))).providers,
      ),
    /limit/,
  );
  assert.throws(
    () =>
      nativePedSelectGroundSupport(
        [face("f")],
        [0, 0, 0],
        0,
        () => ({ parameter: NaN, point: [0, 0, 0] }),
        false,
      ),
    /finite/,
  );
});

for (const [stem, defaults] of [
  ["BIPED1", "DEFBIP1"],
  ["BIPEDF", "DEFBIP1"],
  ["DOG1", "DEFDOG1"],
]) {
  test(`original ${stem} authored default slot0/current movement clearances drive the source target`, async (t) => {
    let formText, moveText;
    try {
      formText = decodeText(
        new Uint8Array(
          await readFile(
            new URL(
              `../carma2_orig/data/PEDS/FORMS/${stem}.TXT`,
              import.meta.url,
            ),
          ),
        ),
      );
      moveText = decodeText(
        new Uint8Array(
          await readFile(
            new URL(
              `../carma2_orig/data/PEDS/MOVES/${defaults}.TXT`,
              import.meta.url,
            ),
          ),
        ),
      );
    } catch (error) {
      if (error.code === "ENOENT") {
        t.skip("Original installation/default move file unavailable");
        return;
      }
      throw error;
    }
    const form = parsePedForm(formText),
      moves = parsePedPersonalityMoves(moveText, form),
      slot0 = moves.get(form.moves[0].id),
      current = moves.get(30) ?? moves.get(41);
    assert.ok(slot0);
    assert.ok(current);
    assert.ok(form.moves.some((move) => move.id === 72));
    const floor = face("f"),
      result = nativePedGroundingStep(
        input({
          rootPose: [...basis, 0, f(slot0.groundingOffset + 0.1), 0],
          currentMoveClearance: current.groundingOffset,
          slot0Clearance: slot0.groundingOffset,
        }),
        host([floor]).providers,
      );
    assert.equal(result.status, "supported");
    assert.deepEqual(result.effects[0].position, [
      0,
      f(current.groundingOffset),
      0,
    ]);
  });
}
