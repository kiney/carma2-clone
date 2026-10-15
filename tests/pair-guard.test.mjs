import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  hullPenetration,
  hullsBounds,
  recoverHullOverlap,
  transformHull,
} from "../src/physics/geometry.ts";
import {
  attachmentRoot,
  guardPairTrajectory,
  guardBodyTrajectories,
} from "../src/physics/pair-guard.ts";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";

const v = (...args) => new Vector3(...args);
function box(x, half = 0.2) {
  return {
    hulls: [buildBoxHull(v(-half, -half, -half), v(half, half, half))],
    state: {
      position: v(x, 0, 0),
      orientation: new Quaternion(),
      velocity: v(),
      angularVelocity: v(),
    },
    properties: { mass: 1, inertia: v(1, 1, 1), centerOfMass: v() },
  };
}
const path =
  (body, delta = v(), rotation = 0) =>
  (t) => ({
    position: body.state.position.clone().addScaledVector(delta, t),
    orientation: body.state.orientation
      .clone()
      .multiply(new Quaternion().setFromAxisAngle(v(0, 1, 0), rotation * t)),
  });
function pathDepth(a, b, pa, pb, t) {
  return Math.max(
    ...a.hulls.flatMap((ah) =>
      b.hulls.map((bh) =>
        hullPenetration(
          transformHull(ah, pa(t).position, pa(t).orientation),
          transformHull(bh, pb(t).position, pb(t).orientation),
        ),
      ),
    ),
  );
}

test("final pair guard clips a real crossing, including clear endpoints, without changing momentum", () => {
  const a = box(-2, 0.1),
    b = box(0, 0.1),
    pa = path(a, v(4, 0, 0)),
    pb = path(b);
  a.state.velocity.x = 100;
  const fraction = guardPairTrajectory(a, b, pa, pb);
  assert.ok(Math.abs(fraction - 0.45) < 1e-5);
  assert.ok(pathDepth(a, b, pa, pb, fraction) <= 1.01e-6);
  assert.equal(a.state.velocity.x, 100);
  assert.equal(a.state.position.x, -2);
});

test("touching cars can separate or slide without being frozen by source tolerance contacts", () => {
  const a = box(-0.2),
    b = box(0.2);
  assert.equal(
    guardPairTrajectory(a, b, path(a, v(-1, 0, 0)), path(b, v(1, 0, 0))),
    1,
  );
  assert.equal(
    guardPairTrajectory(a, b, path(a, v(0, 0, -2)), path(b, v(0, 0, -2))),
    1,
  );
});

test("native-qualified old overlap does not require a prior recovery flag", () => {
  const a = box(-0.1),
    b = box(0.1),
    still = path(b);
  assert.equal(guardPairTrajectory(a, b, path(a, v(-1, 0, 0)), still), 1);
  assert.equal(guardPairTrajectory(a, b, path(a, v(0.2, 0, 0)), still), 1);
  const oscillation = (t) => ({
    position: v(-0.1 - Math.sin(Math.PI * t), 0, 0),
    orientation: new Quaternion(),
  });
  assert.equal(guardPairTrajectory(a, b, oscillation, still), 1);
});

test("rotation arcs are checked against authored hulls, not endpoint boxes", () => {
  const a = box(0),
    b = box(0.35, 0.025);
  a.hulls = [buildBoxHull(v(-0.04, -0.04, -0.5), v(0.04, 0.04, 0.5))];
  const pa = path(a, v(), Math.PI),
    pb = path(b);
  assert.equal(pathDepth(a, b, pa, pb, 0), 0);
  assert.equal(pathDepth(a, b, pa, pb, 1), 0);
  const fraction = guardPairTrajectory(a, b, pa, pb);
  assert.ok(fraction > 0.3 && fraction < 0.5);
  assert.ok(pathDepth(a, b, pa, pb, fraction) <= 1.01e-6);
});

