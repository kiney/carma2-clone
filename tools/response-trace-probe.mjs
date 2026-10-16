/** Install bounded, high-overhead local-response state tracing in a browser.
 * This diagnostic is not suitable for FPS comparisons.
 */
export function installResponseTraceProbe({
  maxEvents = 512,
  maxRows = 4096,
} = {}) {
  if (!Number.isInteger(maxEvents) || maxEvents < 1 || maxEvents > 512)
    throw new Error("Response trace maxEvents must be 1–512");
  if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > 4096)
    throw new Error("Response trace maxRows must be 1–4096");
  window.__perfResponseTraceProbe?.dispose?.();
  const c = window.carma,
    sim = c?.simulation;
  if (!sim || typeof sim.allBodies !== "function")
    throw new Error("A loaded simulation is required for response tracing");
  const bodyIds = new WeakMap(),
    hullIds = new WeakMap(),
    jointIds = new WeakMap(),
    events = [],
    rows = [],
    geometryCounts = new Map(),
    impulseCounts = new Map(),
    rowKeys = { geometryRepeats: 0, impulseRepeats: 0 },
    originals = {
      trace: sim.onLocalResponseTrace,
      process: sim.processImpactDamage,
      traceOwn: Object.prototype.hasOwnProperty.call(
        sim,
        "onLocalResponseTrace",
      ),
      traceDescriptor: Object.getOwnPropertyDescriptor(
        sim,
        "onLocalResponseTrace",
      ),
      processOwn: Object.prototype.hasOwnProperty.call(
        sim,
        "processImpactDamage",
      ),
      processDescriptor: Object.getOwnPropertyDescriptor(
        sim,
        "processImpactDamage",
      ),
    };
  if (typeof originals.process !== "function")
    throw new Error("Simulation processImpactDamage is unavailable");
  let nextBodyId = 1,
    nextHullId = 1,
    nextJointId = 1,
    currentAttempt = null,
    collectionState = null,
    seedState = null,
    stopped = false,
    droppedEvents = 0,
    droppedRows = 0,
    diagnosticErrors = 0,
    eventSequence = 0;
  const idFor = (map, value, next) => {
    if (!value || (typeof value !== "object" && typeof value !== "function"))
      return null;
    let id = map.get(value);
    if (id === undefined) {
      id = next();
      map.set(value, id);
    }
    return id;
  };
  const bodyId = (body) => idFor(bodyIds, body, () => nextBodyId++);
  const hullId = (hull) => idFor(hullIds, hull, () => nextHullId++);
  const jointId = (joint) => idFor(jointIds, joint, () => nextJointId++);
  const vector = (value) => {
    if (!value) return null;
    if (typeof value.toArray === "function") return value.toArray();
    if (["x", "y", "z"].every((key) => Number.isFinite(value[key])))
      return [value.x, value.y, value.z];
    return null;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const nameOf = (body) =>
    body?.group?.name ?? body?.actor?.name ?? body?.name ?? "";
  const pushEvent = (event) => {
    if (events.length >= maxEvents) {
      droppedEvents++;
      return;
    }
    events.push({ sequence: eventSequence++, ...event });
  };
  const coordinateHash = (hull, limit) => {
    let hash = 0x811c9dc5,
      count = 0;
    const mix = (value) => {
      const text = `${String(value)};`;
      for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
    };
    for (const vertex of hull.vertices ?? []) {
      if (count + 3 > limit) break;
      mix(vertex.x);
      mix(vertex.y);
      mix(vertex.z);
      count += 3;
    }
    return {
      hash: hash.toString(16).padStart(8, "0"),
      coordinates: count,
      truncated: (hull.vertices?.length ?? 0) * 3 > count,
    };
  };
  const snapshotBody = (body) => {
    let coordinateBudget = 4096;
    const hulls = (body.hulls ?? []).slice(0, 128).map((hull) => {
      const coordinates = coordinateHash(hull, coordinateBudget);
      coordinateBudget -= coordinates.coordinates;
      const candidateRevision =
        hull.geometryRevision ??
        hull.shapeRevision ??
        hull.revision ??
        body.geometryRevision ??
        body.shapeRevision ??
        null;
      return {
        id: hullId(hull),
        revision:
          candidateRevision == null ||
          ["number", "string", "boolean"].includes(typeof candidateRevision)
            ? candidateRevision
            : null,
        vertexCount: hull.vertices?.length ?? 0,
        faceCount: hull.faces?.length ?? 0,
        coordinates,
      };
    });
    const joint = body.joint;
    return {
      id: bodyId(body),
      name: nameOf(body),
      kind: body.kind ?? (body.damage ? "car" : "body"),
      pose: {
        position: vector(body.state?.position),
        orientation: vector(body.state?.orientation),
      },
      velocity: vector(body.state?.velocity),
      angularVelocity: vector(body.state?.angularVelocity),
      mass: body.properties?.mass ?? null,
      inertia: vector(body.properties?.inertia),
      centerOfMass: vector(body.properties?.centerOfMass),
      hulls,
      hullsTruncated: (body.hulls?.length ?? 0) > hulls.length,
      joint: joint
        ? {
            id: jointId(joint),
            type: joint.type ?? null,
            parentId: bodyId(joint.parent),
            childId: bodyId(joint.child),
            parentAnchor: vector(joint.parentAnchor),
            childAnchor: vector(joint.childAnchor),
            parentAxis: vector(joint.parentAxis),
            childAxis: vector(joint.childAxis),
          }
        : null,
      damage: body.damage?.componentLevels
        ? Array.from(body.damage.componentLevels)
        : null,
      quiet: {
        immovable: body.properties?.immovable ?? false,
        quietState:
          typeof body.quietState?.quietState === "number" ||
          typeof body.quietState?.quietState === "boolean"
            ? body.quietState.quietState
            : typeof body.quietState === "number" ||
                typeof body.quietState === "boolean"
              ? body.quietState
              : null,
        doNothing: body.quietState?.doNothing ?? body.doNothing ?? null,
        sleeping: body.motor?.sleeping ?? null,
      },
    };
  };
  const snapshotRoster = () => {
    const all = sim.allBodies(),
      limit = Math.min(all.length, 2048),
      states = new Map();
    for (let i = 0; i < limit; i++) {
      const state = snapshotBody(all[i]);
      states.set(state.id, state);
    }
    return { states, bodyCount: all.length, truncated: all.length > limit };
  };
  const snapshotSelected = (bodies) => {
    const unique = new Map();
    for (const body of bodies) {
      if (!body || unique.size >= 128) continue;
      unique.set(bodyId(body), snapshotBody(body));
      const parent = body.joint?.parent;
      if (parent && unique.size < 128)
        unique.set(bodyId(parent), snapshotBody(parent));
    }
    return unique;
  };
  const fieldDiff = (before, after) => {
    const changes = [];
    const ids = new Set([
      ...(before?.states.keys() ?? []),
      ...(after?.states.keys() ?? []),
    ]);
    for (const id of ids) {
      const oldState = before?.states.get(id) ?? null,
        nextState = after?.states.get(id) ?? null;
      if (!oldState || !nextState) {
        changes.push({
          bodyId: id,
          name: oldState?.name ?? nextState?.name ?? "",
          fields: { presence: { before: !!oldState, after: !!nextState } },
        });
        continue;
      }
      const fields = {};
      for (const key of Object.keys(oldState))
        if (key !== "id" && !same(oldState[key], nextState[key]))
          fields[key] = { before: oldState[key], after: nextState[key] };
      if (Object.keys(fields).length)
        changes.push({ bodyId: id, name: nextState.name, fields });
    }
    return changes;
  };
  const vectorKey = (value) => vector(value) ?? null;
  const rowDescription = (row) => {
    const a = bodyId(row.a),
      b = bodyId(row.b),
      geometryKey = JSON.stringify([
        a,
        b,
        row.sourceType ?? null,
        vectorKey(row.point),
        vectorKey(row.pointB),
        vectorKey(row.normal),
      ]),
      impulseKey = JSON.stringify([
        geometryKey,
        row.normalImpulse ?? null,
        vectorKey(row.tangentImpulse),
      ]);
    return {
      bodyAId: a,
      bodyBId: b,
      geometryKey,
      impulseKey,
      sourceType: row.sourceType ?? null,
      point: vectorKey(row.point),
      pointB: vectorKey(row.pointB),
      normal: vectorKey(row.normal),
      normalImpulse: row.normalImpulse ?? null,
      tangentImpulse: vectorKey(row.tangentImpulse),
      closingSpeed: row.closingSpeed ?? null,
      solverAccepted: row.solverAccepted ?? null,
    };
  };
  const recordImpactRows = (impacts, attemptId) => {
    const count = Math.min(impacts?.length ?? 0, 4096),
      start = rows.length;
    for (let i = 0; i < count; i++) {
      const description = impacts[i],
        geometryOccurrence = geometryCounts.get(description.geometryKey) ?? 0,
        impulseOccurrence = impulseCounts.get(description.impulseKey) ?? 0;
      if (geometryOccurrence) rowKeys.geometryRepeats++;
      if (impulseOccurrence) rowKeys.impulseRepeats++;
      if (
        geometryCounts.has(description.geometryKey) ||
        geometryCounts.size < maxRows
      )
        geometryCounts.set(description.geometryKey, geometryOccurrence + 1);
      if (
        impulseCounts.has(description.impulseKey) ||
        impulseCounts.size < maxRows
      )
        impulseCounts.set(description.impulseKey, impulseOccurrence + 1);
      if (rows.length >= maxRows) {
        droppedRows++;
        continue;
      }
      rows.push({
        attemptId,
        rowIndex: i,
        ...description,
        geometryOccurrence: geometryOccurrence + 1,
        impulseOccurrence: impulseOccurrence + 1,
      });
    }
    droppedRows += Math.max(0, (impacts?.length ?? 0) - count);
    if (currentAttempt && currentAttempt.id === attemptId) {
      currentAttempt.rowCount += impacts?.length ?? 0;
      currentAttempt.recordedRows += rows.length - start;
    }
    return count;
  };
  const makeAttemptId = (seed, attempt) => `${bodyId(seed)}:${attempt}`;
  const traceWrapper = function (event) {
    try {
      return originals.trace?.apply(this, arguments);
    } finally {
      if (!stopped && event) {
        if (events.length >= maxEvents && rows.length >= maxRows) {
          droppedEvents++;
        } else {
          try {
            const seedId = bodyId(event.seed),
              attemptId = makeAttemptId(event.seed, event.attempt);
            if (event.phase === "collection") {
              if (currentAttempt?.id !== attemptId)
                currentAttempt = {
                  id: attemptId,
                  seedId,
                  attempt: event.attempt,
                  processCalls: 0,
                  rowCount: 0,
                  recordedRows: 0,
                  usefulCalls: 0,
                  unchangedCalls: 0,
                };
              collectionState = snapshotRoster();
              pushEvent({
                phase: "collection",
                attemptId,
                seedId,
                attempt: event.attempt,
                ringSize: event.ringSize,
                batchBodyIds: (event.batch ?? []).slice(0, 128).map(bodyId),
                batchTruncated: (event.batch?.length ?? 0) > 128,
                snapshotBodies: collectionState.bodyCount,
                snapshotTruncated: collectionState.truncated,
              });
            } else if (event.phase === "response") {
              const after = snapshotRoster(),
                changes = fieldDiff(collectionState ?? seedState, after),
                attempt =
                  currentAttempt?.id === attemptId ? currentAttempt : null;
              pushEvent({
                phase: "response",
                attemptId,
                seedId,
                attempt: event.attempt,
                ringSize: event.ringSize,
                changedBodyIds: (event.changed ?? []).slice(0, 128).map(bodyId),
                changedBodiesTruncated: (event.changed?.length ?? 0) > 128,
                positiveNormal: !!event.positiveNormal,
                positiveJoint: !!event.positiveJoint,
                rejected: !!event.rejected,
                worldChanged: !!event.worldChanged,
                rosterChanged: !!event.rosterChanged,
                stateChanges: changes,
                usefulStateChange: changes.length > 0,
                classification: changes.length
                  ? "useful-state-change"
                  : "unchanged-state",
                processCalls: attempt?.processCalls ?? 0,
                impactRows: attempt?.rowCount ?? 0,
                recordedRows: attempt?.recordedRows ?? 0,
                usefulCalls: attempt?.usefulCalls ?? 0,
                unchangedCalls: attempt?.unchangedCalls ?? 0,
                note: "Classification describes observed body-state changes only; it is not a validity or skip decision.",
              });
              collectionState = after;
              currentAttempt = null;
            }
          } catch {
            diagnosticErrors++;
          }
        }
      }
    }
  };
  const processWrapper = function (impacts, jointImpacts, restarts) {
    if (stopped || (events.length >= maxEvents && rows.length >= maxRows))
      return originals.process.apply(this, arguments);
    const impactRows = impacts ?? [],
      jointRows = jointImpacts ?? [],
      attemptId = currentAttempt?.id ?? null;
    let affected = [],
      before,
      beforeRows;
    try {
      for (let i = 0; i < Math.min(impactRows.length, 4096); i++)
        affected.push(impactRows[i].a, impactRows[i].b);
      for (let i = 0; i < Math.min(jointRows.length, 4096); i++) {
        const row = jointRows[i];
        affected.push(row.a, row.b, row.joint?.parent, row.joint?.child);
      }
      for (const restart of restarts ?? [])
        for (const body of restart) {
          if (affected.length >= 512) break;
          affected.push(body);
        }
      before = snapshotSelected(affected);
      beforeRows = Array.from(
        { length: Math.min(impactRows.length, 4096) },
        (_, i) => rowDescription(impactRows[i]),
      );
    } catch {
      diagnosticErrors++;
      return originals.process.apply(this, arguments);
    }
    if (currentAttempt) currentAttempt.processCalls++;
    let returned,
      completed = false;
    try {
      returned = originals.process.apply(this, arguments);
      completed = true;
      return returned;
    } finally {
      try {
        const after = snapshotSelected(affected),
          changes = fieldDiff({ states: before }, { states: after });
        recordImpactRows(beforeRows, attemptId);
        if (currentAttempt && currentAttempt.id === attemptId) {
          if (changes.length) currentAttempt.usefulCalls++;
          else currentAttempt.unchangedCalls++;
        }
        pushEvent({
          phase: "processImpactDamage",
          attemptId,
          rowCount: impactRows.length,
          jointRowCount: jointRows.length,
          rowsTruncated: impactRows.length > 4096,
          stateChanges: changes,
          usefulStateChange: changes.length > 0,
          classification: changes.length
            ? "useful-state-change"
            : "unchanged-state",
          returnKind: completed ? typeof returned : "threw",
          returnValue:
            completed && typeof returned === "boolean" ? returned : null,
          note: "Repeated geometry and impulse keys are descriptive diagnostics and do not establish that a response was invalid or skippable.",
        });
      } catch {
        diagnosticErrors++;
      }
    }
  };
  sim.onLocalResponseTrace = traceWrapper;
  sim.processImpactDamage = processWrapper;
  const probe = {
    version: 1,
    limits: { maxEvents, maxRows, maxBodiesPerSnapshot: 2048 },
    seed() {
      if (stopped) throw new Error("Response trace probe has been disposed");
      seedState = snapshotRoster();
      collectionState = seedState;
      pushEvent({
        phase: "seed",
        snapshotBodies: seedState.bodyCount,
        snapshotTruncated: seedState.truncated,
        note: "Initial body state captured immediately before measured stepping.",
      });
      return { bodyCount: seedState.bodyCount, truncated: seedState.truncated };
    },
    snapshot() {
      return {
        version: 1,
        overheadNote:
          "Detailed whole-roster and per-response snapshots add substantial CPU work; exclude these captures from FPS/performance claims.",
        limits: { maxEvents, maxRows, maxBodiesPerSnapshot: 2048 },
        events,
        rows,
        rowKeyCounts: {
          geometryRepeats: rowKeys.geometryRepeats,
          sameImpulseRepeats: rowKeys.impulseRepeats,
          uniqueGeometryKeys: geometryCounts.size,
          uniqueImpulseKeys: impulseCounts.size,
        },
        droppedEvents,
        droppedRows,
        diagnosticErrors,
      };
    },
    dispose() {
      if (stopped) return;
      stopped = true;
      if (sim.onLocalResponseTrace === traceWrapper) {
        if (originals.traceOwn)
          Object.defineProperty(
            sim,
            "onLocalResponseTrace",
            originals.traceDescriptor,
          );
        else delete sim.onLocalResponseTrace;
      }
      if (sim.processImpactDamage === processWrapper) {
        if (originals.processOwn)
          Object.defineProperty(
            sim,
            "processImpactDamage",
            originals.processDescriptor,
          );
        else delete sim.processImpactDamage;
      }
      if (window.__perfResponseTraceProbe === probe)
        delete window.__perfResponseTraceProbe;
    },
  };
  window.__perfResponseTraceProbe = probe;
  return {
    version: probe.version,
    limits: probe.limits,
    methods: ["processImpactDamage", "onLocalResponseTrace"],
    overheadNote: probe.snapshot().overheadNote,
  };
}
