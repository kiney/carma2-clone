import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP browser smoke: provide Chromium and a local C2 installation.",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const port = 5187;
const server = spawn(
  process.execPath,
  ["server/dev.mjs", ...(process.env.SMOKE_DEV ? [] : ["--production"])],
  {
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
let browser;
try {
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/manifest`)).ok) break;
    } catch {}
    if (server.exitCode !== null) throw new Error(serverLog);
    await new Promise((r) => setTimeout(r, 100));
  }
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
  const errors = [],
    failedRequests = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("requestfailed", (request) =>
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, {
    timeout: 90000,
  });
  await page.click("#play");
  await page.waitForFunction(
    () => window.carma.stats.ready && !window.carma.paused,
    { timeout: 90000 },
  );
  await page.waitForFunction(
    () =>
      window.carma.rivals.length === 4 && window.carma.pedestrians?.count > 0,
    { timeout: 60000 },
  );
  const before = await page.evaluate(() => ({
    x: window.carma.vehicle.position.x,
    z: window.carma.vehicle.position.z,
  }));
  await page.keyboard.down("w");
  await page.waitForFunction(
    (start) =>
      Math.hypot(
        window.carma.vehicle.position.x - start.x,
        window.carma.vehicle.position.z - start.z,
      ) > 2,
    before,
    { timeout: 20000 },
  );
  await page.keyboard.down("a");
  await page.waitForTimeout(750);
  await page.keyboard.up("a");
  await page.keyboard.up("w");
  const driving = await page.evaluate(() => ({
    position: window.carma.vehicle.position,
    heading: window.carma.vehicle.heading,
    speed: window.carma.vehicle.speed,
    health: window.carma.vehicle.health,
    audio: window.carma.audio.diagnostics,
    pedestrians: window.carma.pedestrians.count,
    rivals: window.carma.rivals.length,
    ...window.carma.stats,
  }));
  assert.ok(
    Math.hypot(driving.position.x - before.x, driving.position.z - before.z) >
      1,
    `keyboard throttle moves original car: ${JSON.stringify({ before, driving })}`,
  );
  assert.ok(driving.heading > 0.01, "keyboard steering changes heading");
  assert.ok(driving.triangles > 1000, "original scene rendered");
  assert.equal(driving.ready, true);
  assert.deepEqual(driving.audio, [], "original audio loads");
  await page.screenshot({ path: "artifacts/browser-beaver-city.png" });
  // Cross every actual gate through the runtime update loop, including four laps.
  const progression = await page.evaluate(async () => {
    const race = window.carma.race;
    const v = window.carma.vehicle;
    const checkpoints = race.checkpoints.map((g) =>
      g.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    );
    race.timeLeft = 500;
    for (let lap = 0; lap < race.laps; lap++)
      for (const points of checkpoints) {
        const cx = points.reduce((n, p) => n + p.x, 0) / points.length,
          cz = points.reduce((n, p) => n + p.z, 0) / points.length;
        const a = points[0],
          b = points[1],
          c = points[2];
        let nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
          nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
        const length = Math.hypot(nx, nz);
        nx /= length;
        nz /= length;
        v.position.set(
          cx - nx * 0.12,
          window.carma.collision.height(cx, cz, 5),
          cz - nz * 0.12,
        );
        v.velocity.set(nx * 2, 0, nz * 2);
        v.heading = Math.atan2(-nx, -nz);
        window.carma.simulation.reset(window.carma.player);
        await new Promise((r) => setTimeout(r, 220));
      }
    return {
      status: race.status,
      lap: race.lap,
      credits: race.credits,
      next: race.nextCheckpoint,
    };
  });
  assert.equal(
    progression.status,
    "completed",
    "actual original gates allow race completion",
  );
  const switches = [];
  for (const [track, car, label] of [
    [
      "data/RACES/quarry1/quarry1.txt",
      "data/CARS/delorean/delorean.txt",
      "quarry",
    ],
    [
      "adv_data/RACES/AcidReign/AcidReign.txt",
      "adv_data/CARS/69mach1/69mach1.txt",
      "acid-reign",
    ],
  ]) {
    const available = await page.evaluate(
      ([track, car]) =>
        window.carma.assets.resolve(track) && window.carma.assets.resolve(car),
      [track, car],
    );
    if (!available) continue;
    await page.evaluate(
      async ([track, car]) => {
        document.getElementById("track-select").value =
          window.carma.assets.resolve(track);
        document.getElementById("car-select").value =
          window.carma.assets.resolve(car);
        await window.carma.loadRace();
        window.carma.paused = true;
      },
      [track, car],
    );
    await page.waitForTimeout(400);
    const result = await page.evaluate(() => ({
      status: document.getElementById("status").textContent,
      stats: window.carma.stats,
      track: window.carma.track.start,
    }));
    assert.equal(result.stats.ready, true, `switch to ${label}`);
    assert.ok(result.stats.triangles > 1000);
    switches.push({ label, ...result });
    await page.evaluate(() => (document.getElementById("panel").hidden = true));
    await page.screenshot({ path: `artifacts/browser-${label}.png` });
  }
  assert.deepEqual(errors, [], "browser console has no fatal errors");
  assert.deepEqual(failedRequests, [], "all requested local assets load");
  const report = { driving, progression, switches, errors, failedRequests };
  await writeFile(
    "artifacts/browser-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error);
  console.error(serverLog);
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((r) => server.once("exit", r));
    server.kill("SIGTERM");
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
  }
}
