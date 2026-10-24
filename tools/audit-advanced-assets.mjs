/** Bounded read-only audit of Advanced MAT/UI PIX compatibility and texture refs.
 * The report contains counts and representative paths, never asset payloads. */
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, sep, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAssetStore } from "../server/assets.mjs";
import { parseMat, parsePix } from "../src/formats.ts";
import { parseTiff } from "../src/tiff.ts";

const key = (name) =>
  name.replace(/\.(pix|mat|dat|act|tif|tiff)$/i, "").toLowerCase();
const isMap = (path) => /\.(?:pix|p16)$/i.test(path);
const isTiff = (path) => /\.tiff?$/i.test(path);
const isTextureFile = (path) =>
  isMap(path) || isTiff(path) || /\.p08$/i.test(path);
const isUiPixel = (path) =>
  /^adv_data\/(?:intrface|32x20x8|64x48x8)\//i.test(path) &&
  /\.(?:pix|p16)$/i.test(path);
const MAX_EXAMPLES = 20;

export function classifyParserError(message) {
  const text = String(message);
  if (/unsupported|unrecognized|unknown format/i.test(text))
    return "unsupported-variant";
  if (/missing brender header|invalid brender header/i.test(text))
    return "header-or-type-mismatch";
  if (/truncated or invalid data|length exceeds/i.test(text))
    return "parser-bounds-rejection-root-cause-unverified";
  if (
    /shorter than|exceeds .*bounds|outside file|shorter than dimensions|missing final end|unbalanced|invalid dimensions|invalid pixel size|missing pixels/i.test(
      text,
    )
  )
    return "structurally-invalid-or-incomplete";
  return "parser-rejection-unclassified";
}

export function classifyTextureReference({
  runtimeResolved,
  hostFileExists,
  hostEmbeddedNameExists,
}) {
  if (runtimeResolved) return "resolved-in-runtime-scope";
  if (hostFileExists || hostEmbeddedNameExists)
    return "asset-exists-outside-runtime-scope";
  return "no-basename-or-parsed-map-name-match";
}

function addCount(target, keyName) {
  target[keyName] = (target[keyName] ?? 0) + 1;
}

function materialSceneRoot(path) {
  const scene = /^(?:data|adv_data)\/(?:races|cars)\/[^/]+/i.exec(path);
  return scene?.[0] ?? path.slice(0, path.lastIndexOf("/"));
}

async function safeReportDestination(root, reportPath) {
  const rootReal = await realpath(root);
  let candidate = resolve(reportPath);
  // Resolve existing ancestors so a symlinked report directory cannot point
  // back into the original installation. Resolve a pre-existing file symlink
  // itself as well, because writeFile would otherwise follow it.
  try {
    candidate = await realpath(candidate);
  } catch {
    let ancestor = candidate;
    const suffix = [];
    while (true) {
      try {
        const resolvedAncestor = await realpath(ancestor);
        candidate = resolve(resolvedAncestor, ...suffix.reverse());
        break;
      } catch {
        const parent = dirname(ancestor);
        if (parent === ancestor) throw new Error("Cannot resolve report path");
        suffix.push(ancestor.slice(parent.length + 1));
        ancestor = parent;
      }
    }
  }
  const fromRoot = relative(rootReal, candidate);
  if (
    fromRoot === "" ||
    (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot))
  )
    throw new Error("Refusing to write audit report inside the configured original installation");
  return candidate;
}

function recordFailure(summary, path, message) {
  const category = classifyParserError(message);
  addCount(summary.failureCategories, category);
  if (summary.examples.length < MAX_EXAMPLES)
    summary.examples.push({
      path,
      category,
      message: String(message).slice(0, 240),
    });
}

async function readRequired(store, path) {
  const bytes = await store.read(path);
  if (!bytes) throw new Error(`Asset disappeared after indexing: ${path}`);
  return new Uint8Array(bytes);
}

