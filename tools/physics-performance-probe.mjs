/** Opt-in, bounded same-browser ABBA comparison. Requires the local Vite server
 * for source modules; not imported by the production app. No simulation steps. */
export async function comparePhysicsHotpaths(devUrl = "http://127.0.0.1:5254") {
  const url = new URL(devUrl);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    throw new Error(
      "Physics diagnostics require a local loopback source server",
    );
  const { guardPairTrajectory, guardBodyTrajectories } = await import(
    new URL(`/src/physics/pair-guard.ts?comparison=${Date.now()}`, url).href
  );
  const {
    legacyGuardPairTrajectory,
    legacyGuardBodyTrajectories,
    eagerPenetration,
  } = await import(
    new URL("/tests/support/legacy-physics-guard.mjs", url).href
  );
  const { hullPenetration, transformHull } = await import(
    new URL("/src/physics/geometry.ts", url).href
  );
  const c = window.carma;
  if (!c?.player || !c.simulation) throw new Error("Load original cars first");
  const a = c.player,
    b = c.simulation.cars.find((x) => x !== a);
  const V = a.state.position.constructor,
    Q = a.state.orientation.constructor;
  const origin = a.state.position.clone(),
    orientation = a.state.orientation.clone();
  const forward = new V(0, 0, -1).applyQuaternion(orientation);
  const right = new V(1, 0, 0).applyQuaternion(orientation);
  const path = (offset, travel) => (t) => ({
    position: origin.clone().add(offset).addScaledVector(travel, t),
    orientation: orientation.clone(),
  });
  const cases = [
    [
      "disjoint guard",
      path(new V(), forward.clone().multiplyScalar(0.04)),
      path(right.clone().multiplyScalar(2), new V()),
    ],
    [
      "near parallel guard",
      path(new V(), forward.clone().multiplyScalar(0.05)),
      path(
        right.clone().multiplyScalar(0.55),
        forward.clone().multiplyScalar(0.02),
      ),
    ],
    [
      "clear-end crossing",
      path(
        forward.clone().multiplyScalar(-1.5),
        forward.clone().multiplyScalar(3),
      ),
      path(new V(), new V()),
    ],
  ].map(([name, pa, pb]) => ({
    name,
    legacy: () => legacyGuardPairTrajectory(a, b, pa, pb),
    optimized: () => guardPairTrajectory(a, b, pa, pb),
  }));
  const ha = transformHull(a.hulls[0], origin, orientation);
  for (const [name, distance] of [
    ["face-separated SAT", 0.55],
    ["overlap SAT", 0.1],
  ]) {
    const hb = transformHull(
      b.hulls[0],
      origin.clone().addScaledVector(right, distance),
      orientation,
    );
    cases.push({
      name,
      legacy: () => eagerPenetration(ha, hb),
      optimized: () => hullPenetration(ha, hb),
    });
  }
  const bodies = [a, b, ...c.simulation.noncars];
  const paths = new Map(
    bodies.map((body) => [
      body,
      (t) => ({
        position: body.state.position
          .clone()
          .addScaledVector(body.state.velocity, t * 0.04),
        orientation: body.state.orientation.clone(),
      }),
    ]),
  );
  const summarize = (map) => bodies.map((body) => map.get(body));
  cases.push({
    name: "diagnostic body-group subset",
    legacy: () => summarize(legacyGuardBodyTrajectories(bodies, paths)),
    optimized: () => summarize(guardBodyTrajectories(bodies, paths)),
  });
  const equal = (a, b) =>
    Array.isArray(a)
      ? Array.isArray(b) &&
        a.length === b.length &&
        a.every((x, i) => Object.is(x, b[i]))
      : Object.is(a, b);
  const deadline = performance.now() + 1500;
  const reports = [];
  for (const item of cases) {
    const expected = item.legacy(),
      actual = item.optimized();
    if (!equal(expected, actual))
      throw new Error(`${item.name}: numerical mismatch`);
    const samples = [];
    const calls = item.name.includes("SAT")
      ? 16
      : item.name.includes("body-group")
        ? 2
        : 4;
    for (const method of ["legacy", "optimized", "optimized", "legacy"]) {
      if (performance.now() > deadline)
        throw new Error("Bounded diagnostic exceeded 1.5 seconds");
      const start = performance.now();
      let result;
      for (let i = 0; i < calls; i++) result = item[method]();
      const ms = performance.now() - start;
      if (!equal(result, expected))
        throw new Error(`${item.name}: input changed during capture`);
      samples.push({ method, calls, ms, perCallMs: ms / calls });
    }
    reports.push({ name: item.name, result: expected, samples });
  }
  return {
    note: "Same original live hulls, no game-state mutation or simulation stepping. Body-group subset uses two cars and noncars with linear 40 ms paths, fixed orientations and no native pair predicate; pedestrians, debris and mines excluded. All ABBA samples retained; not an FPS prediction.",
    cars: [a, b].map((x) => ({
      name: x.group.name,
      mass: x.properties.mass,
      features: x.hulls.map((h) => [
        h.vertices.length,
        h.edges.length,
        h.faces.length,
      ]),
    })),
    bodyCount: bodies.length,
    reports,
  };
}
