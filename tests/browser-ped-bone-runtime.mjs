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
    "SKIP pedestrian bone browser test: Chromium or C2 assets absent.",
  );
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5225;
const server = spawn(process.execPath, ["server/dev.mjs"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (data) => (serverLog += data));
server.stderr.on("data", (data) => (serverLog += data));
let browser;
const report = {
  mode: "diagnostic original assets in VehicleSimulation; not normal pedestrian population integration",
  cases: [],
  errors: [],
  errorCounts: {},
  failedRequests: [],
  badResponses: [],
  webgl: [],
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
  await page.goto(`http://localhost:${port}`);
  await page.waitForFunction(() => window.carma?.stats.ready, null, {
    timeout: 90000,
  });
  report.serverMode =
    "Vite development server with direct original installation asset requests";

  for (const dataRoot of ["data", "adv_data"]) {
    const path = await page.evaluate((root) => {
      const options = [...document.querySelector("#track-select").options];
      return options.find(
        (option) =>
          option.value.toLowerCase().startsWith(`${root}/`) &&
          /newcity1/i.test(`${option.value} ${option.textContent}`),
      )?.value;
    }, dataRoot);
    assert.ok(path, `missing ${dataRoot} Newcity1 track`);
    await page.evaluate(async (track) => {
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
      c.paused = false;
      document.querySelector("#panel").hidden = true;
    }, path);
    await page.waitForFunction(
      () => window.carma?.simulation && window.carma?.player,
    );
    await page.waitForTimeout(500);

    let fixture;
    try {
      fixture = await page.evaluate(
        async ({ dataRoot }) => {
          const c = window.carma;
          const [assetModule, instanceModule, bodyModule] = await Promise.all([
            import("/src/ped-native-assets.ts"),
            import("/src/ped-native-instance.ts"),
            import("/src/physics/ped-bone-body.ts"),
          ]);
          const { loadNativePedAssets } = assetModule;
          const { createNativePedInstance, selectNativePedMove } =
            instanceModule;
          const { createNativePedBoneBody, commitNativePedBoneBody } =
            bodyModule;
          const template = await loadNativePedAssets(
            c.assets,
            "PEDS/PEEPS/Blokebl",
            "Blokebl",
            dataRoot,
          );
          const player = c.player;
          const forward = player.state.velocity.clone();
          forward.y = 0;
          if (forward.lengthSq() < 0.01)
            forward.set(0, 0, -1).applyQuaternion(player.state.orientation);
          forward.normalize();
          const rootPosition = player.state.position
            .clone()
            .addScaledVector(forward, 0.65);
          rootPosition.y += 0.55;
          const rootPose = [
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
          ];
          const instance = createNativePedInstance(template, { rootPose });
          c.scene.add(instance.group);
          const selection = selectNativePedMove(
            instance,
            30,
            [0, 0, 1],
            [0, 1, 0],
            100,
            { groundHeight: rootPosition.y - 0.55 },
          );
          if (selection.status !== "complete")
            throw new Error(
              `Original move30 unavailable: ${selection.requiredProviders.join(",")}`,
            );
          instance.group.updateMatrixWorld(true);

          const selectBone = (sourceInstance, predicate) => {
            const index = template.form.bones.findIndex(
              (bone, i) =>
                bone.mass > 0 &&
                sourceInstance.bones[i]?.model &&
                predicate(bone, i),
            );
            if (index < 0) return null;
            const definition = template.form.bones[index];
            const liveBone = sourceInstance.bones[index];
            const assetBone = template.bones[index];
            const variant = assetBone.variants[liveBone.poseIndex];
            const sourceName = variant.sourceModels[0];
            const authoredBounds = variant.modelBounds.get(sourceName);
            if (!authoredBounds)
              throw new Error(`Missing current MODEL bounds: ${sourceName}`);
            const nativePose = Float32Array.from(liveBone.pose);
            return {
              index,
              instance: sourceInstance,
              definition,
              liveBone,
              bounds: {
                min: authoredBounds.min.toArray(),
                max: authoredBounds.max.toArray(),
              },
              nativePose,
              sourceName,
            };
          };
          const head = selectBone(
            instance,
            (bone) =>
              bone.name === template.form.bones[template.form.headBone]?.name,
          );
          const boxBone = selectBone(
            instance,
            (bone) => bone.collisionType === "BOX",
          );
          if (!head || head.definition.collisionType !== "SPHERE")
            throw new Error(
              "Blokebl did not provide the expected current SPHERE head",
            );
          if (!boxBone)
            throw new Error("Blokebl has no visible current BOX bone");

          const createRequest = (candidate, slot, velocity) => ({
            index: candidate.index,
            slot,
            bone: candidate.definition,
            snapshot: {
              actor: candidate.liveBone.actor,
              model: candidate.liveBone.model,
              nativePose: candidate.nativePose,
              bounds: candidate.bounds,
            },
            rigidType: 5,
            filterA: 0x40000,
            filterB: 0x50000,
            localOmega: [0, 0, 0],
            activation: {
              velocity,
              gravity: 1,
              clearProperties: [3, 4, 5],
              clearDoNothing: true,
              enableHalt: true,
            },
            clearParentJoint: true,
            clearChildren: true,
            clearLink188: true,
          });
          const registerDetached = (candidate, slot, velocity) => {
            const request = createRequest(candidate, slot, velocity);
            const body = createNativePedBoneBody({
              request,
              owner: candidate.instance,
              levelOut: 0,
              retained: { rigidFlags: 0, objectFriction: 0.4 },
            });
            const admitted = c.simulation.addPedBoneBody(body);
            if (!admitted.accepted)
              throw new Error(`PHIL admission code ${admitted.code}`);
            commitNativePedBoneBody(request, body, {
              unlink: (value) => value.actor.removeFromParent(),
              activate: (value) =>
                c.simulation.phil.activate(value, { flag2: false }),
            });
            candidate.instance.removedBoneMask =
              (candidate.instance.removedBoneMask | (1 << candidate.index)) >>>
              0;
            c.scene.add(body.actor);
            return body;
          };
          const headBody = registerDetached(head, 0, [0, -0.25, -0.2]);
          const boxBody = registerDetached(boxBone, 1, [0.08, -0.1, -0.1]);
          const carBeforeSetup = player.state.position.toArray();
          const controlledCarStart = headBody.state.position
            .clone()
            .addScaledVector(forward, -4.5);
          controlledCarStart.y = headBody.state.position.y - 0.15;
          c.simulation.rematerializePose(
            player,
            controlledCarStart,
            player.state.orientation.clone(),
            forward.clone().multiplyScalar(1),
          );
          c.simulation.sync(player);
          const impactFailures = [];
          const originalApplyImpactDamage = c.simulation.applyImpactDamage.bind(
            c.simulation,
          );
          c.simulation.applyImpactDamage = (impacts, ...args) => {
            try {
              return originalApplyImpactDamage(impacts, ...args);
            } catch (error) {
              if (impactFailures.length < 8)
                impactFailures.push({
                  message: String(error),
                  impactCount: impacts.length,
                  rows: impacts
                    .filter((impact) => {
                      if (impact.sourceType === 9) return false;
                      const components = [
                        impact.normal?.x,
                        impact.normal?.y,
                        impact.normal?.z,
                      ].map(Math.fround);
                      return (
                        components.some(
                          (n) => !Number.isFinite(n) || Math.abs(n) > 1,
                        ) || components.every((n) => n === 0)
                      );
                    })
                    .slice(0, 8)
                    .map((impact) => ({
                      sourceType: impact.sourceType ?? null,
                      normal: impact.normal?.toArray?.() ?? null,
                      normalLength: impact.normal?.length?.() ?? null,
                      normalLengthSq: impact.normal?.lengthSq?.() ?? null,
                      point: impact.point?.toArray?.() ?? null,
                      penetration: impact.penetration ?? null,
                      normalImpulse: impact.normalImpulse ?? null,
                      closingSpeed: impact.closingSpeed ?? null,
                      a: {
                        kind:
                          impact.a?.kind ??
                          (impact.a === c.player ? "EAGLE" : null),
                        position:
                          impact.a?.state?.position?.toArray?.() ?? null,
                        quaternion:
                          impact.a?.state?.orientation?.toArray?.() ?? null,
                      },
                      b: {
                        kind:
                          impact.b?.kind ??
                          (impact.b === c.player ? "EAGLE" : null),
                        position:
                          impact.b?.state?.position?.toArray?.() ?? null,
                        quaternion:
                          impact.b?.state?.orientation?.toArray?.() ?? null,
                      },
                    })),
                });
              throw error;
            }
          };
          const contactTrace = [];
          const worldContactTrace = [];
          const bodyTrajectory = [];
          const contactCounts = {};
          const bodyCenter = (body) => {
            const center = body.state.position.clone();
            if (body.shape.type === "SPHERE") {
              center.add(
                new body.state.position.constructor(
                  ...body.shape.center,
                ).applyQuaternion(body.state.orientation),
              );
            }
            return center;
          };
          let worldContactRows = 0;
          const originalStep = c.simulation.step.bind(c.simulation);
          c.simulation.step = (...args) => {
            const result = originalStep(...args);
            let bodyWorldContacts = 0;
            for (const impact of c.simulation.lastImpacts) {
              if (
                impact.a === headBody ||
                impact.b === headBody ||
                impact.a === boxBody ||
                impact.b === boxBody
              ) {
                const other = [headBody, boxBody].includes(impact.a)
                  ? impact.b
                  : impact.a;
                if (other !== c.player) bodyWorldContacts++;
                if (other !== c.player && worldContactTrace.length < 120)
                  worldContactTrace.push({
                    kind:
                      impact.a === headBody || impact.b === headBody
                        ? "HEAD"
                        : "BOX",
                    gameTimeMs: c.stats.gameTimeMs,
                    sourceType: impact.sourceType ?? null,
                    normal: impact.normal?.toArray?.() ?? null,
                    normalLength: impact.normal?.length?.() ?? null,
                    point: impact.point?.toArray?.() ?? null,
                    penetration: impact.penetration ?? null,
                    normalImpulse: impact.normalImpulse ?? null,
                    closingSpeed: impact.closingSpeed ?? null,
                    otherKind: other?.kind ?? "world-or-unknown",
                    actorPosition: (impact.a === headBody
                      ? headBody
                      : impact.b === headBody
                        ? headBody
                        : boxBody
                    ).state.position.toArray(),
                    shapeCenter: bodyCenter(
                      impact.a === headBody || impact.b === headBody
                        ? headBody
                        : boxBody,
                    ).toArray(),
                    orientation: (impact.a === headBody || impact.b === headBody
                      ? headBody
                      : boxBody
                    ).state.orientation.toArray(),
                    velocity: (impact.a === headBody || impact.b === headBody
                      ? headBody
                      : boxBody
                    ).state.velocity.toArray(),
                    localOmega: (impact.a === headBody || impact.b === headBody
                      ? headBody
                      : boxBody
                    ).localOmega.toArray(),
                    root12: Array.from(
                      (impact.a === headBody || impact.b === headBody
                        ? headBody
                        : boxBody
                      ).nativeMatrix.elements,
                    ).slice(0, 12),
                  });
                if (other === c.player) {
                  const kind =
                    impact.a === headBody || impact.b === headBody
                      ? "HEAD"
                      : "BOX";
                  const key = `${kind}:sourceType${impact.sourceType ?? "unknown"}`;
                  contactCounts[key] = (contactCounts[key] ?? 0) + 1;
                  if (contactTrace.length < 40)
                    contactTrace.push({
                      kind,
                      gameTimeMs: c.stats.gameTimeMs,
                      a:
                        impact.a === headBody
                          ? "HEAD"
                          : impact.a === boxBody
                            ? "BOX"
                            : impact.a === c.player
                              ? "EAGLE"
                              : "other",
                      b:
                        impact.b === headBody
                          ? "HEAD"
                          : impact.b === boxBody
                            ? "BOX"
                            : impact.b === c.player
                              ? "EAGLE"
                              : "other",
                      sourceType: impact.sourceType ?? null,
                      normalImpulse: impact.normalImpulse,
                      closingSpeed: impact.closingSpeed,
                    });
                }
              }
            }
            worldContactRows += bodyWorldContacts;
            window.__pedBoneFixture.worldContactRows = worldContactRows;
            if (bodyTrajectory.length < 100) {
              bodyTrajectory.push({
                gameTimeMs: c.stats.gameTimeMs,
                head: {
                  actor: headBody.state.position.toArray(),
                  center: bodyCenter(headBody).toArray(),
                  velocity: headBody.state.velocity.toArray(),
                  orientation: headBody.state.orientation.toArray(),
                  root12: Array.from(headBody.nativeMatrix.elements).slice(
                    0,
                    12,
                  ),
                  localOmega: headBody.localOmega.toArray(),
                  solverLocalVelocity: headBody.solverLocalVelocity.toArray(),
                  ec: headBody.ec,
                  headerState: c.simulation.phil.getState(headBody),
                  floorSupport: (() => {
                    const center = bodyCenter(headBody);
                    const origin = center.clone();
                    origin.y += 0.25;
                    const hit = c.simulation.world.raycast(
                      origin,
                      new center.constructor(0, -1, 0),
                      0.5,
                    );
                    return hit
                      ? {
                          point: hit.point.toArray(),
                          normal: hit.normal.toArray(),
                          centerDistance: center.y - hit.point.y,
                          material: hit.surface.material,
                          faceIndex: hit.surface.faceIndex ?? null,
                          materialFlags: hit.surface.materialFlags,
                          faceFlags: hit.surface.faceFlags,
                          pixelmapType: hit.surface.pixelmapType ?? null,
                          vertices: [
                            hit.surface.a.toArray(),
                            hit.surface.b.toArray(),
                            hit.surface.c.toArray(),
                          ],
                        }
                      : null;
                  })(),
                },
                box: {
                  actor: boxBody.state.position.toArray(),
                  orientation: boxBody.state.orientation.toArray(),
                  root12: Array.from(boxBody.nativeMatrix.elements).slice(
                    0,
                    12,
                  ),
                  velocity: boxBody.state.velocity.toArray(),
                  localOmega: boxBody.localOmega.toArray(),
                  ec: boxBody.ec,
                  headerState: c.simulation.phil.getState(boxBody),
                },
              });
            }
            return result;
          };
          const initial = {
            dataRoot,
            track: c.track?.path ?? null,
            driver:
              "controlled fixture placed in live Eagle velocity direction; real simulation and actual car contact expected",
            personality: template.form.name,
            boneCount: template.bones.length,
            move30: { status: selection.status, moveId: instance.moveId },
            intactGroupChildren: instance.group.children.length,
            headIndex: head.index,
            boxBoneIndex: boxBone.index,
            removedBoneMask: instance.removedBoneMask >>> 0,
            remainingBones: instance.group.children.length,
            head: {
              index: head.index,
              name: head.definition.name,
              type: head.definition.collisionType,
              mass: head.definition.mass,
              sourceModel: head.sourceName,
              actorName: head.liveBone.actor.name,
              modelVisible: !!head.liveBone.model,
              authoredBounds: head.bounds,
              shapeRadius: headBody.shape.radius,
              type5: headBody.rigidType,
              admittedState: c.simulation.phil.getState(headBody),
              position: headBody.state.position.toArray(),
              actualShapeCenter: bodyCenter(headBody).toArray(),
              floorRay: (() => {
                const origin = bodyCenter(headBody);
                origin.y += 2;
                const hit = c.simulation.world.raycast(
                  origin,
                  new c.player.state.position.constructor(0, -1, 0),
                  5,
                );
                return hit
                  ? {
                      point: hit.point.toArray(),
                      normal: hit.normal.toArray(),
                      distance: hit.distance,
                      material: hit.surface.material,
                      faceFlags: hit.surface.faceFlags,
                    }
                  : null;
              })(),
              worldBounds: c.simulation.world.triangles,
              flags: {
                ec: headBody.ec,
                sleep: headBody.motor?.sleeping ?? null,
                velocity: headBody.state.velocity.toArray(),
                omega: headBody.localOmega.toArray(),
                philHeaderPresent: !!c.simulation.phil.getHeader(headBody),
              },
            },
            box: {
              index: boxBone.index,
              name: boxBone.definition.name,
              type: boxBone.definition.collisionType,
              mass: boxBone.definition.mass,
              sourceModel: boxBone.sourceName,
              actorName: boxBone.liveBone.actor.name,
              modelVisible: !!boxBone.liveBone.model,
              authoredBounds: boxBone.bounds,
              type5: boxBody.rigidType,
              admittedState: c.simulation.phil.getState(boxBody),
              position: boxBody.state.position.toArray(),
            },
            philsBeforeDrive: c.simulation.phil.count,
            controlledCarSetup: {
              source:
                "simulation.rematerializePose fixture, then real W-driven physics",
              carPositionBefore: carBeforeSetup,
              carPositionAfter: player.state.position.toArray(),
              heading: forward.toArray(),
              launchSpeed: 1,
            },
          };
          window.__pedBoneFixture = {
            instance,
            headBody,
            boxBody,
            contactTrace,
            worldContactTrace,
            bodyTrajectory,
            contactCounts,
            worldContactRows,
            originalStep,
            impactFailures,
            originalApplyImpactDamage,
          };
          return initial;
        },
        { dataRoot },
      );
    } catch (error) {
      await writeFile(
        "artifacts/browser-ped-bone-runtime-load-failure.json",
        JSON.stringify(
          {
            dataRoot,
            error: String(error),
            failedRequests: report.failedRequests,
            badResponses: report.badResponses,
          },
          null,
          2,
        ),
      );
      throw error;
    }
    const caseResult = { ...fixture, carContacts: [], frames: 0 };
    const setupShot = await page.evaluate(() => {
      const c = window.carma;
      const { headBody } = window.__pedBoneFixture;
      const oldPosition = c.camera.position.clone();
      const oldQuaternion = c.camera.quaternion.clone();
      c.paused = true;
      document.querySelector("#panel").hidden = true;
      c.camera.position.copy(headBody.state.position);
      c.camera.position.x += 0.25;
      c.camera.position.y += 0.65;
      c.camera.position.z += 0.95;
      c.camera.lookAt(headBody.state.position);
      c.camera.updateMatrixWorld(true);
      c.renderer.render(c.scene, c.camera);
      const data = c.renderer.domElement.toDataURL("image/png");
      c.camera.position.copy(oldPosition);
      c.camera.quaternion.copy(oldQuaternion);
      c.camera.updateMatrixWorld(true);
      c.paused = false;
      return data;
    });
    await writeFile(
      `artifacts/ped-bone-${dataRoot}-setup.png`,
      Buffer.from(setupShot.split(",")[1], "base64"),
    );
    await page.locator("#view").click({ position: { x: 640, y: 400 } });
    const driveStart = await page.evaluate(() => ({
      gameTimeMs: window.carma.stats.gameTimeMs,
      position: window.carma.player.state.position.toArray(),
    }));
    caseResult.driveStart = driveStart;
    await page.keyboard.down("w");
    let driveProgress = null;
    let peakSimulatedMs = 0;
    let traveled = 0;
    let lastPosition = driveStart.position;
    let stopReason = "wall-clock-safety-bound";
    const wallDeadline = Date.now() + 30000;
    while (Date.now() < wallDeadline) {
      await page.waitForTimeout(100);
      driveProgress = await page.evaluate((start) => {
        const c = window.carma;
        const position = c.player.state.position.toArray();
        const counts = window.__pedBoneFixture.contactCounts;
        const hitKinds = ["HEAD", "BOX"].filter((kind) =>
          Object.keys(counts).some((key) => key.startsWith(`${kind}:`)),
        );
        return {
          gameTimeMs: c.stats.gameTimeMs,
          gameFrames: c.stats.gameFrames,
          position,
          displacement: Math.hypot(
            position[0] - start.position[0],
            position[1] - start.position[1],
            position[2] - start.position[2],
          ),
          hitKinds,
          contactCounts: { ...counts },
        };
      }, driveStart);
      peakSimulatedMs = Math.max(
        peakSimulatedMs,
        driveProgress.gameTimeMs - driveStart.gameTimeMs,
      );
      traveled += Math.hypot(
        driveProgress.position[0] - lastPosition[0],
        driveProgress.position[1] - lastPosition[1],
        driveProgress.position[2] - lastPosition[2],
      );
      lastPosition = driveProgress.position;
      if (driveProgress.hitKinds.length === 2) {
        stopReason = "head-and-box-car-contacts-confirmed";
        break;
      }
      if (peakSimulatedMs >= 12000) {
        stopReason = "simulated-duration-bound-reached";
        break;
      }
      if (traveled >= 12) {
        stopReason = "player-travel-bound-reached";
        break;
      }
    }
    await page.keyboard.up("w");
    const after = await page.evaluate(() => {
      const c = window.carma;
      const { headBody, boxBody, instance } = window.__pedBoneFixture;
      const contacts = c.simulation.lastImpacts
        .filter(
          (impact) =>
            impact.a === headBody ||
            impact.b === headBody ||
            impact.a === boxBody ||
            impact.b === boxBody,
        )
        .map((impact) => ({
          sourceType: impact.sourceType ?? null,
          normalImpulse: impact.normalImpulse,
          closingSpeed: impact.closingSpeed,
          a:
            impact.a === headBody
              ? "HEAD"
              : impact.a === boxBody
                ? "BOX"
                : impact.a === c.player
                  ? "EAGLE"
                  : (impact.a?.kind ?? "other"),
          b:
            impact.b === headBody
              ? "HEAD"
              : impact.b === boxBody
                ? "BOX"
                : impact.b === c.player
                  ? "EAGLE"
                  : (impact.b?.kind ?? "other"),
        }));
      return {
        gameFrames: c.stats.gameFrames,
        gameTimeMs: c.stats.gameTimeMs,
        playerPosition: c.player.state.position.toArray(),
        playerVelocity: c.player.state.velocity.toArray(),
        headPosition: headBody.state.position.toArray(),
        headVelocity: headBody.state.velocity.toArray(),
        boxPosition: boxBody.state.position.toArray(),
        boxVelocity: boxBody.state.velocity.toArray(),
        intactGroupChildren: instance.group.children.length,
        removedBoneMask: instance.removedBoneMask >>> 0,
        remainingBones: instance.group.children.length,
        philCount: c.simulation.phil.count,
        headState: c.simulation.phil.getState(headBody),
        boxState: c.simulation.phil.getState(boxBody),
        contacts,
        contactTrace: window.__pedBoneFixture.contactTrace,
        worldContactTrace: window.__pedBoneFixture.worldContactTrace,
        bodyTrajectory: window.__pedBoneFixture.bodyTrajectory,
        contactCounts: window.__pedBoneFixture.contactCounts,
        impactFailures: window.__pedBoneFixture.impactFailures,
        worldContactRows: window.__pedBoneFixture.worldContactRows ?? 0,
      };
    });
    caseResult.afterDrive = after;
    caseResult.drive = {
      stopReason,
      wallMs: 30000 - Math.max(0, wallDeadline - Date.now()),
      simulatedElapsedMs: driveProgress
        ? driveProgress.gameTimeMs - driveStart.gameTimeMs
        : 0,
      peakSimulatedElapsedMs: peakSimulatedMs,
      traveledMeters: traveled,
      finalProgress: driveProgress,
    };
    const supportSamples = after.bodyTrajectory
      .map((sample) => sample.head.floorSupport?.centerDistance)
      .filter(Number.isFinite);
    caseResult.floorSupport = {
      sampleCount: supportSamples.length,
      sphereRadius: fixture.head.shapeRadius,
      minimumCenterDistance: supportSamples.length
        ? Math.min(...supportSamples)
        : null,
      maximumCenterDistance: supportSamples.length
        ? Math.max(...supportSamples)
        : null,
      closestRadiusError: supportSamples.length
        ? Math.min(
            ...supportSamples.map((distance) =>
              Math.abs(distance - fixture.head.shapeRadius),
            ),
          )
        : null,
    };
    caseResult.carContacts = after.contactTrace.filter(
      (contact) => contact.a === "EAGLE" || contact.b === "EAGLE",
    );
    caseResult.carContactCounts = after.contactCounts;
    const observedCarContactKinds = ["HEAD", "BOX"].filter((kind) =>
      Object.keys(after.contactCounts).some((key) =>
        key.startsWith(`${kind}:`),
      ),
    );
    caseResult.contactCoverage = {
      hitKinds: observedCarContactKinds,
      anyActualContact: observedCarContactKinds.length > 0,
      complete: observedCarContactKinds.length === 2,
    };
    report.cases.push(caseResult);
    await writeFile(
      "artifacts/browser-ped-bone-runtime-progress.json",
      JSON.stringify(report, null, 2),
    );

    const shot = await page.evaluate(async () => {
      const c = window.carma;
      const { headBody } = window.__pedBoneFixture;
      c.paused = true;
      document.querySelector("#panel").hidden = true;
      c.camera.position.copy(headBody.state.position);
      c.camera.position.x += 0.25;
      c.camera.position.y += 0.25;
      c.camera.position.z += 0.55;
      c.camera.lookAt(headBody.state.position);
      c.camera.updateMatrixWorld(true);
      c.renderer.render(c.scene, c.camera);
      return c.renderer.domElement.toDataURL("image/png");
    });
    await writeFile(
      `artifacts/ped-bone-${dataRoot}-after.png`,
      Buffer.from(shot.split(",")[1], "base64"),
    );
    const webgl = await page.evaluate(() => {
      const gl = window.carma.renderer.getContext();
      const errors = [];
      for (let i = 0; i < 16; i++) {
        const error = gl.getError();
        if (error === gl.NO_ERROR) break;
        errors.push(error);
      }
      return { isWebGL2: gl instanceof WebGL2RenderingContext, errors };
    });
    report.webgl.push({ dataRoot, ...webgl });
    await writeFile(
      "artifacts/browser-ped-bone-runtime-progress.json",
      JSON.stringify(report, null, 2),
    );

    caseResult.assertionFailures = [];
    const verify = (condition, message) => {
      if (!condition) caseResult.assertionFailures.push(message);
    };
    verify(
      fixture.head.type === "SPHERE",
      "HEAD must use authored SPHERE type",
    );
    verify(fixture.box.type === "BOX", "body must use authored BOX type");
    verify(
      fixture.head.modelVisible && fixture.box.modelVisible,
      "HEAD and BOX render models must be present",
    );
    const expectedRemovedMask =
      ((1 << fixture.headIndex) | (1 << fixture.boxBoneIndex)) >>> 0;
    verify(
      fixture.removedBoneMask === expectedRemovedMask,
      "only the selected HEAD and BOX bones should be removed",
    );
    verify(
      fixture.intactGroupChildren === fixture.boneCount - 2 &&
        after.intactGroupChildren === fixture.intactGroupChildren &&
        after.removedBoneMask === expectedRemovedMask &&
        after.remainingBones === fixture.intactGroupChildren,
      "intact FORM instance must retain all other bones",
    );
    verify(
      after.headState === 2 && after.boxState === 2,
      "both detached bodies must remain in active PHIL state 2",
    );
    verify(
      stopReason !== "wall-clock-safety-bound",
      "drive must end on native contact or a simulated-time/travel bound",
    );
    verify(
      caseResult.contactCoverage.complete,
      "real Eagle impact rows must include both authored HEAD and BOX bodies",
    );
    verify(
      caseResult.floorSupport.sampleCount > 0 &&
        caseResult.floorSupport.closestRadiusError <= 0.01,
      "sampled SPHERE centers must contact an authored road within radius tolerance",
    );
    verify(
      caseResult.floorSupport.minimumCenterDistance >=
        fixture.head.shapeRadius - 0.01,
      "sampled SPHERE centers must not penetrate authored road surfaces",
    );
    verify(
      after.headPosition.every(Number.isFinite) &&
        after.boxPosition.every(Number.isFinite),
      "detached body state must remain finite",
    );
    verify(webgl.errors.length === 0, "WebGL must report no errors");
    // Bodies are removed before loading another source track; the instance's
    // original model resources are not disposed or mutated by the test.
    caseResult.teardown = await page.evaluate(() => {
      const c = window.carma;
      const {
        headBody,
        boxBody,
        instance,
        originalStep,
        originalApplyImpactDamage,
      } = window.__pedBoneFixture;
      c.simulation.step = originalStep;
      c.simulation.applyImpactDamage = originalApplyImpactDamage;
      c.simulation.removePedBoneBody(headBody);
      c.simulation.removePedBoneBody(boxBody);
      const headersAfterRemoval = c.simulation.phil.count;
      instance.group.removeFromParent();
      headBody.actor.removeFromParent();
      boxBody.actor.removeFromParent();
      window.__pedBoneFixture = null;
      c.paused = false;
      return {
        headersAfterRemoval,
        headHeader: c.simulation.phil.getHeader(headBody),
        boxHeader: c.simulation.phil.getHeader(boxBody),
      };
    });
    verify(
      caseResult.teardown.headersAfterRemoval ===
        fixture.philsBeforeDrive - 2 &&
        caseResult.teardown.headHeader === null &&
        caseResult.teardown.boxHeader === null,
      "teardown must release both PHIL headers",
    );
    await writeFile(
      "artifacts/browser-ped-bone-runtime-progress.json",
      JSON.stringify(report, null, 2),
    );
  }

  const gl = await page.evaluate(() => {
    const context = window.carma.renderer.getContext();
    const errors = [];
    for (let i = 0; i < 16; i++) {
      const code = context.getError();
      if (code === context.NO_ERROR) break;
      errors.push(code);
    }
    return { isWebGL2: context instanceof WebGL2RenderingContext, errors };
  });
  report.webgl.push({ final: true, ...gl });
  report.uncovered = [
    "No source-driven pedestrian walk population or native damage/sever caller is integrated by this diagnostic.",
    "Driver contact is only counted when the live Eagle appears in the real simulation impact rows; fixture positioning is controlled.",
  ];
  await writeFile(
    "artifacts/browser-ped-bone-runtime.json",
    JSON.stringify(report, null, 2),
  );
  const caseFailures = report.cases.flatMap((entry) =>
    (entry.assertionFailures ?? []).map(
      (message) => `${entry.dataRoot}: ${message}`,
    ),
  );
  assert.deepEqual(caseFailures, [], JSON.stringify(caseFailures));
  assert.deepEqual(report.errors, [], JSON.stringify(report.errors));
  assert.deepEqual(
    report.failedRequests,
    [],
    JSON.stringify(report.failedRequests),
  );
  assert.deepEqual(
    report.badResponses,
    [],
    JSON.stringify(report.badResponses),
  );
  assert.ok(report.webgl.every((sample) => sample.errors.length === 0));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
