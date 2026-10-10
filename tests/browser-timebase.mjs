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
    "SKIP timebase browser regression: Chromium or C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5206;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
let browser;
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
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`),
  );

  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.evaluate(async () => {
    const c = window.carma;
    const track = c.assets.resolve("data/RACES/newcity1/newcity1.txt");
    const car = c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT");
    if (!track || !car) throw new Error("Stock New City/EAGLE3 unavailable");
    document.querySelector("#track-select").value = track;
    document.querySelector("#car-select").value = car;
    await c.loadRace();
    c.paused = true;
    document.querySelector("#panel").hidden = true;
    const originalUpdate = c.simulation.updateFrame.bind(c.simulation);
    const originalPowerupUpdate = c.powerups.beginFrame.bind(c.powerups);
    window.__timebaseTrace = { physics: [], powerups: [] };
    c.simulation.updateFrame = (startMs, periodMs) => {
      const windowResult = originalUpdate(startMs, periodMs);
      window.__timebaseTrace.physics.push({
        startMs,
        periodMs,
        steps: windowResult.steps,
        skippedMs: windowResult.skippedMs,
      });
      return windowResult;
    };
    c.powerups.beginFrame = (...args) => {
      window.__timebaseTrace.powerups.push({
        dt: args[0],
        gameTimeMs: args[4],
      });
      return originalPowerupUpdate(...args);
    };
    window.__rafTicks = 0;
    const countRaf = () => {
      window.__rafTicks++;
      requestAnimationFrame(countRaf);
    };
    requestAnimationFrame(countRaf);
  });
  await page.waitForFunction(
    () => window.carma.stats.ready && window.carma.paused,
    null,
    { timeout: 90000 },
  );

  // Keep an early throttle edge and the deliberate stall below native 2s race
  // age, then test sustained driving independently.
  const start = await page.evaluate(() => {
    const c = window.carma;
    const state = c.player.state;
    return {
      wallNow: performance.now(),
      gameFrames: c.stats.gameFrames,
      gameTimeMs: c.stats.gameTimeMs,
      physicsElapsed: c.simulation.elapsed,
      position: state.position.toArray(),
      timeLeft: c.race.timeLeft,
    };
  });
  await page.evaluate(() => (window.carma.paused = false));
  await page.keyboard.down("w");
  await page.waitForTimeout(100);
  await page.keyboard.up("w");

  // Stall while race age is still below the native 2s correction threshold.
  // The real next frame must retain the long sample and cap physics work.
  const preStall = await page.evaluate(() => ({
    wallNow: performance.now(),
    gameFrames: window.carma.stats.gameFrames,
    gameTimeMs: window.carma.stats.gameTimeMs,
    skippedMs: window.carma.stats.physicsSkippedMs,
    physicsCount: window.__timebaseTrace.physics.length,
  }));
  const stall = await page.evaluate(() => {
    const until = performance.now() + 650;
    while (performance.now() < until) {}
    return performance.now();
  });
  await page.waitForFunction(
    (oldFrame) => window.carma.stats.gameFrames > oldFrame,
    preStall.gameFrames,
    { timeout: 5000 },
  );
  const afterStall = await page.evaluate(() => {
    const c = window.carma;
    return {
      gameFrames: c.stats.gameFrames,
      gameTimeMs: c.stats.gameTimeMs,
      framePeriodMs: c.stats.framePeriodMs,
      physicsSkippedMs: c.stats.physicsSkippedMs,
      physicsElapsed: c.simulation.elapsed,
      physics: window.__timebaseTrace.physics.slice(-3),
      renders: c.stats.frames,
    };
  });
  assert.ok(
    afterStall.physics.some((entry) => entry.periodMs > 500),
    `long sampled period lost: ${JSON.stringify({
      period: afterStall.framePeriodMs,
      start,
      preStall,
      afterStall,
    })}`,
  );
  assert.ok(
    afterStall.physics.every((entry) => entry.periodMs <= 1000),
    "sample exceeded native 1000 ms cap",
  );
  assert.ok(
    afterStall.physicsSkippedMs > preStall.skippedMs,
    "stall was not recorded as skipped physics time",
  );
  assert.ok(afterStall.physics.some((entry) => entry.steps <= 5));
  assert.ok(afterStall.physics.every((entry) => entry.periodMs >= 10));
  assert.ok(
    afterStall.gameFrames <= preStall.gameFrames + 3,
    "gameplay ran multiple catch-up updates",
  );
  assert.ok(Number.isFinite(afterStall.physicsElapsed));

  const driveStart = await page.evaluate(() => {
    const c = window.carma;
    const state = c.player.state;
    return {
      wallMs: Date.now(),
      gameFrames: c.stats.gameFrames,
      gameTimeMs: c.stats.gameTimeMs,
      physicsElapsed: c.simulation.elapsed,
      position: c.vehicle.position.toArray(),
      timeLeft: c.race.timeLeft,
      rpm: state.rpm,
      speed: state.speed,
      gear: state.gear,
    };
  });
  await page.keyboard.down("w");
  await page.waitForFunction(
    (position) => {
      const current = window.carma.vehicle.position;
      return Math.hypot(current.x - position[0], current.z - position[2]) > 0.5;
    },
    driveStart.position,
    { timeout: 20000 },
  );
  await page.keyboard.up("w");
  const driven = await page.evaluate((before) => {
    const c = window.carma;
    const state = c.player.state;
    const position = c.vehicle.position.toArray();
    return {
      wallMs: Date.now(),
      gameFrames: c.stats.gameFrames,
      gameTimeMs: c.stats.gameTimeMs,
      physicsElapsed: c.simulation.elapsed,
      position,
      distance: Math.hypot(position[0] - before[0], position[2] - before[2]),
      timeLeft: c.race.timeLeft,
      rpm: state.rpm,
      speed: state.speed,
      gear: state.gear,
    };
  }, driveStart.position);
  const driveDistance = driven.distance;
  assert.ok(
    driveDistance > 0.5,
    `real W input did not move car enough: ${driveDistance}`,
  );
  assert.ok(driven.gameFrames > driveStart.gameFrames);
  assert.ok(driven.gameTimeMs > driveStart.gameTimeMs);
  assert.ok(driven.timeLeft < driveStart.timeLeft);
  assert.ok(driven.rpm > 0, `engine RPM did not rise: ${driven.rpm}`);
  assert.ok(Number.isFinite(driven.speed));
  assert.ok(driven.speed >= 0);
  assert.ok(Number.isFinite(driven.physicsElapsed));

  // Pause using the game's actual Escape binding. RAF continues rendering, but
  // gameplay frames, physics windows, race timer and effect updates must stop.
  await page.keyboard.press("Escape");
  const paused = await page.evaluate(() => {
    const c = window.carma;
    return {
      gameFrames: c.stats.gameFrames,
      gameTimeMs: c.stats.gameTimeMs,
      physicsElapsed: c.simulation.elapsed,
      physicsCount: window.__timebaseTrace.physics.length,
      powerupCount: window.__timebaseTrace.powerups.length,
      timeLeft: c.race.timeLeft,
      renders: c.stats.frames,
      rafTicks: window.__rafTicks,
    };
  });
  await page.waitForTimeout(600);
  const stillPaused = await page.evaluate(() => {
    const c = window.carma;
    return {
      gameFrames: c.stats.gameFrames,
      gameTimeMs: c.stats.gameTimeMs,
      physicsElapsed: c.simulation.elapsed,
      physicsCount: window.__timebaseTrace.physics.length,
      powerupCount: window.__timebaseTrace.powerups.length,
      timeLeft: c.race.timeLeft,
      renders: c.stats.frames,
      rafTicks: window.__rafTicks,
    };
  });
  assert.equal(stillPaused.gameFrames, paused.gameFrames);
  assert.equal(stillPaused.gameTimeMs, paused.gameTimeMs);
  assert.equal(stillPaused.physicsElapsed, paused.physicsElapsed);
  assert.equal(stillPaused.physicsCount, paused.physicsCount);
  assert.equal(stillPaused.powerupCount, paused.powerupCount);
  assert.equal(stillPaused.timeLeft, paused.timeLeft);
  assert.ok(
    stillPaused.rafTicks > paused.rafTicks,
    "RAF continues while paused",
  );

  await page.keyboard.press("Escape");
  await page.waitForFunction(
    (oldFrame) => window.carma.stats.gameFrames > oldFrame,
    paused.gameFrames,
    { timeout: 5000 },
  );
  const resumed = await page.evaluate(() => ({
    gameFrames: window.carma.stats.gameFrames,
    gameTimeMs: window.carma.stats.gameTimeMs,
    physicsElapsed: window.carma.simulation.elapsed,
    timeLeft: window.carma.race.timeLeft,
    latestPhysics: window.__timebaseTrace.physics.at(-1),
    latestPowerup: window.__timebaseTrace.powerups.at(-1),
  }));
  assert.ok(
    resumed.gameTimeMs - paused.gameTimeMs < 200,
    "pause duration leaked into game clock",
  );
  assert.ok(resumed.timeLeft > stillPaused.timeLeft - 0.1);
  assert.ok(resumed.latestPhysics);
  assert.ok(resumed.latestPowerup?.gameTimeMs >= resumed.gameTimeMs - 1);

  await page.keyboard.down("w");
  await page.waitForTimeout(350);
  await page.keyboard.up("w");
  const finalState = await page.evaluate(() => {
    const c = window.carma;
    const state = c.player.state;
    return {
      position: state.position.toArray(),
      velocity: state.velocity.toArray(),
      orientation: [
        state.orientation.x,
        state.orientation.y,
        state.orientation.z,
        state.orientation.w,
      ],
      physicsElapsed: c.simulation.elapsed,
      gameTimeMs: c.stats.gameTimeMs,
      physicsSkippedMs: c.stats.physicsSkippedMs,
      framePeriodMs: c.stats.framePeriodMs,
      gameFrames: c.stats.gameFrames,
    };
  });
  assert.ok(
    [
      ...finalState.position,
      ...finalState.velocity,
      ...finalState.orientation,
    ].every(Number.isFinite),
  );
  assert.ok(Number.isFinite(finalState.physicsElapsed));
  await page.screenshot({ path: "artifacts/browser-timebase.png" });
  const webgl = await page.evaluate(() => {
    const gl = document.querySelector("#view").getContext("webgl2");
    const errors = [];
    for (let i = 0; i < 16; i++) {
      const error = gl.getError();
      if (error === gl.NO_ERROR) break;
      errors.push(error);
    }
    return errors;
  });
  assert.deepEqual(webgl, [], `WebGL errors: ${webgl.join(",")}`);
  assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
  assert.deepEqual(
    failedRequests,
    [],
    `failed requests: ${failedRequests.join(" | ")}`,
  );

  const report = {
    start,
    driven,
    driveDistance,
    paused,
    stillPaused,
    resumed,
    stall: { blockedAtPerformanceMs: stall, ...afterStall },
    finalState,
    webglErrors: webgl,
    browserErrors: errors,
    failedRequests,
  };
  await writeFile(
    "artifacts/browser-timebase-report.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
