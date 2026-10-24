import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP powerup respawn browser regression: Chromium or original installation absent",
  );
  process.exit(0);
}

const port = await new Promise((resolve, reject) => {
  const reservation = createServer();
  reservation.once("error", reject);
  reservation.listen(0, "127.0.0.1", () => {
    const value = reservation.address().port;
    reservation.close((error) => (error ? reject(error) : resolve(value)));
  });
});
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (chunk) => (serverLog += chunk));
server.stderr.on("data", (chunk) => (serverLog += chunk));
let browser;
const errors = [];
const warnings = [];
const failedRequests = [];
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
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.setDefaultTimeout(90000);
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
    if (message.type() === "warning") warnings.push(message.text());
  });
  page.on("requestfailed", (request) =>
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.evaluate(async () => {
    const c = window.carma;
    const track = c.assets.resolve("data/RACES/newcity1/newcity1.txt");
    const car = c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT");
    if (!track || !car) throw new Error("Stock Newcity/EAGLE3 is absent");
    document.querySelector("#track-select").value = track;
    document.querySelector("#car-select").value = car;
    await c.loadRace();
    c.paused = true;
  });
  await page.waitForFunction(
    () => window.carma?.paused && window.carma.powerups?.pickups.length,
    null,
    { timeout: 90000 },
  );

  const stockCollection = await page.evaluate(() => {
    const c = window.carma;
    const system = c.powerups;
    const queue = system.respawns;
    if (!queue || system.pendingRespawns !== 0)
      throw new Error(
        "Stock single-player respawn queue did not initialize empty",
      );
    const eligible = (item) => queue.enabled[item.index] === 1;
    const isolated = (item) =>
      system.pickups.every(
        (other) =>
          other === item || other.position.distanceTo(item.position) > 1.5,
      );
    const disabledChecks = [];
    const player = c.player;
    const saved = {
      position: player.state.position.clone(),
      heading: player.state.heading,
      velocity: player.state.velocity.clone(),
      angularVelocity: player.state.angularVelocity.clone(),
    };
    const collect = (pickup) => {
      player.state.position.copy(pickup.position);
      player.state.velocity.set(0, 0, 0);
      c.powerups.resetPath(player.state.position);
      c.powerups.update(0, player.state, c.race);
      const collected = pickup.collected;
      player.state.position.copy(saved.position);
      player.state.heading = saved.heading;
      player.state.velocity.copy(saved.velocity);
      player.state.angularVelocity.copy(saved.angularVelocity);
      c.simulation.reset(player);
      c.powerups.resetPath(player.state.position);
      return collected;
    };

    for (const index of [0, 1, 12]) {
      const pickup = system.pickups.find(
        (item) => item.index === index && !item.collected && isolated(item),
      );
      if (!pickup) continue;
      if (queue.enabled[index] !== 0)
        throw new Error(
          `Stock mask unexpectedly enables excluded index ${index}`,
        );
      const pending = system.pendingRespawns;
      if (!collect(pickup))
        throw new Error(
          `In-memory Newcity world pickup ${index} did not collect`,
        );
      if (!pickup.collected || system.pendingRespawns !== pending)
        throw new Error(
          `Excluded index ${index} was reactivated by the respawn queue`,
        );
      disabledChecks.push({
        index,
        collected: pickup.collected,
        pending: system.pendingRespawns,
      });
    }

    const pickup = system.pickups.find(
      (item) => item.index === 52 && eligible(item) && !item.collected,
    );
    if (!pickup)
      throw new Error(
        "Newcity stock mine pickup 52 is missing or not respawn-enabled",
      );
    const index = pickup.index;
    const beforeDebug = system.pendingRespawns;
    if (!c.debugMode.enabled) document.querySelector("#debug-button").click();
    document.querySelector("#debug-powerup").value = String(index);
    document.querySelector("#debug-grant").click();
    const afterGrant = system.pendingRespawns;
    if (afterGrant !== beforeDebug || pickup.collected)
      throw new Error(
        "A direct powerup grant incorrectly queued a world respawn",
      );

    const object = pickup.object;
    object.updateWorldMatrix(true, true);
    const pose = {
      position: object.position.toArray(),
      quaternion: object.quaternion.toArray(),
      scale: object.scale.toArray(),
      matrix: object.matrix.toArray(),
      matrixWorld: object.matrixWorld.toArray(),
      matrixAutoUpdate: object.matrixAutoUpdate,
      nodes: [],
    };
    object.traverse((node) =>
      pose.nodes.push({
        uuid: node.uuid,
        geometry: node.geometry?.uuid ?? null,
        materials: Array.isArray(node.material)
          ? node.material.map((material) => material.uuid)
          : (node.material?.uuid ?? null),
      }),
    );
    const now = system.elapsedMs;
    if (!collect(pickup))
      throw new Error(`World pickup ${index} did not collect`);
    if (
      !pickup.collected ||
      object.visible ||
      object.userData.c2ActorRenderStyle !== 1
    )
      throw new Error(
        "World collection did not hide the original pickup actor",
      );
    if (system.pendingRespawns !== 1)
      throw new Error(
        `Expected one pending pickup respawn, got ${system.pendingRespawns}`,
      );
    const queued = queue.slots.find(Boolean);
    if (
      !queued ||
      queued.index !== index ||
      queued.actor !== pickup ||
      queued.dueMs !== now + 120000
    )
      throw new Error(
        `Original respawn deadline mismatch: now=${now}, queued=${JSON.stringify(queued && { index: queued.index, dueMs: queued.dueMs })}`,
      );

    const debugWasEnabled = c.debugMode.enabled;
    return {
      index,
      now,
      dueMs: queued.dueMs,
      disabledChecks,
      pendingAfterDirectGrant: afterGrant,
      pose,
      timerFrozen: c.debugMode.timerFrozen,
      debugWasEnabled,
      pickupPosition: pickup.position.toArray(),
    };
  });
  assert.equal(stockCollection.pendingAfterDirectGrant, 0);
  assert.equal(stockCollection.debugWasEnabled, true);
  assert.equal(stockCollection.timerFrozen, true);
  assert.equal(stockCollection.dueMs, stockCollection.now + 120000);

  // Trigger the real production callback at due-1 and due while paused. A
  // camera pose aimed at the retained actor makes the native point-visibility
  // gate positive without claiming a rendered/hardware visibility result.
  const respawnResult = await page.evaluate((index) => {
    const c = window.carma;
    const system = c.powerups;
    const pickup = system.pickups.find(
      (item) => item.index === index && item.collected,
    );
    const queued = system.respawns.slots.find(Boolean);
    if (!pickup || !queued)
      throw new Error("Queued original pickup disappeared");
    const object = pickup.object;
    const camera = c.camera;
    const cameraPose = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
    };
    object.updateWorldMatrix(true, false);
    const worldPosition = object.getWorldPosition(
      new camera.position.constructor(),
    );
    camera.position
      .copy(worldPosition)
      .add(new camera.position.constructor(0, 0, 8));
    camera.lookAt(worldPosition);
    camera.updateWorldMatrix(true, false);
    const glowsBefore = c.scene.children.filter(
      (child) => child.name === "source-explosion",
    ).length;
    const sounds = [];
    const playSound = c.audio.playSound.bind(c.audio);
    c.audio.playSound = (id, volume, playbackRate, ...rest) => {
      sounds.push({ id, volume, playbackRate });
      return playSound(id, volume, playbackRate, ...rest);
    };
    const due = queued.dueMs;
    const early = system.updateRespawns(due - 1);
    const earlyState = {
      restored: object.visible,
      pending: system.pendingRespawns,
      calls: sounds.length,
    };
    const dueCount = system.updateRespawns(due);
    const explosionSprites = c.scene.children.filter(
      (child) => child.name === "source-explosion",
    );
    const visibleGlows = explosionSprites.filter(
      (sprite) => sprite.visible && sprite.material?.map,
    );
    const resolvedMaps = explosionSprites.map((sprite) => ({
      visible: sprite.visible,
      mapName: sprite.material?.map?.name ?? null,
      imageSize: [
        sprite.material?.map?.image?.width ?? null,
        sprite.material?.map?.image?.height ?? null,
      ],
    }));
    const pose = {
      position: object.position.toArray(),
      quaternion: object.quaternion.toArray(),
      scale: object.scale.toArray(),
      matrix: object.matrix.toArray(),
      matrixWorld: object.matrixWorld.toArray(),
      matrixAutoUpdate: object.matrixAutoUpdate,
      nodes: [],
    };
    object.traverse((node) =>
      pose.nodes.push({
        uuid: node.uuid,
        geometry: node.geometry?.uuid ?? null,
        materials: Array.isArray(node.material)
          ? node.material.map((material) => material.uuid)
          : (node.material?.uuid ?? null),
      }),
    );
    const result = {
      index,
      due,
      early,
      earlyState,
      dueCount,
      restored: object.visible,
      style: object.userData.c2ActorRenderStyle,
      collected: pickup.collected,
      pose,
      sounds,
      glowsBefore,
      glowsAfter: explosionSprites.length,
      visibleGlows: visibleGlows.length,
      resolvedMaps,
      pending: system.pendingRespawns,
      warnings: c.assets.warnings.filter((warning) =>
        warning.startsWith("Powerup respawn"),
      ),
    };
    c.audio.playSound = playSound;
    camera.position.copy(cameraPose.position);
    camera.quaternion.copy(cameraPose.quaternion);
    camera.updateWorldMatrix(true, false);
    return result;
  }, stockCollection.index);
  assert.equal(respawnResult.early, 0);
  assert.deepEqual(respawnResult.earlyState, {
    restored: false,
    pending: 1,
    calls: 0,
  });
  assert.equal(respawnResult.dueCount, 1);
  assert.equal(respawnResult.restored, true);
  assert.equal(respawnResult.style, 4);
  assert.equal(respawnResult.collected, false);
  assert.equal(respawnResult.pending, 0);
  assert.equal(
    respawnResult.pose.matrixAutoUpdate,
    stockCollection.pose.matrixAutoUpdate,
  );
  assert.deepEqual(respawnResult.pose.position, stockCollection.pose.position);
  assert.deepEqual(
    respawnResult.pose.quaternion,
    stockCollection.pose.quaternion,
  );
  assert.deepEqual(respawnResult.pose.scale, stockCollection.pose.scale);
  assert.deepEqual(respawnResult.pose.matrix, stockCollection.pose.matrix);
  assert.deepEqual(
    respawnResult.pose.matrixWorld,
    stockCollection.pose.matrixWorld,
  );
  assert.deepEqual(respawnResult.pose.nodes, stockCollection.pose.nodes);
  assert.ok(
    respawnResult.sounds.some(
      (event) => event.id === 5402 && event.volume === 1,
    ),
  );
  assert.ok(
    respawnResult.glowsAfter > respawnResult.glowsBefore,
    "native-visible original pickup allocates source-explosion sprites",
  );
  assert.ok(
    respawnResult.visibleGlows > 0,
    `at least one source-explosion sprite resolves a pixelmap and is visible; sprites=${JSON.stringify(respawnResult.resolvedMaps)}`,
  );
  assert.ok(
    respawnResult.sounds.every((event) => event.id !== 3001),
    "respawn audio does not emit the race checkpoint sound",
  );
  assert.deepEqual(
    respawnResult.warnings,
    [],
    "effect callback reports no respawn failure warning",
  );

  // Shortened in-memory timing only: prove the ordinary live loop advances the
  // queue on game time while the debug race countdown remains frozen.
  const shortFixture = await page.evaluate((index) => {
    const c = window.carma;
    const system = c.powerups;
    const queue = system.respawns;
    const pickup = system.pickups.find((item) => item.index === index);
    if (!pickup || !pickup.object.visible || system.pendingRespawns !== 0)
      throw new Error(
        "Original pickup did not return for the short-timing fixture",
      );
    if (!c.debugMode.enabled) {
      document.querySelector("#debug-button").click();
    }
    document.querySelector("#debug-freeze").checked = true;
    document
      .querySelector("#debug-freeze")
      .dispatchEvent(new Event("change", { bubbles: true }));
    if (!c.debugMode.timerFrozen)
      throw new Error(
        "Race timer did not freeze through the normal debug control",
      );
    queue.clear();
    const original = { minimumMs: queue.minimumMs, extraMs: queue.extraMs };
    queue.minimumMs = 300;
    queue.extraMs = 0;
    const p = c.player;
    const position = p.state.position.clone();
    const heading = p.state.heading;
    const velocity = p.state.velocity.clone();
    const angularVelocity = p.state.angularVelocity.clone();
    p.state.position.copy(pickup.position);
    p.state.velocity.set(0, 0, 0);
    c.powerups.resetPath(p.state.position);
    c.powerups.update(0, p.state, c.race);
    p.state.position.copy(position);
    p.state.heading = heading;
    p.state.velocity.copy(velocity);
    p.state.angularVelocity.copy(angularVelocity);
    c.simulation.reset(p);
    if (p.state.position.distanceTo(pickup.position) < 2)
      p.state.position.x += 8;
    c.simulation.reset(p);
    c.powerups.resetPath(p.state.position);
    queue.minimumMs = original.minimumMs;
    queue.extraMs = original.extraMs;
    const queued = queue.slots.find(Boolean);
    if (
      !pickup.collected ||
      !queued ||
      queued.dueMs !== c.powerups.elapsedMs + 300
    )
      throw new Error(
        "Shortened fixture did not queue a 300ms in-memory deadline",
      );
    return {
      dueMs: queued.dueMs,
      raceTime: c.race.timeLeft,
      simElapsed: c.simulation.elapsed,
      elapsedMs: c.powerups.elapsedMs,
      originalSettings: original,
      actorVisibleBefore: pickup.object.visible,
    };
  }, stockCollection.index);
  await page.evaluate(() => (window.carma.paused = false));
  await page.waitForFunction(
    () =>
      window.carma.powerups.pendingRespawns === 0 &&
      window.carma.powerups.pickups.some(
        (pickup) => pickup.collected === false && pickup.object.visible,
      ),
    null,
    { timeout: 1800 },
  );
  const liveLoop = await page.evaluate((index) => {
    const c = window.carma;
    const pickup = c.powerups.pickups.find((item) => item.index === index);
    const result = {
      timerFrozen: c.debugMode.timerFrozen,
      raceTime: c.race.timeLeft,
      simElapsed: c.simulation.elapsed,
      elapsedMs: c.powerups.elapsedMs,
      visible: pickup.object.visible,
      collected: pickup.collected,
      pending: c.powerups.pendingRespawns,
    };
    c.paused = true;
    return result;
  }, stockCollection.index);
  assert.equal(shortFixture.actorVisibleBefore, false);
  assert.ok(shortFixture.dueMs > shortFixture.elapsedMs);
  assert.equal(liveLoop.timerFrozen, true);
  assert.equal(liveLoop.raceTime, shortFixture.raceTime);
  assert.ok(liveLoop.simElapsed > shortFixture.simElapsed);
  assert.ok(liveLoop.elapsedMs >= shortFixture.dueMs);
  assert.equal(liveLoop.visible, true);
  assert.equal(liveLoop.collected, false);
  assert.equal(liveLoop.pending, 0);
  const postPause = await page.evaluate((index) => {
    const c = window.carma;
    const pickup = c.powerups.pickups.find((item) => item.index === index);
    return {
      pending: c.powerups.pendingRespawns,
      visible: pickup.object.visible,
      raceTime: c.race.timeLeft,
      simElapsed: c.simulation.elapsed,
    };
  }, stockCollection.index);
  await page.waitForTimeout(120);
  const stable = await page.evaluate((index) => {
    const c = window.carma;
    const pickup = c.powerups.pickups.find((item) => item.index === index);
    return {
      pending: c.powerups.pendingRespawns,
      visible: pickup.object.visible,
      raceTime: c.race.timeLeft,
      simElapsed: c.simulation.elapsed,
    };
  }, stockCollection.index);
  assert.equal(stable.pending, postPause.pending);
  assert.equal(stable.visible, postPause.visible);
  assert.equal(stable.raceTime, postPause.raceTime);
  assert.equal(stable.simElapsed, postPause.simElapsed);

  const reloadCleanup = await page.evaluate(async (index) => {
    const c = window.carma;
    const previous = c.powerups;
    const pickup = previous.pickups.find((item) => item.index === index);
    if (!pickup || !pickup.object.visible || previous.pendingRespawns !== 0)
      throw new Error(
        "Could not prepare pending entry for reload cleanup check",
      );
    const queue = previous.respawns;
    const original = { minimumMs: queue.minimumMs, extraMs: queue.extraMs };
    queue.minimumMs = 60000;
    queue.extraMs = 0;
    const p = c.player;
    const position = p.state.position.clone();
    const heading = p.state.heading;
    const velocity = p.state.velocity.clone();
    const angularVelocity = p.state.angularVelocity.clone();
    p.state.position.copy(pickup.position);
    p.state.velocity.set(0, 0, 0);
    c.powerups.resetPath(p.state.position);
    previous.update(0, p.state, c.race);
    p.state.position.copy(position);
    p.state.heading = heading;
    p.state.velocity.copy(velocity);
    p.state.angularVelocity.copy(angularVelocity);
    c.simulation.reset(p);
    c.powerups.resetPath(p.state.position);
    queue.minimumMs = original.minimumMs;
    queue.extraMs = original.extraMs;
    const queuedBeforeReload = previous.pendingRespawns;
    if (queuedBeforeReload !== 1)
      throw new Error("Pending entry was not prepared before race reload");
    await c.loadRace();
    c.paused = true;
    return {
      statsReady: c.stats.ready,
      paused: c.paused,
      status: document.querySelector("#message")?.textContent ?? "",
      diagnostics: c.diagnosticsReport,
      queuedBeforeReload,
      oldQueueAfterReload: previous.pendingRespawns,
      newPending: c.powerups.pendingRespawns,
      oldAndNewSystemsDiffer: previous !== c.powerups,
    };
  }, stockCollection.index);
  assert.equal(
    reloadCleanup.statsReady,
    true,
    `race reload did not become ready: ${JSON.stringify(reloadCleanup)}`,
  );
  assert.equal(reloadCleanup.paused, true);
  assert.equal(reloadCleanup.queuedBeforeReload, 1);
  assert.equal(reloadCleanup.oldQueueAfterReload, 0);
  assert.equal(reloadCleanup.newPending, 0);
  assert.equal(reloadCleanup.oldAndNewSystemsDiffer, true);

  const renderer = await page.evaluate(() => {
    const gl = window.carma.renderer.getContext();
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      webgl2: gl instanceof WebGL2RenderingContext,
      vendor: gl.getParameter(gl.VENDOR),
      renderer: gl.getParameter(gl.RENDERER),
      unmaskedVendor: debug
        ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
        : null,
      unmaskedRenderer: debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : null,
      error: gl.getError(),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    };
  });
  assert.equal(renderer.webgl2, true);
  assert.equal(renderer.error, 0);
  assert.ok(renderer.drawingBuffer.every((value) => value > 0));
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  const finalWarnings = await page.evaluate(() =>
    window.carma.assets.warnings.filter((warning) =>
      warning.startsWith("Powerup respawn"),
    ),
  );
  assert.deepEqual(finalWarnings, []);
  console.log(
    "PASS native Stock powerup respawn",
    JSON.stringify({
      stockCollection: {
        ...stockCollection,
      },
      respawnResult,
      shortFixture,
      liveLoop,
      reloadCleanup,
      renderer,
      errors,
      warnings,
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
