/** Bounded in-page correction capture. Call only from a loopback Chromium harness. */
const PLAYER_START = [-84.45, 1.53, 7.8355];
const MATERIAL = "TEZFEN";
const TEXTURE_CONTACT_IMPULSE = 0.54;
const FRAME_CAPTURE_MS = 250;
const MAX_CASE_MS = 2000;
const MAX_TRACE_ROWS = 8192;
const WORK_COUNTERS = Object.freeze([
  "correctionPasses",
  "contactCollections",
  "worldCollections",
  "worldHullTransforms",
  "validityChecks",
  "validityChanges",
  "geometryTransforms",
  "geometryHits",
  "pairTests",
  "pairHits",
  "worldTests",
  "worldHits",
  "localCollections",
  "responseSolves",
  "retryRounds",
  "traversalRestarts",
  "consideredBodies",
  "worldContactCollections",
  "pairIncidentCollections",
  "activeRoots",
  "deferredFrictionRows",
  "deferredFrictionOverflow",
  "deferredFrictionApplied",
  "inputScans",
  "responseChangedBodies",
  "retryExhaustions",
  "normalResponseSolves",
  "jointResponseSolves",
]);

/** Missing baseline counters are unknown, not zero work. */
export function correctionWorkCounts(diagnostics) {
  return Object.fromEntries(
    WORK_COUNTERS.map((key) => {
      const value = diagnostics?.[key];
      if (value === undefined) return [key, null];
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error(`Invalid correction work counter ${key}`);
      return [key, value];
    }),
  );
}

/** Coarse bounded observation: two timer reads per tick/update, none per hull,
 * contact or dormant guard. Counts actual completed step calls rather than
 * inferring ticks from elapsed time or a returned planned window. */
