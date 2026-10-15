import test from "node:test";
import assert from "node:assert/strict";
import { Euler, Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  BodyTrajectoryGuard,
  guardPairTrajectory,
} from "../src/physics/pair-guard.ts";
import { DamageSystem } from "../src/damage.ts";
import { createSimulatedCar } from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";
import { legacyGuardBodyTrajectories } from "./support/legacy-physics-guard.mjs";

const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function body(position = v(), half = v(0.2, 0.2, 0.2), immovable = false) {
  return {
    hulls: [buildBoxHull(half.clone().negate(), half.clone())],
    properties: { mass: 1, inertia: v(1, 1, 1), centerOfMass: v(), immovable },
    state: {
      position,
      orientation: new Quaternion(),
      velocity: v(),
      angularVelocity: v(),
    },
    motor: { sleeping: immovable },
  };
}

// Read live state on every call: the same paths can be reused after wake,
// crush, COM or pose changes without hiding stale working-set observations.
function path(body, delta = v(), turn = 0, axis = v(0, 1, 0)) {
  const result = (t) => ({
    position: body.state.position.clone().addScaledVector(delta, t),
    orientation: body.state.orientation
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(axis, turn * t)),
  });
  result.angularTravel = Math.abs(turn);
  result.stable = true;
  if (body.properties.immovable && delta.lengthSq() === 0 && turn === 0)
    result.constantPose = result(0);
  return result;
}

const retainedGuard = new BodyTrajectoryGuard(),
  fallbackGuard = new BodyTrajectoryGuard();
function assertResults(actual, expected, bodies, label) {
  assert.deepEqual([...actual.keys()], bodies, `${label}: output body order`);
  assert.equal(actual.size, expected.size, `${label}: output size`);
  for (const [index, body] of bodies.entries()) {
    const value = actual.get(body),
      baseline = expected.get(body);
    assert.ok(
      Object.is(value, baseline),
      `${label}: body ${index}: ${value} != reference ${baseline}`,
    );
    assert.ok(baseline >= 0 && baseline <= 1, `${label}: bounded fraction`);
  }
}

function refreshCertificates(paths) {
  for (const path of paths.values())
    if (path.constantPose) path.constantPose = path(0);
}

function uncertifiedPaths(paths) {
  return new Map(
    [...paths].map(([body, original]) => {
      const path = (fraction) => original(fraction);
      path.angularTravel = original.angularTravel;
      return [body, path];
    }),
  );
}

// PHY-16 intentionally admits geometrically confirmed OLD overlap without a
// prior recovery flag. For those explicit cases, compare retained certificates
// with a fresh guard's private, uncertified geometry rather than changing the
// frozen historical oracle's monotone-depth policy.
function compareCurrent(
  bodies,
  paths,
  label,
  allowed,
  guard = retainedGuard,
  diagnostics,
) {
  refreshCertificates(paths);
  const expected = new BodyTrajectoryGuard().run(
    bodies,
    uncertifiedPaths(paths),
    allowed,
  );
  const actual = guard.run(bodies, paths, allowed, diagnostics);
  assertResults(actual, expected, bodies, `${label} current uncached`);
  return actual;
}

function compare(
  bodies,
  paths,
  label,
  allowed,
  guard = retainedGuard,
  diagnostics,
) {
  // A certificate describes this phase only; recapture after external pose edits.
  refreshCertificates(paths);
  const expected = legacyGuardBodyTrajectories(bodies, paths, allowed);
  assertResults(
    guard.run(bodies, paths, allowed, diagnostics),
    expected,
    bodies,
    `${label} certified`,
  );
  const uncertified = uncertifiedPaths(paths);
  assertResults(
    fallbackGuard.run(bodies, uncertified, allowed),
    expected,
    bodies,
    `${label} uncertified`,
  );
  return expected;
}

