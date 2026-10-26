import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP AI-05 opponent-startup browser fixture: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = Number(process.env.AI05_PORT || 5258);
const server = spawn(process.execPath, ["server/dev.mjs"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
let page;
const report = {
  fixture:
    "DUNE BUGGERED / DESERT2.TXT, Bigdump player, complete original ten-opponent roster selected with stack-filtered xorshift32 seed 1; second opponent scene held to inspect staged population",
  backend: "SwiftShader correctness fixture, not a hardware measurement",
  selectionSeed: 1,
  selectedOpponentIds: [2, 7, 22, 3, 17, 10, 6, 14, 29, 35],
  errors: [],
  failedRequests: [],
};
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));

try {
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/manifest`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) throw new Error(serverLog);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `Vite asset server did not start: ${serverLog}`);
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
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (error) => report.errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    report.failedRequests.push(
      `${request.url()}: ${request.failure()?.errorText}`,
    ),
  );
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 45000,
  });
  await page.evaluate(() => {
    window.carma.paused = true;
  });
  await page.waitForFunction(
    () =>
      window.carma?.populationLoadState?.opponents.state !== "loading" &&
      window.carma?.populationLoadState?.pedestrians.state !== "loading",
    null,
    { timeout: 45000 },
  );

  // Stack filtering seeds only the two global-random consumers that choose
  // the race roster and its authored personality slots. Other systems retain
  // their ordinary Math.random behavior.
  const configured = await page.evaluate(async () => {
    const c = window.carma;
    const module = await import("/src/native-random.ts");
    module.sharedNativeRandom.seed(1);
    const originalRandom = Math.random.bind(Math);
    const streams = { selection: 1, personality: 1 };
    const next = (key) => {
      let value = streams[key] >>> 0;
      value ^= value << 13;
      value ^= value >>> 17;
      value ^= value << 5;
      streams[key] = value >>> 0;
      return streams[key] / 0x100000000;
    };
    const draws = { selection: 0, personality: 0 };
    Math.random = function () {
      const stack = String(new Error().stack || "");
      if (/opponent-selection(?:\.ts|\.js)?/.test(stack)) {
        draws.selection++;
        return next("selection");
      }
      if (/personality(?:\.ts|\.js)?/.test(stack)) {
        draws.personality++;
        return next("personality");
      }
      return originalRandom();
    };
    const track = c.assets.resolve("data/RACES/desert2/desert2.txt");
    const car = c.assets.resolve("data/CARS/bigdump/bigdump.txt");
    if (!track || !car) throw new Error("Original DUNE/Bigdump data is absent");
    document.querySelector("#track-select").value = track;
    document.querySelector("#car-select").value = car;
    const originalScene = c.assets.scene.bind(c.assets);
    window.__ai05OriginalScene = originalScene;
    let opponentSceneCalls = 0;
    c.assets.scene = async (directory, stem, options) => {
      if (options?.storage === "opponents") {
        opponentSceneCalls++;
        if (opponentSceneCalls === 2) {
          await new Promise((resolve) => {
            window.__releaseOpponentScene = resolve;
          });
        }
      }
      return originalScene(directory, stem, options);
    };
    window.__ai05OriginalRandom = originalRandom;
    window.__ai05RandomDraws = draws;
    window.__ai05SceneCalls = () => opponentSceneCalls;
    window.__ai05RaceLoad = c.loadRace();
    return {
      track,
      car,
      playerCountBeforeLoad: c.simulation?.cars?.length ?? 0,
    };
  });
  report.track = configured.track;
  report.playerCar = configured.car;
  await page.waitForFunction(
    () => typeof window.__releaseOpponentScene === "function",
    null,
    { timeout: 45000 },
  );

  const staged = await page.evaluate(() => {
    const c = window.carma;
    c.paused = true;
    const player = c.simulation.cars.find((car) => car.human);
    const stagedCarNames = new Set([
      "bugtoo5",
      "wideboy",
      "newhawk",
      "cerby",
      "cobra",
      "fordpick",
      "junker1",
      "mminor",
      "volvo",
      "combine",
    ]);
    const sceneOpponents = [];
    c.scene.traverse((object) => {
      if (stagedCarNames.has(object.name.toLowerCase()))
        sceneOpponents.push(object.name);
    });
    return {
      population: c.populationLoadState.opponents,
      ready: c.opponentsReady,
      loadingRace: c.populationLoadState.opponents.state === "loading",
      simulationCars: c.simulation.cars.map((car) => car.group.name),
      rivals: c.rivals.map((rival) => rival.id),
      fleetPublished: !!c.opponentFleet,
      sceneOpponents,
      player: player
        ? {
            name: player.group.name,
            position: player.state.position.toArray(),
            damage: [...player.damage.componentLevels],
          }
        : null,
    };
  });
  report.stagedPopulation = staged;
  assert.equal(staged.population.state, "loading");
  assert.equal(staged.ready, false);
  assert.deepEqual(staged.simulationCars, ["bigdump"]);
  assert.deepEqual(staged.rivals, []);
  assert.equal(staged.fleetPublished, false);
  assert.deepEqual(staged.sceneOpponents, []);
  assert.ok(staged.player, "Player remains available during opponent loading");

  await page.evaluate(() => {
    const c = window.carma;
    c.paused = false;
    document.querySelector("#view").focus();
    window.__ai05PlayerStart = c.player.state.position.clone();
    window.__ai05ElapsedStart = c.simulation.elapsed;
  });
  await page.keyboard.down("w");
  await page.waitForFunction(
    () => window.carma.simulation.elapsed >= window.__ai05ElapsedStart + 0.3,
    null,
    { timeout: 5000 },
  );
  await page.keyboard.up("w");
  const driving = await page.evaluate(() => {
    const c = window.carma;
    c.paused = true;
    return {
      elapsed: c.simulation.elapsed - window.__ai05ElapsedStart,
      distance: c.player.state.position.distanceTo(window.__ai05PlayerStart),
      position: c.player.state.position.toArray(),
    };
  });
  report.playerDuringOpponentLoad = driving;
  assert.ok(driving.elapsed >= 0.3);
  assert.ok(
    driving.distance > 0.02,
    "Player input advances during population load",
  );

  await page.evaluate(() => window.__releaseOpponentScene());
  await page.waitForFunction(
    () => window.carma.populationLoadState.opponents.state === "ready",
    null,
    { timeout: 45000 },
  );
  await page.waitForFunction(
    () => window.carma.populationLoadState.pedestrians.state === "ready",
    null,
    { timeout: 45000 },
  );
  const completed = await page.evaluate(async () => {
    const c = window.carma;
    const module = await import("/src/native-random.ts");
    module.sharedNativeRandom.seed(1);
    const rivals = c.rivals.map((rival) => ({
      id: rival.id,
      name: rival.body.group.name,
      wasted: rival.body.knackered,
      damage: [...rival.body.damage.componentLevels],
      support: rival.body.state.groundedWheelCount,
      position: rival.body.state.position.toArray(),
    }));
    const player = c.player;
    const cars = c.simulation.cars.map((body) => ({
      name: body.group.name,
      human: body.human,
      damage: [...body.damage.componentLevels],
      support: body.state.groundedWheelCount,
      position: body.state.position.toArray(),
      wasted: body.knackered,
    }));
    return {
      opponents: c.populationLoadState.opponents,
      sceneCalls: window.__ai05SceneCalls(),
      randomDraws: { ...window.__ai05RandomDraws },
      player: player.group.name,
      rivals,
      cars,
      fleetPublished: !!c.opponentFleet,
      fleetBeforeFirstUpdate: c.opponentFleet
        ? {
            nowMs: c.opponentFleet.snapshot.nowMs,
            firstFrame: c.opponentFleet.snapshot.firstFrame,
            gameTimeMs: c.stats.gameTimeMs,
          }
        : null,
      initialElapsed: c.simulation.elapsed,
    };
  });
  report.completePopulation = completed;
  assert.equal(completed.opponents.state, "ready");
  assert.equal(completed.rivals.length, 10);
  assert.deepEqual(
    completed.rivals.map((rival) => rival.id),
    report.selectedOpponentIds,
    "Stack-filtered seed must reproduce the expected full Bigdump roster",
  );
  assert.ok(
    completed.rivals.some((rival) => rival.name.toLowerCase() === "newhawk"),
    "Qualifying roster must contain Newhawk",
  );
  assert.equal(completed.cars.length, 11);
  assert.equal(completed.fleetPublished, true);
  assert.deepEqual(completed.fleetBeforeFirstUpdate, {
    nowMs: completed.fleetBeforeFirstUpdate.gameTimeMs,
    firstFrame: true,
    gameTimeMs: completed.fleetBeforeFirstUpdate.gameTimeMs,
  });
  assert.ok(
    completed.cars.every(
      (car) =>
        car.support === 4 &&
        !car.wasted &&
        car.damage.every((level) => level === 0) &&
        car.position.every(Number.isFinite),
    ),
    "Every published car must begin at a finite, supported, undamaged pose",
  );
  assert.equal(completed.randomDraws.selection, 10);

  // Observe a short ordinary-AI window. Heavy-car contact damage or a later
  // waste is recorded as behavior; it is not treated as an unconditional test
  // failure because a real crash can be valid gameplay.
  const monitorInstalled = await page.evaluate(() => {
    const c = window.carma;
    const sim = c.simulation;
    const previousPair = sim.onImpactPair;
    window.__ai05Contacts = [];
    sim.onImpactPair = (a, b) => {
      if (a && b)
        window.__ai05Contacts.push({
          time: sim.elapsed,
          a: a.group.name,
          b: b.group.name,
        });
      previousPair?.(a, b);
    };
    window.__ai05DamageChanges = [];
    window.__ai05Waste = [];
    const baseline = new Map(
      sim.cars.map((body) => [body, [...body.damage.componentLevels]]),
    );
    const seenWaste = new Set();
    window.__ai05Monitor = window.setInterval(() => {
      for (const body of sim.cars) {
        const before = baseline.get(body) ?? [];
        const current = [...body.damage.componentLevels];
        if (
          !window.__ai05DamageChanges.some(
            (entry) => entry.car === body.group.name,
          ) &&
          current.some((level, i) => level !== before[i])
        )
          window.__ai05DamageChanges.push({
            time: sim.elapsed,
            car: body.group.name,
            before,
            after: current,
          });
        if (body.knackered && !seenWaste.has(body)) {
          seenWaste.add(body);
          window.__ai05Waste.push({ time: sim.elapsed, car: body.group.name });
        }
      }
    }, 20);
    return true;
  });
  assert.equal(monitorInstalled, true);
  await page.evaluate(() => {
    window.carma.paused = false;
    window.__ai05RunStart = window.carma.simulation.elapsed;
    window.__ai05RunUntil = window.carma.simulation.elapsed + 4;
  });
  await page.waitForFunction(
    () => window.carma.simulation.elapsed >= window.__ai05RunUntil,
    null,
    { timeout: 15000 },
  );
  const settled = await page.evaluate(() => {
    const c = window.carma;
    window.clearInterval(window.__ai05Monitor);
    c.paused = true;
    for (const body of c.simulation.cars)
      body.state.position.toArray().forEach((value) => {
        if (!Number.isFinite(value)) throw new Error("Nonfinite car position");
      });
    return {
      elapsed: c.simulation.elapsed - window.__ai05RunStart,
      contacts: window.__ai05Contacts,
      firstDamage: window.__ai05DamageChanges[0] ?? null,
      damageChanges: window.__ai05DamageChanges,
      firstWaste: window.__ai05Waste[0] ?? null,
      wasted: window.__ai05Waste,
      cars: c.simulation.cars.map((body) => ({
        name: body.group.name,
        wasted: body.knackered,
        damage: [...body.damage.componentLevels],
        position: body.state.position.toArray(),
      })),
      glError: c.renderer.getContext().getError(),
    };
  });
  report.settled = settled;
  assert.equal(settled.glError, 0, "WebGL context reports no error");
  assert.ok(
    settled.cars.every((car) => car.position.every(Number.isFinite)),
    "All cars retain finite poses after the bounded AI window",
  );
  assert.deepEqual(report.errors, [], "No fatal page or console errors");
  assert.deepEqual(report.failedRequests, [], "No failed asset requests");

  // A mid-roster model failure must discard every staged opponent and mark the
  // population unavailable without exposing a partial fleet to simulation.
  const failedLoadStarted = await page.evaluate(async () => {
    const c = window.carma;
    c.assets.scene = window.__ai05OriginalScene;
    let opponentCalls = 0;
    c.assets.scene = async (directory, stem, options) => {
      if (options?.storage === "opponents" && ++opponentCalls === 3)
        throw new Error("AI-05 injected middle-opponent failure");
      return window.__ai05OriginalScene(directory, stem, options);
    };
    document.querySelector("#track-select").value = c.assets.resolve(
      "data/RACES/desert2/desert2.txt",
    );
    document.querySelector("#car-select").value = c.assets.resolve(
      "data/CARS/bigdump/bigdump.txt",
    );
    await c.loadRace();
    c.paused = true;
    window.__ai05FailureSceneCalls = () => opponentCalls;
    return true;
  });
  assert.equal(failedLoadStarted, true);
  await page.waitForFunction(
    () => window.carma.populationLoadState.opponents.state === "failed",
    null,
    { timeout: 45000 },
  );
  const failedLoad = await page.evaluate(() => {
    const c = window.carma;
    return {
      population: c.populationLoadState.opponents,
      gameTimeMs: c.stats.gameTimeMs,
      practiceReason: c.populationLoadState.practiceReason,
      opponentsUsable: c.populationLoadState.objectives.opponents,
      notice: document.querySelector("#population-status").textContent,
      fleetPublished: !!c.opponentFleet,
      rivals: c.rivals.map((rival) => rival.id),
      cars: c.simulation.cars.map((body) => body.group.name),
      sceneCalls: window.__ai05FailureSceneCalls(),
    };
  });
  report.middleModelFailure = failedLoad;
  assert.equal(failedLoad.population.state, "failed");
  assert.equal(failedLoad.gameTimeMs, 0, "Reload resets the paused race clock");
  assert.match(
    failedLoad.population.reason,
    /AI-05 injected middle-opponent failure/,
  );
  assert.equal(failedLoad.opponentsUsable, false);
  assert.match(failedLoad.notice, /opponent/i);
  // Classic races retain their available lap/pedestrian alternatives; a missing
  // optional opponent target must not force every race into practice mode.
  assert.equal(failedLoad.fleetPublished, false);
  assert.deepEqual(failedLoad.rivals, []);
  assert.deepEqual(failedLoad.cars, ["bigdump"]);
  assert.equal(failedLoad.sceneCalls, 3);

  // Cancel a second Bigdump load while its second model scene is still
  // blocked, then switch to a zero-opponent Boulder Dash mission. The late
  // model completion must only dispose stale staged objects, never republish
  // the old fleet or overwrite the new generation's ready state.
  const cancellationStarted = await page.evaluate(async () => {
    const c = window.carma;
    let calls = 0;
    window.__ai05CancelledDisposed = [];
    c.assets.scene = async (directory, stem, options) => {
      if (options?.storage !== "opponents")
        return window.__ai05OriginalScene(directory, stem, options);
      calls++;
      if (calls === 2)
        await new Promise((resolve) => {
          window.__releaseCancelledOpponent = resolve;
        });
      const model = await window.__ai05OriginalScene(directory, stem, options);
      const dispose = model.dispose.bind(model);
      model.dispose = () => {
        window.__ai05CancelledDisposed.push(model.group.name);
        return dispose();
      };
      return model;
    };
    document.querySelector("#track-select").value = c.assets.resolve(
      "data/RACES/desert2/desert2.txt",
    );
    document.querySelector("#car-select").value = c.assets.resolve(
      "data/CARS/bigdump/bigdump.txt",
    );
    await c.loadRace();
    c.paused = true;
    window.__ai05CancelledSceneCalls = () => calls;
    return true;
  });
  assert.equal(cancellationStarted, true);
  await page.waitForFunction(
    () => typeof window.__releaseCancelledOpponent === "function",
    null,
    { timeout: 45000 },
  );
  const cancellationStaged = await page.evaluate(() => {
    const c = window.carma;
    c.paused = true;
    return {
      state: c.populationLoadState.opponents.state,
      cars: c.simulation.cars.map((body) => body.group.name),
      rivals: c.rivals.length,
      fleetPublished: !!c.opponentFleet,
      sceneCalls: window.__ai05CancelledSceneCalls(),
    };
  });
  report.cancellationStaged = cancellationStaged;
  assert.equal(cancellationStaged.state, "loading");
  assert.deepEqual(cancellationStaged.cars, ["bigdump"]);
  assert.equal(cancellationStaged.rivals, 0);
  assert.equal(cancellationStaged.fleetPublished, false);
  assert.equal(cancellationStaged.sceneCalls, 2);

  const replacementStarted = await page.evaluate(async () => {
    const c = window.carma;
    document.querySelector("#track-select").value = c.assets.resolve(
      "data/RACES/quarry_mission/quarry_mission.txt",
    );
    document.querySelector("#car-select").value = c.assets.resolve(
      "data/CARS/eaglegreen/EAGLEGREEN.TXT",
    );
    await c.loadRace();
    c.paused = true;
    return {
      track: c.raceDefinition?.name,
      player: c.player?.group.name,
    };
  });
  assert.equal(replacementStarted.track, "MISSION: BOULDER DASH");
  await page.waitForFunction(
    () =>
      window.carma.stats.ready &&
      window.carma.populationLoadState.opponents.state === "ready" &&
      window.carma.populationLoadState.pedestrians.state !== "loading",
    null,
    { timeout: 45000 },
  );
  const replacementReady = await page.evaluate(() => {
    const c = window.carma;
    return {
      definition: c.raceDefinition?.name,
      player: c.player?.group.name,
      opponentState: c.populationLoadState.opponents.state,
      pedestrianState: c.populationLoadState.pedestrians.state,
      practiceReason: c.populationLoadState.practiceReason,
      rivals: c.rivals.length,
      cars: c.simulation.cars.map((body) => body.group.name),
      fleetPublished: !!c.opponentFleet,
      sceneOldOpponents: (() => {
        const names = new Set([
          "bugtoo5",
          "wideboy",
          "newhawk",
          "cerby",
          "cobra",
          "fordpick",
          "junker1",
          "mminor",
          "volvo",
          "combine",
        ]);
        const found = [];
        c.scene.traverse((object) => {
          if (names.has(object.name.toLowerCase())) found.push(object.name);
        });
        return found;
      })(),
      disposed: [...window.__ai05CancelledDisposed],
    };
  });
  report.replacementReady = replacementReady;
  assert.equal(replacementReady.definition, "MISSION: BOULDER DASH");
  assert.equal(replacementReady.opponentState, "ready");
  assert.equal(replacementReady.pedestrianState, "ready");
  assert.equal(replacementReady.rivals, 0);
  assert.deepEqual(replacementReady.cars, [replacementReady.player]);
  assert.deepEqual(replacementReady.sceneOldOpponents, []);
  assert.equal(replacementReady.fleetPublished, false);

  await page.evaluate(() => window.__releaseCancelledOpponent());
  await page.waitForFunction(
    () => window.__ai05CancelledDisposed.length >= 2,
    null,
    { timeout: 15000 },
  );
  await page.waitForTimeout(100);
  const afterStaleCompletion = await page.evaluate(() => {
    const c = window.carma;
    return {
      definition: c.raceDefinition?.name,
      opponentState: c.populationLoadState.opponents.state,
      pedestrianState: c.populationLoadState.pedestrians.state,
      practiceReason: c.populationLoadState.practiceReason,
      rivals: c.rivals.length,
      cars: c.simulation.cars.map((body) => body.group.name),
      fleetPublished: !!c.opponentFleet,
      disposed: [...window.__ai05CancelledDisposed],
    };
  });
  report.afterStaleCompletion = afterStaleCompletion;
  assert.equal(afterStaleCompletion.definition, "MISSION: BOULDER DASH");
  assert.equal(afterStaleCompletion.opponentState, "ready");
  assert.equal(
    afterStaleCompletion.pedestrianState,
    replacementReady.pedestrianState,
  );
  assert.equal(afterStaleCompletion.rivals, 0);
  assert.deepEqual(afterStaleCompletion.cars, [replacementReady.player]);
  assert.equal(afterStaleCompletion.fleetPublished, false);
  assert.ok(afterStaleCompletion.disposed.length >= 2);
  assert.deepEqual(report.errors, [], "No fatal page or console errors");
  assert.deepEqual(report.failedRequests, [], "No failed asset requests");
  await writeFile(
    "artifacts/browser-opponent-startup.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    "PASS bounded AI-05 Bigdump/Newhawk opponent-startup fixture; artifacts/browser-opponent-startup.json",
  );
} catch (error) {
  report.failure = String(error);
  if (page && !page.isClosed()) {
    report.failureState = await page
      .evaluate(() => ({
        population: window.carma?.populationLoadState,
        cars: window.carma?.simulation?.cars?.map((car) => ({
          name: car.group.name,
          wasted: car.knackered,
          position: car.state.position.toArray(),
        })),
      }))
      .catch((captureError) => ({ captureError: String(captureError) }));
    await page
      .screenshot({ path: "artifacts/browser-opponent-startup-failure.png" })
      .catch(() => {});
  }
  await writeFile(
    "artifacts/browser-opponent-startup-failure.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
