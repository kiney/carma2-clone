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
  console.log("SKIP ghost browser QA: Chromium or local C2 assets absent.");
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5221;
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
      { label: "stock Newcity", path: choose("data/", "newcity1") },
      { label: "stock Airport", path: choose("data/", "airport1") },
      { label: "Advanced Newcity", path: choose("adv_data/", "newcity1") },
      { label: "Advanced Airport", path: choose("adv_data/", "airport1") },
    ];
  });
  const carPath = await page.evaluate(() =>
    window.carma.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT"),
  );
  assert.ok(carPath, "stock Eagle car configuration unavailable");

  for (const target of targets) {
    if (!target.path) {
      report.unmet.push(`${target.label}: no matching race catalog entry`);
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
      async ({ label }) => {
        const c = window.carma;
        const destruction = c.simulation.destruction;
        if (!destruction)
          throw new Error("No world destruction runtime loaded");
        const allConnotations = (spec) => [
          ...(spec.connotations ? [spec.connotations] : []),
          ...spec.levels.map((level) => level.connotations),
        ];
        const candidates = [];
        const ghostInventory = [];
        const key = (name) =>
          name.replace(/\.(mat|pix|tif|tiff)$/i, "").toLowerCase();
        for (const [specIndex, spec] of destruction.specs.entries()) {
          for (const [connotationIndex, data] of allConnotations(
            spec,
          ).entries()) {
            const ghostSpecs = data.shrapnel.filter(
              (item) => item.kind === "ghostparts",
            );
            if (!ghostSpecs.length) continue;
            const retained = destruction.retainActors.filter((item) =>
              item.userData.worldSmashSpecIndices?.includes(specIndex),
            );
            ghostInventory.push({
              specIndex,
              connotationIndex,
              trigger: spec.trigger,
              mode: spec.mode,
              retained: retained.length,
              visible: retained.filter((item) => item.visible).length,
              actorNames: retained.slice(0, 5).map((item) => item.name),
            });
            const actors = [];
            if (spec.trigger.kind === "material") {
              c.scene.traverse((item) => {
                if (!item.isMesh || !item.visible) return;
                const materials = Array.isArray(item.material)
                  ? item.material
                  : [item.material];
                if (
                  materials.some(
                    (material) => key(material.name) === key(spec.trigger.name),
                  )
                )
                  actors.push(item);
              });
            } else {
              const actor = destruction.retainActors.find(
                (item) =>
                  item.visible &&
                  item.userData.worldSmashSpecIndices?.includes(specIndex),
              );
              if (actor) actors.push(actor);
            }
            for (const actor of actors)
              candidates.push({
                specIndex,
                connotationIndex,
                spec,
                data,
                actor,
                ghostSpecs,
              });
          }
        }
        candidates.sort(
          (a, b) =>
            Number(a.spec.trigger.kind === "material") -
            Number(b.spec.trigger.kind === "material"),
        );
        const selected = candidates[0];
        const base = {
          label,
          track: document.querySelector("#track-select").value,
          destructionSpecs: destruction.specs.length,
          ghostCandidateCount: candidates.length,
          ghostInventory,
          candidates: candidates.map((entry) => ({
            specIndex: entry.specIndex,
            connotationIndex: entry.connotationIndex,
            trigger: entry.spec.trigger,
            mode: entry.spec.mode,
            actor: entry.actor.name,
            authoredSounds: entry.data.sounds,
            ghostSpecs: entry.ghostSpecs.map((spec) => ({
              actors: spec.actors,
              amount: spec.amount,
              position: spec.position,
              lifetime: spec.lifetimeSeconds,
            })),
          })),
        };
        if (!selected) return { ...base, supported: false };

        const before = c.shards.snapshot();
        const sourceMaterial = selected.spec.trigger.name;
        const sourceMeshes = [];
        selected.actor.traverse((node) => {
          if (node.isMesh) sourceMeshes.push(node);
        });
        const mesh =
          sourceMeshes.find((node) => {
            const materials = Array.isArray(node.material)
              ? node.material
              : [node.material];
            return materials.some(
              (material) =>
                material.name.toLowerCase().replace(/\.(mat|pix)$/i, "") ===
                sourceMaterial.toLowerCase().replace(/\.(mat|pix)$/i, ""),
            );
          }) ?? sourceMeshes[0];
        if (!mesh)
          return { ...base, supported: false, reason: "candidate has no mesh" };
        const materialIndex = (
          Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        ).findIndex(
          (material) =>
            material.name.toLowerCase().replace(/\.(mat|pix)$/i, "") ===
            sourceMaterial.toLowerCase().replace(/\.(mat|pix)$/i, ""),
        );
        const faceIndices = [];
        if (selected.spec.trigger.kind === "material") {
          const geometry = mesh.geometry;
          const position = geometry.getAttribute("position");
          const uv = geometry.getAttribute("uv");
          const index = geometry.index;
          const groups = geometry.groups?.length
            ? geometry.groups
            : [
                {
                  start: 0,
                  count: index?.count ?? position.count,
                  materialIndex: 0,
                },
              ];
          for (const group of groups) {
            if (group.materialIndex !== materialIndex) continue;
            for (
              let offset = group.start;
              offset + 2 < group.start + group.count;
              offset += 3
            ) {
              const ids = [0, 1, 2].map((corner) =>
                index ? index.getX(offset + corner) : offset + corner,
              );
              if (uv) {
                const u = ids.map((id) => uv.getX(id));
                const v = ids.map((id) => uv.getY(id));
                if (
                  Math.max(...u) - Math.min(...u) <= 1e-6 ||
                  Math.max(...v) - Math.min(...v) <= 1e-6
                )
                  continue;
              }
              faceIndices.push(Math.floor(offset / 3));
              if (faceIndices.length >= 512) break;
            }
            if (faceIndices.length >= 512) break;
          }
        } else faceIndices.push(0);
        let connotationCalls = 0;
        let ghostCallbacks = 0;
        const changes = [];
        const cameraObservations = [];
        const destructionAssets = destruction.assets;
        const originalCallback = destructionAssets.onConnotations;
        destructionAssets.onConnotations = (data, contact, suppressed) => {
          connotationCalls++;
          if (data.shrapnel.some((item) => item.kind === "ghostparts"))
            ghostCallbacks++;
          if (contact.point) {
            c.camera.position
              .copy(contact.point)
              .add(new mesh.position.constructor(0, 4, 12));
            c.camera.up.set(0, 1, 0);
            c.camera.lookAt(contact.point);
            c.camera.updateWorldMatrix(true, false);
            const elements = c.camera.matrixWorld.elements;
            const delta = contact.point
              .clone()
              .sub(
                new mesh.position.constructor(
                  elements[12],
                  elements[13],
                  elements[14],
                ),
              );
            cameraObservations.push({
              point: contact.point.toArray(),
              position: [elements[12], elements[13], elements[14]],
              backwards: [elements[8], elements[9], elements[10]],
              distanceSquared: delta.lengthSq(),
              facingDot: delta.dot(
                new mesh.position.constructor(
                  elements[8],
                  elements[9],
                  elements[10],
                ),
              ),
            });
          }
          originalCallback?.(data, contact, suppressed);
        };
        const originalChange = destructionAssets.onChange;
        destructionAssets.onChange = (change) => {
          changes.push({ mode: change.mode, actor: change.actor.name });
          originalChange?.(change);
        };
        const sounds = [];
        const originalPlaySound = c.audio.playSound.bind(c.audio);
        c.audio.playSound = (id, ...args) => {
          sounds.push(id);
          return originalPlaySound(id, ...args);
        };
        const impulse = Math.max(
          1000,
          (selected.spec.removalThreshold ?? 0) + 1,
        );
        const attempts = [];
        let contact;
        let impact;
        const fixturePoint = selected.actor.getWorldPosition(
          new mesh.position.constructor(),
        );
        c.player.state.position
          .copy(fixturePoint)
          .add(new mesh.position.constructor(0, 0, 12));
        c.player.state.heading = 0;
        c.player.state.orientation.identity();
        c.simulation.sync(c.player);
        let chaseVisibility = null;
        for (let frame = 0; frame < 45; frame++) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          c.camera.updateWorldMatrix(true, false);
          const elements = c.camera.matrixWorld.elements;
          const delta = fixturePoint
            .clone()
            .sub(
              new mesh.position.constructor(
                elements[12],
                elements[13],
                elements[14],
              ),
            );
          const facingDot = delta.dot(
            new mesh.position.constructor(
              elements[8],
              elements[9],
              elements[10],
            ),
          );
          chaseVisibility = {
            position: [elements[12], elements[13], elements[14]],
            backwards: [elements[8], elements[9], elements[10]],
            distanceSquared: delta.lengthSq(),
            facingDot,
            visible:
              delta.lengthSq() < c.camera.far * c.camera.far && facingDot < 0,
          };
          if (chaseVisibility.visible) break;
        }
        mesh.updateWorldMatrix(true, false);
        for (const faceIndex of faceIndices) {
          const point = new mesh.position.constructor();
          if (selected.spec.trigger.kind === "material") {
            const position = mesh.geometry.getAttribute("position");
            const index = mesh.geometry.index;
            const offset = faceIndex * 3;
            const points = [0, 1, 2].map((corner) => {
              const vertex = index
                ? index.getX(offset + corner)
                : offset + corner;
              return new mesh.position.constructor().fromBufferAttribute(
                position,
                vertex,
              );
            });
            point
              .copy(points[0])
              .add(points[1])
              .add(points[2])
              .multiplyScalar(1 / 3)
              .applyMatrix4(mesh.matrixWorld);
          } else selected.actor.getWorldPosition(point);
          contact = {
            actor:
              selected.spec.trigger.kind === "material" ? mesh : selected.actor,
            material: sourceMaterial,
            faceIndex,
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
          try {
            impact = destruction.handleContact(contact);
            attempts.push({ faceIndex, diagnostics: impact.diagnostics });
            if (impact.changed || !impact.diagnostics.length) break;
          } catch (error) {
            const message = String(error);
            attempts.push({ faceIndex, error: message });
            if (!/Degenerate native ghost-frame UV mapping/i.test(message))
              throw error;
          }
        }
        if (
          !contact ||
          !impact ||
          (selected.spec.trigger.kind === "material" &&
            !impact.changed &&
            impact.diagnostics.length)
        )
          return {
            ...base,
            supported: false,
            reason: "no nondegenerate authored UV tile was accepted",
            uvAttempts: attempts,
          };
        // This controlled source contact exercises the production world callback.
        // It is deliberately reported separately from keyboard-driven collisions.
        window.__ghostTrace = {
          get calls() {
            return connotationCalls;
          },
          get ghostCallbacks() {
            return ghostCallbacks;
          },
          get sounds() {
            return [...sounds];
          },
          get changes() {
            return [...changes];
          },
          get cameraObservations() {
            return [...cameraObservations];
          },
        };
        return {
          ...base,
          supported: true,
          fixture:
            "controlled WorldDestruction.handleContact; actual camera physically moved behind and above target for visibility; not a driven collision",
          chaseVisibility,
          specIndex: selected.specIndex,
          trigger: selected.spec.trigger,
          mode: selected.spec.mode,
          authoredSounds: selected.data.sounds,
          sourceActor: selected.actor.name,
          sourceMesh: mesh.name,
          sourceMaterial: selected.spec.trigger.name,
          uvAttempts: attempts,
          sourceTextureBefore: (Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]
          ).map((material) => material?.map?.name ?? null),
          impact: {
            changed: impact.changed,
            diagnostics: impact.diagnostics,
            changes: impact.changes.map((change) => ({
              mode: change.mode,
              actor: change.actor.name,
              connotations: Boolean(change.connotations),
            })),
          },
          hooks: { connotationCalls, ghostCallbacks },
          sounds,
          before,
          sourceWarnings: c.assets.warnings.filter((warning) =>
            /ghost|shrapnel|source uv/i.test(warning),
          ),
        };
      },
      { label: target.label },
    );
    report.cases.push(result);
    if (!result.supported) {
      report.uncoveredTargets.push({
        label: target.label,
        reason: result.reason ?? "no loaded authored source target",
        inventory: result.ghostInventory,
        uvAttempts: result.uvAttempts ?? [],
        sourceWarnings: result.sourceWarnings ?? [],
      });
      continue;
    }
    const priorTotal = result.before.totalCreated;
    await page.evaluate(() => {
      window.carma.paused = false;
    });
    let created = false;
    try {
      await page.waitForFunction(
        (prior) => window.carma.shards.snapshot().totalCreated > prior,
        priorTotal,
        { timeout: 5000 },
      );
      created = true;
    } catch {}
    await page.evaluate(() => {
      window.carma.paused = true;
    });
    const visual = await page.evaluate(() => {
      const c = window.carma;
      const snapshot = c.shards.snapshot();
      const ghosts = [];
      c.scene.traverse((node) => {
        if (!node.name.startsWith("C2 ghost: ")) return;
        const materials = Array.isArray(node.material)
          ? node.material
          : [node.material];
        const textures = materials
          .map((material) => material?.map)
          .filter(Boolean);
        ghosts.push({
          name: node.name,
          visible: node.visible,
          matrixAutoUpdate: node.matrixAutoUpdate,
          matrix: node.matrix.elements.slice(),
          geometryVertices: node.geometry?.attributes?.position?.count ?? 0,
          materialNames: materials.map((material) => material?.name ?? null),
          textures: textures.map((texture) => ({
            name: texture.name,
            width: texture.image?.width ?? texture.source?.data?.width ?? null,
            height:
              texture.image?.height ?? texture.source?.data?.height ?? null,
          })),
          position: node.position.toArray(),
        });
      });
      const gl = document.querySelector("#view").getContext("webgl2");
      const glErrors = [];
      for (let i = 0; i < 32; i++) {
        const error = gl.getError();
        if (error === gl.NO_ERROR) break;
        glErrors.push(error);
      }
      return { snapshot, ghosts, glErrors, gameTimeMs: c.stats.gameTimeMs };
    });
    result.visual = visual;
    if (
      !visual.ghosts.length ||
      !visual.snapshot.fragments.some((fragment) => fragment.priority === 4)
    ) {
      result.created = created;
      result.hooksAfterTick = await page.evaluate(() => ({
        connotationCalls: window.__ghostTrace?.calls ?? 0,
        ghostCallbacks: window.__ghostTrace?.ghostCallbacks ?? 0,
        sounds: window.__ghostTrace?.sounds ?? [],
        changes: window.__ghostTrace?.changes ?? [],
      }));
      report.uncoveredTargets.push({
        label: target.label,
        reason:
          result.impact.diagnostics.join("; ") ||
          "controlled contact did not emit an original ghost mesh",
        trigger: result.trigger,
        mode: result.mode,
        hooks: result.hooksAfterTick,
        sourceWarnings: result.sourceWarnings,
      });
      continue;
    }
    result.created = created;
    result.hooksAfterTick = await page.evaluate(() => ({
      connotationCalls: window.__ghostTrace?.calls ?? 0,
      ghostCallbacks: window.__ghostTrace?.ghostCallbacks ?? 0,
      sounds: window.__ghostTrace?.sounds ?? [],
      changes: window.__ghostTrace?.changes ?? [],
      cameraObservations: window.__ghostTrace?.cameraObservations ?? [],
    }));
    result.sourceWarnings = await page.evaluate(() =>
      window.carma.assets.warnings.filter((warning) =>
        /ghost|shrapnel|source uv/i.test(warning),
      ),
    );
    const initialPosition = visual.ghosts[0]?.position;
    await page.evaluate(() => {
      const c = window.carma;
      document.querySelector("#panel").hidden = true;
      document.querySelector("#feedback").style.display = "none";
      document.querySelector("#message").style.visibility = "hidden";
    });
    const diagnosticFrame = await page.evaluate(() => {
      const c = window.carma;
      let target = null;
      c.scene.traverse((node) => {
        if (!target && node.name.startsWith("C2 ghost: ") && node.visible) {
          node.updateWorldMatrix(true, false);
          target = node.getWorldPosition(new node.position.constructor());
        }
      });
      if (!target) throw new Error("No visible ghost mesh for diagnostic view");
      // Diagnostic camera only: hold the simulation paused, physically position
      // the actual camera, then render through the production WebGL renderer.
      c.camera.position.set(target.x + 0.5, target.y + 2.5, target.z + 7);
      c.camera.up.set(0, 1, 0);
      c.camera.lookAt(target);
      c.camera.updateWorldMatrix(true, false);
      c.renderer.render(c.scene, c.camera);
      return c.renderer.domElement.toDataURL("image/png");
    });
    await writeFile(
      `artifacts/browser-ghosts-${target.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`,
      Buffer.from(diagnosticFrame.split(",")[1], "base64"),
    );
    const initialCoordinates = result.visual.ghosts.map(
      (ghost) => ghost.position,
    );
    await page.evaluate(() => {
      window.carma.paused = false;
    });
    try {
      await page.waitForFunction(
        (positions) => {
          const current = [];
          window.carma.scene.traverse((node) => {
            if (node.name.startsWith("C2 ghost: "))
              current.push(node.position.toArray());
          });
          return current.some((position, i) =>
            position.some((value, axis) => value !== positions[i]?.[axis]),
          );
        },
        initialCoordinates,
        { timeout: 3000 },
      );
    } catch {}
    await page.evaluate(() => {
      window.carma.paused = true;
    });
    result.afterMovement = await page.evaluate(() => {
      const c = window.carma;
      const snapshot = c.shards.snapshot();
      const ghosts = [];
      c.scene.traverse((node) => {
        if (node.name.startsWith("C2 ghost: "))
          ghosts.push({
            name: node.name,
            position: node.position.toArray(),
            visible: node.visible,
          });
      });
      return { snapshot, ghosts, gameTimeMs: c.stats.gameTimeMs };
    });
    result.positionChanged = Boolean(
      initialPosition &&
        result.afterMovement.ghosts.some((ghost) =>
          ghost.position.some(
            (value, index) => value !== initialPosition[index],
          ),
        ),
    );
    result.textureReplacementControl = result.hooksAfterTick.changes.some(
      (change) => change.mode === "texturechange",
    );
    const hasGhosts =
      result.visual.snapshot.fragments.some(
        (fragment) => fragment.priority === 4,
      ) && result.visual.ghosts.length > 0;
    if (!hasGhosts) {
      report.uncoveredTargets.push({
        label: target.label,
        reason:
          result.impact.diagnostics.join("; ") ||
          "source connotation did not create a visible ghost in this controlled contact",
        trigger: result.trigger,
        mode: result.mode,
        hooks: result.hooksAfterTick,
        sourceWarnings: result.sourceWarnings,
      });
      continue;
    }
    if (!result.hooksAfterTick.ghostCallbacks)
      report.unmet.push(`${target.label}: ghostparts callback not observed`);
    if (result.mode === "texturechange" && !result.textureReplacementControl)
      report.unmet.push(
        `${target.label}: texturechange control did not commit`,
      );
    if (result.authoredSounds?.length && !result.hooksAfterTick.sounds.length)
      report.unmet.push(
        `${target.label}: authored sound did not reach dispatch`,
      );
    if (
      !result.visual.ghosts.every(
        (ghost) =>
          ghost.matrix.length === 16 &&
          ghost.matrix.every(Number.isFinite) &&
          ghost.geometryVertices > 0 &&
          ghost.textures.length > 0,
      )
    )
      report.unmet.push(
        `${target.label}: ghost matrix, geometry, or borrowed texture invalid`,
      );
    if (!result.positionChanged)
      report.unmet.push(
        `${target.label}: ghost did not move during the checked lifetime`,
      );
    if (result.visual.glErrors.length)
      report.unmet.push(
        `${target.label}: WebGL errors ${result.visual.glErrors.join(",")}`,
      );
    const expiryUntil =
      Math.max(
        ...result.visual.snapshot.fragments
          .filter((fragment) => fragment.priority === 4)
          .map((fragment) => fragment.endMs),
      ) + 100;
    const expiryStartedAt = performance.now();
    const expiryStart = await page.evaluate(() => ({
      gameTimeMs: window.carma.stats.gameTimeMs,
      paused: window.carma.paused,
      raceStatus: window.carma.stats.race?.status ?? null,
      frameCount: window.carma.stats.frameCount ?? null,
      framesRendered: window.carma.stats.framesRendered ?? null,
    }));
    const expiryWaitMs = Math.min(
      30000,
      Math.max(8000, expiryUntil - expiryStart.gameTimeMs + 8000),
    );
    let expiryDeadlineReached = false;
    let expiryObservedGameTimeMs = null;
    await page.evaluate(() => {
      window.carma.paused = false;
    });
    try {
      const expiryObservation = await page.waitForFunction(
        (until) => {
          const gameTimeMs = window.carma.stats.gameTimeMs;
          return gameTimeMs >= until ? gameTimeMs : false;
        },
        expiryUntil,
        { timeout: expiryWaitMs },
      );
      expiryDeadlineReached = true;
      expiryObservedGameTimeMs = await expiryObservation.jsonValue();
      await expiryObservation.dispose();
    } catch {}
    const expiryElapsedMs = performance.now() - expiryStartedAt;
    await page.evaluate(() => {
      window.carma.paused = true;
    });
    result.afterExpiry = await page.evaluate(() => {
      const c = window.carma;
      let ghosts = 0;
      c.scene.traverse((node) => {
        if (node.name.startsWith("C2 ghost: ")) ghosts++;
      });
      return {
        ...c.shards.snapshot(),
        ghosts,
        gameTimeMs: c.stats.gameTimeMs,
        paused: c.paused,
        raceStatus: c.stats.race?.status ?? null,
        frameCount: c.stats.frameCount ?? null,
        framesRendered: c.stats.framesRendered ?? null,
      };
    });
    result.expiryCheck = {
      expiryUntil,
      start: expiryStart,
      end: {
        gameTimeMs: result.afterExpiry.gameTimeMs,
        paused: result.afterExpiry.paused,
        raceStatus: result.afterExpiry.raceStatus,
        frameCount: result.afterExpiry.frameCount,
        framesRendered: result.afterExpiry.framesRendered,
      },
      waitBoundMs: expiryWaitMs,
      elapsedPerformanceMs: expiryElapsedMs,
      deadlineReached: expiryDeadlineReached,
      observedGameTimeMs: expiryObservedGameTimeMs,
      timeoutKind: expiryDeadlineReached
        ? null
        : result.afterExpiry.gameTimeMs < expiryUntil
          ? "clock-not-reached"
          : "deadline-observer-timeout",
    };
    // BrowserGameClock's predicted endMs may regress after a scheduling stall.
    // Keep the observed crossing as evidence; the final snapshot still checks
    // that the fragment was actually retired after that native time boundary.
    const expiryClockReached =
      (expiryObservedGameTimeMs ?? 0) >= expiryUntil ||
      result.afterExpiry.gameTimeMs >= expiryUntil;
    if (!expiryClockReached)
      report.unmet.push(
        `${target.label}: expiry clock not reached (game time ${result.afterExpiry.gameTimeMs} < ${expiryUntil}; ${result.expiryCheck.timeoutKind})`,
      );
    else if (
      result.afterExpiry.ghosts ||
      result.afterExpiry.fragments.some((fragment) => fragment.priority === 4)
    )
      report.unmet.push(
        `${target.label}: ghost remained beyond authored maximum lifetime`,
      );
  }

  const covered = report.cases.filter((item) =>
    item.visual?.snapshot.fragments.some((fragment) => fragment.priority === 4),
  );
  report.coverage = {
    coveredTracks: covered.map((item) => item.label),
    coverageComplete: report.uncoveredTargets.length === 0,
    texturechangeCovered: report.cases.some(
      (item) => item.mode === "texturechange" && item.textureReplacementControl,
    ),
    sourceWarnings: report.cases.flatMap((item) => item.sourceWarnings ?? []),
  };
  for (const expected of ["stock Airport", "Advanced Airport"])
    if (!covered.some((item) => item.label === expected))
      report.unmet.push(`${expected}: original ghost outlet was not verified`);

  await writeFile(
    "artifacts/browser-ghosts.json",
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
    "ghost browser checks failed; see artifacts/browser-ghosts.json",
  );
  console.log(
    `PASS ghost browser QA: ${report.cases.length} original track cases; artifacts/browser-ghosts.json`,
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
