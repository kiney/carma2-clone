import { readdir, lstat, realpath, readFile, open } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

const RECORD_SIZE = 56;
const HEADER_SIZE = 8;

/** Parse a Carmageddon TWT archive table and return payload offsets. */
export function parseTwt(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length < HEADER_SIZE)
    throw new Error("TWT archive is shorter than its header");
  const totalLength = buffer.readUInt32LE(0);
  const count = buffer.readUInt32LE(4);
  if (totalLength !== buffer.length)
    throw new Error("TWT total length does not match buffer length");
  if (count > Math.floor((buffer.length - HEADER_SIZE) / RECORD_SIZE)) {
    throw new Error("TWT entry table exceeds archive bounds");
  }
  const payloadStart = HEADER_SIZE + count * RECORD_SIZE;
  const records = [];
  for (let i = 0; i < count; i++) {
    const at = HEADER_SIZE + i * RECORD_SIZE;
    const size = buffer.readUInt32LE(at);
    const nameBytes = buffer.subarray(at + 4, at + RECORD_SIZE);
    const nul = nameBytes.indexOf(0);
    const name = nameBytes
      .subarray(0, nul < 0 ? nameBytes.length : nul)
      .toString("utf8");
    if (
      !name ||
      name === "." ||
      name === ".." ||
      /[\\/]/.test(name) ||
      name.includes("\0")
    ) {
      throw new Error(`Unsafe or empty TWT entry name at index ${i}`);
    }
    records.push({ name, size });
  }
  let offset = payloadStart;
  const entries = records.map(({ name, size }) => {
    const entry = { name, size, offset };
    if (size > buffer.length - offset)
      throw new Error(`TWT entry exceeds archive bounds: ${name}`);
    offset += size + ((4 - (size % 4)) % 4);
    if (offset > buffer.length)
      throw new Error(`TWT entry padding exceeds archive bounds: ${name}`);
    return entry;
  });
  if (offset !== buffer.length)
    throw new Error("TWT payload lengths do not match archive length");
  return { totalLength, entries };
}

function relativeAssetPath(value) {
  if (
    typeof value !== "string" ||
    !value ||
    value.includes("\0") ||
    value.includes("\\")
  )
    return null;
  if (value.startsWith("/") || /^[a-z]:/i.test(value)) return null;
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return null;
  return parts.join("/");
}

/** Build a read-only, case-insensitive asset index rooted at root (default carma2_orig). */
export async function createAssetStore(root = path.resolve("carma2_orig")) {
  const rootPath = await realpath(root);
  const rootInfo = await lstat(rootPath);
  if (!rootInfo.isDirectory())
    throw new Error("Asset root must be a directory");
  const byKey = new Map();
  const archives = [];
  const withinRoot = (candidate) =>
    candidate === rootPath || candidate.startsWith(rootPath + path.sep);

  async function walk(directory, relative = "") {
    // Retain the host directory's enumeration rather than claiming sorted
    // filenames reproduce Windows FindFirst/FindNext.
    const names = await readdir(directory);
    for (const [directoryEntryIndex, name] of names.entries()) {
      const absolute = path.join(directory, name);
      const rel = relative ? `${relative}/${name}` : name;
      const info = await lstat(absolute);
      // Do not follow symlinks, including links that happen to point back into the root.
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        await walk(absolute, rel);
        continue;
      }
      if (!info.isFile()) continue;
      const normalized = relativeAssetPath(rel);
      if (normalized)
        add({
          path: normalized,
          size: info.size,
          kind: "file",
          absolute,
          enumeration: { kind: "host-directory", index: directoryEntryIndex },
        });
      if (name.toLowerCase().endsWith(".twt")) {
        try {
          const bytes = await readFile(absolute);
          const parsed = parseTwt(bytes);
          const parent = relative;
          const stem = name.slice(0, -4);
          const virtualDir = parent ? `${parent}/${stem}` : stem;
          for (const [archiveEntryIndex, entry] of parsed.entries.entries()) {
            const assetPath = relativeAssetPath(`${virtualDir}/${entry.name}`);
            if (assetPath)
              archives.push({
                path: assetPath,
                size: entry.size,
                kind: "archive",
                absolute,
                offset: entry.offset,
                enumeration: {
                  kind: "archive-table",
                  archive: rel,
                  index: archiveEntryIndex,
                },
              });
          }
        } catch (error) {
          // Invalid .TWT files remain available as ordinary files, but add no virtual entries.
          if (error?.code === "ENOENT") throw error;
        }
      }
    }
  }

  function add(asset) {
    const key = asset.path.toLocaleLowerCase("en-US");
    const current = byKey.get(key);
    if (!current || (current.kind === "archive" && asset.kind === "file"))
      byKey.set(key, asset);
  }

  await walk(rootPath);
  for (const asset of archives) {
    // A loose override changes bytes, not this mounted archive's enumeration.
    // Extra loose files remain supported as a local mod workflow; they are
    // explicitly identified as host-directory entries.
    const override = byKey.get(asset.path.toLocaleLowerCase("en-US"));
    if (override?.kind === "file") override.enumeration = asset.enumeration;
    add(asset);
  }
  const manifest = [...byKey.values()]
    .map(({ path: assetPath, size, enumeration }) => ({
      path: assetPath,
      size,
      enumeration,
    }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    manifest,
    async read(assetPath) {
      const normalized = relativeAssetPath(assetPath);
      if (!normalized) return null;
      const asset = byKey.get(normalized.toLocaleLowerCase("en-US"));
      if (!asset) return null;
      const actual = await realpath(asset.absolute);
      if (!withinRoot(actual)) return null;
      const info = await lstat(actual);
      if (!info.isFile() || info.isSymbolicLink()) return null;
      const handle = await open(
        actual,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
      );
      try {
        if (asset.kind === "file") return await handle.readFile();
        const out = Buffer.alloc(asset.size);
        let done = 0;
        while (done < out.length) {
          const { bytesRead } = await handle.read(
            out,
            done,
            out.length - done,
            asset.offset + done,
          );
          if (!bytesRead)
            throw new Error(`Archive changed after indexing: ${asset.path}`);
          done += bytesRead;
        }
        return out;
      } finally {
        await handle.close();
      }
    },
  };
}
