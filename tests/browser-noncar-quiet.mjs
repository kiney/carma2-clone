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
        const loadedPlayerPose = {
          position: c.player.state.position.clone(),
          orientation: c.player.state.orientation.clone(),
        };
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
        const authoredLaunch = bodies.map(snapshot);
        const sim = c.simulation,
          player = c.player;
        const V = player.state.position.constructor;
        const B = player.damage.runtimeParts[0].bounds.constructor;
        const Q = player.state.orientation.constructor;
        const dropBody = bodies.find(
          (body) => !body.attached && !body.joint && !body.mechanics.worldJoint,
        );
        const dropObservations = [];
        let controlledDrop;
        if (dropBody) {
          const originalHulls = dropBody.hulls;
          const originalMass = dropBody.properties.mass;
          const originalModel = sim.world.getNonCarNativeActor(dropBody.actor)
            ?.localModel.value;
          const localPoints = dropBody.hulls.flatMap((hull) =>
            hull.vertices.map((vertex) =>
              vertex.clone().applyQuaternion(dropBody.state.orientation),
            ),
          );
          const localBounds = new B().setFromPoints(localPoints);
          const carPoints = (orientation) =>
            player.hulls.flatMap((hull) =>
              hull.vertices.map((vertex) =>
                vertex.clone().applyQuaternion(orientation),
              ),
            );
          for (const [dx, dz] of [
            [3, 0],
            [-3, 0],
            [0, 3],
            [0, -3],
            [6, 0],
            [-6, 0],
            [0, 6],
            [0, -6],
            [6, 6],
          ]) {
            const center = loadedPlayerPose.position
              .clone()
              .add(new V(dx, 0, dz));
            const observation = {
              center: center.toArray(),
              floor: [],
              approaches: [],
            };
            dropObservations.push(observation);
            const heights = [];
            for (const [x, z] of [
              [0, 0],
              [localBounds.min.x, localBounds.min.z],
              [localBounds.max.x, localBounds.min.z],
              [localBounds.min.x, localBounds.max.z],
              [localBounds.max.x, localBounds.max.z],
            ]) {
              const hit = sim.world.raycast(
                new V(
                  center.x + x,
                  loadedPlayerPose.position.y + 2,
                  center.z + z,
                ),
                new V(0, -1, 0),
                6,
              );
              if (
                !hit ||
                hit.body ||
                hit.normal.y < 0.98 ||
                /^[!#]/.test(hit.surface.material) ||
                !hit.point.toArray().every(Number.isFinite)
              )
                break;
              heights.push(hit.point.y);
              observation.floor.push({
                point: hit.point.toArray(),
                material: hit.surface.material,
              });
            }
            if (
              heights.length !== 5 ||
              Math.max(...heights) - Math.min(...heights) > 0.015
            ) {
              observation.reason =
                "no flat finite original road beneath the entire hull";
              continue;
            }
            const floorY =
              heights.reduce((sum, y) => sum + y, 0) / heights.length;
            const dropPosition = new V(
              center.x,
              floorY - localBounds.min.y + 0.12,
              center.z,
            );
            const dropBounds = localBounds.clone().translate(dropPosition);
            if (
              sim.world
                .querySurfaces(dropBounds.min, dropBounds.max)
                .some(
                  (surface) =>
                    surface.enabled !== false &&
                    dropBounds.intersectsTriangle(surface),
                )
            ) {
              observation.reason =
                "original static geometry obstructs the clear drop bounds";
              continue;
            }
            const settledPosition = new V(
              center.x,
              floorY - localBounds.min.y,
              center.z,
            );
            const settledPoints = localPoints.map((vertex) =>
              vertex.clone().add(settledPosition),
            );
            const settledBounds = new B().setFromPoints(settledPoints);
            let clearApproach = false;
            for (const direction of [
              new V(0, 0, -1),
              new V(1, 0, 0),
              new V(0, 0, 1),
              new V(-1, 0, 0),
            ]) {
              const heading = Math.atan2(-direction.x, -direction.z);
              const orientation = new Q().setFromAxisAngle(
                new V(0, 1, 0),
                heading,
              );
              const front = Math.max(
                ...carPoints(orientation).map((vertex) =>
                  vertex.dot(direction),
                ),
              );
              const back = Math.min(
                ...settledPoints.map((vertex) => vertex.dot(direction)),
              );
              const origin = settledBounds
                .getCenter(new V())
                .addScaledVector(
                  direction,
                  back -
                    settledBounds.getCenter(new V()).dot(direction) -
                    front -
                    0.15,
                );
              const approach = { direction: direction.toArray(), checks: [] };
              observation.approaches.push(approach);
              let valid = true;
              for (const distance of [0, 0.135]) {
                const trial = origin
                  .clone()
                  .addScaledVector(direction, distance);
                const supportHeights = [];
                for (let wheel = 0; wheel < 4; wheel++) {
                  const axle = wheel >> 1;
                  const length =
                    player.motion.suspensionLength[axle] -
                    player.motion.suspensionBase.give[axle];
                  const offset = player.motion.wheelPositions[wheel]
                    .clone()
                    .multiplyScalar(1 / 6.9)
                    .applyQuaternion(orientation)
                    .add(new V(0, -length / 6.9, 0));
                  const hit = sim.world.raycast(
                    new V(
                      trial.x + offset.x,
                      loadedPlayerPose.position.y + 2,
                      trial.z + offset.z,
                    ),
                    new V(0, -1, 0),
                    6,
                  );
                  if (
                    !hit ||
                    hit.body ||
                    hit.normal.y < 0.98 ||
                    /^[!#]/.test(hit.surface.material) ||
                    !hit.point.toArray().every(Number.isFinite)
                  )
                    break;
                  supportHeights.push(hit.point.y - offset.y);
                }
                if (
                  supportHeights.length !== 4 ||
                  Math.max(...supportHeights) - Math.min(...supportHeights) >
                    0.015
                ) {
                  valid = false;
                  break;
                }
                trial.y = supportHeights.reduce((sum, y) => sum + y, 0) / 4;
                sim.rematerializePose(player, trial, orientation, new V());
                const clear = sim.testCarPlacement(player) === -1;
                approach.checks.push({ position: trial.toArray(), clear });
                if (!clear) {
                  valid = false;
                  break;
                }
              }
              if (valid) {
                clearApproach = true;
                break;
              }
            }
            if (!clearApproach) {
              observation.reason =
                "no clear four-wheel grounded approach beside the drop";
              continue;
            }
            dropBody.state.position.copy(dropPosition);
            dropBody.state.velocity.set(0, -0.4, 0);
            dropBody.state.angularVelocity.copy(
              new V(1, 2, 3).normalize().multiplyScalar(0.2),
            );
            dropBody.previousVelocity.copy(dropBody.state.velocity);
            dropBody.state.predictedPosition = undefined;
            dropBody.state.predictedOrientation = undefined;
            sim.syncActor(dropBody);
            sim.invalidateWorldFaceCache(dropBody);
            const preserved = {
              hullIdentity: dropBody.hulls === originalHulls,
              mass: dropBody.properties.mass === originalMass,
              modelIdentity:
                sim.world.getNonCarNativeActor(dropBody.actor)?.localModel
                  .value === originalModel,
            };
            if (!Object.values(preserved).every(Boolean))
              throw new Error(
                "controlled drop changed original physical/resource ownership",
              );
            controlledDrop = {
              fixture:
                "controlled free-body drop on clear original road; explicit initial pose/V/omega, unchanged authored hull/mass/MODEL",
              reason:
                "the authored pump site has a station ledge; isolate quiet/contact/reclaim behavior from original outlet placement",
              selectedBody: dropBody.actor.name,
              floorY,
              clearance: 0.12,
              originalStart: authoredLaunch.find(
                (body) => body.name === dropBody.actor.name,
              ),
              controlledStart: snapshot(dropBody),
              preserved,
              floor: observation.floor,
              clearApproach: observation.approaches.at(-1),
              examinedCenters: dropObservations.length,
            };
            break;
          }
        }
        player.input.throttle = player.input.steer = 0;
        player.input.brake = false;
        sim.rematerializePose(
          player,
          loadedPlayerPose.position,
          loadedPlayerPose.orientation,
          new V(),
        );
        const trace = {
          refs: bodies.map((body) => body.actor),
          reclaims: [],
          firstNulls: [],
          firstNullActors: new Set(),
          forcedRecoveryActors: new Set(),
          wakeSamples: [],
        };
        window.__quietTrace = trace;
        // Reclaim removes the live PHIL quiet provider after the final40ms
        // sleep fold, before requestAnimationFrame can observe that state.
        // Preserve evidence at the actual ownership transition; never assign
        // quiet eligibility or sleep state from a retained/static ACT.
        const applyReclaim = c.simulation.applyNonCarReclaimEffect.bind(
          c.simulation,
        );
        c.simulation.applyNonCarReclaimEffect = (effect) => {
          if (
            trace.refs.includes(effect.owner.actor) &&
            (effect.kind === "set-do-nothing" ||
              effect.kind === "zero-body-omega")
          )
            trace.forcedRecoveryActors.add(effect.owner.actor);
          if (
            effect.kind === "remove-physics" &&
            trace.refs.includes(effect.owner.actor)
          ) {
            const body = effect.owner;
            const header = c.simulation.phil.getHeader(body);
            trace.reclaims.push({
              actor: body.actor,
              gameTimeMs: c.stats.gameTimeMs,
              y: body.state.position.y,
              minimumWorldY: c.simulation.world.minimumWorldY,
              forcedRecovery: trace.forcedRecoveryActors.has(body.actor),
              phil: header && { index: header.index, state: header.state },
              pulled: !!body.actor.userData.noncarPulled,
              driver: body.actor.userData.nativeNoncarDriver ?? null,
              physicalSlot: c.simulation.nonCarSlots.get(body),
              snapshot: snapshot(body),
            });
            trace.forcedRecoveryActors.delete(body.actor);
          }
          return applyReclaim(effect);
        };
        const prepareContacts = c.simulation.preparePedContacts.bind(
          c.simulation,
        );
        c.simulation.preparePedContacts = (rows) => {
          const prepared = prepareContacts(rows);
          const target = trace.wakeTarget;
          if (
            target &&
            prepared.some(
              (row) =>
                (row.a === target && row.b === c.player) ||
                (row.b === target && row.a === c.player),
            )
          ) {
            const state = c.simulation.nativeNonCarQuietState(target);
            trace.wakePrelude = {
              philState: c.simulation.phil.getState(target),
              physicalSlot: c.simulation.nonCarSlots.get(target),
              doNothing: state?.doNothing ?? null,
              wakeTransitions: state?.wakeTransitions ?? null,
            };
          }
          return prepared;
        };
        const step = c.simulation.step.bind(c.simulation);
        c.simulation.step = (...args) => {
          const result = step(...args);
          const target = trace.wakeTarget;
          if (!target) return result;
          const state = c.simulation.nativeNonCarQuietState(target);
          const impulses = c.simulation.lastImpacts.filter(
            (row) =>
              row.solverAccepted &&
              row.sourceType !== 9 &&
              row.normalImpulse > 0 &&
              ((row.a === target && row.b === c.player) ||
                (row.b === target && row.a === c.player)),
          );
          const sample = {
            name: target.actor.name,
            position: target.state.position.toArray(),
            velocity: target.state.velocity.toArray(),
            angularVelocity: target.state.angularVelocity.toArray(),
            doNothing: state?.doNothing ?? null,
            eligibleLeaves: state?.eligibleLeaves ?? null,
            sleepTransitions: state?.sleepTransitions ?? null,
            wakeTransitions: state?.wakeTransitions ?? null,
            immovable: target.properties.immovable,
            collisionFlags: target.collisionFlags,
            motorSleeping: target.motor.sleeping,
            philState: c.simulation.phil.getState(target),
            physicalSlot: c.simulation.nonCarSlots.get(target),
            positiveBodyImpulse: impulses.reduce(
              (sum, row) => sum + row.normalImpulse,
              0,
            ),
            preLambda: trace.wakePrelude ?? null,
            gameTimeMs: c.stats.gameTimeMs,
          };
          trace.wakeSamples.push(sample);
          const hasVelocity = sample.velocity.some(
            (value) => Math.abs(value) > 1e-5,
          );
          const accepted =
            trace.wakeMode === "static-ACT-repull"
              ? sample.philState === 2 &&
                sample.physicalSlot !== null &&
                sample.preLambda?.philState === 2 &&
                sample.preLambda?.doNothing === false &&
                sample.positiveBodyImpulse > 0 &&
                sample.doNothing === false &&
                hasVelocity
              : sample.doNothing === false &&
                sample.wakeTransitions >
                  (trace.wakeInitial?.wakeTransitions ?? 0) &&
                hasVelocity;
          if (accepted && !trace.wakeAccepted) trace.wakeAccepted = sample;
          return result;
        };
        return {
          label,
          supported: !!controlledDrop,
          outletSupported: true,
          reason: controlledDrop
            ? undefined
            : "no clear finite original-road controlled drop with a grounded approach",
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
          bodies: authoredLaunch,
          controlledDrop: controlledDrop ?? {
            reason:
              "no clear finite original-road drop with a grounded car approach",
            observations: dropObservations,
          },
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

    // Let native forces and real contacts settle the labelled controlled drop.
    // The original outlet and untouched authored launch remain recorded above.
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
          if (!body || !state) {
            const trace = window.__quietTrace;
            if (!trace.firstNullActors.has(actor)) {
              trace.firstNullActors.add(actor);
              trace.firstNulls.push({
                name: actor.name,
                gameTimeMs: c.stats.gameTimeMs,
                bodyPresent: !!body,
                y: body?.state.position.y ?? null,
                minimumWorldY: c.simulation.world.minimumWorldY,
                pulled: !!actor.userData.noncarPulled,
                driver: actor.userData.nativeNoncarDriver ?? null,
                philState: body ? c.simulation.phil.getState(body) : null,
              });
            }
            const reclaim = [...trace.reclaims]
              .reverse()
              .find((entry) => entry.actor === actor);
            const saved = reclaim?.snapshot;
            if (
              reclaim?.forcedRecovery ||
              !saved?.quiet?.doNothing ||
              !(saved.quiet.eligibleLeaves > 0) ||
              !(saved.quiet.sleepTransitions > 0)
            )
              return null;
            eligibleNames.add(saved.name);
            return {
              ...saved,
              ...saved.quiet,
              lifecycle: "reclaimed-static-ACT",
            };
          }
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
          return { ...snapshot, lifecycle: "registered-physics" };
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
            firstNulls: window.__quietTrace.firstNulls,
            reclaims: window.__quietTrace.reclaims.map(
              ({ actor, ...entry }) => entry,
            ),
          };
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return {
        kind: "no-native-eligible-sleep-transition",
        eligibleNames: [...eligibleNames],
        sampledFrames: snapshots.length,
        lastSamples: snapshots.slice(-5),
        firstNulls: window.__quietTrace.firstNulls,
        reclaims: window.__quietTrace.reclaims.map(
          ({ actor, ...entry }) => entry,
        ),
      };
    }, 5000);
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
          const saved = [...window.__quietTrace.reclaims]
            .reverse()
            .find((entry) => entry.actor === target.actor)?.snapshot.quiet;
          const initial = {
            position: target.state.position.toArray(),
            velocity: target.state.velocity.toArray(),
            doNothing: quiet?.doNothing ?? saved?.doNothing ?? null,
            eligibleLeaves:
              quiet?.eligibleLeaves ?? saved?.eligibleLeaves ?? null,
            sleepTransitions:
              quiet?.sleepTransitions ?? saved?.sleepTransitions ?? null,
            wakeTransitions:
              quiet?.wakeTransitions ?? saved?.wakeTransitions ?? null,
            philState: c.simulation.phil.getState(target),
            physicalSlot: c.simulation.nonCarSlots.get(target),
            immovable: target.properties.immovable,
            gameTimeMs: c.stats.gameTimeMs,
          };
          const player = c.player;
          const sim = c.simulation;
          const V = player.state.position.constructor;
          const Q = player.state.orientation.constructor;
          const B = player.damage.runtimeParts[0].bounds.constructor;
          const vertices = (
            body,
            orientation = body.state.orientation,
            position = body.state.position,
          ) =>
            body.hulls.flatMap((hull) =>
              hull.vertices.map((vertex) =>
                vertex.clone().applyQuaternion(orientation).add(position),
              ),
            );
          const targetVertices = vertices(target);
          const targetBounds = new B().setFromPoints(targetVertices);
          const center = targetBounds.getCenter(new V());
          const nativeTarget = sim.world.getNonCarNativeActor(target.actor);
          const ownsTarget = (surface) => {
            if (surface?.native?.actor === nativeTarget && nativeTarget)
              return true;
            for (let actor = surface?.actor; actor; actor = actor.parent)
              if (actor === target.actor) return true;
            return false;
          };
          const observations = [];
          let approach;
          // Use the actual car/prop hull extrema, not a prop-specific offset.
          // Both start and near-contact poses must have four finite flat-ground
          // supports and clear original static geometry. No physics steps or
          // target quiet/mask/velocity edits are used to select the approach.
          for (const localDirection of [
            new V(0, 0, -1),
            new V(1, 0, 0),
            new V(0, 0, 1),
            new V(-1, 0, 0),
          ]) {
            const direction = localDirection
              .applyQuaternion(target.state.orientation)
              .setY(0)
              .normalize();
            if (!direction.lengthSq()) continue;
            const heading = Math.atan2(-direction.x, -direction.z);
            const orientation = new Q().setFromAxisAngle(
              new V(0, 1, 0),
              heading,
            );
            const carFront = Math.max(
              ...vertices(player, orientation, new V()).map((vertex) =>
                vertex.dot(direction),
              ),
            );
            const targetBack = Math.min(
              ...targetVertices.map((vertex) => vertex.dot(direction)),
            );
            const position = center
              .clone()
              .addScaledVector(
                direction,
                targetBack - center.dot(direction) - carFront - 0.15,
              );
            const observation = {
              direction: direction.toArray(),
              supports: [],
              placements: [],
            };
            observations.push(observation);
            let valid = true;
            for (const distance of [0, 0.135]) {
              const trial = position
                .clone()
                .addScaledVector(direction, distance);
              const heights = [],
                supports = [];
              for (let wheel = 0; wheel < 4; wheel++) {
                const axle = wheel >> 1;
                const length =
                  player.motion.suspensionLength[axle] -
                  player.motion.suspensionBase.give[axle];
                const offset = player.motion.wheelPositions[wheel]
                  .clone()
                  .multiplyScalar(1 / 6.9)
                  .applyQuaternion(orientation)
                  .add(new V(0, -length / 6.9, 0));
                const origin = new V(
                  trial.x + offset.x,
                  targetBounds.max.y + 1,
                  trial.z + offset.z,
                );
                const hit = sim.world.raycast(origin, new V(0, -1, 0), 3);
                if (
                  !hit ||
                  hit.normal.y < 0.98 ||
                  hit.body ||
                  ownsTarget(hit.surface) ||
                  !hit.point.toArray().every(Number.isFinite)
                )
                  break;
                heights.push(hit.point.y - offset.y);
                supports.push({
                  point: hit.point.toArray(),
                  material: hit.surface.material,
                  normal: hit.normal.toArray(),
                });
              }
              observation.supports.push(supports);
              if (
                heights.length !== 4 ||
                Math.max(...heights) - Math.min(...heights) > 0.015
              ) {
                observation.reason =
                  "four consistent finite ground supports unavailable";
                valid = false;
                break;
              }
              trial.y = heights.reduce((sum, height) => sum + height, 0) / 4;
              const carBounds = new B().setFromPoints(
                vertices(player, orientation, trial),
              );
              if (
                Math.min(carBounds.max.y, targetBounds.max.y) -
                  Math.max(carBounds.min.y, targetBounds.min.y) <
                0.01
              ) {
                observation.reason =
                  "grounded car hull does not overlap prop vertically";
                valid = false;
                break;
              }
              sim.rematerializePose(
                player,
                trial,
                orientation,
                direction.clone().multiplyScalar(2.5),
              );
              const placement = sim.testCarPlacement(player);
              observation.placements.push({
                position: trial.toArray(),
                clear: placement === -1,
              });
              if (placement !== -1) {
                observation.reason =
                  "original static geometry obstructs car approach";
                valid = false;
                break;
              }
              if (distance === 0) position.y = trial.y;
            }
            if (valid) {
              approach = {
                position,
                orientation,
                direction,
                heading,
                speed: 2.5,
                gap: 0.15,
                carFront,
                targetBack,
                supports: observation.supports,
                placements: observation.placements,
              };
              break;
            }
          }
          if (!approach)
            return {
              reached: false,
              reason:
                "no grounded clear approach among four original-hull directions",
              initial,
              approachObservations: observations,
            };
          player.input.throttle = player.input.steer = 0;
          player.input.brake = false;
          sim.rematerializePose(
            player,
            approach.position,
            approach.orientation,
            approach.direction.clone().multiplyScalar(approach.speed),
          );
          sim.invalidateWorldFaceCache(player);
          window.__quietWakeTarget = target.actor;
          const trace = window.__quietTrace;
          trace.wakeTarget = target;
          trace.wakeInitial = initial;
          trace.wakeMode =
            initial.philState === 0
              ? "static-ACT-repull"
              : "registered-quiet-wake";
          return {
            reached: true,
            wakeMode: trace.wakeMode,
            fixture:
              "controlled four-wheel grounded Eagle approach; original hulls and clear static geometry; production collision step",
            approach: {
              position: approach.position.toArray(),
              orientation: approach.orientation.toArray(),
              direction: approach.direction.toArray(),
              speed: approach.speed,
              gap: approach.gap,
              carFront: approach.carFront,
              targetBack: approach.targetBack,
              targetBounds: [
                targetBounds.min.toArray(),
                targetBounds.max.toArray(),
              ],
              supports: approach.supports,
              placements: approach.placements,
              examinedDirections: observations.length,
            },
            initial,
          };
        },
        { name: firstSleeping.name },
      );
      if (spawned.wake.reached) {
        await page.evaluate(() => {
          window.carma.paused = false;
        });
        await page.waitForTimeout(500);
        await page.evaluate(() => {
          window.carma.paused = true;
        });
        spawned.wake.after = await page.evaluate(() => {
          const c = window.carma;
          if (window.__quietTrace.wakeAccepted)
            return window.__quietTrace.wakeAccepted;
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
        spawned.wake.evidence = await page.evaluate(() => ({
          preLambda: window.__quietTrace.wakePrelude ?? null,
          samples: window.__quietTrace.wakeSamples,
        }));
        spawned.wake.contactObserved = Boolean(
          spawned.wake.after &&
            spawned.wake.after.doNothing === false &&
            (spawned.wake.wakeMode === "static-ACT-repull"
              ? spawned.wake.initial.philState === 0 &&
                spawned.wake.initial.physicalSlot === null &&
                spawned.wake.after.philState === 2 &&
                spawned.wake.after.physicalSlot !== null &&
                spawned.wake.after.preLambda?.philState === 2 &&
                spawned.wake.after.preLambda?.doNothing === false &&
                spawned.wake.after.positiveBodyImpulse > 0
              : spawned.wake.after.wakeTransitions >
                (spawned.wake.initial.wakeTransitions ?? 0)) &&
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
