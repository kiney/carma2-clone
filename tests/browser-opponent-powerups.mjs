import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const assetRoot = process.env.CARMA2_ROOT || "carma2_orig";
try {
  await access(executable);
  await access(assetRoot);
} catch {
  console.log(
    "SKIP opponent powerup browser test: Chromium or C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5210;
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
  const catalogs = await page.evaluate(() => {
    const options = [...document.querySelector("#track-select").options];
    return {
      stock: options.find((option) => /NICE BEAVER/i.test(option.textContent))
        ?.value,
      advanced: options.find(
        (option) =>
          /^adv_data\//i.test(option.value) &&
          /carrier_mission\.txt$/i.test(option.value),
      )?.value,
      car: [...document.querySelector("#car-select").options].find((option) =>
        /eagle\s*3|eagle3/i.test(`${option.textContent} ${option.value}`),
      )?.value,
    };
  });
  assert.ok(
    catalogs.stock,
    "catalog-backed stock NICE BEAVER mission is missing",
  );
  assert.ok(catalogs.advanced, "catalog-backed ADV mission is missing");
  assert.ok(catalogs.car, "catalog-backed Eagle 3 is missing");

  const snapshots = [];
  for (const [caseName, trackPath, expectedOpponentCount] of [
    ["stock", catalogs.stock, 5],
    ["adv", catalogs.advanced, 10],
  ]) {
    console.log(`Loading ${caseName} mission: ${trackPath}`);
    await page.evaluate(
      async ({ trackPath, carPath }) => {
        const c = window.carma;
        document.querySelector("#track-select").value = trackPath;
        document.querySelector("#car-select").value = carPath;
        await c.loadRace();
        // Hold the race while async opponent assets finish loading so a large
        // authored grid does not run away during its own fixture setup.
        c.paused = true;
        document.querySelector("#panel").hidden = true;
        window.__opponentWorldContacts = [];
        const contacts = c.simulation.cameraContacts;
        const originalStep = contacts.step.bind(contacts);
        contacts.step = (impacts) => {
          originalStep(impacts);
          for (const impact of impacts) {
            if (
              impact.solverAccepted &&
              c.rivals.some(
                (rival) => impact.a === rival.body || impact.b === rival.body,
              )
            ) {
              window.__opponentWorldContacts.push({
                world: !impact.b,
                sourceType: impact.sourceType,
                impulse: impact.normalImpulse,
              });
            }
          }
        };
        const powerups = c.powerups;
        const originalFinish = powerups.finishFrame.bind(powerups);
        window.__opponentModifiers = null;
        powerups.finishFrame = (...args) => {
          const result = originalFinish(...args);
          window.__opponentModifiers = result;
          return result;
        };
      },
      { trackPath, carPath: catalogs.car },
    );
    await page.waitForFunction(
      () => window.carma.stats.ready && window.carma.paused,
      null,
      { timeout: 90000 },
    );
    await page.waitForFunction(
      (count) => window.carma.rivals.length === count,
      expectedOpponentCount,
      { timeout: 90000 },
    );
    const loadedRace = await page.evaluate(() => ({
      name: document.querySelector("#race-name").textContent,
      track: document.querySelector("#track-select").value,
      rivalCount: window.carma.rivals.length,
      configuredOpponentCount: window.carma.raceDefinition?.numberOfOpponents,
      raceType: window.carma.raceDefinition?.raceType,
      ready: window.carma.stats.ready,
      paused: window.carma.paused,
    }));
    assert.ok(
      loadedRace.rivalCount > 0,
      `${caseName}: selected mission has no opponents to exercise: ${JSON.stringify(loadedRace)}`,
    );
    await page.evaluate(() => (window.carma.paused = false));
    await page.locator("#view").click();
    const debugIsEnabled = await page.locator("#debug-enabled").isChecked();
    const debugPanelIsVisible = await page.locator("#debug-panel").isVisible();
    if (!debugIsEnabled || !debugPanelIsVisible)
      await page.click("#debug-button");
    assert.equal(await page.locator("#debug-enabled").isChecked(), true);
    assert.equal(await page.locator("#debug-freeze").isChecked(), true);

    const sample = () =>
      page.evaluate(() => {
        const c = window.carma;
        return {
          timer: c.race.timeLeft,
          elapsed: c.simulation.elapsed,
          gameTimeMs: c.stats.gameTimeMs,
          gameFrames: c.stats.gameFrames,
          player: {
            position: c.player.state.position.toArray(),
            velocity: c.player.state.velocity.toArray(),
            speed: c.player.state.speed,
          },
          rivals: c.rivals.map((rival) => ({
            id: rival.id,
            wasted: rival.wasted,
            frozen: rival.frozen,
            position: rival.state.position.toArray(),
            velocity: rival.state.velocity.toArray(),
            speed: rival.state.speed,
            accForce: rival.state.accForce,
            brakeForce: rival.state.brakeForce,
            mass: rival.body.motion.mass,
            registeredForPhysics: c.simulation.cars.includes(rival.body),
            engineFactor: rival.state.engineFactor ?? 1,
            tyreGripFactor: rival.state.tyreGripFactor ?? 1,
            suspensionPowerup: rival.body.suspensionPowerup,
          })),
          hotrodParameters: c.powerups.definitions[5]?.floatParams,
          modifiers: window.__opponentModifiers,
          powerups: c.powerups.active.map((effect) => ({ ...effect })),
          worldContacts: window.__opponentWorldContacts.length,
          worldRivalContacts: window.__opponentWorldContacts.filter(
            (contact) => contact.world,
          ).length,
        };
      });
    const grant = async (index) => {
      await page.selectOption("#debug-powerup", String(index));
      await page.click("#debug-grant");
      await page.waitForTimeout(250);
    };
    const moving = await sample();
    await page.waitForFunction(
      (start) =>
        window.carma.rivals.some(
          (rival, index) =>
            Math.hypot(
              rival.state.position.x - start[index][0],
              rival.state.position.y - start[index][1],
              rival.state.position.z - start[index][2],
            ) > 0.05,
        ),
      moving.rivals.map((rival) => rival.position),
      { timeout: 6000 },
    );
    const movingAfter = await sample();
    const moved = moving.rivals.some(
      (rival, index) =>
        Math.hypot(
          movingAfter.rivals[index].position[0] - rival.position[0],
          movingAfter.rivals[index].position[1] - rival.position[1],
          movingAfter.rivals[index].position[2] - rival.position[2],
        ) > 0.05,
    );
    assert.ok(
      moved,
      `${caseName}: normal AI rivals did not move before the powerup`,
    );

    let hotrodFixture = null;
    if (caseName === "stock") {
      hotrodFixture = await page.evaluate(() => {
        const rivals = window.carma.rivals;
        const native = rivals.find((rival) => rival.id === 29);
        const first = native ?? rivals.find((rival) => !rival.wasted);
        const second = rivals.find((rival) => rival !== first && !rival.wasted);
        if (!first || !second)
          throw new Error("Hotrod fixture needs two living stock opponents");
        const firstIndex = rivals.indexOf(first);
        const secondIndex = rivals.indexOf(second);
        const originalIds = [first.id, second.id];
        if (!native) {
          // Controlled test fixture: keep these real native car bodies/assets
          // but assign duplicate catalog identity 29 so the installed
          // special-opponent path can be observed without changing source.
          first.id = 29;
          second.id = 29;
        }
        return {
          actualCatalog29: Boolean(native),
          firstIndex,
          secondIndex,
          originalIds,
          firstBefore: {
            engineFactor: first.state.engineFactor ?? 1,
            tyreGripFactor: first.state.tyreGripFactor ?? 1,
            suspensionPowerup: first.body.suspensionPowerup,
          },
          secondBefore: {
            engineFactor: second.state.engineFactor ?? 1,
            tyreGripFactor: second.state.tyreGripFactor ?? 1,
            suspensionPowerup: second.body.suspensionPowerup,
          },
        };
      });
    }

    // Original powerup 15: Frozen opponents (action 14, factor zero).
    await grant(15);
    const frozen = await sample();
    assert.equal(frozen.modifiers.opponentSpeedFactor, 0);
    const livingFrozen = frozen.rivals.filter((rival) => !rival.wasted);
    assert.ok(
      livingFrozen.length > 0,
      `${caseName}: no living opponents to freeze`,
    );
    for (const rival of livingFrozen) {
      assert.equal(rival.frozen, true);
      assert.equal(rival.accForce, 0);
      assert.ok(
        Math.abs(rival.brakeForce - 15 * rival.mass) < 0.001,
        `${caseName}: freeze force mismatch for rival ${rival.id}`,
      );
    }
    if (hotrodFixture) {
      const activeHotrod = frozen.rivals[hotrodFixture.firstIndex];
      const unaffected = frozen.rivals[hotrodFixture.secondIndex];
      const parameters = frozen.hotrodParameters;
      assert.equal(activeHotrod.engineFactor, parameters[0]);
      assert.equal(activeHotrod.tyreGripFactor, parameters[1]);
      assert.deepEqual(activeHotrod.suspensionPowerup, {
        frontGiveMultiplier: parameters[2],
        rearGiveMultiplier: parameters[3],
        frontExtraLength: parameters[4],
        rearExtraLength: parameters[5],
        dampingMultiplier: parameters[6],
      });
      assert.equal(
        unaffected.engineFactor,
        hotrodFixture.secondBefore.engineFactor,
      );
      assert.equal(
        unaffected.tyreGripFactor,
        hotrodFixture.secondBefore.tyreGripFactor,
      );
    }
    await page.waitForTimeout(400);
    const freezingProgress = await sample();
    assert.ok(
      freezingProgress.elapsed > frozen.elapsed,
      `${caseName}: physics stopped during opponent freeze`,
    );
    assert.equal(
      freezingProgress.timer,
      frozen.timer,
      `${caseName}: debug timer freeze should hold race time`,
    );
    const beforePlayerDrive = freezingProgress.player;
    await page.keyboard.down("w");
    await page.waitForTimeout(500);
    await page.keyboard.up("w");
    const playerDuringFreeze = await sample();
    assert.ok(
      Math.hypot(
        playerDuringFreeze.player.position[0] - beforePlayerDrive.position[0],
        playerDuringFreeze.player.position[1] - beforePlayerDrive.position[1],
        playerDuringFreeze.player.position[2] - beforePlayerDrive.position[2],
      ) > 0.01,
      `${caseName}: player physics did not advance while the race timer and opponent controllers were frozen`,
    );
    assert.equal(playerDuringFreeze.timer, frozen.timer);
    assert.ok(
      freezingProgress.rivals
        .filter((rival) => !rival.wasted)
        .every((rival) => rival.registeredForPhysics),
      `${caseName}: freeze removed an opponent from the native physics body set`,
    );

    // Original powerup 93 cancels timed effects through its normal UI grant.
    await grant(93);
    const afterCancel = await sample();
    assert.equal(afterCancel.modifiers.opponentSpeedFactor, 1);
    assert.ok(
      afterCancel.rivals
        .filter((rival) => !rival.wasted)
        .every((rival) => !rival.frozen),
    );
    if (hotrodFixture) {
      const resetHotrod = afterCancel.rivals[hotrodFixture.firstIndex];
      const unaffected = afterCancel.rivals[hotrodFixture.secondIndex];
      assert.equal(resetHotrod.engineFactor, 1);
      assert.equal(resetHotrod.tyreGripFactor, 1);
      assert.deepEqual(resetHotrod.suspensionPowerup, {
        frontGiveMultiplier: 1,
        rearGiveMultiplier: 1,
        frontExtraLength: 0,
        rearExtraLength: 0,
        dampingMultiplier: 1,
      });
      assert.equal(
        unaffected.engineFactor,
        hotrodFixture.secondBefore.engineFactor,
      );
      assert.equal(
        unaffected.tyreGripFactor,
        hotrodFixture.secondBefore.tyreGripFactor,
      );
      if (!hotrodFixture.actualCatalog29) {
        await page.evaluate(({ firstIndex, secondIndex, originalIds }) => {
          const rivals = window.carma.rivals;
          rivals[firstIndex].id = originalIds[0];
          rivals[secondIndex].id = originalIds[1];
        }, hotrodFixture);
      }
    }

    // Original powerup 17: Turbo opponents (action 14, factor two).
    await grant(17);
    const turbo = await sample();
    assert.equal(turbo.modifiers.opponentSpeedFactor, 2);
    const turboEffect = turbo.powerups.find((effect) => effect.index === 17);
    assert.ok(turboEffect, `${caseName}: original turbo effect was not active`);
    assert.equal(turboEffect.duration, 30);
    const livingTurbo = turbo.rivals.filter((rival) => !rival.wasted);
    assert.ok(livingTurbo.length > 0);
    for (const rival of livingTurbo) {
      assert.ok(
        Math.abs(rival.accForce) <= 24 * rival.mass + 0.001,
        `${caseName}: turbo acceleration exceeded 24 per mass for rival ${rival.id}`,
      );
      assert.ok(
        Math.abs(rival.brakeForce) <= 24 * rival.mass + 0.001,
        `${caseName}: turbo braking exceeded 24 per mass for rival ${rival.id}`,
      );
    }
    assert.ok(
      livingTurbo.some((rival) => rival.accForce > 0),
      `${caseName}: turbo controller produced no positive force`,
    );

    // Original indices 16 and 18 target cops only. The current loader has no
    // cop actors, so ordinary racers and the player remain on their own paths.
    const rivalCount = turbo.rivals.length;
    await grant(16);
    const frozenCops = await sample();
    assert.equal(frozenCops.modifiers.copSpeedFactor, 0);
    assert.equal(frozenCops.modifiers.opponentSpeedFactor, 2);
    assert.equal(frozenCops.rivals.length, rivalCount);
    assert.deepEqual(
      {
        acceleration: frozenCops.modifiers.accelerationMultiplier,
        maxSpeed: frozenCops.modifiers.maxSpeedMultiplier,
        lateralGrip: frozenCops.modifiers.lateralGripMultiplier,
      },
      {
        acceleration: turbo.modifiers.accelerationMultiplier,
        maxSpeed: turbo.modifiers.maxSpeedMultiplier,
        lateralGrip: turbo.modifiers.lateralGripMultiplier,
      },
      `${caseName}: cop-only powerup changed human vehicle modifiers`,
    );
    assert.ok(
      frozenCops.rivals
        .filter((rival) => !rival.wasted)
        .every((rival) => !rival.frozen),
    );
    await grant(18);
    const turboCops = await sample();
    assert.equal(turboCops.modifiers.copSpeedFactor, 2);
    assert.equal(turboCops.modifiers.opponentSpeedFactor, 2);
    assert.equal(turboCops.rivals.length, rivalCount);
    assert.deepEqual(
      {
        acceleration: turboCops.modifiers.accelerationMultiplier,
        maxSpeed: turboCops.modifiers.maxSpeedMultiplier,
        lateralGrip: turboCops.modifiers.lateralGripMultiplier,
      },
      {
        acceleration: turbo.modifiers.accelerationMultiplier,
        maxSpeed: turbo.modifiers.maxSpeedMultiplier,
        lateralGrip: turbo.modifiers.lateralGripMultiplier,
      },
      `${caseName}: cop-only turbo changed human vehicle modifiers`,
    );

    if (caseName === "stock") {
      // With the debug timer frozen, native powerup time still advances. Let
      // the real 30-second effect expire on the loaded game clock.
      const expiryStart = await sample();
      await page.waitForFunction(
        () =>
          window.__opponentModifiers?.opponentSpeedFactor === 1 &&
          window.__opponentModifiers?.copSpeedFactor === 1,
        null,
        { timeout: 65000, polling: 250 },
      );
      const expired = await sample();
      assert.ok(
        expired.gameTimeMs >= turboEffect.expiresAtMs,
        `stock turbo expired before its native deadline: ${expired.gameTimeMs} < ${turboEffect.expiresAtMs}`,
      );
      assert.equal(
        expired.timer,
        expiryStart.timer,
        "debug timer freeze must not freeze the opponent powerup's 30-second expiry",
      );
      assert.equal(expired.modifiers.copSpeedFactor, 1);
      await page.screenshot({
        path: "artifacts/browser-opponent-powerups-stock-expired.png",
      });
    } else {
      await grant(93);
      const afterAdvancedCancel = await sample();
      assert.equal(afterAdvancedCancel.modifiers.opponentSpeedFactor, 1);
      assert.equal(afterAdvancedCancel.modifiers.copSpeedFactor, 1);
    }

    const end = await sample();
    console.log(
      `${caseName} opponent-powerup runtime: ${JSON.stringify({
        loadedRace,
        rivalIds: end.rivals.map((rival) => rival.id),
        worldRivalContacts: end.worldRivalContacts,
        modifierState: end.modifiers,
      })}`,
    );
    snapshots.push({
      caseName,
      moving,
      movingAfter,
      frozen,
      freezingProgress,
      playerDuringFreeze,
      afterCancel,
      turbo,
      frozenCops,
      turboCops,
      end,
    });
    await page.screenshot({
      path: `artifacts/browser-opponent-powerups-${caseName}.png`,
    });
  }

  const webglErrors = await page.evaluate(() => {
    const gl = document.querySelector("#view").getContext("webgl2");
    if (!gl) throw new Error("WebGL2 context unavailable");
    const result = [];
    for (let i = 0; i < 16; i++) {
      const error = gl.getError();
      if (error === gl.NO_ERROR) break;
      result.push(error);
    }
    return result;
  });
  assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
  assert.deepEqual(
    failedRequests,
    [],
    `failed requests: ${failedRequests.join(" | ")}`,
  );
  assert.deepEqual(webglErrors, [], `WebGL errors: ${webglErrors.join(",")}`);
  console.log(
    JSON.stringify(
      { catalogs, snapshots, errors, failedRequests, webglErrors },
      null,
      2,
    ),
  );
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
