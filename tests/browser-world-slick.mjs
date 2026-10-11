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
    "SKIP world slick browser regression: Chromium or C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5220;
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
  const badResponses = [];
  page.on("pageerror", (error) =>
    errors.push(`pageerror: ${error.stack ?? error}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) =>
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      badResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  const loadRace = async (dataRoot) => {
    const selected = await page.evaluate(async (root) => {
      const c = window.carma;
      const track = c.assets.resolve(`${root}/RACES/newcity1/newcity1.txt`);
      const car = c.assets.resolve(`${root}/CARS/EAGLE3/EAGLE3.TXT`);
      if (!track || !car)
        throw new Error(`Missing ${root} Newcity1/Eagle assets`);
      document.querySelector("#track-select").value = track;
      document.querySelector("#car-select").value = car;
      await c.loadRace();
      c.paused = true;
      return { track, car };
    }, `${dataRoot}`);
    await page.waitForFunction(
      () => window.carma.stats.ready && window.carma.paused,
      null,
      { timeout: 90000 },
    );
    return selected;
  };
  const finite = (values) => values.every(Number.isFinite);
  const rendererError = async () =>
    page.evaluate(() => {
      const gl = window.carma.renderer.getContext();
      const errors = [];
      for (let i = 0; i < 16; i++) {
        const code = gl.getError();
        if (code === gl.NO_ERROR) break;
        errors.push(code);
      }
      return { isWebGL2: gl instanceof WebGL2RenderingContext, errors };
    });

  const chargedRuns = [];
  for (const dataRoot of ["data", "adv_data"]) {
    const selected = await loadRace(dataRoot);
    const action = await page.evaluate(() => {
      const definition = window.carma.powerups.definitions.find(
        (item) => item.action === 35,
      );
      if (!definition)
        throw new Error("Original action35 oil powerup is missing");
      return {
        index: definition.index,
        action: definition.action,
        duration: definition.duration,
        parameters: [...definition.floatParams],
        initialValue: definition.initialValue,
      };
    });
    assert.equal(action.action, 35);
    const panelVisible = await page
      .locator("#debug-panel")
      .evaluate((node) => !node.hidden);
    if (!panelVisible) await page.click("#debug-button");
    await page.waitForFunction(
      () => !document.querySelector("#debug-panel").hidden,
    );
    await page.waitForFunction(
      () => !document.querySelector("#debug-controls").disabled,
    );
    await page.selectOption("#debug-powerup", String(action.index));
    await page.click("#debug-grant");
    const inventory = await page.evaluate((index) => {
      const c = window.carma;
      const ability = c.powerups.abilities.get(index);
      return {
        selected: c.powerups.selectedAbility,
        charges: ability?.charges ?? 0,
        spillsBefore: c.simulation.oil.spills.filter(Boolean).length,
      };
    }, action.index);
    assert.equal(inventory.selected, action.index);
    assert.ok(inventory.charges > 0);

    await page.evaluate(() => {
      const c = window.carma;
      c.paused = false;
      document.activeElement?.blur?.();
    });
    await page.locator("#view").click({ position: { x: 600, y: 400 } });
    await page.keyboard.press("F");
    await page.waitForFunction(
      () => window.carma.simulation.oil.spills.some(Boolean),
      null,
      { timeout: 6000 },
    );
    const queued = await page.evaluate((index) => {
      const c = window.carma;
      const spill = c.simulation.oil.spills.find(Boolean);
      const sourcePosition = spill.source.readPosition().toArray();
      return {
        authored: spill.authored,
        pending: spill.pending,
        visible: spill.mesh.visible,
        initialSize: spill.initialSize,
        currentSize: spill.currentSize,
        friction: [...spill.friction],
        smearDistance: [...spill.smearDistance],
        materialName: spill.mesh.children[0]?.material?.map?.name ?? null,
        hasSource: !!spill.source,
        sourcePosition,
        sourceMatrix: [...spill.source.readMatrix().elements],
        ownerNull: spill.owner === null,
        nativeOwnerCarNull: spill.nativeOwnerCar === null,
        abilityCharges: c.powerups.abilities.get(index)?.charges ?? 0,
        gameTimeMs: c.stats.gameTimeMs,
      };
    }, action.index);
    assert.equal(queued.authored, true, JSON.stringify(queued));
    assert.ok(
      queued.hasSource && queued.ownerNull && queued.nativeOwnerCarNull,
    );
    assert.ok(Math.abs(queued.initialSize - 0.2) < 1e-6);
    assert.ok(Math.abs(queued.friction[0] - 0.01) < 1e-6);
    assert.ok(Math.abs(queued.friction[1] - 0.15) < 1e-6);
    assert.ok(finite([...queued.sourcePosition, ...queued.sourceMatrix]));
    await page.waitForTimeout(1400);
    const placed = await page.evaluate(() => {
      const c = window.carma;
      const spill = c.simulation.oil.spills.find(Boolean);
      if (!spill) return null;
      return {
        pending: spill.pending,
        visible: spill.mesh.visible,
        size: spill.currentSize,
        max: spill.fullSize,
        position: spill.position.toArray(),
        sourcePosition: spill.source.readPosition().toArray(),
        sourceBounds: [
          spill.source.readModelBounds().min.toArray(),
          spill.source.readModelBounds().max.toArray(),
        ],
        matrix: [...spill.mesh.matrix.elements],
        positionFromSource: spill.position.distanceTo(
          spill.source.readPosition(),
        ),
      };
    });
    assert.ok(placed, "charged oil slot remains allocated");
    assert.equal(placed.pending, false, JSON.stringify(placed));
    assert.equal(placed.visible, true, JSON.stringify(placed));
    assert.ok(placed.size > 0.2, JSON.stringify(placed));
    assert.ok(
      finite([...placed.position, ...placed.sourcePosition, ...placed.matrix]),
    );

    const driveStart = await page.evaluate(() => {
      const c = window.carma;
      const oil = c.simulation.oil;
      const original = oil.wheelFactors.bind(oil);
      const playerBody = c.simulation.cars.find((body) => body.human);
      window.__worldSlickGripSamples = [];
      oil.wheelFactors = (body, points, options) => {
        const factors = original(body, points, options);
        if (body === playerBody && window.__worldSlickGripSamples.length < 8)
          window.__worldSlickGripSamples.push({
            factors: [...factors],
            points: points.map((point) => point?.toArray() ?? null),
          });
        return factors;
      };
      return {
        position: c.vehicle.position.toArray(),
        frames: c.stats.gameFrames,
      };
    });
    await page.locator("#view").click({ position: { x: 600, y: 400 } });
    await page.keyboard.down("W");
    await page.waitForTimeout(900);
    await page.keyboard.up("W");
    const gripDrive = await page.evaluate(() => {
      const c = window.carma;
      c.paused = true;
      const body = c.simulation.cars.find((item) => item.human);
      return {
        position: c.vehicle.position.toArray(),
        frames: c.stats.gameFrames,
        samples: window.__worldSlickGripSamples,
        wheelOilRemaining: [0, 1, 2, 3].map((wheel) =>
          c.simulation.oil.wheelOilRemaining(body, wheel),
        ),
        wheelOilMaterial: [0, 1, 2, 3].map(
          (wheel) =>
            c.simulation.oil.wheelOilMaterial(body, wheel)?.name ?? null,
        ),
        skidmarks: c.skidmarks?.snapshot?.() ?? null,
      };
    });
    gripDrive.distance = Math.hypot(
      gripDrive.position[0] - driveStart.position[0],
      gripDrive.position[1] - driveStart.position[1],
      gripDrive.position[2] - driveStart.position[2],
    );
    assert.ok(gripDrive.frames > driveStart.frames);
    assert.ok(
      gripDrive.samples.length > 0,
      "production sampled player's wheel oil factors",
    );
    assert.ok(
      gripDrive.samples.some((sample) =>
        sample.factors.some((factor) => factor < 1),
      ),
      `W-driven wheel path did not sample reduced oil grip: ${JSON.stringify(gripDrive.samples)}`,
    );

    // Use the regular close/resume controls so the screenshot is unobscured.
    if (await page.locator("#debug-close").isVisible())
      await page.locator("#debug-close").click();
    if ((await page.locator("#menu-button").textContent())?.includes("RESUME"))
      await page.locator("#menu-button").click();
    // Brief diagnostic camera pose; the source and oil mesh remain production-owned.
    const chargedImage = await page.evaluate(() => {
      const c = window.carma;
      const spill = c.simulation.oil.spills.find(Boolean);
      const target = spill.mesh.getWorldPosition(spill.position.clone());
      c.camera.position
        .copy(target)
        .add(new c.camera.position.constructor(1.2, 1.1, 1.7));
      c.camera.up.set(0, 1, 0);
      c.camera.lookAt(target);
      c.camera.updateMatrixWorld(true);
      c.renderer.render(c.scene, c.camera);
      return c.renderer.domElement.toDataURL("image/png");
    });
    await writeFile(
      `artifacts/browser-world-slick-${dataRoot}-charged.png`,
      Buffer.from(chargedImage.slice("data:image/png;base64,".length), "base64"),
    );
    const webgl = await rendererError();
    assert.deepEqual(webgl.errors, [], `${dataRoot} charged oil WebGL`);
    chargedRuns.push({
      dataRoot,
      selected,
      action,
      queued,
      placed,
      gripDrive,
      webgl,
    });
  }

  // Stock Newcity1 has no authored world/WAM slick records. Exercise the
  // ordinary WorldDestruction -> onConnotations -> queueWorldSlick route with
  // an explicitly labelled slick fixture on an original retained target ACT.
  const selected = await loadRace("data");
  const fixture = await page.evaluate(() => {
    const c = window.carma;
    const destruction = c.simulation.destruction;
    const oil = c.simulation.oil;
    oil.__worldSlickUpdates = [];
    const updateOil = oil.update.bind(oil);
    oil.update = (timeMs, ...args) => {
      const result = updateOil(timeMs, ...args);
      const spill = oil.spills.find((item) => item?.authored);
      if (spill && oil.__worldSlickUpdates.length < 128)
        oil.__worldSlickUpdates.push({
          timeMs,
          queuedAt: spill.queuedAt,
          spillTime: spill.spillTime,
          pending: spill.pending,
          visible: spill.mesh.visible,
          position: spill.position.toArray(),
          sourcePosition: spill.source.readPosition().toArray(),
          size: spill.currentSize,
          matrix: [...spill.mesh.matrix.elements],
        });
      return result;
    };
    const materialEntries = [...(destruction.assets.materials ?? new Map())];
    const textured = materialEntries.find(([, material]) => material.map);
    if (!textured)
      throw new Error(
        "Original track has no registered textured MAT for slick fixture",
      );
    const candidates = [];
    for (let index = 0; index < destruction.specs.length; index++) {
      const spec = destruction.specs[index];
      if (
        spec.trigger.kind !== "model" ||
        !["nochange", "remove", "replacemodel"].includes(spec.mode) ||
        !Number.isFinite(spec.removalThreshold)
      )
        continue;
      const actor = destruction.retainActors.find((item) =>
        item.userData.worldSmashSpecIndices?.includes(index),
      );
      if (
        !actor ||
        !actor.visible ||
        !actor.children.some((child) => child.isMesh)
      )
        continue;
      actor.updateWorldMatrix(true, false);
      const position = actor
        .getWorldPosition(actor.position.clone().set(0, 0, 0))
        .toArray();
      const mesh = actor.children.find((child) => child.isMesh);
      if (!mesh?.geometry?.userData?.sourcePositions?.length) continue;
      candidates.push({ index, spec, actor, position });
    }
    candidates.sort((a, b) => Math.abs(a.position[1]) - Math.abs(b.position[1]));
    const chosen = candidates[0];
    if (!chosen)
      throw new Error(
        "No original retained model-trigger target ACT is eligible for controlled slick fixture",
      );
    const { index, spec, actor } = chosen;
    const materialName = textured[1].name;
    const config = {
      material: materialName,
      first: [0, 0.0003, 0],
      second: [0.2, 0.5, 0.8],
      firstPair: [0.03, 0.12],
      secondPair: [0.5, 1.5],
      secondMaterial: materialName,
    };
    if (!spec.connotations) {
      spec.connotations = {
        sounds: [],
        shrapnel: [],
        explosions: [],
        slick: null,
        activations: [],
        sideEffects: [],
        extensionFlags: 0,
        roomCode: -1,
        award: { frequency: "none" },
        variableChanges: [],
      };
    }
    spec.connotations.slick = config;
    const before = c.simulation.oil.spills.filter(Boolean).length;
    const sourceMesh = actor.children.find((child) => child.isMesh);
    const sourceBounds = sourceMesh?.geometry?.userData?.sourcePositions;
    if (!sourceMesh || !sourceBounds?.length)
      throw new Error(
        `Original source ACT ${actor.name} lacks retained MODEL bounds`,
      );
    actor.updateWorldMatrix(true, false);
    const result = destruction.handleContact({
      actor,
      kind: "body",
      normalImpulse: spec.removalThreshold,
      point: actor.getWorldPosition(actor.position.clone().set(0, 0, 0)),
      timeMs: c.stats.gameTimeMs,
    });
    const spill = c.simulation.oil.spills.find((item) => item?.authored);
    return {
      label:
        "controlled original-target ACT contact; injected slick connotation fixture, not authored track payload or driven impact",
      track: c.raceDefinition?.raceFilename,
      specIndex: index,
      trigger: { ...spec.trigger },
      mode: spec.mode,
      threshold: spec.removalThreshold,
      actorName: actor.name,
      actorWorldPosition: actor
        .getWorldPosition(actor.position.clone().set(0, 0, 0))
        .toArray(),
      sourceVertexCount: sourceBounds.length / 3,
      sourceModelFlags: sourceMesh.geometry.userData.modelFlags,
      eligibleOriginalTargetCount: candidates.length,
      closestTargetCandidates: candidates.slice(0, 8).map((candidate) => ({
        specIndex: candidate.index,
        actorName: candidate.actor.name,
        position: candidate.position,
        trigger: candidate.spec.trigger,
      })),
      materialName,
      materialTexture: textured[1].map?.name ?? null,
      contactChanged: result.changed,
      contactDiagnostics: result.diagnostics,
      queuedAtGameTimeMs: c.stats.gameTimeMs,
      queuedAtGameFrames: c.stats.gameFrames,
      raceStatus: c.race.status,
      before,
      after: c.simulation.oil.spills.filter(Boolean).length,
      spill: spill
        ? {
            authored: spill.authored,
            pending: spill.pending,
            visible: spill.mesh.visible,
            sourceIsOriginalACT: spill.source.identity === actor,
            sourcePosition: spill.source.readPosition().toArray(),
            sourceMatrix: [...spill.source.readMatrix().elements],
            bounds: [
              spill.source.readModelBounds().min.toArray(),
              spill.source.readModelBounds().max.toArray(),
            ],
            queuedAt: spill.queuedAt,
            spillTime: spill.spillTime,
            size: spill.currentSize,
            initialSize: spill.initialSize,
            friction: [...spill.friction],
            smearDistance: [...spill.smearDistance],
            material: spill.mesh.children[0]?.material?.map?.name ?? null,
            smearMaterial: spill.smearMaterial?.name ?? null,
            meshMatrix: [...spill.mesh.matrix.elements],
          }
        : null,
      configuredSlick: config,
      registeredMaterials: materialEntries.length,
    };
  });
  assert.equal(fixture.contactChanged, true, JSON.stringify(fixture));
  assert.ok(fixture.spill, JSON.stringify(fixture));
  assert.equal(fixture.spill.authored, true);
  assert.equal(fixture.spill.sourceIsOriginalACT, true);
  assert.ok(fixture.spill.pending);
  assert.ok(fixture.spill.bounds.flat().every(Number.isFinite));
  assert.ok(fixture.spill.sourceMatrix.every(Number.isFinite));
  const placementWait = await page.evaluate((spillTime) => {
    const c = window.carma;
    const remaining = Math.max(0, spillTime - c.stats.gameTimeMs);
    return {
      startGameTimeMs: c.stats.gameTimeMs,
      startGameFrames: c.stats.gameFrames,
      remainingGameMs: remaining,
      timeoutMs: Math.min(30000, Math.max(5000, remaining + 5000)),
    };
  }, fixture.spill.spillTime);
  await page.evaluate(() => (window.carma.paused = false));
  await page
    .waitForFunction(
      () => {
        return window.carma.simulation.oil.__worldSlickUpdates?.some(
          (sample) => !sample.pending && sample.visible,
        );
      },
      null,
      { timeout: placementWait.timeoutMs },
    )
    .catch(() => {});
  // PETPUMP is the only Stock WAM retained destruction target on this track,
  // and its real native placement gate rejects the source pose. Preserve that
  // observation, then try an untouched source ACT from the original live
  // NONCARS list. The only setup mutation is a clearly labelled synthetic
  // nochange spec/connotation routed through the normal destruction callback.
  const fallbackFixture = await page.evaluate(() => {
    const c = window.carma;
    const oil = c.simulation.oil;
    const updates = oil.__worldSlickUpdates;
    if (updates.some((sample) => !sample.pending && sample.visible))
      return null;
    const destruction = c.simulation.destruction;
    const existing = new Set(destruction.retainActors);
    const candidates = c.simulation.noncars
      .map((body) => {
        const actor = body.actor;
        if (existing.has(actor) || !actor.visible) return null;
        const mesh = actor.children.find((child) => child.isMesh);
        const sourcePositions = mesh?.geometry?.userData?.sourcePositions;
        if (!mesh || !sourcePositions?.length) return null;
        actor.updateWorldMatrix(true, false);
        const position = actor
          .getWorldPosition(actor.position.clone().set(0, 0, 0));
        const origin = position.clone().add(new actor.position.constructor(0, 0.3, 0));
        const floor = c.simulation.world.raycast(
          origin,
          new actor.position.constructor(0, -1, 0),
          3,
        );
        if (!floor || floor.normal.y < 0.97) return null;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i < sourcePositions.length; i += 3) {
          minX = Math.min(minX, sourcePositions[i]);
          minY = Math.min(minY, sourcePositions[i + 1]);
          minZ = Math.min(minZ, sourcePositions[i + 2]);
          maxX = Math.max(maxX, sourcePositions[i]);
          maxY = Math.max(maxY, sourcePositions[i + 1]);
          maxZ = Math.max(maxZ, sourcePositions[i + 2]);
        }
        const source = {
          identity: actor,
          readMatrix: () => actor.matrixWorld.clone(),
          readPosition: () => actor.getWorldPosition(actor.position.clone().set(0, 0, 0)),
          readModelBounds: () => ({
            min: position.clone().set(minX, minY, minZ),
            max: position.clone().set(maxX, maxY, maxZ),
            isEmpty: () => minX > maxX || minY > maxY || minZ > maxZ,
          }),
        };
        const probe = c.simulation.projectOil(
          position,
          0.8,
          null,
          { source, mesh: { position: position.clone().set(0, 0, 0) } },
        );
        if (
          !probe ||
          probe.normal.y < Math.fround(0.97) ||
          probe.nearbyFaceNormals.some((normal, index) => {
            const dot = normal.dot(probe.normal);
            return (
              dot < Math.fround(0.98) &&
              (dot > Math.fround(0.8) || probe.sameSideOfNearbyPlanes[index] === false)
            );
          })
        )
          return null;
        return {
          actor,
          mesh,
          position: position.toArray(),
          floorPoint: floor.point.toArray(),
          floorNormal: floor.normal.toArray(),
          floorDistance: floor.distance,
          projectedPosition: probe.position.toArray(),
          projectedNormal: probe.normal.toArray(),
          nearbyFaceCount: probe.nearbyFaceNormals?.length ?? 0,
          nativeValid: true,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.floorDistance - b.floorDistance);
    const candidate = candidates[0];
    if (!candidate) return { candidateCount: 0 };
    const base = destruction.specs[0];
    const index = destruction.specs.length;
    const material = [...(destruction.assets.materials ?? new Map())].find(
      ([, value]) => value.map,
    );
    if (!material) throw new Error("No original textured MAT for fallback fixture");
    const slick = {
      material: material[1].name,
      first: [0, 0.0003, 0],
      second: [0.2, 0.8, 0.8],
      firstPair: [0.03, 0.12],
      secondPair: [0.5, 1.5],
      secondMaterial: material[1].name,
    };
    const spec = {
      ...base,
      trigger: { kind: "model", name: candidate.actor.name },
      mode: "nochange",
      replacement: undefined,
      connotations: { ...base.connotations, slick },
    };
    destruction.specs.push(spec);
    const triggerKey = candidate.actor.name.replace(/\.(act|dat)$/i, "").toLowerCase();
    destruction.bindings.set(`model:${triggerKey}`, index);
    destruction.actorSpecs.set(candidate.actor, [index]);
    candidate.actor.userData.worldSmashRetained = true;
    candidate.actor.userData.worldSmashSpecIndices = [index];
    destruction.retainActors.push(candidate.actor);
    const before = oil.spills.filter(Boolean).length;
    const result = destruction.handleContact({
      actor: candidate.actor,
      kind: "body",
      normalImpulse: Math.max(1, spec.removalThreshold),
      point: candidate.actor.getWorldPosition(candidate.actor.position.clone().set(0, 0, 0)),
      timeMs: c.stats.gameTimeMs,
    });
    const spill = oil.spills.find((item) => item?.authored);
    return {
      label: "controlled contact on an original live NONCARS ACT; synthetic nochange spec and slick connotation, not an authored WAM record or driven impact",
      actorName: candidate.actor.name,
      sourcePosition: candidate.position,
      sourceVertexCount: candidate.mesh.geometry.userData.sourcePositions.length / 3,
      floorPoint: candidate.floorPoint,
      floorNormal: candidate.floorNormal,
      floorDistance: candidate.floorDistance,
      projectedPosition: candidate.projectedPosition,
      projectedNormal: candidate.projectedNormal,
      nearbyFaceCount: candidate.nearbyFaceCount,
      material: material[1].name,
      materialTexture: material[1].map?.name ?? null,
      contactChanged: result.changed,
      contactDiagnostics: result.diagnostics,
      queuedAt: c.stats.gameTimeMs,
      before,
      after: oil.spills.filter(Boolean).length,
      spill: spill
        ? {
            authored: spill.authored,
            pending: spill.pending,
            sourceIsOriginalACT: spill.source.identity === candidate.actor,
            sourcePosition: spill.source.readPosition().toArray(),
            sourceMatrix: [...spill.source.readMatrix().elements],
            bounds: [spill.source.readModelBounds().min.toArray(), spill.source.readModelBounds().max.toArray()],
            initialSize: spill.initialSize,
            friction: [...spill.friction],
            material: spill.smearMaterial?.name ?? null,
          }
        : null,
      eligibleFloorCandidateCount: candidates.length,
      sourceGateRejection: "previous original PETPUMP target failed native projection; retained in report",
    };

  });
  fixture.fallback = fallbackFixture;
  if (fallbackFixture?.spill) {
    const fallbackWait = await page.evaluate((spill) => {
      const current = window.carma.stats.gameTimeMs;
      return { startGameTimeMs: current, startGameFrames: window.carma.stats.gameFrames, timeoutMs: Math.min(20000, Math.max(5000, spill.spillTime - current + 5000)) };
    }, await page.evaluate(() => {
      const spill = window.carma.simulation.oil.spills.find((item) => item?.authored);
      return { spillTime: spill?.spillTime ?? window.carma.stats.gameTimeMs };
    }));
    await page.evaluate(() => (window.carma.paused = false));
    await page.waitForFunction(() => window.carma.simulation.oil.__worldSlickUpdates.some((sample) => !sample.pending && sample.visible), null, { timeout: fallbackWait.timeoutMs }).catch(() => {});
    fallbackFixture.placementWait = {
      ...fallbackWait,
      endGameTimeMs: await page.evaluate(() => window.carma.stats.gameTimeMs),
      endGameFrames: await page.evaluate(() => window.carma.stats.gameFrames),
      placementSample: await page.evaluate(() => window.carma.simulation.oil.__worldSlickUpdates.find((sample) => !sample.pending && sample.visible) ?? null),
    };
  }
  const worldPlaced = await page.evaluate(() => {
    const spill = window.carma.simulation.oil.spills.find(
      (item) => item?.authored,
    );
    const sampled = window.carma.simulation.oil.__worldSlickUpdates.find(
      (item) => !item.pending && item.visible,
    );
    return (
      spill && {
        pending: spill.pending,
        visible: spill.mesh.visible,
        size: spill.currentSize,
        position: spill.position.toArray(),
        sourcePosition: spill.source.readPosition().toArray(),
        matrix: [...spill.mesh.matrix.elements],
        gameTimeMs: window.carma.stats.gameTimeMs,
        gameFrames: window.carma.stats.gameFrames,
        paused: window.carma.paused,
        raceStatus: window.carma.race.status,
        updates: window.carma.simulation.oil.__worldSlickUpdates.slice(-6),
      }
    ) ?? (sampled && {
      pending: sampled.pending,
      visible: sampled.visible,
      size: sampled.size,
      position: sampled.position,
      sourcePosition: sampled.sourcePosition,
      matrix: sampled.matrix,
      gameTimeMs: sampled.timeMs,
      gameFrames: window.carma.stats.gameFrames,
      paused: window.carma.paused,
      raceStatus: window.carma.race.status,
      updates: window.carma.simulation.oil.__worldSlickUpdates.slice(-6),
    });
  });
  fixture.placed = worldPlaced;
  fixture.placementWait = {
    ...placementWait,
    endGameTimeMs:
      worldPlaced?.gameTimeMs ??
      (await page.evaluate(() => window.carma.stats.gameTimeMs)),
    endGameFrames:
      worldPlaced?.gameFrames ??
      (await page.evaluate(() => window.carma.stats.gameFrames)),
  };
  assert.ok(
    worldPlaced,
    `world slick never produced an observable placed sample: ${JSON.stringify({
      fixture,
      fallbackFixture,
      placementWait: fixture.placementWait,
      current: await page.evaluate(() => ({
        gameTimeMs: window.carma.stats.gameTimeMs,
        gameFrames: window.carma.stats.gameFrames,
        paused: window.carma.paused,
        raceStatus: window.carma.race.status,
        updates: window.carma.simulation.oil.__worldSlickUpdates.slice(-12),
        spills: window.carma.simulation.oil.spills.map((spill) =>
          spill && { pending: spill.pending, authored: spill.authored },
        ),
      })),
    })}`,
  );
  assert.equal(
    worldPlaced.pending,
    false,
    JSON.stringify({ worldPlaced, queued: fixture.spill }),
  );
  assert.equal(worldPlaced.visible, true, JSON.stringify(worldPlaced));
  assert.ok(
    worldPlaced.size > fixture.spill.initialSize,
    JSON.stringify(worldPlaced),
  );
  assert.ok(finite([...worldPlaced.position, ...worldPlaced.matrix]));
  if (await page.locator("#debug-close").isVisible())
    await page.locator("#debug-close").click();
  if ((await page.locator("#menu-button").textContent())?.includes("RESUME"))
    await page.locator("#menu-button").click();
  const worldImage = await page.evaluate(() => {
    const c = window.carma;
    const spill = c.simulation.oil.spills.find((item) => item?.authored);
    const target = spill.mesh.getWorldPosition(spill.position.clone());
    c.camera.position
      .copy(target)
      .add(new c.camera.position.constructor(1.2, 1.1, 1.7));
    c.camera.up.set(0, 1, 0);
    c.camera.lookAt(target);
    c.camera.updateMatrixWorld(true);
    c.renderer.render(c.scene, c.camera);
    return c.renderer.domElement.toDataURL("image/png");
  });
  await writeFile(
    "artifacts/browser-world-slick-stock-world-fixture.png",
    Buffer.from(worldImage.slice("data:image/png;base64,".length), "base64"),
  );
  const worldWebgl = await rendererError();
  assert.deepEqual(worldWebgl.errors, [], "controlled world slick WebGL");

  const report = {
    bundle: await page.evaluate(
      () =>
        [...document.scripts].find((script) => script.type === "module")?.src ??
        "unknown",
    ),
    chargedRuns,
    worldFixture: fixture,
    uncovered: [
      "Stock/Advanced track asset inspection reports no authored world/WAM slick payload; this harness injects one slick record for a controlled retained original ACT contact.",
      "Wheel grip/skid smear retain material is inspected numerically only if runtime sampling reaches the injected slick; no synthetic wheel contact is forced.",
    ],
    errors,
    failedRequests,
    badResponses,
    webgl: worldWebgl,
    warnings: await page.evaluate(() =>
      window.carma.assets.warnings.slice(-30),
    ),
  };
  assert.deepEqual(errors, [], JSON.stringify(errors));
  assert.deepEqual(failedRequests, [], JSON.stringify(failedRequests));
  assert.deepEqual(badResponses, [], JSON.stringify(badResponses));
  await writeFile(
    "artifacts/browser-world-slick.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        charged: chargedRuns.map(({ dataRoot, action, placed }) => ({
          dataRoot,
          action,
          placed,
        })),
        worldFixture: {
          actor: fixture.actorName,
          trigger: fixture.trigger,
          material: fixture.materialName,
          placed: fixture.placed,
        },
        errors: errors.length,
        failedRequests: failedRequests.length,
        badResponses: badResponses.length,
        webgl: worldWebgl,
        report: "artifacts/browser-world-slick.json",
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