test("pair working set exactly preserves shared groups alongside disconnected resting props", () => {
  const a = body(v(-0.7)),
    b = body(),
    c = body(v(0.7));
  const resting = Array.from({ length: 12 }, (_, i) =>
    body(v(10, 0, i * 2), v(0.2, 0.2, 0.2), true),
  );
  const bodies = [a, ...resting.slice(0, 6), b, c, ...resting.slice(6)];
  const paths = new Map(bodies.map((body) => [body, path(body)]));
  paths.set(a, path(a, v(1.4)));
  paths.set(b, path(b, v(0.1)));
  paths.set(c, path(c, v(-0.4)));
  for (const [index, order] of [bodies, bodies.toReversed()].entries()) {
    const expected = compare(order, paths, `shared group order ${index}`);
    assert.ok(expected.get(a) < 1, "the shared group must actually clamp");
    assert.ok(Object.is(expected.get(a), expected.get(b)));
    assert.ok(Object.is(expected.get(a), expected.get(c)));
    assert.ok(resting.every((body) => Object.is(expected.get(body), 1)));
  }
});

test("immovable scenery constrains each group without linking otherwise distant vehicles", () => {
  const left = body(v(-6.2)),
    right = body(v(6.2)),
    scenery = body(v(), v(6, 0.3, 0.3), true);
  const paths = new Map([
    [left, path(left, v(0.5))],
    [right, path(right, v(0.5))],
    [scenery, path(scenery)],
  ]);
  for (const order of [
    [left, scenery, right],
    [scenery, right, left],
  ]) {
    const expected = compare(order, paths, "large immovable bridge");
    assert.ok(expected.get(left) < 1, "incoming vehicle must clamp");
    assert.ok(Object.is(expected.get(right), 1), "outgoing vehicle stays free");
    assert.ok(Object.is(expected.get(scenery), 1));
  }
});

test("shared multi-hull bodies retain independent escaping-overlap and clear-hull allowances", () => {
  const a = body(),
    b = body(v(-0.9)),
    c = body(v(1));
  const embedded = buildBoxHull(v(-1.2, -0.2, -0.2), v(-0.8, 0.2, 0.2)),
    clear = buildBoxHull(v(0.8, -0.2, -0.2), v(1.2, 0.2, 0.2));
  a.hulls = [embedded, clear];
  const bodies = [b, a, c],
    paths = new Map([
      [a, path(a, v(-2))],
      [b, path(b)],
      [c, path(c)],
    ]);
  const legacy = legacyGuardBodyTrajectories(bodies, paths),
    actual = retainedGuard.run(bodies, paths);
  assert.ok(actual.get(a) > 0 && actual.get(a) < 1);
  assert.equal(
    actual.get(a),
    legacy.get(a),
    "real obstruction keeps its original limit",
  );
  assert.equal(
    actual.get(a),
    actual.get(b),
    "the obstructing body stays coupled",
  );
  assert.equal(
    actual.get(c),
    1,
    "an escaping overlap must not inherit an unrelated obstruction",
  );
  assert.ok(
    legacy.get(c) < 1,
    "legacy broadphase coupling demonstrates the corrected bug",
  );
  const clipped = new Map(
    [...paths].map(([item, trajectory]) => [
      item,
      (t) => trajectory(t * actual.get(item)),
    ]),
  );
  for (const [first, second] of [
    [a, b],
    [a, c],
    [b, c],
  ])
    assert.equal(
      guardPairTrajectory(
        first,
        second,
        clipped.get(first),
        clipped.get(second),
      ),
      1,
      "the independently accepted prefixes remain collision-safe",
    );

  a.hulls = [embedded];
  const escaped = compare(
    bodies.toReversed(),
    paths,
    "embedded hull escapes after clear hull removal",
  );
  assert.ok(Object.is(escaped.get(a), 1));
});

