#!/usr/bin/env node
/** Map a bounded CDP CPU profile through exact-byte-matched hidden source maps. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { SourceMap } from "node:module";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const MAX_PROFILE_BYTES = 128 * 1024 * 1024;
const MAX_MAP_BYTES = 64 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const MAX_NEGATIVE_TIME_DELTA_US = 60_000_000;
const TOP_LIMIT = 60;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
async function filesBelow(root, directory = root) {
  const rows = await readdir(directory, { withFileTypes: true }),
    files = [];
  for (const row of rows) {
    const path = resolve(directory, row.name);
    if (row.isDirectory()) files.push(...(await filesBelow(root, path)));
    else if (row.isFile()) files.push(relative(root, path));
  }
  return files;
}
const frameFile = (url) => {
  if (!url) return "";
  let path = String(url).split("?", 1)[0].split("#", 1)[0];
  try {
    path = new URL(url).pathname;
  } catch {
    // CDP can report non-URL script identifiers; treat them as paths.
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    // Keep the original identifier if it contains malformed escapes.
  }
  return basename(path);
};

/** Pair each hidden map with its generated JS and require exact build bytes. */
export async function loadVerifiedSourceMaps(mapDirectory, bundleDirectory) {
  const mapRoot = resolve(mapDirectory),
    bundleRoot = resolve(bundleDirectory),
    names = (await filesBelow(mapRoot)).filter((name) =>
      name.endsWith(".js.map"),
    );
  assert.ok(names.length, `No .js.map files found in ${mapRoot}`);
  assert.ok(names.length <= 64, "Source map count exceeds 64");
  const maps = new Map(),
    verification = [];
  for (const mapRelative of names) {
    const mapPath = resolve(mapRoot, mapRelative),
      mapBuffer = await readFile(mapPath);
    assert.ok(
      mapBuffer.byteLength <= MAX_MAP_BYTES,
      `Source map too large: ${mapRelative}`,
    );
    const mapData = JSON.parse(mapBuffer.toString("utf8"));
    assert.equal(
      mapData.version,
      3,
      `Unsupported source map version in ${mapRelative}`,
    );
    const adjacentCode = mapRelative.slice(0, -4),
      declaredCode = mapData.file
        ? basename(String(mapData.file).replaceAll("\\", "/"))
        : basename(adjacentCode),
      codeName = basename(adjacentCode);
    assert.equal(
      declaredCode,
      codeName,
      `Map file name mismatch: ${mapRelative}`,
    );
    const generatedPath = resolve(mapRoot, adjacentCode),
      bundlePath = resolve(bundleRoot, adjacentCode),
      [generated, bundled] = await Promise.all([
        readFile(generatedPath),
        readFile(bundlePath),
      ]);
    assert.ok(
      generated.byteLength <= MAX_BUNDLE_BYTES,
      `Mapped JS too large: ${codeName}`,
    );
    assert.ok(
      bundled.byteLength <= MAX_BUNDLE_BYTES,
      `Bundle JS too large: ${codeName}`,
    );
    const generatedHash = sha256(generated),
      bundleHash = sha256(bundled);
    assert.equal(
      generatedHash,
      bundleHash,
      `Hidden-map bundle bytes differ from profiled production bundle: ${codeName}`,
    );
    assert.ok(
      !maps.has(codeName),
      `Duplicate source map basename: ${codeName}`,
    );
    maps.set(codeName, new SourceMap(mapData));
    verification.push({
      file: adjacentCode.split(sep).join("/"),
      sha256: bundleHash,
      map: mapRelative.split(sep).join("/"),
      mapSha256: sha256(mapBuffer),
    });
  }
  return { maps, verification };
}

const sourceLocation = (node, maps) => {
  const frame = node.callFrame ?? {},
    file = frameFile(frame.url),
    sourceMap = maps.get(file);
  if (
    !sourceMap ||
    !Number.isInteger(frame.lineNumber) ||
    frame.lineNumber < 0 ||
    !Number.isInteger(frame.columnNumber) ||
    frame.columnNumber < 0
  )
    return null;
  const entry = sourceMap.findEntry(frame.lineNumber, frame.columnNumber);
  if (!entry?.originalSource || entry.originalLine < 0) return null;
  return {
    source: entry.originalSource,
    line: entry.originalLine + 1,
    column: entry.originalColumn + 1,
    functionName: entry.name || frame.functionName || "(anonymous)",
  };
};

