import type { RigidBody, ContactImpact, Contact } from "./contact";
import { buildJointConstraints, type RigidJoint } from "./joint";

export interface LocalResponseDiagnostics {
  localCollections?: number;
  responseSolves?: number;
  retryRounds?: number;
  traversalRestarts?: number;
  consideredBodies?: number;
  activeRoots?: number;
  inputScans?: number;
  responseChangedBodies?: number;
  retryExhaustions?: number;
  normalResponseSolves?: number;
  jointResponseSolves?: number;
  zeroResponseSolves?: number;
}
export interface ResponseResult {
  impacts: ContactImpact[];
  rejected: boolean;
  positiveJointImpulse: boolean;
  /** Native report/failure status, not an ordinary positive lambda. */
  reportedFailure?: boolean;
}
export type LocalResponseTrace<Body extends RigidBody> =
  | {
      phase: "collection";
      seed: Body;
      batch: readonly Body[];
      ringSize: number;
      attempt: number;
    }
  | {
      phase: "response";
      seed: Body;
      changed: readonly Body[];
      ringSize: number;
      attempt: number;
      positiveNormal: boolean;
      positiveJoint: boolean;
      rejected: boolean;
      worldChanged: boolean;
      rosterChanged: boolean;
    };
export interface LocalResponseHost<Body extends RigidBody> {
  roster(): Body[];
  joints(): RigidJoint[];
  input(body: Body): object;
  worldVersion(): unknown;
  /** Optional producer protocol: advances for every input/roster mutation in
   * world collection. Unknown providers omit it and retain full inspection. */
  worldCollectionVersion?(): unknown;
  emptyPreparationIsPure?: boolean;
  predict(roster: Body[], changed: boolean): void;
  worldRows(body: Body): readonly Contact[];
  pairRows(
    roster: Body[],
    incident: ReadonlySet<Body>,
    alreadyCollected?: ReadonlyMap<RigidBody, ReadonlySet<RigidBody>>,
  ): Contact[];
  prepare(rows: Contact[]): Contact[];
  solve(rows: Contact[], joints: RigidJoint[]): ResponseResult;
  diagnostics?: LocalResponseDiagnostics;
  trace?(event: LocalResponseTrace<Body>): void;
}

/** Native-informed OLD-X traversal and persistent geometry response rings.
 * Reintegrations replace candidates from OLD; they never advance the clock.
 * Global changes revisit traversal, while ordinary response retries stay local.
 * Native failure status is separate from successful impulses. */
