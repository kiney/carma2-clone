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
    "SKIP command powerup browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5198;
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
  const selected = await page.evaluate(async () => {
    const c = window.carma;
    const track = c.assets.resolve("data/RACES/newcity1/newcity1.txt");
    const car = c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT");
    if (!track || !car) throw new Error("Stock NICE BEAVER/EAGLE3 is absent");
    document.querySelector("#track-select").value = track;
    document.querySelector("#car-select").value = car;
    await c.loadRace();
    c.paused = true;
    return { track, car };
  });
  await page.waitForFunction(
    () => window.carma.stats.ready && window.carma.paused,
    null,
    { timeout: 90000 },
  );
  const race = await page.evaluate(() => ({
    name: window.carma.raceDefinition?.name,
    type: window.carma.raceDefinition?.raceType,
    exclusions: window.carma.raceDefinition?.powerupExclusions,
    status: window.carma.race.status,
  }));
  assert.match(race.name, /NICE BEAVER/i);
  assert.match(selected.track, /^data\//i);
  assert.deepEqual(race.exclusions, []);
  assert.equal(race.status, "racing");

  const driveStart = await page.evaluate(() =>
    window.carma.vehicle.position.toArray(),
  );
  await page.evaluate(() => (window.carma.paused = false));
  await page.keyboard.down("ArrowUp");
  await page.waitForTimeout(1200);
  await page.keyboard.up("ArrowUp");
  const drive = await page.evaluate(() => {
    window.carma.paused = true;
    return window.carma.vehicle.position.toArray();
  });
  const driveDistance = Math.hypot(
    drive[0] - driveStart[0],
    drive[1] - driveStart[1],
    drive[2] - driveStart[2],
  );
  assert.ok(driveDistance > 0.1, "stock driving still advances under ArrowUp");

  await page.click("#debug-button");
  await page.waitForFunction(
    () =>
      document.querySelector("#debug-enabled").checked &&
      !document.querySelector("#debug-panel").hidden,
  );
  const table = await page.evaluate(() =>
    [38, 32, 54].map((index) => {
      const definition = window.carma.powerups.definitions[index];
      if (!definition) throw new Error(`Original powerup ${index} is absent`);
      return {
        index,
        action: definition.action,
        duration: definition.duration,
        initialValue: definition.initialValue,
        integerParams: definition.integerParams,
        floatParams: definition.floatParams,
      };
    }),
  );
  assert.deepEqual(
    table.map(({ index, action }) => [index, action]),
    [
      [38, 26],
      [32, 28],
      [54, 36],
    ],
  );

  const grant = async (index) => {
    await page.selectOption("#debug-powerup", String(index));
    await page.click("#debug-grant");
  };

  await grant(38);
  await grant(38);
  const voucherGrant = await page.evaluate(() => ({
    vouchers: window.carma.powerups.recoveryVouchers,
  }));
  assert.equal(voucherGrant.vouchers, 10);

  const recovery = await page.evaluate(() => {
    const c = window.carma;
    c.race.credits = 0;
    c.vehicle.velocity.set(3, 4, 5);
    c.paused = false;
    const view = document.querySelector("#view");
    view.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyR", bubbles: true }),
    );
    view.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyR", bubbles: true }),
    );
    c.paused = true;
    return {
      vouchers: c.powerups.recoveryVouchers,
      credits: c.race.credits,
      velocity: c.vehicle.velocity.toArray(),
      message: document.querySelector("#message").textContent,
    };
  });
  assert.equal(recovery.vouchers, 9);
  assert.equal(
    recovery.credits,
    0,
    "voucher recovery succeeds at zero credits",
  );
  assert.ok(
    recovery.velocity.every((component) => Math.abs(component) < 0.001),
    "recovery resets motion within its tiny solver residual",
  );
  assert.match(recovery.message, /VOUCHER USED/i);

  const rejectedRecovery = await page.evaluate(() => {
    const c = window.carma;
    const before = c.powerups.recoveryVouchers;
    c.player.knackered = true;
    c.paused = false;
    const view = document.querySelector("#view");
    view.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyR", bubbles: true }),
    );
    view.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyR", bubbles: true }),
    );
    c.player.knackered = false;
    c.race.status = "failed";
    view.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyR", bubbles: true }),
    );
    view.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyR", bubbles: true }),
    );
    c.race.status = "racing";
    c.paused = true;
    return { before, after: c.powerups.recoveryVouchers };
  });
  assert.equal(
    rejectedRecovery.after,
    rejectedRecovery.before,
    "knackered and failed-race recovery requests do not consume vouchers",
  );

  await grant(32);
  const handbrakeEffect = await page.evaluate(() => {
    const c = window.carma;
    c.powerups.resetPath(c.vehicle.position);
    return c.powerups.update(0, c.vehicle, c.race).instantHandbrake;
  });
  assert.equal(handbrakeEffect, true);

  await page.evaluate(() => {
    const c = window.carma;
    c.vehicle.position.y = 100;
    c.vehicle.velocity.set(3, -2, 4);
    c.vehicle.angularVelocity.set(0.25, -0.5, 0.75);
    c.vehicle.rpm = 1200;
    // Capture the live frame boundary after input, before integration.
    const originalUpdateFrame = c.simulation.updateFrame.bind(c.simulation);
    let captured;
    c.simulation.updateFrame = function () {
      captured = {
        velocity: c.vehicle.velocity.toArray(),
        angularVelocity: c.vehicle.angularVelocity.toArray(),
        rpm: c.vehicle.rpm,
        handbrake: c.player.input.handbrake,
      };
      this.updateFrame = originalUpdateFrame;
      c.paused = true;
      window.__commandPowerupFrame = captured;
      return { skippedMs: 0 };
    };
    c.paused = false;
  });
  await page.keyboard.down("Space");
  await page.waitForFunction(() => window.__commandPowerupFrame, null, {
    timeout: 5000,
  });
  const handbrake = await page.evaluate(() => window.__commandPowerupFrame);
  await page.keyboard.up("Space");
  assert.deepEqual(handbrake.velocity, [0, 0, 0]);
  assert.deepEqual(handbrake.angularVelocity, [0.25, -0.5, 0.75]);
  assert.equal(handbrake.rpm, 0);
  assert.equal(handbrake.handbrake, false);

  await grant(54);
  await grant(54);
  const jump = await page.evaluate(() => {
    const c = window.carma;
    const ability = c.powerups.abilities.get(54);
    if (!ability) throw new Error("Debug grant did not add jump inventory");
    const sounds = [];
    const playSound = c.audio.playSound.bind(c.audio);
    c.audio.playSound = async (id, ...args) => {
      sounds.push(id);
      return playSound(id, ...args);
    };
    c.race.status = "racing";
    c.vehicle.position.y = 100;
    c.vehicle.velocity.set(3, -1.5, 4);
    c.vehicle.angularVelocity.set(-0.3, 0.4, -0.5);
    const initial = {
      charges: ability.charges,
      velocity: c.vehicle.velocity.toArray(),
      angularVelocity: c.vehicle.angularVelocity.toArray(),
    };
    c.paused = false;
    const view = document.querySelector("#view");
    view.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
    );
    const first = {
      velocity: c.vehicle.velocity.toArray(),
      angularVelocity: c.vehicle.angularVelocity.toArray(),
      charges: c.powerups.abilities.get(54)?.charges ?? 0,
    };
    view.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: "KeyF",
        repeat: true,
        bubbles: true,
      }),
    );
    const repeated = {
      velocity: c.vehicle.velocity.toArray(),
      charges: c.powerups.abilities.get(54)?.charges ?? 0,
    };
    view.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyF", bubbles: true }),
    );
    view.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
    );
    const second = {
      velocity: c.vehicle.velocity.toArray(),
      charges: c.powerups.abilities.get(54)?.charges ?? 0,
    };
    view.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyF", bubbles: true }),
    );
    c.paused = true;
    return { initial, first, repeated, second, sounds };
  });
  const jumpIncrement = 12 / 6.9;
  assert.equal(jump.initial.charges, 6);
  assert.equal(jump.first.charges, 5);
  assert.equal(jump.repeated.charges, 5);
  assert.equal(jump.second.charges, 4);
  assert.ok(Math.abs(jump.first.velocity[0] - 3) < 1e-8);
  assert.ok(Math.abs(jump.first.velocity[1] - (-1.5 + jumpIncrement)) < 1e-8);
  assert.ok(Math.abs(jump.first.velocity[2] - 4) < 1e-8);
  assert.deepEqual(jump.first.angularVelocity, jump.initial.angularVelocity);
  assert.ok(
    Math.abs(jump.second.velocity[1] - (-1.5 + jumpIncrement * 2)) < 1e-8,
  );
  assert.deepEqual(jump.sounds, [9010, 9010]);

  const expiry = await page.evaluate(() => {
    const c = window.carma;
    const position = c.vehicle.position.clone();
    c.vehicle.position.set(10000, 100, 10000);
    c.powerups.resetPath(c.vehicle.position);
    const before = c.powerups.update(0, c.vehicle, c.race).instantHandbrake;
    const after = c.powerups.update(31, c.vehicle, c.race).instantHandbrake;
    c.vehicle.position.copy(position);
    return { before, after };
  });
  assert.deepEqual(expiry, { before: true, after: false });
  await page.screenshot({ path: "artifacts/browser-command-powerups.png" });

  const glError = await page.evaluate(() => {
    const gl = document.querySelector("#view").getContext("webgl2");
    if (!gl) throw new Error("WebGL2 context unavailable");
    return gl.getError();
  });
  assert.equal(glError, 0, "WebGL has no outstanding error");
  assert.deepEqual(errors, [], "Chromium has no page or console errors");
  assert.deepEqual(failedRequests, [], "all requested local assets load");
  const report = {
    selected,
    race,
    table,
    driveDistance,
    voucherGrant,
    recovery,
    rejectedRecovery,
    handbrakeEffect,
    handbrake,
    jump,
    expiry,
    errors,
    failedRequests,
    glError,
  };
  await writeFile(
    "artifacts/browser-command-powerups.json",
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
