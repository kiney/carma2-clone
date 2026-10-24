/** Bounded original-data hull audit. Capture proprietary point arrays only in
 * ignored artifacts; never alter the installation or substitute crash physics. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Vector3 } from "three";
import { originalCar } from "../tests/support/original-car.mjs";
import { DamageSystem } from "../src/damage.ts";
import { createSimulatedCar } from "../src/physics/simulation.ts";
import { buildHull } from "../src/physics/geometry.ts";
import { NativeRandom } from "../src/native-random.ts";

const file = "artifacts/phy11-hull-precision.json";
const report = {
  fixture:
    "Original Porker2, bounded controlled DamageSystem.applyImpact inputs; no physical-contact chronology or historical horizon reproduction is claimed",
  cases: [],
  failures: [],
  skipped: false,
};
const cases = [
  { human: true, rng: "constant0.5", force: 0.5 },
  { human: false, rng: "constant0.5", force: 0.5 },
  { human: true, rng: "native-seed1", force: 5 },
  { human: false, rng: "native-seed1", force: 5 },
];
const sequence = [
  [2, -1],
  [2, 1],
  [0, -1],
  [1, -1],
  [1, -1],
  [1, -1],
  [1, -1],
  [1, -1],
];
const topology = (hull) => ({
  order: hull.vertexOrder,
  edges: hull.edges,
  planes: hull.faces.map((face) => [
    face.normal.toArray(),
    face.constant,
    face.indices,
  ]),
});
const started = performance.now();
await mkdir("artifacts", { recursive: true });
try {
  for (const configuration of cases) {
    let data;
    try {
      data = await originalCar("porker2");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      report.skipped = true;
      break;
    }
    const damage = new DamageSystem(data.assets, data.group, data.text);
    await damage.init();
    const random = new NativeRandom(1);
    damage.damageContext.random =
      configuration.rng === "constant0.5" ? () => 0.5 : random.random;
    damage.damageContext.seedRandom = random.seed;
    const car = createSimulatedCar(
      data.group,
      data.text,
      damage,
      new Vector3(),
      0,
      configuration.human,
    );
    const result = { ...configuration, impacts: [] };
    report.cases.push(result);
    try {
      for (const [impactIndex, [axis, sign]] of sequence.entries()) {
        if (performance.now() - started > 15000)
          throw new Error("Bounded hull audit exceeded 15 seconds");
        const point = damage.bounds.getCenter(new Vector3());
        point.setComponent(
          axis,
          (sign < 0 ? damage.bounds.min : damage.bounds.max).getComponent(axis),
        );
        const force = new Vector3().setComponent(
          axis,
          sign * configuration.force,
        );
        const response = damage.applyImpact(
          [point],
          force,
          true,
          configuration.human,
          impactIndex * 40,
          force,
          point,
        );
        const row = {
          impactIndex,
          axis,
          sign,
          queuedForce: response.queuedForce,
          revision: damage.deformationRevision,
          bent: !!damage.structuralBend,
          components: Array.from(damage.componentLevels),
          shapes: [],
        };
        result.impacts.push(row);
        for (const points of car.shapeVertices) {
          if (points.length < 4) continue;
          const actual = buildHull(points),
            stored = buildHull(
              points.map((p) => new Vector3(...p.toArray().map(Math.fround))),
            );
          assert.deepEqual(
            topology(actual),
            topology(stored),
            "identical native Float32 input retains identical features",
          );
          assert.ok(
            actual.faces.every(
              (face) =>
                face.normal.toArray().every(Number.isFinite) &&
                Number.isFinite(face.constant),
            ),
          );
          row.shapes.push({
            vertices: points.length,
            activeVertices: actual.vertexOrder.length,
            edges: actual.edges.length,
            faces: actual.faces.length,
            rawDoubleCoordinates: points.reduce(
              (n, p) =>
                n + p.toArray().filter((v) => v !== Math.fround(v)).length,
              0,
            ),
            maximumHalfspaceExcess: Math.max(
              ...actual.faces.flatMap((face) =>
                points.map((p) => face.normal.dot(p) - face.constant),
              ),
            ),
          });
        }
      }
      damage.repair();
      result.repairShapes = car.shapeVertices
        .filter((p) => p.length >= 4)
        .map((p) => ({ vertices: p.length, edges: buildHull(p).edges.length }));
    } catch (error) {
      report.failures.push({
        configuration,
        error: String(error),
        stack: error.stack,
        impacts: result.impacts.length,
        shapes: car.shapeVertices.map((points) =>
          points.map((p) => p.toArray()),
        ),
      });
    } finally {
      damage.repair();
      data.group.traverse((object) => {
        object.geometry?.dispose();
        for (const material of Array.isArray(object.material)
          ? object.material
          : object.material
            ? [object.material]
            : [])
          material.dispose();
      });
      data.group.clear();
    }
  }
} finally {
  report.wallMs = performance.now() - started;
  await writeFile(file, JSON.stringify(report, null, 2) + "\n");
}
console.log(
  JSON.stringify(
    {
      file,
      cases: report.cases.length,
      impacts: report.cases.reduce((n, c) => n + c.impacts.length, 0),
      failures: report.failures.map((f) => ({
        configuration: f.configuration,
        error: f.error,
      })),
      skipped: report.skipped,
      wallMs: report.wallMs,
    },
    null,
    2,
  ),
);
if (report.failures.length) process.exitCode = 1;
