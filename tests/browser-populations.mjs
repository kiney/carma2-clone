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
    "SKIP opponent population browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5201;
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

  const pathByName = async (pattern) =>
    page.evaluate((source) => {
      const expression = new RegExp(source, "i");
      const option = [...document.querySelector("#track-select").options].find(
        (candidate) => expression.test(candidate.textContent),
      );
      if (!option) throw new Error(`No stock catalog race matches ${source}`);
      return option.value;
    }, pattern);

  const loadPopulation = async (racePath, carPath, expectedCount) => {
    await page.evaluate(
      async ({ track, car, count }) => {
        const c = window.carma;
        const resolvedTrack = c.assets.resolve(track);
        const resolvedCar = c.assets.resolve(car);
        if (!resolvedTrack || !resolvedCar)
          throw new Error(`Missing race/car asset: ${track} / ${car}`);
        document.querySelector("#track-select").value = resolvedTrack;
        document.querySelector("#car-select").value = resolvedCar;
        await c.loadRace();
        c.paused = true;
        document.querySelector("#panel").hidden = true;
        return count;
      },
      { track: racePath, car: carPath, count: expectedCount },
    );
    await page.waitForFunction(
      () => window.carma.stats.ready && window.carma.paused,
      null,
      { timeout: 90000 },
    );
    await page.waitForFunction(
      (count) => window.carma.rivals.length === count,
      expectedCount,
      { timeout: 90000 },
    );
    return page.evaluate(() => ({
      name: window.carma.raceDefinition?.name,
      raceType: window.carma.raceDefinition?.raceType,
      countConfigured: window.carma.raceDefinition?.numberOfOpponents,
      explicitOpponents: [
        ...(window.carma.raceDefinition?.explicitOpponents ?? []),
      ],
      selectedOpponents: window.carma.rivals.map((rival) => rival.id),
      selectedCar:
        document.querySelector("#car-select").selectedOptions[0].textContent,
      selectedCarPath: document.querySelector("#car-select").value,
      ready: window.carma.stats.ready,
    }));
  };

  const stockEagle = await page.evaluate(() =>
    window.carma.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT"),
  );
  assert.ok(stockEagle, "stock EAGLE3 is available");
  const truckingPath = await pathByName("MISSION: TRUCKING HELL");
  const trucking = await loadPopulation(truckingPath, stockEagle, 1);
  assert.equal(trucking.name, "MISSION: TRUCKING HELL");
  assert.equal(trucking.countConfigured, 1);
  assert.deepEqual(trucking.explicitOpponents, [38]);
  assert.deepEqual(trucking.selectedOpponents, [38]);
  await page.screenshot({
    path: "artifacts/browser-populations-trucking-hell.png",
  });

  const bruisePath = await pathByName("THE BRUISE BROTHERS");
  const bruise = await loadPopulation(bruisePath, stockEagle, 12);
  assert.equal(bruise.name, "THE BRUISE BROTHERS");
  assert.equal(bruise.countConfigured, 12);
  assert.deepEqual(bruise.explicitOpponents, Array(12).fill(51));
  assert.deepEqual(bruise.selectedOpponents, Array(12).fill(51));
  await page.screenshot({
    path: "artifacts/browser-populations-bruise-brothers.png",
  });

  const playerIdentity = await page.evaluate(async () => {
    const text = await window.carma.assets.text("data/OPPONENT.TXT");
    const lines = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.split("//")[0].trim())
      .filter(Boolean);
    const index = 1;
    const start = 1 + index * 11;
    return {
      id: index,
      carName: lines[start + 2],
      carFilename: lines[start + 6],
    };
  });
  const buggyPath = await page.evaluate((filename) => {
    const basename = filename.split("/").pop().toLowerCase();
    const option = [...document.querySelector("#car-select").options].find(
      (candidate) =>
        /^data\//i.test(candidate.value) &&
        candidate.value.split("/").pop().toLowerCase() === basename,
    );
    return option?.value ?? null;
  }, playerIdentity.carFilename);
  assert.ok(buggyPath, `opponent ${playerIdentity.id} car is selectable`);
  assert.match(playerIdentity.carFilename, /buggy/i);
  const truckingBuggy = await loadPopulation(truckingPath, buggyPath, 1);
  assert.equal(truckingBuggy.selectedCar, playerIdentity.carName);
  assert.deepEqual(truckingBuggy.selectedOpponents, [38]);
  await page.screenshot({
    path: "artifacts/browser-populations-trucking-buggy-player.png",
  });

  const buggyPlayer = await loadPopulation(bruisePath, buggyPath, 12);
  assert.equal(buggyPlayer.selectedCar, playerIdentity.carName);
  assert.deepEqual(buggyPlayer.selectedOpponents, Array(12).fill(51));
  await page.screenshot({
    path: "artifacts/browser-populations-bruise-buggy-player.png",
  });

  const glError = await page.evaluate(() => {
    const gl = document.querySelector("#view").getContext("webgl2");
    if (!gl) throw new Error("WebGL2 context unavailable");
    return gl.getError();
  });
  assert.equal(glError, 0, "WebGL has no outstanding error");
  assert.deepEqual(errors, [], "Chromium has no page or console errors");
  assert.deepEqual(failedRequests, [], "all requested local assets load");
  const report = {
    trucking,
    bruise,
    truckingBuggy,
    playerIdentity,
    buggyPlayer,
    errors,
    failedRequests,
    glError,
  };
  await writeFile(
    "artifacts/browser-populations.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
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
