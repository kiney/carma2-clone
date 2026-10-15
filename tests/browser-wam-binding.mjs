import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
const assetRoot = process.env.CARMA2_ROOT || "carma2_orig";
try {
  await access(executable);
  await access(assetRoot);
} catch {
  console.log(
    "SKIP WAM binding browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = Number(process.env.WAM_BINDING_PORT || 5219);
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
let browser;
const report = {
  backend: "SwiftShader software WebGL; functional regression only",
  scenes: [],
  errors: [],
  failedRequests: [],
  failedResponses: [],
};

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
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  page.on("pageerror", (error) => report.errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") report.errors.push(message.text());
  });
  page.on("requestfailed", (request) =>
    report.failedRequests.push(
      `${request.url()}: ${request.failure()?.errorText}`,
    ),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      report.failedResponses.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });

  // Use a separate browser and a close fixed camera to make actual vertex damage
  // reviewable. The user's browser/debugging session is never connected here.
  await page.evaluate(() => {
    const c = window.carma;
    const render = c.renderer.render.bind(c.renderer);
    c.renderer.render = (scene, camera) => {
      if (camera === c.camera && c.player) {
        const car = c.player;
        const offset = car.state.position
          .clone()
          .set(0.65, 0.35, -0.85)
          .applyQuaternion(car.state.orientation);
        camera.position.copy(car.state.position).add(offset);
        camera.lookAt(
          car.state.position.clone().add(new offset.constructor(0, 0.08, 0)),
        );
        camera.updateMatrixWorld(true);
      }
      return render(scene, camera);
    };
  });

  for (const [scope, name] of [
    ["data", "eaglegold"],
    ["data", "eaglegreen"],
    ["adv_data", "eaglegreen"],
    ["data", "mustang"],
  ]) {
    const key = `${scope}-${name}`;
    await page.evaluate(
      async ({ scope, name }) => {
        const c = window.carma;
        const car = c.assets.resolve(`${scope}/CARS/${name}/${name}.TXT`);
        const track = c.assets.resolve(`${scope}/RACES/desert2/desert2.txt`);
        if (!car || !track)
          throw new Error(`Missing original scene ${scope}/${name}`);
        document.querySelector("#track-select").value = track;
        document.querySelector("#car-select").value = car;
        await c.loadRace();
        c.paused = true;
        document.querySelector("#panel").hidden = true;
      },
      { scope, name },
    );
    await page.waitForFunction(
      () => window.carma.paused && window.carma.opponentsReady,
      null,
      { timeout: 90000 },
    );
    const before = await page.evaluate(() => {
      const c = window.carma;
      const damage = c.player.damage;
      const principal = damage.runtimeParts.find(
        ({ actor }) => actor.parent === c.player.group,
      );
      const mesh = principal?.actor.children.find((object) => object.isMesh);
      if (!mesh) throw new Error("Principal body mesh is unbound");
      window.__wamBinding = {
        mesh,
        principal,
        pristine: Array.from(mesh.geometry.attributes.position.array),
        originalMeshes: damage.meshes.map(({ mesh, original }) => ({
          mesh,
          original: Array.from(original),
        })),
      };
      const gl = c.renderer.getContext();
      const extension = gl.getExtension("WEBGL_debug_renderer_info");
      return {
        config: document.querySelector("#car-select").value,
        bound: damage.runtimeParts.length,
        authored: damage.wam.parts.length,
        wamVersion: damage.wam.version,
        principal: principal.actor.name,
        principalVertices: mesh.geometry.attributes.position.count,
        warnings: c.assets.warnings.filter((warning) =>
          /Damage (binding|data)/i.test(warning),
        ),
        gpu: extension
          ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER),
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        webglError: gl.getError(),
      };
    });
    assert.equal(
      before.bound,
      before.authored,
      `${key}: all authored parts bind`,
    );
    assert.ok(before.bound > 4, `${key}: body and detachable actors bind`);
    assert.equal(before.webglError, 0);
    const sceneReport = { key, before };
    report.scenes.push(sceneReport);
    if (name !== "mustang")
      await page.screenshot({
        path: `artifacts/browser-wam-binding-${key}-before.png`,
      });
    const crushed = await page.evaluate(() => {
      const c = window.carma;
      const car = c.player;
      const damage = car.damage;
      const f = window.__wamBinding;
      damage.damageContext.random = () => 0.5;
      const impactEnd = (front) => {
        car.group.updateWorldMatrix(true, true);
        const positions = f.mesh.geometry.attributes.position;
        let index = 0;
        for (let i = 1; i < positions.count; i++) {
          if (
            front
              ? positions.getZ(i) < positions.getZ(index)
              : positions.getZ(i) > positions.getZ(index)
          )
            index = i;
        }
        const contact =
          new car.state.position.constructor().fromBufferAttribute(
            positions,
            index,
          );
        f.mesh.localToWorld(contact);
        car.group.worldToLocal(contact);
        const force = new contact.constructor(0, 0, front ? 0.2 : -0.2);
        const result = damage.applyImpact(
          [contact],
          force,
          false,
          true,
          c.simulation.elapsed * 1000,
          force,
        );
        c.simulation.update(0);
        return result.maxInfluence;
      };
      const firstInfluence = impactEnd(true);
      const first = Array.from(f.mesh.geometry.attributes.position.array);
      const firstIndices = first.flatMap((value, i) =>
        Math.abs(value - f.pristine[i]) > 1e-5 ? [i] : [],
      );
      const secondInfluence = impactEnd(false);
      const second = Array.from(f.mesh.geometry.attributes.position.array);
      const displacement = second.map((value, i) =>
        Math.abs(value - f.pristine[i]),
      );
      return {
        firstInfluence,
        secondInfluence,
        firstChanged: firstIndices.length,
        secondChanges: second.filter(
          (value, i) => Math.abs(value - first[i]) > 1e-5,
        ).length,
        retainedFirst: firstIndices.filter(
          (i) => Math.abs(second[i] - f.pristine[i]) > 1e-5,
        ).length,
        maxDisplacement: Math.max(...displacement),
        actualChanged: displacement.filter((value) => value > 1e-5).length,
        revision: damage.deformationRevision,
        publishedHullRevision: car.revision,
        finiteHull: car.hulls.every((hull) =>
          hull.vertices.every((point) =>
            point.toArray().every(Number.isFinite),
          ),
        ),
      };
    });
    sceneReport.crushed = crushed;
    assert.ok(
      crushed.firstInfluence > 0 && crushed.secondInfluence > 0,
      `${key}: normal impact reaches original body`,
    );
    assert.ok(
      crushed.firstChanged > 0 &&
        crushed.secondChanges > 0 &&
        crushed.retainedFirst > 0,
      `${key}: localized dents accumulate`,
    );
    assert.ok(crushed.finiteHull);
    if (name !== "mustang")
      await page.screenshot({
        path: `artifacts/browser-wam-binding-${key}-after.png`,
      });
    const lifecycle = await page.evaluate(() => {
      const c = window.carma;
      const car = c.player;
      const damage = car.damage;
      const candidate = damage.runtimeParts.find(
        ({ part }) => part.type !== "boring",
      );
      const index = damage.wam.parts.indexOf(candidate.part);
      damage.damageContext.random = () =>
        (index + 0.5) / damage.wam.parts.length;
      const spam = c.simulation.spamCar(car, 1);
      const detached = c.simulation.debris.find(
        (body) => body.owner === car && body.actor === candidate.actor,
      );
      const result = {
        candidate: candidate.actor.name,
        requested: spam.detachedParts.includes(candidate),
        physicalBody: !!detached,
        phase: candidate.state.phase,
        reparented: candidate.actor.parent === c.scene,
        finiteDetachedState:
          !!detached &&
          [
            detached.state.position,
            detached.state.velocity,
            detached.state.angularVelocity,
          ].every((vector) => vector.toArray().every(Number.isFinite)),
      };
      c.simulation.repair(car);
      // Reattached actors leave the physical debris registry on the next tick.
      c.simulation.step();
      // Full repair439460 quantizes body vertices to the original U16 targets.
      const compressed = (value) => {
        const packed = Math.trunc(
          ((Math.max(-10, Math.min(10, value)) + 10) * 65535) / 20 + 0.5,
        );
        return Math.fround(packed * 20 * Math.fround(1 / 65535) - 10);
      };
      result.maxRepairError = 0;
      for (const { mesh, original } of window.__wamBinding.originalMeshes) {
        const bound = damage.runtimeParts.some(
          ({ actor }) => actor === mesh || actor === mesh.parent,
        );
        const positions = mesh.geometry.attributes.position.array;
        for (let i = 0; i < positions.length; i++) {
          const expected = bound ? compressed(original[i]) : original[i];
          result.maxRepairError = Math.max(
            result.maxRepairError,
            Math.abs(positions[i] - expected),
          );
        }
      }
      result.reattached = candidate.actor.parent === candidate.originalParent;
      result.phaseAfterRepair = candidate.state.phase;
      result.debrisAfterRepair = c.simulation.debris.filter(
        (body) => body.owner === car,
      ).length;
      const gl = c.renderer.getContext();
      result.webglError = gl.getError();
      return result;
    });
    sceneReport.lifecycle = lifecycle;
    assert.ok(
      lifecycle.requested &&
        lifecycle.physicalBody &&
        lifecycle.reparented &&
        lifecycle.finiteDetachedState,
      `${key}: authored detachable becomes a physical body`,
    );
    assert.equal(lifecycle.phase, 2);
    assert.ok(lifecycle.reattached);
    assert.equal(lifecycle.phaseAfterRepair, 0);
    assert.equal(lifecycle.debrisAfterRepair, 0);
    assert.ok(
      lifecycle.maxRepairError < 1e-6,
      `${key}: compressed repair coordinates differ by ${lifecycle.maxRepairError}`,
    );
    assert.equal(lifecycle.webglError, 0);
    console.log(
      `PASS ${key}: ${before.bound} actors, ${crushed.actualChanged} changed body coordinates, physical detachment and repair`,
    );
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  assert.deepEqual(report.failedResponses, []);
} finally {
  await writeFile(
    "artifacts/browser-wam-binding.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await browser?.close();
  server.kill("SIGTERM");
}
