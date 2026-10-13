import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP render presentation browser regression: Chromium or C2 assets absent.",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const port = 5253;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "",
  browser,
  page;
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
const report = {
  fixture:
    "Paused original scenes; native/optimized presentation comparison and reversible ACT mutations; no direct simulation ticks or driving loop",
  backend:
    "SwiftShader correctness regression, not hardware performance evidence",
  scenes: [],
  errors: [],
  failedRequests: [],
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
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
  report.build = await page
    .locator('script[type="module"]')
    .getAttribute("src");
  assert.match(report.build, /^\/assets\//, "production bundle required");
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  const catalog = await page.evaluate(() => {
    const c = window.carma,
      options = [...document.querySelector("#track-select").options];
    return {
      car: c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT"),
      scenes: [
        {
          label: "stock-timber",
          track: c.assets.resolve("data/RACES/timber2/timber2.txt"),
        },
        {
          label: "advanced-carrier",
          track:
            options.find(
              (o) =>
                /^adv_data\//i.test(o.value) &&
                /\/Carrier1\/Carrier1\.txt$/i.test(o.value),
            )?.value ??
            options.find(
              (o) =>
                /^adv_data\//i.test(o.value) &&
                /carrier_mission\.txt$/i.test(o.value),
            )?.value,
        },
      ],
    };
  });
  report.catalog = catalog;
  assert.ok(catalog.car, "original Eagle3 unavailable");
  for (const target of catalog.scenes) {
    assert.ok(
      target.track,
      `required original scene unavailable: ${target.label}`,
    );
    await page.evaluate(
      async ({ track, car }) => {
        const c = window.carma,
          r = c.renderer;
        window.__presentationLoadRender = Object.getOwnPropertyDescriptor(
          r,
          "render",
        );
        r.render = () => {};
        try {
          c.paused = true;
          document.querySelector("#track-select").value = track;
          document.querySelector("#car-select").value = car;
          await c.loadRace();
          c.paused = true;
          document.querySelector("#panel").hidden = true;
        } catch (error) {
          if (window.__presentationLoadRender)
            Object.defineProperty(r, "render", window.__presentationLoadRender);
          else delete r.render;
          delete window.__presentationLoadRender;
          throw error;
        }
      },
      { track: target.track, car: catalog.car },
    );
    try {
      await page.waitForFunction(
        () =>
          window.carma.stats.ready &&
          window.carma.opponentsReady &&
          window.carma.paused,
        null,
        { timeout: 90000 },
      );
    } finally {
      await page.evaluate(() => {
        const r = window.carma.renderer;
        if (window.__presentationLoadRender)
          Object.defineProperty(r, "render", window.__presentationLoadRender);
        else delete r.render;
        delete window.__presentationLoadRender;
      });
    }
    // Capture actual application cameras, with original drawing forwarded.
    await page.evaluate(() => {
      const r = window.carma.renderer,
        original = r.render;
      const descriptor = Object.getOwnPropertyDescriptor(r, "render");
      const state = { descriptor, sky: null, main: null };
      r.render = function (scene, camera) {
        if (camera.layers.mask === 2) state.sky = camera;
        else state.main = camera;
        return original.apply(this, arguments);
      };
      window.__presentationCameras = state;
    });
    try {
      await page.waitForFunction(
        () =>
          window.__presentationCameras?.sky &&
          window.__presentationCameras?.main,
        null,
        { timeout: 10000 },
      );
    } finally {
      await page.evaluate(() => {
        const d = window.__presentationCameras?.descriptor;
        if (d) Object.defineProperty(window.carma.renderer, "render", d);
        else delete window.carma.renderer.render;
      });
    }
    const result = await page.evaluate(({ label }) => {
      const c = window.carma,
        sim = c.simulation,
        batch = c.noncarRenderBatch,
        renderer = c.renderer;
      const require = (value, message) => {
        if (!value) throw new Error(message);
      };
      require(c.paused &&
        c.renderPoses &&
        batch &&
        typeof batch.isBatched === "function" &&
        batch.matrixSkipRoots instanceof
          Set, "production presentation diagnostic APIs absent");
      const elapsed = sim.elapsed,
        used = new Set();
      const result = {
        label,
        noncars: sim.nonCarCensus(),
        initialBatch: { ...batch.diagnostics },
        invalidations: [],
      };
      window.__presentationResult = result;
      const delta = (a, b) =>
        Math.max(0, ...a.map((v, i) => Math.abs(v - b[i])));
      const poseSnapshot = (object) => ({
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
        matrix: object.matrix.clone(),
        parent: object.parent,
      });
      const restorePose = (object, snapshot) => {
        object.position.copy(snapshot.position);
        object.quaternion.copy(snapshot.quaternion);
        object.scale.copy(snapshot.scale);
        object.matrix.copy(snapshot.matrix);
        object.matrixWorldNeedsUpdate = true;
      };
      const matrixAgreement = () => {
        c.prepareRenderMatrices();
        const saved = [];
        // Hidden articulated pedestrians deliberately defer descendants. Compare
        // every visible actor plus original source and instance NONCAR meshes.
        c.scene.traverseVisible((object) =>
          saved.push({ object, matrix: object.matrixWorld.toArray() }),
        );
        for (const body of sim.noncars)
          body.actor.traverse((object) =>
            saved.push({ object, matrix: object.matrixWorld.toArray() }),
          );
        c.scene.updateMatrixWorld(true);
        let maxDifference = 0;
        for (const { object, matrix } of saved)
          maxDifference = Math.max(
            maxDifference,
            delta(matrix, object.matrixWorld.toArray()),
          );
        require(maxDifference <=
          1e-8, `optimized/native matrix mismatch ${maxDifference}`);
        return { checked: saved.length, maxDifference };
      };
      batch.update();
      result.initialAgreement = matrixAgreement();
      const { sky, main } = window.__presentationCameras;
      const gl = renderer.getContext(),
        width = gl.drawingBufferWidth,
        height = gl.drawingBufferHeight;
      const draw = (full) => {
        const auto = renderer.autoClear,
          matrixAuto = c.scene.matrixWorldAutoUpdate;
        try {
          if (full) c.scene.updateMatrixWorld(true);
          else c.prepareRenderMatrices();
          c.scene.matrixWorldAutoUpdate = false;
          renderer.autoClear = true;
          renderer.render(c.scene, sky);
          renderer.autoClear = false;
          renderer.render(c.scene, main);
          const pixels = new Uint8Array(width * height * 4);
          gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          return pixels;
        } finally {
          renderer.autoClear = auto;
          c.scene.matrixWorldAutoUpdate = matrixAuto;
        }
      };
      const optimized = draw(false),
        native = draw(true);
      let differentBytes = 0,
        maxByteDifference = 0;
      for (let i = 0; i < optimized.length; i++)
        if (optimized[i] !== native[i]) {
          differentBytes++;
          maxByteDifference = Math.max(
            maxByteDifference,
            Math.abs(optimized[i] - native[i]),
          );
        }
      result.pixels = {
        width,
        height,
        bytes: optimized.length,
        differentBytes,
        maxByteDifference,
      };
      require(differentBytes ===
        0, `optimized/native pixel mismatch: ${differentBytes} bytes, max${maxByteDifference}`);
      const fresh = (predicate = () => true) => {
        batch.update();
        const body = sim.noncars.find(
          (b) =>
            !used.has(b) &&
            batch.isBatched(b) &&
            batch.matrixSkipRoots.has(b.actor) &&
            predicate(b),
        );
        require(body, "original scene lacks a fresh certified source NONCAR fixture");
        used.add(body);
        return body;
      };
      const testPose = (body, actor, manual) => {
        const poses = new c.renderPoses.constructor();
        const savedActor = poseSnapshot(actor),
          savedBodyPosition = body.state.position.clone(),
          savedBodyQ = body.state.orientation.clone(),
          savedVelocity = body.state.velocity.clone(),
          savedOmega = body.state.angularVelocity.clone(),
          savedEpoch = body.poseEpoch;
        const oldWorld = actor.matrixWorld.clone();
        try {
          poses.capture([body]);
          const unchanged = poses.apply(body, actor, 1, manual);
          poses.restore();
          if (!manual)
            require(unchanged ===
              false, "unchanged original car did not take presentation no-op path");
          body.state.position.x += 0.125;
          const committed = body.state.position.clone();
          const changed = poses.apply(body, actor, 0.5, manual);
          require(changed ===
            true, "changed original pose failed to update presentation");
          require(body.state.position.equals(committed) &&
            body.state.orientation.equals(
              savedBodyQ,
            ), "render interpolation mutated committed body pose");
          require(body.state.velocity.equals(savedVelocity) &&
            body.state.angularVelocity.equals(savedOmega) &&
            body.poseEpoch ===
              savedEpoch, "render interpolation mutated committed motion/pose epoch");
          poses.restore();
          require(actor.position.equals(savedActor.position) &&
            actor.quaternion.equals(
              savedActor.quaternion,
            ), "render restore lost committed actor components");
          if (manual)
            require(actor.matrix.elements.every((v, i) =>
              Object.is(v, savedActor.matrix.elements[i]),
            ), "manual original ACT matrix was not restored exactly");
          const worldDifference = delta(
            oldWorld.elements,
            actor.matrixWorld.elements,
          );
          require(worldDifference <=
            1e-8, "render restore changed original actor world matrix");
          return {
            actor: actor.name,
            manual,
            unchanged,
            changed,
            worldDifference,
            committedPoseUnchanged: true,
          };
        } finally {
          poses.restore();
          body.state.position.copy(savedBodyPosition);
          body.state.orientation.copy(savedBodyQ);
          body.state.velocity.copy(savedVelocity);
          body.state.angularVelocity.copy(savedOmega);
          restorePose(actor, savedActor);
          c.scene.updateMatrixWorld(true);
        }
      };
      result.poseRestore = [testPose(c.player, c.player.group, false)];
      const manualOwner = fresh((b) => b.actor.children.length > 0);
      const manualActor = manualOwner.actor.children[0];
      const originalAuto = manualActor.matrixAutoUpdate;
      const V = manualOwner.state.position.constructor;
      const Q = manualOwner.state.orientation.constructor;
      const physicalBefore = {
        position: manualOwner.state.position.clone(),
        orientation: manualOwner.state.orientation.clone(),
        velocity: manualOwner.state.velocity.clone(),
        omega: manualOwner.state.angularVelocity.clone(),
      };
      // The production track's source actors use automatic matrices. Exercise
      // manual policy explicitly on one REAL borrowed child, with a separate
      // presentation-only world pose; this is not a manual physics-body claim.
      manualActor.updateWorldMatrix(true, false);
      const presentationBody = {
        state: {
          position: manualActor.getWorldPosition(new V()),
          orientation: manualActor.getWorldQuaternion(new Q()),
          velocity: new V(),
          angularVelocity: new V(),
        },
      };
      try {
        manualActor.matrixAutoUpdate = false;
        result.poseRestore.push({
          ...testPose(presentationBody, manualActor, true),
          fixture:
            "Manual-matrix policy diagnostic on real original retained child ACT; independent presentation pose, not a physics body",
          originalMatrixAutoUpdate: originalAuto,
          parentPhysicalPoseUnchanged:
            manualOwner.state.position.equals(physicalBefore.position) &&
            manualOwner.state.orientation.equals(physicalBefore.orientation) &&
            manualOwner.state.velocity.equals(physicalBefore.velocity) &&
            manualOwner.state.angularVelocity.equals(physicalBefore.omega),
        });
        require(result.poseRestore.at(-1)
          .parentPhysicalPoseUnchanged, "manual child presentation diagnostic changed original parent physics");
      } finally {
        manualActor.matrixAutoUpdate = originalAuto;
        c.scene.updateMatrixWorld(true);
      }
      // Each invalidation uses a distinct real retained source actor. No fake
      // ACTs, geometries or sleep states are introduced; original locals return.
      for (const kind of [
        "actor-pose",
        "child-pose",
        "reparent",
        "wake",
        "parent-pose",
      ]) {
        const body = fresh((b) => {
          if (kind === "child-pose") return b.actor.children.length > 0;
          if (kind === "parent-pose")
            return b.actor.parent && b.actor.parent !== c.scene;
          if (kind === "wake")
            return (
              !b.attached &&
              !b.mechanics.worldJoint &&
              !b.mechanics.infiniteInertia &&
              !b.mechanics.tumble
            );
          return true;
        });
        const record = batch.bodies.get(body);
        require(record?.meshes
          .length, "original source body has no borrowed mesh record");
        const object =
          kind === "child-pose"
            ? body.actor.children[0]
            : kind === "parent-pose"
              ? body.actor.parent
              : body.actor;
        const old = poseSnapshot(object),
          rootOld = poseSnapshot(body.actor);
        try {
          if (kind === "reparent") c.scene.attach(body.actor);
          else if (kind === "wake")
            require(sim.admitNonCar(body, {
              wake: true,
              resetVelocity: false,
            }), "original wake fixture could not obtain native PHIL/slot");
          else {
            object.position.x += 0.0625;
            object.updateMatrix();
          }
          batch.update();
          c.prepareRenderMatrices();
          const sourceVisible = record.meshes.every(
            (s) => s.mesh.visible === s.visible,
          );
          const entry = {
            kind,
            actor: body.actor.name,
            batched: batch.isBatched(body),
            matrixSkipped: batch.matrixSkipRoots.has(body.actor),
            sourceVisible,
            agreement: matrixAgreement(),
          };
          if (kind === "wake")
            entry.physics = {
              active: sim.isNonCarPhysicsActive(body),
              header: !!sim.phil.getHeader(body),
              slot: sim.nonCarSlots.get(body),
              velocity: body.state.velocity.toArray(),
            };
          result.invalidations.push(entry);
          require(!entry.batched &&
            !entry.matrixSkipped &&
            sourceVisible, `${kind}: changed/woken source remained batched or matrix-skipped`);
          if (kind === "wake")
            require(entry.physics.active &&
              entry.physics.header &&
              entry.physics
                .slot, "wake fixture did not retain real admitted physics ownership");
        } finally {
          if (kind === "reparent") {
            rootOld.parent.add(body.actor);
            restorePose(body.actor, rootOld);
          } else if (kind !== "wake") restorePose(object, old);
          batch.update();
          c.scene.updateMatrixWorld(true);
        }
      }
      result.finalBatch = { ...batch.diagnostics };
      result.physicsElapsedDelta = sim.elapsed - elapsed;
      require(result.physicsElapsedDelta === 0 &&
        c.paused, "presentation-only fixture advanced simulation");
      result.gl = {
        error: gl.getError(),
        size: [width, height],
        renderer: (() => {
          const e = gl.getExtension("WEBGL_debug_renderer_info");
          return e && gl.getParameter(e.UNMASKED_RENDERER_WEBGL);
        })(),
      };
      require(result.gl.error === 0, `WebGL error ${result.gl.error}`);
      return result;
    }, target);
    report.scenes.push(result);
    await page.screenshot({
      path: `artifacts/browser-render-presentation-${target.label}.png`,
    });
    await page.evaluate(() => {
      delete window.__presentationCameras;
      delete window.__presentationResult;
    });
  }
  await writeFile(
    "artifacts/browser-render-presentation.json",
    JSON.stringify(report, null, 2),
  );
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  console.log(
    `PASS original render presentation: ${report.scenes.length} paused scenes; artifacts/browser-render-presentation.json`,
  );
} catch (error) {
  report.failure = String(error);
  if (page && !page.isClosed()) {
    report.failureState = await page
      .evaluate(() => window.__presentationResult ?? null)
      .catch((e) => ({ captureError: String(e) }));
    await page
      .screenshot({ path: "artifacts/browser-render-presentation-failure.png" })
      .catch(() => {});
  }
  await writeFile(
    "artifacts/browser-render-presentation-failure.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
