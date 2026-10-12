/** Serial, paused-scene PERF-11 capture using explicit SwiftShader. */
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";

const url = new URL(process.argv[2] ?? "http://localhost:5191");
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  !["http:", "https:"].includes(url.protocol)
)
  throw new Error("Use a local loopback server URL");

await mkdir("artifacts", { recursive: true });
const report = {
  backendPolicy:
    "Explicit SwiftShader; frozen CPU query/guard comparisons, no hardware FPS claim",
  cases: [],
  errors: [],
  failedRequests: [],
};
let browser;
let page;
let rendererWasRestored = false;
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
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (error) => report.errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    report.failedRequests.push(request.url()),
  );
  await page.goto(url.href);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  await page.evaluate(() => {
    const c = window.carma;
    c.paused = true;
    window.__perf11Render = c.renderer.render;
    c.renderer.render = () => {};
  });

  const targets = await page.evaluate(() => {
    const options = [...document.querySelector("#track-select").options]
      .map((option) => ({
        value: option.value,
        label: option.textContent ?? "",
      }))
      .filter((option) => option.value);
    const stock = options.filter(({ value }) => /^data\//i.test(value));
    const advanced = options.filter(({ value }) => /^adv_data\//i.test(value));
    const counterpart = (value) =>
      advanced.find(
        ({ value: candidate }) =>
          candidate.replace(/^adv_data\//i, "").toLowerCase() ===
          value.replace(/^data\//i, "").toLowerCase(),
      )?.value;
    const timber = stock.find(({ value }) =>
      /timber2\/timber2\.txt$/i.test(value),
    )?.value;
    const snow =
      stock.find(({ label }) => /snow way out/i.test(label))?.value ??
      stock.find(({ value }) => /skitrack3\/skitrack3\.txt$/i.test(value))
        ?.value;
    return [
      timber,
      timber && counterpart(timber),
      snow,
      snow && counterpart(snow),
    ];
  });
  if (targets.some((target) => !target))
    throw new Error(
      "Stock and Advanced Timber plus matching Stock/Advanced Snow Way Out catalog entries are required",
    );

  for (const target of targets) {
    await page.evaluate(async (value) => {
      const c = window.carma;
      document.querySelector("#track-select").value = value;
      await c.loadRace();
      c.paused = true;
    }, target);
    await page.waitForFunction(
      () => window.carma.stats.ready && window.carma.opponentsReady,
      null,
      { timeout: 90000 },
    );
    const result = await page.evaluate(async () =>
      (
        await import("/tools/world-face-performance-probe.mjs")
      ).compareWorldFaceLocality(),
    );
    report.cases.push(result);
    if (result.metadata?.glError)
      throw new Error(`WebGL error while probing ${target}`);

    await page.evaluate(() => {
      const c = window.carma;
      c.renderer.render = window.__perf11Render;
      document.querySelector("#panel").hidden = true;
    });
    await page.waitForTimeout(200);
    const label = `${target.startsWith("adv_data/") ? "advanced" : "stock"}-${
      /timber/i.test(target) ? "timber" : "snow"
    }`;
    await page.screenshot({ path: `artifacts/perf11-${label}.png` });
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
} catch (error) {
  report.fatal = String(error);
  throw error;
} finally {
  const difference = await page
    ?.evaluate(() => window.__perf11Difference)
    .catch(() => undefined);
  if (difference) report.difference = difference;
  if (page && !page.isClosed()) {
    await page
      .evaluate(() => {
        const c = window.carma;
        if (c && window.__perf11Render) {
          c.renderer.render = window.__perf11Render;
          c.paused = true;
        }
      })
      .catch(() => {});
    rendererWasRestored = true;
  }
  report.rendererRestoredBeforeClose = rendererWasRestored;
  await writeFile(
    "artifacts/perf11-world-faces.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
}