export function runLocalResponses<Body extends RigidBody>(
  host: LocalResponseHost<Body>,
): ContactImpact[] {
  const count = (key: keyof LocalResponseDiagnostics, n = 1) => {
    if (host.diagnostics)
      host.diagnostics[key] = (host.diagnostics[key] ?? 0) + n;
  };
  const membership = new Map<RigidBody, Set<Body>>();
  const pending = new Set<Body>();
  const admitted = new Set<RigidBody>();
  const oldX = new Map<RigidBody, number>();
  let roster: Body[] = [],
    joints: RigidJoint[] = [],
    version: unknown;
  let inputs = new Map<Body, object>(),
    predictionChanged = true;
  const impacts: ContactImpact[] = [];
  const join = (a: RigidBody, b: RigidBody): boolean => {
    const aa = membership.get(a),
      bb = membership.get(b);
    if (!aa || !bb || aa === bb) return false;
    for (const member of bb) {
      aa.add(member);
      membership.set(member, aa);
    }
    return true;
  };
  const refresh = (initial = false) => {
    const next = host.roster();
    const alive = new Set(next);
    const changed = new Set<Body>();
    const rosterChanged =
      next.length !== roster.length ||
      next.some((body, i) => body !== roster[i]);
    for (const body of roster)
      if (!alive.has(body)) {
        membership.get(body)?.delete(body);
        membership.delete(body);
        pending.delete(body);
      }
    const states = new Map<RigidBody["state"], Body>();
    const nextInputs = new Map<Body, object>();
    for (const body of next) {
      if (!membership.has(body)) {
        membership.set(body, new Set([body]));
        admitted.add(body);
        oldX.set(body, body.state.position.x);
        if (!body.properties.immovable) pending.add(body);
      }
      const previous = states.get(body.state);
      if (previous) join(previous, body);
      else states.set(body.state, body);
      const token = host.input(body);
      nextInputs.set(body, token);
      if (inputs.get(body) !== token) changed.add(body);
    }
    joints = host.joints();
    // External fixed anchors are distinct constructor identities; they do not
    // unite all world contacts. Multiple children of one anchor share a tree.
    const external = new Map<RigidBody, Body>();
    for (const joint of joints) {
      if (membership.has(joint.parent)) join(joint.parent, joint.child);
      else {
        const prior = external.get(joint.parent);
        if (prior) join(prior, joint.child);
        else external.set(joint.parent, joint.child as Body);
      }
    }
    const nextVersion = host.worldVersion();
    // A moved fixed body can introduce contacts outside the current ring.
    // Rare fixed-provider edits use the conservative traversal restart.
    const worldChanged =
      !initial &&
      (!Object.is(version, nextVersion) ||
        [...changed].some((body) => body.properties.immovable));
    if (worldChanged) {
      count("traversalRestarts");
      for (const body of next)
        if (!body.properties.immovable) pending.add(body);
    }
    for (const body of changed) {
      if (!initial && !body.properties.immovable) {
        pending.add(body);
      }
    }
    count("inputScans");
    if (!initial) count("responseChangedBodies", changed.size);
    predictionChanged ||=
      initial || rosterChanged || changed.size > 0 || worldChanged;
    inputs = nextInputs;
    roster = next;
    version = nextVersion;
    return { changed, rosterChanged, worldChanged };
  };
  refresh(true);
  count(
    "activeRoots",
    new Set([...pending].map((b) => membership.get(b))).size,
  );
  // Counts belong to a seed's entire tick, including conditional restarts;
  // this is a bounded browser adaptation of native local/traversal loops.
  const attempts = new Map<Body, number>();
  while (pending.size) {
    const root = (body: RigidBody): RigidBody => {
      const visited = new Set<RigidBody>();
      while (!visited.has(body)) {
        visited.add(body);
        const parent = joints.find((joint) => joint.child === body)?.parent;
        if (!parent) break;
        body = parent;
      }
      return body;
    };
    const seed = [...pending]
      .filter((body) => membership.has(body) && !body.properties.immovable)
      .sort((a, b) => {
        const aa = root(a),
          bb = root(b);
        return (
          (oldX.get(aa) ?? aa.state.position.x) -
            (oldX.get(bb) ?? bb.state.position.x) ||
          roster.indexOf(aa as Body) - roster.indexOf(bb as Body)
        );
      })[0];
    if (!seed) break;
    let failures = 0;
    for (;;) {
      const used = attempts.get(seed) ?? 0;
      if (used >= 30 || failures >= 3) {
        count("retryExhaustions");
        break;
      }
      attempts.set(seed, used + 1);
      if (used) count("retryRounds");
      host.predict(roster, predictionChanged);
      predictionChanged = false;
      let rows: Contact[] = [];
      let collectionStable = false;
      // Collection can wake, pull or register bodies. Discard stale geometry
      // after such a barrier and reclose the ring against the fresh roster.
      // Recollection consumes the same local budget as response reintegration.
      while (!collectionStable) {
        const collected = new Set<Body>();
        const pairKeys = new Map<RigidBody, Set<RigidBody>>();
        rows = [];
        collectionStable = true;
        for (;;) {
          const ring = membership.get(seed);
          if (!ring) break;
          const batch = [...ring].filter((body) => !collected.has(body));
          if (!batch.length) break;
          count("localCollections");
          count("consideredBodies", batch.length);
          host.trace?.({
            phase: "collection",
            seed,
            batch,
            ringSize: ring.size,
            attempt: attempts.get(seed) ?? 0,
          });
          const collectionVersion = host.worldCollectionVersion?.();
          const world: Contact[] = [];
          for (const body of batch) {
            collected.add(body);
            if (!body.properties.immovable) world.push(...host.worldRows(body));
          }
          // ACT-pull admission is visible to pairs in this same collection.
          let changes =
            host.worldCollectionVersion &&
            Object.is(collectionVersion, host.worldCollectionVersion())
              ? {
                  changed: new Set<Body>(),
                  rosterChanged: false,
                  worldChanged: false,
                }
              : refresh();
          if (
            changes.rosterChanged ||
            changes.changed.size ||
            changes.worldChanged
          ) {
            collectionStable = false;
            break;
          }
          const discoveries = host.pairRows(roster, new Set(batch), pairKeys);
          for (const row of discoveries)
            if (!pairKeys.has(row.a)) pairKeys.set(row.a, new Set());
          const fresh = discoveries.filter(
            (row) => !pairKeys.get(row.a)!.has(row.b!),
          );
          for (const row of discoveries) pairKeys.get(row.a)!.add(row.b!);
          const preparationRows = [...world, ...fresh];
          const prepared = host.prepare(preparationRows);
          for (const row of prepared) if (row.b) join(row.a, row.b);
          rows.push(...prepared);
          if (
            host.emptyPreparationIsPure &&
            !preparationRows.length &&
            !prepared.length
          )
            continue;
          changes = refresh();
          if (
            changes.rosterChanged ||
            changes.changed.size ||
            changes.worldChanged
          ) {
            collectionStable = false;
            break;
          }
        }
        if (!collectionStable) {
          const consumed = attempts.get(seed) ?? 0;
          if (consumed >= 30) {
            count("retryExhaustions");
            break;
          }
          attempts.set(seed, consumed + 1);
          count("retryRounds");
          host.predict(roster, predictionChanged);
          predictionChanged = false;
        }
      }
      const ring = membership.get(seed);
      if (!ring || !collectionStable) break;
      // A removed registered body must not become an external world anchor.
      const alive = new Set(roster);
      rows = rows.filter(
        (row) =>
          alive.has(row.a as Body) &&
          (!row.b || !admitted.has(row.b) || alive.has(row.b as Body)),
      );
      const ringJoints = joints.filter((joint) =>
        ring.has(joint.child as Body),
      );
      // Installed4bafb8 exits BEFORE collecting bilateral +218 rows. Only
      // emitted geometry or an active authored unilateral limit starts a
      // response; anchor/hinge residuals alone are not collision retries.
      if (
        !rows.length &&
        !buildJointConstraints(ringJoints).some((row) => row.unilateral)
      )
        break;
      count("responseSolves");
      const result = host.solve(rows, ringJoints);
      impacts.push(...result.impacts);
      if (result.reportedFailure) failures++;
      const change = refresh();
      const current = membership.get(seed);
      const localChanged = [...change.changed].some((body) =>
        current?.has(body),
      );
      const positiveNormal = result.impacts.some(
        (row) =>
          row.solverAccepted && row.sourceType !== 9 && row.normalImpulse > 0,
      );
      host.trace?.({
        phase: "response",
        seed,
        changed: [...change.changed],
        ringSize: current?.size ?? 0,
        attempt: attempts.get(seed) ?? 0,
        positiveNormal,
        positiveJoint: result.positiveJointImpulse,
        rejected: result.rejected,
        worldChanged: change.worldChanged,
        rosterChanged: change.rosterChanged,
      });
      if (positiveNormal) count("normalResponseSolves");
      if (result.positiveJointImpulse) count("jointResponseSolves");
      if (!positiveNormal && !result.positiveJointImpulse)
        count("zeroResponseSolves");
      const positive =
        result.positiveJointImpulse ||
        result.impacts.some(
          (row) =>
            row.solverAccepted && row.sourceType !== 9 && row.normalImpulse > 0,
        );
      // Exact zero-response fixed point avoids repeating joint-only callbacks.
      // Accepted positive stresses/restarts never use this early termination.
      if (
        !result.rejected &&
        !positive &&
        !localChanged &&
        !change.worldChanged &&
        !change.rosterChanged
      )
        break;
      // Even after an accepted solve whose normal values happen to cancel,
      // repeated positive stresses remain subject to native local retry budget.
    }
    const completed = membership.get(seed);
    if (completed) for (const body of completed) pending.delete(body);
  }
  return impacts;
}
