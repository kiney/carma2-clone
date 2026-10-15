import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "playwright-core";

const { values } = parseArgs({
  options: {
    snapshot: {
      type: "string",
      default: "artifacts/perf18-user-interlock.json",
    },
    output: {
      type: "string",
      default: "artifacts/browser-shallow-contact.json",
    },
    steps: { type: "string", default: "3" },
    "record-only": { type: "boolean", default: false },
  },
});
const steps = Number(values.steps);
assert.ok(
  Number.isInteger(steps) && steps >= 1 && steps <= 3,
  "--steps must be 1–3",
);
const output = resolve(values.output);
const ignored = relative(resolve("artifacts"), output);
assert.ok(
  ignored && !ignored.startsWith("..") && !isAbsolute(ignored),
  "report must be inside ignored artifacts/",
);
const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await Promise.all([
    access(executable),
    access(process.env.CARMA2_ROOT || "carma2_orig"),
    access(values.snapshot),
    access("dist/index.html"),
  ]);
} catch {
  console.log(
    "SKIP shallow contact browser regression: Chromium, original assets, capture or production build absent.",
  );
  process.exit(0);
}
const captureText = await readFile(values.snapshot, "utf8");
assert.ok(
  Buffer.byteLength(captureText) <= 32 * 1024 * 1024,
  "capture exceeds 32 MiB",
);
const snapshot = JSON.parse(captureText);
const helper = await build({
  entryPoints: ["tests/support/shallow-contact-fixture.mjs"],
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  globalName: "ShallowContactFixture",
  logLevel: "silent",
});
const port = Number(process.env.SHALLOW_CONTACT_PORT || 5233);
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "",
  browser;
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
const report = {
  capturedAt: new Date().toISOString(),
  snapshot: values.snapshot,
  captureSha256: createHash("sha256").update(captureText).digest("hex"),
  backend:
    "SwiftShader correctness fixture; cold serial step timings are not hardware FPS measurements",
  cases: [],
  errors: [],
  failedRequests: [],
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
    await new Promise((done) => setTimeout(done, 100));
  }
  assert.ok(ready, `production server failed: ${serverLog}`);
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
  report.build = await page
    .locator('script[type="module"]')
    .getAttribute("src");
  assert.match(
    report.build,
    /^\/assets\//,
    "fixture requires the production bundle",
  );
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.addScriptTag({ content: helper.outputFiles[0].text });
  for (const scenario of [
    { name: "captured-forward", throttle: 1 },
    { name: "captured-reverse", throttle: -1 },
    { name: "bumper-removal-control", throttle: 1, removeBumper: true },
  ]) {
    await page.evaluate(async () => {
      const c = window.carma;
      document.querySelector("#track-select").value = c.assets.resolve(
        "data/RACES/timber2/timber2.txt",
      );
      document.querySelector("#car-select").value = c.assets.resolve(
        "data/CARS/EAGLE3/EAGLE3.TXT",
      );
      await c.loadRace();
      c.paused = true;
    });
    await page.waitForFunction(
      () =>
        window.carma.stats.ready &&
        window.carma.opponentsReady &&
        window.carma.paused,
      null,
      { timeout: 90000 },
    );
    const result = await page.evaluate(
      async ({ snapshot, scenario, steps }) => {
        const c = window.carma;
        const f = await ShallowContactFixture.installShallowContactFixture(
          c,
          snapshot,
          scenario,
        );
        window.__shallowContactFixture = f;
        const initialAnchors = f.anchorErrors();
        for (let index = 0; index < steps; index++) f.tick();
        const repair = f.repairPlayer();
        const gl = c.renderer.getContext();
        const extension = gl.getExtension("WEBGL_debug_renderer_info");
        return {
          ...scenario,
          roster: f.roster,
          extraRegisteredBodies: f.extraRegisteredBodies,
          initialAnchors,
          steps: f.steps,
          repair,
          limitations: f.limitations,
          gl: {
            error: gl.getError(),
            renderer:
              extension && gl.getParameter(extension.UNMASKED_RENDERER_WEBGL),
            drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
          },
        };
      },
      { snapshot, scenario, steps },
    );
    report.cases.push(result);
    assert.equal(result.roster.length, scenario.removeBumper ? 9 : 10);
    assert.deepEqual(
      result.extraRegisteredBodies,
      [],
      "fixture gained unrecorded physical roots",
    );
    for (const body of result.roster) {
      const recorded = snapshot.bodies.find((row) => row.id === body.id);
      for (const key of [
        "overlapRecovery",
        "overlapDetected",
        "worldRecovery",
        "worldOverlapDetected",
      ])
        assert.equal(
          body[key],
          recorded.flags[key],
          `initial body ${body.id} ${key} differs from capture`,
        );
    }
    assert.ok(
      result.initialAnchors.some(
        (joint) =>
          joint.id === 8 && joint.parent === 3 && joint.type === "hinge",
      ),
    );
    assert.ok(
      result.steps.every(
        (step) => step.bodies.find((body) => body.id === 8)?.present,
      ),
      "source door disappeared",
    );
    assert.ok(
      result.steps.every(
        (step) =>
          step.anchors.length === 2 &&
          step.anchors.every((joint) => joint.error < 1e-9),
      ),
      "source door or world prop anchor separated",
    );
    assert.ok(
      result.steps.every(
        (step) => step.bodies.find((body) => body.id === 8)?.joint === "hinge",
      ),
      "source door lost its physical hinge",
    );
    assert.ok(
      result.repair.components.every((level) => level === 0),
      "repair left component damage",
    );
    assert.equal(
      result.repair.foreignDoorPresent,
      true,
      "player repair removed foreign bodywork",
    );
    assert.equal(
      result.repair.foreignDoorJointParent,
      3,
      "player repair changed foreign hinge ancestry",
    );
    assert.ok(
      result.steps.some((step) => step.diagnostics.worldCollections > 0),
      "production world contact collection did not run",
    );
    assert.ok(
      result.steps.every((step) => step.playerForce?.every(Number.isFinite)),
      "normal vehicle forces did not run",
    );
    assert.equal(result.gl.error, 0, "WebGL error");
    if (!scenario.removeBumper) {
      assert.ok(
        result.steps.some((step) =>
          step.impacts.some(
            (impact) =>
              impact.a === 3 &&
              impact.b === 7 &&
              impact.sourceType === 5 &&
              impact.solverAccepted &&
              impact.normalImpulse > 0,
          ),
        ),
        "meaningful ordinary Mach13/bumper impulse missing",
      );
      assert.ok(
        result.steps.every(
          (step) =>
            step.bodies.find((body) => body.id === 7)?.present &&
            step.bodies.find((body) => body.id === 7)?.joint === null,
        ),
        "released source bumper disappeared or acquired a joint",
      );
      assert.equal(result.repair.before.phase, 2);
      assert.equal(
        result.repair.phase,
        0,
        "repair did not restore source part state",
      );
      assert.equal(result.repair.queuedAt, null);
      assert.equal(
        result.repair.originalParent,
        true,
        "repair did not restore source actor ownership",
      );
    }
    if (!values["record-only"] && !scenario.removeBumper) {
      const progress = result.steps
        .at(-1)
        .bodies.find((body) => body.id === snapshot.playerId).displacement;
      assert.ok(
        progress > 0.015,
        `player remained stalled: ${progress} model units`,
      );
    }
    console.log(
      JSON.stringify({
        name: result.name,
        steps: result.steps.map((step) => ({
          tick: step.tick,
          cpuMs: step.cpuMs,
          diagnostics: step.diagnostics,
          commit: step.pair.filter((entry) => entry.phase === "commit"),
          guardFractions: step.guardFractions,
          player: step.bodies.find((body) => body.id === snapshot.playerId),
          acceptedMachBumper: step.impacts.filter(
            (impact) =>
              impact.a === 3 &&
              impact.b === 7 &&
              impact.solverAccepted &&
              impact.normalImpulse > 0,
          ),
        })),
      }),
    );
  }
  assert.deepEqual(report.errors, [], "browser runtime errors");
  assert.deepEqual(report.failedRequests, [], "failed requests");
} finally {
  await mkdir(resolve("artifacts"), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  await browser?.close();
  server.kill("SIGTERM");
}
