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
    "SKIP PHY-17 browser fixture: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const port = Number(process.env.PHY17_PORT || 5257);
// This bounded source-module fixture intentionally uses Vite, not dist/.
const server = spawn(process.execPath, ["server/dev.mjs"], {
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
    "Original Porker2 WAM and mechanics; eight deterministic component impacts; real due part-6/7 reservations; SPAM; recorded launch input; procedural support plane; maximum three ticks per case",
  limitation:
    "Controlled original-data mechanism reproduction, not restoration of the unavailable historical damaged orientation/geometry. Native contact response remains unchanged.",
  backend:
    "SwiftShader correctness fixture, not a hardware performance measurement",
  cases: [],
  errors: [],
  failedRequests: [],
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
  assert.ok(ready, `Vite asset server did not start: ${serverLog}`);
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
  await page.addInitScript(() => {
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      request((time) => {
        if (!window.__phy17HoldAnimation) callback(time);
      });
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
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  report.entry = await page
    .locator('script[type="module"][src]')
    .last()
    .getAttribute("src");
  assert.match(
    report.entry,
    /^\/src\/main\.ts/,
    "Source-module fixture requires the dev server",
  );
  await page.evaluate(() => {
    window.carma.paused = true;
    window.__phy17HoldAnimation = true;
  });
  // Drain the one already-scheduled game RAF before manual fixture rendering.
  await page.waitForTimeout(100);
  for (const options of [
    { label: "grounded", airborne: false, wall: false },
    { label: "airborne", airborne: true, wall: false },
    { label: "new-wall", airborne: false, wall: true },
  ]) {
    const result = await page.evaluate(async ({ label, airborne, wall }) => {
      const c = window.carma;
      // Read Vite's transformed main import to share its exact Three instance.
      const transformed = await (await fetch("/src/main.ts")).text();
      const threePath = transformed.match(
        /import \* as THREE from ["']([^"']+)["']/,
      )?.[1];
      if (!threePath)
        throw new Error("Cannot resolve the active Vite Three module");
      const THREE = await import(threePath);
      const [
        { VehicleSimulation, createSimulatedCar },
        { WorldCollision },
        { DamageSystem },
      ] = await Promise.all([
        import("/src/physics/simulation.ts"),
        import("/src/world.ts"),
        import("/src/damage.ts"),
      ]);
      const require = (condition, message) => {
        if (!condition) throw new Error(`PHY-17 ${label}: ${message}`);
      };
      const config = c.assets.resolve("data/CARS/porker2/PORKER2.TXT");
      require(config, "Original Porker2 configuration absent");
      const text = await c.assets.text(config);
      const directory = config.slice(0, config.lastIndexOf("/"));
      const stem = config
        .slice(config.lastIndexOf("/") + 1)
        .replace(/\.[^.]+$/, "");
      const loaded = await c.assets.scene(directory, stem, {
        shading: 2,
        storage: `phy17-${label}`,
      });
      const damage = new DamageSystem(c.assets, loaded.group, text);
      await damage.init();
      damage.damageContext.random = () => 0.5;
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x20252c);
      const geometry = new THREE.BufferGeometry();
      const vertices = [
        -20, 0, -20, 20, 0, 20, 20, 0, -20, -20, 0, -20, -20, 0, 20, 20, 0, 20,
      ];
      if (wall) vertices.push(0.23, -20, -20, 0.23, 20, -20, 0.23, 0, 20);
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(vertices, 3),
      );
      geometry.userData.sourceFaceFlags = new Uint8Array(
        vertices.length / 9,
      ).fill(7);
      geometry.computeVertexNormals();
      const material = new THREE.MeshLambertMaterial({
        color: 0x8a9298,
        side: THREE.DoubleSide,
      });
      scene.add(new THREE.Mesh(geometry, material));
      const world = new WorldCollision(scene);
      const sim = new VehicleSimulation(world, scene);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x404850, 2));
      const light = new THREE.DirectionalLight(0xffffff, 2);
      light.position.set(2, 4, 3);
      scene.add(light, loaded.group);
      const car = createSimulatedCar(
        loaded.group,
        text,
        damage,
        new THREE.Vector3(0, airborne ? 2 : -0.04, 0),
        0,
        true,
        { immutableHulls: true },
      );
      sim.add(car);
      for (const [axis, sign] of [
        [2, -1],
        [2, 1],
        [0, -1],
        [1, -1],
        [1, -1],
        [1, -1],
        [1, -1],
        [1, -1],
      ]) {
        const point = damage.bounds.getCenter(new THREE.Vector3());
        point.setComponent(
          axis,
          (sign < 0 ? damage.bounds.min : damage.bounds.max).getComponent(axis),
        );
        const energy = new THREE.Vector3().setComponent(axis, sign * 0.5);
        damage.applyImpact([point], energy, true, false, 0, energy, point);
      }
      const before = Array.from(damage.componentLevels);
      require(JSON.stringify(before) ===
        JSON.stringify([
          29, 47, 29, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]), "Bounded impacts changed snap preconditions");
      for (const index of [6, 7]) damage.runtimeParts[index].state.queuedAt = 0;
      sim.detachParts(car);
      const mass = car.properties.mass;
      const launch = new THREE.Vector3(
        1.5254815979504726,
        2.8236296822095572,
        -0.6026382068057459,
      );
      car.state.velocity.copy(launch);
      damage.damageContext.random = () => 0;
      const spam = sim.spamCar(car, 0.1);
      const secondary = sim.debris.find((body) => body.part < 0);
      require(spam?.rays.length === 10 &&
        spam.splitRequest &&
        secondary &&
        damage.snapped, "SPAM did not create original split secondary");
      const attachments = sim.debris.filter((body) =>
        [6, 7].includes(body.part),
      );
      require(attachments.length === 2 &&
        attachments.every(
          (body) => body.joint?.parent === secondary,
        ), "Real attachments did not migrate to secondary");
      const moments = secondary.properties.inertia.clone();
      const com = secondary.properties.centerOfMass.clone();
      const start = secondary.state.position.clone();
      sim.predictHierarchy(sim.allBodies());
      const guard = sim.advanceWorldContacts(secondary, true);
      require(wall
        ? guard.fraction > 0 &&
            guard.fraction < 1 &&
            guard.contacts.some((row) => row.normal.x < -0.9)
        : guard.fraction ===
            1, "World guard failed separating support/new-wall distinction");
      let ticks = 0;
      const tick = () => {
        require(ticks < 3, "Exceeded three-tick fixture limit");
        sim.step();
        ticks++;
        for (const body of [car, ...sim.debris])
          require([
            body.state.position,
            body.state.orientation,
            body.state.velocity,
            body.state.angularVelocity,
          ]
            .flatMap((value) => value.toArray())
            .every(Number.isFinite), "Nonfinite physics state");
      };
      tick();
      require(sim.phil.getState(secondary) ===
        2, "Secondary lost PHIL admission");
      if (!wall) {
        require(!sim.hierarchyQuiet.get(secondary)
          .doNothing, "Secondary incorrectly slept");
        require(secondary.state.position.distanceTo(start) >
          0.03, "Secondary remained stationary");
        if (airborne)
          require(secondary.state.position.y >
            start.y + 0.09, "Airborne launch did not advance");
        require(attachments.every(
          (body) => body.joint?.parent === secondary,
        ), "Attachment ancestry changed during launch");
      }
      require(secondary.properties.inertia.distanceTo(moments) < 1e-12 &&
        secondary.properties.centerOfMass.distanceTo(com) <
          1e-12, "Partition moments/COM changed");
      require(Math.abs(car.properties.mass + secondary.properties.mass - mass) <
        1e-12, "Partition mass not conserved");
      const camera = new THREE.PerspectiveCamera(45, 1280 / 800, 0.01, 100);
      const focus = car.state.position
        .clone()
        .add(new THREE.Vector3(0, 0.15, 0));
      camera.position.copy(focus).add(new THREE.Vector3(-1.2, 0.85, 1.5));
      camera.lookAt(focus);
      document.querySelectorAll("#app > :not(#view)").forEach((element) => {
        element.hidden = true;
      });
      const caption = document.createElement("div");
      caption.id = "phy17-caption";
      caption.style.cssText =
        "position:fixed;top:18px;left:18px;z-index:10000;color:white;background:#111b;padding:12px;font:16px sans-serif";
      caption.textContent = `PHY-17 · ${label} · original Porker2 SPAM · ${ticks} physics tick`;
      document.body.append(caption);
      scene.updateMatrixWorld(true);
      c.renderer.render(scene, camera);
      const gl = c.renderer.getContext();
      const backend = gl.getExtension("WEBGL_debug_renderer_info");
      const snapshot = {
        label,
        componentsBefore: before,
        initialPosition: start.toArray(),
        inheritedVelocity: launch.toArray(),
        afterPosition: secondary.state.position.toArray(),
        afterVelocity: secondary.state.velocity.toArray(),
        worldFraction: guard.fraction,
        guardTypes: guard.contacts.map((row) => row.sourceType),
        quiet: sim.hierarchyQuiet.get(secondary).lastResult,
        philState: sim.phil.getState(secondary),
        masses: [car.properties.mass, secondary.properties.mass],
        originalMass: mass,
        moments: moments.toArray(),
        centerOfMass: com.toArray(),
        attachments: attachments.map((body) => ({
          part: body.part,
          parentPart: body.joint?.parent.part ?? null,
        })),
        glError: gl.getError(),
        renderer: backend && gl.getParameter(backend.UNMASKED_RENDERER_WEBGL),
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        drawCalls: c.renderer.info.render.calls,
      };
      require(snapshot.glError === 0, `WebGL error ${snapshot.glError}`);
      window.__phy17Fixture = {
        sim,
        car,
        secondary,
        scene,
        camera,
        geometry,
        material,
        loaded,
        caption,
        tick,
        getTicks: () => ticks,
        mass,
      };
      window.__phy17Snapshot = snapshot;
      return snapshot;
    }, options);
    await page.screenshot({
      path: `artifacts/browser-phy17-${options.label}-split.png`,
    });
    result.repair = await page.evaluate(() => {
      const f = window.__phy17Fixture,
        c = window.carma;
      f.sim.repair(f.car);
      f.tick();
      const result = {
        snapped: f.car.damage.snapped,
        debris: f.sim.debris.filter((body) => body.owner === f.car).length,
        mass: f.car.properties.mass,
        secondaryPhil: f.sim.phil.getState(f.secondary),
        quietReleased: f.sim.hierarchyQuiet.get(f.secondary) === null,
        ticks: f.getTicks(),
      };
      if (
        result.snapped ||
        result.debris ||
        result.mass !== f.mass ||
        result.secondaryPhil !== 0 ||
        !result.quietReleased
      )
        throw new Error(`PHY-17 full repair failed: ${JSON.stringify(result)}`);
      c.renderer.render(f.scene, f.camera);
      result.glError = c.renderer.getContext().getError();
      return result;
    });
    assert.equal(result.repair.glError, 0);
    await page.screenshot({
      path: `artifacts/browser-phy17-${options.label}-repair.png`,
    });
    report.cases.push(result);
    await page.evaluate(() => {
      const f = window.__phy17Fixture;
      f.sim.dispose();
      f.loaded.dispose();
      f.geometry.dispose();
      f.material.dispose();
      f.caption.remove();
      delete window.__phy17Fixture;
    });
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  await writeFile(
    "artifacts/browser-phy17-split.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    "PASS bounded PHY-17 original Porker2 browser fixture: grounded/airborne/new-wall, attachments, mass/moments and repair; artifacts/browser-phy17-split.json",
  );
} catch (error) {
  report.failure = String(error);
  if (page && !page.isClosed()) {
    report.failureState = await page
      .evaluate(() => window.__phy17Snapshot ?? null)
      .catch((e) => ({ captureError: String(e) }));
    await page
      .screenshot({ path: "artifacts/browser-phy17-failure.png" })
      .catch(() => {});
  }
  await writeFile(
    "artifacts/browser-phy17-split-failure.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
