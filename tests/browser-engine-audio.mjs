import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP engine audio browser regression: Chromium or C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5202;
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
  // A real Playwright click is required to unlock Web Audio in Chromium.
  await page.click("#play");
  await page.waitForFunction(
    () => window.carma.stats.ready && !window.carma.paused,
    null,
    { timeout: 90000 },
  );
  await page.waitForFunction(
    () =>
      window.carma.audio.context?.state === "running" &&
      window.carma.audio.engineBuffer &&
      window.carma.audio.engineSource,
    null,
    { timeout: 30000 },
  );

  const idle = await page.evaluate(async () => {
    const c = window.carma;
    const audio = c.audio;
    const sample = () => new Promise(requestAnimationFrame);
    for (let i = 0; i < 20; i++) await sample();
    return {
      context: audio.context.state,
      rpm: c.player.state.rpm,
      speed: c.player.state.speed,
      source: !!audio.engineSource,
      rate: audio.engineRate,
      volume: audio.engineVolume,
      gain: audio.engineGain.gain.value,
      buffer: !!audio.engineBuffer,
    };
  });
  assert.equal(idle.context, "running");
  assert.equal(idle.buffer, true, "configured engine sample is decoded");
  assert.equal(idle.source, true, "the stationary engine loop remains active");
  assert.ok(Math.abs(idle.rate - 40960 / 65536) < 1e-8, JSON.stringify(idle));
  assert.ok(Math.abs(idle.volume - 240 / 255) < 1e-8, JSON.stringify(idle));

  const rpmCases = await page.evaluate(async () => {
    const c = window.carma;
    const audio = c.audio;
    const sample = () => new Promise(requestAnimationFrame);
    const simulationUpdate = c.simulation.update;
    const oldSpecialVolume = c.player.specialVolume;
    const oldEngineFactor = c.powerups.motionFactors.engineFactor;
    // Keep the real animation/audio call path running while holding physics
    // fixed, so each requested rev/index pair survives long enough to sample.
    c.simulation.update = () => {};
    const read = async (rpm, index, engineFactor = 1) => {
      c.player.state.rpm = rpm;
      // Supply the value through the real power-up modifier result. Main's
      // animation loop copies that result to player.state.engineFactor before
      // passing it through to the AudioSystem.
      c.powerups.motionFactors.engineFactor = engineFactor;
      c.player.specialVolume = {
        ...(oldSpecialVolume ?? {}),
        volume: {
          ...(oldSpecialVolume?.volume ?? {}),
          engineNoiseIndex: index,
        },
      };
      for (let i = 0; i < 5; i++) await sample();
      return {
        inputRpm: c.player.state.rpm,
        engineFactor: c.player.state.engineFactor,
        index: c.player.specialVolume.volume.engineNoiseIndex,
        rate: audio.engineRate,
        volume: audio.engineVolume,
        source: !!audio.engineSource,
      };
    };
    try {
      return {
        normal: await read(1000, 0),
        boosted: await read(1000, 0, 2),
        noise1: await read(1000, 1),
        noise2: await read(1000, 2),
      };
    } finally {
      c.player.specialVolume = oldSpecialVolume;
      c.powerups.motionFactors.engineFactor = oldEngineFactor;
      c.simulation.update = simulationUpdate;
    }
  });
  assert.ok(
    Math.abs(rpmCases.normal.rate - 50960 / 65536) < 1e-8,
    JSON.stringify(rpmCases.normal),
  );
  assert.ok(
    Math.abs(rpmCases.normal.volume - 243 / 255) < 1e-8,
    JSON.stringify(rpmCases.normal),
  );
  assert.ok(
    Math.abs(rpmCases.boosted.volume - 264 / 255) < 1e-8,
    JSON.stringify(rpmCases.boosted),
  );
  assert.ok(
    Math.abs(rpmCases.noise1.rate - Math.trunc(50960 * 0.75) / 65536) < 1e-8,
    JSON.stringify(rpmCases.noise1),
  );
  assert.ok(
    Math.abs(rpmCases.noise1.volume - 255 / 255) < 1e-8,
    JSON.stringify(rpmCases.noise1),
  );
  assert.ok(
    Math.abs(rpmCases.noise2.rate - Math.trunc(50960 * 0.55) / 65536) < 1e-8,
    JSON.stringify(rpmCases.noise2),
  );
  assert.ok(
    Math.abs(rpmCases.noise2.volume - 195 / 255) < 1e-8,
    JSON.stringify(rpmCases.noise2),
  );

  const pauseResume = await page.evaluate(async () => {
    const c = window.carma;
    const audio = c.audio;
    const first = audio.engineSource;
    let starts = 0;
    const startEngine = audio.startEngine.bind(audio);
    audio.startEngine = () => {
      starts++;
      startEngine();
    };
    c.paused = true;
    await new Promise((resolve) => {
      const start = performance.now();
      const poll = () => {
        if (!audio.engineSource) return resolve();
        if (performance.now() - start > 2000)
          throw new Error("engine loop did not stop when paused");
        requestAnimationFrame(poll);
      };
      poll();
    });
    const stopped = !audio.engineSource;
    c.paused = false;
    await new Promise((resolve, reject) => {
      const start = performance.now();
      const poll = () => {
        if (audio.engineSource) return resolve();
        if (performance.now() - start > 5000)
          return reject(new Error("engine loop did not resume"));
        requestAnimationFrame(poll);
      };
      poll();
    });
    audio.startEngine = startEngine;
    return {
      stopped,
      resumed: !!audio.engineSource,
      newSource: audio.engineSource !== first,
      startsOnResume: starts,
    };
  });
  assert.equal(pauseResume.stopped, true, "pause stops the loop source");
  assert.equal(pauseResume.resumed, true);
  assert.equal(
    pauseResume.newSource,
    true,
    "resume creates one fresh loop source",
  );
  assert.equal(
    pauseResume.startsOnResume,
    1,
    "resume starts exactly one loop source",
  );

  const drive = await page.evaluate(() => {
    const canvas = document.querySelector("#view");
    canvas.focus();
    const before = window.carma.vehicle.position.clone();
    return { before: before.toArray() };
  });
  await page.keyboard.down("ArrowUp");
  await page.waitForFunction(
    (before) => {
      const c = window.carma;
      const p = c.vehicle.position;
      return Math.hypot(p.x - before[0], p.z - before[2]) > 0.5;
    },
    drive.before,
    { timeout: 20000 },
  );
  await page.keyboard.up("ArrowUp");
  const driving = await page.evaluate(async () => {
    const c = window.carma;
    for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame);
    return {
      rpm: c.player.state.rpm,
      speed: c.player.state.speed,
      rate: c.audio.engineRate,
      volume: c.audio.engineVolume,
    };
  });
  assert.ok(
    driving.rpm > 0,
    `driving RPM did not rise: ${JSON.stringify(driving)}`,
  );
  assert.ok(driving.rate !== idle.rate, JSON.stringify({ idle, driving }));

  const gl = await page.evaluate(() => {
    const canvas = document.querySelector("#view");
    return canvas.getContext("webgl2")?.getError() ?? null;
  });
  assert.equal(gl, 0, "WebGL remains error-free");
  await page.screenshot({ path: "artifacts/browser-engine-audio.png" });
  assert.deepEqual(
    errors,
    [],
    `browser console/runtime errors: ${errors.join("\n")}`,
  );
  assert.deepEqual(
    failedRequests,
    [],
    `failed requests: ${failedRequests.join("\n")}`,
  );
  console.log(
    JSON.stringify({ idle, rpmCases, pauseResume, driving, webglError: gl }),
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
