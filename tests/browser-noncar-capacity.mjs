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
    "SKIP noncar capacity browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const port = 5452;
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
    "Controlled original ACT capacity saturation, retry after controlled source reclaim, then ordinary keyboard driving",
  capacitySetup:
    "One mechanics-index-20 dedicated sign plus mechanics-index-25 cones filling that type's dedicated slot and 40 global extras; quiet admission with wake=false; props kept away from the player route.",
  release:
    "Controlled diagnostic release through the production reclaim effect sequence (set-driver, return-actor, clear-actor-binding, remove-physics); this validates retryability, not natural settling.",
  backend:
    "SwiftShader correctness regression, not hardware performance evidence",
  cases: [],
  errors: [],
  failedRequests: [],
};
try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/manifest`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) throw Error(serverLog);
    await new Promise((r) => setTimeout(r, 100));
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
  page.on("pageerror", (e) => report.errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") report.errors.push(m.text());
  });
  page.on("requestfailed", (r) =>
    report.failedRequests.push(`${r.url()}: ${r.failure()?.errorText}`),
  );
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  const catalog = await page.evaluate(
    () =>
      [...document.querySelector("#track-select").options]
        .map((o) => o.value)
        .find((v) => /^data\/.*\/newcity1\/newcity1\.txt$/i.test(v)) && {
        track: [...document.querySelector("#track-select").options]
          .map((o) => o.value)
          .find((v) => /^data\/.*\/newcity1\/newcity1\.txt$/i.test(v)),
        car: window.carma.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT"),
      },
  );
  assert.ok(
    catalog?.track && catalog.car,
    "original Stock Newcity1 or Eagle3 configuration absent",
  );
  for (const root of ["data", "adv_data"]) {
    const track = catalog.track.replace(/^data\//i, `${root}/`);
    await page.evaluate(
      async ({ track, car }) => {
        const c = window.carma;
        document.querySelector("#track-select").value = c.assets.resolve(track);
        document.querySelector("#car-select").value = car;
        await c.loadRace();
        c.paused = true;
        document.querySelector("#panel").hidden = true;
      },
      { track, car: catalog.car },
    );
    await page.waitForFunction(
      () => window.carma.opponentsReady && window.carma.paused,
      null,
      { timeout: 90000 },
    );
    const setup = await page.evaluate(() => {
      const c = window.carma,
        sim = c.simulation,
        player = c.player;
      const ensure = (ok, msg) => {
        if (!ok) throw Error(msg);
      };
      for (const car of sim.cars) {
        if (car !== player && typeof sim.deactivateCar === "function")
          sim.deactivateCar(car);
        else sim.setCarPhysicsActive(car, car === player);
        car.input.throttle = car.input.steer = 0;
        car.input.brake = false;
        car.state.velocity.set(0, 0, 0);
        car.state.angularVelocity.set(0, 0, 0);
      }
      const props = sim.noncars.filter(
        (b) =>
          !sim.isNonCarPhysicsActive(b) &&
          !b.attached &&
          !b.joint &&
          !b.mechanics.worldJoint &&
          !b.mechanics.infiniteInertia &&
          b.mechanics.freeMass > 0,
      );
      const target = props.find(
        (b) =>
          b.mechanics.index === 20 &&
          (b.actor.userData.c2ActorName === "&20s0078.ACT" ||
            /&20s0078\.ACT$/i.test(b.actor.name)),
      );
      const signs = props.filter(
        (b) =>
          b.mechanics.index === 20 &&
          b !== target &&
          b.state.position.distanceTo(target.state.position) > 10,
      );
      const cones = props.filter(
        (b) =>
          b.mechanics.index === 25 &&
          b.state.position.distanceTo(target.state.position) > 10,
      );
      ensure(
        target && signs.length >= 1 && cones.length >= 41,
        `required original ACT capacity fixture missing: target=${!!target}, signs=${signs.length}, cones=${cones.length}`,
      );
      const targetNative = sim.world.getNonCarNativeActor(target.actor);
      ensure(targetNative, "target has no original native actor binding");
      // Keep original poses and select distant actors so capacity setup cannot
      // interfere with the approach or trigger off-map containment.
      const V = player.state.position.constructor;
      const sign = signs[0];
      const candidates = cones.slice(0, 41);
      ensure(
        sim.admitNonCar(sign, {
          wake: false,
        }),
        "could not occupy mechanics-index-20 dedicated slot",
      );
      const admitted = [sign];
      let extraCount = 0,
        dedicatedCount = 0;
      for (const body of candidates) {
        if (!sim.admitNonCar(body, { wake: false })) continue;
        admitted.push(body);
        const slot = sim.nonCarSlots.get(body);
        if (slot?.kind === "extra") extraCount++;
        if (slot?.kind === "dedicated") dedicatedCount++;
        if (extraCount === 40) break;
      }
      ensure(
        extraCount === 40 && dedicatedCount >= 1,
        `failed to saturate target type plus global extras: ${JSON.stringify({ extraCount, dedicatedCount, census: sim.nonCarCensus() })}`,
      );
      const before = sim.nonCarCensus();
      const targetName = target.actor.name;
      const targetBefore = {
        name: targetName,
        pulled: !!target.actor.userData.noncarPulled,
        header: !!sim.phil.getHeader(target),
        slot: sim.nonCarSlots.get(target),
        nativeName: targetNative.name,
      };
      // Index 25 exhausted its own slot and the global extras; index 20 keeps
      // the exact failing ACT identifiable while its dedicated slot stays occupied.
      const retryTarget = target;
      const failedAdmission = sim.admitNonCar(retryTarget, { wake: false });
      const failureState = {
        admission: failedAdmission,
        actorName: retryTarget.actor.name,
        expectedActorName: targetName,
        nativeName: targetNative?.name,
        pulled: !!retryTarget.actor.userData.noncarPulled,
        header: !!sim.phil.getHeader(retryTarget),
        slot: sim.nonCarSlots.get(retryTarget) ?? null,
        staticCoverage: (() => {
          const bounds = sim.world.getNonCarModelBounds(retryTarget.actor);
          if (!bounds) return 0;
          retryTarget.actor.updateWorldMatrix(true, true);
          const worldBounds = bounds
            .clone()
            .applyMatrix4(retryTarget.actor.matrixWorld);
          return sim.world
            .querySurfaces(worldBounds.min, worldBounds.max)
            .filter((surface) => {
              if (surface.owner || surface.enabled === false) return false;
              for (let actor = surface.actor; actor; actor = actor.parent)
                if (actor === retryTarget.actor) return true;
              return false;
            }).length;
        })(),
        census: sim.nonCarCensus(),
      };
      ensure(
        !failedAdmission &&
          failureState.actorName === targetName &&
          failureState.nativeName === targetBefore.nativeName &&
          !failureState.pulled &&
          !failureState.header &&
          !failureState.slot &&
          failureState.staticCoverage > 0,
        `capacity failure mutated/rejected retained static ACT incorrectly: ${JSON.stringify(failureState)}`,
      );
      // Invoke precisely the normal reclaim-effect mutations for one admitted
      // extra body, releasing its PHIL header and physical slot for a real retry.
      const release = admitted.find(
        (b) => sim.nonCarSlots.get(b)?.kind === "extra",
      );
      ensure(
        release,
        "no occupied global extra available for controlled release",
      );
      const apply = (effect) => sim.applyNonCarReclaimEffect(effect);
      apply({ kind: "set-driver", owner: release, value: 0 });
      apply({
        kind: "return-actor",
        owner: release,
        position: release.state.position.clone(),
        carId: sim.noncarReturnIds.get(release) ?? 0xffff,
        destination: "track-column",
      });
      apply({ kind: "clear-actor-binding", owner: release });
      apply({ kind: "remove-physics", owner: release });
      ensure(
        !sim.isNonCarPhysicsActive(retryTarget) &&
          retryTarget.actor.name === targetName,
        "releasing capacity must not manufacture a target activation",
      );
      // Clear the remaining synthetic capacity occupants via the same controlled
      // reclaim path so ordinary driving has no distant active bodies.
      for (const body of admitted.filter((b) => b !== release)) {
        if (!sim.isNonCarPhysicsActive(body)) continue;
        apply({ kind: "set-driver", owner: body, value: 0 });
        apply({
          kind: "return-actor",
          owner: body,
          position: body.state.position.clone(),
          carId: sim.noncarReturnIds.get(body) ?? 0xffff,
          destination: "track-column",
        });
        apply({ kind: "clear-actor-binding", owner: body });
        apply({ kind: "remove-physics", owner: body });
      }
      const targetPosition = new V(45.278461, -0.823819, 52);
      player.state.position.copy(targetPosition);
      player.state.heading = 0;
      player.state.velocity.set(0, 0, -3);
      player.state.angularVelocity.set(0, 0, 0);
      sim.reset(player);
      c.paused = false;
      document.querySelector("#view").focus();
      window.__capacity = {
        sign,
        retryTarget,
        targetName,
        start: retryTarget.state.position.clone().toArray(),
        startOrientation: retryTarget.state.orientation.clone(),
        before,
        failureState,
        releaseName: release.actor.name,
        targetNativeName: targetNative?.name,
        targetBefore,
      };
      return {
        before,
        failureState,
        targetName,
        releaseName: release.actor.name,
        activeBeforeDriving: sim.isNonCarPhysicsActive(retryTarget),
        start: window.__capacity.start,
      };
    });
    await page.keyboard.down("w");
    try {
      await page.waitForFunction(
        () => {
          const x = window.__capacity,
            sim = window.carma.simulation;
          const p = x.retryTarget.state.position.toArray();
          return (
            sim.isNonCarPhysicsActive(x.retryTarget) &&
            Math.hypot(
              p[0] - x.start[0],
              p[1] - x.start[1],
              p[2] - x.start[2],
            ) > 0.2 &&
            x.retryTarget.state.orientation.angleTo(x.startOrientation) > 0.25
          );
        },
        null,
        { timeout: 6000 },
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
        x = window.__capacity,
        gl = c.renderer.getContext(),
        ext = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        target: x.retryTarget.actor.name,
        targetNativeName: c.simulation.world.getNonCarNativeActor(
          x.retryTarget.actor,
        )?.name,
        targetPulled: !!x.retryTarget.actor.userData.noncarPulled,
        targetPosition: x.retryTarget.state.position.toArray(),
        targetRotationRadians: x.retryTarget.state.orientation.angleTo(
          x.startOrientation,
        ),
        targetVelocity: x.retryTarget.state.velocity.toArray(),
        targetOmega: x.retryTarget.state.angularVelocity.toArray(),
        player: c.player.state.position.toArray(),
        targetActive: c.simulation.isNonCarPhysicsActive(x.retryTarget),
        targetHeader: c.simulation.phil.getHeader(x.retryTarget)?.index ?? null,
        targetSlot: c.simulation.nonCarSlots.get(x.retryTarget),
        census: c.simulation.nonCarCensus(),
        glError: gl.getError(),
        renderer: ext
          ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
        buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      };
    });
    assert.equal(after.target, setup.targetName);
    assert.ok(
      after.targetRotationRadians > 0.25,
      "the impact must tip the sign, not only slide it",
    );
    assert.ok(
      after.targetActive &&
        after.targetPulled &&
        after.targetHeader !== null &&
        after.targetSlot,
      "retried original ACT did not remain physically admitted",
    );
    report.cases.push({
      root,
      setup,
      after,
      label:
        "controlled capacity/release followed by contact-driven ordinary admission",
    });
    await page.screenshot({
      path: `artifacts/browser-noncar-capacity-${root}.png`,
    });
    assert.equal(after.glError, 0);
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  await writeFile(
    "artifacts/browser-noncar-capacity.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error);
  if (page && !page.isClosed()) {
    report.failureState = await page
      .evaluate(() => ({
        capacity: window.__capacity && {
          target: window.__capacity.retryTarget?.actor?.name,
          census: window.carma?.simulation?.nonCarCensus?.(),
        },
        census: window.carma?.simulation?.nonCarCensus?.(),
      }))
      .catch((e) => ({ captureError: String(e) }));
    await page
      .screenshot({ path: "artifacts/browser-noncar-capacity-failure.png" })
      .catch(() => {});
  }
  await writeFile(
    "artifacts/browser-noncar-capacity-failure.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
