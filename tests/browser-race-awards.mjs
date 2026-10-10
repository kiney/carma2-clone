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
    "SKIP race awards browser regression: Chromium or local C2 assets absent.",
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

  const loadPath = async (path) => {
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
      raceType: window.carma.raceDefinition?.raceType,
      smashVariable: window.carma.raceDefinition?.smashVariable,
      smashTarget: window.carma.raceDefinition?.smashTarget,
      pedGroupsToKill: window.carma.raceDefinition?.pedGroupsToKill,
      status: window.carma.race.status,
      timeLeft: window.carma.race.timeLeft,
      credits: window.carma.race.credits,
      rivals: window.carma.rivals.length,
      pedestrians: window.carma.pedestrians?.count,
    }));
  };
  const loadByName = async (pattern) => {
    const path = await page.evaluate((source) => {
      const expression = new RegExp(source, "i");
      const option = [...document.querySelector("#track-select").options].find(
        (candidate) => expression.test(candidate.textContent),
      );
      if (!option) throw new Error(`No catalog race matches ${source}`);
      return option.value;
    }, pattern);
    return loadPath(path);
  };

  const eye = await loadByName("MISSION: EYE OF THE BEAVER");
  assert.equal(eye.raceType, "smash");
  assert.equal(eye.status, "racing");

  const start = await page.evaluate(() =>
    window.carma.vehicle.position.toArray(),
  );
  await page.evaluate(() => (window.carma.paused = false));
  await page.keyboard.down("ArrowUp");
  await page.waitForFunction(
    (origin) =>
      Math.hypot(
        window.carma.vehicle.position.x - origin[0],
        window.carma.vehicle.position.z - origin[2],
      ) > 0.1,
    start,
    { timeout: 15000 },
  );
  await page.keyboard.up("ArrowUp");
  const drive = await page.evaluate(() => {
    window.carma.paused = true;
    return {
      position: window.carma.vehicle.position.toArray(),
      speed: window.carma.vehicle.speed,
    };
  });
  assert.ok(
    drive.speed > 0 ||
      Math.hypot(drive.position[0] - start[0], drive.position[2] - start[2]) >
        0.1,
  );

  // Complete the original mission through its configured actor contacts, then
  // exercise the real deferred payout, RAF state machine, audio, and Enter path.
  const completion = await page.evaluate(() => {
    const c = window.carma;
    const definition = c.raceDefinition;
    const destruction = c.simulation.destruction;
    const variable = definition.smashVariable;
    const target = definition.smashTarget;
    const announcementIds = [];
    c.__raceAwardSoundEvents = announcementIds;
    const playSound = c.audio.playSound.bind(c.audio);
    c.audio.playSound = async (id, ...args) => {
      announcementIds.push(id);
      return playSound(id, ...args);
    };
    // Use a short positive remainder so the real payout has both award phases.
    c.race.timeLeft = 12;
    const snapshot = c.race.credits;
    const candidates = [];
    for (const [specIndex, spec] of destruction.specs.entries()) {
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
          actor.visible &&
          actor.userData.worldSmashSpecIndices?.includes(specIndex)
        )
          candidates.push({ actor, spec, specIndex });
      }
    }
    const distinct = [
      ...new Map(
        candidates.map((candidate) => [candidate.actor.uuid, candidate]),
      ).values(),
    ];
    const playerActor = c.player.group;
    playerActor.updateWorldMatrix(true, true);
    const impacts = [];
    for (const candidate of distinct) {
      if (
        c.missionVariables.get(variable) >= target ||
        c.race.status !== "racing"
      )
        break;
      const { actor, spec, specIndex } = candidate;
      const point = actor.getWorldPosition(new actor.position.constructor());
      const result = destruction.handleContact({
        actor,
        normalImpulse: Math.max(1000, spec.removalThreshold ?? 0),
        kind: "body",
        bodyActor: playerActor,
        impacteeVelocity: c.vehicle.velocity,
        impacteeTransform: playerActor.matrixWorld,
        point,
        timeMs: 1000 + impacts.length * 40,
      });
      impacts.push({ specIndex, changed: result.changed });
    }
    return {
      variable,
      target,
      value: c.missionVariables.get(variable),
      status: c.race.status,
      snapshot,
      expectedCompletionBonus:
        c.race.completionCreditsByReason?.[c.race.completionReason ?? 0] ??
        c.race.completionCredits,
      timeLeft: c.race.timeLeft,
      rate: c.race.completionTimeCreditRate,
      impacts,
      announcementIds,
    };
  });
  assert.equal(completion.status, "completed");
  assert.equal(completion.value, completion.target);
  assert.equal(completion.impacts.length, completion.target);
  await page.waitForFunction(() => window.carma.racePayout, null, {
    timeout: 10000,
  });
  const payoutStart = await page.evaluate(() => {
    const c = window.carma;
    return {
      state: c.racePayout.state,
      finished: c.racePayout.finished,
      snapshotCredits: c.racePayout.snapshotCredits,
      totalBonus: c.racePayout.totalBonus,
      credits: c.race.credits,
    };
  });
  assert.equal(payoutStart.snapshotCredits, completion.snapshot);
  assert.equal(
    payoutStart.credits,
    completion.snapshot,
    "completion award is deferred",
  );
  assert.equal(
    payoutStart.totalBonus,
    completion.expectedCompletionBonus +
      Math.floor(completion.timeLeft) * completion.rate,
  );

  await page.evaluate(() => (window.carma.paused = false));
  await page.waitForFunction(() => window.carma.racePayout?.state === 2, null, {
    timeout: 25000,
  });
  const naturalAward = await page.evaluate(() => ({
    state: window.carma.racePayout.state,
    credits: window.carma.race.credits,
    bonus: window.carma.racePayout.completionBonus,
    finished: window.carma.racePayout.finished,
  }));
  assert.equal(naturalAward.credits, completion.snapshot + naturalAward.bonus);
  assert.equal(naturalAward.finished, false);
  const naturalSounds = await page.evaluate(() =>
    window.carma.__raceAwardSoundEvents.filter((id) => id === 8015),
  );
  assert.equal(
    naturalSounds.length,
    1,
    "natural completion award plays clap once",
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.carma.racePayout.finished, null, {
    timeout: 5000,
  });
  const settled = await page.evaluate(() => ({
    credits: window.carma.race.credits,
    snapshot: window.carma.racePayout.snapshotCredits,
    totalBonus: window.carma.racePayout.totalBonus,
    payoutCredits: window.carma.racePayout.credits,
    finished: window.carma.racePayout.finished,
  }));
  assert.equal(settled.credits, settled.snapshot + settled.totalBonus);
  assert.equal(settled.payoutCredits, settled.credits);
  await page.screenshot({ path: "artifacts/browser-race-awards-payout.png" });

  const hardcore = await loadByName("MISSION: HARD CORE");
  assert.equal(hardcore.raceType, "smashAndPed");
  assert.equal(hardcore.smashTarget, 19);
  assert.ok(hardcore.pedGroupsToKill.includes(56));
  await page.waitForFunction(
    () => window.carma.pedestrians?.groupCounts?.has(56),
    null,
    { timeout: 90000 },
  );
  const finalSelectedPed = await page.evaluate(() => {
    const c = window.carma;
    const definition = c.raceDefinition;
    const variable = definition.smashVariable;
    const target = definition.smashTarget;
    const system = c.pedestrians;
    const candidate = system.states.find((state) => state.group === 56);
    if (!candidate)
      throw new Error("HARD CORE group 56 has no spawned pedestrian");
    c.paused = true;
    c.missionVariables.add(variable, target - 1);
    const before = {
      value: c.missionVariables.get(variable),
      credits: c.race.credits,
      timeLeft: c.race.timeLeft,
      killed: system.groupCounts.get(56)?.killed ?? 0,
      hits: system.hits,
    };
    const start = candidate.position.clone();
    start.x -= 0.55;
    const end = candidate.position.clone();
    end.x += 0.55;
    system.resetCar(start);
    system.update(0, {
      position: start,
      yaw: 0,
      speed: 0,
      velocity: c.vehicle.velocity,
    });
    c.race.status = "racing";
    system.update(0, {
      position: end,
      yaw: Math.PI / 2,
      speed: 1,
      velocity: c.vehicle.velocity,
    });
    return {
      variable,
      target,
      value: c.missionVariables.get(variable),
      status: c.race.status,
      reason: c.race.completionReason,
      creditsBefore: before.credits,
      creditsAfter: c.race.credits,
      timeBefore: before.timeLeft,
      timeAfter: c.race.timeLeft,
      groupKilledBefore: before.killed,
      groupKilledAfter: system.groupCounts.get(56)?.killed ?? 0,
      hitsBefore: before.hits,
      hitsAfter: system.hits,
    };
  });
  assert.equal(finalSelectedPed.value, finalSelectedPed.target);
  assert.equal(finalSelectedPed.status, "completed");
  assert.equal(finalSelectedPed.reason, 3);
  assert.equal(finalSelectedPed.hitsAfter, finalSelectedPed.hitsBefore + 1);
  assert.equal(
    finalSelectedPed.groupKilledAfter,
    finalSelectedPed.groupKilledBefore + 1,
  );
  assert.equal(
    finalSelectedPed.creditsAfter,
    finalSelectedPed.creditsBefore,
    "the final selected pedestrian completes the mission before ordinary pedestrian credits",
  );
  assert.equal(
    finalSelectedPed.timeAfter,
    finalSelectedPed.timeBefore,
    "the final selected pedestrian completes before ordinary time awards",
  );
  await page.waitForFunction(() => window.carma.racePayout, null, {
    timeout: 10000,
  });
  const selectedPedPayout = await page.evaluate(() => ({
    status: window.carma.race.status,
    reason: window.carma.race.completionReason,
    credits: window.carma.race.credits,
    snapshot: window.carma.racePayout.snapshotCredits,
  }));
  assert.equal(selectedPedPayout.status, "completed");
  assert.equal(selectedPedPayout.reason, 3);
  assert.equal(selectedPedPayout.snapshot, finalSelectedPed.creditsBefore);
  await page.screenshot({
    path: "artifacts/browser-race-awards-final-selected-ped.png",
  });

  const stock = await loadByName("NICE BEAVER");
  await page.waitForFunction(
    () =>
      window.carma.pedestrians?.options?.onHit && window.carma.rivals.length,
    null,
    { timeout: 30000 },
  );
  const pedestrianAwards = await page.evaluate(() => {
    const c = window.carma;
    const callback = c.pedestrians?.options?.onHit;
    if (typeof callback !== "function")
      throw new Error(
        "Pedestrian award callback is not exposed on the loaded system",
      );
    const before = { credits: c.race.credits, timeLeft: c.race.timeLeft };
    callback({
      timeMs: 1000,
      group: 0,
      count: 1,
      total: 1,
      speed: 1,
      position: c.vehicle.position.clone(),
    });
    const first = { credits: c.race.credits, timeLeft: c.race.timeLeft };
    callback({
      timeMs: 2000,
      group: 0,
      count: 1,
      total: 2,
      speed: 1,
      position: c.vehicle.position.clone(),
    });
    return {
      before,
      first,
      second: { credits: c.race.credits, timeLeft: c.race.timeLeft },
    };
  });
  assert.equal(
    pedestrianAwards.first.credits - pedestrianAwards.before.credits,
    300,
  );
  assert.equal(
    pedestrianAwards.first.timeLeft - pedestrianAwards.before.timeLeft,
    15,
  );
  assert.equal(
    pedestrianAwards.second.credits - pedestrianAwards.first.credits,
    600,
  );
  assert.equal(
    pedestrianAwards.second.timeLeft - pedestrianAwards.first.timeLeft,
    15,
  );

  const uncreditedWaste = await page.evaluate(async () => {
    const c = window.carma;
    const uncredited = c.rivals[0];
    if (!uncredited) throw new Error("Stock race has no opponent");
    const beforeUncredited = {
      credits: c.race.credits,
      timeLeft: c.race.timeLeft,
    };
    uncredited.damage.componentLevels[0] = 99;
    uncredited.body.wastedByPlayer = false;
    uncredited.wasted = false;
    c.paused = false;
    const started = performance.now();
    while (!uncredited.wasted && performance.now() - started < 5000)
      await new Promise((resolve) => setTimeout(resolve, 10));
    c.paused = true;
    const afterUncredited = {
      credits: c.race.credits,
      timeLeft: c.race.timeLeft,
    };
    return { beforeUncredited, afterUncredited };
  });
  assert.equal(
    uncreditedWaste.afterUncredited.credits,
    uncreditedWaste.beforeUncredited.credits,
  );
  assert.ok(
    uncreditedWaste.afterUncredited.timeLeft <=
      uncreditedWaste.beforeUncredited.timeLeft,
    "unattributed wasted opponent receives no time award",
  );

  await loadByName("NICE BEAVER");
  await page.waitForFunction(() => window.carma.rivals.length, null, {
    timeout: 30000,
  });
  const rivalAwards = await page.evaluate(async () => {
    const c = window.carma;
    const credited = c.rivals[0];
    if (!credited) throw new Error("Stock race has no opponent");
    const before = { credits: c.race.credits, timeLeft: c.race.timeLeft };
    credited.damage.componentLevels[0] = 99;
    credited.body.wastedByPlayer = true;
    credited.wasted = false;
    const softness = credited.damage.carSoftness;
    c.paused = false;
    const secondStart = performance.now();
    while (!credited.wasted && performance.now() - secondStart < 5000)
      await new Promise((resolve) => setTimeout(resolve, 10));
    c.paused = true;
    return {
      before,
      credited: { credits: c.race.credits, timeLeft: c.race.timeLeft },
      softness,
    };
  });
  const expectedWastedCredits =
    100 * Math.trunc((3000 * (0.7 / rivalAwards.softness) ** 2 + 50) * 0.01);
  assert.equal(
    rivalAwards.credited.credits - rivalAwards.before.credits,
    expectedWastedCredits,
    "player-attributed wasted opponent uses its softness-scaled award",
  );
  assert.ok(
    rivalAwards.credited.timeLeft - rivalAwards.before.timeLeft > 119,
    "player-attributed waste adds the native 120 seconds",
  );
  await page.screenshot({ path: "artifacts/browser-race-awards-stock.png" });

  const carma = await loadByName("NICE BEAVER");
  assert.equal(carma.raceType, "carma");
  await page.waitForFunction(() => window.carma.rivals.length === 5, null, {
    timeout: 30000,
  });
  const finalOpponentWaste = await page.evaluate(async () => {
    const c = window.carma;
    const opponents = c.rivals;
    if (opponents.length < 2)
      throw new Error("CARMA race did not load multiple opponents");
    for (const opponent of opponents.slice(0, -1)) {
      opponent.damage.componentLevels[0] = 99;
      opponent.body.wastedByPlayer = false;
      opponent.wasted = false;
      c.paused = false;
      const started = performance.now();
      while (!opponent.wasted && performance.now() - started < 5000)
        await new Promise((resolve) => setTimeout(resolve, 10));
      c.paused = true;
      if (!opponent.wasted)
        throw new Error("unattributed rival waste did not process");
    }
    const finalOpponent = opponents.at(-1);
    const before = c.race.credits;
    finalOpponent.damage.componentLevels[0] = 99;
    finalOpponent.body.wastedByPlayer = true;
    finalOpponent.wasted = false;
    c.paused = false;
    const started = performance.now();
    while (c.race.status === "racing" && performance.now() - started < 5000)
      await new Promise((resolve) => setTimeout(resolve, 10));
    c.paused = true;
    return {
      status: c.race.status,
      reason: c.race.completionReason,
      creditsBeforeFinalWaste: before,
      creditsAfterFinalWaste: c.race.credits,
      payoutSnapshot: c.racePayout?.snapshotCredits,
      payoutFinished: c.racePayout?.finished,
      allWasted: opponents.every((opponent) => opponent.wasted),
    };
  });
  assert.equal(finalOpponentWaste.status, "completed");
  assert.equal(finalOpponentWaste.reason, 2);
  assert.equal(finalOpponentWaste.allWasted, true);
  assert.equal(
    finalOpponentWaste.creditsAfterFinalWaste,
    finalOpponentWaste.creditsBeforeFinalWaste,
    "the final goal waste completes first and awards no separate wasting bonus",
  );
  assert.equal(
    finalOpponentWaste.payoutSnapshot,
    finalOpponentWaste.creditsBeforeFinalWaste,
  );
  await page.screenshot({
    path: "artifacts/browser-race-awards-final-waste.png",
  });

  const advPath = await page.evaluate(() => {
    const option = [...document.querySelector("#track-select").options].find(
      (candidate) => /^adv_data\//i.test(candidate.value),
    );
    if (!option) throw new Error("Advanced race catalog is empty");
    return option.value;
  });
  const adv = await loadPath(advPath);
  assert.match(stock.track, /^data\//i);
  assert.match(adv.track, /^adv_data\//i);
  await page.waitForFunction(
    () => window.carma.pedestrians?.options?.onHit,
    null,
    { timeout: 30000 },
  );
  const advPedestrian = await page.evaluate(() => {
    const c = window.carma;
    const before = { credits: c.race.credits, timeLeft: c.race.timeLeft };
    c.pedestrians.options.onHit({
      timeMs: 1000,
      group: 0,
      count: 1,
      total: 1,
      speed: 1,
      position: c.vehicle.position.clone(),
    });
    return {
      credits: c.race.credits - before.credits,
      time: c.race.timeLeft - before.timeLeft,
    };
  });
  assert.equal(advPedestrian.credits, 300);
  assert.equal(advPedestrian.time, 10);

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
    drive,
    completion,
    payoutStart,
    naturalAward,
    settled,
    hardcore,
    finalSelectedPed,
    selectedPedPayout,
    pedestrianAwards,
    uncreditedWaste,
    rivalAwards,
    finalOpponentWaste,
    stock,
    adv,
    advPedestrian,
    errors,
    failedRequests,
    glError,
  };
  await writeFile(
    "artifacts/browser-race-awards.json",
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
