/** Short serial PERF-19 profile; always launches an isolated Chromium process. */
import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5173" },
    output: { type: "string", default: "artifacts/perf19-world-contacts.json" },
    snapshot: {
      type: "string",
      default: "artifacts/phy16-live-fps9-bodies.json",
    },
    reference: { type: "string" },
    repeats: { type: "string", default: "2" },
    eager: { type: "boolean", default: false },
    track: { type: "string", default: "desert2" },
    "grid-only": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});
if (values.help) {
  console.log(`Bounded original desert2 ordinary-world contact CPU profile.
Usage: node tools/profile-world-contacts.mjs [options]
  --url URL         Existing loopback app server (default http://127.0.0.1:5173)
  --output PATH     JSON in ignored artifacts/; adjacent .cpuprofile is also saved
  --snapshot PATH   Ignored captured-body JSON (default phy16-live-fps9-bodies)
  --grid-only       Fresh original grid only, no captured bodies
  --track STEM      Original race stem; non-desert2 requires --grid-only
  --eager           Disable native preparation scope for a same-build baseline
  --reference PATH  Assert matching fixture/contacts; compare timings and work
  --repeats N       1 or 2 cold/warm passes per workload (default 2)
The browser is isolated; no existing CDP page is attached or changed. Drawing is
suppressed and no simulation ticks/long loops run. Both fixtures use an explicit
40ms production hierarchy prediction, then frozen ordinary worldContacts calls.
The 13s captured poses are not an 81s outlier replay or a complete race restore.
Timings include optional source diagnostics and CDP sampling, using SwiftShader;
they are CPU work measurements, not hardware frame-rate predictions.`);
  process.exit(0);
}
const url = new URL(values.url);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
assert.ok(["http:", "https:"].includes(url.protocol));
const repeats = Number(values.repeats);
assert.ok(repeats === 1 || repeats === 2, "--repeats must be 1 or 2");
assert.match(
  values.track,
  /^[a-z0-9_-]{1,40}$/i,
  "--track must be an original race stem",
);
values.track = values.track.toLowerCase();
assert.ok(
  values.track.toLowerCase() === "desert2" || values["grid-only"],
  "Captured desert2 poses require desert2; use --grid-only for other tracks",
);
const output = resolve(values.output);
const ignored = relative(resolve("artifacts"), output);
assert.ok(
  ignored && !ignored.startsWith("..") && !isAbsolute(ignored),
  "output must be in ignored artifacts/",
);
const executablePath = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await Promise.all([
    access(executablePath),
    access(process.env.CARMA2_ROOT || "carma2_orig"),
    ...(values["grid-only"] ? [] : [access(values.snapshot)]),
  ]);
} catch {
  console.log(
    "SKIP world contact profile: original assets, Chromium or capture absent.",
  );
  process.exit(0);
}
const snapshotText = values["grid-only"]
  ? null
  : await readFile(values.snapshot, "utf8");
