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
    "SKIP smash mission browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5197;
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
  const loadByName = async (pattern) => {
    const path = await page.evaluate((source) => {
      const match = new RegExp(source, "i");
      const option = [...document.querySelector("#track-select").options].find(
        (candidate) => match.test(candidate.textContent),
      );
      if (!option) throw new Error(`No catalog race matches ${source}`);
      return option.value;
    }, pattern);
    await page.evaluate(async (track) => {
      const c = window.carma;
      const car = c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT");
      if (!car) throw new Error("Stock EAGLE3 car is absent");
      document.querySelector("#track-select").value = track;
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
      track: document.querySelector("#track-select").value,
      name: window.carma.raceDefinition?.name,
      type: window.carma.raceDefinition?.raceType,
      smashVariable: window.carma.raceDefinition?.smashVariable,
      smashTarget: window.carma.raceDefinition?.smashTarget,
      pedGroupsToKill: window.carma.raceDefinition?.pedGroupsToKill,
      raceStatus: window.carma.race.status,
    }));
  };

  const eye = await loadByName("MISSION: EYE OF THE BEAVER");
  assert.match(eye.track, /^data\//i);
  assert.equal(eye.type, "smash");
  assert.equal(eye.smashVariable, 1);
  assert.equal(eye.smashTarget, 11);
  assert.equal(eye.raceStatus, "racing");

  const targetRun = await page.evaluate(() => {
    const c = window.carma;
    const definition = c.raceDefinition;
    const destruction = c.simulation.destruction;
    if (!destruction)
      throw new Error("Loaded race has no world destruction system");
    const variable = definition.smashVariable;
    const target = definition.smashTarget;
    const announcementIds = [];
    const playSound = c.audio.playSound.bind(c.audio);
    c.audio.playSound = async (id, ...args) => {
      announcementIds.push(id);
      return playSound(id, ...args);
    };
    const value = () => c.missionVariables.get(variable);
    const candidates = [];
    const inventory = [];
    for (const [specIndex, spec] of destruction.specs.entries()) {
      const variableChanges = [
        ...(spec.connotations?.variableChanges ?? []),
        ...spec.levels.flatMap((level) => level.connotations.variableChanges),
      ];
      const actorCount = destruction.retainActors.filter((actor) =>
        actor.userData.worldSmashSpecIndices?.includes(specIndex),
      ).length;
      if (variableChanges.length)
        inventory.push({
          specIndex,
          trigger: spec.trigger,
          mode: spec.mode,
          removalThreshold: spec.removalThreshold,
          variableChanges,
          actorCount,
        });
      if (!new Set(["number", "model"]).has(spec.trigger.kind)) continue;
      if (
        !["remove", "replacemodel"].includes(spec.mode) ||
        spec.connotations?.variableChanges?.length !== 1
      )
        continue;
      const [address, delta] = spec.connotations.variableChanges[0];
      if (address !== variable || delta !== 1) continue;
      for (const actor of destruction.retainActors) {
        if (
          !actor.visible ||
          !actor.userData.worldSmashSpecIndices?.includes(specIndex)
        )
          continue;
        candidates.push({ actor, spec, specIndex });
      }
    }
    const distinct = [
      ...new Map(
        candidates.map((candidate) => [candidate.actor.uuid, candidate]),
      ).values(),
    ];
    if (value() !== 0)
      throw new Error(
        `Eye mission variable ${variable} did not reset: ${value()}`,
      );
    const playerActor = c.player.group;
    playerActor.updateWorldMatrix(true, true);
    const impacts = [];
    let repeatedActorResult;
    for (const candidate of distinct) {
      if (value() >= target || c.race.status !== "racing") break;
      const { actor, spec, specIndex } = candidate;
      const before = value();
      const point = actor.getWorldPosition(new actor.position.constructor());
      const normalImpulse = Math.max(1000, spec.removalThreshold ?? 0);
      const contact = (timeMs) =>
        destruction.handleContact({
          actor,
          normalImpulse,
          kind: "body",
          bodyActor: playerActor,
          impacteeVelocity: c.vehicle.velocity,
          impacteeTransform: playerActor.matrixWorld,
          point,
          timeMs,
        });
      const result = contact(1000 + impacts.length * 40);
      const after = value();
      if (after > before) {
        impacts.push({
          specIndex,
          actor: actor.name,
          mode: spec.mode,
          before,
          after,
          changed: result.changed,
        });
        if (!repeatedActorResult) {
          const repeatedBefore = value();
          const repeated = contact(1001 + impacts.length * 40);
          repeatedActorResult = {
            changed: repeated.changed,
            before: repeatedBefore,
            after: value(),
          };
        }
      }
    }
    return {
      variable,
      target,
      candidates: distinct.length,
      inventory,
      announcementIds,
      impacts,
      value: value(),
      status: c.race.status,
      repeatedActorResult,
    };
  });
  assert.ok(
    targetRun.candidates >= eye.smashTarget,
    `expected at least ${eye.smashTarget} original actor targets, found ${targetRun.candidates}; inventory=${JSON.stringify(targetRun.inventory)}`,
  );
  assert.equal(
    targetRun.impacts.length,
    eye.smashTarget,
    "eleven distinct original actor contacts increment the native mission variable",
  );
  assert.equal(targetRun.value, eye.smashTarget);
  assert.equal(targetRun.status, "completed");
  assert.deepEqual(targetRun.repeatedActorResult, {
    changed: false,
    before: 1,
    after: 1,
  });
  assert.equal(
    targetRun.announcementIds.filter((id) => id === 8011).length,
    1,
    "the completed smash objective announces native completion sound 8011 once",
  );
  await page.waitForFunction(
    () => document.querySelector("#checkpoint").textContent.endsWith("11/11"),
    null,
    { timeout: 10000 },
  );
  await page.screenshot({ path: "artifacts/browser-smash-eye-of-beaver.png" });

  const hardcore = await loadByName("MISSION: HARD CORE");
  assert.match(hardcore.track, /^data\//i);
  assert.equal(hardcore.type, "smashAndPed");
  assert.equal(hardcore.smashVariable, 1);
  assert.equal(hardcore.smashTarget, 19);
  assert.ok(hardcore.pedGroupsToKill.includes(56));
  assert.equal(hardcore.raceStatus, "racing");
  await page.waitForFunction(
    () => window.carma.pedestrians?.groupCounts?.has(56),
    null,
    { timeout: 90000 },
  );
  const pedSweep = await page.evaluate(() => {
    const c = window.carma;
    const group = 56;
    const variable = c.raceDefinition.smashVariable;
    const before = c.missionVariables.get(variable);
    const counts = c.pedestrians.groupCounts;
    const groupBefore = counts.get(group);
    const candidate = c.pedestrians.states.find(
      (state) => state.group === group,
    );
    if (!candidate)
      throw new Error(
        "HARD CORE has no spawned pedestrian in objective group 56",
      );
    const start = candidate.position.clone();
    start.x -= 0.55;
    const end = candidate.position.clone();
    end.x += 0.55;
    c.pedestrians.resetCar(start);
    c.pedestrians.update(0, {
      position: start,
      yaw: 0,
      speed: 0,
      velocity: c.vehicle.velocity,
    });
    c.race.status = "racing";
    c.pedestrians.update(0, {
      position: end,
      yaw: Math.PI / 2,
      speed: 1,
      velocity: c.vehicle.velocity,
    });
    const groupAfter = c.pedestrians.groupCounts.get(group);
    return {
      group,
      variable,
      before,
      after: c.missionVariables.get(variable),
      groupBefore: groupBefore?.killed ?? 0,
      groupAfter: groupAfter?.killed ?? 0,
      totalHits: c.pedestrians.hits,
      raceStatus: c.race.status,
      position: candidate.position.toArray(),
    };
  });
  assert.ok(pedSweep.groupAfter > pedSweep.groupBefore);
  assert.equal(
    pedSweep.after - pedSweep.before,
    pedSweep.groupAfter - pedSweep.groupBefore,
    "the real pedestrian sweep adds exactly the selected mission group kills to its smash variable",
  );
  assert.ok(pedSweep.totalHits > 0);
  await page.screenshot({ path: "artifacts/browser-smash-hardcore-ped.png" });

  const glError = await page.evaluate(() => {
    const gl = document.querySelector("#view").getContext("webgl2");
    if (!gl) throw new Error("WebGL2 context unavailable");
    return gl.getError();
  });
  assert.equal(glError, 0, "WebGL has no outstanding error");
  assert.deepEqual(errors, [], "Chromium has no page or console errors");
  assert.deepEqual(failedRequests, [], "all requested local assets load");
  const report = {
    eye,
    targetRun,
    hardcore,
    pedSweep,
    errors,
    failedRequests,
    glError,
  };
  await writeFile(
    "artifacts/browser-smash-missions.json",
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
