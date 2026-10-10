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
    "SKIP race flags browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5196;
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

  const load = async (path) => {
    await page.evaluate(async (requestedPath) => {
      const c = window.carma;
      const track = c.assets.resolve(requestedPath);
      const car = c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT");
      if (!track || !car)
        throw new Error(`Required race/car is absent: ${requestedPath}`);
      const selector = document.querySelector("#track-select");
      if (![...selector.options].some((option) => option.value === track))
        throw new Error(`Race is not in the catalog-backed menu: ${track}`);
      selector.value = track;
      document.querySelector("#car-select").value = car;
      await c.loadRace();
      c.paused = true;
    }, path);
    await page.waitForFunction(
      () => window.carma.stats.ready && window.carma.paused,
      null,
      { timeout: 90000 },
    );
    return page.evaluate(() => ({
      name: document.querySelector("#race-name").textContent,
      track: document.querySelector("#track-select").value,
      timeLeft: window.carma.race.timeLeft,
      disableTimeAwards: window.carma.race.disableTimeAwards,
      exclusions: [...window.carma.powerups.exclusions],
      definitions: window.carma.powerups.definitions.map((definition) => ({
        index: definition.index,
        message: definition.message,
        action: definition.action,
      })),
    }));
  };

  const mission = await load("data/RACES/quarry_mission/quarry_mission.txt");
  assert.match(mission.name, /MISSION.*BOULDER DASH/i);
  assert.equal(
    mission.disableTimeAwards,
    true,
    "stock Quarry mission retains its no_time race flag",
  );
  assert.ok(mission.exclusions.includes(5), "mission excludes Hot Rod index 5");

  const excludedGrant = await page.evaluate(() => {
    const c = window.carma;
    const target = c.powerups.definitions[5];
    if (!target || !/hot\s*rod/i.test(target.message))
      throw new Error("Original powerup index 5 is not Hot Rod");
    const credits = c.race.credits;
    c.powerups.resetPath(c.vehicle.position);
    const modifiers = c.powerups.update(0, c.vehicle, c.race);
    const events = [];
    const granted = c.powerups.grant(5, c.vehicle, c.race, (event) =>
      events.push({ kind: event.kind, index: event.definition.index }),
    );
    return {
      granted,
      creditsBefore: credits,
      creditsAfter: c.race.credits,
      modifiersBefore: {
        accelerationMultiplier: modifiers.accelerationMultiplier,
        lateralGripMultiplier: modifiers.lateralGripMultiplier,
      },
      modifiersAfter: (() => {
        const current = c.powerups.update(0, c.vehicle, c.race);
        return {
          accelerationMultiplier: current.accelerationMultiplier,
          lateralGripMultiplier: current.lateralGripMultiplier,
        };
      })(),
      events,
    };
  });
  assert.equal(excludedGrant.granted, true);
  assert.ok(excludedGrant.creditsAfter > excludedGrant.creditsBefore);
  assert.deepEqual(excludedGrant.modifiersAfter, excludedGrant.modifiersBefore);
  assert.deepEqual(excludedGrant.events, [{ kind: "credits", index: 0 }]);
  await page.screenshot({
    path: "artifacts/browser-race-flags-quarry-mission.png",
  });

  const bruisePath = await page.evaluate(() => {
    const option = [...document.querySelector("#track-select").options].find(
      (candidate) => /THE BRUISE BROTHERS/i.test(candidate.textContent),
    );
    if (!option)
      throw new Error("THE BRUISE BROTHERS is absent from stock catalog");
    return option.value;
  });
  const noTimeRace = await load(bruisePath);
  assert.equal(noTimeRace.disableTimeAwards, true);
  assert.deepEqual(
    noTimeRace.exclusions,
    [],
    "THE BRUISE BROTHERS isolates no_time from powerup exclusions",
  );
  const missionTime = await page.evaluate(() => {
    const c = window.carma;
    const timePowerup = c.powerups.definitions.find(
      (definition) => definition.action === 11,
    );
    if (!timePowerup) throw new Error("Original time award powerup is absent");
    const before = c.race.timeLeft;
    const events = [];
    c.powerups.grant(timePowerup.index, c.vehicle, c.race, (event) =>
      events.push({ kind: event.kind, amount: event.amount }),
    );
    return {
      index: timePowerup.index,
      before,
      after: c.race.timeLeft,
      events,
    };
  });
  assert.equal(missionTime.after, missionTime.before);
  assert.deepEqual(missionTime.events, [{ kind: "time", amount: 0 }]);
  await page.screenshot({ path: "artifacts/browser-race-flags-no-time.png" });

  const normal = await load("data/RACES/newcity1/newcity1.txt");
  assert.match(normal.name, /NICE BEAVER/i);
  assert.equal(normal.disableTimeAwards, false);
  assert.ok(!normal.exclusions.includes(5));
  await page.evaluate(() => {
    window.carma.paused = false;
  });
  const driveStart = await page.evaluate(() =>
    window.carma.vehicle.position.toArray(),
  );
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1800);
  await page.keyboard.up("ArrowUp");
  const driveResult = await page.evaluate(() => {
    const c = window.carma;
    c.paused = true;
    return {
      position: c.vehicle.position.toArray(),
      speed: c.vehicle.speed,
    };
  });
  driveResult.distance = Math.hypot(
    driveResult.position[0] - driveStart[0],
    driveResult.position[1] - driveStart[1],
    driveResult.position[2] - driveStart[2],
  );
  assert.ok(
    driveResult.distance > 0.1 || driveResult.speed > 0.1,
    "normal keyboard input advances the loaded stock car",
  );
  const normalGrants = await page.evaluate(() => {
    const c = window.carma;
    c.powerups.resetPath(c.vehicle.position);
    const beforeModifiers = c.powerups.update(0, c.vehicle, c.race);
    const events = [];
    c.powerups.grant(5, c.vehicle, c.race, (event) =>
      events.push({ kind: event.kind, index: event.definition.index }),
    );
    const afterModifiers = c.powerups.update(0, c.vehicle, c.race);
    const timePowerup = c.powerups.definitions.find(
      (definition) => definition.action === 11,
    );
    const before = c.race.timeLeft;
    c.powerups.grant(timePowerup.index, c.vehicle, c.race);
    return {
      modifiersChanged:
        beforeModifiers.accelerationMultiplier !==
          afterModifiers.accelerationMultiplier ||
        beforeModifiers.lateralGripMultiplier !==
          afterModifiers.lateralGripMultiplier,
      events,
      timeBefore: before,
      timeAfter: c.race.timeLeft,
      timeIndex: timePowerup.index,
    };
  });
  assert.equal(normalGrants.modifiersChanged, true);
  assert.deepEqual(normalGrants.events, [{ kind: "engine", index: 5 }]);
  assert.ok(normalGrants.timeAfter > normalGrants.timeBefore);
  await page.screenshot({ path: "artifacts/browser-race-flags-newcity.png" });

  const advCandidates = await page.evaluate(() =>
    [...document.querySelector("#track-select").options]
      .map((option) => option.value)
      .filter(
        (path) => /^adv_data\//i.test(path) && /_mission\.txt$/i.test(path),
      ),
  );
  let adv;
  for (const path of advCandidates) {
    const candidate = await load(path);
    if (candidate.exclusions.length) {
      adv = candidate;
      break;
    }
  }
  assert.ok(adv, "an ADV mission has catalog powerup exclusions");
  assert.match(adv.track, /^adv_data\//i);
  const excludedAdvIndex = adv.exclusions.find((index) =>
    adv.definitions.some((definition) => definition.index === index),
  );
  assert.notEqual(excludedAdvIndex, undefined);
  const advExcluded = await page.evaluate(() => {
    const c = window.carma;
    const events = [];
    const before = c.race.credits;
    const excludedIndex = c.powerups.exclusions.values().next().value;
    c.powerups.grant(excludedIndex, c.vehicle, c.race, (event) =>
      events.push({ kind: event.kind, index: event.definition.index }),
    );
    return { excludedIndex, before, after: c.race.credits, events };
  });
  assert.ok(advExcluded.after > advExcluded.before);
  assert.deepEqual(advExcluded.events, [{ kind: "credits", index: 0 }]);
  await page.screenshot({
    path: "artifacts/browser-race-flags-adv-quarry.png",
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
    mission: { ...mission, definitions: undefined },
    excludedGrant,
    noTimeRace: { ...noTimeRace, definitions: undefined },
    missionTime,
    normal: { ...normal, definitions: undefined },
    driveResult,
    normalGrants,
    adv: { ...adv, definitions: undefined },
    advExcluded,
    errors,
    failedRequests,
    glError,
  };
  await writeFile(
    "artifacts/browser-race-flags.json",
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
