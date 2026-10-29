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
    "SKIP pedestrian animation completion browser test: Chromium or C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5445;
const server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
let browser;
const report = {
  mode: "full original population BON/SKL death, render-effect powerups, reset and shared-RNG mutant animation integration",
  backend: "headless Chromium SwiftShader",
  cases: [],
  errors: [],
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
  assert.ok(ready, `production asset server did not start: ${serverLog}`);
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
  page.on("pageerror", (error) =>
    report.errors.push({ type: "pageerror", message: String(error) }),
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      report.errors.push({ type: "console", message: message.text() });
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
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });

  const catalog = await page.evaluate(() => {
    const tracks = [...document.querySelector("#track-select").options];
    const cars = [...document.querySelector("#car-select").options];
    return {
      tracks: Object.fromEntries(
        ["data", "adv_data"].map((root) => [
          root,
          tracks.find(
            (option) =>
              option.value.toLowerCase().startsWith(`${root}/`) &&
              /newcity1/i.test(`${option.value} ${option.textContent}`),
          )?.value,
        ]),
      ),
      eagle: cars.find(
        (option) =>
          option.value.toLowerCase().startsWith("data/") &&
          /eagle3/i.test(`${option.value} ${option.textContent}`),
      )?.value,
    };
  });
  assert.ok(catalog.eagle, "original Eagle3 selection should be available");

  for (const dataRoot of ["data", "adv_data"]) {
    const track = catalog.tracks[dataRoot];
    assert.ok(track, `${dataRoot} Newcity1 should be available`);
    await page.evaluate(
      async ({ track, eagle }) => {
        const c = window.carma;
        document.querySelector("#track-select").value = track;
        document.querySelector("#car-select").value = eagle;
        await c.loadRace();
        c.paused = true;
        document.querySelector("#panel").hidden = true;
      },
      { track, eagle: catalog.eagle },
    );
    await page.waitForFunction(
      () =>
        window.carma?.paused &&
        window.carma?.opponentsReady &&
        window.carma?.pedestrians?.count === 791,
      null,
      { timeout: 90000 },
    );

    // Capture a real source body-size grant in the loaded scene. Reset the
    // population afterward so the main death audit starts from canonical pose.
    const bodyCapture = await page.evaluate(() => {
      const c = window.carma,
        peds = c.pedestrians,
        city = peds.peds
          .filter(
            (ped) => ped.presentation && /cityswat/i.test(ped.object.name),
          )
          .sort(
            (a, b) =>
              a.object.position.distanceTo(c.player.state.position) -
              b.object.position.distanceTo(c.player.state.position),
          )[0],
        bodyIndex = c.powerups.definitions.findIndex(
          (definition) => definition.action === 2,
        ),
        cancelIndex = c.powerups.definitions.findIndex(
          (definition) => definition.action === 51,
        );
      if (!city || bodyIndex < 0 || cancelIndex < 0)
        throw new Error(
          "Source body-size grant or CitySwat actor is unavailable",
        );
      const far = city.object.position
        .clone()
        .add(new city.object.position.constructor(100, 0, 100));
      peds.resetCar(far);
      c.powerups.grant(bodyIndex, c.vehicle, c.race);
      peds.update(
        0,
        { position: far, yaw: 0, speed: 0 },
        {
          cameraPosition: city.object.position.clone(),
          gameTimeMs: 1000,
          pedestrianAnimation: c.powerups.pedestrianAnimationState,
        },
      );
      c.camera.position
        .copy(city.object.position)
        .add(new city.object.position.constructor(0.65, 0.5, 0.85));
      window.__aniOriginalLookAt ??= c.camera.lookAt.bind(c.camera);
      c.camera.lookAt = () =>
        window.__aniOriginalLookAt(
          city.object.position
            .clone()
            .add(new city.object.position.constructor(0, 0.22, 0)),
        );
      c.camera.lookAt(city.object.position);
      c.camera.updateMatrixWorld(true);
      document.querySelector("#panel").hidden = true;
      return {
        name: city.object.name,
        state: c.powerups.pedestrianAnimationState,
      };
    });
    assert.ok(bodyCapture.state.bodyScale.some((value) => value !== 1));
    await page.screenshot({
      path: `artifacts/browser-ped-animation-complete-${dataRoot}-body-scale.png`,
    });
    await page.evaluate(() => {
      const c = window.carma,
        peds = c.pedestrians,
        city = peds.peds
          .filter(
            (ped) => ped.presentation && /cityswat/i.test(ped.object.name),
          )
          .sort(
            (a, b) =>
              a.object.position.distanceTo(c.player.state.position) -
              b.object.position.distanceTo(c.player.state.position),
          )[0],
        cancelIndex = c.powerups.definitions.findIndex(
          (definition) => definition.action === 51,
        ),
        far = city.object.position
          .clone()
          .add(new city.object.position.constructor(100, 0, 100));
      c.powerups.grant(cancelIndex, c.vehicle, c.race);
      peds.update(
        0,
        { position: far, yaw: 0, speed: 0 },
        {
          cameraPosition: city.object.position.clone(),
          gameTimeMs: 1001,
          pedestrianAnimation: c.powerups.pedestrianAnimationState,
        },
      );
      peds.reset();
    });

    const audit = await page.evaluate((dataRoot) => {
      const c = window.carma;
      c.paused = true;
      const peds = c.pedestrians,
        entries = peds.peds,
        city = entries
          .filter(
            (ped) => ped.presentation && /cityswat/i.test(ped.object.name),
          )
          .sort(
            (a, b) =>
              a.object.position.distanceTo(c.player.state.position) -
              b.object.position.distanceTo(c.player.state.position),
          )[0],
        other = entries.find(
          (ped) =>
            ped !== city &&
            ped.presentation &&
            /cityswat/i.test(ped.object.name),
        );
      if (!city || !other)
        throw new Error(`${dataRoot}: two CitySwat presenters are required`);
      const presentation = city.presentation,
        otherPresentation = other.presentation,
        instance = presentation.instance,
        headIndex = presentation.template.form.headBone,
        sourceTemplate = peds.nativeTemplates.get("cityswat");
      if (!sourceTemplate || headIndex < 0)
        throw new Error(
          `${dataRoot}: source CitySwat template/head unavailable`,
        );

      const meshFor = (bone) => bone.model?.getObjectByProperty("isMesh", true);
      const extent = (bone) => {
        const mesh = meshFor(bone);
        if (!mesh) return null;
        mesh.geometry.computeBoundingBox();
        const bounds = mesh.geometry.boundingBox;
        return [
          bounds.max.x - bounds.min.x,
          bounds.max.y - bounds.min.y,
          bounds.max.z - bounds.min.z,
        ];
      };
      // Snapshot geometry owned by loaded source assets before applying the
      // private render-effect copies; powerups must never mutate these arrays.
      const sourceArrays = sourceTemplate.bones.flatMap((bone) =>
        bone.variants
          .map(
            (variant) =>
              variant.actor
                ?.getObjectByProperty("isMesh", true)
                ?.geometry?.getAttribute("position")?.array,
          )
          .filter(Boolean)
          .map((array) => [array, array.slice()]),
      );
      const bodyBone = instance.bones.find((bone) => meshFor(bone));
      const bodyIndex = bodyBone.index;
      const bodyBefore = extent(bodyBone),
        bodyOtherBefore = extent(otherPresentation.instance.bones[bodyIndex]),
        headBefore = extent(instance.bones[headIndex]),
        sourceFirst = sourceArrays[0]?.[1];
      if (!bodyBefore || !bodyOtherBefore || !headBefore || !sourceFirst)
        throw new Error(`${dataRoot}: source or rendered bounds unavailable`);

      const actionIndex = (action) =>
        c.powerups.definitions.findIndex(
          (definition) => definition.action === action,
        );
      const indexes = {
        body: actionIndex(2),
        head: actionIndex(32),
        mutant: actionIndex(33),
        cancel: actionIndex(51),
      };
      if (Object.values(indexes).some((index) => index < 0))
        throw new Error(
          `${dataRoot}: source action 2/32/33/51 definition missing`,
        );
      const animationPowerups = [
        indexes.body,
        indexes.head,
        indexes.mutant,
      ].map((index) => c.powerups.definitions[index]);
      const stateFor = (timeMs) => ({
        cameraPosition: city.object.position.clone(),
        gameTimeMs: timeMs,
        pedestrianAnimation: c.powerups.pedestrianAnimationState,
      });
      const far = city.object.position
        .clone()
        .add(new city.object.position.constructor(100, 0, 100));
      const car = { position: far, yaw: 0, speed: 0 };
      peds.resetCar(far);
      let timeMs = 1000;
      const update = (dt = 0) => {
        timeMs += Math.max(1, Math.round(dt * 1000));
        peds.update(dt, car, stateFor(timeMs));
        presentation.group.updateMatrixWorld(true);
        otherPresentation.group.updateMatrixWorld(true);
      };
      update();

      // Normal PowerupSystem grants use the actual original records. Action32
      // shares action2's group bit, so its expected cancellation restores body
      // scale while retaining its own head setter.
      c.powerups.grant(indexes.body, c.vehicle, c.race);
      update();
      const sourceBodyScale = animationPowerups[0].floatParams,
        bodyPowered = extent(bodyBone),
        otherBodyPowered = extent(otherPresentation.instance.bones[bodyIndex]),
        bodyChanged = bodyPowered.some(
          (value, axis) => Math.abs(value - bodyBefore[axis]) > 1e-4,
        ),
        otherBodyChanged = otherBodyPowered.some(
          (value, axis) => Math.abs(value - bodyOtherBefore[axis]) > 1e-4,
        );
      c.powerups.grant(indexes.head, c.vehicle, c.race);
      update();
      const headPowered = extent(instance.bones[headIndex]),
        bodyAfterHeadConflict = extent(bodyBone),
        sourceHeadScale = animationPowerups[1].floatParams[0],
        headChanged = headPowered.some(
          (value, axis) => Math.abs(value - headBefore[axis]) > 1e-4,
        ),
        bodyRestoredByConflict = bodyAfterHeadConflict.every(
          (value, axis) => Math.abs(value - bodyBefore[axis]) < 1e-4,
        );

      // Labelled controlled setup: call the existing kill owner with its normal
      // move argument set to death BON 91, then continue through real updates.
      city.velocity.set(0, 0, 0.5);
      peds.kill(
        city,
        timeMs,
        0.5,
        city.velocity.clone(),
        1,
        undefined,
        "vehicle",
        91,
      );
      update(0.01);
      const headBone = instance.bones[headIndex],
        deadInitial = {
          alive: city.alive,
          deadModelSet: city.deadModelSet,
          modelSet: instance.modelSet,
          deadAllSet1: instance.bones
            .filter((bone) => bone.index !== headIndex)
            .every((bone) => bone.model === bone.modelSets[1]?.[0]),
          deadHeadPose2: headBone.model === headBone.modelSets[1]?.[2],
          moveId: instance.moveId,
          frame: instance.clock.frame,
          period: instance.clock.periodMs,
          root: instance.bones[0].actor
            .getWorldPosition(new city.object.position.constructor())
            .toArray(),
          position: city.object.position.toArray(),
          matrices: instance.bones.map((bone) => [...bone.pose]),
        };
      const move91Period =
        presentation.template.moves.get(91)?.form.periodMs ?? 33;
      update(Math.min(0.1, Math.max(0.02, move91Period / 1000)));
      const deadAdvanced = {
        moveId: instance.moveId,
        frame: instance.clock.frame,
        matrices: instance.bones.map((bone) => [...bone.pose]),
        root: instance.bones[0].actor
          .getWorldPosition(new city.object.position.constructor())
          .toArray(),
        position: city.object.position.toArray(),
        diagnostics: [...presentation.diagnostics],
      };
      const maxMatrixDelta = (a, b) =>
        Math.max(
          ...a
            .slice(1)
            .flatMap((matrix, index) =>
              matrix.map((value, i) => Math.abs(value - b[index + 1][i])),
            ),
        );
      const deathPoseAdvanced =
        maxMatrixDelta(deadInitial.matrices, deadAdvanced.matrices) > 1e-5;
      const rootFollowError = Math.hypot(
        deadAdvanced.root[0] - deadAdvanced.position[0],
        deadAdvanced.root[2] - deadAdvanced.position[2],
      );

      // Cross the legacy two-second corpse transport boundary and verify the
      // original passive move94/Stillify path freezes BON time at period zero.
      city.fallTime = 1.999;
      city.settled = false;
      update(0.002);
      const settled = {
        moveId: instance.moveId,
        period: instance.clock.periodMs,
        settled: city.settled,
        frame: instance.clock.frame,
      };
      const settledMatrices = instance.bones.map((bone) => [...bone.pose]);
      update(0.05);
      const stillMatrices = instance.bones.map((bone) => [...bone.pose]);
      const stillPoseDelta = maxMatrixDelta(settledMatrices, stillMatrices);

      // Action33 is a normal timed source grant. The shared CRT stream is the
      // population's ordinary NativePedPresentation provider.
      c.powerups.grant(indexes.mutant, c.vehicle, c.race);
      update(0.02);
      const mutantStart = instance.bones.map((bone) => [...bone.pose]);
      update(0.05);
      const mutantEnd = instance.bones.map((bone) => [...bone.pose]);
      const mutant = {
        speed: animationPowerups[2].floatParams[0],
        currentSpeed: instance.mutantSpeed,
        matrixDelta: maxMatrixDelta(mutantStart, mutantEnd),
        diagnostics: [...presentation.diagnostics],
      };

      // Expire through the normal powerup updater, then feed its restored
      // snapshot into ordinary pedestrian updates and finally reset the race.
      c.powerups.update(31, c.vehicle, c.race);
      update();
      const expiredState = c.powerups.pedestrianAnimationState;
      const expiredHeadBounds = extent(headBone);
      const sourceUntouched = sourceArrays.every(
        ([array, snapshot]) =>
          array.length === snapshot.length &&
          array.every((value, index) => value === snapshot[index]),
      );
      const gl = c.renderer.getContext();
      const webglErrors = [];
      for (let i = 0; i < 16; i++) {
        const error = gl.getError();
        if (error === gl.NO_ERROR) break;
        webglErrors.push(error);
      }
      const result = {
        dataRoot,
        populationCount: peds.count,
        allNative:
          peds.states.filter(
            (state) => state.animation?.source === "original-bon-skl",
          ).length === 791,
        citySwat: city.object.name,
        sourcePowerups: animationPowerups.map((definition) => ({
          index: definition.index,
          action: definition.action,
          duration: definition.duration,
          group: definition.groupInclusion,
          floats: definition.floatParams,
        })),
        sourceBodyScale,
        sourceHeadScale,
        bodyChanged,
        otherSamePersonalityChanged: otherBodyChanged,
        bodyRestoredByConflict,
        headChanged,
        bodyBounds: {
          before: bodyBefore,
          powered: bodyPowered,
          otherPowered: otherBodyPowered,
          afterHeadConflict: bodyAfterHeadConflict,
        },
        headBounds: {
          before: headBefore,
          powered: headPowered,
          afterExpiry: expiredHeadBounds,
        },
        sourceGeometryUntouched: sourceUntouched,
        death: {
          ...deadInitial,
          frameAfter: deadAdvanced.frame,
          moveAfter: deadAdvanced.moveId,
          poseAdvanced: deathPoseAdvanced,
          rootAfter: deadAdvanced.root,
          positionAfter: deadAdvanced.position,
          rootFollowError,
          diagnosticsAfter: deadAdvanced.diagnostics,
        },
        settled,
        stillPoseDelta,
        mutant,
        expiredState,
        webglErrors,
      };
      return result;
    }, dataRoot);

    audit.assertions = [];
    const verify = (condition, message) => {
      if (!condition) audit.assertions.push(message);
    };
    verify(
      audit.populationCount === 791 && audit.allNative,
      `${dataRoot}: full Newcity1 population must use native presentation`,
    );
    verify(
      audit.bodyChanged &&
        audit.otherSamePersonalityChanged &&
        audit.bodyRestoredByConflict,
      `${dataRoot}: body scale must alter shared personality render copies, then restore on source group conflict`,
    );
    verify(
      audit.headChanged &&
        audit.headBounds.powered.some(
          (value, axis) =>
            Math.abs(value - audit.headBounds.before[axis]) > 1e-4,
        ),
      `${dataRoot}: head scale must alter source-bounded head geometry`,
    );
    verify(
      audit.sourceGeometryUntouched,
      `${dataRoot}: source asset geometry arrays must remain immutable`,
    );
    verify(
      !audit.death.alive &&
        audit.death.deadModelSet === 1 &&
        audit.death.modelSet === 1 &&
        audit.death.deadAllSet1 &&
        audit.death.deadHeadPose2,
      `${dataRoot}: physical death must select modelSet1 all-pose0/head-pose2`,
    );
    verify(
      audit.death.moveId === 91 &&
        audit.death.poseAdvanced &&
        audit.death.frameAfter !== audit.death.frame,
      `${dataRoot}: death move91 BON/SKL pose must advance after the kill`,
    );
    verify(
      audit.death.rootFollowError < 0.12,
      `${dataRoot}: corpse root must follow existing corpse transport`,
    );
    verify(
      audit.death.diagnosticsAfter.length === 0,
      `${dataRoot}: ordinary death animation must have no presentation diagnostics`,
    );
    verify(
      audit.settled.settled &&
        audit.settled.moveId === 94 &&
        audit.settled.period === 0 &&
        audit.stillPoseDelta < 1e-5,
      `${dataRoot}: settled corpse must select move94 and Stillify at period zero`,
    );
    verify(
      audit.mutant.currentSpeed !== 0 &&
        audit.mutant.matrixDelta > 1e-5 &&
        audit.mutant.diagnostics.length === 0,
      `${dataRoot}: dead mutant sequence must update joints using the shared RNG without diagnostics`,
    );
    verify(
      audit.expiredState.bodyScale.every((value) => value === 1) &&
        audit.expiredState.headScale === 1 &&
        audit.expiredState.mutantSpeed === 0,
      `${dataRoot}: timed animation effects must restore defaults on normal expiry`,
    );
    verify(audit.webglErrors.length === 0, `${dataRoot}: no WebGL errors`);
    report.cases.push(audit);
    await page.evaluate(() => {
      document.querySelector("#panel").hidden = true;
    });
    await page.screenshot({
      path: `artifacts/browser-ped-animation-complete-${dataRoot}-death.png`,
    });
    audit.reset = await page.evaluate(() => {
      const c = window.carma,
        peds = c.pedestrians,
        city = peds.peds
          .filter(
            (ped) => ped.presentation && /cityswat/i.test(ped.object.name),
          )
          .sort(
            (a, b) =>
              a.object.position.distanceTo(c.player.state.position) -
              b.object.position.distanceTo(c.player.state.position),
          )[0];
      peds.reset();
      const presentation = city.presentation,
        headIndex = presentation.template.form.headBone;
      return {
        alive: city.alive,
        moveId: presentation.instance.moveId,
        modelSet: presentation.instance.modelSet,
        headModelSet0:
          presentation.instance.bones[headIndex].model ===
          presentation.instance.bones[headIndex].modelSets[0][0],
        headScale: c.powerups.pedestrianAnimationState.headScale,
      };
    });
    audit.assertions.push(
      ...(audit.reset.alive &&
      audit.reset.modelSet === 0 &&
      audit.reset.headModelSet0 &&
      audit.reset.moveId !== null &&
      audit.reset.headScale === 1
        ? []
        : [
            `${dataRoot}: race reset must restore living source presentation/modelSet0`,
          ]),
    );
  }

  report.errors = [
    ...new Map(
      report.errors.map((entry) => [JSON.stringify(entry), entry]),
    ).values(),
  ];
  assert.deepEqual(
    report.errors,
    [],
    "browser should have no console or page errors",
  );
  assert.deepEqual(
    report.failedRequests,
    [],
    "browser should have no failed requests",
  );
  assert.deepEqual(
    report.badResponses,
    [],
    "browser should have no failed asset responses",
  );
  for (const result of report.cases)
    assert.deepEqual(result.assertions, [], JSON.stringify(result.assertions));
  await writeFile(
    "artifacts/browser-ped-animation-complete.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.failure = String(error);
  await writeFile(
    "artifacts/browser-ped-animation-complete.json",
    JSON.stringify(report, null, 2),
  );
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
