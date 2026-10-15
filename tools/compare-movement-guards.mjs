/** Bounded, serial A/B of the pair guard on a captured original-asset scene.
 * Run: PERF_GUARD_ROOT=/tmp/carma-perf20 node --import tsx
 *      tools/compare-movement-guards.mjs artifacts/perf20-seeded-before.json
 * This reconstructs a partial guard phase, never a full simulation replay.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { Quaternion, Vector3 } from "three";

const baselineRoot = resolve(
  process.env.PERF_GUARD_BASELINE_ROOT ||
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);
const optimizedRoot = resolve(
  process.env.PERF_GUARD_ROOT || "/tmp/carma-perf20",
);
assert.notEqual(
  baselineRoot,
  optimizedRoot,
  "Select a separate optimized source root",
);
const input = resolve(process.argv[2] || "artifacts/perf20-seeded-before.json");
const output = resolve(
  process.env.PERF_GUARD_OUTPUT || "artifacts/perf20-guard-phase-abba.json",
);
const parsed = JSON.parse(await readFile(input, "utf8"));
const selected = parsed.cases.find(
  (entry) => entry.scenario.name === "timber-damaged-grid",
);
assert.ok(
  selected?.initialFixture?.bodies?.length,
  "Missing damaged-grid initialFixture",
);
const fixture = selected.initialFixture;
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sourceHash = hash(fixture.bodies);
assert.equal(
  sourceHash,
  fixture.bodiesSha256,
  "Input body fingerprint does not match recorded SHA256",
);
const { sha256, bodiesSha256, ...state } = fixture;
if (sha256)
  assert.equal(
    hash(state),
    sha256,
    "Input full fingerprint does not match recorded SHA256",
  );

// Load both implementations before measuring, then run workloads serially.
const implementations = {};
for (const [name, root] of [
  ["baseline", baselineRoot],
  ["optimized", optimizedRoot],
]) {
  const guardModule = await import(
    pathToFileURL(resolve(root, "src/physics/pair-guard.ts")).href
  );
  const hierarchyModule = await import(
    pathToFileURL(resolve(root, "src/physics/hierarchy-motion.ts")).href
  );
  implementations[name] = {
    root,
    BodyTrajectoryGuard: guardModule.BodyTrajectoryGuard,
    createHierarchyMotionPhase: hierarchyModule.createHierarchyMotionPhase,
  };
}
const vec = (value, label) => {
  assert.ok(
    Array.isArray(value) && value.length === 3 && value.every(Number.isFinite),
    label,
  );
  return new Vector3(...value);
};
function reconstruct(stationary) {
  const bodies = fixture.bodies.map((body) => {
    assert.ok(
      Array.isArray(body.orientation) &&
        body.orientation.length === 4 &&
        body.orientation.every(Number.isFinite),
    );
    return {
      name: body.name,
      state: {
        position: vec(body.position, "position"),
        orientation: new Quaternion(...body.orientation),
        velocity: stationary ? new Vector3() : vec(body.velocity, "velocity"),
        angularVelocity: stationary
          ? new Vector3()
          : vec(body.angularVelocity, "angularVelocity"),
      },
      properties: {
        mass: body.mass,
        inertia: vec(body.inertia, "inertia"),
        centerOfMass: vec(body.centerOfMass, "centerOfMass"),
        immovable: body.immovable,
      },
      // The snapshot omits nativeType/vertexOrder. Do not invent either tag.
      hulls: body.hulls.map((hull) => ({
        vertices: hull.vertices.map((vertex) => vec(vertex, "hull vertex")),
        faces: hull.faces.map((face) => ({
          normal: vec(face.normal, "face normal"),
          constant: face.constant,
          indices: [...face.indices],
        })),
        edges: hull.edges.map((edge) => [...edge]),
      })),
    };
  });
  const joints = [];
  fixture.bodies.forEach((source, index) => {
    if (!source.attachment) return;
    const attached = source.attachment;
    assert.ok(
      Number.isInteger(attached.parent) && bodies[attached.parent],
      "Joint parent missing from snapshot",
    );
    const joint = {
      type: attached.type,
      child: bodies[index],
      parent: bodies[attached.parent],
      childAnchor: vec(attached.childAnchor, "child anchor"),
      parentAnchor: vec(attached.parentAnchor, "parent anchor"),
      childAxis: attached.childAxis
        ? vec(attached.childAxis, "child axis")
        : undefined,
      parentAxis: attached.parentAxis
        ? vec(attached.parentAxis, "parent axis")
        : undefined,
      // Joint limit/translation metadata was not captured. This is documented
      // as a limitation rather than inferred from the attachment's name.
      planeLimits: [],
    };
    assert.notEqual(
      joint.type,
      "translation",
      "Snapshot lacks translation joint axes/travel; cannot reconstruct this guard path",
    );
    bodies[index].joint = joint;
    joints.push(joint);
  });
  return { bodies, joints };
}
const summarize = (values) => ({
  count: values.length,
  mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  min: Math.min(...values),
  max: Math.max(...values),
});
const report = {
  scope:
    "Partial 40ms hierarchy-motion and body-pair guard phase; no full simulation or browser performance claim",
  input,
  sourceBodiesSha256: sourceHash,
  sourceFixtureSha256: sha256,
  clocks: fixture.clocks,
  bodyCount: fixture.bodies.length,
  hullCount: fixture.bodies.reduce((sum, body) => sum + body.hulls.length, 0),
  movingSourceBodies: fixture.bodies.filter((body) =>
    [...body.velocity, ...body.angularVelocity].some((value) => value !== 0),
  ).length,
  limitations: [
    "Snapshot omits hull nativeType, vertexOrder, sphere shape metadata, collision masks and overlap flags; reconstructed hulls use the captured polygon features and admit all body pairs.",
    "Snapshot omits joint limits, translation metadata, immutability certification, world fractions, force history and live physics orchestration; no world contacts, response, integration loop or force update is replayed.",
    "Stationary workload explicitly zeros captured velocities at the same poses; moving workload uses captured linear and angular velocities without invented motion.",
    "Four cold, independently reconstructed guard phases per workload run in ABBA order. Timings include JIT/GC effects and are bounded observations, not a sustained performance benchmark.",
  ],
  variants: Object.fromEntries(
    Object.entries(implementations).map(([name, impl]) => [
      name,
      { root: impl.root },
    ]),
  ),
  workloads: [],
};
for (const stationary of [true, false]) {
  const rows = [];
  for (const variant of ["baseline", "optimized", "optimized", "baseline"]) {
    // Reconstruct separately for every pass; no source vectors, body instances,
    // hierarchy caches or guard caches are shared between variants.
    const { bodies, joints } = reconstruct(stationary);
    const impl = implementations[variant];
    const started = performance.now();
    const phase = impl.createHierarchyMotionPhase(bodies, joints, 0.04);
    const hierarchyMs = performance.now() - started;
    const guard = new impl.BodyTrajectoryGuard();
    const diagnostics = {};
    const guardStart = performance.now();
    const fractions = guard.run(bodies, phase.paths, undefined, diagnostics);
    const guardMs = performance.now() - guardStart;
    const values = bodies.map((body) => fractions.get(body));
    assert.ok(
      values.every(
        (value) => Number.isFinite(value) && value >= 0 && value <= 1,
      ),
      "Invalid guard fraction",
    );
    assert.equal(hash(fixture.bodies), sourceHash, "Source snapshot mutated");
    rows.push({
      pass: rows.length + 1,
      variant,
      hierarchyMs,
      guardMs,
      totalMs: hierarchyMs + guardMs,
      sourceBodiesSha256: sourceHash,
      fractionSha256: hash(values),
      fractions: values,
      diagnostics,
    });
  }
  const baseline = rows.filter((row) => row.variant === "baseline");
  const optimized = rows.filter((row) => row.variant === "optimized");
  const differences = baseline[0].fractions.flatMap((value, index) => {
    const other = optimized[0].fractions[index];
    return value === other
      ? []
      : [
          {
            body: index,
            name: fixture.bodies[index].name,
            baseline: value,
            optimized: other,
            absoluteDifference: Math.abs(value - other),
          },
        ];
  });
  const workload = {
    name: stationary
      ? "stationary-at-captured-poses"
      : "captured-source-velocities",
    rows,
    comparison: {
      sameInput: rows.every((row) => row.sourceBodiesSha256 === sourceHash),
      baselineRepeatExact:
        baseline[0].fractionSha256 === baseline[1].fractionSha256,
      optimizedRepeatExact:
        optimized[0].fractionSha256 === optimized[1].fractionSha256,
      fractionsExact: differences.length === 0,
      differences,
      baselineGuardMs: summarize(baseline.map((row) => row.guardMs)),
      optimizedGuardMs: summarize(optimized.map((row) => row.guardMs)),
    },
  };
  report.workloads.push(workload);
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify(
    {
      output,
      sourceBodiesSha256: sourceHash,
      workloads: report.workloads.map(({ name, comparison, rows }) => ({
        name,
        ...comparison,
        work: rows.map(({ variant, diagnostics }) => ({
          variant,
          ...diagnostics,
        })),
      })),
    },
    null,
    2,
  ),
);
