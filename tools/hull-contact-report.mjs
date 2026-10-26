/** Bounded physical-contact diagnostics; original-derived captures stay ignored.
 * Run explicitly: node --import tsx tools/hull-contact-report.mjs */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { originalCar } from "../tests/support/original-car.mjs";
import { DamageSystem } from "../src/damage.ts";
import { buildHull } from "../src/physics/geometry.ts";
import {
  createSimulatedCar,
  PHYSICS_STEP,
  VehicleSimulation,
} from "../src/physics/simulation.ts";
import { NativeRandom, sharedNativeRandom } from "../src/native-random.ts";
import { WorldCollision } from "../src/world.ts";

const file = "artifacts/phy11-hull-contacts.json";
const started = performance.now();
const deadlineMs = 15000;
const sequence = [
  ["front", 0, 2],
  ["rear", Math.PI, 4],
  ["left", Math.PI / 2, 4],
  ["right", -Math.PI / 2, 4],
  ["front-left-corner", Math.PI / 4, 6],
  ["front", 0, 8],
  ["rear", Math.PI, 8],
  ["left", Math.PI / 2, 8],
  ["right", -Math.PI / 2, 8],
  ["rear-right-corner", (-3 * Math.PI) / 4, 10],
  ["front", 0, 12],
  ["front-right-corner", -Math.PI / 4, 12],
];
const report = {
  fixture:
    "Stock original cars; consecutive VehicleSimulation.step car-versus-procedural-plane contacts. Only pose/velocity and their placement caches reset between hits; damage, components, structural state and detached bodies persist. No historical crash chronology is claimed.",
  limits: { deadlineMs, cars: 3, impactsPerCar: 12, ticksPerImpact: 3 },
  stepSeconds: PHYSICS_STEP,
  seed: 1,
  cars: [],
  recovered: [],
  failures: [],
  skipped: [],
};

function checkDeadline() {
  assert.ok(
    performance.now() - started < deadlineMs,
    "Contact audit exceeded 15 seconds",
  );
}

function planeScene() {
  const scene = new Group();
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [-30, -30, 0, 30, 30, 0, 30, -30, 0, -30, -30, 0, -30, 30, 0, 30, 30, 0],
      3,
    ),
  );
  geometry.userData.sourceFaceFlags = Uint8Array.from([7, 7]);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  material.userData.c2Flags = 4096;
  scene.add(new Mesh(geometry, material));
  return scene;
}

function finiteState(body) {
  for (const key of [
    "position",
    "orientation",
    "velocity",
    "angularVelocity",
    "predictedPosition",
    "predictedOrientation",
  ])
    if (body.state[key])
      assert.ok(
        body.state[key].toArray().every(Number.isFinite),
        `Nonfinite ${key}`,
      );
  const actor = body.group ?? body.actor;
  assert.ok(
    actor.matrixWorld.elements.every(Number.isFinite),
    "Nonfinite actor matrix",
  );
}

function auditHull(hull) {
  assert.ok(hull.faces.length >= 4, "Missing collision half-spaces");
  assert.ok(
    hull.vertices.every((point) => point.toArray().every(Number.isFinite)),
  );
  let maximumStoredExcess = -Infinity;
  for (const face of hull.faces) {
    assert.ok(face.normal.toArray().every(Number.isFinite));
    assert.ok(Number.isFinite(face.constant));
    assert.ok(Math.abs(face.normal.length() - 1) < 1e-5);
    for (const point of hull.vertices) {
      const stored = new Vector3(...point.toArray().map(Math.fround));
      maximumStoredExcess = Math.max(
        maximumStoredExcess,
        face.normal.dot(stored) - face.constant,
      );
    }
  }
  assert.ok(
    maximumStoredExcess <= 1.00001e-6,
    `Stored point outside hull: ${maximumStoredExcess}`,
  );
  return {
    vertices: hull.vertices.length,
    activeVertices: hull.vertexOrder?.length,
    edges: hull.edges.length,
    faces: hull.faces.length,
    maximumStoredExcess,
    recoveredFrom: hull.recoveredFrom ?? null,
  };
}

function placeForImpact(sim, car, heading, speed) {
  car.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), heading);
  const minimumZ = Math.min(
    ...car.hulls.flatMap((hull) =>
      (hull.vertexOrder ?? hull.vertices.map((_, index) => index)).map(
        (index) =>
          hull.vertices[index].clone().applyQuaternion(car.state.orientation).z,
      ),
    ),
  );
  car.state.position.set(0, 0, -minimumZ + 0.01);
  car.state.velocity.set(0, 0, -speed);
  car.state.angularVelocity.set(0, 0, 0);
  car.state.heading = heading;
  car.state.predictedPosition = undefined;
  car.state.predictedOrientation = undefined;
  car.poseEpoch++;
  sim.invalidateWorldFaceCache(car);
  sim.sync(car);
}

function disposeScene(scene) {
  const geometries = new Set(),
    materials = new Set();
  scene.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [])
      materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  scene.clear();
}