test("recursive attachment roots link non-overlapping immovable members before bounds rejection", () => {
  const root = body(v(-0.8)),
    obstacle = body(),
    child = body(v(100), v(0.1, 0.1, 0.1), true),
    grandchild = body(v(-100), v(0.1, 0.1, 0.1), true);
  child.joint = { parent: root };
  grandchild.joint = { parent: child };
  const bodies = [grandchild, obstacle, child, root];
  const paths = new Map(bodies.map((body) => [body, path(body)]));
  paths.set(root, path(root, v(1.5)));
  const expected = compare(bodies, paths, "distant same-root members");
  assert.ok(expected.get(root) < 1);
  for (const member of [child, grandchild, obstacle])
    assert.ok(Object.is(expected.get(member), expected.get(root)));

  const allowed = (a, b) => ![a, b].includes(grandchild);
  const masked = compare(
    bodies,
    paths,
    "mask precedes same-root union",
    allowed,
  );
  assert.ok(Object.is(masked.get(grandchild), 1));
  assert.ok(Object.is(masked.get(child), masked.get(root)));
});

test("mutable pair masks preserve exact group limits without stale rejected or admitted pairs", () => {
  const a = body(v(-1)),
    b = body(),
    c = body(v(1));
  const bodies = [a, b, c],
    paths = new Map([
      [a, path(a, v(2))],
      [b, path(b)],
      [c, path(c, v(-0.4))],
    ]);
  const mask = new Set(),
    allowed = (a, b) => !mask.has(a) && !mask.has(b);
  const full = compare(bodies, paths, "all pairs enabled", allowed);
  assert.ok(full.get(a) < 1);
  mask.add(a);
  const rejected = compare(bodies, paths, "moving body masked", allowed);
  assert.ok(Object.is(rejected.get(a), 1));
  mask.add(b);
  const none = compare(
    bodies.toReversed(),
    paths,
    "all useful pairs masked",
    allowed,
  );
  assert.ok(bodies.every((body) => Object.is(none.get(body), 1)));
  mask.clear();
  compare(
    bodies.toReversed(),
    paths,
    "mask restored after reordered invocation",
    allowed,
  );
});

test("full rotation and angularTravel bounds preserve shared-group fractions with clear endpoints", () => {
  for (const turn of [Math.PI, 2 * Math.PI, 8 * Math.PI]) {
    const rod = body(v(), v(0.5, 0.05, 0.05)),
      target = body(v(0, 0, 0.35), v(0.025, 0.025, 0.025)),
      attached = body(v(20), v(0.01, 0.01, 0.01));
    attached.joint = { parent: target };
    const bodies = [target, attached, rod],
      paths = new Map([
        [rod, path(rod, v(), turn)],
        [target, path(target)],
        [attached, path(attached)],
      ]);
    const expected = compare(bodies, paths, `complete rotation ${turn}`);
    assert.ok(expected.get(rod) > 0 && expected.get(rod) < 1);
    assert.ok(Object.is(expected.get(attached), expected.get(rod)));
  }
});

test("custom moving paths remain authoritative even when their bodies are immovable", () => {
  const movingScenery = body(v(-1), v(0.2, 0.2, 0.2), true),
    dynamic = body(),
    otherScenery = body(v(20), v(0.2, 0.2, 0.2), true);
  const bodies = [otherScenery, dynamic, movingScenery],
    paths = new Map([
      [movingScenery, path(movingScenery, v(2))],
      [dynamic, path(dynamic)],
      [otherScenery, path(otherScenery, v(-40))],
    ]);
  const expected = compare(
    bodies,
    paths,
    "two independently moving immovable paths",
  );
  assert.ok(expected.get(dynamic) < 1);
  assert.ok(Object.is(expected.get(movingScenery), 1));
  assert.ok(Object.is(expected.get(otherScenery), 1));

  movingScenery.hulls = [
    buildBoxHull(v(-0.5, -0.05, -0.05), v(0.5, 0.05, 0.05)),
  ];
  movingScenery.state.position.set(0, 0, 0);
  dynamic.state.position.set(0, 0, 0.35);
  paths.set(movingScenery, path(movingScenery, v(), 8 * Math.PI));
  const rotated = compare(
    bodies.toReversed(),
    paths,
    "rotating immovable custom path",
  );
  assert.ok(rotated.get(dynamic) > 0 && rotated.get(dynamic) < 1);
});

