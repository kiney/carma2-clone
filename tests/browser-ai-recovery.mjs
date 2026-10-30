import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

// Kept self-contained so the identical controlled-clock fixture can also run
// through DevTools in a hardware-rendered browser. Main gameplay stays paused;
// real loaded cars, road data and placement callbacks remain in use.
export function recoveryScenario() {
  const c = window.carma;
  c.paused = true;
  const fleet = c.opponentFleet;
  const body = c.rivals[0].body;
  const record = fleet.rivals.get(body.group.uuid);
  const playerStart = c.player.state.position.clone();
  const bodyStart = body.state.position.clone();
  const base = fleet.snapshot.nowMs;
  const states = [];
  const require = (condition, message) => {
    if (!condition) throw new Error(`AI-04: ${message}`);
  };
  const state = () =>
    fleet.snapshot.rivals.find((r) => r.identity === body.group.uuid);
  const remember = (label) => {
    const s = state();
    states.push({
      label,
      now: fleet.snapshot.nowMs,
      objective: s.objective,
      physical: s.physical,
      cheating: s.cheating,
      followCheating: s.follow.cheating,
      struggleStartMs: record.follow.physicalFollower.struggleStartMs,
      struggleCount: record.follow.physicalFollower.struggleCount,
      forces: s.forces,
      position: body.state.position.toArray(),
    });
  };
  // Do not allow an unrelated sighting/pursuit to preempt the recovery under
  // examination. Physical ground and placement queries remain the real ones.
  fleet.hooks.rayFraction = () => 0;
  record.personality = 1;
  body.state.velocity.set(0.05, 0, 0);
  c.player.state.position.copy(body.state.position);
  fleet.update(base + 100, 16, 1, false);
  body.state.velocity.set(0, 0, 0);
  require(state()
    .movedEver, "initial motion did not open the native struggle gate");
  fleet.update(base + 2101, 16, 1, false);
  fleet.update(base + 2117, 16, 1, false);
  require(record.follow.physicalFollower.struggleCount ===
    0, "not count-zero struggle");
  require(body.state.accForce ===
    Math.fround(
      -6 * Math.fround(body.properties.mass),
    ), "missing reverse force");
  remember("physical-count-zero");
  const deadline = state().objective.deadlineMs;
  fleet.update(deadline, 16, 1, false);
  require(state().objective.startMs ===
    base + 100, "objective restarted at deadline equality");
  fleet.update(deadline + 1, 16, 1, false);
  require(state().objective.startMs ===
    deadline + 1, "objective failed to restart after deadline");
  require(record.follow.physicalFollower.struggleStartMs ===
    0, "restart retained active struggle");
  remember("objective-restart");

  // Borrowed give-up must preserve actual car fields, not the prior follower's
  // acceleration. Only this late state is injected: the unsigned count-zero
  // phase cannot naturally finish during a short fixture.
  record.follow.physicalFollower.madeIt = false;
  record.follow.physicalFollower.borrowedStartMs = deadline - 10000;
  body.state.accForce = 7;
  body.state.brakeForce = 8;
  fleet.update(deadline + 2, 16, 1, false);
  require(body.state.accForce === 7 &&
    body.state.brakeForce === 8, "borrowed give-up restored stale forces");
  remember("borrowed-restart");

  // A real remote transition runs physics-off and cheaty movement; return near
  // the player invokes native road/ground/collision rematerialization.
  c.player.state.position.x += 500;
  fleet.update(deadline + 3003, 16, 1, false);
  require(state().cheating && !state().physical, "remote transition failed");
  remember("remote");
  c.player.state.position.copy(body.state.position);
  fleet.update(deadline + 3019, 16, 1, false);
  remember("rematerialized");
  // The original placement function returns1 even for exhausted fallback.
  // Record that distinction rather than pretending every return activates physics.
  require(!state().follow
    .cheating, "nonzero placement result not acknowledged");
  require(body.state.accForce === 0 &&
    body.state.brakeForce ===
      0, "successful follow remat did not clear forces");
  require(state()
    .physical, "real authored-road rematerialization exhausted in fixture");
  require(body.group.visible, "physical opponent remained hidden");
  fleet.update(deadline + 3035, 16, 1, false);
  require(body.state.position
    .toArray()
    .every(Number.isFinite), "invalid physical resume pose");
  remember("physical-resume");
  c.player.state.position.copy(playerStart);
  c.player.group.position.copy(playerStart);
  const gl = c.renderer.getContext();
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    states,
    originalPosition: bodyStart.toArray(),
    glError: gl.getError(),
    backend: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "unknown",
    drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
  };
}

// This file is also imported for its self-contained page fixture by tooling.
if (process.argv[1]?.endsWith("browser-ai-recovery.mjs")) {
  const executablePath = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
  let available = true;
  try {
    await access(executablePath);
    await access(process.env.CARMA2_ROOT || "carma2_orig");
  } catch {
    available = false;
  }
  if (!available) {
    console.log(
      "SKIP AI-04 browser recovery: Chromium or original assets absent.",
    );
  } else {
    await mkdir("artifacts", { recursive: true });
    const port = 5289;
    const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    server.stdout.on("data", (d) => (log += d));
    server.stderr.on("data", (d) => (log += d));
    let browser;
    const report = {
      cases: [],
      errors: [],
      failedRequests: [],
      failedResponses: [],
    };
    try {
      let ready = false;
      for (let i = 0; i < 200; i++) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}/api/manifest`)).ok) {
            ready = true;
            break;
          }
        } catch {}
        if (server.exitCode !== null) throw new Error(log);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(ready, log);
      browser = await chromium.launch({
        executablePath,
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
      page.on("response", (r) => {
        if (r.status() >= 400 && !r.url().endsWith("/favicon.ico"))
          report.failedResponses.push(`${r.status()} ${r.url()}`);
      });
      await page.goto(`http://127.0.0.1:${port}`);
      await page.waitForFunction(() => window.carma?.stats.ready, null, {
        timeout: 90000,
      });
      for (const track of [
        "data/races/newcity1/newcity1.txt",
        "adv_data/races/carrier2/carrier2.txt",
      ]) {
        await page.evaluate(async (track) => {
          const c = window.carma;
          c.paused = true;
          document.querySelector("#track-select").value =
            c.assets.resolve(track);
          document.querySelector("#car-select").value = c.assets.resolve(
            "data/cars/eagle3/eagle3.txt",
          );
          await c.loadRace();
          c.paused = true;
          document.querySelector("#panel").hidden = true;
        }, track);
        await page.waitForFunction(
          () =>
            window.carma.opponentsReady &&
            window.carma.opponentFleet?.snapshot.rivals.length > 0,
          null,
          { timeout: 90000 },
        );
        const result = await page.evaluate(recoveryScenario);
        assert.equal(result.glError, 0);
        report.cases.push({ track, ...result });
        await page.screenshot({
          path: `artifacts/ai04-${report.cases.length}.png`,
        });
      }
      assert.deepEqual(report.errors, []);
      assert.deepEqual(report.failedRequests, []);
      assert.deepEqual(report.failedResponses, []);
      console.log(
        `AI-04 original Stock/Advanced recovery: ${report.cases.length} passed`,
      );
    } finally {
      await writeFile(
        "artifacts/browser-ai-recovery-report.json",
        JSON.stringify(report, null, 2),
      );
      await browser?.close();
      server.kill("SIGTERM");
    }
  }
}