function sharedCommonPaths(manifest) {
  const configuredRaceDirs = new Set(
    manifest
      .filter(
        (entry) =>
          /^data\/races\//i.test(entry.path) &&
          /\/[^/]+\.txt$/i.test(entry.path),
      )
      .map((entry) =>
        entry.path.slice(0, entry.path.lastIndexOf("/")).toLowerCase(),
      ),
  );
  return manifest
    .filter((entry) => {
      const path = entry.path;
      if (!/^data\/(?:races|reg|common|pixelmap)\//i.test(path)) return false;
      if (!(/\.p16$/i.test(path) || /^data\/pixelmap\/[^/]+\.pix$/i.test(path)))
        return false;
      return !configuredRaceDirs.has(
        path.slice(0, path.lastIndexOf("/")).toLowerCase(),
      );
    })
    .map((entry) => entry.path);
}

export async function auditAdvancedAssets({
  root = process.env.CARMA2_ROOT ?? "carma2_orig",
  writeReport = true,
  reportPath = "artifacts/advanced-assets-audit.json",
} = {}) {
  const store = await createAssetStore(root);
  const manifest = store.manifest;
  const materialPaths = manifest
    .filter(
      (entry) => /^adv_data\//i.test(entry.path) && /\.mat$/i.test(entry.path),
    )
    .map((entry) => entry.path);
  const uiPixelPaths = manifest
    .filter((entry) => isUiPixel(entry.path))
    .map((entry) => entry.path);
  const advancedMapPaths = manifest
    .filter((entry) => /^adv_data\//i.test(entry.path) && isMap(entry.path))
    .map((entry) => entry.path);
  const sharedPaths = sharedCommonPaths(manifest);
  const palettePath = store.manifest.find(
    (entry) => entry.path.toLowerCase() === "data/reg/palettes/drrender.pal",
  )?.path;
  let palette;
  let paletteResult = {
    path: palettePath ?? "data/Reg/PALETTES/DRRENDER.PAL",
    status: "missing-from-installation",
  };
  if (palettePath) {
    try {
      const parsed = parsePix(await readRequired(store, palettePath));
      palette = parsed[0]?.palette ?? parsed[0]?.rgba;
      paletteResult = {
        path: palettePath,
        status: palette
          ? "parsed-palette-container"
          : "parsed-no-palette-pixels",
        mapCount: parsed.length,
      };
    } catch (error) {
      paletteResult = {
        path: palettePath,
        status: "parser-rejected",
        category: classifyParserError(error),
        message: String(error).slice(0, 240),
      };
    }
  }

  const matSummary = {
    files: materialPaths.length,
    parsedFiles: 0,
    parsedRecords: 0,
    failureCategories: {},
    examples: [],
  };
  const uiSummary = {
    files: uiPixelPaths.length,
    parsedFiles: 0,
    parsedMaps: 0,
    failureCategories: {},
    examples: [],
  };
  const textureLibrarySummary = {
    files: sharedPaths.length + advancedMapPaths.length,
    parsedFiles: 0,
    mapRecords: 0,
    failureCategories: {},
    examples: [],
  };
  const allTextureEntries = [];
  const allHostBasenames = new Set(
    manifest
      .filter((entry) => isTextureFile(entry.path))
      .map((entry) => key(entry.path.split("/").at(-1) ?? entry.path)),
  );
  const hostBasenamePaths = new Map();
  for (const entry of manifest) {
    if (!isTextureFile(entry.path)) continue;
    const name = key(entry.path.split("/").at(-1) ?? entry.path);
    const matches = hostBasenamePaths.get(name) ?? [];
    if (matches.length < 3) matches.push(entry.path);
    hostBasenamePaths.set(name, matches);
  }
  const parsedMapFiles = new Map();
  const failedMapFiles = new Map();
  const parseMapFile = async (path, summary) => {
    if (parsedMapFiles.has(path)) return parsedMapFiles.get(path);
    try {
      const maps = parsePix(await readRequired(store, path), palette);
      const entries = maps.map((map) => ({
        path,
        name: key(map.name || path.split("/").at(-1) || ""),
      }));
      parsedMapFiles.set(path, entries);
      summary.parsedFiles++;
      summary.mapRecords += maps.length;
      allTextureEntries.push(...entries);
      return entries;
    } catch (error) {
      parsedMapFiles.set(path, null);
      failedMapFiles.set(path, String(error));
      recordFailure(summary, path, error);
      return null;
    }
  };

  // Serial file reads keep this census bounded on the user's workstation.
  for (const path of sharedPaths)
    await parseMapFile(path, textureLibrarySummary);
  for (const path of advancedMapPaths) {
    const entries = await parseMapFile(path, textureLibrarySummary);
    if (entries && isUiPixel(path)) {
      uiSummary.parsedFiles++;
      uiSummary.parsedMaps += entries.length;
    } else if (!entries && isUiPixel(path)) {
      recordFailure(
        uiSummary,
        path,
        failedMapFiles.get(path) ?? "PIX parser rejected this file",
      );
    }
  }
  // UI maps not already counted as Advanced libraries are still included here.
  for (const path of uiPixelPaths) {
    if (parsedMapFiles.has(path)) continue;
    const entries = await parseMapFile(path, uiSummary);
    if (entries) uiSummary.parsedMaps += entries.length;
  }

  const materials = [];
  for (const path of materialPaths) {
    try {
      const records = parseMat(await readRequired(store, path));
      matSummary.parsedFiles++;
      matSummary.parsedRecords += records.length;
      for (const material of records)
        if (material.texture)
          materials.push({
          path,
            sceneDir: materialSceneRoot(path),
            texture: material.texture,
          });
    } catch (error) {
      recordFailure(matSummary, path, error);
    }
  }

  const localMapCache = new Map();
  const localMapNames = async (sceneDir) => {
    const cacheKey = sceneDir.toLowerCase();
    if (localMapCache.has(cacheKey)) return localMapCache.get(cacheKey);
    const prefix = `${sceneDir.toLowerCase()}/`;
    const names = new Set();
    const tiffPaths = [];
    for (const entry of manifest) {
      if (!entry.path.toLowerCase().startsWith(prefix)) continue;
      if (isMap(entry.path)) {
        const maps = parsedMapFiles.get(entry.path);
        if (maps) for (const map of maps) names.add(map.name);
      } else if (isTiff(entry.path)) tiffPaths.push(entry.path);
    }
    localMapCache.set(cacheKey, { names, tiffPaths });
    return { names, tiffPaths };
  };
  const commonNames = new Set();
  for (const path of sharedPaths) {
    const entries = parsedMapFiles.get(path);
    if (entries) for (const entry of entries) commonNames.add(entry.name);
  }
  const hostMapNames = new Set(allTextureEntries.map((entry) => entry.name));
  const hostMapNamePaths = new Map();
  for (const entry of allTextureEntries) {
    const matches = hostMapNamePaths.get(entry.name) ?? [];
    if (matches.length < 3) matches.push(entry.path);
    hostMapNamePaths.set(entry.name, matches);
  }
  const resolutionCounts = {};
  const uniqueResolutionLabels = new Map();
  const unresolvedExamples = [];
  const tiffValidation = new Map();
  for (const reference of materials) {
    const wanted = key(reference.texture);
    const local = await localMapNames(reference.sceneDir);
    let resolved = commonNames.has(wanted) || local.names.has(wanted);
    if (!resolved) {
      const tiff = local.tiffPaths.find(
        (path) => key(path.split("/").at(-1) ?? path) === wanted,
      );
      if (tiff) {
        if (!tiffValidation.has(tiff)) {
          try {
            parseTiff(await readRequired(store, tiff));
            tiffValidation.set(tiff, true);
          } catch (error) {
            tiffValidation.set(tiff, {
              category: classifyParserError(error),
              message: String(error).slice(0, 240),
            });
          }
        }
        resolved = tiffValidation.get(tiff) === true;
      }
    }
    const category = classifyTextureReference({
      runtimeResolved: resolved,
      hostFileExists: allHostBasenames.has(wanted),
      hostEmbeddedNameExists: hostMapNames.has(wanted),
    });
    addCount(resolutionCounts, category);
    const uniqueKey = `${category}\0${wanted}`;
    if (!uniqueResolutionLabels.has(uniqueKey))
      uniqueResolutionLabels.set(uniqueKey, {
        category,
        label: reference.texture,
      });
    if (
      category !== "resolved-in-runtime-scope" &&
      unresolvedExamples.length < MAX_EXAMPLES
    )
      unresolvedExamples.push({
        materialPath: reference.path,
        texture: reference.texture,
        category,
        hostFileCandidates: hostBasenamePaths.get(wanted) ?? [],
        parsedMapCandidates: hostMapNamePaths.get(wanted) ?? [],
      });
  }

  const tiffFailures = [...tiffValidation.entries()]
    .filter(([, result]) => result !== true)
    .slice(0, MAX_EXAMPLES)
    .map(([path, result]) => ({ path, ...result }));
  const manifestByPath = new Map(manifest.map((entry) => [entry.path, entry]));
  const uiFailurePatterns = new Map();
  for (const [path, message] of failedMapFiles) {
    if (!isUiPixel(path)) continue;
    const size = manifestByPath.get(path)?.size ?? null;
    const category = classifyParserError(message);
    const signature = `${size}:${category}:${message}`;
    const current = uiFailurePatterns.get(signature) ?? {
      size,
      category,
      message: message.slice(0, 180),
      count: 0,
      examplePath: path,
    };
    current.count++;
    uiFailurePatterns.set(signature, current);
  }
  const uniqueResolutionCounts = {};
  for (const { category } of uniqueResolutionLabels.values())
    addCount(uniqueResolutionCounts, category);
  const report = {
    installationRoot: resolve(root),
    inventory: {
      manifestEntries: manifest.length,
      advancedMaterialFiles: materialPaths.length,
      advancedMapLibraryFiles: advancedMapPaths.length,
      sharedRuntimeMapLibraryFiles: sharedPaths.length,
      advancedUiPixelFiles: uiPixelPaths.length,
      uiPalette: paletteResult,
    },
    materialParsing: matSummary,
    uiPixelParsing: uiSummary,
    uiPixelFailurePatterns: [...uiFailurePatterns.values()],
    mapLibraryParsing: textureLibrarySummary,
    materialTextureReferences: {
      references: materials.length,
      distinctLabels: new Set(
        materials.map((reference) => key(reference.texture)),
      ).size,
      resolution: resolutionCounts,
      uniqueLabelResolution: uniqueResolutionCounts,
      unresolvedExamples,
      checkedScopedTiffFiles: tiffValidation.size,
      scopedTiffFailures: tiffFailures,
    },
    classificationNotes: [
      "Parser rejection categories are based on bounded error text; unclassified failures are retained as such rather than labeled malformed.",
      "Unknown asset labels are checked against runtime-scoped texture maps, original file basenames, and parsed PIX/P16 embedded map names; unmatched labels are not asserted to be genuinely absent when an unparsed container might contain the map.",
      "TIFF fallback matches the production scene loader: nested local TIFFs load by basename only when no PIX/P16 map already claimed that key.",
      "The original palette container is parsed as PIX/PAL data; a present palette is supplied to indexed maps to avoid false palette-missing reports.",
    ],
  };
  if (writeReport) {
    const destination = await safeReportDestination(root, reportPath);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
    report.reportPath = destination;
  }
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const stdout = process.argv.includes("--stdout");
  const report = await auditAdvancedAssets({ writeReport: !stdout });
  console.log(JSON.stringify(report, null, 2));
}
