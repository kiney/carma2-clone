/** Parse the source Options.txt GoreLevel value into the internal scale.
 * SetGoreLevel stores 2 - the user's 0..2 setting; the native default is 1. */
export function parseNativePedGoreOption(optionsText: string): number {
  if (typeof optionsText !== "string")
    throw new TypeError("Native pedestrian OPTIONS text must be a string");
  let level = 1;
  for (const [index, raw] of optionsText.split(/\r?\n/).entries()) {
    const line = raw.split("//", 1)[0].trim();
    if (!line) continue;
    const fields = line.split(/\s+/);
    if (fields[0] !== "GoreLevel") continue;
    if (fields.length !== 2 || !/^\d+$/.test(fields[1]))
      throw new Error(`Malformed GoreLevel option on line ${index + 1}`);
    const sourceLevel = Number(fields[1]);
    if (
      !Number.isSafeInteger(sourceLevel) ||
      sourceLevel < 0 ||
      sourceLevel > 2
    )
      throw new RangeError(
        `GoreLevel must be a decimal integer from 0 to 2 (line ${index + 1})`,
      );
    // The native OPTIONS loop applies every matching row in order; the last wins.
    level = 2 - sourceLevel;
  }
  return level;
}
