import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access, copyFile, mkdir, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { decodeCapture } from "../src/bug-capture/format.ts";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP bug capture browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

const port = await reservePort();
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
let browser;

try {
  let ready = false;
  for (let i = 0; i < 200; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/manifest`)).ok) {
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
    acceptDownloads: true,
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

  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(
    () =>
      window.carma?.stats.ready &&
      window.carma.populationLoadState?.opponents.state !== "loading" &&
      window.carma.populationLoadState?.pedestrians.state !== "loading" &&
      window.carma.bugCapture,
    null,
    { timeout: 90000 },
  );
  const saveButton = page.locator("#bug-capture-save");
  assert.equal(
    await saveButton.isVisible(),
    true,
    "capture export is always visible",
  );
  assert.match(await saveButton.innerText(), /save bug capture/i);
  const initial = await page.evaluate(() => {
    const c = window.carma;
    return {
      paused: c.paused,
      enabled: c.bugCapture.enabled,
      status: c.bugCapture.status,
      recorderSame: c.simulation.bugCapture === c.bugCapture,
    };
  });
  assert.equal(initial.enabled, true, "recorder runs with debug controls off");
  assert.equal(initial.recorderSame, true);
  assert.equal(initial.status.memoryLimitBytes, 512 * 1024 * 1024);
  assert.equal(initial.status.ring.maxAgeMs, 180_000);
  assert.equal(initial.status.ring.maxBytes, 248 * 1024 * 1024);

  // Let real keyboard input move the loaded player, then take a short serial
  // physics sample to ensure the recorder observes committed body state.
  if (initial.paused) await page.locator("#menu-button").click();
  await page.keyboard.down("w");
  await page.waitForTimeout(1000);
  await page.keyboard.up("w");
  const expected = await page.evaluate(() => {
    const c = window.carma;
    for (let i = 0; i < 20; i++) c.simulation.step();
    return {
      stepRecords: c.bugCapture.status.ring.count,
    };
  });
  await page.waitForTimeout(200);
  await page.locator("#menu-button").click();
  await page.waitForFunction(() => window.carma.paused);
  const paused = await page.evaluate(() => ({
    status: window.carma.bugCapture.status,
    count: window.carma.bugCapture.status.ring.count,
    position: [
      window.carma.player.state.position.x,
      window.carma.player.state.position.y,
      window.carma.player.state.position.z,
    ],
  }));
  await page.waitForTimeout(250);
  const preserved = await page.evaluate(() => ({
    count: window.carma.bugCapture.status.ring.count,
    oldest: window.carma.bugCapture.status.ring.oldestTimeMs,
    newest: window.carma.bugCapture.status.ring.newestTimeMs,
  }));
  assert.equal(
    preserved.count,
    paused.count,
    "pause keeps capture history without advancing time",
  );
  assert.equal(preserved.oldest, paused.status.ring.oldestTimeMs);
  assert.equal(preserved.newest, paused.status.ring.newestTimeMs);
  assert.ok(expected.stepRecords > 0);
  assert.ok(paused.count > 0);
  assert.ok(paused.status.ring.accountedBytes <= paused.status.ring.maxBytes);

  const oldGeneration = paused.status.generation;
  await page.evaluate(() => window.carma.loadRace());
  await page.waitForFunction(
    () =>
      window.carma.stats.ready &&
      window.carma.populationLoadState?.opponents.state !== "loading" &&
      window.carma.populationLoadState?.pedestrians.state !== "loading",
    null,
    { timeout: 90000 },
  );
  const afterReload = await page.evaluate(() => window.carma.bugCapture.status);
  assert.ok(afterReload.generation > oldGeneration);
  assert.ok(
    afterReload.ring.count >= paused.count,
    "race load preserves earlier records",
  );

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    saveButton.click(),
  ]);
  assert.match(download.suggestedFilename(), /\.c2bug$/);
  const downloadedPath = await download.path();
  await mkdir("artifacts", { recursive: true });
  await copyFile(downloadedPath, "artifacts/browser-bug-capture.c2bug");
  const file = await readFile(downloadedPath);
  const { metadata, records } = decodeCapture(file);
  assert.equal(metadata.type, "carma-bug-capture");
  assert.equal(metadata.diagnosticOnly, true);
  assert.ok(metadata.schemas && metadata.schemas["1"]?.bodyColumns);
  assert.ok(Array.isArray(metadata.directory));
  for (const entry of metadata.directory) {
    assert.equal(typeof entry.name, "string");
    assert.notEqual(entry.name, "undefined");
  }
  const kinds = new Set(records.map((record) => record.kind));
  for (const kind of [1, 2, 3, 4, 5, 6])
    assert.ok(kinds.has(kind), `capture contains record kind ${kind}`);
  const header = metadata.schemas["1"].header;
  const columns = metadata.schemas["1"].bodyColumns;
  const bodyOffset = header.length;
  const idColumn = columns.indexOf("id");
  const pxColumn = columns.indexOf("px");
  const pyColumn = columns.indexOf("py");
  const pzColumn = columns.indexOf("pz");
  const decodedStates = records
    .filter((record) => record.kind === 1)
    .map((record) => {
      const view = new DataView(
        record.payload.buffer,
        record.payload.byteOffset,
        record.payload.byteLength,
      );
      const floats = Array.from(
        { length: record.payload.byteLength / 8 },
        (_, i) => view.getFloat64(i * 8, true),
      );
      return floats;
    });
  const floats = decodedStates
    .filter(
      (values) => values[0] === paused.status.generation && values[2] === 1,
    )
    .at(-1);
  assert.ok(
    floats,
    "capture retains a committed phase-1 body state from the paused generation",
  );
  const bodyStride = columns.length;
  let matchedPosition = false;
  for (
    let offset = bodyOffset;
    offset + bodyStride <= floats.length;
    offset += bodyStride
  ) {
    const x = floats[offset + idColumn];
    const name = metadata.directory.find((entry) => entry.id === x)?.name;
    if (
      name &&
      floats[offset + pxColumn] === paused.position[0] &&
      floats[offset + pyColumn] === paused.position[1] &&
      floats[offset + pzColumn] === paused.position[2]
    ) {
      assert.deepEqual(
        [
          floats[offset + pxColumn],
          floats[offset + pyColumn],
          floats[offset + pzColumn],
        ],
        paused.position,
        "captured Float64 body position exactly matches the simulation state",
      );
      matchedPosition = true;
      break;
    }
  }
  assert.ok(
    matchedPosition,
    "captured Float64 state matches a named body position",
  );

  const contactSchema = metadata.schemas["3"].header;
  assert.match(contactSchema[3], /callback-candidate.*after-normal-response/);
  assert.match(contactSchema[4], /callbackAccepted/);
  assert.ok(
    records.some(
      (record) => record.kind === 3 && record.payload.byteLength > 0,
    ),
  );
  for (const record of records.filter((entry) => entry.kind === 3)) {
    const contactView = new DataView(
      record.payload.buffer,
      record.payload.byteOffset,
      record.payload.byteLength,
    );
    assert.ok(record.payload.byteLength >= 7 * 8);
    assert.ok([0, 1].includes(contactView.getFloat64(3 * 8, true)));
    assert.ok([-1, 0, 1].includes(contactView.getFloat64(4 * 8, true)));
  }
  for (const record of records.filter(
    (entry) => entry.kind === 4 || entry.kind === 5 || entry.kind === 6,
  ))
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(record.payload),
    );

  assert.deepEqual(errors, [], "Chromium has no uncaught errors");
  assert.deepEqual(failedRequests, [], "all requested local assets load");
  console.log(
    "PASS always-on bug capture, bounded pause/reload history, schemas, Float64 state and .c2bug download",
  );
} catch (error) {
  console.error(serverLog);
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
}

async function reservePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}