test("physical joint time is coupled even when parent-child collision masks reject", () => {
  const parent = box(-1, 0.1),
    child = box(-0.5, 0.1),
    wall = box(0.1, 0.1);
  wall.properties.immovable = true;
  const group = {};
  const a = path(parent, v(1.5)),
    b = path(child, v(1.5));
  a.temporalGroup = b.temporalGroup = group;
  const paths = new Map([
    [parent, a],
    [child, b],
    [wall, path(wall)],
  ]);
  const fractions = guardBodyTrajectories(
    [parent, child, wall],
    paths,
    (a, b) => !((a === parent && b === child) || (a === child && b === parent)),
  );
  assert.ok(fractions.get(child) < 1);
  assert.equal(fractions.get(parent), fractions.get(child));
});

test("complete rotations cannot alias clear endpoint quaternions", () => {
  const a = box(0),
    b = box(0, 0.05);
  b.state.position.z = 0.35;
  a.hulls = [buildBoxHull(v(-0.5, -0.05, -0.05), v(0.5, 0.05, 0.05))];
  for (const turn of [2 * Math.PI, 8 * Math.PI]) {
    const pa = path(a, v(), turn),
      pb = path(b);
    pa.angularTravel = turn;
    assert.equal(pathDepth(a, b, pa, pb, 1), 0);
    const fraction = guardPairTrajectory(a, b, pa, pb);
    assert.ok(fraction > 0 && fraction < 0.25);
    assert.ok(pathDepth(a, b, pa, pb, fraction) <= 1.01e-6);
  }
});

test("joint ancestry is recursive and common time preserves pair safety after different world clamps", () => {
  const a = box(-0.4, 0.1),
    b = box(0, 0.1),
    c = box(0.4, 0.1);
  const child = box(-0.4, 0.02),
    grandchild = box(-0.4, 0.01);
  child.joint = { parent: a };
  grandchild.joint = { parent: child };
  assert.equal(attachmentRoot(grandchild), a);
  const paths = new Map([
    [a, path(a)],
    [b, path(b, v(-0.5, 0, 0))],
    [c, path(c, v(-0.5, 0, 0))],
    [child, path(child)],
    [grandchild, path(grandchild)],
  ]);
  const fractions = guardBodyTrajectories([...paths.keys()], paths);
  assert.ok(fractions.get(a) < 1);
  assert.equal(fractions.get(a), fractions.get(b));
  assert.equal(fractions.get(a), fractions.get(c));
  assert.equal(fractions.get(a), fractions.get(grandchild));
  for (const [x, y] of [
    [a, b],
    [b, c],
    [a, c],
  ])
    assert.ok(
      pathDepth(x, y, paths.get(x), paths.get(y), fractions.get(x)) <= 1.01e-6,
    );
});

test("wire shapes retain zero solid thickness and do not crash the depth-only verifier", () => {
  const a = box(0),
    b = box(0);
  a.hulls[0].faces = [];
  assert.equal(hullPenetration(a.hulls[0], b.hulls[0]), 0);
  assert.equal(guardPairTrajectory(a, b, path(a, v(0, 0, 1)), path(b)), 1);
});

async function stock(t, name, pos) {
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
  damage.damageContext.random = () => 0.5;
  damage.wam.snappability = 0;
  return createSimulatedCar(
    original.group,
    original.text,
    damage,
    v(...pos),
    0,
    true,
  );
}
const depth = (a, b) => pathDepth(a, b, path(a), path(b), 0);

