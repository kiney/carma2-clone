import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import assert from "node:assert/strict";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP population availability browser regression: Chromium or local C2 assets absent.",
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
  });
  const errors = [];
  const warnings = [];
  const failedRequests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "warning") warnings.push(message.text());
  });
  page.on("requestfailed", (request) =>
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`),
  );

  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(
    () => window.carma?.stats.ready && window.carma.populationLoadState,
    null,
    { timeout: 90000 },
  );

  const baseline = await page.evaluate(async () => {
    const c = window.carma;
    const track = c.assets.resolve("data/RACES/newcity1/newcity1.txt");
    const car = c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT");
    if (!track || !car) throw new Error("Stock Newcity1/Eagle3 is absent");
    document.querySelector("#track-select").value = track;
    document.querySelector("#car-select").value = car;
    await c.loadRace();
    c.paused = true;
    return { track, car };
  });
  await page.waitForFunction(
    () =>
      window.carma.stats.ready &&
      window.carma.paused &&
      window.carma.populationLoadState.opponents.state !== "loading" &&
      window.carma.populationLoadState.pedestrians.state !== "loading",
    null,
    { timeout: 90000 },
  );
  const originalDefinition = await page.evaluate(() => {
    const c = window.carma;
    const definition = c.raceDefinition;
    if (!definition) throw new Error("Newcity mission definition is absent");
    if (definition.raceType !== "carma")
      throw new Error(
        `Expected Newcity carma baseline, got ${definition.raceType}`,
      );
    if (c.rivals.length < 2)
      throw new Error("Newcity baseline has fewer than two loaded rivals");
    const snapshot = structuredClone(definition);
    window.__populationBaseline = snapshot;
    window.__populationBaselineRivalIds = c.rivals.map((rival) => rival.id);
    window.__populationOriginalScene = c.assets.scene.bind(c.assets);
    return {
      name: definition.name,
      raceType: definition.raceType,
      rivals: c.rivals.length,
      populationLoadState: c.populationLoadState,
    };
  });
  assert.equal(originalDefinition.raceType, "carma");
  assert.ok(originalDefinition.rivals >= 2);

  const requiredOpponentFailure = await page.evaluate(async () => {
    const c = window.carma;
    const definition = c.raceDefinition;
    const ids = c.rivals.slice(0, 2).map((rival) => rival.id);
    Object.assign(definition, {
      raceType: "cars",
      numberOfOpponents: 2,
      explicitOpponents: ids,
      numberOfOpponentsToKill: 2,
      opponentsToKill: ids,
    });

    const originalScene = window.__populationOriginalScene;
    let opponentSceneCalls = 0;
    c.assets.scene = async (dir, stem, options) => {
      if (options?.storage === "opponents" && ++opponentSceneCalls === 2)
        return await new Promise((_, reject) => {
          window.__rejectRequiredOpponent = reject;
        });
      return originalScene(dir, stem, options);
    };
    await c.loadRace();
    c.paused = true;
    return { ids };
  });
  await page.waitForFunction(
    () => typeof window.__rejectRequiredOpponent === "function",
    null,
    { timeout: 90000 },
  );
  const pendingRequired = await page.evaluate(() => ({
    state: window.carma.populationLoadState.opponents.state,
    practice: !!window.carma.race.practice,
    visibleStatus: !document.querySelector("#population-status").hidden,
    rivals: window.carma.rivals.map((rival) => rival.id),
  }));
  assert.equal(pendingRequired.state, "loading");
  assert.equal(pendingRequired.practice, false);
  assert.equal(pendingRequired.visibleStatus, true);
  assert.ok(requiredOpponentFailure.ids.includes(pendingRequired.rivals[0]));

  await page.evaluate(() =>
    window.__rejectRequiredOpponent(
      new Error("TEST FIXTURE: second opponent scene rejected"),
    ),
  );
  await page.waitForFunction(
    () => window.carma.populationLoadState.opponents.state === "failed",
    null,
    { timeout: 30000 },
  );
  const requiredUnavailable = await page.evaluate(() => ({
    state: window.carma.populationLoadState.opponents,
    practice: !!window.carma.race.practice,
    status: document.querySelector("#population-status").textContent,
    visibleStatus: !document.querySelector("#population-status").hidden,
    objectiveAvailable: window.carma.populationLoadState.objectives.opponents,
    loadedRivals: window.carma.rivals.map((rival) => rival.id),
    raceStatus: window.carma.race.status,
    payout: window.carma.racePayout,
  }));
  assert.match(requiredUnavailable.state.reason, /TEST FIXTURE/);
  assert.equal(requiredUnavailable.practice, true);
  assert.equal(requiredUnavailable.visibleStatus, true);
  assert.match(
    requiredUnavailable.status,
    /Mission unavailable.*no completion payout/i,
  );
  assert.equal(
    await page.locator("#population-menu-status").isVisible(),
    true,
    "paused menu keeps the required-population failure visible",
  );
  assert.match(
    await page.locator("#population-menu-status").innerText(),
    /Mission unavailable.*no completion payout/i,
  );
  assert.equal(requiredUnavailable.objectiveAvailable, false);
  assert.equal(requiredUnavailable.loadedRivals.length, 1);
  assert.equal(
    requiredUnavailable.loadedRivals[0],
    requiredOpponentFailure.ids[0],
  );
  assert.equal(requiredUnavailable.raceStatus, "racing");
  assert.equal(requiredUnavailable.payout, undefined);
  await page.evaluate(() => {
    window.carma.assets.scene = window.__populationOriginalScene;
  });

  const classicFailure = await page.evaluate(async () => {
    const c = window.carma;
    const definition = c.raceDefinition;
    Object.assign(definition, window.__populationBaseline, {
      raceType: "carma",
      numberOfOpponents: 2,
      explicitOpponents: window.__populationBaselineRivalIds.slice(0, 2),
      numberOfOpponentsToKill: null,
      opponentsToKill: [],
    });
    const ids = [...definition.explicitOpponents];
    const originalScene = window.__populationOriginalScene;
    let opponentSceneCalls = 0;
    c.assets.scene = async (dir, stem, options) => {
      if (options?.storage === "opponents" && ++opponentSceneCalls === 2)
        return await new Promise((_, reject) => {
          window.__rejectClassicOpponent = reject;
        });
      return originalScene(dir, stem, options);
    };
    await c.loadRace();
    c.paused = true;
    return { ids };
  });
  await page.waitForFunction(
    () => typeof window.__rejectClassicOpponent === "function",
    null,
    { timeout: 90000 },
  );
  const classicPending = await page.evaluate(() => ({
    state: window.carma.populationLoadState.opponents.state,
    practice: !!window.carma.race.practice,
  }));
  assert.equal(classicPending.state, "loading");
  assert.equal(classicPending.practice, false);
  await page.evaluate(() =>
    window.__rejectClassicOpponent(
      new Error("TEST FIXTURE: optional classic opponent scene rejected"),
    ),
  );
  await page.waitForFunction(
    () => window.carma.populationLoadState.opponents.state === "failed",
    null,
    { timeout: 30000 },
  );
  const classicDegraded = await page.evaluate(() => ({
    practice: !!window.carma.race.practice,
    checkpointCount: window.carma.race.checkpoints.length,
    objectiveAvailable: window.carma.populationLoadState.objectives.opponents,
    loadedRivals: window.carma.rivals.map((rival) => rival.id),
    status: document.querySelector("#population-status").textContent,
    visibleStatus: !document.querySelector("#population-status").hidden,
  }));
  assert.equal(classicDegraded.practice, false);
  assert.ok(classicDegraded.checkpointCount > 0);
  assert.equal(classicDegraded.objectiveAvailable, false);
  assert.equal(classicDegraded.loadedRivals.length, 1);
  assert.ok(classicFailure.ids.includes(classicDegraded.loadedRivals[0]));
  assert.equal(classicDegraded.visibleStatus, true);
  assert.match(classicDegraded.status, /failed|could not finish loading/i);
  await page.evaluate(() => {
    window.carma.assets.scene = window.__populationOriginalScene;
  });

  const pedestrianFailure = await page.evaluate(async () => {
    const c = window.carma;
    const occupiedGroup = [...c.pedestrians.groupCounts].find(
      ([, counts]) => counts.total > 0,
    )?.[0];
    if (occupiedGroup === undefined)
      throw new Error(
        "Baseline Newcity population has no occupied pedestrian group",
      );
    const definition = c.raceDefinition;
    Object.assign(definition, window.__populationBaseline, {
      raceType: "peds",
      numberOfOpponents: 0,
      explicitOpponents: [],
      numberOfOpponentsToKill: null,
      opponentsToKill: [],
      numberOfPedGroupsToKill: 1,
      pedGroupsToKill: [occupiedGroup],
    });
    const originalScene = window.__populationOriginalScene;
    c.assets.scene = async (dir, stem, options) => {
      if (/\/peds\/peeps\//i.test(dir))
        throw new Error("TEST FIXTURE: pedestrian actor scene unavailable");
      return originalScene(dir, stem, options);
    };
    await c.loadRace();
    c.paused = true;
    return { occupiedGroup };
  });
  await page.waitForFunction(
    () =>
      window.carma.stats.ready &&
      window.carma.populationLoadState.pedestrians.state !== "loading",
    null,
    { timeout: 90000 },
  );
  const missingPedestrians = await page.evaluate(() => ({
    population: window.carma.populationLoadState.pedestrians,
    practice: !!window.carma.race.practice,
    status: document.querySelector("#population-status").textContent,
    visibleStatus: !document.querySelector("#population-status").hidden,
    objectiveAvailable: window.carma.populationLoadState.objectives.pedestrians,
    populationFailures: window.carma.pedestrians.populationFailures,
    warnings: window.carma.pedestrians.warnings,
    count: window.carma.pedestrians.count,
    raceStatus: window.carma.race.status,
    payout: window.carma.racePayout,
  }));
  assert.equal(missingPedestrians.population.state, "ready");
  assert.equal(missingPedestrians.practice, true);
  assert.equal(missingPedestrians.visibleStatus, true);
  assert.match(
    missingPedestrians.status,
    /Mission unavailable.*no completion payout/i,
  );
  assert.equal(
    await page.locator("#population-menu-status").isVisible(),
    true,
    "paused menu keeps the pedestrian-package failure visible",
  );
  assert.match(
    await page.locator("#population-menu-status").innerText(),
    /Mission unavailable.*no completion payout/i,
  );
  assert.equal(missingPedestrians.objectiveAvailable, false);
  assert.equal(missingPedestrians.count, 0);
  assert.ok(
    missingPedestrians.populationFailures.some((failure) =>
      /No original pedestrian actor packages loaded/.test(failure.reason),
    ),
  );
  assert.ok(
    missingPedestrians.warnings.some((warning) =>
      /TEST FIXTURE: pedestrian actor scene unavailable/.test(warning),
    ),
    "in-memory scene rejection is recorded as a caught pedestrian warning",
  );
  assert.equal(missingPedestrians.raceStatus, "racing");
  assert.equal(missingPedestrians.payout, undefined);
  await page.evaluate(() => {
    window.carma.assets.scene = window.__populationOriginalScene;
  });

  await page.evaluate(async () => {
    const c = window.carma;
    const definition = c.raceDefinition;
    Object.assign(definition, window.__populationBaseline, {
      raceType: "cars",
      numberOfOpponents: 2,
      explicitOpponents: [1, 2],
      numberOfOpponentsToKill: 2,
      opponentsToKill: [1, 2],
    });
    const originalScene = window.__populationOriginalScene;
    let opponentSceneCalls = 0;
    c.assets.scene = async (dir, stem, options) => {
      if (options?.storage === "opponents" && ++opponentSceneCalls === 2)
        return await new Promise((_, reject) => {
          window.__rejectStaleOpponent = reject;
        });
      return originalScene(dir, stem, options);
    };
    await c.loadRace();
    c.paused = true;
    return true;
  });
  await page.waitForFunction(
    () => typeof window.__rejectStaleOpponent === "function",
    null,
    { timeout: 90000 },
  );
  await page.evaluate(async () => {
    const c = window.carma;
    Object.assign(c.raceDefinition, window.__populationBaseline);
    // The prior generation still owns its unresolved promise, while the new
    // race uses the normal scene loader.
    c.assets.scene = window.__populationOriginalScene;
    await c.loadRace();
    c.paused = true;
  });
  await page.waitForFunction(
    () =>
      window.carma.stats.ready &&
      window.carma.populationLoadState.opponents.state === "ready" &&
      window.carma.populationLoadState.pedestrians.state === "ready",
    null,
    { timeout: 90000 },
  );
  const settledBeforeLateFailure = await page.evaluate(() => ({
    opponents: window.carma.populationLoadState.opponents.state,
    practice: !!window.carma.race.practice,
    name: window.carma.raceDefinition.name,
  }));
  assert.equal(settledBeforeLateFailure.opponents, "ready");
  assert.equal(settledBeforeLateFailure.practice, false);
  await page.evaluate(() =>
    window.__rejectStaleOpponent(
      new Error("TEST FIXTURE: stale old-race opponent rejection"),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  const afterLateFailure = await page.evaluate(() => ({
    opponents: window.carma.populationLoadState.opponents.state,
    practice: !!window.carma.race.practice,
    name: window.carma.raceDefinition.name,
    visibleStatus: !document.querySelector("#population-status").hidden,
  }));
  assert.deepEqual(afterLateFailure, {
    opponents: "ready",
    practice: false,
    name: settledBeforeLateFailure.name,
    visibleStatus: false,
  });

  assert.deepEqual(errors, [], "Chromium has no uncaught errors");
  assert.deepEqual(
    failedRequests,
    [],
    "test fixtures reject in-memory scene loads",
  );
  console.log(
    "PASS population availability failure regression",
    JSON.stringify({
      baseline: originalDefinition,
      requiredUnavailable,
      classicDegraded,
      pedestrianFailure: {
        group: pedestrianFailure.occupiedGroup,
        population: missingPedestrians.population,
        practice: missingPedestrians.practice,
        failures: missingPedestrians.populationFailures.length,
      },
      afterLateFailure,
      expectedWarnings: warnings,
    }),
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
