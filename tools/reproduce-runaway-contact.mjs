/**
 * Procedural reproducer for the shallow world-contact energy investigation.
 * This fixture is independent of any captured/proprietary game data. It is a
 * diagnostic report, not a passing regression: it records current solver
 * behavior so candidate fixes can be compared against native/guard controls.
 * It does not replay the reported FAIR wreck or establish historical cause.
 *
 * Run: node --import tsx tools/reproduce-runaway-contact.mjs
 * Add --full-step to include one production 40 ms tick with worldRecovery off.
 * Output is restricted to the ignored artifacts/ directory.
 */
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
} from "three";
import {
  lstat,
  mkdir,
  realpath,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildBoxHull } from "../src/physics/box-hull.ts";
import {
  DeferredContactFriction,
  resolveContacts,
} from "../src/physics/contact.ts";
import { createHierarchyMotionPhase } from "../src/physics/hierarchy-motion.ts";
import { createNonCarBody } from "../src/physics/noncar-body.ts";
import { VehicleSimulation } from "../src/physics/simulation.ts";
import { WorldCollision } from "../src/world.ts";
import { parseNonCarMechanics } from "../src/noncars.ts";

const SLOPE = 1e-6;
const SPIN = 20;
const DT = 0.04;
const REPO = fileURLToPath(new URL("../", import.meta.url));
const OUT = resolve(REPO, "artifacts/runaway-contact-analysis.json");

function makeFixture(slope = SLOPE) {
  const root = new Group();
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [-10, 10 * slope, -10, 10, -10 * slope, 10, 10, -10 * slope, -10],
      3,
    ),
  );
  geometry.userData.sourceFaceFlags = new Uint8Array([7]);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  root.add(new Mesh(geometry, material));
  const world = new WorldCollision(root);
  const simulation = new VehicleSimulation(world, root);

  const lo = new Vector3(-0.05, 0, -0.055);
  const hi = new Vector3(0.055, 0.307, 0.055);
  const size = hi.clone().sub(lo);
  const mass = 0.05;
  const body = {
    kind: "noncar",
    mechanics: { ignoreWorldCollisions: false },
    hulls: [buildBoxHull(lo, hi)],
    properties: {
      mass,
      inertia: new Vector3(
        size.y ** 2 + size.z ** 2,
        size.x ** 2 + size.z ** 2,
        size.x ** 2 + size.y ** 2,
      ).multiplyScalar(mass / 12),
      centerOfMass: lo.clone().add(hi).multiplyScalar(0.5),
      worldFriction: 0,
      objectFriction: 0,
      immovable: false,
      rotationLocked: false,
    },
    state: {
      position: new Vector3(),
      orientation: new Quaternion(),
      velocity: new Vector3(-3, 0, 1),
      angularVelocity: new Vector3(0, 0, SPIN),
    },
  };
  simulation.hierarchyMotion = createHierarchyMotionPhase([body], [], DT);
  simulation.hierarchyMotion.writeCandidates([body]);
  return { root, geometry, material, simulation, body, lo, hi };
}

function bodyEnergy(body) {
  const omegaBody = body.state.angularVelocity
    .clone()
    .applyQuaternion(body.state.orientation.clone().invert());
  // Do not mutate inertia while forming the quadratic form.
  const iw = omegaBody.clone().multiply(body.properties.inertia);
  return (
    0.5 * body.properties.mass * body.state.velocity.lengthSq() +
    0.5 * omegaBody.dot(iw)
  );
}

function lever(body, point) {
  return point
    .clone()
    .sub(
      body.properties.centerOfMass
        .clone()
        .applyQuaternion(body.state.orientation),
    )
    .sub(body.state.position);
}

function invInertia(body, torque) {
  // Rotate torque first, then apply diagonal body inertia.
  const local = torque
    .clone()
    .applyQuaternion(body.state.orientation.clone().invert());
  const inertia = body.properties.inertia;
  local.set(local.x / inertia.x, local.y / inertia.y, local.z / inertia.z);
  return local.applyQuaternion(body.state.orientation);
}

function rowK(body, rowA, rowB) {
  const rA = lever(body, rowA.point);
  const rB = lever(body, rowB.point);
  const ja = rowA.normal;
  const jb = rowB.normal;
  const ta = rA.clone().cross(ja);
  const tb = rB.clone().cross(jb);
  return ja.dot(jb) / body.properties.mass + ta.dot(invInertia(body, tb));
}

