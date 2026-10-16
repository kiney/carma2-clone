import test from "node:test";
import assert from "node:assert/strict";
import { Euler, Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { createHierarchyMotionPhase } from "../src/physics/hierarchy-motion.ts";
import { BodyTrajectoryGuard } from "../src/physics/pair-guard.ts";
import { createBallJoint } from "../src/physics/joint.ts";
import { hullPenetration, transformHull } from "../src/physics/geometry.ts";
import { firstOrderGuardSlop } from "../src/physics/first-order-guard.ts";

const STEP = 0.04;
const v = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);
function body(position = v(), half = v(0.1, 0.1, 0.1), immovable = false) {
  return {
    hulls: [buildBoxHull(half.clone().negate(), half)],
    properties: {
      mass: 1,
      inertia: v(1, 1, 1),
      centerOfMass: v(),
      immovable,
    },
    state: {
      position,
      orientation: new Quaternion(),
      velocity: v(),
      angularVelocity: v(),
    },
  };
}
function run(bodies, joints = [], guard = new BodyTrajectoryGuard()) {
  const phase = createHierarchyMotionPhase(bodies, joints, STEP);
  const diagnostics = {};
  const limits = guard.run(bodies, phase.paths, undefined, diagnostics);
  return { phase, limits, diagnostics };
}
function depth(a, b, phase, ta, tb = ta) {
  const pa = phase.paths.get(a)(ta),
    pb = phase.paths.get(b)(tb);
  return Math.max(
    ...a.hulls.flatMap((ha) =>
      b.hulls.map((hb) =>
        hullPenetration(
          transformHull(ha, pa.position, pa.orientation),
          transformHull(hb, pb.position, pb.orientation),
        ),
      ),
    ),
  );
}
const guardSlop = (a, b) => firstOrderGuardSlop(a.hulls[0], b.hulls[0]);

test("producer certifies only captured free first-order paths and preserves source state", () => {
  const a = body(),
    high = body(v(3)),
    child = body(v(5));
  a.state.angularVelocity.set(0.04 / STEP, 0, 0);
  a.properties.inertia.set(100, 1, 1);
  high.state.angularVelocity.set(0, 0.1 / STEP, 0);
  const joint = createBallJoint(child, a, v(), v(5));
  child.joint = joint;
  const before = JSON.stringify(
    [a, high, child].map((item) => [item.state, item.properties, item.hulls]),
  );
  const phase = createHierarchyMotionPhase([a, high, child], [joint], STEP);
  const captured = phase.paths.get(a).firstOrderMotion;
  assert.ok(captured);
  assert.ok(Math.abs(captured.angularSpeed * captured.duration - 0.04) < 1e-15);
  assert.ok(
    phase.paths.get(a).angularTravel > 1,
    "general momentum bound is deliberately larger",
  );
  assert.equal(phase.paths.get(high).firstOrderMotion, undefined);
  assert.equal(phase.paths.get(child).firstOrderMotion, undefined);
  assert.equal(
    JSON.stringify(
      [a, high, child].map((item) => [item.state, item.properties, item.hulls]),
    ),
    before,
  );
});

test("fast thin crossing with tiny rotation uses geometric overlap windows with clear endpoints", () => {
  const a = body(v(-3), v(1e-5, 0.1, 0.1)),
    b = body(v(), v(1e-5, 0.2, 0.2), true);
  a.state.velocity.x = 4 / STEP;
  a.state.angularVelocity.x = 0.0005 / STEP;
  const before = JSON.stringify([a.state, b.state]);
  const { phase, limits, diagnostics } = run([a, b]);
  const fraction = limits.get(a);
  assert.equal(depth(a, b, phase, 0), 0);
  assert.equal(depth(a, b, phase, 1), 0);
  assert.ok(Math.abs(fraction - (3 - 2e-5 + 1e-6) / 4) < 1e-10, `${fraction}`);
  assert.ok(depth(a, b, phase, fraction) <= 1.01e-6);
  assert.ok(diagnostics.firstOrderTranslationQueries > 0);
  assert.equal(diagnostics.firstOrderFallbacks, 0);
  assert.equal(diagnostics.sampledIntervals, 0);
  assert.ok(diagnostics.firstOrderIntervals <= 4, JSON.stringify(diagnostics));
  assert.equal(JSON.stringify([a.state, b.state]), before);
});

