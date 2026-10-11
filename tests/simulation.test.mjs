import test from "node:test";
import assert from "node:assert/strict";
import {
  Group,
  Vector3,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshBasicMaterial,
  DoubleSide,
  Quaternion,
} from "three";
import { WorldCollision } from "../src/world.ts";
import { DamageSystem } from "../src/damage.ts";
import {
  createSimulatedCar,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { originalCar } from "./support/original-car.mjs";
import { transformHull } from "../src/physics/geometry.ts";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import { createBallJoint } from "../src/physics/joint.ts";
async function stock(t, name, position = new Vector3()) {
  let data;
  try {
    data = await originalCar(name);
  } catch (e) {
    if (e.code === "ENOENT") {
      t.skip("Local original data absent");
      return;
    }
    throw e;
  }
  const damage = new DamageSystem(data.assets, data.group, data.text);
  await damage.init();
  const body = createSimulatedCar(
    data.group,
    data.text,
    damage,
    position,
    0,
    true,
  );
  return body;
}
const emptyWorld = {
  raycast() {
    return null;
  },
  querySurfaces() {
    return [];
  },
};
function roadCorner(size = 20) {
  const scene = new Group();
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.userData.c2Flags = 4096;
  for (const vertices of [
    [
      -size,
      0,
      -size,
      size,
      0,
      size,
      size,
      0,
      -size,
      -size,
      0,
      -size,
      -size,
      0,
      size,
      size,
      0,
      size,
    ],
    [
      -size,
      -size,
      0,
      size,
      size,
      0,
      size,
      -size,
      0,
      -size,
      -size,
      0,
      -size,
      size,
      0,
      size,
      size,
      0,
    ],
  ]) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.userData.sourceFaceFlags = Uint8Array.from([7, 7]);
    scene.add(new Mesh(geometry, material));
  }
  return { scene, world: new WorldCollision(scene) };
}

test("outer physics retains original Eagle crush events until all five steps finish", async (t) => {
  const car = await stock(t, "EAGLE3", new Vector3(0, 0.15, 0.6));
  if (!car) return;
  // Isolate ordinary dent timing from the separately tested bend/split paths.
  car.damage.wam.bendability = car.damage.wam.snappability = 0;
  car.damage.damageContext.random = () => 0.5;
  car.state.velocity.set(0, -2, -4);
  const { scene, world } = roadCorner();
  scene.add(car.group);
  const simulation = new VehicleSimulation(world, scene);
  simulation.add(car);
  t.after(() => simulation.dispose());
  const step = simulation.step.bind(simulation);
  const consume = car.damage.applyQueuedCrush.bind(car.damage);
  let frameRevision = 0;
  let queuedSteps = 0;
  let consumed = 0;
  let stepsInFrame = 0;
  simulation.step = () => {
    step();
    stepsInFrame++;
    assert.equal(
      car.damage.deformationRevision,
      frameRevision,
      "candidate shape and mesh remain unchanged during the frame's impulses",
    );
    if (simulation.ordinaryCrushQueue.count) queuedSteps++;
  };
  car.damage.applyQueuedCrush = (...args) => {
    assert.equal(
      stepsInFrame,
      5,
      "crush executes after the full physics budget",
    );
    assert.equal(simulation.collectingOrdinaryCrush, false);
    consumed++;
    return consume(...args);
  };
  for (let frame = 0; frame < 5; frame++) {
    frameRevision = car.damage.deformationRevision;
    stepsInFrame = 0;
    simulation.updateFrame(frame * 200, 200);
    assert.equal(simulation.ordinaryCrushQueue.count, 0);
  }
  assert.ok(
    queuedSteps > 0 && consumed > 0,
    "real finite-wall collision queues and consumes crush",
  );
  assert.ok(car.damage.deformationRevision > 0);
  assert.equal(
    car.revision,
    car.damage.deformationRevision,
    "the candidate hull is committed after deferred model deformation",
  );
});