/** Attribute sample durations to profile nodes, then roll them up their trees. */
export function summarizeCpuProfile(profile, maps) {
  assert.ok(
    Array.isArray(profile.nodes) && profile.nodes.length,
    "Profile has no nodes",
  );
  assert.ok(Array.isArray(profile.samples), "Profile has no samples array");
  assert.ok(
    Array.isArray(profile.timeDeltas),
    "Profile has no timeDeltas array",
  );
  assert.equal(
    profile.samples.length,
    profile.timeDeltas.length,
    "Profile samples/timeDeltas lengths differ",
  );
  assert.ok(
    profile.nodes.length <= 2_000_000,
    "Profile node count exceeds limit",
  );
  assert.ok(
    profile.samples.length <= 10_000_000,
    "Profile sample count exceeds limit",
  );
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  assert.equal(
    nodes.size,
    profile.nodes.length,
    "Profile has duplicate node ids",
  );
  const selfUs = new Map([...nodes.keys()].map((id) => [id, 0]));
  let normalizedTotalUs = 0,
    rawTotalUs = 0,
    negativeTimeDeltaCount = 0,
    negativeTimeDeltaTotalUs = 0,
    mappedUs = 0,
    missingSampleNodes = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i],
      delta = profile.timeDeltas[i];
    assert.ok(nodes.has(id), `Sample refers to missing node ${id}`);
    assert.ok(Number.isFinite(delta), `Invalid timeDelta at sample ${i}`);
    assert.ok(
      delta >= -MAX_NEGATIVE_TIME_DELTA_US,
      `timeDelta at sample ${i} is below the -60s sanity limit`,
    );
    const attributionDelta = Math.max(0, delta);
    selfUs.set(id, selfUs.get(id) + attributionDelta);
    rawTotalUs += delta;
    normalizedTotalUs += attributionDelta;
    if (delta < 0) {
      negativeTimeDeltaCount++;
      negativeTimeDeltaTotalUs += delta;
    }
    if (sourceLocation(nodes.get(id), maps)) mappedUs += attributionDelta;
    else missingSampleNodes++;
  }

  const inclusiveUs = new Map(),
    visiting = new Set();
  const sumTree = (id) => {
    if (inclusiveUs.has(id)) return inclusiveUs.get(id);
    assert.ok(!visiting.has(id), `Cycle in profile call tree at node ${id}`);
    visiting.add(id);
    const node = nodes.get(id);
    let total = selfUs.get(id);
    for (const childId of node.children ?? []) {
      assert.ok(
        nodes.has(childId),
        `Node ${id} refers to missing child ${childId}`,
      );
      total += sumTree(childId);
    }
    visiting.delete(id);
    inclusiveUs.set(id, total);
    return total;
  };
  for (const id of nodes.keys()) sumTree(id);

  const generated = [],
    sourceFunctions = new Map();
  for (const node of profile.nodes) {
    const frame = node.callFrame ?? {},
      self = selfUs.get(node.id),
      inclusive = inclusiveUs.get(node.id),
      mapped = sourceLocation(node, maps);
    generated.push({
      nodeId: node.id,
      functionName: frame.functionName || "(anonymous)",
      url: frame.url || "",
      line: Number.isInteger(frame.lineNumber) ? frame.lineNumber + 1 : null,
      column: Number.isInteger(frame.columnNumber)
        ? frame.columnNumber + 1
        : null,
      selfMs: self / 1000,
      inclusiveMs: inclusive / 1000,
      mapped,
    });
    if (!mapped) continue;
    const key = `${mapped.source}\0${mapped.line}\0${mapped.functionName}`,
      row = sourceFunctions.get(key) ?? {
        source: mapped.source,
        line: mapped.line,
        functionName: mapped.functionName,
        selfUs: 0,
        inclusiveUs: 0,
        nodes: 0,
      };
    row.selfUs += self;
    row.inclusiveUs += inclusive;
    row.nodes++;
    sourceFunctions.set(key, row);
  }
  const top = (rows, field) =>
    rows
      .sort((a, b) => b[field] - a[field])
      .slice(0, TOP_LIMIT)
      .map((row) => {
        const { selfUs, inclusiveUs, ...rest } = row;
        return {
          ...rest,
          selfMs: (selfUs ?? row.selfMs * 1000) / 1000,
          inclusiveMs: (inclusiveUs ?? row.inclusiveMs * 1000) / 1000,
        };
      });
  const sourceRows = [...sourceFunctions.values()];
  const profileSpanUs =
      Number.isFinite(profile.startTime) && Number.isFinite(profile.endTime)
        ? profile.endTime - profile.startTime
        : null,
    warnings = [];
  if (negativeTimeDeltaCount)
    warnings.push(
      `${negativeTimeDeltaCount} negative timeDelta value(s) totaling ${negativeTimeDeltaTotalUs} us were clamped to zero for attribution; source timings use normalized deltas.`,
    );
  if (profileSpanUs !== null && Math.abs(profileSpanUs - rawTotalUs) > 1000)
    warnings.push(
      `Profile start/end span differs from the raw timeDelta sum by ${profileSpanUs - rawTotalUs} us.`,
    );
  return {
    sampleCount: profile.samples.length,
    totalSampledMs: normalizedTotalUs / 1000,
    rawTimeDeltaTotalMs: rawTotalUs / 1000,
    negativeTimeDeltaCount,
    negativeTimeDeltaTotalMs: negativeTimeDeltaTotalUs / 1000,
    profileSpanMs: profileSpanUs === null ? null : profileSpanUs / 1000,
    profileSpanMinusRawDeltaMs:
      profileSpanUs === null ? null : (profileSpanUs - rawTotalUs) / 1000,
    mappedSampledMs: mappedUs / 1000,
    mappedSampleFraction: normalizedTotalUs
      ? mappedUs / normalizedTotalUs
      : null,
    samplesWithoutVerifiedSourceLocation: missingSampleNodes,
    topSourceFunctionsBySelfTime: top(sourceRows, "selfUs"),
    topSourceFunctionsByInclusiveTime: top([...sourceRows], "inclusiveUs"),
    topGeneratedNodesBySelfTime: top(generated, "selfMs"),
    topGeneratedNodesByInclusiveTime: top([...generated], "inclusiveMs"),
    warnings,
    interpretation:
      "Self time is attributed once per sample using max(timeDelta, 0); raw signed timeDeltas and negative-delta anomalies are reported separately. Inclusive time sums each node's subtree; top inclusive rows overlap across caller/callee ancestors and must not be added together. Source-function inclusive totals can also overlap, including recursion.",
  };
}

