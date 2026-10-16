#!/usr/bin/env node
/** Four-tick rendered-context ABBA comparison in isolated hardware Chromium contexts. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require("playwright-core");
const { build } = require("esbuild");
const endpoint = process.env.CDP_URL || "http://127.0.0.1:9222";
const baseline = process.env.BASELINE_URL || "http://localhost:5222";
const candidate = process.env.CANDIDATE_URL || "http://localhost:5221";
const output =
  process.env.PERF22_OUTPUT || "artifacts/perf22-browser-fixed-ticks.json";
const snapshotPath = process.env.PERF22_SNAPSHOT;
const urls = [baseline, candidate, candidate, baseline];
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
for (const value of [endpoint, baseline, candidate]) {
  assert(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname),
    "Local endpoints only",
  );
}
let capturedSnapshot;
let capturedFixtureBundle;
let capturedSnapshotSha256;
if (snapshotPath) {
  const snapshotText = await readFile(snapshotPath, "utf8");
  assert(
    Buffer.byteLength(snapshotText) <= 32 * 1024 * 1024,
    "PERF22_SNAPSHOT exceeds 32 MiB",
  );
  capturedSnapshot = JSON.parse(snapshotText);
  capturedSnapshotSha256 = hash(snapshotText);
  const helper = await build({
    entryPoints: ["tests/support/shallow-contact-fixture.mjs"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    globalName: "ShallowContactFixture",
    logLevel: "silent",
  });
  capturedFixtureBundle = helper.outputFiles[0].text;
}

// Installed once per page and reused for initial, per-tick, and final state.
function installSnapshotter() {
  window.__perf22Snapshot = () => {
    const c = window.carma;
    const sim = c.simulation;
    const bodies = sim.allBodies();
    const ids = new Map(bodies.map((body, index) => [body, index]));
    const vector = (value) => value?.toArray?.() ?? null;
    const cleanProperties = (properties) =>
      Object.fromEntries(
        Object.entries(properties ?? {}).filter(
          ([, value]) =>
            ["number", "boolean", "string"].includes(typeof value) ||
            value == null,
        ),
      );
    return {
      elapsed: sim.elapsed,
      gameTimeMs: c.stats.gameTimeMs,
      bodies: bodies.map((body) => ({
        id: ids.get(body),
        name: body.group?.name ?? body.actor?.name ?? body.name ?? "",
        kind: body.kind ?? (body.damage ? "car" : "body"),
        rigidType: body.rigidType ?? null,
        position: vector(body.state.position),
        orientation: vector(body.state.orientation),
        velocity: vector(body.state.velocity),
        angularVelocity: vector(body.state.angularVelocity),
        mass: body.properties.mass,
        inertia: vector(body.properties.inertia),
        centerOfMass: vector(body.properties.centerOfMass),
        properties: cleanProperties(body.properties),
        filters: {
          filterA: body.filterA ?? null,
          filterB: body.filterB ?? null,
        },
        recovery: {
          immovable: body.properties.immovable ?? false,
          doNothing: body.quietState?.doNothing ?? body.doNothing ?? null,
          recoveryFlags:
            body.recoveryFlags ?? body.damage?.recoveryFlags ?? null,
        },
        damage: body.damage
          ? Array.from(body.damage.componentLevels ?? [])
          : null,
        hulls: (body.hulls ?? []).map((hull) => ({
          nativeType: hull.nativeType ?? null,
          vertexOrder: hull.vertexOrder ?? null,
          vertices: hull.vertices.map(vector),
          faces: hull.faces.map((face) => ({
            indices: face.indices,
            normal: vector(face.normal),
            constant: face.constant,
            contactTypes: face.contactTypes ?? null,
          })),
          edges: hull.edges,
        })),
        joint: body.joint
          ? {
              type: body.joint.type,
              parent: ids.get(body.joint.parent) ?? null,
              childAnchor: vector(body.joint.childAnchor),
              parentAnchor: vector(body.joint.parentAnchor),
              childAxis: vector(body.joint.childAxis),
              parentAxis: vector(body.joint.parentAxis),
            }
          : null,
        parts:
          body.damage?.runtimeParts?.map((part) => ({
            name: part.actor.name,
            mass: part.mass,
            state: { ...part.state },
            position: vector(part.actor.position),
            orientation: vector(part.actor.quaternion),
          })) ?? null,
      })),
      impacts: (sim.lastImpacts ?? []).map((hit) => ({
        a: ids.get(hit.a) ?? null,
        b: hit.b ? (ids.get(hit.b) ?? null) : null,
        point: vector(hit.point),
        pointB: vector(hit.pointB),
        normal: vector(hit.normal),
        tangentImpulse: vector(hit.tangentImpulse),
        impulse: hit.normalImpulse,
        closingSpeed: hit.closingSpeed,
        contactTypes: hit.contactTypes ?? null,
        sourceType: hit.sourceType ?? null,
      })),
    };
  };
}

const report = {
  fixture: {
    track: "timber2",
    car: "eagle3",
    ticksPerPass: 4,
    seed: 20201016,
    installedFixture: snapshotPath
      ? {
          type: "captured-pile-install",
          snapshot: snapshotPath,
          sha256: capturedSnapshotSha256,
          note: "Installs captured body state into a freshly loaded race; this is not a historical replay.",
        }
      : { type: "default-spam-first-three-cars" },
    order: ["baseline", "candidate", "candidate", "baseline"],
    clocks: {
      elapsed: "physics simulation; expected +160 ms",
      gameTimeMs:
        "captured separately; direct step does not advance rendered/AI game clock",
    },
  },
  passes: [],
  errors: [],
  failedRequests: [],
  failedResponses: [],
};
await mkdir("artifacts", { recursive: true });
const browser = await chromium.connectOverCDP(endpoint);
try {
  for (let pass = 0; pass < urls.length; pass++) {
    const url = urls[pass];
    const label = url === baseline ? "baseline" : "candidate";
    const context = await browser.newContext({
      viewport: { width: 2100, height: 1466 },
    });
    try {
      await context.addInitScript(installSnapshotter);
      const page = await context.newPage();
      page.on("pageerror", (error) => report.errors.push(`${label}: ${error}`));
      page.on("console", (message) => {
        if (message.type() === "error")
          report.errors.push(`${label}: ${message.text()}`);
      });
      page.on("requestfailed", (request) =>
        report.failedRequests.push(`${label}: ${request.url()}`),
      );
      page.on("response", (response) => {
        if (response.status() >= 400)
          report.failedResponses.push(
            `${label}: ${response.url()} (${response.status()})`,
          );
      });
      await page.goto(url);
      await page.waitForFunction(() => window.carma?.stats.ready, null, {
        timeout: 90000,
      });
      await page.evaluate(async () => {
        const c = window.carma;
        c.paused = true;
        document.querySelector("#track-select").value = c.assets.resolve(
          "data/RACES/timber2/timber2.txt",
        );
        document.querySelector("#car-select").value = c.assets.resolve(
          "data/CARS/eagle3/eagle3.txt",
        );
        const random = Math.random;
        Math.random = () => 0.5;
        try {
          await c.loadRace();
        } finally {
          Math.random = random;
        }
        c.paused = true;
      });
      await page.waitForFunction(
        () => window.carma?.opponentsReady && !!window.carma?.pedestrians,
        null,
        { timeout: 90000 },
      );
      if (capturedFixtureBundle)
        await page.addScriptTag({ content: capturedFixtureBundle });
      const setup = await page.evaluate(
        async ({ useCapturedFixture, snapshot }) => {
          const c = window.carma;
          const sim = c.simulation;
          c.paused = true;
          const seed = c.player.damage?.damageContext?.seedRandom;
          if (typeof seed !== "function")
            throw new Error("Damage RNG seed API unavailable");
          seed(20201016);
          if (sim.motionContext) sim.motionContext.stopTimer = 0;
          let spam = [];
          let capturedRoster = null;
          if (useCapturedFixture) {
            const fixture =
              await window.ShallowContactFixture.installShallowContactFixture(
                c,
                snapshot,
              );
            window.__perf22ShallowContactFixture = fixture;
            capturedRoster = fixture.roster;
            seed(20201016);
          } else {
            spam = sim.cars.slice(0, 3).map((car) => ({
              name: car.group?.name ?? "",
              detached: sim.spamCar(car, 0.35)?.detachedParts?.length ?? 0,
            }));
          }
          if (sim.motionContext) sim.motionContext.stopTimer = 0;
          c.player.input.throttle = 1;
          c.player.input.steer = 0;
          c.player.input.brake = 0;
          c.player.input.handbrake = false;
          sim.correctionDiagnostics = {};
          const capture = { trace: [], pairTotals: {} };
          const previousPairs = sim.bodyPairDiagnostics;
          sim.bodyPairDiagnostics = (phase, values) => {
            previousPairs?.(phase, values);
            const totals = (capture.pairTotals[phase] ??= {});
            for (const [key, value] of Object.entries(values)) {
              if (typeof value === "number" && Number.isFinite(value))
                totals[key] = (totals[key] ?? 0) + value;
            }
          };
          const numericRefs = (value, ids, seen = new WeakSet()) => {
            if (
              value == null ||
              ["number", "string", "boolean"].includes(typeof value)
            )
              return value;
            if (ids.has(value)) return ids.get(value);
            if (typeof value !== "object" || seen.has(value)) return null;
            seen.add(value);
            if (Array.isArray(value))
              return value.map((item) => numericRefs(item, ids, seen));
            return Object.fromEntries(
              Object.entries(value).map(([key, item]) => [
                key,
                numericRefs(item, ids, seen),
              ]),
            );
          };
          sim.onLocalResponseTrace = (row) => {
            if (capture.trace.length >= 512) return;
            const ids = new Map(
              sim.allBodies().map((body, index) => [body, index]),
            );
            capture.trace.push(numericRefs(row, ids));
          };
          sim.__perf22 = capture;
          sim.__perf22Elapsed = sim.elapsed;
          sim.__perf22GameTime = c.stats.gameTimeMs;
          return {
            fixtureType: useCapturedFixture
              ? "captured-pile-install"
              : "default-spam-first-three-cars",
            capturedRoster,
            spam,
            motionStopTimer: sim.motionContext?.stopTimer ?? null,
          };
        },
        { useCapturedFixture: !!snapshotPath, snapshot: capturedSnapshot },
      );
      const gpu = await page.evaluate(() => {
        const gl = window.carma.renderer.getContext();
        const extension = gl.getExtension("WEBGL_debug_renderer_info");
        return {
          vendor: gl.getParameter(gl.VENDOR),
          renderer: gl.getParameter(gl.RENDERER),
          unmaskedVendor: extension
            ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL)
            : null,
          unmaskedRenderer: extension
            ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
            : null,
          buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
          webgl2: !!window.carma.renderer.capabilities?.isWebGL2,
          glError: gl.getError(),
        };
      });
      assert(
        gpu.unmaskedRenderer,
        `WEBGL_debug_renderer_info unavailable: ${JSON.stringify(gpu)}`,
      );
      assert(
        !/SwiftShader|llvmpipe|software/i.test(
          `${gpu.unmaskedVendor} ${gpu.unmaskedRenderer}`,
        ),
        `Hardware GPU required: ${JSON.stringify(gpu)}`,
      );
      assert.equal(gpu.glError, 0, `Initial WebGL error: ${gpu.glError}`);
      const initial = await page.evaluate(() => window.__perf22Snapshot());
      const initialSha256 = hash(initial);
      let timeoutId;
      const measuredPromise = page.evaluate(() => {
        const c = window.carma;
        const sim = c.simulation;
        c.paused = true;
        const timings = [];
        const afterEachTick = [];
        for (let tick = 0; tick < 4; tick++) {
          const start = performance.now();
          sim.step();
          timings.push(performance.now() - start);
          afterEachTick.push(window.__perf22Snapshot());
        }
        const glError = c.renderer.getContext().getError();
        return {
          state: window.__perf22Snapshot(),
          afterEachTick,
          timings,
          glError,
          elapsedDelta: sim.elapsed - sim.__perf22Elapsed,
          gameTimeDelta: c.stats.gameTimeMs - sim.__perf22GameTime,
          diagnostics: structuredClone(sim.correctionDiagnostics ?? {}),
          trace: sim.__perf22.trace,
          pairTotals: sim.__perf22.pairTotals,
        };
      });
      const measured = await Promise.race([
        measuredPromise,
        new Promise((_, reject) => {
          timeoutId = setTimeout(
            () =>
              reject(
                new Error(
                  "Physics page.evaluate exceeded 15 seconds; closing its context",
                ),
              ),
            15000,
          );
        }),
      ]).finally(() => clearTimeout(timeoutId));
      assert(
        Math.abs(measured.elapsedDelta - 0.16) < 1e-9,
        `Expected four 40 ms ticks, got ${measured.elapsedDelta}`,
      );
      assert.equal(
        measured.gameTimeDelta,
        0,
        "Direct stepping advanced game time",
      );
      assert.equal(
        measured.glError,
        0,
        `WebGL error after ticks: ${measured.glError}`,
      );
      const tickHashes = measured.afterEachTick.map(hash);
      const entry = {
        pass: pass + 1,
        label,
        url,
        gpu,
        setup,
        initial,
        initialSha256,
        final: measured.state,
        finalSha256: hash(measured.state),
        timingsMs: measured.timings,
        afterEachTick: measured.afterEachTick,
        afterEachTickSha256: tickHashes,
        elapsedDelta: measured.elapsedDelta,
        gameTimeDelta: measured.gameTimeDelta,
        diagnostics: measured.diagnostics,
        trace: measured.trace,
        pairTotals: measured.pairTotals,
      };
      report.passes.push(entry);
      await page.screenshot({
        path: `artifacts/perf22-${label}-${pass + 1}.png`,
      });
      await writeFile(output, JSON.stringify(report, null, 2));
    } finally {
      await context.close();
    }
  }
  const sameInitialFixture = report.passes.every(
    (pass) => pass.initialSha256 === report.passes[0].initialSha256,
  );
  const tickComparisons = sameInitialFixture
    ? [1, 2, 3, 4].map((tick) => ({
        tick,
        baseline: report.passes[0].afterEachTickSha256[tick - 1],
        candidatePass2: report.passes[1].afterEachTickSha256[tick - 1],
        candidatePass3: report.passes[2].afterEachTickSha256[tick - 1],
        baselineRepeat: report.passes[3].afterEachTickSha256[tick - 1],
        candidateMatchesBaseline:
          report.passes[0].afterEachTickSha256[tick - 1] ===
          report.passes[1].afterEachTickSha256[tick - 1],
        baselineRepeatMatches:
          report.passes[0].afterEachTickSha256[tick - 1] ===
          report.passes[3].afterEachTickSha256[tick - 1],
      }))
    : null;
  report.comparison = {
    sameInitialFixture,
    initialHashes: report.passes.map((pass) => pass.initialSha256),
    finalHashes: report.passes.map((pass) => pass.finalSha256),
    afterEachTickHashes: report.passes.map((pass) => pass.afterEachTickSha256),
    tickHashesComparable: sameInitialFixture,
    tickComparisons,
    note: "Compare after-tick hashes only when every initial fixture hash matches.",
  };
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  assert.deepEqual(report.failedResponses, []);
  console.log(JSON.stringify(report.comparison));
} catch (error) {
  report.failure = String(error);
  console.error(error);
} finally {
  await writeFile(output, JSON.stringify(report, null, 2));
  // Exit the client process to drop its CDP transport without closing Chromium.
  process.exit(report.failure ? 1 : 0);
}
