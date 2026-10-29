#!/usr/bin/env node
import { realpath, stat, open, readFile } from "node:fs/promises";
import { dirname, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { decodeCapture } from "../src/bug-capture/format.ts";

const MAX_FILE_BYTES = 512 * 1024 * 1024;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

function usage() {
  return "Usage: node --import tsx tools/read-bug-capture.mjs <file.c2bug> [--json <output.json>]";
}

function parseArgs(args) {
  if (args.length < 1 || args.length > 3) throw new Error(usage());
  const input = args[0];
  let jsonPath;
  if (args.length > 1) {
    if (args[1] !== "--json" || args.length !== 3 || !args[2])
      throw new Error(usage());
    jsonPath = args[2];
  }
  return { input, jsonPath };
}

async function safeOutputPath(path) {
  const destination = resolve(path);
  const tempRoot = await realpath(os.tmpdir());
  let parent;
  try {
    parent = await realpath(dirname(destination));
  } catch {
    throw new Error("Output directory must already exist");
  }
  const resolvedDestination = resolve(
    parent,
    destination.slice(dirname(destination).length + 1),
  );
  const inRoot = (root, candidate) => {
    const rel = relative(root, candidate);
    return (
      rel === "" ||
      (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))
    );
  };
  const artifactsRoot = resolve(REPO_ROOT, "artifacts");
  const allowed =
    inRoot(tempRoot, resolvedDestination) ||
    inRoot(artifactsRoot, resolvedDestination);
  const protectedOriginal = resolve(REPO_ROOT, "carma2_orig");
  let realOriginal;
  try {
    realOriginal = await realpath(protectedOriginal);
  } catch {
    realOriginal = protectedOriginal;
  }
  let existingDestination;
  try {
    existingDestination = await realpath(resolvedDestination);
  } catch {
    existingDestination = resolvedDestination;
  }
  if (
    !allowed ||
    inRoot(realOriginal, existingDestination) ||
    (inRoot(REPO_ROOT, existingDestination) &&
      !inRoot(artifactsRoot, existingDestination))
  )
    throw new Error(
      "JSON output must be under /tmp or the repository artifacts/ directory",
    );
  return resolvedDestination;
}

function decodeRecord(record) {
  if (record.kind === 4 || record.kind === 5 || record.kind === 6) {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      record.payload,
    );
    return { ...record, payload: JSON.parse(text) };
  }
  if (record.payload.byteLength % Float64Array.BYTES_PER_ELEMENT !== 0)
    throw new Error(`Record kind ${record.kind} has a non-Float64 payload`);
  const view = new DataView(
    record.payload.buffer,
    record.payload.byteOffset,
    record.payload.byteLength,
  );
  const values = new Array(record.payload.byteLength / 8);
  for (let i = 0; i < values.length; i++) {
    const value = view.getFloat64(i * 8, true);
    values[i] = Number.isNaN(value)
      ? "NaN"
      : value === Infinity
        ? "Infinity"
        : value === -Infinity
          ? "-Infinity"
          : value;
  }
  return { timeMs: record.timeMs, kind: record.kind, payloadValues: values };
}

async function writeFullJson(path, metadata, records) {
  // Exclusive creation rejects existing files and symlinks, preventing
  // accidental overwrite and symlink redirection after the path checks.
  const handle = await open(path, "wx");
  try {
    await handle.write('{"metadata":');
    await handle.write(JSON.stringify(metadata));
    await handle.write(',"records":[\n');
    for (let i = 0; i < records.length; i++) {
      if (i) await handle.write(",\n");
      await handle.write(JSON.stringify(decodeRecord(records[i])));
    }
    await handle.write("\n]}\n");
  } finally {
    await handle.close();
  }
}

export async function runCaptureCli(args, stdout = process.stdout) {
  const { input, jsonPath } = parseArgs(args);
  const inputPath = resolve(input);
  const info = await stat(inputPath);
  if (!info.isFile()) throw new Error("Input must be a regular file");
  if (info.size > MAX_FILE_BYTES)
    throw new Error("Capture file exceeds 512 MiB limit");
  const bytes = await readFile(inputPath);
  const { metadata, records } = decodeCapture(bytes, {
    maxFileBytes: MAX_FILE_BYTES,
  });
  const outputPath = jsonPath ? await safeOutputPath(jsonPath) : undefined;
  if (outputPath) {
    try {
      const [inputInfo, outputInfo] = await Promise.all([
        stat(inputPath),
        stat(outputPath),
      ]);
      if (inputInfo.dev === outputInfo.dev && inputInfo.ino === outputInfo.ino)
        throw new Error("JSON output cannot overwrite the input capture");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const kinds = {};
  for (const record of records)
    kinds[record.kind] = (kinds[record.kind] ?? 0) + 1;
  const times = records.map(({ timeMs }) => timeMs);
  const summary = {
    metadata,
    recordCount: records.length,
    kindCounts: kinds,
    timeRangeMs: {
      start: times.length ? times[0] : null,
      end: times.length ? times.at(-1) : null,
    },
    fileBytes: info.size,
  };
  stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (outputPath) await writeFullJson(outputPath, metadata, records);
  return summary;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runCaptureCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exitCode = 1;
  });
}
