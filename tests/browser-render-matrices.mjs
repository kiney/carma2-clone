import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const assetRoot = process.env.CARMA2_ROOT || "carma2_orig";
try {
  await access(executable);
  await access(assetRoot);
} catch {
  console.log(
    "SKIP render matrix browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5252;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
const report = {
  backend:
    "SwiftShader (explicit software WebGL); no hardware benchmark claimed",
  scenes: [],
  errors: [],
  failedRequests: [],
  webglError: null,
};
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
  page.on("pageerror", (error) => report.errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    report.failedRequests.push(
      `${request.url()}: ${request.failure()?.errorText}`,
    ),
  );
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });

  const catalog = await page.evaluate(() => {
    const cars = [...document.querySelector("#car-select").options];
    const tracks = [...document.querySelector("#track-select").options];
    return {
      snow: tracks.find((option) => /snow/i.test(option.textContent))?.value,
      carrier: tracks.find(
        (option) =>
          /^adv_data\//i.test(option.value) &&
          /carrier_mission\.txt$/i.test(option.value),
      )?.value,
      car69mach1: cars.find(
        (option) =>
          /^adv_data\/CARS\//i.test(option.value) &&
          /69mach1\.txt$/i.test(option.value),
      )?.value,
      stockCar: cars.find(
        (option) =>
          /^data\/CARS\//i.test(option.value) &&
          /eagle3\.txt$/i.test(option.value),
      )?.value,
    };
  });
  if (
    !catalog.snow ||
    !catalog.carrier ||
    !catalog.car69mach1 ||
    !catalog.stockCar
  ) {
    console.log(
      "SKIP render matrix browser regression: required Snow, Advanced carrier, or 69mach1 asset absent.",
    );
  } else {
    const loadScene = async (name, track, car) => {
      const priorPopulationSize = await page.evaluate(
        async ({ track, car }) => {
          const c = window.carma;
          const previous = c.pedestrians;
          const renderer = c.renderer;
          window.__renderMatrixRenderDescriptor =
            Object.getOwnPropertyDescriptor(renderer, "render");
          renderer.render = () => {};
          try {
            document.querySelector("#track-select").value = track;
            document.querySelector("#car-select").value = car;
            await c.loadRace();
            c.paused = true;
            document.querySelector("#panel").hidden = true;
            return previous?.renderActors.size ?? 0;
          } catch (error) {
            if (window.__renderMatrixRenderDescriptor)
              Object.defineProperty(
                renderer,
                "render",
                window.__renderMatrixRenderDescriptor,
              );
            else delete renderer.render;
            delete window.__renderMatrixRenderDescriptor;
            throw error;
          }
        },
        { track, car },
      );
      if (name !== "snow")
        assert.equal(
          priorPopulationSize,
          0,
          "disposing the previous scene clears its pedestrian render registry",
        );
      try {
        await page.waitForFunction(
          () =>
            window.carma.paused &&
            window.carma.opponentsReady &&
            window.carma.pedestrians?.count > 0 &&
            window.carma.rivals.length > 0,
          null,
          { timeout: 90000 },
        );
      } finally {
        await page.evaluate(() => {
          const renderer = window.carma.renderer;
          if (window.__renderMatrixRenderDescriptor)
            Object.defineProperty(
              renderer,
              "render",
              window.__renderMatrixRenderDescriptor,
            );
          else delete renderer.render;
          delete window.__renderMatrixRenderDescriptor;
        });
      }
      const loaded = await page.evaluate(() => {
        const c = window.carma;
        return {
          peds: c.pedestrians.count,
          registeredActors: c.pedestrians.renderActors.size,
          opponents: c.rivals.length,
          preparedApi: typeof c.prepareRenderMatrices,
          paused: c.paused,
        };
      });
      assert.ok(loaded.peds > 0, `${name}: pedestrians loaded`);
      assert.equal(loaded.registeredActors, loaded.peds);
      assert.ok(loaded.opponents > 0, `${name}: opponents loaded`);
      assert.equal(loaded.preparedApi, "function");
      assert.equal(loaded.paused, true);

      const matrices = await page.evaluate(() => {
        const c = window.carma;
        let actor;
        let limb;
        for (const candidate of c.pedestrians.renderActors) {
          limb = candidate.getObjectByName("ped-L-A-joint");
          if (limb) {
            actor = candidate;
            break;
          }
        }
        if (!actor || !limb)
          throw new Error("No articulated pedestrian actor found");
        const child = actor.children[0];
        const originalVisible = actor.visible;
        const originalActorPosition = actor.position.clone();
        const originalActorQuaternion = actor.quaternion.clone();
        const originalActorScale = actor.scale.clone();
        const originalPosition = limb.position.clone();
        const originalQuaternion = limb.quaternion.clone();
        const originalScale = limb.scale.clone();
        let descendantUpdates = 0;
        const originalUpdate = child.updateMatrixWorld;
        child.updateMatrixWorld = function (...args) {
          descendantUpdates++;
          return originalUpdate.apply(this, args);
        };
        const rootPoseBefore = actor.matrixWorld.toArray();
        const equal = (a, b) =>
          a.length === b.length &&
          a.every((value, index) => Math.abs(value - b[index]) <= 1e-8);
        const maxMatrixDifference = (a, b) =>
          Math.max(...a.map((value, index) => Math.abs(value - b[index])));
        try {
          actor.visible = false;
          actor.position.x += 0.125;
          actor.updateMatrix();
          limb.rotation.x += 0.37;
          limb.position.y += 0.125;
          limb.updateMatrix();
          c.prepareRenderMatrices();
          const dormant = {
            descendantUpdates,
            rootPoseCurrent: !equal(
              actor.matrixWorld.toArray(),
              rootPoseBefore,
            ),
          };
          if (!dormant.rootPoseCurrent)
            throw new Error(
              "Dormant pedestrian root did not follow its changed local pose",
            );
          if (descendantUpdates !== 0)
            throw new Error(
              `Dormant pedestrian descendant updated ${descendantUpdates} times`,
            );

          c.scene.updateMatrixWorld(true);
          const explicitFullUpdateCount = descendantUpdates;
          if (explicitFullUpdateCount === 0)
            throw new Error(
              "Explicit scene.updateMatrixWorld(true) skipped a hidden descendant",
            );
          descendantUpdates = 0;

          actor.visible = true;
          c.prepareRenderMatrices();
          if (descendantUpdates === 0)
            throw new Error(
              "Reactivated pedestrian descendants were not updated",
            );
          child.updateMatrixWorld = originalUpdate;
          const prepared = [];
          c.scene.traverseVisible((object) =>
            prepared.push({ object, matrix: object.matrixWorld.toArray() }),
          );
          c.scene.updateMatrixWorld(true);
          const maxDiff = Math.max(
            ...prepared.map(({ object, matrix }) =>
              maxMatrixDifference(matrix, object.matrixWorld.toArray()),
            ),
          );
          if (maxDiff > 1e-8)
            throw new Error(
              `Prepared matrix differs from native traversal by ${maxDiff}`,
            );
          return {
            dormant,
            explicitFullUpdateCount,
            reactivatedDescendantUpdates: descendantUpdates,
            maxMatrixDifference: maxDiff,
          };
        } finally {
          child.updateMatrixWorld = originalUpdate;
          actor.visible = originalVisible;
          actor.position.copy(originalActorPosition);
          actor.quaternion.copy(originalActorQuaternion);
          actor.scale.copy(originalActorScale);
          actor.updateMatrix();
          limb.position.copy(originalPosition);
          limb.quaternion.copy(originalQuaternion);
          limb.scale.copy(originalScale);
          limb.updateMatrix();
          c.prepareRenderMatrices();
          window.__renderMatrixActor = actor;
        }
      });
      const expectedRenderMatrix = await page.evaluate(() =>
        window.__renderMatrixActor.matrixWorld.toArray(),
      );
      await page.waitForFunction(
        () => window.carma.renderer && window.carma.scene.matrixWorldAutoUpdate,
        null,
        { timeout: 10000 },
      );
      await page.evaluate(() => {
        const renderer = window.carma.renderer;
        const original = renderer.render;
        const descriptor = Object.getOwnPropertyDescriptor(renderer, "render");
        const seen = [];
        renderer.render = function (scene, camera) {
          if (seen.length < 2)
            seen.push({
              autoUpdate: scene.matrixWorldAutoUpdate,
              rootMatrix: window.__renderMatrixActor.matrixWorld.toArray(),
            });
          return original.apply(this, arguments);
        };
        window.__renderMatrixPassCapture = { seen, descriptor };
      });
      await page.waitForFunction(
        () => window.__renderMatrixPassCapture?.seen.length >= 2,
        null,
        { timeout: 10000 },
      );
      const passResult = await page.evaluate(() => {
        const { seen, descriptor } = window.__renderMatrixPassCapture;
        if (descriptor)
          Object.defineProperty(window.carma.renderer, "render", descriptor);
        else delete window.carma.renderer.render;
        delete window.__renderMatrixPassCapture;
        return {
          seen,
          restored: window.carma.scene.matrixWorldAutoUpdate,
        };
      });
      assert.deepEqual(
        passResult.seen.map((entry) => entry.autoUpdate),
        [false, false],
        `${name}: both render passes disable automatic world updates`,
      );
      assert.deepEqual(
        passResult.seen[0].rootMatrix,
        passResult.seen[1].rootMatrix,
      );
      assert.deepEqual(
        passResult.seen[0].rootMatrix,
        expectedRenderMatrix,
        `${name}: render passes see the current prepared pedestrian world matrix`,
      );
      assert.equal(
        passResult.restored,
        true,
        `${name}: scene flag restored after RAF`,
      );

      const webglError = await page.evaluate(() => {
        const gl = document.querySelector("#view").getContext("webgl2");
        if (!gl) throw new Error("WebGL2 context unavailable");
        return gl.getError();
      });
      assert.equal(webglError, 0, `${name}: no WebGL error`);
      await page.screenshot({
        path: `artifacts/browser-render-matrices-${name}.png`,
      });
      await page.evaluate(() => delete window.__renderMatrixActor);
      report.scenes.push({
        name,
        ...loaded,
        dormant: matrices.dormant,
        explicitFullUpdateCount: matrices.explicitFullUpdateCount,
        reactivatedDescendantUpdates: matrices.reactivatedDescendantUpdates,
        maxMatrixDifference: matrices.maxMatrixDifference,
        passes: passResult.seen,
        sceneFlagRestored: passResult.restored,
        webglError,
      });
    };

    await loadScene("snow", catalog.snow, catalog.stockCar);
    await loadScene("advanced-carrier", catalog.carrier, catalog.car69mach1);

    report.webglError = await page.evaluate(() => {
      const gl = document.querySelector("#view").getContext("webgl2");
      const extension = gl?.getExtension("WEBGL_debug_renderer_info");
      return {
        error: gl?.getError() ?? -1,
        renderer: extension
          ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
          : "unavailable",
      };
    });
    assert.equal(report.webglError.error, 0);
    assert.deepEqual(
      report.errors,
      [],
      "Chromium has no page or console errors",
    );
    assert.deepEqual(
      report.failedRequests,
      [],
      "all requested local assets load",
    );
    await writeFile(
      "artifacts/browser-render-matrices.json",
      JSON.stringify({ catalog, ...report }, null, 2),
    );
    console.log(JSON.stringify({ catalog, ...report }, null, 2));
  }
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