test("working sets observe wake, in-place hull, COM, pose and attachment changes between calls", () => {
  const a = body(v(-1)),
    b = body(),
    c = body(v(10), v(0.1, 0.1, 0.1), true);
  const bodies = [a, b, c],
    paths = new Map([
      [a, path(a, v(2))],
      [b, path(b)],
      [c, path(c)],
    ]);
  const first = compare(bodies, paths, "initial working set");
  assert.ok(first.get(a) < 1);

  const hull = a.hulls[0];
  for (const vertex of hull.vertices) vertex.x += 6;
  for (const face of hull.faces) face.constant += face.normal.x * 6;
  const crushed = compare(
    bodies.toReversed(),
    paths,
    "same hull identity, moved vertices and planes",
  );
  assert.ok(Object.is(crushed.get(a), 1));

  a.hulls[0] = buildBoxHull(v(-0.3, -0.15, -0.1), v(0.3, 0.15, 0.1));
  a.properties.centerOfMass.set(0.12, -0.04, 0.08);
  b.properties.centerOfMass.set(-0.07, 0.03, 0);
  a.state.orientation.setFromEuler(new Euler(0.11, 0.27, -0.08));
  b.state.orientation.setFromEuler(new Euler(-0.13, 0.05, 0.19));
  a.state.position.set(-0.9, 0.02, 0.03);
  const replaced = compare(
    [b, c, a],
    paths,
    "replacement hull, COM and pose mutations",
  );
  assert.ok(replaced.get(a) < 1);

  c.motor.sleeping = false;
  c.properties.immovable = false;
  c.state.position.set(0.7, 0, 0);
  paths.set(c, path(c, v(-0.4)));
  const awake = compare(bodies, paths, "awakened body joins current group");
  assert.ok(Object.is(awake.get(a), awake.get(c)));

  c.state.position.set(100, 0, 0);
  c.joint = { parent: a };
  const attached = compare([c, b, a], paths, "new distant attachment");
  assert.ok(Object.is(attached.get(a), attached.get(c)));
  delete c.joint;
  const detached = compare(
    [c, b, a],
    paths,
    "attachment removed on same body identities",
  );
  assert.ok(Object.is(detached.get(c), 1));
});

test("repeated paths preserve historical clear-contact results and explicit PHY-16 old-overlap admission", () => {
  const a = body(),
    b = body(),
    resting = body(v(8), v(0.2, 0.2, 0.2), true),
    bodies = [a, resting, b];
  const cases = [
    ["separated", -1, -0.5, false],
    ["touching separation", -0.4, -0.5, false],
    ["touching slide", -0.4, 0, false, v(0, 0, 1)],
    ["overlap escape", -0.2, -1, false],
    ["overlap deepens", -0.2, 0.1, true],
    ["clear-end crossing", -1, 2, true],
    ["overlap escapes and re-enters", -0.2, 0, true, null],
  ];
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const [label, start, dx, blocked, delta] of cases) {
      a.state.position.set(start, 0, 0);
      const pa =
        delta === null
          ? (t) => ({
              position: v(start - Math.sin(Math.PI * t)),
              orientation: new Quaternion(),
            })
          : path(a, delta ?? v(dx));
      pa.stable = true;
      const paths = new Map([
        [a, pa],
        [b, path(b)],
        [resting, path(resting)],
      ]);
      const order = repeat % 2 ? bodies.toReversed() : bodies;
      const admitted =
        label === "overlap deepens" ||
        label === "overlap escapes and re-enters";
      const expected = (admitted ? compareCurrent : compare)(
        order,
        paths,
        `${label} repeat ${repeat}`,
      );
      if (admitted) {
        const legacy = legacyGuardBodyTrajectories(order, paths);
        assert.ok(legacy.get(a) < 1, `${label}: historical depth guard clamps`);
        assert.equal(
          expected.get(a),
          1,
          `${label}: PHY-16 admits the OLD hull cell for this phase`,
        );
      } else if (blocked)
        assert.ok(expected.get(a) < 1, `${label} must exercise clamping`);
      else assert.ok(Object.is(expected.get(a), 1), `${label} remains free`);
      assert.ok(Object.is(expected.get(resting), 1));
    }
  }
});

