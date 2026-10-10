import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const assetRoot = process.env.CARMA2_ROOT || "carma2_orig";
const phase = (process.env.CAMERA_PHASE || "baseline").replace(
  /[^a-z0-9-]/gi,
  "-",
);
try {
  await access(executable);
  await access(assetRoot);
} catch {
  console.log("SKIP camera browser baseline: Chromium or C2 assets absent.");
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5208;
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
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`),
  );

  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  const options = await page.evaluate(() => ({
    tracks: Array.from(document.querySelector("#track-select").options).map(
      (option) => ({ label: option.textContent.trim(), value: option.value }),
    ),
    cars: Array.from(document.querySelector("#car-select").options).map(
      (option) => ({ label: option.textContent.trim(), value: option.value }),
    ),
  }));
  const track = options.tracks.find(
    (option) =>
      option.value.toLowerCase().startsWith("data/races/") &&
      /new city|nice beaver|newcity1/i.test(`${option.label} ${option.value}`),
  );
  const cars = [
    options.cars.find(
      (option) =>
        option.value.toLowerCase().startsWith("data/cars/") &&
        /eagle\s*3|eagle3/i.test(`${option.label} ${option.value}`),
    ),
    options.cars.find(
      (option) =>
        option.value.toLowerCase().startsWith("data/cars/") &&
        /big\s*dump|bigdump/i.test(`${option.label} ${option.value}`),
    ),
  ];
  assert.ok(
    track,
    `New City track option missing: ${JSON.stringify(options.tracks)}`,
  );
  assert.ok(cars[0], `Eagle 3 option missing: ${JSON.stringify(options.cars)}`);
  assert.ok(
    cars[1],
    `Big Dump option missing: ${JSON.stringify(options.cars)}`,
  );

  const captures = [];
  for (const [index, carOption] of cars.entries()) {
    await page.evaluate(
      async ({ trackValue, carValue }) => {
        const c = window.carma;
        document.querySelector("#track-select").value = trackValue;
        document.querySelector("#car-select").value = carValue;
        await c.loadRace();
        c.paused = true;
        document.querySelector("#panel").hidden = true;
      },
      { trackValue: track.value, carValue: carOption.value },
    );
    await page.waitForFunction(
      () => window.carma.stats.ready && window.carma.paused,
      null,
      { timeout: 90000 },
    );
    // Let the actual chase camera settle while the paused render loop continues.
    await page.waitForTimeout(1200);
    const capture = await page.evaluate(() => {
      const c = window.carma;
      const camera = c.camera;
      const vehicle = c.player.group;
      vehicle.updateMatrixWorld(true);
      camera.updateMatrixWorld(true);
      // The application does not publish THREE; use the model's loaded geometry
      // bounds transformed into world space from its actual scene object.
      let min = [Infinity, Infinity, Infinity];
      let max = [-Infinity, -Infinity, -Infinity];
      const corners = [];
      vehicle.traverse((node) => {
        if (!node.isMesh || !node.geometry?.attributes?.position) return;
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        const bounds = node.geometry.boundingBox;
        if (!bounds) return;
        for (let mask = 0; mask < 8; mask++) {
          const point = {
            x: mask & 1 ? bounds.max.x : bounds.min.x,
            y: mask & 2 ? bounds.max.y : bounds.min.y,
            z: mask & 4 ? bounds.max.z : bounds.min.z,
          };
          const world = node.localToWorld(
            new camera.position.constructor(point.x, point.y, point.z),
          );
          const values = [world.x, world.y, world.z];
          for (let axis = 0; axis < 3; axis++) {
            min[axis] = Math.min(min[axis], values[axis]);
            max[axis] = Math.max(max[axis], values[axis]);
          }
          corners.push(world);
        }
      });
      const center = new camera.position.constructor(
        (min[0] + max[0]) / 2,
        (min[1] + max[1]) / 2,
        (min[2] + max[2]) / 2,
      );
      const size = max.map((value, i) => value - min[i]);
      const projected = corners.map((point) => point.project(camera).toArray());
      const inFrustum = projected.filter(
        ([x, y, z]) =>
          Math.abs(x) <= 1 && Math.abs(y) <= 1 && z >= -1 && z <= 1,
      ).length;
      const cameraToCenter = camera.position.distanceTo(center);
      const radius = Math.hypot(...size) / 2;
      const direction = camera.getWorldDirection(
        new camera.position.constructor(),
      );
      const toCenter = center.clone().sub(camera.position).normalize();
      const cameraAimDot = direction.dot(toCenter);
      const minProjected = [0, 1, 2].map((axis) =>
        Math.min(...projected.map((p) => p[axis])),
      );
      const maxProjected = [0, 1, 2].map((axis) =>
        Math.max(...projected.map((p) => p[axis])),
      );
      return {
        track: c.raceDefinition?.name ?? c.raceDefinition?.raceFilename,
        trackFile: c.raceDefinition?.raceFilename,
        carName: vehicle.name,
        carConfig: c.carConfig,
        camera: {
          position: camera.position.toArray(),
          quaternion: [
            camera.quaternion.x,
            camera.quaternion.y,
            camera.quaternion.z,
            camera.quaternion.w,
          ],
          fov: camera.fov,
          aspect: camera.aspect,
          near: camera.near,
          far: camera.far,
          distanceToCarCenter: cameraToCenter,
          clearancePastBoundingRadius: cameraToCenter - radius,
          angularRadiusRadians: Math.asin(Math.min(1, radius / cameraToCenter)),
          verticalFovRadians: (camera.fov * Math.PI) / 180,
          cameraAimDot,
        },
        car: {
          position: vehicle.position.toArray(),
          boundsMin: min,
          boundsMax: max,
          boundsSize: size,
          projectedNdcBounds: { min: minProjected, max: maxProjected },
          projectedPixelSize: [
            ((maxProjected[0] - minProjected[0]) * innerWidth) / 2,
            ((maxProjected[1] - minProjected[1]) * innerHeight) / 2,
          ],
          bboxCornersInFrustum: inFrustum,
          bboxCornersTotal: corners.length,
        },
        stats: { ...c.stats },
      };
    });
    assert.equal(capture.car.bboxCornersTotal > 0, true);
    assert.equal(capture.stats.ready, true);
    await page.screenshot({
      path: `artifacts/browser-camera-${phase}-${index ? "bigdump" : "eagle3"}.png`,
    });
    captures.push({ selection: carOption, capture });
  }
  const webglErrors = await page.evaluate(() => {
    const gl = document.querySelector("#view").getContext("webgl2");
    const result = [];
    for (let i = 0; i < 16; i++) {
      const error = gl.getError();
      if (error === gl.NO_ERROR) break;
      result.push(error);
    }
    return result;
  });
  assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
  assert.deepEqual(
    failedRequests,
    [],
    `failed requests: ${failedRequests.join(" | ")}`,
  );
  assert.deepEqual(webglErrors, [], `WebGL errors: ${webglErrors.join(",")}`);
  const report = {
    options: { track, cars },
    captures,
    errors,
    failedRequests,
    webglErrors,
  };
  await writeFile(
    `artifacts/browser-camera-${phase}.json`,
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
