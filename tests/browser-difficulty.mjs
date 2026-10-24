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
  await page.evaluate(() => (window.carma.paused = true));
  await checkInitialTables(2);
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  await page.close();
  const fresh = await browser.newPage();
  await fresh.goto(`http://127.0.0.1:${port}`);
  await fresh.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  assert.equal(await fresh.locator("#difficulty-select").inputValue(), "0");
  assert.equal(await fresh.evaluate(() => window.carma.simulation.skill), 0);
  console.log(
    "SKIP difficulty browser regression: Chromium or local C2 assets absent.",
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
  const checkInitialTables = async (skill) => {
    const sample = await page.evaluate(() => {
      const c = window.carma,
        settings = c.simulation.settings;
      return {
        skill: c.simulation.skill,
        levels: [...c.player.upgrades.levels],
        potential: [...c.player.upgrades.potential],
        credits: c.race.credits,
        authored: {
          initial: settings.initial.map((column) => column.skill),
          potential: settings.potential.map((column) => column.skill),
          money: settings.startingMoney.skill,
        },
      };
    });
    assert.equal(sample.skill, skill);
    assert.deepEqual(
      sample.levels,
      sample.authored.initial.map((column) => column[skill]),
    );
    assert.deepEqual(
      sample.potential,
      sample.authored.potential.map((column) => column[skill]),
    );
    assert.equal(sample.credits, sample.authored.money[skill]);
  };
  await page.addInitScript(() => localStorage.setItem("c2-difficulty", "1"));
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(
    () => window.carma?.stats.ready && window.carma?.simulation?.skill === 1,
    null,
    { timeout: 90000 },
  );
  await checkInitialTables(1);
  const selector = page.locator("#difficulty-select");
  await selector.waitFor();
  assert.deepEqual(await selector.locator("option").allTextContents(), [
    "Easy",
    "Medium",
    "Hard",
  ]);
  assert.equal(await selector.inputValue(), "1");
  await selector.selectOption("2");
  assert.equal(await page.evaluate(() => window.carma.simulation.skill), 1);
  assert.equal(
    await page.evaluate(() => localStorage.getItem("c2-difficulty")),
    "2",
  );
  const denied = await page.evaluate(async () => {
    const c = window.carma;
    const track = document.querySelector("#track-select");
    const original = track.value;
    const nuke = Array.from(track.options).find((option) =>
      /\/nuke\/nuke\.txt$/i.test(option.value),
    );
    if (!nuke) throw new Error("Original unavailable Nuke selection absent");
    track.value = nuke.value;
    await c.loadRace();
    track.value = original;
    track.dispatchEvent(new Event("change", { bubbles: true }));
    return {
      skill: c.simulation.skill,
      checkpointCredits: c.race.checkpointCredits,
    };
  });
  assert.equal(
    denied.skill,
    1,
    "unavailable-track preflight cannot change the current race skill",
  );
  await page.locator("#play").click();
  await page.waitForFunction(
    () => window.carma?.stats.ready && window.carma?.simulation?.skill === 2,
    null,
    { timeout: 90000 },
  );
  await page.evaluate(() => (window.carma.paused = true));
  await checkInitialTables(2);
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  await page.close();
  const fresh = await browser.newPage();
  await fresh.goto(`http://127.0.0.1:${port}`);
  await fresh.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  assert.equal(await fresh.locator("#difficulty-select").inputValue(), "0");
  assert.equal(await fresh.evaluate(() => window.carma.simulation.skill), 0);
  console.log(
    "PASS difficulty browser regression: persisted selection and per-load snapshot",
  );
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", resolve);
  });
}
