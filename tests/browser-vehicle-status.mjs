import assert from "node:assert/strict";
import { access, mkdir } from "node:fs/promises";
import net from "node:net";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP vehicle status browser regression: Chromium or C2 assets absent",
  );
  process.exit(0);
}

const reservation = net.createServer();
await new Promise((resolve, reject) => {
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", resolve);
});
const { port } = reservation.address();
await new Promise((resolve, reject) =>
  reservation.close((error) => (error ? reject(error) : resolve())),
);
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
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
    polling: 100,
  });
  await page.evaluate(async () => {
    const c = window.carma;
    const track = c.assets.resolve("data/RACES/newcity1/newcity1.txt");
    const car = c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT");
    if (!track || !car) throw new Error("Stock Newcity/EAGLE3 is unavailable");
    document.querySelector("#track-select").value = track;
    document.querySelector("#car-select").value = car;
    c.paused = true;
    await c.loadRace();
    c.paused = true;
  });
  await page.waitForFunction(
    () =>
      window.carma?.stats.ready &&
      window.carma?.opponentsReady &&
      window.carma?.paused,
    null,
    { timeout: 90000, polling: 100 },
  );

  const fixture = [0, 9, 18, 27, 36, 45, 54, 63, 72, 81, 90, 99];
  const rows = await page.evaluate((levels) => {
    const c = window.carma;
    const components = c.player.damage.componentLevels;
    if (components.length !== levels.length)
      throw new Error(
        `Expected 12 damage components, got ${components.length}`,
      );
    levels.forEach((value, index) => (components[index] = value));
    document.querySelector("#vehicle-status-menu").open = true;
    return true;
  }, fixture);
  assert.equal(rows, true);
  await page.waitForFunction(
    (levels) => {
      const rows = [
        ...document.querySelectorAll(
          ".vehicle-status__component--menu progress",
        ),
      ];
      return (
        rows.length === levels.length &&
        rows.every((node, index) => node.value === levels[index])
      );
    },
    fixture,
    { timeout: 10000 },
  );
  const componentReport = await page.evaluate(() => {
    const read = (selector) =>
      [...document.querySelectorAll(selector)].map((row) => ({
        label: row.querySelector(".vehicle-status__label")?.textContent,
        aria: row.getAttribute("aria-label"),
        progress: row.querySelector("progress")?.value,
        value: row.querySelector(".vehicle-status__value")?.textContent,
      }));
    return {
      hud: read(".vehicle-status__component--hud"),
      menu: read(".vehicle-status__component--menu"),
    };
  });
  const expected = [
    ["Engine", "Engine"],
    ["Trans", "Transmission"],
    ["Driver", "Driver"],
    ["Steering", "Steering"],
    ["LF brake", "Left front brake"],
    ["RF brake", "Right front brake"],
    ["LR brake", "Left rear brake"],
    ["RR brake", "Right rear brake"],
    ["LF wheel", "Left front wheel"],
    ["RF wheel", "Right front wheel"],
    ["LR wheel", "Left rear wheel"],
    ["RR wheel", "Right rear wheel"],
  ];
  assert.equal(componentReport.hud.length, 12);
  assert.equal(componentReport.menu.length, 12);
  for (let index = 0; index < expected.length; index++) {
    const [shortName, fullName] = expected[index];
    const level = fixture[index];
    assert.deepEqual(componentReport.hud[index], {
      label: shortName,
      aria: `${fullName} damage`,
      progress: level,
      value: `${level} / 99`,
    });
    assert.deepEqual(componentReport.menu[index], {
      label: fullName,
      aria: `${fullName} damage`,
      progress: level,
      value: `Damage ${level} / 99`,
    });
  }

  await page
    .getByLabel("Debug mode (timer, credits, powerups)", { exact: true })
    .check();
  await page.waitForFunction(
    () => !document.querySelector("#debug-controls").disabled,
  );
  assert.equal(await page.locator("#debug-freeze").isChecked(), true);
  await page.click("#debug-repair");
  await page.waitForFunction(
    () =>
      [
        ...document.querySelectorAll(
          ".vehicle-status__component--menu progress",
        ),
      ].every((node) => node.value === 0),
    null,
    { timeout: 10000 },
  );
  const repaired = await page.evaluate(
    () => window.carma.player.damage.componentLevels,
  );
  assert.deepEqual([...repaired], Array(12).fill(0));

  const selectedDefinitions = await page.evaluate(() => {
    const c = window.carma;
    const allowedActions = new Set([
      5, 6, 8, 10, 14, 15, 16, 17, 18, 22, 27, 28, 29, 31, 48,
    ]);
    const definitions = c.powerups.definitions.filter((definition) =>
      allowedActions.has(definition.action),
    );
    const timed = definitions.find(
      (definition) => definition.duration > 1 && definition.action === 14,
    );
    const wholeRace = definitions.find(
      (definition) => definition.duration === 0 && definition.action === 29,
    );
    const cancellation =
      timed &&
      definitions.find(
        (definition) =>
          definition.index !== timed.index &&
          definition.action === timed.action &&
          definition.duration > 0 &&
          (definition.groupInclusion & timed.groupInclusion & 0xffff) !== 0,
      );
    if (!timed || !wholeRace || !cancellation)
      throw new Error(
        `Original POWERUP table lacks test cases: ${JSON.stringify(definitions.map(({ index, message, action, duration, groupInclusion }) => ({ index, message, action, duration, groupInclusion })))}`,
      );
    return {
      timed: {
        index: timed.index,
        message: timed.message,
        action: timed.action,
      },
      wholeRace: {
        index: wholeRace.index,
        message: wholeRace.message,
        action: wholeRace.action,
      },
      cancellation: {
        index: cancellation.index,
        message: cancellation.message,
        action: cancellation.action,
      },
    };
  });

  // All powerup grants use the visible debug controls and the normal pickup path.
  const grant = async (index) => {
    await page.selectOption("#debug-powerup", String(index));
    await page.click("#debug-grant");
  };
  await page.evaluate(() => (window.carma.paused = false));
  await grant(selectedDefinitions.timed.index);
  const renewedBefore = await page.evaluate((index) => {
    const active = window.carma.powerups
      .activeEffectsFor(window.carma.vehicle)
      .filter((effect) => effect.index === index);
    return active;
  }, selectedDefinitions.timed.index);
  assert.equal(
    renewedBefore.length,
    1,
    "normal grant did not create one active timed effect",
  );
  await grant(selectedDefinitions.timed.index);
  const renewal = await page.evaluate(
    (index) => ({
      active: window.carma.powerups
        .activeEffectsFor(window.carma.vehicle)
        .filter((effect) => effect.index === index),
      rows: [
        ...document.querySelectorAll(".vehicle-status__effect--menu"),
      ].filter((row) => row.dataset.powerupIndex === String(index)).length,
    }),
    selectedDefinitions.timed.index,
  );
  assert.equal(
    renewal.active.length,
    1,
    "renewal duplicated the effect record",
  );
  assert.equal(renewal.rows, 1, "renewal duplicated the status row");
  await grant(selectedDefinitions.cancellation.index);
  await page.waitForFunction(
    (indexes) =>
      document.querySelector(
        `.vehicle-status__effect--menu[data-powerup-index="${indexes[0]}"]`,
      ) === null &&
      document.querySelector(
        `.vehicle-status__effect--menu[data-powerup-index="${indexes[1]}"]`,
      ) !== null,
    [selectedDefinitions.timed.index, selectedDefinitions.cancellation.index],
    { timeout: 5000 },
  );
  const cancelled = await page.evaluate(
    (indexes) => ({
      active: window.carma.powerups
        .activeEffectsFor(window.carma.vehicle)
        .map((effect) => effect.index),
      rows: [...document.querySelectorAll(".vehicle-status__effect--menu")].map(
        (row) => Number(row.dataset.powerupIndex),
      ),
    }),
    [selectedDefinitions.timed.index, selectedDefinitions.cancellation.index],
  );
  assert.ok(
    !cancelled.active.includes(selectedDefinitions.timed.index),
    "conflicting grant did not cancel the older effect",
  );
  assert.ok(cancelled.active.includes(selectedDefinitions.cancellation.index));
  assert.deepEqual(
    cancelled.rows,
    cancelled.active,
    "menu did not remove cancelled effect row",
  );

  await grant(selectedDefinitions.wholeRace.index);
  await page.waitForFunction(
    (index) =>
      document.querySelector(
        `.vehicle-status__effect--hud[data-powerup-index="${index}"]`,
      ) !== null &&
      document.querySelector(
        `.vehicle-status__effect--menu[data-powerup-index="${index}"]`,
      ) !== null,
    selectedDefinitions.wholeRace.index,
    { timeout: 5000 },
  );
  const persistent = await page.evaluate((index) => {
    const state = window.carma.powerups
      .activeEffectsFor(window.carma.vehicle)
      .find((effect) => effect.index === index);
    const hud = document.querySelector(
      `.vehicle-status__effect--hud[data-powerup-index="${index}"]`,
    );
    const menu = document.querySelector(
      `.vehicle-status__effect--menu[data-powerup-index="${index}"]`,
    );
    return {
      state,
      hudName: hud?.querySelector(".vehicle-status__effect-name")?.textContent,
      hudDuration: hud?.querySelector(".vehicle-status__effect-duration")
        ?.textContent,
      menuName: menu?.querySelector(".vehicle-status__effect-name")
        ?.textContent,
      menuDuration: menu?.querySelector(".vehicle-status__effect-duration")
        ?.textContent,
    };
  }, selectedDefinitions.wholeRace.index);
  assert.equal(
    persistent.state?.remainingSeconds,
    null,
    "whole-race effect should expose no countdown",
  );
  assert.deepEqual(persistent, {
    state: {
      index: selectedDefinitions.wholeRace.index,
      name: selectedDefinitions.wholeRace.message,
      remainingSeconds: null,
    },
    hudName: selectedDefinitions.wholeRace.message,
    hudDuration: "Race",
    menuName: selectedDefinitions.wholeRace.message,
    menuDuration: "Race",
  });
  await page.click("#debug-close");
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/vehicle-status.png" });
  await page.click("#debug-button");

  const beforeExpiry = await page.evaluate(() => ({
    timer: window.carma.race.timeLeft,
    simulation: window.carma.simulation.elapsed,
  }));
  await page.evaluate((index) => {
    const definition = window.carma.powerups.definitions.find(
      (item) => item.index === index,
    );
    definition.duration = 0.5; // In-memory fixture: make the normal effect expiry bounded.
  }, selectedDefinitions.timed.index);
  await grant(selectedDefinitions.timed.index);
  await page.waitForFunction(
    (index) =>
      !window.carma.powerups
        .activeEffectsFor(window.carma.vehicle)
        .some((effect) => effect.index === index),
    selectedDefinitions.timed.index,
    { timeout: 3000, polling: 50 },
  );
  await page.waitForFunction(
    (index) =>
      !document.querySelector(
        `.vehicle-status__effect--hud[data-powerup-index="${index}"]`,
      ) &&
      !document.querySelector(
        `.vehicle-status__effect--menu[data-powerup-index="${index}"]`,
      ),
    selectedDefinitions.timed.index,
    { timeout: 5000 },
  );
  const afterExpiry = await page.evaluate(
    (index) => ({
      timer: window.carma.race.timeLeft,
      simulation: window.carma.simulation.elapsed,
      active: window.carma.powerups.activeEffectsFor(window.carma.vehicle),
      hudRows: [
        ...document.querySelectorAll(".vehicle-status__effect--hud"),
      ].map((row) => Number(row.dataset.powerupIndex)),
      menuRows: [
        ...document.querySelectorAll(".vehicle-status__effect--menu"),
      ].map((row) => Number(row.dataset.powerupIndex)),
      timerFrozen: window.carma.debugMode?.timerFrozen,
    }),
    selectedDefinitions.timed.index,
  );
  assert.equal(afterExpiry.timerFrozen, true);
  assert.equal(
    afterExpiry.timer,
    beforeExpiry.timer,
    "timer freeze should hold during powerup expiry",
  );
  assert.ok(
    afterExpiry.simulation > beforeExpiry.simulation,
    "physics/game clock should advance during expiry",
  );
  assert.ok(
    !afterExpiry.active.some(
      (effect) => effect.index === selectedDefinitions.timed.index,
    ),
  );
  assert.ok(
    !afterExpiry.hudRows.includes(selectedDefinitions.timed.index),
    "expired effect remained in HUD",
  );
  assert.ok(
    !afterExpiry.menuRows.includes(selectedDefinitions.timed.index),
    "expired effect remained in menu",
  );

  await page.evaluate(() => {
    window.carma.paused = true;
    document.querySelector("#vehicle-status-menu").open = true;
  });
  await page.evaluate(async () => {
    await window.carma.loadRace();
    window.carma.paused = true;
  });
  await page.waitForFunction(
    () =>
      window.carma?.stats.ready &&
      window.carma?.opponentsReady &&
      window.carma?.paused,
    null,
    { timeout: 90000, polling: 100 },
  );
  const reset = await page.evaluate(() => ({
    active: window.carma.powerups.activeEffectsFor(window.carma.vehicle),
    menuRows: document.querySelectorAll(".vehicle-status__effect--menu").length,
    values: [
      ...document.querySelectorAll(".vehicle-status__component--menu progress"),
    ].map((node) => node.value),
  }));
  assert.deepEqual(
    reset.active,
    [],
    "fresh race retained prior powerup effects",
  );
  assert.equal(reset.menuRows, 0, "fresh race retained old effect rows");
  assert.deepEqual(
    reset.values,
    Array(12).fill(0),
    "fresh race retained component damage fixture",
  );

  const renderer = await page.evaluate(() => {
    const gl = window.carma.renderer.getContext();
    return {
      webgl2: gl instanceof WebGL2RenderingContext,
      error: gl.getError(),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    };
  });
  assert.equal(renderer.webgl2, true);
  assert.equal(renderer.error, 0);
  assert.ok(renderer.drawingBuffer.every((value) => value > 0));
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  console.log(
    "PASS vehicle status",
    JSON.stringify({
      selectedDefinitions,
      componentReport,
      renewal,
      cancelled,
      persistent,
      beforeExpiry,
      afterExpiry,
      reset,
      renderer,
      errors,
      failedRequests,
    }),
  );
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once("exit", resolve);
    });
  }
}
