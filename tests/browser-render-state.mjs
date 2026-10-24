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
    "SKIP browser render state regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5291;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
const report = {
  backend:
    "SwiftShader (explicit software WebGL); pixel/program-state regression only, no FPS claim",
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
    const tracks = [...document.querySelector("#track-select").options];
    const cars = [...document.querySelector("#car-select").options];
    return {
      timber: tracks.find((option) => /timber/i.test(option.textContent))
        ?.value,
      carrier: tracks.find(
        (option) =>
          /^adv_data\//i.test(option.value) &&
          /carrier_mission\.txt$/i.test(option.value),
      )?.value,
      stockCar: cars.find(
        (option) =>
          /^data\/CARS\//i.test(option.value) &&
          /eagle3\.txt$/i.test(option.value),
      )?.value,
      advancedCar: cars.find(
        (option) =>
          /^adv_data\/CARS\//i.test(option.value) &&
          /69mach1\.txt$/i.test(option.value),
      )?.value,
    };
  });
  if (
    !catalog.timber ||
    !catalog.carrier ||
    !catalog.stockCar ||
    !catalog.advancedCar
  ) {
    console.log(
      "SKIP browser render state regression: required Timber, Advanced carrier, or car asset absent.",
    );
  } else {
    const loadScene = async (name, track, car) => {
      await page.evaluate(
        async ({ track, car }) => {
          const c = window.carma;
          const renderer = c.renderer;
          window.__renderStatePreviousRender = Object.getOwnPropertyDescriptor(
            renderer,
            "render",
          );
          renderer.render = () => {};
          try {
            document.querySelector("#track-select").value = track;
            document.querySelector("#car-select").value = car;
            await c.loadRace();
            c.paused = true;
            document.querySelector("#panel").hidden = true;
          } catch (error) {
            if (window.__renderStatePreviousRender)
              Object.defineProperty(
                renderer,
                "render",
                window.__renderStatePreviousRender,
              );
            else delete renderer.render;
            delete window.__renderStatePreviousRender;
            throw error;
          }
        },
        { track, car },
      );
      try {
        await page.waitForFunction(
          () => {
            const c = window.carma;
            return (
              c?.paused &&
              c.opponentsReady &&
              !!c.pedestrians &&
              c.pedestrians?.count > 0 &&
              c.rivals.length > 0 &&
              c.vehicle &&
              c.renderer &&
              c.scene &&
              c.camera
            );
          },
          null,
          { timeout: 90000 },
        );
      } finally {
        await page.evaluate(() => {
          const renderer = window.carma.renderer;
          if (window.__renderStatePreviousRender)
            Object.defineProperty(
              renderer,
              "render",
              window.__renderStatePreviousRender,
            );
          else delete renderer.render;
          delete window.__renderStatePreviousRender;
        });
      }
      await page.evaluate(() => {
        window.carma.paused = true;
        document.querySelector("#panel").hidden = true;
      });

      const result = await page.evaluate(async () => {
        const c = window.carma;
        const renderer = c.renderer;
        const gl = document.querySelector("#view").getContext("webgl2");
        if (!gl) throw new Error("WebGL2 context unavailable");
        const lights = [];
        c.scene.traverse((object) => {
          if (object.isDirectionalLight) lights.push(object);
        });
        const sun = lights.find((light) => light.layers.isEnabled(1));
        if (!sun)
          throw new Error(
            `No directional light has layer 1 enabled (${lights.length} directional lights)`,
          );

        const restore = [];
        const renderDescriptor = Object.getOwnPropertyDescriptor(
          renderer,
          "render",
        );
        const lightMask = sun.layers.mask;
        const materials = new Set();
        c.scene.traverse((object) => {
          const value = object.material;
          if (Array.isArray(value))
            value.forEach((material) => material && materials.add(material));
          else if (value) materials.add(value);
        });
        const materialStats = new Map();
        for (const material of materials) {
          const original = material.customProgramCacheKey;
          const stat = {
            material,
            calls: 0,
            original,
            initialLightsVersion: null,
            finalLightsVersion: null,
          };
          materialStats.set(material, stat);
          material.customProgramCacheKey = function (...args) {
            stat.calls++;
            return original.apply(this, args);
          };
          restore.push(() => {
            material.customProgramCacheKey = original;
          });
        }
        const cameraPixels = new Map();
        let observedSkyCamera;
        const pixels = () => {
          const width = gl.drawingBufferWidth,
            height = gl.drawingBufferHeight;
          const data = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
          return { width, height, bytes: data };
        };
        let comparisonDone = false;
        let mainFrames = 0;
        const originalRender = renderer.render;
        renderer.render = function (scene, camera) {
          const value = originalRender.apply(this, arguments);
          // Capture both actual passes. Compare legacy output with the optimized
          // pass in the same RAF after the main pass has completed.
          if (!comparisonDone && camera === c.camera) {
            const optimizedMain = pixels();
            const priorMask = sun.layers.mask;
            const priorAutoClear = renderer.autoClear;
            try {
              sun.layers.disable(1);
              renderer.autoClear = true;
              originalRender.call(renderer, c.scene, observedSkyCamera);
              const legacySky = pixels();
              renderer.autoClear = false;
              originalRender.call(renderer, c.scene, c.camera);
              const legacyMain = pixels();
              cameraPixels.set("legacySky", legacySky);
              cameraPixels.set("legacyMain", legacyMain);
              cameraPixels.set("optimizedMain", optimizedMain);
              cameraPixels.set("optimizedSky", cameraPixels.get("observedSky"));
              comparisonDone = true;
            } finally {
              sun.layers.mask = priorMask;
              // Leave the normal main scene in the drawing buffer for the screenshot.
              renderer.autoClear = false;
              originalRender.call(renderer, c.scene, c.camera);
              renderer.autoClear = priorAutoClear;
            }
          } else if (!comparisonDone && camera !== c.camera) {
            observedSkyCamera = camera;
            cameraPixels.set("observedSky", pixels());
          }
          if (camera === c.camera) mainFrames++;
          return value;
        };
        restore.push(() => {
          if (renderDescriptor)
            Object.defineProperty(renderer, "render", renderDescriptor);
          else delete renderer.render;
        });
        try {
          // Let scene and renderer state settle, then compare output at the same
          // paused scene pose before collecting independent four-frame samples.
          while (mainFrames < 3 || !comparisonDone)
            await new Promise(requestAnimationFrame);
          const sample = async (enabled) => {
            sun.layers.set(0);
            if (enabled) sun.layers.enable(1);
            for (const stat of materialStats.values()) {
              stat.calls = 0;
              stat.initialLightsVersion =
                renderer.properties.get(stat.material).lightsStateVersion ??
                null;
            }
            const startFrames = mainFrames;
            while (mainFrames < startFrames + 4)
              await new Promise(requestAnimationFrame);
            const stats = [...materialStats.values()].map((stat) => ({
              type: stat.material.type,
              name: stat.material.name,
              calls: stat.calls,
              initialLightsVersion: stat.initialLightsVersion,
              finalLightsVersion:
                renderer.properties.get(stat.material).lightsStateVersion ??
                null,
            }));
            return {
              programSelectionCalls: stats.reduce(
                (sum, entry) => sum + entry.calls,
                0,
              ),
              lightsStateVersionAdvances: stats.filter(
                (entry) =>
                  entry.initialLightsVersion !== entry.finalLightsVersion,
              ).length,
              materialStates: stats,
            };
          };
          const legacy = await sample(false);
          const optimized = await sample(true);

          const bytesEqual = (a, b) =>
            a &&
            b &&
            a.width === b.width &&
            a.height === b.height &&
            a.bytes.length === b.bytes.length &&
            a.bytes.every((value, index) => value === b.bytes[index]);
          if (!comparisonDone)
            throw new Error(
              "Render hook did not capture the sky/main comparison",
            );
          if (!cameraPixels.get("optimizedSky"))
            throw new Error("Optimized sky pass was not captured");
          const skyEqual = bytesEqual(
            cameraPixels.get("optimizedSky"),
            cameraPixels.get("legacySky"),
          );
          const mainEqual = bytesEqual(
            cameraPixels.get("optimizedMain"),
            cameraPixels.get("legacyMain"),
          );
          return {
            directionalLights: lights.length,
            layer1Enabled: sun.layers.isEnabled(1),
            pixel: {
              skyEqual,
              mainEqual,
              width: cameraPixels.get("optimizedMain").width,
              height: cameraPixels.get("optimizedMain").height,
            },
            materialCount: materialStats.size,
            legacy,
            optimized,
            webglError: gl.getError(),
          };
        } finally {
          sun.layers.mask = lightMask;
          for (const restoreMethod of restore.reverse()) restoreMethod();
        }
      });
      assert.equal(
        result.layer1Enabled,
        true,
        `${name}: directional light enables layer 1 at boot`,
      );
      assert.equal(
        result.pixel.skyEqual,
        true,
        `${name}: optimized and legacy Basic sky pixels match byte-for-byte`,
      );
      assert.equal(
        result.pixel.mainEqual,
        true,
        `${name}: optimized and legacy native main pixels match byte-for-byte`,
      );
      assert.ok(
        result.legacy.lightsStateVersionAdvances > 0,
        `${name}: legacy lightsStateVersion advances across four main frames`,
      );
      assert.equal(
        result.optimized.lightsStateVersionAdvances,
        0,
        `${name}: optimized lightsStateVersion stabilizes across four main frames`,
      );
      assert.ok(
        result.optimized.programSelectionCalls <
          result.legacy.programSelectionCalls,
        `${name}: optimized program selection calls decrease (${result.optimized.programSelectionCalls} vs ${result.legacy.programSelectionCalls})`,
      );
      assert.equal(result.webglError, 0, `${name}: no WebGL error`);
      await page.screenshot({
        path: `artifacts/browser-render-state-${name}.png`,
      });
      report.scenes.push({ name, ...result });
    };

    await loadScene("timber-stock", catalog.timber, catalog.stockCar);
    await loadScene("advanced-carrier", catalog.carrier, catalog.advancedCar);
    assert.deepEqual(
      report.scenes.map((scene) => scene.programSelectionCalls).length,
      2,
    );
    assert.ok(
      report.scenes.every((scene) => scene.materialCount > 0),
      "scene materials were instrumented",
    );
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
      "artifacts/browser-render-state.json",
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
