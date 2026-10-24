import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import net from "node:net";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP powerup bend browser regression: Chromium or C2 assets absent",
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

  const loadRace = async () => {
    await page.evaluate(async () => {
      const c = window.carma;
      const track = c.assets.resolve("data/RACES/newcity1/newcity1.txt");
      const car = c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT");
      if (!track || !car)
        throw new Error("Stock Newcity/EAGLE3 is unavailable");
      document.querySelector("#track-select").value = track;
      document.querySelector("#car-select").value = car;
      c.paused = true;
      await c.loadRace();
      c.paused = true;
    });
    await page.waitForFunction(
      () =>
        window.carma?.stats.ready &&
        window.carma?.player &&
        window.carma?.simulation &&
        window.carma?.opponentsReady &&
        window.carma?.paused,
      null,
      { timeout: 90000, polling: 100 },
    );
  };

  const syncModifiers = async () => {
    const targetFrame = await page.evaluate(() => {
      const c = window.carma;
      const frame = c.stats.gameFrames + 1;
      c.paused = false;
      return frame;
    });
    await page.waitForFunction(
      (frame) => window.carma.stats.gameFrames >= frame,
      targetFrame,
      {
        timeout: 5000,
        polling: 20,
      },
    );
    await page.evaluate(() => (window.carma.paused = true));
  };

  const snapshot = () =>
    page.evaluate(() => {
      const c = window.carma;
      const body = c.player;
      const motion = body.motion;
      const suspension = body.suspensionPowerup;
      return {
        engineFactor: body.state.engineFactor,
        tyreGripFactor: body.state.tyreGripFactor,
        protection: body.protection,
        suspension: suspension ? { ...suspension } : null,
        spring: [...motion.spring],
        damper: [...motion.damper],
        suspensionLength: [...motion.suspensionLength],
      };
    });

  const results = [];
  const defaultSuspension = {
    frontGiveMultiplier: 1,
    rearGiveMultiplier: 1,
    frontExtraLength: 0,
    rearExtraLength: 0,
    dampingMultiplier: 1,
  };
  const resetSuspensionFor = (index, baseline) =>
    index === 5 || index === 23 ? defaultSuspension : baseline;
  const runAccepted = async (index, { gates = false } = {}) => {
    await loadRace();
    const setup = await page.evaluate((powerupIndex) => {
      const c = window.carma;
      const definition = c.powerups.definitions[powerupIndex];
      if (
        !definition ||
        definition.index !== powerupIndex ||
        !(definition.flags & 4)
      )
        throw new Error(
          `Powerup ${powerupIndex} is not an authored structural-bend removal effect`,
        );
      if (typeof c.player.damage.onBeforeStructuralBend !== "function")
        throw new Error("Player structural-bend callback was not bound");
      const base = {
        engineFactor: c.player.state.engineFactor,
        tyreGripFactor: c.player.state.tyreGripFactor,
        protection: c.player.protection,
        suspension: c.player.suspensionPowerup
          ? { ...c.player.suspensionPowerup }
          : null,
        spring: [...c.player.motion.spring],
        damper: [...c.player.motion.damper],
        suspensionLength: [...c.player.motion.suspensionLength],
      };
      if (!c.powerups.grant(powerupIndex, c.vehicle, c.race))
        throw new Error(`Could not grant original powerup ${powerupIndex}`);
      if (!c.powerups.grant(24, c.vehicle, c.race))
        throw new Error(
          "Could not grant original whole-race pedestrian-map effect",
        );
      return { base, active: c.powerups.activeEffectsFor(c.vehicle) };
    }, index);
    assert.ok(setup.active.some((effect) => effect.index === index));
    await syncModifiers();
    const powered = await snapshot();
    if (index === 5)
      assert.notEqual(
        powered.engineFactor,
        1,
        "Hotrod fixture did not change engine factor",
      );
    if (index === 23)
      assert.notDeepEqual(
        powered.suspension,
        setup.base.suspension,
        "Jelly fixture did not change suspension parameters",
      );
    if (index === 39)
      assert.notEqual(
        powered.protection,
        1,
        "Granite fixture did not change protection",
      );

    const repair = await page.evaluate((powerupIndex) => {
      const c = window.carma;
      c.simulation.repair(c.player);
      return c.powerups
        .activeEffectsFor(c.vehicle)
        .map((effect) => effect.index);
    }, index);
    assert.ok(
      repair.includes(index),
      "ordinary simulation repair removed a flag-4 effect",
    );
    await syncModifiers();

    const bend = await page.evaluate(
      ({ powerupIndex, exerciseGates }) => {
        const c = window.carma;
        const damage = c.player.damage;
        const report = {
          powerupIndex,
          callbacks: 0,
          before: undefined,
          afterCallback: undefined,
        };
        const originalHook = damage.onBeforeStructuralBend;
        const originalRandom = damage.damageContext.random;
        const originalSnappability = damage.wam.snappability;
        const Point = c.player.state.position.constructor;
        const mean = new Point(0, 0, damage.wam.bendZMin - 1);
        const direction = new Point(0, 0, 1);
        const read = () => ({
          effects: c.powerups.activeEffectsFor(c.vehicle),
          engineFactor: c.player.state.engineFactor,
          tyreGripFactor: c.player.state.tyreGripFactor,
          protection: c.player.protection,
          suspension: c.player.suspensionPowerup
            ? { ...c.player.suspensionPowerup }
            : null,
          spring: [...c.player.motion.spring],
          damper: [...c.player.motion.damper],
          suspensionLength: [...c.player.motion.suspensionLength],
          components: [...damage.componentLevels],
          alreadyBent: !!damage.structuralBend,
        });
        damage.damageContext.random = () => 0;
        damage.wam.snappability = 0;
        damage.onBeforeStructuralBend = () => {
          report.callbacks++;
          report.before = read();
          originalHook?.call(damage);
          report.afterCallback = read();
        };
        try {
          if (exerciseGates) {
            damage.damageContext.invulnerable = true;
            report.immuneAttempt = damage.applyDeferredBend(
              mean,
              direction,
              6,
              c.simulation.elapsed * 1000,
              true,
            );
            report.afterImmune = read();
            damage.damageContext.invulnerable = false;
          }
          report.componentBaseline = [...damage.componentLevels];
          report.accepted = damage.applyDeferredBend(
            mean,
            direction,
            6,
            c.simulation.elapsed * 1000,
            true,
          );
          report.afterAccepted = read();
          report.structuralBend = !!damage.structuralBend;
          if (exerciseGates) {
            c.powerups.grant(powerupIndex, c.vehicle, c.race);
            report.afterSecondGrant = c.powerups.activeEffectsFor(c.vehicle);
            damage.applyDeferredBend(
              mean,
              direction,
              6,
              c.simulation.elapsed * 1000,
              true,
            );
            report.afterAlreadyBent = read();
            const rival = c.rivals.find(
              (entry) =>
                entry.body !== c.player &&
                entry.body.damage.wam &&
                !entry.body.damage.structuralBend,
            );
            if (!rival)
              throw new Error("No unbent original rival with WAM was loaded");
            const rivalDamage = rival.body.damage;
            const rivalRandom = rivalDamage.damageContext.random;
            const rivalSnap = rivalDamage.wam.snappability;
            rivalDamage.damageContext.random = () => 0;
            rivalDamage.wam.snappability = 0;
            try {
              report.rivalAccepted = rivalDamage.applyDeferredBend(
                new Point(0, 0, rivalDamage.wam.bendZMin - 1),
                direction,
                6,
                c.simulation.elapsed * 1000,
                false,
              );
            } finally {
              rivalDamage.damageContext.random = rivalRandom;
              rivalDamage.wam.snappability = rivalSnap;
            }
            report.afterRival = read();
          }
          return report;
        } finally {
          damage.onBeforeStructuralBend = originalHook;
          damage.damageContext.random = originalRandom;
          damage.wam.snappability = originalSnappability;
          damage.damageContext.invulnerable = false;
        }
      },
      { powerupIndex: index, exerciseGates: gates },
    );

    if (gates) {
      assert.equal(
        bend.callbacks,
        1,
        "immune/repeated bends must not run the removal callback",
      );
      assert.ok(
        bend.afterImmune.effects.some((effect) => effect.index === index),
      );
      assert.equal(bend.afterImmune.alreadyBent, false);
      assert.ok(bend.structuralBend, "accepted player bend was not applied");
      assert.ok(
        !bend.afterCallback.effects.some((effect) => effect.index === index),
      );
      assert.ok(
        bend.afterCallback.effects.some((effect) => effect.index === 24),
        "unflagged whole-race pedestrian-map effect was removed",
      );
      assert.equal(bend.afterCallback.engineFactor, 1);
      assert.equal(bend.afterCallback.tyreGripFactor, 1);
      assert.equal(bend.afterCallback.protection, 1);
      assert.deepEqual(
        bend.afterCallback.suspension,
        resetSuspensionFor(index, setup.base.suspension),
      );
      assert.deepEqual(bend.afterCallback.spring, setup.base.spring);
      assert.deepEqual(bend.afterCallback.damper, setup.base.damper);
      assert.deepEqual(
        bend.afterCallback.suspensionLength,
        setup.base.suspensionLength,
      );
      assert.ok(
        bend.afterAlreadyBent.effects.some((effect) => effect.index === index),
      );
      assert.ok(
        bend.afterRival.effects.some((effect) => effect.index === index),
        "rival bend cancelled player effect",
      );
      assert.ok(bend.rivalAccepted, "original rival WAM bend was not accepted");
    } else {
      assert.equal(
        bend.callbacks,
        1,
        "accepted bend should remove the active flag-4 effect",
      );
      assert.ok(bend.structuralBend, "accepted player bend was not applied");
      assert.ok(
        !bend.afterCallback.effects.some((effect) => effect.index === index),
      );
      assert.ok(
        bend.afterCallback.effects.some((effect) => effect.index === 24),
        "unflagged whole-race pedestrian-map effect was removed",
      );
      assert.deepEqual(
        bend.afterCallback.components,
        bend.componentBaseline,
        "callback ran after bend component writes",
      );
      assert.equal(
        bend.afterCallback.alreadyBent,
        false,
        "powerup callback should precede bend state writes",
      );
      assert.equal(bend.afterCallback.engineFactor, 1);
      assert.equal(bend.afterCallback.tyreGripFactor, 1);
      assert.equal(bend.afterCallback.protection, 1);
      assert.deepEqual(
        bend.afterCallback.suspension,
        resetSuspensionFor(index, setup.base.suspension),
      );
      assert.deepEqual(bend.afterCallback.spring, setup.base.spring);
      assert.deepEqual(bend.afterCallback.damper, setup.base.damper);
      assert.deepEqual(
        bend.afterCallback.suspensionLength,
        setup.base.suspensionLength,
      );
    }
    return { index, setup, powered, bend };
  };

  // The original table's flag-4 records are Hotrod, Jelly and Granite.
  const stockDefinitions = await page.evaluate(() =>
    [5, 23, 39].map((index) => {
      const definition = window.carma.powerups.definitions[index];
      return (
        definition && {
          index: definition.index,
          name: definition.message,
          action: definition.action,
          flags: definition.flags,
        }
      );
    }),
  );
  assert.deepEqual(
    stockDefinitions.map((definition) => [
      definition.index,
      definition.action,
      definition.flags,
    ]),
    [
      [5, 9, 4],
      [23, 20, 4],
      [39, 27, 4],
    ],
  );
  const pedestrianMapDefinition = await page.evaluate(() => {
    const definition = window.carma.powerups.definitions[24];
    return {
      index: definition?.index,
      action: definition?.action,
      duration: definition?.duration,
      flags: definition?.flags,
    };
  });
  assert.deepEqual(
    {
      index: pedestrianMapDefinition.index,
      action: pedestrianMapDefinition.action,
      duration: pedestrianMapDefinition.duration,
    },
    { index: 24, action: 29, duration: 0 },
  );
  assert.equal(pedestrianMapDefinition.flags & 4, 0);
  results.push(await runAccepted(5, { gates: true }));
  results.push(await runAccepted(23));
  results.push(await runAccepted(39));

  // Controlled spam fixture proves the accepted BendCar path used by SpamModel.
  await loadRace();
  await page.evaluate(() => {
    const c = window.carma;
    if (!c.powerups.grant(5, c.vehicle, c.race))
      throw new Error("Hotrod grant failed");
    if (!c.powerups.grant(24, c.vehicle, c.race))
      throw new Error("Pedestrian-map grant failed");
  });
  await syncModifiers();
  const spam = await page.evaluate(() => {
    const c = window.carma;
    const damage = c.player.damage;
    const report = { callbacks: 0 };
    const originalHook = damage.onBeforeStructuralBend;
    const originalRandom = damage.damageContext.random;
    const originalSnappability = damage.wam.snappability;
    damage.componentLevels.fill(40);
    damage.wam.snappability = 0;
    damage.damageContext.random = () => 0.5;
    damage.onBeforeStructuralBend = () => {
      report.callbacks++;
      originalHook?.call(damage);
      report.effects = c.powerups.activeEffectsFor(c.vehicle);
      report.engineFactor = c.player.state.engineFactor;
      report.componentsAtCallback = [...damage.componentLevels];
    };
    try {
      const spamResult = damage.spamModel(1, c.simulation.elapsed * 1000, true);
      report.result = {
        rays: spamResult.rays.length,
        maxInfluence: spamResult.maxInfluence,
        detachedParts: spamResult.detachedParts.length,
        splitRequest: !!spamResult.splitRequest,
      };
      report.structuralBend = !!damage.structuralBend;
      report.effectsAfterBend = c.powerups.activeEffectsFor(c.vehicle);
      report.engineFactorAfterBend = c.player.state.engineFactor;
      return report;
    } finally {
      damage.onBeforeStructuralBend = originalHook;
      damage.damageContext.random = originalRandom;
      damage.wam.snappability = originalSnappability;
    }
  });
  assert.equal(
    spam.callbacks,
    1,
    "accepted SpamModel bend did not run its pre-bend callback",
  );
  assert.ok(spam.structuralBend, "controlled SpamModel fixture did not bend");
  assert.ok(
    !spam.effects.some((effect) => effect.index === 5),
    "SpamModel bend left the flag-4 effect active",
  );
  assert.ok(
    spam.effects.some((effect) => effect.index === 24),
    "SpamModel bend removed the unflagged pedestrian-map effect",
  );
  assert.ok(spam.result.rays > 0, "SpamModel did not execute its crush rays");
  assert.ok(
    spam.componentsAtCallback.every((level) => level === 40),
    "SpamModel callback ran after its component fixture changed",
  );

  const afterRepair = await page.evaluate(() => {
    const c = window.carma;
    c.simulation.repair(c.player);
    return {
      active: c.powerups.activeEffectsFor(c.vehicle),
      engineFactor: c.player.state.engineFactor,
    };
  });
  assert.ok(
    !afterRepair.active.some((effect) => effect.index === 5),
    "repair resurrected the removed Hotrod effect",
  );
  assert.ok(
    afterRepair.active.some((effect) => effect.index === 24),
    "repair removed the persistent pedestrian-map effect",
  );
  const frame = await page.evaluate(() => {
    const c = window.carma;
    const target = c.stats.gameFrames + 1;
    c.paused = false;
    return target;
  });
  await page.waitForFunction(
    (target) => window.carma.stats.gameFrames >= target,
    frame,
    { timeout: 5000, polling: 20 },
  );
  await page.evaluate(() => (window.carma.paused = true));
  const finalEffects = await page.evaluate(() =>
    window.carma.powerups.activeEffectsFor(window.carma.vehicle),
  );
  assert.ok(!finalEffects.some((effect) => effect.index === 5));
  assert.ok(finalEffects.some((effect) => effect.index === 24));

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
    "PASS original powerup structural bend",
    JSON.stringify({
      stockDefinitions,
      results,
      spam,
      afterRepair,
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
