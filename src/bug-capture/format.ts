import {
  DEFAULT_CAPTURE_MAX_BYTES,
  DEFAULT_CAPTURE_MAX_RECORDS,
  type CaptureRecord,
  type CaptureSnapshot,
} from "./ring";

export const CAPTURE_MAGIC = "C2BUGCAP";
export const CAPTURE_FORMAT_VERSION = 1;
export const CAPTURE_FILE_HEADER_BYTES = 20;
export const CAPTURE_RECORD_HEADER_BYTES = 16;
export const DEFAULT_CAPTURE_MAX_METADATA_BYTES = 1024 * 1024;

export interface CaptureFormatLimits {
  maxFileBytes?: number;
  maxMetadataBytes?: number;
  maxRecords?: number;
}

function limits(options: CaptureFormatLimits) {
  const result = {
    maxFileBytes: options.maxFileBytes ?? DEFAULT_CAPTURE_MAX_BYTES,
    maxMetadataBytes:
      options.maxMetadataBytes ?? DEFAULT_CAPTURE_MAX_METADATA_BYTES,
    maxRecords: options.maxRecords ?? DEFAULT_CAPTURE_MAX_RECORDS,
  };
  for (const [key, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError(`Invalid ${key}`);
  }
  return result;
}

/** Validate bounded plain JSON before stringify, without invoking toJSON/getters. */
function metadataBytes(
  metadata: unknown,
  maxBytes: number,
): Uint8Array<ArrayBuffer> {
  let nodes = 0;
  let chars = 0;
  const seen = new Set<object>();
  function inspect(value: unknown, depth: number): void {
    if (++nodes > 10_000 || depth > 32)
      throw new RangeError("Capture metadata is too complex");
    if (typeof value === "string") chars += value.length;
    else if (value === null || typeof value === "boolean") {
      /* JSON scalar */
    } else if (typeof value === "number" && Number.isFinite(value)) {
      /* JSON number */
    } else if (typeof value === "object") {
      if (seen.has(value))
        throw new TypeError("Capture metadata contains a cycle");
      if (Object.getOwnPropertyDescriptor(value, "toJSON"))
        throw new TypeError("Capture metadata cannot contain toJSON");
      seen.add(value);
      if (Array.isArray(value)) {
        if (value.length > 10_000)
          throw new RangeError("Capture metadata array is too large");
        for (let i = 0; i < value.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
          if (!descriptor || !("value" in descriptor))
            throw new TypeError(
              "Capture metadata must contain plain JSON values",
            );
          inspect(descriptor.value, depth + 1);
        }
      } else {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null)
          throw new TypeError("Capture metadata must be plain JSON");
        for (const key in value) {
          if (!Object.hasOwn(value, key)) continue;
          chars += key.length;
          if (chars > maxBytes)
            throw new RangeError("Capture metadata is too large");
          const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
          if (!("value" in descriptor))
            throw new TypeError("Capture metadata cannot contain getters");
          inspect(descriptor.value, depth + 1);
        }
      }
      seen.delete(value);
    } else
      throw new TypeError("Capture metadata must contain plain JSON values");
    if (chars > maxBytes) throw new RangeError("Capture metadata is too large");
  }
  inspect(metadata, 0);
  const encoded = new TextEncoder().encode(JSON.stringify(metadata));
  if (encoded.byteLength > maxBytes)
    throw new RangeError("Capture metadata is too large");
  return encoded;
}

function recordValid(record: CaptureRecord, previousTime: number): boolean {
  return (
    Number.isFinite(record.timeMs) &&
    record.timeMs >= previousTime &&
    Number.isInteger(record.kind) &&
    record.kind >= 0 &&
    record.kind <= 0xffffffff &&
    record.payload instanceof Uint8Array &&
    record.payload.byteLength <= 0xffffffff
  );
}

