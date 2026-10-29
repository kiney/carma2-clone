import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP nearby pedestrian regression: Chromium or original assets absent.",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: "5445" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "",
  browser;
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const report = {
  fixture:
    "Authored living BIPED1 retained-presentation regression; historical private-RNG target coordinates are reference-only; real keyboard-driven PHIL contact",
  cases: [],
  errors: [],
  failedRequests: [],
};
try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch("http://localhost:5445/api/manifest")).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) throw Error(serverLog);
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, serverLog);
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
  page.on("pageerror", (e) => report.errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") report.errors.push(m.text());
  });
  page.on("requestfailed", (r) =>
    report.failedRequests.push(`${r.url()}: ${r.failure()?.errorText}`),
  );
  await page.goto("http://localhost:5445");
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  for (const root of ["data", "adv_data"]) {
    await page.evaluate(async (root) => {
      const c = window.carma;
      document.querySelector("#track-select").value = c.assets.resolve(
        `${root}/RACES/newcity1/newcity1.txt`,
      );
      document.querySelector("#car-select").value = c.assets.resolve(
        "data/CARS/EAGLE3/EAGLE3.TXT",
      );
      await c.loadRace();
      c.paused = true;
    }, root);
    await page.waitForFunction(
      () => window.carma.opponentsReady && window.carma.pedestrians?.count > 0,
      null,
      { timeout: 90000 },
    );
    const setup = await page.evaluate(() => {
      const c = window.carma,
        p = c.pedestrians,
        nativeRuntime = p.nativeRuntime;
      const nativeCharacter = nativeRuntime?.characters.find((row) => {
        const actor = p.peds.find((entry) => entry.object === row.owner);
        return row.formKey === "BIPED1" && actor?.alive && !!actor.presentation;
      });
      const target =
        nativeCharacter &&
        p.peds.find((entry) => entry.object === nativeCharacter.owner);
      if (!target?.alive || !target.presentation)
        throw Error(
          "No authored living BIPED1 identity is enrolled for the retained-presentation fixture",
        );
      const V = c.player.state.position.constructor;
      const historicalReferencePosition = [
        -11.455115747, -0.817796844, -33.535243218,
      ];
      const sourcePosition = target.object.position.clone();
      c.camera.position.copy(sourcePosition);
      c.camera.lookAt(target.object.position);
      p.noteCameraPosition(c.camera.position);
      p.resetCar(c.player.state.position);
      p.nearReset = true;
      p.update(
        0,
        { position: c.player.state.position, yaw: 0, speed: 0 },
        { cameraPosition: sourcePosition, gameTimeMs: c.stats.gameTimeMs },
      );
      const initiallyAdmittedBody = nativeCharacter.body;
      const preallocatedBodies = new Set(p.nativeRuntime.simpleResources);
      if (!initiallyAdmittedBody)
        throw Error(
          "Authored BIPED1 did not acquire its normal native body slot",
        );
      // Native normal admission may apply its authored ground offset; use that
      // resulting source root as the camera/lane reference from here onward.
      const authoredPosition = target.object.position.clone();
      const farCamera = authoredPosition.clone().add(new V(100, 0, 100));
      c.camera.position.copy(farCamera);
      p.noteCameraPosition(farCamera);
      p.update(
        0,
        { position: c.player.state.position, yaw: 0, speed: 0 },
        { cameraPosition: farCamera, gameTimeMs: c.stats.gameTimeMs + 1 },
      );
      if (
        nativeCharacter.body ||
        c.simulation.phil.registeredBodies.includes(initiallyAdmittedBody)
      )
        throw Error("Far-camera setup failed to release native PHIL resources");

      // Place only Eagle and camera. The authored actor and native root are
      // untouched; retain their original population coordinates.
      const targetPosition = target.object.position.clone();
      const lane = new V(Math.sin(target.heading), 0, Math.cos(target.heading));
      const carPosition = targetPosition.clone().addScaledVector(lane, -0.8);
      c.simulation.reset(c.player);
      c.player.state.position.copy(carPosition);
      c.player.state.heading = Math.atan2(-lane.x, -lane.z);
      c.player.state.orientation.set(
        0,
        Math.sin(c.player.state.heading / 2),
        0,
        Math.cos(c.player.state.heading / 2),
      );
      c.player.state.velocity.set(lane.x * 2, 0, lane.z * 2);
      c.player.state.angularVelocity.set(0, 0, 0);
      c.player.state.speed = 2;
      c.player.input.throttle = 0;
      c.player.input.brake = 0;
      c.player.input.steer = 0;
      c.player.input.handbrake = false;
      c.camera.position.copy(carPosition).add(new V(0, 0.4, 1));
      c.camera.lookAt(target.object.position);
      p.noteCameraPosition(c.camera.position);
      p.resetCar(c.player.state.position);
      p.nearReset = false;
      p.updatePresentation(c.camera.position, 48);
      const d = targetPosition.clone().sub(c.camera.position);
      const state = {
        name: target.object.name,
        formKey: nativeCharacter.formKey,
        historicalReferencePosition,
        position: targetPosition.toArray(),
        populationXZMatchesAuthored:
          Math.abs(target.object.position.x - sourcePosition.x) < 1e-5 &&
          Math.abs(target.object.position.z - sourcePosition.z) < 1e-5,
        initiallyAdmittedBodyReleased: !nativeCharacter.body,
        originalPopulationOwner: nativeCharacter.owner === target.object,
        alive: target.alive,
        active: target.active,
        visible: target.object.visible,
        dormant: p.dormantRenderActors.has(target.object),
        insideProcess:
          Math.abs(d.x) < 12 && Math.abs(d.y) < 7.2 && Math.abs(d.z) < 12,
        insidePopup:
          Math.abs(d.x) <= 9 && Math.abs(d.y) <= 5.4 && Math.abs(d.z) <= 9,
      };
      const capture = {
        target,
        updates: [],
        nativeSamples: [],
        nativeCharacter,
        initiallyAdmittedBody,
        nativeHPBefore: nativeCharacter.hitPoints,
        nativeImpactsBefore: nativeCharacter.impactCount,
        count: 0,
      };
      window.__pedGhostCapture = capture;
      const count = p.options.onCount;
      p.options.onCount = (event) => {
        if (event.actor === target.object) capture.count++;
        count?.(event);
      };
      const update = p.update.bind(p);
      p.update = (...args) => {
        const before = {
          active: target.active,
          dormant: p.dormantRenderActors.has(target.object),
          nearReset: p.nearReset,
        };
        update(...args);
        const row = p.nativeRuntime?.characters.find(
          (entry) => entry.owner === target.object,
        );
        if (row && capture.nativeSamples.length < 16)
          capture.nativeSamples.push({
            hadBody: !!row.body,
            hitPoints: row.hitPoints,
            impactCount: row.impactCount,
            flags: row.flags,
            philState: row.body ? c.simulation.phil.getState(row.body) : 0,
            originalOwner: row.owner === target.object,
          });
        if (capture.updates.length < 8)
          capture.updates.push({
            before,
            active: target.active,
            alive: target.alive,
            dormant: p.dormantRenderActors.has(target.object),
            frame:
              p.nativeRuntime?.character(target.object).instance?.clock.frame ??
              target.presentation.instance.clock.frame,
          });
      };
      const threat = {
        position: c.player.state.position,
        velocity: c.player.state.velocity,
        yaw: c.player.state.heading,
        speed: 0,
      };
      p.update(0, threat, {
        cameraPosition: c.camera.position.clone(),
        gameTimeMs: c.stats.gameTimeMs + 2,
        framePeriodMs: 40,
      });
      if (
        !nativeCharacter.body ||
        nativeCharacter.body.owner !== target.object ||
        !preallocatedBodies.has(nativeCharacter.body) ||
        !c.simulation.phil.registeredBodies.includes(nativeCharacter.body)
      )
        throw Error(
          `Retained visible owner did not reacquire a bounded native body: ${JSON.stringify({ state, flags: nativeCharacter.flags, body: !!nativeCharacter.body, diagnostics: [...nativeCharacter.diagnostics] })}`,
        );
      capture.reacquiredSamePhysicalSlot =
        nativeCharacter.body === initiallyAdmittedBody;
      c.paused = false;
      document.querySelector("#view").focus();
      return state;
    });
    assert.deepEqual(
      {
        formKey: setup.formKey,
        initiallyAdmittedBodyReleased: setup.initiallyAdmittedBodyReleased,
        originalPopulationOwner: setup.originalPopulationOwner,
        populationXZMatchesAuthored: setup.populationXZMatchesAuthored,
        alive: setup.alive,
        active: setup.active,
        visible: setup.visible,
        dormant: setup.dormant,
        insideProcess: setup.insideProcess,
        insidePopup: setup.insidePopup,
      },
      {
        formKey: "BIPED1",
        initiallyAdmittedBodyReleased: true,
        originalPopulationOwner: true,
        populationXZMatchesAuthored: true,
        alive: true,
        active: false,
        visible: true,
        dormant: true,
        insideProcess: true,
        insidePopup: true,
      },
    );
    await page.keyboard.down("w");
    try {
      await page.waitForFunction(
        () => !window.__pedGhostCapture.target.alive,
        null,
        { timeout: 3000 },
      );
    } finally {
      await page.keyboard.up("w");
      await page.evaluate(() => {
        window.carma.paused = true;
        document.querySelector("#panel").hidden = true;
      });
    }
    const after = await page.evaluate(() => {
      const c = window.carma,
        x = window.__pedGhostCapture,
        t = x.target,
        gl = c.renderer.getContext(),
        ext = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        updates: x.updates,
        nativeSamples: x.nativeSamples,
        nativeHPBefore: x.nativeHPBefore,
        nativeImpactsBefore: x.nativeImpactsBefore,
        nativeHitPoints: x.nativeCharacter.hitPoints,
        nativeImpactCount: x.nativeCharacter.impactCount,
        nativeOwner: x.nativeCharacter.owner === t.object,
        nativeCountingCharacter: !!t.nativeCountingCharacter,
        nativeDamageObserved:
          x.nativeCharacter.hitPoints < x.nativeHPBefore ||
          x.nativeCharacter.impactCount > x.nativeImpactsBefore,
        nativeBodySeen: x.nativeSamples.some((sample) => sample.hadBody),
        count: x.count,
        alive: t.alive,
        active: t.active,
        visible: x.nativeCharacter.instance?.group.visible ?? t.object.visible,
        ordinaryAnchorVisible: t.object.visible,
        dormant: c.pedestrians.dormantRenderActors.has(t.object),
        player: c.player.state.position.toArray(),
        glError: gl.getError(),
        renderer: ext
          ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
        buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        diagnostics: t.presentation.diagnostics,
      };
    });
    assert.equal(after.updates[0].before.active, false);
    assert.equal(after.updates[0].before.dormant, true);
    assert.equal(
      after.updates[0].before.nearReset,
      false,
      "the retained-visible promotion, not camera-jump reset, must admit the first pass",
    );
    assert.equal(
      after.updates[0].active,
      true,
      "the ordinary update must activate the previously visible near target",
    );
    assert.equal(after.updates[0].dormant, false);
    assert.equal(after.count, 1);
    assert.equal(after.alive, false);
    assert.equal(
      after.nativeOwner,
      true,
      "original dormant actor remains the native character owner",
    );
    assert.equal(
      after.nativeBodySeen,
      true,
      "the retained presentation entered the native PHIL pool",
    );
    assert.equal(
      after.nativeDamageObserved,
      true,
      "actual PHIL contact changed native HP or impact count",
    );
    assert.equal(
      after.nativeCountingCharacter,
      true,
      "the same population owner retains count-once identity",
    );
    assert.equal(after.visible, true);
    assert.equal(after.glError, 0);
    assert.deepEqual(after.diagnostics, []);
    report.cases.push({ root, setup, after });
    await page.screenshot({ path: `artifacts/browser-ped-ghosts-${root}.png` });
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  console.log(
    `PASS nearby pedestrian regression: ${report.cases.length} original keyboard-driven cases`,
  );
} catch (error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  await writeFile(
    "artifacts/browser-ped-ghosts.json",
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  server.kill("SIGTERM");
}