await mkdir("artifacts", { recursive: true });
try {
  for (const name of ["porker2", "EAGLE3", "buggy"]) {
    checkDeadline();
    let data;
    try {
      data = await originalCar(name);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      report.skipped.push({
        name,
        reason: "Local stock original car archive absent",
      });
      continue;
    }
    const scene = planeScene();
    let sim, car;
    const row = { name, impacts: [], recoveryObservations: 0 };
    report.cars.push(row);
    const captured = new Set();
    const captureRecovery = (hull, phase) => {
      if (!hull.recoveredFrom) return;
      row.recoveryObservations++;
      const points = hull.vertices.map((point) => point.toArray());
      const key = JSON.stringify(points);
      if (captured.has(key)) return;
      captured.add(key);
      report.recovered.push({
        name,
        phase,
        recoveredFrom: hull.recoveredFrom,
        points,
      });
    };
    try {
      const damage = new DamageSystem(data.assets, data.group, data.text);
      await damage.init();
      const random = new NativeRandom(1);
      sharedNativeRandom.seed(1);
      damage.damageContext.random = random.random;
      damage.damageContext.seedRandom = random.seed;
      car = createSimulatedCar(
        data.group,
        data.text,
        damage,
        new Vector3(),
        0,
        true,
      );
      const originalShapes = car.shapeVertices.map((points) =>
        points.map((point) => point.clone()),
      );
      const world = new WorldCollision(scene);
      sim = new VehicleSimulation(world, scene);
      scene.add(car.group);
      sim.add(car);
      row.initial = car.hulls.map(auditHull);
      for (const [index, [region, heading, speed]] of sequence.entries()) {
        checkDeadline();
        placeForImpact(sim, car, heading, speed);
        const hit = {
          index,
          region,
          heading,
          speed,
          ticks: [],
          worldContacts: 0,
        };
        row.impacts.push(hit);
        for (let tick = 0; tick < 3; tick++) {
          checkDeadline();
          sim.step();
          finiteState(car);
          for (const body of sim.debris) finiteState(body);
          const contacts = sim.lastImpacts.filter(
            (impact) =>
              impact.a === car && !impact.b && impact.normalImpulse > 0,
          );
          hit.worldContacts += contacts.length;
          const phase = { impact: index, tick };
          const committed = car.hulls.map((hull) => {
            captureRecovery(hull, { ...phase, source: "committed" });
            return auditHull(hull);
          });
          const candidates = car.shapeVertices
            .filter((points) => points.length >= 4)
            .map((points) => {
              const hull = buildHull(points);
              captureRecovery(hull, { ...phase, source: "candidate" });
              return auditHull(hull);
            });
          for (const body of sim.debris)
            for (const hull of body.hulls) {
              captureRecovery(hull, {
                ...phase,
                source: "detached",
                part: body.part,
              });
              auditHull(hull);
            }
          hit.ticks.push({
            tick,
            worldContacts: contacts.length,
            maximumImpulse: Math.max(
              0,
              ...contacts.map((contact) => contact.normalImpulse),
            ),
            deformationRevision: damage.deformationRevision,
            bent: !!damage.structuralBend,
            snapped: damage.snapped,
            componentDamage: Array.from(damage.componentLevels),
            detachedBodies: sim.debris.length,
            committed,
            candidates,
          });
        }
        assert.ok(
          hit.worldContacts > 0,
          `No car-versus-plane impulse for ${region} at ${speed}`,
        );
      }
      row.maximumShapeDisplacement = Math.max(
        0,
        ...car.shapeVertices.flatMap((points, shape) =>
          points.length === originalShapes[shape]?.length
            ? points.map((point, index) =>
                point.distanceTo(originalShapes[shape][index]),
              )
            : [],
        ),
      );
      checkDeadline();
      // The normal full-repair owner synchronously refreshes candidate hulls.
      sim.repair(car);
      sim.sync(car);
      finiteState(car);
      row.repair = car.hulls.map(auditHull);
      assert.ok(
        car.hulls.every((hull) => !hull.recoveredFrom),
        "Full repair did not return to native-primary hulls",
      );
      assert.ok(
        !damage.structuralBend && !damage.snapped,
        "Full repair retained structural damage",
      );
      assert.deepEqual(
        car.shapeVertices.map((points) =>
          points.map((point) => point.toArray()),
        ),
        originalShapes.map((points) => points.map((point) => point.toArray())),
      );
    } catch (error) {
      report.failures.push({
        name,
        impact: row.impacts.at(-1)?.index ?? null,
        error: String(error),
        stack: error.stack,
        sourceShapes: car?.shapeVertices.map((points) =>
          points.map((point) => point.toArray()),
        ),
        committedShapes: car?.hulls.map((hull) =>
          hull.vertices.map((point) => point.toArray()),
        ),
      });
    } finally {
      sim?.dispose();
      if (!sim) scene.add(data.group);
      disposeScene(scene);
    }
  }
} catch (error) {
  report.failures.push({ error: String(error), stack: error.stack });
} finally {
  report.wallMs = performance.now() - started;
  await writeFile(file, JSON.stringify(report, null, 2) + "\n");
}
console.log(
  JSON.stringify(
    {
      file,
      cars: report.cars.map((car) => ({
        name: car.name,
        impacts: car.impacts.length,
        contacts: car.impacts.reduce(
          (sum, impact) => sum + impact.worldContacts,
          0,
        ),
        recoveryObservations: car.recoveryObservations,
        maximumShapeDisplacement: car.maximumShapeDisplacement,
        repaired: !!car.repair,
      })),
      uniqueRecoveredInputs: report.recovered.length,
      failures: report.failures.map(({ name, error }) => ({ name, error })),
      skipped: report.skipped,
      wallMs: report.wallMs,
    },
    null,
    2,
  ),
);
if (report.failures.length) process.exitCode = 1;
