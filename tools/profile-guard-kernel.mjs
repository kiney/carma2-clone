/** Serial source-checkout A/B fixture with original assets. No long simulation.
 * Includes cold samples; source URLs must be loopback. Leaves user tabs alone.
 */
import { chromium } from "playwright-core";
import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import assert from "node:assert/strict";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5194" },
    baseline: { type: "string", default: "http://localhost:5195" },
    output: { type: "string", default: "artifacts/perf13-kernel-browser.json" },
    hardware: { type: "boolean", default: false },
    samples: { type: "string", default: "4" },
    root: { type: "string" },
    "cpu-profile": { type: "boolean", default: false },
    "allow-motion-changes": { type: "boolean", default: false },
    "allow-participation-changes": { type: "boolean", default: false },
  },
});
for (const input of [values.url, values.baseline]) {
  const url = new URL(input);
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("Use loopback source servers");
}
if (!["2", "4"].includes(values.samples))
  throw new Error("Use two A/B or four ABBA samples");
if (values.root && !["data", "adv_data"].includes(values.root))
  throw new Error("Use the data or adv_data catalog root");
const report = {
  outcomePolicy: values["allow-participation-changes"]
    ? "Equal initial cars/parts and retained noncar counts required; changing active NONCAR participation is intentional. Full-roster and resulting-state equality are reported, not required; not native conformance."
    : values["allow-motion-changes"]
      ? "Equal initial fixture required; intentional native movement differences are reported, not rejected. This is timing evidence, not native conformance."
      : "Exact old/new initial state, outcomes and guard fractions required.",
  note: "Two exact manual physics ticks plus one whole40ms updateFrame per prepared case and a separate bounded250ms CPU-only frame sample; this recreated fixture is not the exact preceding user frame. No long-running simulation. Traced first-tick time includes attribution overhead; second tick disables counters/guard tracing. Hardware/software backend is recorded, never inferred from launch flags.",
  cases: [],
  errors: [],
  requests: [],
  navigationAborts: [],
};
let browser, browserServer;
let navigating = false;
const bounded = (promise, ms, label) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
};
function distribution(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    count: values.length,
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    max: sorted.at(-1),
  };
}
try {
  browserServer = await chromium.launchServer({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: !values.hardware,
    args: values.hardware
      ? ["--no-sandbox", "--use-gl=angle", "--use-angle=gl"]
      : [
          "--no-sandbox",
          "--enable-unsafe-swiftshader",
          "--use-gl=angle",
          "--use-angle=swiftshader",
        ],
  });
  browser = await bounded(
    chromium.connect(browserServer.wsEndpoint()),
    20000,
    "Browser connection",
  );
  const page = await bounded(
    browser.newPage({
      viewport: { width: 1414, height: 988 },
      deviceScaleFactor: 1.484375,
    }),
    20000,
    "Page creation",
  );
  page.on("pageerror", (e) => report.errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") report.errors.push(m.text());
  });
  page.on("requestfailed", (r) => {
    const failure = r.url() + ": " + r.failure()?.errorText;
    // Destroying the preceding document cancels its optional asynchronous
    // assets. Retain these separately; running-scene failures remain fatal.
    if (navigating && r.failure()?.errorText === "net::ERR_ABORTED")
      report.navigationAborts.push(failure);
    else report.requests.push(failure);
  });
  for (const dataRoot of values.root ? [values.root] : ["data", "adv_data"]) {
    const order =
      values.samples === "2"
        ? ["baseline", "optimized"]
        : ["baseline", "optimized", "optimized", "baseline"];
    const samples = [];
    for (const mode of order) {
      const url = mode === "baseline" ? values.baseline : values.url;
      navigating = true;
      try {
        await page.goto(url, { timeout: 90000 });
      } finally {
        navigating = false;
      }
      await page.waitForFunction(
        () => window.carma?.stats.ready && window.carma.opponentsReady,
        null,
        { timeout: 90000 },
      );
      await page.evaluate(() => {
        carma.paused = true;
        carma.renderer.render = () => {};
      });
      await page.waitForLoadState("networkidle", { timeout: 90000 });
      const profiler = values["cpu-profile"]
        ? await page.context().newCDPSession(page)
        : undefined;
      if (profiler) {
        await profiler.send("Profiler.enable");
        await profiler.send("Profiler.start");
      }
      const result = await bounded(
        page.evaluate(
          async ({ dataRoot }) => {
            const { runCorrectionVariant } = await import(
              "/tools/correction-performance-probe.mjs"
            );
            return runCorrectionVariant({
              track: dataRoot + "/RACES/timber2/timber2.txt",
              reuse: true,
              seed: 0x50455246,
              traceFirstTick: true,
              frameMs: 250,
            });
          },
          { dataRoot },
        ),
        120000,
        "Correction fixture",
      );
      if (profiler) {
        const { profile } = await profiler.send("Profiler.stop");
        const profilePath = values.output.replace(
          /\.json$/,
          `-${dataRoot}-${samples.length}-${mode}.cpuprofile`,
        );
        await mkdir(dirname(profilePath), { recursive: true });
        await writeFile(profilePath, JSON.stringify(profile));
        result.cpuProfile = profilePath;
        await profiler.detach();
      }
      await page.evaluate(() => {
        carma.paused = true;
        carma.renderer.render = () => {};
      });
      await page.waitForLoadState("networkidle", { timeout: 90000 });
      samples.push({ mode, result });
      console.log(
        JSON.stringify({
          dataRoot,
          mode,
          manual: result.manualStepMs,
          frames: result.frameMs,
          steps: distribution(result.frameStepSamples),
          gpu: result.gpu,
        }),
      );
    }
    const comparableInitial = (result) =>
      values["allow-participation-changes"]
        ? {
            bodies: result.initialState.bodies.filter(
              (body) => !body.key.startsWith("actor:"),
            ),
            retainedNonCars: result.population.noncars,
          }
        : result.initialState;
    const initial = JSON.stringify(comparableInitial(samples[0].result)),
      state = JSON.stringify(samples[0].result.deterministicState),
      fractions = JSON.stringify(samples[0].result.tracedFractions);
    const comparison = {
      dataRoot,
      exactInitial: samples.every(
        (s) => JSON.stringify(comparableInitial(s.result)) === initial,
      ),
      exactInitialFullRoster: samples.every(
        (s) =>
          JSON.stringify(s.result.initialState) ===
          JSON.stringify(samples[0].result.initialState),
      ),
      exactState: samples.every(
        (s) => JSON.stringify(s.result.deterministicState) === state,
      ),
      exactFractions: samples.every(
        (s) => JSON.stringify(s.result.tracedFractions) === fractions,
      ),
      samples: samples.map(({ mode, result: r }) => ({
        mode,
        gpu: r.gpu,
        buffer: r.drawingBuffer,
        manualStepMs: r.manualStepMs,
        manualFrameUpdateMs: r.manualFrameUpdateMs,
        manualFrameCounts: r.manualFrameCounts,
        manualFrameWorkCounts: r.manualFrameWorkCounts,
        manualFrameDiagnostics: r.manualFrameDiagnostics,
        frameMs: r.frameMs,
        frameUpdateMs: r.frameUpdateMs,
        ticksPerFrameUpdate: r.ticksPerFrameUpdate,
        frameWindowCounts: r.frameWindowCounts,
        frameStepMs: distribution(r.frameStepSamples),
        diagnostics: r.tracedDiagnostics,
        collectionWork: r.tracedCollectionWork,
        initialBodyCount: r.initialState.bodies.length,
        retainedNonCars: r.population.noncars,
        bodyCount: r.deterministicState.bodies.length,
        impactCount: r.deterministicState.impacts.length,
        cpuProfile: r.cpuProfile,
        ...(values["allow-motion-changes"]
          ? {
              resultingState: r.deterministicState,
              fractions: r.tracedFractions,
            }
          : {}),
      })),
    };
    report.cases.push(comparison);
    assert(
      comparison.exactInitial &&
        (values["allow-motion-changes"] ||
          values["allow-participation-changes"] ||
          (comparison.exactState && comparison.exactFractions)),
      "Numerical fixture changed",
    );
  }
  assert.equal(report.errors.length, 0);
  assert.equal(report.requests.length, 0);
} catch (error) {
  report.fatal = String(error);
  throw error;
} finally {
  await mkdir(dirname(values.output), { recursive: true });
  await writeFile(values.output, JSON.stringify(report, null, 2));
  if (browserServer) {
    // A hung GPU/context may also prevent a protocol-level Browser.close.
    // This server owns only our isolated process, never the user's Chromium.
    await bounded(browserServer.close(), 5000, "Browser cleanup").catch(() =>
      browserServer.kill(),
    );
  }
}
console.log(
  JSON.stringify({
    output: values.output,
    cases: report.cases.map((c) => ({
      dataRoot: c.dataRoot,
      exactState: c.exactState,
      exactFractions: c.exactFractions,
    })),
  }),
);
