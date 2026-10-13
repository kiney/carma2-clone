/** Serial, bounded PERF-12 ABBA capture on stock and Advanced Timber. */
import { chromium } from "playwright-core";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5173" },
    output: { type: "string", default: "artifacts/perf12-corrections.json" },
    width: { type: "string", default: "1280" },
    height: { type: "string", default: "800" },
    seed: { type: "string", default: "1346714182" },
    samples: { type: "string", default: "4" },
    "trace-off": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (values.help) {
  console.log(`Bounded serial correction-pass A/B capture on original Timber assets.
Usage: node tools/profile-corrections.mjs [options]
  --url URL       Existing loopback app server (default http://127.0.0.1:5173)
  --output PATH   Ignored JSON report (default artifacts/perf12-corrections.json)
  --width N       CSS viewport width (default 1280)
  --height N      CSS viewport height (default 800)
  --seed N        Deterministic application/random seed
  --samples N     1 for fixture check; 2 for A/B; 4 for ABBA (default 4)
  --trace-off     Time the first heavy tick without counters/fraction tracing
Each stock/Advanced Timber variant reloads from the same initial state and runs
two manual physics ticks plus a 250 ms CPU-only frame sample. ABBA order is
reuse off/on/on/off. Chromium uses SwiftShader; no hardware FPS claim is made.`);
  process.exit(0);
}
const url = new URL(values.url),
  width = Number(values.width),
  height = Number(values.height),
  seed = Number(values.seed);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  !["http:", "https:"].includes(url.protocol)
)
  throw new Error("Use a local loopback server URL");
if (
  !Number.isInteger(width) ||
  width < 320 ||
  width > 3840 ||
  !Number.isInteger(height) ||
  height < 200 ||
  height > 2160 ||
  !Number.isSafeInteger(seed)
)
  throw new Error("Invalid viewport or seed; see --help");

if (!["1", "2", "4"].includes(values.samples))
  throw new Error("--samples must be 1, 2 or 4");
const variants =
    values.samples === "1"
      ? [false]
      : values.samples === "2"
        ? [false, true]
        : [false, true, true, false],
  report = {
    objective:
      "Compare unchanged collision work across correction passes in a controlled prepared Timber state",
    backendPolicy:
      "CPU-only simulation timings with drawing suppressed; actual WebGL backend recorded; no FPS prediction",
    variantOrder: variants.map((reuse) => (reuse ? "on" : "off")),
    cases: [],
    errors: [],
    failedRequests: [],
    failedResponses: [],
  };