function relNormalVelocity(contact, body) {
  const pointVelocity = body.state.velocity
    .clone()
    .add(body.state.angularVelocity.clone().cross(lever(body, contact.point)));
  const otherVelocity = contact.b
    ? contact.b.state.velocity
        .clone()
        .add(
          contact.b.state.angularVelocity
            .clone()
            .cross(lever(contact.b, contact.pointB ?? contact.point)),
        )
    : new Vector3();
  return contact.normal.dot(pointVelocity.sub(otherVelocity));
}

function contactDiagnostic(contact, body, emitter) {
  const relativeNormal = relNormalVelocity(contact, body);
  return {
    point: contact.point.toArray(),
    pointB: contact.pointB?.toArray(),
    normal: contact.normal.toArray(),
    sourceType: contact.sourceType,
    penetration: contact.penetration,
    faceFriction: contact.faceFriction,
    provenance: emitter,
    jv: relativeNormal,
    closing: Math.max(0, -relativeNormal),
  };
}

function worldRestingDemand(contact, body) {
  if (contact.b) throw new Error("This diagnostic contains world rows only");
  const oldInverse = body.state.orientation.clone().invert();
  const local = contact.point
    .clone()
    .sub(body.state.position)
    .applyQuaternion(oldInverse);
  const end = local
    .clone()
    .applyQuaternion(body.state.predictedOrientation ?? body.state.orientation)
    .add(body.state.predictedPosition ?? body.state.position);
  const displacement = end
    .sub(body.state.position)
    .applyQuaternion(oldInverse)
    .sub(local);
  return Math.max(
    0.01,
    0.01 -
      contact.normal.clone().applyQuaternion(oldInverse).dot(displacement) / DT,
  );
}

function uniqueMerged(nativeRows, guardRows) {
  return [
    ...nativeRows,
    ...guardRows.filter(
      (row) =>
        !nativeRows.some(
          (other) =>
            other.b === row.b && other.normal.dot(row.normal) > 1 - 1e-8,
        ),
    ),
  ];
}

function runControl(mode, rows, fixture, origins) {
  const { body } = fixture;
  body.state.velocity.set(-3, 0, 1);
  body.state.angularVelocity.set(0, 0, SPIN);
  const rowData = rows.map((contact) =>
    contactDiagnostic(contact, body, origins.get(contact)),
  );
  // The native branch is selected for the WHOLE packet, not independently
  // per row. In particular the native-only opening control uses resting RHS.
  const impactBranch = rowData.some((row) => row.closing > 0.01);
  const demands = rows.map((row, i) =>
    impactBranch
      ? 0.01 + 1.001 * rowData[i].closing
      : worldRestingDemand(row, body),
  );
  const before = bodyEnergy(body);
  const impacts = resolveContacts(
    rows,
    DT,
    [],
    undefined,
    new DeferredContactFriction(),
  );
  const after = bodyEnergy(body);
  const lambda = impacts.map((impact) => impact.normalImpulse);
  const K = rows.map((a) => rows.map((b) => rowK(body, a, b)));
  // Evaluate K lambda - b using pre-solve Jv and returned multipliers.
  const residual = K.map(
    (line, i) =>
      line.reduce((sum, kij, j) => sum + kij * lambda[j], 0) - demands[i],
  );
  return {
    mode,
    impactBranch,
    count: rows.length,
    beforeEnergy: before,
    afterEnergy: after,
    energyRatio: before > 0 ? after / before : null,
    velocity: body.state.velocity.toArray(),
    angularVelocityWorld: body.state.angularVelocity.toArray(),
    lambda,
    K,
    b: demands,
    physicalKlambdaMinusB: residual,
    activeKlambdaMinusB: residual
      .map((value, index) => ({ index, value }))
      .filter(({ index }) => lambda[index] > 0),
    contacts: rowData.map((row, i) => ({
      ...row,
      rhs: demands[i],
      lambda: lambda[i],
      closingSpeed: impacts[i]?.closingSpeed,
    })),
  };
}

