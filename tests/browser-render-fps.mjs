import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const executablePath = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executablePath);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log("SKIP render FPS: Chromium or original installation absent");
  process.exit(0);
}
const port = 5264;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk));
server.stderr.on("data", (chunk) => (serverLog += chunk));
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      ready = (await fetch(`http://127.0.0.1:${port}/api/manifest`)).ok;
    } catch {}
    if (ready) break;
    if (server.exitCode !== null) throw new Error(serverLog);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Server not ready: ${serverLog}`);
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
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // Control rendered-frame timestamps, leaving performance.now and the game
  // clock untouched. The paused initial menu needs no simulation or drive loop.
  await page.addInitScript(() => {
    let nextId = 0;
    const callbacks = new Map();
    window.requestAnimationFrame = (callback) => {
      const id = ++nextId;
      callbacks.set(id, callback);
      return id;
    };
    window.cancelAnimationFrame = (id) => callbacks.delete(id);
    window.__renderFpsStep = (timestamp) => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback(timestamp);
    };
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
    polling: 100,
  });
  const report = await page.evaluate(() => {
    const c = window.carma;
    const baseline = {
      frames: c.stats.frames,
      gameFrames: c.stats.gameFrames,
      gameTimeMs: c.stats.gameTimeMs,
    };
    const start = performance.now() + 2000;
    window.__renderFpsStep(start); // start a fresh averaging window
    for (let frame = 1; frame <= 10; frame++)
      window.__renderFpsStep(start + frame * 100);
    const slow = {
      fps: c.stats.fps,
      label: document.querySelector("#fps-counter").textContent,
    };
    for (let frame = 1; frame <= 4; frame++)
      window.__renderFpsStep(start + 1000 + frame * 250);
    const slower = {
      fps: c.stats.fps,
      label: document.querySelector("#fps-counter").textContent,
    };
    return {
      baseline,
      slow,
      slower,
      paused: c.paused,
      frames: c.stats.frames,
      gameFrames: c.stats.gameFrames,
      gameTimeMs: c.stats.gameTimeMs,
      webglError: document
        .querySelector("#view")
        .getContext("webgl2")
        .getError(),
    };
  });
  assert.deepEqual(report.slow, { fps: 10, label: "10 FPS" });
  assert.deepEqual(report.slower, { fps: 4, label: "4 FPS" });
  assert.equal(report.frames - report.baseline.frames, 15);
  assert.equal(report.gameFrames, report.baseline.gameFrames);
  assert.equal(report.gameTimeMs, report.baseline.gameTimeMs);
  assert.equal(report.paused, true);
  assert.equal(report.webglError, 0);
  assert.deepEqual(errors, []);
  console.log("PASS real rendered-frame FPS", JSON.stringify(report));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
