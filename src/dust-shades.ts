/** GetSmokeShadeTables reads one RGB triplet and three strength scalars per
 * authored entry. The native puff renderer selects these at shade indices8..15. */
export function parseDustShades(text: string): number[] {
  const raw = text.split(/\r?\n/);
  const marker = raw.findIndex((line) =>
    /number of dust shade tables/i.test(line),
  );
  if (marker < 0) return [];
  const lines = raw
    .slice(marker)
    .map((line) => line.split("//")[0].trim())
    .filter(Boolean);
  const count = Number(lines.shift());
  if (!Number.isInteger(count) || count < 0 || count > 8)
    throw new Error("Invalid dust shade count (expected 0..8)");
  const colours: number[] = [];
  for (let i = 0; i < count; i++) {
    const rgb = lines
      .shift()
      ?.split(/[\s,]+/)
      .map(Number);
    const strengths = lines
      .shift()
      ?.split(/[\s,]+/)
      .map(Number);
    if (
      !rgb ||
      rgb.length !== 3 ||
      rgb.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
    )
      throw new Error(`Invalid dust shade RGB at entry ${i}`);
    if (
      !strengths ||
      strengths.length !== 3 ||
      strengths.some((n) => !Number.isFinite(n))
    )
      throw new Error(`Invalid dust shade strengths at entry ${i}`);
    colours.push((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]);
  }
  return colours;
}
