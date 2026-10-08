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
    "SKIP event audio browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5195;
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
      "--autoplay-policy=no-user-gesture-required",
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
  const selected = await page.evaluate(() => {
    const c = window.carma;
    const options = [...document.querySelector("#track-select").options];
    const tracks = [
      "data/RACES/skitrack3/skitrack3.txt",
      "data/RACES/newcity1/newcity1.txt",
    ];
    const cars = [
      "data/CARS/eaglegreen/eaglegreen.txt",
      "data/CARS/EAGLE3/EAGLE3.TXT",
    ];
    const track = tracks.map((path) => c.assets.resolve(path)).find(Boolean);
    const car = cars.map((path) => c.assets.resolve(path)).find(Boolean);
    if (!track || !car)
      throw new Error(
        "No supported snow/stock race and Eagle car are installed",
      );
    if (!options.some((option) => option.value === track))
      throw new Error(
        `Selected race is not available in the race menu: ${track}`,
      );
    document.querySelector("#track-select").value = track;
    document.querySelector("#car-select").value = car;
    return { track, car };
  });
  await page.evaluate(async () => {
    await window.carma.loadRace();
    window.carma.paused = true;
  });
  await page.evaluate(async () => {
    const c = window.carma;
    await c.audio.unlock();
    if (c.audio.context?.state !== "running")
      throw new Error(
        "Web Audio did not unlock under Chromium autoplay test policy",
      );
  });

  const pickupResult = await page.evaluate(async () => {
    const c = window.carma;
    const supported = new Set([0, 9, 11, 34, 35]);
    const candidates = c.powerups.pickups.filter((pickup) => {
      const definition = c.powerups.definitions[pickup.index];
      return (
        pickup.index !== 14 && definition && supported.has(definition.action)
      );
    });
    const pickup = candidates.find((candidate) =>
      c.powerups.pickups.every(
        (other) =>
          other === candidate ||
          other.position.distanceTo(candidate.position) > 2,
      ),
    );
    if (!pickup)
      throw new Error(
        "No isolated supported non-mine flask exists in the loaded race",
      );
    const definition = c.powerups.definitions[pickup.index];
    const soundIds = [];
    const playOneShot = c.audio.playOneShot.bind(c.audio);
    c.audio.playOneShot = async (id, ...args) => {
      soundIds.push(id);
      return playOneShot(id, ...args);
    };

    const checkpoints = c.race.checkpoints;
    const previous = c.powerups.previous;
    const state = c.player.state;
    const saved = {
      position: state.position.clone(),
      velocity: state.velocity.clone(),
      heading: state.heading,
      speed: state.speed,
    };
    c.race.checkpoints = [];
    state.position.copy(pickup.position);
    state.velocity.set(0, 0, 0);
    state.speed = 0;
    c.simulation.reset(c.player);
    c.powerups.previous = undefined;
    c.paused = false;
    await new Promise((resolve, reject) => {
      const started = performance.now();
      const poll = () => {
        if (pickup.collected) return resolve();
        if (performance.now() - started > 5000)
          return reject(
            new Error(
              "Original flask was not collected by the running animation loop",
            ),
          );
        requestAnimationFrame(poll);
      };
      poll();
    });
    c.paused = true;
    c.race.checkpoints = checkpoints;
    state.position.copy(saved.position);
    state.velocity.copy(saved.velocity);
    state.heading = saved.heading;
    state.speed = saved.speed;
    c.simulation.reset(c.player);
    c.powerups.previous = previous;

    const decoded = await c.audio.buffers.get(5401);
    return {
      index: pickup.index,
      action: definition.action,
      collected: pickup.collected,
      pickupSounds: soundIds.filter((id) => id === 5401).length,
      checkpointSounds: soundIds.filter((id) => id === 8012).length,
      decodedFlaskSound: !!decoded,
      soundIds,
    };
  });
  assert.ok(pickupResult.index !== 14);
  assert.ok([0, 9, 11, 34, 35].includes(pickupResult.action));
  assert.equal(pickupResult.collected, true);
  assert.equal(
    pickupResult.pickupSounds,
    1,
    "world flask collection plays exactly one configured pickup sample",
  );
  assert.equal(
    pickupResult.checkpointSounds,
    0,
    "world flask collection does not play the checkpoint voice",
  );
  assert.equal(
    pickupResult.decodedFlaskSound,
    true,
    "configured FlaskGone sample decodes from local assets",
  );

  const debugResult = await page.evaluate(async () => {
    const c = window.carma;
    const soundIds = [];
    const playOneShot = c.audio.playOneShot.bind(c.audio);
    c.audio.playOneShot = async (id, ...args) => {
      soundIds.push(id);
      return playOneShot(id, ...args);
    };
    const definitions = c.powerups.definitions;
    const ability = definitions.find(
      (definition) =>
        [34, 35].includes(definition.action) && definition.initialValue < 0,
    );
    const timed = definitions.find(
      (definition) =>
        definition.duration > 1 &&
        [5, 6, 8, 9, 10, 21, 22, 27].includes(definition.action),
    );
    if (!ability || !timed)
      throw new Error(
        "Original table has no supported ability and timed effect",
      );

    document.querySelector("#debug-menu-toggle").checked = true;
    document
      .querySelector("#debug-menu-toggle")
      .dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("#debug-powerup").value = String(ability.index);
    document
      .querySelector("#debug-powerup")
      .dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("#debug-grant").click();
    const granted = c.powerups.abilities.get(ability.index)?.charges > 0;
    c.paused = false;
    document
      .querySelector("#view")
      .dispatchEvent(
        new KeyboardEvent("keydown", { code: "KeyF", bubbles: true }),
      );
    document
      .querySelector("#view")
      .dispatchEvent(
        new KeyboardEvent("keyup", { code: "KeyF", bubbles: true }),
      );
    const used =
      (c.powerups.abilities.get(ability.index)?.charges ?? 0) ===
      Math.max(0, -ability.initialValue) - 1;
    c.paused = true;

    document.querySelector("#debug-powerup").value = String(timed.index);
    document
      .querySelector("#debug-powerup")
      .dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector("#debug-grant").click();
    const active = c.powerups.active.find(
      (effect) => effect.index === timed.index,
    );
    if (!active)
      throw new Error("Timed debug grant did not create an original effect");
    active.remaining = 0.02;
    c.paused = false;
    await new Promise((resolve, reject) => {
      const started = performance.now();
      const poll = () => {
        if (!c.powerups.active.some((effect) => effect.index === timed.index))
          return resolve();
        if (performance.now() - started > 3000)
          return reject(
            new Error(
              "Debug-granted original timed effect did not expire in the running animation loop",
            ),
          );
        requestAnimationFrame(poll);
      };
      poll();
    });
    c.paused = true;
    return {
      abilityIndex: ability.index,
      abilityAction: ability.action,
      granted,
      used,
      timedIndex: timed.index,
      expired: !c.powerups.active.some(
        (effect) => effect.index === timed.index,
      ),
      forbiddenSounds: soundIds.filter((id) => id === 8012 || id === 5401),
      soundIds,
    };
  });
  assert.equal(
    debugResult.granted,
    true,
    "visible debug grant adds an original ability",
  );
  assert.equal(
    debugResult.used,
    true,
    "F consumes a charge through the normal ability path",
  );
  assert.equal(
    debugResult.expired,
    true,
    "debug-granted timed effect expires through normal updates",
  );
  assert.deepEqual(
    debugResult.forbiddenSounds,
    [],
    "grant, F use, and expiry do not play pickup/checkpoint audio",
  );

  const checkpointResult = await page.evaluate(async () => {
    const c = window.carma;
    const gate = c.race.checkpoints[0];
    if (!gate || gate.points.length < 3)
      throw new Error("Loaded race has no usable original checkpoint gate");
    const soundIds = [];
    const playOneShot = c.audio.playOneShot.bind(c.audio);
    c.audio.playOneShot = async (id, ...args) => {
      soundIds.push(id);
      return playOneShot(id, ...args);
    };
    const state = c.player.state;
    const points = gate.points.slice(0, 4);
    const center = points
      .reduce(
        (sum, point) => sum.add(point),
        gate.points[0].clone().set(0, 0, 0),
      )
      .multiplyScalar(1 / points.length);
    const normal = gate.points[1]
      .clone()
      .sub(gate.points[0])
      .cross(gate.points[2].clone().sub(gate.points[0]))
      .normalize();
    if (normal.lengthSq() < 1e-8)
      throw new Error("Checkpoint gate has a degenerate plane");
    const sign = gate.direction === -1 ? 1 : -1;
    const from = center.clone().addScaledVector(normal, sign * 0.02);
    const ground = c.collision.height(
      from.x,
      from.z,
      Math.max(...points.map((point) => point.y)),
    );
    if (ground === null)
      throw new Error("Original gate has no supporting road");
    from.y = ground;
    const direction = normal.clone().multiplyScalar(-sign);
    const pickups = c.powerups.pickups.map((pickup) => pickup.collected);
    for (const pickup of c.powerups.pickups) pickup.collected = true;
    state.position.copy(from);
    state.velocity.copy(direction).multiplyScalar(2);
    state.speed = 2;
    state.heading = Math.atan2(-direction.x, -direction.z);
    c.simulation.reset(c.player);
    c.powerups.resetPath(from);
    c.race.nextCheckpoint = 0;
    c.race.lap = 1;
    c.race.timeLeft = 600;
    c.race.status = "racing";
    c.paused = false;
    await new Promise((resolve, reject) => {
      const started = performance.now();
      const poll = () => {
        if (c.race.nextCheckpoint > 0 || c.race.status !== "racing")
          return resolve();
        if (performance.now() - started > 5000)
          return reject(
            new Error("Actual animation did not advance the first checkpoint"),
          );
        requestAnimationFrame(poll);
      };
      poll();
    });
    c.paused = true;
    const advanced = c.race.nextCheckpoint > 0;
    c.powerups.pickups.forEach(
      (pickup, index) => (pickup.collected = pickups[index]),
    );
    return {
      advanced,
      checkpointSounds: soundIds.filter((id) => id === 8012).length,
      pickupSounds: soundIds.filter((id) => id === 5401).length,
      soundIds,
    };
  });
  assert.equal(checkpointResult.advanced, true);
  assert.equal(
    checkpointResult.checkpointSounds,
    1,
    "actual checkpoint crossing plays one checkpoint voice",
  );
  assert.equal(
    checkpointResult.pickupSounds,
    0,
    "checkpoint crossing does not play flask pickup audio",
  );

  const announcements = await page.evaluate(async () => {
    const c = window.carma,
      ids = [];
    const playOneShot = c.audio.playOneShot.bind(c.audio);
    c.audio.playOneShot = async (id, ...args) => {
      ids.push(id);
      return playOneShot(id, ...args);
    };
    c.audio.raceEvents(
      [
        { type: "checkpoint", lap: 5 },
        { type: "lap", lap: 6 },
      ],
      6,
    );
    c.audio.raceEvents(
      [
        { type: "checkpoint", lap: 6 },
        { type: "completed", lap: 6 },
      ],
      6,
    );
    c.audio.raceEvents([{ type: "failed", lap: 1 }], 6);
    c.audio.powerupPickup(14);
    const decoded = await Promise.all(
      ids.map(async (id) => ({
        id,
        duration: (await c.audio.buffers.get(id))?.duration ?? 0,
      })),
    );
    return { ids, decoded, diagnostics: c.audio.diagnostics };
  });
  assert.deepEqual(announcements.ids, [8014, 8011, 8010, 5400]);
  assert.ok(
    announcements.decoded.every((sound) => sound.duration > 0),
    "native race voices and mine pickup sample decode from local data",
  );
  assert.deepEqual(announcements.diagnostics, []);

  const glError = await page.evaluate(
    () =>
      document.querySelector("#view").getContext("webgl2")?.getError() ?? -1,
  );
  assert.equal(glError, 0, "WebGL has no outstanding error");
  assert.deepEqual(errors, [], "Chromium has no page or console errors");
  assert.deepEqual(failedRequests, [], "all requested local assets load");
  const report = {
    selected,
    pickupResult,
    debugResult,
    checkpointResult,
    announcements,
    errors,
    failedRequests,
    glError,
  };
  await writeFile(
    "artifacts/browser-event-audio.json",
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