test("physics SPAM precedes ordinary crush; full repair cancels SPAM without deleting ordinary events", async (t) => {
  const car = await stock(t, "EAGLE3");
  if (!car) return;
  car.damage.damageContext.random = () => 0.5;
  const simulation = new VehicleSimulation(emptyWorld, new Group());
  simulation.add(car);
  t.after(() => simulation.dispose());
  const phases = [];
  const spam = car.damage.spamModel.bind(car.damage);
  const crush = car.damage.applyQueuedCrush.bind(car.damage);
  car.damage.spamModel = (...args) => {
    phases.push(["spam", args[0]]);
    return spam(...args);
  };
  car.damage.applyQueuedCrush = (...args) => {
    phases.push(["ordinary", args[3]]);
    return crush(...args);
  };
  let step = 0;
  // Source-derived queue/repair scenario, isolated from contact discovery.
  simulation.step = () => {
    if (step === 0) {
      car.damage.applyImpact(
        [new Vector3(-0.16, 0.06, -0.38)],
        new Vector3(0, 0, 0.5),
        false,
        true,
        40,
        new Vector3(0, 0, 0.5),
      );
      simulation.spamCar(car, 0.1);
      simulation.spamCar(car, 0.5);
    }
    if (step === 1) {
      assert.equal(simulation.spamCrushQueue.count, 1);
      assert.equal(simulation.ordinaryCrushQueue.count, 1);
      car.damage.repair();
      assert.equal(simulation.spamCrushQueue.count, 0);
      assert.equal(simulation.ordinaryCrushQueue.count, 1);
      simulation.spamCar(car, 0.3);
    }
    assert.deepEqual(phases, [], "neither model path runs inside physics");
    step++;
  };
  simulation.updateFrame(0, 200);
  assert.equal(phases[0][0], "spam");
  assert.equal(phases[0][1], Math.fround(0.3));
  assert.equal(phases[1][0], "ordinary");
  assert.equal(phases.length, 2);
  assert.equal(simulation.spamCrushQueue.count, 0);
  assert.equal(simulation.ordinaryCrushQueue.count, 0);
});

test("post-impact pitch, fast falls and rotation stay above finite road triangles", async (t) => {
  let hadJointedPart = false;
  for (const [velocity, pitch] of [
    [[3, -2, -4], 0], // Wall impulse pitches a clear bumper through the road.
    [[0, -8, -8], 3], // The old top/bottom features alone missed this tumble.
    [[0, -8, -32], 10],
    [[0, 0, 0], 120], // A large arc cannot be checked by its endpoints alone.
    [[0, -32, 0], 0],
  ]) {
    const car = await stock(t, "EAGLE3", new Vector3(0, 0.15, 0.6));
    if (!car) return;
    car.damage.damageContext.random = () => 0.5;
    car.damage.wam.snappability = 0;
    car.state.velocity.fromArray(velocity);
    car.state.angularVelocity.x = pitch;
    const { scene, world } = roadCorner();
    scene.add(car.group);
    const simulation = new VehicleSimulation(world, scene);
    simulation.add(car);
    let roadImpulse = false;
    for (let tick = 0; tick < 150; tick++) {
      simulation.step();
      const vertices = car.hulls.flatMap(
        (hull) =>
          transformHull(hull, car.state.position, car.state.orientation)
            .vertices,
      );
      assert.ok(
        vertices.every((point) => point.y >= -0.003),
        `Road penetration: v=${velocity}, pitch=${pitch}, tick=${tick}`,
      );
      assert.ok(car.state.orientation.toArray().every(Number.isFinite));
      for (const piece of simulation.debris) {
        hadJointedPart ||= !!piece.joint;
        const points = piece.hulls.flatMap(
          (hull) =>
            transformHull(hull, piece.state.position, piece.state.orientation)
              .vertices,
        );
        assert.ok(
          !piece.joint || points.every((point) => point.y >= -0.003),
          `Part ${piece.part} crossed the road at tick ${tick}: ${piece.state.position.toArray()}, min=${Math.min(...points.map((p) => p.y))}, v=${velocity}, pitch=${pitch}, joint=${!!piece.joint}`,
        );
      }
      roadImpulse ||= simulation.lastImpacts.some(
        (impact) => impact.normal.y > 0.95 && impact.normalImpulse > 0,
      );
    }
    assert.ok(roadImpulse, "The authored road face exchanges momentum");
    if (velocity[2] < 0)
      assert.ok(
        car.damage.deformationRevision > 0,
        "Original crush still runs",
      );
    simulation.dispose();
  }
  assert.ok(
    hadJointedPart,
    "The sustained crash regression includes jointed source parts",
  );
});