let browser;
let page;

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

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function firstDifference(a, b, path = "$") {
  if (Object.is(a, b)) return undefined;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return { path, a, b };
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const difference = firstDifference(a[key], b[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return undefined;
}

function summarize(result, screenshot) {
  const stateHash = digest(result.deterministicState),
    initialStateHash = digest(result.initialState),
    impactHash = digest(result.deterministicState.impacts),
    impacts = result.deterministicState.impacts.length,
    bodies = result.deterministicState.bodies.length;
  return {
    track: result.track,
    reuse: result.reuse,
    prepared: result.prepared,
    population: result.population,
    detachedParts: result.detachedParts,
    runtimePartCount: result.runtimePartCount,
    detachmentRequests: result.detachmentRequests,
    bodyCount: bodies,
    impactCount: impacts,
    stateHash,
    initialStateHash,
    impactHash,
    fractionHash: digest(result.tracedFractions),
    manualTickMs: result.manualTickMs,
    firstStepMs: result.manualStepMs[0],
    traceFirstTick: result.traceFirstTick,
    traceStepMs: result.traceFirstTick ? result.manualStepMs[0] : null,
    minimalStepMs: result.manualStepMs[1],
    tracedDiagnostics: result.tracedDiagnostics,
    tracedSafeFractions: result.tracedFractions,
    frameCaptureMs: result.frameCaptureMs,
    frameMs: result.frameMs,
    frameStepMs: distribution(result.frameStepSamples),
    gpu: result.gpu,
    drawingBuffer: result.drawingBuffer,
    dpr: result.dpr,
    glError: result.glError,
    elapsedCaseMs: result.elapsedCaseMs,
    screenshot,
  };
}

try {
  await mkdir(dirname(values.output), { recursive: true });
  await mkdir("artifacts", { recursive: true });
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
    ],
  });
  page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (error) => report.errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    report.failedRequests.push(request.url()),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      report.failedResponses.push({
        status: response.status(),
        url: response.url(),
      });
  });
  await page.goto(url.href);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  const tracks = await page.evaluate(() => {
    const options = [...document.querySelector("#track-select").options],
      stock = options.find(
        (option) =>
          option.value.startsWith("data/") &&
          /timber2\/timber2\.txt$/i.test(option.value),
      )?.value,
      advanced = options.find(
        (option) =>
          option.value.startsWith("adv_data/") &&
          /timber2\/timber2\.txt$/i.test(option.value),
      )?.value;
    return { stock, advanced };
  });
  if (!tracks.stock || !tracks.advanced)
    throw new Error("Stock and Advanced Timber catalog entries are required");

  for (const [label, track] of [
    ["stock", tracks.stock],
    ["advanced", tracks.advanced],
  ]) {
    const samples = [];
    for (let index = 0; index < variants.length; index++) {
      await page.evaluate(() => (window.carma.paused = true));
      const reuse = variants[index],
        result = await page.evaluate(
          async (options) =>
            (
              await import("/tools/correction-performance-probe.mjs")
            ).runCorrectionVariant(options),
          {
            track,
            reuse,
            seed,
            frameMs: 250,
            traceFirstTick: !values["trace-off"],
          },
        );
      const screenshot = `artifacts/perf12-${label}-${reuse ? "on" : "off"}-${index + 1}.png`;
      await page.waitForTimeout(100);
      await page.screenshot({ path: screenshot });
      samples.push({ result, summary: summarize(result, screenshot) });
      console.log(
        JSON.stringify({
          progress: `${label} ${index + 1}/${variants.length}`,
          reuse,
          traceMs: result.manualStepMs[0],
          minimalMs: result.manualStepMs[1],
          diagnostics: result.tracedDiagnostics,
        }),
      );
      if (result.glError)
        throw new Error(`WebGL error in ${label} ${reuse ? "on" : "off"} case`);
      if (result.elapsedCaseMs > 2000)
        throw new Error(`Case exceeded the 2s cap: ${result.elapsedCaseMs} ms`);
    }
    const baseline = samples[0].result.deterministicState,
      initialBaseline = samples[0].result.initialState,
      fractionBaseline = samples[0].result.tracedFractions,
      comparisons = samples.map(({ result }, index) => ({
        variant: index + 1,
        reuse: result.reuse,
        equalInitialState:
          JSON.stringify(result.initialState) ===
          JSON.stringify(initialBaseline),
        initialStateDifference: firstDifference(
          initialBaseline,
          result.initialState,
        ),
        equalToInitialOff:
          JSON.stringify(result.deterministicState) ===
          JSON.stringify(baseline),
        firstDifference: firstDifference(baseline, result.deterministicState),
        exactSafeFractionMatch:
          JSON.stringify(result.tracedFractions) ===
          JSON.stringify(fractionBaseline),
        fractionDifference: firstDifference(
          fractionBaseline,
          result.tracedFractions,
        ),
      })),
      byMode = [false, true].map((reuse) => {
        const chosen = samples.filter(
            (sample) => sample.result.reuse === reuse,
          ),
          manual = chosen.flatMap((sample) => sample.result.manualStepMs),
          frames = chosen.flatMap((sample) => sample.result.frameIntervals),
          frameSteps = chosen.flatMap(
            (sample) => sample.result.frameStepSamples,
          );
        return {
          reuse: reuse ? "on" : "off",
          cases: chosen.length,
          manualTickMs: distribution(manual),
          frameMs: distribution(frames),
          frameStepMs: distribution(frameSteps),
          correctionWork: chosen.map(
            (sample) => sample.result.tracedDiagnostics,
          ),
        };
      });
    const caseReport = {
      label,
      track,
      exactInitialStateMatch: comparisons.every(
        (comparison) => comparison.equalInitialState,
      ),
      exactSafeFractionMatch: comparisons.every(
        (comparison) => comparison.exactSafeFractionMatch,
      ),
      exactDeterministicStateMatch: comparisons.every(
        (comparison) => comparison.equalToInitialOff,
      ),
      comparisons,
      modes: byMode,
      samples: samples.map((sample) => sample.summary),
      gpu: samples[0].result.gpu,
      drawingBuffer: samples[0].result.drawingBuffer,
      dpr: samples[0].result.dpr,
      note: "Each sample reloads the same track and reconstructs the prepared state. Two manual physics ticks produce the exact state/impact/fraction comparison. The first tick has optional correction counters and safe-fraction tracing (see traceFirstTick); the second tick has counters disabled. A separate 250 ms frame sample runs normal AI and physics with drawing suppressed; its frame/tick timings are timing-only because it advances beyond the compared snapshot.",
    };
    for (const sample of samples) delete sample.result;
    report.cases.push(caseReport);
    if (!caseReport.exactInitialStateMatch)
      report.errors.push(`${label}: fixture inputs changed between variants`);
    if (
      !caseReport.exactDeterministicStateMatch ||
      !caseReport.exactSafeFractionMatch
    )
      report.errors.push(
        `${label}: cache modes changed deterministic state or fractions`,
      );
  }
  const software = report.cases.some((item) =>
    /SwiftShader|llvmpipe|software/i.test(item.gpu ?? ""),
  );
  report.softwareBackendDetected = software;
  report.viewport = { width, height, seed };
  if (
    report.errors.length ||
    report.failedRequests.length ||
    report.failedResponses.length
  )
    throw new Error(
      JSON.stringify({
        errors: report.errors,
        failedRequests: report.failedRequests,
        failedResponses: report.failedResponses,
      }),
    );
  console.log(
    JSON.stringify({ output: values.output, cases: report.cases }, null, 2),
  );
} catch (error) {
  report.fatal = String(error);
  throw error;
} finally {
  if (page && !page.isClosed()) {
    await page
      .evaluate(async () => {
        const c = window.carma;
        if (!c?.renderer) return;
        const renderer = c.renderer,
          savedRender = renderer.render;
        c.paused = true;
        renderer.render = () => {};
        try {
          await c.loadRace();
          c.paused = true;
        } finally {
          renderer.render = savedRender;
          c.paused = true;
        }
      })
      .catch((error) => {
        report.cleanupError = String(error);
      });
  }
  await writeFile(values.output, JSON.stringify(report, null, 2) + "\n");
  await browser?.close();
}
