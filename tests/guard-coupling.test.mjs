import test from "node:test";
import assert from "node:assert/strict";
import { Group, Quaternion, Vector3 } from "three";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  hullPenetration,
  hullsBounds,
  transformHull,
} from "../src/physics/geometry.ts";
import {
  BodyTrajectoryGuard,
  guardBodyTrajectories,
  guardPairTrajectory,
} from "../src/physics/pair-guard.ts";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";

const v = (...values) => new Vector3(...values);
function body(position, half = 0.2, immovable = false) {
  return {
    hulls: [buildBoxHull(v(-half, -half, -half), v(half, half, half))],
    state: {
      position: v(...position),
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
function path(item, delta = v()) {
  const trajectory = (fraction) => ({
    position: item.state.position.clone().addScaledVector(delta, fraction),
    orientation: item.state.orientation.clone(),
  });
  if (item.properties.immovable) trajectory.constantPose = trajectory(0);
  return trajectory;
}
function at(item, trajectory, fraction) {
  const pose = trajectory(fraction);
  return item.hulls.map((hull) =>
    transformHull(hull, pose.position, pose.orientation),
  );
}
function depth(a, b, pathA, pathB, fraction) {
  return Math.max(
    ...at(a, pathA, fraction).flatMap((ha) =>
      at(b, pathB, fraction).map((hb) => hullPenetration(ha, hb)),
    ),
  );
}
function clippedDepth(a, b, pathA, pathB, fractionA, fractionB) {
  return Math.max(
    ...at(a, pathA, fractionA).flatMap((ha) =>
      at(b, pathB, fractionB).map((hb) => hullPenetration(ha, hb)),
    ),
  );
}

test("a blocked prop does not freeze a clear, separated car", () => {
  const car = body([0, 10.5, 0]);
  const prop = body([0, 10, 0]);
  const blocker = body([0.3, 10, 0], 0.2, true);
  const carPath = path(car, v(-0.1, 0, 0));
  const propPath = path(prop, v(0.1, 0, 0));
  const blockerPath = path(blocker);
  assert.equal(guardPairTrajectory(car, prop, carPath, propPath), 1);
  assert.equal(guardPairTrajectory(car, blocker, carPath, blockerPath), 1);
  assert.ok(guardPairTrajectory(prop, blocker, propPath, blockerPath) < 1);

  const paths = new Map([
    [car, carPath],
    [prop, propPath],
    [blocker, blockerPath],
  ]);
  const limits = guardBodyTrajectories([...paths.keys()], paths);
  assert.equal(limits.get(car), 1);
  assert.ok(limits.get(prop) < 1);
  assert.equal(limits.get(blocker), 1);
});

test("coupled limits are input-order independent and respect rejected pairs", () => {
  const run = (order, pairAllowed) => {
    const car = body([0, 10.5, 0]);
    const prop = body([0, 10, 0]);
    const blocker = body([0.3, 10, 0], 0.2, true);
    const paths = new Map([
      [car, path(car, v(-0.1, 0, 0))],
      [prop, path(prop, v(0.1, 0, 0))],
      [blocker, path(blocker)],
    ]);
    const limits = guardBodyTrajectories(
      order.map((index) => [...paths.keys()][index]),
      paths,
      pairAllowed,
    );
    return [...paths.keys()].map((item) => limits.get(item));
  };
  assert.deepEqual(run([0, 1, 2]), run([2, 0, 1]));
  const rejected = run(
    [0, 1, 2],
    (a, b) => !(a.state.position.y === 10 && b.properties.immovable),
  );
  assert.deepEqual(rejected, [1, 1, 1]);
});

test("slowing a prop is revalidated against a car that would then run into it", () => {
  const car = body([-0.6, 0, 0]);
  const prop = body([0, 0, 0]);
  const blocker = body([0.3, 0, 0], 0.2, true);
  const paths = new Map([
    [car, path(car, v(1, 0, 0))],
    [prop, path(prop, v(1, 0, 0))],
    [blocker, path(blocker)],
  ]);
  assert.equal(
    guardPairTrajectory(car, prop, paths.get(car), paths.get(prop)),
    1,
  );
  const diagnostics = {
    bodies: 0,
    movable: 0,
    immovable: 0,
    exceptionalBounds: 0,
    staticRebuilds: 0,
    nodeTests: 0,
    candidates: 0,
    boundsTests: 0,
    pairs: 0,
    hullTransforms: 0,
    snapshotHits: 0,
    pairGuardCalls: 0,
    maskTests: 0,
    maskRejected: 0,
    attachmentPairs: 0,
    dependencyMerges: 0,
    revalidationCalls: 0,
    conservativeFallbacks: 0,
  };
  const limits = new BodyTrajectoryGuard().run(
    [...paths.keys()],
    paths,
    undefined,
    diagnostics,
  );
  assert.ok(diagnostics.revalidationCalls > 0);
  assert.equal(diagnostics.conservativeFallbacks, 0);
  for (const [a, b] of [
    [car, prop],
    [car, blocker],
    [prop, blocker],
  ]) {
    const startDepth = clippedDepth(a, b, paths.get(a), paths.get(b), 0, 0);
    assert.ok(
      clippedDepth(
        a,
        b,
        paths.get(a),
        paths.get(b),
        limits.get(a),
        limits.get(b),
      ) <=
        startDepth + 1.01e-6,
      `unsafe clipped pair depth ${clippedDepth(a, b, paths.get(a), paths.get(b), limits.get(a), limits.get(b))}`,
    );
  }
});

test("a shared prefix stays safe when slowing one body would create a third-body crossing", () => {
  const a = body([-0.4, 0, 0], 0.1);
  const b = body([0, 0, 0], 0.1);
  const c = body([0.4, 0, 0], 0.1);
  const paths = new Map([
    [a, path(a)],
    [b, path(b, v(-0.5, 0, 0))],
    [c, path(c, v(-0.5, 0, 0))],
  ]);
  const limits = guardBodyTrajectories([...paths.keys()], paths);
  assert.ok(Math.abs(limits.get(a) - 0.4) < 1e-5);
  assert.equal(limits.get(a), limits.get(b));
  assert.equal(limits.get(b), limits.get(c));
  for (const [x, y] of [
    [a, b],
    [b, c],
    [a, c],
  ])
    assert.ok(
      clippedDepth(
        x,
        y,
        paths.get(x),
        paths.get(y),
        limits.get(x),
        limits.get(y),
      ) <= 1.01e-6,
    );
});

test("an attached flap follows its blocked parent limit, while a released part does not drag a clear car", () => {
  const parent = body([0, 0, 0]);
  const flap = body([0, 0.35, 0], 0.05);
  flap.joint = { parent };
  const wall = body([0.3, 0, 0], 0.2, true);
  const parentPath = path(parent, v(0.1, 0, 0));
  const flapPath = path(flap, v(0.1, 0, 0));
  const limits = guardBodyTrajectories(
    [parent, flap, wall],
    new Map([
      [parent, parentPath],
      [flap, flapPath],
      [wall, path(wall)],
    ]),
  );
  assert.ok(limits.get(parent) < 1);
  assert.equal(limits.get(flap), limits.get(parent));

  const car = body([0, 10.5, 0]);
  const releasedPart = body([0, 10, 0]);
  const obstacle = body([0.3, 10, 0], 0.2, true);
  const paths = new Map([
    [car, path(car, v(-0.1, 0, 0))],
    [releasedPart, path(releasedPart, v(0.1, 0, 0))],
    [obstacle, path(obstacle)],
  ]);
  const releasedLimits = guardBodyTrajectories([...paths.keys()], paths);
  assert.equal(releasedLimits.get(car), 1);
  assert.ok(releasedLimits.get(releasedPart) < 1);
});

test("a descending free body is clipped at a generated prop without ground support", () => {
  const freeCar = body([0, 0.7, 0], 0.2);
  const prop = body([0, 0, 0], 0.2, true);
  const carPath = path(freeCar, v(0, -1, 0));
  const propPath = path(prop);
  const limits = guardBodyTrajectories(
    [freeCar, prop],
    new Map([
      [freeCar, carPath],
      [prop, propPath],
    ]),
  );
  const accepted = limits.get(freeCar);
  assert.ok(accepted > 0 && accepted < 1);
  assert.ok(depth(freeCar, prop, carPath, propPath, accepted) <= 1.01e-6);
});

test("8π orbit revalidation preserves a common prefix with a remote secondary hull", () => {
  const axis = v(0, 1, 0);
  const turn = 8 * Math.PI;
  const orbiting = (x, immovable = false) => ({
    hulls: [buildBoxHull(v(-0.07, -0.07, -0.07), v(0.07, 0.07, 0.07))],
    state: {
      position: v(x, 0, 0),
      orientation: new Quaternion(),
      velocity: v(),
      angularVelocity: v(),
    },
    properties: {
      mass: 1,
      inertia: v(0.1, 2, 0.3),
      centerOfMass: v(-x, 0, 0),
      immovable,
    },
  });
  const a = orbiting(-1);
  const b = orbiting(1);
  const blocker = orbiting(0, true);
  assert.deepEqual(a.properties.centerOfMass.toArray(), [1, 0, 0]);
  assert.deepEqual(b.properties.centerOfMass.toArray(), [-1, 0, 0]);
  assert.deepEqual(a.properties.inertia.toArray(), [0.1, 2, 0.3]);
  a.hulls.push(buildBoxHull(v(-0.05, 9.95, -0.05), v(0.05, 10.05, 0.05)));
  blocker.properties.centerOfMass.set(0, 0, 0);
  blocker.state.position.set(-Math.SQRT1_2, 10, Math.SQRT1_2);

  const orbitPath = (item) => {
    const trajectory = (fraction) => {
      const rotation = new Quaternion().setFromAxisAngle(axis, turn * fraction);
      return {
        position: item.state.position.clone().applyQuaternion(rotation),
        orientation: rotation,
      };
    };
    trajectory.stable = true;
    trajectory.angularTravel = turn;
    return trajectory;
  };
  const pathA = orbitPath(a);
  const pathB = orbitPath(b);
  const pathBlocker = () => ({
    position: blocker.state.position,
    orientation: blocker.state.orientation,
  });
  pathBlocker.constantPose = pathBlocker(0);
  pathBlocker.stable = true;
  const paths = new Map([
    [a, pathA],
    [b, pathB],
    [blocker, pathBlocker],
  ]);
  assert.equal(guardPairTrajectory(a, b, pathA, pathB), 1);
  const diagnostics = {
    bodies: 0,
    movable: 0,
    immovable: 0,
    exceptionalBounds: 0,
    staticRebuilds: 0,
    nodeTests: 0,
    candidates: 0,
    boundsTests: 0,
    pairs: 0,
    hullTransforms: 0,
    snapshotHits: 0,
    pairGuardCalls: 0,
    maskTests: 0,
    maskRejected: 0,
    attachmentPairs: 0,
    dependencyMerges: 0,
    revalidationCalls: 0,
    conservativeFallbacks: 0,
  };
  const limits = new BodyTrajectoryGuard().run(
    [a, b, blocker],
    paths,
    undefined,
    diagnostics,
  );
  assert.equal(
    guardPairTrajectory(a, blocker, pathA, pathBlocker),
    0.02534336482452354,
  );
  assert.ok(Math.abs(limits.get(a) - 0.02534336482452354) < 1e-12);
  assert.equal(limits.get(a), limits.get(b));
  assert.equal(limits.get(blocker), 1);
  assert.ok(diagnostics.revalidationCalls > 0);
  assert.ok(diagnostics.dependencyMerges > 0);
  assert.equal(diagnostics.conservativeFallbacks, 0);

  let maxDepth = 0;
  for (let step = 0; step <= 32; step++) {
    const fraction = step / 32;
    const poseA = pathA(fraction * limits.get(a));
    const poseB = pathB(fraction * limits.get(b));
    maxDepth = Math.max(
      maxDepth,
      hullPenetration(
        transformHull(a.hulls[0], poseA.position, poseA.orientation),
        transformHull(b.hulls[0], poseB.position, poseB.orientation),
      ),
    );
  }
  assert.equal(maxDepth, 0);
});

async function stockEagle(t) {
  let original;
  try {
    original = await originalCar("EAGLE3");
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
    v(0, 10.5, 0),
    0,
    true,
  );
}

test("stock Eagle remains free beside a generated prop while that prop is blocked", async (t) => {
  const car = await stockEagle(t);
  if (!car) return;
  const bounds = hullsBounds(car.hulls);
  const prop = body([0, 10, 0], 0.2);
  const blocker = body([0.3, 10, 0], 0.2, true);
  const carPath = path(car, v(-0.1, 0, 0));
  const propPath = path(prop, v(0.1, 0, 0));
  const blockerPath = path(blocker);
  // Place the generated prop below the authored hull with 0.05 world-unit clearance.
  car.state.position.y = 10.25 - bounds.min.y;
  const paths = new Map([
    [car, carPath],
    [prop, propPath],
    [blocker, blockerPath],
  ]);
  const limits = guardBodyTrajectories([...paths.keys()], paths);
  assert.equal(limits.get(car), 1);
  assert.ok(limits.get(prop) < 1);
});

test("an impacted stock Eagle stays free beside a blocked prop before and after repair", async (t) => {
  const car = await stockEagle(t);
  if (!car) return;
  car.damage.damageContext.random = () => 0;
  const originalVertices = car.shapeVertices.map((shape) =>
    shape.map((point) => point.clone()),
  );
  const world = { raycast: () => null, querySurfaces: () => [] };
  const simulation = new VehicleSimulation(world, new Group());
  simulation.add(car);
  t.after(() => simulation.dispose());

  const impact = v(0, 0.1, -0.3);
  const energy = v(0, 0, 5);
  car.damage.applyImpact([impact], energy, false, true, 10000, energy.clone());
  assert.ok(
    car.damage.deformationRevision > 0,
    "impact changes authored damage state",
  );
  assert.ok(
    car.shapeVertices.some((shape, index) =>
      shape.some(
        (point, i) => point.distanceTo(originalVertices[index][i]) > 1e-7,
      ),
    ),
    "impact deforms an authored collision vertex",
  );
  simulation.syncStructuralState(car);
  assert.equal(car.revision, car.damage.deformationRevision);

  const verifyClearance = () => {
    const bounds = hullsBounds(car.hulls);
    car.state.position.set(0, 10.25 - bounds.min.y, 0);
    const prop = body([0, 10, 0]);
    const blocker = body([0.3, 10, 0], 0.2, true);
    const paths = new Map([
      [car, path(car, v(-0.1, 0, 0))],
      [prop, path(prop, v(0.1, 0, 0))],
      [blocker, path(blocker)],
    ]);
    const limits = guardBodyTrajectories([...paths.keys()], paths);
    assert.equal(limits.get(car), 1);
    assert.ok(limits.get(prop) < 1);
  };
  verifyClearance();

  const damagedRevision = car.damage.deformationRevision;
  simulation.repair(car);
  assert.ok(car.damage.deformationRevision > damagedRevision);
  assert.equal(car.revision, car.damage.deformationRevision);
  assert.ok(
    car.shapeVertices.every((shape, index) =>
      shape.every(
        (point, i) => point.distanceTo(originalVertices[index][i]) === 0,
      ),
    ),
    "repair restores the authored collision vertices",
  );
  verifyClearance();
});

test("repeated guard runs rebuild geometry after a hull shape change", () => {
  const guard = new BodyTrajectoryGuard();
  const car = body([0, 0, 0], 0.1);
  const wall = body([1.3, 0, 0], 0.1, true);
  const paths = new Map([
    [car, path(car, v(1, 0, 0))],
    [wall, path(wall)],
  ]);
  assert.equal(guard.run([car, wall], paths).get(car), 1);
  car.hulls[0] = buildBoxHull(v(-0.4, -0.1, -0.1), v(0.4, 0.1, 0.1));
  const accepted = guard.run([car, wall], paths).get(car);
  assert.ok(accepted < 1);
  assert.ok(
    depth(car, wall, paths.get(car), paths.get(wall), accepted) <= 1.01e-6,
  );
});
