import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import {
  nativeFallenGroundMaterialEligible,
  nativeFindYVerticallyBelow2,
  nativeHasCarFallenOffWorld,
  nativeTeleportOpponentToNearestSafeLocation,
} from "../src/ai/fallen-world.ts";
import { NativeProjectedRoute } from "../src/ai/path-route.ts";

const query = (overrides = {}) => ({
  position: new Vector3(),
  actorUp: new Vector3(0, 1, 0),
  driver: 6,
  wheelsOnGround: 0,
  cachedMaterialNames: [],
  carFlying: false,
  actionReplay: false,
  ...overrides,
});
const miss = () => ({ y: -3.4028234663852886e38, materialName: null });

test("FindYBelow2 queries at most11 iterative Float32 origins and accepts height=-100", () => {
  const points = [];
  const origin = new Vector3(2, 0, 3);
  const hit = nativeFindYVerticallyBelow2(origin, (p) => {
    points.push(p.clone());
    return points.length === 11 ? { y: -100, materialName: "road" } : miss();
  });
  assert.equal(hit.y, -100);
  assert.equal(points.length, 11);
  let y = 0;
  for (const point of points) {
    assert.equal(point.y, y);
    y = Math.fround(y + Math.fround(0.2));
  }
  assert.deepEqual(origin.toArray(), [2, 0, 3]);
  assert.notEqual(points[10].y, Math.fround(10 * Math.fround(0.2)));
  assert.equal(nativeFallenGroundMaterialEligible(null), true);
  assert.equal(nativeFallenGroundMaterialEligible("#water"), true);
  assert.equal(nativeFallenGroundMaterialEligible("^void"), true);
  assert.equal(nativeFallenGroundMaterialEligible("!water"), false);
  assert.equal(nativeFallenGroundMaterialEligible(">invisible"), false);
});

test("grounded check scans cached faces; flight exempts only driver8; replay exempts all", () => {
  const never = () => assert.fail("Unexpected ground query");
  assert.equal(
    nativeHasCarFallenOffWorld(
      query({
        wheelsOnGround: 1,
        cachedMaterialNames: [null, "road", "^void"],
      }),
      never,
    ),
    true,
  );
  assert.equal(
    nativeHasCarFallenOffWorld(
      query({ wheelsOnGround: 1, cachedMaterialNames: ["road", null] }),
      never,
    ),
    false,
  );
  assert.equal(
    nativeHasCarFallenOffWorld(query({ driver: 8, carFlying: true }), never),
    false,
  );
  assert.equal(
    nativeHasCarFallenOffWorld(query({ actionReplay: true }), never),
    false,
  );
  assert.equal(
    nativeHasCarFallenOffWorld(query({ driver: 6, carFlying: true }), () => ({
      y: 0,
      materialName: "^void",
    })),
    true,
  );
});

test("first ordinary/^ hit decides immediately; rotated-up hit ignores its material", () => {
  let count = 0;
  assert.equal(
    nativeHasCarFallenOffWorld(query(), () => {
      count++;
      return { y: -100, materialName: "^void" };
    }),
    true,
  );
  assert.equal(count, 1);
  assert.equal(
    nativeHasCarFallenOffWorld(query(), () => ({ y: 0, materialName: "road" })),
    false,
  );
  const points = [];
  assert.equal(
    nativeHasCarFallenOffWorld(
      query({ actorUp: new Vector3(1, 0, 0) }),
      (p) => {
        points.push(p.clone());
        return p.x === 1 ? { y: 0, materialName: "^void" } : miss();
      },
    ),
    false,
  );
  assert.equal(points.length, 12);
  assert.deepEqual(points[11].toArray(), [1, 0, 0]);
});

test("around checks are independent+X/+Z with bounded recursion and early escape", () => {
  const points = [];
  assert.equal(
    nativeHasCarFallenOffWorld(query(), (p) => {
      points.push(p.clone());
      return miss();
    }),
    true,
  );
  assert.equal(points.length, 66);
  assert.deepEqual(points[0].toArray(), [0, 0.5, 0]);
  assert.deepEqual(points[22].toArray(), [Math.fround(0.05), 0.5, 0]);
  assert.deepEqual(points[44].toArray(), [0, 0.5, Math.fround(0.05)]);
  let calls = 0;
  assert.equal(
    nativeHasCarFallenOffWorld(query(), (p) => {
      calls++;
      return p.x > 0 ? { y: 0, materialName: "road" } : miss();
    }),
    false,
  );
  assert.equal(calls, 23);
});

