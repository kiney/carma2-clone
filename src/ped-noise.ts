/** Parsed authored pedestrian sound choices and the MakePedNoise selector.
 * Selection/RNG is reconstructed from the installed call description; runtime
 * sound loading and playback remain the caller's responsibility. */

export const NATIVE_PED_NOISE_GROUP_COUNT = 11;
/** Packed personality structure has room for five WORDs per group. */
export const NATIVE_PED_NOISE_GROUP_CAPACITY = 5;
/** Browser parser bound for malformed/oversized authored source tables. */
export const NATIVE_PED_AUTHORED_NOISE_GROUP_MAX = 32;

export type NativePedNoiseGroups = readonly (readonly number[])[];

/** Parse the eleven count + sound-ID records in PEDS/SOUND/*.TXT. The safe
 * array bound allows reporting and playing oversized authored records without
 * reproducing the original fixed-structure overwrite. */
export function parseNativePedNoiseGroups(text: string): number[][] {
  if (typeof text !== "string")
    throw new Error("Pedestrian sound table must be text");
  const values = text
    .split(/\r?\n/)
    .map((line) => line.split("//", 1)[0].trim())
    .filter(Boolean)
    .flatMap((line) => line.split(/[\s,]+/).filter(Boolean));
  let cursor = 0;
  const readInteger = (description: string, min: number, max: number) => {
    const token = values[cursor++];
    if (token === undefined || !/^\d+$/.test(token))
      throw new Error(`Invalid pedestrian sound ${description}`);
    const value = Number(token);
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`Pedestrian sound ${description} out of range`);
    return value;
  };
  const groups: number[][] = [];
  for (let group = 0; group < NATIVE_PED_NOISE_GROUP_COUNT; group++) {
    const count = readInteger(
      `count for group ${group}`,
      0,
      NATIVE_PED_AUTHORED_NOISE_GROUP_MAX,
    );
    const sounds: number[] = [];
    for (let i = 0; i < count; i++)
      sounds.push(readInteger(`ID for group ${group}`, 0, 0xffff));
    groups.push(sounds);
  }
  if (cursor !== values.length)
    throw new Error("Unexpected trailing pedestrian sound table values");
  return groups;
}

/** Report source groups that exceed the installed packed five-WORD layout. */
export function nativePedNoiseDiagnostics(
  groups: NativePedNoiseGroups,
): string[] {
  return groups.flatMap((sounds, index) =>
    sounds.length > NATIVE_PED_NOISE_GROUP_CAPACITY
      ? [
          `Pedestrian sound group ${index} has ${sounds.length} IDs; native packed capacity is ${NATIVE_PED_NOISE_GROUP_CAPACITY}.`,
        ]
      : [],
  );
}

/** MakePedNoise 0x4cd630 chooses one authored ID with inclusive
 * IRandomBetween(0,count-1). Empty groups do not consume a CRT draw. */
export function selectNativePedNoise(
  groups: NativePedNoiseGroups,
  index: number,
  nextCrtInteger: (minimum: number, maximum: number) => number,
): number | undefined {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= NATIVE_PED_NOISE_GROUP_COUNT
  )
    throw new Error("Native pedestrian noise group index must be 0..10");
  if (groups.length !== NATIVE_PED_NOISE_GROUP_COUNT)
    throw new Error("Native pedestrian noise requires eleven groups");
  const sounds = groups[index];
  if (!sounds.length) return undefined;
  const selected = nextCrtInteger(0, sounds.length - 1);
  if (!Number.isInteger(selected) || selected < 0 || selected >= sounds.length)
    throw new Error("Native pedestrian noise RNG returned an invalid index");
  return sounds[selected];
}
