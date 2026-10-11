import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const assetRoot = process.env.CARMA2_ROOT || "carma2_orig";
try {
  await access(executable);
  await access(assetRoot);
} catch {
  console.log(
    "SKIP skidmark browser regression: Chromium or C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5217;
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
  const loadRace = async (trackHint, carHint) => {
    await page.evaluate(
      async ({ trackHint, carHint }) => {
        const c = window.carma;
        const find = (hintSource, select, stockOnly = false) => {
          const hint = new RegExp(hintSource, "i");
          const options = [...document.querySelector(select).options];
          return options.find(
            (option) =>
              (!stockOnly ||
                !option.value.toLowerCase().startsWith("adv_data/")) &&
              hint.test(`${option.value} ${option.text}`),
          )?.value;
        };
        const track = find(trackHint, "#track-select");
        const car = find(carHint, "#car-select", true);
        if (!track || !car)
          throw new Error(
            `Missing stock race/car option: ${trackHint}, ${carHint}`,
          );
        document.querySelector("#track-select").value = track;
        document.querySelector("#car-select").value = car;
        await c.loadRace();
        c.paused = false;
        document.querySelector("#panel").hidden = true;
      },
      { trackHint, carHint },
    );
    await page.waitForFunction(() => window.carma.stats.ready, null, {
      timeout: 90000,
    });
    await page.waitForTimeout(1500);
  };

  const drive = async (keys, durationMs) => {
    await page.locator("#view").click({ position: { x: 640, y: 400 } });
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(durationMs);
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(1000);
  };
  const startTrace = async () =>
    page.evaluate(() => {
      window.__skidTrace = [];
      const simulation = window.carma.simulation;
      window.__skidTraceOriginal = simulation.onWheelMarks;
      const nativeRequests = (demand, cap0, cap1, reduction, currentCar) => {
        const f = Math.fround;
        const d = f(demand),
          c0 = f(cap0),
          c1 = f(cap1),
          r = f(reduction);
        const threshold = currentCar ? 20 : 60;
        const requested = [false, false];
        const reasons = [];
        const qualifies = (cap) => cap > 0.1;
        if (d > c0 && d > c1) {
          const denominator = f(c0 + c1);
          const quotient =
            denominator === 0 ? Infinity : (d + d - c0 - c1) / denominator;
          const pass = quotient >= threshold;
          if (pass) {
            requested[0] = qualifies(c0);
            requested[1] = qualifies(c1);
          }
          reasons.push({
            branch: "both-over-capacity",
            quotient,
            threshold,
            pass,
            requested: [...requested],
          });
          return { requested, reasons };
        }
        if (d > c0) {
          const residual = f(d - f(r * c0) + d);
          const quotient = (residual - c1) / c1;
          const pass = residual > c1 && qualifies(c1) && quotient >= threshold;
          if (pass) requested[1] = true;
          reasons.push({
            branch: "first-over-capacity",
            quotient,
            threshold,
            pass,
            requested: [...requested],
          });
          return { requested, reasons };
        }
        if (d > c1) {
          const residual = f(d - f(r * c1) + d);
          const quotient = (residual - c0) / c0;
          const pass = residual > c0 && qualifies(c0) && quotient >= threshold;
          if (pass) requested[0] = true;
          reasons.push({
            branch: "second-over-capacity",
            quotient,
            threshold,
            pass,
            requested: [...requested],
          });
          return { requested, reasons };
        }
        reasons.push({
          branch: "within-capacity",
          quotient: null,
          threshold,
          pass: false,
          requested: [...requested],
        });
        return { requested, reasons };
      };
      simulation.onWheelMarks = function (body) {
        const debug = body.debug;
        const rear = nativeRequests(
          debug?.axleDemands?.[0] ?? 0,
          debug?.wheelCapacities?.[0] ?? 0,
          debug?.wheelCapacities?.[1] ?? 0,
          body.motion.slipMultiplier,
          debug?.skidCurrentCar ?? body.human,
        );
        const front = nativeRequests(
          debug?.axleDemands?.[1] ?? 0,
          debug?.wheelCapacities?.[2] ?? 0,
          debug?.wheelCapacities?.[3] ?? 0,
          body.motion.slipMultiplier,
          debug?.skidCurrentCar ?? body.human,
        );
        window.__skidTrace.push({
          human: !!body.human,
          playerMatch: body === window.carma.player,
          requested: body.debug?.skidRequests?.some(Boolean) ?? false,
          contacts: body.debug?.wheelContacts?.filter(Boolean).length ?? 0,
          axleDemands: debug?.axleDemands,
          wheelCapacities: debug?.wheelCapacities,
          skidCurrentCar: debug?.skidCurrentCar,
          expectedRequests: [...rear.requested, ...front.requested],
          gateReasons: [...rear.reasons, ...front.reasons],
          actualRequests: [...(debug?.skidRequests ?? [])],
          created: window.carma.skidmarks.debug.created,
          position: body.state.position.toArray(),
        });
        return window.__skidTraceOriginal.call(this, body);
      };
    });
  const stopTrace = async () =>
    page.evaluate(() => {
      window.carma.simulation.onWheelMarks = window.__skidTraceOriginal;
      return window.__skidTrace;
    });
  const webglErrors = async () =>
    page.evaluate(() => {
      const gl = document.querySelector("#view").getContext("webgl2");
      if (!gl) throw new Error("WebGL2 context unavailable");
      const errors = [];
      for (let i = 0; i < 16; i++) {
        const error = gl.getError();
        if (error === gl.NO_ERROR) break;
        errors.push(error);
      }
      return errors;
    });
  const readRun = async () =>
    page.evaluate(() => {
      const c = window.carma;
      const body = c.player;
      const snap = c.skidmarks.snapshot(body.group);
      const visible = snap.marks.filter((mark) => mark.visible);
      const maps = [...new Set(visible.map((mark) => mark.material))];
      const requests = body.debug?.skidRequests ?? [];
      const contacts = body.debug?.wheelContacts ?? [];
      return {
        debug: c.skidmarks.debug,
        visible: visible.length,
        materials: maps,
        visiblePositions: visible.map((mark) => mark.position),
        visibleUvs: visible.map((mark) => mark.uv),
        visibleLengths: visible.map((mark) =>
          Math.hypot(mark.matrix[0], mark.matrix[1], mark.matrix[2]),
        ),
        requests: [...requests],
        contacts: contacts.map(
          (hit) =>
            hit && {
              material: hit.surface?.material,
              pixelmapType: hit.surface?.pixelmapType,
            },
        ),
        surfaceSkids: body.debug?.wheelSurfaceModifiers?.map(
          (modifier) => modifier?.skidMaterial,
        ),
        materialTextures: [...new Set(maps)].map((name) => {
          const material = [...c.skidmarks.group.children].find(
            (mesh) => mesh.material?.name === name,
          )?.material;
          const image = material?.map?.image;
          const pixels = image?.data;
          let fractionalAlpha = false;
          if (pixels && pixels.length >= 4) {
            const channels = pixels.length % 4 === 0 ? 4 : 0;
            if (channels)
              for (let i = 3; i < pixels.length; i += 4)
                if (pixels[i] > 0 && pixels[i] < 255) {
                  fractionalAlpha = true;
                  break;
                }
          }
          return {
            name,
            hasMap: !!material?.map,
            opacity: material?.opacity,
            transparent: material?.transparent,
            imageKind: image?.constructor?.name,
            fractionalAlpha,
          };
        }),
        pos: body.state.position.toArray(),
        velocity: body.state.velocity.toArray(),
      };
    });

  const cases = [
    { track: "newcity1", car: "eagle3", label: "Eagle/Newcity" },
    { track: "snow|ice|ski", car: "eagle3", label: "Eagle/Snow" },
    { track: "desert", car: "buggy", label: "Buggy/Desert" },
  ];
  const results = [];
  let cameraMode = 0;
  for (const testCase of cases) {
    try {
      await loadRace(testCase.track, testCase.car);
      const before = await readRun();
      await startTrace();
      // These are ordinary player inputs. No skid request/contact state is written by the harness.
      await drive(["ArrowUp", "ArrowLeft"], 11000);
      await drive(["ArrowUp", "ArrowRight", "Space"], 6000);
      const driven = await readRun();
      assert.ok(
        driven.debug.created > before.debug.created,
        `${testCase.label}: no skid sections created; ${JSON.stringify(driven)}`,
      );
      assert.ok(
        driven.visible > 0,
        `${testCase.label}: skid pool has no visible sections`,
      );
      assert.ok(
        driven.materials.some((name) => name && name !== ""),
        `${testCase.label}: visible sections lack original material`,
      );
      assert.ok(
        driven.materialTextures.every(
          (material) => material.hasMap && material.transparent,
        ),
        `${testCase.label}: original skid material texture missing/opaque: ${JSON.stringify(driven.materialTextures)}`,
      );
      assert.ok(
        driven.materialTextures.some((material) => material.fractionalAlpha),
        `${testCase.label}: original skid PIX texture has no fractional alpha: ${JSON.stringify(driven.materialTextures)}`,
      );

      await page.evaluate(() => (window.carma.paused = false));
      await drive([], 7500);
      const coasted = await readRun();
      const trace = await stopTrace();
      const playerTrace = trace.filter((sample) => sample.playerMatch);
      assert.ok(
        playerTrace.length > 0,
        `${testCase.label}: no force-step diagnostics for c.player`,
      );
      assert.ok(
        playerTrace.some((sample) => sample.contacts > 0),
        `${testCase.label}: human-car trace had no real wheel contacts`,
      );
      for (const sample of playerTrace)
        assert.deepEqual(
          sample.actualRequests,
          sample.expectedRequests,
          `${testCase.label}: live native wheel request differs from source gate math`,
        );
      const expectedRequestSamples = playerTrace.filter((sample) =>
        sample.expectedRequests.some(Boolean),
      );
      if (testCase.label !== "Buggy/Desert")
        assert.ok(
          expectedRequestSamples.length > 0,
          `${testCase.label}: source gates never requested a skid during ordinary driving`,
        );
      assert.ok(
        coasted.visible > 0,
        `${testCase.label}: marks did not persist after input release`,
      );
      assert.ok(
        coasted.debug.created >= driven.debug.created,
        `${testCase.label}: mark pool regressed during coast`,
      );
      await page.keyboard.press("r");
      await page.waitForTimeout(3000);
      const recovered = await readRun();
      assert.ok(
        recovered.visible > 0,
        `${testCase.label}: marks did not persist through recovery`,
      );

      while (cameraMode !== 2) {
        await page.keyboard.press("c");
        cameraMode = (cameraMode + 1) % 3;
      }
      await page.evaluate(() => {
        window.carma.paused = true;
        document.querySelector("#panel").hidden = true;
        document.querySelector("#menu-button").style.display = "none";
      });
      await page.waitForTimeout(1000);
      const screenshot = `artifacts/skidmarks-${testCase.label.toLowerCase().replaceAll("/", "-")}.png`;
      const glErrors = await webglErrors();
      assert.deepEqual(glErrors, [], `${testCase.label}: WebGL2 errors`);
      await page.screenshot({ path: screenshot });
      results.push({
        label: testCase.label,
        before,
        driven,
        coasted,
        recovery: {
          createdDelta: recovered.debug.created - coasted.debug.created,
          maximumVisibleSectionLength: Math.max(...recovered.visibleLengths),
        },
        trace: {
          playerSamples: playerTrace.length,
          requestedSamples: expectedRequestSamples.length,
          contactSamples: playerTrace.filter((sample) => sample.contacts > 0)
            .length,
          gateReasons: [
            ...new Set(
              playerTrace.flatMap((sample) =>
                sample.gateReasons.map((reason) => reason.branch),
              ),
            ),
          ],
          dryGateEvidence:
            testCase.label === "Buggy/Desert" &&
            expectedRequestSamples.length === 0
              ? playerTrace.slice(-8).map((sample) => sample.gateReasons)
              : undefined,
        },
        glErrors,
        screenshot,
      });
    } catch (error) {
      results.push({ label: testCase.label, failure: String(error) });
    }
  }

  // The desert Buggy dry run may legitimately remain below C2's current-car
  // skid gate. Use the stock debug grant and F key to test oil-driven marks
  // independently on that authored surface.
  try {
    await loadRace("desert", "buggy");
    await page.evaluate(() => {
      const c = window.carma;
      const [sx, sy, sz] = c.track.start;
      let placement = null;
      for (let radius = 0; radius <= 8 && !placement; radius++) {
        for (let x = -radius; x <= radius && !placement; x++) {
          for (let z = -radius; z <= radius && !placement; z++) {
            if (Math.max(Math.abs(x), Math.abs(z)) !== radius) continue;
            const ground = c.collision.height(sx + x, sz + z, sy + 4);
            if (ground === null) continue;
            const candidate = c.player.state.position
              .clone()
              .set(sx + x, ground, sz + z);
            const surface = c.simulation.projectOil(candidate, 0.4, null);
            if (!surface || surface.normal.y < 0.97) continue;
            if (
              surface.nearbyFaceNormals.some((normal, i) => {
                const dot = normal.clone().normalize().dot(surface.normal);
                return (
                  dot < 0.98 &&
                  (dot > 0.8 || surface.sameSideOfNearbyPlanes[i] === false)
                );
              })
            )
              continue;
            placement = candidate;
          }
        }
      }
      if (!placement)
        throw new Error(
          "No source-valid oil placement near original desert start",
        );
      c.player.state.position.copy(placement);
      c.player.state.velocity.set(0, 0, 0);
      c.player.state.angularVelocity.set(0, 0, 0);
      c.simulation.reset(c.player);
      c.powerups.resetPath(c.player.state.position);
    });
    await page.click("#debug-button");
    await page.waitForFunction(
      () => document.querySelector("#debug-enabled").checked,
    );
    await page.selectOption("#debug-powerup", "53");
    await page.click("#debug-grant");
    const granted = await page.evaluate(() => ({
      action: window.carma.powerups.abilities.get(53)?.definition.action,
      charges: window.carma.powerups.abilities.get(53)?.charges,
    }));
    assert.deepEqual(
      granted,
      { action: 35, charges: 5 },
      "normal debug grant adds original oil ability",
    );
    await page.click("#debug-close");
    await startTrace();
    await page.keyboard.press("f");
    await page.waitForFunction(
      () =>
        window.carma.simulation.oil.spills.some((spill) => spill?.mesh.visible),
      null,
      { timeout: 10000 },
    );
    const afterDrop = await page.evaluate(() => ({
      charges: window.carma.powerups.abilities.get(53)?.charges,
      spills: window.carma.simulation.oil.spills.filter(
        (spill) => spill?.mesh.visible,
      ).length,
      position: window.carma.player.state.position.toArray(),
    }));
    assert.equal(
      afterDrop.charges,
      4,
      "F uses the granted oil ability through the normal route",
    );
    await drive(["ArrowUp", "ArrowLeft"], 5000);
    const driven = await readRun();
    const trace = await stopTrace();
    assert.ok(
      trace.some((sample) => sample.playerMatch && sample.contacts > 0),
      "desert Buggy has real human wheel contacts during oil drive",
    );
    assert.ok(
      driven.materials.includes("OILSMEAR.MAT"),
      `oil traversal created no original OILSMEAR mark: ${JSON.stringify({ debug: driven.debug, materials: driven.materials, oilFactors: trace.filter((sample) => sample.playerMatch).slice(-5) })}`,
    );
    const screenshot = "artifacts/skidmarks-buggy-desert-oil.png";
    while (cameraMode !== 2) {
      await page.keyboard.press("c");
      cameraMode = (cameraMode + 1) % 3;
    }
    await page.evaluate(() => {
      window.carma.paused = true;
      document.querySelector("#panel").hidden = true;
      document.querySelector("#menu-button").style.display = "none";
    });
    const glErrors = await webglErrors();
    assert.deepEqual(glErrors, [], "Buggy/Desert oil: WebGL2 errors");
    await page.screenshot({ path: screenshot });
    results.push({
      label: "Buggy/Desert oil via debug+F",
      afterDrop,
      driven,
      trace: trace.filter((sample) => sample.playerMatch).length,
      glErrors,
      screenshot,
    });
  } catch (error) {
    results.push({
      label: "Buggy/Desert oil via debug+F",
      failure: String(error),
    });
  }

  const materialNames = new Set(
    results.flatMap(({ driven }) => driven?.materials ?? []),
  );
  const report = results.map(
    ({ label, failure, driven, trace, recovery, afterDrop, screenshot }) => ({
      label,
      failure,
      created: driven?.debug.created,
      extended: driven?.debug.extended,
      materials: driven?.materials,
      fractionalAlpha: driven?.materialTextures.map((material) => [
        material.name,
        material.fractionalAlpha,
      ]),
      trace,
      recovery,
      oilDrop: afterDrop,
      glErrors: results.find((result) => result.label === label)?.glErrors,
      screenshot,
    }),
  );
  console.log(
    JSON.stringify({ results: report, errors, failedRequests }, null, 2),
  );
  assert.equal(errors.length, 0, `browser errors: ${errors.join("\n")}`);
  assert.equal(
    failedRequests.length,
    0,
    `failed requests: ${failedRequests.join("\n")}`,
  );
  assert.ok(
    materialNames.size >= 2,
    `track material changes did not select distinct skid sources: ${[...materialNames].join(", ")}`,
  );
  assert.ok(
    results.every((result) => !result.failure),
    `skidmark case failures: ${results
      .filter((result) => result.failure)
      .map((result) => `${result.label}: ${result.failure}`)
      .join("\n")}`,
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
