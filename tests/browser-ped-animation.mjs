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
    "SKIP pedestrian animation browser test: Chromium or C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5444;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
let browser;
const report = {
  mode: "bounded native BON/SKL population presentation integration; controlled paused updates are not driven physics evidence",
  backend: "headless Chromium SwiftShader",
  cases: [],
  errors: [],
  failedRequests: [],
  badResponses: [],
};

try {
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/manifest`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) throw new Error(serverLog);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `production asset server did not start: ${serverLog}`);
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
  page.setDefaultTimeout(90000);
  page.on("pageerror", (error) =>
    report.errors.push({
      type: "pageerror",
      message: String(error),
      stack: error.stack,
    }),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      report.errors.push({ type: "console", message: message.text() });
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
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });

  const catalog = await page.evaluate(() => {
    const tracks = [...document.querySelector("#track-select").options];
    const cars = [...document.querySelector("#car-select").options];
    return {
      tracks: Object.fromEntries(
        ["data", "adv_data"].map((root) => [
          root,
          tracks.find(
            (option) =>
              option.value.toLowerCase().startsWith(`${root}/`) &&
              /newcity1/i.test(`${option.value} ${option.textContent}`),
          )?.value,
        ]),
      ),
      eagle: cars.find(
        (option) =>
          option.value.toLowerCase().startsWith("data/") &&
          /eagle3/i.test(`${option.value} ${option.textContent}`),
      )?.value,
    };
  });
  assert.ok(catalog.eagle, "original Eagle3 selection should be available");
  for (const dataRoot of ["data", "adv_data"]) {
    const track = catalog.tracks[dataRoot];
    assert.ok(track, `${dataRoot} Newcity1 track should be available`);
    const loaded = await page.evaluate(
      async ({ track, eagle }) => {
        const c = window.carma;
        const previous = c.pedestrians;
        document.querySelector("#track-select").value = track;
        document.querySelector("#car-select").value = eagle;
        await c.loadRace();
        c.paused = true;
        document.querySelector("#panel").hidden = true;
        await new Promise((resolve) => setTimeout(resolve, 250));
        c.paused = true;
        const priorRef = window.__pedAnimationPrior;
        let disposedPresentationThrows = false;
        if (priorRef) {
          try {
            priorRef.presentation.update({});
          } catch (error) {
            disposedPresentationThrows = /disposed/i.test(String(error));
          }
        }
        return {
          priorPopulationSize: previous?.renderActors.size ?? 0,
          oldPopulationCleared: previous
            ? previous.renderActors.size === 0
            : true,
          oldPresentationDetached: priorRef
            ? priorRef.presentation.group.parent === null
            : true,
          disposedPresentationThrows,
          oldTemplateDisposed: priorRef
            ? priorRef.templateGeometryDisposed
            : true,
          count: c.pedestrians?.count ?? 0,
        };
      },
      { track, eagle: catalog.eagle },
    );
    await page.waitForFunction(
      () =>
        window.carma?.paused &&
        window.carma?.opponentsReady &&
        window.carma?.pedestrians?.count > 0,
      null,
      { timeout: 90000 },
    );
    assert.ok(
      (await page.evaluate(() => window.carma.pedestrians.count)) > 0,
      `${dataRoot}: original Newcity1 should load pedestrians`,
    );
    if (report.cases.length) {
      const priorReload = {
        priorPopulationSize: loaded.priorPopulationSize,
        oldPopulationCleared: loaded.oldPopulationCleared,
        oldPresentationDetached: loaded.oldPresentationDetached,
        disposedPresentationThrows: loaded.disposedPresentationThrows,
        oldTemplateDisposed: loaded.oldTemplateDisposed,
      };
      assert.equal(
        priorReload.priorPopulationSize,
        0,
        `${dataRoot}: old population should not retain registered render actors`,
      );
      assert.equal(priorReload.oldPopulationCleared, true);
      assert.equal(priorReload.oldPresentationDetached, true);
      assert.equal(priorReload.disposedPresentationThrows, true);
      assert.equal(priorReload.oldTemplateDisposed, true);
      report.cases[report.cases.length - 1].reloadRelease = priorReload;
    }
    const audit = await page.evaluate(async (dataRoot) => {
      const c = window.carma;
      c.paused = true;
      const peds = c.pedestrians;
      const entries = peds.peds;
      const sourceStates = peds.states;
      const nativeStates = sourceStates.filter(
        (state) => state.animation?.source === "original-bon-skl",
      );
      const cityRecord = entries.find(
        (ped) => ped.presentation && /cityswat/i.test(ped.object.name),
      );
      if (!cityRecord)
        throw new Error(`${dataRoot}: no native CitySwat population member`);
      const Vector = cityRecord.object.position.constructor;
      const presentation = cityRecord.presentation;
      const instance = presentation.instance;
      const matrices = () => {
        presentation.group.updateMatrixWorld(true);
        return instance.bones.map((bone) => ({
          world: [...bone.actor.matrixWorld.elements],
          local: [...bone.actor.matrix.elements],
          models: bone.model ? [...bone.model.matrix.elements] : null,
          hasGeometry: !!bone.model?.getObjectByProperty("isMesh", true)
            ?.geometry,
        }));
      };
      const initial = matrices();
      const stateBefore = peds.states[entries.indexOf(cityRecord)];
      const frameBefore = stateBefore.animation.frame;
      const slot = stateBefore.animation.moveSlot;
      const rootUp = initial[0].world[1];
      const carPosition = cityRecord.object.position
        .clone()
        .add(new Vector(100, 0, 100));
      const car = { position: carPosition, yaw: 0, speed: 0 };
      peds.resetCar(carPosition);
      const updateAt = (timeMs) =>
        peds.update(0, car, {
          gameTimeMs: timeMs,
          cameraPosition: cityRecord.object.position.clone(),
          framePeriodMs: 0,
        });
      updateAt(1000);
      const first = matrices();
      updateAt(1000 + Math.max(1, cityRecord.walkPeriod));
      const second = matrices();
      const stateAfter = peds.states[entries.indexOf(cityRecord)];
      // Verify a source-authored pose advance without prescribing any one
      // arbitrary pose: a full matrix delta is enough to prove BON updates.
      const matrixDelta = (a, b) =>
        Math.max(
          ...a.flatMap((bone, index) =>
            bone.world.map((value, j) => Math.abs(value - b[index].world[j])),
          ),
        );
      const poseChanged = matrixDelta(first, second) > 1e-5;
      const positionBeforeLegacyMove = cityRecord.object.position.clone();
      cityRecord.object.position.add(new Vector(0.25, 0, 0));
      const movedParent = cityRecord.object.position.clone();
      updateAt(1000 + Math.max(2, cityRecord.walkPeriod * 2));
      const moved = matrices();
      const worldRoot = instance.bones[0].actor.getWorldPosition(new Vector());
      const parentPosition = cityRecord.object.position;
      const expectedRoot = parentPosition.clone();
      expectedRoot.y += presentation.groundingOffset;
      const rootPositionError = worldRoot.distanceTo(expectedRoot);
      const bodyModelsIdentity = instance.bones
        .filter((bone) => bone.model)
        .every((bone) => {
          const e = bone.model.matrix.elements;
          return (
            Math.abs(e[12]) + Math.abs(e[13]) + Math.abs(e[14]) < 1e-5 &&
            Math.abs(e[0] - 1) + Math.abs(e[5] - 1) + Math.abs(e[10] - 1) < 1e-5
          );
        });
      const attachedGeometry = instance.bones.some(
        (bone) => bone.model?.getObjectByProperty("isMesh", true)?.geometry,
      );

      // Exercise the ordinary population sweep while this actual native visual
      // remains the renderer. It is still only a presentation integration test.
      const previousCar = cityRecord.object.position
        .clone()
        .add(new Vector(-2, 0, 0));
      peds.previousCar.copy(previousCar);
      peds.update(
        0,
        {
          position: cityRecord.object.position.clone().add(new Vector(2, 0, 0)),
          yaw: 0,
          speed: 2,
        },
        {
          gameTimeMs: 1300,
          cameraPosition: cityRecord.object.position.clone(),
        },
      );
      const dead = peds.states[entries.indexOf(cityRecord)];
      const corpseVisible =
        cityRecord.object.visible &&
        matrices().some((bone) => bone.models !== null);
      const hitCount = peds.hits;
      peds.update(
        0,
        {
          position: cityRecord.object.position
            .clone()
            .add(new Vector(2.1, 0, 0)),
          yaw: 0,
          speed: 2,
        },
        {
          gameTimeMs: 1301,
          cameraPosition: cityRecord.object.position.clone(),
        },
      );
      const onceOnly = peds.hits === hitCount;
      peds.reset();
      const reset = peds.states[entries.indexOf(cityRecord)];
      const resetMatrices = matrices();
      const gl = c.renderer.getContext();
      const errors = [];
      for (let i = 0; i < 16; i++) {
        const error = gl.getError();
        if (error === gl.NO_ERROR) break;
        errors.push(error);
      }
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      const result = {
        dataRoot,
        loadedPedestrians: entries.length,
        nativeStates: nativeStates.length,
        everyPedestrianNative: nativeStates.length === entries.length,
        citySwatName: cityRecord.object.name,
        citySwatMoveSlot: slot,
        rootUp,
        frameBefore,
        frameAfter: stateAfter.animation.frame,
        poseChanged,
        matrixDelta: matrixDelta(first, second),
        movedParent: movedParent.toArray(),
        rootWorldPosition: worldRoot.toArray(),
        rootPositionError,
        bodyModelsIdentity,
        attachedGeometry,
        rootMatricesChangedWithAnimation: matrixDelta(first, moved) > 1e-5,
        dead: dead.alive === false,
        corpseVisible,
        onceOnly,
        resetAlive: reset.alive,
        resetMoveSlot: reset.animation?.moveSlot,
        resetNativeRootUp: resetMatrices[0].world[1],
        webglErrors: errors,
        renderer,
      };
      // Preserve scene references only for the caller's subsequent reload check.
      const template = presentation.template;
      let templateGeometryDisposed = false;
      const templateGeometry = template.group.getObjectByProperty(
        "isMesh",
        true,
      )?.geometry;
      templateGeometry?.addEventListener("dispose", () => {
        templateGeometryDisposed = true;
      });
      window.__pedAnimationPrior = {
        peds,
        entries,
        presentation,
        instance,
        templateGeometryDisposed: false,
      };
      window.__pedAnimationPrior.templateGeometryDisposed =
        templateGeometryDisposed;
      if (templateGeometry) {
        templateGeometry.addEventListener("dispose", () => {
          window.__pedAnimationPrior.templateGeometryDisposed = true;
        });
      }
      return result;
    }, dataRoot);
    audit.assertions = [];
    const verify = (condition, message) => {
      if (!condition) audit.assertions.push(message);
    };
    verify(
      audit.everyPedestrianNative,
      `${dataRoot}: all population states should report original-bon-skl`,
    );
    verify(
      audit.citySwatMoveSlot >= 0,
      `${dataRoot}: CitySwat should select an authored move`,
    );
    verify(
      audit.rootUp > 0.95,
      `${dataRoot}: native root should stand upright without default ACT tilt`,
    );
    verify(
      audit.poseChanged && audit.matrixDelta > 1e-5,
      `${dataRoot}: controlled authored-time updates should change native bone frames`,
    );
    verify(
      audit.rootPositionError < 0.12,
      `${dataRoot}: root world position should track the gameplay parent once`,
    );
    verify(
      audit.bodyModelsIdentity && audit.attachedGeometry,
      `${dataRoot}: flat bone models should retain identity local matrices and attached geometry`,
    );
    verify(
      audit.dead && audit.corpseVisible && audit.onceOnly,
      `${dataRoot}: ordinary sweep should retain a visible native corpse and count once`,
    );
    verify(
      audit.resetAlive &&
        audit.resetMoveSlot >= 0 &&
        audit.resetNativeRootUp > 0.95,
      `${dataRoot}: reset should restore a living native presentation`,
    );
    verify(
      audit.webglErrors.length === 0,
      `${dataRoot}: renderer should report no WebGL errors`,
    );
    report.cases.push(audit);
  }

  const final = await page.evaluate(() => {
    const gl = window.carma.renderer.getContext();
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: ext
        ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER),
      width: gl.drawingBufferWidth,
      height: gl.drawingBufferHeight,
    };
  });
  report.webgl = final;
  await page.screenshot({ path: "artifacts/browser-ped-animation.png" });
  report.errors = [
    ...new Map(
      report.errors.map((entry) => [JSON.stringify(entry), entry]),
    ).values(),
  ];
  assert.deepEqual(
    report.errors,
    [],
    "browser should have no fatal or console errors",
  );
  assert.deepEqual(
    report.failedRequests,
    [],
    "browser should have no failed requests",
  );
  assert.deepEqual(
    report.badResponses,
    [],
    "browser should have no failed asset responses",
  );
  assert.equal(report.cases.length, 2);
  for (const result of report.cases)
    assert.deepEqual(result.assertions, [], JSON.stringify(result.assertions));
  await writeFile(
    "artifacts/browser-ped-animation.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error);
  await writeFile(
    "artifacts/browser-ped-animation.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
