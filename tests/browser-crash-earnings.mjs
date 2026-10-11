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
    "SKIP crash earnings browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5208;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
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
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`),
  );

  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.evaluate(async () => {
    const c = window.carma;
    const track = c.assets.resolve("data/RACES/desert2/desert2.txt");
    const car = c.assets.resolve("data/CARS/eaglegreen/EAGLEGREEN.TXT");
    if (!track || !car) throw new Error("DUNE or green Eagle asset is absent");
    document.querySelector("#track-select").value = track;
    document.querySelector("#car-select").value = car;
    await c.loadRace();
    c.paused = true;
  });
  await page.waitForFunction(() => window.carma.opponentsReady, null, {
    timeout: 90000,
  });

  const selection = await page.evaluate(() => {
    const c = window.carma;
    const a = c.player;
    const rivals = c.simulation.cars.filter((p) => p !== a && !p.human);
    const b =
      rivals.find((p) => p.group.name === "EAGLE3") ??
      [...rivals].sort(
        (x, y) =>
          Math.abs(x.properties.mass - a.properties.mass) -
          Math.abs(y.properties.mass - a.properties.mass),
      )[0];
    if (!b) throw new Error("No loaded original DUNE opponent for crash test");
    return {
      track: document.querySelector("#track-select").value,
      player: a.group.name,
      rival: b.group.name,
      humanMass: a.properties.mass,
      rivalMass: b.properties.mass,
      rivalCount: rivals.length,
      playerComponents: [...a.damage.componentLevels],
      rivalComponents: [...b.damage.componentLevels],
      crashDamageAwards: c.simulation.crashDamageAwards,
      raceStatus: c.race.status,
      worldReady: c.stats.ready,
      webgl: document.querySelector("#view").getContext("webgl2") !== null,
    };
  });
  assert.ok(selection.rivalCount > 0, JSON.stringify(selection));
  assert.ok(
    selection.rivalMass > 0 && selection.humanMass > 0,
    JSON.stringify(selection),
  );
  assert.ok(
    selection.crashDamageAwards,
    "original crash damage award table was not loaded",
  );
  assert.equal(selection.raceStatus, "racing");
  assert.ok(selection.webgl);

  const crashes = [];
  for (const offset of [0, 0.13]) {
    console.log(
      `Driving native crash earnings case with lateral offset ${offset}`,
    );
    const setup = await page.evaluate((offset) => {
      const c = window.carma;
      const a = c.player;
      const b =
        c.simulation.cars.find((p) => p !== a && p.group.name === "EAGLE3") ??
        c.simulation.cars
          .filter((p) => p !== a && !p.human)
          .sort(
            (x, y) =>
              Math.abs(x.properties.mass - a.properties.mass) -
              Math.abs(y.properties.mass - a.properties.mass),
          )[0];
      if (!b) throw new Error("Selected rival disappeared after race load");
      for (const p of c.simulation.cars) {
        c.simulation.setCarPhysicsActive(p, p === a || p === b);
        p.input.throttle = 0;
        p.input.steer = 0;
        p.input.brake = false;
        p.state.velocity.set(0, 0, 0);
        p.state.angularVelocity.set(0, 0, 0);
        p.crashAccelerationKey = false;
      }
      // Keep the real AI update loop alive while preventing it from steering
      // or accelerating the selected victim during this controlled impact.
      for (const rival of c.rivals) {
        if (rival.body === b) {
          rival.navigator.update = () => ({
            throttle: 0,
            steer: 0,
            brake: false,
            handbrake: false,
          });
          rival.speedController.update = () => ({ accForce: 0, brakeForce: 0 });
        }
      }
      if (c.opponentFleet) {
        const update = c.opponentFleet.update.bind(c.opponentFleet);
        c.opponentFleet.update = (...args) => {
          update(...args);
          // The native brain stays live; isolate this numerical impact from
          // other cars and hold only the selected victim's controls neutral.
          for (const rival of c.rivals)
            c.simulation.setCarPhysicsActive(rival.body, rival.body === b);
          b.state.accForce = b.state.brakeForce = b.state.curvature = 0;
          b.input.throttle = b.input.steer = b.input.brake = 0;
        };
      }
      const origin = a.state.position.clone();
      const forward = new a.state.position.constructor(0, 0, -1)
        .applyQuaternion(a.state.orientation)
        .normalize();
      const up = new a.state.position.constructor(0, 1, 0);
      const right = up.clone().cross(forward).normalize();
      const heading = a.state.heading;
      a.state.position.copy(origin);
      a.state.heading = heading;
      c.simulation.reset(a);
      b.state.position
        .copy(origin)
        .addScaledVector(forward, 5.0)
        .addScaledVector(right, offset);
      b.state.heading = heading + Math.PI;
      c.simulation.reset(b);
      b.state.velocity.set(0, 0, 0);
      b.state.angularVelocity.set(0, 0, 0);
      const record = {
        offset,
        player: a.group.name,
        rival: b.group.name,
        rivalMass: b.properties.mass,
        startPlayer: a.state.position.toArray(),
        startRival: b.state.position.toArray(),
        startPlayerComponents: [...a.damage.componentLevels],
        startRivalComponents: [...b.damage.componentLevels],
        startCredits: c.race.credits,
        startTimeLeft: c.race.timeLeft,
        crashAccelerationKeyObserved: false,
        attribution: [],
        awards: [],
      };
      const sim = c.simulation;
      const oldBeforeStep = sim.onBeforeStep;
      sim.onBeforeStep = (...args) => {
        oldBeforeStep?.(...args);
        record.crashAccelerationKeyObserved ||= a.crashAccelerationKey;
      };
      const oldAttribution = sim.onCrashAttribution;
      sim.onCrashAttribution = (attacker, victim) => {
        record.attribution.push({
          attacker: attacker.group.name,
          victim: victim.group.name,
          attackerComponentsBeforeRedistribution: [
            ...attacker.damage.componentLevels,
          ],
          victimComponentsBeforeRedistribution: [
            ...victim.damage.componentLevels,
          ],
          attackerLastComponents: [...attacker.damage.lastComponentLevels],
          victimLastComponents: [...victim.damage.lastComponentLevels],
          attackerCrashRecord: { ...attacker.crashRecord },
          victimCrashRecord: { ...victim.crashRecord },
        });
        oldAttribution?.(attacker, victim);
      };
      const oldAward = sim.onCrashDamageAward;
      sim.onCrashDamageAward = (victim, credits, seconds, multiplier) => {
        record.awards.push({
          victim: victim.group.name,
          credits,
          seconds,
          multiplier,
          componentsAfterAttribution: [...victim.damage.componentLevels],
        });
        oldAward?.(victim, credits, seconds, multiplier);
      };
      window.__nativeCrashCase = record;
      window.__nativeCrashPair = { a, b };
      window.__nativeCrashUntil = sim.elapsed + 15;
      c.paused = false;
      return { elapsed: sim.elapsed };
    }, offset);

    await page.keyboard.down("w");
    await page.waitForFunction(
      () =>
        window.__nativeCrashCase?.attribution.length > 0 ||
        window.carma.simulation.elapsed >= window.__nativeCrashUntil,
      null,
      { timeout: 25000 },
    );
    await page.keyboard.up("w");
    const result = await page.evaluate(() => {
      const c = window.carma;
      c.paused = true;
      const record = window.__nativeCrashCase;
      const { a, b } = window.__nativeCrashPair;
      record.endElapsed = c.simulation.elapsed;
      record.playerCrashAccelerationKey = a.crashAccelerationKey;
      record.playerComponents = [...a.damage.componentLevels];
      record.rivalComponents = [...b.damage.componentLevels];
      record.playerDamageRevision = a.damage.deformationRevision;
      record.rivalDamageRevision = b.damage.deformationRevision;
      record.playerWasted = a.knackered || a.damage.wasted;
      record.rivalWasted = b.knackered || b.damage.wasted;
      record.rivalWastedByPlayer = b.wastedByPlayer;
      record.playerPosition = a.state.position.toArray();
      record.rivalPosition = b.state.position.toArray();
      record.credits = c.race.credits;
      record.timeLeft = c.race.timeLeft;
      record.raceStatus = c.race.status;
      record.worldReady = c.stats.ready;
      record.rendered =
        document.querySelector("#view").width > 0 &&
        document.querySelector("#view").height > 0;
      record.finalDamageDelta = record.rivalComponents.reduce(
        (sum, value, index) =>
          sum + Math.max(0, value - record.startRivalComponents[index]),
        0,
      );
      record.creditDelta = record.credits - record.startCredits;
      return record;
    });
    assert.ok(result.endElapsed > setup.elapsed, JSON.stringify(result));
    assert.ok(
      result.crashAccelerationKeyObserved,
      "W did not reach native crash acceleration state",
    );
    assert.ok(
      result.attribution.some(
        (event) =>
          event.attacker === result.player && event.victim === result.rival,
      ),
      JSON.stringify(result),
    );
    assert.ok(result.finalDamageDelta > 0, JSON.stringify(result));
    assert.ok(
      result.playerDamageRevision + result.rivalDamageRevision > 0,
      JSON.stringify(result),
    );
    assert.ok(result.awards.length > 0, JSON.stringify(result));
    assert.ok(
      result.awards.some((award) => award.credits > 0),
      JSON.stringify(result),
    );
    assert.ok(result.creditDelta > 0, JSON.stringify(result));
    assert.equal(result.raceStatus, "racing", JSON.stringify(result));
    assert.ok(result.worldReady && result.rendered, JSON.stringify(result));

    await page.evaluate(() => {
      document.querySelector("#panel").hidden = true;
    });
    await page.screenshot({
      path: `artifacts/browser-crash-earnings-impact-${offset === 0 ? "headon" : "oblique"}.png`,
    });

    if (!result.playerWasted) {
      await page.evaluate(() => {
        const a = window.carma.player;
        window.__reverseCrashStart = a.state.position.clone();
        window.carma.paused = false;
      });
      await page.keyboard.down("ArrowDown");
      await page
        .waitForFunction(
          (until) => window.carma.simulation.elapsed >= until,
          result.endElapsed + 5,
          { timeout: 15000 },
        )
        .catch(async () => {
          // simulation.elapsed may be reset only by a race reload; fall back to movement.
          await page.waitForFunction(
            () =>
              window.carma.player.state.position.distanceTo(
                window.__reverseCrashStart,
              ) > 0.5,
            null,
            { timeout: 10000 },
          );
        });
      await page.keyboard.up("ArrowDown");
      const reverse = await page.evaluate(() => {
        const c = window.carma;
        c.paused = true;
        return {
          travel: c.player.state.position.distanceTo(
            window.__reverseCrashStart,
          ),
          position: c.player.state.position.toArray(),
          gear: c.player.state.gear,
          wasted: c.player.knackered || c.player.damage.wasted,
        };
      });
      result.reverse = reverse;
      assert.ok(reverse.travel > 0.5, JSON.stringify({ result, reverse }));
    }
    crashes.push(result);
    await page.screenshot({
      path: `artifacts/browser-crash-earnings-${offset === 0 ? "headon" : "oblique"}.png`,
    });
  }

  const glError = await page.evaluate(() =>
    document.querySelector("#view").getContext("webgl2").getError(),
  );
  assert.equal(glError, 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  const report = { selection, crashes, errors, failedRequests, glError };
  await writeFile(
    "artifacts/browser-crash-earnings.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
