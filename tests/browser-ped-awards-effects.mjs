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
    "SKIP pedestrian awards/effects production browser check: Chromium or C2 assets absent",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = Number(process.env.PED_AWARDS_EFFECTS_PORT || 5274),
  server = spawn(process.execPath, ["server/dev.mjs", "--production"], {
    env: { ...process.env, CARMA2_ROOT: assetRoot, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
let serverLog = "",
  browser,
  page;
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
const report = {
  mode: "bounded actual ordinary native population contacts with production award/effect consumers",
  sourceCRTSeed: 24,
  maxOwnersPerTree: 3,
  maxPhysicsFramesPerTree: 60,
  cases: [],
  scopeFall: null,
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
    headless: process.env.PED_AWARDS_HEADED !== "1",
    args: [
      "--no-sandbox",
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--use-angle=swiftshader",
    ],
  });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
  report.graphics = await page.evaluate(() => {
    const gl = window.carma.renderer.getContext(),
      extension = gl.getExtension("WEBGL_debug_renderer_info");
    return {
      renderer: extension
        ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)
        : "unknown",
      version: gl.getParameter(gl.VERSION),
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      pixelRatio: window.carma.renderer.getPixelRatio(),
    };
  });

  for (const dataRoot of ["data", "adv_data"]) {
    const selected = await page.evaluate(
      async ({ dataRoot }) => {
        const c = window.carma,
          track = [...document.querySelector("#track-select").options].find(
            (option) =>
              option.value.toLowerCase().startsWith(`${dataRoot}/`) &&
              /newcity1/i.test(`${option.value} ${option.textContent}`),
          )?.value,
          car = [...document.querySelector("#car-select").options].find(
            (option) =>
              option.value.toLowerCase() === "data/cars/eagle3/eagle3.txt",
          )?.value;
        if (!track || !car)
          throw new Error(`Missing ${dataRoot} Newcity1 or Stock Eagle3`);
        document.querySelector("#track-select").value = track;
        document.querySelector("#car-select").value = car;
        await c.loadRace();
        c.paused = false;
        document.querySelector("#panel").hidden = true;
        return { track, car };
      },
      { dataRoot },
    );
    await page.waitForFunction(
      () =>
        window.carma?.populationLoadState?.pedestrians?.state === "ready" &&
        window.carma?.pedestrians?.nativeLifecycle?.physical > 0,
      null,
      { timeout: 90000 },
    );
    await page.evaluate(() => (window.carma.paused = true));

    const result = await page.evaluate(
      ({ dataRoot, selected }) => {
        const c = window.carma,
          system = c.pedestrians,
          bridge = system.nativeBridge,
          runtime = system.nativeRuntime,
          car = c.player;
        if (
          !bridge ||
          !c.simulation.nativeObjectAddress ||
          !c.simulation.nativeObjectRecords
        )
          throw new Error(
            "Missing production native pedestrian/physics-object providers",
          );
        const nearestCar = (row) =>
          Math.min(
            ...c.simulation.cars
              .filter((other) => other !== car)
              .map((other) =>
                row.body.state.position.distanceTo(other.state.position),
              ),
          );
        const candidates = runtime.characters
          .filter((row) => {
            const ped = system.peds.find((entry) => entry.object === row.owner);
            return (
              ped &&
              bridge.owns(ped) &&
              row.body &&
              row.instance &&
              row.hitPoints > 0 &&
              row.instance.physicsActive === false &&
              row.diagnostics.size === 0 &&
              row.formKey === "BIPED1" &&
              !row.removedBoneMask &&
              system.renderActors.has(row.owner)
            );
          })
          .sort((a, b) => nearestCar(b) - nearestCar(a))
          .slice(0, 3);
        if (!candidates.length)
          throw new Error(
            `No ordinary native population candidates in ${dataRoot}`,
          );
        const globals = bridge.gameplay.options.readGlobals();
        if (globals.goreLevel !== 2)
          throw new Error(
            `Expected full-gore OPTIONS internal2, got ${globals.goreLevel}`,
          );
        const originalHit = system.options.onHit,
          originalCount = system.options.onCount,
          events = [],
          records = [];
        let currentCandidate = null;
        system.options.onCount = (event) => {
          if (candidates.some((row) => row.owner === event.actor))
            events.push({
              kind: "count",
              owner: event.actor,
              timeMs: event.timeMs,
              source: event.source,
              traceIndex: events.length,
            });
          return originalCount?.(event);
        };
        system.options.onHit = (event) => {
          if (
            currentCandidate &&
            event.owner === car &&
            event.position.distanceTo(currentCandidate.body.state.position) < 2
          )
            events.push({
              kind: "hit",
              owner: currentCandidate.owner,
              attributedOwner: event.owner,
              timeMs: event.timeMs,
              cause: event.cause,
              driver: event.owner?.state?.driver ?? null,
              count: event.count,
              traceIndex: events.length,
              awardContext: {
                cachePresent: event.awardContext.cachePresent,
                cacheFlags: event.awardContext.cacheFlags,
                height: event.awardContext.height,
                pedVelocity:
                  event.awardContext.pedVelocity?.toArray?.() ?? null,
                pedStartingVelocity:
                  event.awardContext.pedStartingVelocity?.toArray?.() ?? null,
              },
            });
          return originalHit?.(event);
        };
        const before = {
          blood: { ...system.bloodStats },
          nativeBlood: { ...system.bloodNativeStats },
          shards: { ...c.shards.stats },
          score: c.race?.credits,
          time: c.race?.timeRemainingMs,
        };
        const camera = car.state.position.clone();
        let now = Math.max(0, Math.trunc(c.stats.gameTimeMs)),
          frames = 0,
          picked = null;
        const tick = () => {
          now += 40;
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
            },
          );
          c.simulation.updateFrame(now, 40);
          system.finishPhysics();
          system.finishEffects();
          frames++;
        };
        const impactRows = [];
        c.shards.options.seed(24);
        try {
          for (const row of candidates) {
            if (frames >= 60) break;
            const body = row.body,
              owner = row.owner,
              direction = row.instance.direction,
              length = Math.hypot(direction[0], direction[2]) || 1,
              x = direction[0] / length,
              z = direction[2] / length,
              address = c.simulation.nativeObjectAddress(body),
              record = c.simulation.nativeObjectRecords.readView(body);
            if (
              !(address > 0) ||
              c.simulation.nativeObjectAddress(body) !== address
            )
              throw new Error(
                "Native physics-object address is not a stable memory offset",
              );
            const initialRecord = {
              address,
              worldVelocity: [0, 1, 2].map((axis) =>
                record.getFloat32(0x68 + axis * 4, true),
              ),
              typeByte: record.getUint8(0x238),
            };
            if (initialRecord.typeByte !== 2)
              throw new Error(
                `Ordinary population body type byte was ${initialRecord.typeByte}`,
              );
            if (
              initialRecord.worldVelocity.some(
                (value, axis) =>
                  value !== Math.fround(body.state.velocity.toArray()[axis]),
              )
            )
              throw new Error(
                "Native physics record world velocity does not mirror the actual population body",
              );
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
            currentCandidate = row;
            const eventOffset = events.length,
              ownerStart = events.filter(
                (event) => event.owner === owner,
              ).length;
            for (let i = 0; i < Math.min(20, 60 - frames); i++) {
              tick();
              for (const impact of c.simulation.lastImpacts)
                if (impact.a === body || impact.b === body)
                  impactRows.push({
                    owner: owner.name,
                    accepted: !!impact.solverAccepted,
                    lambda: impact.normalImpulse,
                    sourceType: impact.sourceType,
                    carPair:
                      (impact.a === body && impact.b === car) ||
                      (impact.b === body && impact.a === car),
                  });
              if (
                events
                  .slice(eventOffset)
                  .some(
                    (event) => event.kind === "hit" && event.owner === owner,
                  )
              ) {
                picked = row;
                break;
              }
            }
            records.push({
              owner: owner.name,
              address,
              initialRecord,
              currentVelocity: body.state.velocity.toArray(),
              hitEventsBefore: ownerStart,
            });
            if (picked) break;
          }
          if (!picked)
            throw new Error(
              "No actual ordinary native population death/award event within bounded car contacts",
            );
          const target = picked,
            owner = target.owner,
            body = target.body,
            ownerEvents = events.filter((event) => event.owner === owner),
            beforeRepeat = ownerEvents.length;
          // Revisit the same corpse with an actual car contact; Kill/count/award
          // consumers must remain once-only after the original death.
          const corpseDirection =
              picked.instance?.direction ?? picked.direction,
            corpseLength =
              Math.hypot(corpseDirection[0], corpseDirection[2]) || 1,
            cx = corpseDirection[0] / corpseLength,
            cz = corpseDirection[2] / corpseLength;
          c.simulation.reset(car);
          car.state.position.set(
            body.state.position.x - cx * 0.65,
            body.state.position.y,
            body.state.position.z - cz * 0.65,
          );
          car.state.heading = Math.atan2(-cx, -cz);
          car.state.orientation.set(
            0,
            Math.sin(car.state.heading / 2),
            0,
            Math.cos(car.state.heading / 2),
          );
          car.state.velocity.set(cx * 6, 0, cz * 6);
          car.state.angularVelocity.set(0, 0, 0);
          car.state.speed = 6;
          for (let i = 0; i < Math.min(8, 60 - frames); i++) tick();
          const finalEvents = events.filter((event) => event.owner === owner),
            nativeAddress = c.simulation.nativeObjectAddress(body),
            nativeView = c.simulation.nativeObjectRecords.readView(body),
            nativeWorldVelocity = [0, 1, 2].map((axis) =>
              nativeView.getFloat32(0x68 + axis * 4, true),
            ),
            scoreRows = finalEvents.filter((event) => event.kind === "hit"),
            countRows = finalEvents.filter((event) => event.kind === "count"),
            output = {
              dataRoot,
              selected,
              sourceGoreLevel: globals.goreLevel,
              frames,
              candidateCount: candidates.length,
              impactRows,
              records,
              chosen: {
                owner: owner.name,
                hp: target.hitPoints,
                flags: target.flags,
                countRows: countRows.map(({ owner: actor, ...event }) => ({
                  ...event,
                  owner: actor?.name ?? null,
                })),
                scoreRows: scoreRows.map(
                  ({ owner: actor, attributedOwner, ...event }) => ({
                    ...event,
                    owner: actor?.name ?? null,
                    attributedOwner:
                      attributedOwner === car
                        ? { kind: "player-car", driver: car.state.driver }
                        : null,
                  }),
                ),
                nativeAddress,
                nativeWorldVelocity,
                nativeTypeByte: nativeView.getUint8(0x238),
                nativeMass: nativeView.getFloat32(0x04, true),
                currentRootPose: Array.from(
                  target.instance?.rootPose ?? target.rootPose,
                ),
                currentBodyPosition: body.state.position.toArray(),
                diagnostics: [...target.diagnostics],
              },
              effects: {
                bloodBefore: before.blood,
                bloodAfter: { ...system.bloodStats },
                nativeBloodBefore: before.nativeBlood,
                nativeBloodAfter: { ...system.bloodNativeStats },
                shardsBefore: before.shards,
                shardsAfter: { ...c.shards.stats },
                nativeFragments: c.shards
                  .snapshot()
                  .fragments.filter(
                    (fragment) =>
                      fragment.name === "native-ped-impact-giblet" ||
                      fragment.name === "native-ped-spurt-giblet",
                  )
                  .slice(-20)
                  .map((fragment) => ({
                    name: fragment.name,
                    priority: fragment.priority,
                    position:
                      fragment.position.toArray?.() ?? fragment.position,
                  })),
              },
              raceBefore: { credits: before.score, time: before.time },
              raceAfter: {
                credits: c.race?.credits,
                time: c.race?.timeRemainingMs,
              },
              repeatedContactAddedEvents: finalEvents.length - beforeRepeat,
            };
          if (
            nativeWorldVelocity.some(
              (value, axis) =>
                value !== Math.fround(body.state.velocity.toArray()[axis]),
            )
          )
            throw new Error(
              "Final native physics record does not mirror the live pedestrian velocity",
            );
          system.options.onHit = originalHit;
          system.options.onCount = originalCount;
          return output;
        } finally {
          system.options.onHit = originalHit;
          system.options.onCount = originalCount;
        }
      },
      { dataRoot, selected },
    );
    report.cases.push(result);
    if (dataRoot === "data") {
      const probe = await page.evaluate(
        ({ position, owner }) => {
          const c = window.carma,
            target = c.player.state.position.clone().fromArray(position),
            diagnosticCamera = c.camera.clone();
          diagnosticCamera.near = 0.02;
          diagnosticCamera.fov = 60;
          diagnosticCamera.updateProjectionMatrix();
          diagnosticCamera.position
            .copy(target)
            // These original candidates stand below an elevated street; a high
            // overhead camera sees its roof rather than the physical actors.
            .add(target.clone().set(0.8, 0.35, 1));
          diagnosticCamera.lookAt(target);
          diagnosticCamera.updateMatrixWorld(true);
          document.querySelector("#panel").hidden = true;
          c.prepareRenderMatrices(true);
          const character = c.pedestrians.nativeRuntime.characters.find(
            (row) => row.owner.name === owner,
          );
          const nodes = [
            c.player.group,
            character?.instance?.group,
            character?.instance?.bones[0]?.actor,
          ]
            .filter(Boolean)
            .map((actor) => {
              actor.updateWorldMatrix(true, true);
              const worldPosition = actor.getWorldPosition(target.clone());
              return {
                name: actor.name,
                visible: actor.visible,
                parent: actor.parent?.name,
                worldPosition: worldPosition.toArray(),
                ndc: worldPosition.clone().project(diagnosticCamera).toArray(),
                meshes: (() => {
                  let n = 0;
                  actor.traverse((child) => {
                    if (child.isMesh && child.visible) n++;
                  });
                  return n;
                })(),
              };
            });
          c.renderer.render(c.scene, diagnosticCamera);
          // Read synchronously: the normal chase camera remains the owner on
          // the next RAF, even while gameplay is paused.
          return {
            image: c.renderer.domElement.toDataURL("image/png"),
            nodes,
            camera: diagnosticCamera.position.toArray(),
          };
        },
        {
          position: result.chosen.currentBodyPosition,
          owner: result.chosen.owner,
        },
      );
      report.renderProbe = { nodes: probe.nodes, camera: probe.camera };
      await writeFile(
        "artifacts/browser-ped-awards-effects-stock.png",
        Buffer.from(probe.image.split(",")[1], "base64"),
      );
    }
  }

  const scopeSelection = await page.evaluate(async () => {
    const c = window.carma,
      trackSelect = document.querySelector("#track-select"),
      carSelect = document.querySelector("#car-select"),
      track = [...trackSelect.options].find(
        (option) =>
          option.value.toLowerCase().startsWith("data/") &&
          /newcity1/i.test(`${option.value} ${option.textContent}`),
      )?.value,
      car = [...carSelect.options].find(
        (option) =>
          option.value.toLowerCase() === "data/cars/eagle3/eagle3.txt",
      )?.value;
    if (!track || !car) throw new Error("Missing Stock scope-fall selection");
    trackSelect.value = track;
    carSelect.value = car;
    await c.loadRace();
    c.paused = false;
    return { track, car };
  });
  await page.waitForFunction(
    () =>
      window.carma?.populationLoadState?.pedestrians?.state === "ready" &&
      window.carma?.pedestrians?.nativeLifecycle?.physical > 0,
    null,
    { timeout: 90000 },
  );
  await page.evaluate(() => (window.carma.paused = true));
  report.scopeFall = await page.evaluate((selected) => {
    const c = window.carma,
      system = c.pedestrians,
      runtime = system.nativeRuntime,
      bridge = system.nativeBridge,
      car = c.player;
    if (!bridge || typeof c.simulation.world.nativePedFloorBelow !== "function")
      throw new Error(
        "Missing actual scope-fall bridge or native floor provider",
      );
    const nearestCarDistance = (row) =>
      Math.min(
        ...c.simulation.cars.map((other) =>
          row.body.state.position.distanceTo(other.state.position),
        ),
      );
    const candidates = runtime.characters
      .filter((row) => {
        const ped = system.peds.find((entry) => entry.object === row.owner);
        return (
          ped?.alive &&
          bridge.owns(ped) &&
          row.body &&
          row.instance &&
          row.formKey === "BIPED1" &&
          row.hitPoints > 0 &&
          !(row.flags & 0x180) &&
          !row.instance.physicsActive &&
          !row.removedBoneMask &&
          row.diagnostics.size === 0 &&
          system.renderActors.has(row.owner)
        );
      })
      .sort((a, b) => nearestCarDistance(b) - nearestCarDistance(a))
      .slice(0, 3);
    const character = candidates[0];
    if (!character || nearestCarDistance(character) < 2.5)
      throw new Error("No existing living passive Stock BIPED1 clear of cars");
    const owner = character.owner,
      body = character.body,
      instance = character.instance,
      state = bridge.gameplay.state(owner),
      start = Math.max(0, Math.trunc(c.stats.gameTimeMs)),
      camera = body.state.position.clone(),
      population = runtime.characters.slice(),
      events = [],
      originalCount = system.options.onCount,
      originalHit = system.options.onHit,
      originalKill = bridge.gameplay.kill,
      originalKillGiblets = bridge.gameplay.options.onKillGiblets,
      originalModelEffect = runtime.applyKillModelEffect;
    const releaseState = () => ({
      hp: character.hitPoints,
      flags: character.flags,
      action: state.action,
      phil: c.simulation.phil.getState(body),
      bodyReleased: character.body === null && body.owner === null,
      instanceReleased: character.instance === null,
      renderReleased:
        instance.group.parent === null &&
        instance.group.visible === false &&
        instance.bones.every(
          (bone) => bone.model === null && !bone.actor.visible,
        ),
    });
    const record = (kind, values = {}) =>
      events.push({ kind, traceIndex: events.length, ...values });
    system.options.onCount = (event) => {
      if (event.actor === owner)
        record("count", {
          source: event.source,
          timeMs: event.timeMs,
          ...releaseState(),
        });
      return originalCount?.(event);
    };
    system.options.onHit = (event) => {
      if (
        event.cause === "environment" &&
        event.timeMs === start + 8120 &&
        event.position
          .toArray()
          .every((value, axis) => value === character.position[axis])
      )
        record("score", {
          timeMs: event.timeMs,
          cause: event.cause,
          count: event.count,
          attributedOwner:
            event.owner === car ? "player" : (event.owner?.name ?? null),
          position: event.position.toArray(),
          height: event.awardContext.height,
          cachePresent: event.awardContext.cachePresent,
          cacheFlags: event.awardContext.cacheFlags,
          ...releaseState(),
        });
      return originalHit?.(event);
    };
    // Observe real consumers while preserving their production behavior.
    bridge.gameplay.kill = function (ctx, ...args) {
      if (ctx.owner === owner) record("FullKill");
      return originalKill.call(this, ctx, ...args);
    };
    bridge.gameplay.options.onKillGiblets = (ctx, ...args) => {
      if (ctx.owner === owner) record("kill-giblets");
      return originalKillGiblets?.(ctx, ...args);
    };
    runtime.applyKillModelEffect = function (actor, effect) {
      if (actor === owner) record("kill-model", { effect: effect.kind });
      return originalModelEffect.call(this, actor, effect);
    };
    const update = (timeMs) =>
      system.update(
        0.04,
        {
          position: car.state.position,
          yaw: car.state.heading,
          speed: 0,
          velocity: car.state.velocity,
        },
        {
          gameTimeMs: timeMs,
          physicsTickMs: Math.round(c.simulation.elapsed * 1000) >>> 0,
          framePeriodMs: 40,
          cameraPosition: camera,
          threats: [],
          combatOwner: car,
          combatPosition: car.state.position,
        },
      );
    try {
      const before = {
        ...releaseState(),
        nearestCarDistance: nearestCarDistance(character),
      };
      update(start + 40);
      update(start + 80);
      if (!(character.flags & 0x40))
        throw new Error(
          "Scope fixture did not arm flag40 through two outer visits",
        );
      const lifted = instance.rootPose.slice();
      lifted[10] += 1;
      const lift = runtime.setRootPose(owner, lifted);
      if (lift.status !== "complete")
        throw new Error(
          `Scope fixture root lift failed: ${JSON.stringify(lift)}`,
        );
      bridge.steering.grounding.invalidate(owner);
      update(start + 120);
      const afterFall = {
        ...releaseState(),
        move: character.moveId,
        active: character.instance?.physicsActive ?? false,
        bodyRetained: character.body === body,
        instanceRetained: character.instance === instance,
      };
      if (
        !afterFall.active ||
        afterFall.phil !== 2 ||
        afterFall.move !== 72 ||
        afterFall.action !== 3 ||
        afterFall.hp !== before.hp
      )
        throw new Error(
          `Scope fixture did not genuinely activate source move72/action3/PHIL2: ${JSON.stringify(afterFall)}`,
        );
      if (state.cache?.killer)
        throw new Error(
          "Scope fixture unexpectedly retained an attributed killer",
        );
      const position = body.state.position
          .clone()
          .fromArray(character.position),
        floor = c.simulation.world.nativePedFloorBelow(position, car.group);
      if (!floor || floor.requiredProviders.length)
        throw new Error(
          `Scope fixture native floor unavailable: ${JSON.stringify(floor)}`,
        );
      const expectedHeight = Math.fround(position.y - floor.height),
        effectsBefore = {
          giblets: system.bloodStats.giblets,
          nativeBlood: { ...system.bloodNativeStats },
          shards: { ...c.shards.stats },
        },
        raceBefore = {
          credits: c.race?.credits,
          time: c.race?.timeRemainingMs,
        },
        aliveBefore = system.alive,
        hitsBefore = system.hits;
      // Advance only the outer visit clock; the active body cannot land before
      // the actual out-of-scope path releases its PHIL and ACT resources.
      camera.addScalar(100000);
      update(start + 8120);
      const firstExit = releaseState(),
        firstExitEventCount = events.length;
      update(start + 8160);
      return {
        dataRoot: "data",
        selected,
        owner: owner.name,
        personality: character.personality,
        candidateCount: candidates.length,
        before,
        lift,
        afterFall,
        position: position.toArray(),
        floorHeight: floor.height,
        expectedHeight,
        firstExit,
        final: releaseState(),
        events,
        repeatedExitAddedEvents: events.length - firstExitEventCount,
        aliveDelta: system.alive - aliveBefore,
        hitsDelta: system.hits - hitsBefore,
        effectsBefore,
        effectsAfter: {
          giblets: system.bloodStats.giblets,
          nativeBlood: { ...system.bloodNativeStats },
          shards: { ...c.shards.stats },
        },
        raceBefore,
        raceAfter: { credits: c.race?.credits, time: c.race?.timeRemainingMs },
        populationRetained:
          population.length === runtime.characters.length &&
          population.every((row, index) => row === runtime.characters[index]),
        diagnostics: [...character.diagnostics],
      };
    } finally {
      system.options.onCount = originalCount;
      system.options.onHit = originalHit;
      bridge.gameplay.kill = originalKill;
      bridge.gameplay.options.onKillGiblets = originalKillGiblets;
      runtime.applyKillModelEffect = originalModelEffect;
    }
  }, scopeSelection);

  assert.equal(report.errors.length, 0, "browser/runtime errors");
  assert.equal(report.failedRequests.length, 0, "failed requests");
  assert.equal(report.badResponses.length, 0, "failed HTTP responses");
  for (const result of report.cases) {
    assert.ok(result.chosen.nativeAddress > 0);
    assert.equal(result.chosen.nativeTypeByte, 2);
    assert.equal(result.chosen.hp, 0);
    assert.equal(result.chosen.countRows.length, 1);
    assert.equal(result.chosen.scoreRows.length, 1);
    assert.ok(
      result.chosen.countRows[0].traceIndex <
        result.chosen.scoreRows[0].traceIndex,
    );
    assert.equal(
      result.chosen.scoreRows[0].driver,
      8,
      "local raw driver id remains reward-eligible",
    );
    assert.equal(result.repeatedContactAddedEvents, 0);
    assert.ok(
      result.effects.bloodAfter.giblets >= result.effects.bloodBefore.giblets,
    );
    assert.ok(
      result.effects.nativeBloodAfter.impacts >
        result.effects.nativeBloodBefore.impacts,
    );
    assert.ok(
      result.effects.nativeBloodAfter.created >
        result.effects.nativeBloodBefore.created ||
        result.effects.nativeBloodAfter.spurts >
          result.effects.nativeBloodBefore.spurts,
      "native blood/giblet effects reached the production pool",
    );
    assert.deepEqual(result.chosen.diagnostics, []);
  }
  const scope = report.scopeFall,
    scopeCounts = scope.events.filter((event) => event.kind === "count"),
    scopeScores = scope.events.filter((event) => event.kind === "score");
  assert.equal(scope.afterFall.bodyRetained, true);
  assert.equal(scope.afterFall.instanceRetained, true);
  assert.equal(scope.firstExit.flags & 0x180, 0x180);
  assert.equal(scope.firstExit.hp, 0);
  assert.equal(scope.firstExit.action, 6);
  for (const state of [
    scope.firstExit,
    scope.final,
    ...scopeCounts,
    ...scopeScores,
  ]) {
    assert.equal(state.phil, 0, "scope fall releases actual PHIL registration");
    assert.equal(state.bodyReleased, true);
    assert.equal(state.instanceReleased, true);
    assert.equal(state.renderReleased, true);
  }
  assert.equal(scopeCounts.length, 1, "scope death counts once");
  assert.equal(scopeScores.length, 1, "scope death scores once");
  assert.equal(scopeCounts[0].source, "native");
  assert.ok(scopeCounts[0].traceIndex < scopeScores[0].traceIndex);
  assert.equal(scopeScores[0].cause, "environment");
  assert.equal(scopeScores[0].count, 1);
  assert.equal(scopeScores[0].height, scope.expectedHeight);
  assert.deepEqual(scopeScores[0].position, scope.position);
  assert.equal(scopeScores[0].attributedOwner, null);
  assert.equal(scope.repeatedExitAddedEvents, 0);
  assert.equal(scope.hitsDelta, 1);
  assert.equal(scope.aliveDelta, -1);
  assert.equal(
    scope.events.some((event) =>
      ["FullKill", "kill-giblets", "kill-model"].includes(event.kind),
    ),
    false,
  );
  assert.equal(scope.effectsAfter.giblets, scope.effectsBefore.giblets);
  assert.deepEqual(
    scope.effectsAfter.nativeBlood,
    scope.effectsBefore.nativeBlood,
  );
  assert.deepEqual(scope.effectsAfter.shards, scope.effectsBefore.shards);
  assert.deepEqual(
    scope.raceAfter,
    scope.raceBefore,
    "no cached killer fabricates no player credits or time",
  );
  assert.equal(scope.populationRetained, true);
  assert.deepEqual(scope.diagnostics, []);
  report.graphics.webglError = await page.evaluate(() =>
    window.carma.renderer.getContext().getError(),
  );
  assert.equal(report.graphics.webglError, 0, "WebGL context error");
} catch (error) {
  report.errors.push(String(error?.stack ?? error));
  throw error;
} finally {
  await page
    ?.evaluate?.(() => {
      if (window.carma) window.carma.paused = true;
    })
    .catch(() => {});
  await browser?.close();
  server.kill("SIGTERM");
  if (server.exitCode === null)
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
  report.serverLog = serverLog;
  await writeFile(
    "artifacts/browser-ped-awards-effects.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
console.log(
  `PASS pedestrian awards/effects population cases: ${report.cases.length}; artifacts/browser-ped-awards-effects.json`,
);
