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
    "Captured original Newcity1 near-popup ghost, controlled dormant setup, real keyboard-driven ordinary hit",
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
        target = p.peds.find((x) => x.object.name === "ped-spec1-456");
      if (!target?.alive || !target.presentation)
        throw Error("Original captured living pedestrian is absent");
      const V = c.player.state.position.constructor;
      c.player.state.position.set(-11.455115747, -0.817796844, -33.535243218);
      c.player.state.heading = 0;
      c.player.state.velocity.set(0, 0, 0);
      c.simulation.reset(c.player);
      c.camera.position.copy(c.player.state.position).add(new V(0, 0.4, 1));
      c.camera.lookAt(target.object.position);
      p.noteCameraPosition(c.camera.position);
      p.resetCar(c.player.state.position);
      // Consume source near-reset outside process. The visual extension then
      // exposes the exact inner-popup target, reproducing the reported state.
      p.update(
        0,
        { position: c.player.state.position, yaw: 0, speed: 0 },
        {
          cameraPosition: c.camera.position.clone().add(new V(100, 0, 100)),
          gameTimeMs: c.stats.gameTimeMs,
        },
      );
      p.updatePresentation(c.camera.position, 48);
      const targetPosition = target.object.position.clone();
      const d = targetPosition.clone().sub(c.camera.position);
      const state = {
        name: target.object.name,
        position: targetPosition.toArray(),
        alive: target.alive,
        active: target.active,
        visible: target.object.visible,
        dormant: p.dormantRenderActors.has(target.object),
        insideProcess:
          Math.abs(d.x) < 12 && Math.abs(d.y) < 7.2 && Math.abs(d.z) < 12,
        insidePopup:
          Math.abs(d.x) <= 9 && Math.abs(d.y) <= 5.4 && Math.abs(d.z) <= 9,
      };
      const capture = { target, updates: [], count: 0 };
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
        if (capture.updates.length < 8)
          capture.updates.push({
            before,
            active: target.active,
            alive: target.alive,
            dormant: p.dormantRenderActors.has(target.object),
            frame: target.presentation.instance.clock.frame,
          });
      };
      c.player.state.velocity.set(0, 0, -2);
      c.paused = false;
      document.querySelector("#view").focus();
      for (let i = 0; i < 3; i++) {
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            code: "KeyC",
            key: "c",
            bubbles: true,
          }),
        );
        window.dispatchEvent(
          new KeyboardEvent("keyup", { code: "KeyC", key: "c", bubbles: true }),
        );
      }
      return state;
    });
    assert.deepEqual(
      {
        alive: setup.alive,
        active: setup.active,
        visible: setup.visible,
        dormant: setup.dormant,
        insideProcess: setup.insideProcess,
        insidePopup: setup.insidePopup,
      },
      {
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
        count: x.count,
        alive: t.alive,
        active: t.active,
        visible: t.object.visible,
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
