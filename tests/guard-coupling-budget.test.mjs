import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { hullPenetration, transformHull } from "../src/physics/geometry.ts";
import {
  BodyTrajectoryGuard,
  guardPairTrajectory,
} from "../src/physics/pair-guard.ts";

const v = (...values) => new Vector3(...values);
const half = 0.00002;
const box = (offset = v()) =>
  buildBoxHull(
    v(-half, -half, -half).add(offset),
    v(half, half, half).add(offset),
  );
function body(x, y, z = 0, immovable = false) {
  return {
    hulls: [box()],
    state: {
      position: v(x, y, z),
      orientation: new Quaternion(),
      velocity: v(),
      angularVelocity: v(),
    },
    properties: {
      mass: 1,
      inertia: v(1, 1, 1),
      centerOfMass: v(),
      immovable,
    },
  };
}

test("guard work exhaustion seals one component and preserves a disconnected clear body", () => {
  const paths = new Map();
  const allowed = new Map();
  const allowedPairs = [];
  const permit = (a, b) => {
    allowedPairs.push([a, b]);
    for (const [item, other] of [
      [a, b],
      [b, a],
    ]) {
      if (!allowed.has(item)) allowed.set(item, new Set());
      allowed.get(item).add(other);
    }
  };
  const path = (item, delta = v()) => {
    const position = item.state.position.clone();
    const orientation = item.state.orientation.clone();
    const trajectory = (fraction) => ({
      position: position.clone().addScaledVector(delta, fraction),
      orientation,
    });
    trajectory.stable = true;
    if (item.properties.immovable) trajectory.constantPose = trajectory(0);
    paths.set(item, trajectory);
  };

  const hub = body(0, 0);
  const observer = body(0, 100);
  observer.properties.centerOfMass.z = 100;
  path(observer);
  path(hub, v(0.01, 0, 0));
  permit(observer, hub);
  hub.hulls.push(box(v(0, 0, 30)));
  const hubWall = body(0.009 + 2 * half, 0, 30, true);
  path(hubWall);
  permit(hub, hubWall);

  const neighbors = [];
  const walls = [];
  // Each remote hull meets its own blocker at a distinct prefix. The main
  // vertical trajectory misses the full horizontal hub path, but crosses a
  // particular shortened hub path. Reverse order forces repeated discovery
  // passes instead of finding every dependency in a single forward scan.
  for (let i = 29; i >= 0; i--) {
    const cap = 0.9 - 0.025 * (i + 1);
    const trigger = 0.9 - 0.025 * i;
    const lane = 1 + i * 0.1;
    const item = body(0.005 * trigger, 0.01);
    item.hulls.push(box(v(0, 0, lane)));
    path(item, v(0, -0.02 / cap, 0));
    const wall = body(item.state.position.x, -0.01 - 2 * half, lane, true);
    path(wall);
    permit(item, wall);
    permit(hub, item);
    neighbors.push(item);
    walls.push(wall);
    assert.equal(
      guardPairTrajectory(hub, item, paths.get(hub), paths.get(item)),
      1,
      "full trajectories must initially be clear",
    );
  }

  const clear = body(0, 1000.00005);
  const prop = body(0, 1000);
  const blocker = body(0.00003, 1000, 0, true);
  path(clear, v(-0.00002, 0, 0));
  path(prop, v(0.00002, 0, 0));
  path(blocker);
  permit(clear, prop);
  permit(prop, blocker);
  permit(clear, blocker);
  const bodies = [
    observer,
    hub,
    ...neighbors,
    hubWall,
    ...walls,
    clear,
    prop,
    blocker,
  ];
  const diagnostics = {};
  const limits = new BodyTrajectoryGuard().run(
    bodies,
    paths,
    (a, b) => allowed.get(a)?.has(b) ?? false,
    diagnostics,
  );
  const budget = Math.max(64, allowedPairs.length * 4);
  assert.equal(diagnostics.revalidationCalls, budget);
  assert.equal(diagnostics.pairGuardCalls, allowedPairs.length + budget);
  assert.equal(diagnostics.conservativeFallbacks, 1);
  assert.ok(diagnostics.dependencyMerges > 0);
  assert.ok(limits.get(hub) > 0.149 && limits.get(hub) < 0.151);
  for (const item of [observer, ...neighbors])
    assert.equal(limits.get(item), limits.get(hub));
  assert.equal(limits.get(clear), 1);
  assert.ok(limits.get(prop) < 1);
  for (const item of [hubWall, ...walls, blocker])
    assert.equal(limits.get(item), 1);

  // Check the accepted geometry independently, including the prop's initial
  // overlap allowance and every masked star edge after conservative fallback.
  const depth = (hullsA, hullsB) =>
    Math.max(
      ...hullsA.flatMap((a) => hullsB.map((b) => hullPenetration(a, b))),
    );
  let initial;
  for (let step = 0; step <= 16; step++) {
    const hulls = new Map(
      bodies.map((item) => {
        const pose = paths.get(item)((step / 16) * limits.get(item));
        return [
          item,
          item.hulls.map((hull) =>
            transformHull(hull, pose.position, pose.orientation),
          ),
        ];
      }),
    );
    if (!step)
      initial = allowedPairs.map(([a, b]) => depth(hulls.get(a), hulls.get(b)));
    allowedPairs.forEach(([a, b], index) =>
      assert.ok(
        depth(hulls.get(a), hulls.get(b)) <= initial[index] + 1.01e-6,
        `pair ${index} deepens at accepted sample ${step}`,
      ),
    );
  }
});
