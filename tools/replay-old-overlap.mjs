/** Bounded PHY-13 clone diagnostic. Run with node --import tsx.
 * At most eight partial pair/joint integration windows per small selected
 * cluster. No browser, original assets, world queries or complete step replay.
 */
import { readFile, stat, mkdir, realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { Group } from "three";
import {
  hydrateCapturedBodies,
  capturedBodyIdentifier,
} from "../tests/support/captured-bodies.mjs";
import { VehicleSimulation, PHYSICS_STEP } from "../src/physics/simulation.ts";
import { resolveContactGroups } from "../src/physics/contact.ts";
import { prepareJointVelocities } from "../src/physics/joint.ts";
import { createHierarchyMotionPhase } from "../src/physics/hierarchy-motion.ts";
import { BodyTrajectoryGuard } from "../src/physics/pair-guard.ts";

const { values } = parseArgs({
  options: {
    snapshot: { type: "string" },
    ids: { type: "string" },
    case: { type: "string", default: "both" },
    passes: { type: "string", default: "8" },
    baseline: { type: "string" },
    "guard-policy": { type: "string" },
    output: {
      type: "string",
      default: "artifacts/phy13-old-overlap-replay.json",
    },
  },
});
const maximumPasses = Number(values.passes);
if (!Number.isInteger(maximumPasses) || maximumPasses < 1 || maximumPasses > 8)
  throw new Error("--passes must be an integer from 1 to 8");
if (!["player", "cerby", "both"].includes(values.case))
  throw new Error("--case must be player, cerby or both");
const selectedPolicies =
  values["guard-policy"] ?? (values.baseline ? "both" : "current");
if (!["current", "baseline", "both"].includes(selectedPolicies))
  throw new Error("--guard-policy must be current, baseline or both");
if (selectedPolicies !== "current" && !values.baseline)
  throw new Error(
    "A baseline comparison requires --baseline with an explicit local guard module",
  );
const within = (root, path) => {
  const portion = relative(root, path);
  return portion !== "" && !portion.startsWith("..") && !isAbsolute(portion);
};
const output = resolve(values.output);
if (!within(resolve("artifacts"), output) && !within("/tmp", output))
  throw new Error(
    "Asset-derived output must stay in ignored artifacts/ or /tmp/",
  );
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
function ids(text) {
  if (!/^\d+(,\d+)*$/.test(text))
    throw new Error("--ids must list comma-separated numeric IDs");
  const result = text.split(",").map(Number);
  if (
    result.length > 32 ||
    result.some((id) => !Number.isSafeInteger(id)) ||
    new Set(result).size !== result.length
  )
    throw new Error("Select at most 32 distinct safe numeric body IDs");
  return result;
}
const configurations = values.snapshot
  ? [
      {
        name: "selected",
        path: values.snapshot,
        ids: values.ids ? ids(values.ids) : null,
      },
    ]
  : [
      ...(values.case === "cerby"
        ? []
        : [
            {
              name: "player-wing",
              path: "artifacts/perf01-user-stuck-state.json",
              player: true,
            },
          ]),
      ...(values.case === "player"
        ? []
        : [
            {
              name: "cerby-own-debris",
              path: "artifacts/perf01-directional-body-snapshot.json",
              ids: [6, 10, 11, 12, 14],
            },
          ]),
    ];
if (values.ids && !values.snapshot)
  throw new Error("--ids requires --snapshot");
const guardClasses = { current: BodyTrajectoryGuard };
let baselineMetadata;
if (values.baseline) {
  const path = resolve(values.baseline);
  if (!/\.(ts|mjs|js)$/.test(path))
    throw new Error("Baseline must be a local source module");
  const text = await readFile(path, "utf8");
  if (Buffer.byteLength(text) > 1024 * 1024)
    throw new Error("Baseline module exceeds the bounded source size");
  const imported = await import(pathToFileURL(path).href);
  if (typeof imported.BodyTrajectoryGuard !== "function")
    throw new Error("Baseline must export BodyTrajectoryGuard");
  guardClasses.baseline = imported.BodyTrajectoryGuard;
  baselineMetadata = { path, sha256: sha256(text) };
}
const policies =
  selectedPolicies === "both" ? ["baseline", "current"] : [selectedPolicies];
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
const com = (body, pose = body.state) =>
  body.properties.centerOfMass
    .clone()
    .applyQuaternion(pose.orientation)
    .add(pose.position);
const worldAnchor = (pose, local) =>
  local.clone().applyQuaternion(pose.orientation).add(pose.position);
function anchorErrors(joints, phase, fraction = 1) {
  return joints.map((joint) => {
    const childPose = phase
      ? phase.pose(joint.child, fraction)
      : joint.child.state;
    const parentPose = phase
      ? phase.pose(joint.parent, fraction)
      : joint.parent.state;
    const delta = worldAnchor(childPose, joint.childAnchor).sub(
      worldAnchor(parentPose, joint.parentAnchor),
    );
    if (joint.type === "translation") {
      const axis = joint.translationAxis
        .clone()
        .applyQuaternion(joint.child.state.orientation);
      delta.addScaledVector(axis, -delta.dot(axis));
    }
    return {
      child: capturedBodyIdentifier(joint.child),
      parent: capturedBodyIdentifier(joint.parent),
      type: joint.type,
      error: delta.length(),
      delta: delta.toArray(),
    };
  });
}
function changes(bodies, before) {
  return bodies.flatMap((body) => {
    const old = before.get(body),
      after = motion(body);
    const changed = Object.keys(old).filter((key) =>
      old[key].some((value, i) => !Object.is(value, after[key][i])),
    );
    return changed.length
      ? [{ id: capturedBodyIdentifier(body), changed, before: old, after }]
      : [];
  });
}
function row(contact) {
  return {
    a: capturedBodyIdentifier(contact.a),
    b: contact.b ? capturedBodyIdentifier(contact.b) : null,
    sourceType: contact.sourceType ?? null,
    point: contact.point.toArray(),
    pointB: contact.pointB?.toArray(),
    normal: contact.normal.toArray(),
    penetration: contact.penetration ?? null,
  };
}
function choose(hydrated, configuration, snapshot) {
  let requested = configuration.ids;
  if (configuration.player) {
    const wing = hydrated.bodies.find(
      (body) =>
        body.owner?.capturedId === snapshot.playerId &&
        /EIIIFRWG/i.test(body.capturedName ?? ""),
    );
    if (!wing)
      throw new Error(
        "Default player capture lacks its reported fully detached front-right wing",
      );
    requested = [snapshot.playerId, wing.capturedId];
  }
  if (!requested) {
    if (hydrated.bodies.length > 32)
      throw new Error(
        "Larger custom snapshots require explicit --ids; whole-population replay is disabled",
      );
    requested = hydrated.identifiers;
  }
  const selected = new Set(
    requested.map((id) => {
      const body = hydrated.byId.get(id);
      if (!body) throw new Error(`Unknown selected captured ID ${id}`);
      return body;
    }),
  );
  // Include actual captured ancestors rather than replacing a cut physical
  // dependency with a fabricated fixed body. Logical owners are not ancestry.
  for (const body of selected)
    if (body.joint?.parent.capturedId !== undefined)
      selected.add(body.joint.parent);
  if (selected.size > 32)
    throw new Error("Selected ancestry exceeds the 32-body replay limit");
  return hydrated.bodies.filter((body) => selected.has(body));
}
function replay(snapshot, configuration, commitPolicy) {
  const hydrated = hydrateCapturedBodies(snapshot);
  const bodies = choose(hydrated, configuration, snapshot);
  const selected = new Set(bodies);
  const joints = hydrated.joints.filter(
    (joint) => selected.has(joint.child) && !joint.child.properties.immovable,
  );
  const sim = new VehicleSimulation(
    {
      raycast: () => {
        throw new Error("Replay must not query the world");
      },
      querySurfaces: () => {
        throw new Error("Replay must not collect world geometry");
      },
    },
    new Group(),
  );
  const guards = Object.fromEntries(
    Object.entries(guardClasses).map(([name, Class]) => [name, new Class()]),
  );
  const passes = [];
  try {
    for (let pass = 1; pass <= maximumPasses; pass++) {
      const start = performance.now();
      const before = new Map(bodies.map((body) => [body, motion(body)]));
      const oldCOM = new Map(bodies.map((body) => [body, com(body)]));
      const beforeAnchors = anchorErrors(joints);
      const preparationStart = performance.now();
      prepareJointVelocities(joints);
      const preparationCpuMs = performance.now() - preparationStart;
      const preparationChanges = changes(bodies, before);
      for (const body of bodies) body.overlapDetected = false;
      const predictionStart = performance.now();
      const incoming = createHierarchyMotionPhase(bodies, joints, PHYSICS_STEP);
      incoming.writeCandidates(bodies);
      const predictionCpuMs = performance.now() - predictionStart;
      const collectStart = performance.now();
      // Fresh raw collection avoids dependent-trajectory cache assumptions.
      sim.correctionWorkingSet = undefined;
      const contacts = sim.collectBodyContacts(bodies);
      const collectionCpuMs = performance.now() - collectStart;
      const beforeSolve = new Map(bodies.map((body) => [body, motion(body)]));
      const groups = [];
      const solveStart = performance.now();
      const impacts = resolveContactGroups(
        contacts,
        PHYSICS_STEP,
        joints,
        (contactImpacts, jointImpacts) => {
          groups.push({
            contactRows: contactImpacts.length,
            jointRows: jointImpacts.map((impact) => ({
              child: capturedBodyIdentifier(impact.a),
              parent: capturedBodyIdentifier(impact.b),
              sourceType: impact.sourceType,
              normalImpulse: impact.normalImpulse,
              closingSpeed: impact.closingSpeed,
              angular: impact.constraint.angular,
              unilateral: impact.constraint.unilateral,
            })),
          });
          // Accept ordinary impulses on clones; no damage/effect callback replay.
        },
      );
      const solverCpuMs = performance.now() - solveStart;
      const solveChanges = changes(bodies, beforeSolve);
      const outgoing = createHierarchyMotionPhase(bodies, joints, PHYSICS_STEP);
      const results = {};
      const fractions = {};
      for (const [policy, guard] of Object.entries(guards)) {
        const diagnostics = {};
        const guardStart = performance.now();
        const limits = guard.run(
          bodies,
          outgoing.paths,
          pairAllowed,
          diagnostics,
        );
        fractions[policy] = limits;
        results[policy] = {
          cpuMs: performance.now() - guardStart,
          diagnostics,
          fractions: bodies.map((body) => ({
            id: body.capturedId,
            fraction: limits.get(body),
          })),
        };
      }
      const candidateAnchors = anchorErrors(joints, outgoing);
      const candidateCOM = bodies.map((body) => ({
        id: body.capturedId,
        com: com(body, outgoing.pose(body, 1)).toArray(),
      }));
      outgoing.commit(bodies, fractions[commitPolicy]);
      for (const body of bodies) body.overlapRecovery = body.overlapDetected;
      passes.push({
        pass,
        cpuMs: performance.now() - start,
        preparationCpuMs,
        predictionCpuMs,
        collectionCpuMs,
        solverCpuMs,
        preparationChanges,
        solveChanges,
        rows: contacts.map(row),
        rowTypes: contacts.reduce((counts, contact) => {
          const key = String(contact.sourceType ?? "unknown");
          counts[key] = (counts[key] ?? 0) + 1;
          return counts;
        }, {}),
        impacts: impacts.map((impact) => ({
          ...row(impact),
          normalImpulse: impact.normalImpulse,
          closingSpeed: impact.closingSpeed,
          tangentImpulse: impact.tangentImpulse.toArray(),
          solverAccepted: impact.solverAccepted,
        })),
        groups,
        guards: results,
        guardEvaluationOrder: Object.keys(guards),
        beforeAnchors,
        candidateAnchors,
        committedAnchors: anchorErrors(joints),
        candidateCOM,
        committedBodies: bodies.map((body) => ({
          id: body.capturedId,
          ...motion(body),
          com: com(body).toArray(),
          comDisplacement: com(body).sub(oldCOM.get(body)).length(),
          overlapRecovery: body.overlapRecovery,
          overlapDetected: body.overlapDetected,
        })),
      });
    }
    return {
      commitPolicy,
      selected: bodies.map((body) => ({
        id: body.capturedId,
        name: body.capturedName,
        type: body.capturedType,
        owner: body.owner ? capturedBodyIdentifier(body.owner) : null,
      })),
      activeJoints: joints.map((joint) => ({
        child: capturedBodyIdentifier(joint.child),
        parent: capturedBodyIdentifier(joint.parent),
        type: joint.type,
      })),
      passes,
    };
  } finally {
    sim.dispose();
  }
}
const report = {
  capturedAt: new Date().toISOString(),
  maximumPasses,
  stepSeconds: PHYSICS_STEP,
  baseline: baselineMetadata ?? null,
  limitations: [
    "Partial cloned integration windows start from paused post-tick captures, not a restored preceding tick.",
    "One preparation and one native pair/joint solve per window; source correction retries, world contacts/guards, forces, damage, detachment, split, repair, effects and activation are omitted.",
    "Current and baseline guards inspect the SAME fresh post-solve hierarchy paths within each window. Separate commit-policy variants diverge after their first different commitment.",
    "Captured identity, recovery flags, authored hulls and properties are retained. Shared state identity and unrecorded moving external endpoints cannot be inferred.",
    "World fractions are 1. Commitment includes physical-tree shared temporal caps; baseline comparison changes guard policy, not native hierarchy movement.",
    "At most eight serial windows per small selected cluster/policy, with no warmup or sustained benchmark. CPU contains cold/JIT/observer/host noise; no FPS claim.",
    "Guard evaluation order is recorded. The second policy reuses phase pose samples warmed by the first; timings are not a matched speedup measurement.",
  ],
  cases: [],
};
for (const configuration of configurations) {
  const input = resolve(configuration.path);
  if ((await stat(input)).size > 32 * 1024 * 1024)
    throw new Error("Snapshot exceeds the 32 MiB diagnostic limit");
  const text = await readFile(input, "utf8");
  const snapshot = JSON.parse(text);
  const originalDigest = sha256(JSON.stringify(snapshot));
  const result = {
    name: configuration.name,
    input,
    inputSha256: sha256(text),
    elapsed: snapshot.elapsed ?? snapshot.meta?.elapsed ?? null,
    variants: policies.map((policy) => replay(snapshot, configuration, policy)),
  };
  if (sha256(JSON.stringify(snapshot)) !== originalDigest)
    throw new Error("Replay mutated its input capture");
  report.cases.push(result);
}
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
// Validate the existing ancestor before creating missing output directories:
// even a mkdir through an ignored-directory symlink must not touch originals.
const actualParent = await projectedRealPath(dirname(output));
const actualArtifacts = await projectedRealPath(resolve("artifacts"));
if (
  !within(actualArtifacts, resolve(actualParent, "report.json")) &&
  !within("/tmp", resolve(actualParent, "report.json"))
)
  throw new Error(
    "Output directory symlink escapes ignored artifacts/ or /tmp/",
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
    cases: report.cases.map((entry) => ({
      name: entry.name,
      variants: entry.variants.map((variant) => ({
        policy: variant.commitPolicy,
        bodies: variant.selected.length,
        windows: variant.passes.length,
        initialFractions:
          variant.passes[0]?.guards[variant.commitPolicy].fractions,
        finalDisplacements: variant.passes
          .at(-1)
          ?.committedBodies.map((body) => ({
            id: body.id,
            comDisplacement: body.comDisplacement,
          })),
      })),
    })),
  }),
);