test("a rotating target's offset geometry is checked against fast relative translation", () => {
  const a = body(v(), v(0.001, 0.001, 0.001)),
    b = body();
  a.state.velocity.x = 10 / STEP;
  b.hulls = [buildBoxHull(v(4.9, -0.0501, -0.1), v(5.1, -0.0499, 0.1))];
  b.state.angularVelocity.z = 0.02 / STEP;
  const { phase, limits, diagnostics } = run([a, b]);
  assert.equal(depth(a, b, phase, 0), 0);
  assert.equal(depth(a, b, phase, 1), 0);
  assert.ok(depth(a, b, phase, 0.5) > 1e-6);
  assert.ok(limits.get(a) > 0.45 && limits.get(a) < 0.51, `${limits.get(a)}`);
  assert.equal(limits.get(a), limits.get(b));
  assert.ok(depth(a, b, phase, limits.get(a)) <= guardSlop(a, b) + 1e-8);
  assert.ok(diagnostics.firstOrderIntervals > 0);
  assert.equal(diagnostics.firstOrderFallbacks, 0);
});

test("rotation-axis tangency and separating contacts keep full motion without translation samples", () => {
  for (const separating of [false, true]) {
    const a = body(v(-0.2), v(0.2, 0.2, 0.2)),
      b = body(v(0.2), v(0.2, 0.2, 0.2), true);
    a.state.velocity.set(separating ? -5 / STEP : 0, 0, 3 / STEP);
    a.state.angularVelocity.x = 0.02 / STEP;
    const { limits, diagnostics } = run([a, b]);
    assert.equal(limits.get(a), 1);
    assert.equal(diagnostics.firstOrderFallbacks, 0);
    assert.equal(diagnostics.sampledIntervals, 0);
    assert.ok(diagnostics.firstOrderIntervals <= 4);
  }
});

test("pure rotation entering positive depth at a native quantum event is bracketed", () => {
  const a = body(v(), v(1, 0.01, 0.01)),
    b = body(v(0.9, 0.04), v(0.03, 0.005, 0.03), true);
  a.state.angularVelocity.z = 0.08 / STEP;
  const { phase, limits, diagnostics } = run([a, b]);
  assert.equal(depth(a, b, phase, 0), 0);
  assert.ok(limits.get(a) > 0 && limits.get(a) < 1);
  assert.ok(depth(a, b, phase, limits.get(a)) <= guardSlop(a, b) + 1e-8);
  assert.ok(diagnostics.firstOrderIntervals > 0);
  assert.equal(diagnostics.firstOrderFallbacks, 0, JSON.stringify(diagnostics));
  assert.equal(diagnostics.sampledIntervals, 0);
});

test("repair and fresh source shape replacement cannot reuse a previous safe prefix", () => {
  const a = body(v(-1), v(0.1, 0.1, 0.1)),
    b = body(v(), v(0.1, 0.1, 0.1), true);
  const guard = new BodyTrajectoryGuard();
  a.state.velocity.x = 2 / STEP;
  a.state.angularVelocity.x = 0.001 / STEP;
  const small = run([a, b], [], guard);
  a.hulls = [buildBoxHull(v(-0.4, -0.1, -0.1), v(0.4, 0.1, 0.1))];
  const large = run([a, b], [], guard);
  assert.ok(large.limits.get(a) < small.limits.get(a) - 0.1);
  a.hulls = [buildBoxHull(v(-0.1, -0.1, -0.1), v(0.1, 0.1, 0.1))];
  const repaired = run([a, b], [], guard);
  assert.ok(Math.abs(repaired.limits.get(a) - small.limits.get(a)) < 1e-10);
});

test("unequal-prefix coupling revalidates certified paths at the actual scaled native time", () => {
  const a = body(v(-0.6), v(0.2, 0.2, 0.2)),
    b = body(v(), v(0.2, 0.2, 0.2)),
    wall = body(v(0.45), v(0.2, 0.2, 0.2), true);
  a.state.velocity.x = b.state.velocity.x = 1 / STEP;
  a.state.angularVelocity.x = b.state.angularVelocity.x = 0.001 / STEP;
  const { phase, limits, diagnostics } = run([a, b, wall]);
  assert.ok(limits.get(a) > 0 && limits.get(a) < 1);
  assert.ok(limits.get(b) > 0 && limits.get(b) <= 1);
  assert.ok(
    depth(a, b, phase, limits.get(a), limits.get(b)) <= guardSlop(a, b) + 1e-8,
  );
  assert.ok(
    depth(a, wall, phase, limits.get(a), 1) <= guardSlop(a, wall) + 1e-8,
  );
  assert.ok(diagnostics.firstOrderIntervals > 0);
  assert.ok(diagnostics.revalidationCalls > 0, JSON.stringify(diagnostics));
});

