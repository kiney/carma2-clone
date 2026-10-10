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
  const timedEffect = await page.evaluate(async () => {
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
    const lastGameTimeDescriptor = Object.getOwnPropertyDescriptor(
      c.stats,
      "gameTimeMs",
    );
    let gameTimeMs = lastGameTimeDescriptor.value;
    window.__awaitingResumeFrame = false;
    window.__resumeFrame = undefined;
    window.__lastActiveSample = undefined;
    Object.defineProperty(c.stats, "gameTimeMs", {
      configurable: true,
      enumerable: true,
      get: () => gameTimeMs,
      set: (value) => {
        const previousEndMs = gameTimeMs;
        gameTimeMs = value;
        if (window.__awaitingResumeFrame && !c.paused) {
          window.__awaitingResumeFrame = false;
          window.__resumeFrame = {
            wallNow: performance.now(),
            resumeEventAt: window.__pauseTransitions
              .filter((transition) => transition.wasPaused)
              .at(-1)?.at,
            pauseEventAt: window.__pauseTransitions
              .filter((transition) => !transition.wasPaused)
              .at(-1)?.at,
            frame: c.stats.gameFrames,
            startMs: value - c.stats.framePeriodMs,
            endMs: value,
            clockDeltaMs: value - previousEndMs,
            periodMs: c.stats.framePeriodMs,
            previousActiveFrameWallNow: window.__pauseTransitions
              .filter((transition) => !transition.wasPaused)
              .at(-1)?.lastActiveSample?.wallNow,
            previousActiveFrameEndMs: window.__lastActiveSample?.endMs,
          };
        }
        if (!c.paused)
          window.__lastActiveSample = {
            wallNow: performance.now(),
            endMs: value,
            periodMs: c.stats.framePeriodMs,
          };
      },
    });
    const initialTimeLeft = Object.getOwnPropertyDescriptor(
      c.race,
      "timeLeft",
    ).value;
    let timeLeft = initialTimeLeft;
    window.__awaitingResumeTimer = false;
    window.__resumeTimer = undefined;
    Object.defineProperty(c.race, "timeLeft", {
      configurable: true,
      enumerable: true,
      get: () => timeLeft,
      set: (value) => {
        const previous = timeLeft;
        timeLeft = value;
        if (window.__awaitingResumeTimer && window.__resumeFrame) {
          window.__awaitingResumeTimer = false;
          window.__resumeTimer = {
            frame: c.stats.gameFrames,
            timeLeft: value,
            delta: previous - value,
            previous,
          };
        }
      },
    });
    window.__pauseTransitions = [];
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.code !== "Escape") return;
        const wasPaused = c.paused;
        const at = performance.now();
        window.__pauseTransitions.push({
          wasPaused,
          at,
          lastActiveSample: window.__lastActiveSample,
        });
        if (wasPaused) {
          window.__awaitingResumeFrame = true;
          window.__awaitingResumeTimer = true;
        }
      },
      true,
    );
    const timedEffect = c.powerups.definitions.find(
      (definition) => definition.action === 27 && definition.duration > 0,
    );
    if (!timedEffect)
      throw new Error("Stock table has no timed protection powerup");
    c.powerups.grant(timedEffect.index, c.vehicle, c.race);
    window.__readTimedEffect = () => {
      const active = c.powerups.active.find(
        (effect) => effect.index === timedEffect.index,
      );
      return active
        ? { remaining: active.remaining, expiresAtMs: active.expiresAtMs }
        : null;
    };
    window.__rafTicks = 0;
    const countRaf = () => {
      window.__rafTicks++;
      requestAnimationFrame(countRaf);
    };
    requestAnimationFrame(countRaf);
    return {
      index: timedEffect.index,
      action: timedEffect.action,
      duration: timedEffect.duration,
    };
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
      timedEffect: window.__readTimedEffect(),
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
      wallNow: performance.now(),
      gameTimeMs: c.stats.gameTimeMs,
      physicsElapsed: c.simulation.elapsed,
      physicsCount: window.__timebaseTrace.physics.length,
      powerupCount: window.__timebaseTrace.powerups.length,
      timeLeft: c.race.timeLeft,
      timedEffect: window.__readTimedEffect(),
      renders: c.stats.frames,
      rafTicks: window.__rafTicks,
    };
  });
  await page.waitForTimeout(600);
  const stillPaused = await page.evaluate(() => {
    const c = window.carma;
    return {
      gameFrames: c.stats.gameFrames,
      wallNow: performance.now(),
      gameTimeMs: c.stats.gameTimeMs,
      physicsElapsed: c.simulation.elapsed,
      physicsCount: window.__timebaseTrace.physics.length,
      powerupCount: window.__timebaseTrace.powerups.length,
      timeLeft: c.race.timeLeft,
      timedEffect: window.__readTimedEffect(),
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
  assert.deepEqual(stillPaused.timedEffect, paused.timedEffect);
  assert.ok(stillPaused.wallNow - paused.wallNow >= 500);
  assert.ok(
    stillPaused.rafTicks > paused.rafTicks,
    "RAF continues while paused",
  );

  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () =>
      window.__resumeFrame !== undefined && window.__resumeTimer !== undefined,
    { timeout: 5000 },
  );
  const resumed = await page.evaluate(() => ({
    wallNow: performance.now(),
    gameFrames: window.carma.stats.gameFrames,
    gameTimeMs: window.carma.stats.gameTimeMs,
    physicsElapsed: window.carma.simulation.elapsed,
    timeLeft: window.carma.race.timeLeft,
    latestPhysics: window.__timebaseTrace.physics.at(-1),
    latestPowerup: window.__timebaseTrace.powerups.at(-1),
    resumeFrame: window.__resumeFrame,
    resumeTimer: window.__resumeTimer,
    timedEffect: window.__readTimedEffect(),
  }));
  const resumeActiveWallMs =
    resumed.resumeFrame.wallNow - resumed.resumeFrame.resumeEventAt;
  const prePauseActiveRemainderMs =
    resumed.resumeFrame.pauseEventAt -
    resumed.resumeFrame.previousActiveFrameWallNow;
  const activeElapsedAcrossPauseMs =
    prePauseActiveRemainderMs + resumeActiveWallMs;
  // Native period correction can differ from wall time; this scenario checks
  // that the predicted interval continues from the prior game-clock end.
  assert.ok(resumed.resumeFrame.clockDeltaMs >= 0);
  assert.ok(
    Number.isFinite(prePauseActiveRemainderMs) &&
      prePauseActiveRemainderMs >= 0,
  );
  assert.ok(Number.isFinite(resumeActiveWallMs) && resumeActiveWallMs >= 0);
  assert.ok(
    resumed.resumeFrame.periodMs > 10 && resumed.resumeFrame.periodMs < 1000,
    `resume fixture did not exercise an unclamped native period: ${JSON.stringify(resumed.resumeFrame)}`,
  );
  assert.ok(
    Math.abs(
      resumed.resumeFrame.startMs -
        resumed.resumeFrame.previousActiveFrameEndMs,
    ) <= 1,
    `normal resumed frame skipped or duplicated game-clock time: ${JSON.stringify({ paused, stillPaused, resumed, prePauseActiveRemainderMs, resumeActiveWallMs, activeElapsedAcrossPauseMs })}`,
  );
  assert.ok(resumed.timedEffect.remaining < paused.timedEffect.remaining);
  assert.equal(resumed.resumeTimer.frame, resumed.resumeFrame.frame);
  assert.ok(
    Math.abs(resumed.resumeTimer.delta - resumed.resumeFrame.periodMs / 1000) <
      0.001,
    `first resumed race timer update did not match its native frame dt: ${JSON.stringify({ resumed, stillPaused })}`,
  );
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
