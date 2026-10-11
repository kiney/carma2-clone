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
    "SKIP crash-effects browser QA: Chromium or local C2 assets absent.",
  );
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
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
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
      if (
        /Camera own-shape clearance (?:exceeded authored bounds|ray has no finite exit)/.test(
          event.message,
        ) &&
        c?.player
      ) {
        const vector = (value) => value?.toArray?.() ?? null;
        const p = c.player;
        const renderPosition = p.group?.position?.clone?.();
        const renderOrientation = p.group?.quaternion?.clone?.();
        const centerOfMass = p.properties?.centerOfMass?.clone?.();
        const worldCOM =
          renderPosition && renderOrientation && centerOfMass
            ? centerOfMass
                .applyQuaternion(renderOrientation)
                .add(renderPosition)
            : null;
        const cameraPosition = c.camera?.position?.clone?.();
        const cameraClearanceRayEstimate =
          cameraPosition && worldCOM && renderPosition && renderOrientation
            ? (() => {
                const clearance = (c.camera?.near ?? 0) * 3;
                const outward = cameraPosition.clone().sub(worldCOM);
                if (!outward.lengthSq() || !(clearance > 0))
                  return { clearance, valid: false };
                outward.normalize().multiplyScalar(clearance);
                const inverse = renderOrientation.clone().invert();
                const from = cameraPosition
                  .clone()
                  .sub(renderPosition)
                  .applyQuaternion(inverse);
                const direction = outward
                  .clone()
                  .divideScalar(clearance)
                  .applyQuaternion(inverse);
                const faces = p.hulls?.[0]?.faces ?? [];
                const slopes = faces.map((face, index) => ({
                  index,
                  normal: vector(face.normal),
                  constant: face.constant,
                  offset: face.constant - face.normal.dot(from),
                  slope: face.normal.dot(direction),
                }));
                return {
                  valid: true,
                  pointWorld: vector(cameraPosition),
                  worldCOM: vector(worldCOM),
                  localFromPoint: vector(from),
                  localOutwardDirection: vector(direction),
                  clearance,
                  firstHullFaceCount: faces.length,
                  positiveExitFaces: slopes.filter((face) => face.slope > 0),
                  slopes,
                };
              })()
            : null;
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
            componentLevels: p.damage?.componentLevels
              ? [...p.damage.componentLevels]
              : null,
            deformationRevision: p.damage?.deformationRevision,
            hulls: (p.hulls ?? []).map((hull) => ({
              vertices: hull.vertices.map(vector),
              faces: hull.faces.map((face) => ({
                normal: vector(face.normal),
                constant: face.constant,
                indices: [...face.indices],
              })),
            })),
          },
          renderPosition: vector(c.renderPosition),
          renderOrientation: vector(c.renderOrientation),
          cameraClearanceRayEstimate,
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
  page.on("pageerror", (error) =>
    report.errors.push({ message: String(error), stack: error.stack }),
  );
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
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  const catalog = await page.evaluate(() => {
    const option = (selector, re) =>
      [...document.querySelector(selector).options].find(
        (entry) =>
          /^data\//i.test(entry.value) &&
          re.test(`${entry.text} ${entry.value}`),
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
    await page.evaluate(
      async ({ track, car }) => {
        const c = window.carma;
        document.querySelector("#track-select").value = track;
        document.querySelector("#car-select").value = car;
        await c.loadRace();
        c.paused = true;
        document.querySelector("#panel").hidden = true;
      },
      { track: catalog.newcity, car },
    );
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
      Object.defineProperty(destruction, "__crashEffectsInstrumented", {
        value: true,
      });
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
          cars: source.cars?.map(
            (participant) =>
              participant.actor?.name ??
              participant.group?.name ??
              participant.name,
          ),
          participants: source.cars?.map((participant) => ({
            actor:
              participant.actor?.name ??
              participant.group?.name ??
              participant.name,
            actorId: participant.actor?.uuid,
            driver: participant.driver,
            sparky: !!participant.sparky,
          })),
        });
        oldCar?.(source);
        if (
          trace.pauseOnProp &&
          source.cars?.some(
            (participant) =>
              participant.actor?.uuid === trace.propId &&
              participant.driver === 4,
          )
        ) {
          trace.pauseOnProp = false;
          requestAnimationFrame(() => {
            window.carma.paused = true;
          });
        }
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

  async function instrumentSmoke(label) {
    return page.evaluate((label) => {
      const system = window.carma.smoke;
      const originalColumn = system.spawnColumn.bind(system);
      const originalPuff = system.spawnPuff.bind(system);
      const trace = (window.__smokeTrace = {
        label,
        columns: [],
        puffs: [],
        tyreAxles: [],
      });
      const sim = window.carma.simulation;
      const originalAxle = sim.onTyreAxle;
      sim.onTyreAxle = (body, input) => {
        if (body.human)
          trace.tyreAxles.push({
            actor: body.group?.name,
            axle: input.axle,
            demand: input.demand,
            capacities: input.capacities ? [...input.capacities] : null,
            reduction: input.reduction,
            modifiers: input.modifiers?.map((modifier) => ({
              smokeType: modifier?.smokeType,
              tyreSound: modifier?.tyreSound,
            })),
          });
        return originalAxle?.(body, input);
      };
      system.spawnColumn = (source) => {
        const item = {
          mode: source.mode,
          actor: source.actor?.name,
          car: source.car?.name,
          actorId: source.actor?.uuid,
          vertex: source.vertex,
          colour: source.colour,
          lifetimeMs: source.lifetimeMs,
          rigidVelocity: source.rigid?.velocity?.toArray?.(),
          rigidOmega: source.rigid?.omega?.toArray?.(),
          hasSampleVertex: typeof source.sampleVertex === "function",
        };
        const index = originalColumn(source);
        trace.columns.push({ ...item, index });
        return index;
      };
      system.spawnPuff = (source) => {
        const item = {
          type: source.type,
          position: source.position?.toArray?.(),
          velocity: source.velocity?.toArray?.(),
          strength: source.strength,
          decay: source.decay,
          timeSyncMs: source.timeSyncMs,
        };
        const index = originalPuff(source);
        trace.puffs.push({ ...item, index });
        return index;
      };
      return {
        player: window.carma.player.group.name,
        initialStats: { ...system.stats },
      };
    }, label);
  }

  async function driveCrash(kind, carValue, index) {
    await load(carValue);
    const readyState = await instrument(kind);
    const setup = await page.evaluate(
      ({ kind }) => {
        const c = window.carma;
        const sim = c.simulation;
        const player = c.player;
        const rivals = sim.cars.filter(
          (body) => body !== player && !body.human,
        );
        const rival = rivals.sort(
          (a, b) =>
            Math.abs(a.properties.mass - player.properties.mass) -
            Math.abs(b.properties.mass - player.properties.mass),
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
              ai.body.state.accForce =
                ai.body.state.brakeForce =
                ai.body.state.curvature =
                  0;
              ai.body.input.throttle =
                ai.body.input.steer =
                ai.body.input.brake =
                  0;
            }
          };
        }
        const forward = new player.state.position.constructor(0, 0, -1)
          .applyQuaternion(player.state.orientation)
          .normalize();
        const right = new player.state.position.constructor(0, 1, 0)
          .cross(forward)
          .normalize();
        const origin = player.state.position.clone();
        // Controlled opponent placement is setup only; impact is produced by W.
        rival.state.position
          .copy(origin)
          .addScaledVector(forward, 10)
          .addScaledVector(right, 0.08);
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
      },
      { kind },
    );
    await page.locator("#view").click({ position: { x: 640, y: 400 } });
    await page.keyboard.down("w");
    await page.waitForFunction(
      () => {
        const c = window.carma;
        const trace = window.__crashEffects;
        const effectCreated = c.sparks.stats.created > trace.beforeSpark;
        if (
          (trace.attribution.length && effectCreated) ||
          c.simulation.elapsed >= trace.start + 3 ||
          c.simulation.elapsed >= trace.until
        ) {
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
        sparkVisible: spark.records
          .filter((entry) => entry.visible && entry.active)
          .slice(0, 6)
          .map((entry) => ({
            id: entry.id,
            life: entry.life,
            position: entry.position.toArray(),
            vertices: entry.vertices,
          })),
        carSparkStats: c.carSparks.stats,
        shrapnelStats: c.shrapnel.stats,
        shrapnel: shrapnel.records.filter((entry) => entry.active).slice(0, 8),
        shrapnelVisible: shrapnel.records.filter((entry) => entry.visible)
          .length,
        shrapnelGeometry: c.shrapnel.group.children
          .map((mesh) => ({
            vertices: mesh.geometry.getAttribute("position")?.count ?? 0,
            material: mesh.material.name,
          }))
          .slice(0, 2),
        glErrors,
      };
    });
    details.setup = setup;
    details.ready = readyState;
    report.cases.push(details);
    assert.ok(
      details.elapsed > setup.simStart,
      `${kind}: simulation did not advance`,
    );
    if (!details.attribution.length)
      report.unmet.push(`${kind}: W did not produce a real car impact`);
    if (!details.car.length)
      report.unmet.push(
        `${kind}: native car-spark source gate did not emit a packet`,
      );
    if (
      !details.car.some(
        (source) =>
          source.cars?.includes(details.player) &&
          source.position?.every(Number.isFinite) &&
          source.force?.every(Number.isFinite),
      )
    )
      report.unmet.push(
        `${kind}: no finite native car-spark packet for the human actor`,
      );
    if (details.sparkStats.created <= setup.beforeSpark.created)
      report.unmet.push(`${kind}: native shared spark pool unchanged`);
    if (!details.sparkVisible.length)
      report.unmet.push(`${kind}: no visible active native spark vertices`);
    if (details.shrapnelStats.created <= setup.beforeShrapnel.created)
      report.unmet.push(`${kind}: crash produced no shrapnel outlet fragments`);
    if (!details.shrapnelVisible)
      report.unmet.push(`${kind}: crash shrapnel has no visible mesh`);
    if (
      !details.shrapnel.some(
        (fragment) =>
          fragment.visible &&
          fragment.material &&
          fragment.matrix.every(Number.isFinite),
      )
    )
      report.unmet.push(
        `${kind}: no finite visible fragment with an authored material`,
      );
    if (
      !details.sparkVisible.some((entry) =>
        [...entry.position, ...entry.vertices].every(Number.isFinite),
      )
    )
      report.unmet.push(
        `${kind}: visible spark positions/vertices are not finite`,
      );
    if (!details.shrapnelGeometry.every((mesh) => mesh.vertices > 0))
      report.unmet.push(`${kind}: original fragment geometry missing`);
    if (details.glErrors.length)
      report.unmet.push(`${kind}: WebGL errors ${details.glErrors.join(",")}`);
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
      await page.screenshot({
        path: "artifacts/browser-crash-effects-car-impact.png",
      });
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
    await page.waitForFunction(
      (until) => window.carma.simulation.elapsed >= until,
      afterImpactUntil,
      { timeout: 12000 },
    );
    await page.evaluate(() => {
      window.carma.paused = true;
    });
    await load(catalog.eagle);
    await page.waitForTimeout(1200);
    report.destructionTimeTrace = await page.evaluate(
      () => window.__destructionTimeTrace,
    );
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
    report.wallSmokeInstrument = await instrumentSmoke(
      "Eagle3 real wall waste smoke",
    );
    const wallSetup = await page.evaluate(() => {
      const c = window.carma;
      const sim = c.simulation;
      const player = c.player;
      const world = sim.world;
      const surfaces = [...new Set([...world.cells.values()].flat())].filter(
        (surface) =>
          surface.enabled !== false &&
          surface.collisionMode !== "edges" &&
          !/^[!>?]/.test(surface.material) &&
          Math.abs(surface.normal.y) < 0.12 &&
          surface.normal.lengthSq() > 0.9,
      );
      const here = player.state.position;
      const candidates = surfaces
        .map((surface) => {
          const center = surface.a
            .clone()
            .add(surface.b)
            .add(surface.c)
            .multiplyScalar(1 / 3);
          const toFace = center.clone().sub(here).setY(0);
          const distance = toFace.length();
          const normal = surface.normal.clone().setY(0).normalize();
          const facing = distance ? normal.dot(toFace.clone().normalize()) : -1;
          const area = surface.b
            .clone()
            .sub(surface.a)
            .cross(surface.c.clone().sub(surface.a))
            .length();
          return { surface, center, toFace, distance, normal, facing, area };
        })
        .filter(
          (item) =>
            item.distance >= 5 &&
            item.distance <= 35 &&
            item.facing < -0.7 &&
            item.center.y > -1 &&
            item.center.y < 5,
        )
        .sort((a, b) => b.area - a.area || a.distance - b.distance);
      const best = candidates[0];
      if (!best)
        throw new Error(
          `No original Newcity wall face near Eagle start; surfaces=${surfaces.length}`,
        );
      const normal = best.normal;
      const forward = normal.clone().negate();
      const position = best.center.clone().addScaledVector(normal, 4);
      const ground = c.collision.height(
        position.x,
        position.z,
        best.center.y + 8,
      );
      if (ground === null)
        throw new Error("Original Newcity wall fixture has no ground support");
      position.y = ground;
      const from = new player.state.position.constructor(0, 0, -1);
      const orientation = player.state.orientation
        .clone()
        .setFromUnitVectors(from, forward);
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
      player.state.velocity.copy(forward).multiplyScalar(16);
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
    await page.waitForFunction(
      () => {
        const c = window.carma;
        const trace = window.__crashEffects;
        if (
          (trace.world.length && c.sparks.stats.created > trace.beforeSpark) ||
          c.simulation.elapsed >= trace.until
        ) {
          c.paused = true;
          return true;
        }
        return false;
      },
      null,
      { timeout: 15000 },
    );
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
        activeCars: c.simulation.cars
          .filter((body) => c.simulation.isCarPhysicsActive(body))
          .map((body) => body.group.name),
        world: trace.world,
        car: trace.car,
        attribution: trace.attribution,
        sparkStats: c.sparks.stats,
        sparkVisible: spark.records
          .filter((entry) => entry.visible && entry.active)
          .slice(0, 8)
          .map((entry) => ({
            id: entry.id,
            life: entry.life,
            position: entry.position.toArray(),
            vertices: entry.vertices,
          })),
        shrapnelStats: c.shrapnel.stats,
        shrapnelVisible: shrapnel.records.filter((entry) => entry.visible)
          .length,
        shrapnel: shrapnel.records.filter((entry) => entry.active).slice(0, 8),
        glErrors,
      };
    });
    report.wall = wallResult;
    if (
      wallResult.activeCars.length !== 1 ||
      wallResult.activeCars[0] !== "EAGLE3"
    )
      report.unmet.push(
        `original Newcity wall: active-car isolation failed: ${wallResult.activeCars.join(",")}`,
      );
    if (wallResult.car.length)
      report.unmet.push(
        `original Newcity wall: car-to-car packets occurred in isolated wall case (${wallResult.car.length})`,
      );
    if (
      !wallResult.world.some(
        (source) =>
          source.car === "EAGLE3" &&
          source.position?.every(Number.isFinite) &&
          source.velocity?.every(Number.isFinite) &&
          source.force?.every(Number.isFinite),
      )
    )
      report.unmet.push(
        "original Newcity wall: no finite human world-spark packet from real W-driven face collision",
      );
    if (!wallResult.sparkVisible.length)
      report.unmet.push(
        "original Newcity wall: no visible native world sparks",
      );
    if (!wallResult.shrapnelVisible)
      report.unmet.push("original Newcity wall: no visible shrapnel fragments");
    if (
      !wallResult.shrapnel.some(
        (fragment) =>
          fragment.visible &&
          fragment.material &&
          fragment.matrix.every(Number.isFinite),
      )
    )
      report.unmet.push(
        "original Newcity wall: no finite visible fragment with an authored material",
      );
    if (
      !wallResult.sparkVisible.some((entry) =>
        [...entry.position, ...entry.vertices].every(Number.isFinite),
      )
    )
      report.unmet.push(
        "original Newcity wall: visible spark positions/vertices are not finite",
      );
    if (wallResult.glErrors.length)
      report.unmet.push(
        `original Newcity wall: WebGL errors ${wallResult.glErrors.join(",")}`,
      );
    await page.evaluate(() => {
      document.querySelector("#panel").hidden = true;
    });
    await page.screenshot({
      path: "artifacts/browser-crash-effects-wall-impact.png",
    });
    // Let native wasted feedback and its long-lived source column run after the
    // short explosion. Keep the incoming lifetime and all native gates intact.
    const wallSmokeWait = await page.evaluate(() => {
      const c = window.carma;
      c.paused = false;
      return { until: c.simulation.elapsed + 3, started: c.simulation.elapsed };
    });
    await page.waitForFunction(
      (until) => {
        const t = window.__smokeTrace;
        return (
          t.columns.some((item) => item.mode === 1) ||
          window.carma.simulation.elapsed >= until
        );
      },
      wallSmokeWait.until,
      { timeout: 12000 },
    );
    const columnTime = await page.evaluate(
      () => window.carma.simulation.elapsed,
    );
    await page.waitForFunction(
      (until) => window.carma.simulation.elapsed >= until,
      columnTime + 1.2,
      { timeout: 9000 },
    );
    const wreckSmoke = await page.evaluate(() => {
      const c = window.carma;
      c.paused = true;
      document.querySelector("#panel").hidden = true;
      document.querySelector("#feedback").style.display = "none";
      document.querySelector("#message").style.visibility = "hidden";
      const gl = document.querySelector("#view").getContext("webgl2");
      const glErrors = [];
      for (let i = 0; i < 32; i++) {
        const error = gl.getError();
        if (error === gl.NO_ERROR) break;
        glErrors.push(error);
      }
      return {
        elapsed: c.simulation.elapsed,
        knackered: c.player.knackered,
        events: window.__smokeTrace,
        stats: c.smoke.stats,
        snapshot: c.smoke.snapshot(),
        glErrors,
      };
    });
    report.wreckSmoke = wreckSmoke;
    if (
      !wreckSmoke.events.columns.some(
        (item) =>
          item.mode === 1 &&
          item.actor === "EAGLE3" &&
          item.lifetimeMs === 180000 &&
          item.hasSampleVertex,
      )
    )
      report.unmet.push(
        "real Newcity wall collision: no native 180000ms mode1 wreck column from onWasted",
      );
    if (
      !wreckSmoke.snapshot.columns.some(
        (column) =>
          column.active && column.flames.some((flame) => flame.visible),
      )
    )
      report.unmet.push(
        "real Newcity wall collision: no active visible wreck flame after explosion interval",
      );
    if (wreckSmoke.glErrors.length)
      report.unmet.push(
        `wreck smoke: WebGL errors ${wreckSmoke.glErrors.join(",")}`,
      );
    await page.screenshot({
      path: "artifacts/browser-crash-effects-wreck-smoke.png",
    });
    const repairSetup = await page.evaluate(() => {
      const c = window.carma;
      const trace = window.__smokeTrace;
      const before = c.smoke.snapshot();
      const playerColumnIds = trace.columns
        .filter(
          (column) =>
            column.mode === 1 && column.actorId === c.player.group.uuid,
        )
        .map((column) => column.index)
        .filter((index) => index !== null && before.columns[index]?.active);
      const otherColumnIds = trace.columns
        .filter((column) => column.actorId !== c.player.group.uuid)
        .map((column) => column.index)
        .filter((index) => index !== null && before.columns[index]?.active);
      c.simulation.repair(c.player);
      const immediatelyAfterRepair = c.smoke.snapshot();
      const until = c.simulation.elapsed + 0.12;
      c.paused = false;
      return {
        player: c.player.group.name,
        playerColumnIds,
        otherColumnIds,
        before: c.smoke.stats,
        immediate: playerColumnIds.map((index) => ({
          index,
          ...immediatelyAfterRepair.columns[index],
        })),
        until,
      };
    });
    await page.waitForFunction(
      (until) => window.carma.simulation.elapsed >= until,
      repairSetup.until,
      { timeout: 9000 },
    );
    const repairResult = await page.evaluate(
      ({ playerColumnIds, otherColumnIds }) => {
        const c = window.carma;
        c.paused = true;
        const columns = c.smoke.snapshot().columns;
        return {
          elapsed: c.simulation.elapsed,
          knackered: c.player.knackered,
          stats: c.smoke.stats,
          playerColumns: playerColumnIds.map((index) => ({
            index,
            ...columns[index],
          })),
          otherColumns: otherColumnIds.map((index) => ({
            index,
            ...columns[index],
          })),
          allActive: columns.map((column, index) => ({
            index,
            active: column.active,
            remaining: column.remaining,
          })),
        };
      },
      {
        playerColumnIds: repairSetup.playerColumnIds,
        otherColumnIds: repairSetup.otherColumnIds,
      },
    );
    report.wreckSmokeRepair = { setup: repairSetup, result: repairResult };
    if (!repairSetup.playerColumnIds.length)
      report.unmet.push(
        "WASTED repair lifecycle: no active Eagle mode1 source column before full repair",
      );
    if (
      repairSetup.immediate.some(
        (column) => !column.active || column.remaining !== 0,
      )
    )
      report.unmet.push(
        "WASTED repair lifecycle: full repair did not schedule Eagle columns for next-period retirement",
      );
    if (repairResult.playerColumns.some((column) => column.active))
      report.unmet.push(
        "WASTED repair lifecycle: Eagle wreck column remained active after a positive period",
      );
    if (
      repairSetup.otherColumnIds.length &&
      repairResult.otherColumns.some((column) => !column.active)
    )
      report.unmet.push(
        "WASTED repair lifecycle: unrelated active car column was retired by Eagle repair",
      );
    report.originalNoncarsNearStart = await page.evaluate(() => {
      const c = window.carma;
      return c.simulation.noncars
        .filter((body) => body.actor.visible)
        .map((body) => ({
          name: body.actor.name,
          actorId: body.actor.uuid,
          distance: body.state.position.distanceTo(c.player.state.position),
          position: body.state.position.toArray(),
          sparky: body.mechanics.sparky,
          attached: body.attached,
          shapeCount: body.hulls.length,
          materialProviderCount: body.mechanics.shrapnelMaterials.length,
        }))
        .filter((body) => body.distance < 45)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 12);
    });

    await load(catalog.eagle);
    await instrument("Eagle3 vs original loaded noncar");
    const propSetup = await page.evaluate(() => {
      const c = window.carma;
      const sim = c.simulation;
      const player = c.player;
      const origin = player.state.position;
      const candidates = sim.noncars
        .filter(
          (body) =>
            body.actor.visible &&
            body.hulls.length &&
            body.mechanics.shapes.length,
        )
        .map((body) => {
          const toward = body.state.position.clone().sub(origin).setY(0);
          return { body, toward, distance: toward.length() };
        })
        .filter((entry) => entry.distance >= 5 && entry.distance <= 45)
        .sort((a, b) => a.distance - b.distance);
      let target;
      for (const candidate of candidates) {
        const forward = candidate.toward.clone().normalize();
        const position = candidate.body.state.position
          .clone()
          .addScaledVector(forward, -8);
        const ground = c.collision.height(
          position.x,
          position.z,
          candidate.body.state.position.y + 8,
        );
        if (ground === null || Math.abs(ground - origin.y) > 1.25) continue;
        position.y = ground;
        target = { ...candidate, forward, position };
        break;
      }
      if (!target)
        return {
          attempted: false,
          reason: `No loaded actor can be approached from supported ground; noncars=${sim.noncars.length}, candidates=${candidates.length}`,
        };
      for (const body of sim.cars) {
        sim.setCarPhysicsActive(body, body === player);
        body.input.throttle = body.input.steer = 0;
        body.input.brake = false;
        body.state.velocity.set(0, 0, 0);
        body.state.angularVelocity.set(0, 0, 0);
      }
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
      const forward = target.forward;
      player.state.position.copy(target.position);
      player.state.orientation.setFromUnitVectors(
        new player.state.position.constructor(0, 0, -1),
        forward,
      );
      player.state.heading = Math.atan2(-forward.x, -forward.z);
      sim.reset(player);
      player.state.velocity.copy(forward).multiplyScalar(10);
      window.__crashEffects.propId = target.body.actor.uuid;
      window.__crashEffects.pauseOnProp = true;
      window.__crashEffects.start = sim.elapsed;
      window.__crashEffects.until = sim.elapsed + 7;
      window.__crashEffects.beforeSpark = c.sparks.stats.created;
      window.__crashEffects.beforeShrapnel = c.shrapnel.stats.created;
      c.paused = false;
      return {
        attempted: true,
        prop: target.body.actor.name,
        propId: target.body.actor.uuid,
        propPosition: target.body.state.position.toArray(),
        playerSetup: target.position.toArray(),
        approachDistance: target.distance,
        driverExpectedFromNativeBodyClass: 4,
        sparky: target.body.mechanics.sparky,
        attached: target.body.attached,
        shapeCount: target.body.hulls.length,
        authoredShrapnelMaterials: [...target.body.mechanics.shrapnelMaterials],
      };
    });
    report.propSetup = propSetup;
    if (propSetup.attempted) {
      await page.locator("#view").click({ position: { x: 640, y: 400 } });
      await page.keyboard.down("w");
      await page.waitForFunction(
        () => {
          const c = window.carma;
          const trace = window.__crashEffects;
          const hit = trace.car.some((packet) =>
            packet.participants?.some(
              (part) => part.actorId === trace.propId && part.driver === 4,
            ),
          );
          if (hit || c.simulation.elapsed >= trace.until) {
            c.paused = true;
            return true;
          }
          return false;
        },
        null,
        { timeout: 15000 },
      );
      await page.keyboard.up("w");
      const propResult = await page.evaluate(() => {
        const c = window.carma;
        c.paused = true;
        document.querySelector("#panel").hidden = true;
        document.querySelector("#feedback").style.display = "none";
        document.querySelector("#message").style.visibility = "hidden";
        const trace = window.__crashEffects;
        const pairPackets = trace.car.filter((packet) =>
          packet.participants?.some(
            (part) => part.actorId === trace.propId && part.driver === 4,
          ),
        );
        const sparks = c.sparks.snapshot();
        const shrapnel = c.shrapnel.snapshot();
        return {
          elapsed: c.simulation.elapsed,
          playerPosition: c.player.state.position.toArray(),
          propPackets: pairPackets,
          sparkStats: c.sparks.stats,
          sparkCreatedDelta: c.sparks.stats.created - (trace.beforeSpark ?? 0),
          visibleSparks: sparks.records.filter(
            (entry) => entry.active && entry.visible,
          ).length,
          shrapnelStats: c.shrapnel.stats,
          shrapnelCreatedDelta:
            c.shrapnel.stats.created - (trace.beforeShrapnel ?? 0),
          visibleShrapnel: shrapnel.records.filter(
            (entry) => entry.active && entry.visible,
          ).length,
          debris: c.simulation.debris.map((body) => ({
            actor: body.actor.name,
            part: body.part,
            position: body.state.position.toArray(),
            velocity: body.state.velocity.toArray(),
            joint: !!body.joint,
          })),
        };
      });
      report.prop = propResult;
      if (!propResult.propPackets.length)
        report.unmet.push(
          "original loaded noncar: no native car-spark packet with driver4 participant",
        );
      propResult.visualObservation =
        "No active visible prop-collision spark/shrapnel records remained at the post-packet capture time; numerical driver4 callback and allocated pool deltas are recorded, so this run does not claim visual prop-effect verification.";
      await page.screenshot({
        path: "artifacts/browser-crash-effects-prop-impact.png",
      });
    }

    await load(catalog.eagle);
    report.tyreSmokeInstrument = await instrumentSmoke(
      "Eagle3 native tyre smoke under W+Space",
    );
    const tyreSetup = await page.evaluate(() => {
      const c = window.carma;
      const player = c.player;
      const forward = new player.state.position.constructor(0, 0, -1)
        .applyQuaternion(player.state.orientation)
        .normalize();
      for (const body of c.simulation.cars) {
        c.simulation.setCarPhysicsActive(body, body === player);
        body.input.throttle = body.input.steer = 0;
        body.input.handbrake = false;
        body.state.velocity.set(0, 0, 0);
        body.state.angularVelocity.set(0, 0, 0);
      }
      player.state.velocity.copy(forward).multiplyScalar(8);
      window.__smokeTrace.start = c.simulation.elapsed;
      window.__smokeTrace.until = c.simulation.elapsed + 5;
      c.paused = false;
      return { start: c.simulation.elapsed };
    });
    report.tyreSmokeSetup = tyreSetup;
    await page.locator("#view").click({ position: { x: 640, y: 400 } });
    await page.keyboard.down("w");
    await page.keyboard.down("Space");
    await page.keyboard.down("a");
    await page.waitForFunction(
      (until) =>
        window.carma.simulation.elapsed >= until ||
        window.__smokeTrace.puffs.some((puff) => puff.type === 4),
      tyreSetup.start + 5,
      { timeout: 14000 },
    );
    await page.keyboard.up("a");
    await page.keyboard.up("Space");
    await page.keyboard.up("w");
    const tyreSmoke = await page.evaluate(() => {
      const c = window.carma;
      c.paused = true;
      document.querySelector("#panel").hidden = true;
      const gl = document.querySelector("#view").getContext("webgl2");
      const glErrors = [];
      for (let i = 0; i < 32; i++) {
        const error = gl.getError();
        if (error === gl.NO_ERROR) break;
        glErrors.push(error);
      }
      return {
        elapsed: c.simulation.elapsed,
        events: window.__smokeTrace,
        stats: c.smoke.stats,
        snapshot: c.smoke.snapshot(),
        glErrors,
      };
    });
    report.tyreSmoke = tyreSmoke;
    if (
      !tyreSmoke.events.tyreAxles.some(
        (axle) =>
          axle.actor === "EAGLE3" &&
          axle.modifiers?.some((item) => item?.smokeType === 1),
      )
    )
      report.unmet.push(
        "real W+Space/A drive: no original smokeType1 tyre contact reached axle production",
      );
    if (
      !tyreSmoke.events.puffs.some(
        (puff) => puff.type === 4 && puff.index !== null,
      )
    )
      report.unmet.push(
        "real W+Space/A drive: no native smokeType1 type4 tyre puff reached spawnPuff",
      );
    if (tyreSmoke.glErrors.length)
      report.unmet.push(
        `tyre smoke: WebGL errors ${tyreSmoke.glErrors.join(",")}`,
      );
    await page.screenshot({
      path: "artifacts/browser-crash-effects-tyre-smoke.png",
    });
  }

  report.errorClocks = await page.evaluate(
    () => window.__crashEffectErrorClocks,
  );
  report.cameraOwnShapeErrors = await page.evaluate(
    () => window.__cameraOwnShapeErrors,
  );
  if (!report.destructionTimeTrace)
    report.destructionTimeTrace = await page.evaluate(
      () => window.__destructionTimeTrace,
    );
  await writeFile(
    "artifacts/browser-crash-effects.json",
    `${JSON.stringify({ catalog, ...report }, null, 2)}\n`,
  );
  assert.deepEqual(
    report.errors,
    [],
    `browser console/runtime errors: ${JSON.stringify(report.errors)}`,
  );
  assert.deepEqual(
    report.failedRequests,
    [],
    `failed asset requests: ${JSON.stringify(report.failedRequests)}`,
  );
  assert.deepEqual(
    report.unmet,
    [],
    `crash effects did not meet outlet/visibility checks; see artifacts/browser-crash-effects.json`,
  );
  console.log(
    `PASS crash-effects browser QA: ${report.cases.length} original-car impacts; report artifacts/browser-crash-effects.json`,
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
