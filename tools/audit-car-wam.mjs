/** Read-only census of catalog car WAM identifiers versus the loaded ACT tree.
 * Run: node --import tsx tools/audit-car-wam.mjs
 * CARMA2_ROOT selects the installation; derived evidence stays in artifacts/.
 * This is a binding audit, not a simulation or a claim of native fidelity.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createAssetStore } from "../server/assets.mjs";
import { parseAct, parseDat } from "../src/formats.ts";
import { parseWam } from "../src/damage.ts";

const lower = (value) => value.toLowerCase();
const basename = (value) => value.split("/").at(-1);
const stem = (value) => basename(value).replace(/\.[^.]+$/, "");
const directory = (value) => value.slice(0, value.lastIndexOf("/"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

let store;
try {
  store = await createAssetStore(process.env.CARMA2_ROOT);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  console.log("SKIP: original installation absent");
  process.exit(0);
}
const paths = store.manifest.map((entry) => entry.path);
const byPath = new Map(paths.map((path) => [lower(path), path]));
const resolve = (path) => byPath.get(lower(path));
const configs = paths.filter(
  (path) =>
    /^(data|adv_data)\/cars\/[^/]+\/[^/]+\.txt$/i.test(path) &&
    lower(stem(path)) === lower(basename(directory(path))),
);
const rows = [];
const failures = [];
const parserWarnings = [];

for (const configPath of configs) {
  try {
    const inputHashes = {};
    const read = async (path) => {
      const bytes = await store.read(path);
      if (!bytes) throw new Error(`Missing indexed resource: ${path}`);
      inputHashes[path] = sha256(bytes);
      return bytes;
    };
    const dir = directory(configPath);
    const configText = (await read(configPath)).toString("latin1");
    const uncommented = configText
      .split(/\r?\n/)
      .map((line) => line.split("//")[0])
      .join("\n");
    const legacyWamToken = /([^\s,]+\.wam)\b/i.exec(uncommented)?.[1];
    const legacyStem =
      /([^\s,]+)\.txt\b/i.exec(uncommented)?.[1] ?? stem(configPath);
    // Deliberately retain the old selector as a reproducible defect baseline.
    const legacyWamPath = legacyWamToken
      ? (resolve(`data/CARS/${legacyStem}/${legacyWamToken}`) ??
        resolve(`adv_data/CARS/${legacyStem}/${legacyWamToken}`) ??
        paths.find((path) => lower(basename(path)) === lower(legacyWamToken)))
      : undefined;
    const localWamPaths = paths.filter(
      (path) => lower(directory(path)) === lower(dir) && /\.wam$/i.test(path),
    );
    const authoredWamPath = resolve(`${dir}/${stem(configPath)}.wam`);
    const fixedWamPath = legacyWamToken
      ? (resolve(`${dir}/${legacyWamToken}`) ?? authoredWamPath)
      : undefined;
    const actPath = resolve(`${dir}/${stem(configPath)}.act`);
    if (!actPath) throw new Error("Catalog car has no same-basename ACT");
    const models = new Map();
    for (const path of paths.filter(
      (path) => lower(directory(path)) === lower(dir) && /\.dat$/i.test(path),
    ))
      for (const model of parseDat(await read(path)))
        models.set(lower(model.name), { model, path });

    const actorBytes = await read(actPath);
    let actorTree;
    let actorParserCompatible = true;
    try {
      actorTree = parseAct(actorBytes);
    } catch (error) {
      // Some user-supplied mod resources append a text newline after ACT END.
      // Retry only a bounded suffix trim; never change the installation bytes.
      let end = actorBytes.length;
      while (
        end > actorBytes.length - 4 &&
        [10, 13, 32].includes(actorBytes[end - 1])
      )
        end--;
      if (end === actorBytes.length) throw error;
      actorTree = parseAct(actorBytes.subarray(0, end));
      actorParserCompatible = false;
      parserWarnings.push({
        path: actPath,
        error: String(error),
        auditFallback: `Ignored ${actorBytes.length - end} trailing whitespace byte(s) after ACT END`,
      });
    }
    const actors = [];
    const visit = (node, parentPath = "", parentStyle = 4) => {
      const actorPath = `${parentPath}/${node.name}`;
      const style = node.renderStyle || parentStyle;
      const source = node.model ? models.get(lower(node.model)) : undefined;
      actors.push({
        actor: node.name,
        actorPath,
        type: node.type,
        renderStyle: style,
        model: node.model ?? null,
        modelFound: !!source,
        renderedModel: !!source && style !== 1,
        vertices: source ? source.model.positions.length / 3 : 0,
        faces: source?.model.faces.length ?? 0,
        modelFlags: source?.model.flags ?? null,
      });
      for (const child of node.children) visit(child, actorPath, style);
    };
    for (const root of actorTree) visit(root);

    const wamInspections = new Map();
    const inspectWam = async (path) => {
      if (!path) return null;
      if (wamInspections.has(path)) return wamInspections.get(path);
      const wamText = (await read(path)).toString("latin1");
      let wam;
      let parserCompatible = true;
      try {
        wam = parseWam(wamText);
      } catch (error) {
        const normalized = wamText.replace(
          /^(\s*)very[ \t]+(hard|soft)([ \t]*(?:\/\/[^\r\n]*)?)$/gim,
          "$1very_$2$3",
        );
        if (normalized === wamText) throw error;
        wam = parseWam(normalized);
        parserCompatible = false;
        parserWarnings.push({
          path,
          error: String(error),
          auditFallback:
            "Normalized spaced very hard/very soft softness tokens only for the static census; production parser compatibility remains unresolved",
        });
      }
      // Group traversal claims its direct model before traversal reaches that
      // model's own Mesh node, exactly as DamageSystem's !data.runtime guard.
      const ownership = new Map(wam.parts.map((part) => [part, []]));
      for (const actor of actors) {
        if (!actor.renderedModel) continue;
        const part =
          wam.parts.find((part) => lower(part.actor) === lower(actor.actor)) ??
          wam.parts.find((part) => lower(part.actor) === lower(actor.model));
        if (part) ownership.get(part).push(actor);
      }
      const parts = wam.parts.map((part) => {
        const matches = actors.filter(
          (actor) => lower(actor.actor) === lower(part.actor),
        );
        // DamageSystem also visits direct Mesh nodes, whose names are DAT IDs.
        const modelMatches = actors.filter(
          (actor) =>
            actor.renderedModel && lower(actor.model) === lower(part.actor),
        );
        const bound = ownership.get(part);
        return {
          actor: part.actor,
          softness: part.softness,
          type: part.type,
          smashes: part.smashes.length,
          status: bound.length
            ? part.softnessFactor === 0
              ? "bound-uncrushable"
              : "bound-crushable"
            : matches.length
              ? matches.some((actor) => actor.model)
                ? "actor-model-not-rendered"
                : "actor-without-local-model"
              : modelMatches.length
                ? "model-already-claimed"
                : "actor-absent",
          actorMatches: matches.map((actor) => actor.actorPath),
          modelIdentifierMatches: modelMatches.map((actor) => actor.actorPath),
          boundModels: bound.map((actor) => ({
            actorPath: actor.actorPath,
            model: actor.model,
            vertices: actor.vertices,
          })),
        };
      });
      const boundActors = new Set(
        parts.flatMap((part) => part.boundModels.map((m) => m.actorPath)),
      );
      const counts = {};
      for (const part of parts)
        counts[part.status] = (counts[part.status] ?? 0) + 1;
      const inspection = {
        path,
        parserCompatible,
        version: wam.version,
        partCount: parts.length,
        boundPartCount: parts.filter((part) => part.boundModels.length).length,
        boundModelCount: boundActors.size,
        rootActor: actorTree[0]?.name ?? null,
        rootActorBound: boundActors.has(`/${actorTree[0]?.name}`),
        counts,
        parts,
        // Unlisted wheels/pivots can be intentional. Do not infer a defect from
        // absence alone; only WAM softness explicitly proves uncrushability.
        renderedActorsWithoutWam: actors.filter(
          (actor) => actor.renderedModel && !boundActors.has(actor.actorPath),
        ),
      };
      wamInspections.set(path, inspection);
      return inspection;
    };
    const legacy = await inspectWam(legacyWamPath);
    const authored =
      authoredWamPath === legacyWamPath
        ? legacy
        : await inspectWam(authoredWamPath);
    const fixed = await inspectWam(fixedWamPath);
    rows.push({
      configPath,
      scope: configPath.split("/")[0],
      legacyWamToken: legacyWamToken ?? null,
      legacyStem,
      localWamPaths,
      actPath,
      actorParserCompatible,
      actorCount: actors.length,
      renderedModelCount: actors.filter((actor) => actor.renderedModel).length,
      actors,
      legacy,
      authored,
      fixed,
      inputHashes,
    });
  } catch (error) {
    failures.push({ configPath, error: String(error) });
  }
}

const summarize = (cars, key) => ({
  cars: cars.length,
  missingWam: cars.filter((row) => !row[key]).map((row) => row.configPath),
  zeroBindings: cars
    .filter((row) => row[key]?.boundPartCount === 0)
    .map((row) => row.configPath),
  partialBindings: cars
    .filter(
      (row) =>
        row[key] &&
        row[key].boundPartCount > 0 &&
        row[key].boundPartCount < row[key].partCount,
    )
    .map((row) => ({
      configPath: row.configPath,
      bound: row[key].boundPartCount,
      total: row[key].partCount,
      counts: row[key].counts,
    })),
  unboundRootActor: cars
    .filter((row) => row[key] && !row[key].rootActorBound)
    .map((row) => row.configPath),
});
const summary = {
  catalogCars: configs.length,
  auditedCars: rows.length,
  failures,
  parserWarnings,
  scopes: Object.fromEntries(
    ["data", "adv_data"].map((scope) => {
      const cars = rows.filter((row) => row.scope === scope);
      return [
        scope,
        {
          legacy: summarize(cars, "legacy"),
          fixed: summarize(cars, "fixed"),
          authored: summarize(cars, "authored"),
        },
      ];
    }),
  ),
  changedSelection: rows
    .filter((row) => row.authored?.path !== row.legacy?.path)
    .map((row) => ({
      configPath: row.configPath,
      legacyPath: row.legacy?.path ?? null,
      authoredPath: row.authored?.path ?? null,
      legacyBound: row.legacy?.boundPartCount ?? 0,
      authoredBound: row.authored?.boundPartCount ?? 0,
    })),
  fixedVersusAuthored: rows
    .filter((row) => row.fixed?.path !== row.authored?.path)
    .map((row) => ({
      configPath: row.configPath,
      fixedPath: row.fixed?.path ?? null,
      authoredPath: row.authored?.path ?? null,
    })),
  productionParserIncompatible: rows
    .filter(
      (row) =>
        !row.actorParserCompatible || row.fixed?.parserCompatible === false,
    )
    .map((row) => row.configPath),
};
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  method:
    "Catalog matches src/main.ts. Exact ACT name and direct DAT Mesh-name matching follow DamageSystem binding. ACT render-style inheritance follows AssetManager.scene. DAT lookup is scoped to this car, newest exact identifier wins. Legacy selector is the pre-DMG-06 baseline. Fixed selector matches selected-directory token then selected TXT basename WAM from DamageSystem.init. Authored comparison always uses local same-basename WAM. Parser fallbacks are explicitly labeled audit-only and do not imply runtime compatibility.",
  limitations: [
    "Static asset census: no impacts, simulation or visual verification.",
    "Unlisted render models are reported separately; they are not assumed crushable or defective.",
    "WAM entries for existing model-less actors are distinguished from absent actors and explicitly uncrushable bound parts.",
    "Scene-global preloaded MODEL resources and native wildcard identifier lookup are not emulated; unresolved models remain visible in the report.",
  ],
  summary,
  cars: rows,
};
await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/car-wam-audit.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(summary, null, 2));
if (failures.length) process.exitCode = 1;
