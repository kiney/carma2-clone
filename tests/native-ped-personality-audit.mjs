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
  console.log("SKIP native pedestrian audit: Chromium or C2 assets absent.");
  process.exit(0);
}

await mkdir("artifacts", { recursive: true });
const port = 5221;
const server = spawn(process.execPath, ["server/dev.mjs"], {
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
  const page = await browser.newPage();
  page.setDefaultTimeout(90000);
  const errors = [];
  const failedRequests = [];
  const badResponses = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
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

  const inventory = await page.evaluate(async () => {
    const assets = window.carma.assets;
    const [
      { loadNativePedAssets },
      { prepareNativePedDeadModels, NativePedDeadMaterialRegistry },
      { createNativePedInstance, selectNativePedMove },
    ] = await Promise.all([
      import("/src/ped-native-assets.ts"),
      import("/src/ped-dead-models.ts"),
      import("/src/ped-native-instance.ts"),
    ]);
    window.__nativePedAudit = {
      assets,
      loadNativePedAssets,
      prepareNativePedDeadModels,
      NativePedDeadMaterialRegistry,
      createNativePedInstance,
      selectNativePedMove,
      registries: new Map(),
    };
    return ["data", "adv_data"].map((root) => {
      const prefix = `${root}/PEDS/PEEPS/`;
      const files = assets.manifest
        .filter(
          (entry) =>
            entry.path.toLowerCase().startsWith(prefix.toLowerCase()) &&
            /\.txt$/i.test(entry.path),
        )
        .map((entry) => entry.path)
        .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
      return {
        root,
        personalities: files.map((path) => {
          const relative = path.slice(prefix.length);
          const parts = relative.split("/");
          const filename = parts.pop();
          return {
            path,
            personDirectory: `PEDS/PEEPS/${parts.join("/")}`,
            stem: filename.replace(/\.txt$/i, ""),
          };
        }),
      };
    });
  });

  const report = {
    source:
      "Original asset manifest through Assets; source loader/instance/dead-model modules imported from the dev server.",
    roots: [],
    errors,
    failedRequests,
    badResponses,
  };
  await writeFile(
    "artifacts/native-ped-personality-audit.json",
    JSON.stringify(report, null, 2),
  );

  for (const rootInventory of inventory) {
    const rootResult = {
      dataRoot: rootInventory.root,
      personalityCount: rootInventory.personalities.length,
      personalities: [],
    };
    report.roots.push(rootResult);
    for (
      let offset = 0;
      offset < rootInventory.personalities.length;
      offset += 4
    ) {
      const batch = rootInventory.personalities.slice(offset, offset + 4);
      const results = await page.evaluate(
        async (items) => {
          const api = window.__nativePedAudit;
          return await Promise.all(
            items.map(async ({ personDirectory, stem, path }) => {
              let template;
              let dead;
              let instance;
              let stage = "loadNativePedAssets";
              const row = { path, stem, stages: {}, warnings: [] };
              try {
                const dataRoot = items.find((item) => item.path === path).root;
                template = await api.loadNativePedAssets(
                  api.assets,
                  personDirectory,
                  stem,
                  dataRoot,
                );
                row.stages.loaded = true;
                const rootBone = template.bones[0];
                const rootVariant = rootBone?.variants[0];
                const rootMesh = rootVariant?.actor?.children.find(
                  (node) => node.isMesh,
                );
                row.template = {
                  form: template.form.name,
                  boneCount: template.bones.length,
                  profile: {
                    mass: template.profile.mass,
                    bounds: template.profile.bounds,
                    centreOfMass: [...template.profile.centreOfMass],
                    radius: template.profile.radius,
                    inertia: [...template.profile.inertia],
                  },
                  moveCount: template.moves.size,
                  move30: template.moves.has(30),
                  nullableVariants: template.bones.flatMap((bone) =>
                    bone.variants
                      .map((variant, poseIndex) =>
                        variant.actor
                          ? null
                          : {
                              bone: bone.name,
                              poseIndex,
                              identifier: variant.identifier,
                            },
                      )
                      .filter(Boolean),
                  ),
                  bones: template.bones.map((bone) => ({
                    index: bone.index,
                    name: bone.name,
                    parent: bone.parent,
                    massKg: bone.massKg,
                    mass: bone.mass,
                    collisionType: bone.collisionType,
                    jointType: bone.jointType,
                    attachments: bone.attachments
                      ? {
                          child: [...bone.attachments.child],
                          parent: [...bone.attachments.parent],
                        }
                      : null,
                    variants: bone.variants.map((variant, poseIndex) => ({
                      poseIndex,
                      identifier: variant.identifier,
                      isNull: variant.actor === null,
                      sourceModels: [...variant.sourceModels],
                    })),
                  })),
                  root:
                    rootVariant && rootMesh
                      ? {
                          identifier: rootVariant.identifier,
                          sourceModels: [...rootVariant.sourceModels],
                          vertices:
                            rootMesh.geometry.userData.sourcePositions?.length /
                              3 ?? 0,
                          faces:
                            rootMesh.geometry.userData.sourceFaces?.length ?? 0,
                          materialNames: (Array.isArray(rootMesh.material)
                            ? rootMesh.material
                            : [rootMesh.material]
                          ).map((material) => material?.name ?? null),
                          inheritedActorMaterial:
                            template.inheritedActorMaterial?.name ?? null,
                          inheritedActorMaterialFlags:
                            template.inheritedActorMaterial?.userData
                              ?.c2Flags ?? null,
                          rootModelBounds: [...rootVariant.modelBounds].map(
                            ([name, bounds]) => ({
                              name,
                              min: bounds.min.toArray(),
                              max: bounds.max.toArray(),
                            }),
                          ),
                        }
                      : null,
                  rootGraph: {
                    parent: rootVariant?.actor?.parent?.name ?? null,
                    siblingOfOthers: template.group.children
                      .filter((child) => child !== rootVariant?.actor)
                      .every((child) => child.parent === template.group),
                    identityMatrix:
                      rootVariant?.actor?.matrix?.elements?.every(
                        (value, index) =>
                          value ===
                          [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1][
                            index
                          ],
                      ) ?? false,
                  },
                };
                stage = "prepareNativePedDeadModels";
                let registry = api.registries.get(dataRoot);
                if (!registry) {
                  registry = new api.NativePedDeadMaterialRegistry();
                  api.registries.set(dataRoot, registry);
                }
                dead = api.prepareNativePedDeadModels(stem, template, {
                  materialRegistry: registry,
                  nullFaceMaterial: () => template.inheritedActorMaterial,
                });
                row.stages.deadModels = true;
                row.deadModels = {
                  count: dead.models.length,
                  diagnostics: [...dead.diagnostics],
                  missingClonePointers: dead.models.filter((model) =>
                    model.faceMaterials.some((material) => material === null),
                  ).length,
                  identifiers: dead.models
                    .slice(0, 12)
                    .map((model) => ({
                      boneIndex: model.boneIndex,
                      poseIndex: model.poseIndex,
                      source: model.sourceIdentifier,
                      identifier: model.identifier,
                    })),
                };
                stage = "createNativePedInstance";
                const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
                instance = api.createNativePedInstance(template, {
                  rootPose: identity,
                  modelSet1: dead.modelSet1,
                });
                row.stages.instance = true;
                stage = "selectNativePedMove(30)";
                const selection = api.selectNativePedMove(
                  instance,
                  30,
                  [0, 0, 1],
                  [0, 1, 0],
                  100,
                  { groundHeight: 0 },
                );
                row.stages.move30Selection = selection.status === "complete";
                row.move30Selection = {
                  status: selection.status,
                  requiredProviders: [...selection.requiredProviders],
                  processedFrames: selection.processedFrames,
                  completedMove: selection.completedMove,
                  selectedMoveId: instance.moveId,
                  selectedFrameCount: instance.move?.roots.length ?? 0,
                  moveRecord: template.moves.get(30)
                    ? {
                        periodMs: template.moves.get(30).form.periodMs,
                        frames: template.moves.get(30).motion.frameCount,
                        personalityRecord:
                          template.moves.get(30).personality !== null,
                      }
                    : null,
                };
                row.warnings = [...template.scene.group.children].length
                  ? []
                  : ["source scene root is empty"];
              } catch (error) {
                row.failure = {
                  stage,
                  error: error instanceof Error ? error.message : String(error),
                  stack: error instanceof Error ? error.stack : null,
                };
                row.stages[stage] = false;
              } finally {
                dead?.dispose();
                instance?.group.clear();
                template?.group.clear();
                template = undefined;
                dead = undefined;
                instance = undefined;
              }
              return row;
            }),
          );
        },
        batch.map((item) => ({ ...item, root: rootInventory.root })),
      );
      rootResult.personalities.push(...results);
      report.roots = report.roots.map((item) =>
        item === rootResult ? rootResult : item,
      );
      await writeFile(
        "artifacts/native-ped-personality-audit.json",
        JSON.stringify(report, null, 2),
      );
      console.log(
        `${rootInventory.root}: ${Math.min(offset + batch.length, rootInventory.personalities.length)}/${rootInventory.personalities.length}`,
      );
    }
    await page.evaluate((root) => {
      window.__nativePedAudit.registries.get(root)?.dispose();
      window.__nativePedAudit.registries.get(root)?.materials.clear();
      window.__nativePedAudit.registries.delete(root);
    }, rootInventory.root);
  }

  await page.evaluate(() => {
    window.__nativePedAudit = undefined;
  });
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
  report.webgl = gl;
  report.summary = report.roots.map((root) => ({
    dataRoot: root.dataRoot,
    personalityCount: root.personalityCount,
    loaded: root.personalities.filter((row) => row.stages.loaded).length,
    deadModels: root.personalities.filter((row) => row.stages.deadModels)
      .length,
    instances: root.personalities.filter((row) => row.stages.instance).length,
    move30Available: root.personalities.filter((row) => row.template?.move30)
      .length,
    move30Selected: root.personalities.filter(
      (row) => row.stages.move30Selection,
    ).length,
    failures: root.personalities.filter((row) => row.failure).length,
    fixtureReady: root.personalities.filter((row) => row.stages.move30Selection)
      .length,
    errorGroups: [
      ...root.personalities
        .filter((row) => row.failure)
        .reduce((groups, row) => {
          const key = `${row.failure.stage}: ${row.failure.error}`;
          groups.set(key, (groups.get(key) ?? 0) + 1);
          return groups;
        }, new Map()),
    ].map(([error, count]) => ({ count, error })),
  }));
  report.fixturePrerequisites = report.roots.map((root) => ({
    dataRoot: root.dataRoot,
    readyPersonalities: root.personalities
      .filter((row) => row.stages.move30Selection)
      .map((row) => row.stem),
    missingOrInvalidPersonalities: root.personalities
      .filter((row) => row.failure)
      .map((row) => ({ stem: row.stem, path: row.path, ...row.failure })),
    validFixtureNeeds: [
      "A matching PEEPS personality TXT, FORM, default move table and its named ACT/DAT/MAT assets must be present.",
      "FORM must expose a flat root bone and a move 30 personality record; successful cases select move 30 with no required providers.",
      "Dead-model preparation uses the resolved inherited ACT/default material as the explicit NULL-face fallback.",
    ],
  }));
  await writeFile(
    "artifacts/native-ped-personality-audit.json",
    JSON.stringify(report, null, 2),
  );
  assert.deepEqual(errors, [], JSON.stringify(errors));
  assert.deepEqual(failedRequests, [], JSON.stringify(failedRequests));
  assert.deepEqual(badResponses, [], JSON.stringify(badResponses));
  assert.deepEqual(gl.errors, [], "native pedestrian audit WebGL");
  console.log(
    JSON.stringify(
      {
        summary: report.summary,
        webgl: gl,
        report: "artifacts/native-ped-personality-audit.json",
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