assert.ok(
  !snapshotText || Buffer.byteLength(snapshotText) <= 32 * 1024 * 1024,
  "capture exceeds 32 MiB",
);
const snapshot = snapshotText && JSON.parse(snapshotText);
const digest = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const helper = await build({
  entryPoints: ["tools/world-contact-performance-probe.mjs"],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  globalName: "WorldContactProbe",
  logLevel: "silent",
});
function distribution(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
    total: sorted.reduce((a, b) => a + b, 0),
  };
}
const report = {
  capturedAt: new Date().toISOString(),
  objective:
    "Bounded serial original desert2 ordinary worldContacts profiling and contact-result comparison",
  limitations: [
    "Isolated SwiftShader browser, drawing suppressed; CPU timings are not workstation GPU FPS.",
    "Prepared 40ms hierarchy sweep on frozen original-world inputs; no simulation tick or prior history replay.",
    "Captured hulls/poses and flags are restored, not historical damage lifecycle, world actors, caches or random state.",
    "Captured car wheel bounds use original configuration and original scene hubs; prior suspension deformation is not captured.",
    "The default 13s body capture does not reproduce the 81s worldContacts outlier.",
    "Cold/warm labels refer to body face-cache invalidation; global model caches are already loaded.",
  ],
  snapshot: values["grid-only"] ? null : values.snapshot,
  snapshotSha256: snapshotText && digest(snapshotText),
  repeats,
  track: values.track,
  requestedNativePreparation: values.eager ? "eager" : "scoped",
  errors: [],
  failedRequests: [],
  failedResponses: [],
};
let browser;
try {
  browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  await page.addInitScript(() => {
    // Separate catalog selection randomness from asynchronous render/load draws.
    const random = (seed) => () =>
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 0x100000000;
    const selection = random(0x50455246),
      ordinary = random(0x574f524c);
    Math.random = () =>
      (new Error().stack ?? "").includes("selectOpponentIds")
        ? selection()
        : ordinary();
  });
  page.on("pageerror", (error) => report.errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    report.failedRequests.push(
      `${request.url()}: ${request.failure()?.errorText}`,
    ),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      report.failedResponses.push({
        url: response.url(),
        status: response.status(),
      });
  });
  await page.goto(url.href);
  await page.waitForFunction(
    () => window.carma?.stats.ready && window.carma.opponentsReady,
    null,
    { timeout: 90000 },
  );
  await page.evaluate(() => {
    window.carma.paused = true;
  });
  report.build = await page
    .locator('script[type="module"]')
    .getAttribute("src");
  await page.addScriptTag({ content: helper.outputFiles[0].text });
  report.fixture = await page.evaluate(
    ({ snapshot, track }) =>
      WorldContactProbe.prepareWorldContactProfile(snapshot, track),
    { snapshot, track: values.track },
  );
  report.fixtureHash = digest(report.fixture.workloads);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  await cdp.send("Profiler.start");
  const result = await page.evaluate(
    ({ repeats, eager }) =>
      WorldContactProbe.runWorldContactProfile(repeats, eager),
    { repeats, eager: values.eager },
  );
  const { profile } = await cdp.send("Profiler.stop");
  await cdp.send("Profiler.disable");
  report.profile = output.replace(/\.json$/i, "") + ".cpuprofile";
  await mkdir(dirname(output), { recursive: true });
  await writeFile(report.profile, JSON.stringify(profile));
  report.result = result;
  report.nativePreparation = result.nativePreparation;
  report.cases = result.cases.map((entry) => ({
    name: entry.name,
    repeat: entry.repeat,
    cache: entry.cache,
    bodies: entry.rows.length,
    contactCount: entry.rows.reduce(
      (total, row) => total + row.contacts.length,
      0,
    ),
    contactHash: digest(
      entry.rows.map(({ id, contacts }) => ({ id, contacts })),
    ),
    cpuMs: distribution(entry.rows.map((row) => row.cpuMs)),
    diagnostics: entry.rows.flatMap((row) => row.diagnostics),
    syncDiagnostics: entry.syncDiagnostics,
  }));
  report.sourceDiagnosticsAvailable = report.cases.some(
    (entry) => entry.diagnostics.length > 0,
  );
  report.cpuHotFunctions = Object.values(
    profile.nodes.reduce((totals, node) => {
      if (!node.hitCount) return totals;
      const frame = node.callFrame;
      const key = `${frame.url}:${frame.lineNumber}:${frame.functionName}`;
      const row = (totals[key] ??= {
        functionName: frame.functionName,
        url: frame.url,
        line: frame.lineNumber + 1,
        samples: 0,
      });
      row.samples += node.hitCount;
      return totals;
    }, {}),
  )
    .sort((a, b) => b.samples - a.samples)
    .slice(0, 25);
  if (values.reference) {
    const reference = JSON.parse(await readFile(values.reference, "utf8"));
    report.comparison = {
      reference: values.reference,
      sameSnapshot: reference.snapshotSha256 === report.snapshotSha256,
      sameTrack: reference.fixture?.track === report.fixture.track,
      sameFixture: reference.fixtureHash === report.fixtureHash,
      cases: report.cases.map((entry) => {
        const before = reference.cases.find(
          (row) =>
            row.name === entry.name &&
            row.cache === entry.cache &&
            row.repeat === entry.repeat,
        );
        return {
          name: entry.name,
          cache: entry.cache,
          repeat: entry.repeat,
          sameContacts: before?.contactHash === entry.contactHash,
          beforeMs: before?.cpuMs.total ?? null,
          afterMs: entry.cpuMs.total,
          beforeSyncDiagnostics: before?.syncDiagnostics ?? null,
          afterSyncDiagnostics: entry.syncDiagnostics,
          ratio:
            before?.cpuMs.total > 0
              ? entry.cpuMs.total / before.cpuMs.total
              : null,
        };
      }),
    };
    assert.ok(report.comparison.sameSnapshot, "Reference snapshot differs");
    assert.ok(report.comparison.sameTrack, "Reference original track differs");
    assert.ok(report.comparison.sameFixture, "Reference fixture differs");
    assert.equal(
      reference.cases.length,
      report.cases.length,
      "Reference case count differs",
    );
    assert.ok(
      report.comparison.cases.every((entry) => entry.sameContacts),
      "Reference contacts differ",
    );
  }
  assert.ok(
    result.paused && result.elapsed === report.fixture.elapsed,
    "profile advanced simulation",
  );
  console.log(
    JSON.stringify(
      {
        output,
        fixture: report.fixtureHash,
        sourceDiagnosticsAvailable: report.sourceDiagnosticsAvailable,
        nativePreparation: report.nativePreparation,
        cases: report.cases.map(({ diagnostics, ...row }) => row),
        comparison: report.comparison,
      },
      null,
      2,
    ),
  );
} catch (error) {
  report.failure = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
}
if (report.failure) console.error(report.failure);
