import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log("SKIP native rewards: Chromium or original installation absent");
  process.exit(0);
}
const port = 5216;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "",
  browser;
const report = { errors: [], failedRequests: [] };
server.stdout.on("data", (data) => (log += data));
server.stderr.on("data", (data) => (log += data));
await mkdir("artifacts", { recursive: true });
try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/manifest`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) throw new Error(log);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, log);
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
  page.on("pageerror", (error) => report.errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    report.failedRequests.push(request.url()),
  );
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.evaluate(async () => {
    const c = window.carma;
    document.querySelector("#track-select").value = c.assets.resolve(
      "data/RACES/newcity1/newcity1.txt",
    );
    document.querySelector("#car-select").value = c.assets.resolve(
      "data/CARS/EAGLE3/EAGLE3.TXT",
    );
    await c.loadRace();
    c.paused = true;
    window.__rewardSounds = [];
    const play = c.audio.playSound.bind(c.audio);
    c.audio.playSound = (id, ...args) => {
      window.__rewardSounds.push(id);
      return play(id, ...args);
    };
  });
  await page.waitForFunction(
    () => window.carma.opponentsReady && window.carma.pedestrians,
    null,
    { timeout: 90000 },
  );
  await page.click("#debug-button");
  await page.selectOption("#debug-powerup", "90");
  await page.click("#debug-grant");
  const drink = await page.evaluate(() => ({
    index: window.carma.powerups.definitions[90].index,
    action: window.carma.powerups.definitions[90].action,
    multiplier: window.carma.race.earnedCreditMultiplier,
    state: window.carma.powerups.drinkDriving.snapshot,
    sounds: [...window.__rewardSounds],
  }));
  assert.equal(drink.action, 48);
  assert.equal(drink.multiplier, 3);
  assert.ok(drink.sounds.includes(3601));
  await page.selectOption("#debug-powerup", "0");
  const creditStart = await page.evaluate(() => window.carma.race.credits);
  const creditRange = await page.evaluate(
    () => window.carma.powerups.definitions[0].integerParams,
  );
  await page.click("#debug-grant");
  report.pickupDelta = await page.evaluate(
    (start) => window.carma.race.credits - start,
    creditStart,
  );
  assert.ok(
    report.pickupDelta >= Math.trunc(creditRange[0] / 100) * 300 &&
      report.pickupDelta <= Math.trunc(creditRange[1] / 100) * 300 &&
      report.pickupDelta % 300 === 0,
    `normal authored credit pickup receives 3x earned outlet: ${report.pickupDelta}`,
  );

  await page.evaluate(() => {
    const c = window.carma;
    document.querySelector("#panel").hidden = true;
    document.querySelector("#debug-panel").hidden = true;
    c.paused = false;
  });
  await page.locator("#view").click();
  const frameStart = await page.evaluate(() => window.carma.stats.gameFrames);
  const baseFov = await page.evaluate(async () => {
    const text = await window.carma.assets.text("data/GENERAL.TXT");
    const lines = text.split(/\r?\n/);
    const index = lines.findIndex((line) =>
      /\/\/\s*camera angle\s*$/i.test(line),
    );
    const inline = lines[index]?.split("//")[0].trim();
    return Number(
      inline ||
        lines
          .slice(index + 1)
          .find((line) => line.split("//")[0].trim())
          ?.split("//")[0]
          .trim(),
    );
  });
  assert.ok(baseFov > 0 && baseFov < 180, "original GENERAL camera angle");
  await page.keyboard.down("w");
  await page.waitForFunction(
    (start) => window.carma.stats.gameFrames >= start + 12,
    frameStart,
    { timeout: 25000 },
  );
  await page.keyboard.up("w");
  report.projection = await page.evaluate(() => ({
    fov: window.carma.camera.fov,
    clock: window.carma.stats.gameTimeMs,
    speed: window.carma.player.state.velocity.length(),
    multiplier: window.carma.race.earnedCreditMultiplier,
    voiceSounds: window.__rewardSounds.filter((id) => id >= 3601 && id <= 3603),
  }));
  assert.ok(
    report.projection.speed > 0,
    "real W input still drives under Drink Driving",
  );
  assert.ok(
    report.projection.fov >= baseFov * 0.924 &&
      report.projection.fov <= baseFov * 1.076,
    `authored FOV amplitude at original angle ${baseFov}: ${report.projection.fov}`,
  );
  assert.equal(report.projection.multiplier, 3);
  await page.screenshot({ path: "artifacts/browser-native-rewards-drink.png" });

  // Controlled native graphical-car fixture: keep the actual car's body spin
  // fixed with physics disabled. No direct award/credit/state-counter mutation.
  const stuntStart = await page.evaluate(() => {
    const c = window.carma;
    c.paused = true;
    for (const body of c.simulation.cars)
      c.simulation.setCarPhysicsActive(body, false);
    c.player.state.angularVelocity.set(10, 0, 0);
    c.cunningStunts.cancelPending();
    return {
      credits: c.race.credits,
      time: c.race.timeLeft,
      now: performance.now(),
      previous: c.cunningStunts.snapshot.lastAwardMs,
    };
  });
  const delay = Math.max(0, 10001 - (stuntStart.now - stuntStart.previous));
  if (delay) await page.waitForTimeout(delay);
  await page.evaluate(() => {
    window.carma.paused = false;
  });
  await page.waitForFunction(
    (start) => window.carma.race.credits !== start,
    stuntStart.credits,
    { timeout: 20000 },
  );
  report.stunt = await page.evaluate(
    (start) => ({
      fixture:
        "controlled native body-axis spin; normal graphical award and EarnCredits path",
      credits: window.carma.race.credits - start,
      message: document.querySelector("#message").textContent,
      state: window.carma.cunningStunts.snapshot,
    }),
    stuntStart.credits,
  );
  assert.equal(
    report.stunt.credits,
    6000,
    "source 2000-point stunt uses live Drink Driving multiplier",
  );
  assert.match(report.stunt.message, /CUNNING STUNT/);

  await page.evaluate(() => {
    window.carma.paused = true;
    document.querySelector("#debug-panel").hidden = false;
  });
  await page.selectOption("#debug-powerup", "93");
  await page.click("#debug-grant");
  report.cancelled = await page.evaluate(() => ({
    multiplier: window.carma.race.earnedCreditMultiplier,
    state: window.carma.powerups.drinkDriving.snapshot,
  }));
  assert.equal(report.cancelled.multiplier, 0);
  report.glError = await page.evaluate(() =>
    document.querySelector("#view").getContext("webgl2").getError(),
  );
  assert.equal(report.glError, 0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  await writeFile(
    "artifacts/browser-native-rewards.json",
    JSON.stringify({ drink, ...report }, null, 2),
  );
  console.log(JSON.stringify({ drink, ...report }, null, 2));
} catch (error) {
  report.failure = String(error.stack || error);
  await writeFile(
    "artifacts/browser-native-rewards.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