export async function summarizeCpuProfileFile({
  profilePath,
  mapDirectory,
  bundleDirectory,
}) {
  const profileBuffer = await readFile(profilePath);
  assert.ok(
    profileBuffer.byteLength <= MAX_PROFILE_BYTES,
    "CPU profile exceeds 128 MiB",
  );
  const profile = JSON.parse(profileBuffer.toString("utf8")),
    { maps, verification } = await loadVerifiedSourceMaps(
      mapDirectory,
      bundleDirectory,
    );
  return {
    profile: basename(profilePath),
    profileSha256: sha256(profileBuffer),
    verifiedBundles: verification,
    ...summarizeCpuProfile(profile, maps),
  };
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      "map-dir": { type: "string" },
      "bundle-dir": { type: "string" },
      output: { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(`Summarize a CDP .cpuprofile using exact-byte-verified hidden maps.
Usage: node tools/summarize-cpu-profile.mjs PROFILE --map-dir PATH --bundle-dir PATH [--output artifacts/NAME.json]
Map and bundle directories must contain matching generated .js/map pairs.
Every mapped bundle is SHA-256 checked against the supplied production bundle.
Without --output, write the bounded summary JSON to stdout.`);
    return;
  }
  assert.equal(positionals.length, 1, "Supply one .cpuprofile path");
  assert.ok(values["map-dir"], "--map-dir is required");
  assert.ok(values["bundle-dir"], "--bundle-dir is required");
  await Promise.all([access(values["map-dir"]), access(values["bundle-dir"])]);
  const report = await summarizeCpuProfileFile({
    profilePath: positionals[0],
    mapDirectory: values["map-dir"],
    bundleDirectory: values["bundle-dir"],
  });
  const output = JSON.stringify(report, null, 2);
  if (!values.output) {
    console.log(output);
    return;
  }
  const outputPath = resolve(values.output),
    artifactsRoot = resolve("artifacts"),
    outputRelative = relative(artifactsRoot, outputPath);
  assert.ok(
    outputRelative &&
      !outputRelative.startsWith("..") &&
      !isAbsolute(outputRelative),
    "--output must be inside ignored artifacts/",
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
  console.log(outputPath);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
