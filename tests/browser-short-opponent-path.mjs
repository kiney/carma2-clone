import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const assetRoot = process.env.CARMA2_ROOT || "carma2_orig";
try {
  await access(executable);
  await access(assetRoot);
} catch {
  console.log(
    "SKIP short opponent path browser regression: Chromium or C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5234;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
const report = {
  errors: [],
  failedRequests: [],
  failedResponses: [],
  provenance: "",
};
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));

try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/manifest`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) throw new Error(serverLog);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `production server did not start: ${serverLog}`);
  browser = await chromium.launch({
    executablePath: executable,
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
    if (response.status() >= 400) report.failedResponses.push(response.url());
  });
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });

  const choices = await page.evaluate(() => {
    const valueFor = (selector, path) =>
      [...document.querySelector(selector).options].find(
        (option) => option.value.toLowerCase() === path.toLowerCase(),
      )?.value;
    return {
      quarrynet: valueFor(
        "#track-select",
        "data/RACES/quarrynet/quarrynet.txt",
      ),
      greenEagle: valueFor(
        "#car-select",
        "data/CARS/eaglegreen/EAGLEGREEN.TXT",
      ),
    };
  });
  assert.ok(choices.quarrynet, "original quarrynet mission is absent");
  assert.ok(choices.greenEagle, "original GreenEagle car is absent");

  await page.evaluate(
    async ({ trackPath, carPath }) => {
      const c = window.carma;
      document.querySelector("#track-select").value = trackPath;
      document.querySelector("#car-select").value = carPath;
      await c.loadRace();
      c.paused = false;
      document.querySelector("#panel").hidden = true;
    },
    { trackPath: choices.quarrynet, carPath: choices.greenEagle },
  );
  await page.waitForFunction(() => window.carma.opponentsReady, null, {
    timeout: 90000,
  });
  await page.waitForFunction(
    () => window.carma.rivals.length > 0 && !!window.carma.pedestrians,
    null,
    { timeout: 90000 },
  );
  // Allow normal frames to register/materialize the authored fleet before
  // forcing the native objective that exposes the short-route boundary.
  await page.waitForFunction(() => window.carma.stats.gameFrames >= 4, null, {
    timeout: 30000,
  });
  const fixture = await page.evaluate(() => {
    const c = window.carma;
    c.paused = true;
    const fleet = c.opponentFleet;
    const status = fleet.snapshot.rivals.find((r) => r.physical && !r.cheating);
    const rival = status && fleet.rivals.get(status.identity);
    if (!rival) throw new Error("no registered physical noncheating rival");
    window.__shortPathRival = status.identity;
    const before = c.stats.gameFrames;
    // This is the normal objective transition at the current simulation
    // clock; no synthetic future fleet time or route data is injected.
    fleet.transition(rival, "get-near-player");
    const route = [...rival.getNear.entries];
    const sections = c.track.pathSections;
    return {
      identity: status.identity,
      physicsFrames: before,
      sectionCount: sections.length,
      routeLength: route.length,
      route,
      sectionZeroValid: sections[route[0]?.section] !== undefined,
      trackPath: document.querySelector("#track-select").value,
    };
  });
  assert.equal(fixture.sectionCount, 1, "quarrynet must have one path section");
  assert.equal(fixture.routeLength, 12, "GetNearPlayer should seed 12 entries");
  assert.ok(fixture.sectionZeroValid, "route must begin at a valid section");
  assert.ok(
    fixture.route.every(
      (entry) =>
        entry.section === 0 && (entry.direction === 0 || entry.direction === 1),
    ),
    "route should reference the only authored section in a valid direction",
  );

  const start = await page.evaluate(() => {
    const c = window.carma;
    c.paused = false;
    return {
      frames: c.stats.gameFrames,
      renderedFrames: c.stats.frames,
      elapsed: c.simulation.elapsed,
      position: c.player.state.position.toArray(),
    };
  });
  await page.locator("#view").click();
  await page.keyboard.down("w");
  await page.waitForFunction(
    (frame) => window.carma.stats.gameFrames >= frame + 20,
    start.frames,
    { timeout: 30000 },
  );
  await page.keyboard.up("w");
  const live = await page.evaluate((initial) => {
    const c = window.carma;
    c.paused = true;
    return {
      frames: c.stats.gameFrames,
      renderedFrames: c.stats.frames,
      elapsed: c.simulation.elapsed,
      position: c.player.state.position.toArray(),
      moved:
        c.player.state.position.distanceTo({
          x: initial[0],
          y: initial[1],
          z: initial[2],
        }) > 0.01,
      route: [...c.opponentFleet.rivals.values()]
        .find((r) => r.body.group.uuid === window.__shortPathRival)
        ?.getNear.entries.map((entry) => entry.section),
    };
  }, start.position);
  assert.ok(
    live.frames >= start.frames + 20,
    "gameplay frames stopped advancing",
  );
  assert.ok(live.renderedFrames > start.renderedFrames, "rendering stopped");
  assert.ok(live.elapsed >= start.elapsed + 0.16, "physics stopped advancing");
  assert.ok(live.moved, "player did not move during live driving");
  assert.ok(
    live.route?.length === 12 && live.route.every(Number.isFinite),
    `projected route became invalid: ${JSON.stringify(live.route)}`,
  );

  const webglErrors = await page.evaluate(() => {
    const gl = document.querySelector("#view").getContext("webgl2");
    if (!gl) throw new Error("WebGL2 context unavailable");
    const errors = [];
    for (let i = 0; i < 16; i++) {
      const error = gl.getError();
      if (error === gl.NO_ERROR) break;
      errors.push(error);
    }
    return errors;
  });
  assert.deepEqual(
    report.errors,
    [],
    `browser errors: ${report.errors.join(" | ")}`,
  );
  assert.deepEqual(
    report.failedRequests,
    [],
    `failed requests: ${report.failedRequests.join(" | ")}`,
  );
  assert.deepEqual(report.failedResponses, [], "failed asset responses");
  assert.deepEqual(webglErrors, [], `WebGL errors: ${webglErrors.join(",")}`);
  report.provenance =
    "Forced the native GetNearPlayer transition, then drove through ordinary production frames; this does not claim a natural 21-second reproduction.";
  report.choices = choices;
  report.fixture = fixture;
  report.start = start;
  report.live = live;
  report.webglErrors = webglErrors;
  await page.screenshot({ path: "artifacts/browser-short-opponent-path.png" });
  await writeFile(
    "artifacts/browser-short-opponent-path-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error?.stack || error);
  await writeFile(
    "artifacts/browser-short-opponent-path-report.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