test("the native small-rotation gate cannot conceal a simultaneous thin crossing", () => {
  const gate = Math.sqrt(1e-7) / 0.001;
  const a = body(v(-4 * gate), v(1e-5, 0.1, 0.1)),
    b = body(v(), v(1e-5, 0.2, 0.2), true);
  a.state.velocity.x = 4 / STEP;
  a.state.angularVelocity.x = 0.001 / STEP;
  const { phase, limits, diagnostics } = run([a, b]);
  assert.ok(depth(a, b, phase, gate) > 1e-6);
  assert.ok(Math.abs(limits.get(a) - (gate - (2e-5 - 1e-6) / 4)) < 1e-10);
  assert.equal(diagnostics.firstOrderFallbacks, 0);
  assert.equal(diagnostics.sampledIntervals, 0);
});

test("mixed world axes, COM offsets and anisotropic moments retain actual collision witnesses", () => {
  let seed = 981723;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const signed = () => random() * 2 - 1;
  for (let i = 0; i < 24; i++) {
    const a = body(v(-1), v(0.03, 0.06, 0.07)),
      b = body(v(), v(0.03, 0.06, 0.07));
    a.state.velocity.x = 2 / STEP;
    for (const item of [a, b]) {
      item.state.orientation.setFromAxisAngle(
        v(signed(), signed(), signed()).normalize(),
        signed(),
      );
      item.state.angularVelocity.copy(
        v(signed(), signed(), signed())
          .normalize()
          .multiplyScalar((0.01 + random() * 0.06) / STEP),
      );
      item.properties.centerOfMass.set(
        signed() * 0.1,
        signed() * 0.1,
        signed() * 0.1,
      );
      item.properties.inertia.set(
        0.1 + random() * 10,
        0.1 + random() * 10,
        0.1 + random() * 10,
      );
    }
    const { phase, limits, diagnostics } = run([a, b]);
    assert.ok(depth(a, b, phase, 0.5) > 1e-6, `fixture ${i}`);
    assert.ok(limits.get(a) < 0.5, `missed fixture ${i}`);
    assert.equal(limits.get(a), limits.get(b));
    assert.ok(
      depth(a, b, phase, limits.get(a)) <= guardSlop(a, b) + 1e-8,
      `unsafe fixture ${i}`,
    );
    assert.equal(
      diagnostics.firstOrderFallbacks,
      0,
      `unexpected fallback ${i}`,
    );
  }
});

test("near-rest quantum motion below the browser margin clears before event enumeration", () => {
  const a = body(v(), v(1, 0.1, 0.1)),
    b = body(v(0, 0.2004), v(1, 0.1, 0.1), true);
  a.state.angularVelocity.z = 0.001 / STEP;
  const { phase, limits, diagnostics } = run([a, b]);
  const penetration = depth(a, b, phase, 1);
  assert.ok(penetration > 1e-6 && penetration < guardSlop(a, b));
  assert.equal(limits.get(a), 1);
  assert.ok(diagnostics.firstOrderIntervals <= 3, JSON.stringify(diagnostics));
  assert.equal(diagnostics.firstOrderTranslationQueries, 0);
  assert.equal(diagnostics.firstOrderFallbacks, 0);
  assert.equal(diagnostics.sampledIntervals, 0);
});

test("rotation entering beyond the geometric browser margin is still blocked", () => {
  const a = body(v(), v(1, 0.1, 0.1)),
    b = body(v(0, 0.2004), v(1, 0.1, 0.1), true);
  a.state.angularVelocity.z = 0.004 / STEP;
  const { phase, limits, diagnostics } = run([a, b]);
  assert.ok(depth(a, b, phase, 1) > guardSlop(a, b));
  assert.ok(limits.get(a) > 0 && limits.get(a) < 1);
  assert.ok(depth(a, b, phase, limits.get(a)) <= guardSlop(a, b) + 1e-8);
  assert.ok(diagnostics.firstOrderIntervals < 40, JSON.stringify(diagnostics));
  assert.ok(
    diagnostics.firstOrderTranslationQueries < 20,
    JSON.stringify(diagnostics),
  );
  assert.equal(diagnostics.firstOrderFallbacks, 0);
});

