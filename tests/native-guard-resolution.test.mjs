import test from "node:test";
import assert from "node:assert/strict";
import { Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { createHierarchyMotionPhase } from "../src/physics/hierarchy-motion.ts";
import { BodyTrajectoryGuard } from "../src/physics/pair-guard.ts";
import { hullPenetration, transformHull } from "../src/physics/geometry.ts";
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function body(p = v(), half = v(0.06, 0.05, 0.12), fixed = false) {
  return {
    hulls: [buildBoxHull(half.clone().negate(), half)],
    state: {
      position: p,
      orientation: new Quaternion(),
      velocity: v(),
      angularVelocity: v(),
    },
    properties: {
      mass: 1,
      inertia: v(1, 1, 0.04),
      centerOfMass: v(),
      worldFriction: 0.4,
      immovable: fixed,
    },
  };
}
function run(bodies, paths) {
  const d = {};
  const f = new BodyTrajectoryGuard().run(bodies, paths, undefined, d);
  return { d, f };
}
test("native thin-part resolution follows its turn, not its inertia enclosure", () => {
  const a = body(),
    b = body(v(0.2, 0, 0.2), v(0.1, 0.1, 0.1), true);
  a.state.angularVelocity.set(0.2, 4.7, 0.1);
  const phase = createHierarchyMotionPhase([a, b], [], 0.04);
  const path = phase.paths.get(a);
  assert.ok(path.angularTravel > 4);
  assert.ok(path.worldAngularSampling < 0.2);
  assert.equal(
    path.firstOrderMotion,
    undefined,
    "native high-angle fallback is exercised",
  );
  const native = run([a, b], phase.paths);
  assert.equal(native.f.get(a), 1);
  assert.ok(
    native.d.sampledIntervals > 0 && native.d.sampledIntervals <= 12,
    JSON.stringify(native.d),
  );
  // Same captured function without the native sampling hint takes the existing
  // conservative custom-path route. Global clearance bounds are unchanged.
  const custom = Object.assign((t) => path(t), { ...path });
  delete custom.worldAngularSampling;
  const previous = run(
    [a, b],
    new Map([
      [a, custom],
      [b, phase.paths.get(b)],
    ]),
  );
  assert.equal(previous.f.get(a), 1);
  assert.equal(previous.d.sampledIntervals, 128);
});
test("native hidden full turns retain fine sampling and stop an intermediate impact", () => {
  const rod = body(v(), v(0.5, 0.015, 0.015)),
    target = body(v(0, 0.35), v(0.045, 0.045, 0.045), true);
  rod.properties.inertia.set(1, 1, 1);
  rod.state.angularVelocity.set(0, 0, (Math.PI * 2) / 0.04);
  const phase = createHierarchyMotionPhase([rod, target], [], 0.04);
  const result = run([rod, target], phase.paths);
  assert.ok(phase.paths.get(rod).worldAngularSampling >= Math.PI * 2 - 1e-12);
  assert.ok(result.d.sampledIntervals > 8);
  assert.ok(result.f.get(rod) < 0.3, JSON.stringify(result.d));
  const pose = phase.pose(rod, result.f.get(rod));
  const end = phase.pose(target, result.f.get(target));
  assert.ok(
    hullPenetration(
      transformHull(rod.hulls[0], pose.position, pose.orientation),
      transformHull(target.hulls[0], end.position, end.orientation),
    ) < 2e-6,
  );
});

test("invalid native resolution hints retain the conservative custom-path fallback", () => {
  const a = body(),
    b = body(v(0.2, 0, 0.2), v(0.1, 0.1, 0.1), true);
  a.state.angularVelocity.set(0.2, 4.7, 0.1);
  const phase = createHierarchyMotionPhase([a, b], [], 0.04),
    source = phase.paths.get(a);
  for (const hint of [NaN, -1, Infinity]) {
    const path = Object.assign((t) => source(t), {
      ...source,
      worldAngularSampling: hint,
    });
    const result = run(
      [a, b],
      new Map([
        [a, path],
        [b, phase.paths.get(b)],
      ]),
    );
    assert.equal(result.f.get(a), 1);
    assert.equal(result.d.sampledIntervals, 128);
  }
});
test("anisotropic changing-axis motion still stops a real intermediate corner impact", () => {
  const rod = body(v(), v(0.5, 0.01, 0.02));
  rod.properties.inertia.set(1, 1.5, 0.06);
  rod.state.angularVelocity.set(4, 6, 2);
  const seed = createHierarchyMotionPhase([rod], [], 0.04),
    mid = seed.pose(rod, 0.5);
  const target = body(
    v(0.45).applyQuaternion(mid.orientation).add(mid.position),
    v(0.008, 0.008, 0.008),
    true,
  );
  const phase = createHierarchyMotionPhase([rod, target], [], 0.04);
  const targetHull = transformHull(
    target.hulls[0],
    target.state.position,
    target.state.orientation,
  );
  assert.equal(
    hullPenetration(
      transformHull(rod.hulls[0], rod.state.position, rod.state.orientation),
      targetHull,
    ),
    0,
  );
  assert.ok(
    hullPenetration(
      transformHull(rod.hulls[0], mid.position, mid.orientation),
      targetHull,
    ) > 1e-6,
  );
  const result = run([rod, target], phase.paths);
  assert.ok(
    result.f.get(rod) < 0.5,
    JSON.stringify({ fraction: result.f.get(rod), ...result.d }),
  );
});
test("multiple turns hidden between quarter poses retain the native rate hint", () => {
  const rod = body(v(), v(0.5, 0.015, 0.015)),
    target = body(v(0, 0.35), v(0.045, 0.045, 0.045), true);
  rod.properties.inertia.set(1, 1, 1);
  rod.state.angularVelocity.set(0, 0, (Math.PI * 8) / 0.04);
  const phase = createHierarchyMotionPhase([rod, target], [], 0.04),
    result = run([rod, target], phase.paths);
  assert.ok(phase.paths.get(rod).worldAngularSampling >= Math.PI * 8 - 1e-12);
  assert.ok(result.f.get(rod) < 0.1, JSON.stringify(result.d));
});
