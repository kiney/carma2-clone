/** One serial comparison of partial captured response orchestration. Run with
 * node --import tsx. No browser, world geometry, forces or DamageSystem replay.
 * Do not interpret cold CPU observations as hardware FPS or a preceding tick.
 */
import { readFile, stat, mkdir, realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { Group } from "three";
import {
  hydrateCapturedBodies,
  capturedBodyIdentifier,
} from "../tests/support/captured-bodies.mjs";
import { VehicleSimulation, PHYSICS_STEP } from "../src/physics/simulation.ts";
import { CorrectionWorkingSet } from "../src/physics/correction-working-set.ts";
import { createHierarchyMotionPhase } from "../src/physics/hierarchy-motion.ts";
import { prepareJointVelocities } from "../src/physics/joint.ts";
import {
  DeferredContactFriction,
  resolveContactGroups,
} from "../src/physics/contact.ts";
import { runLocalResponses } from "../src/physics/local-response.ts";
import { BodyTrajectoryGuard } from "../src/physics/pair-guard.ts";

const { values } = parseArgs({
  options: {
    snapshot: {
      type: "string",
      default: "artifacts/perf01-directional-body-snapshot.json",
    },
    output: {
      type: "string",
      default: "artifacts/perf15-captured-local-responses.json",
    },
    cluster: { type: "string", default: "6,10,11,12,14" },
    "cluster-only": { type: "boolean", default: false },
  },
});
if (!/^\d+(,\d+)*$/.test(values.cluster))
  throw new Error("--cluster needs comma-separated numeric IDs");
const clusterIds = values.cluster.split(",").map(Number);
if (
  clusterIds.length > 32 ||
  clusterIds.some((id) => !Number.isSafeInteger(id)) ||
  new Set(clusterIds).size !== clusterIds.length
)
  throw new Error("Select at most 32 distinct cluster IDs");
const within = (root, path) => {
  const part = relative(root, path);
  return part !== "" && !part.startsWith("..") && !isAbsolute(part);
};
const output = resolve(values.output);
if (!within(resolve("artifacts"), output) && !within("/tmp", output))
  throw new Error(
    "Asset-derived reports must stay in ignored artifacts/ or /tmp/",
  );
const input = resolve(values.snapshot);
if ((await stat(input)).size > 32 * 1024 * 1024)
  throw new Error("Snapshot exceeds 32 MiB");
const sourceText = await readFile(input, "utf8");
const snapshot = JSON.parse(sourceText);
const digest = (text) => createHash("sha256").update(text).digest("hex");
const unchanged = digest(JSON.stringify(snapshot));
const bodyId = capturedBodyIdentifier;
const pairAllowed = (a, b) =>
  (((a.filterA ?? 0) & (b.filterB ?? 0)) |
    ((b.filterA ?? 0) & (a.filterB ?? 0))) ===
  0;
const motion = (body) =>
  Object.fromEntries(
    ["position", "orientation", "velocity", "angularVelocity"].map((key) => [
      key,
      body.state[key].toArray(),
    ]),
  );
const center = (body) =>
  body.properties.centerOfMass
    .clone()
    .applyQuaternion(body.state.orientation)
    .add(body.state.position);
function changed(bodies, before) {
  return bodies.flatMap((body) => {
    const old = before.get(body),
      next = motion(body);
    const fields = Object.keys(next).filter((key) =>
      next[key].some((value, i) => !Object.is(value, old[key][i])),
    );
    return fields.length
      ? [{ id: bodyId(body), fields, before: old, after: next }]
      : [];
  });
}
function contact(impact) {
  return {
    a: bodyId(impact.a),
    b: impact.b ? bodyId(impact.b) : null,
    sourceType: impact.sourceType ?? null,
    point: impact.point.toArray(),
    normal: impact.normal.toArray(),
    normalImpulse: impact.normalImpulse ?? null,
    tangentImpulse: impact.tangentImpulse?.toArray() ?? null,
    solverAccepted: impact.solverAccepted ?? null,
  };
}
function replay(mode) {
  const hydrated = hydrateCapturedBodies(snapshot);
  for (const id of clusterIds)
    if (!hydrated.byId.has(id)) throw new Error(`Cluster body ${id} absent`);
  const selected = new Set(clusterIds.map((id) => hydrated.byId.get(id)));
  const bodies = values["cluster-only"]
    ? hydrated.bodies.filter((body) => selected.has(body))
    : hydrated.bodies;
  const alive = new Set(bodies);
  const joints = hydrated.joints.filter(
    (joint) => alive.has(joint.child) && !joint.child.properties.immovable,
  );
  if (
    joints.some(
      (joint) =>
        joint.parent.capturedId !== undefined && !alive.has(joint.parent),
    )
  )
    throw new Error("Selected cluster cuts an active physical ancestor");
  const sim = new VehicleSimulation(
    {
      raycast: () => {
        throw new Error("Partial replay cannot query world geometry");
      },
      querySurfaces: () => {
        throw new Error("Partial replay cannot collect world faces");
      },
    },
    new Group(),
  );
  const diagnostics = {};
  sim.correctionDiagnostics = diagnostics;
  sim.correctionWorkingSet = sim.correctionGeometry.createTick(diagnostics);
  const inputs = new CorrectionWorkingSet();
  const friction =
    mode === "local-deferred-friction"
      ? new DeferredContactFriction()
      : undefined;
  let phase;
  let predictionCalls = 0,
    pairCollections = 0,
    consideredPairsBodies = 0;
  const worldVisits = new Map(bodies.map((body) => [body, 0]));
  const observations = [];
  const rosterBefore = new Map(bodies.map((body) => [body, motion(body)]));
  const oldCenters = new Map(bodies.map((body) => [body, center(body)]));
  function predict(roster, fresh = true) {
    predictionCalls++;
    if (fresh || !phase)
      phase = createHierarchyMotionPhase(roster, joints, PHYSICS_STEP);
    phase.writeCandidates(roster);
  }
  function pairRows(roster, incident) {
    pairCollections++;
    consideredPairsBodies += incident?.size ?? roster.length;
    return sim.collectBodyContacts(roster, incident);
  }
  function worldRows(body) {
    worldVisits.set(body, worldVisits.get(body) + 1);
    return []; // Explicit no-world provider: counts requests, not triangle work.
  }
  function solve(rows, participatingJoints) {
    const before = new Map(bodies.map((body) => [body, motion(body)]));
    const jointRows = [];
    const impacts = resolveContactGroups(
      rows,
      PHYSICS_STEP,
      participatingJoints,
      (_, responses) => {
        jointRows.push(
          ...responses.map((row) => ({
            child: bodyId(row.a),
            parent: bodyId(row.b),
            sourceType: row.sourceType,
            normalImpulse: row.normalImpulse,
            angular: row.constraint.angular,
            unilateral: row.constraint.unilateral,
          })),
        );
        // Accept native impulse equations on clones. No damage/cap/topology
        // callbacks or native failure-status return can be reconstructed here.
      },
      friction,
    );
    observations.push({
      solve: observations.length + 1,
      contactRows: rows.length,
      rowTypes: rows.reduce((counts, row) => {
        const key = String(row.sourceType ?? "unknown");
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {}),
      participatingBodies: [
        ...new Set(
          rows.flatMap((row) => [
            bodyId(row.a),
            ...(row.b ? [bodyId(row.b)] : []),
          ]),
        ),
      ],
      positiveAcceptedNormals: impacts.filter(
        (row) =>
          row.solverAccepted && row.sourceType !== 9 && row.normalImpulse > 0,
      ).length,
      impacts,
      jointRows,
      changedBodies: changed(bodies, before),
    });
    return {
      impacts,
      rejected: false,
      positiveJointImpulse: jointRows.some(
        (row) => Math.abs(row.normalImpulse) > 0,
      ),
    };
  }
  let aggregate;
  let orchestrationCpuMs, guardCpuMs;
  try {
    for (const body of bodies) body.overlapDetected = false;
    prepareJointVelocities(joints);
    const start = performance.now();
    if (mode === "eight-global-immediate-friction") {
      aggregate = [];
      for (let pass = 0; pass < 8; pass++) {
        predict(bodies);
        for (const body of bodies) worldRows(body);
        const rows = pairRows(bodies);
        if (!rows.length && !joints.length) break;
        aggregate.push(...solve(rows, joints).impacts);
      }
    } else {
      const version = {};
      aggregate = runLocalResponses({
        roster: () => bodies,
        joints: () => joints,
        input: (body) => inputs.responseInput(body),
        worldVersion: () => version,
        predict,
        worldRows,
        pairRows,
        prepare: (rows) => rows,
        solve,
        diagnostics,
      });
    }
    orchestrationCpuMs = performance.now() - start;
    // Both modes replace candidates from the same captured OLD transforms.
    // A fresh final hierarchy phase and identical current pair guard certify
    // normal commitment; all world fractions are explicitly one.
    const final = createHierarchyMotionPhase(bodies, joints, PHYSICS_STEP);
    const guardDiagnostics = {};
    const guardStart = performance.now();
    const fractions = new BodyTrajectoryGuard().run(
      bodies,
      final.paths,
      pairAllowed,
      guardDiagnostics,
    );
    guardCpuMs = performance.now() - guardStart;
    const oldOrientations = new Map(
      bodies.map((body) => [body, body.state.orientation.clone()]),
    );
    final.commit(bodies, fractions);
    if (friction) friction.flush(oldOrientations, (body) => alive.has(body));
    const sourceNormalState = aggregate.map(contact);
    return {
      mode,
      bodies: bodies.length,
      movableBodies: bodies.filter((body) => !body.properties.immovable).length,
      activeJointChildren: joints.map((joint) => bodyId(joint.child)),
      orchestrationCpuMs,
      guardCpuMs,
      counts: {
        predictionCalls,
        pairCollections,
        consideredPairsBodies,
        worldPlaceholderCalls: [...worldVisits.values()].reduce(
          (a, b) => a + b,
          0,
        ),
        responseSolves: observations.length,
      },
      diagnostics,
      worldRequests: bodies.map((body) => ({
        id: bodyId(body),
        cluster: selected.has(body),
        immovable: !!body.properties.immovable,
        calls: worldVisits.get(body),
      })),
      observations: observations.map((record) => ({
        ...record,
        impacts: record.impacts.map(contact),
      })),
      acceptedNormalImpacts: sourceNormalState,
      pairGuard: {
        diagnostics: guardDiagnostics,
        fractions: bodies.map((body) => ({
          id: bodyId(body),
          fraction: fractions.get(body),
        })),
      },
      deferredFriction: friction
        ? {
            queued: friction.queued,
            overflow: friction.overflow,
            applied: friction.applied,
            affectedBodies: [...friction.affectedBodies].map(bodyId),
          }
        : null,
      outcome: bodies.map((body) => ({
        id: bodyId(body),
        cluster: selected.has(body),
        ...motion(body),
        com: center(body).toArray(),
        comDisplacement: center(body).sub(oldCenters.get(body)).length(),
      })),
      changedBodies: changed(bodies, rosterBefore),
      anchorErrors: joints.map((joint) => ({
        child: bodyId(joint.child),
        parent: bodyId(joint.parent),
        error: joint.childAnchor
          .clone()
          .applyQuaternion(joint.child.state.orientation)
          .add(joint.child.state.position)
          .distanceTo(
            joint.parentAnchor
              .clone()
              .applyQuaternion(joint.parent.state.orientation)
              .add(joint.parent.state.position),
          ),
      })),
    };
  } finally {
    sim.dispose();
  }
}
const report = {
  generatedAt: new Date().toISOString(),
  input,
  inputSha256: digest(sourceText),
  capturedEngine: snapshot.engine ?? null,
  capturedElapsed: snapshot.elapsed ?? snapshot.meta?.elapsed ?? null,
  clusterIds,
  rosterPolicy: values["cluster-only"]
    ? "selected cluster only"
    : "complete captured body roster including unrelated and dormant obstacles",
  limitations: [
    "One serial partial comparison, not a whole tick, frame update, preceding user stall or hardware FPS replay.",
    "Only captured rigid motion, hulls, flags, identities and active joints are hydrated. There are no forces, world rows/guards, moving scenery, damage, cap/restart callbacks, effects, quiet gates, registration or PHIL-state reconstruction.",
    "The baseline performs up to eight global body-pair collections/solves with immediate friction. It is a labelled diagnostic adaptation, not the complete former initial solve plus eight correction rounds.",
    "Both modes use fresh native hierarchy prediction from the captured OLD poses and the same current final pair guard. Only the local mode retains deferred friction for post-commit application.",
    "Empty world placeholders measure how many bodies orchestration visits, not actual triangle queries or their CPU cost. Local mode still scans/validates the full roster and discovers neighbors from all obstacles.",
    "Normal/joint equations and accepted impulses run on clones. Native callback outcomes and the separate native failure status cannot be inferred from these snapshots.",
    "Cold/JIT, retained source warming, observer allocations and shared-host scheduling affect CPU durations. No warmup, repeated benchmark or speedup/FPS assertion is made.",
  ],
  variants: [],
};
for (const mode of [
  "eight-global-immediate-friction",
  "local-deferred-friction",
])
  report.variants.push(replay(mode));
if (digest(JSON.stringify(snapshot)) !== unchanged)
  throw new Error("Replay mutated its input capture");

async function projectedRealPath(path) {
  let ancestor = path;
  for (;;) {
    try {
      return resolve(await realpath(ancestor), relative(ancestor, path));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const next = dirname(ancestor);
      if (next === ancestor) throw error;
      ancestor = next;
    }
  }
}
const actualParent = await projectedRealPath(dirname(output));
const artifacts = await projectedRealPath(resolve("artifacts"));
if (
  !within(artifacts, resolve(actualParent, "report.json")) &&
  !within("/tmp", resolve(actualParent, "report.json"))
)
  throw new Error(
    "Report directory symlink escapes ignored artifacts/ or /tmp/",
  );
const originalRoot = await realpath(
  resolve(process.env.CARMA2_ROOT ?? "carma2_orig"),
).catch(() => null);
if (
  originalRoot &&
  (actualParent === originalRoot || within(originalRoot, actualParent))
)
  throw new Error("Original installation is read-only");
await mkdir(dirname(output), { recursive: true });
const file = await open(
  output,
  constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_TRUNC |
    constants.O_NOFOLLOW,
  0o600,
);
try {
  await file.writeFile(JSON.stringify(report, null, 2) + "\n");
} finally {
  await file.close();
}
console.log(
  JSON.stringify({
    output: values.output,
    variants: report.variants.map((variant) => ({
      mode: variant.mode,
      counts: variant.counts,
      diagnostics: variant.diagnostics,
      clusterDisplacement: variant.outcome
        .filter((body) => body.cluster)
        .map((body) => ({ id: body.id, displacement: body.comDisplacement })),
    })),
  }),
);
