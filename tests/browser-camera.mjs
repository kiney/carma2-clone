import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const assetRoot = process.env.CARMA2_ROOT || "carma2_orig";
const phase = (process.env.CAMERA_PHASE || "final").replace(
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
      const worldCOM = c.player.properties.centerOfMass
        .clone()
        .applyQuaternion(c.player.state.orientation)
        .add(c.player.state.position);
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
      const cameraLocal = vehicle.worldToLocal(camera.position.clone());
      const localMin = [Infinity, Infinity, Infinity];
      const localMax = [-Infinity, -Infinity, -Infinity];
      vehicle.traverse((node) => {
        if (!node.isMesh || !node.geometry?.attributes?.position) return;
        if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
        const bounds = node.geometry.boundingBox;
        if (!bounds) return;
        for (let mask = 0; mask < 8; mask++) {
          const point = node.localToWorld(
            new camera.position.constructor(
              mask & 1 ? bounds.max.x : bounds.min.x,
              mask & 2 ? bounds.max.y : bounds.min.y,
              mask & 4 ? bounds.max.z : bounds.min.z,
            ),
          );
          vehicle.worldToLocal(point);
          for (let axis = 0; axis < 3; axis++) {
            localMin[axis] = Math.min(localMin[axis], point.getComponent(axis));
            localMax[axis] = Math.max(localMax[axis], point.getComponent(axis));
          }
        }
      });
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
          localPosition: cameraLocal.toArray(),
          worldCOM: worldCOM.toArray(),
          positionFromCOM: camera.position.clone().sub(worldCOM).toArray(),
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
          localModelBounds: { min: localMin, max: localMax },
          projectedNdcBounds: { min: minProjected, max: maxProjected },
          projectedPixelSize: [
            ((maxProjected[0] - minProjected[0]) * innerWidth) / 2,
            ((maxProjected[1] - minProjected[1]) * innerHeight) / 2,
          ],
          bboxCornersInFrustum: inFrustum,
          bboxCornersTotal: corners.length,
        },
        stats: { ...c.stats },
        cameraState: c.cameraState,
      };
    });
    assert.equal(capture.car.bboxCornersTotal > 0, true);
    assert.equal(capture.stats.ready, true);
    if (phase !== "baseline") {
      assert.equal(capture.camera.fov, 55.546875);
      assert.ok(Math.abs(capture.camera.near - 0.06) < 0.00001);
      assert.equal(capture.camera.far, 35);
      if (index === 0) {
        assert.ok(Math.abs(capture.cameraState.zoom - 0.2) < 0.000001);
        assert.equal(
          capture.car.bboxCornersInFrustum,
          capture.car.bboxCornersTotal,
        );
      } else {
        assert.ok(
          capture.cameraState.zoom > 0.2 && capture.cameraState.zoom <= 2,
          `Big Dump startup zoom was not bounded above native minimum: ${JSON.stringify(capture.cameraState)}`,
        );
        assert.equal(
          capture.car.bboxCornersInFrustum,
          capture.car.bboxCornersTotal,
          `Big Dump mesh bounds are clipped at startup: ${JSON.stringify({ camera: capture.camera, bounds: capture.car.localModelBounds, projected: capture.car.projectedNdcBounds, inFrustum: capture.car.bboxCornersInFrustum, total: capture.car.bboxCornersTotal, zoom: capture.cameraState.zoom })}`,
        );
      }
    }
    await page.screenshot({
      path: `artifacts/browser-camera-${phase}-${index ? "bigdump" : "eagle3"}.png`,
    });
    captures.push({ selection: carOption, capture });
  }

  // Exercise the native camera in the real render loop. The capture scenes
  // above remain paused for reproducible geometry measurements; this pass
  // reloads Eagle 3 and uses actual Chromium controls.
  await page.evaluate(
    async ({ trackValue, carValue }) => {
      const c = window.carma;
      document.querySelector("#track-select").value = trackValue;
      document.querySelector("#car-select").value = carValue;
      await c.loadRace();
      c.paused = false;
      document.querySelector("#panel").hidden = true;
      window.__cameraContacts = [];
      const contacts = c.simulation.cameraContacts;
      const originalStep = contacts.step.bind(contacts);
      contacts.step = (impacts) => {
        originalStep(impacts);
        for (const impact of impacts) {
          if (
            impact.solverAccepted &&
            (impact.a === c.player || impact.b === c.player)
          )
            window.__cameraContacts.push({
              sourceType: impact.sourceType,
              impulse: impact.normalImpulse,
              worldContact: !impact.b,
              normal: impact.normal.toArray(),
            });
        }
      };
    },
    { trackValue: track.value, carValue: cars[0].value },
  );
  await page.waitForFunction(
    () => window.carma.stats.ready && !window.carma.paused,
    null,
    { timeout: 90000 },
  );
  await page.locator("#view").click();
  // Isolate zoom from vehicle motion while retaining the production RAF,
  // gameplay clock, camera update, world/own-shape queries and real key input.
  await page.evaluate(() => {
    const simulation = window.carma.simulation;
    window.__originalCameraPhysicsUpdate =
      simulation.updateFrame.bind(simulation);
    simulation.updateFrame = () => ({ steps: 0, skippedMs: 0 });
  });
  await page.waitForTimeout(350);
  const cameraState = () =>
    page.evaluate(() => {
      const c = window.carma;
      const camera = c.camera;
      const car = c.player.group;
      const worldCOM = c.player.properties.centerOfMass
        .clone()
        .applyQuaternion(c.player.state.orientation)
        .add(c.player.state.position);
      return {
        position: c.player.state.position.toArray(),
        velocity: c.player.state.velocity.toArray(),
        angularVelocity: c.player.state.angularVelocity.toArray(),
        speed: c.player.state.speed,
        rpm: c.player.state.rpm,
        groundedWheelCount: c.player.state.groundedWheelCount,
        input: { ...c.player.state.input },
        damage: c.player.damage?.componentLevels,
        worldCOM: worldCOM.toArray(),
        carOrientation: c.player.state.orientation.toArray(),
        cameraPosition: camera.position.toArray(),
        cameraLocalPosition: car
          .worldToLocal(camera.position.clone())
          .toArray(),
        cameraFromCOM: camera.position.clone().sub(worldCOM).toArray(),
        cameraDistance: camera.position.distanceTo(car.position),
        cameraNear: camera.near,
        cameraFar: camera.far,
        cameraFov: camera.fov,
        carVisible: car.visible,
        skyVisible: c.scene.children.some(
          (node) => node.isMesh && node.layers.mask === 2 && node.visible,
        ),
        gameFrames: c.stats.gameFrames,
        cameraUpdates: c.stats.cameraUpdates,
        cameraRuntimeState: c.cameraState,
        cameraContacts: window.__cameraContacts.length,
        worldContacts: window.__cameraContacts.filter(
          (contact) => contact.worldContact,
        ).length,
        verticalWorldContacts: window.__cameraContacts.filter(
          (contact) =>
            contact.worldContact && Math.abs(contact.normal[1]) < 0.5,
        ).length,
        recentCameraContacts: window.__cameraContacts.slice(-8),
      };
    });
  const zoomStart = await cameraState();
  await page.keyboard.down("Equal");
  await page.waitForTimeout(1100);
  await page.keyboard.up("Equal");
  const zoomIn = await cameraState();
  await page.keyboard.down("Minus");
  await page.waitForTimeout(1100);
  await page.keyboard.up("Minus");
  const zoomOut = await cameraState();
  const orbitStart = await cameraState();
  await page.keyboard.down("BracketLeft");
  await page.waitForTimeout(700);
  await page.keyboard.up("BracketLeft");
  const orbitLeft = await cameraState();
  assert.ok(
    Math.hypot(
      orbitLeft.cameraFromCOM[0] - orbitStart.cameraFromCOM[0],
      orbitLeft.cameraFromCOM[1] - orbitStart.cameraFromCOM[1],
      orbitLeft.cameraFromCOM[2] - orbitStart.cameraFromCOM[2],
    ) > 0.05,
    `BracketLeft did not orbit the native camera: ${JSON.stringify({ orbitStart, orbitLeft })}`,
  );
  assert.ok(
    Math.hypot(
      orbitLeft.cameraPosition[0] - orbitStart.cameraPosition[0],
      orbitLeft.cameraPosition[1] - orbitStart.cameraPosition[1],
      orbitLeft.cameraPosition[2] - orbitStart.cameraPosition[2],
    ) > 0.05,
    "BracketLeft changed yaw without moving the camera",
  );
  await page.keyboard.down("BracketLeft");
  await page.keyboard.down("BracketRight");
  await page.waitForTimeout(150);
  const orbitReset = await cameraState();
  assert.equal(orbitReset.cameraRuntimeState.yawBRenderAngle, 0);
  await page.keyboard.up("BracketLeft");
  await page.keyboard.up("BracketRight");
  await page.waitForTimeout(150);
  const orbitReleased = await cameraState();
  await page.keyboard.down("BracketRight");
  await page.waitForTimeout(500);
  await page.keyboard.up("BracketRight");
  const orbitAfterRelease = await cameraState();
  assert.ok(
    Math.hypot(
      orbitAfterRelease.cameraFromCOM[0] - orbitReleased.cameraFromCOM[0],
      orbitAfterRelease.cameraFromCOM[1] - orbitReleased.cameraFromCOM[1],
      orbitAfterRelease.cameraFromCOM[2] - orbitReleased.cameraFromCOM[2],
    ) > 0.05,
    `released bracket reset latch blocked a later orbit: ${JSON.stringify({ orbitReleased, orbitAfterRelease })}`,
  );
  await page.keyboard.down("BracketLeft");
  await page.keyboard.down("BracketRight");
  await page.waitForTimeout(100);
  await page.keyboard.up("BracketLeft");
  await page.keyboard.up("BracketRight");
  await page.waitForTimeout(100);
  const orbitSettled = await cameraState();
  await page.evaluate(() => {
    window.carma.simulation.updateFrame = window.__originalCameraPhysicsUpdate;
  });
  assert.ok(
    zoomIn.cameraDistance < zoomStart.cameraDistance,
    `Equal did not zoom toward the car: ${JSON.stringify({ zoomStart, zoomIn })}`,
  );
  assert.ok(
    zoomOut.cameraDistance > zoomIn.cameraDistance,
    `Minus did not zoom away from the car: ${JSON.stringify({ zoomIn, zoomOut })}`,
  );
  assert.equal(
    zoomOut.cameraUpdates - zoomStart.cameraUpdates,
    zoomOut.gameFrames - zoomStart.gameFrames,
    "chase camera must update once per active gameplay frame",
  );
  const drivingStart = await cameraState();
  await page.keyboard.down("w");
  await page.waitForTimeout(1400);
  await page.keyboard.up("w");
  const drivingForward = await cameraState();
  assert.ok(
    Math.hypot(
      drivingForward.position[0] - drivingStart.position[0],
      drivingForward.position[2] - drivingStart.position[2],
    ) > 0.15,
    `actual W input did not move Eagle 3: ${JSON.stringify({ drivingStart, drivingForward })}`,
  );
  assert.ok(drivingForward.gameFrames > drivingStart.gameFrames);
  assert.ok(
    drivingForward.skyVisible,
    "original sky background pass is missing",
  );
  await page.screenshot({
    path: `artifacts/browser-camera-${phase}-driving.png`,
  });

  await page.keyboard.press("r");
  await page.waitForTimeout(600);
  const reverseStart = await cameraState();
  await page.keyboard.down("s");
  await page.waitForFunction(
    () => window.carma.player.state.speed < -0.2,
    null,
    { timeout: 8000 },
  );
  await page.waitForTimeout(1100);
  await page.keyboard.up("s");
  const reverse = await cameraState();
  assert.ok(
    Math.hypot(
      reverse.position[0] - reverseStart.position[0],
      reverse.position[2] - reverseStart.position[2],
    ) > 0.05,
    `S input did not produce vehicle movement: ${JSON.stringify({ reverseStart, reverse })}`,
  );
  assert.ok(
    reverse.speed < -0.2,
    `S input did not produce reverse speed: ${JSON.stringify({ reverseStart, reverse })}`,
  );

  const reverseSnapshot = await cameraState();
  assert.equal(
    reverseSnapshot.cameraRuntimeState.reverse,
    true,
    `camera did not follow reverse travel: ${JSON.stringify(reverseSnapshot)}`,
  );

  const cameraUpdatesBeforeCockpit = reverseSnapshot.cameraUpdates;
  await page.keyboard.press("c");
  const cockpitTransition = await cameraState();
  await page.waitForTimeout(300);
  const cockpit = await cameraState();
  assert.equal(
    cockpit.carVisible,
    false,
    "C did not enter cockpit camera mode",
  );
  assert.ok(cockpit.cameraUpdates - cockpitTransition.cameraUpdates <= 1);
  assert.ok(cockpit.gameFrames > reverseSnapshot.gameFrames);
  await page.screenshot({
    path: `artifacts/browser-camera-${phase}-cockpit.png`,
  });
  await page.keyboard.press("c");
  const overheadTransition = await cameraState();
  await page.waitForTimeout(250);
  const overhead = await cameraState();
  assert.equal(
    overhead.carVisible,
    true,
    "C did not return the car in overhead mode",
  );
  assert.ok(overhead.cameraUpdates - overheadTransition.cameraUpdates <= 1);
  await page.screenshot({
    path: `artifacts/browser-camera-${phase}-overhead.png`,
  });
  await page.keyboard.press("c");
  await page.waitForTimeout(250);
  const chase = await cameraState();
  assert.equal(
    chase.cameraRuntimeState.reverse,
    true,
    `returning from cockpit/overhead lost reverse travel: ${JSON.stringify(chase)}`,
  );
  assert.ok(chase.cameraUpdates > cameraUpdatesBeforeCockpit);

  await page.keyboard.down("w");
  await page.keyboard.down("a");
  await page.waitForTimeout(2400);
  await page.keyboard.up("a");
  await page.keyboard.up("w");
  const wallRun = await cameraState();
  await page.screenshot({
    path: `artifacts/browser-camera-${phase}-wall-run.png`,
  });

  // Recovery is exercised through its visible debug control while paused.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => window.carma.paused, null, {
    timeout: 5000,
  });
  const pausedCamera = await cameraState();
  await page.waitForTimeout(300);
  const stillPausedCamera = await cameraState();
  assert.equal(stillPausedCamera.cameraUpdates, pausedCamera.cameraUpdates);
  assert.deepEqual(
    stillPausedCamera.cameraRuntimeState,
    pausedCamera.cameraRuntimeState,
    "paused RAFs must not mutate native chase state",
  );
  assert.deepEqual(
    stillPausedCamera.cameraPosition,
    pausedCamera.cameraPosition,
  );
  await page.click("#debug-button");
  const updatesBeforeRecovery = await page.evaluate(
    () => window.carma.stats.cameraUpdates,
  );
  await page.click("#debug-recover");
  await page.waitForFunction(
    (updates) => window.carma.stats.cameraUpdates > updates,
    updatesBeforeRecovery,
    { timeout: 3000 },
  );
  await page.waitForTimeout(300);
  const recovered = await cameraState();
  assert.equal(await page.evaluate(() => window.carma.paused), true);
  assert.ok(recovered.position.every(Number.isFinite));
  assert.ok(recovered.cameraPosition.every(Number.isFinite));
  assert.ok(
    recovered.cameraDistance < 3,
    `camera did not reset near the recovered vehicle: ${JSON.stringify(recovered)}`,
  );
  assert.ok(recovered.skyVisible);
  assert.equal(
    recovered.cameraUpdates,
    updatesBeforeRecovery + 1,
    `paused recovery should cause exactly one camera reset update: ${JSON.stringify({ updatesBeforeRecovery, recovered })}`,
  );
  assert.deepEqual(
    await cameraState().then((state) => state.cameraRuntimeState),
    recovered.cameraRuntimeState,
    "paused recovery camera state should settle after its one reset update",
  );
  await page.screenshot({
    path: `artifacts/browser-camera-${phase}-recovered.png`,
  });

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
    controls: {
      drivingStart,
      drivingForward,
      zoomStart,
      zoomIn,
      zoomOut,
      orbitStart,
      orbitLeft,
      orbitReset,
      orbitReleased,
      orbitAfterRelease,
      orbitSettled,
      reverseStart,
      reverse,
      reverseSnapshot,
      wallRun,
      cockpit,
      overhead,
      chase,
      pausedCamera,
      stillPausedCamera,
      recovered,
    },
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