test("world integration guard permits falling outside the actual finite road", async (t) => {
  const car = await stock(t, "EAGLE3", new Vector3(3, 0.15, 3));
  if (!car) return;
  const { scene, world } = roadCorner(1);
  const simulation = new VehicleSimulation(world, scene);
  scene.add(car.group);
  simulation.add(car);
  for (let tick = 0; tick < 100; tick++) simulation.step();
  assert.ok(car.state.position.y < -5);
  assert.equal(simulation.lastImpacts.length, 0);
  simulation.dispose();
});

test("joint anchor projection cannot teleport an above-road part through a finite face", async (t) => {
  const car = await stock(t, "EAGLE3", new Vector3(0, 0, 3));
  if (!car) return;
  const { scene, world } = roadCorner();
  scene.add(car.group);
  const simulation = new VehicleSimulation(world, scene);
  simulation.add(car);
  car.damage.damageContext.invulnerable = true;
  car.damage.runtimeParts[0].state.phase = 1;
  const piece = {
    actor: new Group(),
    owner: car,
    part: 0,
    overlapRecovery: true,
    overlapDetected: false,
    worldRecovery: true,
    worldOverlapDetected: false,
    state: {
      position: new Vector3(0, 0.3, 3),
      orientation: new Quaternion(),
      velocity: new Vector3(),
      angularVelocity: new Vector3(),
    },
    properties: {
      mass: 0.05,
      inertia: new Vector3(0.001, 0.001, 0.001),
      centerOfMass: new Vector3(),
      worldFriction: 0,
      objectFriction: 0.4,
    },
    hulls: [
      buildBoxHull(new Vector3(-0.1, -0.1, -0.1), new Vector3(0.1, 0.1, 0.1)),
    ],
  };
  // Independent impossible anchor: projection alone targets the far side of
  // the road, without an incoming velocity sweep which could detect it.
  piece.joint = createBallJoint(
    piece,
    car,
    new Vector3(),
    new Vector3(0, -0.5, 0),
  );
  scene.add(piece.actor);
  simulation.debris.push(piece);
  for (let tick = 0; tick < 100; tick++) {
    simulation.step();
    assert.ok(
      transformHull(
        piece.hulls[0],
        piece.state.position,
        piece.state.orientation,
      ).vertices.every((point) => point.y >= -0.003),
    );
    assert.ok(car.state.position.y > -0.5);
  }
  assert.ok(piece.joint, "Blocked projection does not invent a detachment");
  simulation.dispose();
});

