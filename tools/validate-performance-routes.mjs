/** Bounded rendered integration checks in an isolated context of an existing
 * hardware Chromium. Never navigates or changes the user's existing pages.
 * Run against an existing production server; each capture is only 2.5 seconds.
 */
import assert from "node:assert/strict";
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
const page = await context.newPage();
const report = {
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
    await page.evaluate(async (scenario) => {
      const c = window.carma;
      c.paused = true;
      document.querySelector("#track-select").value = c.assets.resolve(
        `data/RACES/${scenario.track}/${scenario.track}.txt`,
      );
      document.querySelector("#car-select").value = c.assets.resolve(
        "data/CARS/eagle3/eagle3.txt",
      );
      await c.loadRace();
      c.paused = true;
      document.querySelector("#panel").hidden = true;
    }, scenario);
    await page.waitForFunction(() => window.carma.opponentsReady, null, {
      timeout: 90000,
    });
    const setup = await page.evaluate((scenario) => {
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
    }, scenario);
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
      return {
        ...result,
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
