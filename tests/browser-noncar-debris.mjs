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
    "SKIP noncar debris browser QA: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5222;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
const report = {
  build: "production bundle",
  cases: [],
  errors: [],
  failedRequests: [],
  unmet: [],
  uncoveredTargets: [],
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

    const result = await page.evaluate(
      ({ label }) => {
        const c = window.carma;
        const destruction = c.simulation.destruction;
        const allConnotations = (spec) => [
          ...(spec.connotations ? [spec.connotations] : []),
          ...spec.levels.map((level) => level.connotations),
        ];
        const candidates = [];
        const inventory = [];
        const key = (name) =>
          name.replace(/\.(mat|pix|tif|tiff)$/i, "").toLowerCase();
        for (const [specIndex, spec] of destruction.specs.entries()) {
          for (const [connotationIndex, data] of allConnotations(
            spec,
          ).entries()) {
            const noncars = data.shrapnel.filter(
              (item) => item.kind === "noncars",
            );
            if (!noncars.length) continue;
            const retained = destruction.retainActors.filter((actor) =>
              actor.userData.worldSmashSpecIndices?.includes(specIndex),
            );
            inventory.push({
              specIndex,
              connotationIndex,
              trigger: spec.trigger,
              mode: spec.mode,
              retainedActors: retained.length,
              noncars: noncars.map((item) => ({
                amount: item.amount,
                fire: item.fire,
                actorFile: item.actorFile,
                templates: item.nonCars,
                speed: item.speed,
              })),
            });
            for (const actor of retained)
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
        candidates.sort((a, b) => {
          const rank = (item) =>
            (item.spec.trigger.kind === "model" ? 0 : 1) +
            (item.spec.mode === "remove" || item.spec.mode === "replacemodel"
              ? 0
              : 2);
          return rank(a) - rank(b);
        });
        const selected = candidates[0];
        const base = {
          label,
          track: document.querySelector("#track-select").value,
          specCount: destruction.specs.length,
          inventory,
          candidateCount: candidates.length,
        };
        if (!selected)
          return {
            ...base,
            supported: false,
            reason: "no authored noncars outlet",
          };
        const actor = selected.actor;
        const mesh = (() => {
          let found = null;
          actor.traverse((node) => {
            if (!found && node.isMesh && node.visible) found = node;
          });
          return found;
        })();
        if (!mesh)
          return {
            ...base,
            supported: false,
            reason: "selected trigger has no visible mesh",
          };
        const sourceTexture = (
          Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        ).map((material) => material?.map?.name ?? null);
        const beforeBodies = new Set(
          c.simulation.noncars.map((body) => body.actor),
        );
        const beforeSmoke =
          c.smoke?.snapshot().columns.filter((column) => column.active)
            .length ?? 0;
        let connotationCalls = 0;
        let noncarCalls = 0;
        const originalConnotations = destruction.assets.onConnotations;
        destruction.assets.onConnotations = (data, contact, suppressed) => {
          connotationCalls++;
          if (data.shrapnel.some((item) => item.kind === "noncars"))
            noncarCalls++;
          originalConnotations?.(data, contact, suppressed);
        };
        const originalChange = destruction.assets.onChange;
        const changes = [];
        destruction.assets.onChange = (change) => {
          changes.push({ mode: change.mode, actor: change.actor.name });
          originalChange?.(change);
        };
        const sounds = [];
        const originalSound = c.audio.playSound.bind(c.audio);
        c.audio.playSound = (id, ...args) => {
          sounds.push(id);
          return originalSound(id, ...args);
        };
        actor.updateWorldMatrix(true, true);
        const point = actor.getWorldPosition(new mesh.position.constructor());
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
        const contact = {
          actor: selected.spec.trigger.kind === "material" ? mesh : actor,
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
        };
        const impact = destruction.handleContact(contact);
        const spawnedBodies = c.simulation.noncars.filter(
          (body) => !beforeBodies.has(body.actor),
        );
        const bodySnapshot = (body) => {
          const modelMesh = (() => {
            let item = null;
            body.actor.traverse((node) => {
              if (!item && node.isMesh) item = node;
            });
            return item;
          })();
          const material =
            modelMesh &&
            (Array.isArray(modelMesh.material)
              ? modelMesh.material[0]
              : modelMesh.material);
          return {
            name: body.actor.name,
            slot: body.actor.userData.nativeDebrisSlot ?? null,
            pulled: body.actor.userData.noncarPulled ?? false,
            position: body.state.position.toArray(),
            quaternion: body.state.orientation.toArray(),
            velocity: body.state.velocity.toArray(),
            angularVelocity: body.state.angularVelocity.toArray(),
            mass: body.properties.mass,
            freeMass: body.mechanics.freeMass,
            hulls: body.hulls.length,
            hullGeometry: body.hulls.map((hull) => ({
              vertices: hull.vertices.length,
              faces: hull.faces.length,
              edges: hull.edges.length,
            })),
            authoredShapeKinds: body.mechanics.shapes.map(
              (shape) => shape.kind,
            ),
            attached: body.attached,
            sleeping: body.motor.sleeping,
            vertexCount:
              modelMesh?.geometry?.getAttribute("position")?.count ?? 0,
            texture: material?.map?.name ?? null,
            textureSize: material?.map?.image
              ? [material.map.image.width, material.map.image.height]
              : null,
          };
        };
        const smokeAfter =
          c.smoke?.snapshot().columns.filter((column) => column.active)
            .length ?? 0;
        const smokeColumns =
          c.smoke
            ?.snapshot()
            .columns.filter((column) => column.active)
            .map((column) => ({
              time: column.time,
              vertex: column.vertex,
              position: column.position.toArray(),
              flameFrames: column.flames.filter((flame) => flame.visible)
                .length,
            })) ?? [];
        const attributedFireColumns =
          c.smoke?.columns
            .filter(
              (column) =>
                column.active &&
                spawnedBodies.some(
                  (body) => column.source?.actor === body.actor,
                ),
            )
            .map((column) => ({
              mode: column.source.mode,
              colour: column.source.colour,
              vertex: column.source.vertex,
              active: column.active,
              remaining: column.remaining,
              flamesVisible: column.flames.filter(
                (flame) => flame.visible && flame.mesh.visible,
              ).length,
              groupVisible: column.group.visible,
            })) ?? [];
        const outlet = {
          trigger: selected.spec.trigger,
          mode: selected.spec.mode,
          threshold: selected.spec.removalThreshold ?? null,
          connotation: selected.connotationIndex,
          authored: selected.noncars.map((item) => ({
            amount: item.amount,
            chance: item.fire?.chance ?? 0,
            columns: item.fire?.count ?? 0,
            smokiness: item.fire?.smokiness ?? null,
            actorFile: item.actorFile,
            templates: item.nonCars,
            speed: item.speed,
          })),
        };
        window.__debrisTrace = {
          actorRefs: spawnedBodies.map((body) => body.actor),
          outlet,
        };
        return {
          ...base,
          supported: true,
          fixture:
            "controlled WorldDestruction.handleContact; not a driven collision",
          sourceActor: actor.name,
          sourceTexture,
          sourcePoint: point.toArray(),
          outlet,
          impact: {
            changed: impact.changed,
            diagnostics: impact.diagnostics,
            changes: impact.changes.map((change) => ({
              mode: change.mode,
              actor: change.actor.name,
              connotations: Boolean(change.connotations),
            })),
          },
          callbacks: { connotationCalls, noncarCalls, changes, sounds },
          bodiesBefore: beforeBodies.size,
          bodiesCreated: spawnedBodies.length,
          bodies: spawnedBodies.map(bodySnapshot),
          smoke: {
            activeBefore: beforeSmoke,
            activeAfter: smokeAfter,
            columns: smokeColumns,
            attributedFireColumns,
          },
          warnings: c.assets.warnings.filter((warning) =>
            /noncar|debris|smoke sampler/i.test(warning),
          ),
        };
      },
      { label: target.label },
    );
    report.cases.push(result);
    if (!result.supported || !result.bodiesCreated) {
      report.uncoveredTargets.push({
        label: target.label,
        reason:
          result.reason ??
          "production outlet did not create a physical noncar body",
        inventory: result.inventory,
        outlet: result.outlet,
        impact: result.impact,
      });
      continue;
    }

    const initialBodies = result.bodies;
    await page.evaluate(() => {
      window.carma.paused = false;
    });
    const motionStarted = performance.now();
    await page.waitForTimeout(1800);
    const motionElapsedMs = performance.now() - motionStarted;
    await page.evaluate(() => {
      window.carma.paused = true;
    });
    result.afterMotion = await page.evaluate(() => {
      const c = window.carma;
      return (window.__debrisTrace.actorRefs ?? []).map((actor) => {
        const body = c.simulation.noncars.find((item) => item.actor === actor);
        return body
          ? {
              name: actor.name,
              parent: actor.parent?.name ?? null,
              position: body.state.position.toArray(),
              quaternion: body.state.orientation.toArray(),
              velocity: body.state.velocity.toArray(),
              angularVelocity: body.state.angularVelocity.toArray(),
              attached: body.attached,
              sleeping: body.motor.sleeping,
              gameTimeMs: c.stats.gameTimeMs,
              paused: c.paused,
            }
          : null;
      });
    });
    result.motionElapsedMs = motionElapsedMs;
    result.moved = result.afterMotion.map(
      (body, index) =>
        body &&
        body.position.some(
          (value, axis) => value !== initialBodies[index]?.position[axis],
        ),
    );
    const diagnostic = await page.evaluate(() => {
      const c = window.carma;
      const actor = window.__debrisTrace.actorRefs?.[0];
      if (!actor) return null;
      actor.updateWorldMatrix(true, true);
      const point = actor.getWorldPosition(new actor.position.constructor());
      // Diagnostic camera only: render an immediate close view using the production renderer.
      c.camera.position.set(point.x + 3, point.y + 2, point.z + 6);
      c.camera.up.set(0, 1, 0);
      c.camera.lookAt(point);
      c.camera.updateWorldMatrix(true, false);
      c.renderer.render(c.scene, c.camera);
      return c.renderer.domElement.toDataURL("image/png");
    });
    if (diagnostic)
      await writeFile(
        `artifacts/browser-noncar-debris-${target.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
        Buffer.from(diagnostic.split(",")[1], "base64"),
      );
    result.diagnosticCamera =
      "physically repositioned while paused; same production WebGL renderer; not gameplay view";
    result.reloadCleanup = await page.evaluate(
      async ({ path }) => {
        const c = window.carma;
        const actors = [...(window.__debrisTrace.actorRefs ?? [])];
        const oldGroup = actors[0]?.parent;
        await c.loadRace();
        c.paused = true;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        return {
          oldActorsDetached: actors.every((actor) => !actor.parent),
          oldGroupDetached: !oldGroup?.parent,
          newDebrisCount: c.simulation.noncars.filter(
            (body) => body.actor.userData.nativeDebrisSlot,
          ).length,
          path,
        };
      },
      { path: target.path },
    );
    if (
      !result.bodies.every(
        (body) =>
          body.slot &&
          body.hulls > 0 &&
          body.hullGeometry.every(
            (hull) => hull.vertices > 0 && hull.faces > 0,
          ) &&
          body.vertexCount > 0 &&
          body.texture &&
          [body.mass, body.freeMass].every(Number.isFinite) &&
          [...body.position, ...body.velocity, ...body.angularVelocity].every(
            Number.isFinite,
          ),
      )
    )
      report.unmet.push(
        `${target.label}: spawned body missing slot, authored collision hull, mesh/material, or finite physical state`,
      );
    if (!result.moved.some(Boolean))
      report.unmet.push(
        `${target.label}: spawned physical body did not move during simulation frames`,
      );
    if (!result.callbacks.noncarCalls)
      report.unmet.push(
        `${target.label}: noncar connotation callback not observed`,
      );
    if (
      !result.reloadCleanup.oldActorsDetached ||
      !result.reloadCleanup.oldGroupDetached
    )
      report.unmet.push(
        `${target.label}: race reload retained old debris actors/group`,
      );
    const canvasErrors = await page.evaluate(() => {
      const gl = window.carma.renderer.getContext();
      const errors = [];
      for (let index = 0; index < 32; index++) {
        const error = gl.getError();
        if (error === gl.NO_ERROR) break;
        errors.push(error);
      }
      return errors;
    });
    result.webglErrors = canvasErrors;
    if (canvasErrors.length)
      report.unmet.push(
        `${target.label}: WebGL errors ${canvasErrors.join(",")}`,
      );
  }

  report.coverage = {
    coveredTracks: report.cases
      .filter((item) => item.bodiesCreated > 0)
      .map((item) => item.label),
    sourceWarnings: report.cases.flatMap((item) => item.warnings ?? []),
    smokeChanceObserved: report.cases.map((item) => ({
      label: item.label,
      authored: item.outlet?.authored?.map((entry) => ({
        chance: entry.chance,
        columns: entry.columns,
      })),
      activeBefore: item.smoke?.activeBefore,
      activeAfter: item.smoke?.activeAfter,
    })),
  };
  await writeFile(
    "artifacts/browser-noncar-debris.json",
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
    "noncar debris browser checks failed; see artifacts/browser-noncar-debris.json",
  );
  console.log(
    `PASS noncar debris browser QA: ${report.cases.length} original track cases; artifacts/browser-noncar-debris.json`,
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