test("sphere tolerance contacts outside tight stationary hull bounds retain the legacy zero clamp", () => {
  const radius = Math.fround(0.1),
    sphere = body(v(0.2005)),
    target = body(v(), v(radius, radius, radius), true);
  sphere.kind = "pedestrian-bone";
  sphere.shape = {
    type: "SPHERE",
    center: [0, 0, 0],
    radius,
    radiusSquared: Math.fround(radius * radius),
  };
  sphere.hulls = [];
  const paths = new Map([
    [sphere, path(sphere)],
    [target, path(target)],
  ]);
  for (const bodies of [
    [sphere, target],
    [target, sphere],
  ]) {
    const diagnostics = {};
    const expected = compare(
      bodies,
      paths,
      "stationary Float32 sphere tolerance",
      undefined,
      retainedGuard,
      diagnostics,
    );
    assert.ok(
      Object.is(expected.get(sphere), 0),
      "the legacy analytic emitter clamps the tolerance contact at zero",
    );
    assert.ok(Object.is(expected.get(target), 1));
    assert.equal(
      diagnostics.pairGuardCalls,
      1,
      "the tolerance pair must reach the analytic guard",
    );
  }
});

test("sparse480 guard reduces discovery work while retaining exact results and phase-local geometry", (t) => {
  const moving = body(v(-0.7)),
    target = body(v(), v(0.2, 0.2, 0.2), true),
    bodies = [moving, target];
  for (let i = 0; i < 478; i++)
    bodies.push(
      body(
        v(20 + (i % 24) * 3, 0, Math.floor(i / 24) * 3),
        v(0.2, 0.2, 0.2),
        true,
      ),
    );
  const paths = new Map(bodies.map((body) => [body, path(body)]));
  paths.set(moving, path(moving, v(1.4)));
  let oldMasks = 0;
  const expected = legacyGuardBodyTrajectories(bodies, paths, () => {
    oldMasks++;
    return true;
  });
  const context = new BodyTrajectoryGuard(),
    diagnostics = {};
  let newMasks = 0;
  const actual = context.run(
    bodies,
    paths,
    () => {
      newMasks++;
      return true;
    },
    diagnostics,
  );
  assertResults(actual, expected, bodies, "sparse480 certified workload");
  assert.ok(expected.get(moving) < 1);
  assert.ok(
    newMasks < oldMasks / 10,
    `${newMasks} optimized mask calls versus ${oldMasks} legacy`,
  );
  assert.ok(diagnostics.boundsTests + diagnostics.nodeTests < oldMasks / 10);
  assert.equal(newMasks, diagnostics.maskTests + diagnostics.pairGuardCalls);
  assert.equal(diagnostics.pairGuardCalls, 1);
  assert.ok(
    diagnostics.snapshotHits > 0,
    "static bound and pair share a same-phase snapshot",
  );
  assert.ok(
    diagnostics.hullTransforms >= 479,
    "stationary geometry is captured in this phase",
  );
  assert.equal(diagnostics.staticRebuilds, 1);
  t.diagnostic(
    `sparse480: masks ${oldMasks} legacy/${newMasks} optimized; bounds ${diagnostics.boundsTests}; nodes ${diagnostics.nodeTests}; pairs ${diagnostics.pairGuardCalls}`,
  );
  const firstTransforms = diagnostics.hullTransforms;
  compare(
    bodies,
    paths,
    "sparse480 repeated retained context",
    undefined,
    context,
    diagnostics,
  );
  assert.equal(
    diagnostics.staticRebuilds,
    0,
    "unchanged static index can be reused",
  );
  assert.equal(
    diagnostics.hullTransforms,
    firstTransforms,
    "geometry must be rebuilt even when the index survives",
  );

  const staticHull = target.hulls[0],
    staticOriginalVertices = staticHull.vertices.map((vertex) =>
      vertex.clone(),
    ),
    staticOriginalConstants = staticHull.faces.map((face) => face.constant);
  for (const vertex of staticHull.vertices) vertex.x += 6;
  for (const face of staticHull.faces) face.constant += face.normal.x * 6;
  const staticCrushed = compare(
    bodies,
    paths,
    "sparse480 retained static hull changed in place",
    undefined,
    context,
    diagnostics,
  );
  assert.ok(Object.is(staticCrushed.get(moving), 1));
  assert.equal(diagnostics.staticRebuilds, 1);
  staticHull.vertices.forEach((vertex, i) =>
    vertex.copy(staticOriginalVertices[i]),
  );
  staticHull.faces.forEach((face, i) => {
    face.constant = staticOriginalConstants[i];
  });
  const staticRepaired = compare(
    bodies,
    paths,
    "sparse480 static hull repaired in place",
    undefined,
    context,
    diagnostics,
  );
  assert.ok(Object.is(staticRepaired.get(moving), expected.get(moving)));
  assert.equal(diagnostics.staticRebuilds, 1);

  target.state.position.set(10, 0, 0);
  const changed = compare(
    bodies,
    paths,
    "sparse480 static pose mutation",
    undefined,
    context,
    diagnostics,
  );
  assert.ok(Object.is(changed.get(moving), 1));
  assert.equal(diagnostics.staticRebuilds, 1);
  target.motor.sleeping = false;
  target.properties.immovable = false;
  target.state.position.set(0, 0, 0);
  delete paths.get(target).constantPose;
  compare(
    bodies.toReversed(),
    paths,
    "sparse480 wake and reorder",
    undefined,
    context,
    diagnostics,
  );
  assert.equal(diagnostics.movable, 2);
  assert.equal(diagnostics.staticRebuilds, 1);
  context.clear();
  compare(
    bodies,
    paths,
    "sparse480 cleared context",
    undefined,
    context,
    diagnostics,
  );
  assert.equal(diagnostics.staticRebuilds, 1);
});

