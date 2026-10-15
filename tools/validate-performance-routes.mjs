/** Bounded rendered integration checks in an isolated context of an existing
 * hardware Chromium. Never navigates or changes the user's existing pages.
 * Run against an existing production server; each capture is only 2.5 seconds.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { installPerformanceProbe } from "./performance-probe.mjs";
import { installLivePerformanceRecorder } from "./live-performance-recorder.mjs";

const endpoint = process.env.CDP_URL || "http://127.0.0.1:9222";
const url = process.env.PERF_ROUTE_URL || "http://localhost:5221";
const output =
  process.env.PERF_ROUTE_OUTPUT || "artifacts/perf13-current-routes.json";
const profiling = process.env.PERF_ROUTE_PROFILE === "1";
const bare = process.env.PERF_ROUTE_BARE === "1";
const fixtureSeed =
  process.env.PERF_ROUTE_SEED === undefined
    ? null
    : Number(process.env.PERF_ROUTE_SEED);
assert.ok(
  fixtureSeed === null ||
    (Number.isSafeInteger(fixtureSeed) &&
      fixtureSeed >= 0 &&
      fixtureSeed <= 0xffffffff),
  "PERF_ROUTE_SEED must be an unsigned 32-bit integer",
);
const pairDiagnostics = process.env.PERF_ROUTE_PAIR_DIAGNOSTICS === "1";
const fingerprint = async () => {
  const state = await page.evaluate(() => {
    const c = window.carma,
      sim = c.simulation,
      bodies = sim.allBodies();
    const vector = (value) => value?.toArray() ?? null;
    return {
      // Clocks are deliberately separate: matching geometry is not a claim of
      // deterministic asynchronous loading or an identical timed drive.
      clocks: { elapsed: sim.elapsed, gameTimeMs: c.stats.gameTimeMs },
      rng: {
        math: window.__perfRouteRandom?.state() ?? null,
        native: c.noncarDebris?.random?.state ?? null,
      },
      bodies: bodies.map((body) => ({
        name: body.group?.name ?? body.actor?.name ?? body.name ?? "",
        kind: body.kind ?? (body.damage ? "car" : "body"),
        owner: bodies.indexOf(body.owner),
        part: body.part ?? null,
        position: vector(body.state.position),
        orientation: vector(body.state.orientation),
        velocity: vector(body.state.velocity),
        angularVelocity: vector(body.state.angularVelocity),
        mass: body.properties.mass,
        inertia: vector(body.properties.inertia),
        centerOfMass: vector(body.properties.centerOfMass),
        immovable: body.properties.immovable ?? false,
        hulls: (body.hulls ?? []).map((hull) => ({
          vertices: hull.vertices.map(vector),
          faces: hull.faces.map((face) => ({
            ...face,
            normal: vector(face.normal),
          })),
          edges: hull.edges,
        })),
        attachment: body.joint
          ? {
              type: body.joint.type,
              parent: bodies.indexOf(body.joint.parent),
              childAnchor: vector(body.joint.childAnchor),
              parentAnchor: vector(body.joint.parentAnchor),
              childAxis: vector(body.joint.childAxis),
              parentAxis: vector(body.joint.parentAxis),
            }
          : null,
        parts:
          body.damage?.runtimeParts.map((part) => ({
            actor: part.actor.name,
            mass: part.mass,
            state: { ...part.state },
            position: vector(part.actor.position),
            orientation: vector(part.actor.quaternion),
          })) ?? null,
      })),
    };
  });
  const hash = (value) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return { ...state, sha256: hash(state), bodiesSha256: hash(state.bodies) };
};
assert.ok(
  !profiling || process.env.PERF_ROUTE_CASE,
  "Select one PERF_ROUTE_CASE when capturing a CPU profile",
);
for (const address of [endpoint, url]) {
  const parsed = new URL(address);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname));
}
const distribution = (values) => {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return null;
  return {
    count: rows.length,
    mean: rows.reduce((a, b) => a + b, 0) / rows.length,
    p50: rows[Math.ceil(rows.length * 0.5) - 1],
    p95: rows[Math.ceil(rows.length * 0.95) - 1],
    p99: rows[Math.ceil(rows.length * 0.99) - 1],
    max: rows.at(-1),
  };
};
await mkdir("artifacts", { recursive: true });
const browser = await chromium.connectOverCDP(endpoint);
const context = await browser.newContext({
  viewport: { width: 2100, height: 1466 },
});
if (fixtureSeed !== null) {
  await context.addInitScript((seed) => {
    let value = seed >>> 0,
      draws = 0;
    window.__perfRouteRandom = {
      reset(next) {
        value = next >>> 0;
        draws = 0;
      },
      state() {
        return { value, draws };
      },
    };
    // Benchmark-only LCG; the native stream retains its real engine algorithm.
    Math.random = () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      draws++;
      return value / 0x100000000;
    };
  }, fixtureSeed);
}
const page = await context.newPage();
const report = {
  fixture: {
    seed: fixtureSeed,
    pairDiagnostics,
    note: "Opt-in benchmark seeding only. Compare initial bodiesSha256 before claiming the same fixture; wall-clock warmup and capture remain nondeterministic.",
  },
  cases: [],
  errors: [],
  failedRequests: [],
  failedResponses: [],
};
page.on("pageerror", (error) => report.errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error") report.errors.push(message.text());
});
page.on("requestfailed", (request) =>
  report.failedRequests.push(request.url()),
);
page.on("response", (response) => {
  if (response.status() >= 400) report.failedResponses.push(response.url());
});
try {
  await page.goto(url);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.bringToFront();
  for (const scenario of [
    { name: "timber-start", track: "timber2" },
    { name: "timber-damaged-grid", track: "timber2", damaged: true },
    { name: "timber-canyon-forward", track: "timber2", node: 192 },
    {
      name: "timber-canyon-reverse",
      track: "timber2",
      node: 192,
      reverse: true,
    },
    { name: "snow-start", track: "skitrack3" },
  ]) {
    if (
      process.env.PERF_ROUTE_CASE &&
      scenario.name !== process.env.PERF_ROUTE_CASE
    )
      continue;
    await page.evaluate(
      async ({ scenario, seed }) => {
        const c = window.carma;
        c.paused = true;
        if (seed !== null) {
          window.__perfRouteRandom.reset(seed);
          const seedRandom = c.player.damage.damageContext.seedRandom;
          if (typeof seedRandom !== "function")
            throw new Error("Native seed owner absent");
          seedRandom(seed);
        }
        document.querySelector("#track-select").value = c.assets.resolve(
          `data/RACES/${scenario.track}/${scenario.track}.txt`,
        );
        document.querySelector("#car-select").value = c.assets.resolve(
          "data/CARS/eagle3/eagle3.txt",
        );
        await c.loadRace();
        c.paused = true;
        document.querySelector("#panel").hidden = true;
      },
      { scenario, seed: fixtureSeed },
    );
    await page.waitForFunction(() => window.carma.opponentsReady, null, {
      timeout: 90000,
    });
    const setup = await page.evaluate(
      ({ scenario, seed }) => {
        const c = window.carma,
          car = c.player;
        if (scenario.node !== undefined) {
          const node = c.track.pathNodes[scenario.node];
          const edge = c.track.pathEdges.find((edge) =>
            edge.includes(scenario.node),
          );
          if (!node || !edge) throw new Error("Authored route node absent");
          const target =
            c.track.pathNodes[edge.find((index) => index !== scenario.node)];
          car.state.position.fromArray(node);
          car.state.position.y += 0.1;
          car.state.heading =
            Math.atan2(-(target[0] - node[0]), -(target[2] - node[2])) +
            (scenario.reverse ? Math.PI : 0);
          c.simulation.reset(car);
        }
        // Async asset initialization can consume unrelated random draws. Start
        // the explicit damage operation from the requested stream state again.
        if (seed !== null) {
          window.__perfRouteRandom.reset(seed);
          car.damage.damageContext.seedRandom(seed);
        }
        const requests = [];
        if (scenario.damaged) {
          for (const body of c.simulation.cars.slice(0, 3)) {
            const result = c.simulation.spamCar(body, 0.35);
            requests.push({
              name: body.group.name,
              detached: result?.detachedParts.length ?? 0,
            });
          }
        }
        return {
          requests,
          position: car.state.position.toArray(),
          heading: car.state.heading,
        };
      },
      { scenario, seed: fixtureSeed },
    );
    const initialFixture = await fingerprint();
    await page.evaluate(installPerformanceProbe);
    const gpu = await page.evaluate(() => window.__c2Perf.metadata().gpu);
    assert.ok(
      gpu && !/SwiftShader|llvmpipe|software/i.test(gpu),
      `Hardware GPU required: ${gpu}`,
    );
    // One short warm-up is retained separately, never silently excluded.
    const warmup = await page.evaluate(() =>
      window.__c2Perf.capture({
        label: "warmup",
        durationMs: 500,
        paused: false,
        key: "KeyW",
      }),
    );
    if (bare) await page.evaluate(() => window.__c2Perf.dispose());
    else await page.evaluate(installLivePerformanceRecorder);
    const captureFixture = await fingerprint();
    if (pairDiagnostics)
      await page.evaluate(() => {
        const sim = window.carma.simulation,
          previous = sim.bodyPairDiagnostics;
        const capture = { rows: [], totals: {}, dropped: 0 };
        window.__perfRoutePairs = capture;
        sim.bodyPairDiagnostics = (phase, counters) => {
          previous?.(phase, counters);
          const numeric = Object.fromEntries(
            Object.entries(counters).filter(
              ([, value]) =>
                typeof value === "number" && Number.isFinite(value),
            ),
          );
          const totals = (capture.totals[phase] ??= {});
          for (const [key, value] of Object.entries(numeric))
            totals[key] = (totals[key] ?? 0) + value;
          if (capture.rows.length < 2048)
            capture.rows.push({ phase, ...numeric });
          else capture.dropped++;
        };
        capture.restore = () => {
          sim.bodyPairDiagnostics = previous;
        };
      });
    const session = await context.newCDPSession(page);
    if (profiling) {
      await session.send("Profiler.enable");
      await session.send("Profiler.start");
    }
    const capture = await page.evaluate(async (name) => {
      if (window.__c2Perf)
        return window.__c2Perf.capture({
          label: name,
          durationMs: 2500,
          paused: false,
          key: "KeyW",
        });
      // Only a RAF interval sampler; no engine method/tick/contact wrappers.
      const c = window.carma,
        gl = c.renderer.getContext();
      const metadata = () => ({
        position: c.player.state.position.toArray(),
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      });
      const initial = metadata(),
        skipped = c.stats.physicsSkippedMs;
      const elapsed = c.simulation.elapsed,
        intervals = [],
        start = performance.now();
      let previous = start,
        raf;
      const frame = () => {
        const now = performance.now();
        intervals.push(now - previous);
        previous = now;
        raf = requestAnimationFrame(frame);
      };
      c.renderer.domElement.dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }),
      );
      c.paused = false;
      raf = requestAnimationFrame(frame);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      c.paused = true;
      c.renderer.domElement.dispatchEvent(
        new KeyboardEvent("keyup", { code: "KeyW", bubbles: true }),
      );
      cancelAnimationFrame(raf);
      const duration = performance.now() - start,
        sorted = [...intervals].sort((a, b) => a - b);
      return {
        bare: true,
        initial,
        final: metadata(),
        actualDurationMs: duration,
        fps: (intervals.length * 1000) / duration,
        frameMs: {
          count: intervals.length,
          mean: intervals.reduce((a, b) => a + b, 0) / intervals.length,
          p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
          p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
          p99: sorted[Math.ceil(sorted.length * 0.99) - 1],
          max: sorted.at(-1),
        },
        physicsSkippedMs: c.stats.physicsSkippedMs - skipped,
        simulationAdvancedMs: (c.simulation.elapsed - elapsed) * 1000,
        glError: gl.getError(),
      };
    }, scenario.name);
    if (profiling) {
      const { profile } = await session.send("Profiler.stop");
      await writeFile(`${output}.cpuprofile`, JSON.stringify(profile));
    }
    await session.detach();
    const live = await page.evaluate(() => {
      const recorder = window.__perf01LiveRecorder;
      const result = recorder?.snapshot() ?? {
        columns: { ticks: [], updates: [] },
        rows: { ticks: [], updates: [] },
      };
      recorder?.stop();
      window.__c2Perf?.dispose();
      const c = window.carma;
      const pairs = window.__perfRoutePairs;
      pairs?.restore();
      return {
        ...result,
        pairGuard: pairs
          ? { rows: pairs.rows, totals: pairs.totals, dropped: pairs.dropped }
          : null,
        quiet: c.simulation.quietCensus(),
        debris: c.simulation.debris.length,
        activeCars: c.simulation.cars.filter((car) =>
          c.simulation.isCarPhysicsActive(car),
        ).length,
      };
    });
    const column = (kind, name) =>
      live.rows[kind].map((row) => row[live.columns[kind].indexOf(name)]);
    const result = {
      scenario,
      setup,
      initialFixture,
      captureFixture,
      warmup,
      capture,
      live,
      summary: {
        fps: capture.fps,
        frameMs: capture.frameMs,
        tickMs: distribution(column("ticks", "cpuMs")),
        updateMs: distribution(column("updates", "cpuMs")),
        ticksPerUpdate: distribution(column("updates", "ticks")),
        executedTicks: bare ? null : live.rows.ticks.length,
        tickRate: bare
          ? null
          : (live.rows.ticks.length * 1000) / capture.actualDurationMs,
        skippedMs: capture.physicsSkippedMs,
        displacement: Math.hypot(
          ...capture.final.position.map(
            (value, i) => value - capture.initial.position[i],
          ),
        ),
      },
    };
    assert.equal(capture.glError, 0);
    await page.screenshot({
      path: `artifacts/perf13-route-${scenario.name}.png`,
    });
    report.cases.push(result);
    await writeFile(output, JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        name: scenario.name,
        gpu,
        buffer: capture.initial.drawingBuffer,
        ...result.summary,
      }),
    );
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  assert.deepEqual(report.failedResponses, []);
} finally {
  await writeFile(output, JSON.stringify(report, null, 2));
  await context.close();
  // Disconnecting must not close the user's Chromium instance.
}
process.exit(0);