test("step snapshot hook precedes motion and recovery reset invalidates stale candidate poses", async (t) => {
  const car = await stock(t, "EAGLE3");
  if (!car) return;
  const simulation = new VehicleSimulation(emptyWorld, new Group());
  simulation.add(car);
  const snapshots = [];
  simulation.onBeforeStep = () => snapshots.push(car.state.position.clone());
  simulation.update(0.08);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].y, 0);
  assert.ok(snapshots[1].y < snapshots[0].y);
  const epoch = car.poseEpoch;
  simulation.reset(car);
  assert.equal(car.poseEpoch, epoch + 1);
  assert.equal(car.state.predictedPosition, undefined);
  assert.equal(car.state.predictedOrientation, undefined);
  assert.equal(car.state.angularVelocity.length(), 0);
  simulation.dispose();
});
test("original stock cars enter the fixed simulation using authored mass, inertia, wheelbase and hulls", async (t) => {
  const scene = new Group(),
    sim = new VehicleSimulation(emptyWorld, scene),
    cars = [];
  for (const [i, name] of ["EAGLE3", "buggy", "bigdump"].entries()) {
    const car = await stock(t, name, new Vector3(i * 5, 0, 0));
    if (!car) return;
    scene.add(car.group);
    sim.add(car);
    cars.push(car);
  }
  assert.equal(new Set(cars.map((c) => c.properties.mass)).size, 3);
  assert.equal(new Set(cars.map((c) => c.motion.spring[0])).size, 3);
  assert.equal(
    new Set(cars.map((c) => c.hulls[0].vertices.length)).size >= 1,
    true,
  );
  sim.update(0.039);
  assert.equal(sim.elapsed, 0);
  sim.update(0.001);
  assert.equal(sim.elapsed, 0.04);
  for (const car of cars) {
    const vy = (-10 / 6.9) * 0.04;
    assert.ok(
      Math.abs(
        car.state.velocity.y -
          vy *
            (1 -
              (Math.abs(vy) * 0.04 * 0.0005000000237487257 * 6.9) /
                car.properties.mass),
      ) < 1e-12,
    );
    assert.ok(car.state.orientation.toArray().every(Number.isFinite));
    assert.ok(
      car.shapeVertices.flat().every((p) => p.toArray().every(Number.isFinite)),
    );
  }
});
test("original localized crush is persistent, changes eligible authored shape vertices, and repair restores both representations", async (t) => {
  const car = await stock(t, "EAGLE3");
  if (!car) return;
  const originals = car.shapeVertices.map((v) => v.map((p) => p.clone()));
  const saved = [];
  car.group.traverse((o) => {
    if (o.isMesh)
      saved.push([o, Float32Array.from(o.geometry.attributes.position.array)]);
  });
  const minZ = Math.min(...car.shapeVertices.flat().map((p) => p.z));
  const contacts = [new Vector3(-0.16, 0.06, minZ)];
  const energy = new Vector3(0, 0, 3);
  car.damage.applyImpact(
    contacts,
    energy,
    false,
    true,
    40,
    energy.clone().multiplyScalar(0.5),
  );
  const first = saved.reduce(
    (sum, [o, a]) =>
      sum +
      Array.from(o.geometry.attributes.position.array).reduce(
        (x, v, i) => x + Math.abs(v - a[i]),
        0,
      ),
    0,
  );
  assert.ok(first > 0, "Original WAM-linked geometry dents");
  const left = saved.reduce(
    (sum, [o, a]) =>
      sum +
      Array.from(o.geometry.attributes.position.array).reduce(
        (x, v, i) =>
          x + (a[Math.floor(i / 3) * 3] < 0 ? Math.abs(v - a[i]) : 0),
        0,
      ),
    0,
  );
  const right = first - left;
  assert.ok(left > right, "Corner contact stays localized to impacted side");
  car.damage.applyImpact(
    contacts,
    energy,
    false,
    true,
    80,
    energy.clone().multiplyScalar(0.5),
  );
  const repeated = saved.reduce(
    (sum, [o, a]) =>
      sum +
      Array.from(o.geometry.attributes.position.array).reduce(
        (x, v, i) => x + Math.abs(v - a[i]),
        0,
      ),
    0,
  );
  assert.ok(repeated >= first, "Permanent repeated crush accumulates");
  assert.ok(
    car.shapeVertices.some((v, s) =>
      v.some((p, i) => p.distanceTo(originals[s][i]) > 1e-7),
    ),
    "Version4 physical shape is crushed",
  );
  car.damage.repair();
  for (const [o, a] of saved) {
    const repaired = o.geometry.attributes.position.array;
    assert.equal(repaired.length, a.length);
    // C2 stores visual repair targets as U16 over[-10,+10]; physical shape
    // snapshots remain exact. The half-quantum bound follows that format.
    assert.ok(
      Array.from(repaired).every(
        (v, i) => Math.abs(v - a[i]) <= 10 / 65535 + 1e-6,
      ),
    );
  }
  for (let s = 0; s < originals.length; s++)
    for (let i = 0; i < originals[s].length; i++)
      assert.equal(car.shapeVertices[s][i].distanceTo(originals[s][i]), 0);
  assert.equal(
    car.damage.componentLevels.reduce((a, b) => a + b, 0),
    0,
  );
  assert.ok(
    car.damage.runtimeParts.every(
      (p) => p.state.phase === 0 && p.state.accumulatedForce === 0,
    ),
  );
});
test("equal original cars exchange momentum head-on and corner contacts create angular velocity", async (t) => {
  for (const offset of [0, 0.14]) {
    const a = await stock(t, "EAGLE3", new Vector3(0, 0, 0.41)),
      b = await stock(t, "EAGLE3", new Vector3(offset, 0, -0.41));
    if (!a || !b) return;
    b.state.heading = Math.PI;
    b.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    a.state.velocity.z = -4;
    b.state.velocity.z = 4;
    const sim = new VehicleSimulation(emptyWorld, new Group());
    sim.add(a);
    sim.add(b);
    sim.step();
    assert.ok(
      sim.lastImpacts.some((i) => i.b),
      "Authored hulls create car-car contacts",
    );
    const momentum = a.state.velocity
      .clone()
      .multiplyScalar(a.properties.mass)
      .addScaledVector(b.state.velocity, b.properties.mass);
    assert.ok(
      Math.abs(momentum.x) < 1e-7 && Math.abs(momentum.z) < 1e-7,
      "Normal/friction impulses exchange equal momentum",
    );
    assert.ok(
      a.state.velocity.z > -4 && b.state.velocity.z < 4,
      "Both cars change speed",
    );
    if (offset)
      assert.ok(
        Math.abs(a.state.angularVelocity.y) > 1e-3,
        "Off-center crash produces yaw",
      );
    else
      assert.ok(
        Math.abs(a.state.angularVelocity.y) < 1e-5,
        "Symmetric front crash produces no yaw",
      );
  }
});

