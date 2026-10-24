import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import assert from "node:assert/strict";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP diagnostics browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

const port = await reservePort();
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));

try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/manifest`)).ok) {
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
    acceptDownloads: true,
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

  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(
    () =>
      window.carma?.stats.ready &&
      window.carma.populationLoadState?.opponents.state !== "loading" &&
      window.carma.populationLoadState?.pedestrians.state !== "loading",
    null,
    { timeout: 90000 },
  );
  const fixture = `TEST DIAGNOSTIC ${Date.now()}`;
  const originals = await page.evaluate((message) => {
    const c = window.carma;
    const warnings = [...c.assets.warnings];
    const animationWarnings = [...(c.carAnimation?.warnings ?? [])];
    c.assets.warnings.push(message, message);
    c.carAnimation?.warnings.push(`${message} animation detail`);
    c.refreshDiagnostics();
    return { warnings, animationWarnings };
  }, fixture);

  const details = page.locator("#diagnostics");
  await details.locator("summary").click();
  assert.equal(await details.evaluate((element) => element.open), true);
  await page.locator("[data-diagnostic-refresh]").click();
  const visibleText = await details.innerText();
  assert.match(visibleText, /Asset and runtime warnings · session/);
  assert.match(visibleText, /Player animation · current race/);
  assert.match(visibleText, /Repeated 2 times/);
  assert.match(visibleText, /TEST DIAGNOSTIC/);
  assert.match(visibleText, /NICE BEAVER/);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("[data-diagnostic-download]").click(),
  ]);
  assert.equal(download.suggestedFilename(), "carma-diagnostics.json");
  const downloaded = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(downloaded.race, "NICE BEAVER");
  assert.match(downloaded.track, /data\/RACES\/newcity1\/newcity1\.txt/i);
  const sessionGroup = downloaded.groups.find(
    (group) => group.source === "Asset and runtime warnings",
  );
  assert.equal(sessionGroup.scope, "session");
  assert.equal(
    sessionGroup.items.find((item) => item.message === fixture).count,
    2,
  );
  assert.ok(
    downloaded.groups.some(
      (group) =>
        group.source === "Player animation" && group.scope === "current race",
    ),
  );

  await page.evaluate(({ warnings, animationWarnings }) => {
    window.carma.assets.warnings.splice(
      0,
      window.carma.assets.warnings.length,
      ...warnings,
    );
    window.carma.carAnimation?.warnings.splice(
      0,
      window.carma.carAnimation.warnings.length,
      ...animationWarnings,
    );
    window.carma.refreshDiagnostics();
  }, originals);
  assert.deepEqual(errors, [], "Chromium has no uncaught errors");
  assert.deepEqual(failedRequests, [], "all requested local assets load");
  console.log(
    "PASS diagnostics panel grouping, deduplication, scope labels and local JSON download",
  );
} catch (error) {
  console.error(serverLog);
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
}

async function reservePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
