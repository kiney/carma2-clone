import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP combat browser checks: Chromium or original installation absent",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const port = 5215;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "",
  browser;
server.stdout.on("data", (data) => (log += data));
server.stderr.on("data", (data) => (log += data));
const report = {
  repulsion: null,
  pedestrians: [],
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
    if (server.exitCode !== null) throw new Error(log);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, log);
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
  await page.evaluate(async () => {
    const c = window.carma;
    document.querySelector("#track-select").value = c.assets.resolve(
      "data/RACES/newcity1/newcity1.txt",
    );
    document.querySelector("#car-select").value = c.assets.resolve(
      "data/CARS/EAGLE3/EAGLE3.TXT",
    );
    await c.loadRace();
    c.paused = true;
  });
  await page.waitForFunction(
    () => window.carma.stats.ready && window.carma.opponentsReady,
    null,
    { timeout: 90000 },
  );
  await page.click("#debug-button");
  await page.waitForFunction(
    () => document.querySelector("#debug-enabled").checked,
  );
  const index = await page.evaluate(
    () => window.carma.powerups.definitions.find((d) => d.action === 38)?.index,
  );
  assert.equal(index, 56, "original opponent repulsificator definition");
  await page.selectOption("#debug-powerup", String(index));
  await page.click("#debug-grant");
  await page.evaluate((index) => {
    const c = window.carma,
      p = c.player,
      target = c.rivals[0].body;
    if (!target) throw new Error("No original opponent loaded");
    c.powerups.selectedAbility = index;
    p.state.position.set(1000, 20, 1000);
    p.state.velocity.set(0, 0, 0);
    target.state.position
      .copy(p.state.position)
      .add(new p.state.position.constructor(3.5, 0, 0));
    target.state.velocity.set(0, 0, 0);
    target.state.angularVelocity.set(0, 0, 0);
    c.simulation.setCarPhysicsActive(target, false);
    for (const r of c.rivals.slice(1))
      r.body.state.position.set(2000, 20, 2000);
    window.__repulsionTarget = target;
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.code !== "KeyF") return;
        const t = window.__repulsionTarget;
        window.__repulsionBefore = {
          source: p.properties.centerOfMass
            .clone()
            .applyQuaternion(p.state.orientation)
            .add(p.state.position)
            .toArray(),
          target: t.properties.centerOfMass
            .clone()
            .applyQuaternion(t.state.orientation)
            .add(t.state.position)
            .toArray(),
          velocity: t.state.velocity.toArray(),
          charges: c.powerups.abilities.get(index).charges,
        };
      },
      { capture: true, once: true },
    );
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.code === "KeyF") c.paused = true;
      },
      { once: true },
    );
  }, index);
  // Real Chromium key input reaches the normal F handler. Capture/pause hooks
  // bracket that event so a later AI/physics frame cannot obscure its impulse.
  await page.evaluate(() => {
    document.activeElement?.blur();
    window.carma.paused = false;
  });
  await page.keyboard.press("f");
  report.repulsion = await page.evaluate((index) => {
    const c = window.carma,
      t = window.__repulsionTarget;
    return {
      before: window.__repulsionBefore,
      velocity: t.state.velocity.toArray(),
      angularVelocity: t.state.angularVelocity.toArray(),
      active: c.simulation.isCarPhysicsActive(t),
      owner: t.lastAwardAttacker === c.player,
      cutoff: t.networkStateCutoffMs,
      charges: c.powerups.abilities.get(index)?.charges ?? 0,
      message: document.querySelector("#message")?.textContent ?? "",
    };
  }, index);
  const r = report.repulsion;
  assert.ok(r.before && r.active && r.owner, JSON.stringify(r));
  const delta = r.before.target.map((v, i) => v - r.before.source[i]);
  const distance = Math.hypot(...delta),
    factor = (7 - distance) / 7;
  const direction =
    distance > 2 ** -22 ? delta.map((v) => v / distance) : [1, 0, 0];
  if (Math.abs(direction[1]) < 0.1) direction[1] = 0.2;
  for (let i = 0; i < 3; i++)
    assert.ok(
      Math.abs(
        r.velocity[i] - r.before.velocity[i] - direction[i] * 12 * factor,
      ) < 1e-8,
      JSON.stringify(r),
    );
  assert.equal(r.charges, r.before.charges - 1);
  assert.ok(Number.isFinite(r.cutoff));
  assert.ok(r.angularVelocity.some((v) => Math.abs(v) > 0));
  await page.screenshot({ path: "artifacts/browser-combat-repulsion.png" });
  for (const action of [45, 37, 49, 31]) {
    await page.evaluate(async () => {
      await window.carma.loadRace();
      window.carma.paused = true;
    });
    await page.waitForFunction(
      () =>
        window.carma.stats.ready &&
        window.carma.pedestrians?.count > 0 &&
        window.carma.opponentsReady,
      null,
      { timeout: 90000 },
    );
    // Native ray timestamp zero denotes an unused slot. Let the normal game
    // clock advance before bracketing F on a paused controlled fixture.
    await page.evaluate(() => {
      window.carma.paused = false;
    });
    await page.waitForFunction(() => window.carma.stats.gameTimeMs >= 80);
    await page.evaluate(() => {
      window.carma.paused = true;
    });
    const index = await page.evaluate(
      (action) =>
        window.carma.powerups.definitions.find((d) => d.action === action)
          ?.index,
      action,
    );
    assert.ok(Number.isInteger(index), `original combat definition ${action}`);
    await page.selectOption("#debug-powerup", String(index));
    await page.click("#debug-grant");
    const setup = await page.evaluate(
      ({ index, action }) => {
        const c = window.carma,
          p = c.player,
          ps = c.pedestrians;
        const base = p.properties.centerOfMass
          .clone()
          .applyQuaternion(p.state.orientation)
          .add(p.state.position);
        // Controlled placement of original actors, followed by normal sight/cache
        // processing. No health, damage, reservation or combat state assignment.
        ps.reset();
        ps.group.children
          .filter((o) => o.name !== "ped-blood")
          .slice(0, ps.count)
          .forEach((o, i) =>
            o.position
              .copy(base)
              .add(
                i === 0
                  ? new base.constructor(0, 0, -1.2).applyQuaternion(
                      p.state.orientation,
                    )
                  : new base.constructor(500 + i, 0, 0),
              ),
          );
        for (const car of c.simulation.cars)
          c.simulation.setCarPhysicsActive(car, false);
        const farCar = base.clone().add(new base.constructor(0, 0, 100));
        ps.update(
          0,
          { position: farCar, velocity: p.state.velocity, yaw: 0, speed: 0 },
          {
            cameraPosition: base,
            gameTimeMs: c.stats.gameTimeMs,
            combatPosition: base,
            combatOwner: p,
          },
        );
        c.powerups.selectedAbility = index;
        window.__combatFixture = { base, index, action, farCar };
        return {
          index,
          action,
          beforeHits: ps.hits,
          beforeCredits: c.race.credits,
          before: ps.states[0],
          beforeCharges: c.powerups.abilities.get(index)?.charges ?? 0,
          electric: c.powerups.electricRayDistanceSquared,
        };
      },
      { index, action },
    );
    if (action !== 31) {
      await page.evaluate(() => {
        document.activeElement?.blur();
        window.addEventListener(
          "keydown",
          (e) => {
            if (e.code === "KeyF") window.carma.paused = true;
          },
          { once: true },
        );
        window.carma.paused = false;
      });
      await page.keyboard.press("f");
    }
    const result = await page.evaluate((action) => {
      const c = window.carma,
        p = c.player,
        ps = c.pedestrians,
        f = window.__combatFixture;
      // Advance the same public pedestrian runtime with native frame/tick
      // clocks; the F handler above performs the actual command dispatch.
      ps.update(
        0,
        { position: f.farCar, velocity: p.state.velocity, yaw: 0, speed: 0 },
        {
          cameraPosition: f.base,
          combatPosition: f.base,
          combatOwner: p,
          gameTimeMs: c.stats.gameTimeMs,
          framePeriodMs: 40,
          physicsTickMs: Math.round(c.simulation.elapsed * 1000) >>> 0,
          electricRayDistanceSquared: c.powerups.electricRayDistanceSquared,
        },
      );
      return {
        action,
        hits: ps.hits,
        credits: c.race.credits,
        state: { ...ps.states[0], combatOwner: ps.states[0].combatOwner === p },
        stats: {
          ...ps.combatStats,
          bolts: ps.combatStats.bolts.map((b) => ({
            slot: b.slot,
            position: b.position.toArray(),
            owner: b.owner === p,
            target: b.target.name,
          })),
        },
        charges: c.powerups.abilities.get(f.index)?.charges ?? 0,
        electric: c.powerups.electricRayDistanceSquared,
        message: document.querySelector("#message").textContent,
      };
    }, action);
    if (action === 45) {
      assert.equal(result.state.alive, true);
      assert.equal(result.state.corporeal, true);
      assert.equal(result.state.moveId, 91);
      assert.ok(result.state.velocity.y > 0);
      assert.equal(result.hits, setup.beforeHits);
      assert.equal(result.stats.repulseRays, 1);
    } else if (action === 37 || action === 31) {
      assert.equal(
        result.state.alive,
        false,
        JSON.stringify({ setup, result }),
      );
      assert.equal(result.hits, setup.beforeHits + 1);
      assert.ok(result.credits > setup.beforeCredits);
      assert.equal(result.stats.proximityRays, 1);
    } else {
      assert.equal(
        result.stats.bolts.length,
        1,
        JSON.stringify({ setup, result }),
      );
      assert.equal(result.stats.reserved, 1);
      assert.equal(result.state.alive, true);
      assert.equal(result.hits, setup.beforeHits);
    }
    if (action === 49) {
      const fire = await page.evaluate(() => {
        const c = window.carma,
          ps = c.pedestrians,
          f = window.__combatFixture,
          start = c.stats.gameTimeMs;
        let ignitedAt, initialColumn;
        for (let step = 1; step <= 100; step++) {
          const now = Math.trunc(start) + step * 40;
          ps.update(
            0,
            {
              position: f.farCar,
              velocity: c.player.state.velocity,
              yaw: 0,
              speed: 0,
            },
            {
              cameraPosition: f.base,
              combatPosition: f.base,
              combatOwner: c.player,
              gameTimeMs: now,
              framePeriodMs: 40,
            },
          );
          c.smoke.update(now, 40);
          if (ps.states[0].burningUntilMs && ignitedAt === undefined) {
            ignitedAt = now;
            initialColumn = c.smoke.snapshot().columns.find((x) => x.active);
          }
          if (ignitedAt !== undefined && now - ignitedAt > 400) break;
        }
        return {
          ignitedAt,
          burning: ps.states[0].burningUntilMs,
          stats: c.smoke.stats,
          initialColumn,
          after: c.smoke.snapshot(),
          diagnostics: c.smoke.diagnostics,
        };
      });
      assert.ok(fire.ignitedAt !== undefined, JSON.stringify(fire));
      assert.equal(fire.burning - fire.ignitedAt, 15000);
      assert.ok(fire.stats.columns > 0, JSON.stringify(fire));
      assert.ok(fire.stats.puffs > 0, JSON.stringify(fire));
      assert.ok(fire.initialColumn.remaining >= 24960);
      assert.ok(fire.stats.flameSprites > 0, JSON.stringify(fire));
      result.fire = fire;
    }
    if (action !== 31) assert.equal(result.charges, setup.beforeCharges - 1);
    else assert.equal(result.electric, 12.25);
    report.pedestrians.push({ setup, result });
    await page.evaluate(() => {
      document.querySelector("#panel").hidden = true;
      document.querySelector("#debug-panel").hidden = true;
    });
    await page.screenshot({
      path: `artifacts/browser-combat-ped-${action}.png`,
    });
    await page.evaluate(() => {
      document.querySelector("#debug-panel").hidden = false;
    });
  }
  report.glError = await page.evaluate(() =>
    document.querySelector("#view").getContext("webgl2").getError(),
  );
  assert.equal(report.glError, 0);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  await writeFile(
    "artifacts/browser-combat-powerups.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