export function installPhysicsWindowProbe(
  sim,
  {
    now = () => performance.now(),
    maximumUpdates = 128,
    maximumTicks = 512,
  } = {},
) {
  for (const value of [maximumUpdates, maximumTicks])
    if (!Number.isInteger(value) || value < 1 || value > 512)
      throw new Error("Probe retention bounds must be integers from 1 to 512");
  if (typeof sim?.step !== "function" || typeof sim?.updateFrame !== "function")
    throw new Error("Physics window probe needs step and updateFrame methods");
  const originals = { step: sim.step, updateFrame: sim.updateFrame };
  const descriptors = Object.fromEntries(
    Object.keys(originals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(sim, key),
    ]),
  );
  const updates = [],
    stepSamples = [],
    active = [];
  let stopped = false,
    updateCalls = 0,
    tickCalls = 0,
    completedTicks = 0;
  let droppedUpdates = 0,
    droppedTicks = 0;
  const wrappers = {
    step(...args) {
      if (stopped) return originals.step.apply(this, args);
      tickCalls++;
      for (const window of active) window.tickCalls++;
      const start = now();
      let completed = false;
      try {
        const result = originals.step.apply(this, args);
        completed = true;
        completedTicks++;
        for (const window of active) window.ticks++;
        return result;
      } finally {
        const cpuMs = now() - start;
        for (const window of active) window.tickCpuMs += cpuMs;
        if (stepSamples.length < maximumTicks) stepSamples.push(cpuMs);
        else droppedTicks++;
        if (!completed) for (const window of active) window.failed = true;
      }
    },
    updateFrame(...args) {
      if (stopped) return originals.updateFrame.apply(this, args);
      updateCalls++;
      const row = {
        frameStartMs: args[0],
        requestedPeriodMs: args[1],
        ticks: 0,
        tickCalls: 0,
        tickCpuMs: 0,
        cpuMs: 0,
        plannedTicks: null,
        skippedMs: null,
        failed: false,
      };
      const start = now();
      active.push(row);
      let completed = false;
      try {
        const result = originals.updateFrame.apply(this, args);
        row.plannedTicks = result?.steps ?? null;
        row.skippedMs = result?.skippedMs ?? null;
        completed = true;
        return result;
      } finally {
        active.pop();
        row.cpuMs = now() - start;
        row.failed ||= !completed;
        if (updates.length < maximumUpdates) updates.push(row);
        else droppedUpdates++;
      }
    },
  };
  sim.step = wrappers.step;
  sim.updateFrame = wrappers.updateFrame;
  return {
    updates,
    stepSamples,
    counts() {
      return {
        updateCalls,
        tickCalls,
        completedTicks,
        droppedUpdates,
        droppedTicks,
      };
    },
    stop() {
      if (stopped) return;
      stopped = true;
      for (const name of Object.keys(originals)) {
        if (sim[name] !== wrappers[name]) continue;
        if (descriptors[name])
          Object.defineProperty(sim, name, descriptors[name]);
        else delete sim[name];
      }
    },
  };
}
const RECONSTRUCTED_ANGULAR_STATE = {
  source:
    "artifacts/timber-investigation/gentle-fence-population.json; recreated diagnostic state, not an exact scene snapshot",
  player: [-1.113978256372464, 0.13116205263704514, 4.984642619341389],
  parts: {
    EIIIFBMP: [-3.5811667540337, -2.5565923142798654, -2.439947012093355],
    EIIIFLWG: [-3.9745395486516797, 9.694021514791553, -5.4878200166139],
    EIIIRDOR: [-1.5359151028768339, -1.613301739158574, 3.4157441424230406],
    EIIIRRWG: [-1.6465292104288212, -1.7967876184551308, 4.979701608346908],
    EIIISPK1: [0, 0, 1.7530910534074298],
    EIIISPK2: [0, 0, 1.7530910534074298],
    EIIIRBMP: [-3.331178816094047, -0.31854843556041074, 4.78536669497363],
  },
  rivals: [
    {
      name: "buggy",
      position: [-116.56984480947227, 4.672465179401285, 29.443922154643083],
      angular: [-7.238285548830141, 6.003217132786333, 5.640648370283205],
    },
    {
      name: "BUZZ",
      position: [-117.9606600326407, 3.7585407819022603, 29.486123155801454],
      angular: [1.941386587747177, -3.168433682693304, -3.640026887550974],
    },
    {
      name: "bugtoo5",
      position: [-119.23981386824624, 7.101360703833903, 26.31979264920319],
      angular: [0.7812814221102282, 0.040531794990408376, 0.269646923266197],
    },
    {
      name: "wideboy",
      position: [-119.52164354412723, 7.02119367765612, 26.80119490383672],
      angular: [3.437686924716609, 0.15096155823362017, 5.68661949062757],
    },
    {
      name: "fair",
      position: [-118.30235299314806, 7.190199521861156, 26.395062437670102],
      angular: [0.06544378048625792, -0.561554314350839, -0.2840602889518146],
    },
    {
      name: "forklift",
      position: [-110.94262305061434, 10.915562924703108, 29.742809308855676],
      angular: [-0.9266915170445982, -1.9854892318385113, -8.176601229626154],
    },
  ],
};

function distribution(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b),
    at = (p) => sorted[Math.ceil(p * sorted.length) - 1];
  return {
    count: values.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted.at(-1),
  };
}

function stableBodyKey(body, index) {
  if (body.group) return `car:${body.group.name || index}:${index}`;
  if (body.owner)
    return `part:${body.owner.group?.name || "car"}:${body.part}:${index}`;
  if (body.actor)
    return `actor:${body.actor.name || body.kind || "body"}:${index}`;
  return `body:${body.kind || "unknown"}:${index}`;
}

