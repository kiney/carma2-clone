/** Bounded, opt-in comparison against a separate baseline source server.
 * No simulation stepping. Original live assets remain in the user's installation.
 * Both methods receive identical bodies, masks and immutable 40ms paths. */
export async function compareBodyWorkingSet(
  baselineUrl = "http://127.0.0.1:5282",
) {
  const url = new URL(baselineUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error("Baseline diagnostics require a local source server");
  const [
    { BodyTrajectoryGuard },
    baselineGuard,
    baselineSimulation,
    integration,
    masks,
  ] = await Promise.all([
    import("/src/physics/pair-guard.ts"),
    import(/* @vite-ignore */ new URL("/src/physics/pair-guard.ts", url).href),
    import(/* @vite-ignore */ new URL("/src/physics/simulation.ts", url).href),
    import("/src/physics/integrate.ts"),
    import("/src/physics/ped-body.ts"),
  ]);
  const c = window.carma,
    sim = c.simulation,
    bodies = sim.allBodies();
  if (!c.paused)
    throw new Error("Pause driving before comparing frozen geometry");
  const V = c.player.state.position.constructor,
    Q = c.player.state.orientation.constructor;
  const saved = bodies.map((body) => ({
    body,
    predictedPosition: body.state.predictedPosition,
    predictedOrientation: body.state.predictedOrientation,
    overlapDetected: body.overlapDetected,
  }));
  const paths = new Map(
    bodies.map((body) => {
      const probe = {
        ...body,
        state: {
          ...body.state,
          position: body.state.position.clone(),
          orientation: body.state.orientation.clone(),
          velocity: body.state.velocity.clone(),
          angularVelocity: body.state.angularVelocity.clone(),
          predictedPosition: new V(),
          predictedOrientation: new Q(),
        },
      };
      const cache = new Map();
      const path = (t) => {
        if (!cache.has(t)) {
          if (body.properties.immovable) {
            probe.state.predictedPosition.copy(probe.state.position);
            probe.state.predictedOrientation.copy(probe.state.orientation);
          } else integration.advanceRigidBody(probe, 0.04 * t, true);
          cache.set(t, {
            position: probe.state.predictedPosition.clone(),
            orientation: probe.state.predictedOrientation.clone(),
          });
        }
        return cache.get(t);
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
  const guard = new BodyTrajectoryGuard();
  const counterRows = [];
  const originalHook = sim.bodyPairDiagnostics;
  const originalCollector = sim.collectBodyContacts;
  const index = new Map(bodies.map((b, i) => [b, i]));
  const summarizeContacts = (rows) =>
    rows.map((r) => ({
      a: index.get(r.a),
      b: index.get(r.b),
      point: r.point.toArray(),
      pointB: r.pointB?.toArray(),
      normal: r.normal.toArray(),
      sourceType: r.sourceType,
      penetration: r.penetration,
    }));
  const summarizeGuard = (result) => bodies.map((b) => result.get(b));
  const equal = (a, b) => {
    if (Array.isArray(a))
      return (
        Array.isArray(b) &&
        a.length === b.length &&
        a.every((v, i) => equal(v, b[i]))
      );
    if (a && typeof a === "object")
      return (
        b &&
        typeof b === "object" &&
        Object.keys(a).length === Object.keys(b).length &&
        Object.keys(a).every((k) => equal(a[k], b[k]))
      );
    return Object.is(a, b);
  };
  try {
    // Candidate preparation is outside both timed collectors and leaves committed
    // state untouched. Restore prediction references and flags in finally.
    for (const body of bodies) {
      const pose = paths.get(body)(1);
      body.state.predictedPosition = pose.position;
      body.state.predictedOrientation = pose.orientation;
    }
    const cases = [
      {
        name: "contacts",
        legacy: () =>
          summarizeContacts(
            baselineSimulation.VehicleSimulation.prototype.collectBodyContacts.call(
              sim,
              bodies,
            ),
          ),
        optimized: () => summarizeContacts(originalCollector.call(sim, bodies)),
      },
      {
        name: "body guard",
        legacy: () =>
          summarizeGuard(
            baselineGuard.guardBodyTrajectories(
              bodies,
              paths,
              (a, b) => !masks.pedBodyPairExcluded(a, b),
            ),
          ),
        optimized: () =>
          summarizeGuard(
            guard.run(
              bodies,
              paths,
              (a, b) => !masks.pedBodyPairExcluded(a, b),
            ),
          ),
      },
    ];
    const results = [];
    const deadline = performance.now() + 2500;
    for (const item of cases) {
      const expected = item.legacy(),
        actual = item.optimized();
      if (!equal(expected, actual))
        throw new Error(`${item.name}: exact baseline mismatch`);
      const samples = [];
      for (const method of ["legacy", "optimized", "optimized", "legacy"]) {
        if (performance.now() > deadline)
          throw new Error("Comparison exceeded 2.5s bound");
        const start = performance.now(),
          result = item[method](),
          ms = performance.now() - start;
        if (!equal(expected, result))
          throw new Error(`${item.name}: input changed during capture`);
        samples.push({ method, ms });
      }
      results.push({
        name: item.name,
        exact: true,
        resultCount: expected.length,
        samples,
      });
    }
    // Source face-array maps are called exactly once per transformHull in these
    // frozen guard invocations. Sweeps read source planes without mapping them.
    // Count both algorithms outside the timing samples and restore descriptors.
    let transforms = 0;
    const arrays = [
      ...new Set(bodies.flatMap((b) => b.hulls.map((h) => h.faces))),
    ];
    const descriptors = arrays.map((array) =>
      Object.getOwnPropertyDescriptor(array, "map"),
    );
    const transformCounts = {};
    try {
      arrays.forEach((array) => {
        const original = array.map;
        array.map = function (...args) {
          transforms++;
          return original.apply(this, args);
        };
      });
      for (const method of ["legacy", "optimized"]) {
        transforms = 0;
        cases[1][method]();
        transformCounts[method] = transforms;
      }
    } finally {
      arrays.forEach((array, i) => {
        if (descriptors[i]) Object.defineProperty(array, "map", descriptors[i]);
        else delete array.map;
      });
    }
    sim.bodyPairDiagnostics = (phase, counters) =>
      counterRows.push({ phase, ...counters });
    originalCollector.call(sim, bodies);
    const guardCounters = {};
    guard.run(
      bodies,
      paths,
      (a, b) => !masks.pedBodyPairExcluded(a, b),
      guardCounters,
    );
    counterRows.push({ phase: "guard", ...guardCounters });
    return {
      metadata: window.__c2Perf?.metadata(),
      population: {
        bodies: bodies.length,
        movable: bodies.filter((b) => !b.properties.immovable).length,
        debris: sim.debris.length,
      },
      results,
      counterRows,
      transformCounts,
      note: "Frozen live geometry; serial ABBA, all samples retained. Baseline imported from an unchanged source checkout. Collector serialization and path-cache lookup are included. This is not an FPS prediction.",
    };
  } finally {
    sim.bodyPairDiagnostics = originalHook;
    for (const row of saved) {
      row.body.state.predictedPosition = row.predictedPosition;
      row.body.state.predictedOrientation = row.predictedOrientation;
      row.body.overlapDetected = row.overlapDetected;
    }
  }
}
