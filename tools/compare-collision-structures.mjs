#!/usr/bin/env node
/**
 * Short deterministic ABBA whole-physics-tick comparison for collision
 * structure changes. Original game data is read from each checkout's ignored
 * carma2_orig installation. Asset-derived numerical reports remain ignored.
 *
 * Run from the candidate checkout with:
 *   node --import tsx tools/compare-collision-structures.mjs /path/to/baseline
 * Arguments: baseline-root [candidate-root] [tick-count]
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import path from "node:path";

const candidateRoot = path.resolve(
  process.argv[3] ??
    path.dirname(fileURLToPath(new URL("../package.json", import.meta.url))),
);
assert.ok(
  process.argv[2],
  "Supply the separate baseline source root as the first argument",
);
const baselineRoot = path.resolve(process.argv[2]);
assert.notEqual(
  baselineRoot,
  candidateRoot,
  "Baseline and candidate must be separate source roots",
);
const tickCount = Number(process.argv[4] ?? 4);
assert(
  Number.isInteger(tickCount) && tickCount >= 3 && tickCount <= 5,
  "tick count must be an integer from 3 to 5",
);

async function checkout(root) {
  const load = (p) => import(pathToFileURL(path.join(root, p)).href);
  const [
    THREE,
    { originalCar },
    { DamageSystem },
    simulation,
    { WorldCollision },
    random,
    motion,
  ] = await Promise.all([
    import(
      pathToFileURL(path.join(root, "node_modules/three/build/three.module.js"))
        .href
    ),
    load("tests/support/original-car.mjs"),
    load("src/damage.ts"),
    load("src/physics/simulation.ts"),
    load("src/world.ts"),
    load("src/native-random.ts"),
    load("src/physics/motion.ts"),
  ]);
  return {
    root,
    THREE,
    originalCar,
    DamageSystem,
    ...simulation,
    WorldCollision,
    sharedNativeRandom: random.sharedNativeRandom,
    sharedMotionContext: motion.sharedMotionContext,
  };
}

function finiteFloorWall(THREE) {
  const scene = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  material.userData.c2Flags = 4096;
  for (const vertices of [
    [-30, 0, -30, 30, 0, 30, 30, 0, -30, -30, 0, -30, -30, 0, 30, 30, 0, 30],
    [-30, -30, 0, 30, 30, 0, 30, -30, 0, -30, -30, 0, -30, 30, 0, 30, 30, 0],
  ]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(vertices, 3),
    );
    geometry.userData.sourceFaceFlags = Uint8Array.from([7, 7]);
    scene.add(new THREE.Mesh(geometry, material));
  }
  return scene;
}

function num(value) {
  assert.ok(Number.isFinite(value), `Nonfinite physical value: ${value}`);
  return value;
}
function vector(v) {
  return v.toArray().map(num);
}

function fingerprint(sim, cars) {
  const bodies = [...cars, ...sim.debris];
  const index = new Map(bodies.map((body, i) => [body, i]));
  return {
    bodies: bodies.map((body) => ({
      kind: body.kind ?? "car",
      part: body.part ?? null,
      position: vector(body.state.position),
      orientation: vector(body.state.orientation),
      velocity: vector(body.state.velocity),
      angularVelocity: vector(body.state.angularVelocity),
      mass: num(body.properties.mass),
      inertia: vector(body.properties.inertia),
      centerOfMass: vector(body.properties.centerOfMass),
      immovable: body.properties.immovable ?? false,
      parent: body.joint ? index.get(body.joint.parent) : null,
      joint: body.joint
        ? {
            type: body.joint.type,
            childAnchor: vector(body.joint.childAnchor),
            parentAnchor: vector(body.joint.parentAnchor),
          }
        : null,
      damage: body.damage ? Array.from(body.damage.componentLevels, num) : null,
      deformationRevision: body.damage?.deformationRevision ?? null,
      splitRevision: body.damage?.splitRevision ?? null,
      hulls: body.hulls.map((h) => ({
        vertices: h.vertices.map(vector),
        vertexOrder: h.vertexOrder ?? null,
        nativeType: h.nativeType ?? null,
        edges: h.edges,
        faces: h.faces.map((f) => ({
          normal: vector(f.normal),
          constant: num(f.constant),
          indices: f.indices,
        })),
      })),
    })),
    impacts: sim.lastImpacts.map((hit) => ({
      a: index.get(hit.a),
      b: hit.b ? index.get(hit.b) : null,
      point: vector(hit.point),
      pointB: hit.pointB ? vector(hit.pointB) : null,
      normal: vector(hit.normal),
      tangentImpulse: vector(hit.tangentImpulse),
      closingSpeed: num(hit.closingSpeed),
      impulse: num(hit.normalImpulse),
      accepted: hit.solverAccepted ?? null,
      sourceType: hit.sourceType ?? null,
    })),
  };
}

async function runOne(api, scenario) {
  const { THREE, sharedNativeRandom, sharedMotionContext } = api;
  sharedNativeRandom.seed(0x6c617232);
  sharedMotionContext.stopTimer = 0;
  sharedMotionContext.currentCar = undefined;
  const scene = finiteFloorWall(THREE);
  const names =
    scenario === "sparse-intact" ? ["EAGLE3"] : ["EAGLE3", "cerby", "EAGLE3"];
  const positions =
    scenario === "sparse-intact"
      ? [[0, 1.6, 1.2]]
      : [
          [-0.45, 1.5, 1.1],
          [0.45, 1.5, 1.1],
          [0, 2.1, 1.8],
        ];
  const cars = [];
  for (let i = 0; i < names.length; i++) {
    const data = await api.originalCar(names[i]);
    const damage = new api.DamageSystem(data.assets, data.group, data.text);
    await damage.init();
    damage.damageContext.random = () => 0.5;
    const car = api.createSimulatedCar(
      data.group,
      data.text,
      damage,
      new THREE.Vector3(...positions[i]),
      0,
      true,
      { immutableHulls: true },
    );
    scene.add(car.group);
    cars.push(car);
  }
  const sim = new api.VehicleSimulation(new api.WorldCollision(scene), scene);
  for (const car of cars) sim.add(car);
  sim.correctionDiagnostics = {};
  const pairEvents = [];
  sim.bodyPairDiagnostics = (phase, counters) =>
    pairEvents.push({ phase, ...counters });
  if (scenario !== "sparse-intact") {
    for (const car of cars) {
      car.state.velocity.set(0, 0, -3);
      sim.spamCar(car, 0.35);
    }
    assert(
      sim.debris.length > 0,
      "damage setup must create real detached parts",
    );
  } else {
    cars[0].state.velocity.set(0, -1, -3);
  }
  const setup = {
    carCount: cars.length,
    authoredHullCount: cars.reduce((n, car) => n + car.hulls.length, 0),
    detachedPartCount: sim.debris.length,
    initial: fingerprint(sim, cars),
  };
  const tickMs = [],
    tickStateHashes = [];
  const fingerprintHash = () =>
    createHash("sha256")
      .update(JSON.stringify(fingerprint(sim, cars)))
      .digest("hex");
  const initialStateHash = fingerprintHash();
  try {
    for (let i = 0; i < tickCount; i++) {
      const start = process.hrtime.bigint();
      sim.step();
      tickMs.push(Number(process.hrtime.bigint() - start) / 1e6);
      tickStateHashes.push(fingerprintHash());
    }
    assert.equal(
      tickMs.length,
      tickCount,
      "all requested physics steps completed",
    );
    assert(
      tickMs.every((ms) => ms > 0),
      "each timed physics step must be nonzero",
    );
    return {
      setup,
      initialStateHash,
      tickStateHashes,
      final: fingerprint(sim, cars),
      tickMs,
      diagnostics: structuredClone(sim.correctionDiagnostics),
      bodyPairDiagnostics: pairEvents,
      completedTicks: tickMs.length,
    };
  } finally {
    sim.dispose();
  }
}

const [baseline, candidate] = await Promise.all([
  checkout(baselineRoot),
  checkout(candidateRoot),
]);
const report = {
  generatedAt: new Date().toISOString(),
  baselineRoot,
  candidateRoot,
  tickCount,
  method:
    "serial ABBA; each pass reconstructs original cars, damage systems, world, and simulation; setup excluded from tick timing",
  scenarios: {},
};
for (const scenario of ["sparse-intact", "damaged-dense"]) {
  const passes = [];
  for (const side of ["baseline", "candidate", "candidate", "baseline"]) {
    const api = side === "baseline" ? baseline : candidate;
    passes.push({ side, result: await runOne(api, scenario) });
  }
  const a = passes.filter((p) => p.side === "baseline").map((p) => p.result);
  const b = passes.filter((p) => p.side === "candidate").map((p) => p.result);
  // Exact checks expose state drift; diagnostics and elapsed time are excluded.
  for (const pass of passes) {
    assert.deepEqual(
      pass.result.setup,
      a[0].setup,
      `${scenario}: setup differs`,
    );
    assert.deepEqual(
      pass.result.tickStateHashes,
      a[0].tickStateHashes,
      `${scenario}: intermediate state differs`,
    );
  }
  assert.deepEqual(
    a[0].final,
    b[0].final,
    `${scenario}: final physics fingerprint differs`,
  );
  assert.deepEqual(
    a[0].final,
    a[1].final,
    `${scenario}: baseline is not deterministic`,
  );
  assert.deepEqual(
    b[0].final,
    b[1].final,
    `${scenario}: candidate is not deterministic`,
  );
  report.scenarios[scenario] = {
    passes,
    deterministicExactMatch: true,
    baselineMedianTickMs: median(a.flatMap((p) => p.tickMs)),
    candidateMedianTickMs: median(b.flatMap((p) => p.tickMs)),
    baselineMeanTickMs: mean(a.flatMap((p) => p.tickMs)),
    candidateMeanTickMs: mean(b.flatMap((p) => p.tickMs)),
  };
}

function mean(values) {
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

const outDir = path.join(candidateRoot, "artifacts/perf21");
await mkdir(outDir, { recursive: true });
const outPath = path.join(outDir, "collision-structures.json");
await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${outPath}`);
for (const [name, value] of Object.entries(report.scenarios))
  console.log(
    `${name}: baseline ${value.baselineMedianTickMs.toFixed(3)} ms/tick; candidate ${value.candidateMedianTickMs.toFixed(3)} ms/tick; exact state match`,
  );
