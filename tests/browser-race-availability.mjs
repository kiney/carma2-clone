import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import assert from "node:assert/strict";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP race availability browser check: Chromium or original assets absent.",
  );
  process.exit(0);
}
const port = 5299;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "",
  browser;
server.stdout.on("data", (data) => (output += data));
server.stderr.on("data", (data) => (output += data));
try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/manifest`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, output);
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
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(
    () => window.carma?.stats.ready && window.carma.paused,
    null,
    { timeout: 90000 },
  );
  const initial = await page.evaluate(() => ({
    name: carma.raceDefinition?.name,
    elapsed: carma.simulation.elapsed,
  }));
  await page.locator("#race-search").fill("nuke");
  await page.locator(".location-tile").first().click();
  assert.equal(await page.locator(".mission-tile").count(), 1);
  assert.equal(await page.locator(".mission-tile").isDisabled(), true);
  assert.match(
    await page.locator(".mission-tile").innerText(),
    /actor file is missing/i,
  );
  assert.match(
    await page.locator(".mission-tile").innerText(),
    /no valid player start/i,
  );
  assert.equal(await page.locator("#play").isDisabled(), true);
  await page.evaluate(() => carma.loadRace());
  assert.deepEqual(
    await page.evaluate(() => ({
      name: carma.raceDefinition?.name,
      elapsed: carma.simulation.elapsed,
    })),
    initial,
    "blocked Nuke load preserves the currently paused scene",
  );
  assert.match(
    await page.locator("#status").innerText(),
    /Cannot load this track/i,
  );

  await page.locator("#race-search").fill("arena1");
  await page.locator(".location-tile").first().click();
  assert.match(
    await page.locator(".mission-tile").innerText(),
    /Free drive only/i,
  );
  assert.equal(await page.locator("#play").isDisabled(), false);
  assert.equal(await page.locator("#play").innerText(), "START FREE DRIVE");
  await page.locator("#play").click();
  await page.waitForFunction(
    () => carma.stats.ready && carma.race.practice && !carma.paused,
    null,
    { timeout: 90000 },
  );
  const before = await page.evaluate(() => {
    carma.race.timeLeft = 0.01;
    return {
      time: carma.simulation.elapsed,
      position: carma.vehicle.position.toArray(),
    };
  });
  await page.keyboard.down("w");
  await page.waitForFunction(
    (time) => carma.simulation.elapsed > time + 0.4,
    before.time,
    { timeout: 20000 },
  );
  await page.keyboard.up("w");
  const practice = await page.evaluate(() => {
    carma.paused = true;
    return {
      status: carma.race.status,
      timeLeft: carma.race.timeLeft,
      gates: carma.race.checkpoints.length,
      practice: carma.race.practice,
      position: carma.vehicle.position.toArray(),
      timer: document.querySelector("#timer").textContent,
    };
  });
  assert.equal(practice.status, "racing");
  assert.equal(practice.timeLeft, 0.01, "practice timer does not expire");
  assert.equal(practice.practice, true);
  assert.equal(practice.gates, 0);
  assert.equal(practice.timer, "FREE DRIVE");
  assert.ok(
    practice.position.some((n, i) => Math.abs(n - before.position[i]) > 0.001),
    "practice permits vehicle motion",
  );

  await page.locator("#race-search").fill("CONTROL FREAK");
  await page.locator(".location-tile").first().click();
  const mission = page
    .locator(".mission-tile")
    .filter({ hasText: "CONTROL FREAK" });
  await mission.click();
  assert.equal(
    await mission.isDisabled(),
    false,
    "non-lap mission needs no gates",
  );
  assert.doesNotMatch(
    await mission.innerText(),
    /free drive only|unavailable/i,
  );
  await page.locator("#play").click();
  await page.waitForFunction(
    () =>
      carma.stats.ready &&
      carma.raceDefinition?.raceType === "peds" &&
      !carma.paused,
    null,
    { timeout: 90000 },
  );
  const actual = await page.evaluate(() => {
    carma.paused = true;
    return {
      practice: !!carma.race.practice,
      gates: carma.race.checkpoints.length,
      type: carma.raceDefinition.raceType,
      gl: carma.renderer.getContext().getError(),
    };
  });
  assert.equal(actual.practice, false);
  assert.equal(actual.gates, 0);
  assert.equal(actual.type, "peds");
  assert.equal(actual.gl, 0);
  assert.deepEqual(errors, []);
  console.log(
    "PASS race availability browser regression",
    JSON.stringify({ practice, actual }),
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