test("original rotated Eagle recovery uses local authored bounds centers (HW0x427b56)", async (t) => {
  const a = await stock(
    t,
    "EAGLE3",
    [-0.20549837942235172, -0.05757920285686852, 0.1256357551552355],
  );
  if (!a) return;
  const b = await stock(t, "EAGLE3", [0, 0, 0]);
  a.state.orientation.fromArray([
    0.19872489368258905, 0.1648147961084184, -0.02020740882450784,
    0.9658862046034116,
  ]);
  b.state.orientation.fromArray([
    0.5687641412306911, 0.6643310710931175, 0.4841680284009579,
    0.027439021569934073,
  ]);
  const center = (c) =>
    hullsBounds(c.hulls)
      .getCenter(v())
      .applyQuaternion(c.state.orientation)
      .add(c.state.position);
  const ca = center(a),
    cb = center(b);
  a.state.velocity.copy(cb).sub(ca).normalize();
  b.state.velocity.copy(a.state.velocity).negate();
  a.overlapRecovery = true;
  b.overlapRecovery = true;
  for (const body of [a, b]) {
    body.state.predictedPosition = body.state.position.clone();
    body.state.predictedOrientation = body.state.orientation.clone();
  }
  const oldA = a.hulls.map((h) =>
    transformHull(h, a.state.position, a.state.orientation),
  );
  const oldB = b.hulls.map((h) =>
    transformHull(h, b.state.position, b.state.orientation),
  );
  const expected = recoverHullOverlap(oldA[0], oldB[0], {
    a,
    b,
    boundsCenterA: ca,
    boundsCenterB: cb,
  });
  const wrong = recoverHullOverlap(oldA[0], oldB[0], {
    a,
    b,
    boundsCenterA: hullsBounds(oldA).getCenter(v()),
    boundsCenterB: hullsBounds(oldB).getCenter(v()),
  });
  assert.equal(expected.contact.points.length, 2);
  assert.equal(wrong.contact, null);
  const sim = new VehicleSimulation(
    { raycast: () => null, querySurfaces: () => [] },
    new Group(),
  );
  sim.add(a);
  sim.add(b);
  const rows = sim.collectBodyContacts([a, b]);
  assert.equal(
    rows.filter(
      (row) =>
        row.sourceType === 6 &&
        row.normal.distanceTo(expected.contact.normal) < 1e-6,
    ).length,
    2,
  );
});

test("original high-angular oblique crash cannot commit the formerly observed .0565 penetration", async (t) => {
  const a = await stock(
    t,
    "EAGLE3",
    [-0.15201018096413463, 0.06250807279720902, 0.6949011456104927],
  );
  if (!a) return;
  const b = await stock(
    t,
    "EAGLE3",
    [-0.2259578083641827, -0.04449137435294688, -0.4509421775816008],
  );
  a.state.orientation.fromArray([
    0, 0.46261580970597643, 0, 0.8865588602061816,
  ]);
  b.state.orientation.fromArray([
    0, 0.9928292641774369, 0, -0.11954100632372644,
  ]);
  a.state.velocity.set(
    2.785726023837924,
    0.2491863016039133,
    -1.116052575339566,
  );
  b.state.velocity.set(
    -1.7597096636891365,
    0.580295811407268,
    17.238151719653978,
  );
  a.state.angularVelocity.set(
    5.884663411416113,
    -5.9137531369924545,
    -5.218992908485234,
  );
  b.state.angularVelocity.set(
    0.5503630731254816,
    -2.184346350841224,
    5.611725468188524,
  );
  const sim = new VehicleSimulation(
    { raycast: () => null, querySurfaces: () => [] },
    new Group(),
  );
  sim.add(a);
  sim.add(b);
  assert.equal(depth(a, b), 0);
  sim.step();
  assert.ok(sim.lastImpacts.some((i) => i.b === b || i.b === a));
  assert.ok(depth(a, b) <= 1.01e-6, `committed depth ${depth(a, b)}`);
  const after = a.state.position.distanceTo(b.state.position);
  for (let i = 0; i < 20; i++) {
    sim.step();
    assert.ok(depth(a, b) <= 1.01e-6);
  }
  assert.ok(
    a.state.position.distanceTo(b.state.position) > after + 1,
    "the guard must not create a persistent trap",
  );
});
