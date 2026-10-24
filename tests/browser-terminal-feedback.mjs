import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import assert from "node:assert/strict";
import { createServer } from "node:net";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  console.log(
    "SKIP terminal feedback browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});
const child = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (data) => (log += data));
child.stderr.on("data", (data) => (log += data));
let browser;
try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/manifest`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (child.exitCode !== null) throw new Error(log);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `server did not start: ${log}`);
  browser = await chromium.launch({
    executablePath: executable,
    headless: true,
    args: ["--no-sandbox", "--enable-unsafe-swiftshader"],
  });
  const page = await browser.newPage({ locale: "en-US" });
  const errors = [],
    failedRequests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) => failedRequests.push(request.url()));
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.locator("#play").click();
  await page.waitForFunction(() => !window.carma?.paused, null, {
    timeout: 30000,
  });
  // Set explicit terminal-state fixtures; this is feedback/state QA, not a
  // reproduction of the vehicle's damage or completion mechanics.
  await page.evaluate(() => {
    window.carma.player.knackered = true;
    window.carma.race.status = "failed";
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#message")?.textContent ===
      "YOU ARE WASTED · ENTER TO RESTART",
    null,
    { timeout: 15000 },
  );
  const renderedFrames = await page.evaluate(() => window.carma.stats.frames);
  await page.waitForTimeout(500);
  assert.ok(
    (await page.evaluate(() => window.carma.stats.frames)) > renderedFrames,
    "the renderer continues producing frames after terminal feedback appears",
  );
  await page.locator("#menu-button").click();
  await page.waitForFunction(() => window.carma?.paused);
  assert.equal(await page.locator("#terminal-state").isVisible(), true);
  assert.equal(
    await page.locator("#terminal-state").textContent(),
    "YOU ARE WASTED · ENTER TO RESTART",
  );
  assert.equal(
    await page.locator("#message").textContent(),
    "YOU ARE WASTED · ENTER TO RESTART",
  );
  await page.locator("#menu-button").click();
  await page.waitForFunction(() => !window.carma?.paused);
  assert.equal(await page.locator("#terminal-state").isVisible(), false);
  assert.equal(
    await page.locator("#message").textContent(),
    "YOU ARE WASTED · ENTER TO RESTART",
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => window.carma?.stats.ready && window.carma?.race?.status === "racing",
    null,
    { timeout: 90000 },
  );
  await page.evaluate(() => {
    window.carma.race.status = "completed";
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#message")?.textContent ===
      "RACE COMPLETED · ENTER TO SKIP",
    null,
    { timeout: 15000 },
  );
  assert.equal(
    await page.evaluate(() => window.carma.racePayout.finished),
    false,
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      window.carma?.racePayout?.finished &&
      document.querySelector("#message")?.textContent ===
        "RACE COMPLETED · ENTER TO RESTART",
    null,
    { timeout: 10000 },
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => window.carma?.stats.ready && window.carma?.race?.status === "racing",
    null,
    { timeout: 90000 },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  console.log(
    "PASS terminal feedback browser regression: WASTED, pause/resume, payout skip, and restart",
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", resolve);
  });
}
