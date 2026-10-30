import assert from "node:assert/strict";
import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const executable = process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  assetRoot = process.env.CARMA2_ROOT || "carma2_orig";
try {
  await access(executable);
  await access(assetRoot);
} catch {
  console.log(
    "SKIP exceptional pedestrian contacts: Chromium or C2 assets absent",
  );
  process.exit(0);
}
await mkdir("artifacts", { recursive: true });
const port = Number(process.env.PED_EXCEPTIONAL_PORT || 5276),
  server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
    env: { ...process.env, CARMA2_ROOT: assetRoot, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
let serverLog = "",
  browser;
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
const report = {
  mode: "Existing authored DOG1 population; actual PHIL car contacts and ordinary timed powerup4 grant; no spawned ped or HP/mask/kill injection",
  sourceCRTSeed: Number(process.env.PED_EXCEPTIONAL_SEED || 24),
  maximumCandidatesPerCase: 3,
  maximumPhysicsFramesPerCase: 60,
  maximumPhysicsFramesPerAttempt: 20,
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
    report.errors.push(String(error.stack ?? error)),
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

  const trees = process.env.PED_EXCEPTIONAL_TREE
    ? [process.env.PED_EXCEPTIONAL_TREE]
    : ["data", "adv_data"];
  for (const dataRoot of trees)
    for (const exploding of [false, true]) {
      const attempts = [];
      let result;
      for (let candidateIndex = 0; candidateIndex < 3; candidateIndex++) {
        const selection = await page.evaluate(async (root) => {
          const trackSelect = document.querySelector("#track-select"),
            carSelect = document.querySelector("#car-select"),
            expected =
              root === "data"
                ? "data/races/junkyard/junkyard.txt"
                : "adv_data/races/junkyard2/junkyard2.txt",
            track = [...trackSelect.options].find(
              (option) => option.value.toLowerCase() === expected,
            )?.value,
            car = [...carSelect.options].find(
              (option) =>
                option.value.toLowerCase() === "data/cars/eagle3/eagle3.txt",
            )?.value;
          if (!track || !car)
            throw new Error(`Missing source Junkyard/Eagle3: ${root}`);
          trackSelect.value = track;
          carSelect.value = car;
          await window.carma.loadRace();
          window.carma.paused = true;
          document.querySelector("#panel").hidden = true;
          return { track, car };
        }, dataRoot);
        await page.waitForFunction(
          () =>
            window.carma?.populationLoadState?.pedestrians?.state === "ready",
          null,
          { timeout: 90000 },
        );
        result = await page.evaluate(
          ({ candidateIndex, seed, exploding, selection }) => {
            const c = window.carma,
              system = c.pedestrians,
              runtime = system.nativeRuntime,
              bridge = system.nativeBridge,
              car = c.player;
            if (!runtime || !bridge || !c.shards?.options?.seed || !c.powerups)
              throw new Error(
                "Missing production population, shared CRT or powerup owner",
              );
            const positionOf = (row) =>
                car.state.position
                  .clone()
                  .fromArray(
                    Array.from(
                      row.body
                        ? row.body.state.position.toArray()
                        : row.rootPose.slice(9, 12),
                    ),
                  ),
              nearestOtherCar = (row) =>
                Math.min(
                  ...c.simulation.cars
                    .filter((other) => other !== car)
                    .map((other) =>
                      positionOf(row).distanceTo(other.state.position),
                    ),
                ),
              candidates = runtime.characters
                .filter(
                  (row) =>
                    row.formKey === "DOG1" &&
                    row.hitPoints > 0 &&
                    !row.removedBoneMask,
                )
                .sort((a, b) => nearestOtherCar(b) - nearestOtherCar(a))
                .slice(0, 3),
              character = candidates[candidateIndex];
            if (!character)
              return {
                unavailable: true,
                candidateIndex,
                candidateCount: candidates.length,
                forms: [
                  ...new Set(runtime.characters.map((row) => row.formKey)),
                ],
              };
            const owner = character.owner,
              logicalPosition = positionOf(character),
              initialOwnerCount = runtime.characters.length,
              camera = logicalPosition.clone(),
              admission = {
                cameraBefore: c.camera.position.toArray(),
                cameraTarget: camera.toArray(),
                cameraJumpDistance: c.camera.position.distanceTo(camera),
                initialFlags: character.flags,
                initialPosition: Array.from(character.position),
                visits: [],
              };
            // Main camera calculation notifies this owner after a camera jump;
            // the next ordinary update consumes that one-frame nearness override.
            // Establish the real current camera before notifying our controlled
            // view change. No population flags or nearness fields are assigned.
            system.noteCameraPosition(c.camera.position);
            system.noteCameraPosition(camera);
            let now = Math.max(0, Math.trunc(c.stats.gameTimeMs)),
              frames = 0;
            const outer = () => {
              now += 40;
              if (character.body) camera.copy(character.body.state.position);
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
                  explosivePedestrians: c.powerups.explosivePedestrians,
                  pedestrianAnimation: c.powerups.pedestrianAnimationState,
                },
              );
              system.noteCameraPosition(camera);
              if (admission.visits.length < 3)
                admission.visits.push({
                  flags: character.flags,
                  physicsFlags: character.physicsFlags,
                  admittedBody: !!character.body,
                  admittedInstance: !!character.instance,
                  rendered: system.renderActors.has(owner),
                  lifecycle: { ...system.nativeLifecycle },
                  diagnostics: [...character.diagnostics],
                });
            };
            // Admission and source flag40 come from normal camera/process visits.
            outer();
            outer();
            if (!character.body || !character.instance)
              return {
                unavailable: true,
                candidateIndex,
                candidateCount: candidates.length,
                actor: owner.name,
                diagnostics: [...character.diagnostics],
                reason: "normal camera admission",
                admission,
              };
            const body = character.body,
              instance = character.instance,
              state = bridge.gameplay.state(owner),
              globalsBefore = bridge.gameplay.options.readGlobals(),
              initialDiagnostics = [...character.diagnostics];
            if (!(character.flags & 0x40))
              throw new Error("Two source visits did not arm contact flag40");
            if (globalsBefore.goreLevel !== 2)
              throw new Error(
                `Expected original OPTIONS full gore2, got${globalsBefore.goreLevel}`,
              );
            if (!instance.template.form.nonHumanoid)
              throw new Error("DOG1 lost its original nonhumanoid FORM flag");
            const definition = c.powerups.definitions[4],
              powerupEvents = [];
            if (
              definition?.action !== 3 ||
              definition.duration !== 30 ||
              definition.floatParams.length ||
              definition.integerParams.length
            )
              throw new Error(
                "Original Explosive Pedestrians record4 differs from inspected source",
              );
            if (c.powerups.explosivePedestrians)
              throw new Error("Exploding global must start clear");
            c.powerups.resetPath(car.state.position);
            c.powerups.beginFrame(0.04, c.vehicle, c.race, undefined, now);
            c.powerups.finishFrame();
            const grantTime = now;
            if (
              exploding &&
              !c.powerups.grant(4, c.vehicle, c.race, (event) =>
                powerupEvents.push({
                  kind: event.kind,
                  index: event.definition.index,
                }),
              )
            )
              throw new Error("Normal powerup4 grant failed");
            outer();
            const globals = bridge.gameplay.options.readGlobals();
            if (globals.exploding !== exploding)
              throw new Error(
                "Production frame did not propagate actual powerup state",
              );
            const snapshots = () => ({
              hp: character.hitPoints,
              flags: character.flags,
              action: state.action,
              removed: character.removedBoneMask >>> 0,
              detached: character.instance?.detachedBoneMask >>> 0,
              hits: system.hits,
              count: system.count,
              position: body.state.position.toArray(),
              impactCount: character.impactCount,
            });
            const before = snapshots(),
              registrations = [],
              launches = [],
              counts = [],
              impacts = [],
              damage = [],
              registered = new Map(),
              originalRegister = runtime.registerBone,
              originalCommit = runtime.commitBone,
              originalCount = system.options.onCount,
              originalDamage = runtime.hooks.onDamage,
              resourceSet = new Set(runtime.bonePool.resources);
            runtime.registerBone = function (key, request) {
              const answer = originalRegister.call(this, key, request);
              if (key === owner) {
                registrations.push({
                  index: request.index,
                  accepted: !!answer,
                  sourceShape: request.bone.collisionType,
                  shape: answer?.body.shape.type,
                  sourceMass: request.bone.mass,
                  mass: answer?.body.properties.mass,
                  sameActor: answer?.body.actor === request.snapshot.actor,
                  sameModel: answer?.body.model === request.snapshot.model,
                });
                if (answer) registered.set(request.index, answer.body);
              }
              return answer;
            };
            runtime.commitBone = function (key, request, answer) {
              const returned = originalCommit.call(this, key, request, answer);
              if (key === owner)
                launches.push({
                  index: request.index,
                  sourceVelocity: request.activation?.velocity ?? null,
                  velocity: answer.body.state.velocity.toArray(),
                  sourceLocalOmega: request.localOmega,
                  localOmega: answer.body.localOmega.toArray(),
                  characterVelocity: Array.from(
                    instance.nativeCharacterVelocity,
                  ),
                  phil: c.simulation.phil.getState(answer.body),
                  rigidType: answer.body.rigidType,
                });
              return returned;
            };
            system.options.onCount = (event) => {
              if (event.actor === owner)
                counts.push({ source: event.source, timeMs: event.timeMs });
              return originalCount?.(event);
            };
            runtime.hooks.onDamage = (ctx, result, phase) => {
              if (ctx.owner === owner)
                damage.push({
                  phase,
                  eligible: result.eligible,
                  rawDamage: result.rawDamage,
                  damage: result.damage,
                  hitPoints: result.hitPoints,
                  unresolved: result.unresolved ?? [],
                });
              return originalDamage?.(ctx, result, phase);
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
              Object.assign(car.input, {
                throttle: 0,
                brake: 0,
                steer: 0,
                handbrake: false,
              });
            };
            const step = () => {
              if (frames >= 20)
                throw new Error(
                  "Exceptional attempt exceeded20 physics frames",
                );
              c.powerups.resetPath(car.state.position);
              c.powerups.beginFrame(
                0.04,
                c.vehicle,
                c.race,
                undefined,
                now + 40,
              );
              outer();
              c.simulation.updateFrame(now, 40);
              system.finishPhysics();
              c.powerups.finishFrame();
              frames++;
              for (const row of c.simulation.lastImpacts)
                if (
                  (row.a === body && row.b === car) ||
                  (row.b === body && row.a === car)
                )
                  impacts.push({
                    frame: frames,
                    accepted: !!row.solverAccepted,
                    lambda: row.normalImpulse,
                    sourceType: row.sourceType,
                  });
            };
            try {
              positionCar();
              c.shards.options.seed(seed);
              for (let i = 0; i < 12; i++) {
                step();
                if (character.hitPoints <= 0 && character.removedBoneMask)
                  break;
              }
              const first = snapshots(),
                firstCounts = counts.length,
                originalParts = [...registered.entries()].map(
                  ([index, part]) => ({
                    index,
                    part,
                    actor: part.actor,
                    position: part.state.position.clone(),
                    relative: part.state.position
                      .clone()
                      .sub(body.state.position),
                    launches: launches.filter((event) => event.index === index)
                      .length,
                  }),
                );
              positionCar();
              for (let i = 0; i < 8; i++) step();
              const repeated = {
                ...snapshots(),
                counts: counts.length,
                parts: originalParts.map(
                  ({
                    index,
                    part,
                    actor,
                    position,
                    relative,
                    launches: priorLaunches,
                  }) => ({
                    index,
                    shape: part.shape.type,
                    sameBody: registered.get(index) === part,
                    sameActor: part.actor === actor,
                    registered: c.simulation.phil.getState(part) > 0,
                    separateFromRoot: part.actor !== body.actor,
                    priorLaunches,
                    launches: launches.filter((event) => event.index === index)
                      .length,
                    moved: part.state.position.distanceTo(position),
                    independentDelta: part.state.position
                      .clone()
                      .sub(body.state.position)
                      .distanceTo(relative),
                    actorError: part.actor
                      .getWorldPosition(part.state.position.clone())
                      .distanceTo(part.state.position),
                    storedTranslationError: part.poseTarget
                      ? Math.hypot(
                          part.poseTarget[9] - part.state.position.x,
                          part.poseTarget[10] - part.state.position.y,
                          part.poseTarget[11] - part.state.position.z,
                        )
                      : null,
                  }),
                ),
              };
              const cameraView = c.camera.clone(),
                target = body.state.position.clone();
              cameraView.near = 0.02;
              cameraView.fov = 60;
              cameraView.updateProjectionMatrix();
              cameraView.position
                .copy(target)
                .add(target.clone().set(1.1, 0.7, 1.2));
              cameraView.lookAt(target);
              cameraView.updateMatrixWorld(true);
              c.prepareRenderMatrices(true);
              c.renderer.render(c.scene, cameraView);
              const image = c.renderer.domElement.toDataURL("image/png"),
                gl = c.renderer.getContext(),
                extension = gl.getExtension("WEBGL_debug_renderer_info");
              let expiry = null;
              if (exploding) {
                const frozen = c.powerups.definitions.find(
                  (row) => row.action === 8,
                );
                if (
                  !frozen ||
                  !c.powerups.grant(frozen.index, c.vehicle, c.race)
                )
                  throw new Error("Source frozen-timer grant unavailable");
                const expiryTime = grantTime + definition.duration * 1000 + 1;
                c.powerups.resetPath(car.state.position);
                const during = c.powerups.beginFrame(
                  0.04,
                  c.vehicle,
                  c.race,
                  undefined,
                  expiryTime,
                );
                const beforeFinish = c.powerups.explosivePedestrians;
                const after = c.powerups.finishFrame();
                expiry = {
                  beforeFinish,
                  after: c.powerups.explosivePedestrians,
                  timerFrozenDuring: during.timerFrozen,
                  timerFrozenAfter: after.timerFrozen,
                  active4: c.powerups
                    .activeEffectsFor(c.vehicle)
                    .some((effect) => effect.index === 4),
                  expiryTime,
                  countUnchanged: counts.length === firstCounts,
                };
              }
              return {
                selection,
                admission,
                candidateIndex,
                candidateCount: candidates.length,
                actor: owner.name,
                personality: character.personality,
                form: character.formKey,
                sourceNonHumanoid: instance.template.form.nonHumanoid,
                sourceGore: globals.goreLevel,
                exploding: globals.exploding,
                logicalPosition: logicalPosition.toArray(),
                nearestOtherCar: nearestOtherCar(character),
                sourceSeverThreshold:
                  bridge.gameplay.options.settings.severDamage,
                sourceBoneCount: instance.template.form.bones.length,
                sourceBones: instance.template.form.bones.map(
                  (bone, index) => ({
                    index,
                    parent: bone.parent,
                    shape: bone.collisionType,
                    mass: bone.mass,
                  }),
                ),
                before,
                first,
                firstCounts,
                repeated,
                registrations,
                launches,
                impacts,
                damage,
                counts,
                frames,
                powerupEvents,
                expiry,
                sourcePoolBounded:
                  runtime.bonePool.resources.size === resourceSet.size &&
                  [...runtime.bonePool.resources].every((part) =>
                    resourceSet.has(part),
                  ),
                originalOwnerPreserved:
                  runtime.characters.length === initialOwnerCount &&
                  runtime.characters.includes(character) &&
                  system.renderActors.has(owner),
                // Admission can expose the original unchecked negative-group
                // lookup documented in ped07-production-integration.md. Keep
                // that evidence separate from failures introduced by contact.
                initialDiagnostics,
                newDiagnostics: [...character.diagnostics].filter(
                  (entry) => !initialDiagnostics.includes(entry),
                ),
                diagnostics: [...character.diagnostics],
                bodyDiagnostics: [...body.diagnostics],
                graphics: {
                  renderer: extension
                    ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
                    : gl.getParameter(gl.RENDERER),
                  buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
                  error: gl.getError(),
                  contextLost: gl.isContextLost(),
                },
                image,
              };
            } finally {
              runtime.registerBone = originalRegister;
              runtime.commitBone = originalCommit;
              system.options.onCount = originalCount;
              runtime.hooks.onDamage = originalDamage;
            }
          },
          { candidateIndex, seed: report.sourceCRTSeed, exploding, selection },
        );
        const { image, ...evidence } = result;
        attempts.push(evidence);
        if (image)
          await writeFile(
            `artifacts/ped-exceptional-${dataRoot}-${exploding ? "exploding" : "normal"}-${candidateIndex}.png`,
            Buffer.from(image.split(",")[1], "base64"),
          );
        if (
          !result.unavailable &&
          result.first.removed &&
          result.first.hp <= 0 &&
          result.impacts.some((row) => row.accepted)
        )
          break;
      }
      const { image, ...evidence } = result;
      report.cases.push({ dataRoot, exploding, attempts, ...evidence });
      assert.ok(
        attempts.reduce((sum, row) => sum + (row.frames ?? 0), 0) <= 60,
        `${dataRoot}: case stays within60 physical frames across at most3 owners`,
      );
      const label = `${dataRoot}/${exploding ? "exploding" : "normal"}DOG1`;
      console.log(
        `${label}: ${JSON.stringify({ actor: result.actor, first: result.first, shapes: result.registrations?.filter((row) => row.accepted).map((row) => row.shape), frames: result.frames, initialDiagnostics: result.initialDiagnostics, newDiagnostics: result.newDiagnostics, diagnostics: result.diagnostics })}`,
      );
      assert.ok(
        !result.unavailable,
        `${label}: real source owner admitted by camera visits`,
      );
      assert.ok(
        result.impacts.some((row) => row.accepted),
        `${label}: actual car PHIL contact`,
      );
      assert.ok(
        result.first.hp <= 0 && result.first.removed,
        `${label}: contact damage kills and severs`,
      );
      assert.equal(
        result.first.removed,
        result.first.detached,
        `${label}: removed and physical detached masks agree`,
      );
      assert.equal(result.firstCounts, 1, `${label}: initial kill counts once`);
      assert.equal(
        result.repeated.counts,
        1,
        `${label}: repeat contact preserves one count`,
      );
      const accepted = result.registrations.filter((row) => row.accepted);
      assert.ok(
        accepted.length &&
          accepted.every(
            (row) =>
              row.shape === row.sourceShape &&
              row.mass === row.sourceMass &&
              row.sameActor &&
              row.sameModel,
          ),
        `${label}: actual source body/model/shape/mass`,
      );
      assert.ok(
        result.repeated.parts.length &&
          result.repeated.parts.every(
            (row) =>
              row.sameBody &&
              row.sameActor &&
              row.registered &&
              row.separateFromRoot &&
              row.priorLaunches === row.launches &&
              row.moved > 1e-6 &&
              row.independentDelta > 1e-6 &&
              row.actorError < 1e-4 &&
              row.storedTranslationError !== null &&
              row.storedTranslationError < 1e-4,
          ),
        `${label}: existing physical parts move independently and retain identity on repeat`,
      );
      assert.ok(
        result.launches.every(
          (row) =>
            row.rigidType === 5 &&
            row.sourceVelocity &&
            row.sourceVelocity.every(
              (value, axis) => Math.abs(value - row.velocity[axis]) < 1e-6,
            ) &&
            row.sourceLocalOmega.every(
              (value, axis) => Math.abs(value - row.localOmega[axis]) < 1e-6,
            ),
        ),
        `${label}: source launch packets reach committed physical bodies`,
      );
      assert.equal(
        result.sourcePoolBounded && result.originalOwnerPreserved,
        true,
        `${label}: finite resources and original population identity`,
      );
      assert.deepEqual(
        result.initialDiagnostics.filter(
          (entry) =>
            entry !==
            "source-proximity-unchecked-negative-prepared-group-storage",
        ),
        [],
        `${label}: admission baseline contains only the documented source proximity lookup limitation`,
      );
      assert.deepEqual(
        result.newDiagnostics,
        [],
        `${label}: contacts introduce no source provider failures`,
      );
      assert.deepEqual(
        result.bodyDiagnostics,
        [],
        `${label}: no missing physical providers`,
      );
      assert.ok(
        result.damage.every((row) => row.unresolved.length === 0),
        `${label}: actual contact damage has no unresolved providers`,
      );
      assert.ok(
        result.damage.some((row) => row.eligible && row.damage > 0),
        `${label}: actual nonhumanoid severity reaches HP tail`,
      );
      assert.ok(result.frames <= 60, `${label}: bounded physical work`);
      assert.equal(
        result.graphics.contextLost,
        false,
        `${label}: WebGL context remains live`,
      );
      assert.equal(result.graphics.error, 0, `${label}: no WebGL error`);
      if (exploding) {
        assert.ok(
          result.powerupEvents.some(
            (event) => event.index === 4 && event.kind === "effect",
          ),
          `${label}: ordinary effect grant`,
        );
        assert.ok(
          result.damage.some(
            (row) =>
              row.eligible &&
              row.rawDamage ===
                result.sourceSeverThreshold *
                  (row.phase === "passive" ? 5 : result.sourceBoneCount),
          ),
          `${label}: original exploding raw-damage branch`,
        );
        assert.ok(
          result.launches.some((row) =>
            row.sourceLocalOmega.some((value) => Math.abs(value) > 1),
          ),
          `${label}: original exploding spin range is exercised`,
        );
        assert.ok(
          result.launches.every((row) =>
            row.sourceLocalOmega.every((value) => value >= -20 && value < 20),
          ),
          `${label}: original exploding spin bounds`,
        );
        assert.equal(
          result.expiry.beforeFinish,
          true,
          `${label}: effect retained through physics window`,
        );
        assert.equal(
          result.expiry.after,
          false,
          `${label}: real timed expiry resets global`,
        );
        assert.equal(
          result.expiry.active4,
          false,
          `${label}: timed record expires`,
        );
        assert.equal(
          result.expiry.timerFrozenDuring && result.expiry.timerFrozenAfter,
          true,
          `${label}: timer freezing preserves ordinary effect expiry`,
        );
        assert.equal(
          result.expiry.countUnchanged,
          true,
          `${label}: expiry does not recount pedestrian`,
        );
      } else
        assert.ok(
          result.launches.every((row) =>
            row.sourceLocalOmega.every((value) => value >= -1 && value < 1),
          ),
          `${label}: ordinary spin range`,
        );
    }
  for (const dataRoot of trees) {
    const cases = report.cases.filter((row) => row.dataRoot === dataRoot),
      shapes = new Set(
        cases.flatMap((row) =>
          row.registrations
            .filter((entry) => entry.accepted)
            .map((entry) => entry.shape),
        ),
      );
    assert.ok(
      shapes.has("BOX") && shapes.has("SPHERE"),
      `${dataRoot}: actual DOG1 BOX and SPHERE parts covered`,
    );
  }
  assert.deepEqual(report.errors, [], "no fatal JavaScript/console errors");
  assert.deepEqual(report.failedRequests, [], "no failed asset requests");
  assert.deepEqual(report.badResponses, [], "no HTTP asset errors");
  console.log("PASS bounded original DOG1 and Explosive Pedestrians contacts");
} finally {
  await writeFile(
    "artifacts/ped-exceptional-browser.json",
    JSON.stringify(report, null, 2),
  );
  await browser?.close();
  server.kill("SIGTERM");
}
