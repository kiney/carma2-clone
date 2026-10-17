/** Short render-only visibility comparisons in an existing headed hardware
 * Chromium. Uses a fresh context, never navigates the user's existing tabs.
 * Production servers and CDP_URL must already be running. Physics stays paused;
 * use validate-performance-routes.mjs separately for real driving regressions.
 */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "playwright-core";

const endpoint = process.env.CDP_URL || "http://127.0.0.1:9234";
const url = process.env.PERF_VISIBILITY_URL || "http://localhost:5241";
const output =
  process.env.PERF_VISIBILITY_OUTPUT || "artifacts/visibility.json";
for (const address of [endpoint, url])
  assert.ok(
    ["localhost", "127.0.0.1", "[::1]"].includes(new URL(address).hostname),
  );
const width = Number(process.env.PERF_VISIBILITY_WIDTH || 2100);
const height = Number(process.env.PERF_VISIBILITY_HEIGHT || 1466);
const durationMs = 2500;
const browser = await chromium.connectOverCDP(endpoint);
const context = await browser.newContext({ viewport: { width, height } });
// Deterministic asset/population selection, not a production RNG change.
await context.addInitScript(() => {
  let value = 20201016;
  Math.random = () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
});
const page = await context.newPage();
const report = {
  mode: "Paused render-only camera views; not driving FPS",
  width,
  height,
  cases: [],
  errors: [],
  failedRequests: [],
  failedResponses: [],
};
page.on("pageerror", (e) => report.errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") report.errors.push(m.text());
});
page.on("requestfailed", (r) => report.failedRequests.push(r.url()));
page.on("response", (r) => {
  if (r.status() >= 400) report.failedResponses.push(r.url());
});
await mkdir(dirname(output), { recursive: true });
try {
  await page.goto(url);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.bringToFront();
  for (const scenario of [
    { name: "timber-tunnel-view", track: "timber2", from: 192, to: 191 },
    { name: "timber-open-view", track: "timber2", from: 0, to: 3, height: 2 },
    { name: "snow-start-view", track: "skitrack3" },
    {
      name: "snow-cave-route",
      track: "skitrack3",
      from: 22,
      to: 11,
      sweep: true,
    },
  ]) {
    if (
      process.env.PERF_VISIBILITY_CASE &&
      scenario.name !== process.env.PERF_VISIBILITY_CASE
    )
      continue;
    await page.evaluate(async (s) => {
      const c = window.carma;
      window.__restoreVisibilityCamera?.();
      c.paused = true;
      document.querySelector("#track-select").value = c.assets.resolve(
        `data/RACES/${s.track}/${s.track}.txt`,
      );
      document.querySelector("#car-select").value = c.assets.resolve(
        "data/CARS/eagle3/eagle3.txt",
      );
      await c.loadRace();
      c.paused = true;
      document.querySelector("#panel").hidden = true;
    }, scenario);
    await page.waitForFunction(
      () => window.carma.opponentsReady && !!window.carma.pedestrians,
      null,
      { timeout: 90000 },
    );
    const setup = await page.evaluate((s) => {
      const c = window.carma,
        camera = c.camera,
        V = camera.position.constructor;
      let from = camera.position.clone(),
        to = c.player.state.position.clone();
      if (s.from !== undefined) {
        from = new V(...c.track.pathNodes[s.from]);
        from.y += s.height ?? 0.35;
        to = new V(...c.track.pathNodes[s.to]);
        to.y += s.height ?? 0.35;
      }
      const direction = to.clone().sub(from).normalize();
      const lookAt = camera.lookAt;
      window.__restoreVisibilityCamera = () => {
        camera.lookAt = lookAt;
      };
      const fixture = { from, to, sweep: s.sweep, progress: 0 };
      window.__visibilityView = fixture;
      camera.lookAt = function () {
        this.position.copy(from);
        if (fixture.sweep) this.position.lerp(to, fixture.progress);
        return lookAt.call(this, this.position.clone().add(direction));
      };
      const gl = c.renderer.getContext(),
        ext = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        from: from.toArray(),
        to: to.toArray(),
        gpu: ext
          ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        nativePopulation: c.pedestrians.states.length,
        opponents: c.rivals.length,
        physicsTime: c.simulation.elapsed,
        nativeProcessDistance: c.pedestrians.nativeProcessDistance ?? 12,
      };
    }, scenario);
    assert.doesNotMatch(setup.gpu, /SwiftShader|llvmpipe|software/i);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${output}.${scenario.name}.before.png` });
    const capture = await page.evaluate(async (duration) => {
      const c = window.carma,
        view = window.__visibilityView;
      const intervals = [],
        start = performance.now();
      let previous = start;
      await new Promise((resolve) => {
        const frame = (now) => {
          intervals.push(now - previous);
          previous = now;
          view.progress = Math.min(1, (now - start) / duration);
          if (now - start >= duration) resolve();
          else requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
      });
      const elapsedMs = performance.now() - start;
      const sorted = intervals.slice(1).sort((a, b) => a - b);
      const quantile = (q) => sorted[Math.ceil(sorted.length * q) - 1];
      return {
        fps: (intervals.length * 1000) / elapsedMs,
        elapsedMs,
        frameMs: {
          p50: quantile(0.5),
          p95: quantile(0.95),
          max: sorted.at(-1),
        },
        visibility: c.visibility ?? null,
        cameraFar: c.camera.far,
        calls: c.renderer.info.render.calls,
        triangles: c.renderer.info.render.triangles,
        physicsTime: c.simulation.elapsed,
        glError: c.renderer.getContext().getError(),
      };
    }, durationMs);
    assert.equal(capture.glError, 0);
    assert.equal(
      capture.physicsTime,
      setup.physicsTime,
      "render-only capture advanced physics",
    );
    await page.screenshot({ path: `${output}.${scenario.name}.after.png` });
    const population = await page.evaluate(() => {
      const c = window.carma,
        peds = c.pedestrians.peds;
      return {
        active: peds.filter((p) => p.active).length,
        visible: peds.filter((p) => p.object.visible).length,
        distantVisible: peds.filter((p) => p.object.visible && !p.active)
          .length,
      };
    });
    report.cases.push({ name: scenario.name, setup, ...capture, population });
    console.log(
      scenario.name,
      JSON.stringify({
        fps: capture.fps,
        frameMs: capture.frameMs,
        calls: capture.calls,
        triangles: capture.triangles,
        population,
      }),
    );
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  assert.deepEqual(report.failedResponses, []);
} finally {
  await writeFile(output, JSON.stringify(report, null, 2));
  await context.close();
  await browser.close();
}
