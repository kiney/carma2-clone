/** C2 world.c material-modifier records; material index is identifier[0]-'/'. */
export interface SurfaceModifier {
  wallFriction: number;
  tyreFriction: number;
  downforce: number;
  bumpiness: number;
  tyreSound: number;
  crashSound: number;
  scrapeSound: number;
  sparkiness: number;
  smokeType: number;
  skidMaterial: string;
}
export const DEFAULT_SURFACE: Readonly<SurfaceModifier> = Object.freeze({
  wallFriction: 1,
  tyreFriction: 1,
  downforce: 1,
  bumpiness: 0,
  tyreSound: 0,
  crashSound: 0,
  scrapeSound: 0,
  sparkiness: 1,
  smokeType: 0,
  skidMaterial: "NONE",
});
export function surfaceIndex(identifier: string): number {
  const i = identifier.charCodeAt(0) - 47;
  return Number.isInteger(i) && i >= 0 && i < 12 ? i : 0;
}
export function parseSurfaceModifiers(text: string): SurfaceModifier[] {
  const raw = text.split(/\r?\n/),
    marker = raw.findIndex((l) => /number of material modifiers/i.test(l));
  if (marker < 0)
    return Array.from({ length: 12 }, () => ({ ...DEFAULT_SURFACE }));
  const lines = raw
    .slice(marker)
    .map((l) => l.split("//")[0].trim())
    .filter(Boolean);
  let at = 0;
  const number = () => {
    const v = Number(lines[at++]);
    if (!Number.isFinite(v)) throw new Error("Invalid track material modifier");
    return v;
  };
  const count = number();
  if (!Number.isInteger(count) || count < 0 || count > 12)
    throw new Error("Invalid material modifier count");
  const result: SurfaceModifier[] = [];
  for (let i = 0; i < count; i++) {
    const values = Array.from({ length: 9 }, number),
      skidMaterial = lines[at++];
    if (!skidMaterial) throw new Error("Missing skid material");
    if (
      values.slice(4, 7).some((v) => !Number.isInteger(v)) ||
      !Number.isInteger(values[8])
    )
      throw new Error("Invalid material sound/type index");
    result.push({
      wallFriction: values[0],
      tyreFriction: values[1],
      downforce: values[2],
      bumpiness: values[3],
      tyreSound: values[4],
      crashSound: values[5],
      scrapeSound: values[6],
      sparkiness: values[7],
      smokeType: values[8],
      skidMaterial,
    });
  }
  while (result.length < 12) result.push({ ...DEFAULT_SURFACE });
  return result;
}
