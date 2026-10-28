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
    "SKIP world-effects browser regression: Chromium or local C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5442;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
let browser;
const report = { cases: [], errors: [], failedRequests: [] };
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));

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
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90_000,
  });

  const loadCase = async (root, track) => {
    await page.evaluate(
      async ({ root, track }) => {
        const c = window.carma;
        const trackPath = c.assets.resolve(
          `${root}/RACES/${track}/${track}.txt`,
        );
        const carPath = c.assets.resolve("data/CARS/EAGLE3/EAGLE3.TXT");
        if (!trackPath || !carPath)
          throw new Error(`Original ${root} ${track} or Eagle3 is absent`);
        document.querySelector("#track-select").value = trackPath;
        document.querySelector("#car-select").value = carPath;
        await c.loadRace();
        c.paused = true;
        document.querySelector("#panel").hidden = true;
      },
      { root, track },
    );
    await page.waitForFunction(
      () => window.carma.opponentsReady && window.carma.simulation?.destruction,
      null,
      { timeout: 90_000 },
    );
  };

  for (const { root, track } of [
    { root: "data", track: "newcity1" },
    { root: "adv_data", track: "newcity1" },
    { root: "data", track: "Carrier1" },
    { root: "adv_data", track: "Carrier1" },
  ]) {
    await loadCase(root, track);
    const result = await page.evaluate(
      async ({ root, track }) => {
        const c = window.carma;
        c.paused = true;
        c.race.awardsClosed = true;
        const destruction = c.simulation.destruction;
        const candidates = [];
        c.scene.traverse((actor) => {
          const indices = actor.userData.worldSmashSpecIndices;
          if (!actor.visible || !Array.isArray(indices)) return;
          for (const index of indices) {
            const spec = destruction.specs[index];
            if (
              spec?.mode === "replacemodel" &&
              spec.trigger.kind === "model" &&
              spec.replacement?.fire?.chance === 100 &&
              spec.replacement.fire.parameters?.[0] > 0
            )
              candidates.push({ actor, index, spec });
          }
        });
        if (!candidates.length)
          throw new Error(
            `${root}/${track}: no visible retained replacement-fire ACT`,
          );
        const selected = candidates[0];
        const actor = selected.actor;
        const originalIdentifier =
          actor.userData.worldSmashOriginalIdentifier ?? actor.name;
        const targetMesh = (() => {
          const find = (node) => {
            if (node.isMesh) return node;
            for (const child of node.children) {
              const result = find(child);
              if (result) return result;
            }
          };
          return find(actor);
        })();
        if (!targetMesh)
          throw new Error(`${root}/${track}: replacement source has no mesh`);

        const spawnPackets = [];
        const smoke = c.smoke;
        const originalSpawnColumn = smoke.spawnColumn.bind(smoke);
        smoke.spawnColumn = (source) => {
          const slot = originalSpawnColumn(source);
          spawnPackets.push({ source, slot });
          return slot;
        };
        const originalPreparedOptions =
          c.assets.getNativeModelPreparedOptions.bind(c.assets);
        const preparedCalls = [];
        c.assets.getNativeModelPreparedOptions = (geometry) => {
          const options = originalPreparedOptions(geometry);
          preparedCalls.push({
            nativeIdentity: Boolean(geometry.userData.c2NativeModelIdentity),
            preparedSource: Boolean(geometry.userData.sourcePositions),
            options,
          });
          return options;
        };
        let connotationCalls = 0;
        const originalConnotations = destruction.assets.onConnotations;
        destruction.assets.onConnotations = (...args) => {
          connotationCalls++;
          return originalConnotations?.(...args);
        };
        const warningsBefore = [...c.assets.warnings];
        const contact = {
          actor,
          bodyActor: c.player.group,
          normalImpulse: Math.max(
            100,
            (selected.spec.removalThreshold ?? 0) + 100,
          ),
          effectMagnitude: 100,
          kind: "body",
          point: actor.getWorldPosition(new actor.position.constructor()),
          impacteeVelocity: c.player.state.velocity.clone(),
          smashStartingVelocity: c.player.state.velocity.clone(),
          impacteeTransform: c.player.group.matrixWorld.clone(),
          timeMs: c.stats.gameTimeMs >>> 0,
        };
        const impact = destruction.handleContact(contact);
        if (!impact.changed)
          throw new Error(
            `${root}/${track}: native replacement did not change the model: ${JSON.stringify(impact.diagnostics)}`,
          );
        const packetCountAfterFirst = spawnPackets.length;
        const connotationsAfterFirst = connotationCalls;
        const repeated = destruction.handleContact(contact);
        if (spawnPackets.length !== packetCountAfterFirst)
          throw new Error(
            `${root}/${track}: repeated same-model contact emitted replacement fire again`,
          );
        if (connotationCalls !== connotationsAfterFirst)
          throw new Error(
            `${root}/${track}: repeated same-model contact repeated connotations`,
          );
        if (repeated.changed)
          throw new Error(
            `${root}/${track}: repeated same-model contact changed the model again`,
          );
        const repeatedContact = {
          changed: repeated.changed,
          fireColumnDelta: spawnPackets.length - packetCountAfterFirst,
          connotationDelta: connotationCalls - connotationsAfterFirst,
        };

        const expectedColumns = selected.spec.replacement.fire.parameters[0];
        // The same original payload also launches burning physical debris. Its
        // mode-two column shares this pool but has a distinct actor/producer.
        const replacementPackets = spawnPackets.filter(
          ({ source }) => source.mode === 0 && source.actor === actor,
        );
        if (replacementPackets.length !== expectedColumns)
          throw new Error(
            `${root}/${track}: expected ${expectedColumns} replacement columns, got ${replacementPackets.length}`,
          );
        const packets = replacementPackets.map(({ source }) => ({
          mode: source.mode,
          actorMatches: source.actor === actor,
          car: source.car ?? null,
          rigid: source.rigid ?? null,
          lifetimeMs: source.lifetimeMs,
          vertex: source.vertex,
          colour: source.colour,
          hasSampler: typeof source.sampleVertex === "function",
        }));
        for (const packet of packets) {
          if (
            packet.mode !== 0 ||
            !packet.actorMatches ||
            packet.car !== null ||
            packet.rigid !== null ||
            packet.lifetimeMs !== 10_000_000 ||
            !packet.hasSampler
          )
            throw new Error(
              `${root}/${track}: replacement column ownership/lifetime mismatch ${JSON.stringify(packet)}`,
            );
        }
        const geometryTagged = Boolean(
          targetMesh.geometry.userData.c2NativeModelIdentity,
        );
        if (!geometryTagged)
          throw new Error(
            `${root}/${track}: replacement MODEL lacks native identity metadata`,
          );
        const newWarnings = c.assets.warnings.filter(
          (warning) => !warningsBefore.includes(warning),
        );
        const positiveOrderWarnings = newWarnings.filter((warning) =>
          /positive material.*order|positive.*material.*approx/i.test(warning),
        );
        if (positiveOrderWarnings.length)
          throw new Error(
            `${root}/${track}: native prepared MODEL reported positive material-order approximation: ${positiveOrderWarnings.join("; ")}`,
          );
        if (
          !preparedCalls.length ||
          preparedCalls.some(
            (entry) => !entry.nativeIdentity || !entry.preparedSource,
          )
        )
          throw new Error(
            `${root}/${track}: replacement fire did not use native MODEL prepared metadata`,
          );

        // Advance the real shared mode-zero column pool once. Verify the owner
        // transform sample and leave lifetime well above any repair boundary.
        const firstPacket = replacementPackets[0];
        const local = new actor.position.constructor();
        if (!firstPacket.source.sampleVertex(firstPacket.source.vertex, local))
          throw new Error(
            `${root}/${track}: replacement MODEL fire vertex could not be sampled`,
          );
        actor.updateWorldMatrix(true, false);
        const expectedPosition = local
          .clone()
          .applyMatrix4(actor.matrixWorld)
          .toArray();
        expectedPosition[1] -= 0.03;
        smoke.updateColumns((c.stats.gameTimeMs + 40) >>> 0, 40);
        const column = smoke.snapshot().columns[firstPacket.slot];
        if (!column?.active || column.remaining !== 9_999_960)
          throw new Error(
            `${root}/${track}: one native column update did not retain the world fire source`,
          );
        const actualPosition = column.position.toArray();
        const positionError = Math.max(
          ...actualPosition.map((value, i) =>
            Math.abs(value - expectedPosition[i]),
          ),
        );
        if (positionError > 1e-4)
          throw new Error(
            `${root}/${track}: live ACT source transform differs by ${positionError}`,
          );
        c.simulation.repair(c.player);
        const afterRepair = smoke.snapshot().columns[firstPacket.slot];
        if (!afterRepair.active || afterRepair.remaining !== 9_999_960)
          throw new Error(
            `${root}/${track}: full player repair retired ownerless mode-zero world smoke`,
          );
        await smoke.loadTextures();
        for (let step = 1; step <= 7; step++)
          smoke.updateColumns((c.stats.gameTimeMs + 40 * (step + 1)) >>> 0, 40);
        const animated = smoke.snapshot().columns[firstPacket.slot];
        const flameCount = animated.flames.filter(
          (flame) => flame.visible && flame.frame >= 0,
        ).length;
        if (!flameCount)
          throw new Error(
            `${root}/${track}: original replacement fire never entered visible flame animation`,
          );
        const flameMeshes =
          smoke.group.children
            .filter((child) => child.isGroup)
            [
              firstPacket.slot
            ]?.children.filter((child) => child.isMesh && child.visible && child.material.map)
            .length ?? 0;
        if (!flameMeshes)
          throw new Error(
            `${root}/${track}: replacement fire has no visible original-textured mesh`,
          );

        // Directly exercise the production connotation callback with an isolated
        // synthetic award. Closed race awards reject credits/time, but the native
        // integerSecond still reaches the original SCROLLERS font/text selection.
        const creditsBefore = c.race.credits;
        const timeBefore = c.race.timeLeft;
        c.race.awardsClosed = true;
        const synthetic = {
          sounds: [],
          shrapnel: [],
          explosions: [],
          slick: null,
          activations: [],
          sideEffects: [],
          extensionFlags: 0,
          roomCode: 0,
          award: {
            frequency: "doitregardless",
            first: 1234,
            second: 30,
            integerFirst: 0,
            integerSecond: 8,
          },
          variableChanges: [],
        };
        const callback = destruction.assets.onConnotations;
        if (typeof callback !== "function")
          throw new Error(
            `${root}/${track}: production connotation callback unavailable`,
          );
        callback(synthetic, contact, false);
        const scrollers = (await c.assets.text("data/SCROLLERS.TXT"))
          .split(/\r?\n/)
          .map((line) => line.split("//")[0].trim())
          .filter(Boolean);
        const sourceFields = scrollers[19].split(/[\s,\/]+/);
        const expectedText = sourceFields.slice(2).join(" ").replace(/_/g, " ");
        const fancy = c.wastedFeedback.fancySnapshot;
        if (c.race.credits !== creditsBefore || c.race.timeLeft !== timeBefore)
          throw new Error(
            `${root}/${track}: closed race changed credits/time for synthetic award`,
          );
        if (
          fancy.index !== 8 ||
          fancy.fontId !== 23 ||
          fancy.text !== expectedText
        )
          throw new Error(
            `${root}/${track}: synthetic fancy award mismatch ${JSON.stringify({ fancy, expectedText, sourceFont: sourceFields[1] })}`,
          );

        const gl = c.renderer.getContext();
        const backend = gl.getParameter(gl.RENDERER);
        return {
          root,
          track,
          fixture:
            "actual visible retained ACT replacement-fire spec via paused production WorldDestruction.handleContact",
          source: {
            actor: originalIdentifier,
            specIndex: selected.index,
            trigger: selected.spec.trigger.name,
            replacementModel: selected.spec.replacement.model,
            fireChance: selected.spec.replacement.fire.chance,
            authoredCount: expectedColumns,
            fireParameters: [...selected.spec.replacement.fire.parameters],
            actualColumns: packets,
            allProducerColumnCount: packetCountAfterFirst,
            nativeModelIdentity: geometryTagged,
            nativePreparedOptionCalls: preparedCalls.length,
            positiveMaterialOrderWarnings: positiveOrderWarnings,
            oneFrameSmoke: {
              active: column.active,
              remaining: column.remaining,
              position: actualPosition,
              expectedPosition,
              maxPositionError: positionError,
              flameSpritesVisible: column.flames.filter(
                (flame) => flame.visible,
              ).length,
            },
            fullRepairPreservedWorldColumn:
              afterRepair.active && afterRepair.remaining === column.remaining,
            animatedOriginalFlameCount: flameCount,
            visibleOriginalFlameMeshes: flameMeshes,
            repeatedContact,
          },
          syntheticAward: {
            fixture:
              "direct production destruction.assets.onConnotations callback; doitregardless award while race.awardsClosed",
            award: {
              frequency: "doitregardless",
              first: 1234,
              second: 30,
              integerSecond: 8,
            },
            creditsBefore,
            creditsAfter: c.race.credits,
            timeBefore,
            timeAfter: c.race.timeLeft,
            fancyIndex: fancy.index,
            fontId: fancy.fontId,
            text: fancy.text,
            expectedOriginalScrollerText: expectedText,
            drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
            renderer: backend,
            glError: gl.getError(),
          },
        };
      },
      { root, track },
    );
    assert.equal(
      result.fixture.includes("paused production WorldDestruction"),
      true,
    );
    assert.equal(
      result.source.actualColumns.length,
      result.source.authoredCount,
    );
    assert.equal(result.source.repeatedContact.fireColumnDelta, 0);
    assert.equal(result.source.repeatedContact.connotationDelta, 0);
    assert.equal(result.source.fullRepairPreservedWorldColumn, true);
    assert.deepEqual(result.source.positiveMaterialOrderWarnings, []);
    assert.equal(result.syntheticAward.fancyIndex, 8);
    assert.equal(result.syntheticAward.fontId, 23);
    assert.equal(
      result.syntheticAward.creditsBefore,
      result.syntheticAward.creditsAfter,
    );
    assert.equal(
      result.syntheticAward.timeBefore,
      result.syntheticAward.timeAfter,
    );
    assert.equal(result.syntheticAward.glError, 0);
    report.cases.push(result);
    const label = `${root}-${track}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    await page.screenshot({
      path: `artifacts/browser-world-effects-${label}.png`,
      fullPage: true,
    });
  }

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  await writeFile(
    "artifacts/browser-world-effects.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error.stack || error);
  await writeFile(
    "artifacts/browser-world-effects.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
