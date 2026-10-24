import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const assetRoot = process.env.CARMA2_ROOT || "carma2_orig";
try {
  await access(executable);
  await access(assetRoot);
} catch {
  console.log(
    "SKIP wheel presentation browser regression: Chromium or C2 assets absent",
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
  for (let i = 0; i < 200; i++) {
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
    viewport: { width: 1024, height: 720 },
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

  const selected = await page.evaluate(async () => {
    const c = window.carma;
    const track = c.assets.resolve("data/RACES/newcity1/newcity1.txt");
    const car = c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT");
    if (!track || !car)
      throw new Error("Stock Newcity/EAGLE3 assets are absent");
    c.paused = true;
    document.querySelector("#track-select").value = track;
    document.querySelector("#car-select").value = car;
    await c.loadRace();
    c.paused = true;
    document.querySelector("#panel").hidden = true;
    return { track, car };
  });
  await page.waitForFunction(
    () =>
      window.carma?.stats.ready &&
      window.carma?.opponentsReady &&
      window.carma?.paused,
    null,
    { timeout: 90000, polling: 100 },
  );

  const installed = await page.evaluate(() => {
    const c = window.carma;
    const sim = c.simulation;
    if (!c.carAnimation || !sim || !c.player || !c.renderer)
      throw new Error("Loaded race does not expose player animation/renderer");
    const report = (window.__wheelPresentationReport = {
      fixture:
        "Original stock Newcity/EAGLE3, actual keyboard input, bounded headless SwiftShader capture",
      frames: 0,
      checks: 0,
      movingSamples: 0,
      pausedSamples: 0,
      transientMatrices: 0,
      restoredMatrices: 0,
      errors: [],
    });
    const previous = new Map();
    const animations = [
      c.carAnimation,
      ...c.rivals.map((rival) => rival.animation),
    ];
    const bodies = [c.player, ...c.rivals.map((rival) => rival.body)];
    const poseSignature = (object) => ({
      parent: object.parent,
      matrix: object.matrix.toArray(),
      position: object.position.toArray(),
      quaternion: object.quaternion.toArray(),
      scale: object.scale.toArray(),
      autoUpdate: object.matrixAutoUpdate,
    });
    const same = (a, b) =>
      a.length === b.length &&
      a.every((value, index) => Object.is(value, b[index]));
    const originalBeforeStep = sim.onBeforeStep;
    sim.onBeforeStep = function (...args) {
      const result = originalBeforeStep?.apply(this, args);
      for (const body of bodies)
        previous.set(body, {
          wheels: [...body.state.wheelLengths],
          curvature: body.state.curvature,
          epoch: body.poseEpoch,
          repair: body.damage?.repairRevision,
        });
      return result;
    };
    for (let index = 0; index < animations.length; index++) {
      const animation = animations[index];
      const body = bodies[index];
      const originalRestore = animation.restorePresentation;
      animation.restorePresentation = function (...args) {
        const entries = [...this.presented.values()];
        const result = originalRestore.apply(this, args);
        for (const saved of entries) {
          const current = poseSignature(saved.object);
          const expected = {
            parent: saved.parent,
            matrix: saved.matrix.toArray(),
            position: saved.position.toArray(),
            quaternion: saved.orientation.toArray(),
            scale: saved.scale.toArray(),
            autoUpdate: saved.autoUpdate,
          };
          if (
            current.parent !== expected.parent ||
            current.autoUpdate !== expected.autoUpdate ||
            !same(current.matrix, expected.matrix) ||
            !same(current.position, expected.position) ||
            !same(current.quaternion, expected.quaternion) ||
            !same(current.scale, expected.scale)
          )
            report.errors.push(
              "wheel local transform was not restored after presentation",
            );
          else report.restoredMatrices++;
        }
        return result;
      };
      const originalApply = animation.applyPresentation;
      animation.applyPresentation = function (input) {
        const old = previous.get(body);
        const snapped =
          !old ||
          old.epoch !== body.poseEpoch ||
          old.repair !== body.damage?.repairRevision;
        const alpha =
          !c.paused && sim.isCarPhysicsActive(body)
            ? Math.max(0, Math.min(1, sim.accumulator / 0.04))
            : 1;
        const fraction = snapped ? 1 : alpha;
        const expectedWheels = body.state.wheelLengths.map((value, wheel) =>
          fraction === 1
            ? value
            : (old.wheels[wheel] ?? value) +
              (value - (old.wheels[wheel] ?? value)) * fraction,
        );
        const expectedCurvature =
          fraction === 1
            ? body.state.curvature
            : old.curvature + (body.state.curvature - old.curvature) * fraction;
        const wheelDelta = Math.max(
          0,
          ...expectedWheels.map((value, wheel) =>
            Math.abs(value - (input.wheelLengths?.[wheel] ?? NaN)),
          ),
        );
        const wheelbase =
          body.motion.wheelPositions[0].z - body.motion.wheelPositions[2].z;
        const steering = Math.atan(wheelbase * expectedCurvature);
        const steeringDelta = Math.abs(steering - input.steeringAngle);
        if (
          !Number.isFinite(wheelDelta) ||
          !Number.isFinite(steeringDelta) ||
          wheelDelta > 1e-8 ||
          steeringDelta > 1e-8
        )
          report.errors.push(
            `sample mismatch (${wheelDelta}, ${steeringDelta}; alpha ${alpha})`,
          );
        report.checks++;
        if (!c.paused && sim.isCarPhysicsActive(body)) report.movingSamples++;
        if (c.paused) report.pausedSamples++;
        const persistent = {
          wheels: [...body.state.wheelLengths],
          curvature: body.state.curvature,
          elapsed: this.elapsed,
          spins: this.bindings.map((binding) => binding.angle),
          offsets: [...this.wheelDamageOffsets],
        };
        const result = originalApply.call(this, input);
        if (
          body.state.curvature !== persistent.curvature ||
          body.state.wheelLengths.some(
            (value, wheel) => value !== persistent.wheels[wheel],
          ) ||
          this.elapsed !== persistent.elapsed ||
          this.bindings.some(
            (binding, bindingIndex) =>
              binding.angle !== persistent.spins[bindingIndex],
          ) ||
          this.wheelDamageOffsets.some(
            (value, wheel) => value !== persistent.offsets[wheel],
          )
        )
          report.errors.push("presentation mutated physics or animation state");
        return result;
      };
    }
    const renderer = c.renderer;
    const originalRender = renderer.render;
    renderer.render = function (...args) {
      for (const animation of animations) {
        for (const saved of animation.presented.values()) {
          const object = saved.object;
          const shown = object.matrix.toArray();
          const base = saved.matrix.toArray();
          if (
            shown.some((value, index) => Math.abs(value - base[index]) > 1e-8)
          )
            report.transientMatrices++;
        }
      }
      report.frames++;
      return originalRender.apply(this, args);
    };
    const gl = renderer.getContext();
    const debug = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      playerPosition: c.player.state.position.toArray(),
      opponentCount: c.rivals.length,
      isWebGL2: gl instanceof WebGL2RenderingContext,
      backend: debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    };
  });

  // Let the paused scene render and establish its exact matrix restoration baseline.
  await page.waitForFunction(
    () => window.__wheelPresentationReport?.frames >= 3,
    null,
    { timeout: 15000 },
  );
  await page.evaluate(() => {
    window.__wheelStartPosition = [
      ...window.carma.player.state.position.toArray(),
    ];
    window.carma.paused = false;
  });
  await page.keyboard.down("w");
  await page.waitForTimeout(850);
  await page.keyboard.up("w");
  await page.waitForTimeout(100);
  const driven = await page.evaluate(() => {
    const c = window.carma;
    const report = window.__wheelPresentationReport;
    const position = c.player.state.position.toArray();
    const moved = Math.hypot(
      ...position.map(
        (value, index) => value - window.__wheelStartPosition[index],
      ),
    );
    return {
      position,
      moved,
      report: { ...report },
      paused: c.paused,
      frames: c.stats.frames,
    };
  });
  // The snapshot is set just before driving to avoid treating spawn placement as input response.
  assert.ok(
    installed.opponentCount >= 1,
    "original Newcity race should include a rival",
  );
  assert.equal(installed.isWebGL2, true);
  assert.ok(installed.drawingBuffer[0] > 0 && installed.drawingBuffer[1] > 0);
  assert.equal(driven.paused, false);
  assert.ok(
    driven.moved > 0.01,
    `W input did not move the player: ${driven.moved}`,
  );
  assert.ok(driven.report.checks >= 12);
  assert.ok(
    driven.report.movingSamples > 0,
    "no active simulation samples were observed",
  );
  assert.ok(
    driven.report.pausedSamples > 0,
    "paused presentation was not observed",
  );
  assert.ok(
    driven.report.transientMatrices > 0,
    "renderer never observed temporary wheel matrices",
  );
  assert.deepEqual(driven.report.errors, []);

  await page.evaluate(() => {
    window.carma.paused = true;
  });
  const paused = await page.evaluate(() => ({
    paused: window.carma.paused,
    time: window.carma.simulation.elapsed,
    frame: window.carma.stats.gameFrames,
  }));
  await page.waitForTimeout(150);
  const pausedAgain = await page.evaluate(() => ({
    paused: window.carma.paused,
    time: window.carma.simulation.elapsed,
    frame: window.carma.stats.gameFrames,
    report: { ...window.__wheelPresentationReport },
  }));
  assert.equal(paused.paused, true);
  assert.equal(pausedAgain.paused, true);
  assert.equal(pausedAgain.time, paused.time);
  assert.equal(pausedAgain.frame, paused.frame);
  assert.ok(pausedAgain.report.pausedSamples > driven.report.pausedSamples);
  assert.deepEqual(pausedAgain.report.errors, []);
  assert.ok(
    pausedAgain.report.restoredMatrices > 0,
    "no exact wheel-matrix restorations were observed",
  );
  const gl = await page.evaluate(() => {
    const context = window.carma.renderer.getContext();
    return {
      error: context.getError(),
      width: context.drawingBufferWidth,
      height: context.drawingBufferHeight,
    };
  });
  assert.equal(gl.error, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  console.log(
    "PASS wheel presentation",
    JSON.stringify({
      selected,
      installed,
      driven,
      paused,
      pausedAgain,
      gl,
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
