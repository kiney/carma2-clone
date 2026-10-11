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
  console.log("SKIP crash-effects browser QA: Chromium or local C2 assets absent.");
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5218;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
let browser;
  const report = {
    build: "production bundle served by server/dev.mjs",
    cases: [],
    errors: [],
    failedRequests: [],
    unmet: [],
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() => {
    window.__crashEffectErrorClocks = [];
    window.__destructionTimeTrace = [];
    window.__cameraOwnShapeErrors = [];
    window.addEventListener("error", (event) => {
      const c = window.carma;
      window.__crashEffectErrorClocks.push({
        message: event.message,
        simulationElapsed: c?.simulation?.elapsed,
        simulationAccumulator: c?.simulation?.accumulator,
        gameTimeMs: c?.stats?.gameTimeMs,
        gameFrames: c?.stats?.gameFrames,
        framePeriodMs: c?.stats?.framePeriodMs,
      });
      if (/Camera own-shape clearance exceeded authored bounds/.test(event.message) && c?.player) {
        const vector = (value) => value?.toArray?.() ?? null;
        const p = c.player;
        window.__cameraOwnShapeErrors.push({
          message: event.message,
          simulationElapsed: c.simulation?.elapsed,
          simulationAccumulator: c.simulation?.accumulator,
          gameTimeMs: c.stats?.gameTimeMs,
          gameFrames: c.stats?.gameFrames,
          framePeriodMs: c.stats?.framePeriodMs,
          player: {
            name: p.group?.name,
            position: vector(p.state?.position),
            orientation: vector(p.state?.orientation),
            velocity: vector(p.state?.velocity),
            angularVelocity: vector(p.state?.angularVelocity),
            centerOfMass: vector(p.properties?.centerOfMass),
            damageCenterOfMass: vector(p.damage?.currentCenterOfMass),
            knackered: p.knackered,
            componentLevels: p.damage?.componentLevels ? [...p.damage.componentLevels] : null,
            deformationRevision: p.damage?.deformationRevision,
            hulls: (p.hulls ?? []).map((hull) => ({
              vertices: hull.vertices.map(vector),
              faces: hull.faces.map((face) => ({ normal: vector(face.normal), constant: face.constant, indices: [...face.indices] })),
            })),
          },
          renderPosition: vector(c.renderPosition),
          renderOrientation: vector(c.renderOrientation),
          camera: {
            position: vector(c.camera?.position),
            quaternion: vector(c.camera?.quaternion),
            near: c.camera?.near,
            cameraState: c.cameraState,
          },
        });
      }
    });
  });
  page.on("pageerror", (error) => report.errors.push({ message: String(error), stack: error.stack }));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    report.failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  await page.goto(`http://localhost:${port}`);
  report.build = await page.locator('script[type="module"]').getAttribute("src");
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  const catalog = await page.evaluate(() => {
    const option = (selector, re) =>
      [...document.querySelector(selector).options].find(
        (entry) => /^data\//i.test(entry.value) && re.test(`${entry.text} ${entry.value}`),
      )?.value;
    return {
      newcity: option("#track-select", /NEW.?CITY\s*1|newcity1/i),
      eagle: option("#car-select", /EAGLE\s*3|EAGLE3\.TXT/i),
      buggy: option("#car-select", /\bBUGGY\b|BUGGY\.TXT/i),
      newhawk: option("#car-select", /NEWHawk|NEWHawk\.TXT/i),
    };
  });
  for (const key of ["newcity", "eagle", "buggy", "newhawk"])
    assert.ok(catalog[key], `original catalog option unavailable: ${key}`);

  async function load(car) {
    await page.evaluate(async ({ track, car }) => {
      const c = window.carma;
      document.querySelector("#track-select").value = track;
      document.querySelector("#car-select").value = car;
      await c.loadRace();
      c.paused = true;
      document.querySelector("#panel").hidden = true;
    }, { track: catalog.newcity, car });
    await page.waitForFunction(
      () => window.carma.stats.ready && window.carma.opponentsReady,
      null,
      { timeout: 90000 },
    );
    await page.evaluate(() => {
      const c = window.carma;
      const destruction = c.simulation.destruction;
      if (!destruction || destruction.__crashEffectsInstrumented) return;
      const original = destruction.update.bind(destruction);
      Object.defineProperty(destruction, "__crashEffectsInstrumented", { value: true });
      destruction.update = function (proposedTimeMs) {
        const priorTimeMs = this.timeMs;
        if (Number.isFinite(priorTimeMs) && proposedTimeMs < priorTimeMs)
          window.__destructionTimeTrace.push({
            proposedTimeMs,
            priorTimeMs,
            gameTimeMs: c.stats.gameTimeMs,
            gameFrames: c.stats.gameFrames,
            framePeriodMs: c.stats.framePeriodMs,
            simulationElapsed: c.simulation.elapsed,
            simulationAccumulator: c.simulation.accumulator,
            stack: new Error("Destruction clock regression capture").stack,
          });
        return original(proposedTimeMs);
      };
    });
  }

  async function instrument(label) {
    return page.evaluate((label) => {
      const sim = window.carma.simulation;
      const trace = (window.__crashEffects = {
        label,
        world: [],
        car: [],
        attribution: [],
      });
      const oldWorld = sim.onWorldSparks;
      const oldCar = sim.onCarSparks;
      const oldAttribution = sim.onCrashAttribution;
      sim.onWorldSparks = (source) => {
        trace.world.push({
        car: source.car?.name,
        position: source.position?.toArray(),
        velocity: source.velocity?.toArray(),
        force: source.force?.toArray(),
          sparkiness: source.sparkiness,
        });
        oldWorld?.(source);
      };
      sim.onCarSparks = (source) => {
        trace.car.push({
          severity: source.severity,
          force: source.force?.toArray(),
          position: source.position?.toArray(),
          cars: source.cars?.map((participant) => participant.actor?.name ?? participant.group?.name ?? participant.name),
        });
        oldCar?.(source);
      };
      sim.onCrashAttribution = (a, b) => {
        trace.attribution.push([a.group.name, b.group.name]);
        oldAttribution?.(a, b);
      };
      const gl = document.querySelector("#view").getContext("webgl2");
      if (!gl) throw new Error("WebGL2 context unavailable");
      for (let i = 0; i < 32 && gl.getError() !== gl.NO_ERROR; i++) {}
      trace.gl = gl;
      return { player: window.carma.player.group.name };
    }, label);
  }

  async function driveCrash(kind, carValue, index) {
    await load(carValue);
    const readyState = await instrument(kind);
    const setup = await page.evaluate(({ kind }) => {
      const c = window.carma;
      const sim = c.simulation;
      const player = c.player;
      const rivals = sim.cars.filter((body) => body !== player && !body.human);
      const rival = rivals.sort(
        (a, b) => Math.abs(a.properties.mass - player.properties.mass) - Math.abs(b.properties.mass - player.properties.mass),
      )[0];
      if (!rival) throw new Error("No physical rival in original race");
      for (const body of sim.cars) {
        sim.setCarPhysicsActive(body, body === player || body === rival);
        body.input.throttle = body.input.steer = 0;
        body.input.brake = false;
        body.state.velocity.set(0, 0, 0);
        body.state.angularVelocity.set(0, 0, 0);
        body.crashAccelerationKey = false;
      }
      if (c.opponentFleet) {
        const update = c.opponentFleet.update.bind(c.opponentFleet);
        c.opponentFleet.update = (...args) => {
          update(...args);
          for (const body of sim.cars)
            sim.setCarPhysicsActive(body, body === player || body === rival);
          const ai = c.rivals.find((entry) => entry.body === rival);
          if (ai) {
            ai.body.state.accForce = ai.body.state.brakeForce = ai.body.state.curvature = 0;
            ai.body.input.throttle = ai.body.input.steer = ai.body.input.brake = 0;
          }
        };
      }
      const forward = new player.state.position.constructor(0, 0, -1)
        .applyQuaternion(player.state.orientation).normalize();
      const right = new player.state.position.constructor(0, 1, 0)
        .cross(forward).normalize();
      const origin = player.state.position.clone();
      // Controlled opponent placement is setup only; impact is produced by W.
      rival.state.position.copy(origin).addScaledVector(forward, 10).addScaledVector(right, 0.08);
      rival.state.heading = player.state.heading + Math.PI;
      sim.reset(rival);
      // Labeled initial-velocity fixture raises impact severity above native
      // spark gates; the contacts/outlets remain entirely production driven.
      player.state.velocity.copy(forward).multiplyScalar(14);
      rival.state.velocity.copy(forward).multiplyScalar(-3);
      rival.state.angularVelocity.set(0, 0, 0);
      const beforeSpark = c.sparks.stats;
      const beforeShrapnel = c.shrapnel.stats;
      window.__crashEffects.beforeSpark = beforeSpark.created;
      window.__crashEffects.start = sim.elapsed;
      window.__crashEffects.until = sim.elapsed + 14;
      c.paused = false;
      return {
        player: player.group.name,
        rival: rival.group.name,
        start: player.state.position.toArray(),
        beforeSpark: { ...beforeSpark },
        beforeShrapnel: { ...beforeShrapnel },
        simStart: sim.elapsed,
      };
    }, { kind });
    await page.locator("#view").click({ position: { x: 640, y: 400 } });
    await page.keyboard.down("w");
    await page.waitForFunction(
      () => {
        const c = window.carma;
        const trace = window.__crashEffects;
        const effectCreated = c.sparks.stats.created > trace.beforeSpark;
        if ((trace.attribution.length && effectCreated) || c.simulation.elapsed >= trace.start + 3 || c.simulation.elapsed >= trace.until) {
          c.paused = true;
          return true;
        }
        return false;
      },
      null,
      { timeout: 22000 },
    );
    await page.keyboard.up("w");
    const details = await page.evaluate(() => {
      const c = window.carma;
      c.paused = true;
      const trace = window.__crashEffects;
      const spark = c.sparks.snapshot();
      const shrapnel = c.shrapnel.snapshot();
      const gl = trace.gl;
      const glErrors = [];
      for (let i = 0; i < 32; i++) {
        const error = gl.getError();
        if (error === gl.NO_ERROR) break;
        glErrors.push(error);
      }
      return {
        label: trace.label,
        player: c.player.group.name,
        position: c.player.state.position.toArray(),
        elapsed: c.simulation.elapsed,
        world: trace.world,
        car: trace.car,
        attribution: trace.attribution,
        sparkStats: c.sparks.stats,
        sparkVisible: spark.records.filter((entry) => entry.visible && entry.active).slice(0, 6).map((entry) => ({ id: entry.id, life: entry.life, position: entry.position.toArray(), vertices: entry.vertices })),
        carSparkStats: c.carSparks.stats,
        shrapnelStats: c.shrapnel.stats,
        shrapnel: shrapnel.records.filter((entry) => entry.active).slice(0, 8),
        shrapnelVisible: shrapnel.records.filter((entry) => entry.visible).length,
        shrapnelGeometry: c.shrapnel.group.children.map((mesh) => ({ vertices: mesh.geometry.getAttribute("position")?.count ?? 0, material: mesh.material.name })).slice(0, 2),
        glErrors,
      };
    });
    details.setup = setup;
    details.ready = readyState;
    report.cases.push(details);
    assert.ok(details.elapsed > setup.simStart, `${kind}: simulation did not advance`);
    if (!details.attribution.length) report.unmet.push(`${kind}: W did not produce a real car impact`);
    if (!details.car.length) report.unmet.push(`${kind}: native car-spark source gate did not emit a packet`);
    if (!details.car.some((source) => source.cars?.includes(details.player) && source.position?.every(Number.isFinite) && source.force?.every(Number.isFinite))) report.unmet.push(`${kind}: no finite native car-spark packet for the human actor`);
    if (details.sparkStats.created <= setup.beforeSpark.created) report.unmet.push(`${kind}: native shared spark pool unchanged`);
    if (!details.sparkVisible.length) report.unmet.push(`${kind}: no visible active native spark vertices`);
    if (details.shrapnelStats.created <= setup.beforeShrapnel.created) report.unmet.push(`${kind}: crash produced no shrapnel outlet fragments`);
    if (!details.shrapnelVisible) report.unmet.push(`${kind}: crash shrapnel has no visible mesh`);
    if (!details.shrapnel.some((fragment) => fragment.visible && fragment.material && fragment.matrix.every(Number.isFinite))) report.unmet.push(`${kind}: no finite visible fragment with an authored material`);
    if (!details.sparkVisible.some((entry) => [...entry.position, ...entry.vertices].every(Number.isFinite))) report.unmet.push(`${kind}: visible spark positions/vertices are not finite`);
    if (!details.shrapnelGeometry.every((mesh) => mesh.vertices > 0)) report.unmet.push(`${kind}: original fragment geometry missing`);
    if (details.glErrors.length) report.unmet.push(`${kind}: WebGL errors ${details.glErrors.join(",")}`);
    if (index === 0) {
      await page.evaluate(() => {
        document.querySelector("#panel").hidden = true;
        document.querySelector("#feedback").style.display = "none";
        document.querySelector("#message").style.visibility = "hidden";
      });
      await page.keyboard.press("c");
      await page.keyboard.press("c");
      await page.evaluate(() => {
        document.querySelector("#panel").hidden = true;
        document.querySelector("#feedback").style.display = "none";
        document.querySelector("#message").style.visibility = "hidden";
      });
      await page.screenshot({ path: "artifacts/browser-crash-effects-car-impact.png" });
    }
    return details;
  }

  const quickEagleOnly = process.env.CRASH_EFFECTS_QUICK_EAGLE === "1";
  if (quickEagleOnly) {
    await driveCrash("Eagle3 vs original rival", catalog.eagle, 0);
    const afterImpactUntil = await page.evaluate(() => {
      const c = window.carma;
      c.paused = false;
      return c.simulation.elapsed + 1.5;
    });
    await page.waitForFunction((until) => window.carma.simulation.elapsed >= until, afterImpactUntil, { timeout: 12000 });
    await page.evaluate(() => { window.carma.paused = true; });
    await load(catalog.eagle);
    await page.waitForTimeout(1200);
    report.destructionTimeTrace = await page.evaluate(() => window.__destructionTimeTrace);
  } else {
    await driveCrash("Eagle3 vs original rival", catalog.eagle, 0);
    await driveCrash("Buggy vs original rival", catalog.buggy, 1);
    await driveCrash("Newhawk vs original rival", catalog.newhawk, 2);
  }

  if (!quickEagleOnly) {
  // Place the player beside an original Newcity vertical collision face. The
  // face/pose are fixture setup; W drives the real hull into the world.
  await load(catalog.eagle);
  await instrument("Eagle3 vs original Newcity wall");
  const wallSetup = await page.evaluate(() => {
    const c = window.carma;
    const sim = c.simulation;
    const player = c.player;
    const world = sim.world;
    const surfaces = [...new Set([...world.cells.values()].flat())].filter(
      (surface) => surface.enabled !== false && surface.collisionMode !== "edges" &&
        !/^[!>?]/.test(surface.material) && Math.abs(surface.normal.y) < 0.12 &&
        surface.normal.lengthSq() > 0.9,
    );
    const here = player.state.position;
    const candidates = surfaces.map((surface) => {
      const center = surface.a.clone().add(surface.b).add(surface.c).multiplyScalar(1 / 3);
      const toFace = center.clone().sub(here).setY(0);
      const distance = toFace.length();
      const normal = surface.normal.clone().setY(0).normalize();
      const facing = distance ? normal.dot(toFace.clone().normalize()) : -1;
      const area = surface.b.clone().sub(surface.a).cross(surface.c.clone().sub(surface.a)).length();
      return { surface, center, toFace, distance, normal, facing, area };
    }).filter((item) => item.distance >= 5 && item.distance <= 35 && item.facing < -0.7 && item.center.y > -1 && item.center.y < 5)
      .sort((a, b) => b.area - a.area || a.distance - b.distance);
    const best = candidates[0];
    if (!best) throw new Error(`No original Newcity wall face near Eagle start; surfaces=${surfaces.length}`);
    const normal = best.normal;
    const forward = normal.clone().negate();
    const position = best.center.clone().addScaledVector(normal, 4);
    const ground = c.collision.height(position.x, position.z, best.center.y + 8);
    if (ground === null) throw new Error("Original Newcity wall fixture has no ground support");
    position.y = ground;
    const from = new player.state.position.constructor(0, 0, -1);
    const orientation = player.state.orientation.clone().setFromUnitVectors(from, forward);
    for (const body of sim.cars) {
      sim.setCarPhysicsActive(body, body === player);
      body.input.throttle = body.input.steer = 0;
      body.input.brake = false;
      body.state.velocity.set(0, 0, 0);
      body.state.angularVelocity.set(0, 0, 0);
    }
    // The original fleet update normally reactivates opponents every frame.
    // Keep the real wall-only setup isolated for the full impact interval.
    if (c.opponentFleet) {
      const update = c.opponentFleet.update.bind(c.opponentFleet);
      c.opponentFleet.update = (...args) => {
        update(...args);
        for (const body of sim.cars) {
          sim.setCarPhysicsActive(body, body === player);
          if (body !== player) {
            body.input.throttle = body.input.steer = 0;
            body.input.brake = false;
          }
        }
      };
    }
    player.state.position.copy(position);
    player.state.orientation.copy(orientation);
    player.state.heading = Math.atan2(-forward.x, -forward.z);
    sim.reset(player);
    player.state.velocity.copy(forward).multiplyScalar(12);
    const gl = document.querySelector("#view").getContext("webgl2");
    window.__crashEffects.start = sim.elapsed;
    window.__crashEffects.until = sim.elapsed + 8;
    window.__crashEffects.beforeSpark = c.sparks.stats.created;
    c.paused = false;
    return {
      material: best.surface.material,
      faceCenter: best.center.toArray(),
      faceNormal: normal.toArray(),
      faceArea: best.area,
      position: position.toArray(),
      forward: forward.toArray(),
      distance: best.distance,
      candidateCount: candidates.length,
    };
  });
  report.wallSetup = wallSetup;
  await page.locator("#view").click({ position: { x: 640, y: 400 } });
  await page.keyboard.down("w");
  await page.waitForFunction(() => {
    const c = window.carma;
    const trace = window.__crashEffects;
    if ((trace.world.length && c.sparks.stats.created > trace.beforeSpark) || c.simulation.elapsed >= trace.until) {
      c.paused = true;
      return true;
    }
    return false;
  }, null, { timeout: 15000 });
  await page.keyboard.up("w");
  const wallResult = await page.evaluate(() => {
    const c = window.carma;
    c.paused = true;
    document.querySelector("#panel").hidden = true;
    document.querySelector("#feedback").style.display = "none";
    document.querySelector("#message").style.visibility = "hidden";
    const trace = window.__crashEffects;
    const spark = c.sparks.snapshot();
    const shrapnel = c.shrapnel.snapshot();
    const gl = document.querySelector("#view").getContext("webgl2");
    const glErrors = [];
    for (let i = 0; i < 32; i++) {
      const error = gl.getError();
      if (error === gl.NO_ERROR) break;
      glErrors.push(error);
    }
    return {
      label: trace.label,
      elapsed: c.simulation.elapsed,
      position: c.player.state.position.toArray(),
      activeCars: c.simulation.cars.filter((body) => c.simulation.isCarPhysicsActive(body)).map((body) => body.group.name),
      world: trace.world,
      car: trace.car,
      attribution: trace.attribution,
      sparkStats: c.sparks.stats,
      sparkVisible: spark.records.filter((entry) => entry.visible && entry.active).slice(0, 8).map((entry) => ({ id: entry.id, life: entry.life, position: entry.position.toArray(), vertices: entry.vertices })),
      shrapnelStats: c.shrapnel.stats,
      shrapnelVisible: shrapnel.records.filter((entry) => entry.visible).length,
      shrapnel: shrapnel.records.filter((entry) => entry.active).slice(0, 8),
      glErrors,
    };
  });
  report.wall = wallResult;
  if (wallResult.activeCars.length !== 1 || wallResult.activeCars[0] !== "EAGLE3") report.unmet.push(`original Newcity wall: active-car isolation failed: ${wallResult.activeCars.join(",")}`);
  if (wallResult.car.length) report.unmet.push(`original Newcity wall: car-to-car packets occurred in isolated wall case (${wallResult.car.length})`);
  if (!wallResult.world.some((source) => source.car === "EAGLE3" && source.position?.every(Number.isFinite) && source.velocity?.every(Number.isFinite) && source.force?.every(Number.isFinite))) report.unmet.push("original Newcity wall: no finite human world-spark packet from real W-driven face collision");
  if (!wallResult.sparkVisible.length) report.unmet.push("original Newcity wall: no visible native world sparks");
  if (!wallResult.shrapnelVisible) report.unmet.push("original Newcity wall: no visible shrapnel fragments");
  if (!wallResult.shrapnel.some((fragment) => fragment.visible && fragment.material && fragment.matrix.every(Number.isFinite))) report.unmet.push("original Newcity wall: no finite visible fragment with an authored material");
  if (!wallResult.sparkVisible.some((entry) => [...entry.position, ...entry.vertices].every(Number.isFinite))) report.unmet.push("original Newcity wall: visible spark positions/vertices are not finite");
  if (wallResult.glErrors.length) report.unmet.push(`original Newcity wall: WebGL errors ${wallResult.glErrors.join(",")}`);
  await page.evaluate(() => { document.querySelector("#panel").hidden = true; });
  await page.screenshot({ path: "artifacts/browser-crash-effects-wall-impact.png" });
  }

  report.errorClocks = await page.evaluate(() => window.__crashEffectErrorClocks);
  report.cameraOwnShapeErrors = await page.evaluate(() => window.__cameraOwnShapeErrors);
  if (!report.destructionTimeTrace)
    report.destructionTimeTrace = await page.evaluate(() => window.__destructionTimeTrace);
  await writeFile("artifacts/browser-crash-effects.json", `${JSON.stringify({ catalog, ...report }, null, 2)}\n`);
  assert.deepEqual(report.errors, [], `browser console/runtime errors: ${JSON.stringify(report.errors)}`);
  assert.deepEqual(report.failedRequests, [], `failed asset requests: ${JSON.stringify(report.failedRequests)}`);
  assert.deepEqual(report.unmet, [], `crash effects did not meet outlet/visibility checks; see artifacts/browser-crash-effects.json`);
  console.log(`PASS crash-effects browser QA: ${report.cases.length} original-car impacts; report artifacts/browser-crash-effects.json`);
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
