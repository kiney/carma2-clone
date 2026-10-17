import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

// Use a fresh page in an already running, serially scheduled Chromium instance.
// This script neither builds the application nor launches browsers or servers.
const endpoint = process.env.CDP_URL;
const url = process.env.VISIBILITY_URL;
assert.ok(
  endpoint && url,
  "Set CDP_URL and VISIBILITY_URL for this regression",
);
await mkdir("artifacts", { recursive: true });
const report = {
  fixture:
    "Snow/Eagle3, current-clock native FOLLOW publication; paused render isolation, native relocation invalidation and inactive pedestrian presentation",
  errors: [],
  failedRequests: [],
};
let browser, page;
try {
  browser = await chromium.connectOverCDP(endpoint);
  page = await browser.contexts()[0].newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.bringToFront();
  page.on("pageerror", (error) => report.errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    report.failedRequests.push(
      `${request.url()}: ${request.failure()?.errorText}`,
    ),
  );
  await page.goto(url);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  report.build = await page
    .locator('script[type="module"]')
    .getAttribute("src");
  assert.match(report.build, /^\/assets\//, "production build required");
  await page.evaluate(async () => {
    const c = window.carma;
    c.paused = true;
    const tracks = [...document.querySelector("#track-select").options];
    const track = tracks.find(
      (o) =>
        /^data\//i.test(o.value) && /snow/i.test(`${o.value} ${o.textContent}`),
    )?.value;
    const car = c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT");
    if (!track || !car) throw new Error("Original Snow/Eagle3 fixture absent");
    document.querySelector("#track-select").value = track;
    document.querySelector("#car-select").value = car;
    await c.loadRace();
    c.paused = true;
    document.querySelector("#panel").hidden = true;
  });
  await page.waitForFunction(
    () =>
      window.carma.opponentsReady &&
      window.carma.pedestrians?.count > 0 &&
      window.carma.paused,
    null,
    { timeout: 90000 },
  );
  report.policy = await page.evaluate(() => window.carma.visibility);
  assert.equal(report.policy.nativeOpponentDistance, 45);
  assert.equal(report.policy.opponents, 140);
  await page.evaluate(() => {
    const c = window.carma,
      p = c.player,
      zero = p.state.velocity.clone().set(0, 0, 0);
    c.simulation.setCarPhysicsActive(p, false);
    c.simulation.rematerializePose(
      p,
      p.state.position.clone().add(zero.clone().set(500, 0, 0)),
      p.state.orientation.clone().set(0, 0, 0, 1),
      zero,
    );
    c.paused = false;
  });
  await page.keyboard.press("c");
  await page.waitForFunction(
    () =>
      window.carma.stats.gameTimeMs > 4100 &&
      window.carma.opponentFleet.snapshot.rivals.some(
        (r) => !r.physical && r.follow.cheating,
      ),
    null,
    { timeout: 15000 },
  );
  report.publication = await page.evaluate(() => {
    const c = window.carma;
    c.paused = true;
    document.querySelector("#panel").hidden = true;
    const rival = c.opponentFleet.snapshot.rivals.find(
      (r) => !r.physical && r.follow.cheating && !r.objective.finishedForRace,
    );
    const body = c.rivals.find(
      (r) => r.body.group.uuid === rival?.identity,
    )?.body;
    if (!body) throw new Error("No genuine nonphysical FOLLOW rival");
    const p = c.player;
    c.simulation.rematerializePose(
      p,
      body.state.position.clone().add(p.state.velocity.clone().set(0, 2, 80)),
      p.state.orientation.clone().set(0, 0, 0, 1),
      p.state.velocity.clone().set(0, 0, 0),
    );
    const now = c.stats.gameTimeMs;
    c.opponentFleet.update(now, 16, 1, false);
    const after = c.opponentFleet.snapshot.rivals.find(
      (r) => r.identity === body.group.uuid,
    );
    if (after.physical || !after.follow.cheating || body.group.visible)
      throw new Error(
        "Current-clock update did not retain hidden cheaty FOLLOW",
      );
    const nativeState = () =>
      JSON.stringify({
        fleet: c.opponentFleet.snapshot,
        position: body.state.position.toArray(),
        orientation: body.state.orientation.toArray(),
        velocity: body.state.velocity.toArray(),
        omega: body.state.angularVelocity.toArray(),
        epoch: body.poseEpoch,
        physical: c.simulation.isCarPhysicsActive(body),
        header: c.simulation.phil.getHeader(body)?.index ?? null,
        elapsed: c.simulation.elapsed,
        gameTimeMs: c.stats.gameTimeMs,
        gameFrames: c.stats.gameFrames,
        raceTime: c.race.timeLeft,
      });
    const probe = (window.__visibilityRegression = {
      body,
      nativeState,
      before: nativeState(),
      frames: [],
      draws: 0,
      restoreMeshes: [],
      mode: "published",
      originalRender: c.renderer.render,
      ownRender: Object.getOwnPropertyDescriptor(c.renderer, "render"),
    });
    body.group.traverse((object) => {
      if (!object.isMesh) return;
      const original = object.onBeforeRender;
      probe.restoreMeshes.push(() => (object.onBeforeRender = original));
      object.onBeforeRender = function (...args) {
        if (args[2] === c.camera) probe.draws++;
        return original.apply(this, args);
      };
    });
    c.renderer.render = function (scene, camera) {
      if (camera !== c.camera)
        return probe.originalRender.call(this, scene, camera);
      const distance = body.state.position.distanceTo(camera.position),
        visible = body.group.visible,
        beforeDraws = probe.draws;
      const result = probe.originalRender.call(this, scene, camera);
      probe.frames.push({
        mode: probe.mode,
        distance,
        visible,
        draws: probe.draws - beforeDraws,
        nativeUnchanged: nativeState() === probe.before,
      });
      return result;
    };
    return {
      identity: body.group.uuid,
      now,
      lastInViewMs: after.lastInViewMs,
      followCheating: after.follow.cheating,
      physical: after.physical,
      header: c.simulation.phil.getHeader(body)?.index ?? null,
      nativeHidden: !body.group.visible,
    };
  });
  await page.waitForFunction(
    () => window.__visibilityRegression.frames.length >= 2,
    null,
    { timeout: 10000 },
  );
  report.publishedRender = await page.evaluate(() => {
    const c = window.carma,
      p = window.__visibilityRegression;
    return {
      frames: [...p.frames],
      nativeUnchanged: p.nativeState() === p.before,
      hiddenOutsideRender: !p.body.group.visible,
      visibility: c.visibility,
    };
  });
  assert.equal(report.publication.header, null);
  assert.ok(report.publishedRender.hiddenOutsideRender);
  assert.ok(report.publishedRender.nativeUnchanged);
  assert.ok(
    report.publishedRender.frames.every(
      (f) =>
        f.visible && f.distance > 45 && f.distance < 140 && f.nativeUnchanged,
    ),
    `invalid published render: ${JSON.stringify(report.publishedRender)}`,
  );
  assert.ok(
    report.publishedRender.frames.some((f) => f.draws > 0),
    "published rival mesh was not submitted by the actual renderer",
  );
  await page.screenshot({ path: "artifacts/visibility-cheaty-rival.png" });
  report.relocation = await page.evaluate(() => {
    const c = window.carma,
      p = window.__visibilityRegression,
      epoch = p.body.poseEpoch;
    const result = c.opponentFleet.teleportToSafeLocation(p.body);
    p.mode = "relocated";
    p.frames = [];
    p.before = p.nativeState();
    return {
      kind: result.kind,
      oldEpoch: epoch,
      newEpoch: p.body.poseEpoch,
      hidden: !p.body.group.visible,
      physical: c.simulation.isCarPhysicsActive(p.body),
    };
  });
  assert.ok(report.relocation.newEpoch > report.relocation.oldEpoch);
  assert.equal(report.relocation.hidden, true);
  assert.equal(report.relocation.physical, false);
  await page.waitForFunction(
    () => window.__visibilityRegression.frames.length >= 2,
    null,
    { timeout: 10000 },
  );
  report.relocatedRender = await page.evaluate(() => {
    const p = window.__visibilityRegression;
    return {
      frames: [...p.frames],
      nativeUnchanged: p.nativeState() === p.before,
      hiddenOutsideRender: !p.body.group.visible,
    };
  });
  assert.ok(report.relocatedRender.nativeUnchanged);
  assert.ok(report.relocatedRender.hiddenOutsideRender);
  assert.ok(report.relocatedRender.frames.every((f) => !f.visible && !f.draws));
  report.pedestrianFixture = await page.evaluate(() => {
    const c = window.carma,
      p = window.__visibilityRegression,
      ped = c.pedestrians.peds.find(
        (entry) =>
          !entry.active && !entry.vanished && !entry.nativeCountingCharacter,
      );
    if (!ped) throw new Error("No inactive source-owned pedestrian fixture");
    p.ped = ped;
    p.pedState = () =>
      JSON.stringify({
        active: ped.active,
        alive: ped.alive,
        action: ped.action,
        position: ped.object.position.toArray(),
        velocity: ped.velocity.toArray(),
        heading: ped.heading,
        moveId: ped.moveId,
        lastScareMs: ped.lastScareMs,
      });
    p.pedBefore = p.pedState();
    c.simulation.rematerializePose(
      c.player,
      ped.object.position
        .clone()
        .add(c.player.state.velocity.clone().set(0, 1, 30)),
      c.player.state.orientation.clone().set(0, 0, 0, 1),
      c.player.state.velocity.clone().set(0, 0, 0),
    );
    p.before = p.nativeState();
    return { name: ped.object.name, position: ped.object.position.toArray() };
  });
  await page.waitForFunction(
    () => {
      const c = window.carma,
        p = window.__visibilityRegression;
      return (
        p.ped.object.visible &&
        c.pedestrians.dormantRenderActors.has(p.ped.object)
      );
    },
    null,
    { timeout: 10000 },
  );
  report.pedestrian = await page.evaluate(() => {
    const c = window.carma,
      p = window.__visibilityRegression;
    return {
      active: p.ped.active,
      visible: p.ped.object.visible,
      dormant: c.pedestrians.dormantRenderActors.has(p.ped.object),
      distance: p.ped.object.position.distanceTo(c.camera.position),
      nativeUnchanged: p.pedState() === p.pedBefore,
      visibility: c.visibility,
    };
  });
  assert.equal(report.pedestrian.active, false);
  assert.ok(report.pedestrian.visible && report.pedestrian.dormant);
  assert.ok(report.pedestrian.nativeUnchanged);
  assert.ok(
    report.pedestrian.distance > report.policy.nativePedestrianDistance,
  );
  assert.ok(report.pedestrian.distance < report.policy.pedestrians);
  await page.screenshot({
    path: "artifacts/visibility-dormant-pedestrian.png",
  });
  report.webgl = await page.evaluate(() => {
    const gl = window.carma.renderer.getContext(),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      error: gl.getError(),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
    };
  });
  assert.equal(report.webgl.error, 0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  report.passed = true;
  console.log("PASS native cheaty/dormant visibility browser regression");
} catch (error) {
  report.failure = String(error.stack ?? error);
  throw error;
} finally {
  if (page && !page.isClosed()) {
    await page
      .evaluate(() => {
        const c = window.carma,
          p = window.__visibilityRegression;
        if (!c) return;
        c.paused = true;
        if (!p) return;
        for (const restore of p.restoreMeshes) restore();
        if (p.ownRender)
          Object.defineProperty(c.renderer, "render", p.ownRender);
        else delete c.renderer.render;
        delete window.__visibilityRegression;
      })
      .catch(() => {});
    await page.close();
  }
  await writeFile(
    "artifacts/browser-visibility.json",
    JSON.stringify(report, null, 2),
  );
  // CDP attachment sets close to disconnect this client, preserving Chromium.
  await browser?.close();
}
