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
    "SKIP original pedestrian panic completion: Chromium or C2 assets absent",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const port = Number(process.env.PED_PANIC_PORT || 5293);
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "",
  browser;
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
const report = {
  mode: "Original Stock Timber and Advanced Newcity1: real fear BON2 completion through native bridge and steering",
  control:
    "Pause RAF simulation; advance native bridge in serial40ms steps bounded by actual authored BON duration, then two authored run-frame periods. No HP, bone masks, support normals, or completion flags are forged.",
  cases: [],
  errors: [],
  failedRequests: [],
  badResponses: [],
};
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
  assert.ok(ready, `production asset server failed: ${serverLog}`);
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
  page.on("pageerror", (error) =>
    report.errors.push(String(error?.stack ?? error)),
  );
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    report.failedRequests.push(
      `${request.url()}: ${request.failure()?.errorText}`,
    ),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      report.badResponses.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  for (const [dataRoot, trackName] of [
    ["data", "timber2"],
    ["adv_data", "newcity1"],
  ]) {
    const selection = await page.evaluate(
      async ({ root, name }) => {
        const tracks = document.querySelector("#track-select"),
          cars = document.querySelector("#car-select");
        const track = [...tracks.options].find(
          (o) =>
            o.value.toLowerCase().startsWith(`${root}/`) &&
            o.value.toLowerCase().includes(`/${name}/`),
        )?.value;
        const car = [...cars.options].find(
          (o) => o.value.toLowerCase() === "data/cars/eagle3/eagle3.txt",
        )?.value;
        if (!track || !car)
          throw new Error(`Missing ${root}/${name} or Stock Eagle3`);
        tracks.value = track;
        cars.value = car;
        await window.carma.loadRace();
        window.carma.paused = true;
        document.querySelector("#panel").hidden = true;
        return { track, car };
      },
      { root: dataRoot, name: trackName },
    );
    await page.waitForFunction(
      () => window.carma?.populationLoadState?.pedestrians?.state === "ready",
      null,
      { timeout: 90000 },
    );
    const result = await page.evaluate(() => {
      const c = window.carma,
        system = c.pedestrians,
        runtime = system.nativeRuntime,
        bridge = system.nativeBridge;
      if (!bridge) throw new Error("Native population bridge missing");
      c.paused = true;
      const start = Math.max(120, Math.trunc(c.stats.gameTimeMs));
      // Normal population admission supplies the actual selected support face.
      for (let visit = 0; visit < 3; visit++)
        bridge.prepare(c.camera.position, start + visit * 40, false);
      const candidates = runtime.characters.filter((row) => {
        const state = bridge.gameplay.state(row.owner);
        return (
          row.body &&
          row.instance &&
          row.hitPoints > 0 &&
          !(row.flags & 0x180) &&
          !row.instance.physicsActive &&
          row.removedBoneMask === 0 &&
          row.diagnostics.size === 0 &&
          (state.action === 0 || state.action === 1) &&
          state.cache?.faceCache?.selectedFace &&
          row.instance.template.moves.has(2) &&
          row.instance.template.moves.has(41)
        );
      });
      const carDistance = (row) =>
        Math.sqrt(
          Math.min(
            ...c.simulation.cars.map((car) =>
              row.owner.position.distanceToSquared(car.state.position),
            ),
          ),
        );
      candidates.sort((a, b) => carDistance(b) - carDistance(a));
      const character = candidates[0];
      if (!character)
        throw new Error(
          `No living passive supported ped with authored2/41; admitted=${runtime.characters.filter((r) => r.instance).length}`,
        );
      const owner = character.owner,
        instance = character.instance,
        body = character.body,
        state = bridge.gameplay.state(owner);
      const camera = owner.position.clone(),
        now = start + 120;
      bridge.prepare(camera, now, false);
      if (!state.cache?.faceCache?.selectedFace)
        throw new Error("Candidate lost selected support before setup");
      const before = {
        hp: character.hitPoints,
        mask: character.removedBoneMask,
        direction: [...character.direction],
        root: Array.from(instance.rootPose),
        runningTimeMs: state.runningTimeMs ?? null,
        flags: character.flags,
      };
      const completions = [],
        scans = [];
      const originalComplete = runtime.hooks.onMoveCompleted,
        originalScan = bridge.steering.options.scanForObjects;
      // Observe the normal scanner without changing its threat decisions.
      bridge.steering.options.scanForObjects = (ctx, movement) => {
        if (ctx.owner === owner) scans.push(ctx.timeMs);
        return originalScan?.(ctx, movement);
      };
      runtime.hooks.onMoveCompleted = (row, current, timeMs) => {
        if (row.owner !== owner)
          return originalComplete?.(row, current, timeMs);
        const event = {
          timeMs,
          beforeMove: current.moveId,
          completionRequested: current.completionRequested,
          beforeDirection: [...row.direction],
        };
        const output = originalComplete?.(row, current, timeMs);
        completions.push({
          ...event,
          afterMove: row.moveId,
          afterDirection: [...row.direction],
          action: state.action,
          runSpeed: state.cache?.runSpeed,
          runFactor: state.cache?.runFactor,
          periodMs: current.clock.periodMs,
          faceReleased: state.cache?.faceCache === null,
        });
        return output;
      };
      try {
        const request = bridge.gameplay.requestMove(
          runtime.callbackContext(owner),
          { id: 2, speed: -1, action: 2, completion: true },
        );
        if (request.status !== "complete" || character.moveId !== 2)
          throw new Error(
            `Fear request failed ${JSON.stringify(request)}, actual=${character.moveId}`,
          );
        const authored = {
          frameCount: instance.move.asset.motion.frameCount,
          periodMs: instance.clock.periodMs,
          filename: instance.move.asset.form.filename,
        };
        const durationMs = authored.frameCount * authored.periodMs,
          maxSteps = Math.ceil(durationMs / 40) + 2;
        bridge.prepare(camera, now, false);
        let steps = 0,
          completionPosition = null;
        for (let step = 1; step <= maxSteps; step++) {
          bridge.prepare(camera, now + step * 40, false);
          steps = step;
          if (completions.length) {
            completionPosition = instance.rootPose.slice(9);
            break;
          }
        }
        const extra = [],
          runFramePeriodMs = Math.max(40, instance.clock.periodMs);
        for (let step = 1; step <= 2; step++) {
          bridge.prepare(
            camera,
            now + steps * 40 + step * runFramePeriodMs,
            false,
          );
          extra.push({
            timeMs: now + steps * 40 + step * runFramePeriodMs,
            move: character.moveId,
            position: Array.from(instance.rootPose.slice(9)),
          });
        }
        const final = {
          move: character.moveId,
          action: state.action,
          hp: character.hitPoints,
          mask: character.removedBoneMask,
          direction: [...character.direction],
          position: Array.from(instance.rootPose.slice(9)),
          periodMs: instance.clock.periodMs,
          completionRequested: instance.completionRequested,
          runningTimeMs: state.runningTimeMs ?? null,
          active: instance.physicsActive,
        };
        c.camera.position
          .copy(owner.position)
          .add(camera.clone().set(0.3, 0.2, 0.3));
        c.camera.lookAt(owner.position);
        c.renderer.render(c.scene, c.camera);
        const gl = c.renderer.getContext(),
          debug = gl.getExtension("WEBGL_debug_renderer_info");
        return {
          personality: character.personality,
          actor: owner.name,
          candidates: candidates.length,
          nearestCarDistance: carDistance(character),
          before,
          request,
          authored,
          durationMs,
          maxSteps,
          steps,
          completions,
          completionPosition: completionPosition
            ? Array.from(completionPosition)
            : null,
          extra,
          runFramePeriodMs,
          final,
          ordinaryThreatScans: scans.length,
          bodyRetained: character.body === body,
          instanceRetained: character.instance === instance,
          diagnostics: [...character.diagnostics],
          bodyDiagnostics: [...body.diagnostics],
          graphics: {
            renderer: debug
              ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
              : gl.getParameter(gl.RENDERER),
            buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
            error: gl.getError(),
          },
        };
      } finally {
        runtime.hooks.onMoveCompleted = originalComplete;
        bridge.steering.options.scanForObjects = originalScan;
      }
    });
    report.cases.push({ dataRoot, selection, ...result });
    console.log(`${dataRoot} fear completion: ${JSON.stringify(result)}`);
    try {
      assert.equal(
        result.completions.length,
        1,
        `${dataRoot}: one actual BON completion`,
      );
      const completed = result.completions[0];
      assert.equal(completed.beforeMove, 2);
      assert.equal(completed.afterMove, 41);
      assert.equal(
        completed.completionRequested,
        false,
        "native callback bit cleared before dispatch",
      );
      const dot = completed.beforeDirection.reduce(
        (sum, n, i) => sum + n * completed.afterDirection[i],
        0,
      );
      assert.ok(
        dot < -0.99,
        `${dataRoot}: real steering reverses direction, dot=${dot}`,
      );
      assert.equal(completed.action, 1);
      assert.equal(completed.runSpeed, 100);
      assert.equal(completed.runFactor, Math.fround(0.09));
      assert.equal(completed.periodMs, 100);
      assert.equal(completed.faceReleased, true);
      assert.equal(result.final.move, 41);
      assert.equal(result.final.action, 1);
      assert.equal(result.final.completionRequested, false);
      assert.equal(result.final.hp, result.before.hp);
      assert.equal(result.final.mask, result.before.mask);
      assert.equal(result.final.runningTimeMs, result.before.runningTimeMs);
      assert.equal(result.final.active, false);
      assert.ok(result.bodyRetained && result.instanceRetained);
      assert.ok(
        result.steps <= result.maxSteps,
        "completion stays within source BON duration plus two frames",
      );
      const distance = Math.hypot(
        ...result.final.position.map(
          (n, i) => n - result.completionPosition[i],
        ),
      );
      assert.ok(
        distance > 1e-7,
        `${dataRoot}: actual run BON transports root after completion (${distance})`,
      );
      assert.deepEqual(result.diagnostics, []);
      assert.deepEqual(result.bodyDiagnostics, []);
      assert.equal(result.graphics.error, 0);
    } catch (error) {
      (report.validationFailures ??= []).push({
        dataRoot,
        failure: String(error?.stack ?? error),
      });
    }
    await page.screenshot({
      path: `artifacts/browser-ped-panic-${dataRoot}.png`,
    });
  }
  assert.deepEqual(report.validationFailures ?? [], []);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  assert.deepEqual(report.badResponses, []);
} catch (error) {
  report.failure = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await writeFile(
    "artifacts/browser-ped-panic.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server.kill("SIGTERM");
}
console.log(
  JSON.stringify(
    {
      artifact: "artifacts/browser-ped-panic.json",
      cases: report.cases.map(
        ({ dataRoot, personality, completions, final }) => ({
          dataRoot,
          personality,
          completions,
          final,
        }),
      ),
      errors: report.errors,
      failedRequests: report.failedRequests,
      badResponses: report.badResponses,
      validationFailures: report.validationFailures,
      failure: report.failure,
    },
    null,
    2,
  ),
);
