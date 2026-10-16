import test from "node:test";
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { Vector3 } from "three";
import { createAssetStore } from "../server/assets.mjs";
import { decodeText } from "../src/formats.ts";
import { parseTrackConfig } from "../src/config.ts";
import { NativeProjectedRoute } from "../src/ai/path-route.ts";
import { getStraightPathGeometry } from "../src/ai/path-geometry.ts";
import {
  calculateNativePathCorners,
  calculateNativeSpeedConstraints,
  nearestSectionInStraight,
} from "../src/ai/path-constraints.ts";
import { NativePhysicalPathFollower } from "../src/ai/path-follow.ts";
import { NativeGetNearPlayerState } from "../src/ai/get-near-state.ts";

const nodes = [new Vector3(), new Vector3(0, 0, 20)];
const sections = [
  {
    nodeIndices: [0, 1],
    minSpeed: [0, 0],
    maxSpeed: [17, 19],
    width: 2,
    type: 0,
    oneWay: false,
  },
];
function query(points, nowMs) {
  return {
    position: points[0].clone().lerp(points[1], 0.5),
    velocity: new Vector3(),
    dtMs: 16,
    nowMs,
    maxCurve: 0.2,
    mass: 2,
    factor: 1,
    engineDamage: 0,
    transmissionDamage: 0,
    currentCurvature: 0,
    actorRow2: new Vector3(0, 0, -1),
    targetPosition: points[1].clone(),
    cheating: false,
    strength: 5,
    opponentFlags: 0,
    ignoreEnd: false,
    neverStruggle: true,
    pursuit: false,
  };
}
function assertFinite(value) {
  if (typeof value === "number") assert.ok(Number.isFinite(value));
  else if (value && typeof value === "object")
    for (const part of Object.values(value)) assertFinite(part);
}

test("a twelve-slot route over one valid section stays usable through geometry and physical following", () => {
  const projected = new NativeProjectedRoute(nodes.length, sections);
  projected.append(0, 1);
  projected.topUpRandom(-1, false, () => 0);
  const route = projected.entries;
  assert.equal(route.length, 12);
  assert.deepEqual(
    route.map((x) => x.direction),
    [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
  );
  for (let slot = 0; slot < route.length; slot++) {
    const straight = getStraightPathGeometry(nodes, sections, route, slot);
    assert.equal(
      straight.nextSlot,
      -1,
      `undefined metadata at slot ${slot + 1}`,
    );
    const corners = calculateNativePathCorners(nodes, sections, route, slot);
    assert.deepEqual(corners, []);
    const soc = calculateNativeSpeedConstraints(
      nodes,
      sections,
      route,
      corners,
      slot,
    );
    assert.deepEqual(soc, [], "no corner records implies no SOC records");
    assert.equal(
      nearestSectionInStraight(nodes, sections, route, slot, -1, 100),
      slot,
    );
    const follower = new NativePhysicalPathFollower();
    follower.start(100, slot);
    const result = follower.run(
      nodes,
      sections,
      route,
      query(nodes, 116),
      () => 0,
    );
    assert.equal(result.kind, "ok");
    assertFinite(result);
  }
});

function exerciseGetNear(points, metadata) {
  const route = new NativeProjectedRoute(points.length, metadata);
  const follower = new NativePhysicalPathFollower();
  const state = new NativeGetNearPlayerState(
    points,
    metadata,
    route,
    follower,
    () => 0,
  );
  const started = state.start(query(points, 100), {
    section: -1,
    refreshAtMs: 0,
  });
  assert.equal(started.route.length, 12);
  assert.ok(started.route.every((entry) => entry.section === 0));
  let cache = started.targetCache;
  for (let tick = 1; tick <= 4; tick++) {
    const result = state.run(query(points, 100 + tick * 16), cache);
    cache = result.targetCache;
    assert.equal(result.transition, "continue");
    assert.equal(result.follower.kind, "ok");
    assertFinite(result);
  }
}

test("GetNearPlayer can acquire and follow repeated sections in a small authored graph", () => {
  exerciseGetNear(nodes, sections);
});

test("the short-graph boundary does not hide malformed referenced geometry", () => {
  assert.throws(
    () =>
      getStraightPathGeometry(nodes, sections, [{ section: 99, direction: 1 }]),
    /Invalid opponent path section/,
  );
  assert.throws(
    () =>
      getStraightPathGeometry(nodes, sections, [{ section: 0, direction: 2 }]),
    /Invalid projected path direction/,
  );
});

const assetRoot = resolve(process.env.CARMA2_ROOT || "carma2_orig");
let present = true;
try {
  await access(assetRoot);
} catch {
  present = false;
}
test(
  "original Stock quarrynet's one-section graph supports native GetNearPlayer",
  { skip: !present },
  async () => {
    const assets = await createAssetStore(assetRoot);
    const bytes = await assets.read("data/RACES/quarrynet/quarrynet.txt");
    assert.ok(bytes, "Original quarrynet TXT missing");
    const track = parseTrackConfig(decodeText(bytes));
    assert.equal(track.pathNodes.length, 2);
    assert.equal(track.pathSections.length, 1);
    exerciseGetNear(
      track.pathNodes.map((p) => new Vector3(...p)),
      track.pathSections,
    );
  },
);