test("original Eagle splits at a scenery edge before impulse application and full repair reunites both physical halves", async (t) => {
  const car = await stock(t, "EAGLE3", new Vector3(0, 0, 0.55));
  if (!car) return;
  car.damage.damageContext.random = () => 0.5;
  const originalMass = car.properties.mass,
    originalI = car.properties.inertia.clone(),
    originalCOM = car.properties.centerOfMass.clone();
  const scene = new Group(),
    geo = new BufferGeometry();
  // Independently authored perpendicular/oblique faces share a vertical edge;
  // the source contact gate requires two nearby edges with differing normals.
  geo.setAttribute(
    "position",
    new Float32BufferAttribute(
      [0, -1, 0, 0, 1, 0, 1, 1, 0, 0, -1, 0, -1, 1, -1, 0, 1, 0],
      3,
    ),
  );
  geo.userData.sourceFaceFlags = Uint8Array.from([6, 3]); // Only the shared vertical edge participates.
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.userData.c2Flags = 4096;
  scene.add(new Mesh(geo, material));
  const world = new WorldCollision(scene);
  scene.add(car.group);
  const simulation = new VehicleSimulation(world, scene);
  simulation.add(car);
  car.state.velocity.z = -8;
  simulation.step();
  assert.ok(
    car.damage.snapped,
    "Source type0 world-edge force passes original split threshold",
  );
  const child = simulation.debris.find(
    (body) => body.splitRevision !== undefined,
  );
  assert.ok(child, "Secondary half is a persistent independent rigid body");
  assert.ok(
    Math.abs(car.properties.mass + child.properties.mass - originalMass) <
      1e-12,
    "Source partition conserves mass",
  );
  assert.ok(car.properties.mass > 0 && child.properties.mass > 0);
  assert.ok(
    simulation.lastImpacts.some((impact) => impact.sourceType === 9),
    "Pre-split impulses are disabled before recollection",
  );
  assert.ok(
    simulation.lastImpacts.some((impact) => impact.sourceType !== 9),
    "New halves are collision-tested in the same tick",
  );
  for (const body of [car, child])
    assert.ok(
      [
        ...body.state.velocity.toArray(),
        ...body.state.angularVelocity.toArray(),
      ].every(Number.isFinite),
    );
  assert.equal(
    car.damage.repairStep(40).bodyworkRepair,
    0,
    "Held repair cannot heal a snapped body",
  );
  car.damage.repair();
  car.state.position.z = 2;
  car.state.velocity.set(0, 0, 0);
  simulation.step();
  assert.equal(car.damage.snapped, false);
  assert.equal(simulation.debris.length, 0);
  assert.equal(car.properties.mass, originalMass);
  assert.deepEqual(car.properties.inertia, originalI);
  assert.deepEqual(car.properties.centerOfMass, originalCOM);
  assert.ok(car.damage.runtimeParts.every((part) => part.state.phase === 0));
});

