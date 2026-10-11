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
    "SKIP component-smoke browser QA: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5220;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
let browser;
const report = {
  build: "production bundle",
  cases: [],
  errors: [],
  failedRequests: [],
  unmet: [],
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
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
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
    };
  });
  assert.ok(
    catalog.newcity && catalog.eagle && catalog.buggy,
    "original Newcity, Eagle3, or Buggy unavailable",
  );

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
  }

  async function runCarCase(label, carValue) {
    await load(carValue);
    const setup = await page.evaluate((label) => {
      const c = window.carma;
      const sim = c.simulation;
      const player = c.player;
      const rival = sim.cars
        .filter((body) => body !== player && !body.human)
        .sort(
          (a, b) =>
            Math.abs(a.properties.mass - player.properties.mass) -
            Math.abs(b.properties.mass - player.properties.mass),
        )[0];
      if (!rival)
        throw new Error(
          "No original physical rival available for component smoke QA",
        );
      const trace = (window.__componentSmokeTrace = {
        label,
        sequence: 0,
        playerId: player.group.uuid,
        rivalId: rival.group.uuid,
        impacts: [],
        impactDamageEvents: [],
        damageCalls: [],
        componentRequests: [],
        columnEvents: [],
        shortenCalls: [],
        fullRepairEvents: [],
        knackeredSmokeEvents: [],
        wastedEvents: [],
        eHeld: false,
        attempts: [],
        currentDamageCall: null,
      });
      const captureDamage = sim.onDamageSmoke;
      sim.onDamageSmoke = (body) => {
        const state = {
          actor: body.group.name,
          actorId: body.group.uuid,
          human: body.human,
          driver: body.state.driver ?? (body.human ? 8 : 6),
          health: body.state.health,
          knackered: body.knackered,
          levels: [...body.damage.componentLevels],
          previous: [...body.smokeLastComponentLevels],
        };
        trace.damageCalls.push(state);
        trace.currentDamageCall = state;
        captureDamage?.(body);
        trace.currentDamageCall = null;
      };
      const captureImpact = sim.onImpact;
      sim.onImpact = (body, speed) => {
        trace.impacts.push({
          actor: body.group.name,
          actorId: body.group.uuid,
          speed,
          elapsed: sim.elapsed,
        });
        captureImpact?.(body, speed);
      };
      for (const body of [player, rival]) {
        const originalApplyImpact = body.damage.applyImpact.bind(body.damage);
        body.damage.applyImpact = (...args) => {
          const result = originalApplyImpact(...args);
          trace.impactDamageEvents.push({
            actor: body.group.name,
            actorId: body.group.uuid,
            contacts: args[0]?.map((point) => point.toArray()),
            energy: args[1]?.toArray?.(),
            hitAnotherCar: args[2],
            human: args[3],
            explicitDamagePoint: args[6]?.toArray?.() ?? null,
            componentEvents: result.componentEvents,
            knackered: body.knackered,
            levels: [...body.damage.componentLevels],
          });
          return result;
        };
      }
      const captureFullRepair = sim.onFullRepair;
      sim.onFullRepair = (body) => {
        trace.fullRepairEvents.push({
          actorId: body.group.uuid,
          actor: body.group.name,
          elapsed: sim.elapsed,
          levels: [...body.damage.componentLevels],
        });
        captureFullRepair?.(body);
      };
      const captureKnackeredSmoke = sim.onKnackeredSmoke;
      sim.onKnackeredSmoke = (body) => {
        trace.knackeredSmokeEvents.push({
          order: trace.sequence++,
          actorId: body.group.uuid,
          actor: body.group.name,
          elapsed: sim.elapsed,
          levels: [...body.damage.componentLevels],
          health: body.state.health,
        });
        captureKnackeredSmoke?.(body);
      };
      const captureWasted = sim.onWasted;
      sim.onWasted = (body) => {
        trace.wastedEvents.push({
          order: trace.sequence++,
          actorId: body.group.uuid,
          actor: body.group.name,
          elapsed: sim.elapsed,
          levels: [...body.damage.componentLevels],
          health: body.state.health,
        });
        captureWasted?.(body);
      };
      const smoke = c.smoke;
      const originalComponent = smoke.spawnComponentColumn.bind(smoke);
      const originalColumn = smoke.spawnColumn.bind(smoke);
      const originalShorten = smoke.shortenCarColumns.bind(smoke);
      smoke.spawnComponentColumn = (source) => {
        const point = new source.actor.position.constructor();
        const sampled = source.sampleVertex?.(source.vertex, point) ?? false;
        const state = trace.currentDamageCall;
        const nativeDivisors = [20, 20, 0, 10, 10, 10, 10, 10, 10, 10, 10, 10];
        const candidateComponents = state
          ? state.levels.flatMap((level, component) => {
              const divisor = nativeDivisors[component];
              if (divisor === 0 || level <= state.previous[component])
                return [];
              const colour = Math.trunc((99 - level) / divisor);
              const previousColour = Math.trunc(
                (99 - state.previous[component]) / divisor,
              );
              return colour === source.colour && colour !== previousColour
                ? [component]
                : [];
            })
          : [];
        const record = {
          actor: source.actor.name,
          actorId: source.actor.uuid,
          driver: source.driver,
          colourRequested: source.colour,
          vertex: source.vertex,
          lifetimeMs: source.lifetimeMs,
          knackered: source.knackered,
          volumeGravity: source.volumeGravity,
          sampled,
          samplePosition: sampled ? point.toArray() : null,
          health: state?.health,
          componentLevels: state?.levels,
          smokeLast: state?.previous,
          candidateComponents,
          velocity: source.rigid?.velocity?.toArray?.(),
          omega: source.rigid?.omega?.toArray?.(),
        };
        if (source.actor.uuid === trace.playerId)
          trace.playerSmokeCar = source.car;
        const index = originalComponent(source);
        trace.componentRequests.push({ ...record, index });
        return index;
      };
      smoke.spawnColumn = (source) => {
        const point = new source.actor.position.constructor();
        const sampled = source.sampleVertex?.(source.vertex, point) ?? false;
        const index = originalColumn(source);
        trace.columnEvents.push({
          actor: source.actor.name,
          actorId: source.actor.uuid,
          driver: source.driver,
          mode: source.mode,
          colour: source.colour,
          vertex: source.vertex,
          lifetimeMs: source.lifetimeMs,
          sampled,
          samplePosition: sampled ? point.toArray() : null,
          index,
        });
        return index;
      };
      smoke.shortenCarColumns = (car, maximumMs) => {
        trace.shortenCalls.push({
          matchingPlayerCar: car === trace.playerSmokeCar,
          eHeld: trace.eHeld,
          maximumMs,
          elapsed: sim.elapsed,
        });
        return originalShorten(car, maximumMs);
      };
      const originalFleetUpdate = c.opponentFleet?.update?.bind(
        c.opponentFleet,
      );
      if (originalFleetUpdate) {
        c.opponentFleet.update = (...args) => {
          originalFleetUpdate(...args);
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
      const heading = player.state.heading;
      for (const body of sim.cars) {
        sim.setCarPhysicsActive(body, body === player || body === rival);
        body.input.throttle = body.input.steer = 0;
        body.input.brake = body.input.handbrake = false;
        body.state.velocity.set(0, 0, 0);
        body.state.angularVelocity.set(0, 0, 0);
      }
      const initial = {
        player: player.group.name,
        rival: rival.group.name,
        playerId: player.group.uuid,
        rivalId: rival.group.uuid,
        playerDriver: player.state.driver ?? 8,
        rivalDriver: rival.state.driver ?? 6,
        playerHealth: player.state.health,
        playerLevels: [...player.damage.componentLevels],
        rivalHealth: rival.state.health,
        rivalLevels: [...rival.damage.componentLevels],
      };
      trace.fixture = { origin: origin.toArray(), heading, speed: 10, initial };
      trace.forward = forward.toArray();
      trace.right = right.toArray();
      trace.rivalId = rival.group.uuid;
      return trace.fixture;
    }, label);

    const maxImpacts = 10;
    const attemptResults = [];
    for (let attempt = 0; attempt < maxImpacts; attempt++) {
      const attemptSetup = await page.evaluate((attempt) => {
        const c = window.carma;
        const sim = c.simulation;
        const player = c.player;
        const trace = window.__componentSmokeTrace;
        const rival = sim.cars.find(
          (body) => body.group.uuid === trace.rivalId,
        );
        const forward = new player.state.position.constructor(...trace.forward);
        const right = new player.state.position.constructor(...trace.right);
        const origin = new player.state.position.constructor(
          ...trace.fixture.origin,
        );
        const heading = trace.fixture.heading;
        for (const body of sim.cars) {
          sim.setCarPhysicsActive(body, body === player || body === rival);
          body.input.throttle = body.input.steer = 0;
          body.input.brake = body.input.handbrake = false;
          body.state.velocity.set(0, 0, 0);
          body.state.angularVelocity.set(0, 0, 0);
        }
        player.state.position.copy(origin);
        player.state.heading = heading;
        player.state.orientation.setFromAxisAngle(
          new player.state.position.constructor(0, 1, 0),
          heading,
        );
        const lateralOffsets = [0, 0.4, 0.7, 1, -0.4, -0.7, -1];
        const rivalPosition = origin
          .clone()
          .addScaledVector(forward, 9)
          .addScaledVector(
            right,
            lateralOffsets[attempt % lateralOffsets.length],
          );
        rival.state.position.copy(rivalPosition);
        rival.state.heading = heading + Math.PI;
        rival.state.orientation.setFromAxisAngle(
          new rival.state.position.constructor(0, 1, 0),
          heading + Math.PI,
        );
        sim.reset(rival);
        sim.reset(player);
        player.state.velocity.copy(forward).multiplyScalar(7);
        rival.state.velocity.copy(forward).multiplyScalar(-1);
        const start = sim.elapsed;
        const item = {
          attempt,
          start,
          until: start + 1.4,
          playerBefore: {
            health: player.state.health,
            levels: [...player.damage.componentLevels],
            knackered: player.knackered,
          },
          rivalBefore: {
            health: rival.state.health,
            levels: [...rival.damage.componentLevels],
            knackered: rival.knackered,
          },
          impactCount: trace.impacts.length,
          requestCount: trace.componentRequests.length,
        };
        trace.attempts.push(item);
        c.paused = false;
        return item;
      }, attempt);
      await page.locator("#view").click({ position: { x: 640, y: 400 } });
      await page.keyboard.down("w");
      await page.waitForFunction(
        (state) => {
          const c = window.carma;
          const trace = window.__componentSmokeTrace;
          return (
            trace.impacts.length > state.impactCount ||
            trace.componentRequests.length > state.requestCount ||
            c.simulation.elapsed >= state.until ||
            c.player.knackered
          );
        },
        attemptSetup,
        { timeout: 12000 },
      );
      await page.keyboard.up("w");
      await page.evaluate(() => {
        window.carma.paused = true;
      });
      const end = await page.evaluate(() => {
        const c = window.carma;
        const rival = c.simulation.cars.find(
          (body) => body.group.uuid === window.__componentSmokeTrace.rivalId,
        );
        const snapshot = c.smoke.snapshot();
        return {
          elapsed: c.simulation.elapsed,
          player: {
            health: c.player.state.health,
            levels: [...c.player.damage.componentLevels],
            knackered: c.player.knackered,
          },
          rival: {
            actor: rival.group.name,
            driver: rival.state.driver ?? 6,
            health: rival.state.health,
            levels: [...rival.damage.componentLevels],
            knackered: rival.knackered,
          },
          activeColumns: snapshot.columns
            .map((column, index) => ({
              index,
              active: column.active,
              remaining: column.remaining,
              vertex: column.vertex,
              position: column.position.toArray(),
              flameVisible: column.flames.some((flame) => flame.visible),
            }))
            .filter((column) => column.active),
          glErrors: (() => {
            const gl = document.querySelector("#view").getContext("webgl2");
            const errors = [];
            for (let i = 0; i < 32; i++) {
              const value = gl.getError();
              if (value === gl.NO_ERROR) break;
              errors.push(value);
            }
            return errors;
          })(),
        };
      });
      attemptResults.push({ setup: attemptSetup, result: end });
      const shouldRepair = await page.evaluate(() => {
        const c = window.carma;
        const trace = window.__componentSmokeTrace;
        return (
          !trace.didERepair &&
          !c.player.knackered &&
          trace.componentRequests.some(
            (event) => event.actorId === trace.playerId && !event.knackered,
          )
        );
      });
      if (shouldRepair) {
        await page.evaluate(() => {
          const c = window.carma;
          const trace = window.__componentSmokeTrace;
          trace.didERepair = true;
          trace.eHeld = true;
          c.paused = false;
          trace.eRepairUntil = c.simulation.elapsed + 0.8;
        });
        await page.keyboard.down("e");
        await page.waitForFunction(
          (until) => window.carma.simulation.elapsed >= until,
          await page.evaluate(() => window.__componentSmokeTrace.eRepairUntil),
          { timeout: 10000 },
        );
        await page.keyboard.up("e");
        await page.evaluate(() => {
          window.__componentSmokeTrace.eHeld = false;
          window.carma.paused = true;
        });
      }
      const thresholdReached =
        end.player.levels[0] >= 80 && end.player.levels[3] >= 70;
      if (thresholdReached || end.player.knackered) break;
    }

    const madePlayerColumn = await page.evaluate(() => {
      const trace = window.__componentSmokeTrace;
      return trace.componentRequests.some(
        (event) => event.actorId === trace.playerId && !event.knackered,
      );
    });
    if (madePlayerColumn) {
      const visualUntil = await page.evaluate(() => {
        const c = window.carma;
        c.paused = false;
        return c.simulation.elapsed + 0.45;
      });
      await page.waitForFunction(
        (until) => window.carma.simulation.elapsed >= until,
        visualUntil,
        { timeout: 8000 },
      );
      await page.evaluate(() => {
        window.carma.paused = true;
      });
    }
    const beforeRepairUntil = await page.evaluate(() => {
      const c = window.carma;
      return {
        until: c.simulation.elapsed + 0.8,
        wasted: c.player.knackered || c.player.damage.wasted,
      };
    });
    if (!beforeRepairUntil.wasted) {
      await page.evaluate(() => {
        window.__componentSmokeTrace.eHeld = true;
      });
      await page.keyboard.down("e");
      await page.evaluate(() => {
        window.carma.paused = false;
      });
      await page.waitForFunction(
        (until) => window.carma.simulation.elapsed >= until,
        beforeRepairUntil.until,
        { timeout: 10000 },
      );
      await page.keyboard.up("e");
      await page.evaluate(() => {
        window.__componentSmokeTrace.eHeld = false;
      });
      await page.evaluate(() => {
        window.carma.paused = true;
      });
    }
    const details = await page.evaluate(() => {
      const c = window.carma;
      c.paused = true;
      document.querySelector("#panel").hidden = true;
      document.querySelector("#feedback").style.display = "none";
      document.querySelector("#message").style.visibility = "hidden";
      const trace = window.__componentSmokeTrace;
      const smoke = c.smoke.snapshot();
      const gl = document.querySelector("#view").getContext("webgl2");
      const glErrors = [];
      for (let i = 0; i < 32; i++) {
        const value = gl.getError();
        if (value === gl.NO_ERROR) break;
        glErrors.push(value);
      }
      return {
        label: trace.label,
        fixture: trace.fixture,
        attempts: trace.attempts,
        playerId: trace.playerId,
        rivalId: trace.rivalId,
        impacts: trace.impacts,
        impactDamageEvents: trace.impactDamageEvents,
        damageCalls: trace.damageCalls,
        componentRequests: trace.componentRequests,
        columnEvents: trace.columnEvents,
        shortenCalls: trace.shortenCalls,
        fullRepairEvents: trace.fullRepairEvents,
        knackeredSmokeEvents: trace.knackeredSmokeEvents,
        wastedEvents: trace.wastedEvents,
        stats: c.smoke.stats,
        columns: smoke.columns.map((column, index) => ({
          index,
          active: column.active,
          remaining: column.remaining,
          vertex: column.vertex,
          position: column.position.toArray(),
          flames: column.flames,
        })),
        colorRoutes: {
          localZero: trace.componentRequests.some(
            (request) =>
              request.actorId === trace.playerId &&
              request.driver === 8 &&
              request.colourRequested === 0 &&
              !request.knackered &&
              trace.columnEvents.some(
                (column) =>
                  column.actorId === trace.playerId &&
                  column.driver === 8 &&
                  column.vertex === request.vertex &&
                  column.colour === 0,
              ),
          ),
          opponentZeroToOne: trace.componentRequests.some(
            (request) =>
              request.actorId === trace.rivalId &&
              request.driver === 6 &&
              request.colourRequested === 0 &&
              trace.columnEvents.some(
                (column) =>
                  column.actorId === trace.rivalId &&
                  column.driver === 6 &&
                  column.vertex === request.vertex &&
                  column.colour === 1,
              ),
          ),
        },
        glErrors,
      };
    });
    details.attemptResults = attemptResults;
    report.cases.push(details);
    if (!details.impacts.length)
      report.unmet.push(`${label}: real W-driven car impact did not occur`);
    if (details.glErrors.length)
      report.unmet.push(`${label}: WebGL errors ${details.glErrors.join(",")}`);

    const produced = details.componentRequests.some(
      (event) => !event.knackered,
    );
    if (produced) {
      await page.screenshot({
        path: `artifacts/browser-component-smoke-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
      });
    }
    return details;
  }

  async function runWallCase(
    label,
    carValue,
    cornerAngle,
    setupSpeed,
    sideImpact = false,
  ) {
    await load(carValue);
    const setup = await page.evaluate(
      ({ label, cornerAngle, setupSpeed, sideImpact }) => {
        const c = window.carma;
        const sim = c.simulation;
        const player = c.player;
        const surfaces = [
          ...new Set([...sim.world.cells.values()].flat()),
        ].filter(
          (surface) =>
            surface.enabled !== false &&
            surface.collisionMode !== "edges" &&
            !/^[!>?]/.test(surface.material) &&
            Math.abs(surface.normal.y) < 0.12 &&
            surface.normal.lengthSq() > 0.9,
        );
        const candidates = surfaces
          .map((surface) => {
            const center = surface.a
              .clone()
              .add(surface.b)
              .add(surface.c)
              .multiplyScalar(1 / 3);
            const toFace = center.clone().sub(player.state.position).setY(0);
            const distance = toFace.length();
            const normal = surface.normal.clone().setY(0).normalize();
            const facing = distance
              ? normal.dot(toFace.clone().normalize())
              : -1;
            const area = surface.b
              .clone()
              .sub(surface.a)
              .cross(surface.c.clone().sub(surface.a))
              .length();
            return { surface, center, distance, normal, facing, area };
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
        if (!best) throw new Error("No original Newcity wall face near Eagle");
        const trace = (window.__componentSmokeTrace = {
          label,
          sequence: 0,
          playerId: player.group.uuid,
          rivalId: null,
          impacts: [],
          impactDamageEvents: [],
          worldSparks: [],
          damageCalls: [],
          componentRequests: [],
          columnEvents: [],
          shortenCalls: [],
          fullRepairEvents: [],
          powerupEvents: [],
          knackeredSmokeEvents: [],
          wastedEvents: [],
          attempts: [],
          currentDamageCall: null,
          eHeld: false,
        });
        const captureDamage = sim.onDamageSmoke;
        sim.onDamageSmoke = (body) => {
          const state = {
            actor: body.group.name,
            actorId: body.group.uuid,
            driver: body.state.driver ?? (body.human ? 8 : 6),
            health: body.state.health,
            knackered: body.knackered,
            levels: [...body.damage.componentLevels],
            previous: [...body.smokeLastComponentLevels],
          };
          trace.damageCalls.push(state);
          trace.currentDamageCall = state;
          captureDamage?.(body);
          trace.currentDamageCall = null;
        };
        const originalApplyImpact = player.damage.applyImpact.bind(
          player.damage,
        );
        player.damage.applyImpact = (...args) => {
          const result = originalApplyImpact(...args);
          trace.impactDamageEvents.push({
            actor: player.group.name,
            actorId: player.group.uuid,
            contacts: args[0]?.map((point) => point.toArray()),
            energy: args[1]?.toArray?.(),
            hitAnotherCar: args[2],
            human: args[3],
            explicitDamagePoint: args[6]?.toArray?.() ?? null,
            componentEvents: result.componentEvents,
            knackered: player.knackered,
            levels: [...player.damage.componentLevels],
          });
          return result;
        };
        const originalComponent = c.smoke.spawnComponentColumn.bind(c.smoke);
        const originalColumn = c.smoke.spawnColumn.bind(c.smoke);
        const originalShorten = c.smoke.shortenCarColumns.bind(c.smoke);
        c.smoke.spawnComponentColumn = (source) => {
          const point = new source.actor.position.constructor();
          const sampled = source.sampleVertex?.(source.vertex, point) ?? false;
          const state = trace.currentDamageCall;
          const divisors = [20, 20, 0, 10, 10, 10, 10, 10, 10, 10, 10, 10];
          const candidateComponents = state
            ? state.levels.flatMap((level, component) => {
                const divisor = divisors[component];
                if (divisor === 0 || level <= state.previous[component])
                  return [];
                const colour = Math.trunc((99 - level) / divisor);
                const oldColour = Math.trunc(
                  (99 - state.previous[component]) / divisor,
                );
                return colour === source.colour && colour !== oldColour
                  ? [component]
                  : [];
              })
            : [];
          const index = originalComponent(source);
          if (source.actor.uuid === trace.playerId)
            trace.playerSmokeCar = source.car;
          trace.componentRequests.push({
            actor: source.actor.name,
            actorId: source.actor.uuid,
            driver: source.driver,
            colourRequested: source.colour,
            vertex: source.vertex,
            lifetimeMs: source.lifetimeMs,
            knackered: source.knackered,
            sampled,
            samplePosition: sampled ? point.toArray() : null,
            health: state?.health,
            componentLevels: state?.levels,
            smokeLast: state?.previous,
            candidateComponents,
            index,
          });
          return index;
        };
        c.smoke.spawnColumn = (source) => {
          const point = new source.actor.position.constructor();
          const sampled = source.sampleVertex?.(source.vertex, point) ?? false;
          const index = originalColumn(source);
          trace.columnEvents.push({
            actor: source.actor.name,
            actorId: source.actor.uuid,
            driver: source.driver,
            mode: source.mode,
            colour: source.colour,
            vertex: source.vertex,
            lifetimeMs: source.lifetimeMs,
            sampled,
            samplePosition: sampled ? point.toArray() : null,
            index,
          });
          return index;
        };
        c.smoke.shortenCarColumns = (car, maximumMs) => {
          trace.shortenCalls.push({
            matchingPlayerCar: car === trace.playerSmokeCar,
            eHeld: trace.eHeld,
            maximumMs,
            elapsed: sim.elapsed,
          });
          return originalShorten(car, maximumMs);
        };
        const captureRepair = sim.onFullRepair;
        sim.onFullRepair = (body) => {
          trace.fullRepairEvents.push({
            actorId: body.group.uuid,
            actor: body.group.name,
            elapsed: sim.elapsed,
            levels: [...body.damage.componentLevels],
          });
          captureRepair?.(body);
        };
        for (const [key, callbackName] of [
          ["onKnackeredSmoke", "knackeredSmokeEvents"],
          ["onWasted", "wastedEvents"],
        ]) {
          const original = sim[key];
          sim[key] = (body) => {
            trace[callbackName].push({
              order: trace.sequence++,
              actorId: body.group.uuid,
              actor: body.group.name,
              elapsed: sim.elapsed,
              levels: [...body.damage.componentLevels],
              health: body.state.health,
            });
            original?.(body);
          };
        }
        const wallIn = best.normal.clone().negate();
        const forward = sideImpact
          ? new best.normal.constructor(0, 1, 0).cross(best.normal).normalize()
          : wallIn
              .clone()
              .applyAxisAngle(
                new best.normal.constructor(0, 1, 0),
                cornerAngle,
              );
        const position = best.center
          .clone()
          .addScaledVector(best.normal, sideImpact ? 2.5 : 4)
          .addScaledVector(forward, sideImpact ? 0.35 : 0);
        const ground = c.collision.height(
          position.x,
          position.z,
          best.center.y + 8,
        );
        if (ground === null)
          throw new Error("Newcity wall fixture lacks ground");
        position.y = ground;
        const orientation = player.state.orientation
          .clone()
          .setFromUnitVectors(new forward.constructor(0, 0, -1), forward);
        for (const body of sim.cars) {
          sim.setCarPhysicsActive(body, body === player);
          body.input.throttle = body.input.steer = 0;
          body.input.brake = body.input.handbrake = false;
          body.state.velocity.set(0, 0, 0);
          body.state.angularVelocity.set(0, 0, 0);
        }
        const fleet = c.opponentFleet?.update?.bind(c.opponentFleet);
        if (fleet)
          c.opponentFleet.update = (...args) => {
            fleet(...args);
            for (const body of sim.cars)
              sim.setCarPhysicsActive(body, body === player);
          };
        player.state.position.copy(position);
        player.state.orientation.copy(orientation);
        player.state.heading = Math.atan2(-forward.x, -forward.z);
        sim.reset(player);
        player.state.velocity
          .copy(sideImpact ? wallIn : forward)
          .multiplyScalar(setupSpeed);
        trace.fixture = {
          initial: {
            player: player.group.name,
            playerId: player.group.uuid,
            playerDriver: player.state.driver ?? 8,
            health: player.state.health,
            levels: [...player.damage.componentLevels],
          },
          wallMaterial: best.surface.material,
          faceCenter: best.center.toArray(),
          faceNormal: best.normal.toArray(),
          distance: best.distance,
          candidateCount: candidates.length,
          cornerAngle,
          sideImpact,
          setupSpeed,
          steeringProgram: player.damage.damagePrograms?.programs?.steering,
          setupVelocity: player.state.velocity.toArray(),
        };
        trace.until = sim.elapsed + 8;
        c.paused = false;
        return trace.fixture;
      },
      { label, cornerAngle, setupSpeed, sideImpact },
    );
    await page.locator("#view").click({ position: { x: 640, y: 400 } });
    await page.keyboard.down("w");
    await page.waitForFunction(
      () => {
        const c = window.carma;
        const trace = window.__componentSmokeTrace;
        return (
          trace.componentRequests.some(
            (request) => request.actorId === trace.playerId,
          ) ||
          c.player.knackered ||
          c.simulation.elapsed >= trace.until
        );
      },
      null,
      { timeout: 12000 },
    );
    await page.keyboard.up("w");
    const canRepair = await page.evaluate(() => {
      const c = window.carma;
      const trace = window.__componentSmokeTrace;
      const request = trace.componentRequests.find(
        (entry) => entry.actorId === trace.playerId && !entry.knackered,
      );
      if (!request || c.player.knackered) return false;
      trace.eHeld = true;
      c.paused = false;
      trace.eRepairUntil = c.simulation.elapsed + 1;
      return true;
    });
    if (canRepair) {
      await page.keyboard.down("e");
      await page.waitForFunction(
        (until) => window.carma.simulation.elapsed >= until,
        await page.evaluate(() => window.__componentSmokeTrace.eRepairUntil),
        { timeout: 10000 },
      );
      await page.keyboard.up("e");
    }
    await page.evaluate(() => {
      window.carma.paused = true;
      document.querySelector("#panel").hidden = true;
    });
    await page.screenshot({
      path: `artifacts/browser-component-smoke-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
    });
    const fullRepairGrant =
      label === "Eagle3 vs original Newcity wall" && canRepair
        ? await page.evaluate(() => {
            const c = window.carma;
            const trace = window.__componentSmokeTrace;
            const index = c.powerups.definitions.findIndex(
              (definition) => definition.action === 7,
            );
            if (index < 0) return { found: false };
            const granted = c.powerups.grant(
              index,
              c.vehicle,
              c.race,
              (event) => {
                trace.powerupEvents.push({
                  kind: event.kind,
                  action: event.definition.action,
                  name: event.name,
                });
                if (event.kind === "repair") c.simulation.repair(c.player);
              },
            );
            return { found: true, index, granted };
          })
        : null;
    const details = await page.evaluate(() => {
      const c = window.carma;
      const trace = window.__componentSmokeTrace;
      c.paused = true;
      trace.eHeld = false;
      document.querySelector("#panel").hidden = true;
      const gl = document.querySelector("#view").getContext("webgl2");
      const glErrors = [];
      for (let i = 0; i < 32; i++) {
        const value = gl.getError();
        if (value === gl.NO_ERROR) break;
        glErrors.push(value);
      }
      return {
        label: trace.label,
        fixture: trace.fixture,
        playerId: trace.playerId,
        rivalId: null,
        impacts: trace.impacts,
        impactDamageEvents: trace.impactDamageEvents,
        damageCalls: trace.damageCalls,
        componentRequests: trace.componentRequests,
        columnEvents: trace.columnEvents,
        shortenCalls: trace.shortenCalls,
        fullRepairEvents: trace.fullRepairEvents,
        powerupEvents: trace.powerupEvents,
        knackeredSmokeEvents: trace.knackeredSmokeEvents,
        wastedEvents: trace.wastedEvents,
        attempts: [],
        glErrors,
      };
    });
    details.fullRepairGrant = fullRepairGrant;
    report.cases.push(details);
    if (
      !sideImpact &&
      !details.componentRequests.some(
        (request) => request.actorId === details.playerId,
      )
    )
      report.unmet.push(
        "real Newcity wall did not request a component smoke column",
      );
    if (details.glErrors.length)
      report.unmet.push(
        `Newcity wall WebGL errors ${details.glErrors.join(",")}`,
      );
    return details;
  }

  await runCarCase("Eagle3 vs original rival", catalog.eagle);
  await runCarCase("Buggy vs original rival", catalog.buggy);
  await runWallCase("Eagle3 vs original Newcity wall", catalog.eagle, 0, 8);
  await runWallCase(
    "Buggy vs original Newcity front-corner wall",
    catalog.buggy,
    0.35,
    10,
  );
  await runWallCase(
    "Eagle3 vs original Newcity side wall",
    catalog.eagle,
    0,
    8.2,
    true,
  );
  const requests = report.cases.flatMap((item) => item.componentRequests);
  const acceptedPreWasted = requests.filter(
    (request) =>
      !request.knackered &&
      request.sampled &&
      Number.isInteger(request.index) &&
      request.index >= 0 &&
      request.candidateComponents.length > 0,
  );
  const requestedLevels = acceptedPreWasted.flatMap((request) =>
    request.candidateComponents.map((component) => ({
      component,
      level: request.componentLevels[component],
      colour: request.colourRequested,
      driver: request.driver,
      actor: request.actor,
      vertex: request.vertex,
    })),
  );
  report.tierCoverage = {
    engine: [40, 60, 80].map((threshold) => ({
      threshold,
      reached: requestedLevels.some(
        (entry) => entry.component === 0 && entry.level >= threshold,
      ),
    })),
    steering: [70, 80, 90].map((threshold) => ({
      threshold,
      reached: requestedLevels.some(
        (entry) => entry.component === 3 && entry.level >= threshold,
      ),
    })),
    requestedLevels,
  };
  report.uncoveredTiers = [
    ...report.tierCoverage.engine
      .filter((tier) => !tier.reached)
      .map((tier) => ({ system: "engine", threshold: tier.threshold })),
    ...report.tierCoverage.steering
      .filter((tier) => !tier.reached)
      .map((tier) => ({ system: "steering", threshold: tier.threshold })),
  ];
  report.coverageComplete = report.uncoveredTiers.length === 0;
  const acceptedMode1 = acceptedPreWasted.some((request) =>
    report.cases.some((item) =>
      item.columnEvents.some(
        (column) =>
          column.actorId === request.actorId &&
          column.mode === 1 &&
          column.vertex === request.vertex &&
          column.index === request.index &&
          column.sampled &&
          column.samplePosition?.every(Number.isFinite) &&
          Number.isInteger(column.index) &&
          column.index >= 0,
      ),
    ),
  );
  if (!acceptedMode1)
    report.unmet.push(
      "no accepted pre-knackered mode1 fire column with finite vertex sample",
    );
  report.preKnackeredMode1 = acceptedMode1;
  if (
    !report.cases.some((item) =>
      item.shortenCalls.some(
        (event) =>
          event.eHeld && event.matchingPlayerCar && event.maximumMs === 2000,
      ),
    )
  )
    report.unmet.push(
      "held E did not shorten the matching smoke source to 2000ms",
    );
  const fullRepairCase = report.cases.find(
    (item) => item.fullRepairGrant?.found,
  );
  if (
    !fullRepairCase?.fullRepairGrant?.granted ||
    !fullRepairCase.powerupEvents?.some((event) => event.kind === "repair") ||
    !fullRepairCase.fullRepairEvents?.length
  )
    report.unmet.push(
      "ordinary action7 repair powerup did not reach the full-repair smoke callback",
    );
  report.ordinaryRepairCallback = Boolean(
    fullRepairCase?.fullRepairGrant?.granted &&
      fullRepairCase.powerupEvents?.some((event) => event.kind === "repair") &&
      fullRepairCase.fullRepairEvents?.length,
  );
  report.heldEShortening = report.cases.some((item) =>
    item.shortenCalls.some(
      (event) =>
        event.eHeld && event.matchingPlayerCar && event.maximumMs === 2000,
    ),
  );
  const lifecyclePairs = report.cases.flatMap((item) =>
    item.knackeredSmokeEvents.flatMap((knackered) =>
      item.wastedEvents
        .filter((wasted) => wasted.actorId === knackered.actorId)
        .map((wasted) => ({
          actor: knackered.actor,
          knackeredOrder: knackered.order,
          wastedOrder: wasted.order,
          knackeredHealth: knackered.health,
          wastedHealth: wasted.health,
        })),
    ),
  );
  report.knackeredBeforeDelayedWasted = lifecyclePairs.some(
    (pair) => pair.knackeredOrder < pair.wastedOrder,
  );
  report.lifecyclePairs = lifecyclePairs;
  if (!report.knackeredBeforeDelayedWasted)
    report.unmet.push(
      "no same-actor capture proved synchronous knackered smoke precedes delayed Wasted callback",
    );
  if (!report.heldEShortening)
    report.unmet.push(
      "held E did not shorten the matching smoke source to 2000ms",
    );
  report.zeroWebglErrors = report.cases.every(
    (item) => item.glErrors.length === 0,
  );
  if (!report.zeroWebglErrors)
    report.unmet.push("one or more browser cases reported WebGL errors");
  report.fullRepairEvents = report.cases.flatMap(
    (item) => item.fullRepairEvents,
  );
  await writeFile(
    "artifacts/browser-component-smoke.json",
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
    "component smoke did not meet actual-impact checks; see artifacts/browser-component-smoke.json",
  );
  console.log(
    `PASS component-smoke browser QA: ${report.cases.length} original-car impact cases; artifacts/browser-component-smoke.json`,
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
