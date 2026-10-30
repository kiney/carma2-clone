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
    "SKIP AI-01 crash-reaction browser fixture: Chromium or C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5287;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
let page;
const report = {
  fixture:
    "Stock THE BRUISE BROTHERS / NEWCITY4, original Eagle3 player and one of twelve authored catalog51 copcar regular racers (strength5/driver6)",
  isolation:
    "Two actual loaded participants are placed100 model units above the original player start. The original world, gravity, damage, attribution outlet and remaining population remain active. Main gameplay stays paused while at most twelve normal40ms physics ticks run per independent race load.",
  backend:
    "SwiftShader correctness fixture, not a hardware performance measurement",
  cases: [],
  errors: [],
  failedRequests: [],
  failedResponses: [],
};
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));

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
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico"))
      report.failedResponses.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.evaluate(() => {
    window.carma.paused = true;
  });

  const assets = await page.evaluate(() => {
    const c = window.carma;
    return {
      track: c.assets.resolve("data/races/newcity4/newcity4.txt"),
      car: c.assets.resolve("data/cars/eagle3/eagle3.txt"),
    };
  });
  assert.ok(
    assets.track && assets.car,
    `required Stock assets absent: ${JSON.stringify(assets)}`,
  );
  report.assets = assets;

  for (const [name, playerAttacks, speed] of [
    ["player-hits-strong-ai", true, 3],
    ["ai-hits-stationary-player", false, 1.2],
  ]) {
    await page.evaluate(async ({ track, car }) => {
      const c = window.carma;
      c.paused = true;
      document.querySelector("#track-select").value = track;
      document.querySelector("#car-select").value = car;
      await c.loadRace();
      c.paused = true;
    }, assets);
    await page.waitForFunction(
      () => {
        const c = window.carma;
        return (
          c.opponentsReady &&
          c.opponentFleet?.snapshot.rivals.length === 12 &&
          c.rivals.length === 12
        );
      },
      null,
      { timeout: 90000 },
    );

    const result = await page.evaluate(
      ({ name, playerAttacks, speed }) => {
        const c = window.carma;
        c.paused = true;
        const sim = c.simulation;
        const fleet = c.opponentFleet;
        const player = c.player;
        const selected = c.rivals.find(
          (r) => r.id === 51 && r.body.state.driver === 6,
        );
        if (!selected)
          throw new Error("Authored catalog51 regular copcar is absent");
        const rival = selected.body;
        const instance = fleet.rivals.get(rival.group.uuid);
        if (!instance)
          throw new Error("Selected original rival is not in the native fleet");
        const beforePopulation = c.rivals.map((r) => ({
          id: r.id,
          name: r.body.group.name,
          identity: r.body.group.uuid,
          physical: sim.isCarPhysicsActive(r.body),
          knackered: r.body.knackered,
          components: [...r.body.damage.componentLevels],
        }));
        const base = fleet.snapshot.nowMs;
        // Use the live dispatcher to leave firstFrame, then the existing ordinary
        // objective lifecycle if a preceding startup frame had selected pursuit.
        fleet.update(base + 40, 40, 1, false);
        if (instance.objective.snapshot().objective !== "complete-race")
          fleet.transition(instance, "complete-race");
        const aiTime = fleet.snapshot.nowMs;
        const origin = player.state.position.clone();
        origin.y += 100;
        const source = playerAttacks ? player : rival;
        const victim = playerAttacks ? rival : player;
        const sourceBounds = bounds(source);
        const victimBounds = bounds(victim);
        const centreY = (bodyBounds) =>
          (bodyBounds.min[1] + bodyBounds.max[1]) / 2;
        for (const body of [source, victim]) {
          body.state.heading = 0;
          body.state.position.copy(origin);
          body.state.velocity.set(0, 0, 0);
          body.state.angularVelocity.set(0, 0, 0);
          body.state.accForce =
            body.state.brakeForce =
            body.state.curvature =
              0;
          body.input.throttle = body.input.steer = body.input.brake = 0;
          body.input.handbrake = false;
          body.crashAccelerationKey = false;
          sim.reset(body);
        }
        source.state.position.z += 3;
        source.state.position.y +=
          centreY(victimBounds) - centreY(sourceBounds);
        source.state.velocity.set(0, 0, -speed);
        source.state.gear = 1;
        source.state.rpm = 2500;
        source.input.throttle = 1;
        source.crashAccelerationKey = source.human;
        const sourceRole = source.human ? "player" : "rival";
        const victimRole = victim.human ? "player" : "rival";
        const catalogIndex = instance.catalogIndex;
        const entry = fleet.catalogState[catalogIndex];
        const beforeGrudge = entry.grudge;
        const beforeObjective = instance.objective.snapshot();
        const pair = (a, b) =>
          (a === source && b === victim) || (a === victim && b === source);
        const events = [];
        const contacts = [];
        let otherAttributions = 0;
        const originalFleetOutlet = fleet.onCrashAttribution;
        const originalSimulationOutlet = sim.onCrashAttribution;
        fleet.onCrashAttribution = function (attacker, target) {
          if (!pair(attacker, target)) {
            otherAttributions++;
            return originalFleetOutlet.call(this, attacker, target);
          }
          const accumulator = target.crashRecord.accumulator;
          const severity = Math.trunc(
            Math.min(100, Math.sqrt(Math.fround(accumulator) * 300000)),
          );
          const grudgeBefore = entry.grudge;
          const result = originalFleetOutlet.call(this, attacker, target);
          const facts = fleet.snapshot.rivals.find(
            (r) => r.identity === rival.group.uuid,
          );
          events.push({
            attacker: attacker.group.name,
            victim: target.group.name,
            attackerIdentity: attacker.group.uuid,
            victimIdentity: target.group.uuid,
            accumulator,
            severity,
            result,
            grudgeBefore,
            grudgeAfter: entry.grudge,
            aiTime: fleet.snapshot.nowMs,
            rawClockSample: sim.crashClock(),
            contact: facts.contact,
            objective: facts.objective,
            forces: facts.forces,
          });
          return result;
        };
        let steps = 0;
        function tick() {
          sim.update(0.04);
          steps++;
          for (const impact of sim.lastImpacts)
            if (pair(impact.a, impact.b))
              contacts.push({
                step: steps,
                impulse: impact.normalImpulse,
                closingSpeed: impact.closingSpeed,
                point: impact.point.toArray(),
                distance: source.state.position.distanceTo(
                  victim.state.position,
                ),
              });
        }
        try {
          // Normal separated frames establish both native speed-cache stores;
          // the first above-epsilon speed is deliberately clamped to epsilon.
          tick();
          tick();
          const warmAttributions = events.length;
          const warmSource = source.state.position.clone();
          source.state.position.x = victim.state.position.x;
          source.state.position.z =
            victim.state.position.z +
            victimBounds.max[2] -
            sourceBounds.min[2] +
            0.001;
          source.poseEpoch++;
          source.group.position.copy(source.state.position);
          source.group.updateMatrixWorld(true);
          while (!events.length && steps < 12) tick();
          const preDecision = fleet.snapshot.rivals.find(
            (r) => r.identity === rival.group.uuid,
          );
          const accumulatorAfterCleanup = victim.crashRecord.accumulator;
          const historyAfter = { ...victim.crashHistory };
          fleet.update(aiTime + 40, 40, 1, false);
          const after = fleet.snapshot.rivals.find(
            (r) => r.identity === rival.group.uuid,
          );
          const gl = c.renderer.getContext();
          const extension = gl.getExtension("WEBGL_debug_renderer_info");
          const webglErrors = [];
          for (let i = 0; i < 16; i++) {
            const error = gl.getError();
            if (error === gl.NO_ERROR) break;
            webglErrors.push(error);
          }
          c.camera.position
            .copy(victim.state.position)
            .add(new victim.state.position.constructor(1.5, 1.1, 2.5));
          c.camera.lookAt(victim.state.position);
          c.prepareRenderMatrices(true);
          c.renderer.render(c.scene, c.camera);
          document.querySelector("#panel").hidden = true;
          return {
            name,
            playerAttacks,
            speed,
            steps,
            warmAttributions,
            sourceRole,
            victimRole,
            sourceIdentity: source.group.uuid,
            victimIdentity: victim.group.uuid,
            sourceName: source.group.name,
            victimName: victim.group.name,
            selectedId: selected.id,
            selectedDriver: rival.state.driver,
            strength: entry.strength,
            beforePopulation,
            afterPopulation: c.rivals.map((r) => ({
              id: r.id,
              identity: r.body.group.uuid,
            })),
            beforeGrudge,
            beforeObjective,
            threshold: fleet.bigBangThreshold,
            aiTime,
            firstFrame: fleet.snapshot.firstFrame,
            sourceStartAboveTrack: origin.toArray(),
            warmSource: warmSource.toArray(),
            finalPositions: [
              source.state.position.toArray(),
              victim.state.position.toArray(),
            ],
            events,
            contacts,
            otherAttributions,
            preDecision,
            after,
            accumulatorAfterCleanup,
            historyAfter,
            finalGrudge: entry.grudge,
            sourceKnackered: source.knackered,
            victimKnackered: victim.knackered,
            originalOutletPreserved:
              sim.onCrashAttribution === originalSimulationOutlet,
            paused: c.paused,
            populationCount: c.rivals.length,
            raceStatus: c.race.status,
            webgl: {
              renderer: extension
                ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
                : gl.getParameter(gl.RENDERER),
              drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
              errors: webglErrors,
            },
          };
        } finally {
          fleet.onCrashAttribution = originalFleetOutlet;
        }

        function bounds(body) {
          const min = [Infinity, Infinity, Infinity],
            max = [-Infinity, -Infinity, -Infinity];
          for (const shape of body.shapeVertices)
            for (const point of shape)
              for (const [axis, value] of point.toArray().entries()) {
                min[axis] = Math.min(min[axis], value);
                max[axis] = Math.max(max[axis], value);
              }
          return { min, max };
        }
      },
      { name, playerAttacks, speed },
    );
    report.cases.push(result);
    await page.screenshot({
      path: `artifacts/browser-ai-crash-reactions-${name}.png`,
    });
    assert.equal(
      result.populationCount,
      12,
      `${name}: authored population changed`,
    );
    assert.ok(
      result.beforePopulation.every((r) => r.id === 51),
      `${name}: expected authored copcar roster`,
    );
    assert.equal(
      result.selectedDriver,
      6,
      `${name}: selected body is not a regular racer`,
    );
    assert.equal(result.strength, 5, `${name}: original strength changed`);
    assert.equal(
      result.warmAttributions,
      0,
      `${name}: warm frames contacted participants`,
    );
    assert.equal(result.firstFrame, false);
    assert.equal(result.beforeObjective.objective, "complete-race");
    assert.equal(
      result.events.length,
      1,
      `${name}: missing or multiple selected-pair attributions: ${JSON.stringify(result)}`,
    );
    const event = result.events[0];
    assert.equal(event.attackerIdentity, result.sourceIdentity);
    assert.equal(event.victimIdentity, result.victimIdentity);
    assert.ok(event.accumulator > 0 && event.severity >= 5);
    assert.equal(event.result.severity, event.severity);
    assert.ok(
      result.contacts.some((contact) => contact.impulse > 0),
      `${name}: no real solved contact impulse`,
    );
    assert.ok(result.steps <= 12);
    assert.equal(result.accumulatorAfterCleanup, 0);
    assert.equal(result.sourceKnackered, false, `${name}: source was wasted`);
    assert.equal(result.victimKnackered, false, `${name}: victim was wasted`);
    assert.equal(result.originalOutletPreserved, true);
    assert.equal(event.aiTime, result.aiTime);
    assert.equal(event.contact.contactTimeMs, result.aiTime);
    const increment = Math.trunc(event.severity / 10);
    if (playerAttacks) {
      assert.equal(event.result.outcome, "human-hit-ai");
      assert.ok(
        event.severity >= result.threshold,
        `${name}: actual impact did not reach native big-bang threshold`,
      );
      assert.equal(event.contact.flags.bigBang, true);
      assert.equal(event.contact.lastHitter, result.sourceIdentity);
      assert.equal(
        event.grudgeAfter,
        Math.min(100, event.grudgeBefore + increment),
      );
    } else {
      assert.equal(event.result.outcome, "ai-hit-human");
      assert.equal(event.contact.lastWeHit, result.victimIdentity);
      assert.equal(
        event.grudgeAfter,
        Math.max(0, event.grudgeBefore - 2 * increment),
      );
    }
    assert.equal(result.preDecision.objective.objective, "complete-race");
    assert.equal(
      result.after.objective.objective,
      "pursue",
      `${name}: contact did not start next-frame pursuit`,
    );
    const playerIdentity = playerAttacks
      ? result.sourceIdentity
      : result.victimIdentity;
    assert.equal(result.after.objective.target, playerIdentity);
    assert.deepEqual(result.after.contact.flags, {
      grudgeRecent: false,
      bigBang: false,
      scaryBang: false,
    });
    assert.equal(result.after.contact.lastHitter, null);
    assert.equal(result.after.contact.lastWeHit, null);
    assert.equal(result.paused, true);
    assert.deepEqual(result.webgl.errors, []);
    console.log(
      `${name}: severity${event.severity}, native threshold${result.threshold}, ${result.steps} physics steps, next objective${result.after.objective.objective}`,
    );
  }
  assert.deepEqual(
    report.errors,
    [],
    `browser errors: ${report.errors.join(" | ")}`,
  );
  assert.deepEqual(
    report.failedRequests,
    [],
    `failed requests: ${report.failedRequests.join(" | ")}`,
  );
  assert.deepEqual(
    report.failedResponses,
    [],
    `failed responses: ${report.failedResponses.join(" | ")}`,
  );
  await writeFile(
    "artifacts/browser-ai-crash-reactions-report.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error?.stack || error);
  report.serverLog = serverLog;
  if (page)
    await page
      .screenshot({ path: "artifacts/browser-ai-crash-reactions-failure.png" })
      .catch(() => {});
  await writeFile(
    "artifacts/browser-ai-crash-reactions-report.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
