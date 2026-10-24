import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: {
    race: { type: "string", default: "data/RACES/newcity1/newcity1.txt" },
    car: { type: "string", default: "data/CARS/EAGLE3/EAGLE3.TXT" },
    cycles: { type: "string", default: "6" },
    "second-scene": { type: "string" },
    opponents: { type: "string", default: "1,2" },
    output: { type: "string", default: "artifacts/resource-lifetime.json" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(`Short, serial resource audit across repeated original race loads.
Usage: node tools/audit-resources.mjs [options]
  --race PATH          Original race TXT path
  --car PATH           Original car TXT path
  --cycles N           Total primary loads, including initial load (3–8; default 6)
  --opponents IDS      Explicit native opponent IDs for reloads (default 1,2)
  --second-scene PATH  Optional second race TXT; total loads may not exceed 8
  --output PATH        Ignored JSON report path (default artifacts/resource-lifetime.json)
The script builds a temporary production copy, uses one headless Chromium page,
keeps simulation paused, and writes no installation data. Original assets are optional.`);
  process.exit(0);
}

const cycles = Number(values.cycles);
const opponentIds = values.opponents.split(",").map(Number);
if (
  !Number.isSafeInteger(cycles) ||
  cycles < 3 ||
  cycles > 8 ||
  (values["second-scene"] && cycles + 2 > 8) ||
  opponentIds.length !== 2 ||
  opponentIds.some((id) => !Number.isSafeInteger(id) || id < 0)
)
  throw new Error(
    "Use 3–8 cycles and exactly two nonnegative opponent IDs; an optional scene adds two loads.",
  );

const rootPath = path.resolve(
  process.env.CARMA2_ROOT || path.join(repo, "carma2_orig"),
);
let root;
try {
  root = await realpath(rootPath);
  await access(path.join(root, "carma2.exe"));
  await access(process.env.CHROMIUM_PATH || "/usr/bin/chromium");
} catch {
  console.log(
    "SKIP resource audit: original installation or Chromium is unavailable.",
  );
  process.exit(0);
}

const output = path.resolve(repo, values.output);
const insideRoot = (candidate) =>
  candidate === root || candidate.startsWith(root + path.sep);
let outputParent = path.dirname(output),
  missingSegments = [];
let canonicalParent;
while (!canonicalParent) {
  try {
    canonicalParent = await realpath(outputParent);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    missingSegments.unshift(path.basename(outputParent));
    const parent = path.dirname(outputParent);
    if (parent === outputParent) throw error;
    outputParent = parent;
  }
}
const canonicalCandidate = path.join(
  canonicalParent,
  ...missingSegments,
  path.basename(output),
);
let canonicalOutput = canonicalCandidate;
try {
  canonicalOutput = await realpath(output);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (
  insideRoot(output) ||
  insideRoot(canonicalCandidate) ||
  insideRoot(canonicalOutput)
)
  throw new Error(
    "Resource reports cannot be written inside the original installation.",
  );

const temp = await mkdtemp(path.join(os.tmpdir(), "carma-resource-audit-"));
const port = 5350 + Math.floor(Math.random() * 1000);
let server, browser, page, cdp;
let serverLog = "";
const report = {
  test: "QUA-06 short serial repeated scene load resource audit",
  installationRootName: path.basename(root),
  requestedRace: values.race,
  requestedCar: values.car,
  requestedOpponentIds: opponentIds,
  primaryLoads: cycles,
  optionalSecondScene: values["second-scene"] ?? null,
  backend: null,
  initial: null,
  samples: [],
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "",
      stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += chunk));
    child.stderr?.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`)),
    );
  });
}

try {
  // Snapshot source before building so concurrent root edits cannot change the
  // served bundle during capture; never build into the shared dist directory.
  await Promise.all(
    [
      "src",
      "server",
      "index.html",
      "vite.config.js",
      "LICENSE",
      "THIRD_PARTY_LICENSES.txt",
    ].map((item) =>
      cp(path.join(repo, item), path.join(temp, item), { recursive: true }),
    ),
  );
  await symlink(
    path.join(repo, "node_modules"),
    path.join(temp, "node_modules"),
    "dir",
  );
  await run(
    process.execPath,
    [
      path.join(repo, "node_modules/vite/bin/vite.js"),
      "build",
      "--outDir",
      "dist",
    ],
    { cwd: temp },
  );

  server = spawn(
    process.execPath,
    [path.join(temp, "server/dev.mjs"), "--production"],
    {
      cwd: temp,
      env: { ...process.env, CARMA2_ROOT: root, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => (serverLog += chunk));
  server.stderr.on("data", (chunk) => (serverLog += chunk));
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/manifest`);
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null)
      throw new Error(`Asset server stopped: ${serverLog}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(
    ready,
    `Temporary production asset server did not start: ${serverLog}`,
  );
  const manifest = await (
    await fetch(`http://127.0.0.1:${port}/api/manifest`)
  ).json();
  const findPath = (requested) =>
    manifest.assets.find(
      (entry) => entry.path.toLowerCase() === requested.toLowerCase(),
    )?.path;
  const racePath = findPath(values.race);
  const carPath = findPath(values.car);
  const secondPath = values["second-scene"]
    ? findPath(values["second-scene"])
    : undefined;
  if (!racePath || !carPath || (values["second-scene"] && !secondPath)) {
    console.log(
      "SKIP resource audit: requested original race or car is absent from the indexed installation.",
    );
    process.exitCode = 0;
  } else {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      headless: true,
      args: [
        "--no-sandbox",
        "--enable-unsafe-swiftshader",
        "--use-gl=angle",
        "--use-angle=swiftshader",
      ],
    });
    page = await browser.newPage({ viewport: { width: 960, height: 640 } });
    page.on("pageerror", (error) => report.pageErrors.push(String(error)));
    page.on("console", (message) => {
      if (message.type() === "error") report.consoleErrors.push(message.text());
    });
    page.on("requestfailed", (request) =>
      report.failedRequests.push(
        `${request.url()}: ${request.failure()?.errorText}`,
      ),
    );
    await page.addInitScript(() => {
      if (typeof WebGL2RenderingContext === "undefined") return;
      const contexts = new WeakMap();
      const objectIds = new WeakMap();
      let nextContextId = 1,
        nextObjectId = 1;
      const identity = (value) => {
        if (
          (typeof value !== "object" || value === null) &&
          typeof value !== "function"
        )
          return null;
        let id = objectIds.get(value);
        if (!id) {
          id = nextObjectId++;
          objectIds.set(value, id);
        }
        return id;
      };
      const stateFor = (gl) => {
        let state = contexts.get(gl);
        if (state) return state;
        state = {
          contextId: nextContextId++,
          activeUnit: gl.TEXTURE0,
          bindings: new Map(),
          handles: new WeakMap(),
          live: new Map(),
          createdCount: 0,
          deletedCount: 0,
          unknownDeleteCount: 0,
          nextHandleId: 1,
          recentDeletes: [],
          objectIdentity: identity,
        };
        contexts.set(gl, state);
        return state;
      };
      const targetForBinding = (gl, target) =>
        target >= gl.TEXTURE_CUBE_MAP_POSITIVE_X &&
        target <= gl.TEXTURE_CUBE_MAP_NEGATIVE_Z
          ? gl.TEXTURE_CUBE_MAP
          : target;
      const boundHandle = (gl, state, target) =>
        state.bindings.get(state.activeUnit)?.get(targetForBinding(gl, target));
      const stack = () =>
        new Error("texture allocation").stack?.split("\n").slice(2, 9) ?? [];
      const recordUpload = (gl, state, method, args) => {
        const target = args[0],
          handle = boundHandle(gl, state, target),
          record = handle && state.handles.get(handle);
        if (!record) return;
        const imageOverload =
            (method === "texImage2D" && args.length < 9) ||
            (method === "texSubImage2D" && args.length < 9),
          source =
            method === "texImage2D"
              ? args.length >= 9
                ? args[8]
                : args[5]
              : args.length >= 9
                ? args[8]
                : args[6],
          width = imageOverload
            ? (source?.width ?? source?.videoWidth ?? null)
            : args[method === "texImage2D" ? 3 : 4],
          height = imageOverload
            ? (source?.height ?? source?.videoHeight ?? null)
            : args[method === "texImage2D" ? 4 : 5];
        record.uploadCount++;
        record.lastUpload = {
          method,
          target,
          width: Number.isFinite(width) ? width : null,
          height: Number.isFinite(height) ? height : null,
          sourceObjectId: identity(source),
          imageOverload,
        };
      };
      const proto = WebGL2RenderingContext.prototype;
      const wrap = (name, after) => {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name),
          original = descriptor?.value;
        if (typeof original !== "function" || original.__resourceAuditWrapped)
          return;
        const wrapped = function (...args) {
          const result = original.apply(this, args);
          after(this, args, result);
          return result;
        };
        Object.defineProperty(wrapped, "__resourceAuditWrapped", {
          value: true,
        });
        Object.defineProperty(proto, name, { ...descriptor, value: wrapped });
      };
      wrap("createTexture", (gl, _args, texture) => {
        if (!texture) return;
        const state = stateFor(gl),
          record = {
            id: state.nextHandleId++,
            createdContextId: state.contextId,
            createdStack: stack(),
            uploadCount: 0,
            lastUpload: null,
            lastKnownOwners: [],
          };
        state.handles.set(texture, record);
        state.live.set(texture, record);
        state.createdCount++;
      });
      wrap("deleteTexture", (gl, args) => {
        const state = stateFor(gl),
          handle = args[0],
          record = handle && state.handles.get(handle);
        if (!record || !state.live.delete(handle)) {
          state.unknownDeleteCount++;
          return;
        }
        state.deletedCount++;
        state.recentDeletes.push({
          id: record.id,
          lastUpload: record.lastUpload,
          lastKnownOwners: record.lastKnownOwners.slice(-12),
        });
        if (state.recentDeletes.length > 512) state.recentDeletes.shift();
      });
      wrap("activeTexture", (gl, args) => {
        stateFor(gl).activeUnit = args[0];
      });
      wrap("bindTexture", (gl, args) => {
        const state = stateFor(gl),
          target = targetForBinding(gl, args[0]),
          unit = state.bindings.get(state.activeUnit) ?? new Map();
        unit.set(target, args[1]);
        state.bindings.set(state.activeUnit, unit);
      });
      wrap("texStorage2D", (gl, args) => {
        const state = stateFor(gl),
          record = state.handles.get(boundHandle(gl, state, args[0]));
        if (!record) return;
        record.storage = {
          target: args[0],
          levels: args[1],
          internalFormat: args[2],
          width: args[3],
          height: args[4],
        };
      });
      wrap("texImage2D", (gl, args) =>
        recordUpload(gl, stateFor(gl), "texImage2D", args),
      );
      wrap("texSubImage2D", (gl, args) =>
        recordUpload(gl, stateFor(gl), "texSubImage2D", args),
      );
      window.__resourceGLAudit = { get: (gl) => contexts.get(gl), identity };
    });
    await page.addInitScript(
      ({ track, car }) =>
        localStorage.setItem("c2-selection", JSON.stringify({ track, car })),
      { track: racePath, car: carPath },
    );
    await page.goto(`http://127.0.0.1:${port}`);
    await page.waitForFunction(
      () =>
        window.carma?.stats.ready &&
        window.carma?.paused &&
        window.carma.populationLoadState?.opponents.state !== "loading" &&
        window.carma.populationLoadState?.pedestrians.state !== "loading",
      null,
      { timeout: 120000 },
    );
    await page.waitForFunction(() => window.carma.paused, null, {
      timeout: 30000,
    });
    cdp = await page.context().newCDPSession(page);
    await cdp.send("HeapProfiler.enable");

    await page.evaluate(() => {
      const c = window.carma;
      const sampleObject = (object) => ({
        uuid: object.uuid,
        name: object.name ?? "",
      });
      const probe = { disposed: { texture: [], material: [], geometry: [] } };
      probe.webglHandles = new WeakMap();
      probe.nextWebglHandleId = 1;
      const visual = (object) =>
        object.isMesh || object.isSprite || object.isLine || object.isPoints;
      const prototypes = {
        texture: new Set(),
        material: new Set(),
        geometry: new Set(),
      };
      const addPrototype = (kind, object) => {
        for (
          let prototype = object?.constructor?.prototype;
          prototype;
          prototype = Object.getPrototypeOf(prototype)
        )
          if (Object.hasOwn(prototype, "dispose"))
            prototypes[kind].add(prototype);
      };
      for (const texture of c.assets.textures.values())
        addPrototype("texture", texture);
      c.scene.traverse((item) => {
        if (item.isMesh || item.isLine || item.isPoints)
          addPrototype("geometry", item.geometry);
        if (!visual(item)) return;
        for (const material of Array.isArray(item.material)
          ? item.material
          : [item.material]) {
          addPrototype("material", material);
          addPrototype("texture", material.map);
        }
      });
      for (const [kind, list] of Object.entries(prototypes)) {
        for (const prototype of list) {
          if (
            !Object.hasOwn(prototype, "dispose") ||
            prototype.__resourceAuditWrapped
          )
            continue;
          const original = prototype.dispose;
          Object.defineProperty(prototype, "__resourceAuditWrapped", {
            value: true,
          });
          prototype.dispose = function (...args) {
            probe.disposed[kind].push(sampleObject(this));
            return original.apply(this, args);
          };
        }
      }
      window.__resourceAuditProbe = probe;
    });

    const readMetrics = async (label) => {
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await cdp.send("HeapProfiler.collectGarbage");
      const heap = await cdp.send("Runtime.getHeapUsage");
      return page.evaluate(
        async ({ label, heap }) => {
          const c = window.carma,
            gl = c.renderer.getContext();
          const debug = gl.getExtension("WEBGL_debug_renderer_info");
          const active = {
            geometry: new Set(),
            material: new Set(),
            texture: new Set(),
          };
          const glAudit = window.__resourceGLAudit?.get(gl),
            currentHandles = new Set(),
            currentSourceObjects = new Set(),
            renderableTextures = new Map();
          const visual = (object) =>
            object.isMesh ||
            object.isSprite ||
            object.isLine ||
            object.isPoints;
          const collectTextures = (material) => {
            const found = new Set(),
              visited = new Set();
            const visit = (value, depth = 0) => {
              if (
                !value ||
                (typeof value !== "object" && typeof value !== "function")
              )
                return;
              if (value.isTexture) {
                found.add(value);
                return;
              }
              if (depth >= 3 || visited.has(value)) return;
              visited.add(value);
              const values = Array.isArray(value)
                ? value
                : Object.values(value);
              for (const entry of values) visit(entry, depth + 1);
            };
            for (const value of Object.values(material)) visit(value);
            visit(material.uniforms);
            return found;
          };
          const addTextureOwner = (texture, owner) => {
            const owners = renderableTextures.get(texture) ?? [];
            if (owner && !owners.includes(owner)) owners.push(owner);
            renderableTextures.set(texture, owners);
          };
          c.scene.traverse((item) => {
            if (item.isMesh || item.isLine || item.isPoints)
              active.geometry.add(item.geometry.uuid);
            if (!visual(item)) return;
            for (const material of Array.isArray(item.material)
              ? item.material
              : [item.material]) {
              active.material.add(material.uuid);
              for (const texture of collectTextures(material)) {
                active.texture.add(texture.uuid);
                addTextureOwner(
                  texture,
                  `scene:${item.type}:${item.name || "(unnamed)"}/${material.name || "(unnamed material)"}`,
                );
              }
            }
          });
          const sharedTextures = new Set(c.assets.textures.values());
          const sharedBySource = new Map();
          for (const [key, texture] of c.assets.textures) {
            const sourceId = texture.source?.uuid;
            if (!sourceId) continue;
            const keys = sharedBySource.get(sourceId) ?? [];
            keys.push(key);
            sharedBySource.set(sourceId, keys);
          }
          for (const texture of sharedTextures)
            active.texture.add(texture.uuid);
          const probe = window.__resourceAuditProbe;
          const sourceObjectIds = (texture) =>
            [
              texture.image,
              texture.image?.data,
              texture.source?.data,
              texture.source?.data?.data,
            ]
              .map((value) => glAudit?.objectIdentity(value))
              .filter((id) => id !== null && id !== undefined);
          const textureState = (texture, owners = []) => {
            const properties = c.renderer.properties.get(texture);
            const handle = properties.__webglTexture;
            const sourceIds = sourceObjectIds(texture);
            for (const id of sourceIds) currentSourceObjects.add(id);
            let webglHandleId = null;
            if (handle && typeof handle === "object") {
              webglHandleId = probe.webglHandles.get(handle);
              if (!webglHandleId) {
                webglHandleId = probe.nextWebglHandleId++;
                probe.webglHandles.set(handle, webglHandleId);
              }
              currentHandles.add(handle);
              const live = glAudit?.live.get(handle);
              if (live) {
                for (const owner of owners) {
                  const signature = `${owner}|${texture.uuid}`;
                  if (
                    !live.lastKnownOwners.some(
                      (known) => known.signature === signature,
                    )
                  )
                    live.lastKnownOwners.push({
                      signature,
                      owner,
                      textureName: texture.name ?? "",
                      textureUuid: texture.uuid,
                      textureSourceUuid: texture.source?.uuid ?? null,
                    });
                  if (live.lastKnownOwners.length > 24)
                    live.lastKnownOwners.shift();
                }
              }
            }
            return {
              uuid: texture.uuid,
              name: texture.name ?? "",
              sourceUuid: texture.source?.uuid ?? null,
              sourceObjectIds: sourceIds,
              sharedSourceKeys: sharedBySource.get(texture.source?.uuid) ?? [],
              initialized: properties.__webglInit !== undefined,
              webglHandleId,
            };
          };
          const initializedShared = [...c.assets.textures]
            .map(([key, texture]) => ({
              key,
              ...textureState(texture, [`assets:${key}`]),
            }))
            .filter((texture) => texture.initialized);
          const activeTextures = [...renderableTextures].map(
            ([texture, owners]) => ({
              ...textureState(texture, owners),
              shared: sharedTextures.has(texture),
            }),
          );
          const retainedSources =
            c.assets.retainedNativeMaterials instanceof Set
              ? [...c.assets.retainedNativeMaterials]
              : [];
          const retainedMaps = retainedSources.flatMap((source) => {
            const texture = c.assets.getNativeRenderMaterial(source)?.map;
            return texture
              ? [
                  {
                    sourceName: source.name,
                    ...textureState(texture, [`retained-MAT:${source.name}`]),
                    shared: sharedTextures.has(texture),
                  },
                ]
              : [];
          });
          const retainedHandleIds = [
            ...new Set(
              retainedMaps
                .map((texture) => texture.webglHandleId)
                .filter((id) => id !== null),
            ),
          ].sort((a, b) => a - b);
          const activeHandleIds = [
            ...new Set(
              activeTextures
                .map((texture) => texture.webglHandleId)
                .filter((id) => id !== null),
            ),
          ].sort((a, b) => a - b);
          const activeWebglHandles = new Map();
          for (const texture of activeTextures) {
            if (texture.webglHandleId === null) continue;
            const handle = activeWebglHandles.get(texture.webglHandleId) ?? {
              id: texture.webglHandleId,
              names: [],
              owners: [],
              uuids: [],
              sourceUuids: [],
              sourceObjectIds: [],
              sharedSourceKeys: [],
            };
            if (texture.name && !handle.names.includes(texture.name))
              handle.names.push(texture.name);
            for (const owner of renderableTextures.get(texture) ?? [])
              if (!handle.owners.includes(owner)) handle.owners.push(owner);
            if (!handle.uuids.includes(texture.uuid))
              handle.uuids.push(texture.uuid);
            if (
              texture.sourceUuid &&
              !handle.sourceUuids.includes(texture.sourceUuid)
            )
              handle.sourceUuids.push(texture.sourceUuid);
            for (const id of texture.sourceObjectIds)
              if (!handle.sourceObjectIds.includes(id))
                handle.sourceObjectIds.push(id);
            for (const key of texture.sharedSourceKeys)
              if (!handle.sharedSourceKeys.includes(key))
                handle.sharedSourceKeys.push(key);
            activeWebglHandles.set(texture.webglHandleId, handle);
          }
          const liveGpuState = glAudit
            ? {
                contextId: glAudit.contextId,
                createdCount: glAudit.createdCount,
                deletedCount: glAudit.deletedCount,
                unknownDeleteCount: glAudit.unknownDeleteCount,
                liveHandleCount: glAudit.live.size,
                uploadedLiveHandleCount: [...glAudit.live.values()].filter(
                  (record) => record.uploadCount > 0,
                ).length,
                currentOwnedHandleCount: currentHandles.size,
                liveUploadedHandlesAbsentCurrentOwners: [
                  ...glAudit.live.entries(),
                ]
                  .filter(
                    ([handle, record]) =>
                      record.uploadCount > 0 &&
                      !currentHandles.has(handle) &&
                      !(
                        record.lastUpload?.sourceObjectId &&
                        currentSourceObjects.has(
                          record.lastUpload.sourceObjectId,
                        )
                      ),
                  )
                  .map(([, record]) => ({
                    id: record.id,
                    storage: record.storage ?? null,
                    lastUpload: record.lastUpload,
                    createdStack: record.createdStack,
                    lastKnownOwners: record.lastKnownOwners,
                  })),
                liveUploadedHandlesWithSourceOwnerOnly: [
                  ...glAudit.live.entries(),
                ]
                  .filter(
                    ([handle, record]) =>
                      record.uploadCount > 0 &&
                      !currentHandles.has(handle) &&
                      !!record.lastUpload?.sourceObjectId &&
                      currentSourceObjects.has(
                        record.lastUpload.sourceObjectId,
                      ),
                  )
                  .map(([, record]) => ({
                    id: record.id,
                    storage: record.storage ?? null,
                    lastUpload: record.lastUpload,
                    createdStack: record.createdStack,
                    lastKnownOwners: record.lastKnownOwners,
                  })),
                recentDeletes: glAudit.recentDeletes.slice(-24),
              }
            : null;
          const cache = await Promise.all(c.assets.cache.values());
          return {
            label,
            race: c.raceDefinition?.raceFilename ?? null,
            opponents: c.rivals.map((rival) => rival.id),
            population: {
              state: c.populationLoadState,
              opponentCount: c.rivals.length,
              pedestrianCount: c.pedestrians?.count ?? 0,
              pedestrianGroups: [
                ...(c.pedestrians?.groupCounts ?? new Map()),
              ].map(([group, count]) => [group, count.total]),
            },
            renderer: {
              version: gl.getParameter(gl.VERSION),
              vendor: gl.getParameter(gl.VENDOR),
              renderer: debug
                ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
                : gl.getParameter(gl.RENDERER),
              drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
              isWebGL2:
                typeof WebGL2RenderingContext !== "undefined" &&
                gl instanceof WebGL2RenderingContext,
              info: {
                ...c.renderer.info.memory,
                programs: c.renderer.info.programs?.length ?? null,
              },
            },
            assets: {
              cacheEntries: c.assets.cache.size,
              cacheBytes: cache.reduce(
                (sum, entry) => sum + (entry.byteLength ?? 0),
                0,
              ),
              textureEntries: c.assets.textures.size,
              initializedSharedTextureCount: initializedShared.length,
              initializedSharedTextureIds: initializedShared
                .map((texture) => texture.uuid)
                .sort(),
              initializedSharedTextureSamples: initializedShared
                .slice(0, 20)
                .map(({ name, uuid }) => ({ name, uuid })),
              retainedNativeMaterialCount: retainedSources.length,
              retainedNativeMappedMaterialCount: retainedMaps.length,
              retainedNativeMaps: retainedMaps,
              retainedNativeUniqueWebGLHandleIds: retainedHandleIds,
              liveGpuState,
            },
            textureAudit: {
              activeRenderableTextureCount: activeTextures.length,
              activeRenderableSharedTextureCount: activeTextures.filter(
                (texture) => texture.shared,
              ).length,
              activeRenderablePrivateTextureCount: activeTextures.filter(
                (texture) => !texture.shared,
              ).length,
              activeRenderableInitializedTextureCount: activeTextures.filter(
                (texture) => texture.initialized,
              ).length,
              activeRenderableInitializedSharedTextureCount:
                activeTextures.filter(
                  (texture) => texture.initialized && texture.shared,
                ).length,
              activeRenderableInitializedPrivateTextureCount:
                activeTextures.filter(
                  (texture) => texture.initialized && !texture.shared,
                ).length,
              activeRenderableUniqueWebGLHandleIds: activeHandleIds,
              activeRenderableWebGLHandles: [...activeWebglHandles.values()],
              activePrivateTextureSamples: activeTextures
                .filter((texture) => texture.initialized && !texture.shared)
                .slice(0, 20)
                .map(({ name, uuid }) => ({ name, uuid })),
            },
            activeIds: Object.fromEntries(
              Object.entries(active).map(([key, ids]) => [
                key,
                [...ids].sort(),
              ]),
            ),
            heap: {
              usedSize: heap.usedSize,
              totalSize: heap.totalSize,
              embedderHeapUsedSize: heap.embedderHeapUsedSize,
            },
            disposed: Object.fromEntries(
              Object.entries(window.__resourceAuditProbe.disposed).map(
                ([key, objects]) => [key, objects.splice(0)],
              ),
            ),
          };
        },
        { label, heap },
      );
    };

    const initial = await readMetrics("warm initial load");
    report.backend = initial.renderer;
    report.initial = initial;
    let stableOpponentIds = opponentIds;
    const loadedIds = initial.opponents;
    if (
      !loadedIds.includes(opponentIds[0]) ||
      !loadedIds.includes(opponentIds[1])
    ) {
      // Select two valid native IDs from the completed warm load, then pin them
      // explicitly for all subsequent iterations.
      stableOpponentIds = [...new Set(loadedIds)].slice(0, 2);
    }
    assert.equal(
      stableOpponentIds.length,
      2,
      `Need at least two native opponents in warm load; got ${loadedIds}`,
    );
    report.requestedOpponentIds = stableOpponentIds;

    const loadRace = async (targetPath, label, expectPinned) => {
      const before = await page.evaluate(() => {
        const c = window.carma,
          ids = {
            geometry: new Set(),
            material: new Set(),
            texture: new Set(),
          };
        c.scene.traverse((item) => {
          if (item.isMesh || item.isLine || item.isPoints)
            ids.geometry.add(item.geometry.uuid);
          if (!item.isMesh && !item.isSprite && !item.isLine && !item.isPoints)
            return;
          for (const material of Array.isArray(item.material)
            ? item.material
            : [item.material]) {
            ids.material.add(material.uuid);
            if (material.map) ids.texture.add(material.map.uuid);
          }
        });
        return Object.fromEntries(
          Object.entries(ids).map(([key, value]) => [key, [...value]]),
        );
      });
      const started = performance.now();
      const transition = await page.evaluate(
        async ({ targetPath, stableOpponentIds, expectPinned }) => {
          const c = window.carma;
          c.paused = true;
          document.querySelector("#track-select").value = targetPath;
          if (expectPinned && c.raceDefinition) {
            c.raceDefinition.numberOfOpponents = stableOpponentIds.length;
            c.raceDefinition.explicitOpponents = [...stableOpponentIds];
          }
          const framesBeforeLoad = c.stats.frames;
          await c.loadRace();
          const framesAfterLoad = c.stats.frames;
          c.paused = true;
          return { framesBeforeLoad, framesAfterLoad };
        },
        { targetPath, stableOpponentIds, expectPinned },
      );
      await page.waitForFunction(
        () =>
          window.carma.stats.ready &&
          window.carma.paused &&
          window.carma.populationLoadState.opponents.state !== "loading" &&
          window.carma.populationLoadState.pedestrians.state !== "loading",
        null,
        { timeout: 120000 },
      );
      const sample = await readMetrics(label);
      sample.loadMs = Math.round(performance.now() - started);
      sample.transitionFrames = transition;
      assert.equal(
        transition.framesAfterLoad,
        transition.framesBeforeLoad,
        `A render frame ran before ${label} finished loading`,
      );
      sample.oldResourceCounts = Object.fromEntries(
        Object.entries(before).map(([kind, ids]) => [kind, ids.length]),
      );
      sample.oldResourcesDisposed = Object.fromEntries(
        Object.entries(before).map(([kind, ids]) => [
          kind,
          new Set(
            sample.disposed[kind]
              .filter((object) => ids.includes(object.uuid))
              .map((object) => object.uuid),
          ).size,
        ]),
      );
      sample.oldResourcesStillActive = Object.fromEntries(
        Object.entries(before).map(([kind, ids]) => [
          kind,
          ids.filter((id) => sample.activeIds[kind].includes(id)).length,
        ]),
      );
      if (expectPinned)
        assert.deepEqual(
          sample.opponents,
          stableOpponentIds,
          `Opponent set changed during ${label}`,
        );
      report.samples.push(sample);
    };

    for (let index = 1; index < cycles; index++)
      await loadRace(racePath, `primary reload ${index}/${cycles - 1}`, true);
    if (secondPath) {
      await loadRace(secondPath, "optional second scene", false);
      await loadRace(racePath, "return to primary scene", false);
    }
    const allSamples = [report.initial, ...report.samples];
    const baselineUnowned =
      report.initial.assets.liveGpuState
        ?.liveUploadedHandlesAbsentCurrentOwners ?? [];
    const baselineUnownedIds = baselineUnowned
      .map((handle) => handle.id)
      .sort((a, b) => a - b);
    assert.ok(
      baselineUnowned.length > 0 &&
        baselineUnowned.every(
          (handle) =>
            handle.lastUpload?.width === 1 && handle.lastUpload?.height === 1,
        ),
      "Expected only the renderer's persistent 1x1 default uploads at baseline",
    );
    for (let index = 1; index < allSamples.length; index++) {
      const sample = allSamples[index];
      const unowned =
        sample.assets.liveGpuState?.liveUploadedHandlesAbsentCurrentOwners ??
        [];
      const unownedIds = unowned
        .map((handle) => handle.id)
        .sort((a, b) => a - b);
      for (const handle of [
        ...unowned,
        ...(sample.assets.liveGpuState
          ?.liveUploadedHandlesWithSourceOwnerOnly ?? []),
      ]) {
        const sourceObjectId = handle.lastUpload?.sourceObjectId;
        handle.previousSampleSourceOwners = sourceObjectId
          ? allSamples.slice(0, index).flatMap((prior) =>
              prior.textureAudit.activeRenderableWebGLHandles
                .filter((owner) =>
                  owner.sourceObjectIds.includes(sourceObjectId),
                )
                .map((owner) => ({
                  sample: prior.label,
                  names: owner.names,
                })),
            )
          : [];
      }
      assert.deepEqual(
        unownedIds,
        baselineUnownedIds,
        `New uploaded WebGL texture handles lack current owners after ${sample.label}`,
      );
    }
    if (secondPath) {
      const primaryBeforeTransition = report.samples.findLast((sample) =>
        sample.label.startsWith("primary reload "),
      );
      const returnedPrimary = report.samples.find(
        (sample) => sample.label === "return to primary scene",
      );
      assert.ok(primaryBeforeTransition && returnedPrimary);
      assert.deepEqual(
        returnedPrimary.renderer.info,
        primaryBeforeTransition.renderer.info,
        "Returning to the primary scene did not restore its settled renderer counts",
      );
      report.crossSceneReturn = {
        baselinePrimaryRendererCounts: primaryBeforeTransition.renderer.info,
        returnedPrimaryRendererCounts: returnedPrimary.renderer.info,
        uploadedHandlesWithoutCurrentOwners: allSamples.map((sample) => ({
          label: sample.label,
          ids:
            sample.assets.liveGpuState?.liveUploadedHandlesAbsentCurrentOwners?.map(
              (handle) => handle.id,
            ) ?? [],
        })),
      };
    }
    const steady = report.samples
      .filter((sample) => sample.label.startsWith("primary reload "))
      .slice(1);
    report.steadyState = {
      basis:
        "primary reloads after the first reload, which can populate lazy resources and the fetched-byte cache",
      sampleCount: steady.length,
      rendererMemoryCounts: steady.map((sample) => sample.renderer.info),
      cacheEntries: steady.map((sample) => sample.assets.cacheEntries),
      cacheBytes: steady.map((sample) => sample.assets.cacheBytes),
      textureMapEntries: steady.map((sample) => sample.assets.textureEntries),
      heapUsedBytes: steady.map((sample) => sample.heap.usedSize),
      lastPriorSceneIdentitiesStillActive:
        report.samples.findLast((sample) =>
          sample.label.startsWith("primary reload "),
        )?.oldResourcesStillActive ?? null,
      lastPriorSceneIdentityDisposals:
        report.samples.findLast((sample) =>
          sample.label.startsWith("primary reload "),
        )?.oldResourcesDisposed ?? null,
    };
    assert.deepEqual(report.pageErrors, [], "Browser page errors occurred");
    assert.deepEqual(
      report.consoleErrors,
      [],
      "Browser console errors occurred",
    );
    assert.deepEqual(report.failedRequests, [], "Browser requests failed");
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify(
        {
          report: path.relative(repo, output),
          primaryLoads: cycles,
          samples: report.samples.length,
          backend: report.backend,
          cacheEntries: report.samples.at(-1)?.assets.cacheEntries,
          gpu: report.samples.map((sample) => sample.renderer.info),
        },
        null,
        2,
      ),
    );
  }
} catch (error) {
  // Keep the collected attribution on a regression, not just on successful runs.
  report.failure = error instanceof Error ? error.message : String(error);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  throw error;
} finally {
  await page?.close().catch(() => {});
  await cdp?.detach().catch(() => {});
  await browser?.close().catch(() => {});
  if (server?.exitCode === null) server.kill("SIGTERM");
  if (server && server.exitCode === null)
    await new Promise((resolve) => server.once("exit", resolve));
  await rm(temp, { recursive: true, force: true });
}
