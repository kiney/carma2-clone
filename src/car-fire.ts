import { sharedNativeRandom } from "./native-random";

const FIRE_VERTEX_COUNT = 12;
const UINT16_MAX = 0xffff;
const MAX_PREPARED_VERTICES = UINT16_MAX + 1;
const MAX_CONFIG_LENGTH = 1024 * 1024;
const MAX_CONFIG_LINES = 20_000;
const MAX_FIRE_SECTION_LINES = 64;

const FIRE_MARKER = /^\s*\/\/\s*damage\s+vertices\s+fire\s+points\s*$/i;
const SIGNED_INTEGER = /^[+-]?\d+$/;

/** Read the twelve authored damage/fire vertex IDs following the native
 * marker. The bounded scan avoids treating later keyword data as this table. */
export function parseCarFireVertices(text: string): number[] | undefined {
  if (text.length > MAX_CONFIG_LENGTH)
    throw new RangeError("Car config exceeds fire-vertex parse limit");
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n?|\n/);
  if (lines.length > MAX_CONFIG_LINES)
    throw new RangeError("Car config exceeds fire-vertex line limit");
  const marker = lines.findIndex((line) => FIRE_MARKER.test(line));
  if (marker < 0) return undefined;

  const values: number[] = [];
  const limit = Math.min(lines.length, marker + 1 + MAX_FIRE_SECTION_LINES);
  for (let line = marker + 1; line < limit; line++) {
    const value = lines[line].replace(/\/\/.*$/, "").trim();
    if (!value) {
      if (values.length === FIRE_VERTEX_COUNT) break;
      continue;
    }
    if (!SIGNED_INTEGER.test(value))
      throw new Error(
        "Malformed car fire vertices: expected one signed integer per line",
      );
    const parsed = Number(value);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < -0x80000000 ||
      parsed > 0x7fffffff
    )
      throw new Error(
        "Malformed car fire vertices: value is outside signed 32-bit range",
      );
    values.push(parsed);
    if (values.length === FIRE_VERTEX_COUNT) return values;
  }
  if (values.length !== FIRE_VERTEX_COUNT)
    throw new Error(
      "Malformed car fire vertices: expected exactly twelve values",
    );
  return values;
}

/** Apply LoadCar's uint16 storage, prepared-vertex clamp, first-match remap,
 * and all-zero random fallback in their native order. */
export function initializeNativeFireVertices(
  authored: readonly number[] | undefined,
  preparedSourceIndices: ArrayLike<number>,
  random: () => number = sharedNativeRandom.random,
): Uint16Array {
  if (!authored || authored.length !== FIRE_VERTEX_COUNT)
    throw new Error(
      "Native fire vertices require exactly twelve authored values",
    );
  const total = preparedSourceIndices.length;
  if (
    !Number.isSafeInteger(total) ||
    total < 1 ||
    total > MAX_PREPARED_VERTICES
  )
    throw new RangeError("Prepared car vertex count is outside uint16 bounds");
  if (typeof random !== "function")
    throw new TypeError("Native fire vertex random source must be callable");

  const firstPreparedIndex = new Map<number, number>();
  for (let index = 0; index < total; index++) {
    const sourceIndex = preparedSourceIndices[index];
    if (
      !Number.isInteger(sourceIndex) ||
      sourceIndex! < 0 ||
      sourceIndex! > UINT16_MAX
    )
      throw new RangeError(
        "Prepared source vertex ID is outside uint16 bounds",
      );
    if (!firstPreparedIndex.has(sourceIndex!))
      firstPreparedIndex.set(sourceIndex!, index);
  }

  const result = new Uint16Array(FIRE_VERTEX_COUNT);
  for (let index = 0; index < FIRE_VERTEX_COUNT; index++) {
    const value = authored[index];
    if (
      !Number.isSafeInteger(value) ||
      value < -0x80000000 ||
      value > 0x7fffffff
    )
      throw new RangeError(
        "Authored fire vertex is outside signed 32-bit bounds",
      );
    const stored = value & UINT16_MAX;
    result[index] = stored >= total ? 0 : stored;
  }

  // The native fallback checks this storage before changing any ID to its
  // prepared flattened index. Buggy/Copcar all-zero tables therefore draw 12.
  if (result.every((value) => value === 0)) {
    for (let index = 0; index < FIRE_VERTEX_COUNT; index++) {
      const sample = random();
      if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
        throw new RangeError(
          "Native fire vertex random sample must be in [0, 1)",
        );
      const nativeRand15 = Math.floor(sample * 0x8000);
      result[index] = Math.floor((nativeRand15 * total) / 0x8000);
    }
    return result;
  }

  for (let index = 0; index < FIRE_VERTEX_COUNT; index++) {
    const preparedIndex = firstPreparedIndex.get(result[index]);
    if (preparedIndex !== undefined) result[index] = preparedIndex;
  }
  return result;
}