function normalizeActorName(name) {
  return String(name ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .at(-1)
    .replace(/\.[^.]+$/, "")
    .toUpperCase();
}

function partModelKeys(runtimePart) {
  const candidates = new Set([normalizeActorName(runtimePart?.part.actor)]);
  runtimePart?.actor.traverse((node) =>
    candidates.add(normalizeActorName(node.name)),
  );
  return [...candidates].filter(Boolean);
}

function physicsSnapshot(sim) {
  const bodies = sim.allBodies(),
    indices = new Map(bodies.map((body, index) => [body, index]));
  return {
    bodies: bodies.map((body, index) => ({
      key: stableBodyKey(body, index),
      position: body.state.position.toArray(),
      orientation: body.state.orientation.toArray(),
      velocity: body.state.velocity.toArray(),
      angularVelocity: body.state.angularVelocity.toArray(),
      components: body.damage ? Array.from(body.damage.componentLevels) : null,
      deformationRevision: body.damage?.deformationRevision ?? null,
      splitRevision: body.damage?.splitRevision ?? null,
      hulls: body.hulls?.map((hull) => {
        const values = hull.vertices.map((vertex) => vertex.toArray());
        let hash = 2166136261;
        for (const char of JSON.stringify(values))
          hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
        return { vertices: values.length, hash: (hash >>> 0).toString(16) };
      }),
      jointParent: body.joint ? (indices.get(body.joint.parent) ?? -1) : null,
    })),
    impacts: sim.lastImpacts.map((impact) => ({
      a: indices.get(impact.a) ?? -1,
      b: impact.b ? (indices.get(impact.b) ?? -1) : null,
      point: impact.point.toArray(),
      pointB: impact.pointB?.toArray() ?? null,
      normal: impact.normal.toArray(),
      sourceType: impact.sourceType ?? null,
      sourceMaterial: impact.sourceSurface?.material ?? null,
      sourceFace: impact.sourceSurface?.faceIndex ?? null,
      normalImpulse: impact.normalImpulse,
      closingSpeed: impact.closingSpeed,
      tangentImpulse: impact.tangentImpulse.toArray(),
      solverAccepted: impact.solverAccepted ?? null,
    })),
  };
}

function fractionSnapshot(sim, fractionRows) {
  const bodies = sim.allBodies(),
    indices = new Map(bodies.map((body, index) => [body, index]));
  return fractionRows.map(({ body, result, refine }) => ({
    body: indices.get(body) ?? -1,
    refine,
    fraction: result.fraction,
    contacts: result.contacts.length,
  }));
}

async function waitReady(c) {
  const deadline = performance.now() + 90000;
  while (!(c.stats.ready && c.opponentsReady)) {
    // loadRace starts a new race unpaused before its async opponents finish.
    // Hold it as soon as the new player/track are ready; the prototype guard
    // below prevents a physics tick in the one frame before this poll runs.
    if (c.stats.ready) c.paused = true;
    if (performance.now() > deadline)
      throw new Error("Selected Timber race did not finish loading");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function deterministicRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function findFenceSurface(world, point) {
  const Vector = point.constructor,
    normalize = (value) =>
      value.replace(/\.(mat|pix|tif|tiff)$/i, "").toUpperCase();
  for (const radius of [4, 8, 16, 24]) {
    const delta = new Vector(radius, radius, radius),
      surfaces = world.querySurfaces(
        point.clone().sub(delta),
        point.clone().add(delta),
        true,
      );
    const matches = surfaces
      .filter(
        (surface) =>
          normalize(surface.material) === MATERIAL &&
          surface.actor &&
          surface.faceIndex !== undefined,
      )
      .map((surface) => {
        const center = surface.a
          .clone()
          .add(surface.b)
          .add(surface.c)
          .multiplyScalar(1 / 3);
        return { surface, point: center, distance: center.distanceTo(point) };
      })
      .sort((a, b) => a.distance - b.distance);
    if (matches.length) return matches[0];
  }
  throw new Error(
    `No original ${MATERIAL} face within 24 units of player start`,
  );
}

function prepareFence(c, player) {
  const sim = c.simulation,
    spec = sim.destruction?.specs.find(
      (entry) =>
        entry.trigger.kind === "material" &&
        entry.trigger.name
          .replace(/\.(mat|pix|tif|tiff)$/i, "")
          .toUpperCase() === MATERIAL &&
        entry.mode === "texturechange",
    );
  if (!spec) throw new Error(`No original texture-change spec for ${MATERIAL}`);
  const threshold = spec.levels[0]?.threshold;
  if (!Number.isFinite(threshold) || threshold <= 0.1)
    throw new Error(`Unexpected ${MATERIAL} first threshold: ${threshold}`);
  const site = findFenceSurface(sim.world, player.state.position),
    impulse = Math.min(TEXTURE_CONTACT_IMPULSE, threshold - 0.01);
  if (!(impulse > 0.1))
    throw new Error(
      `No texture preparation impulse below threshold ${threshold}`,
    );
  const result = sim.destruction.handleContact({
    actor: site.surface.actor,
    faceIndex: site.surface.faceIndex,
    material: site.surface.material,
    normalImpulse: impulse,
    kind: "body",
    bodyActor: player.group,
    impacteeVelocity: player.state.velocity,
    smashStartingVelocity: player.state.velocity.clone(),
    impacteeTransform: player.group.matrixWorld,
    point: site.point,
    timeMs: 0,
  });
  if (!result.changed)
    throw new Error(
      `Original ${MATERIAL} preparation contact was rejected: ${result.diagnostics.join("; ")}`,
    );
  sim.flushSmashEffects();
  sim.synchronizeWorldDestruction();
  return {
    material: site.surface.material,
    faceIndex: site.surface.faceIndex,
    distanceFromStart: site.distance,
    impulse,
    firstThreshold: threshold,
    changed: result.changed,
    geometryChanged: result.changes.some((change) => change.geometryChanged),
    diagnostics: result.diagnostics,
  };
}

function applyReconstructedAngularState(sim, player) {
  player.state.angularVelocity.fromArray(RECONSTRUCTED_ANGULAR_STATE.player);
  const applied = [];
  for (const body of sim.debris) {
    if (body.owner !== player || body.part < 0) continue;
    const runtimePart = player.damage.runtimeParts[body.part],
      key = partModelKeys(runtimePart).find(
        (candidate) => RECONSTRUCTED_ANGULAR_STATE.parts[candidate],
      ),
      angular = RECONSTRUCTED_ANGULAR_STATE.parts[key];
    if (!angular) continue;
    body.state.angularVelocity.fromArray(angular);
    applied.push({
      runtimePartIndex: body.part,
      key,
      angularVelocity: angular,
    });
  }
  const rivalAssignments = [],
    remainingCars = sim.cars.filter((car) => car !== player),
    assigned = new Set();
  for (
    let index = 0;
    index < RECONSTRUCTED_ANGULAR_STATE.rivals.length;
    index++
  ) {
    const observed = RECONSTRUCTED_ANGULAR_STATE.rivals[index],
      wanted = normalizeActorName(observed.name),
      named = remainingCars.find(
        (car) =>
          !assigned.has(car) && normalizeActorName(car.group.name) === wanted,
      ),
      car =
        named ?? remainingCars.find((candidate) => !assigned.has(candidate));
    if (!car) break;
    assigned.add(car);
    car.state.position.fromArray(observed.position);
    car.state.angularVelocity.fromArray(observed.angular);
    sim.sync(car);
    rivalAssignments.push({
      observedName: observed.name,
      carName: car.group.name,
      carIndex: sim.cars.indexOf(car),
      matchedBy: named ? "authored-name" : "deterministic-rival-order",
      position: observed.position,
      angularVelocity: observed.angular,
    });
  }
  return {
    kind: "reconstructed-diagnostic-angular-stress",
    source: RECONSTRUCTED_ANGULAR_STATE.source,
    playerAngularVelocity: RECONSTRUCTED_ANGULAR_STATE.player,
    detachedPartsApplied: applied,
    unmatchedDetachedParts: sim.debris
      .filter((body) => body.owner === player && body.part >= 0)
      .filter(
        (body) =>
          !partModelKeys(player.damage.runtimeParts[body.part]).some(
            (candidate) => RECONSTRUCTED_ANGULAR_STATE.parts[candidate],
          ),
      ).length,
    rivalAssignments,
    unassignedObservedRivals:
      RECONSTRUCTED_ANGULAR_STATE.rivals.length - rivalAssignments.length,
  };
}

/** Load a fresh track, prepare the heavy state, then collect one short variant.
 * Rendering is suppressed only in this call and restored in its finally block. */
export async function runCorrectionVariant({
  track,
  reuse,
  seed = 0x50455246,
  traceFirstTick = true,
  frameMs = FRAME_CAPTURE_MS,
}) {
  if (!/^data\//i.test(track) && !/^adv_data\//i.test(track))
    throw new Error("Track must be a catalogued local data/ or adv_data/ path");
  if (!(frameMs >= 0 && frameMs <= 500))
    throw new Error("Frame capture must be between 0 and 500 ms");
  const c = window.carma;
  if (!c?.stats.ready || !c.simulation || !c.renderer)
    throw new Error("Application is not ready");
  const renderer = c.renderer,
    savedRender = renderer.render,
    savedPaused = c.paused,
    savedRandom = Math.random;
  let fractionRows = [],
    worldGuardDescriptor,
    worldGuardWrapper,
    measuredSimulation,
    manualWindowProbe,
    frameWindowProbe,
    prepared,
    manualStepMs = [],
    tracedDiagnostics,
    tracedFractions,
    tracedCollectionWork,
    collectionRestores = [],
    manualFrameDiagnostics,
    manualFrameState,
    frameIntervals = [],
    frameStepMs = [],
    animationFrame = 0,
    frameTimer,
    nativeRandom,
    savedNativeState,
    savedDiagnostics,
    savedReuse,
    savedWorkingSet,
    savedCrashClock,
    savedStopTimer,
    simulationPrototype,
    savedUpdateFrame,
    selectionRandomDraws = 0,
    applicationRandomDraws = 0,
    mathRandom,
    measurementStarted;
  try {
    c.paused = true;
    renderer.render = () => {};
    const select = document.querySelector("#track-select");
    if (
      !select ||
      ![...select.options].some((option) => option.value === track)
    )
      throw new Error(`Track is not in the local catalog: ${track}`);
    nativeRandom = await import("/src/native-random.ts");
    savedNativeState = nativeRandom.sharedNativeRandom.state;
    nativeRandom.sharedNativeRandom.seed(seed);
    mathRandom = deterministicRandom(seed);
    const selectionRandom = deterministicRandom(seed ^ 0x53454c45);
    Math.random = () => {
      if ((new Error().stack ?? "").includes("selectOpponentIds")) {
        selectionRandomDraws++;
        return selectionRandom();
      }
      applicationRandomDraws++;
      return mathRandom();
    };
    select.value = track;
    const carSelect = document.querySelector("#car-select");
    const eagleOption =
      carSelect &&
      [...carSelect.options].find((option) =>
        /^data\/cars\/[^/]+\/EAGLE3\.TXT$/i.test(option.value),
      );
    if (!carSelect || !eagleOption)
      throw new Error("Stock EAGLE3.TXT is not in the local car catalog");
    carSelect.value = eagleOption.value;
    simulationPrototype = Object.getPrototypeOf(c.simulation);
    savedUpdateFrame = Object.getOwnPropertyDescriptor(
      simulationPrototype,
      "updateFrame",
    );
    simulationPrototype.updateFrame = () => ({ skippedMs: 0 });
    await c.loadRace();
    await waitReady(c);
    c.paused = true;
    if (savedUpdateFrame)
      Object.defineProperty(
        simulationPrototype,
        "updateFrame",
        savedUpdateFrame,
      );
    else delete simulationPrototype.updateFrame;
    simulationPrototype = undefined;

    const sim = c.simulation,
      player = c.player;
    measuredSimulation = sim;
    if (!player || !sim.cars.includes(player))
      throw new Error("Loaded race has no registered player car");
    const V = player.state.position.constructor,
      Q = player.state.orientation.constructor;
    savedDiagnostics = sim.correctionDiagnostics;
    savedReuse = sim.correctionReuse;
    savedWorkingSet = sim.correctionWorkingSet;
    savedCrashClock = sim.crashClock;
    savedStopTimer = sim.motionContext.stopTimer;
    for (const car of sim.cars) sim.setCarPhysicsActive(car, true);
    player.state.position.set(...PLAYER_START);
    player.state.orientation.copy(
      new Q().setFromAxisAngle(new V(0, 1, 0), -Math.PI / 2),
    );
    player.state.heading = -Math.PI / 2;
    player.state.velocity
      .set(0, 0, -0.3)
      .applyQuaternion(player.state.orientation);
    player.state.angularVelocity.set(0, 0, 0);
    player.state.predictedPosition = undefined;
    player.state.predictedOrientation = undefined;
    player.input.throttle = 0;
    player.input.brake = false;
    player.input.handbrake = false;
    sim.sync(player);
    sim.elapsed = 0;
    sim.motionContext.stopTimer = 0;
    sim.crashClock = () => 0;
    const partRequests = [];
    const runtimeParts = player.damage.runtimeParts;
    const observedPartNames = Object.keys(RECONSTRUCTED_ANGULAR_STATE.parts);
    const orderedParts = runtimeParts
      .map((part, index) => ({ part, index, keys: partModelKeys(part) }))
      .sort((a, b) => {
        const rank = (keys) => {
          const match = keys.findIndex((key) =>
            observedPartNames.includes(key),
          );
          return match < 0 ? observedPartNames.length : match;
        };
        return rank(a.keys) - rank(b.keys) || a.index - b.index;
      });
    for (const { part, index } of orderedParts) {
      if (sim.debris.filter((body) => body.owner === player).length >= 7) break;
      if (part.state.phase !== 0) continue;
      const before = sim.debris.filter((body) => body.owner === player).length;
      part.state.queuedAt = 0;
      sim.detachParts(player);
      const after = sim.debris.filter((body) => body.owner === player).length;
      partRequests.push({
        runtimePartIndex: index,
        authoredActor: part.part.actor,
        modelKeys: partModelKeys(part),
        authoredType: part.state.type,
        before,
        after,
        accepted: after > before,
      });
      // Discard a refused fixture request so each subsequent authored part
      // reaches the normal detachment gates independently.
      if (after === before && part.state.phase === 0)
        part.state.queuedAt = null;
    }
    const detached = sim.debris.filter((body) => body.owner === player).length;
    if (detached !== 7)
      throw new Error(
        `Expected seven detached parts after trying ${runtimeParts.length} runtime parts; ` +
          `found ${detached}. Requests: ${JSON.stringify(partRequests)}`,
      );
    prepared = prepareFence(c, player);
    prepared.correctionStress = applyReconstructedAngularState(sim, player);
    prepared.randomIsolation = {
      method:
        "call-stack-routed Math.random; selectOpponentIds gets its own seeded stream",
      selectionRandomDraws,
      otherLoadRandomDraws: applicationRandomDraws,
    };

    // Prime the ordinary dormant-prop bounds cache before timing. This is a
    // pure contact collection: preserve candidate poses and recovery flags.
    const bodies = sim.allBodies(),
      elapsedBeforeWarm = sim.elapsed,
      flags = bodies.map((body) => [
        body,
        body.overlapDetected,
        body.worldOverlapDetected,
      ]),
      { createHierarchyMotionPhase } = await import(
        "/src/physics/hierarchy-motion.ts"
      );
    createHierarchyMotionPhase(bodies, sim.allJoints(), 0.04).writeCandidates(
      bodies,
    );
    sim.correctionReuse = reuse;
    sim.correctionWorkingSet = reuse
      ? new (
          await import("/src/physics/correction-working-set.ts")
        ).CorrectionWorkingSet()
      : undefined;
    sim.collectBodyContacts(bodies);
    sim.correctionWorkingSet = undefined;
    if (sim.elapsed !== elapsedBeforeWarm)
      throw new Error("Correction warmup advanced the simulation clock");
    for (const [body, overlap, worldOverlap] of flags) {
      body.overlapDetected = overlap;
      body.worldOverlapDetected = worldOverlap;
    }
    sim.correctionDiagnostics = undefined;
    // Restore candidate slots; the first measured step owns their calculation.
    for (const body of bodies) {
      body.state.predictedPosition = undefined;
      body.state.predictedOrientation = undefined;
    }

    nativeRandom.sharedNativeRandom.seed(seed);
    Math.random = deterministicRandom(seed);
    sim.correctionReuse = reuse;
    sim.correctionDiagnostics = traceFirstTick ? {} : undefined;
    const initialState = physicsSnapshot(sim);
    measurementStarted = performance.now();
    worldGuardDescriptor = Object.getOwnPropertyDescriptor(
      sim,
      "advanceWorldContacts",
    );
    const originalWorldGuard = sim.advanceWorldContacts;
    if (traceFirstTick) {
      tracedCollectionWork = {
        worldGuardCalls: 0,
        movableWorldGuardCalls: 0,
        refinedWorldGuardCalls: 0,
        worldGuardContactRows: 0,
        droppedFractionRows: 0,
        pairCollections: 0,
        pairConsideredBodies: 0,
        pairContactRows: 0,
        worldContactCollections: 0,
        worldContactRows: 0,
      };
      worldGuardWrapper = function (body, refine = false) {
        const result = originalWorldGuard.call(this, body, refine);
        if (
          !Number.isFinite(result.fraction) ||
          result.fraction < 0 ||
          result.fraction > 1
        )
          throw new Error(
            "World guard returned a nonfinite or out-of-range fraction",
          );
        tracedCollectionWork.worldGuardCalls++;
        tracedCollectionWork.movableWorldGuardCalls += Number(
          !body.properties.immovable,
        );
        tracedCollectionWork.refinedWorldGuardCalls += Number(refine);
        tracedCollectionWork.worldGuardContactRows += result.contacts.length;
        if (fractionRows.length < MAX_TRACE_ROWS)
          fractionRows.push({ body, result, refine });
        else tracedCollectionWork.droppedFractionRows++;
        return result;
      };
      Object.defineProperty(worldGuardWrapper, "correctionObserverSource", {
        value: originalWorldGuard,
      });
      sim.advanceWorldContacts = worldGuardWrapper;
      for (const name of ["collectBodyContacts", "worldContacts"]) {
        const descriptor = Object.getOwnPropertyDescriptor(sim, name);
        const original = sim[name];
        const wrapper = function (...args) {
          const rows = original.apply(this, args);
          if (name === "collectBodyContacts") {
            tracedCollectionWork.pairCollections++;
            tracedCollectionWork.pairConsideredBodies += args[0].length;
            tracedCollectionWork.pairContactRows += rows.length;
          } else {
            tracedCollectionWork.worldContactCollections++;
            tracedCollectionWork.worldContactRows += rows.length;
          }
          return rows;
        };
        Object.defineProperty(wrapper, "correctionObserverSource", {
          value: original,
        });
        sim[name] = wrapper;
        collectionRestores.push(() => {
          if (sim[name] !== wrapper) return;
          if (descriptor) Object.defineProperty(sim, name, descriptor);
          else delete sim[name];
        });
      }
    }
    let before = performance.now();
    sim.step();
    manualStepMs.push(performance.now() - before);
    tracedDiagnostics = structuredClone(sim.correctionDiagnostics ?? {});
    tracedFractions = fractionSnapshot(sim, fractionRows);
    fractionRows = [];
    for (const restore of collectionRestores.reverse()) restore();
    collectionRestores = [];
    if (worldGuardWrapper) {
      if (worldGuardDescriptor)
        Object.defineProperty(
          sim,
          "advanceWorldContacts",
          worldGuardDescriptor,
        );
      else delete sim.advanceWorldContacts;
    }

    sim.correctionDiagnostics = undefined;
    before = performance.now();
    sim.step();
    manualStepMs.push(performance.now() - before);
    const deterministicState = physicsSnapshot(sim);

    // Keep the historical two step() samples/state above. This additional
    // deterministic one-tick frame measures queue/finalization work owned by
    // updateFrame; its timing includes that tick rather than adding to it.
    if (performance.now() - measurementStarted >= MAX_CASE_MS)
      throw new Error("Manual ticks exhausted the two-second case budget");
    sim.correctionDiagnostics = traceFirstTick ? {} : undefined;
    manualWindowProbe = installPhysicsWindowProbe(sim, {
      maximumUpdates: 1,
      maximumTicks: 5,
    });
    try {
      sim.updateFrame(Math.round(sim.elapsed * 1000), 40);
    } finally {
      manualWindowProbe.stop();
    }
    manualFrameDiagnostics = structuredClone(sim.correctionDiagnostics ?? {});
    manualFrameState = physicsSnapshot(sim);
    sim.correctionDiagnostics = undefined;

    // A quarter-second frame sample leaves normal AI and application callbacks
    // running. It follows the two manual ticks AND explicit frame probe; the
    // extra advance is reported, so old frame captures are not matched inputs.
    if (frameMs) {
      if (performance.now() - measurementStarted + frameMs >= MAX_CASE_MS)
        throw new Error(
          "Insufficient two-second budget for the requested frame capture",
        );
      frameWindowProbe = installPhysicsWindowProbe(sim);
      frameStepMs = frameWindowProbe.stepSamples;
      c.paused = false;
      let previous = performance.now();
      const sampleFrame = () => {
        const now = performance.now();
        frameIntervals.push(now - previous);
        previous = now;
        animationFrame = requestAnimationFrame(sampleFrame);
      };
      animationFrame = requestAnimationFrame(sampleFrame);
      const captureStart = performance.now();
      await new Promise((resolve) => {
        frameTimer = setTimeout(resolve, frameMs);
      });
      if (performance.now() - captureStart > MAX_CASE_MS)
        throw new Error("Frame capture exceeded the two-second case budget");
      cancelAnimationFrame(animationFrame);
      c.paused = true;
      frameWindowProbe.stop();
    }
    const elapsedMs = performance.now() - measurementStarted,
      gl = renderer.getContext(),
      rendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
    if (elapsedMs > MAX_CASE_MS)
      throw new Error(`Case exceeded the two-second budget (${elapsedMs} ms)`);
    const finalBodies = sim.allBodies();
    return {
      track,
      reuse,
      prepared,
      detachedParts: detached,
      detachmentRequests: partRequests,
      runtimePartCount: runtimeParts.length,
      initialState,
      population: {
        cars: sim.cars.length,
        activeCars: sim.cars.filter((car) => sim.isCarPhysicsActive(car))
          .length,
        debris: sim.debris.length,
        noncars: sim.noncars.length,
        pedestrians: sim.pedBodies.length,
        bodies: finalBodies.length,
      },
      manualStepMs,
      traceFirstTick,
      manualTickMs: distribution(manualStepMs),
      deterministicState,
      tracedDiagnostics,
      tracedWorkCounts: correctionWorkCounts(tracedDiagnostics),
      tracedFractions,
      tracedCollectionWork: tracedCollectionWork ?? null,
      manualFrameUpdates: manualWindowProbe.updates,
      manualFrameUpdateMs: manualWindowProbe.updates.map(
        (entry) => entry.cpuMs,
      ),
      manualFrameTickSamples: manualWindowProbe.stepSamples,
      manualFrameCounts: manualWindowProbe.counts(),
      manualFrameDiagnostics,
      manualFrameWorkCounts: correctionWorkCounts(manualFrameDiagnostics),
      manualFrameState,
      frameCaptureMs: frameMs,
      frameIntervals,
      frameStepSamples: frameStepMs,
      frameMs: distribution(frameIntervals),
      frameStepMs: distribution(frameStepMs),
      frameUpdates: frameWindowProbe?.updates ?? [],
      frameUpdateSamples:
        frameWindowProbe?.updates.map((entry) => entry.cpuMs) ?? [],
      frameUpdateMs: distribution(
        frameWindowProbe?.updates.map((entry) => entry.cpuMs) ?? [],
      ),
      ticksPerFrameUpdate: distribution(
        frameWindowProbe?.updates.map((entry) => entry.ticks) ?? [],
      ),
      frameWindowCounts: frameWindowProbe?.counts() ?? null,
      measurementNotes: [
        "Two historical manual step samples precede a new deterministic 40ms updateFrame probe; the timed normal frame capture starts after that additional advance.",
        "updateFrame CPU is inclusive of its ticks, queue finalization and callbacks; do not add tick CPU to update CPU.",
        "Tick counts are completed step calls, with attempted calls and retention drops reported separately. Missing engine work counters are null rather than zero.",
        "First-tick collection wrappers count work without per-contact/guard timers; normal-frame timing uses only coarse step/update wrappers.",
      ],
      gpu: rendererInfo
        ? gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      dpr: devicePixelRatio,
      glError: gl.getError(),
      elapsedCaseMs: elapsedMs,
    };
  } finally {
    if (simulationPrototype) {
      if (savedUpdateFrame)
        Object.defineProperty(
          simulationPrototype,
          "updateFrame",
          savedUpdateFrame,
        );
      else delete simulationPrototype.updateFrame;
    }
    clearTimeout(frameTimer);
    cancelAnimationFrame(animationFrame);
    manualWindowProbe?.stop();
    frameWindowProbe?.stop();
    for (const restore of collectionRestores.reverse()) restore();
    if (measuredSimulation) {
      if (
        worldGuardWrapper &&
        measuredSimulation.advanceWorldContacts === worldGuardWrapper
      ) {
        if (worldGuardDescriptor)
          Object.defineProperty(
            measuredSimulation,
            "advanceWorldContacts",
            worldGuardDescriptor,
          );
        else delete measuredSimulation.advanceWorldContacts;
      }
      measuredSimulation.correctionDiagnostics = savedDiagnostics;
      measuredSimulation.correctionReuse = savedReuse;
      measuredSimulation.correctionWorkingSet = savedWorkingSet;
      if (savedCrashClock) measuredSimulation.crashClock = savedCrashClock;
      if (savedStopTimer !== undefined)
        measuredSimulation.motionContext.stopTimer = savedStopTimer;
    }
    c.paused = savedPaused;
    renderer.render = savedRender;
    Math.random = savedRandom;
    if (nativeRandom && savedNativeState !== undefined)
      nativeRandom.sharedNativeRandom.seed(savedNativeState);
  }
}
