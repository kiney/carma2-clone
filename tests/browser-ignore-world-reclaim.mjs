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
    "SKIP ignore-world reclaim browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5458;
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
    "Original type-99 ignore-world lift with retained scenery query bounds and native reclaim intersection",
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
  assert.match(report.build, /^\/assets\//, "must exercise production bundle");
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });

  const catalog = await page.evaluate(() => {
    const c = window.carma;
    return {
      tracks: [
        c.assets.resolve("data/RACES/desert1/desert1.txt"),
        c.assets.resolve("adv_data/RACES/desert1/desert1.txt"),
      ],
      car: c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT"),
    };
  });
  assert.ok(catalog.car, "original stock EAGLE3 configuration absent");
  assert.ok(
    catalog.tracks.every(Boolean),
    "original Stock/Advanced Desert1 race absent",
  );

  for (let index = 0; index < catalog.tracks.length; index++) {
    const track = catalog.tracks[index],
      root = index === 0 ? "data" : "adv_data";
    await page.evaluate(
      async ({ track, car }) => {
        const c = window.carma;
        document.querySelector("#track-select").value = track;
        document.querySelector("#car-select").value = car;
        await c.loadRace();
        c.paused = true;
        document.querySelector("#panel").hidden = true;
      },
      { track, car: catalog.car },
    );
    await page.waitForFunction(
      () =>
        window.carma.stats.ready &&
        window.carma.opponentsReady &&
        window.carma.paused,
      null,
      { timeout: 90000 },
    );

    const result = await page.evaluate(() => {
      const c = window.carma,
        sim = c.simulation,
        ensure = (condition, message) => {
          if (!condition) throw Error(message);
        };
      // Remove unrelated awake owners so this reclaim frame has no artificial
      // missing-cache blocker. The browser fixture is not a capacity fake.
      for (const car of sim.cars) sim.setCarPhysicsActive(car, false);
      const source = sim.noncars.find((body) => {
        const name = body.actor.userData.c2ActorName ?? body.actor.name;
        return body.mechanics.index === 99 && /99!0013\.ACT$/i.test(name);
      });
      ensure(source, "original type-99 &99!0013.ACT lift is absent");
      ensure(
        source.mechanics.ignoreWorldCollisions,
        "lift lacks IGNORE_WORLD_COLLISIONS",
      );
      const scenery = sim.noncars.filter(
        (body) =>
          body !== source &&
          body.mechanics.index === 5 &&
          !body.attached &&
          !body.joint &&
          !body.mechanics.worldJoint &&
          body.mechanics.freeMass > 0,
      );
      const near =
        scenery.find(
          (body) => body.state.position.distanceTo(source.state.position) < 100,
        ) ?? scenery[0];
      const far = scenery.find(
        (body) =>
          body !== near &&
          body.state.position.distanceTo(source.state.position) > 10,
      );
      ensure(
        near && far,
        `original unjointed type-5 scenery missing: count=${scenery.length}`,
      );

      ensure(
        sim.admitNonCar(source, { wake: true }),
        "could not admit original lift",
      );
      source.motor.sleeping = true; // Deliberately stale motor flag; native ec is awake.
      ensure(
        sim.nativeNonCarQuietState(source)?.doNothing !== true &&
          sim.hierarchyQuiet.get(source)?.doNothing !== true &&
          source.properties.immovable === false,
        "lift admission did not preserve an awake native owner",
      );
      for (const target of [near, far])
        ensure(
          sim.admitNonCar(target, { wake: false }),
          `could not admit quiet ${target.actor.name}`,
        );

      // Retain the authored lift pose. Reposition only scenery targets, keeping
      // both physics and rendered actor poses coherent for candidate bounds.
      const sourcePosition = source.state.position.clone();
      near.state.position.copy(sourcePosition);
      near.actor.position.copy(sourcePosition);
      sim.syncCommittedNonCarActor(near);
      sim.invalidateWorldFaceCache(near);
      const farPosition = sourcePosition
        .clone()
        .add(new sourcePosition.constructor(100, 0, 0));
      far.state.position.copy(farPosition);
      far.actor.position.copy(farPosition);
      sim.syncCommittedNonCarActor(far);
      sim.invalidateWorldFaceCache(far);

      const contacts = sim.worldContacts(source, source.hulls);
      const cache = sim.worldFaceStates.get(source);
      ensure(
        cache && sim.worldFaceCache.valid(cache),
        "lift did not retain a valid world-face cache",
      );
      ensure(!cache.bounds.isEmpty(), "lift cache bounds are empty");
      ensure(
        cache.bounds.min.toArray().every(Number.isFinite),
        "lift cached bounds are non-finite",
      );
      ensure(
        cache.inverse.elements.every(Number.isFinite),
        "lift cached inverse is non-finite",
      );
      ensure(
        contacts.length === 0,
        "ignore-world lift emitted ordinary world contacts",
      );
      ensure(
        cache.start === cache.end,
        "ignore-world query retained physical face slots",
      );
      const worldGuard = sim.advanceWorldContacts(source);
      ensure(
        worldGuard.fraction === 1,
        `lift world guard clamped motion to ${worldGuard.fraction}`,
      );
      ensure(
        worldGuard.contacts.length === 0,
        "ignore-world lift guard emitted contacts",
      );
      ensure(
        sim.nativeNonCarQuietState(near)?.doNothing === true,
        "near prop was not quiet",
      );
      ensure(
        sim.nativeNonCarQuietState(far)?.doNothing === true,
        "far prop was not quiet",
      );

      sim.finishNonCarReclaim(1000);
      const state = {
        source: source.actor.userData.c2ActorName ?? source.actor.name,
        mechanicsIndex: source.mechanics.index,
        ignoreWorldCollisions: source.mechanics.ignoreWorldCollisions,
        motorSleeping: source.motor.sleeping,
        nativeEcAwake:
          sim.nativeNonCarQuietState(source)?.doNothing !== true &&
          sim.hierarchyQuiet.get(source)?.doNothing !== true &&
          source.properties.immovable === false,
        cacheBounds: {
          min: cache.bounds.min.toArray(),
          max: cache.bounds.max.toArray(),
        },
        inverse: cache.inverse.elements.slice(),
        cacheRange: [cache.start, cache.end],
        contacts: contacts.length,
        guardFraction: worldGuard.fraction,
        guardContacts: worldGuard.contacts.length,
        near: near.actor.userData.c2ActorName ?? near.actor.name,
        nearActive: sim.isNonCarPhysicsActive(near),
        far: far.actor.userData.c2ActorName ?? far.actor.name,
        farActive: sim.isNonCarPhysicsActive(far),
        sourceActive: sim.isNonCarPhysicsActive(source),
        census: sim.nonCarCensus(),
      };
      ensure(
        state.nearActive,
        "quiet scenery intersecting lift query was reclaimed",
      );
      ensure(
        !state.farActive,
        "quiet scenery outside lift query was not reclaimed",
      );
      ensure(state.sourceActive, "awake ignore-world lift was reclaimed");
      return state;
    });
    report.cases.push({ root, track, result });
    await page.screenshot({
      path: `artifacts/browser-ignore-world-reclaim-${root}.png`,
    });
    const gl = await page.evaluate(() => {
      const context = window.carma.renderer.getContext(),
        extension = context.getExtension("WEBGL_debug_renderer_info");
      return {
        error: context.getError(),
        renderer: extension
          ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
          : context.getParameter(context.RENDERER),
        buffer: [context.drawingBufferWidth, context.drawingBufferHeight],
      };
    });
    assert.equal(gl.error, 0);
    report.cases.at(-1).gl = gl;
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  await writeFile(
    "artifacts/browser-ignore-world-reclaim.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error);
  if (page && !page.isClosed()) {
    report.failureState = await page
      .evaluate(() => ({
        track: document.querySelector("#track-select")?.value,
        census: window.carma?.simulation?.nonCarCensus?.(),
      }))
      .catch((captureError) => ({ captureError: String(captureError) }));
    await page
      .screenshot({
        path: "artifacts/browser-ignore-world-reclaim-failure.png",
      })
      .catch(() => {});
  }
  await writeFile(
    "artifacts/browser-ignore-world-reclaim-failure.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
