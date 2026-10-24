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
    "SKIP escaped-body browser checks: Chromium or original data absent.",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const port = 5258;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "",
  browser;
server.stdout.on("data", (data) => (logs += data));
server.stderr.on("data", (data) => (logs += data));
const report = {
  fixture:
    "Controlled post-release original props with far escaped finite poses and extreme spin; source mechanics/resources retained. Not a reproduction of the unknown initiating impulse.",
  backend: "SwiftShader correctness only",
  cases: [],
  errors: [],
  failedRequests: [],
};
try {
  for (let i = 0; i < 200; i++) {
    if (server.exitCode !== null) throw Error(logs);
    try {
      if ((await fetch(`http://localhost:${port}/api/manifest`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
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
  page.on("requestfailed", (r) => report.failedRequests.push(r.url()));
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  for (const target of [
    "data/RACES/timber2/timber2.txt",
    "adv_data/RACES/Carrier1/Carrier1.txt",
  ]) {
    await page.evaluate(async (target) => {
      const c = carma,
        t = document.querySelector("#track-select");
      const selected = [...t.options].find(
        (o) => o.value.toLowerCase() === target.toLowerCase(),
      );
      if (!selected) throw Error(`Original race absent: ${target}`);
      t.value = selected.value;
      await c.loadRace();
      c.paused = true;
    }, target);
    await page.waitForFunction(
      () => carma.stats.ready && carma.opponentsReady,
      null,
      { timeout: 90000 },
    );
    const result = await page.evaluate(() => {
      const c = carma,
        s = c.simulation,
        bounds = c.collision.escapeBounds;
      if (!bounds) throw Error("No authored containment bounds");
      const chosen = s.noncars
        .filter(
          (b) => !b.mechanics.worldJoint && !b.mechanics.ignoreWorldCollisions,
        )
        .slice(0, 6);
      if (chosen.length !== 6) throw Error("Insufficient original world props");
      const identities = chosen.map((b) => ({
        actor: b.actor,
        mechanics: b.mechanics,
        hulls: b.hulls,
      }));
      for (let i = 0; i < chosen.length; i++) {
        const b = chosen[i];
        if (!s.admitNonCar(b, { wake: true, resetVelocity: false }))
          throw Error("Prop admission failed");
        // Model the captured free post-release state, not an authored joint.
        b.attached = false;
        b.joint = undefined;
        b.state.position.set(bounds.max.x + 100000 + i, 800000, -300000);
        b.state.velocity.set(4500, 30900, -11600);
        b.state.angularVelocity.set(717744, 289227, 454739);
      }
      const retired = s.containEscapedBodies();
      if (retired !== 6) throw Error(`Only ${retired} escaped props retired`);
      chosen.forEach((b, i) => {
        if (
          s.isNonCarPhysicsActive(b) ||
          s.phil.getHeader(b) ||
          b.actor.visible
        )
          throw Error("Escaped prop still participates");
        if (
          b.actor !== identities[i].actor ||
          b.mechanics !== identities[i].mechanics ||
          b.hulls !== identities[i].hulls
        )
          throw Error("Original identity lost");
        if (s.admitNonCar(b, { wake: true }))
          throw Error("Escaped prop readmitted");
      });
      const before = s.elapsed;
      s.step();
      if (!(s.elapsed > before))
        throw Error("Simulation stopped after retirement");
      return {
        retired,
        actors: chosen.map((b) => b.actor.name),
        counts: { ...s.escapedBodyCounts },
        census: s.nonCarCensus(),
        glError: c.renderer.getContext().getError(),
      };
    });
    assert.equal(result.glError, 0);
    const start = await page.evaluate(() => {
      carma.paused = false;
      return carma.player.state.position.toArray();
    });
    await page.keyboard.down("w");
    await page.waitForTimeout(600);
    await page.keyboard.up("w");
    result.drive = await page.evaluate((start) => {
      carma.paused = true;
      const p = carma.player.state.position;
      return {
        distance: Math.hypot(p.x - start[0], p.y - start[1], p.z - start[2]),
        gameFrames: carma.stats.gameFrames,
        glError: carma.renderer.getContext().getError(),
      };
    }, start);
    assert.ok(result.drive.distance > 0.01);
    assert.equal(result.drive.glError, 0);
    report.cases.push({ target, ...result });
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  await writeFile(
    "artifacts/browser-escaped-bodies.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    "PASS Stock Timber and Advanced Carrier escaped-body retirement, identity/slots and continued driving",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
