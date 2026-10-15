import { chromium } from "playwright-core";
import { parseArgs } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { installPerformanceProbe } from "./performance-probe.mjs";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5173" },
    race: { type: "string", default: "snow way out" },
    seconds: { type: "string", default: "2" },
    width: { type: "string", default: "1280" },
    height: { type: "string", default: "800" },
    ratio: { type: "string" },
    drive: { type: "boolean", default: false },
    "no-render": { type: "boolean", default: false },
    "eager-native-preparation": { type: "boolean", default: false },
    software: { type: "boolean", default: false },
    headful: { type: "boolean", default: false },
    "cpu-profile": { type: "boolean", default: false },
    output: { type: "string", default: "artifacts/performance.json" },
    help: { type: "boolean", default: false },
  },
});
if (values.help) {
  console.log(`Short, serial performance capture against an already running server.
Usage: node tools/profile-performance.mjs [options]
  --url URL          Existing local server (default http://127.0.0.1:5173)
  --race NAME        Race label substring or exact original TXT path
  --seconds N        Capture 0.25–5 seconds; default 2
  --width N          CSS viewport width (default 1280, max 3840)
  --height N         CSS viewport height (default 800, max 2160)
  --ratio N          Temporary pixel ratio (default engine policy, max 1.7)
  --drive            Unpause and hold W during the capture; otherwise paused
  --eager-native-preparation  Diagnostic baseline: disable tick-scoped ACT preparation
  --no-render        Diagnostic only: omit GPU rendering during the capture
  --cpu-profile      Also save a CDP CPU profile beside the JSON report
  --software         Explicitly use SwiftShader (not a hardware FPS benchmark)
  --headful          Open an isolated visible browser; may enable hardware GPU
  --output PATH      Report path (default ignored artifacts/performance.json)
The browser closes after one capture. No auto-repeats or parallel load tests.
Normal engine settings are restored; no production behavior is changed.`);
  process.exit(0);
}
const durationMs = Number(values.seconds) * 1000,
  width = Number(values.width),
  height = Number(values.height),
  pixelRatio = values.ratio === undefined ? undefined : Number(values.ratio),
  url = new URL(values.url);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  !["http:", "https:"].includes(url.protocol)
)
  throw new Error("Use a local loopback server URL");
if (
  !Number.isFinite(durationMs) ||
  durationMs < 250 ||
  durationMs > 5000 ||
  !Number.isInteger(width) ||
  width < 320 ||
  width > 3840 ||
  !Number.isInteger(height) ||
  height < 200 ||
  height > 2160 ||
  (pixelRatio !== undefined &&
    (!Number.isFinite(pixelRatio) || pixelRatio <= 0 || pixelRatio > 1.7))
)
  throw new Error("Invalid duration, viewport or pixel ratio; see --help");

let browser;
const errors = [],
  failedRequests = [];
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: !values.headful,
    args: [
      "--no-sandbox",
      ...(values.software
        ? [
            "--enable-unsafe-swiftshader",
            "--use-gl=angle",
            "--use-angle=swiftshader",
          ]
        : []),
    ],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  await page.goto(url.href);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.evaluate(async (race) => {
    const c = window.carma,
      select = document.querySelector("#track-select");
    c.paused = true;
    // Suppress diagnostic rendering while asynchronous assets are loading;
    // loadRace and all resource owners still run normally.
    const render = c.renderer.render;
    c.renderer.render = () => {};
    try {
      const entry = [...select.options].find(
        (option) =>
          option.value === race ||
          option.text.toLowerCase().includes(race.toLowerCase()),
      );
      if (!entry) throw new Error(`Race not installed: ${race}`);
      select.value = entry.value;
      await c.loadRace();
      c.paused = true;
      if (!c.stats.ready) throw new Error("Selected race failed to load");
    } finally {
      c.renderer.render = render;
    }
  }, values.race);
  await page.waitForFunction(
    () => window.carma.opponentsReady && !!window.carma.pedestrians,
    null,
    { timeout: 90000 },
  );
  if (values["eager-native-preparation"])
    await page.evaluate(() => {
      const world = window.carma.simulation.world;
      world.beginNativePreparation = world.endNativePreparation = () => {};
    });
  await page.evaluate(installPerformanceProbe);
  await page.evaluate(() => window.__c2Perf.idle());
  const session = await page.context().newCDPSession(page);
  if (values["cpu-profile"]) {
    await session.send("Profiler.enable");
    await session.send("Profiler.start");
  }
  const report = await page.evaluate(
    (options) => window.__c2Perf.capture(options),
    {
      label: `${values.race}-${values.drive ? "drive" : "paused"}`,
      durationMs,
      paused: !values.drive,
      key: values.drive ? "KeyW" : undefined,
      pixelRatio,
      disableRender: values["no-render"],
    },
  );
  const softwareDetected = /SwiftShader|llvmpipe|software/i.test(
    report.initial.gpu ?? "",
  );
  if (softwareDetected)
    console.error(
      "Software WebGL detected: these FPS values are not a hardware benchmark.",
    );
  if (values["cpu-profile"]) {
    const { profile } = await session.send("Profiler.stop");
    await mkdir(dirname(values.output), { recursive: true });
    await writeFile(`${values.output}.cpuprofile`, JSON.stringify(profile));
  }
  await page.evaluate(() => window.__c2Perf.dispose());
  await mkdir(dirname(values.output), { recursive: true });
  await writeFile(
    values.output,
    JSON.stringify(
      {
        ...report,
        nativePreparation: values["eager-native-preparation"]
          ? "eager"
          : "scoped",
        errors,
        failedRequests,
        softwareRequested: values.software,
        softwareDetected,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify(
      {
        report: values.output,
        gpu: report.initial.gpu,
        softwareDetected,
        drawingBuffer: report.initial.drawingBuffer,
        fps: report.fps,
        frameMs: report.frameMs,
        gpuElapsedMs: report.gpuElapsedMs,
        errors,
        failedRequests,
      },
      null,
      2,
    ),
  );
  if (errors.length || failedRequests.length || report.glError)
    process.exitCode = 1;
} finally {
  await browser?.close();
}
