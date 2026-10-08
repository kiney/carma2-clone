import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP debug browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const port = 5192;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "",
  browser;
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
  assert.ok(ready, serverLog);
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
  const errors = [],
    failedRequests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("requestfailed", (request) =>
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  assert.equal(await page.locator("#debug-menu-toggle").isChecked(), false);
  await page.evaluate(() => {
    document.querySelector("#track-select").value = window.carma.assets.resolve(
      "data/RACES/newcity1/newcity1.txt",
    );
    document.querySelector("#car-select").value = window.carma.assets.resolve(
      "data/CARS/EAGLE3/EAGLE3.TXT",
    );
  });
  await page.check("#debug-menu-toggle");
  assert.equal(await page.locator("#debug-panel").isVisible(), true);
  assert.equal(
    await page.locator("#debug-controls").isDisabled(),
    false,
    "tools work for the initially loaded, paused race",
  );
  await page.click("#debug-close");
  await page.click("#play");
  await page.waitForFunction(
    () =>
      window.carma.player && window.carma.stats.ready && !window.carma.paused,
    null,
    { timeout: 90000 },
  );
  await page.click("#debug-button");
  const sample = () =>
    page.evaluate(() => ({
      time: window.carma.race.timeLeft,
      elapsed: window.carma.simulation.elapsed,
      position: window.carma.vehicle.position.toArray(),
    }));
  const frozenBefore = await sample();
  await page.keyboard.down("w");
  await page.waitForFunction(
    (elapsed) => window.carma.simulation.elapsed > elapsed + 0.8,
    frozenBefore.elapsed,
    { timeout: 20000 },
  );
  await page.keyboard.up("w");
  const frozenAfter = await sample();
  assert.equal(
    frozenAfter.time,
    frozenBefore.time,
    "debug timer freeze does not decrement race time",
  );
  assert.ok(
    frozenAfter.position.some(
      (value, axis) => Math.abs(value - frozenBefore.position[axis]) > 0.01,
    ),
    "original car moves while timer is frozen",
  );
  await page.uncheck("#debug-freeze");
  const runningBefore = await sample();
  await page.waitForFunction(
    (elapsed) => window.carma.simulation.elapsed > elapsed + 0.5,
    runningBefore.elapsed,
    { timeout: 20000 },
  );
  assert.ok(
    (await sample()).time < runningBefore.time - 0.3,
    "unfreezing resumes countdown",
  );
  await page.check("#debug-freeze");
  await page.check("#debug-immune");
  await page.check("#debug-repairs");
  await page.waitForFunction(
    () =>
      window.carma.player.damage.damageContext.invulnerable &&
      window.carma.player.freeRepairs,
  );
  await page.evaluate(() => {
    window.carma.paused = true;
  });
  const creditsBefore = await page.evaluate(() => window.carma.race.credits);
  await page.fill("#debug-credit-amount", "23456");
  await page.click("#debug-add-credits");
  assert.equal(
    await page.evaluate(() => window.carma.race.credits),
    creditsBefore + 23456,
  );
  assert.equal(
    await page.evaluate(() => window.carma.player.upgrades.credits),
    creditsBefore + 23456,
  );
  const timeBefore = (await sample()).time;
  await page.click("#debug-add-time");
  assert.equal((await sample()).time, timeBefore + 60);
  const definitions = await page.evaluate(
    () => window.carma.powerups.definitions,
  );
  const engine = definitions.find(
    (d) => d.action === 9 && d.floatParams[0] !== 1,
  );
  const oil = definitions.find((d) => d.action === 35);
  const mine = definitions.find((d) => d.action === 34);
  assert.ok(
    engine && oil && mine,
    "original table supplies engine/oil/mine definitions",
  );
  await page.selectOption("#debug-powerup", String(engine.index));
  const pickupsBeforeGrant = await page.evaluate(() =>
    window.carma.powerups.pickups.map((p) => p.collected),
  );
  await page.click("#debug-grant");
  await page.click("#debug-abilities");
  assert.equal(
    await page.evaluate(
      (index) => window.carma.powerups.abilities.get(index).charges,
      oil.index,
    ),
    -oil.initialValue,
  );
  await page.selectOption("#debug-powerup", String(mine.index));
  await page.click("#debug-grant");
  const pickupState = await page.evaluate(() =>
    window.carma.powerups.pickups.map((p) => p.collected),
  );
  assert.deepEqual(
    pickupState,
    pickupsBeforeGrant,
    "debug grants leave world pickup actors untouched",
  );
  const unsupported = await page.evaluate(() =>
    Array.from(document.querySelector("#debug-powerup").options)
      .filter((option) => option.disabled)
      .map((option) => option.textContent),
  );
  assert.ok(
    unsupported.length > 0 &&
      unsupported.every((text) => text.includes("nicht implementiert")),
  );

  // Exercise repair/recovery while paused and broke, through their visible UI.
  await page.evaluate(() => {
    window.carma.race.credits = 0;
    window.carma.player.damage.componentLevels[0] = 60;
  });
  await page.click("#debug-repair");
  assert.ok(
    await page.evaluate(() =>
      Array.from(window.carma.player.damage.componentLevels).every(
        (level) => level === 0,
      ),
    ),
  );
  await page.click("#debug-recover");
  assert.equal(
    await page.evaluate(() => window.carma.race.credits),
    0,
    "debug recovery is free",
  );
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    (factor) => window.carma.player.state.engineFactor === factor,
    engine.floatParams[0],
  );
  await page.keyboard.press("f");
  await page.waitForFunction(
    () => window.carma.simulation.mineBodies.length > 0,
  );
  assert.equal(
    await page.evaluate(
      (index) => window.carma.powerups.abilities.get(index).charges,
      mine.index,
    ),
    -mine.initialValue - 1,
  );

  // Text/arrow entry must never reach driving input.
  await page.fill("#debug-credit-amount", "1000");
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(150);
  assert.equal(
    await page.evaluate(() => window.carma.player.input.throttle),
    0,
  );
  await page.keyboard.up("ArrowUp");
  await page.uncheck("#debug-enabled");
  assert.equal(await page.locator("#debug-menu-toggle").isChecked(), false);
  await page.waitForFunction(
    () =>
      !window.carma.player.damage.damageContext.invulnerable &&
      !window.carma.player.freeRepairs,
  );
  assert.ok(
    await page.evaluate(() => window.carma.player.state.engineFactor !== 1),
    "a granted timed powerup survives turning debug off",
  );
  const disabledBefore = await sample();
  await page.waitForFunction(
    (elapsed) => window.carma.simulation.elapsed > elapsed + 0.5,
    disabledBefore.elapsed,
    { timeout: 20000 },
  );
  assert.ok(
    (await sample()).time < disabledBefore.time - 0.3,
    "turning debug off removes timer override",
  );
  await page.click("#debug-button");
  await page.evaluate(() => {
    window.carma.race.status = "failed";
  });
  await page.waitForFunction(
    () => document.querySelector("#debug-grant").disabled,
  );
  assert.equal(await page.locator("#debug-add-time").isDisabled(), true);
  await page.click("#debug-restart");
  await page.waitForFunction(
    () =>
      window.carma.stats.ready &&
      !window.carma.paused &&
      window.carma.race.status === "racing",
    null,
    { timeout: 90000 },
  );
  assert.equal(await page.locator("#debug-menu-toggle").isChecked(), true);
  assert.equal(await page.locator("#debug-grant").isDisabled(), false);
  assert.equal(
    await page.evaluate(() => window.carma.debugMode.timerFrozen),
    true,
  );
  await page.screenshot({ path: "artifacts/browser-debug.png" });
  const glError = await page.evaluate(() =>
    document.querySelector("#view").getContext("webgl2").getError(),
  );
  assert.equal(glError, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  const report = {
    frozenBefore,
    frozenAfter,
    creditsGranted: 23456,
    engine: engine.message,
    oil: oil.message,
    mine: mine.message,
    unsupported: unsupported.length,
    pickupActorsUntouchedByGrant: pickupState.length,
    errors,
    failedRequests,
    glError,
  };
  await writeFile(
    "artifacts/browser-debug.json",
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
