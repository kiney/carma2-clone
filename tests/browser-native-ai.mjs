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
    "SKIP native AI browser regression: Chromium or C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5211;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
const report = { cases: [], errors: [], failedRequests: [] };
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
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });

  const catalogs = await page.evaluate(() => {
    const options = [...document.querySelector("#track-select").options];
    const find = (pattern) =>
      options.find((option) =>
        pattern.test(`${option.textContent} ${option.value}`),
      )?.value;
    return {
      stock: find(/NICE BEAVER/i),
      advanced: options.find(
        (option) =>
          /^adv_data\//i.test(option.value) &&
          /carrier2\/carrier2\.txt$/i.test(option.value),
      )?.value,
      snow: find(/snow/i),
      dune12: find(/dune.*12|12.*dune/i),
      eagle3: [...document.querySelector("#car-select").options].find(
        (option) =>
          /eagle\s*3|eagle3/i.test(`${option.textContent} ${option.value}`),
      )?.value,
    };
  });
  assert.ok(catalogs.stock, "stock NICE BEAVER mission absent");
  assert.ok(catalogs.advanced, "Advanced USS LEWINSKY race absent");
  assert.ok(catalogs.eagle3, "original Eagle 3 absent");
  const cases = [
    ["stock", catalogs.stock, 5],
    ["advanced", catalogs.advanced, 12],
  ];
  if (catalogs.snow) cases.push(["snow", catalogs.snow, null]);
  if (catalogs.dune12 && catalogs.dune12 !== catalogs.snow)
    cases.push(["dune12", catalogs.dune12, null]);

  for (const [name, trackPath, expectedCount] of cases.filter(
    ([name]) =>
      !process.env.CARMA_BROWSER_CASE ||
      name === process.env.CARMA_BROWSER_CASE,
  )) {
    await page.evaluate(
      async ({ trackPath, carPath }) => {
        const c = window.carma;
        document.querySelector("#track-select").value = trackPath;
        document.querySelector("#car-select").value = carPath;
        await c.loadRace();
        c.paused = true;
        document.querySelector("#panel").hidden = true;
      },
      { trackPath, carPath: catalogs.eagle3 },
    );
    await page.waitForFunction(() => window.carma.opponentsReady, null, {
      timeout: 90000,
    });
    await page.waitForFunction(
      () =>
        window.carma.opponentFleet?.snapshot?.rivals?.length ===
          window.carma.rivals.length && window.carma.rivals.length > 0,
      null,
      { timeout: 90000 },
    );
    const loaded = await page.evaluate(() => {
      const c = window.carma;
      const fleet = c.opponentFleet.snapshot;
      return {
        configured: c.raceDefinition?.numberOfOpponents,
        loaded: c.rivals.length,
        registered: fleet.rivals.length,
        physicsBodies: c.simulation.cars.length,
        fleetCount: fleet.rivals.length,
        personalities: [
          ...new Set(fleet.rivals.map((r) => r.personality)),
        ].sort(),
        catalogGrudges: fleet.catalogGrudges,
        initial: fleet.rivals.map((r) => ({
          identity: r.identity,
          physical: r.physical,
          cheating: r.cheating,
          personality: r.personality,
          nastiness: r.nastiness,
          objective: r.objective.objective,
          forces: r.forces,
        })),
        positions: c.rivals.map((r) => r.state.position.toArray()),
      };
    });
    assert.equal(
      loaded.registered,
      loaded.loaded,
      `${name}: incomplete fleet registration`,
    );
    if (expectedCount !== null)
      assert.equal(
        loaded.loaded,
        expectedCount,
        `${name}: authored opponent count`,
      );
    assert.ok(
      loaded.initial.every((r) => r.physical && !r.cheating),
      `${name}: initial native physics state ${JSON.stringify(loaded.initial)}`,
    );
    assert.ok(
      loaded.initial.every(
        (r) => Number.isFinite(r.nastiness) && r.nastiness > 0,
      ),
      `${name}: missing authored personality/nastiness`,
    );
    assert.ok(
      loaded.catalogGrudges.some((grudge) => grudge > 0),
      `${name}: catalog grudge state was not initialized`,
    );

    // Run this controlled clock/pose fixture from the untouched race start;
    // the native objective initializes its dispatcher on that first update.
    const transition = await page.evaluate(() => {
      const c = window.carma;
      const fleet = c.opponentFleet;
      const rival = fleet.snapshot.rivals.find((r) => r.physical);
      const body = c.rivals.find(
        (r) => r.body.group.uuid === rival?.identity,
      )?.body;
      if (!body)
        throw new Error("no physical native rival for transition fixture");
      const player = c.player;
      const originalPlayer = player.state.position.clone();
      const originalBody = body.state.position.clone();
      const base = fleet.snapshot.nowMs;
      const call = (now) => fleet.update(now, 16, 1, false);
      call(base + 100);
      player.state.position.add({ x: 500, y: 0, z: 0 });
      player.group.position.copy(player.state.position);
      call(base + 5000);
      const cheated = fleet.snapshot.rivals.find(
        (r) => r.identity === rival.identity,
      );
      player.state.position.copy(body.state.position);
      player.group.position.copy(player.state.position);
      call(base + 5016);
      const rematerialized = fleet.snapshot.rivals.find(
        (r) => r.identity === rival.identity,
      );
      player.state.position.copy(originalPlayer);
      player.group.position.copy(originalPlayer);
      body.state.position.copy(originalBody);
      body.group.position.copy(originalBody);
      body.group.updateMatrixWorld(true);
      return {
        cheated: {
          cheating: cheated.cheating,
          physical: cheated.physical,
          objective: cheated.objective.objective,
        },
        rematerialized: {
          cheating: rematerialized.cheating,
          physical: rematerialized.physical,
          objective: rematerialized.objective.objective,
        },
      };
    });
    assert.ok(
      transition.cheated.cheating && !transition.cheated.physical,
      `${name}: native cheating transition failed: ${JSON.stringify(transition)}`,
    );
    assert.ok(
      !transition.rematerialized.cheating && transition.rematerialized.physical,
      `${name}: native rematerialization transition failed: ${JSON.stringify(transition)}`,
    );

    // The synthetic visibility fixture advances fleet time by five seconds and
    // rematerializes a body directly onto the player. It is a separate scenario:
    // restore all simulation/history state by reloading before real-key driving.
    await page.evaluate(async () => {
      const c = window.carma;
      await c.loadRace();
      c.paused = true;
      document.querySelector("#panel").hidden = true;
    });
    await page.waitForFunction(() => window.carma.opponentsReady, null, {
      timeout: 90000,
    });

    await page.evaluate(() => {
      window.carma.paused = false;
    });
    await page.locator("#view").click();
    if (
      !(await page.locator("#debug-enabled").isChecked()) ||
      !(await page.locator("#debug-panel").isVisible())
    )
      await page.click("#debug-button");
    await page.waitForTimeout(1800);
    const moving = await page.evaluate((before) => {
      const c = window.carma;
      const snapshot = c.opponentFleet.snapshot;
      return {
        moved: c.rivals.some(
          (r, i) =>
            c.rivals[i].state.position.distanceTo({
              x: before[i][0],
              y: before[i][1],
              z: before[i][2],
            }) > 0.05,
        ),
        frames: c.stats.gameFrames,
        fleet: snapshot.rivals.map((r) => ({
          physical: r.physical,
          movedEver: r.movedEver,
          objective: r.objective.objective,
          forces: r.forces,
        })),
      };
    }, loaded.positions);
    assert.ok(
      moving.frames > 0 && moving.moved,
      `${name}: normal native AI did not move: ${JSON.stringify(moving)}`,
    );

    await page.selectOption("#debug-powerup", "15");
    await page.click("#debug-grant");
    await page.waitForTimeout(250);
    const freeze = await page.evaluate(
      () => window.carma.opponentFleet.snapshot,
    );
    assert.ok(
      freeze.rivals.every((r) => !r.physical || r.forces.accForce === 0),
      `${name}: freeze did not stop AI control forces`,
    );
    await page.waitForTimeout(450);
    const driveStart = await page.evaluate(() => ({
      position: window.carma.player.state.position.toArray(),
      frames: window.carma.stats.gameFrames,
    }));
    const playerStart = driveStart.position;
    await page.locator("#view").click();
    await page.keyboard.down("w");
    // Software WebGL can render only a few frames in 500 ms. Count actual
    // gameplay frames, rather than treating a wall-time sleep as simulation.
    await page.waitForFunction(
      (start) => window.carma.stats.gameFrames >= start + 12,
      driveStart.frames,
      { timeout: 20000 },
    );
    const heldInput = await page.evaluate(() => {
      const c = window.carma;
      const p = c.player,
        guard = c.simulation.advanceWorldContacts(p, true);
      const describe = (row) => ({
        normal: row.normal.toArray(),
        point: row.point.toArray(),
        impulse: row.normalImpulse,
        penetration: row.penetration,
        type: row.sourceType,
        actor: row.sourceSurface?.actor?.name,
        material: row.sourceSurface?.material,
        other: row.b?.actor?.name ?? row.b?.group?.name,
      });
      return {
        throttle: p.input.throttle,
        active: c.simulation.isCarPhysicsActive(p),
        wasted: p.knackered,
        components: p.damage.componentLevels,
        grounded: p.state.groundedWheelCount,
        position: p.state.position.toArray(),
        velocity: p.state.velocity.toArray(),
        omega: p.state.angularVelocity.toArray(),
        orientation: p.state.orientation.toArray(),
        worldRecovery: p.worldRecovery,
        worldOverlap: p.worldOverlapDetected,
        guard: {
          fraction: guard.fraction,
          crossing: guard.crossingFraction,
          contacts: guard.contacts.map(describe),
        },
        lastImpacts: c.simulation.lastImpacts
          .filter((i) => i.a === p || i.b === p)
          .slice(0, 12)
          .map(describe),
        focus: document.activeElement?.id,
        frames: c.stats.gameFrames,
      };
    });
    await page.keyboard.up("w");
    const playerEnd = await page.evaluate(() => {
      const c = window.carma;
      return {
        position: c.player.state.position.toArray(),
        velocity: c.player.state.velocity.toArray(),
        throttle: c.player.input.throttle,
        paused: c.paused,
        raceStatus: c.race.status,
        gameFrames: c.stats.gameFrames,
      };
    });
    assert.ok(
      Math.hypot(...playerEnd.position.map((v, i) => v - playerStart[i])) >
        0.01,
      `${name}: player did not drive while opponents were frozen: ${JSON.stringify({ playerStart, heldInput, playerEnd })}`,
    );
    await page.selectOption("#debug-powerup", "93");
    await page.click("#debug-grant");
    await page.waitForTimeout(250);
    const thaw = await page.evaluate(() => window.carma.opponentFleet.snapshot);
    assert.ok(
      thaw.rivals.some((r) => Math.abs(r.forces.accForce) > 0),
      `${name}: cancellation did not restore AI controls`,
    );

    report.cases.push({
      name,
      trackPath,
      loaded,
      moving,
      freezeCount: freeze.rivals.length,
      transition,
      drive: { playerStart, heldInput, playerEnd },
    });
    await page.evaluate(() => {
      document.querySelector("#panel").hidden = true;
      document.querySelector("#debug-panel").hidden = true;
    });
    await page.screenshot({ path: `artifacts/browser-native-ai-${name}.png` });
  }

  const webglErrors = await page.evaluate(() => {
    const gl = document.querySelector("#view").getContext("webgl2");
    if (!gl) throw new Error("WebGL2 context unavailable");
    const out = [];
    for (let i = 0; i < 16; i++) {
      const e = gl.getError();
      if (e === gl.NO_ERROR) break;
      out.push(e);
    }
    return out;
  });
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
  assert.deepEqual(webglErrors, [], `WebGL errors: ${webglErrors.join(",")}`);
  report.webglErrors = webglErrors;
  await writeFile(
    "artifacts/browser-native-ai-report.json",
    JSON.stringify({ catalogs, ...report }, null, 2),
  );
  console.log(JSON.stringify({ catalogs, ...report }, null, 2));
} catch (error) {
  report.failure = String(error?.stack || error);
  await writeFile(
    "artifacts/browser-native-ai-report.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
