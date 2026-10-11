import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const assetRoot = process.env.CARMA2_ROOT || "carma2_orig";
try {
  await access(executable);
  await access(assetRoot);
} catch {
  console.log(
    "SKIP noncar quiet browser QA: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5223;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
const report = {
  build: null,
  cases: [],
  errors: [],
  failedRequests: [],
  unmet: [],
  uncoveredTargets: [],
  coverageComplete: false,
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
  page.on("pageerror", (error) =>
    report.errors.push({ message: String(error), stack: error.stack }),
  );
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
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  const targets = await page.evaluate(() => {
    const options = [...document.querySelector("#track-select").options];
    const choose = (prefix, pattern) =>
      options.find(
        (option) =>
          option.value.toLowerCase().startsWith(prefix) &&
          new RegExp(pattern, "i").test(
            `${option.value} ${option.textContent}`,
          ),
      )?.value;
    return [
      { label: "stock Newcity1", path: choose("data/", "newcity1") },
      { label: "stock Carrier1", path: choose("data/", "carrier1") },
      { label: "Advanced Newcity1", path: choose("adv_data/", "newcity1") },
      { label: "Advanced Carrier1", path: choose("adv_data/", "carrier1") },
    ];
  });
  const carPath = await page.evaluate(() =>
    window.carma.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT"),
  );
  assert.ok(carPath, "stock Eagle car configuration unavailable");

  for (const target of targets) {
    if (!target.path) {
      report.uncoveredTargets.push({
        label: target.label,
        reason: "no matching race catalog entry",
      });
      continue;
    }
    await page.evaluate(
      async ({ path, car }) => {
        const c = window.carma;
        document.querySelector("#track-select").value = path;
        document.querySelector("#car-select").value = car;
        await c.loadRace();
        c.paused = true;
        document.querySelector("#panel").hidden = true;
      },
      { path: target.path, car: carPath },
    );
    await page.waitForFunction(
      () => window.carma.stats.ready && window.carma.paused,
      null,
      { timeout: 90000 },
    );

    const spawned = await page.evaluate(
      ({ label }) => {
        const c = window.carma;
        const destruction = c.simulation.destruction;
        const allConnotations = (spec) => [
          ...(spec.connotations ? [spec.connotations] : []),
          ...spec.levels.map((level) => level.connotations),
        ];
        const candidates = [];
        for (const [specIndex, spec] of destruction.specs.entries()) {
          for (const [connotationIndex, data] of allConnotations(
            spec,
          ).entries()) {
            const noncars = data.shrapnel.filter(
              (item) => item.kind === "noncars",
            );
            if (!noncars.length) continue;
            const actor = destruction.retainActors.find((item) =>
              item.userData.worldSmashSpecIndices?.includes(specIndex),
            );
            if (actor)
              candidates.push({
                specIndex,
                connotationIndex,
                spec,
                data,
                actor,
                noncars,
              });
          }
        }
        candidates.sort(
          (a, b) =>
            (a.spec.trigger.kind === "model" ? 0 : 1) -
            (b.spec.trigger.kind === "model" ? 0 : 1),
        );
        const selected = candidates[0];
        if (!selected)
          return {
            label,
            supported: false,
            reason: "no authored noncars outlet",
          };
        const mesh = (() => {
          let found;
          selected.actor.traverse((node) => {
            if (!found && node.isMesh && node.visible) found = node;
          });
          return found;
        })();
        if (!mesh)
          return {
            label,
            supported: false,
            reason: "outlet actor has no visible mesh",
          };
        const before = new Set(c.simulation.noncars.map((body) => body.actor));
        selected.actor.updateWorldMatrix(true, true);
        const point = selected.actor.getWorldPosition(
          new mesh.position.constructor(),
        );
        // Controlled native outlet fixture: WorldDestruction owns the original authored trigger.
        // This is not counted as a driven collision or as proof of sleep.
        c.player.state.position
          .copy(point)
          .add(new mesh.position.constructor(0, 0, 12));
        c.player.state.velocity.set(0, 0, 0);
        c.player.state.heading = 0;
        c.player.state.orientation.identity();
        c.simulation.sync(c.player);
        const impulse = Math.max(
          1000,
          (selected.spec.removalThreshold ?? 0) + 1,
        );
        const result = destruction.handleContact({
          actor:
            selected.spec.trigger.kind === "material" ? mesh : selected.actor,
          material: selected.spec.trigger.name,
          faceIndex: 0,
          normalImpulse: impulse,
          kind: "body",
          bodyActor: c.player.group,
          impacteeVelocity: c.player.state.velocity.clone(),
          smashStartingVelocity: c.player.state.velocity.clone(),
          effectMagnitude: impulse,
          impacteeTransform: c.player.group.matrixWorld.clone(),
          point,
          timeMs: c.stats.gameTimeMs,
        });
        const bodies = c.simulation.noncars.filter(
          (body) => !before.has(body.actor),
        );
        const snapshot = (body) => {
          const quiet = c.simulation.nativeNonCarQuietState(body);
          return {
            name: body.actor.name,
            slot: body.actor.userData.nativeDebrisSlot ?? null,
            pulled: body.actor.userData.noncarPulled ?? false,
            position: body.state.position.toArray(),
            orientation: body.state.orientation.toArray(),
            velocity: body.state.velocity.toArray(),
            angularVelocity: body.state.angularVelocity.toArray(),
            mass: body.properties.mass,
            inertia: body.properties.inertia.toArray(),
            immovable: body.properties.immovable,
            collisionFlags: body.collisionFlags,
            motorSleeping: body.motor.sleeping,
            quiet: quiet && {
              doNothing: quiet.doNothing,
              quietState: quiet.quietState,
              eligibleLeaves: quiet.eligibleLeaves,
              sleepTransitions: quiet.sleepTransitions,
              wakeTransitions: quiet.wakeTransitions,
              inertiaScale: quiet.inertiaScale,
              bounds: quiet.bounds,
              unsupported: quiet.unsupported,
              lastResult: quiet.lastResult && {
                quietState: quiet.lastResult.quietState,
                quietEligible: quiet.lastResult.quietEligible,
                zeroVelocities: quiet.lastResult.zeroVelocities,
                gate: quiet.lastResult.gate,
                gravityComparisonUnordered:
                  quiet.lastResult.gravityComparisonUnordered,
              },
            },
          };
        };
        window.__quietTrace = { refs: bodies.map((body) => body.actor) };
        return {
          label,
          supported: true,
          fixture:
            "controlled WorldDestruction.handleContact on original authored outlet; not driven",
          track: document.querySelector("#track-select").value,
          outlet: {
            trigger: selected.spec.trigger,
            mode: selected.spec.mode,
            threshold: selected.spec.removalThreshold ?? null,
            connotation: selected.connotationIndex,
            authored: selected.noncars.map((item) => ({
              amount: item.amount,
              templates: item.nonCars,
              speed: item.speed,
              fireChance: item.fire?.chance ?? 0,
              fireCount: item.fire?.count ?? 0,
            })),
          },
          impact: { changed: result.changed, diagnostics: result.diagnostics },
          count: bodies.length,
          bodies: bodies.map(snapshot),
        };
      },
      { label: target.label },
    );
    report.cases.push(spawned);
    if (!spawned.supported || spawned.count === 0) {
      report.uncoveredTargets.push({
        label: target.label,
        reason: spawned.reason ?? "authored outlet spawned no noncar body",
      });
      continue;
    }

    // Let native forces and real contacts settle the created original body. Pauses only bracket observations.
    const launchedAt = await page.evaluate(() => ({
      gameTimeMs: window.carma.stats.gameTimeMs,
      rawPerf: performance.now(),
      paused: window.carma.paused,
    }));
    await page.evaluate(() => {
      window.carma.paused = false;
    });
    // Observe every browser frame on-page so a one-tick eligible leaf cannot
    // disappear between Node's slower diagnostic polls.
    const wallStart = Date.now();
    const quietObservation = await page.evaluate(async (waitMs) => {
      const c = window.carma;
      const eligibleNames = new Set();
      const started = performance.now();
      const snapshots = [];
      while (performance.now() - started < waitMs) {
        const bodies = (window.__quietTrace.refs ?? []).map((actor) => {
          const body = c.simulation.noncars.find(
            (item) => item.actor === actor,
          );
          const state = body && c.simulation.nativeNonCarQuietState(body);
          if (!body || !state) return null;
          const snapshot = {
            name: actor.name,
            position: body.state.position.toArray(),
            velocity: body.state.velocity.toArray(),
            angularVelocity: body.state.angularVelocity.toArray(),
            immovable: body.properties.immovable,
            collisionFlags: body.collisionFlags,
            motorSleeping: body.motor.sleeping,
            doNothing: state.doNothing,
            quietState: state.quietState,
            eligibleLeaves: state.eligibleLeaves,
            sleepTransitions: state.sleepTransitions,
            wakeTransitions: state.wakeTransitions,
            inertia: body.properties.inertia.toArray(),
            inertiaScale: state.inertiaScale,
            lastResult: state.lastResult && {
              quietState: state.lastResult.quietState,
              quietEligible: state.lastResult.quietEligible,
              zeroVelocities: state.lastResult.zeroVelocities,
              gate: state.lastResult.gate,
              gravityComparisonUnordered:
                state.lastResult.gravityComparisonUnordered,
            },
          };
          if (snapshot.lastResult?.quietEligible)
            eligibleNames.add(snapshot.name);
          if (snapshot.eligibleLeaves > 0) eligibleNames.add(snapshot.name);
          return snapshot;
        });
        snapshots.push({ gameTimeMs: c.stats.gameTimeMs, bodies });
        const sleeping = bodies.find(
          (body) =>
            body?.doNothing &&
            body.eligibleLeaves > 0 &&
            body.sleepTransitions > 0 &&
            eligibleNames.has(body.name),
        );
        if (sleeping)
          return {
            kind: "native-eligible-then-doNothing",
            eligibleNames: [...eligibleNames],
            bodies,
            sampledFrames: snapshots.length,
          };
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return {
        kind: "no-native-eligible-sleep-transition",
        eligibleNames: [...eligibleNames],
        sampledFrames: snapshots.length,
        lastSamples: snapshots.slice(-5),
      };
    }, 18000);
    await page.evaluate(() => {
      window.carma.paused = true;
    });
    spawned.settle = {
      launchedAt,
      wallElapsedMs: Date.now() - wallStart,
      sampledFrames: quietObservation.sampledFrames,
      endState: await page.evaluate(() => ({
        gameTimeMs: window.carma.stats.gameTimeMs,
        paused: window.carma.paused,
        raceStatus: window.carma.race?.status ?? null,
        gameFrames: window.carma.stats.gameFrames,
      })),
      quietObservation,
      lastSample: await page.evaluate(() => {
        const c = window.carma;
        return (window.__quietTrace.refs ?? []).map((actor) => {
          const body = c.simulation.noncars.find(
            (item) => item.actor === actor,
          );
          const state = body && c.simulation.nativeNonCarQuietState(body);
          return body && state
            ? {
                name: actor.name,
                position: body.state.position.toArray(),
                velocity: body.state.velocity.toArray(),
                angularVelocity: body.state.angularVelocity.toArray(),
                immovable: body.properties.immovable,
                collisionFlags: body.collisionFlags,
                motorSleeping: body.motor.sleeping,
                doNothing: state.doNothing,
                quietState: state.quietState,
                eligibleLeaves: state.eligibleLeaves,
                sleepTransitions: state.sleepTransitions,
                wakeTransitions: state.wakeTransitions,
                inertia: body.properties.inertia.toArray(),
                inertiaScale: state.inertiaScale,
                lastResult: state.lastResult && {
                  quietState: state.lastResult.quietState,
                  quietEligible: state.lastResult.quietEligible,
                  zeroVelocities: state.lastResult.zeroVelocities,
                  gate: state.lastResult.gate,
                  gravityComparisonUnordered:
                    state.lastResult.gravityComparisonUnordered,
                },
              }
            : null;
        });
      }),
    };
    const firstSleeping = quietObservation?.bodies?.find(
      (body) =>
        body?.doNothing && quietObservation.eligibleNames.includes(body.name),
    );
    if (firstSleeping) {
      // Controlled second-body placement and velocity fixture; wake must arise from production contact processing.
      spawned.wake = await page.evaluate(
        ({ name }) => {
          const c = window.carma;
          const target = (window.__quietTrace.refs ?? [])
            .map((actor) =>
              c.simulation.noncars.find((body) => body?.actor === actor),
            )
            .find((body) => body?.actor.name === name);
          if (!target)
            return { reached: false, reason: "resting body disappeared" };
          const quiet = c.simulation.nativeNonCarQuietState(target);
          const initial = {
            position: target.state.position.toArray(),
            velocity: target.state.velocity.toArray(),
            doNothing: quiet?.doNothing ?? null,
            eligibleLeaves: quiet?.eligibleLeaves ?? null,
            sleepTransitions: quiet?.sleepTransitions ?? null,
            wakeTransitions: quiet?.wakeTransitions ?? null,
            immovable: target.properties.immovable,
            gameTimeMs: c.stats.gameTimeMs,
          };
          const player = c.player;
          const start = target.state.position.clone();
          // Controlled physical overlap from a separate, labeled setup: no quiet state, flags, or contact masks are edited.
          player.state.position.copy(start).add(new start.constructor(0, 0, 3));
          player.state.velocity.set(0, 0, -25);
          player.state.heading = 0;
          player.state.orientation.identity();
          c.simulation.sync(player);
          window.__quietWakeTarget = target.actor;
          return {
            reached: true,
            fixture:
              "controlled Eagle/player body placement and velocity; production collision step",
            initial,
          };
        },
        { name: firstSleeping.name },
      );
      if (spawned.wake.reached) {
        await page.evaluate(() => {
          window.carma.paused = false;
        });
        await page.waitForTimeout(1200);
        await page.evaluate(() => {
          window.carma.paused = true;
        });
        spawned.wake.after = await page.evaluate(() => {
          const c = window.carma;
          const actor = window.__quietWakeTarget;
          const body = c.simulation.noncars.find(
            (item) => item.actor === actor,
          );
          const state = body && c.simulation.nativeNonCarQuietState(body);
          return body && state
            ? {
                position: body.state.position.toArray(),
                velocity: body.state.velocity.toArray(),
                angularVelocity: body.state.angularVelocity.toArray(),
                doNothing: state.doNothing,
                quietState: state.quietState,
                eligibleLeaves: state.eligibleLeaves,
                sleepTransitions: state.sleepTransitions,
                wakeTransitions: state.wakeTransitions,
                immovable: body.properties.immovable,
                collisionFlags: body.collisionFlags,
                motorSleeping: body.motor.sleeping,
                gameTimeMs: c.stats.gameTimeMs,
              }
            : null;
        });
        spawned.wake.contactObserved = Boolean(
          spawned.wake.after &&
            spawned.wake.after.doNothing === false &&
            spawned.wake.after.wakeTransitions >
              (spawned.wake.initial.wakeTransitions ?? 0) &&
            spawned.wake.after.velocity.some((value) => Math.abs(value) > 1e-5),
        );
      }
    } else {
      spawned.wake = {
        reached: false,
        reason:
          "no production doNothing state reached within bounded native simulation wait",
      };
      report.uncoveredTargets.push({
        label: target.label,
        reason:
          "native noncar quiet sleep not reached during bounded simulation; second-body wake phase could not be exercised",
      });
    }

    const webglErrors = await page.evaluate(() => {
      const gl = window.carma.renderer.getContext();
      const errors = [];
      for (let i = 0; i < 32; i++) {
        const error = gl.getError();
        if (error === gl.NO_ERROR) break;
        errors.push(error);
      }
      return errors;
    });
    spawned.webglErrors = webglErrors;
    if (webglErrors.length)
      report.unmet.push(
        `${target.label}: WebGL errors ${webglErrors.join(",")}`,
      );
    const invalid = spawned.settle.lastSample.filter(
      (body) =>
        body &&
        [
          ...body.position,
          ...body.velocity,
          ...body.angularVelocity,
          ...body.inertia,
        ].some((value) => !Number.isFinite(value)),
    );
    if (invalid.length)
      report.unmet.push(`${target.label}: non-finite native quiet body fields`);
    if (spawned.wake.reached && !spawned.wake.contactObserved)
      report.uncoveredTargets.push({
        label: target.label,
        reason:
          "controlled placement did not produce an observed wake transition with exchanged velocity before the bounded sample",
        wake: spawned.wake,
      });
  }

  report.coverageComplete =
    report.cases.length === targets.length &&
    report.cases.every(
      (item) =>
        item.settle?.quietObservation.kind ===
          "native-eligible-then-doNothing" && item.wake?.contactObserved,
    );
  if (
    !report.cases.some(
      (item) =>
        item.settle?.quietObservation.kind === "native-eligible-then-doNothing",
    )
  )
    report.unmet.push(
      "No actual native eligible-leaf-to-doNothing transition observed across original tracks",
    );
  if (!report.cases.some((item) => item.wake?.contactObserved))
    report.unmet.push(
      "No controlled production second-body contact woke a resting noncar and exchanged velocity",
    );
  await writeFile(
    "artifacts/browser-noncar-quiet.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  assert.deepEqual(
    report.errors,
    [],
    `console/runtime errors: ${JSON.stringify(report.errors)}`,
  );
  assert.deepEqual(
    report.failedRequests,
    [],
    `failed requests: ${JSON.stringify(report.failedRequests)}`,
  );
  assert.deepEqual(
    report.unmet,
    [],
    "noncar quiet browser checks failed; see artifacts/browser-noncar-quiet.json",
  );
  console.log(
    `PASS noncar quiet browser QA: ${report.cases.length} original track cases; coverageComplete=${report.coverageComplete}; artifacts/browser-noncar-quiet.json`,
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
