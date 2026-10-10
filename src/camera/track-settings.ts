const FLOAT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const TRACK_FILENAME = /^[A-Za-z0-9_.-]+\.TXT$/i;

/** Read the track's trailing Yon multiplier from its native ordered footer.
 * LoadInKevStuff consumes splash count/names; LoadRaceInfo then reads this
 * float and the trailing track filename (rec2 world.c:4436–4439). */
export function parseTrackCameraSettings(decodedTrack: string): number {
  const dataLines = decodedTrack
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.split("//", 1)[0].trim())
    .filter(Boolean);
  if (dataLines.length < 2)
    throw new Error("Track camera footer is missing Yon multiplier");

  const filename = dataLines.at(-1)!;
  if (!TRACK_FILENAME.test(filename))
    throw new Error("Track camera footer is missing its track filename");
  const token = dataLines.at(-2)!;
  if (!FLOAT.test(token)) throw new Error("Invalid track Yon multiplier");
  const multiplier = Number(token);
  const nativeMultiplier = Math.fround(multiplier);
  if (!Number.isFinite(nativeMultiplier))
    throw new Error("Track Yon multiplier exceeds native float range");
  return nativeMultiplier;
}
