/** Serial, bounded original-material CPU comparison; no sustained simulation. */
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
const url = new URL(process.argv[2] ?? "http://localhost:5190");
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  !["http:", "https:"].includes(url.protocol)
)
  throw new Error("Use a local loopback server URL");
await mkdir("artifacts", { recursive: true });
const report = {
  backendPolicy:
    "Explicit SwiftShader; CPU-only frozen comparisons, no hardware FPS claim",
  cases: [],
  errors: [],
  failedRequests: [],
};
let browser;
let page;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
    ],
  });
  page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.on("pageerror", (e) => report.errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") report.errors.push(m.text());
  });
  page.on("requestfailed", (r) => report.failedRequests.push(r.url()));
  await page.goto(url.href);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.evaluate(() => {
    const c = window.carma;
    c.paused = true;
    window.__perf10Render = c.renderer.render;
    c.renderer.render = () => {};
  });
  const targets = await page.evaluate(() => {
    const options = [...document.querySelector("#track-select").options];
    return ["data/", "adv_data/"].map(
      (prefix) =>
        options.find(
          (o) =>
            o.value.toLowerCase().startsWith(prefix) &&
            /timber2\/timber2\.txt$/i.test(o.value),
        )?.value,
    );
  });
  if (targets.some((t) => !t))
    throw new Error("Stock/Advanced Timber catalog entries required");
  for (const target of targets) {
    await page.evaluate(async (target) => {
      document.querySelector("#track-select").value = target;
      await window.carma.loadRace();
      window.carma.paused = true;
    }, target);
    await page.waitForFunction(
      () => window.carma.stats.ready && window.carma.opponentsReady,
      null,
      { timeout: 90000 },
    );
    const result = await page.evaluate(async () =>
      (
        await import("/tools/smash-invalidation-performance-probe.mjs")
      ).compareSmashInvalidation(),
    );
    report.cases.push(result);
    if (result.glError) throw new Error("WebGL error in comparison");
    // The helper disposes diagnostic tile resources. Reload ordinary content
    // before checking the actual renderer; do not resume the modified scene.
    await page.evaluate(async () => {
      await window.carma.loadRace();
      window.carma.paused = true;
      window.carma.renderer.render = window.__perf10Render;
    });
    await page.waitForFunction(() => window.carma.stats.ready, null, {
      timeout: 90000,
    });
    await page.evaluate(() => (document.querySelector("#panel").hidden = true));
    await page.waitForTimeout(200);
    await page.screenshot({
      path: `artifacts/perf10-${target.startsWith("adv_data/") ? "advanced" : "stock"}.png`,
    });
    await page.evaluate(() => (window.carma.renderer.render = () => {}));
  }
  if (report.errors.length || report.failedRequests.length)
    throw new Error(
      JSON.stringify({
        errors: report.errors,
        failedRequests: report.failedRequests,
      }),
    );
  console.log(JSON.stringify(report, null, 2));
} finally {
  const mismatch = await page
    ?.evaluate(() => window.__perf10Difference)
    .catch(() => undefined);
  if (mismatch) report.mismatch = mismatch;
  await writeFile(
    "artifacts/perf10-smash-invalidation.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
}