test("original Volvo roof configuration rejects splitting when authored snappability is zero", async (t) => {
  const car = await stock(t, "volvo");
  if (!car) return;
  car.damage.damageContext.random = () => 0.5;
  const originalMass = car.properties.mass,
    scene = new Group(),
    geo = new BufferGeometry();
  geo.setAttribute(
    "position",
    new Float32BufferAttribute(
      [-3, 0.8, -3, 3, 0.8, -3, 3, 0.8, 3, -3, 0.8, -3, 3, 0.8, 3, -3, 0.8, 3],
      3,
    ),
  );
  geo.userData.sourceFaceFlags = Uint8Array.from([7, 7]); // Face contact alone, no wedge-edge split.
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.userData.c2Flags = 4096;
  scene.add(new Mesh(geo, material));
  const world = new WorldCollision(scene),
    simulation = new VehicleSimulation(world, scene);
  scene.add(car.group);
  simulation.add(car);
  car.state.velocity.y = 8;
  simulation.step();
  assert.equal(car.damage.wam.snappability, 0);
  assert.equal(
    car.damage.snapped,
    false,
    "Zero snappability makes the original roof threshold infinite",
  );
  assert.ok(
    simulation.lastImpacts.some(
      (i) => i.sourceType === 1 && i.normalImpulse > 0,
    ),
    "Overhead face collision still exchanges momentum",
  );
  assert.ok(car.state.velocity.y < 8);
  simulation.dispose();
});

test("source knackered state and ten-second countdown survive a late full model repair", async (t) => {
  const car = await stock(t, "EAGLE3");
  if (!car) return;
  const sim = new VehicleSimulation(emptyWorld, new Group());
  sim.add(car);
  car.damage.componentLevels[0] = 99;
  sim.step();
  assert.equal(car.knackered, true);
  const wastedAt = car.wastedAt;
  car.damage.repair();
  car.repairing = true;
  let bills = 0;
  sim.onRepair = () => bills++;
  sim.step();
  assert.equal(car.wastedAt, wastedAt);
  assert.equal(car.knackered, true);
  assert.equal(bills, 0);
});

test("original Porker roof cut creates independent halves from a face impact while retaining wheel forces", async (t) => {
  const car = await stock(t, "porker2");
  if (!car) return;
  car.damage.damageContext.random = () => 0.5;
  const originalSpring = [...car.motion.spring],
    originalDamper = [...car.motion.damper];
  const originalMass = car.properties.mass,
    scene = new Group(),
    geo = new BufferGeometry();
  geo.setAttribute(
    "position",
    new Float32BufferAttribute(
      [
        -3, 0.54, -3, 3, 0.54, -3, 3, 0.54, 3, -3, 0.54, -3, 3, 0.54, 3, -3,
        0.54, 3,
      ],
      3,
    ),
  );
  geo.userData.sourceFaceFlags = Uint8Array.from([7, 7]);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.userData.c2Flags = 4096;
  scene.add(new Mesh(geo, material));
  const world = new WorldCollision(scene),
    sim = new VehicleSimulation(world, scene);
  scene.add(car.group);
  sim.add(car);
  car.state.velocity.y = 8;
  sim.step();
  assert.ok(
    car.damage.snapped,
    "Original positive snappability and qualifying above-cut impulses trigger roof split",
  );
  assert.equal(car.damage.splitRuntime.disableMotion, false);
  assert.ok(Math.abs(car.damage.splitRuntime.plane.normal.y) > 0.707107);
  const child = sim.debris.find((b) => b.part < 0);
  assert.ok(child);
  assert.ok(
    Math.abs(car.properties.mass + child.properties.mass - originalMass) <
      1e-10,
  );
  assert.ok(sim.lastImpacts.some((i) => i.sourceType === 9));
  assert.deepEqual(
    car.motion.spring,
    originalSpring,
    "Source splitting preserves stiffness despite mass partition",
  );
  assert.deepEqual(car.motion.damper, originalDamper);
  assert.ok(
    car.state.wheelLengths.every(
      (length) => length === car.motion.suspensionBase.rideHeight,
    ),
  );
  sim.dispose();
  assert.equal(sim.debris.length, 0);
});