function runControls() {
  const fixture = makeFixture();
  const { simulation, body } = fixture;
  const native = simulation.computeWorldContacts(body, body.hulls);
  const nativePosition = body.state.predictedPosition.clone();
  const nativeOrientation = body.state.predictedOrientation.clone();
  const guardResult = simulation.computeAdvanceWorldContacts(body, false);
  const guard = guardResult.contacts;
  body.state.predictedPosition.copy(nativePosition);
  body.state.predictedOrientation.copy(nativeOrientation);
  const merged = uniqueMerged(native, guard);
  const origins = new Map([
    ...native.map((r) => [r, "native-chord"]),
    ...guard.map((r) => [r, "angular-guard"]),
  ]);
  const results = [
    runControl("native", native, fixture, origins),
    runControl("guard", guard, fixture, origins),
    runControl("merged", merged, fixture, origins),
  ];
  const report = {
    fixture: {
      kind: "procedural single shallow triangle against box hull",
      capturedFAIRReplay: false,
      slope: SLOPE,
      dt: DT,
      initialVelocity: [-3, 0, 1],
      initialAngularVelocityWorld: [0, 0, SPIN],
      mass: body.properties.mass,
      inertiaBodyDiagonal: body.properties.inertia.toArray(),
      centerOfMass: body.properties.centerOfMass.toArray(),
      boxMin: fixture.lo.toArray(),
      boxMax: fixture.hi.toArray(),
      guardFraction: guardResult.fraction,
      guardCrossingFraction: guardResult.crossingFraction,
    },
    controls: results,
  };
  fixture.simulation.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
  return report;
}

function runFullStep() {
  const fixture = makeFixture();
  const { simulation, root } = fixture;
  // The production-tick branch uses the real PHIL hierarchy built at update;
  // the ad-hoc candidate phase belongs only to the direct row controls.
  simulation.hierarchyMotion = undefined;
  const actor = new Group();
  actor.name = "&01!0001.ACT";
  root.add(actor);
  const mechanics = parseNonCarMechanics(
    "101\n1\n.0025,.1535,0\n.0025,0,0\n1\nbox\n-.05,0,-.055\n.055,.307,.055\n.05,.05\n.105,.307,.11\n0\n0\n0\nEND",
  );
  const body = createNonCarBody(actor, mechanics);
  simulation.addNonCar(body);
  simulation.admitNonCar(body, { wake: true });
  body.worldRecovery = false;
  body.overlapRecovery = false;
  body.state.velocity.set(-3, 0, 1);
  body.state.angularVelocity.set(0, 0, SPIN);
  const events = [];
  simulation.onLocalResponseTrace = (event) => {
    if (event.phase === "response" && events.length < 16)
      events.push({
        phase: event.phase,
        attempt: event.attempt,
        velocity: body.state.velocity.toArray(),
        angularVelocity: body.state.angularVelocity.toArray(),
        rejected: event.rejected,
      });
  };
  const started = performance.now();
  simulation.update(DT);
  const result = {
    tickMs: performance.now() - started,
    worldRecovery: body.worldRecovery,
    overlapRecovery: body.overlapRecovery,
    velocity: body.state.velocity.toArray(),
    angularVelocityWorld: body.state.angularVelocity.toArray(),
    events,
  };
  simulation.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
  return result;
}

export function produceRunawayContactReport(options = {}) {
  const report = runControls();
  if (options.fullStep) report.fullProductionTick = runFullStep();
  return report;
}

async function writeReport(report) {
  const folder = dirname(OUT);
  for (const path of [folder, OUT]) {
    const info = await lstat(path).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (info?.isSymbolicLink())
      throw new Error("Diagnostic output must not be a symlink");
  }
  await mkdir(folder, { recursive: true });
  const actualFolder = await realpath(folder);
  for (const source of [
    resolve(REPO, "carma2_orig"),
    resolve(process.env.CARMA2_ROOT ?? resolve(REPO, "carma2_orig")),
  ]) {
    const original = await realpath(source).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!original) continue;
    const rel = relative(original, actualFolder);
    if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)))
      throw new Error("Diagnostic output must remain outside original assets");
  }
  const temporary = resolve(actualFolder, `.runaway-${randomUUID()}.json`);
  try {
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, {
      flag: "wx",
    });
    // Replace rather than write through an existing hard-linked report inode.
    await rename(temporary, OUT);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

const invokedPath = process.argv[1] && resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const report = produceRunawayContactReport({
    fullStep: process.argv.includes("--full-step"),
  });
  await writeReport(report);
  console.log(
    JSON.stringify(
      {
        output: OUT,
        controls: report.controls.map(
          ({
            mode,
            count,
            beforeEnergy,
            afterEnergy,
            energyRatio,
            lambda,
          }) => ({
            mode,
            count,
            beforeEnergy,
            afterEnergy,
            energyRatio,
            lambda,
          }),
        ),
        fullProductionTick: report.fullProductionTick,
      },
      null,
      2,
    ),
  );
}