const section = (a, b) => ({
  nodeIndices: [a, b],
  minSpeed: [0, 0],
  maxSpeed: [80, 80],
  width: 4,
  type: 0,
  oneWay: false,
});
function relocationFixture() {
  const nodes = [new Vector3(), new Vector3(10, 0, 0)],
    sections = [section(0, 1)];
  return {
    nodes,
    sections,
    route: new NativeProjectedRoute(nodes.length, sections),
  };
}
const relocation = (overrides = {}) => ({
  position: new Vector3(),
  cachedDirection: new Vector3(1, 0, 0),
  playerPosition: new Vector3(),
  viewDistance: 5,
  nowMs: 99,
  ...overrides,
});

test("relocation skips seed, uses reversed native dot rule and retains proximity updates", () => {
  const a = relocationFixture();
  const result = nativeTeleportOpponentToNearestSafeLocation(
    a.nodes,
    a.sections,
    a.route,
    relocation(),
    () => 0,
  );
  assert.equal(result.kind, "relocated");
  assert.equal(result.endpointVisits, 1);
  assert.equal(result.position.x, 10);
  assert.equal(result.route[0].direction, 0);
  assert.equal(result.physicsActive, false);
  assert.equal(result.resetMotion, true);
  const b = relocationFixture();
  const opposite = nativeTeleportOpponentToNearestSafeLocation(
    b.nodes,
    b.sections,
    b.route,
    relocation({ cachedDirection: new Vector3(-1, 0, 0) }),
    () => 0,
  );
  assert.equal(opposite.endpointVisits, 2);
  assert.equal(opposite.lastInViewMs, 99);
  assert.equal(opposite.route[0].direction, 1);
});

test("stored view-distance equality continues; exhausted bounded walk reports failure", () => {
  const a = relocationFixture();
  const result = nativeTeleportOpponentToNearestSafeLocation(
    a.nodes,
    a.sections,
    a.route,
    relocation({ playerPosition: new Vector3(20, 0, 0), viewDistance: 10 }),
    () => 0,
  );
  assert.equal(result.endpointVisits, 2);
  assert.equal(result.position.x, 0);
  const b = relocationFixture();
  const bounded = nativeTeleportOpponentToNearestSafeLocation(
    b.nodes,
    b.sections,
    b.route,
    relocation({ viewDistance: 10 }),
    () => 0,
    11,
  );
  assert.equal(bounded.kind, "bound-exhausted");
  assert.match(bounded.diagnostic, /11 endpoint visits/);
  // Visit11 consumes the logical final slot: shift/refill occurs before exit.
  assert.equal(bounded.route.length, 12);
  assert.equal(bounded.route[0].direction, 1);
  assert.equal(bounded.position.x, 10);
});

test("missing nearest returns before motion reset or mutation of shared projected route", () => {
  const route = new NativeProjectedRoute(0, []);
  const result = nativeTeleportOpponentToNearestSafeLocation(
    [],
    [],
    route,
    relocation(),
    () => 0,
  );
  assert.equal(result.kind, "no-route");
  assert.equal(result.resetMotion, undefined);
  assert.equal(result.physicsActive, undefined);
  assert.equal(result.endpointVisits, 0);
  assert.deepEqual(result.route, []);
});

test("escape at the final logical slot still consumes/refills the shared backing before returning", () => {
  const nodes = Array.from(
    { length: 13 },
    (_, index) => new Vector3(index, 0, 0),
  );
  const sections = nodes.slice(1).map((_, index) => section(index, index + 1));
  const route = new NativeProjectedRoute(nodes.length, sections);
  const result = nativeTeleportOpponentToNearestSafeLocation(
    nodes,
    sections,
    route,
    relocation({ viewDistance: 10.5 }),
    () => 0,
  );
  assert.equal(result.kind, "relocated");
  assert.equal(result.endpointVisits, 11);
  assert.equal(result.position.x, 11);
  assert.equal(result.route.length, 12);
  assert.deepEqual(result.route[0], { section: 10, direction: 1 });
  assert.deepEqual(result.route[1], { section: 11, direction: 1 });
});
