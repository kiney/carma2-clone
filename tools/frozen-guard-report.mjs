/** Short serial differential guard check from an ignored local body snapshot.
 * No game/simulation stepping. Requires node --import tsx. Not a FPS benchmark.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";
import { Vector3, Quaternion } from "three";
import { BodyTrajectoryGuard } from "../src/physics/pair-guard.ts";
import { advanceRigidBody } from "../src/physics/integrate.ts";
import { sealCollisionHulls } from "../src/physics/immutable-hulls.ts";

const { values } = parseArgs({
  options: {
    snapshot: {
      type: "string",
      default: "artifacts/perf01-directional-body-snapshot.json",
    },
    baseline: { type: "string" },
    output: { type: "string", default: "artifacts/perf13-frozen-guards.json" },
  },
});
if (!values.baseline)
  throw new Error(
    "--baseline needs an isolated source checkout, not original game binaries",
  );
const snapshot = JSON.parse(await readFile(values.snapshot, "utf8"));
if (!Array.isArray(snapshot.bodies) || snapshot.bodies.length > 8192)
  throw new Error("Invalid bounded body snapshot");
const baseline = await import(
  pathToFileURL(resolve(values.baseline, "src/physics/pair-guard.ts")).href
);
const vector = (x) => new Vector3(...x),
  quaternion = (x) => new Quaternion(...x);
function bodiesFromSnapshot(immutable = false) {
  const bodies = snapshot.bodies.map((row) => ({
    ...row.flags,
    properties: {
      ...row.properties,
      inertia: vector(row.properties.inertia),
      centerOfMass: vector(row.properties.centerOfMass),
    },
    state: {
      ...row.state,
      position: vector(row.state.position),
      orientation: quaternion(row.state.orientation),
      velocity: vector(row.state.velocity),
      angularVelocity: vector(row.state.angularVelocity),
      predictedPosition: vector(row.state.position),
      predictedOrientation: quaternion(row.state.orientation),
    },
    hulls: row.hulls.map((h) => ({
      ...h,
      vertices: h.vertices.map(vector),
      faces: h.faces.map((f) => ({ ...f, normal: vector(f.normal) })),
    })),
  }));
  for (let i = 0; i < bodies.length; i++) {
    const row = snapshot.bodies[i];
    if (immutable && (row.type === "noncar" || row.kind === "noncar"))
      sealCollisionHulls(bodies[i].hulls);
    if (row.owner >= 0) bodies[i].owner = bodies[row.owner];
    if (row.joint)
      bodies[i].joint = {
        ...row.joint,
        // The native NONCAR constructor gives each object a private anchor.
        // A shared fallback would invent ~29k static attachment relations.
        parent: bodies[row.joint.parent] ?? {
          state: { position: new Vector3(), orientation: new Quaternion() },
          properties: { immovable: true },
        },
        child: bodies[row.joint.child] ?? bodies[i],
      };
  }
  return bodies;
}
function pathsFor(bodies) {
  return new Map(
    bodies.map((body) => {
      const cache = new Map();
      const path = (t) => {
        let value = cache.get(t);
        if (value) return value;
        if (body.properties.immovable)
          value = {
            position: body.state.position.clone(),
            orientation: body.state.orientation.clone(),
          };
        else {
          advanceRigidBody(body, 0.04 * t, true);
          value = {
            position: body.state.predictedPosition.clone(),
            orientation: body.state.predictedOrientation.clone(),
          };
        }
        cache.set(t, value);
        return value;
      };
      path.stable = true;
      if (body.properties.immovable) path.constantPose = path(0);
      const inertia = body.properties.inertia;
      path.angularTravel =
        body.properties.immovable || body.properties.rotationLocked
          ? 0
          : (body.state.angularVelocity
              .clone()
              .applyQuaternion(body.state.orientation.clone().invert())
              .multiply(inertia)
              .length() /
              Math.min(inertia.x, inertia.y, inertia.z)) *
            0.04;
      return [body, path];
    }),
  );
}
const allowed = (a, b) => {
  const maskA = (a.filterA ?? 0) & (b.filterB ?? 0);
  const maskB = (b.filterA ?? 0) & (a.filterB ?? 0);
  return (maskA | maskB) === 0;
};
const samples = [];
const modes = {
  baseline: {
    bodies: bodiesFromSnapshot(),
    guard: new baseline.BodyTrajectoryGuard(),
  },
  optimized: {
    bodies: bodiesFromSnapshot(true),
    guard: new BodyTrajectoryGuard(),
  },
};
for (const name of ["baseline", "optimized", "optimized", "baseline"]) {
  const { bodies, guard } = modes[name],
    paths = pathsFor(bodies),
    diagnostics = {};
  const start = performance.now(),
    fractions = guard.run(bodies, paths, allowed, diagnostics),
    cpuMs = performance.now() - start;
  samples.push({
    name,
    cpuMs,
    diagnostics,
    fractions: bodies.map((b) => fractions.get(b)),
  });
}
for (const sample of samples)
  assert.deepEqual(
    sample.fractions,
    samples[0].fractions,
    "Guard fractions changed",
  );
const report = {
  note: "Four short serial full-40ms next-trajectory guard calls; each mode retains its own body/guard identities, cold/JIT effects retained. External NONCAR anchors are synthesized separately per built-in constructor. Optimized NONCAR geometry is sealed as in the loader. No world-fraction clipping, forces, correction or frame/GPU workload. Not a full-tick replay or FPS benchmark.",
  snapshot: values.snapshot,
  elapsed: snapshot.elapsed,
  bodies: snapshot.bodies.length,
  samples,
  exact: true,
};
await mkdir(dirname(values.output), { recursive: true });
await writeFile(values.output, JSON.stringify(report, null, 2));
console.log(
  JSON.stringify({
    bodies: report.bodies,
    exact: true,
    samples: samples.map(({ name, cpuMs, diagnostics }) => ({
      name,
      cpuMs,
      pairs: diagnostics.pairs,
      transforms: diagnostics.hullTransforms,
    })),
    output: values.output,
  }),
);
