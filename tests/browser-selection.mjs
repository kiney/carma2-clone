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
    "SKIP selection browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5298;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
let browser;
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
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
  });
  const pageErrors = [];
  const consoleErrors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`),
  );

  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.waitForFunction(() => window.carma?.paused, null, {
    timeout: 30000,
  });
  await page.locator("#selection .location-tile").first().waitFor();
  assert.equal(
    await page
      .locator("#track-select")
      .evaluate((e) => Boolean(e.closest("[hidden]"))),
    true,
  );
  assert.equal(
    await page
      .locator("#car-select")
      .evaluate((e) => Boolean(e.closest("[hidden]"))),
    true,
  );

  const stockRace = await page
    .locator("#track-select")
    .evaluate(
      (select) =>
        Array.from(select.options).find((option) =>
          /^data\/RACES\/newcity1\/newcity1\.txt$/i.test(option.value),
        )?.value,
    );
  const missionRace = await page
    .locator("#track-select")
    .evaluate(
      (select) =>
        Array.from(select.options).find((option) =>
          /^data\/RACES\/newcity_mission\/newcity_mission\.txt$/i.test(
            option.value,
          ),
        )?.value,
    );
  const stockCar = await page
    .locator("#car-select")
    .evaluate(
      (select) =>
        Array.from(select.options).find((option) =>
          /^data\/CARS\/EAGLE3\/EAGLE3\.TXT$/i.test(option.value),
        )?.value,
    );
  assert.ok(stockRace, "stock Newcity race is available");
  assert.ok(missionRace, "stock Newcity mission is available");
  assert.ok(stockCar, "stock Eagle car is available");

  await page.locator('.source-tab[data-source="data"]').click();
  await page.locator("#race-search").fill("NICE BEAVER");
  const newcityTile = page.locator("#selection .location-tile").first();
  assert.equal(await newcityTile.count(), 1);
  await newcityTile.focus();
  await page.keyboard.press("Enter");
  assert.equal(await newcityTile.getAttribute("aria-pressed"), "true");

  const newcityMissionPaths = await page
    .locator("#selection .mission-tile")
    .evaluateAll((buttons) => buttons.map((button) => button.dataset.race));
  assert.ok(
    newcityMissionPaths.includes(stockRace),
    `Newcity group misses stock race ${stockRace}: ${newcityMissionPaths.join(", ")}`,
  );
  assert.ok(
    newcityMissionPaths.includes(missionRace),
    `Newcity group misses mission ${missionRace}: ${newcityMissionPaths.join(", ")}`,
  );
  assert.ok(
    newcityMissionPaths.filter((path) => /newcity/i.test(path)).length >= 4,
    `Newcity family should retain original race variants: ${newcityMissionPaths.join(", ")}`,
  );
  const newcityRaceNames = await page
    .locator("#selection .mission-tile strong")
    .allTextContents();
  for (const name of [
    "NICE BEAVER",
    "CITY SLICKER",
    "CITY OF THE LOST GIBLETS",
    "THE BRUISE BROTHERS",
    "MISSION: EYE OF THE BEAVER",
  ])
    assert.ok(
      newcityRaceNames.includes(name),
      `Newcity race label is retained: ${name}`,
    );
  const missionTile = page.locator(
    `#selection .mission-tile[data-race="${missionRace}"]`,
  );
  await missionTile.click();
  assert.equal(await missionTile.getAttribute("aria-pressed"), "true");
  assert.match(await missionTile.innerText(), /Mission ·/i);
  await page.locator("#race-search").fill("no matching location 8ab17");
  assert.equal(await page.locator("#selection .location-tile").count(), 0);
  assert.equal(await page.locator("#track-select").inputValue(), missionRace);
  await page.locator("#race-search").fill("");
  await page.locator("#race-search").fill("NICE BEAVER");

  await page.locator("#car-search").fill("EAGLE3");
  const stockCarTile = page.locator(
    `#selection .vehicle-tile[data-car="${stockCar}"]`,
  );
  await stockCarTile.scrollIntoViewIfNeeded();
  await stockCarTile.waitFor();
  const stockCarPreview = stockCarTile.locator(".selection-picture");
  await stockCarPreview.waitFor({ state: "visible" });
  await stockCarPreview.evaluate(
    (frame) =>
      new Promise((resolve, reject) => {
        const started = Date.now();
        const check = () => {
          if (frame.classList.contains("preview-ready")) resolve(true);
          else if (frame.classList.contains("preview-unavailable"))
            reject(new Error(frame.textContent));
          else if (Date.now() - started > 45000)
            reject(new Error("stock car preview timed out"));
          else setTimeout(check, 100);
        };
        check();
      }),
  );
  assert.match(
    await stockCarPreview.locator("img").getAttribute("src"),
    /^data:image\/png;base64,/,
    "car preview is decoded from native installation artwork",
  );
  assert.deepEqual(
    await stockCarPreview.locator("img").evaluate((image) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    })),
    { width: 192, height: 128 },
    "car tile composes all six native views into the selector preview",
  );

  const stockLocationPreview = newcityTile.locator(".selection-picture");
  await stockLocationPreview.evaluate(
    (frame) =>
      new Promise((resolve, reject) => {
        const started = Date.now();
        const check = () => {
          if (frame.classList.contains("preview-ready")) resolve(true);
          else if (frame.classList.contains("preview-unavailable"))
            reject(new Error(frame.textContent));
          else if (Date.now() - started > 60000)
            reject(new Error("stock track preview timed out"));
          else setTimeout(check, 150);
        };
        check();
      }),
  );
  assert.match(
    await stockLocationPreview.locator("img").getAttribute("src"),
    /^data:image\/png;base64,/,
    "location preview is rendered from the selected native track scene",
  );

  // Select a playable nonmission variant, run the normal load path, then
  // verify the saved choices survive a menu pause and a fresh page load.
  await page
    .locator(`#selection .mission-tile[data-race="${stockRace}"]`)
    .click();
  await stockCarTile.click();
  assert.equal(await page.locator("#track-select").inputValue(), stockRace);
  assert.equal(await page.locator("#car-select").inputValue(), stockCar);
  await page.locator("#play").click();
  await page.waitForFunction(
    () =>
      window.carma?.stats.ready &&
      !window.carma.paused &&
      window.carma.raceDefinition?.name === "NICE BEAVER",
    null,
    { timeout: 90000 },
  );
  await page.locator("#menu-button").click();
  await page.waitForFunction(() => window.carma?.paused, null, {
    timeout: 10000,
  });
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("c2-selection")),
  );
  assert.equal(saved.track, stockRace);
  assert.equal(saved.car, stockCar);

  await page.reload();
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.waitForFunction(() => window.carma?.paused, null, {
    timeout: 30000,
  });
  assert.equal(await page.locator("#track-select").inputValue(), stockRace);
  assert.equal(await page.locator("#car-select").inputValue(), stockCar);

  await page.locator('.source-tab[data-source="adv_data"]').click();
  assert.equal(
    await page
      .locator('.source-tab[data-source="adv_data"]')
      .getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#race-search").fill("BLOOD ON THE ROOF TOPS");
  const advancedRace = await page
    .locator("#track-select")
    .evaluate(
      (select) =>
        Array.from(select.options).find((option) =>
          /\/BloodOnTheRooftops\.txt$/i.test(option.value),
        )?.value,
    );
  const advancedCar = await page
    .locator("#car-select")
    .evaluate(
      (select) =>
        Array.from(select.options).find((option) =>
          /^adv_data\/cars\//i.test(option.value),
        )?.value,
    );
  assert.ok(advancedRace, "an Advanced original race is available");
  assert.ok(advancedCar, "an Advanced original car is available");
  const advancedLocation = page.locator("#selection .location-tile").first();
  assert.equal(await advancedLocation.count(), 1);
  await advancedLocation.click();
  const advancedMission = page.locator(
    `#selection .mission-tile[data-race="${advancedRace}"]`,
  );
  await advancedMission.click();
  await page.locator("#car-search").fill(
    advancedCar
      .split("/")
      .at(-1)
      .replace(/\.txt$/i, ""),
  );
  const advancedCarTile = page.locator(
    `#selection .vehicle-tile[data-car="${advancedCar}"]`,
  );
  await advancedCarTile.scrollIntoViewIfNeeded();
  await advancedCarTile.click();
  await advancedCarTile.locator(".selection-picture.preview-ready").waitFor({
    timeout: 45000,
  });
  assert.deepEqual(
    await advancedCarTile
      .locator(".selection-picture img")
      .evaluate((image) => ({
        width: image.naturalWidth,
        height: image.naturalHeight,
      })),
    { width: 192, height: 128 },
    "Advanced car tile composes the native view fragments",
  );
  assert.equal(await page.locator("#track-select").inputValue(), advancedRace);
  assert.equal(await page.locator("#car-select").inputValue(), advancedCar);
  await advancedLocation
    .locator(".selection-picture.preview-ready")
    .waitFor({ timeout: 60000 });

  await page.locator("#play").click();
  await page.waitForFunction(
    () =>
      window.carma?.stats.ready &&
      !window.carma.paused &&
      window.carma.raceDefinition?.name === "BLOOD ON THE ROOF TOPS",
    null,
    { timeout: 90000 },
  );
  const loadedCarName = await page.evaluate(() => window.carma.carConfig?.name);
  assert.ok(
    loadedCarName,
    "normal load populated the selected car configuration",
  );
  assert.ok(
    loadedCarName.toLowerCase().includes(
      advancedCar
        .split("/")
        .at(-1)
        .replace(/\.txt$/i, "")
        .toLowerCase(),
    ),
    `loaded car ${loadedCarName} matches selected path ${advancedCar}`,
  );

  await page.locator("#menu-button").click();
  await page.waitForFunction(() => window.carma?.paused, null, {
    timeout: 10000,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(
    overflow.document <= overflow.viewport + 1 &&
      overflow.body <= overflow.viewport + 1,
    `narrow selector overflows horizontally: ${JSON.stringify(overflow)}`,
  );
  await page.screenshot({
    path: "artifacts/browser-selection.png",
    fullPage: true,
  });
  await writeFile(
    "artifacts/browser-selection.json",
    JSON.stringify(
      { pageErrors, consoleErrors, failedRequests, overflow },
      null,
      2,
    ) + "\n",
  );
  assert.deepEqual(pageErrors, [], "browser page has no uncaught errors");
  assert.deepEqual(failedRequests, [], "browser requests all succeed");
  assert.deepEqual(consoleErrors, [], "browser console has no errors");
  console.log("PASS selection browser regression", JSON.stringify(overflow));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
