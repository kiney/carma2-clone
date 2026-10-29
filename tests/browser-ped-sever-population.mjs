import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium";
try {
  await access(executable);
  await access(process.env.CARMA2_ROOT || "carma2_orig");
} catch {
  console.log(
    "SKIP ordinary population severing: Chromium or C2 assets absent",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const port = Number(process.env.PED_SEVER_PORT || 5272);
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "",
  browser;
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
const report = {
  mode: "Original enrolled population; controlled car placement/velocity, actual PHIL impact and native severing; no HP/action/mask/sever-call overrides",
  contactOnly: process.env.PED_SEVER_CONTACT_ONLY === "1",
  explicitFullGoreFrame: process.env.PED_SEVER_FULL_GORE === "1",
  sourceCRTSeed: Number(process.env.PED_SEVER_SEED || 24),
  maxCandidateAttemptsPerTree: 3,
  physicsFrameBudgetPerAttempt: 60,
  cases: [],
  errors: [],
  failedRequests: [],
  badResponses: [],
};
try {
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/manifest`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) throw new Error(serverLog);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, `production asset server failed: ${serverLog}`);
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
    report.errors.push(String(error?.stack ?? error)),
  );
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
      report.badResponses.push(`${response.status()} ${response.url()}`);
  });
  await page.goto(`http://127.0.0.1:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  const trees = process.env.PED_SEVER_TREE
    ? [process.env.PED_SEVER_TREE]
    : ["data", "adv_data"];
  for (const dataRoot of trees) {
    let selection, result;
    const attempts = [],
      candidateIndices =
        process.env.PED_SEVER_CANDIDATE !== undefined
          ? [Number(process.env.PED_SEVER_CANDIDATE)]
          : [0, 1, 2];
    for (const candidateIndex of candidateIndices) {
      // Each bounded attempt uses a fresh original race. A legitimate kill need
      // not sever: native blood consumes CRT draws before the severing branch.
      selection = await page.evaluate(async (root) => {
        const trackSelect = document.querySelector("#track-select"),
          carSelect = document.querySelector("#car-select");
        const track = [...trackSelect.options].find(
          (option) =>
            option.value.toLowerCase().startsWith(`${root}/`) &&
            /newcity1/i.test(`${option.value} ${option.textContent}`),
        )?.value;
        const car = [...carSelect.options].find(
          (option) =>
            option.value.toLowerCase() === "data/cars/eagle3/eagle3.txt",
        )?.value;
        if (!track || !car)
          throw new Error(`Missing ${root} Newcity1 or Stock Eagle3`);
        trackSelect.value = track;
        carSelect.value = car;
        await window.carma.loadRace();
        window.carma.paused = false;
        document.querySelector("#panel").hidden = true;
        return { track, car };
      }, dataRoot);
      await page.waitForFunction(
        () =>
          window.carma?.populationLoadState?.pedestrians?.state === "ready" &&
          window.carma?.pedestrians?.nativeLifecycle?.physical > 0,
        null,
        { timeout: 90000 },
      );
      await page.evaluate(() => (window.carma.paused = true));
      result = await page.evaluate(
        ({ seed, contactOnly, explicitFullGore, candidateIndex }) => {
          const c = window.carma,
            system = c.pedestrians,
            bridge = system.nativeBridge,
            runtime = system.nativeRuntime,
            car = c.player;
          if (!bridge || !c.shards?.options?.seed)
            throw new Error(
              "Missing ordinary population/shared native CRT owner",
            );
          const nearestOtherCar = (row) =>
            Math.min(
              ...c.simulation.cars
                .filter((other) => other !== car)
                .map((other) =>
                  row.body.state.position.distanceTo(other.state.position),
                ),
            );
          const candidates = runtime.characters
            .filter(
              (row) =>
                row.body &&
                row.instance &&
                row.hitPoints > 0 &&
                row.formKey === "BIPED1" &&
                !row.removedBoneMask &&
                !row.instance.physicsActive &&
                row.diagnostics.size === 0 &&
                system.renderActors.has(row.owner),
            )
            .sort((a, b) => nearestOtherCar(b) - nearestOtherCar(a))
            .slice(0, 3);
          const character = candidates[candidateIndex];
          if (!character)
            throw new Error(
              `No ordinary passive BIPED1 candidate${candidateIndex}`,
            );
          const owner = character.owner,
            body = character.body,
            instance = character.instance,
            state = bridge.gameplay.state(owner),
            ped = system.peds.find((row) => row.object === owner),
            census = runtime.characters.slice(),
            simpleResources = new Set(runtime.simpleResources),
            boneResources = new Set(runtime.bonePool.resources);
          const camera = body.state.position.clone(),
            start = Math.max(0, Math.trunc(c.stats.gameTimeMs));
          const originalCarPose = {
            position: car.state.position.clone(),
            orientation: car.state.orientation.clone(),
            heading: car.state.heading,
          };
          let now = start,
            steps = 0;
          const advanceOuter = () => {
            now += 40;
            // Follow the actual physical root while testing retained parts. A
            // high-energy corpse may leave the fixed initial camera's real scope;
            // explicit scope release is exercised separately below.
            camera.copy(body.state.position);
            system.update(
              0.04,
              {
                position: car.state.position,
                yaw: car.state.heading,
                speed: car.state.velocity.length(),
                velocity: car.state.velocity,
              },
              {
                gameTimeMs: now,
                physicsTickMs: Math.round(c.simulation.elapsed * 1000) >>> 0,
                framePeriodMs: 40,
                cameraPosition: camera,
                threats: [],
                combatOwner: car,
                combatPosition: car.state.position,
                ...(explicitFullGore ? { goreLevel: 2 } : {}),
              },
            );
          };
          const step = () => {
            advanceOuter();
            c.simulation.updateFrame(now, 40);
            system.finishPhysics();
            steps++;
          };
          advanceOuter();
          advanceOuter();
          if (!(character.flags & 0x40))
            throw new Error(
              "Normal visits did not arm source impact eligibility",
            );
          const globals = bridge.gameplay.options.readGlobals();
          if (globals.goreLevel !== 2)
            throw new Error(
              `Expected original full-gore internal2, actual${globals.goreLevel}; explicit fixture override=${explicitFullGore}`,
            );
          const snapshots = () => ({
            hp: character.hitPoints,
            flags: character.flags,
            removed: character.removedBoneMask >>> 0,
            vanished: character.vanishedBoneMask >>> 0,
            detached: character.instance?.detachedBoneMask >>> 0,
            bonedSlot: character.bonedSlot,
            action: state.action,
            move: character.moveId,
            hits: system.hits,
            count: system.count,
            root: character.instance
              ? Array.from(character.instance.rootPose)
              : Array.from(character.rootPose),
          });
          const before = snapshots(),
            setup = {
              candidateIndex,
              candidateCount: candidates.length,
              sourceCRTSeed: seed,
              speed: 6,
              sourceGoreLevel: globals.goreLevel,
              originalActor: owner.name,
              originalPersonality: character.personality,
              originalForm: character.formKey,
              nearestOtherCar: nearestOtherCar(character),
              sourceBonedCapacity: instance.template.form.maxBoned,
              sourceStoredCapacity: instance.template.form.maxStoredDismembered,
              sourceBoneDefinitions: instance.template.form.bones.map(
                (bone, index) => ({
                  index,
                  name: bone.name,
                  parent: bone.parent,
                  mass: bone.mass,
                  collisionType: bone.collisionType,
                }),
              ),
              headIndex: instance.template.form.headBone,
            };
          const launches = [],
            registrations = [],
            counts = [],
            populationCalls = [],
            damage = [],
            impacts = [];
          const registeredObjects = new Map(),
            detachedActors = new Map();
          const register = runtime.registerBone,
            commit = runtime.commitBone,
            count = bridge.gameplay.options.onOneLessPed,
            oneLess = system.oneLessNativePed,
            damageHook = runtime.hooks.onDamage;
          runtime.registerBone = function (key, request) {
            const result = register.call(this, key, request);
            if (key === owner) {
              const actual = result?.body;
              registrations.push({
                index: request.index,
                shape: actual?.shape?.type ?? null,
                sourceShape: request.bone.collisionType,
                mass: actual?.properties.mass,
                sourceMass: request.bone.mass,
                pose: Array.from(request.snapshot.nativePose),
                sameActor: actual?.actor === request.snapshot.actor,
                sameModel: actual?.model === request.snapshot.model,
                phil: actual ? c.simulation.phil.getState(actual) : 0,
                accepted: !!result,
              });
              if (actual) {
                registeredObjects.set(request.index, actual);
                detachedActors.set(request.index, actual.actor);
              }
            }
            return result;
          };
          runtime.commitBone = function (key, request, result) {
            const answer = commit.call(this, key, request, result);
            if (key === owner)
              launches.push({
                index: request.index,
                body: registeredObjects.get(request.index) === result.body,
                velocity: result.body.state.velocity.toArray(),
                omega: result.body.state.angularVelocity.toArray(),
                sourceVelocity: request.activation?.velocity ?? null,
                sourceLocalOmega: request.localOmega,
                phil: c.simulation.phil.getState(result.body),
                flags: result.body.rigidFlags,
              });
            return answer;
          };
          bridge.gameplay.options.onOneLessPed = (ctx, ...args) => {
            if (ctx.owner === owner)
              counts.push({ time: ctx.timeMs, flags: ctx.character.flags });
            return count(ctx, ...args);
          };
          system.oneLessNativePed = function (key, ...args) {
            const counted = oneLess.call(this, key, ...args);
            if (key === owner)
              populationCalls.push({
                counted,
                reason: args[2] ?? "killed",
                flags: character.flags,
                hp: character.hitPoints,
              });
            return counted;
          };
          runtime.hooks.onDamage = (ctx, result, phase) => {
            if (ctx.owner === owner) damage.push({ phase, result });
            return damageHook?.(ctx, result, phase);
          };
          const positionCar = () => {
            const direction =
                character.instance?.direction ?? character.direction,
              length = Math.hypot(direction[0], direction[2]) || 1,
              x = direction[0] / length,
              z = direction[2] / length;
            c.simulation.reset(car);
            car.state.position.set(
              body.state.position.x - x * 0.65,
              body.state.position.y,
              body.state.position.z - z * 0.65,
            );
            car.state.heading = Math.atan2(-x, -z);
            car.state.orientation.set(
              0,
              Math.sin(car.state.heading / 2),
              0,
              Math.cos(car.state.heading / 2),
            );
            car.state.velocity.set(x * 6, 0, z * 6);
            car.state.angularVelocity.set(0, 0, 0);
            car.state.speed = 6;
            car.input.throttle = 0;
            car.input.brake = 0;
            car.input.steer = 0;
            car.input.handbrake = false;
          };
          let first,
            repeated,
            offscreen = null;
          try {
            positionCar();
            for (let i = 0; i < 20; i++) {
              advanceOuter();
              if (i === 0) c.shards.options.seed(seed);
              c.simulation.updateFrame(now, 40);
              system.finishPhysics();
              steps++;
              for (const row of c.simulation.lastImpacts)
                if (row.a === body || row.b === body)
                  impacts.push({
                    phase: i,
                    carPair:
                      (row.a === body && row.b === car) ||
                      (row.b === body && row.a === car),
                    accepted: !!row.solverAccepted,
                    lambda: row.normalImpulse,
                    sourceType: row.sourceType,
                  });
              if (character.removedBoneMask) break;
            }
            first = snapshots();
            const firstObjects = [...registeredObjects.entries()].map(
              ([index, part]) => ({
                index,
                part,
                actor: part.actor,
                position: part.state.position.clone(),
                relativeToRoot: part.state.position
                  .clone()
                  .sub(body.state.position),
                pose: character.instance?.bones[index].pose.slice(),
                launches: launches.filter((event) => event.index === index)
                  .length,
              }),
            );
            positionCar();
            for (let i = 0; i < 8; i++) step();
            repeated = {
              ...snapshots(),
              originalParts: firstObjects.map(
                ({
                  index,
                  part,
                  actor,
                  position,
                  relativeToRoot,
                  pose,
                  launches: priorLaunches,
                }) => ({
                  index,
                  sameBody: registeredObjects.get(index) === part,
                  sameActor: part.actor === actor,
                  registered: c.simulation.phil.getState(part) > 0,
                  launchesBefore: priorLaunches,
                  launchesAfter: launches.filter(
                    (event) => event.index === index,
                  ).length,
                  position: part.state.position.toArray(),
                  moved: part.state.position.distanceTo(position) > 1e-6,
                  independentDelta: part.state.position
                    .clone()
                    .sub(body.state.position)
                    .distanceTo(relativeToRoot),
                  actorWorldError: part.actor
                    .getWorldPosition(part.state.position.clone())
                    .distanceTo(part.state.position),
                  storedTranslationError: part.poseTarget
                    ? Math.hypot(
                        part.poseTarget[9] - part.state.position.x,
                        part.poseTarget[10] - part.state.position.y,
                        part.poseTarget[11] - part.state.position.z,
                      )
                    : Infinity,
                  poseMoved: pose
                    ? Array.from(part.poseTarget ?? []).some(
                        (value, i) => Math.abs(value - pose[i]) > 1e-6,
                      )
                    : false,
                  separateFromRoot: part.actor !== body.actor,
                  shape: part.shape.type,
                }),
              ),
              targetCounts: counts.length,
            };
            if (!contactOnly && character.removedBoneMask) {
              // Move the controlled car back out of the corpse's lane, then give
              // the real falling body a bounded chance to land before scope exit.
              c.simulation.reset(car);
              car.state.position.copy(originalCarPose.position);
              if (car.state.position.distanceTo(body.state.position) < 2.5)
                car.state.position.x -= 5;
              car.state.orientation.copy(originalCarPose.orientation);
              car.state.heading = originalCarPose.heading;
              car.state.velocity.set(0, 0, 0);
              car.state.angularVelocity.set(0, 0, 0);
              car.input.handbrake = true;
              const settleStart = steps;
              while (
                steps < 60 &&
                character.instance?.physicsActive &&
                (!body.worldFaceNormals.some((normal) => normal.y > 0) ||
                  body.state.velocity.length() > 0.05)
              )
                step();
              repeated.settleSteps = steps - settleStart;
              repeated.afterSettle = {
                ...snapshots(),
                normals: body.worldFaceNormals.map((normal) =>
                  normal.toArray(),
                ),
                velocity: body.state.velocity.toArray(),
                phil: c.simulation.phil.getState(body),
              };
              const partsBefore = [...c.simulation.pedBoneBodies].filter(
                  (part) => part.owner === owner,
                ),
                partHeadersBefore = partsBefore.map((part) => ({
                  index: part.boneIndex,
                  state: c.simulation.phil.getState(part),
                })),
                savedPoses = new Map(
                  partsBefore.map((part) => [
                    part.boneIndex,
                    Array.from(character.instance.bones[part.boneIndex].pose),
                  ]),
                );
              const beforeStored = { ...runtime.storedPoses.stats };
              const beforeScope = snapshots(),
                expectedNewScopeCounts = runtime.characters.filter(
                  (row) =>
                    row.body &&
                    row.instance?.physicsActive &&
                    !(row.flags & 0x180),
                ).length,
                rootHeaderBefore = c.simulation.phil.getState(body),
                rootActiveBefore = character.instance.physicsActive,
                populationCallsBefore = populationCalls.length,
                launchesBefore = launches.length,
                releasedInstance = character.instance,
                settings = {
                  processDistance: system.settings.processDistance,
                  popupDistance: system.settings.popupDistance,
                  innerProcessDistance: Math.fround(
                    system.settings.processDistance * 0.6,
                  ),
                  innerPopupDistance: Math.fround(
                    system.settings.popupDistance * 0.6,
                  ),
                },
                near = [...character.position];
              // Controlled outer resource-scope clock exceeds the actual7500ms
              // recent-event grace; no physics steps or animation periods are invented.
              const scopeTime = now + 8001;
              runtime.prepareFrame({
                cameraOrigin: [100000, 100000, 100000],
                timeMs: scopeTime,
                settings,
                pedNearness: true,
              });
              system.finishPhysics();
              const allocation = runtime.storedPoses.owners.get(owner),
                storedRecord = allocation
                  ? runtime.storedPoses.forms.get(allocation.key)?.records[
                      allocation.slot
                    ]
                  : null;
              const sourceRecord = () => {
                const view = new DataView(
                  bridge.records.memory.buffer,
                  bridge.nativeAddress(owner),
                  0x54,
                );
                return {
                  hp: view.getInt8(4),
                  flags: view.getUint16(8, true),
                  action: view.getInt32(0x10, true),
                };
              };
              const released = {
                sourceRecord: sourceRecord(),
                rootACTDetached: releasedInstance.group.parent === null,
                partsACTDetached: partsBefore.every((part) => {
                  for (let actor = part.actor; actor; actor = actor.parent)
                    if (actor === system.group) return false;
                  return true;
                }),
                storedOwner:
                  storedRecord?.owner === owner &&
                  storedRecord?.storage[0] === 1,
                storedMatrices: [...savedPoses.entries()].map(
                  ([index, pose]) => ({
                    index,
                    error: storedRecord
                      ? Math.max(
                          ...pose.map((value, i) =>
                            Math.abs(
                              value - storedRecord.storage[index * 12 + i],
                            ),
                          ),
                        )
                      : Infinity,
                  }),
                ),
                body: character.body === null,
                instance: character.instance === null,
                bonedSlot: character.bonedSlot,
                oldPartsUnregistered: partsBefore.every(
                  (part) => c.simulation.phil.getState(part) === 0,
                ),
                oldRootUnregistered: c.simulation.phil.getState(body) === 0,
                storedPoses: { ...runtime.storedPoses.stats },
                diagnostics: [...character.diagnostics],
              };
              runtime.prepareFrame({
                cameraOrigin: near,
                timeMs: scopeTime + 40,
                settings,
                pedNearness: true,
              });
              system.finishPhysics();
              const restored = [...c.simulation.pedBoneBodies].filter(
                (part) => part.owner === owner,
              );
              offscreen = {
                scopeTime,
                expectedNewScopeCounts,
                rootHeaderBefore,
                rootActiveBefore,
                populationCalls: populationCalls.slice(populationCallsBefore),
                newLaunches: launches.length - launchesBefore,
                finalSourceRecord: sourceRecord(),
                partHeadersBefore,
                beforeStored,
                afterStored: { ...runtime.storedPoses.stats },
                before: beforeScope,
                released,
                after: snapshots(),
                sameCensus:
                  runtime.characters.length === census.length &&
                  runtime.characters.every((row, i) => row === census[i]),
                reacquired: !!character.body && !!character.instance,
                partCount: restored.length,
                sourceStoredOwner:
                  !!runtime.storedPoses &&
                  runtime.storedPoses.stats.capacity > 0,
                restoredMatrices: [...savedPoses.entries()].map(
                  ([index, pose]) => ({
                    index,
                    visible:
                      character.instance?.bones[index].actor.visible ?? null,
                    error: character.instance
                      ? Math.max(
                          ...Array.from(
                            character.instance.bones[index].pose,
                          ).map((value, i) => Math.abs(value - pose[i])),
                        )
                      : Infinity,
                  }),
                ),
                parts: restored.map((part) => ({
                  index: part.boneIndex,
                  owner: part.owner === owner,
                  phil: c.simulation.phil.getState(part),
                  shape: part.shape.type,
                  sourceMass:
                    character.instance.template.form.bones[part.boneIndex].mass,
                  mass: part.properties.mass,
                  poseError: Math.max(
                    ...Array.from(
                      character.instance.bones[part.boneIndex].pose,
                    ).map((value, i) =>
                      Math.abs(
                        value -
                          (savedPoses.get(part.boneIndex)?.[i] ?? Infinity),
                      ),
                    ),
                  ),
                })),
              };
            }
            const gl = c.renderer.getContext(),
              debug = gl.getExtension("WEBGL_debug_renderer_info");
            return {
              setup,
              before,
              first,
              repeated,
              offscreen,
              physicsSteps: steps,
              registrations,
              launches,
              counts,
              damage,
              impacts,
              final: snapshots(),
              diagnostics: [...character.diagnostics],
              bodyDiagnostics: [...body.diagnostics],
              headRemoved: !!(
                character.removedBoneMask &
                (1 << setup.headIndex)
              ),
              shapes: [
                ...new Set(
                  registrations
                    .filter((row) => row.accepted)
                    .map((row) => row.shape),
                ),
              ],
              sameOriginalOwner:
                system.renderActors.has(owner) &&
                system.group.children.includes(owner),
              simplePoolBounded:
                simpleResources.size === runtime.simpleResources.size &&
                [...runtime.simpleResources].every((part) =>
                  simpleResources.has(part),
                ),
              bonePoolBounded:
                boneResources.size === runtime.bonePool.resources.size &&
                [...runtime.bonePool.resources].every((part) =>
                  boneResources.has(part),
                ),
              bonePool: runtime.bonePool.counts(character.formKey),
              graphics: {
                renderer: debug
                  ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
                  : gl.getParameter(gl.RENDERER),
                buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
                error: gl.getError(),
              },
            };
          } finally {
            runtime.registerBone = register;
            runtime.commitBone = commit;
            bridge.gameplay.options.onOneLessPed = count;
            system.oneLessNativePed = oneLess;
            runtime.hooks.onDamage = damageHook;
          }
        },
        {
          seed: report.sourceCRTSeed,
          contactOnly: report.contactOnly,
          explicitFullGore: report.explicitFullGoreFrame,
          candidateIndex,
        },
      );
      attempts.push({
        candidateIndex,
        actor: result.setup.originalActor,
        personality: result.setup.originalPersonality,
        physicsSteps: result.physicsSteps,
        first: result.first,
        shapes: result.shapes,
        counts: result.counts,
        acceptedCarContacts: result.impacts.filter(
          (row) => row.carPair && row.accepted,
        ).length,
        diagnostics: result.diagnostics,
        bodyDiagnostics: result.bodyDiagnostics,
      });
      if (result.first.removed !== 0) break;
    }
    report.cases.push({ dataRoot, selection, attempts, ...result });
    console.log(
      `${dataRoot} sever: ${JSON.stringify({ actor: result.setup.originalActor, first: result.first, shapes: result.shapes, headRemoved: result.headRemoved, launches: result.launches.length, diagnostics: result.diagnostics, offscreen: result.offscreen })}`,
    );
    try {
      assert.ok(
        result.impacts.some((row) => row.carPair && row.accepted),
        `${dataRoot}: real car PHIL contact reaches the enrolled target`,
      );
      assert.ok(
        result.first.removed !== 0,
        `${dataRoot}: real contact severs authored bones`,
      );
      assert.equal(
        result.first.detached,
        result.first.removed,
        `${dataRoot}: actual physical detachment and native removed masks agree`,
      );
      assert.ok(
        result.registrations.some((row) => row.accepted),
        `${dataRoot}: severed parts acquire actual PHIL bodies`,
      );
      assert.ok(
        result.registrations
          .filter((row) => row.accepted)
          .every(
            (row) =>
              row.sameActor &&
              row.sameModel &&
              row.mass === row.sourceMass &&
              row.sourceShape === row.shape,
          ),
        `${dataRoot}: original ACT/MODEL mass and shape reach each part`,
      );
      assert.ok(
        result.repeated.originalParts.every(
          (row) =>
            row.sameBody &&
            row.sameActor &&
            row.registered &&
            row.launchesAfter === row.launchesBefore &&
            row.separateFromRoot &&
            row.moved &&
            row.poseMoved &&
            row.independentDelta > 1e-6 &&
            row.actorWorldError < 1e-4 &&
            row.storedTranslationError < 1e-4,
        ),
        `${dataRoot}: repeated corpse contact preserves existing independent bodies without a second launch`,
      );
      assert.equal(
        result.counts.length,
        1,
        `${dataRoot}: target population counts once`,
      );
      assert.equal(
        result.repeated.targetCounts,
        1,
        `${dataRoot}: repeat does not count target again`,
      );
      assert.equal(
        result.simplePoolBounded &&
          result.bonePoolBounded &&
          result.sameOriginalOwner,
        true,
        `${dataRoot}: source pool capacities and original population identity survive`,
      );
      assert.deepEqual(
        result.diagnostics,
        [],
        `${dataRoot}: no missing source owner`,
      );
      assert.deepEqual(
        result.bodyDiagnostics,
        [],
        `${dataRoot}: no missing physics owner`,
      );
      assert.equal(result.graphics.error, 0, `${dataRoot}: no WebGL error`);
      if (!report.contactOnly) {
        assert.ok(
          result.offscreen?.released.body &&
            result.offscreen.released.instance &&
            result.offscreen.released.oldPartsUnregistered &&
            result.offscreen.released.oldRootUnregistered,
          `${dataRoot}: offscreen cycle releases real ACT/PHIL resources`,
        );
        assert.ok(
          result.offscreen.sameCensus && result.offscreen.sourceStoredOwner,
          `${dataRoot}: scope exit retains original census and authored stored-pose owner`,
        );
        assert.ok(
          [1, 2].includes(result.offscreen.rootHeaderBefore),
          `${dataRoot}: actual source root header selects the scope branch`,
        );
        assert.equal(
          result.offscreen.rootActiveBefore,
          result.offscreen.rootHeaderBefore === 2,
          `${dataRoot}: instance active state agrees with actual source root header`,
        );
        assert.ok(
          result.offscreen.released.rootACTDetached &&
            result.offscreen.released.partsACTDetached,
          `${dataRoot}: root and detached part ACTs leave the scene on release`,
        );
        assert.equal(
          result.offscreen.newLaunches,
          0,
          `${dataRoot}: scope handling never launches a part again`,
        );
        const rootWasActive = result.offscreen.rootHeaderBefore === 2;
        // Native Munge4d5369 sets80 on active whole owners.408400 still saves
        // removed matrices; no subsequent near visit may revive that owner.
        assert.equal(
          result.offscreen.reacquired,
          !rootWasActive,
          `${dataRoot}: actual root header controls source vanish versus passive reacquisition`,
        );
        assert.equal(
          !!(result.offscreen.after.flags & 0x80),
          rootWasActive,
          `${dataRoot}: whole-owner source vanish80 follows the actual root header`,
        );
        assert.equal(
          result.offscreen.populationCalls.length,
          rootWasActive ? 1 : 0,
          `${dataRoot}: active scope exit invokes OneLess once, passive release does not`,
        );
        assert.equal(
          result.offscreen.populationCalls.filter((row) => row.counted).length,
          0,
          `${dataRoot}: already-counted corpse never increments the population again`,
        );
        assert.equal(
          result.offscreen.after.hits,
          result.offscreen.before.hits +
            result.offscreen.expectedNewScopeCounts,
          `${dataRoot}: only other previously uncounted active owners change the global scope count`,
        );
        assert.deepEqual(
          result.offscreen.finalSourceRecord,
          {
            hp: result.offscreen.after.hp,
            flags: result.offscreen.after.flags & 0xffff,
            action: result.offscreen.after.action,
          },
          `${dataRoot}: final source record bytes retain actual HP/flags/action`,
        );
        assert.ok(
          result.offscreen.released.storedOwner &&
            result.offscreen.released.storedMatrices.every(
              (row) => row.error < 1e-4,
            ),
          `${dataRoot}: actual bounded stored record owns the original removed matrices`,
        );
        assert.equal(
          result.offscreen.released.storedPoses.occupied,
          result.offscreen.beforeStored.occupied + 1,
          `${dataRoot}: source408400 allocates one bounded dismembered pose record`,
        );
        assert.equal(
          result.offscreen.afterStored.occupied,
          result.offscreen.beforeStored.occupied + (rootWasActive ? 1 : 0),
          `${dataRoot}: vanished owner keeps its stored slot until race reset; passive restore releases it`,
        );
        assert.equal(
          result.offscreen.after.removed,
          result.offscreen.before.removed,
          `${dataRoot}: removed mask survives resource cycle`,
        );
        assert.equal(
          result.offscreen.afterStored.capacity,
          result.offscreen.beforeStored.capacity,
          `${dataRoot}: stored-pose capacity remains the authored bounded allocation`,
        );
        assert.equal(
          result.offscreen.afterStored.bytes,
          result.offscreen.beforeStored.bytes,
          `${dataRoot}: stored-pose backing storage never grows during scope cycling`,
        );
        const expectedVanished =
          result.offscreen.partHeadersBefore.reduce(
            (mask, part) =>
              part.state === 2 ? mask | (1 << part.index) : mask,
            result.offscreen.before.vanished,
          ) >>> 0;
        assert.equal(
          result.offscreen.after.vanished,
          expectedVanished,
          `${dataRoot}: source header2 parts become vanished before scope removal`,
        );
        const expectedSurvivors = result.offscreen.partHeadersBefore.filter(
          (part) =>
            result.offscreen.before.removed & (1 << part.index) &&
            !(expectedVanished & (1 << part.index)),
        );
        assert.equal(
          result.offscreen.parts.length,
          rootWasActive ? 0 : expectedSurvivors.length,
          `${dataRoot}: vanished whole owners reacquire no parts; passive owners restore only nonvanished parts`,
        );
        if (!rootWasActive)
          assert.ok(
            result.offscreen.restoredMatrices.every(
              (part) =>
                part.error < 1e-4 &&
                part.visible === !(expectedVanished & (1 << part.index)),
            ),
            `${dataRoot}: actual bounded stored matrices restore with source vanished visibility`,
          );
        assert.ok(
          result.offscreen.parts.every(
            (part) =>
              part.owner &&
              part.phil > 0 &&
              part.mass === part.sourceMass &&
              part.poseError < 1e-4,
          ),
          `${dataRoot}: nonvanished part poses/mass restore through actual bounded owners`,
        );
      }
    } catch (error) {
      (report.validationFailures ??= []).push({
        dataRoot,
        failure: String(error?.stack ?? error),
      });
    }
    await page.screenshot({
      path: `artifacts/browser-ped-sever-population-${dataRoot}.png`,
    });
    if (!report.contactOnly) {
      await page.evaluate(() => {
        const c = window.carma,
          r = c.pedestrians.nativeRuntime;
        window.__pedSeverOld = {
          runtime: r,
          simulation: c.simulation,
          scene: c.scene,
          roots: r.characters.map((row) => row.body).filter(Boolean),
          parts: [...c.simulation.pedBoneBodies],
          actors: r.characters
            .map((row) => row.instance?.group)
            .filter(Boolean),
          partActors: c.simulation.pedBoneBodies.map((body) => body.actor),
        };
      });
      await page.evaluate(async () => {
        await window.carma.loadRace();
        window.carma.paused = true;
      });
      await page.waitForFunction(
        () => window.carma.populationLoadState?.pedestrians?.state === "ready",
        null,
        { timeout: 90000 },
      );
      const reset = await page.evaluate(() => {
        const old = window.__pedSeverOld,
          c = window.carma;
        return {
          oldCharacters: old.runtime.characters.length,
          oldRegistered: [...old.roots, ...old.parts].filter(
            (body) => old.simulation.phil.getState(body) !== 0,
          ).length,
          oldActorsAttached: old.actors.filter((actor) => actor.parent).length,
          oldPartsInScene: old.partActors.filter((actor) => {
            for (let node = actor; node; node = node.parent)
              if (node === old.scene) return true;
            return false;
          }).length,
          oldStoredOccupied: old.runtime.storedPoses.stats.occupied,
          freshRuntime: c.pedestrians.nativeRuntime !== old.runtime,
          freshPopulation: c.pedestrians.count,
        };
      });
      report.cases.at(-1).reset = reset;
      assert.equal(
        reset.oldCharacters,
        0,
        `${dataRoot}: reset clears old native census`,
      );
      assert.equal(
        reset.oldRegistered,
        0,
        `${dataRoot}: reset leaves no old PHIL root/part`,
      );
      assert.equal(
        reset.oldActorsAttached,
        0,
        `${dataRoot}: reset detaches old render ACT groups`,
      );
      assert.equal(
        reset.oldPartsInScene,
        0,
        `${dataRoot}: reset leaves no detached ACT in the scene`,
      );
      assert.equal(
        reset.oldStoredOccupied,
        0,
        `${dataRoot}: reset clears bounded stored-pose owners`,
      );
      assert.ok(
        reset.freshRuntime && reset.freshPopulation > 0,
        `${dataRoot}: reset loads fresh original population`,
      );
    }
  }
  assert.ok(
    report.cases.some(
      (row) => row.shapes.includes("SPHERE") && row.headRemoved,
    ),
    "Real population impacts detach an authored head SPHERE",
  );
  assert.ok(
    report.cases.some((row) => row.shapes.includes("BOX")),
    "Real population impacts detach authored limb/subtree BOX bodies",
  );
  assert.deepEqual(report.validationFailures ?? [], []);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.failedRequests, []);
  assert.deepEqual(report.badResponses, []);
} catch (error) {
  report.failure = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await writeFile(
    "artifacts/browser-ped-sever-population.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  server.kill("SIGTERM");
}
console.log(
  JSON.stringify(
    {
      artifact: "artifacts/browser-ped-sever-population.json",
      cases: report.cases.map((row) => ({
        dataRoot: row.dataRoot,
        actor: row.setup.originalActor,
        headRemoved: row.headRemoved,
        shapes: row.shapes,
        first: row.first,
        offscreen: row.offscreen,
        reset: row.reset,
      })),
      failure: report.failure,
      validationFailures: report.validationFailures,
      errors: report.errors,
      failedRequests: report.failedRequests,
    },
    null,
    2,
  ),
);
