/** Read-only classification of the two known ACT compatibility anomalies.
 * See docs/actor-compatibility.md. Never writes to the source installation. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAct } from "../src/formats.ts";

export function inspectActEnvelope(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const hasHeader =
    bytes.length >= 16 &&
    view.getUint32(0) === 0x12 &&
    view.getUint32(4) === 8 &&
    view.getUint32(8) === 1 &&
    view.getUint32(12) === 2;
  if (!hasHeader) return { hasHeader: false, chunkCount: 0, endOffset: null };

  let chunkCount = 0;
  const knownTags = new Set([
    0, 0x23, 0x24, 0x25, 0x26, 0x29, 0x2a, 0x2b, 0x2c, 0x30, 0x31, 0x32,
  ]);
  const unknownTags = new Set();
  let offset = 16;
  let endOffset = null;
  let endCount = 0;
  while (offset < bytes.length) {
    if (bytes.length - offset < 8)
      return {
        hasHeader: true,
        chunkCount,
        unknownTags: [...unknownTags],
        endCount,
        endOffset,
        malformedAt: offset,
        trailingBytes: bytes.length - (endOffset ?? offset),
      };
    const tag = view.getUint32(offset);
    const length = view.getUint32(offset + 4);
    const payloadOffset = offset + 8;
    const next = payloadOffset + length;
    if (next > bytes.length)
      return {
        hasHeader: true,
        chunkCount,
        unknownTags: [...unknownTags],
        endCount,
        endOffset,
        malformedAt: offset,
        tag,
        length,
        trailingBytes: bytes.length - (endOffset ?? offset),
      };
    chunkCount++;
    if (!knownTags.has(tag)) unknownTags.add(tag);
    offset = next;
    if (tag === 0 && length === 0) {
      endOffset = offset;
      endCount++;
    }
  }
  return {
    hasHeader: true,
    chunkCount,
    unknownTags: [...unknownTags],
    endCount,
    endRecordOffset: endOffset === null ? null : endOffset - 8,
    endOffset,
    trailingBytes: bytes.length - offset,
  };
}

export function classifyAct(path, bytes) {
  const envelope = inspectActEnvelope(bytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (!envelope.hasHeader) {
    const text = new TextDecoder("latin1").decode(bytes);
    const printable = /^[\x09-\x0d\x20-\x7e]+$/.test(text);
    return {
      path,
      bytes: bytes.length,
      sha256: hash,
      classification: printable
        ? "text-placeholder-without-brender-header"
        : "missing-or-invalid-brender-header",
      printableText: printable ? text.slice(0, 64) : undefined,
      printableTextTruncated: printable && text.length > 64,
      parseResult: parseResult(bytes),
      envelope,
    };
  }
  const fullParse = parseResult(bytes);
  if (envelope.endOffset !== null && bytes.length > envelope.endOffset) {
    const trailing = bytes.subarray(envelope.endOffset);
    const whitespace = [...trailing].every(
      (b) => b === 9 || b === 10 || b === 13 || b === 32,
    );
    const trimmed = bytes.subarray(0, envelope.endOffset);
    let roots = null;
    let trimmedParseError;
    try {
      roots = parseAct(trimmed).length;
    } catch (error) {
      trimmedParseError =
        error instanceof Error ? error.message : String(error);
    }
    return {
      path,
      bytes: bytes.length,
      sha256: hash,
      classification:
        whitespace && roots !== null && envelope.unknownTags.length === 0
          ? "complete-act-with-trailing-whitespace"
          : roots !== null && envelope.unknownTags.length > 0
            ? "act-with-unverified-chunk-tags"
            : "parser-rejected-act",
      endOffset: envelope.endOffset,
      trailingBytes: trailing.length,
      trailingHexPrefix: Buffer.from(trailing.subarray(0, 64)).toString("hex"),
      trailingHexTruncated: trailing.length > 64,
      trailingWhitespace: whitespace,
      parsedRootsAfterAuditTrim: roots,
      trimmedParseError,
      parseResult: fullParse,
      envelope,
    };
  }
  if (fullParse.ok && envelope.unknownTags.length === 0)
    return {
      path,
      bytes: bytes.length,
      sha256: hash,
      classification: "complete-act",
      parseResult: fullParse,
      envelope,
    };
  return {
    path,
    bytes: bytes.length,
    sha256: hash,
    classification: fullParse.ok
      ? "act-with-unverified-chunk-tags"
      : "parser-rejected-act",
    parseResult: fullParse,
    envelope,
  };
}

function parseResult(bytes) {
  try {
    return { ok: true, roots: parseAct(bytes).length };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function auditOriginalActors(
  root = process.env.CARMA2_ROOT ?? "carma2_orig",
) {
  const paths = [
    "data/ACTORS/PROG.ACT",
    "adv_data/ACTORS/PROG.ACT",
    "adv_data/CARS/DIGGA/DIGGA.ACT",
  ];
  const rows = [];
  for (const path of paths) {
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) {
      rows.push({ path, skipped: "not present in local installation" });
      continue;
    }
    rows.push(classifyAct(path, new Uint8Array(await readFile(absolute))));
  }
  return rows;
}

export async function searchExecutableProgReferences(
  root = process.env.CARMA2_ROOT ?? "carma2_orig",
) {
  const findAsciiInsensitive = (bytes, needle) => {
    const wanted = Buffer.from(needle.toUpperCase(), "ascii");
    const offsets = [];
    for (let start = 0; start <= bytes.length - wanted.length; start++) {
      let equal = true;
      for (let i = 0; i < wanted.length; i++) {
        let got = bytes[start + i];
        if (got >= 0x61 && got <= 0x7a) got -= 0x20;
        if (got !== wanted[i]) {
          equal = false;
          break;
        }
      }
      if (equal) offsets.push(start);
    }
    return {
      count: offsets.length,
      offsets: offsets.slice(0, 16),
      offsetsTruncated: offsets.length > 16,
    };
  };
  const results = [];
  for (const file of ["carma2_HW.exe", "carma2_SW.exe"]) {
    const path = resolve(root, file);
    if (!existsSync(path)) {
      results.push({ file, skipped: "not present in local installation" });
      continue;
    }
    const bytes = new Uint8Array(await readFile(path));
    const findAll = (text, needle) => {
      const offsets = [];
      let at = 0;
      while ((at = text.indexOf(needle, at)) !== -1) {
        offsets.push(at);
        at += needle.length;
      }
      return {
        count: offsets.length,
        offsets: offsets.slice(0, 16),
        offsetsTruncated: offsets.length > 16,
      };
    };
    results.push({
      file,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      ascii: findAsciiInsensitive(bytes, "PROG.ACT"),
      utf16le: [0, 1].map((offset) => ({
        startingByteOffset: offset,
        ...findAll(
          Buffer.from(bytes.subarray(offset)).toString("utf16le").toUpperCase(),
          "PROG.ACT",
        ),
      })),
    });
  }
  return results;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(
    JSON.stringify(
      {
        installationRoot: process.env.CARMA2_ROOT ?? "carma2_orig",
        actors: await auditOriginalActors(),
        executableStringSearch: await searchExecutableProgReferences(),
      },
      null,
      2,
    ),
  );
}
