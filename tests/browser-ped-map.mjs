import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log("SKIP pedestrian map: Chromium or original installation absent");
  process.exit(0);
}
const port = Number(process.env.PED_MAP_PORT || 5263);
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "",
  browser;
const report = { errors: [], failedRequests: [] };
server.stdout.on("data", (data) => (log += data));
server.stderr.on("data", (data) => (log += data));
await mkdir("artifacts", { recursive: true });
try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/manifest`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) throw new Error(log);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, log);
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
    viewport: { width: 1024, height: 768 },
  });
  page.on("pageerror", (error) => report.errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    report.failedRequests.push(request.url()),
  );
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.evaluate(async () => {
    const c = window.carma;
    document.querySelector("#track-select").value = c.assets.resolve(
      "data/RACES/newcity1/newcity1.txt",
    );
    document.querySelector("#car-select").value = c.assets.resolve(
      "data/CARS/EAGLE3/EAGLE3.TXT",
    );
    await c.loadRace();
    c.paused = true;
    document.querySelector("#panel").hidden = true;
  });
  await page.waitForFunction(() => window.carma.pedestrians?.count > 0, null, {
    timeout: 90000,
  });
  await page.evaluate(() => {
    const c = window.carma,
      canvas = document.querySelector("#map"),
      ctx = canvas.getContext("2d");
    const offset = 52 * 4,
      palette = c.assets.palette;
    const rgb = Array.from(palette.slice(offset, offset + 3));
    // Canvas exposes opaque RGB fill styles as canonical #rrggbb strings.
    const colorContext = document.createElement("canvas").getContext("2d");
    colorContext.fillStyle = `rgb(${rgb.join(", ")})`;
    const color = colorContext.fillStyle;
    window.__pedMap = { rgb, color, frames: 0, points: [] };
    const clear = ctx.clearRect.bind(ctx),
      fill = ctx.fillRect.bind(ctx);
    ctx.clearRect = (...args) => {
      window.__pedMap.points = [];
      window.__pedMap.frames++;
      return clear(...args);
    };
    ctx.fillRect = (x, y, w, h) => {
      if (w === 1 && h === 1 && ctx.fillStyle === color)
        window.__pedMap.points.push([x, y]);
      return fill(x, y, w, h);
    };
    window.__pedMapRead = () => {
      const state = window.__pedMap;
      const matching = state.points.filter(([x, y]) => {
        const pixel = ctx.getImageData(x, y, 1, 1).data;
        return state.rgb.every((n, i) => pixel[i] === n) && pixel[3] === 255;
      });
      return {
        active: c.powerups.pedestriansOnMap,
        count: state.points.length,
        matchingPixels: matching.length,
        frames: state.frames,
        rgb: state.rgb,
        definition: {
          index: c.powerups.definitions[24].index,
          duration: c.powerups.definitions[24].duration,
          action: c.powerups.definitions[24].action,
        },
        eligible: c.pedestrians.states.filter((p) => p.alive && p.active)
          .length,
      };
    };
  });
  await page.waitForFunction(() => window.__pedMap.frames >= 2);
  report.initial = await page.evaluate(() => window.__pedMapRead());
  assert.equal(report.initial.active, false);
  assert.equal(report.initial.count, 0);
  assert.ok(
    report.initial.eligible > 0,
    "actual New City processed population is present",
  );
  await page.click("#debug-button");
  await page.selectOption("#debug-powerup", "24");
  assert.doesNotMatch(
    await page.locator('#debug-powerup option[value="24"]').textContent(),
    /NOT IMPLEMENTED/i,
  );
  await page.click("#debug-grant");
  await page.waitForFunction(() => window.__pedMap.points.length > 0);
  report.granted = await page.evaluate(() => window.__pedMapRead());
  assert.equal(report.granted.active, true);
  assert.equal(report.granted.definition.duration, 0);
  assert.ok(
    report.granted.matchingPixels > 0,
    "actual Canvas2D map contains original palette52 pixels",
  );
  assert.doesNotMatch(
    await page.locator("#message").textContent(),
    /NOT IMPLEMENTED/,
  );

  await page.evaluate(() => {
    const c = window.carma;
    // Exercise the authored whole-race deadline without a long simulation loop.
    c.powerups.beginFrame(
      120,
      c.vehicle,
      c.race,
      undefined,
      c.stats.gameTimeMs + 120000,
    );
    c.powerups.finishFrame();
  });
  assert.equal(
    await page.evaluate(() => window.carma.powerups.pedestriansOnMap),
    true,
  );
  await page.selectOption("#debug-powerup", "93");
  await page.click("#debug-grant");
  await page.waitForFunction(
    () =>
      !window.carma.powerups.pedestriansOnMap &&
      window.__pedMap.points.length === 0,
  );
  report.cancelled = await page.evaluate(() => window.__pedMapRead());

  // Bind a bounded mission-context fixture to the real paused population/map.
  // The separate unit/source tests verify authored group/flag200 equivalence.
  report.mission = await page.evaluate(async () => {
    const c = window.carma,
      savedType = c.raceDefinition.raceType,
      savedGroups = c.raceDefinition.pedGroupsToKill;
    const first = c.pedestrians.states.find((p) => p.alive && p.active);
    c.raceDefinition.raceType = "peds";
    c.raceDefinition.pedGroupsToKill = [first.group];
    const previous = window.__pedMap.frames;
    while (window.__pedMap.frames <= previous + 1)
      await new Promise(requestAnimationFrame);
    const withTargets = window.__pedMapRead();
    c.raceDefinition.pedGroupsToKill = [];
    const next = window.__pedMap.frames;
    while (window.__pedMap.frames <= next + 1)
      await new Promise(requestAnimationFrame);
    const emptyTargets = window.__pedMapRead();
    c.raceDefinition.raceType = savedType;
    c.raceDefinition.pedGroupsToKill = savedGroups;
    return { withTargets, emptyTargets };
  });
  assert.equal(report.mission.withTargets.active, false);
  assert.ok(
    report.mission.withTargets.count > 0,
    "ped mission shows selected groups without the pickup",
  );
  assert.equal(report.mission.emptyTargets.count, 0);

  await page.selectOption("#debug-powerup", "24");
  await page.click("#debug-grant");
  await page.evaluate(async () => {
    await window.carma.loadRace();
    window.carma.paused = true;
    document.querySelector("#panel").hidden = true;
  });
  await page.waitForFunction(() => window.carma.pedestrians?.count > 0, null, {
    timeout: 90000,
  });
  assert.equal(
    await page.evaluate(() => window.carma.powerups.pedestriansOnMap),
    false,
    "race reload resets the effect",
  );
  report.backend = await page.evaluate(() => {
    const gl = document.querySelector("#view").getContext("webgl2");
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    };
  });
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  await writeFile(
    "artifacts/browser-ped-map.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error);
  await writeFile(
    "artifacts/browser-ped-map.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