test("shared partners reduce source geometry cloning without sharing pair depth or escape allowances", (t) => {
  const moving = body(),
    targets = Array.from({ length: 12 }, (_, i) =>
      body(v(i * 0.18, 0, 0), v(0.2, 0.2, 0.2), true),
    ),
    bodies = [moving, ...targets],
    paths = new Map(bodies.map((body) => [body, path(body)]));
  paths.set(moving, path(moving, v(2.4)));
  let vertexClones = 0;
  for (const body of bodies)
    for (const hull of body.hulls)
      for (const vertex of hull.vertices) {
        const clone = vertex.clone.bind(vertex);
        vertex.clone = () => {
          vertexClones++;
          return clone();
        };
      }
  const legacy = legacyGuardBodyTrajectories(bodies, paths);
  const legacyClones = vertexClones;
  const expected = new BodyTrajectoryGuard().run(
    bodies,
    uncertifiedPaths(paths),
  );
  vertexClones = 0;
  const context = new BodyTrajectoryGuard(),
    diagnostics = {};
  assertResults(
    context.run(bodies, paths, undefined, diagnostics),
    expected,
    bodies,
    "shared partners certified",
  );
  assert.ok(expected.get(moving) < 1);
  assert.ok(
    legacy.get(moving) < 1e-5,
    "historical depth guard stalls on the initially overlapping partners",
  );
  assert.ok(
    Math.abs(expected.get(moving) - 0.14 / 2.4) < 1e-6,
    "PHY-16 admits old partners but the first initially clear target still clamps at its geometric gap",
  );
  assert.ok(
    vertexClones < legacyClones,
    `${vertexClones} optimized source-point clones versus ${legacyClones} legacy`,
  );
  // The original feature sweep also clones source edge endpoints; this counter
  // therefore measures total source geometry work, not only pose transforms.
  assert.ok(vertexClones >= diagnostics.hullTransforms * 8);
  assert.ok(diagnostics.snapshotHits > diagnostics.pairGuardCalls);
  assert.equal(diagnostics.pairGuardCalls, targets.length);
  t.diagnostic(
    `shared partners: source vertex clones ${legacyClones} legacy/${vertexClones} optimized; hull transforms ${diagnostics.hullTransforms}; snapshot hits ${diagnostics.snapshotHits}; pairs ${diagnostics.pairGuardCalls}`,
  );

  const sourceHull = moving.hulls[0],
    sourceOriginalVertices = sourceHull.vertices.map((vertex) =>
      vertex.clone(),
    ),
    sourceOriginalConstants = sourceHull.faces.map((face) => face.constant);
  for (const vertex of sourceHull.vertices) vertex.x += 6;
  for (const face of sourceHull.faces) face.constant += face.normal.x * 6;
  vertexClones = 0;
  const crushed = compare(
    bodies,
    paths,
    "shared partners crushed between phases",
    undefined,
    context,
    diagnostics,
  );
  assert.ok(Object.is(crushed.get(moving), 1));
  assert.ok(
    diagnostics.hullTransforms > 0,
    "no source geometry snapshot survives crush",
  );
  sourceHull.vertices.forEach((vertex, i) =>
    vertex.copy(sourceOriginalVertices[i]),
  );
  sourceHull.faces.forEach((face, i) => {
    face.constant = sourceOriginalConstants[i];
  });
  const repaired = compareCurrent(
    bodies,
    paths,
    "shared partners repaired in place",
    undefined,
    context,
    diagnostics,
  );
  assert.ok(Object.is(repaired.get(moving), expected.get(moving)));
  assert.ok(
    diagnostics.hullTransforms > 0,
    "repair receives a fresh geometry phase",
  );
});