test("geometric margin preserves diagonally thin faces and observes mutable shape edits", () => {
  const thin = buildBoxHull(v(-1, -1e-5, -0.1), v(1, 1e-5, 0.1));
  const rotated = transformHull(
    thin,
    v(),
    new Quaternion().setFromAxisAngle(v(0, 0, 1), Math.PI / 4),
  );
  const thick = buildBoxHull(v(-1, -1, -1), v(1, 1, 1));
  assert.ok(firstOrderGuardSlop(rotated, thick) <= 1.000001e-6);
  assert.equal(firstOrderGuardSlop(thick, thick), 0.001);
  for (const point of thick.vertices) point.y *= 0.00001;
  assert.ok(Math.abs(firstOrderGuardSlop(thick, thick) - 1e-6) < 1e-18);
});

test("skew near-clear rods use edge-cross witnesses before enumerating native angle quanta", () => {
  const a = body(v(), v(1, 0.15, 0.1)),
    b = body(
      v(0.7564654950983822, 0.20036458037793636, 0.32528953021392226),
      v(1, 0.15, 0.1),
    );
  a.state.orientation.setFromEuler(
    new Euler(1.2213671787176281, 1.9113588784821332, 2.345409391215071),
  );
  b.state.orientation.setFromEuler(
    new Euler(0.27511618472635746, 0.4755855586845428, 2.760273307096213),
  );
  // Both free bodies share a world COM and angular motion: their separating
  // edge direction rotates, while their exact relative geometry stays clear.
  b.properties.centerOfMass
    .copy(b.state.position)
    .negate()
    .applyQuaternion(b.state.orientation.clone().invert());
  a.state.angularVelocity.set(0, 0.06 / STEP, 0);
  b.state.angularVelocity.copy(a.state.angularVelocity);
  const { phase, limits, diagnostics } = run([a, b]);
  const a0 = transformHull(
      a.hulls[0],
      phase.pose(a, 0).position,
      phase.pose(a, 0).orientation,
    ),
    b0 = transformHull(
      b.hulls[0],
      phase.pose(b, 0).position,
      phase.pose(b, 0).orientation,
    );
  for (const { normal } of [...a0.faces, ...b0.faces]) {
    const pa = a0.vertices.map((point) => point.dot(normal)),
      pb = b0.vertices.map((point) => point.dot(normal));
    assert.ok(Math.max(...pa) > Math.min(...pb));
    assert.ok(Math.max(...pb) > Math.min(...pa));
  }
  for (const fraction of [0, 0.125, 0.5, 0.875, 1])
    assert.equal(depth(a, b, phase, fraction), 0);
  assert.equal(limits.get(a), 1);
  assert.equal(limits.get(b), 1);
  assert.ok(diagnostics.firstOrderIntervals <= 8, JSON.stringify(diagnostics));
  assert.equal(diagnostics.firstOrderTranslationQueries, 0);
  assert.equal(diagnostics.firstOrderFallbacks, 0);
  assert.equal(diagnostics.sampledIntervals, 0);
});

test("simultaneous native angle jumps cannot block synchronously rotating tangent parts", () => {
  const a = body(),
    b = body();
  a.hulls = [buildBoxHull(v(-0.5, -5e-6, -0.02), v(0.5, 5e-6, 0.02))];
  b.hulls = [buildBoxHull(v(-0.5, 5e-6, -0.02), v(0.5, 15e-6, 0.02))];
  a.state.angularVelocity.z = b.state.angularVelocity.z = 2;
  const { phase, limits, diagnostics } = run([a, b]);
  for (const fraction of [0, Math.sqrt(1e-7) / 0.08, 0.125, 0.5, 1])
    assert.ok(depth(a, b, phase, fraction) < 1e-12);
  assert.equal(limits.get(a), 1);
  assert.equal(limits.get(b), 1);
  assert.equal(diagnostics.firstOrderFallbacks, 1);
  assert.ok(diagnostics.firstOrderIntervals < 16, JSON.stringify(diagnostics));
  assert.ok(diagnostics.sampledIntervals > 0);
});

test("simultaneous native angle jumps retain actual relative-translation collisions", () => {
  const a = body(v(-0.5), v(0.1, 0.1, 0.1)),
    b = body(v(0.5), v(0.1, 0.1, 0.1));
  a.state.angularVelocity.z = b.state.angularVelocity.z = 2;
  a.state.velocity.x = 0.5 / STEP;
  b.state.velocity.x = -0.5 / STEP;
  const { phase, limits } = run([a, b]);
  assert.ok(depth(a, b, phase, 1) > 0.1);
  assert.ok(limits.get(a) > 0.7 && limits.get(a) < 0.81);
  assert.equal(limits.get(a), limits.get(b));
  assert.ok(depth(a, b, phase, limits.get(a)) <= guardSlop(a, b) + 1e-8);
});