/** Blob copies immutable payload parts without constructing a whole-file buffer. */
export function createCaptureBlob(
  snapshot: CaptureSnapshot,
  metadata: unknown,
  options: CaptureFormatLimits = {},
): Blob {
  const cap = limits(options);
  if (
    snapshot.records.length > cap.maxRecords ||
    snapshot.records.length > 0xffffffff
  )
    throw new RangeError("Too many capture records");
  const encodedMetadata = metadataBytes(metadata, cap.maxMetadataBytes);
  let totalBytes = CAPTURE_FILE_HEADER_BYTES + encodedMetadata.byteLength;
  let previousTime = -Infinity;
  for (const record of snapshot.records) {
    if (!recordValid(record, previousTime))
      throw new TypeError("Invalid capture record");
    previousTime = record.timeMs;
    totalBytes += CAPTURE_RECORD_HEADER_BYTES + record.payload.byteLength;
    if (totalBytes > cap.maxFileBytes)
      throw new RangeError("Capture file exceeds size limit");
  }
  if (totalBytes > cap.maxFileBytes)
    throw new RangeError("Capture file exceeds size limit");
  const header = new Uint8Array(CAPTURE_FILE_HEADER_BYTES);
  header.set(new TextEncoder().encode(CAPTURE_MAGIC));
  const view = new DataView(header.buffer);
  view.setUint32(8, CAPTURE_FORMAT_VERSION, true);
  view.setUint32(12, encodedMetadata.byteLength, true);
  view.setUint32(16, snapshot.records.length, true);
  const parts: BlobPart[] = [header, encodedMetadata];
  for (const record of snapshot.records) {
    const recordHeader = new ArrayBuffer(CAPTURE_RECORD_HEADER_BYTES);
    const recordView = new DataView(recordHeader);
    recordView.setFloat64(0, record.timeMs, true);
    recordView.setUint32(8, record.kind, true);
    recordView.setUint32(12, record.payload.byteLength, true);
    parts.push(recordHeader, record.payload);
  }
  return new Blob(parts, { type: "application/octet-stream" });
}

/** Validate the entire untrusted file before allocating copied record payloads. */
export function decodeCapture(
  input: Uint8Array | ArrayBuffer,
  options: CaptureFormatLimits = {},
): { metadata: unknown; records: CaptureRecord[] } {
  const cap = limits(options);
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength > cap.maxFileBytes)
    throw new RangeError("Capture file exceeds size limit");
  if (bytes.byteLength < CAPTURE_FILE_HEADER_BYTES)
    throw new Error("Truncated capture header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < CAPTURE_MAGIC.length; i++) {
    if (bytes[i] !== CAPTURE_MAGIC.charCodeAt(i))
      throw new Error("Invalid capture magic");
  }
  if (view.getUint32(8, true) !== CAPTURE_FORMAT_VERSION)
    throw new Error("Unsupported capture version");
  const metadataLength = view.getUint32(12, true);
  const count = view.getUint32(16, true);
  if (metadataLength > cap.maxMetadataBytes)
    throw new RangeError("Capture metadata exceeds size limit");
  if (count > cap.maxRecords) throw new RangeError("Too many capture records");
  const recordsStart = CAPTURE_FILE_HEADER_BYTES + metadataLength;
  if (recordsStart > bytes.byteLength)
    throw new Error("Truncated capture metadata");
  if (
    count >
    Math.floor((bytes.byteLength - recordsStart) / CAPTURE_RECORD_HEADER_BYTES)
  )
    throw new Error("Truncated capture records");
  let cursor = recordsStart;
  let previousTime = -Infinity;
  for (let i = 0; i < count; i++) {
    if (cursor + CAPTURE_RECORD_HEADER_BYTES > bytes.byteLength)
      throw new Error("Truncated capture record header");
    const timeMs = view.getFloat64(cursor, true);
    if (!Number.isFinite(timeMs) || timeMs < previousTime)
      throw new Error("Invalid capture timestamp order");
    previousTime = timeMs;
    const length = view.getUint32(cursor + 12, true);
    cursor += CAPTURE_RECORD_HEADER_BYTES;
    if (length > bytes.byteLength - cursor)
      throw new Error("Truncated capture record payload");
    cursor += length;
  }
  if (cursor !== bytes.byteLength)
    throw new Error("Unexpected trailing capture data");
  const metadata = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(CAPTURE_FILE_HEADER_BYTES, recordsStart),
    ),
  ) as unknown;
  // Apply the same structural limits as the exporter, including nesting limits.
  metadataBytes(metadata, cap.maxMetadataBytes);
  const records = new Array<CaptureRecord>(count);
  cursor = recordsStart;
  for (let i = 0; i < count; i++) {
    const timeMs = view.getFloat64(cursor, true);
    const kind = view.getUint32(cursor + 8, true);
    const length = view.getUint32(cursor + 12, true);
    cursor += CAPTURE_RECORD_HEADER_BYTES;
    // Uint8Array subclasses (notably Node Buffer) may implement slice as a
    // shared view. Always make an exact owned allocation explicitly.
    const payload = new Uint8Array(length);
    payload.set(bytes.subarray(cursor, cursor + length));
    records[i] = { timeMs, kind, payload };
    cursor += length;
  }
  return { metadata, records };
}