async function stock(t, name) {
  let original;
  try {
    original = await originalCar(name);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    t.skip("Original installation absent");
    return null;
  }
  const damage = new DamageSystem(
    original.assets,
    original.group,
    original.text,
  );
  await damage.init();
  return createSimulatedCar(
    original.group,
    original.text,
    damage,
    v(),
    0,
    true,
  );
}

for (const name of ["EAGLE3", "buggy", "bigdump"]) {
  test(`original ${name} multi-body group fractions exactly preserve the legacy oracle`, async (t) => {
    const a = await stock(t, name);
    if (!a) return;
    const b = await stock(t, "EAGLE3");
    if (!b) return;
    const prop = body(v(0.8, 0, 0.1), v(0.15, 0.15, 0.15), true),
      resting = body(v(10), v(0.2, 0.2, 0.2), true),
      bodies = [a, resting, prop, b];
    for (const [index, turn] of [0, 0.4, 2 * Math.PI].entries()) {
      a.state.position.set(-2, 0, 0.05);
      a.state.orientation.identity();
      b.state.position.set(0, 0, 0);
      b.state.orientation.setFromEuler(new Euler(0.07, 0.13, -0.05));
      const paths = new Map([
        [a, path(a, v(4, 0, 0.1), turn)],
        [b, path(b, v(0.15))],
        [prop, path(prop)],
        [resting, path(resting)],
      ]);
      const expected = compare(
        index % 2 ? bodies.toReversed() : bodies,
        paths,
        `${name} authored hull group ${index}`,
      );
      assert.ok(expected.get(a) < 1, "authored multi-body scenario must clamp");
      assert.ok(Object.is(expected.get(a), expected.get(b)));
      assert.ok(Object.is(expected.get(resting), 1));
    }
  });
}
