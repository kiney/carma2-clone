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
    "SKIP native pedestrian gameplay browser test: Chromium or C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5231;
const server = spawn(process.execPath, ["server/dev.mjs"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
let browser;
let intentionalReload = false;
const report = {
  mode: "NativePedRuntime + NativePedGameplay with original Blokebl assets in live VehicleSimulation",
  cases: [],
  errors: [],
  errorCounts: {},
  abortedDuringReload: [],
  failedRequests: [],
  badResponses: [],
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
  assert.ok(ready, `development asset server did not start: ${serverLog}`);
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
  page.setDefaultTimeout(90000);
  page.on("pageerror", (error) => {
    const message = String(error);
    report.errorCounts[message] = (report.errorCounts[message] ?? 0) + 1;
    if (!report.errors.some((entry) => entry.message === message))
      report.errors.push({ message, stack: error.stack });
  });
  page.on("console", (message) => {
    if (message.type() === "error")
      report.errors.push({ message: message.text() });
  });
  page.on("requestfailed", (request) => {
    const failure = `${request.url()}: ${request.failure()?.errorText}`;
    if (
      intentionalReload &&
      request.failure()?.errorText === "net::ERR_ABORTED"
    )
      report.abortedDuringReload.push(failure);
    else report.failedRequests.push(failure);
  });
  page.on("response", (response) => {
    if (response.status() >= 400)
      report.badResponses.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });

  for (const dataRoot of ["data", "adv_data"]) {
    if (dataRoot === "adv_data") {
      intentionalReload = true;
      await page.goto(`http://localhost:${port}`);
      await page.waitForFunction(() => window.carma?.stats.ready, null, {
        timeout: 90000,
      });
      intentionalReload = false;
    }
    const track = await page.evaluate(
      (root) =>
        [...document.querySelector("#track-select").options].find(
          (option) =>
            option.value.toLowerCase().startsWith(`${root}/`) &&
            /newcity1/i.test(`${option.value} ${option.textContent}`),
        )?.value,
      dataRoot,
    );
    assert.ok(track, `missing ${dataRoot} Newcity1 track`);
    const result = await page.evaluate(
      async ({ track, dataRoot }) => {
        const c = window.carma;
        const carPath = [...document.querySelector("#car-select").options].find(
          (option) =>
            !option.value.toLowerCase().startsWith("adv_data/") &&
            /eagle3/i.test(`${option.value} ${option.textContent}`),
        )?.value;
        if (!carPath) throw new Error("Stock Eagle3 selection unavailable");
        document.querySelector("#track-select").value = track;
        document.querySelector("#car-select").value = carPath;
        await c.loadRace();
        c.paused = true;
        document.querySelector("#panel").hidden = true;
        const [
          assetsModule,
          runtimeModule,
          gameplayModule,
          poolModule,
          fsmModule,
          deadModule,
          randomModule,
          settingsModule,
          otherModule,
          attributionModule,
          pedBodyModule,
          headModule,
          bloodModule,
          slickMaterialsModule,
          recoveryModule,
          processModule,
          rulesModule,
        ] = await Promise.all([
          import("/src/ped-native-assets.ts"),
          import("/src/ped-native-runtime.ts"),
          import("/src/ped-native-gameplay.ts"),
          import("/src/ped-body-pool.ts"),
          import("/src/ped-move-fsm.ts"),
          import("/src/ped-dead-models.ts"),
          import("/src/native-random.ts"),
          import("/src/physics/ped-contact.ts"),
          import("/src/physics/ped-other.ts"),
          import("/src/ped-contact-attribution.ts"),
          import("/src/physics/ped-body.ts"),
          import("/src/ped-head-sequence.ts"),
          import("/src/ped-blood.ts"),
          import("/src/ped-slick-materials.ts"),
          import("/src/ped-recovery-effects.ts"),
          import("/src/ped-process-cache.ts"),
          import("/src/ped-rules.ts"),
        ]);
        const assets = await assetsModule.loadNativePedAssets(
          c.assets,
          "PEDS/PEEPS/Blokebl",
          "Blokebl",
          dataRoot,
        );
        const dead = deadModule.prepareNativePedDeadModels("Blokebl", assets, {
          nullFaceMaterial: () => assets.inheritedActorMaterial,
        });
        const settings = settingsModule.parsePedContactSettings(
          await c.assets.text(`${dataRoot}/PEDS/settings.txt`),
        );
        const bloodSettings = bloodModule.parsePedBloodSettings(
          await c.assets.text(`${dataRoot}/PEDS/settings.txt`),
        );
        // Controlled source renderer globals for registration, not a claim that
        // the full race Glorify/fog adaptation owner has been integrated.
        const slickRegistry =
          new slickMaterialsModule.NativePedSlickMaterialRegistry(c.assets, {
            dataRoot,
            pixelmapDirectory: "PIX16",
            textureQuality: {
              interpolation: false,
              antialiasing: false,
              perspective: true,
              exceptionFlags: () => null,
            },
          });
        const slickRegistration = await slickRegistry.prepare();
        if (slickRegistration.status !== "complete")
          throw new Error(slickRegistration.requiredProviders.join(", "));
        for (const name of [
          bloodSettings.slick.pixelmap,
          bloodSettings.slick.smearMaterial,
        ]) {
          if (!name) continue;
          const registered = slickRegistry.loadTemporaryMaterial(name);
          if (registered.status !== "complete")
            throw new Error(registered.requiredProviders.join(", "));
        }
        const moveTable = fsmModule.readNativePedMoveFSM(
          await c.assets.bytes("carma2_HW.exe"),
        );
        // These controlled enrolled fixtures explicitly select authored movement
        // row0; normal track placement/personality mapping remains separate.
        const processMovement = rulesModule.parsePedSettings(
          await c.assets.text(`${dataRoot}/PEDS/settings.txt`),
        ).movements[0];
        if (!processMovement)
          throw new Error("Original process movement row absent");
        const rng = randomModule.sharedNativeRandom;
        const owner = { label: `Blokebl-${dataRoot}` };
        const events = [];
        const cacheByOwner = new Map();
        const attribute = attributionModule.createNativePedContactAttribution({
          readOther: (_ctx, actual) =>
            otherModule.describeNativePedAttributionOther(actual.other, {
              readCharacterCache: (otherOwner) =>
                cacheByOwner.get(otherOwner) ?? null,
            }),
          readCarDriver: (candidate) =>
            c.simulation.pedestrianAttributionDriver(candidate),
          readCarCulprit: (candidate) =>
            c.simulation.pedestrianAttributionCulprit(candidate),
        });
        const globals = {
          immortal: false,
          exploding: false,
          brittle: false,
          goreLevel: 1,
          dismemberSpurtCount: 100,
          mutantSpeed: 0,
          blind: false,
          valiumTimeMs: 0,
          replay: false,
        };
        const recoveryHost = {
          readAllocation: (owner) => runtime.allocation(owner),
          readOil: () => c.simulation.oil,
          readSlick: () => bloodSettings.slick,
          readMaterials: () => slickRegistry.materials,
          statusRecording: "disabled",
          onSlickResult: (owner, result) => {
            events.push({
              kind: "corpse-slick",
              owner: owner.label,
              status: result.status,
              requiredProviders: result.requiredProviders,
              queuedAt: result.spill?.queuedAt ?? null,
              spillTime: result.spill?.spillTime ?? null,
              poolSlot: result.spill
                ? c.simulation.oil.spills.indexOf(result.spill)
                : null,
            });
          },
        };
        const gameplay = new gameplayModule.NativePedGameplay({
          settings,
          readGlobals: () => globals,
          nextCrtInteger: () => rng.nextInteger(),
          // This harness exercises live MODEL selection with replay recording
          // explicitly disabled; it does not claim a native replay serializer.
          headModelRecording: "disabled",
          onRecoveryEffect:
            recoveryModule.createNativePedRecoveryEffects(recoveryHost),
          preflightRecoveryEffects: (ctx, state, input, decision) =>
            recoveryModule.preflightNativePedRecoveryEffects(
              recoveryHost,
              ctx,
              state,
              input,
              decision,
            ),
          planMove: fsmModule.createNativePedMovePlanner(moveTable, () => ({
            drunk: false,
            dancing: false,
            panicking: false,
            pedestrianSpeedFactor: 0,
          })),
          onNoise: (event) => {
            events.push({
              kind: "noise",
              owner: event.context.owner.label,
              phase: event.phase,
              index: event.index,
            });
          },
          attributeContact: (context, dispatch, state) => {
            const diagnostics = attribute(context, dispatch, state) ?? [];
            events.push({
              kind: "attribute",
              phase: dispatch.phase,
              impactCount: context.character.impactCount,
              owner: context.owner.label,
              hitPlayer: dispatch.other === c.player,
              routeDiagnostics: diagnostics,
              cachedDriver: state.cache?.killerDriver ?? null,
              other: dispatch.other
                ? {
                    rigidType: dispatch.other.rigidType ?? null,
                    driver:
                      c.simulation.pedestrianAttributionDriver(
                        dispatch.other,
                      ) ?? null,
                    id: dispatch.other.id ?? null,
                  }
                : null,
            });
          },
          onContactEffects: (context, dispatch, damage) => {
            events.push({
              kind: "contact-effects",
              owner: context.owner.label,
              phase: dispatch.phase,
              damage: damage.damage ?? null,
              rawDamage: damage.rawDamage ?? null,
              hitPoints: damage.hitPoints ?? null,
              applied: damage.applied ?? null,
            });
          },
          onKillGiblets: (context, dispatch, packet) => {
            events.push({
              kind: "kill-giblets",
              owner: context.owner.label,
              force: packet.force,
              headPose: context.instance.bones[assets.form.headBone].poseIndex,
            });
          },
          onOneLessPed: (context) => {
            events.push({
              kind: "one-less",
              owner: context.owner.label,
              flags: context.character.flags,
            });
          },
          onScoreDeath: (context, state) => {
            events.push({
              kind: "score-death",
              owner: context.owner.label,
              hitPoints: context.character.hitPoints,
              action: state.action,
              killerDriver: state.cache?.killerDriver ?? null,
            });
          },
          readHaltInput: (context, state) => {
            const body = context.body;
            const form = context.instance.template.form;
            const head = form.headBone;
            const volumeGravity =
              body.specialVolume?.volume?.gravityMultiplier ?? null;
            const renderSlot =
              runtime.allocation(context.owner)?.renderSlot ?? -1;
            const input = {
              actorRootPose: pedBodyModule.nativePedRootPose(body),
              characterOrientation: context.instance.characterOrientation,
              worldFaceNormals: body.worldFaceNormals.map((normal) =>
                normal.toArray(),
              ),
              ...(body.firstWorldFaceNormal
                ? { optionalFaceNormal: body.firstWorldFaceNormal.toArray() }
                : {}),
              mass: body.properties.mass,
              inertia: body.properties.inertia.toArray(),
              bounds: body.profile.bounds,
              lyingAxes: form.lyingAxes,
              head: {
                boneIndex: head,
                modelState: renderSlot,
                renderSlot,
              },
              collisionFlag: body.collisionFlags !== 0,
              nowMs: context.timeMs,
              immortal: globals.immortal,
              volumeGravity,
              goreLevel: globals.goreLevel,
              mutantSpeed: globals.mutantSpeed,
            };
            events.push({
              kind: "halt-input",
              input: {
                actorRootPose: Array.from(input.actorRootPose),
                characterOrientation: Array.from(input.characterOrientation),
                worldFaceNormals: input.worldFaceNormals,
                optionalFaceNormal: input.optionalFaceNormal ?? null,
                mass: input.mass,
                inertia: input.inertia,
                bounds: input.bounds,
                lyingAxes: input.lyingAxes,
                head: input.head,
                collisionFlag: input.collisionFlag,
                volumeGravity: input.volumeGravity,
                goreLevel: input.goreLevel,
                nowMs: input.nowMs,
                gameTimeMs: c.stats.gameTimeMs,
                simulationElapsed: c.simulation.elapsed,
                runtimeTimeMs: runtime.currentTimeMs,
                nativeClock: { ...context.instance.clock },
                moveId: context.instance.moveId,
                physicalActive: context.instance.physicsActive,
              },
            });
            return input;
          },
        });
        const runtime = new runtimeModule.NativePedRuntime(c.simulation, {
          levelOut: 0,
          hooks: gameplay.hooks,
        });
        gameplay.bindRuntime(runtime);
        const processPool = new processModule.NativePedProcessCachePool({
          readCache: (owner) => gameplay.state(owner).cache,
          writeCache: (owner, cache) => {
            gameplay.state(owner).cache = cache;
            cacheByOwner.set(owner, cache);
          },
          randomTurnInterval: (min, max) =>
            rulesModule.pedRandomInteger(rng.random, min, max),
        });
        runtime.hooks.beforePose = (context) => {
          const result = processPool.visit(context.owner, {
            timeMs: context.timeMs,
            replay: globals.replay,
            minTurnIntervalMs: processMovement.minTurnMs,
            maxTurnIntervalMs: processMovement.maxTurnMs,
            spurtingPeriodMs: bloodSettings.spurtingPeriodMs >>> 0,
          });
          return {
            status: result.status,
            requiredProviders: result.requiredProviders,
            processedFrames: 0,
            completedMove: false,
          };
        };
        const moved = runtime.moved.bind(runtime);
        runtime.moved = (record, period) => {
          try {
            return moved(record, period);
          } catch (error) {
            events.push({
              kind: "moved-error",
              error: String(error),
              stack: error?.stack,
              timeMs: c.stats.gameTimeMs,
              runtimeTimeMs: runtime.currentTimeMs,
              simulationElapsed: c.simulation.elapsed,
              framePeriodMs: period,
              clock: record.instance ? { ...record.instance.clock } : null,
              moveId: record.instance?.moveId,
              physicsActive: record.instance?.physicsActive,
              body: record.body
                ? {
                    position: record.body.state.position.toArray(),
                    velocity: record.body.state.velocity.toArray(),
                    state: c.simulation.phil.getState(record.body),
                  }
                : null,
            });
            throw error;
          }
        };
        runtime.registerPersonality("Blokebl", assets, { deadModels: dead });
        const player = c.player;
        const forward = player.state.velocity.clone();
        forward.y = 0;
        if (forward.lengthSq() < 0.01)
          forward.set(0, 0, -1).applyQuaternion(player.state.orientation);
        forward.normalize();
        const rootPosition = player.state.position
          .clone()
          .addScaledVector(forward, 1.65);
        rootPosition.y += 0.15;
        const timeMs = Math.max(0, Math.trunc(c.stats.gameTimeMs)) >>> 0;
        const character = runtime.enroll({
          owner,
          personality: "Blokebl",
          rootPose: [
            1,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            1,
            rootPosition.x,
            rootPosition.y,
            rootPosition.z,
          ],
          moveId: 30,
          direction: forward.toArray(),
          groundNormal: [0, 1, 0],
          timeMs,
          flags: 0x40,
          hitPoints: 100,
        });
        const gameplayState = gameplay.enroll(owner, {
          action: 0,
          cache: null,
        });
        cacheByOwner.set(owner, gameplayState.cache);
        const frameSettings = poolModule.createNativePedPoolSettings(100, 0);
        const cameraOrigin = c.camera.position.toArray();
        let reverseReplayCount = 0;
        const reverseReplaySamples = [];
        const prepare = () => {
          const rawGameTimeMs = c.stats.gameTimeMs;
          const inputTimeMs = Math.max(0, Math.trunc(rawGameTimeMs)) >>> 0;
          const priorClock = character.instance
            ? { ...character.instance.clock }
            : null;
          const runtimeBefore = runtime.currentTimeMs;
          const visits = runtime.prepareFrame({
            cameraOrigin,
            timeMs: inputTimeMs,
            settings: frameSettings,
          });
          const visit = visits.find(
            (entry) => entry.pool.character.owner === owner,
          );
          if (
            visit?.pose?.requiredProviders.includes(
              "native-reverse-replay-provider",
            )
          ) {
            reverseReplayCount++;
            if (reverseReplaySamples.length < 20)
              reverseReplaySamples.push({
                rawGameTimeMs,
                inputTimeMs,
                runtimeBefore,
                priorClock,
                resultingClock: character.instance
                  ? { ...character.instance.clock }
                  : null,
                simulationElapsed: c.simulation.elapsed,
                pose: visit.pose,
              });
          }
          return visits;
        };
        let lastFrameVisits = [];
        let gameplayReleased = false;
        let releaseEventStart = events.length;
        // A second authentic body proves the ordinary inactive out-of-scope
        // PHIL/pool removal path independently of the active corpse below.
        const releaseOwner = { label: `release-control-${dataRoot}` };
        const releasePosition = player.state.position
          .clone()
          .add(new player.state.position.constructor(2, 0, 2));
        const releaseCharacter = runtime.enroll({
          owner: releaseOwner,
          personality: "Blokebl",
          rootPose: [
            1,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            1,
            releasePosition.x,
            releasePosition.y,
            releasePosition.z,
          ],
          moveId: 30,
          direction: forward.toArray(),
          groundNormal: [0, 1, 0],
          timeMs,
          flags: 0x40,
        });
        const releaseState = gameplay.enroll(releaseOwner, {
          action: 0,
          cache: null,
        });
        const initialVisits = prepare();
        const allocation = runtime.allocation(owner);
        if (!allocation?.body)
          throw new Error(
            `Native body pool did not allocate the original pedestrian: ${JSON.stringify({ visits: initialVisits.map((visit) => ({ status: visit.pool.status, required: visit.pool.requiredProviders, collideworthyReturn: visit.pool.collideworthyReturn, registrationReturn: visit.pool.registrationReturn })), flags: character.flags, position: character.position, cameraOrigin, bounds: assets.profile.bounds, maxSimple: assets.form.maxSimple })}`,
          );
        window.__pedNativeGroup = character.instance.group;
        const controlAllocated = !!runtime.allocation(releaseOwner)?.body;
        if (!controlAllocated)
          throw new Error(
            "Head sequence control lacks actual render/body allocation",
          );
        const headStateBefore = {
          clock: { ...releaseCharacter.instance.clock },
          root: Array.from(releaseCharacter.instance.rootPose),
          velocity: releaseCharacter.body.state.velocity.toArray(),
          randomState: rng.state,
        };
        const startHead = gameplay.startHeadSequence(
          releaseOwner,
          headModule.nativePedScareHeadSequence,
          timeMs,
        );
        const headSamples = [
          {
            offsetMs: 0,
            pose: releaseCharacter.instance.bones[assets.form.headBone]
              .poseIndex,
            status: startHead.status,
          },
        ];
        for (const offsetMs of [125, 126, 251, 252, 378]) {
          const result = gameplay.advanceHeadSequence(
            releaseOwner,
            (timeMs + offsetMs) >>> 0,
          );
          headSamples.push({
            offsetMs,
            pose: releaseCharacter.instance.bones[assets.form.headBone]
              .poseIndex,
            status: result.status,
          });
        }
        globals.replay = true;
        const replayHead = gameplay.advanceHeadSequence(
          releaseOwner,
          (timeMs + 504) >>> 0,
        );
        globals.replay = false;
        const calmHead = gameplay.startHeadSequence(
          releaseOwner,
          headModule.nativePedCalmHeadSequence,
          (timeMs + 500) >>> 0,
        );
        const endHead = gameplay.advanceHeadSequence(
          releaseOwner,
          (timeMs + 626) >>> 0,
        );
        const headSequence = {
          method:
            "controlled source timestamps on an allocated original personality; MODEL-only calls, replay recording explicitly disabled",
          samples: headSamples,
          replay: { status: replayHead.status, reason: replayHead.reason },
          calm: {
            status: calmHead.status,
            endStatus: endHead.status,
            state: { ...releaseState.cache.headSequence },
            pose: releaseCharacter.instance.bones[assets.form.headBone]
              .poseIndex,
          },
          before: headStateBefore,
          after: {
            clock: { ...releaseCharacter.instance.clock },
            root: Array.from(releaseCharacter.instance.rootPose),
            velocity: releaseCharacter.body.state.velocity.toArray(),
            randomState: rng.state,
          },
        };
        runtime.updateState(releaseOwner, {
          flags: releaseCharacter.flags | 0x80,
        });
        const controlReleaseVisit = prepare();
        const controlReleased = !runtime.allocation(releaseOwner);
        // Ordinary offscreen/render release retains Ped process/gameplay state;
        // only the admitted visit refreshes its bounded process timestamp.
        let running = true;
        const frameTick = () => {
          if (!running) return;
          try {
            lastFrameVisits = prepare();
          } catch (error) {
            events.push({
              kind: "prepare-error",
              error: String(error),
              stack: error?.stack,
              timeMs: c.stats.gameTimeMs,
              clock: character.instance
                ? { ...character.instance.clock }
                : null,
              moveId: character.instance?.moveId,
              runtimeTimeMs: runtime.currentTimeMs,
              simulationElapsed: c.simulation.elapsed,
              lastTick: c.stats.lastTick,
              active: character.instance?.physicsActive,
            });
          }
          requestAnimationFrame(frameTick);
        };
        requestAnimationFrame(frameTick);
        window.__pedNativeSnapshot = () => ({
          events: [...events],
          slickMaterials: {
            registration: slickRegistration.status,
            identities: slickRegistration.resources.map(
              (resource) => resource.identifier,
            ),
            temporaryEntries: slickRegistry.temporaryMaterials.length,
            renderingScope:
              "verified initial registration; final race Glorify/fog adaptation remains separate",
          },
          slickSpills: c.simulation.oil.spills
            .filter(
              (spill) =>
                spill?.source?.identity === character.instance?.bones[0]?.actor,
            )
            .map((spill) => ({
              queuedAt: spill.queuedAt,
              spillTime: spill.spillTime,
              pending: spill.pending,
              visible: spill.mesh.visible,
              fullSize: spill.fullSize,
              growRate: spill.growRate,
              currentSize: spill.currentSize,
              friction: [...spill.friction],
              material: spill.mesh.children[0]?.material?.name ?? null,
            })),
          processCache: {
            capacity: processPool.slots.length,
            used: processPool.slots.filter((cache) => cache.owner !== null)
              .length,
            index: gameplayState.cache?.index ?? null,
            lastUsedTimeMs: gameplayState.cache?.lastUsedTimeMs ?? null,
            spurtingPeriodMs: gameplayState.cache?.spurtingPeriodMs ?? null,
            turnInterval: [
              processMovement.minTurnMs,
              processMovement.maxTurnMs,
            ],
            scope:
              "original row0 controlled fixtures; bounded allocation on admitted beforePose visits",
          },
          gameTimeMs: c.stats.gameTimeMs,
          runtimeTimeMs: runtime.currentTimeMs,
          nativeClock: character.instance
            ? { ...character.instance.clock }
            : null,
          character: {
            flags: character.flags,
            physicsFlags: character.physicsFlags,
            hitPoints: character.hitPoints,
            impactCount: character.impactCount,
            removedBoneMask: character.removedBoneMask,
            vanishedBoneMask: character.vanishedBoneMask,
            bonedSlot: character.bonedSlot,
            diagnostics: [...character.diagnostics],
            rootPose: [...character.rootPose],
            body: character.body
              ? {
                  headerState: character.body.headerState,
                  philState: c.simulation.phil.getState(character.body),
                  position: character.body.state.position.toArray(),
                  velocity: character.body.state.velocity.toArray(),
                  mass: character.body.properties.mass,
                  active: character.body.active,
                  diagnostics: [...character.body.diagnostics],
                }
              : null,
          },
          gameplay: {
            action: gameplayState.action,
            deathTimeMs: gameplayState.deathTimeMs,
            countCommitted: gameplayState.countCommitted,
            callback: gameplayState.callback,
            diagnostics: [...gameplayState.diagnostics],
          },
          modelSet: character.instance?.modelSet ?? null,
          poseIndices:
            character.instance?.bones.map((bone) => bone.poseIndex) ?? [],
          boneMask: character.instance?.removedBoneMask ?? null,
          phil: {
            registered: c.simulation.phil.registeredBodies.length,
            state: allocation.body.headerState,
          },
        });
        window.__pedNativeStop = () => {
          running = false;
        };
        window.__pedNativeRelease = () => {
          releaseEventStart = events.length;
          const before = {
            cameraOrigin: [...cameraOrigin],
            gameTimeMs: c.stats.gameTimeMs,
            runtimeTimeMs: runtime.currentTimeMs,
            nativeClock: character.instance
              ? { ...character.instance.clock }
              : null,
            simulationElapsed: c.simulation.elapsed,
            flags: character.flags,
            philState: character.body
              ? c.simulation.phil.getState(character.body)
              : null,
            velocity: character.body?.state.velocity.toArray() ?? null,
          };
          // PrepareFrame recomputes scope flags. Exercise the actual native
          // distance gate using a controlled camera input, not a transient bit.
          cameraOrigin.splice(
            0,
            3,
            Math.fround(
              character.position[0] + frameSettings.processDistance + 1,
            ),
            character.position[1],
            character.position[2],
          );
          c.paused = false;
          running = true;
          requestAnimationFrame(frameTick);
          return {
            before,
            trigger:
              "controlled native camera origin beyond authored process distance; RAF continues with live application timestamps",
            cameraOrigin: [...cameraOrigin],
          };
        };
        window.__pedNativeReleaseStatus = () => {
          const released = !runtime.allocation(owner);
          if (released && !gameplayReleased) {
            gameplayReleased = true;
            // Resource release does not delete the source Ped+0c owner.
          }
          const releaseHaltInputs = events
            .slice(releaseEventStart)
            .filter((event) => event.kind === "halt-input");
          return {
            released,
            allocation: !!runtime.allocation(owner),
            phil: c.simulation.phil.registeredBodies.length,
            diagnostics: [...character.diagnostics],
            gameTimeMs: c.stats.gameTimeMs,
            runtimeTimeMs: runtime.currentTimeMs,
            nativeClock: character.instance
              ? { ...character.instance.clock }
              : null,
            simulationElapsed: c.simulation.elapsed,
            flags: character.flags,
            philState: character.body
              ? c.simulation.phil.getState(character.body)
              : null,
            velocity: character.body?.state.velocity.toArray() ?? null,
            lastVisit:
              lastFrameVisits.find(
                (visit) => visit.pool.character.owner === owner,
              )?.pool.status ?? null,
            haltInputsSinceRelease: releaseHaltInputs.length,
            firstHaltInputSinceRelease: releaseHaltInputs[0]?.input ?? null,
            lastHaltInputSinceRelease: releaseHaltInputs.at(-1)?.input ?? null,
            reverseReplayCount,
            reverseReplaySamples,
            recentEvents: events
              .filter((event) =>
                ["halt-input", "prepare-error", "moved-error"].includes(
                  event.kind,
                ),
              )
              .slice(-4),
          };
        };
        window.__pedNativeControlledSever = () => {
          running = false;
          c.paused = true;
          const controlledGlobalsGore = globals.goreLevel;
          globals.goreLevel = 2;
          const controlledOwner = { label: `controlled-sever-${dataRoot}` };
          const controlledPosition = c.player.state.position
            .clone()
            .addScaledVector(forward, 3);
          const controlledTime =
            Math.max(0, Math.trunc(c.stats.gameTimeMs)) >>> 0;
          const controlledCharacter = runtime.enroll({
            owner: controlledOwner,
            personality: "Blokebl",
            rootPose: [
              1,
              0,
              0,
              0,
              1,
              0,
              0,
              0,
              1,
              controlledPosition.x,
              controlledPosition.y,
              controlledPosition.z,
            ],
            moveId: 30,
            direction: forward.toArray(),
            groundNormal: [0, 1, 0],
            timeMs: controlledTime,
            flags: 0x40,
            hitPoints: 100,
          });
          const controlledGameplay = gameplay.enroll(controlledOwner, {
            action: 0,
            cache: null,
          });
          cacheByOwner.set(controlledOwner, controlledGameplay.cache);
          prepare();
          const body = controlledCharacter.body;
          if (!body) throw new Error("Controlled sever body did not allocate");
          runtime.activate(controlledOwner);
          const beforeRng = rng.state;
          // This isolated source row enters the real grouped native damage path,
          // with genuine FORM/settings/PHIL providers and a separately labeled CRT
          // seed. It does not claim contact geometry or a keyboard-driven impact.
          rng.seed(24);
          const impactNormal = body.state.position.clone().set(0, 1, 0);
          const row = {
            a: body,
            b: c.player,
            point: body.state.position.clone(),
            normal: impactNormal,
            normalImpulse: 0.4,
            closingSpeed: 1,
            tangentImpulse: impactNormal.clone().set(0, 0, 0),
            sourceType: 5,
          };
          const eventStart = events.length;
          c.simulation.processPedContactDamage([row]);
          globals.goreLevel = controlledGlobalsGore;
          return {
            label:
              "controlled original-lambda fixture; directly enters grouped damage dispatch, no collision solver or keyboard-driving claim",
            sourceSettings: settings,
            sourceCRTSeed: 24,
            crtStateBeforeSeed: beforeRng,
            crtStateAfter: rng.state,
            headBone: assets.form.headBone,
            normalizedContactDamage:
              events
                .slice(eventStart)
                .find((event) => event.kind === "contact-effects")?.damage ??
              null,
            hitPoints: controlledCharacter.hitPoints,
            removedBoneMask: controlledCharacter.removedBoneMask,
            headRemoved: !!(
              controlledCharacter.removedBoneMask &
              (1 << assets.form.headBone)
            ),
            bonedSlot: controlledCharacter.bonedSlot,
            detachedBodies: c.simulation.pedBoneBodies.filter(
              (part) => part.owner === controlledOwner,
            ).length,
            philState: c.simulation.phil.getState(body),
            bodyPosition: body.state.position.toArray(),
            events: events.slice(eventStart),
          };
        };
        c.paused = false;
        return {
          dataRoot,
          actor: assets.bones.map((bone) => bone.actor?.name),
          modelCount: assets.bones.length,
          deadModelCount: dead.models.length,
          moveRows: moveTable.rows.length,
          sourceAddress: moveTable.sourceAddress,
          settings,
          start: rootPosition.toArray(),
          playerStart: player.state.position.toArray(),
          playerVelocity: player.state.velocity.toArray(),
          bodyState: allocation.body.headerState,
          initialVisits: initialVisits.map((visit) => visit.pool.status),
          headSequence,
          inactiveRelease: {
            allocated: controlAllocated,
            released: controlReleased,
            trigger:
              "controlled out-of-scope flags 0x80 while PHIL header remained inactive",
            visits: controlReleaseVisit.map((visit) => ({
              status: visit.pool.status,
              owner: visit.pool.character.owner.label,
            })),
            remainingPhil: c.simulation.phil.registeredBodies.length,
          },
          character: {
            flags: character.flags,
            hitPoints: character.hitPoints,
            impactCount: character.impactCount,
            position: [...character.position],
          },
          gameplayState: {
            action: gameplayState.action,
            countCommitted: gameplayState.countCommitted,
          },
          ownerKey: owner.label,
        };
      },
      { track, dataRoot },
    );
    report.cases.push({
      ...result,
      drive: { method: "keyboard W, up to 7 s", outcome: null },
    });
    await page.keyboard.down("KeyW");
    await page.waitForTimeout(7000);
    await page.keyboard.up("KeyW");
    // Quieting is a physical velocity/contact gate, not a fixed seven-second
    // deadline. Keep InitPedProcessCache's authentic retry0 and wait for the
    // original contacted body before pausing the scene for a closeup.
    let quietWaitCompleted = true;
    await page
      .waitForFunction(
        () => {
          const state = window.__pedNativeSnapshot?.();
          return (
            state?.character.body?.philState === 1 &&
            state.nativeClock?.periodMs === 0
          );
        },
        null,
        { timeout: 10000, polling: "raf" },
      )
      .catch(() => {
        quietWaitCompleted = false;
      });
    report.cases.at(-1).quietWait = {
      completed: quietWaitCompleted,
      timeoutMs: 10000,
      criterion:
        "original contacted corpse PHIL1 and stopped native animation clock",
    };
    const controlledSever = await page.evaluate(
      () => window.__pedNativeControlledSever?.() ?? null,
    );
    report.cases.at(-1).controlledSever = controlledSever;
    // Keep scenario state inside the page, then read the actual live records and callback trace.
    const snapshot = await page.evaluate(
      () => window.__pedNativeSnapshot?.() ?? null,
    );
    if (snapshot) report.cases.at(-1).after = snapshot;
    else report.cases.at(-1).afterUnavailable = true;
    const closeup = await page.evaluate(() => {
      const c = window.carma;
      const group = window.__pedNativeGroup;
      const h = window.__pedNativeSnapshot?.();
      if (!group || !h?.character?.body) return null;
      c.paused = true;
      c.scene.updateMatrixWorld(true);
      const vec = (x = 0, y = 0, z = 0) =>
        c.camera.position.clone().set(x, y, z);
      const emptyBounds = () => ({
        min: vec(Infinity, Infinity, Infinity),
        max: vec(-Infinity, -Infinity, -Infinity),
      });
      const boundsEmpty = (box) =>
        box.min.x > box.max.x || box.min.y > box.max.y || box.min.z > box.max.z;
      const addPoint = (box, point) => {
        box.min.min(point);
        box.max.max(point);
      };
      const unionBounds = (boxes) =>
        boxes.reduce((all, item) => {
          if (!boundsEmpty(item)) {
            all.min.min(item.min);
            all.max.max(item.max);
          }
          return all;
        }, emptyBounds());
      const objectBounds = (root) => {
        const box = emptyBounds();
        root.traverse((object) => {
          if (!object.isMesh || !object.geometry) return;
          for (let parent = object; parent; parent = parent.parent)
            if (!parent.visible) return;
          if (!object.geometry.boundingBox)
            object.geometry.computeBoundingBox();
          const local = object.geometry.boundingBox;
          if (!local) return;
          for (const x of [local.min.x, local.max.x])
            for (const y of [local.min.y, local.max.y])
              for (const z of [local.min.z, local.max.z])
                addPoint(box, vec(x, y, z).applyMatrix4(object.matrixWorld));
        });
        return box;
      };
      const subjects = [];
      const bones = [];
      const visibleBoneBounds = [];
      group.children.forEach((actor, index) => {
        const model = actor.children.find(
          (child) => child.visible && child.isGroup,
        );
        const eligible = actor.visible && actor.parent === group && !!model;
        const bounds = emptyBounds();
        if (eligible) {
          Object.assign(bounds, objectBounds(model));
          if (!boundsEmpty(bounds)) {
            subjects.push({ actor, model, index });
            visibleBoneBounds.push(bounds);
          }
        }
        bones.push({
          index,
          actor: actor.name,
          actorVisible: actor.visible,
          attachedToInstanceGroup: actor.parent === group,
          selectedModel: model?.name ?? null,
          modelVisible: !!model,
          includedAsSubject: eligible && !boundsEmpty(bounds),
          worldBounds:
            eligible && !boundsEmpty(bounds)
              ? {
                  min: bounds.min.toArray(),
                  max: bounds.max.toArray(),
                }
              : null,
        });
      });
      if (!subjects.length)
        return { diagnostic: { status: "no-visible-selected-models", bones } };
      const bounds = unionBounds(visibleBoneBounds);
      const target = bounds.min.clone().add(bounds.max).multiplyScalar(0.5);
      const size = bounds.max.clone().sub(bounds.min);
      const sphereRadius = Math.max(size.length() / 2, 0.025);
      const canvas = document.querySelector("canvas");
      const rect = canvas?.getBoundingClientRect();
      const aspect =
        c.camera.aspect || (rect?.width ?? 1) / (rect?.height ?? 1);
      const verticalFov = (c.camera.fov * Math.PI) / 180;
      const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
      const distance = sphereRadius / Math.sin((verticalFov * 0.65) / 2);
      const directions = [
        [1, 0.35, 1],
        [-1, 0.35, 1],
        [1, 0.35, -1],
        [-1, 0.35, -1],
        [0.2, 1, 1],
        [-0.2, 1, 1],
        [1, 0.8, 0.2],
        [-1, 0.8, 0.2],
      ].map((value) => vec(...value).normalize());
      const subjectModels = new Set(subjects.map(({ model }) => model));
      const isSubjectHit = (object) => {
        for (let current = object; current; current = current.parent)
          if (subjectModels.has(current)) return true;
        return false;
      };
      const samples = [target.clone()];
      for (const axis of [vec(1, 0, 0), vec(0, 1, 0), vec(0, 0, 1)]) {
        samples.push(
          target.clone().addScaledVector(axis, size.dot(axis) * 0.32),
        );
        samples.push(
          target.clone().addScaledVector(axis, -size.dot(axis) * 0.32),
        );
      }
      const occluders = [];
      c.scene.traverse((object) => {
        if (!object.isMesh || !object.visible || !object.geometry) return;
        let parent = object;
        while (parent && parent !== c.scene) {
          if (!parent.visible) return;
          if (subjectModels.has(parent)) return;
          parent = parent.parent;
        }
        const box = objectBounds(object);
        if (boundsEmpty(box)) return;
        occluders.push({ object, box });
      });
      const rayBoxDistance = (origin, direction, box, limit) => {
        let near = 0,
          far = limit;
        if (
          origin.x >= box.min.x &&
          origin.x <= box.max.x &&
          origin.y >= box.min.y &&
          origin.y <= box.max.y &&
          origin.z >= box.min.z &&
          origin.z <= box.max.z
        )
          return null;
        for (const axis of ["x", "y", "z"]) {
          if (Math.abs(direction[axis]) < 1e-8) {
            if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis])
              return null;
            continue;
          }
          let first = (box.min[axis] - origin[axis]) / direction[axis];
          let last = (box.max[axis] - origin[axis]) / direction[axis];
          if (first > last) [first, last] = [last, first];
          near = Math.max(near, first);
          far = Math.min(far, last);
          if (near > far) return null;
        }
        return near <= limit ? near : null;
      };
      const views = directions.map((direction, index) => {
        const eye = target.clone().addScaledVector(direction, distance);
        let blocked = 0;
        const blockers = [];
        const cameraInsideBounds = occluders
          .filter(
            ({ box }) =>
              eye.x >= box.min.x &&
              eye.x <= box.max.x &&
              eye.y >= box.min.y &&
              eye.y <= box.max.y &&
              eye.z >= box.min.z &&
              eye.z <= box.max.z,
          )
          .map(({ object }) => object.name || object.type);
        for (const point of samples) {
          const ray = point.clone().sub(eye);
          const rayLength = ray.length();
          ray.normalize();
          let obstruction = null;
          for (const candidate of occluders) {
            const hit = rayBoxDistance(
              eye,
              ray,
              candidate.box,
              rayLength - 0.015,
            );
            if (hit !== null && (!obstruction || hit < obstruction.distance))
              obstruction = { distance: hit, object: candidate.object };
          }
          if (obstruction) {
            blocked++;
            blockers.push({
              name: obstruction.object.name || null,
              type: obstruction.object.type,
              distance: obstruction.distance,
            });
          }
        }
        return {
          index,
          eye: eye.toArray(),
          direction: direction.toArray(),
          blockedRays: blocked,
          sampleCount: samples.length,
          blockers,
          cameraInsideBounds,
        };
      });
      const viewScore = (view) => view.blockedRays * 1000 + view.index * 0.001;
      const selectedView = [...views].sort(
        (a, b) => viewScore(a) - viewScore(b),
      )[0];
      c.camera.position.copy(vec(...selectedView.eye));
      c.camera.lookAt(target);
      c.camera.updateProjectionMatrix();
      c.camera.updateMatrixWorld(true);
      c.scene.updateMatrixWorld(true);
      const projectedRect = (box) => {
        const corners = [];
        for (const x of [box.min.x, box.max.x])
          for (const y of [box.min.y, box.max.y])
            for (const z of [box.min.z, box.max.z])
              corners.push(vec(x, y, z).project(c.camera));
        const width = rect?.width ?? canvas?.width ?? 1;
        const height = rect?.height ?? canvas?.height ?? 1;
        const xs = corners.map((p) => ((p.x + 1) * width) / 2);
        const ys = corners.map((p) => ((1 - p.y) * height) / 2);
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
          insideFrame:
            corners.every((p) => p.z >= -1 && p.z <= 1) &&
            Math.min(...xs) >= 0 &&
            Math.max(...xs) <= width &&
            Math.min(...ys) >= 0 &&
            Math.max(...ys) <= height,
        };
      };
      const perBoneProjection = subjects.map(({ index, model }) => ({
        index,
        model: model.name || null,
        pixelRect: projectedRect(objectBounds(model)),
      }));
      const targetRect = projectedRect(bounds);
      c.renderer.render(c.scene, c.camera);
      return {
        image: canvas?.toDataURL("image/png") ?? null,
        diagnostic: {
          status:
            targetRect.insideFrame && targetRect.height >= 80
              ? "framed"
              : "clipped-or-small",
          visibleSelectedModelCount: subjects.length,
          bones,
          bodyWorldRoot: h.character.body.position,
          actorGroupWorldMatrix: group.matrixWorld.toArray(),
          worldBounds: {
            min: bounds.min.toArray(),
            max: bounds.max.toArray(),
            size: size.toArray(),
            center: target.toArray(),
          },
          camera: {
            eye: selectedView.eye,
            target: target.toArray(),
            distance,
            fovDegrees: c.camera.fov,
            aspect,
            verticalFovRadians: verticalFov,
            horizontalFovRadians: horizontalFov,
            chosenOffsetIndex: selectedView.index,
          },
          chosenView: selectedView,
          candidateViews: views,
          sceneOcclusion: selectedView.blockedRays
            ? "possible-blockers-from-coarse-world-AABBs"
            : selectedView.cameraInsideBounds.length
              ? "inconclusive-camera-inside-coarse-world-AABB"
              : "no-sampled-world-AABB-blocker",
          projectedPixelRect: targetRect,
          perBoneProjection,
          occlusionMethod:
            "scene mesh world-AABB ray samples; approximate obstruction test",
          note: "Read-only diagnostic framing from visible selected-model bounds; scenery and PHIL/gameplay state are unchanged.",
        },
      };
    });
    if (closeup?.image?.startsWith("data:image/png;base64,")) {
      const path = `artifacts/browser-ped-native-gameplay-${dataRoot}-closeup.png`;
      await writeFile(
        path,
        Buffer.from(
          closeup.image.slice("data:image/png;base64,".length),
          "base64",
        ),
      );
      report.cases.at(-1).closeupScreenshot = path;
    }
    report.cases.at(-1).visualDiagnostic = closeup?.diagnostic ?? {
      status: "unavailable",
    };
    const releaseStart = await page.evaluate(
      () => window.__pedNativeRelease?.() ?? null,
    );
    await page
      .waitForFunction(
        () => window.__pedNativeReleaseStatus?.()?.released,
        null,
        // Source recent-event grace is7500ms; keep actual RAF/PD timestamps.
        { timeout: 10000, polling: "raf" },
      )
      .catch(() => {});
    const releaseStatus = await page.evaluate(
      () => window.__pedNativeReleaseStatus?.() ?? null,
    );
    const release = { ...releaseStart, afterLiveFrames: releaseStatus };
    report.cases.at(-1).release = release;
    report.cases.at(-1).unsupported = [
      ...new Set([
        ...(snapshot?.character?.diagnostics ?? []),
        ...(snapshot?.gameplay?.diagnostics ?? []),
      ]),
    ];
    const ordinaryOwner = report.cases.at(-1).ownerKey;
    report.cases.at(-1).coverage = {
      actualContactObserved: !!snapshot?.events.some(
        (event) => event.owner === ordinaryOwner && event.kind === "attribute",
      ),
      actualPlayerBodyContactObserved: !!snapshot?.events.some(
        (event) =>
          event.owner === ordinaryOwner &&
          event.kind === "attribute" &&
          event.hitPlayer,
      ),
      persistentDeath:
        snapshot?.character.hitPoints === 0 &&
        Number.isInteger(snapshot?.gameplay.deathTimeMs),
      countAndScoreCallbacks:
        snapshot?.gameplay.countCommitted &&
        snapshot?.events.some(
          (event) =>
            event.owner === ordinaryOwner && event.kind === "score-death",
        ),
      deadModelSet:
        snapshot?.modelSet === 1 && snapshot?.poseIndices?.[1] === 2,
      headSeverReached: !!(snapshot?.character.removedBoneMask & (1 << 1)),
      controlledNativeSever:
        !!controlledSever?.headRemoved && controlledSever.detachedBodies > 0,
      inactiveHeaderRelease: !!report.cases.at(-1).inactiveRelease.released,
      activeCorpseQuieted:
        snapshot?.character.body?.philState === 1 &&
        snapshot.nativeClock?.periodMs === 0,
      corpseAllocationReleased: !!release?.afterLiveFrames?.released,
      coverageComplete: false,
      uncovered: [
        "authored halt/recovery face-cache continuation",
        "ordinary native population ownership",
      ],
      closeupCamera: closeup?.diagnostic?.status ?? "unavailable",
    };
    report.cases.at(-1).playerAfter = await page.evaluate(() =>
      window.carma.player.state.position.toArray(),
    );
    await page.evaluate(() => {
      window.carma.paused = true;
      document.querySelector("#panel").hidden = true;
    });
    await page.screenshot({
      path: `artifacts/browser-ped-native-gameplay-${dataRoot}.png`,
    });
  }
  report.webgl = await page.evaluate(() => {
    const gl =
      window.carma.renderer?.getContext?.() ??
      document.querySelector("canvas")?.getContext("webgl2");
    return gl
      ? { version: gl.getParameter(gl.VERSION), error: gl.getError() }
      : null;
  });
  await writeFile(
    "artifacts/browser-ped-native-gameplay.json",
    JSON.stringify(report, null, 2),
  );
  for (const scenario of report.cases) {
    assert.equal(scenario.after.slickMaterials.registration, "complete");
    assert.deepEqual(scenario.after.slickMaterials.identities, [
      "GIBSLICK",
      "GIBSMEAR.MAT",
    ]);
    assert.equal(
      scenario.coverage.activeCorpseQuieted,
      true,
      `${scenario.dataRoot}: actual contacted corpse quiets to passive PHIL with stopped animation`,
    );
    assert.equal(
      scenario.coverage.corpseAllocationReleased,
      true,
      `${scenario.dataRoot}: actual source camera distance releases retained corpse allocation`,
    );
    assert.deepEqual(
      scenario.unsupported,
      [],
      `${scenario.dataRoot}: ordinary corpse has actual effect owners`,
    );
    const slickEvents = scenario.after.events.filter(
      (event) =>
        event.kind === "corpse-slick" && event.owner === scenario.ownerKey,
    );
    assert.ok(
      slickEvents.length <= 1,
      `${scenario.dataRoot}: once-only corpse effect`,
    );
    for (const event of slickEvents) {
      assert.equal(event.status, "queued");
      assert.deepEqual(event.requiredProviders, []);
      assert.equal(event.spillTime - event.queuedAt, 300);
      assert.ok(event.poolSlot >= 0 && event.poolSlot < 32);
    }
    for (const spill of scenario.after.slickSpills) {
      assert.equal(spill.material, "GIBSLICK");
      assert.deepEqual(spill.friction, [Math.fround(0.2), 1]);
      assert.ok(
        spill.fullSize >= Math.fround(0.05) &&
          spill.fullSize <= Math.fround(0.15),
      );
    }
    assert.deepEqual(
      scenario.headSequence.samples.map((sample) => sample.pose),
      [1, 1, 2, 2, 1, 2],
      `${scenario.dataRoot}: installed scare table loops with strict 125ms gate`,
    );
    assert.ok(
      scenario.headSequence.samples.every(
        (sample) => sample.status === "complete",
      ),
    );
    assert.equal(scenario.headSequence.replay.reason, "replay");
    assert.equal(scenario.headSequence.calm.pose, 0);
    assert.equal(scenario.headSequence.calm.state.address, null);
    assert.equal(scenario.headSequence.calm.endStatus, "complete");
    assert.deepEqual(
      scenario.headSequence.after,
      scenario.headSequence.before,
      `${scenario.dataRoot}: head MODEL changes retain BON, physical pose/velocity and shared CRT`,
    );
    assert.ok(
      scenario.inactiveRelease?.released,
      `${scenario.dataRoot}: normal inactive body removal`,
    );
    assert.equal(
      scenario.coverage?.persistentDeath,
      true,
      `${scenario.dataRoot}: real contact death persisted`,
    );
    assert.equal(
      scenario.coverage?.countAndScoreCallbacks,
      true,
      `${scenario.dataRoot}: count/score callback`,
    );
    assert.equal(
      scenario.coverage?.deadModelSet,
      true,
      `${scenario.dataRoot}: original dead model transition`,
    );
    assert.equal(
      scenario.visualDiagnostic?.status,
      "framed",
      `${scenario.dataRoot}: visible selected model bounds framed`,
    );
    assert.equal(
      scenario.visualDiagnostic?.visibleSelectedModelCount,
      scenario.modelCount,
      `${scenario.dataRoot}: visible selected models reported`,
    );
    assert.equal(
      scenario.visualDiagnostic?.projectedPixelRect?.insideFrame,
      true,
      `${scenario.dataRoot}: subject bounds inside diagnostic frame`,
    );
  }
  assert.deepEqual(report.failedRequests, [], "failed browser requests");
  assert.deepEqual(report.badResponses, [], "HTTP errors");
  assert.deepEqual(report.errors, [], "browser/runtime errors");
  assert.ok(report.webgl?.error === 0, "WebGL2 error-free state");
} catch (error) {
  report.fatal = { message: String(error), stack: error?.stack };
  report.serverLog = serverLog;
  await writeFile(
    "artifacts/browser-ped-native-gameplay.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
